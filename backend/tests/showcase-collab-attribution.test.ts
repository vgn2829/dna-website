// DNA 2.0 V1 — collaboration: attribution consent, publishing, activity, discussion and visibility.
import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getStorage } from '../src/storage';
import { query } from '../src/db/client';
import { COLLAB_LIMITS } from '../src/routes/showcaseCollab';
import {
  app, request, get, post, patch, put, cget, cpost, cpatch, cdel, pub, aTransition, auth, legacyAuth, asset, workspaceFor, student, publicProfile,
  ownerProject, invite, collabs, team, registerCollabHooks, S, C,
} from './helpers/collabHarness';
import { signBypassStudentToken } from '../src/middleware/studentAuth';

registerCollabHooks();

describe('contributor attribution (consent is separate from access)', () => {
  it('accepting access does NOT name the person publicly; a proposed credit needs their own explicit yes', async () => {
    const { id } = await ownerProject();
    await invite('ALICE', id, { roll: 'BOB', access_role: 'editor', role_label: 'Illustrator', contribution: 'Poster set' });
    expect((await cget('BOB', '/invitations')).body.invitations[0]).toMatchObject({ creditProposed: true, creditRole: 'Illustrator' });
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    const accepted = await cpost('BOB', `/invitations/${invId}/accept`);                          // no display_name
    expect(accepted.body.credited).toBe(false);
    expect((await get('BOB', `/mine/${id}`)).status).toBe(200);                                   // access: yes
    expect((await query<{ status: string }>('SELECT status FROM showcase_credits WHERE roll = $1', ['BOB']))[0].status).toBe('pending');   // credit: not yet
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(400);                         // a pending credit blocks submission
  });

  it('accepting with a display name also accepts the credit, and it publishes with the project', async () => {
    const { id } = await ownerProject();
    await invite('ALICE', id, { roll: 'BOB', access_role: 'editor', role_label: 'Illustrator' });
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    expect((await cpost('BOB', `/invitations/${invId}/accept`, { display_name: 'Bala I.' })).body.credited).toBe(true);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
    expect((await aTransition(id, 'approved')).status).toBe(200);
    expect((await aTransition(id, 'published')).status).toBe(200);
    const slug = (await get('ALICE', `/mine/${id}`)).body.slug;
    const detail = (await pub(`/projects/${slug}`)).body;
    expect(detail.credits.map((c: { displayName: string }) => c.displayName)).toEqual(['Asha Rao', 'Bala I.']);
    expect(JSON.stringify(detail)).not.toMatch(/"roll"|BOB|ALICE|@iitk/);
  });

  it('keeps an accepted credit when access is removed or the role changes, and drops it the instant the person withdraws consent', async () => {
    const { id } = await ownerProject();
    await invite('ALICE', id, { roll: 'BOB', access_role: 'editor', role_label: 'Illustrator' });
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    await cpost('BOB', `/invitations/${invId}/accept`, { display_name: 'Bala I.' });
    await post('ALICE', `/mine/${id}/submit`); await aTransition(id, 'approved'); await aTransition(id, 'published');
    const slug = (await get('ALICE', `/mine/${id}`)).body.slug;
    const names = async () => (await pub(`/projects/${slug}`)).body.credits.map((c: { displayName: string }) => c.displayName);
    expect(await names()).toContain('Bala I.');

    const rowId = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['BOB']))[0].id;
    expect((await cpatch('ALICE', `/projects/${id}/collaborators/${rowId}`, { access_role: 'viewer' })).status).toBe(200);
    expect(await names()).toContain('Bala I.');                                                   // role change ≠ credit change
    expect((await cdel('ALICE', `/projects/${id}/collaborators/${rowId}`)).status).toBe(200);
    expect((await get('BOB', `/mine/${id}`)).status).toBe(404);                                   // no access…
    expect(await names()).toContain('Bala I.');                                                   // …but the accepted attribution is preserved

    const credit = (await get('ALICE', `/mine/${id}`)).body.credits.find((c: { roll: string | null }) => c.roll === 'BOB');
    expect((await post('BOB', `/invitations/${credit.id}/decline`)).status).toBe(200);            // BOB withdraws consent (the existing credit flow)
    expect(await names()).not.toContain('Bala I.');                                               // gone from the public page immediately
  });

  it('ends a proposed-but-unaccepted credit together with the invitation that carried it (so it can never block submission)', async () => {
    const credit = async (roll: string) => (await query<{ status: string }>('SELECT status FROM showcase_credits WHERE roll = $1', [roll]))[0]?.status ?? null;
    const { id } = await ownerProject();
    // owner withdraws a pending invitation
    await invite('ALICE', id, { roll: 'BOB', access_role: 'viewer', role_label: 'Colour' });
    expect(await credit('BOB')).toBe('pending');
    const bobRow = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['BOB']))[0].id;
    await cdel('ALICE', `/projects/${id}/collaborators/${bobRow}`);
    expect(await credit('BOB')).toBeNull();
    // invitee declines
    await invite('ALICE', id, { roll: 'CAROL', access_role: 'viewer', role_label: 'Type' });
    await cpost('CAROL', `/invitations/${(await cget('CAROL', '/invitations')).body.invitations[0].id}/decline`);
    expect(await credit('CAROL')).toBeNull();
    // accepted access without accepting the credit, then leaves
    await invite('ALICE', id, { roll: 'ERIN', access_role: 'editor', role_label: 'Photos' });
    await cpost('ERIN', `/invitations/${(await cget('ERIN', '/invitations')).body.invitations[0].id}/accept`);
    expect(await credit('ERIN')).toBe('pending');
    await cpost('ERIN', `/projects/${id}/leave`);
    expect(await credit('ERIN')).toBeNull();
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);          // nothing left pending to block it
  });

  it('keeps the owner’s private moodboard links away from collaborators', async () => {
    const { id } = await ownerProject();
    await team(id);
    const board = await request(app).post('/api/boards').set(auth('ALICE')).send({ name: 'Secret Moodboard Name' });
    if (board.status === 201 || board.status === 200) await put('ALICE', `/mine/${id}/boards`, { board_ids: [board.body.id] });
    expect(JSON.stringify((await get('ALICE', `/mine/${id}`)).body.boards)).toContain(board.body.id ?? 'none');
    for (const who of ['BOB', 'CAROL']) {
      const body = (await get(who, `/mine/${id}`)).body;
      expect(body.boards).toEqual([]);
      expect(JSON.stringify(body)).not.toContain('Secret Moodboard Name');
    }
  });

  it('does not publish while a collaborator’s credit is still pending, even if an admin tries', async () => {
    const { id } = await ownerProject();
    await post('ALICE', `/mine/${id}/credits`, { roll: 'BOB', role_label: 'Colour' });
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(400);
    await query(`UPDATE showcase_projects SET status = 'approved' WHERE id = $1`, [id]);
    expect((await aTransition(id, 'published')).status).toBe(409);
  });
});

describe('publishing a project that has collaborator-added images', () => {
  it('copies the editor’s own image publicly, and removes it again the moment they are removed', async () => {
    const { id, ownerAsset } = await ownerProject();
    await team(id);
    const bobAsset = await asset('BOB', await workspaceFor('BOB'), 'bob.png');
    await put('BOB', `/mine/${id}/works`, { works: [{ asset_id: ownerAsset.id, is_cover: true }, { asset_id: bobAsset.id, caption: 'By Bala' }] });
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
    expect((await aTransition(id, 'approved')).status).toBe(200);
    expect((await aTransition(id, 'published')).status).toBe(200);
    const slug = (await get('ALICE', `/mine/${id}`)).body.slug;
    expect((await pub(`/projects/${slug}`)).body.works).toHaveLength(2);
    const keys = (await query<{ public_key: string }>('SELECT public_key FROM showcase_assets WHERE project_id = $1 AND added_by_roll = $2', [id, 'BOB'])).map(r => r.public_key);
    expect(keys).toHaveLength(1);
    await getStorage().download(keys[0]);                                                          // exists

    const rowId = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['BOB']))[0].id;
    expect((await cdel('ALICE', `/projects/${id}/collaborators/${rowId}`)).status).toBe(200);
    expect((await pub(`/projects/${slug}`)).body.works).toHaveLength(1);                          // immediately
    await expect(getStorage().download(keys[0])).rejects.toBeDefined();                            // and the public copy is deleted
    expect((await pub(`/projects/${slug}`)).status).toBe(200);                                    // project itself stays published
  });

  it('refuses to publish an image whose contributor no longer owns the source', async () => {
    const { id, ownerAsset } = await ownerProject();
    await team(id);
    const bobAsset = await asset('BOB', await workspaceFor('BOB'));
    await put('BOB', `/mine/${id}/works`, { works: [{ asset_id: ownerAsset.id, is_cover: true }, { asset_id: bobAsset.id }] });
    await post('ALICE', `/mine/${id}/submit`); await aTransition(id, 'approved');
    await query(`UPDATE assets SET owner_roll = 'DAVE' WHERE id = $1`, [bobAsset.id]);
    const res = await aTransition(id, 'published');
    expect(res.status).toBe(409);
    expect((await get('ALICE', `/mine/${id}`)).body.status).toBe('approved');
  });
});

describe('activity feed', () => {
  it('records who did what by NAME, never by roll, email or comment text', async () => {
    const { id } = await ownerProject();
    await team(id);
    await patch('BOB', `/mine/${id}`, { summary: 'Edited by the editor!' });
    await cpost('CAROL', `/projects/${id}/comments`, { body: 'SECRET-COMMENT-BODY' });
    const feed = (await cget('BOB', `/projects/${id}/activity`)).body;
    const kinds = feed.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['collaborator.invited', 'collaborator.accepted', 'content.updated', 'comment.added']));
    const text = JSON.stringify(feed);
    for (const leak of ['ALICE', 'BOB"', 'CAROL', 'DAVE', '@iitk', 'SECRET-COMMENT-BODY']) expect(text, leak).not.toContain(leak);
    expect(feed.items.find((i: { kind: string }) => i.kind === 'content.updated')).toMatchObject({ actorName: 'Bala Iyer', you: true, detail: { fields: ['summary'] } });
    expect(feed.items[0].id).toMatch(/^\d+$/);
  });

  it('is visible to every collaborator, hidden from strangers and pending invitees, and paginates', async () => {
    const { id } = await ownerProject();
    await team(id);
    await invite('ALICE', id, { roll: 'ERIN', access_role: 'viewer' });
    expect((await cget('CAROL', `/projects/${id}/activity`)).status).toBe(200);
    expect((await cget('ERIN', `/projects/${id}/activity`)).status).toBe(404);                    // pending invitee
    expect((await cget('DAVE', `/projects/${id}/activity`)).status).toBe(404);
    for (let i = 0; i < 35; i++) await query(`INSERT INTO showcase_activity (project_id, actor_roll, kind) VALUES ($1,'ALICE','comment.added')`, [id]);
    const first = (await cget('ALICE', `/projects/${id}/activity`)).body;
    expect(first.items).toHaveLength(COLLAB_LIMITS.pageSize);
    expect(first.next).toBeTruthy();
    const second = (await cget('ALICE', `/projects/${id}/activity?before=${first.next}`)).body;
    expect(second.items[0].id < first.items[first.items.length - 1].id || Number(second.items[0].id) < Number(first.items[first.items.length - 1].id)).toBe(true);
  });

  it('only exposes allow-listed detail keys', async () => {
    const { id } = await ownerProject();
    await query(`INSERT INTO showcase_activity (project_id, actor_roll, kind, detail) VALUES ($1,'ALICE','x.test','{"name":"ok","roll":"ALICE","email":"a@b.c"}')`, [id]);
    const item = (await cget('ALICE', `/projects/${id}/activity`)).body.items.find((i: { kind: string }) => i.kind === 'x.test');
    expect(item.detail).toEqual({ name: 'ok' });
  });
});

describe('discussion', () => {
  it('lets owner, editor and viewer talk; strangers and pending invitees cannot read or write', async () => {
    const { id } = await ownerProject();
    await team(id);
    await invite('ALICE', id, { roll: 'ERIN', access_role: 'viewer' });
    expect((await cpost('ALICE', `/projects/${id}/comments`, { body: 'Welcome both!' })).status).toBe(201);
    expect((await cpost('BOB', `/projects/${id}/comments`, { body: '  Thanks — starting on the posters.  ' })).status).toBe(201);
    expect((await cpost('CAROL', `/projects/${id}/comments`, { body: 'Love the palette.' })).status).toBe(201);
    const list = (await cget('CAROL', `/projects/${id}/comments`)).body.comments;
    expect(list.map((c: { body: string }) => c.body)).toEqual(['Welcome both!', 'Thanks — starting on the posters.', 'Love the palette.']);
    expect(list.map((c: { authorName: string }) => c.authorName)).toEqual(['Asha Rao', 'Bala Iyer', 'Chitra Nair']);
    expect(list.map((c: { mine: boolean }) => c.mine)).toEqual([false, false, true]);
    expect(JSON.stringify(list)).not.toMatch(/ALICE|BOB|CAROL|@iitk/);
    for (const who of ['DAVE', 'ERIN']) {
      expect((await cget(who, `/projects/${id}/comments`)).status).toBe(404);
      expect((await cpost(who, `/projects/${id}/comments`, { body: 'let me in' })).status).toBe(404);
    }
  });

  it('validates comment bodies and stores them as inert text', async () => {
    const { id } = await ownerProject();
    for (const body of ['', '   ', 'x'.repeat(COLLAB_LIMITS.commentChars + 1)]) expect((await cpost('ALICE', `/projects/${id}/comments`, { body })).status).toBe(400);
    expect((await cpost('ALICE', `/projects/${id}/comments`, { body: 'hi', extra: 1 })).status).toBe(400);
    expect((await cpost('ALICE', `/projects/${id}/comments`, { body: 'x'.repeat(COLLAB_LIMITS.commentChars) })).status).toBe(201);
    await cpost('ALICE', `/projects/${id}/comments`, { body: '<img src=x onerror=alert(1)>' });
    const stored = (await cget('ALICE', `/projects/${id}/comments`)).body.comments.at(-1).body;
    expect(stored).toBe('<img src=x onerror=alert(1)>');                                          // stored verbatim; the UI renders text nodes only
  });

  it('lets authors delete their own comments and the owner moderate anyone’s — nobody else', async () => {
    const { id } = await ownerProject();
    await team(id);
    const cid = async (roll: string, text: string) => { await cpost(roll, `/projects/${id}/comments`, { body: text }); return (await cget(roll, `/projects/${id}/comments`)).body.comments.find((c: { body: string }) => c.body === text).id as string; };
    const bobs = await cid('BOB', 'bobs note');
    const carols = await cid('CAROL', 'carols note');
    expect((await cdel('CAROL', `/projects/${id}/comments/${bobs}`)).status).toBe(403);
    expect((await cdel('DAVE', `/projects/${id}/comments/${bobs}`)).status).toBe(404);
    expect((await cdel('BOB', `/projects/${id}/comments/${bobs}`)).status).toBe(200);
    expect((await cdel('BOB', `/projects/${id}/comments/${bobs}`)).status).toBe(404);              // already deleted
    expect((await cdel('ALICE', `/projects/${id}/comments/${carols}`)).status).toBe(200);          // owner moderates
    expect((await cget('ALICE', `/projects/${id}/comments`)).body.comments).toEqual([]);
    const bobView = (await cget('BOB', `/projects/${id}/comments`)).body.comments;
    expect(bobView).toEqual([]);
  });

  it('a removed collaborator can no longer read the discussion', async () => {
    const { id } = await ownerProject();
    await team(id);
    await cpost('BOB', `/projects/${id}/comments`, { body: 'my note' });
    const rowId = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['BOB']))[0].id;
    await cdel('ALICE', `/projects/${id}/collaborators/${rowId}`);
    expect((await cget('BOB', `/projects/${id}/comments`)).status).toBe(404);
    expect((await cget('ALICE', `/projects/${id}/comments`)).body.comments).toHaveLength(1);       // history stays with the project
  });
});

describe('private and public visibility', () => {
  it('never exposes a project, its collaborators or its comments through any public endpoint before publication', async () => {
    const { id, slug } = await ownerProject('Hidden Draft Project');
    await team(id);
    await cpost('CAROL', `/projects/${id}/comments`, { body: 'internal-only chatter' });
    expect((await pub(`/projects/${slug}`)).status).toBe(404);
    const list = JSON.stringify((await pub('/projects')).body);
    expect(list).not.toContain('Hidden Draft Project');
    for (const p of [`/collab/projects/${id}/comments`, `/collab/projects/${id}/activity`, `/mine/${id}`, '/collab/invitations', '/collab/shared']) {
      expect((await request(app).get(S(p))).status, p).toBe(401);
    }
  });

  it('after publication the public page shows credited names only — no collaborators list, comments or activity', async () => {
    const { id } = await ownerProject();
    await team(id);
    await cpost('BOB', `/projects/${id}/comments`, { body: 'private-discussion-text' });
    await post('ALICE', `/mine/${id}/submit`); await aTransition(id, 'approved'); await aTransition(id, 'published');
    const slug = (await get('ALICE', `/mine/${id}`)).body.slug;
    const text = JSON.stringify((await pub(`/projects/${slug}`)).body);
    expect(text).not.toMatch(/private-discussion-text|collaborators|accessRole|permissions|activity|BOB|CAROL|ALICE/);
  });
});
