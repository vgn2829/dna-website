import { MAX_UPLOAD_BYTES } from './uploadLimits';
import type { Workspace } from './api';

// Saving a creative-tool output (Background Remover, Halftone, SVG Converter)
// into the Asset Library. Pure helpers only — no network, no DOM — so the
// rules are unit-testable. The component that uses them is
// components/assets/SaveToAssetsButton.tsx.
//
// Privacy rules, deliberately fixed here rather than left to callers:
//   - The saved asset is ALWAYS created 'personal' (visible to its owner
//     only). Sharing or publishing stays an explicit, separate action in the
//     Asset Library (routes/assets.ts visibility model).
//   - It goes into the signed-in student's OWN personal workspace; the
//     server re-checks workspace membership on every upload.
//   - Only image formats the library already accepts as images are allowed.

/** Formats a tool may save. All are in the library's image allowlist (assetLibrary.IMAGE_MIME). */
export const TOOL_ASSET_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export const TOOL_ASSET_VISIBILITY = 'personal' as const;

export type ToolId = 'background-remover' | 'halftone' | 'svg-converter';

const TOOL_LABEL: Record<ToolId, string> = {
  'background-remover': 'Background Remover',
  halftone: 'Halftone',
  'svg-converter': 'SVG Converter',
};
export const toolLabel = (tool: ToolId): string => TOOL_LABEL[tool];

/**
 * A filename the library will accept and a person will recognise: the source
 * name (extension stripped, unsafe characters removed, length capped) plus a
 * tool suffix and the extension implied by the real MIME type — never by the
 * caller's say-so.
 */
export function toolAssetFilename(baseName: string, tool: ToolId, mime: string): string {
  const ext = TOOL_ASSET_MIME[mime] ?? 'png';
  const stem = baseName
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[^\p{L}\p{M}\p{N} _.-]+/gu, '')   // \p{M}: vowel signs/combining marks in Indic scripts
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')                       // no hidden/relative-looking names
    .trim()
    .slice(0, 60);
  return `${stem || 'untitled'} - ${toolLabel(tool)}.${ext}`;
}

export type ToolOutputProblem = 'empty' | 'type' | 'too-large';

/** Refuses an output the library would reject, before any network call. */
export function checkToolOutput(blob: { size: number; type: string }): ToolOutputProblem | null {
  if (!blob.size) return 'empty';
  if (!(blob.type in TOOL_ASSET_MIME)) return 'type';
  if (blob.size > MAX_UPLOAD_BYTES) return 'too-large';
  return null;
}

export const TOOL_OUTPUT_MESSAGE: Record<ToolOutputProblem, string> = {
  empty: 'There is nothing to save yet — create the result first.',
  type: 'This result is in a format the Asset Library does not accept.',
  'too-large': 'This result is larger than the Asset Library allows.',
};

/**
 * The workspace a tool output lands in: the student's own personal workspace.
 * Never a shared one, so a save can never put work in front of other people.
 * Returns null when none is found (the caller shows an honest error).
 */
export function pickTargetWorkspace(workspaces: Pick<Workspace, 'id' | 'is_personal' | 'role'>[]): string | null {
  return workspaces.find(w => w.is_personal && w.role === 'owner')?.id
    ?? workspaces.find(w => w.is_personal)?.id
    ?? null;
}
