// DNA 2.0 V1 — collaboration: invitations (who can invite, whom, how often) and answering them.
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

describe('invitations', () => {
  it('invites a student, who sees it pending but gets NO access until they accept', async () => {
    const { id } = await ownerProject();
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' })).status).toBe(201);
    const list = (await cget('BOB', '/invitations')).body.invitations;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ accessRole: 'editor', projectTitle: 'Festival Identity', ownerName: 'Asha Rao', projectStatus: 'draft' });
    expect(JSON.stringify(list)).not.toContain('ALICE');                         // owner's roll is never shown
    expect((await get('BOB', `/mine/${id}`)).status).toBe(404);                  // pending ≠ access
    expect((await cget('BOB', `/projects/${id}/comments`)).status).toBe(404);
    expect((await cpost('BOB', `/invitations/${list[0].id}/accept`)).status).toBe(200);
    expect((await get('BOB', `/mine/${id}`)).status).toBe(200);
  });

  it('only a VERIFIED (email-OTP) session can invite, accept, remove or change a role', async () => {
    const { id } = await ownerProject();
    const body = { roll: 'BOB', access_role: 'editor' };
    expect((await request(app).post(C(`/projects/${id}/collaborators`)).send(body)).status).toBe(401);
    expect((await request(app).post(C(`/projects/${id}/collaborators`)).set(legacyAuth('ALICE')).send(body)).status).toBe(403);
    expect((await request(app).post(C(`/projects/${id}/collaborators`)).set({ Authorization: `Bearer ${signBypassStudentToken('ALICE')}` }).send(body)).status).toBe(403);
    expect(await collabs(id)).toHaveLength(0);
    await invite('ALICE', id, body);
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    expect((await request(app).post(C(`/invitations/${invId}/accept`)).set(legacyAuth('BOB')).send({})).status).toBe(403);
  });

  it('only the owner can invite: collaborators get 403, strangers the same 404 as a missing project', async () => {
    const { id } = await ownerProject();
    await team(id);
    const body = { roll: 'ERIN', access_role: 'viewer' };
    expect((await invite('BOB', id, body)).status).toBe(403);       // editor
    expect((await invite('CAROL', id, body)).status).toBe(403);     // viewer
    expect((await invite('DAVE', id, body)).status).toBe(404);      // stranger
    expect((await invite('DAVE', uuidv4(), body)).status).toBe(404);
    expect((await collabs(id)).map(c => c.roll)).not.toContain('ERIN');
  });

  it('does not reveal whether a student exists, is blocking you, or has a private profile', async () => {
    const { id } = await ownerProject();
    await publicProfile('BOB', 'bala-iyer', 'public');
    await publicProfile('CAROL', 'chitra-nair', 'private');
    const unknown = await invite('ALICE', id, { roll: 'NOSUCHROLL', access_role: 'viewer' });
    const privateProfile = await invite('ALICE', id, { handle: 'chitra-nair', access_role: 'viewer' });
    const unknownHandle = await invite('ALICE', id, { handle: 'does-not-exist', access_role: 'viewer' });
    const self = await invite('ALICE', id, { roll: 'ALICE', access_role: 'viewer' });
    for (const r of [unknown, privateProfile, unknownHandle, self]) { expect(r.status).toBe(404); expect(r.body).toEqual(unknown.body); }
    expect((await invite('ALICE', id, { handle: 'bala-iyer', access_role: 'viewer' })).status).toBe(201);    // public handle resolves
  });

  it('rejects malformed invites (no/both identifiers, unknown role, extra fields, owner role)', async () => {
    const { id } = await ownerProject();
    for (const b of [{ access_role: 'viewer' }, { roll: 'BOB', handle: 'bob', access_role: 'viewer' }, { roll: 'BOB', access_role: 'owner' }, { roll: 'BOB', access_role: 'admin' }, { roll: 'BOB' }, { roll: 'BOB', access_role: 'editor', owner_roll: 'BOB' }]) {
      expect((await invite('ALICE', id, b)).status, JSON.stringify(b)).toBe(400);
    }
    expect(await collabs(id)).toHaveLength(0);
  });

  it('refuses duplicates and conflicting invitations', async () => {
    const { id } = await ownerProject();
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' })).status).toBe(201);
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' })).status).toBe(409);
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'viewer' })).status).toBe(409);          // conflicting role while pending
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    await cpost('BOB', `/invitations/${invId}/accept`);
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'viewer' })).status).toBe(409);          // already a collaborator
    expect((await collabs(id)).filter(c => c.roll === 'BOB')).toHaveLength(1);
  });

  it('serialises concurrent duplicate invites to exactly one', async () => {
    const { id } = await ownerProject();
    const results = await Promise.all(Array.from({ length: 6 }, () => invite('ALICE', id, { roll: 'BOB', access_role: 'editor' })));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(5);
    expect(await collabs(id)).toHaveLength(1);
  });

  it('caps active collaborators per project', async () => {
    const { id } = await ownerProject();
    for (let i = 0; i < COLLAB_LIMITS.activeCollaborators; i++) {
      await student(`X${i}`);
      expect((await invite('ALICE', id, { roll: `X${i}`, access_role: 'viewer' })).status).toBe(201);
    }
    await student('XOVER');
    const over = await invite('ALICE', id, { roll: 'XOVER', access_role: 'viewer' });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/Up to 10/);
  });

  it('caps invitations per person per day (database-backed), even across projects', async () => {
    const { id } = await ownerProject();
    const other = await post('ALICE', '/mine', { title: 'Second project' });
    for (let i = 0; i < COLLAB_LIMITS.invitesPerDay; i++) {
      await query(`INSERT INTO showcase_collaborators (id, project_id, roll, access_role, status, invited_by, invited_at) VALUES ($1,$2,$3,'viewer','declined','ALICE', NOW() - INTERVAL '2 hours')`, [uuidv4(), other.body.id, `OLD${i}`]);
    }
    const res = await invite('ALICE', id, { roll: 'BOB', access_role: 'viewer' });
    expect(res.status).toBe(429);
    await query(`UPDATE showcase_collaborators SET invited_at = NOW() - INTERVAL '30 hours' WHERE invited_by = 'ALICE'`);
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'viewer' })).status).toBe(201);
  });

  it('rate-limits invitation bursts per student', async () => {
    process.env.SHOWCASE_TEST_LIMITS = '1';
    const { id } = await ownerProject();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await invite('ALICE', id, { roll: `NOPE${i}`, access_role: 'viewer' })).status);
    expect(statuses.slice(0, 10).every(s => s === 404)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('only allows invitations while the project is editable', async () => {
    const { id } = await ownerProject();
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'viewer' })).status).toBe(409);
  });
});

describe('responding to invitations', () => {
  it('lets the owner withdraw a pending invitation, after which it cannot be accepted', async () => {
    const { id } = await ownerProject();
    await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' });
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    const rowId = (await get('ALICE', `/mine/${id}`)).body.collaborators.find((c: { roll?: string }) => c.roll === 'BOB').id;
    expect((await cdel('ALICE', `/projects/${id}/collaborators/${rowId}`)).status).toBe(200);
    expect((await collabs(id))[0].status).toBe('withdrawn');
    expect((await cget('BOB', '/invitations')).body.invitations).toHaveLength(0);
    expect((await cpost('BOB', `/invitations/${invId}/accept`)).status).toBe(409);
    expect((await get('BOB', `/mine/${id}`)).status).toBe(404);
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'viewer' })).status).toBe(201);        // a withdrawn invite may be re-sent
  });

  it('only the invited student can answer, and only once', async () => {
    const { id } = await ownerProject();
    await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' });
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    expect((await cpost('DAVE', `/invitations/${invId}/accept`)).status).toBe(404);           // someone else's invitation
    expect((await cpost('ALICE', `/invitations/${invId}/accept`)).status).toBe(404);          // not even the inviter
    expect((await cpost('DAVE', `/invitations/${invId}/decline`)).status).toBe(404);
    expect((await cpost('BOB', `/invitations/${invId}/accept`)).status).toBe(200);
    expect((await cpost('BOB', `/invitations/${invId}/accept`)).status).toBe(409);
    expect((await cpost('BOB', `/invitations/${invId}/decline`)).status).toBe(409);
  });

  it('declining gives no access and imposes a cooldown before the owner can ask again', async () => {
    const { id } = await ownerProject();
    await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' });
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    expect((await cpost('BOB', `/invitations/${invId}/decline`)).status).toBe(200);
    expect((await get('BOB', `/mine/${id}`)).status).toBe(404);
    const again = await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' });
    expect(again.status).toBe(404);                                                               // same answer as "can't invite"
    expect(again.body.error).toBe('That student can’t be invited to this project');
    await query(`UPDATE showcase_collaborators SET responded_at = NOW() - INTERVAL '8 days' WHERE roll = 'BOB'`);
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' })).status).toBe(201);
  });

  it('"decline and block" stops all future invitations from that owner without telling them why', async () => {
    const { id } = await ownerProject();
    await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' });
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    expect((await cpost('BOB', `/invitations/${invId}/decline`, { block: true })).body.blocked).toBe(true);
    await query(`UPDATE showcase_collaborators SET responded_at = NOW() - INTERVAL '30 days' WHERE roll = 'BOB'`);
    const unknown = await invite('ALICE', id, { roll: 'NOBODY', access_role: 'editor' });
    const blocked = await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' });
    expect(blocked.status).toBe(404); expect(blocked.body).toEqual(unknown.body);
    // the existing credit-invite path honours the block too, with the same answer
    expect((await post('ALICE', `/mine/${id}/credits`, { roll: 'BOB' })).status).toBe(404);
    // BOB can undo it
    const blocks = (await cget('BOB', '/blocks')).body.blocks;
    expect(blocks).toEqual([{ id: expect.any(String), name: 'Asha Rao' }]);
    expect((await cdel('CAROL', `/blocks/${blocks[0].id}`)).status).toBe(404);                  // not someone else's block
    expect((await cdel('BOB', `/blocks/${blocks[0].id}`)).status).toBe(200);
    expect((await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' })).status).toBe(201);
  });

  it('ignores invitations to archived projects', async () => {
    const { id } = await ownerProject();
    await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' });
    const invId = (await cget('BOB', '/invitations')).body.invitations[0].id;
    await query(`UPDATE showcase_projects SET status = 'archived' WHERE id = $1`, [id]);
    expect((await cget('BOB', '/invitations')).body.invitations).toHaveLength(0);
    expect((await cpost('BOB', `/invitations/${invId}/accept`)).status).toBe(404);
  });
});

