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
import MoodboardsPage from './pages/MoodboardsPage';
import BoardPage from './pages/BoardPage';
import { WorkspaceShell } from './components/shell/WorkspaceShell';
import HomeShellPage from './pages/HomeShellPage';
import AssetsPage from './pages/AssetsPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import TemplatesPage from './pages/TemplatesPage';

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
      // /moodboards/:id (the board canvas) stays a direct child of Root,
      // OUTSIDE WorkspaceShell below — see Root.tsx's isBoardPage check
      // and WorkspaceShell.tsx's own header comment on why: existing
      // board URLs/share links keep their exact pre-existing full-screen,
      // chrome-free rendering, unchanged by the V2.0 shell.
      { path: 'moodboards/:id', Component: BoardPage },
      // Workspace app shell (V2.0 Phase 2) — Home/Moodboards/Assets/
      // Projects/Templates, all under the new persistent sidebar shell.
      // Pathless layout route: contributes no path segment of its own,
      // only wraps these five with WorkspaceShell's sidebar/header/
      // WorkspaceProvider.
      {
        Component: WorkspaceShell,
        children: [
          { path: 'home', Component: HomeShellPage },
          { path: 'moodboards', Component: MoodboardsPage },
          { path: 'assets', Component: AssetsPage },
          { path: 'projects', Component: ProjectsPage },
          { path: 'projects/:id', Component: ProjectDetailPage },
          { path: 'templates', Component: TemplatesPage },
        ],
      },
    ],
  },
]);
