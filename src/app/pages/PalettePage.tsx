import '../../styles/studio.css';
// PALETTE_STUDIO_FEATURE — remove the /palette route and nav link to disable
import PaletteStudio from '../components/PaletteStudio';
import { usePageMeta } from '../components/hooks/use-page-meta';

export function PalettePage() {
  usePageMeta({
    title: 'Palette Studio | DnA Club, IIT Kanpur',
    description: 'Generate accessible color palettes and font pairings — a free design tool from DnA Club, IIT Kanpur.',
    path: '/palette',
  });


  return (
    <div style={{ background: 'var(--color-canvas)', minHeight: '100vh', padding: '24px' }}>
      <h1 className="type-display-lg">Palette Studio</h1>
      <PaletteStudio />
    </div>
  );
}
