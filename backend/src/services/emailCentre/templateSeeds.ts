// Built-in Email Centre templates, authored in the unified DNA email design
// (see emailShell.ts + the engine's heading/callout/button styling). Plain data in
// the same document model the editor produces.
//
// Design: editorial, typography-led — big bold headings, natural paragraphs, one lime
// marker highlight at most, quiet dividers. Not stacked coloured cards.
//
// Seeding rules (store.seedSystemTemplates): a template id is inserted once. A
// built-in that is still on its original version 1 (never edited by an admin) and
// predates this design is moved to the new design as an appended version 2 —
// version 1 and every already-sent message stay exactly as they were. Admin-edited
// templates are never touched. The legacy Announcements-tab templates
// (email_templates table) are separate and unchanged.

import type { DocNode, SubjectConfig } from './engine';
import type { ShellOptions } from './emailShell';

/** Bump when the built-in designs change; stored in each seeded version's settings. */
export const SEED_DESIGN = 2;

const t = (text: string, marks?: DocNode['marks']): DocNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const bold = (text: string): DocNode => t(text, [{ type: 'bold' }]);
const br = (): DocNode => ({ type: 'hardBreak' });
const p = (...parts: (string | DocNode)[]): DocNode => ({ type: 'paragraph', content: parts.map(x => (typeof x === 'string' ? t(x) : x)) });
const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const btn = (label: string, href: string): DocNode => ({ type: 'button', attrs: { label, href } });
const hl = (text: string): DocNode => t(text, [{ type: 'highlight' }]);
const hr = (): DocNode => ({ type: 'horizontalRule' });
// "Dear Asha," when we know the name, plain "Hello," when we don't — never a guessed name.
const greeting = (): DocNode => ({
  type: 'conditionalBlock',
  content: [
    { type: 'conditionalBranch', attrs: { when: { match: 'all', rules: [{ field: 'first_name', op: 'is_not_empty' }] } }, content: [h(1, 'Dear {{first_name}},')] },
    { type: 'conditionalBranch', attrs: { when: null }, content: [h(1, 'Hello,')] },
  ],
});
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });

export interface SeedTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  mode: 'normal' | 'individual';
  subject: SubjectConfig;
  doc: DocNode;
  settings: { sharedData?: Record<string, string>; fallbacks?: Record<string, string>; shell?: 'dna' | 'plain'; shellOptions?: ShellOptions };
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    id: 'tpl_welcome', name: 'Welcome email', category: 'welcome', mode: 'individual',
    description: 'Greets a new member by first name.',
    subject: { default: 'Welcome to the Design & Animation Club, {{first_name}}!' },
    doc: doc(
      h(1, 'Welcome to DnA Club, {{first_name}}.'),
      p('We are thrilled to have you in the Design & Animation Club, IIT Kanpur.'),
      p('Explore tutorials, share your artwork and ', hl('join our upcoming events'), '.'),
      btn('Visit the website', 'https://www.dnaiitk.site'),
    ),
    settings: {},
  },
  {
    id: 'tpl_new_post', name: 'New post announcement', category: 'announcement', mode: 'individual',
    description: 'Announce a new post or update from the club.',
    subject: { default: '{{post_title}} — DnA Club' },
    doc: doc(
      h(1, '{{post_title}}'),
      p('Hi {{first_name|there}},'),
      p('{{post_summary}}'),
      btn('Read more', 'https://www.dnaiitk.site'),
    ),
    settings: { sharedData: { post_title: '', post_summary: '' } },
  },
  {
    id: 'tpl_new_event', name: 'New event announcement', category: 'event', mode: 'individual',
    description: 'Announce an event. Pick the event in the composer to fill the event variables.',
    subject: { default: 'New event: {{event_name}}' },
    doc: doc(
      h(1, '{{event_name}}'),
      p('Hi {{first_name|there}}, we have a new event coming up!'),
      hr(),
      h(2, '{{event_date}}'),
      p('At {{event_venue}}.'),
      btn('View event & register', '{{event_link}}'),
    ),
    settings: {},
  },
  {
    id: 'tpl_artwork', name: 'Artwork announcement', category: 'announcement', mode: 'individual',
    description: 'Show off a newly published artwork.',
    subject: { default: 'New artwork: {{artwork_title}} by {{artist_name}}' },
    doc: doc(
      h(1, '{{artwork_title}}'),
      p('Hi {{first_name|there}}, a new piece by {{artist_name}} just landed in the gallery.'),
      btn('See it in the gallery', 'https://www.dnaiitk.site/gallery'),
    ),
    settings: { sharedData: { artwork_title: '', artist_name: '' } },
  },
  {
    id: 'tpl_event_reminder', name: 'Event reminder', category: 'event', mode: 'individual',
    description: 'Remind registrants about an event.',
    subject: { default: 'Reminder: {{event_name}} on {{event_date}}' },
    doc: doc(
      h(1, "Don't forget."),
      p('Hi {{first_name|there}},'),
      p('This is a reminder that {{event_name}} takes place on ', hl('{{event_date}}'), ' at {{event_venue}}.'),
      btn('Event details', '{{event_link}}'),
    ),
    settings: {},
  },
  {
    id: 'tpl_event_selection', name: 'Event selection', category: 'results', mode: 'individual',
    description: 'Tell someone they were selected, with their team and role.',
    subject: { default: "Congratulations, {{first_name}}! You're selected for {{event_name}}" },
    doc: doc(
      h(1, 'Congratulations, {{first_name}}!'),
      p('We are delighted to let you know that you have been ', hl('selected for {{event_name}}'), '.'),
      p(bold('Team: '), '{{team_name}}', br(), bold('Role: '), '{{role}}'),
      p('Your coordinator is {{coordinator_name}}.'),
    ),
    settings: { sharedData: { coordinator_name: '' } },
  },
  {
    id: 'tpl_event_waitlist', name: 'Event waitlist', category: 'results', mode: 'individual',
    description: 'Let someone know they are on the waitlist.',
    subject: { default: 'Update regarding your {{event_name}} application' },
    doc: doc(
      h(1, 'Hi {{first_name}},'),
      p('Thank you for applying to {{event_name}}.'),
      p('You have been placed on our waitlist. We will contact you if a position becomes available.'),
    ),
    settings: {},
  },
  {
    id: 'tpl_custom', name: 'Custom email', category: 'custom', mode: 'individual',
    description: 'A blank starting point.',
    subject: { default: '' },
    doc: doc(h(1, 'Your headline.'), p('')),
    settings: {},
  },
  {
    id: 'tpl_selection_digital_arts_cup',
    name: 'Digital Arts Cup — Inter IIT Cultural Meet 9.0 Selection',
    category: 'selection',
    mode: 'individual',
    description: 'Official selection announcement for the IIT Kanpur Digital Arts Cup contingent, with the mandatory schedule.',
    subject: { default: 'Selection for Digital Arts Cup Contingent | Inter IIT Cultural Meet 9.0' },
    doc: doc(
      greeting(),
      p(hl('Congratulations!'), ' We are pleased to inform you that you have been selected to represent IIT Kanpur in the Digital Arts Cup contingent for the Inter IIT Cultural Meet 9.0.'),
      p('To make sure we are well prepared for the competition, here is the mandatory schedule.'),
      hr(),
      h(2, 'December 3 – 21'),
      p(bold('On-campus preparation, IIT Kanpur'), br(), 'You are required to stay on the IIT Kanpur campus from December 3rd to December 21st.'),
      h(2, 'December 25 – 29'),
      p(bold('Offline events, IIT Mandi'), br(), 'Following the preparation period, the IIT Kanpur contingent will travel to IIT Mandi for the offline events scheduled from December 25th to December 29th.'),
      hr(),
      p('All travel arrangements to and from IIT Mandi are being managed by the institute. Further details regarding the travel itinerary and preparation schedule will be shared shortly.'),
      p('See you on campus,'),
      p(bold('The Coordinators'), br(), 'Design and Animation Club', br(), 'Media and Cultural Council', br(), 'IIT Kanpur'),
    ),
    settings: { shellOptions: { labelLeft: 'digital arts cup', labelRight: 'inter iit 9.0', tagline: 'All the best!' } },
  },
];
