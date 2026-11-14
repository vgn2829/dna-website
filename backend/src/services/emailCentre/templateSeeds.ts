// Built-in Email Centre templates. Plain data in the same document model the
// editor produces. Seeded once per id (never overwritten), editable by admins
// as new immutable versions. The legacy Announcements-tab templates
// (email_templates table) are separate and unchanged.

import type { DocNode, SubjectConfig } from './engine';

const t = (text: string, marks?: DocNode['marks']): DocNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...parts: (string | DocNode)[]): DocNode => ({ type: 'paragraph', content: parts.map(x => (typeof x === 'string' ? t(x) : x)) });
const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const btn = (label: string, href: string): DocNode => ({ type: 'button', attrs: { label, href } });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });

export interface SeedTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  mode: 'normal' | 'individual';
  subject: SubjectConfig;
  doc: DocNode;
  settings: { sharedData?: Record<string, string>; fallbacks?: Record<string, string>; shell?: 'dna' | 'plain' };
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    id: 'tpl_welcome', name: 'Welcome email', category: 'welcome', mode: 'individual',
    description: 'Greets a new member by first name.',
    subject: { default: 'Welcome to the Design & Animation Club, {{first_name}}!' },
    doc: doc(
      h(2, 'Welcome, {{first_name}}!'),
      p('We are thrilled to have you in the Design & Animation Club, IIT Kanpur.'),
      p('Explore tutorials, share your artwork and join our upcoming events.'),
      btn('Visit the website', 'https://www.dnaiitk.site'),
    ),
    settings: {},
  },
  {
    id: 'tpl_new_post', name: 'New post announcement', category: 'announcement', mode: 'individual',
    description: 'Announce a new post or update from the club.',
    subject: { default: '{{post_title}} — DnA Club' },
    doc: doc(
      h(2, '{{post_title}}'),
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
      h(2, '{{event_name}}'),
      p('Hi {{first_name|there}}, we have a new event coming up!'),
      p({ type: 'text', text: 'When: ', marks: [{ type: 'bold' }] }, '{{event_date}}'),
      p({ type: 'text', text: 'Where: ', marks: [{ type: 'bold' }] }, '{{event_venue}}'),
      btn('View event & register', '{{event_link}}'),
    ),
    settings: {},
  },
  {
    id: 'tpl_artwork', name: 'Artwork announcement', category: 'announcement', mode: 'individual',
    description: 'Show off a newly published artwork.',
    subject: { default: 'New artwork: {{artwork_title}} by {{artist_name}}' },
    doc: doc(
      h(2, '{{artwork_title}}'),
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
      h(2, "Don't forget — {{event_name}}"),
      p('Hi {{first_name|there}},'),
      p('This is a reminder that {{event_name}} takes place on {{event_date}} at {{event_venue}}.'),
      btn('Event details', '{{event_link}}'),
    ),
    settings: {},
  },
  {
    id: 'tpl_event_selection', name: 'Event selection', category: 'results', mode: 'individual',
    description: 'Tell someone they were selected, with their team and role.',
    subject: { default: "Congratulations, {{first_name}}! You're selected for {{event_name}}" },
    doc: doc(
      h(2, 'Congratulations, {{first_name}}!'),
      p('We are delighted to let you know that you have been selected for {{event_name}}.'),
      p({ type: 'text', text: 'Team: ', marks: [{ type: 'bold' }] }, '{{team_name}}'),
      p({ type: 'text', text: 'Role: ', marks: [{ type: 'bold' }] }, '{{role}}'),
      p('Your coordinator is {{coordinator_name}}.'),
    ),
    settings: { sharedData: { coordinator_name: '' } },
  },
  {
    id: 'tpl_event_waitlist', name: 'Event waitlist', category: 'results', mode: 'individual',
    description: 'Let someone know they are on the waitlist.',
    subject: { default: 'Update regarding your {{event_name}} application' },
    doc: doc(
      h(2, 'Hi {{first_name}},'),
      p('Thank you for applying to {{event_name}}.'),
      p('You have been placed on our waitlist. We will contact you if a position becomes available.'),
    ),
    settings: {},
  },
  {
    id: 'tpl_custom', name: 'Custom email', category: 'custom', mode: 'individual',
    description: 'A blank starting point.',
    subject: { default: '' },
    doc: doc(p('')),
    settings: {},
  },
];
