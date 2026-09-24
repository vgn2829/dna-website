// This app doesn't use next-themes (see src/app/context/ThemeContext.tsx —
// a small custom light/dark provider reading/writing data-theme + a
// dna-theme localStorage key), and its CSS tokens are --color-* (see
// src/styles/theme.css), not the shadcn --popover/--border defaults this
// file originally shipped with. Wired to the app's real theme + tokens so
// toasts actually render correctly instead of falling back to
// next-themes' unset "system" default and CSS variables that don't exist
// here.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Toaster as Sonner, ToasterProps } from "sonner";
import { useTheme } from "../../context/ThemeContext";

// While an element is in browser fullscreen (e.g. the board canvas),
// ONLY that element's subtree is displayed — a Toaster rendered anywhere
// else is invisible, along with every success/error toast. sonner has no
// container option, so the Toaster is portalled into the fullscreen
// element for as long as it's fullscreen, and rendered in place
// otherwise. Switching location remounts the Toaster: a toast already on
// screen at the exact moment fullscreen is entered/exited is dropped
// (toasts fired afterwards show normally).
function useFullscreenElement(): Element | null {
  const [element, setElement] = useState<Element | null>(() => document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setElement(document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  return element;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  const fullscreenElement = useFullscreenElement();

  const toaster = (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--color-surface-1)",
          "--normal-text": "var(--color-ink)",
          "--normal-border": "var(--color-hairline)",
        } as React.CSSProperties
      }
      {...props}
    />
  );

  return fullscreenElement ? createPortal(toaster, fullscreenElement) : toaster;
};

export { Toaster };
