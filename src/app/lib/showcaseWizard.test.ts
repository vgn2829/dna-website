import { describe, expect, it } from 'vitest';
import { STEP_COUNT, WIZARD_STEPS, firstIncompleteStep, parseStepParam, stepForServerProblem, stepNotes, stepProblems, type WizardContext } from './showcaseWizard';

const full = (): WizardContext => ({
  form: { title: 'Retro Posters', summary: 'A poster series', description: 'Three posters exploring halftone textures and palettes.', category: 'illustration', tags: 'retro, poster', links: [], disciplineIds: ['illus'], ownerName: 'Asha Rao', ownerRole: '' },
  works: [{ isCover: true }], credits: [{ isOwner: true, status: 'accepted' }],
});

describe('wizard definition', () => {
  it('has exactly seven distinct steps ending in review', () => {
    expect(STEP_COUNT).toBe(7);
    expect(new Set(WIZARD_STEPS.map(s => s.id)).size).toBe(7);
    expect(WIZARD_STEPS[6].id).toBe('review');
  });
});

describe('stepProblems', () => {
  it('a complete project has no problems on any step', () => {
    for (const s of WIZARD_STEPS) expect(stepProblems(s.id, full()), s.id).toEqual([]);
  });
  it('basics: title, summary, category and discipline are required (same thresholds as the server)', () => {
    const c = full(); c.form.title = 'ab'; c.form.summary = 'short'; c.form.category = ''; c.form.disciplineIds = [];
    expect(stepProblems('basics', c)).toHaveLength(4);
    c.form.title = 'abc'; c.form.summary = '0123456789'; c.form.category = 'print'; c.form.disciplineIds = ['x'];
    expect(stepProblems('basics', c)).toEqual([]);
  });
  it('media: needs an image, exactly one cover, and no missing sources', () => {
    const c = full(); c.works = [];
    expect(stepProblems('media', c)).toEqual(['Add at least one image']);
    c.works = [{ isCover: false }]; expect(stepProblems('media', c)).toEqual(['Choose a cover image']);
    c.works = [{ isCover: true }, { isCover: true }]; expect(stepProblems('media', c)).toEqual(['Choose a cover image']);
    c.works = [{ isCover: true, sourceMissing: true }]; expect(stepProblems('media', c)[0]).toMatch(/removed from your Asset Library/);
  });
  it('story: description needs 30 real characters (whitespace does not count)', () => {
    const c = full(); c.form.description = '   '.padEnd(40, ' ');
    expect(stepProblems('story', c)).toHaveLength(1);
    c.form.description = 'x'.repeat(30); expect(stepProblems('story', c)).toEqual([]);
  });
  it('people: the owner credit name is required', () => {
    const c = full(); c.form.ownerName = '  '; expect(stepProblems('people', c)).toHaveLength(1);
  });
  it('resources: rejects private/non-http links but ignores blank rows', () => {
    const c = full(); c.form.links = [{ label: '', url: '' }, { label: 'x', url: 'http://localhost:3000' }];
    expect(stepProblems('resources', c)).toHaveLength(1);
    c.form.links = [{ label: 'Behance', url: 'https://www.behance.net/gallery/1' }]; expect(stepProblems('resources', c)).toEqual([]);
  });
});

describe('stepNotes', () => {
  it('warns (without blocking) about contributors who have not accepted', () => {
    const c = full(); c.credits.push({ isOwner: false, status: 'pending' }, { isOwner: false, status: 'pending' });
    expect(stepNotes('people', c)[0]).toMatch(/2 contributors haven’t accepted/);
    expect(stepProblems('people', c)).toEqual([]);
  });
  it('flags tags that will be dropped', () => {
    const c = full(); c.form.tags = 'good, bad tag!!, ';
    expect(stepNotes('discovery', c)).toHaveLength(1);
  });
});

describe('resume and routing helpers', () => {
  it('lands on the first incomplete step, or review when everything is done', () => {
    expect(firstIncompleteStep(full())).toBe(6);
    const c = full(); c.works = []; expect(firstIncompleteStep(c)).toBe(1);
    c.form.title = ''; expect(firstIncompleteStep(c)).toBe(0);
  });
  it('maps server problems to the step that fixes them', () => {
    expect(stepForServerProblem('Add a title (at least 3 characters)')).toBe(0);
    expect(stepForServerProblem('Choose a cover image')).toBe(1);
    expect(stepForServerProblem('Describe the project (at least 30 characters)')).toBe(2);
    expect(stepForServerProblem('Waiting for contributors to accept their credit — remove or wait for them')).toBe(3);
    expect(stepForServerProblem('something unexpected')).toBe(6);
  });
  it('parses ?step= safely', () => {
    expect(parseStepParam('1')).toBe(0); expect(parseStepParam('7')).toBe(6);
    for (const bad of [null, '', '0', '8', '-1', '2.5', 'abc', '1; drop']) expect(parseStepParam(bad as string | null)).toBeNull();
  });
});
