// PALETTE_STUDIO_FEATURE — remove the /palette route and nav link to disable
import { createBrowserRouter } from 'react-router';
import { Root } from './components/Root';
import { HomePage } from './pages/HomePage';
import { ResourcesPage } from './pages/ResourcesPage';
import { GalleryPage } from './pages/GalleryPage';
import { EventsPage } from './pages/EventsPage';
import { TeamPage } from './pages/TeamPage';
import { AcademyPage } from './pages/AcademyPage';
import MoodboardsPage from './pages/MoodboardsPage';
import BoardPage from './pages/BoardPage';
import { WorkspaceShell } from './components/shell/WorkspaceShell';
import HomeShellPage from './pages/HomeShellPage';
import AssetsPage from './pages/AssetsPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import TemplatesPage from './pages/TemplatesPage';

// Route-level code splitting (V3.2.6). Admin, Design Studio and Palette are
// only reachable through their own routes and carry heavy route-exclusive
// code (Admin: recharts, image compression + cropper; Design Studio /
// Palette: PaletteStudio, HalftoneStudio), so each loads as its own chunk
// when its route is entered instead of in every visitor's entry bundle.
// Client-side navigation keeps the current page until the chunk arrives;
// a direct load renders the layout with RouteLoading until it does.
function RouteLoading() {
  return <div aria-busy="true" style={{ minHeight: '100vh' }} />;
}
function RouteLoadError() {
  return (
    <div style={{ padding: '120px 24px', textAlign: 'center', fontFamily: 'var(--font-body)', color: 'var(--color-ink)' }}>
      <p style={{ margin: '0 0 16px' }}>This page couldn’t be loaded.</p>
      <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}

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
      { path: 'palette', lazy: () => import('./pages/PalettePage').then(m => ({ Component: m.PalettePage })), hydrateFallbackElement: <RouteLoading />, errorElement: <RouteLoadError /> }, // PALETTE_STUDIO_FEATURE
      { path: 'design-studio', lazy: () => import('./pages/DesignStudioPage').then(m => ({ Component: m.default })), hydrateFallbackElement: <RouteLoading />, errorElement: <RouteLoadError /> },
      { path: 'admin', lazy: () => import('./pages/AdminPage').then(m => ({ Component: m.AdminPage })), hydrateFallbackElement: <RouteLoading />, errorElement: <RouteLoadError /> },
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
