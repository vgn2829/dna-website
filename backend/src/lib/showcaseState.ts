// ─────────────────────────────────────────────────────────────────────────
// Showcase project lifecycle (pure). The server is the only authority: every
// transition goes through canTransition, so no client, student or stale tab
// can skip review.
// ─────────────────────────────────────────────────────────────────────────

export const SHOWCASE_STATUSES = [
  'draft', 'submitted', 'changes_requested', 'approved', 'published', 'rejected', 'archived',
] as const;
export type ShowcaseStatus = typeof SHOWCASE_STATUSES[number];
export type Actor = 'owner' | 'admin';

const RULES: ReadonlyArray<{ from: ShowcaseStatus; to: ShowcaseStatus; by: readonly Actor[]; reason?: true }> = [
  { from: 'draft', to: 'submitted', by: ['owner'] },
  { from: 'submitted', to: 'changes_requested', by: ['admin'], reason: true },
  { from: 'submitted', to: 'rejected', by: ['admin'], reason: true },
  { from: 'submitted', to: 'approved', by: ['admin'] },
  { from: 'submitted', to: 'draft', by: ['owner'] },
  { from: 'changes_requested', to: 'submitted', by: ['owner'] },
  { from: 'changes_requested', to: 'draft', by: ['owner'] },
  { from: 'approved', to: 'published', by: ['admin'] },
  { from: 'approved', to: 'changes_requested', by: ['admin'], reason: true },
  { from: 'approved', to: 'rejected', by: ['admin'], reason: true },
  { from: 'published', to: 'archived', by: ['owner', 'admin'] },
  { from: 'archived', to: 'draft', by: ['owner', 'admin'] },
  { from: 'rejected', to: 'archived', by: ['owner', 'admin'] },
];

export type TransitionCheck = { ok: true } | { ok: false; status: 403 | 409 | 400; error: string };

export function canTransition(from: ShowcaseStatus, to: ShowcaseStatus, actor: Actor, reason?: string | null): TransitionCheck {
  const rule = RULES.find(r => r.from === from && r.to === to);
  if (!rule) return { ok: false, status: 409, error: `A ${from.replace('_', ' ')} project can’t move to ${to.replace('_', ' ')}` };
  if (!rule.by.includes(actor)) return { ok: false, status: 403, error: 'You are not allowed to make that change' };
  if (rule.reason && !(reason && reason.trim().length >= 3)) return { ok: false, status: 400, error: 'A reason is required' };
  return { ok: true };
}

/** States in which the owner may edit content. Published/approved/submitted are frozen for review integrity. */
export const OWNER_EDITABLE: readonly ShowcaseStatus[] = ['draft', 'changes_requested'];
export const OWNER_DELETABLE: readonly ShowcaseStatus[] = ['draft', 'archived', 'rejected'];

export interface SubmissionInput {
  title: string; description: string | null; summary: string | null; category: string | null;
  disciplineCount: number; workCount: number; coverCount: number;
  pendingCredits: number; ownerDisplayName: string | null;
  missingSources: number;
}

/** Everything wrong with a project that is about to be submitted (empty = ready). */
export function submissionProblems(p: SubmissionInput): string[] {
  const out: string[] = [];
  if (p.title.trim().length < 3) out.push('Add a title (at least 3 characters)');
  if (!p.summary || p.summary.trim().length < 10) out.push('Add a short summary (at least 10 characters)');
  if (!p.description || p.description.trim().length < 30) out.push('Describe the project (at least 30 characters)');
  if (!p.category) out.push('Choose a category');
  if (p.disciplineCount < 1) out.push('Pick at least one discipline');
  if (p.workCount < 1) out.push('Add at least one image');
  if (p.workCount > 0 && p.coverCount !== 1) out.push('Choose a cover image');
  if (p.missingSources > 0) out.push('An image was removed from your Asset Library — remove it from the project');
  if (p.pendingCredits > 0) out.push('Waiting for contributors to accept their credit — remove or wait for them');
  if (!p.ownerDisplayName || !p.ownerDisplayName.trim()) out.push('Set the name you want to be credited as');
  return out;
}
