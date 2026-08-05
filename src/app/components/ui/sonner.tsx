// This app doesn't use next-themes (see src/app/context/ThemeContext.tsx —
// a small custom light/dark provider reading/writing data-theme + a
// dna-theme localStorage key), and its CSS tokens are --color-* (see
// src/styles/theme.css), not the shadcn --popover/--border defaults this
// file originally shipped with. Wired to the app's real theme + tokens so
// toasts actually render correctly instead of falling back to
// next-themes' unset "system" default and CSS variables that don't exist
// here.
import { Toaster as Sonner, ToasterProps } from "sonner";
import { useTheme } from "../../context/ThemeContext";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
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
};

export { Toaster };
