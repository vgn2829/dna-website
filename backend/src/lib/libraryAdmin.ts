import { z } from 'zod';
import { LIBRARY_STATUSES, LIBRARY_VISIBILITIES } from './libraryVisibility';

// ── Admin moderation ────────────────────────────────────────────────────
// requireAdmin: the site admin JWT (role 'admin', issued by POST
// /api/auth/admin/login) — a student token, including a workspace
// owner/admin's, is refused with 401. Admins see every item, active and
// hidden, across all workspaces, and may change visibility or status. They
// never change workspace_id or ownership, so community visibility set by an
// admin still only reaches that item's own workspace members.
export const adminListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'hidden', 'all']).optional(),
  visibility: z.enum(['personal', 'community', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export const adminUpdateSchema = z.object({
  visibility: z.enum(LIBRARY_VISIBILITIES).optional(),
  status: z.enum(LIBRARY_STATUSES).optional(),
}).refine(v => v.visibility !== undefined || v.status !== undefined, { message: 'Nothing to update' });

// WHERE clause for the admin list over alias a (+ workspaces w).
export function adminListWhere(parsed: z.infer<typeof adminListQuery>, nameColumn: string, params: unknown[]): string {
  const where: string[] = [];
  if (parsed.status && parsed.status !== 'all') { params.push(parsed.status); where.push(`a.status = $${params.length}`); }
  if (parsed.visibility && parsed.visibility !== 'all') { params.push(parsed.visibility); where.push(`a.visibility = $${params.length}`); }
  if (parsed.q) {
    params.push(`%${parsed.q.replace(/[\\%_]/g, c => `\\${c}`)}%`);
    const n = params.length;
    where.push(`(a.${nameColumn} ILIKE $${n} OR a.owner_name ILIKE $${n} OR a.owner_roll ILIKE $${n} OR w.name ILIKE $${n})`);
  }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}
