import { settleDerivativeJobs } from '../src/storage/derivatives';
import * as storageModule from '../src/storage';
import { pool } from '../src/db/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';

afterEach(async () => { await settleDerivativeJobs(); vi.restoreAllMocks(); });
const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const ids = (r: { body: { assets: { id: string }[] } }) => r.body.assets.map(a => a.id);
beforeEach(async () => {
  await query('TRUNCATE assets, asset_collections, workspaces CASCADE');
  for (const ws of ['source', 'target', 'outside']) {
    await query(`INSERT INTO workspaces(id,name,owner_roll,created_at) VALUES($1,$1,'OWNER',now())`, [ws]);
  }
  for (const [ws, roll, role] of [['source','OWNER','owner'],['source','MEMBER','member'],['target','OWNER','admin'],['target','RECIPIENT','member'],['outside','OUTSIDER','owner']]) {
    await query('INSERT INTO workspace_members(workspace_id,roll_number,role,added_at) VALUES($1,$2,$3,now())', [ws,roll,role]);
  }
  await query(`INSERT INTO asset_collections(id,workspace_id,name,created_by_roll,created_at,updated_at) VALUES('pack','source','Pack','OWNER',now(),now())`);
  for (const [id, visibility, status, kind, collection] of [
    ['shared','community','active','image','pack'], ['personal','personal','active','image',null],
    ['hidden','community','hidden','image','pack'], ['file','community','active','file',null],
  ]) {
    await query(`INSERT INTO assets(id,workspace_id,owner_roll,filename,storage_key,mime_type,size_bytes,created_at,visibility,status,kind,collection_id)
      VALUES($1,'source','OWNER',$1,'assets/source/' || $1 || '.png','image/png',68,$2,$3,$4,$5,$6)`,
      [id, '2026-01-01T00:00:00.000Z', visibility,status,kind,collection]);
  }
});
const list = (roll: string, workspace = 'source', filters = '') => request(app).get(`/api/assets?workspace_id=${workspace}${filters}`).set(auth(roll));

describe('scoped asset discovery', () => {
  it('Community plus a named collection binds the collection independently of workspace', async () => {
    const res = await list('MEMBER','source','&scope=community&collection_id=pack');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(['shared']);
  });
  it('does not expose Community assets in an unrelated workspace', async () => {
    expect(ids(await list('OUTSIDER','outside','&scope=community'))).toEqual([]);
  });
  it('non-owners cannot move a Community asset to a collection', async () => {
    expect((await request(app).patch('/api/assets/shared').set(auth('MEMBER')).send({collection_id:null})).status).toBe(403);
  });
});

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const upload = (workspace: string, key: string, filename = 'retry.png') => request(app).post('/api/assets').set(auth('OWNER'))
  .field('workspace_id',workspace).field('client_upload_id',key).attach('file',bytes,{filename,contentType:'image/png'});
describe('retry authorization', () => {
  it('does not return a hidden retry result', async () => {
    const first = await upload('source','hidden-retry');
    expect(first.status).toBe(201);
    await query(`UPDATE assets SET status='hidden' WHERE id=$1`,[first.body.id]);
    const retry = await upload('source','hidden-retry');
    expect(retry.status).toBe(404);
    expect(retry.body).not.toHaveProperty('url');
  });
  it('rejects a retry key reused in another workspace', async () => {
    expect((await upload('source','wrong-workspace')).status).toBe(201);
    expect((await upload('target','wrong-workspace')).status).toBe(409);
  });
  it('rejects a retry key reused for a different file identity', async () => {
    expect((await upload('source','wrong-filename')).status).toBe(201);
    expect((await upload('source','wrong-filename','other.png')).status).toBe(409);
  });
});

describe('explicit workspace grants', () => {
  const grant = (roll='OWNER', asset='shared', target='target') => request(app).put(`/api/assets/${asset}/shares/${target}`).set(auth(roll));
  const revoke = () => request(app).delete('/api/assets/shared/shares/target').set(auth('OWNER'));
  it('grants only the selected asset, idempotently, without changing its source or owner', async () => {
    const before = await query('SELECT * FROM assets ORDER BY id');
    expect((await grant()).status).toBe(204);
    expect((await grant()).status).toBe(204);
    expect(ids(await list('RECIPIENT','target'))).toEqual(['shared']);
    expect(ids(await list('OUTSIDER','outside'))).toEqual([]);
    expect(await query('SELECT * FROM assets ORDER BY id')).toEqual(before);
    expect(await query('SELECT * FROM asset_workspace_grants')).toHaveLength(1);
    expect((await request(app).get('/api/assets/shared?workspace_id=target').set(auth('RECIPIENT'))).status).toBe(200);
    expect((await request(app).get('/api/assets/shared?workspace_id=outside').set(auth('RECIPIENT'))).status).toBe(404);
    expect((await revoke()).status).toBe(204);
    expect(ids(await list('RECIPIENT','target'))).toEqual([]);
    expect((await request(app).get('/api/assets/shared?workspace_id=target').set(auth('RECIPIENT'))).status).toBe(404);
  });
  it('rejects non-owners, personal/hidden assets, non-member and arbitrary targets', async () => {
    expect((await grant('MEMBER')).status).toBe(404);
    expect((await grant('OWNER','shared','outside')).status).toBe(404);
    expect((await grant('OWNER','personal')).status).toBe(409);
    expect((await grant('OWNER','hidden')).status).toBe(409);
    expect((await grant('OWNER','shared','source')).status).toBe(409);
    expect(await query('SELECT * FROM asset_workspace_grants')).toHaveLength(0);
    // An ordinary (non-admin) member of the target may share their own asset there…
    await query(`UPDATE workspace_members SET role='member' WHERE workspace_id='target' AND roll_number='OWNER'`);
    expect((await grant()).status).toBe(204);
    await query('DELETE FROM asset_workspace_grants');
    // …but not once they are no longer a member of it.
    await query(`DELETE FROM workspace_members WHERE workspace_id='target' AND roll_number='OWNER'`);
    expect((await grant()).status).toBe(404);
    expect(await query('SELECT * FROM asset_workspace_grants')).toHaveLength(0);
  });
  it('hiding/unpublishing suspend grants; restoring Community restores their explicit access', async () => {
    await grant();
    for (const change of ["status='hidden'", "status='active', visibility='personal'"]) {
      await query(`UPDATE assets SET ${change} WHERE id='shared'`);
      expect(ids(await list('RECIPIENT','target'))).toEqual([]);
      expect((await request(app).get('/api/assets/shared').set(auth('RECIPIENT'))).status).toBe(404);
    }
    await query(`UPDATE assets SET visibility='community' WHERE id='shared'`);
    expect(ids(await list('RECIPIENT','target'))).toEqual(['shared']);
    await query(`DELETE FROM workspace_members WHERE workspace_id='target' AND roll_number='RECIPIENT'`);
    expect((await list('RECIPIENT','target')).status).toBe(403);
    expect((await request(app).get('/api/assets/shared').set(auth('RECIPIENT'))).status).toBe(404);
  });
  it('owner can revoke after losing target membership; deleting target cascades only grants', async () => {
    await grant();
    await query(`DELETE FROM workspace_members WHERE workspace_id='target' AND roll_number='OWNER'`);
    expect((await revoke()).status).toBe(204);
    await query(`INSERT INTO asset_workspace_grants(asset_id,workspace_id,created_by_roll) VALUES('shared','target','OWNER')`);
    await query(`DELETE FROM workspaces WHERE id='target'`);
    expect(await query('SELECT * FROM asset_workspace_grants')).toHaveLength(0);
    expect(await query("SELECT * FROM assets WHERE id='shared'")).toHaveLength(1);
  });
  it('schema migration is idempotent and preserves grants', async () => {
    const { initAssetSharingSchema } = await import('../src/db/assetSharingSchema');
    const { pool } = await import('../src/db/client');
    await grant();
    const before = await query('SELECT * FROM asset_workspace_grants');
    await initAssetSharingSchema(pool); await initAssetSharingSchema(pool);
    expect(await query('SELECT * FROM asset_workspace_grants')).toEqual(before);
  });
});

const cases = ['all','mine','community'].flatMap(scope => ['','pack','none'].flatMap(collection => ['image','file'].flatMap(kind => ['', 'sh'].map(q => ({scope,collection,kind,q})))));
describe('query filter matrix', () => {
  it.each(cases)('$scope / $collection / $kind / $q across source, grant and outsider', async ({scope,collection,kind,q}) => {
    await query(`INSERT INTO asset_workspace_grants(asset_id,workspace_id,created_by_roll) VALUES('shared','target','OWNER')`);
    const filters = `&scope=${scope}&kind=${kind}&q=${q}${collection ? `&collection_id=${collection}`:''}`;
    for (const [roll,ws] of [['OWNER','source'],['MEMBER','source'],['RECIPIENT','target'],['OUTSIDER','outside']]) {
      const res = await list(roll,ws,filters);
      expect(res.status).toBe(200);
      const candidates = ws==='source' ? (roll==='OWNER' ? ['shared','personal','file'] : scope==='mine'?[]:['shared','file']) : ws==='target' && scope!=='mine'?['shared']:[];
      const expected = candidates.filter(id => (scope!=='community' || id!=='personal') && (kind==='file' ? id==='file' : id!=='file') && (!q || id.includes(q)) && (!collection || (ws==='source' && (collection==='pack' ? id==='shared' : id!=='shared'))));
      expect(ids(res).sort()).toEqual(expected.sort());
      if (expected.length) {
        const page = await list(roll,ws,filters+'&limit=1');
        expect(page.body.assets).toHaveLength(1);
        const rest = await list(roll,ws,filters+'&cursor='+page.body.assets[0].id);
        expect(rest.status).toBe(200);
        expect(new Set([...ids(page),...ids(rest)])).toEqual(new Set(expected));
      }
    }
  });
  it('a hidden/personal cursor cannot probe otherwise visible rows', async () => {
    for (const cursor of ['hidden','personal']) expect(ids(await list('MEMBER','source','&cursor='+cursor))).toEqual([]);
  });
});

describe('storage integrity and management', () => {
  it('upload replay keeps one original and rejects different bytes of the same size', async () => {
    const store = vi.spyOn(storageModule.getStorage(),'uploadFile');
    const first = await upload('source','valid-retry');
    expect(first.status).toBe(201);
    expect((await upload('source','valid-retry')).body.id).toBe(first.body.id);
    const changed = Buffer.from(bytes); changed[changed.length-1] ^= 1;
    const bad = await request(app).post('/api/assets').set(auth('OWNER')).field('workspace_id','source').field('client_upload_id','valid-retry').attach('file',changed,{filename:'retry.png',contentType:'image/png'});
    expect(bad.status).toBe(409);
    expect(store).toHaveBeenCalledTimes(1);
    expect(first.body).not.toHaveProperty('upload_fingerprint');
  });
  it('concurrent matching uploads return the same asset and clean only the losing object', async () => {
    const store=vi.spyOn(storageModule.getStorage(),'uploadFile');
    const remove=vi.spyOn(storageModule.getStorage(),'delete');
    const [a,b]=await Promise.all([upload('source','racing-upload'),upload('source','racing-upload')]);
    expect([a.status,b.status].sort()).toEqual([200,201]);
    expect(a.body.id).toBe(b.body.id);
    expect(store.mock.calls.length-remove.mock.calls.length).toBe(1);
    const row=(await query<{storage_key:string}>('SELECT storage_key FROM assets WHERE id=$1',[a.body.id]))[0];
    expect(await storageModule.getStorage().download(row.storage_key)).toEqual(bytes);
  });
  it('owner metadata lookup failure does not leave an uploaded object', async () => {
    const store=vi.spyOn(storageModule.getStorage(),'uploadFile');
    const original=pool.query.bind(pool);
    vi.spyOn(pool,'query').mockImplementation(((sql: string, ...args: unknown[]) => {
      if (typeof sql==='string' && sql.includes('SELECT name FROM student_sessions')) return Promise.reject(new Error('injected owner lookup failure'));
      return (original as Function)(sql,...args);
    }) as typeof pool.query);
    expect((await upload('source','lookup-failure')).status).toBe(500);
    expect(store).not.toHaveBeenCalled();
  });
  it('members cannot rename, change visibility, delete or reshare; owner can manage', async () => {
    for (const body of [{filename:'new.png'},{visibility:'personal'},{collection_id:null}]) {
      expect((await request(app).patch('/api/assets/shared').set(auth('MEMBER')).send(body)).status).toBe(403);
    }
    expect((await request(app).delete('/api/assets/shared').set(auth('MEMBER'))).status).toBe(403);
    expect((await request(app).delete('/api/assets/shared/shares/target').set(auth('MEMBER'))).status).toBe(404);
    expect((await request(app).patch('/api/assets/shared').set(auth('OWNER')).send({filename:'new.png',collection_id:null})).status).toBe(200);
  });
  it('normal users cannot call site-admin sharing or moderation endpoints', async () => {
    for (const roll of ['OWNER','MEMBER','RECIPIENT','OUTSIDER']) {
      expect((await request(app).put('/api/assets/admin/shared/shares/target').set(auth(roll))).status).toBe(401);
      expect((await request(app).patch('/api/assets/admin/shared').set(auth(roll)).send({status:'hidden'})).status).toBe(401);
    }
  });
});
