import { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Lightweight accessibility primitive for this app's existing custom
// motion.div modal pattern (backdrop + centered card, dozens of instances
// across BoardPage.tsx/MoodboardsPage.tsx/WorkspacesPanel.tsx/
// WorkspaceSettingsModal.tsx). Deliberately NOT a migration to Radix's
// Dialog primitive (already installed, @radix-ui/react-dialog, wrapped at
// components/ui/dialog.tsx) — that wrapper uses Tailwind/shadcn tokens
// this app doesn't define (--popover, bg-black/50, etc., the same
// mismatch the sonner Toaster wrapper had) and is unused anywhere in this
// codebase today; swapping every existing modal onto it would be a much
// larger, riskier change than "add focus trapping" calls for. This hook
// adds the three behaviors screen-reader/keyboard users actually need —
// Escape to close, Tab/Shift+Tab cycling confined to the dialog, and
// focus returning to whatever triggered the dialog on close — to the
// existing markup with a single ref + one effect, no visual change.
//
// Usage: const dialogRef = useModalA11y(open, onClose); then spread
// { ref: dialogRef, role: 'dialog', 'aria-modal': true } onto the
// dialog's outer motion.div (the card, not the backdrop).
// ─────────────────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalA11y(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Every call site passes an inline `() => setX(false)` arrow, which is a
  // new function identity on every render of the CALLER (not just when the
  // dialog opens/closes) — e.g. typing into a controlled input inside the
  // dialog re-renders the parent, which used to be in this effect's own
  // dependency array via `onClose`, tearing the effect down and back up on
  // every keystroke. Teardown calls previouslyFocused.current.focus() (the
  // element that had focus BEFORE the dialog opened — never the input being
  // typed into) and setup immediately re-steals focus to the dialog
  // container itself, so a character would land, then focus would jump
  // away, breaking typing entirely in every modal built on this hook
  // (confirmed: MoodboardsPage's create/rename dialogs, WorkspaceSettingsModal,
  // NotificationBell, and in fact every current caller, since none of them
  // memoize onClose). Routing calls through a ref instead of the dependency
  // array is the standard fix (the "latest ref" pattern) — the effect now
  // only keys off `open`, so it runs once per actual open/close, and
  // handleKeyDown/cleanup always call the CURRENT onClose via the ref
  // without needing it as a dependency.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Focus the dialog itself first (not the first field) — matches how a
    // screen reader announces a newly-opened dialog before reading into
    // its contents, and avoids accidentally triggering an input's own
    // focus side effects (e.g. a search field's dropdown) the instant the
    // dialog appears.
    const raf = requestAnimationFrame(() => dialogRef.current?.focus());

    const handleKeyDown = (e: KeyboardEvent) => {
      // Nested modals (e.g. the workspace switcher panel opened from the
      // mobile nav drawer, portalled to document.body so it is no longer
      // a DOM descendant of the drawer) each register a document-level
      // listener. Only the dialog that actually contains focus should
      // react — otherwise one Escape closes both layers at once.
      const active = document.activeElement;
      if (
        dialogRef.current && active && !dialogRef.current.contains(active)
        && active.closest('[aria-modal="true"]')
      ) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => el.offsetParent !== null); // skip hidden/collapsed elements
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  return dialogRef;
}
