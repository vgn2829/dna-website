import { createBrowserRouter } from 'react-router';
import { Root } from './components/Root';
import { HomePage } from './pages/HomePage';
import { ResourcesPage } from './pages/ResourcesPage';
import { GalleryPage } from './pages/GalleryPage';
import { EventsPage } from './pages/EventsPage';
import { TeamPage } from './pages/TeamPage';
import { AcademyPage } from './pages/AcademyPage';
import { AdminPage } from './pages/AdminPage';

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
      { path: 'admin', Component: AdminPage },
    ],
  },
]);
