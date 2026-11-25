// Profile completion (V1.1): a friendly nudge, never a gate. Pure so the rules
// are testable and identical wherever the indicator is shown.

export interface CompletionInput {
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  skills: string[];
  /** Credited artworks on the profile (published + accepted). */
  worksCount: number;
  /** Published Showcase projects the member is credited on, when known. */
  projectCount?: number;
}

export interface CompletionStep { id: 'avatar' | 'headline' | 'bio' | 'skills' | 'work'; label: string; hint: string; done: boolean; href: string }
export interface Completion { steps: CompletionStep[]; doneCount: number; total: number; percent: number; complete: boolean; next: CompletionStep | null }

export function profileCompletion(p: CompletionInput): Completion {
  const steps: CompletionStep[] = [
    { id: 'avatar', label: 'Profile image', hint: 'Add a photo so people recognise you', done: !!p.avatarUrl, href: '#profile-image' },
    { id: 'headline', label: 'Headline', hint: 'One line on what you do, e.g. “Illustrator & motion designer”', done: !!p.headline?.trim(), href: '#edit-profile' },
    { id: 'bio', label: 'Bio', hint: 'A few sentences about you and your work', done: !!p.bio?.trim(), href: '#edit-profile' },
    { id: 'skills', label: 'Skills', hint: 'List the skills you want to be found by', done: p.skills.length > 0, href: '#skills' },
    { id: 'work', label: 'A project or artwork', hint: 'Get credited on a Gallery artwork or publish a Showcase project', done: p.worksCount > 0 || (p.projectCount ?? 0) > 0, href: '/showcase/manage' },
  ];
  const doneCount = steps.filter(s => s.done).length;
  return { steps, doneCount, total: steps.length, percent: Math.round((doneCount / steps.length) * 100), complete: doneCount === steps.length, next: steps.find(s => !s.done) ?? null };
}
