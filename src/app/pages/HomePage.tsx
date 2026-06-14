import { Hero } from '../components/Hero';
import { Mission } from '../components/Mission';
import { Stats } from '../components/Stats';
import { FeaturedMarquee } from '../components/FeaturedMarquee';
import { GalleryPreview } from '../components/GalleryPreview';
import { EventSpotlight } from '../components/EventSpotlight';
import { ResourcesPreview } from '../components/ResourcesPreview';
import { Team } from '../components/Team';
import { PaletteStudioCard } from '../components/PaletteStudioCard';

export function HomePage() {
  return (
    <div style={{ background: 'var(--color-canvas)', overflow: 'hidden' }}>
      <Hero />
      <FeaturedMarquee />
      <Mission />
      <Stats />
      <GalleryPreview />
      <EventSpotlight />
      <ResourcesPreview />
      <Team />
      <div style={{ padding: '0 24px 96px', maxWidth: 1200, margin: '0 auto' }}>
        <PaletteStudioCard />
      </div>
    </div>
  );
}
