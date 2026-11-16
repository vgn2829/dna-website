import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { pool } from '../src/db/client';
import { initDesignerSchema } from '../src/db/designerSchema';

describe('designer / credits migration on a representative legacy installation', () => {
  it('preserves legacy rows and attribution text, is rerunnable, and enforces ownership/consent/deletion policy', async () => {
    // A legacy schema INSIDE the disposable instance, not an existing DB.
    const schema = `pr1_legacy_${randomUUID().replace(/-/g, '')}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const legacy = new Pool({ connectionString: process.env.DATABASE_URL,
      ssl: false, options: `-c search_path=${schema}`, max: 1 });
    try {
      await legacy.query(`
        CREATE TABLE student_sessions(roll_number TEXT PRIMARY KEY, unique_id TEXT NOT NULL, registered_at TEXT NOT NULL);
        CREATE TABLE domains(id TEXT PRIMARY KEY, title TEXT);
        CREATE TABLE assets(id TEXT PRIMARY KEY);
        CREATE TABLE artworks(id TEXT PRIMARY KEY, title TEXT, artist TEXT NOT NULL, domain TEXT,
          image_url TEXT, storage_path TEXT, likes INT NOT NULL DEFAULT 0, featured BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
        CREATE TABLE artwork_likes(artwork_id TEXT REFERENCES artworks(id) ON DELETE CASCADE, roll_number TEXT,
          PRIMARY KEY(artwork_id, roll_number));
        CREATE TABLE artwork_comments(id TEXT PRIMARY KEY, artwork_id TEXT REFERENCES artworks(id) ON DELETE CASCADE,
          sender TEXT, text TEXT);
        INSERT INTO student_sessions VALUES('230001', 'synthetic-account-id', '01 Jan 2026');
        INSERT INTO student_sessions VALUES('230002', 'other-synthetic-account', '01 Jan 2026');
        INSERT INTO artworks VALUES('legacy-art', 'Legacy title', 'Ada', 'UI/UX Design',
          'https://example.test/legacy.png', NULL, 1, true);
        INSERT INTO artwork_likes VALUES('legacy-art', '230001');
        INSERT INTO artwork_comments VALUES('legacy-comment', 'legacy-art', 'Legacy sender', 'Legacy text');
      `);
      const before = (await legacy.query('SELECT * FROM artworks')).rows;
      await initDesignerSchema(legacy);
      await initDesignerSchema(legacy);

      // Legacy artwork keeps every original value (including the free-text artist) and
      // becomes a published, admin-curated Gallery piece — no rewrite, no name matching.
      const after = (await legacy.query('SELECT * FROM artworks')).rows;
      expect(after).toEqual(before.map(row => ({
        ...row, status: 'published', source_kind: 'gallery_admin', source_asset_id: null,
        created_by_roll: null, description: null, published_at: null,
      })));
      expect((await legacy.query('SELECT * FROM artwork_likes')).rows).toEqual([{ artwork_id: 'legacy-art', roll_number: '230001' }]);
      expect((await legacy.query('SELECT * FROM artwork_comments')).rows).toEqual([{ id: 'legacy-comment', artwork_id: 'legacy-art', sender: 'Legacy sender', text: 'Legacy text' }]);
      for (const t of ['designer_profiles', 'artwork_credits', 'creator_audit_log', 'designer_profile_links', 'designer_profile_disciplines']) {
        expect((await legacy.query(`SELECT * FROM ${t}`)).rows).toHaveLength(0);
      }
      // The retired single-column model must not exist.
      const columns = (await legacy.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'artworks'`, [schema])).rows.map(r => r.column_name);
      expect(columns).not.toContain('creator_designer_id');

      const profileId = randomUUID();
      const insert = (id: string, owner: string, handle: string) => legacy.query(
        `INSERT INTO designer_profiles(id, owner_roll, handle, display_name) VALUES($1,$2,$3,'Ada')`, [id, owner, handle]);
      await insert(profileId, '230001', 'ada-design');
      expect((await legacy.query(`SELECT visibility, moderation_status, verified_at FROM designer_profiles`)).rows[0])
        .toEqual({ visibility: 'private', moderation_status: 'active', verified_at: null });  // private by default
      await expect(insert(randomUUID(), '230001', 'other-handle')).rejects.toMatchObject({ code: '23505' });
      await expect(insert(randomUUID(), '230002', 'ada-design')).rejects.toMatchObject({ code: '23505' });
      await expect(insert(randomUUID(), '239999', 'unknown-account')).rejects.toMatchObject({ code: '23503' });
      await expect(insert(randomUUID(), '230002', 'UPPERCASE')).rejects.toMatchObject({ code: '23514' });
      await expect(legacy.query(`UPDATE designer_profiles SET visibility = 'everyone'`)).rejects.toMatchObject({ code: '23514' });

      const credit = (id: string, art: string, profile: string, role: string, primary: boolean, status: string) => legacy.query(
        `INSERT INTO artwork_credits(id, artwork_id, profile_id, role, is_primary, status, source) VALUES($1,$2,$3,$4,$5,$6,'admin')`,
        [id, art, profile, role, primary, status]);
      const second = randomUUID();
      await insert(second, '230002', 'bob-design');
      await credit('c1', 'legacy-art', profileId, 'creator', true, 'accepted');
      await expect(credit('c2', 'legacy-art', second, 'creator', true, 'accepted')).rejects.toMatchObject({ code: '23505' }); // one primary
      await expect(credit('c3', 'legacy-art', profileId, 'contributor', false, 'accepted')).rejects.toMatchObject({ code: '23505' }); // unique per profile
      await expect(credit('c4', 'legacy-art', second, 'contributor', true, 'accepted')).rejects.toMatchObject({ code: '23514' }); // primary must be creator
      await expect(credit('c5', 'legacy-art', second, 'creator', true, 'pending')).rejects.toMatchObject({ code: '23514' });     // primary must be accepted
      await expect(credit('c6', 'legacy-art', second, 'boss', false, 'accepted')).rejects.toMatchObject({ code: '23514' });
      await expect(credit('c7', 'missing-art', second, 'contributor', false, 'accepted')).rejects.toMatchObject({ code: '23503' });
      await credit('c8', 'legacy-art', second, 'contributor', false, 'pending');

      await initDesignerSchema(legacy); // rerun with data present
      expect((await legacy.query('SELECT id FROM artwork_credits ORDER BY id')).rows.map(r => r.id)).toEqual(['c1', 'c8']);
      await expect(legacy.query('DELETE FROM designer_profiles WHERE id = $1', [profileId])).rejects.toMatchObject({ code: '23503' });
      await expect(legacy.query("DELETE FROM student_sessions WHERE roll_number = '230001'")).rejects.toMatchObject({ code: '23503' });

      // Audit entries survive deleting the artwork and its credits.
      await legacy.query(`INSERT INTO creator_audit_log(entity_type, entity_id, action, actor_kind) VALUES('artwork','legacy-art','artwork.hide','admin')`);
      await legacy.query("DELETE FROM artworks WHERE id = 'legacy-art'");
      expect((await legacy.query('SELECT * FROM artwork_credits')).rows).toHaveLength(0);   // credits cascade with the artwork
      expect((await legacy.query('SELECT * FROM creator_audit_log')).rows).toHaveLength(1);
      await legacy.query('DELETE FROM designer_profiles');
      expect((await legacy.query('SELECT * FROM student_sessions')).rows).toHaveLength(2);
    } finally {
      await legacy.end();
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });
});
