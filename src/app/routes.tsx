// PALETTE_STUDIO_FEATURE — remove the /palette route and nav link to disable
import { createBrowserRouter } from 'react-router';
import { Root } from './components/Root';
import { HomePage } from './pages/HomePage';
import { ResourcesPage } from './pages/ResourcesPage';
import { GalleryPage } from './pages/GalleryPage';
import { EventsPage } from './pages/EventsPage';
import { TeamPage } from './pages/TeamPage';
import { AcademyPage } from './pages/AcademyPage';
import { AdminPage } from './pages/AdminPage';
import { PalettePage } from './pages/PalettePage'; // PALETTE_STUDIO_FEATURE
import DesignStudio from './pages/DesignStudioPage';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    children: [
      { index: true, Component: HomePage },
      { path: 'academy', Component: AcademyPage },
      { path: 'resources', Component: ResourcesPage },
      { path: 'gallery', Component: GalleryPage },
      { path: 'events', Component: EventsPage },
      { path: 'team', Component: TeamPage },
      { path: 'palette', Component: PalettePage }, // PALETTE_STUDIO_FEATURE
      { path: 'design-studio', Component: DesignStudio },
      { path: 'admin', Component: AdminPage },
    ],
  },
]);
