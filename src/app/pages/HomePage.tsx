import { Hero } from '../components/Hero';
import { Mission } from '../components/Mission';
import { Stats } from '../components/Stats';
import { FeaturedMarquee } from '../components/FeaturedMarquee';
import { GalleryPreview } from '../components/GalleryPreview';
import { EventSpotlight } from '../components/EventSpotlight';
import { ResourcesPreview } from '../components/ResourcesPreview';
import { Team } from '../components/Team';
import { DesignStudioCard } from '../components/DesignStudioCard';

export function HomePage() {
  return (
    <div style={{ background: 'var(--color-canvas)', overflow: 'hidden' }}>
      <Hero />
      <FeaturedMarquee />
      <Mission />
      <Stats />
      <GalleryPreview />
      <EventSpotlight />
      <DesignStudioCard />
      <ResourcesPreview />
      <Team />
    </div>
  );
}
