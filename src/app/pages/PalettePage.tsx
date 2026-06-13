// PALETTE_STUDIO_FEATURE — remove the /palette route and nav link to disable
import { useEffect } from 'react';
import PaletteStudio from '../components/PaletteStudio';

export function PalettePage() {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  return (
    <div style={{ background: 'var(--color-canvas)', minHeight: '100vh', paddingTop: '56px' }}>
      <PaletteStudio />
    </div>
  );
}
