# DnA Club Website — Comprehensive Documentation

Design & Animation Club, IIT Kanpur  
Last updated: June 2026

---

## Table of Contents

1. [About the Website](#1-about-the-website)
2. [Feature Overview](#2-feature-overview)
3. [User Roles & Access](#3-user-roles--access)
4. [Page by Page Guide](#4-page-by-page-guide)
5. [UI Design System](#5-ui-design-system)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Backend Architecture](#7-backend-architecture)
8. [Database Schema](#8-database-schema)
9. [API Reference](#9-api-reference)
10. [Email System](#10-email-system)
11. [Key Components](#11-key-components)
12. [Environment Variables](#12-environment-variables)
13. [Deployment](#13-deployment)
14. [Known Issues & Deferred Work](#14-known-issues--deferred-work)
15. [Future Features Discussed](#15-future-features-discussed)

---

## 1. About the Website

The DnA Club website is the official digital home of the Design & Animation Club at IIT Kanpur. It serves three audiences simultaneously: prospective members browsing the club's work, registered students engaging with club content, and club coordinators/admins managing everything.

**Live URLs**

| Environment | URL |
|---|---|
| Frontend | https://dna-website-two.vercel.app |
| Backend API | https://dna-website.onrender.com |

**Technology summary**

The frontend is a React 18 single-page application deployed on Vercel, built with Vite and TypeScript. The backend is a Node.js + Express API deployed on Render. The database is PostgreSQL hosted on Supabase. File storage (artwork images, videos, team photos) uses Supabase Storage. Email is sent via Resend. Collaborative moodboard canvases use the tldraw library.

**Club contacts**

- Club email: designandanimationclub.iitk@gmail.com
- Website contact via email links: same address

---

## 2. Feature Overview

### 2.1 Features for Students (registered IITK members)

**Registration**  
Students register using their IITK roll number and a `@iitk.ac.in` email. The roll number format validated is `/^[0-9]{2}[a-zA-Z0-9]{4,6}$/i`. Upon first registration a welcome email is sent automatically and a unique member ID is assigned in the format `IITK-DnA-{ROLL}-{4-char-suffix}`.

**Gallery**  
Browse all artworks uploaded by the club. Filter by domain (e.g. Illustration, Motion Graphics). Click any artwork to open a full viewer. Like artworks (toggle). Leave comments. Save artwork images directly to a personal moodboard. Images load as thumbnails (`?width=300&quality=75`) with full resolution on click. PDFs and videos are also supported with cover image previews.

**Academy**  
Domain-structured learning hub. Select a design domain from the sidebar, watch curated YouTube videos (embedded iframe), mark them as watched, then take a domain quiz to earn XP. XP formula: 10 points per video watched + 20 points per quiz completed. Progress persists across sessions via backend sync. Difficulty levels are color-coded: Beginner (green `#3ecf5f`), Intermediate (blue `#007AFF`), Advanced (red `#e5484d`).

**Events**  
Browse all upcoming and past club events. RSVP to upcoming events (requires login). A live countdown timer shows time until each event. Events show a capacity bar. Students can un-RSVP. Events filter into All / Upcoming / Past. Live sessions (video call links) appear in a separate "Live Now" section at the top of the page.

**Moodboards**  
Create and manage personal visual boards. Each board has a name, description, and visibility setting (private or shared). Shared boards are discoverable by all students. Board owners can invite collaborators by roll number. The board canvas (powered by tldraw) supports drawing, sticky notes, images, and text. Images from the gallery can be saved directly to any owned moodboard.

**Design Studio**  
An in-browser design environment (separate page at `/design-studio`). The exact capabilities depend on the PaletteStudio component.

**Like & Comment**  
On any artwork in the gallery, logged-in students can tap the heart icon to like (tap again to unlike). Comment with name and text. Admin can delete any comment.

**Live Sessions**  
When a coordinator or admin creates a live session, it appears in a fixed banner at the top of every page. The banner shows the session title, host, and a "Join" button. Students in the target audience group see the meeting link; others see the session but not the link. Clicking "Join" records the student's attendance in the database.

**XP & Progress Tracking**  
Visible on the Academy page as a progress ring. Tracks videos watched per domain and quiz completions per domain. All state is stored in localStorage and synced to the backend.

### 2.2 Features for Coordinators

Coordinators are approved IITK members (listed in the `coordinators` audience group). They do not have admin access but have special scheduling privileges.

**Schedule Live Sessions**  
Coordinators can create live sessions from the **footer scheduler modal**. The modal appears only when `meetEnabled` is true (set by admin), the user is logged in, and they are an approved coordinator (`canSchedule === true`). They fill in: title, host name, meeting link, scheduled time, and optionally an audience group.

**Go Live / End Session**  
In the footer scheduler modal, coordinators see a list of their own sessions. Each session has "Go Live" (sets status to `live`) and "End Session" (sets status to `ended`) buttons. These make direct API calls to `/api/live-sessions/coordinator/:id/status`.

**Delete Session**  
Coordinators can remove sessions they created within 24 hours of creation.

### 2.3 Admin Tabs

The admin panel at `/admin` is protected by a password (JWT-based). It has nine tabs:

| Tab | Purpose |
|---|---|
| Academy | Manage domains, videos, quiz questions |
| Gallery | Upload/edit/delete artworks, bulk upload, set featured |
| Team | Add/edit/delete team members, drag-and-drop reorder |
| Events | Create/edit/delete events |
| Comments | View and delete all artwork comments |
| Sessions | Create/edit/delete/manage live sessions, see join analytics |
| Moodboards | View all student moodboards, delete any, change visibility |
| Announcements | Compose and send email announcements to all registered students |
| Settings | Toggle public meet scheduler, set passcode, manage coordinators, edit email templates |

**Gallery bulk upload**: Admin can paste a list of files named `title_artist.ext` and the system parses title + artist automatically. Dragging in a video also captures the first frame as the cover image. An image cropper allows editing before upload.

---

## 3. User Roles & Access

| Role | How Identified | What They Can Do |
|---|---|---|
| Guest | No session in localStorage | Browse home, gallery (no likes/comments), events (no RSVP), team, resources, academy (no progress saved) |
| Student | `iitk_dna_student_session` in localStorage, validated by roll number | Everything above + like, comment, RSVP, moodboards, academy XP, join live sessions |
| Coordinator | Student who is in `audience_group_members` with `group_id='coordinators'` and `approved=true` | Everything student can do + schedule/manage live sessions via footer |
| Admin | `dna_admin_token` JWT in sessionStorage | Full admin panel, all CRUD operations, email sending, settings |

**Auth mechanics**

- Student auth: Roll number stored in `localStorage` under `iitk_dna_student_session`. No password. Roll number sent as `X-Roll-Number` header on every API request. There is no server-side session token for students; the backend uses the header for owner-checks.
- Admin auth: `POST /api/auth/admin/login` with password. Returns a JWT signed with `JWT_SECRET` (8-hour expiry). Stored in `sessionStorage` under `dna_admin_token`. Sent as `Authorization: Bearer {token}` header. The backend middleware `requireAdmin` verifies this token. On 401 response, the frontend clears the token and throws `SESSION_EXPIRED`, which `AppDataContext` catches and redirects to `/admin`.
- Coordinator auth: The backend `requireCoordinator` middleware queries `audience_group_members` where `group_id='coordinators'` AND `roll_number = X-Roll-Number header` AND `approved=true`. No separate token; coordinator status is checked live per request.

**Session gate**

`Root.tsx` wraps the entire app in a `SessionGate` component. When no student session exists, `JoinPrompt` is shown after a 1500ms delay — a floating card at the bottom of the screen offering to register or browse as guest. "Browse as guest" dismisses it for 24 hours (stored in `localStorage` as `iitk_dna_guest_dismissed` with a timestamp). The JoinPrompt is not shown on `/moodboards/:id` or `/admin`.

---

## 4. Page by Page Guide

### 4.1 Home Page

**URL**: `/`  
**Access**: Everyone  
**Component**: `src/app/pages/HomePage.tsx`

A composition-only page. Renders these sections top to bottom:

1. **Hero** — Full-screen section with club tagline, PixelTrail mouse-follow interaction, stats card (250+ Members, 50+ Workshops, 500+ Artworks), and two CTAs. If logged in: "Explore Events" button. If not logged in: "Join the Club" (opens RollModal).
2. **FeaturedMarquee** — Horizontally scrolling strip of artworks marked as featured by admin. Cards are 220px wide (7+ artworks), 260px (3–6), or 300px (1–2). Pauses on hover. Loops seamlessly by duplicating the array when count ≥ 3.
3. **Mission** — Club mission statement and values.
4. **Stats** — Animated counters for key club metrics.
5. **GalleryPreview** — A preview grid of recent artworks, links to `/gallery`.
6. **EventSpotlight** — Highlights the next upcoming event.
7. **DesignStudioCard** — CTA card linking to `/design-studio`.
8. **ResourcesPreview** — Preview of resources, links to `/resources`.
9. **Team** — Preview of team members, links to `/team`.

### 4.2 Gallery Page

**URL**: `/gallery`  
**Access**: Everyone (likes/comments require student login)  
**Component**: `src/app/pages/GalleryPage.tsx`

Masonry column layout using CSS `columns-1 sm:columns-2 lg:columns-3 xl:columns-4`. Domain filter tabs at the top (ALL + one tab per unique domain string found in artwork data). Clicking a tab filters the visible artworks.

**Artwork modal**: Clicking an artwork opens a modal. On desktop it is a centered floating card. On mobile it is a bottom-sheet that springs up with Framer Motion. The modal shows the full media (image, video player, or PDF embed), title, artist, domain, like count, and comments thread.

**LikeBurst**: When a student likes an artwork, 8 heart particles explode outward in a radial burst animation.

**MediaViewer**: Handles image, video (`<video>` element), and PDF (`<iframe>` embed).

**Save to moodboard**: Logged-in students see a "Save" button in the artwork modal that opens a picker listing their own boards. Selecting a board calls `POST /api/boards/:id/items` with the artwork image URL.

**Thumbnail optimization**: Gallery list images use `?width=300&quality=75` query params via the `thumbUrl()` helper, which Supabase storage transforms on the fly.

### 4.3 Academy Page

**URL**: `/academy`  
**Access**: Everyone (progress tracking requires student login)  
**Component**: `src/app/pages/AcademyPage.tsx`

12-column grid layout: 3-column sidebar on the left, 9-column main content on the right.

**Sidebar**: Domain tabs (one per design domain, with icon and title). Below the tabs: student stats — XP total, videos watched count, quizzes completed count. A ProgressRing SVG component renders a circular progress indicator.

**Main content**: When a domain is selected:
- YouTube iframe showing the current video (playlist of all domain videos).
- Below the iframe: a playlist of all videos in that domain. Each shows difficulty badge, duration, title. Checked state shows if the student has already watched it. Clicking a video navigates the iframe to that video and marks it watched.
- Quiz section: A multi-question flow. QuizCard component shows one question at a time. After selecting an answer, the card shows green (correct) or red (incorrect) feedback. After completing all questions, the domain quiz is marked complete.

**XP formula**: `watchedVideos.length × 10 + completedQuizzes.length × 20`. Stored in `localStorage` key `iitk_dna_student_progress`.

**Difficulty colors**:
- Beginner: `#3ecf5f`
- Intermediate: `#007AFF`
- Advanced: `#e5484d`

### 4.4 Events Page

**URL**: `/events`  
**Access**: Everyone (RSVP requires student login)  
**Component**: `src/app/pages/EventsPage.tsx`

**Live sessions section**: At the top, fetches `/api/live-sessions/active`. Shows any `live` or `upcoming` sessions. Renders them as cards with a join button.

**Filter tabs**: All / Upcoming / Past. Status logic:
- Past: event date + time is more than 2 hours ago
- Live: within 1 hour of event start
- Upcoming: everything else

**Grid / List toggle**: Students can switch between a card grid view and a compact list view.

**Event card**: Shows title, date, time, location, description, capacity bar (`registeredCount / capacity`), and a live countdown timer (days / hours / minutes / seconds) that updates every second.

**RSVP button**: Logged-in students see a RSVP / Cancel RSVP button. Clicking it calls `POST /api/events/:id/rsvp` which toggles attendance. If the event is at capacity, a 409 error is returned and the button shows "Full".

### 4.5 Team Page

**URL**: `/team`  
**Access**: Everyone  
**Component**: `src/app/pages/TeamPage.tsx`

Sections (in order): Faculty/Advisors, Coordinators, Secretaries, Design Team, Ex-Core. Ex-Core members are grouped by year and sorted descending (most recent year first).

**MemberCard**: Shows photo (or colored placeholder), name, designation, year. Clicking the card expands it to show the full bio. Social links (Instagram, LinkedIn, email) appear as icon buttons.

Responsive grid: adapts columns based on screen width.

### 4.6 Resources Page

**URL**: `/resources`  
**Access**: Everyone  
**Component**: `src/app/pages/ResourcesPage.tsx`

A curated list of design resources. (Content managed statically or via domain data.)

### 4.7 Design Studio Page

**URL**: `/design-studio`  
**Access**: Everyone  
**Component**: `src/app/pages/DesignStudioPage.tsx`

An in-browser creative tool powered by the `PaletteStudio` component.

### 4.8 Palette Page (Feature-Flagged)

**URL**: `/palette`  
**Access**: Not linked in navigation (feature-flagged as `PALETTE_STUDIO_FEATURE` in routes.tsx)  
**Component**: `src/app/pages/PalettePage.tsx`

Color palette studio. Not publicly accessible through normal navigation. The route exists in the router but is not shown in any nav link.

### 4.9 Moodboards Page

**URL**: `/moodboards`  
**Access**: Student login required (SessionGate enforces this)  
**Component**: `src/app/pages/MoodboardsPage.tsx`

Two tabs: **Mine** (boards owned by the student) and **Shared** (all boards with `visibility='shared'`).

Board list is cached in `sessionStorage` with a 5-minute TTL to avoid redundant API calls.

**Create board modal**: Name (required), description (optional), visibility: private / shared.

**BoardCard**: Shows board name, description, owner name, item count, member count, visibility badge. Clicking opens `/moodboards/:id`.

**Share & Invite modal**: Change visibility, set `edit_mode` (members only / anyone), copy a share link, invite a collaborator by entering their roll number. Inviting calls `POST /api/boards/:id/members`.

**Delete confirm**: Owner can delete the board. Non-owners can leave.

### 4.10 Board Page (Full-Screen Canvas)

**URL**: `/moodboards/:id`  
**Access**: Owner + members for private boards; everyone for shared boards  
**Component**: `src/app/pages/BoardPage.tsx` (actually `src/app/pages/TldrawCanvas.tsx` is the canvas component)

Full-screen fixed layout — the navigation bar, footer, LiveSessionBanner, and BackToTop are all hidden. The Root component detects `/moodboards/:id` paths and skips rendering those shell components.

**Top bar**: Back arrow, board name, visibility badge (Private / Shared), save status ("Saved" / "Saving…"), member avatar stack, Share/Invite/Delete buttons.

**Canvas**: `TldrawCanvas` component, lazy-loaded via `React.lazy()`. Wraps the tldraw editor with the current board's stored canvas state loaded from `GET /api/boards/:id/canvas`. On change, saves to `PUT /api/boards/:id/canvas`.

**Access logic**:
- `isOwner`: `board.owner_roll === studentSession.rollNumber`
- `isMember`: `isOwner` OR the roll number appears in `board.members`
- `readOnly`: not a member AND `edit_mode === 'members_only'`

**Keepalive**: `BoardPage` sends a ping to `/api/health` every 10 minutes to prevent the Render.com backend from going cold while the student is working.

### 4.11 Admin Page

**URL**: `/admin`  
**Access**: Admin password required  
**Component**: `src/app/pages/AdminPage.tsx` (3311 lines)

Login form on first visit. On successful login, the JWT token is stored in `sessionStorage` and the full admin dashboard is shown. Token expires after 8 hours; on expiry the panel redirects back to the login form.

**Tab: Academy**
- List all domains. Create new domain (title, full name, icon, tagline, description, color).
- For each domain: add/edit/delete videos (title, YouTube URL or ID, difficulty, duration, sequence order). Add/edit/delete quiz questions (question text, 4 options, correct answer index).

**Tab: Gallery**
- Grid of all artworks with edit/delete buttons per card.
- Upload new artwork: drag-and-drop or file picker. Fields: title, artist, domain, file (jpg/jpeg/png/gif/webp/pdf/mp4, max 50MB). Optional cover image.
- **Bulk upload mode**: toggle to drag multiple files at once. Filenames are parsed as `{title}_{artist}.{ext}`.
- **Video cover auto-capture**: When uploading a video, the first frame is captured on the frontend as a cover image.
- **Image cropper**: Before uploading, images can be cropped using the `ImageCropper` component.
- Star toggle (⭐) sets `featured=true` — featured artworks appear in the homepage marquee.
- Edit artwork: update title, artist, domain, featured status, or replace the file/cover.

**Tab: Team**
- Grid of all team members.
- Add/edit member: name, designation, year, bio, color (hex), photo (jpg/png/webp, max 10MB), display order, social links (Instagram, LinkedIn, email).
- Drag-and-drop reorder within each group (designation-based grouping).
- Delete member (photo deleted from storage too).

**Tab: Events**
- List all events. Create/edit/delete events.
- Fields: title, date (YYYY-MM-DD), time (text), location, description (up to 2000 chars), capacity.

**Tab: Comments**
- Table of all comments across all artworks. Shows comment text, sender, artwork title, timestamp. Delete button per comment.

**Tab: Sessions**
- List all live sessions (upcoming, live, ended).
- Create session: title, host, meeting link (URL), scheduled time, audience group, description.
- Set session status to live/upcoming/ended.
- View join analytics: who joined and when.

**Tab: Moodboards**
- Table of all boards from all students: name, owner, visibility, item count, member count.
- Admin can delete any board or change its `visibility` / `edit_mode`.

**Tab: Announcements**
- Compose email subject and HTML body.
- Send to all registered students (batched 50 per email via Resend BCC).

**Tab: Settings**
- Toggle `public_meet_enabled` (shows/hides the coordinator meet scheduler in footer).
- Set `public_meet_passcode` (passphrase that unlocks the public meet token).
- **Coordinators panel**: list all coordinators, add by roll number + name, approve/revoke, delete.
- **Email templates**: edit the `welcome`, `new_event`, and `new_artwork` template subject + body. Templates support `{{name}}`, `{{title}}`, `{{artist}}`, `{{domain}}`, `{{date}}`, `{{venue}}`, `{{description}}` placeholders.

---

## 5. UI Design System

All design tokens live in `src/styles/theme.css`. The app uses dark theme by default; light theme is applied by setting `data-theme="light"` on the `<html>` element (controlled by `ThemeProvider`).

### 5.1 Color Variables

| Variable | Dark value | Light value |
|---|---|---|
| `--color-canvas` | `#111110` | `#ffffff` |
| `--color-surface-1` | `#1c1c1a` | `#f5f5f5` |
| `--color-surface-2` | `#252523` | `#ebebeb` |
| `--color-ink` | `#ffffff` | `#111110` |
| `--color-ink-muted` | `#999999` | `#555550` |
| `--color-brand` | `#E91E8C` | `#E91E8C` (same) |
| `--color-inverse-canvas` | `#ffffff` | `#111110` |

Additional semantic variables (same in both themes unless noted):
- `--color-hairline`: `rgba(255,255,255,0.08)` dark / `rgba(0,0,0,0.08)` light — used for borders
- `--color-focus`: focus ring color
- `--color-shadow`: drop shadow color

### 5.2 Typography Scale

All text classes are defined as utility classes in `theme.css`.

| Class | Font size | Weight | Line height | Letter spacing |
|---|---|---|---|---|
| `.type-display-xxl` | clamp(52px, 7.6vw, 110px) | 500 | 0.85 | -5.5px |
| `.type-display-xl` | clamp(40px, 5.9vw, 85px) | 500 | 0.95 | -4.25px |
| `.type-display-lg` | clamp(30px, 4.3vw, 62px) | 500 | 1.00 | -3.1px |
| `.type-display-md` | clamp(22px, 2.2vw, 32px) | 500 | 1.13 | -1.0px |
| `.type-headline` | clamp(18px, 1.5vw, 22px) | 700 | 1.20 | -0.8px |
| `.type-body-lg` | 18px | 400 | — | — |
| `.type-body` | 15px | 400 | 1.30 | -0.15px |
| `.type-body-sm` | 14px | 500 | — | — |
| `.type-caption` | 13px | 500 | — | -0.13px |
| `.type-micro` | 12px | 400 | — | -0.12px |

### 5.3 Font Families

| Variable | Family | Usage |
|---|---|---|
| `--font-display` | `'Mona Sans'` | All headings, display text |
| `--font-body` | `'Inter Variable'` | All body copy, UI labels |
| `--font-mono` | `'JetBrains Mono'` | Code blocks, IDs |

Fonts are loaded as variable fonts via the `@font-face` declarations at the top of `theme.css`.

### 5.4 Border Radius Scale

| Variable | Value |
|---|---|
| `--radius-xs` | 4px |
| `--radius-sm` | 6px |
| `--radius-md` | 10px |
| `--radius-lg` | 15px |
| `--radius-xl` | 20px |
| `--radius-xxl` | 30px |
| `--radius-pill` | 100px |
| `--radius-full` | 9999px |

### 5.5 Component Classes

**Buttons**

```css
.btn-primary   /* inverse-canvas background, pill radius, 44px min-height, ink-inverse text */
.btn-secondary /* surface-1 background, same shape */
.btn-icon      /* 40×40px, full radius (circle), icon-only */
```

**Input**

```css
.input-base    /* surface-1 bg, hairline border, md radius, focus = box-shadow using --color-shadow-focus */
```

**Card**

```css
.card          /* surface-1 bg, xl radius */
```

**Page container**

```css
.page-container  /* max-width: 1440px, padding: 0 30px (16px on mobile) */
```

### 5.6 Spacing

No custom spacing scale beyond CSS defaults. Spacing values are used inline (e.g. `padding: '96px 0'`, `gap: 16`, `marginBottom: 48`). The main page content top padding is controlled by the fixed Navigation bar height.

### 5.7 Animations

All component animations use Framer Motion (`motion/react`). Common patterns:
- `whileHover={{ y: -4 }}` on cards for lift effect
- `initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}` for page entrance
- Spring physics via `useSpring` for scroll-driven effects
- Staggered children via `staggerChildren` in `Variants`

The LiveSessionBanner uses a `@keyframes pulse` white dot animation defined inline.  
The FeaturedMarquee uses `@keyframes marquee` injected via `useEffect` into `document.head`.

---

## 6. Frontend Architecture

### 6.1 Stack

| Tool | Version/Detail |
|---|---|
| React | 18 |
| React Router | v7 (data router, `createBrowserRouter`) |
| Vite | Build tool |
| TypeScript | Throughout |
| Tailwind CSS | v4 (utility classes used minimally; primary styling is CSS-in-JS via inline styles + theme.css classes) |
| Framer Motion | `motion/react` package |
| tldraw | Canvas library, lazy-loaded |

### 6.2 Directory Structure

```
src/
├── app/
│   ├── components/         # Shared UI components
│   │   ├── hooks/          # Custom hooks (useScrollY, etc.)
│   │   ├── ui/             # Primitive UI components
│   │   └── figma/          # Figma-related components (if any)
│   ├── context/            # React context providers
│   │   ├── AppDataContext.tsx
│   │   ├── StudentContext.tsx
│   │   └── ThemeContext.tsx (implied by ThemeProvider)
│   ├── lib/
│   │   └── api.ts          # Typed API client
│   ├── pages/              # Route-level page components
│   └── routes.tsx          # Route definitions
├── styles/
│   └── theme.css           # Full design token CSS
└── main.tsx                # Entry point
```

### 6.3 Routing

Routes are defined in `src/app/routes.tsx` using React Router v7's data router format:

```typescript
{ path: '/',                Component: Root,           children: [
  { index: true,            Component: HomePage },
  { path: 'academy',        Component: AcademyPage },
  { path: 'resources',      Component: ResourcesPage },
  { path: 'gallery',        Component: GalleryPage },
  { path: 'events',         Component: EventsPage },
  { path: 'team',           Component: TeamPage },
  { path: 'palette',        Component: PalettePage },       // feature-flagged
  { path: 'design-studio',  Component: DesignStudio },
  { path: 'admin',          Component: AdminPage },
  { path: 'moodboards',     Component: MoodboardsPage },
  { path: 'moodboards/:id', Component: BoardPage },
]}
```

`Root` is the layout wrapper that provides all context providers and renders the shell (Navigation, LiveSessionBanner, Footer, BackToTop). Board pages at `/moodboards/:id` get a full-screen treatment — the shell is not rendered for them.

### 6.4 State Management

There is no external state management library (no Redux, no Zustand). State is organized into three React contexts:

**ThemeProvider** (`src/app/context/` or in Root)  
Manages `data-theme` attribute on `<html>`. Persists preference in localStorage.

**StudentProvider** (`src/app/context/StudentContext.tsx`)  
Manages student session (roll number, name, email, unique ID). Reads/writes to `localStorage`:
- `iitk_dna_student_session` — session object
- `iitk_dna_student_progress` — `{ watchedVideos: string[], completedQuizzes: string[] }`
- `iitk_dna_welcome_shown_{roll}` — boolean flag per roll number

Exposes: `studentSession`, `setStudentSession`, `watchedVideos`, `completedQuizzes`, `markVideoWatched`, `unmarkVideoWatched`, `completeQuiz`, `xp`.

Syncs progress changes to the backend via: `api.students.markVideoWatched`, `api.students.unmarkVideoWatched`, `api.students.completeQuiz`.

**AppDataProvider** (`src/app/context/AppDataContext.tsx`)  
Loads all shared data on mount (and when roll number changes) via `Promise.all`:
```typescript
[api.domains.list(), api.artworks.list(roll), api.events.list(roll), api.team.list()]
```

Exposes: `artworks`, `events`, `domains`, `team`, `loading`, `uploadArtwork`, `updateArtwork`, `deleteArtwork`, `toggleLike`, `addComment`, `deleteComment`, `rsvpEvent`, `addEvent`, `updateEvent`, `deleteEvent`.

Optimistic updates: `toggleLike` and `rsvpEvent` update local state immediately before the API call resolves.

After `uploadArtwork` resolves: fires `api.notify.artwork()` to send email notifications.  
After `addEvent` resolves: fires `api.notify.event()` to send email notifications.

On 401 responses with admin context: calls `onAdminErr` which redirects to `/admin`.

### 6.5 API Client

`src/app/lib/api.ts` is a typed API client. All fetch calls are wrappers here.

- Base URL: `import.meta.env.VITE_API_BASE_URL`
- Admin token: read from `sessionStorage` key `dna_admin_token`
- Roll number: sent as `X-Roll-Number` header on all calls that need student identity
- Admin token: sent as `Authorization: Bearer {token}`

Namespaces:

| Namespace | Methods |
|---|---|
| `api.auth` | `adminLogin(password)` |
| `api.domains` | `list()`, `create(data)`, `update(id, data)`, `delete(id)`, `addVideo(domainId, data)`, `updateVideo(domainId, videoId, data)`, `patchVideoSeq(domainId, videoId, seq)`, `deleteVideo(domainId, videoId)` |
| `api.artworks` | `list(roll?)`, `upload(formData)`, `update(id, formData)`, `setFeatured(id, bool)`, `delete(id)`, `like(id, roll)`, `addComment(id, data)`, `deleteComment(id, commentId)` |
| `api.events` | `list(roll?)`, `create(data)`, `update(id, data)`, `delete(id)`, `rsvp(id, roll)` |
| `api.team` | `list()`, `create(formData)`, `update(id, formData)`, `updateOrder(id, order)`, `delete(id)` |
| `api.students` | `checkExists(roll)`, `register(data)`, `login(roll)`, `getProgress(roll)`, `markVideoWatched(roll, videoId)`, `unmarkVideoWatched(roll, videoId)`, `completeQuiz(roll, domainId)` |
| `api.boards` | `list(roll)`, `listShared()`, `adminListAll()`, `get(id, roll)`, `create(data, roll)`, `update(id, data, roll)`, `delete(id, roll)`, `adminDelete(id)`, `adminUpdate(id, data)`, `addMember(id, targetRoll, roll)`, `removeMember(id, targetRoll, roll)`, `addItem(id, data, roll)`, `deleteItem(id, itemId, roll)`, `getItems(id, roll)`, `getCanvas(id, roll)`, `saveCanvas(id, data, roll)`, `uploadCanvasFile(id, file, fileId, roll)` |
| `api.liveSessions` | `getActive(roll?)`, `getPast()`, `getGroups()`, `getAll()`, `create(data)`, `createPublic(data, token)`, `createCoordinator(data, roll)`, `update(id, data)`, `updateStatus(id, status)`, `updateCoordinatorStatus(id, status, roll)`, `delete(id)`, `deletePublic(id, token)`, `deleteCoordinator(id, roll)`, `join(id, roll)`, `getJoinCount(id)`, `getJoins(id)` |
| `api.coordinators` | `list()`, `add(data)`, `approve(roll, approved)`, `delete(roll)`, `check(roll)` |
| `api.settings` | `getPublic()`, `getAll()`, `update(data)`, `verifyPasscode(passcode)` |
| `api.notify` | `event(data)`, `artwork(data)`, `getTemplates()`, `getTemplate(id)`, `updateTemplate(id, data)`, `announce(subject, html)` |

---

## 7. Backend Architecture

### 7.1 Stack

| Tool | Detail |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Language | TypeScript |
| Database | PostgreSQL (Supabase-hosted) |
| Storage | Supabase Storage |
| Email | Resend |
| Auth | bcryptjs (password hashing), jsonwebtoken (JWT) |
| Validation | Zod |
| File upload | multer (memory storage) |
| ID generation | uuid v4 |
| Rate limiting | express-rate-limit |

### 7.2 App Setup (`backend/src/app.ts`)

Express app with the following middleware stack (in order):

1. `helmet()` — Security headers
2. `cors()` — Allowed origins from `CORS_ORIGINS` environment variable (comma-separated list)
3. `express.json({ limit: '50mb' })` — JSON body parser with 50MB limit
4. `express.static('uploads', { setHeaders: res => res.setHeader('Content-Disposition', 'attachment') })` — Serves local uploads with forced download header
5. Rate limit: 300 requests/minute per IP, skips `/api/health`

All API routes are mounted at `/api/*`:

```
/api/health           → { ok: true }
/api/auth             → authRouter
/api/domains          → domainsRouter
/api/artworks         → artworksRouter
/api/events           → eventsRouter
/api/team             → teamRouter
/api/students         → studentsRouter
/api/live-sessions    → liveSessionsRouter
/api/boards           → boardsRouter
/api/coordinators     → coordinatorsRouter
/api/settings         → settingsRouter
/api/notify           → notifyRouter
```

### 7.3 Admin Middleware

`backend/src/middleware/adminAuth.ts` exports `requireAdmin`. It reads the `Authorization: Bearer {token}` header, verifies with `jwt.verify(token, process.env.JWT_SECRET)`, and checks that the payload contains `{ role: 'admin' }`. On failure returns `401 { error: 'Unauthorized' }`.

### 7.4 Storage (`backend/src/storage.ts`)

The `getStorage()` function returns a storage adapter backed by Supabase Storage. It exposes three methods:

- `upload(path, buffer, mimeType)` — Uploads a file buffer to Supabase Storage
- `getPublicUrl(path)` — Returns the public CDN URL for a file
- `delete(path)` — Deletes a file from storage

Storage paths by type:
- Artwork files: `gallery/{uuid}.{ext}`
- Artwork cover images: `covers/{uuid}.jpg`
- Team member photos: `team/{uuid}.{ext}`
- Canvas images: `canvas-files/{boardId}/{fileId}.{ext}`

### 7.5 Database Client (`backend/src/db/client.ts`)

Exports `pool` (a `pg.Pool` instance) and a typed `query<T>` helper. The database schema auto-migrates on server startup — all `CREATE TABLE IF NOT EXISTS` statements run in `backend/src/db/schema.ts`.

### 7.6 File Upload Validation

For artworks and team photos, the backend validates:
1. File extension is in the allowed list
2. File magic bytes match the extension (prevents extension spoofing):
   - JPEG: `0xFF 0xD8 0xFF`
   - PNG: `0x89 0x50 0x4E 0x47`
   - GIF: `0x47 0x49 0x46 0x38`
   - WebP: `RIFF....WEBP`
   - PDF: `0x25 0x50 0x44 0x46`
   - MP4: bytes 4–7 are `ftyp`
3. File size ≤ 50MB for artworks, ≤ 10MB for team photos

---

## 8. Database Schema

All tables are auto-created on server startup via `CREATE TABLE IF NOT EXISTS`. The database is PostgreSQL on Supabase.

### `admin_config`
| Column | Type | Notes |
|---|---|---|
| `key` | TEXT | PRIMARY KEY |
| `value` | TEXT | |

Seeded with: `admin_password_hash` (bcrypt hash of the admin password).

### `domains`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (slug, e.g. `motion-graphics`) |
| `title` | TEXT | Short label (e.g. `Motion`) |
| `full_name` | TEXT | Full display name |
| `icon` | TEXT | FontAwesome class or icon identifier |
| `tagline` | TEXT | One-line description |
| `description` | TEXT | Longer description |
| `color` | TEXT | Hex color (e.g. `#007AFF`) |
| `display_order` | INT | Sort order in sidebar |
| `created_at` | TIMESTAMPTZ | Auto |

### `videos`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`{domain_id}-{uuid8}`) |
| `domain_id` | TEXT | FK → `domains.id` |
| `title` | TEXT | |
| `yt_id` | TEXT | YouTube video ID (11 chars) |
| `difficulty` | TEXT | CHECK IN ('Beginner', 'Intermediate', 'Advanced') |
| `duration` | TEXT | Human-readable string (e.g. `12:34`) |
| `sequence` | INT | Sort order within domain |
| `created_at` | TIMESTAMPTZ | Auto |

### `quiz_questions`
| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY |
| `domain_id` | TEXT | FK → `domains.id` |
| `question` | TEXT | |
| `options` | TEXT | JSON array of 4 strings, serialized |
| `answer_index` | INT | 0-based index into options |

### `events`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`evt-{uuid8}`) |
| `title` | TEXT | |
| `date` | TEXT | YYYY-MM-DD |
| `time` | TEXT | Human-readable (e.g. `6:00 PM`) |
| `location` | TEXT | |
| `content` | TEXT | Description / details |
| `capacity` | INT | Max attendees |
| `registered_count` | INT | DEFAULT 0, maintained by rsvp endpoint |
| `created_at` | TIMESTAMPTZ | Auto |

### `event_rsvps`
| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT | FK → `events.id` |
| `roll_number` | TEXT | |
| PRIMARY KEY | (`event_id`, `roll_number`) | |

The RSVP endpoint uses `SELECT ... FOR UPDATE` inside a transaction to prevent race conditions on capacity checks.

### `artworks`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`art-{uuid8}`) |
| `title` | TEXT | |
| `artist` | TEXT | |
| `domain` | TEXT | Domain label string |
| `image_url` | TEXT | Legacy field (nullable) |
| `media_type` | TEXT | CHECK IN ('image', 'pdf', 'video') |
| `storage_path` | TEXT | Supabase Storage path (e.g. `gallery/uuid.jpg`) |
| `original_filename` | TEXT | |
| `mime_type` | TEXT | |
| `file_size` | BIGINT | Bytes, max 52428800 (50MB) |
| `likes` | INT | DEFAULT 0, maintained by like endpoint |
| `featured` | BOOLEAN | DEFAULT false |
| `cover_url` | TEXT | Full URL for video/PDF cover image |
| `created_at` | TIMESTAMPTZ | Auto |

### `artwork_likes`
| Column | Type | Notes |
|---|---|---|
| `artwork_id` | TEXT | FK → `artworks.id` |
| `roll_number` | TEXT | |
| PRIMARY KEY | (`artwork_id`, `roll_number`) | |

Like/unlike is a transaction: inserts/deletes `artwork_likes` row and increments/decrements `artworks.likes`.

### `artwork_comments`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`c-{uuid8}`) |
| `artwork_id` | TEXT | FK → `artworks.id` |
| `sender` | TEXT | Student name |
| `text` | TEXT | Max 1000 chars |
| `created_at` | TIMESTAMPTZ | Auto |

Comment dates are returned as relative strings: "Just now", "5 minutes ago", "2 hours ago", "3 days ago".

### `student_sessions`
| Column | Type | Notes |
|---|---|---|
| `roll_number` | TEXT | PRIMARY KEY, uppercased |
| `unique_id` | TEXT | `IITK-DnA-{ROLL}-{XXXX}` |
| `registered_at` | TEXT | Formatted date string (Indian locale) |
| `name` | TEXT | |
| `email` | TEXT | Must end with `@iitk.ac.in` |

### `student_watched_videos`
| Column | Type | Notes |
|---|---|---|
| `roll_number` | TEXT | |
| `video_id` | TEXT | FK → `videos.id` |
| PRIMARY KEY | (`roll_number`, `video_id`) | |

### `student_completed_quizzes`
| Column | Type | Notes |
|---|---|---|
| `roll_number` | TEXT | |
| `domain_id` | TEXT | FK → `domains.id` |
| PRIMARY KEY | (`roll_number`, `domain_id`) | |

### `team_members`
| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY |
| `name` | TEXT | |
| `designation` | TEXT | Used for grouping on team page |
| `year` | TEXT | Graduation year, nullable |
| `bio` | TEXT | Max 500 chars, nullable |
| `color` | TEXT | Hex, used for avatar placeholder |
| `photo_path` | TEXT | Supabase Storage path, nullable |
| `display_order` | INT | Sort key within designation group |
| `social_instagram` | TEXT | URL, nullable |
| `social_linkedin` | TEXT | URL, nullable |
| `social_email` | TEXT | Email address, nullable |
| `created_at` | TIMESTAMPTZ | Auto |

### `email_templates`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`welcome`, `new_event`, `new_artwork`) |
| `name` | TEXT | Human-readable name |
| `subject` | TEXT | Email subject line (supports `{{placeholders}}`) |
| `body` | TEXT | HTML body (supports `{{placeholders}}`) |
| `updated_at` | TEXT | ISO string |

### `audience_groups`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (e.g. `coordinators`) |
| `name` | TEXT | |
| `description` | TEXT | |
| `created_at` | TEXT | ISO string |

### `audience_group_members`
| Column | Type | Notes |
|---|---|---|
| `group_id` | TEXT | FK → `audience_groups.id` |
| `roll_number` | TEXT | |
| `name` | TEXT | |
| `added_at` | TEXT | ISO string |
| `approved` | BOOLEAN | DEFAULT false |
| PRIMARY KEY | (`group_id`, `roll_number`) | |

The coordinator-check middleware queries this table: `group_id='coordinators'` AND `approved=true`.

### `live_sessions`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (UUID) |
| `title` | TEXT | |
| `host` | TEXT | |
| `meet_link` | TEXT | URL |
| `scheduled_at` | TEXT | ISO string |
| `status` | TEXT | DEFAULT 'upcoming' — 'upcoming', 'live', or 'ended' |
| `audience_group_id` | TEXT | FK → `audience_groups.id`, nullable (null = everyone) |
| `description` | TEXT | Nullable |
| `created_at` | TEXT | ISO string |

If `audience_group_id` is null or `'all_students'`, the session is visible to everyone and the meeting link is shown to all logged-in students.

### `session_joins`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (UUID) |
| `session_id` | TEXT | FK → `live_sessions.id` |
| `roll_number` | TEXT | |
| `name` | TEXT | Student's name at time of join |
| `joined_at` | TEXT | ISO string |
| UNIQUE | (`session_id`, `roll_number`) | Re-joining updates `joined_at` |

### `boards`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (UUID) |
| `name` | TEXT | Max 100 chars |
| `description` | TEXT | Max 300 chars, nullable |
| `owner_roll` | TEXT | Student roll number |
| `owner_name` | TEXT | |
| `visibility` | TEXT | DEFAULT 'private' — 'private' or 'shared' |
| `room_id` | TEXT | UUID, reserved for future real-time use |
| `edit_mode` | TEXT | DEFAULT 'members_only' — 'members_only' or 'anyone' |
| `canvas_data` | TEXT | JSON string of tldraw canvas state |
| `created_at` | TEXT | ISO string |

### `board_members`
| Column | Type | Notes |
|---|---|---|
| `board_id` | TEXT | FK → `boards.id` |
| `roll_number` | TEXT | |
| `name` | TEXT | |
| `added_at` | TEXT | ISO string |
| PRIMARY KEY | (`board_id`, `roll_number`) | |

### `board_items`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (UUID) |
| `board_id` | TEXT | FK → `boards.id` |
| `image_url` | TEXT | URL of the artwork image saved to this board |
| `note` | TEXT | Optional note, max 500 chars |
| `source_url` | TEXT | Optional source link |
| `added_by_roll` | TEXT | |
| `added_by_name` | TEXT | |
| `created_at` | TEXT | ISO string |

### `app_settings`
| Column | Type | Notes |
|---|---|---|
| `key` | TEXT | PRIMARY KEY |
| `value` | TEXT | |
| `updated_at` | TEXT | ISO string |

Seeded with:
- `public_meet_enabled` = `'false'`
- `public_meet_passcode` = `'DNA2025'`

---

## 9. API Reference

Base URL for all endpoints: `https://dna-website.onrender.com`

All endpoints are prefixed with `/api`.

**Common headers**:
- `X-Roll-Number: {ROLL}` — Student identity (required for student-protected endpoints)
- `Authorization: Bearer {token}` — Admin JWT (required for admin-protected endpoints)
- `Content-Type: application/json` — For JSON bodies
- `Content-Type: multipart/form-data` — For file upload endpoints

**Legend**: 🔓 Public · 🎓 Student (roll number header) · 🛡 Admin (JWT) · 📡 Coordinator

---

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | 🔓 | Returns `{ ok: true }`. Rate-limit exempt. |

---

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/admin/login` | 🔓 | Body: `{ password }`. Returns `{ token }`. Rate-limited: 10 req / 15 min. |

---

### Domains

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/domains` | 🔓 | All domains with their videos and quiz questions. |
| POST | `/api/domains` | 🛡 | Create domain. Body: `{ title, fullName, icon?, tagline?, description?, color? }`. |
| PUT | `/api/domains/:id` | 🛡 | Update domain fields. Body: same as create (all optional). |
| DELETE | `/api/domains/:id` | 🛡 | Delete domain. 204 on success. |
| POST | `/api/domains/:id/videos` | 🛡 | Add video. Body: `{ title, ytUrl, difficulty, duration, sequence? }`. |
| PUT | `/api/domains/:id/videos/:videoId` | 🛡 | Update video. Body: same fields all optional. |
| PATCH | `/api/domains/:id/videos/:videoId` | 🛡 | Update sequence only. Body: `{ sequence }`. |
| DELETE | `/api/domains/:id/videos/:videoId` | 🛡 | Delete video. 204 on success. |

The `GET /api/domains` response is an object keyed by domain ID:
```json
{
  "motion-graphics": {
    "id": "motion-graphics",
    "title": "Motion",
    "fullName": "Motion Graphics",
    "icon": "fa-film",
    "tagline": "...",
    "description": "...",
    "color": "#007AFF",
    "videos": [{ "id": "...", "title": "...", "ytId": "...", "difficulty": "Beginner", "duration": "12:00", "sequence": 1 }],
    "quizzes": [{ "q": "...", "options": ["A","B","C","D"], "ans": 2 }]
  }
}
```

---

### Artworks

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/artworks` | 🔓 / 🎓 | All artworks ordered by `created_at DESC`. With roll header: includes `likedByUser`. |
| POST | `/api/artworks` | 🛡 | Multipart: `file` (required), `cover` (optional), `title`, `artist`, `domain`. |
| PUT | `/api/artworks/:id` | 🛡 | Multipart update: all fields optional, `file` and `cover` optional replacements. |
| PATCH | `/api/artworks/:id/featured` | 🛡 | Body: `{ featured: boolean }`. Returns `{ id, featured }`. |
| DELETE | `/api/artworks/:id` | 🛡 | Deletes file from storage and DB. 204 on success. |
| POST | `/api/artworks/:id/like` | 🎓 | Toggle like. Returns `{ likes, likedByUser }`. Rate-limited: 30 req/min. |
| POST | `/api/artworks/:id/comments` | 🎓 | Body: `{ sender, text }`. Returns created comment. Rate-limited: 10 req/min. |
| DELETE | `/api/artworks/:id/comments/:commentId` | 🛡 | Delete comment. Returns `{ success, deletedId }`. |

Artwork response shape:
```json
{
  "id": "art-abc12345",
  "title": "...",
  "artist": "...",
  "domain": "Illustration",
  "mediaUrl": "https://...",
  "mediaType": "image",
  "originalFilename": "design.jpg",
  "likes": 12,
  "likedByUser": false,
  "featured": true,
  "coverUrl": null,
  "comments": [{ "id": "c-xxxx", "sender": "Name", "text": "...", "date": "5 minutes ago" }]
}
```

---

### Events

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/events` | 🔓 / 🎓 | All events ordered by date ASC. With roll header: includes `isRegistered`. |
| POST | `/api/events` | 🛡 | Body: `{ title, date (YYYY-MM-DD), time, location, content, capacity }`. |
| PUT | `/api/events/:id` | 🛡 | Body: same fields, all optional. |
| DELETE | `/api/events/:id` | 🛡 | 204 on success. |
| POST | `/api/events/:id/rsvp` | 🎓 | Toggle RSVP. Uses `FOR UPDATE` row lock. Returns `{ registeredCount, isRegistered }`. 409 if at capacity. |

---

### Team

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/team` | 🔓 | All members ordered by `display_order ASC, id ASC`. |
| POST | `/api/team` | 🛡 | Multipart: `photo` (optional), plus all member fields. |
| PUT | `/api/team/:id` | 🛡 | Multipart update: all fields required (replaces record). Photo optional. |
| PATCH | `/api/team/:id/order` | 🛡 | Body: `{ display_order }`. |
| DELETE | `/api/team/:id` | 🛡 | Deletes photo from storage and DB. 204 on success. |

Member response shape:
```json
{
  "id": 1,
  "name": "Jane Doe",
  "designation": "Coordinator",
  "year": "2025",
  "bio": "...",
  "color": "#007AFF",
  "photoUrl": "https://...",
  "displayOrder": 1,
  "social": { "instagram": null, "linkedin": "https://...", "email": null }
}
```

---

### Students

| Method | Path | Auth | Rate limit |
|---|---|---|---|
| GET | `/api/students/:roll/exists` | 🔓 | — |
| POST | `/api/students/sessions` | 🔓 | 10 req / 5 min |
| POST | `/api/students/sessions/login` | 🔓 | — |
| GET | `/api/students/:roll/profile` | 🔓 | 60 req / min |
| GET | `/api/students/:roll/progress` | 🔓 | 60 req / min |
| POST | `/api/students/:roll/progress/videos/:videoId` | 🎓 (owner) | 30 req / min |
| DELETE | `/api/students/:roll/progress/videos/:videoId` | 🎓 (owner) | 30 req / min |
| POST | `/api/students/:roll/progress/quizzes/:domainId` | 🎓 (owner) | 30 req / min |

**Owner guard**: Progress write endpoints check that `X-Roll-Number` header matches the `:roll` param. 403 if they don't match.

`GET /:roll/exists` returns:
```json
{ "exists": true, "hasProfile": true }
```

`POST /sessions` body: `{ rollNumber, name, email }`. Returns:
```json
{
  "session": { "rollNumber": "22ABC123", "uniqueId": "IITK-DnA-22ABC123-XY9Z", "registeredAt": "01 Jun 2025", "name": "Jane", "email": "jane@iitk.ac.in" },
  "progress": { "watchedVideos": ["vid-id1"], "completedQuizzes": ["motion-graphics"] }
}
```

Also fires a welcome email on first-time registration.

---

### Notify (Email)

All endpoints require admin JWT.

| Method | Path | Description |
|---|---|---|
| GET | `/api/notify/test-email` | Sends a test email to the club Gmail. |
| POST | `/api/notify/event` | Body: `{ title, date?, venue?, description? }`. Queues event notification to all students. |
| POST | `/api/notify/artwork` | Body: `{ title, artist, domain? }`. Queues artwork notification to all students. |
| GET | `/api/notify/templates` | Returns all email templates. |
| GET | `/api/notify/templates/:id` | Returns single template by ID. |
| PUT | `/api/notify/templates/:id` | Body: `{ subject, body }`. Updates template. |
| POST | `/api/notify/announce` | Body: `{ subject, html }`. Sends custom email to all registered students. Returns `{ sent: N }`. |

---

### Live Sessions

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/live-sessions/active` | 🔓 / 🎓 | Active + upcoming sessions. Audience-checks the `meet_link` per student. |
| GET | `/api/live-sessions/past` | 🛡 | Ended sessions with join counts. |
| GET | `/api/live-sessions/groups` | 🛡 | Audience groups with member counts. |
| GET | `/api/live-sessions` | 🛡 | All sessions ordered by `scheduled_at DESC`. |
| POST | `/api/live-sessions` | 🛡 | Create session. Body: `{ title, host, meet_link, scheduled_at, audience_group_id?, description? }`. |
| POST | `/api/live-sessions/public` | 🔓 (token) | Create session using public meet token (base64 JWT, 24h expiry). Body includes `token`. |
| DELETE | `/api/live-sessions/public/:id` | 🔓 (token) | Delete session within 24h of creation. Body: `{ token }`. |
| POST | `/api/live-sessions/coordinator` | 📡 | Create session. Same body as admin create. |
| DELETE | `/api/live-sessions/coordinator/:id` | 📡 | Delete own session within 24h. |
| PUT | `/api/live-sessions/coordinator/:id/status` | 📡 | Body: `{ status }` — 'live', 'ended', or 'upcoming'. |
| GET | `/api/live-sessions/:id/joins` | 🛡 | Returns `{ session_id, count, joins: [{roll_number, name, joined_at}] }`. |
| GET | `/api/live-sessions/:id/joins/count` | 🔓 | Returns `{ count }`. Polled by `LiveSessionBanner` every 30s. |
| POST | `/api/live-sessions/:id/join` | 🎓 | Track join event. Body: roll in header. Silently succeeds even on error. |
| PUT | `/api/live-sessions/:id/status` | 🛡 | Body: `{ status }`. |
| PUT | `/api/live-sessions/:id` | 🛡 | Partial update of session fields. |
| DELETE | `/api/live-sessions/:id` | 🛡 | Delete any session. |

**Audience access logic** in `GET /active`: If a session has no `audience_group_id` or it is `'all_students'`, `canAccess=true` for everyone. Otherwise, checks `audience_group_members` for the student's roll. If not a member, `meet_link` is returned as `null`.

**Public meet token**: Generated by `POST /api/settings/verify-passcode`. It is a base64-encoded JSON payload `{ type: 'public_meet', exp: timestamp }` valid for 24 hours. Used by the footer scheduler when `public_meet_enabled=true`.

---

### Boards

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/boards` | 🎓 | Boards owned by or member of. |
| GET | `/api/boards/shared` | 🔓 | All boards with `visibility='shared'`. |
| GET | `/api/boards/admin/all` | 🛡 | All boards from all users. |
| DELETE | `/api/boards/admin/:id` | 🛡 | Admin delete any board. |
| PUT | `/api/boards/admin/:id` | 🛡 | Admin update `visibility` or `edit_mode`. |
| POST | `/api/boards` | 🎓 | Create board. Body: `{ name, description?, visibility? }`. |
| GET | `/api/boards/:id` | 🔓 / 🎓 | Board + items + members. Private boards require membership. |
| PUT | `/api/boards/:id` | 🎓 (owner) | Update `name`, `description`, `visibility`, `edit_mode`. |
| DELETE | `/api/boards/:id` | 🎓 (owner) | Delete board. |
| GET | `/api/boards/:id/canvas` | 🎓 (member) | Returns `{ canvas_data: string\|null }`. |
| PUT | `/api/boards/:id/canvas` | 🎓 (member) | Body: `{ canvas_data }` (JSON string). |
| POST | `/api/boards/:id/members` | 🎓 (owner) | Invite collaborator. Body: `{ roll_number }`. Student must already be registered. |
| DELETE | `/api/boards/:id/members/:roll` | 🎓 (owner) | Remove collaborator. |
| POST | `/api/boards/:id/items` | 🎓 (member) | Add item. Body: `{ image_url, note?, source_url? }`. |
| DELETE | `/api/boards/:id/items/:itemId` | 🎓 (item owner or board owner) | Delete item. |
| GET | `/api/boards/:id/items` | 🎓 / 🔓 (shared) | Items only (for polling). |
| POST | `/api/boards/:id/canvas-files` | 🎓 (member) | Upload image for canvas. Multipart: `file`. Returns `{ fileId, url }`. |

---

### Coordinators

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/coordinators` | 🛡 | All coordinators with approval status and email. |
| POST | `/api/coordinators` | 🛡 | Add coordinator. Body: `{ roll_number, name }`. `approved=false` by default. |
| PUT | `/api/coordinators/:roll/approve` | 🛡 | Toggle approval. Body: `{ approved: boolean }`. |
| DELETE | `/api/coordinators/:roll` | 🛡 | Remove coordinator. |
| GET | `/api/coordinators/check/:roll` | 🔓 | Returns `{ canSchedule: boolean }`. Used by Footer to show scheduler. |

---

### Settings

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/settings/public` | 🔓 | Returns `{ public_meet_enabled: 'true'\|'false' }`. |
| GET | `/api/settings` | 🛡 | All settings as `{ key: value }`. |
| PUT | `/api/settings` | 🛡 | Body: `{ key: value, ... }` — upserts any keys. |
| POST | `/api/settings/verify-passcode` | 🔓 | Body: `{ passcode }`. Returns `{ success, token }` (24h base64 token). |

---

## 10. Email System

### Provider

Resend (`https://resend.com`). SDK: `import { Resend } from 'resend'`.

All outgoing emails use:
- **From**: `DnA Club IITK <onboarding@resend.dev>` (Resend's shared sending domain)
- **Reply-To**: `designandanimationclub.iitk@gmail.com`

### Email Functions (`backend/src/services/mailer.ts`)

**`sendWelcomeEmail(name, email)`**  
Triggered on first-time student registration. Fetches the `welcome` template from `email_templates`. Replaces `{{name}}` placeholder. Sends to the student's individual `@iitk.ac.in` email.

**`sendEventNotification(event)`**  
Triggered when admin creates an event via `POST /api/notify/event`. Fetches all student emails from `student_sessions`. Fetches the `new_event` template. Replaces `{{title}}`, `{{date}}`, `{{venue}}`, `{{description}}`. Sends to all students in batches.

**`sendArtworkNotification(artwork)`**  
Triggered when admin uploads an artwork via `POST /api/notify/artwork`. Fetches all student emails. Fetches the `new_artwork` template. Replaces `{{title}}`, `{{artist}}`, `{{domain}}`. Sends to all students in batches.

**`sendCustomAnnouncement(subject, html, emails)`**  
Used by `POST /api/notify/announce`. Sends a custom subject + HTML body to a provided list of emails.

**`sendInBatches(emails, subject, html)`**  
Internal helper. Splits the email list into chunks of 50. For each chunk, sends one email with the chunk as BCC recipients and the club Gmail as the `to` address. This keeps individual student addresses private and complies with Resend's sending limits.

### HTML Wrapper

All emails use `getBaseTemplate(content)` which wraps content in a styled HTML shell:
- Dark background (`#0a0a0a`), white text
- Brand-colored (`#E91E8C`) header bar with "Design & Animation Club, IIT Kanpur"
- "Visit Website" CTA button linking to `https://dna-website-two.vercel.app`
- Footer with club name and website link

### Template Placeholders

| Template ID | Available Placeholders |
|---|---|
| `welcome` | `{{name}}` |
| `new_event` | `{{title}}`, `{{date}}`, `{{venue}}`, `{{description}}` |
| `new_artwork` | `{{title}}`, `{{artist}}`, `{{domain}}` |

Templates are edited by admin in the Settings tab → Email Templates section. Changes take effect immediately (no restart needed).

---

## 11. Key Components

### `src/app/components/Root.tsx`
Provider tree: `ThemeProvider` > `StudentProvider` > `AppDataProvider`. Detects board page paths (`/moodboards/:id`) and renders full-screen (no navbar, no footer, no LiveSessionBanner, no BackToTop, no top padding). All other routes get the full shell. `SessionGate` renders `JoinPrompt` when no student session exists. Smooth scrolls to top on route change (except board pages).

### `src/app/components/Navigation.tsx`
Top navigation bar with fixed positioning. Contains logo, nav links, theme toggle, and student login status / roll number display. On mobile: hamburger menu with slide-in drawer.

### `src/app/components/Hero.tsx`
Full-screen landing section. PixelTrail interaction: mouse move events on the section create a trail of colored pixels at the cursor position (pointer-events disabled so it doesn't block clicks). Stats card with gradient-violet spotlight effect showing 250+ Members, 50+ Workshops, 500+ Artworks. Two CTAs based on auth state.

### `src/app/components/FeaturedMarquee.tsx`
Horizontally scrolling featured artworks strip. Injects `@keyframes marquee` via `useEffect` into `document.head`. Items array is duplicated for seamless loop when count ≥ 3. Pauses on mouseEnter. Card width adapts to artwork count (220/260/300px). Animation duration adapts: 20s for ≤4 items, 30s for ≤8, 40s for more.

### `src/app/components/LiveSessionBanner.tsx`
Fixed top bar, `z-index: 8000`. Polls `/api/live-sessions/active` every 60 seconds. Shows the primary session (live status takes priority over upcoming). Pulsing white dot for live sessions. Join count polled every 30s from `/api/live-sessions/:id/joins/count`. Dismissible per session ID (stored in state, resets on page refresh). Background: `#E91E8C` (brand) when live, `--color-surface-1` when upcoming.

### `src/app/components/Footer.tsx`
Standard footer with Explore and Club link columns plus Instagram + email social links. Contains the coordinator **Meet Scheduler modal**. The modal appears only when: `meetEnabled` (from `/api/settings/public`) is `true` AND `studentSession` exists AND `canSchedule` is `true` (from `/api/coordinators/check/:roll`). The modal has a "Schedule a Meet" form and a list of existing sessions with "Go Live", "End Session", "Remove" action buttons.

### `src/app/components/RollModal.tsx`
Two-step registration/login flow. Step 1 (`'roll'`): enter roll number → `api.students.checkExists()`. If `exists && hasProfile` → direct login. Otherwise → Step 2 (`'profile'`): enter name + `@iitk.ac.in` email → `api.students.register()`. After successful first-time registration: if `hasSeenWelcome(roll)` is false, shows `WelcomeOverlay`. Shake animation on validation errors.

### `src/app/components/JoinPrompt.tsx`
Bottom-anchored floating card shown to guests after 1500ms delay. Dismissible for 24h via `localStorage` key `iitk_dna_guest_dismissed` (stores timestamp). The outer wrapper has `pointer-events: none`; the card itself has `pointer-events: all` so background content remains interactive. "Register with IITK ID" opens `RollModal`. "Browse as guest" dismisses.

### `src/app/components/WelcomeOverlay.tsx`
Full-screen modal, `z-index: 9999`. Shown once per new registration. Lists 5 features: Design Studio, Academy, Moodboards, Gallery, Like & Comment. Staggered entrance animation per feature row. Two CTAs: "Explore Gallery" (navigates to `/gallery` then closes) and "Browse on my own" (closes only). After close, marks `iitk_dna_welcome_shown_{roll}=true` in localStorage.

### `src/app/components/ImageCropper.tsx`
Image crop modal used in admin gallery upload. Allows cropping before upload.

### `src/app/components/AnimatedBlobs.tsx`
Background blob animations. Used on certain sections for visual depth.

### `src/app/components/BackToTop.tsx`
Floating button that appears when user scrolls down. Smooth-scrolls to top on click.

### `src/app/components/CustomCursor.tsx`
Custom cursor overlay (desktop only). Renders a custom pointer following the mouse.

### `src/app/components/HeroScroll.tsx`
Built but currently not active (was reverted from HomePage). Scroll-driven animation section showing featured artwork grid with tilt effects. Uses `useSpring` with smooth physics and `perspective: 1200px` on the parent. Can be re-enabled by importing in `HomePage.tsx`.

### `src/app/context/AppDataContext.tsx`
Interfaces exported: `Artwork`, `ArtworkComment`, `ClubEvent`, `VideoResource`, `QuizQuestion`, `Domain`, `TeamMember`. Loads data in parallel on mount. Provides optimistic updates for like/RSVP. Handles `SESSION_EXPIRED` from admin API calls.

### `src/app/context/StudentContext.tsx`
LocalStorage keys managed: `iitk_dna_student_session`, `iitk_dna_student_progress`, `iitk_dna_welcome_shown_{roll}`. XP computed as `watchedVideos.length * 10 + completedQuizzes.length * 20`. Progress synced to backend on change.

### `src/app/lib/api.ts`
Typed API client. Base URL from `VITE_API_BASE_URL`. Admin token in `sessionStorage`. Roll in `X-Roll-Number` header. 401 admin responses throw `SESSION_EXPIRED` error after clearing token.

---

## 12. Environment Variables

### Frontend (`.env` or Vercel environment)

| Variable | Example | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `https://dna-website.onrender.com` | Backend API base URL used by `api.ts` |

### Backend (`.env` or Render environment)

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://...supabase...` | PostgreSQL connection string (Supabase) |
| `JWT_SECRET` | `a-long-random-string` | Signs and verifies admin JWT tokens |
| `RESEND_API_KEY` | `re_...` | Resend email service API key |
| `CORS_ORIGINS` | `https://dna-website-two.vercel.app,http://localhost:5173` | Comma-separated list of allowed CORS origins |
| `PORT` | `3000` | Express server port (Render sets this automatically) |
| `NODE_ENV` | `production` | Node environment |
| `SUPABASE_URL` | `https://xyz.supabase.co` | Supabase project URL (for storage client) |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Supabase service role key (bypasses RLS for storage operations) |

If `RESEND_API_KEY` is not set, the mailer service logs a warning and all email functions return early without sending. This allows local development without email setup.

The admin password is not an environment variable — it is stored as a bcrypt hash in the `admin_config` table under the key `admin_password_hash`. To change the password, update this row directly in the database.

---

## 13. Deployment

### Frontend — Vercel

**Repository**: same monorepo  
**Build command**: `npm run build` (Vite)  
**Output directory**: `dist`  
**Framework preset**: Vite  
**Environment variables set in Vercel dashboard**: `VITE_API_BASE_URL`

All routes fall back to `index.html` (SPA routing). Vercel handles this automatically for Vite projects.

### Backend — Render

**Repository**: `backend/` subdirectory of the monorepo  
**Build command**: `npm run build` (TypeScript compile)  
**Start command**: `npm start` (runs compiled `dist/index.js`)  
**Instance type**: Free tier  
**Environment variables set in Render dashboard**: `DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY`, `CORS_ORIGINS`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

**Cold start mitigation**: Render free tier suspends the service after 15 minutes of inactivity. `BoardPage` sends a keepalive ping to `GET /api/health` every 10 minutes while a student has a board open. This prevents the backend from sleeping during active sessions.

The first request after a cold start may take 30–60 seconds to respond while the Node.js process boots.

### Database & Storage — Supabase

**Database**: PostgreSQL, hosted on Supabase. Schema auto-migrates on every backend startup via `CREATE TABLE IF NOT EXISTS` statements in `backend/src/db/schema.ts`.

**Storage**: Supabase Storage. Files are organized in paths:
- `gallery/` — Artwork media files
- `covers/` — Video and PDF cover images
- `team/` — Team member photos
- `canvas-files/` — tldraw canvas image assets

Supabase Storage provides public CDN URLs for all uploaded files. The `getStorage().getPublicUrl(path)` helper constructs these URLs.

Thumbnail resizing for gallery images is done via Supabase's image transform API: the frontend appends `?width=300&quality=75` to image URLs, which Supabase processes on the CDN edge.

---

## 14. Known Issues & Deferred Work

### 1. Render Free Tier Cold Start Latency

The backend is hosted on Render's free tier, which suspends the process after 15 minutes of inactivity. The `BoardPage` keepalive ping (every 10 minutes) only prevents sleep while a board is open. On first page load of the day — or after any other 15-minute idle period — the backend takes 30–60 seconds to respond. Users see loading spinners or errors during this window. The `LiveSessionBanner` poll and `AppDataProvider` parallel fetch will both fail silently until the backend is warm.

**Mitigation**: Upgrade to a paid Render instance, or add a global keepalive cron (e.g. an external uptime monitoring service pinging `/api/health` every 10 minutes).

### 2. HeroScroll Component Built but Reverted

`src/app/components/HeroScroll.tsx` is a fully built animated homepage section that shows the featured artworks in a scroll-driven tilt animation grid. It was added (commit `7525137`) and subsequently reverted (commit `5dff31c`) back to the original homepage layout. The component still exists in the codebase but is not imported or rendered anywhere. The final `157b70b` commit fixed the spring physics and perspective issues before it was reverted.

**Deferred**: If the HeroScroll section is desired in future, re-import it in `HomePage.tsx` between `<Hero />` and `<FeaturedMarquee />`. The component is complete and should work — it uses `useSpring` for smooth scroll-driven transforms and `perspective: 1200` on the parent container.

### 3. Moodboard Canvas Has No Real-Time Sync

The tldraw canvas saves state to the backend (`PUT /api/boards/:id/canvas`) and loads it on mount (`GET /api/boards/:id/canvas`). There is no WebSocket or real-time sync channel between concurrent editors. The `room_id` column in the `boards` table is reserved for this purpose but is not yet used. If two collaborators edit the same board simultaneously, the last one to save wins and the other's changes are overwritten.

**Deferred**: Implement WebSocket-based real-time collaboration using the `room_id` field as a session key (e.g., with tldraw's built-in sync adapter or a separate Partykit/Socket.io server).

### 4. Palette Studio Is Behind a Feature Flag and Unreachable

The Palette Studio page (`src/app/pages/PalettePage.tsx`, route `/palette`) exists in the router under the comment `// PALETTE_STUDIO_FEATURE` but is not linked in the Navigation or any other component. The `PaletteStudio` component is functional but the feature is not considered ready for general access. There is no admin toggle for it.

**Deferred**: When ready, add a navigation link to `/palette` in `Navigation.tsx` and remove the feature-flag comment in `routes.tsx`.

---

## 15. Future Features Discussed

### Real-Time Collaborative Canvas

The moodboard system has the database infrastructure (`room_id` in `boards`, the `board_members` table) for real-time collaboration but currently uses save-on-demand. A future iteration would integrate tldraw's sync engine or a separate WebSocket relay (Partykit, Liveblocks, or a custom Socket.io server) to enable true simultaneous editing with cursor presence.

### HeroScroll Animated Section

The built-but-reverted `HeroScroll.tsx` component would add a scroll-driven section between the hero and the featured marquee on the homepage. It shows the featured artworks as a grid with 3D tilt animation driven by scroll position. The implementation is complete; re-enabling requires one import and one JSX line in `HomePage.tsx`.

### Interactive 3D Robot on Hero

`src/app/components/InteractiveRobotSpline.tsx` exists in the codebase, suggesting a 3D robot model (Spline-based) was explored for the hero section as a more engaging visual element than the current PixelTrail interaction. This was not shipped.

### Figma Component Integration

A `figma/` subdirectory exists inside `src/app/components/`, indicating Figma-related tooling or component export scaffolding was explored. No detail on what this contains was established in the initial codebase review.

### Audience Group Management Beyond Coordinators

The `audience_groups` and `audience_group_members` tables support arbitrary groups (not just coordinators). The current UI only surfaces the `coordinators` group. A future admin feature could let admins create custom audience groups (e.g. by year, by domain interest) and target live sessions to specific groups.

### Per-Domain Leaderboard

The XP system tracks points per student but there is no leaderboard page. A leaderboard showing top students by XP (with privacy options — show name or roll only) was discussed as a future engagement feature.

### Resource Upload by Domain

The Resources page currently shows static or domain-derived content. A future iteration could allow admins to upload curated design resources (PDFs, links, templates) per domain, with the same storage pipeline used for artworks.

### Admin Analytics Dashboard

Currently the admin has session join counts and event registration counts but no unified analytics view. A future analytics tab could show: total registrations over time, most liked artworks, most active domains, event attendance rates, and email open rates.
