import { WandSparkles, Images, PenTool, Box, Layers, Video, type LucideIcon } from 'lucide-react';

// `Domain.icon` is a free-text Font Awesome class name (e.g. "fa-cube"),
// stored in the DB and editable via a plain text input in AdminPage's
// domain form — a holdover from when the app loaded Font Awesome globally.
// This maps the currently-known values (seed data + the admin form's
// placeholder/default) to their closest lucide-react equivalent so the
// Font Awesome CDN stylesheet can be removed. Any value not in this map
// (e.g. an admin typing a new fa- class after this change) falls back to
// DEFAULT_DOMAIN_ICON rather than rendering nothing.
const DOMAIN_ICON_MAP: Record<string, LucideIcon> = {
  'fa-wand-magic-sparkles': WandSparkles,
  'fa-images': Images,
  'fa-pen-nib': PenTool,
  'fa-cube': Box,
  'fa-layer-group': Layers,
  'fa-video': Video,
};

export const DEFAULT_DOMAIN_ICON: LucideIcon = Layers;

export function getDomainIcon(icon: string): LucideIcon {
  return DOMAIN_ICON_MAP[icon] ?? DEFAULT_DOMAIN_ICON;
}
