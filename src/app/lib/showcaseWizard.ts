import { isPublicLink, parseTags } from './showcase';

// ─────────────────────────────────────────────────────────────────────────
// The seven-step project submission wizard — pure step logic.
//
// This mirrors (never replaces) the server's `submissionProblems`: the server
// still re-checks everything on submit. These rules only give early,
// per-step feedback. Fields come from the existing showcase schema; there is
// deliberately no separate "tools" or "visibility" field because the backend
// has none (tools go in the story or tags; a project is private until an
// admin publishes it).
// ─────────────────────────────────────────────────────────────────────────

export const WIZARD_STEPS = [
  { id: 'basics',    label: 'Basics',    title: 'Project basics',        blurb: 'Name your project and tell people what kind of work it is.' },
  { id: 'media',     label: 'Media',     title: 'Cover and media',       blurb: 'Choose the images from your Asset Library. The cover is the card image.' },
  { id: 'story',     label: 'Story',     title: 'Project story',         blurb: 'Describe the brief, your process and the outcome.' },
  { id: 'people',    label: 'People',    title: 'Contributors',          blurb: 'Credit everyone who worked on it. Each person must accept before you can submit.' },
  { id: 'resources', label: 'Resources', title: 'Tools and resources',   blurb: 'Link process moodboards and external references.' },
  { id: 'discovery', label: 'Discovery', title: 'Discovery details',     blurb: 'Tags help people find your project in the Showcase.' },
  { id: 'review',    label: 'Review',    title: 'Review and submit',     blurb: 'Check everything, then send it to the club for review.' },
] as const;
export type StepId = typeof WIZARD_STEPS[number]['id'];
export const STEP_COUNT = WIZARD_STEPS.length;

export interface WizardForm {
  title: string; summary: string; description: string; category: string; tags: string;
  links: Array<{ label: string; url: string }>; disciplineIds: string[]; ownerName: string; ownerRole: string;
}
export interface WizardContext {
  form: WizardForm;
  works: Array<{ isCover: boolean; sourceMissing?: boolean }>;
  credits: Array<{ isOwner: boolean; status: 'accepted' | 'pending' | 'declined' }>;
}

/** Blocking problems for one step (empty = the step is complete). */
export function stepProblems(step: StepId, { form, works, credits }: WizardContext): string[] {
  const out: string[] = [];
  switch (step) {
    case 'basics':
      if (form.title.trim().length < 3) out.push('Add a title (at least 3 characters)');
      if (form.summary.trim().length < 10) out.push('Add a short summary (at least 10 characters)');
      if (!form.category) out.push('Choose a category');
      if (form.disciplineIds.length < 1) out.push('Pick at least one discipline');
      break;
    case 'media':
      if (works.length < 1) out.push('Add at least one image');
      else if (works.filter(w => w.isCover).length !== 1) out.push('Choose a cover image');
      if (works.some(w => w.sourceMissing)) out.push('An image was removed from your Asset Library — remove it from the project');
      break;
    case 'story':
      if (form.description.trim().length < 30) out.push('Describe the project (at least 30 characters)');
      break;
    case 'people':
      if (!form.ownerName.trim()) out.push('Set the name you want to be credited as');
      break;
    case 'resources':
      if (form.links.some(l => l.url.trim() && !isPublicLink(l.url))) out.push('Links must be public http(s) addresses');
      break;
    default: break;   // discovery and review have no blocking rules of their own
  }
  return out;
}

/** Non-blocking things worth knowing at a step (e.g. contributors who haven't replied yet). */
export function stepNotes(step: StepId, { form, credits }: WizardContext): string[] {
  const out: string[] = [];
  if (step === 'people') {
    const pending = credits.filter(c => !c.isOwner && c.status === 'pending').length;
    if (pending > 0) out.push(`${pending} contributor${pending === 1 ? ' hasn’t' : 's haven’t'} accepted yet — you can’t submit until they do (or you remove them).`);
  }
  if (step === 'discovery') {
    const typed = form.tags.split(/[,\n]/).filter(s => s.trim()).length;
    if (typed > parseTags(form.tags).length) out.push('Some tags were skipped: use letters and numbers, up to 30 characters, and at most 10 tags.');
  }
  return out;
}

export function stepComplete(step: StepId, ctx: WizardContext): boolean { return stepProblems(step, ctx).length === 0; }

/** Where "resume" should land: the first step that still has a blocking problem, else the review step. */
export function firstIncompleteStep(ctx: WizardContext): number {
  const i = WIZARD_STEPS.findIndex(s => s.id !== 'review' && !stepComplete(s.id, ctx));
  return i === -1 ? STEP_COUNT - 1 : i;
}

/** Maps a server-side submission problem back to the step that fixes it. */
export function stepForServerProblem(problem: string): number {
  const p = problem.toLowerCase();
  const id: StepId =
    /title|summary|category|discipline/.test(p) ? 'basics'
    : /image|cover|asset library/.test(p) ? 'media'
    : /describe/.test(p) ? 'story'
    : /contributor|credit/.test(p) ? 'people'
    : 'review';
  return WIZARD_STEPS.findIndex(s => s.id === id);
}

/** Clamp a raw `?step=` value (1-based) into a valid 0-based index; null when absent/invalid. */
export function parseStepParam(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= STEP_COUNT ? n - 1 : null;
}
