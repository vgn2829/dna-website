// DNA 2.0 V1 — collaboration: server-side permissions and revocation.
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

describe('permissions are enforced on the server', () => {
  it('stranger: every project route is a 404', async () => {
    const { id, ownerAsset } = await ownerProject();
    await team(id);
    const rowId = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['BOB']))[0].id;
    const responses = [
      await get('DAVE', `/mine/${id}`), await patch('DAVE', `/mine/${id}`, { title: 'Hijacked title' }),
      await put('DAVE', `/mine/${id}/works`, { works: [] }), await post('DAVE', `/mine/${id}/submit`), await post('DAVE', `/mine/${id}/archive`),
      await request(app).delete(S(`/mine/${id}`)).set(auth('DAVE')),
      await cget('DAVE', `/projects/${id}/activity`), await cget('DAVE', `/projects/${id}/comments`), await cpost('DAVE', `/projects/${id}/comments`, { body: 'hi' }),
      await cpatch('DAVE', `/projects/${id}/collaborators/${rowId}`, { access_role: 'viewer' }), await cdel('DAVE', `/projects/${id}/collaborators/${rowId}`),
      await cpost('DAVE', `/projects/${id}/leave`),
    ];
    for (const r of responses) expect(r.status).toBe(404);
    expect((await query<{ title: string }>('SELECT title FROM showcase_projects WHERE id = $1', [id]))[0].title).toBe('Festival Identity');
    expect(ownerAsset.id).toBeTruthy();
  });

  it('viewer: can read and discuss, nothing else', async () => {
    const { id } = await ownerProject();
    await team(id);
    const view = await get('CAROL', `/mine/${id}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ access: 'viewer', viewerIsOwner: false, title: 'Festival Identity' });
    expect(view.body.permissions.sort()).toEqual(['comment', 'view']);
    expect((await patch('CAROL', `/mine/${id}`, { title: 'Viewer edit' })).status).toBe(403);
    expect((await put('CAROL', `/mine/${id}/works`, { works: [] })).status).toBe(403);
    expect((await put('CAROL', `/mine/${id}/boards`, { board_ids: [] })).status).toBe(403);
    expect((await put('CAROL', `/mine/${id}/artworks`, { artwork_ids: [] })).status).toBe(403);
    expect((await post('CAROL', `/mine/${id}/credits`, { roll: 'DAVE' })).status).toBe(403);
    expect((await invite('CAROL', id, { roll: 'DAVE', access_role: 'viewer' })).status).toBe(403);
    expect((await post('CAROL', `/mine/${id}/submit`)).status).toBe(404);
    expect((await request(app).delete(S(`/mine/${id}`)).set(auth('CAROL'))).status).toBe(404);
    expect((await cpost('CAROL', `/projects/${id}/comments`, { body: 'Looks great' })).status).toBe(201);
  });

  it('editor: edits content and their own images; cannot invite, re-role, remove, submit, archive, delete or touch references', async () => {
    const { id, ownerAsset } = await ownerProject();
    await team(id);
    const view = await get('BOB', `/mine/${id}`);
    expect(view.body.access).toBe('editor');
    expect(view.body.permissions.sort()).toEqual(['comment', 'edit_content', 'edit_works', 'view']);

    expect((await patch('BOB', `/mine/${id}`, { title: 'Festival Identity v2', summary: 'An updated summary line' })).status).toBe(200);
    expect((await get('ALICE', `/mine/${id}`)).body.title).toBe('Festival Identity v2');
    expect((await patch('BOB', `/mine/${id}`, { owner_display_name: 'Not Asha' })).status).toBe(403);
    expect((await patch('BOB', `/mine/${id}`, { owner_role_label: 'Boss' })).status).toBe(403);

    const bobAsset = await asset('BOB', await workspaceFor('BOB'), 'bob.png');
    const keep = { asset_id: ownerAsset.id, caption: 'Hero', is_cover: true };
    expect((await put('BOB', `/mine/${id}/works`, { works: [keep, { asset_id: bobAsset.id, caption: 'By Bala' }] })).status).toBe(200);
    expect((await query<{ added_by_roll: string | null }>('SELECT added_by_roll FROM showcase_assets WHERE asset_id = $1', [bobAsset.id]))[0].added_by_roll).toBe('BOB');
    expect((await query<{ added_by_roll: string | null }>('SELECT added_by_roll FROM showcase_assets WHERE asset_id = $1', [ownerAsset.id]))[0].added_by_roll).toBeNull();

    // cannot add someone else's private image, nor delete the owner's
    const carolAsset = await asset('CAROL', await workspaceFor('CAROL'));
    expect((await put('BOB', `/mine/${id}/works`, { works: [keep, { asset_id: carolAsset.id }] })).status).toBe(404);
    expect((await put('BOB', `/mine/${id}/works`, { works: [{ asset_id: bobAsset.id }] })).status).toBe(403);
    // may reorder, caption and remove their own
    expect((await put('BOB', `/mine/${id}/works`, { works: [{ asset_id: bobAsset.id, caption: 'Moved first' }, keep] })).status).toBe(200);
    expect((await put('BOB', `/mine/${id}/works`, { works: [keep] })).status).toBe(200);
    expect((await query('SELECT 1 FROM showcase_assets WHERE asset_id = $1', [bobAsset.id])).length).toBe(0);

    const row = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['CAROL']))[0].id;
    expect((await invite('BOB', id, { roll: 'DAVE', access_role: 'viewer' })).status).toBe(403);
    expect((await cpatch('BOB', `/projects/${id}/collaborators/${row}`, { access_role: 'editor' })).status).toBe(403);
    expect((await cdel('BOB', `/projects/${id}/collaborators/${row}`)).status).toBe(403);
    expect((await post('BOB', `/mine/${id}/credits`, { roll: 'DAVE' })).status).toBe(403);
    expect((await put('BOB', `/mine/${id}/boards`, { board_ids: [] })).status).toBe(403);
    expect((await put('BOB', `/mine/${id}/artworks`, { artwork_ids: [] })).status).toBe(403);
    for (const act of ['submit', 'withdraw', 'archive', 'reopen']) expect((await post('BOB', `/mine/${id}/${act}`)).status).toBe(404);
    expect((await request(app).delete(S(`/mine/${id}`)).set(auth('BOB'))).status).toBe(404);
    expect((await get('ALICE', `/mine/${id}`)).body.status).toBe('draft');
  });

  it('freezes content for EVERY role while the project is in review or published', async () => {
    const { id, ownerAsset } = await ownerProject();
    await team(id);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
    expect((await patch('BOB', `/mine/${id}`, { title: 'Late edit' })).status).toBe(409);
    expect((await patch('ALICE', `/mine/${id}`, { title: 'Late owner edit' })).status).toBe(409);
    expect((await put('BOB', `/mine/${id}/works`, { works: [{ asset_id: ownerAsset.id, is_cover: true }] })).status).toBe(409);
    expect((await get('BOB', `/mine/${id}`)).body.contentEditable).toBe(false);
  });

  it('collaborators never receive roll numbers or other people’s emails', async () => {
    const { id } = await ownerProject();
    await team(id);
    await post('ALICE', `/mine/${id}/credits`, { roll: 'ERIN', role_label: 'Photographer' });
    for (const who of ['BOB', 'CAROL']) {
      const text = JSON.stringify((await get(who, `/mine/${id}`)).body);
      for (const secret of ['ALICE', 'DAVE', 'ERIN', '@iitk.ac.in', 'IITK-DnA']) expect(text, `${who} saw ${secret}`).not.toContain(secret);
      // a collaborator may see their OWN roll only inside their own credit row, never the pending credit of someone else
      expect((JSON.parse(text).credits as Array<{ displayName: string | null; status: string }>).every(c => c.status === 'accepted')).toBe(true);
    }
    const owner = JSON.stringify((await get('ALICE', `/mine/${id}`)).body);
    expect(owner).toContain('BOB');                                                              // the owner works with rolls
    expect(owner).not.toContain('@iitk.ac.in');
  });

  it('owner changes a role immediately; the new permissions apply on the very next request', async () => {
    const { id } = await ownerProject();
    await team(id);
    const rowId = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['CAROL']))[0].id;
    expect((await patch('CAROL', `/mine/${id}`, { summary: 'Viewer cannot edit this' })).status).toBe(403);
    expect((await cpatch('ALICE', `/projects/${id}/collaborators/${rowId}`, { access_role: 'editor' })).status).toBe(200);
    expect((await patch('CAROL', `/mine/${id}`, { summary: 'Now an editor can edit this' })).status).toBe(200);
    expect((await cpatch('ALICE', `/projects/${id}/collaborators/${rowId}`, { access_role: 'viewer' })).status).toBe(200);
    expect((await patch('CAROL', `/mine/${id}`, { summary: 'Demoted again, no more edits' })).status).toBe(403);
    expect((await cpatch('ALICE', `/projects/${id}/collaborators/${rowId}`, { access_role: 'owner' })).status).toBe(400);      // ownership cannot be granted
    expect((await cpatch('ALICE', `/projects/${id}/collaborators/${uuidv4()}`, { access_role: 'viewer' })).status).toBe(404);
  });

  it('lists shared projects for collaborators only, and never archived ones', async () => {
    const { id } = await ownerProject();
    await team(id);
    expect((await cget('BOB', '/shared')).body.projects).toMatchObject([{ id, accessRole: 'editor', ownerName: 'Asha Rao', title: 'Festival Identity' }]);
    expect((await cget('DAVE', '/shared')).body.projects).toEqual([]);
    expect((await get('ALICE', '/mine')).body.projects).toHaveLength(1);
    expect((await get('BOB', '/mine')).body.projects).toEqual([]);                                // shared projects are not "mine"
    await query(`UPDATE showcase_projects SET status = 'archived' WHERE id = $1`, [id]);
    expect((await cget('BOB', '/shared')).body.projects).toEqual([]);
  });
});

describe('revocation', () => {
  it('a removed collaborator loses access at once, and the images they contributed leave the project', async () => {
    const { id, ownerAsset } = await ownerProject();
    await team(id);
    const bobAsset = await asset('BOB', await workspaceFor('BOB'));
    await put('BOB', `/mine/${id}/works`, { works: [{ asset_id: ownerAsset.id, is_cover: true }, { asset_id: bobAsset.id }] });
    const rowId = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['BOB']))[0].id;
    expect((await cdel('ALICE', `/projects/${id}/collaborators/${rowId}`)).status).toBe(200);

    expect((await get('BOB', `/mine/${id}`)).status).toBe(404);
    expect((await patch('BOB', `/mine/${id}`, { title: 'Still here?' })).status).toBe(404);
    expect((await put('BOB', `/mine/${id}/works`, { works: [] })).status).toBe(404);
    expect((await cget('BOB', `/projects/${id}/comments`)).status).toBe(404);
    expect((await cget('BOB', '/shared')).body.projects).toEqual([]);
    expect((await query('SELECT 1 FROM showcase_assets WHERE project_id = $1 AND asset_id = $2', [id, bobAsset.id])).length).toBe(0);
    expect((await query('SELECT 1 FROM showcase_assets WHERE project_id = $1 AND asset_id = $2', [id, ownerAsset.id])).length).toBe(1);
    expect((await query('SELECT 1 FROM assets WHERE id = $1', [bobAsset.id])).length).toBe(1);   // their own library is untouched
    expect((await cdel('ALICE', `/projects/${id}/collaborators/${rowId}`)).status).toBe(404);     // already gone
  });

  it('a collaborator can leave at any time (the owner cannot)', async () => {
    const { id } = await ownerProject();
    await team(id);
    expect((await cpost('ALICE', `/projects/${id}/leave`)).status).toBe(400);
    expect((await cpost('BOB', `/projects/${id}/leave`)).status).toBe(200);
    expect((await get('BOB', `/mine/${id}`)).status).toBe(404);
    expect((await cpost('BOB', `/projects/${id}/leave`)).status).toBe(404);
    expect((await collabs(id)).find(c => c.roll === 'BOB')!.status).toBe('removed');
  });

  it('a removed collaborator cannot rejoin by replaying their old invitation id', async () => {
    const { id } = await ownerProject();
    await team(id);
    const invId = (await query<{ id: string }>('SELECT id FROM showcase_collaborators WHERE roll = $1', ['BOB']))[0].id;
    await cpost('BOB', `/projects/${id}/leave`);
    expect((await cpost('BOB', `/invitations/${invId}/accept`)).status).toBe(409);
    expect((await get('BOB', `/mine/${id}`)).status).toBe(404);
  });

  it('pulls a project out of review if its only images were withdrawn, rather than leaving it image-less', async () => {
    const { id, ownerAsset } = await ownerProject();
    await team(id);
    const bobAsset = await asset('BOB', await workspaceFor('BOB'));
    expect((await put('BOB', `/mine/${id}/works`, { works: [{ asset_id: ownerAsset.id, is_cover: true }, { asset_id: bobAsset.id }] })).status).toBe(200);
    await query('DELETE FROM showcase_assets WHERE asset_id = $1', [ownerAsset.id]);      // the owner removed their own image; BOB's is the only one left
    await query('UPDATE showcase_assets SET is_cover = true WHERE asset_id = $1', [bobAsset.id]);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
    expect((await cpost('BOB', `/projects/${id}/leave`)).status).toBe(200);
    const p = (await query<{ status: string }>('SELECT status FROM showcase_projects WHERE id = $1', [id]))[0];
    expect(p.status).toBe('draft');
    expect((await query<{ actor_kind: string }>(`SELECT actor_kind FROM showcase_events WHERE project_id = $1 AND from_status = 'submitted' AND to_status = 'draft'`, [id]))[0].actor_kind).toBe('system');
  });
});

