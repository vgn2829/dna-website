import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { pool } from '../src/db/client';
import { initDesignerSchema } from '../src/db/designerSchema';

describe('designer migration on a representative legacy installation', () => {
  it('preserves legacy rows/interactions, is rerunnable, and enforces ownership/FKs/deletion policy', async () => {
    // A legacy schema INSIDE the disposable instance, not an existing DB.
    const schema = `pr1_legacy_${randomUUID().replace(/-/g, '')}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const legacy = new Pool({ connectionString: process.env.DATABASE_URL,
      ssl: false, options: `-c search_path=${schema}`, max: 1 });
    try {
      await legacy.query(`
        CREATE TABLE student_sessions(roll_number TEXT PRIMARY KEY, unique_id TEXT NOT NULL, registered_at TEXT NOT NULL);
        CREATE TABLE artworks(id TEXT PRIMARY KEY, title TEXT, artist TEXT NOT NULL, domain TEXT,
          image_url TEXT, storage_path TEXT, likes INT NOT NULL DEFAULT 0, featured BOOLEAN DEFAULT false);
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
      expect((await legacy.query('SELECT * FROM artworks')).rows).toEqual(before.map(row => ({ ...row, creator_designer_id: null })));
      expect((await legacy.query('SELECT * FROM artwork_likes')).rows).toEqual([{ artwork_id: 'legacy-art', roll_number: '230001' }]);
      expect((await legacy.query('SELECT * FROM artwork_comments')).rows).toEqual([{ id: 'legacy-comment', artwork_id: 'legacy-art', sender: 'Legacy sender', text: 'Legacy text' }]);
      expect((await legacy.query('SELECT * FROM designer_profiles')).rows).toHaveLength(0);
      expect((await legacy.query('SELECT * FROM artwork_attribution_audit')).rows).toHaveLength(0);
      const profileId = randomUUID();
      const insert = (id: string, owner: string, handle: string) => legacy.query(
        `INSERT INTO designer_profiles(id, owner_roll, handle, display_name) VALUES($1,$2,$3,'Ada')`, [id, owner, handle]);
      await insert(profileId, '230001', 'ada-design');
      await expect(insert(randomUUID(), '230001', 'other-handle')).rejects.toMatchObject({ code: '23505' });
      await expect(insert(randomUUID(), '230002', 'ada-design')).rejects.toMatchObject({ code: '23505' });
      await expect(insert(randomUUID(), '239999', 'unknown-account')).rejects.toMatchObject({ code: '23503' });
      await expect(insert(randomUUID(), '230002', 'UPPERCASE')).rejects.toMatchObject({ code: '23514' });
      await expect(legacy.query('UPDATE artworks SET creator_designer_id = $1', [randomUUID()])).rejects.toMatchObject({ code: '23503' });
      await legacy.query('UPDATE artworks SET creator_designer_id = $1', [profileId]);
      await initDesignerSchema(legacy);
      expect((await legacy.query('SELECT creator_designer_id FROM artworks')).rows[0].creator_designer_id).toBe(profileId);
      await expect(legacy.query('DELETE FROM designer_profiles WHERE id = $1', [profileId])).rejects.toMatchObject({ code: '23503' });
      await expect(legacy.query("DELETE FROM student_sessions WHERE roll_number = '230001'")).rejects.toMatchObject({ code: '23503' });
      await legacy.query(`INSERT INTO artwork_attribution_audit(artwork_id, previous_designer_id, new_designer_id, actor)
        VALUES('legacy-art', NULL, $1, 'admin')`, [profileId]);
      await legacy.query('UPDATE artworks SET creator_designer_id = NULL');
      await legacy.query('DELETE FROM designer_profiles WHERE id = $1', [profileId]);
      expect((await legacy.query('SELECT * FROM artworks')).rows).toEqual(before.map(row => ({ ...row, creator_designer_id: null })));
      // Audit survives existing admin artwork deletion and profile deletion.
      await legacy.query("DELETE FROM artworks WHERE id = 'legacy-art'");
      expect((await legacy.query('SELECT * FROM artwork_attribution_audit')).rows).toHaveLength(1);
    } finally {
      await legacy.end();
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });
});
