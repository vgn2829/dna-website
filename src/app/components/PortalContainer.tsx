import { createContext, useContext } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Where portalled overlays (dialogs, dropdown menus) should mount.
// Defaults to document.body — the root stacking context, which is the
// point of portalling (see WorkspaceSwitcher.tsx). BoardPage overrides it
// with its canvas container: while that element is in browser fullscreen,
// ONLY its own subtree is rendered, so an overlay portalled to body would
// be invisible in fullscreen.
// ─────────────────────────────────────────────────────────────────────────

const PortalContainerContext = createContext<HTMLElement | null>(null);

export const PortalContainerProvider = PortalContainerContext.Provider;

export function usePortalContainer(): HTMLElement {
  return useContext(PortalContainerContext) ?? document.body;
}
