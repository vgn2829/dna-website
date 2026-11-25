// CI schema verification.
//
// Applies the repository's own migrations (initSchema — the same function
// tests/setup.ts calls in beforeAll, and the same one server.ts runs at
// boot) against the fresh CI database, then asserts the V2/V2.6 objects
// actually landed. Deliberately NOT a hand-written DDL check: if this and
// the real migration ever disagreed, the migration is the one that matters.
import { initSchema } from '../src/db/schema';
import { pool, query } from '../src/db/client';

const REQUIRED_TABLES = [
  'boards', 'board_members', 'board_comments', 'board_comment_reads',
  'projects', 'templates', 'notifications', 'workspaces',
  'assets', 'asset_collections',
  // DNA 2.0 Phase 1: creator identity, attribution and the optional roster.
  'designer_profiles', 'designer_profile_links', 'designer_profile_disciplines',
  'artwork_credits', 'creator_audit_log', 'student_roster',
];
// Gallery lifecycle columns that keep non-published artwork out of public reads.
const REQUIRED_ARTWORK_COLUMNS = ['status', 'source_kind', 'source_asset_id', 'created_by_roll', 'published_at'];
const REQUIRED_COMMENT_COLUMNS = ['anchor_page_id', 'mentions'];
// Workspace Asset Library: kinds, collections, external links.
const REQUIRED_ASSET_COLUMNS = ['kind', 'collection_id', 'link_url'];

async function main(): Promise<void> {
  await initSchema();

  const tables = (await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  )).map(r => r.table_name);

  const missingTables = REQUIRED_TABLES.filter(t => !tables.includes(t));
  if (missingTables.length > 0) {
    console.error('MISSING TABLES:', missingTables.join(', '));
    process.exitCode = 1;
    return;
  }

  const columns = (await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'board_comments'`
  )).map(r => r.column_name);

  const missingColumns = REQUIRED_COMMENT_COLUMNS.filter(c => !columns.includes(c));
  if (missingColumns.length > 0) {
    console.error('MISSING board_comments COLUMNS:', missingColumns.join(', '));
    process.exitCode = 1;
    return;
  }

  const assetColumns = (await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'assets'`
  )).map(r => r.column_name);

  const missingAssetColumns = REQUIRED_ASSET_COLUMNS.filter(c => !assetColumns.includes(c));
  if (missingAssetColumns.length > 0) {
    console.error('MISSING assets COLUMNS:', missingAssetColumns.join(', '));
    process.exitCode = 1;
    return;
  }

  const artworkColumns = (await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'artworks'`
  )).map(r => r.column_name);
  const missingArtworkColumns = REQUIRED_ARTWORK_COLUMNS.filter(c => !artworkColumns.includes(c));
  if (missingArtworkColumns.length > 0) {
    console.error('MISSING artworks COLUMNS:', missingArtworkColumns.join(', '));
    process.exitCode = 1;
    return;
  }
  // The retired single-column attribution model must not come back.
  if (artworkColumns.includes('creator_designer_id')) {
    console.error('artworks.creator_designer_id must not exist (attribution lives in artwork_credits)');
    process.exitCode = 1;
    return;
  }

  console.log(`migrations OK — ${tables.length} tables, V2/V2.6 + asset library objects present`);
}

main()
  .catch(err => { console.error('schema verification failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());
