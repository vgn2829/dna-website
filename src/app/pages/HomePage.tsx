import { Hero } from '../components/Hero';
import { Mission } from '../components/Mission';
import { Stats } from '../components/Stats';
import { FeaturedMarquee } from '../components/FeaturedMarquee';
import { GalleryPreview } from '../components/GalleryPreview';
import { EventSpotlight } from '../components/EventSpotlight';
import { ResourcesPreview } from '../components/ResourcesPreview';
import { Team } from '../components/Team';
import { DesignStudioCard } from '../components/DesignStudioCard';
import { usePageMeta } from '../components/hooks/use-page-meta';

export function HomePage() {
  usePageMeta({
    title: 'DnA Club | Design & Animation Club, IIT Kanpur',
    description: 'IIT Kanpur\'s creative community for UI/UX, motion design, 3D artistry, and visual storytelling.',
    path: '/',
  });

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
