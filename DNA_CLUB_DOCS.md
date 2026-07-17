# DnA Club Website — Comprehensive Documentation

Design & Animation Club, IIT Kanpur
Rewritten from a fresh, line-by-line audit of the codebase — July 2026

---

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [Tech Stack](#2-tech-stack)
3. [Folder & File Structure](#3-folder--file-structure)
4. [Complete Features List](#4-complete-features-list)
5. [Components Breakdown](#5-components-breakdown)
6. [Full Code Logic Reference](#6-full-code-logic-reference)
7. [Styling Approach](#7-styling-approach)
8. [Animations](#8-animations)
9. [Data & State Management](#9-data--state-management)
10. [Routing](#10-routing)
11. [Known Issues / TODOs](#11-known-issues--todos)
12. [How to Run Locally](#12-how-to-run-locally)
13. [Database Schema](#13-database-schema)
14. [API Reference](#14-api-reference)

---

## 1. Project Summary

The DnA Club website is the official digital home of the **Design & Animation Club at IIT Kanpur**. It serves three audiences:

- **Prospective/general visitors** — browse the club's artwork gallery, events, and team, with no login required.
- **Registered IITK students** — log in with their roll number + `@iitk.ac.in` email to like/comment on artwork, RSVP to events, track learning progress in the "Academy," join live sessions, and create collaborative moodboard canvases.
- **Club admins/coordinators** — manage all content (gallery, events, team, academy domains/videos/quizzes) through a password-protected admin dashboard, send email notifications/announcements, and (for approved coordinators) schedule live Google Meet sessions.

**Live URLs** (per `DEPLOYMENT.md`):

| Environment | URL |
|---|---|
| Frontend | https://dna-website-two.vercel.app |
| Backend API | https://dna-website.onrender.com |

**One-line architecture:** a React 18 + Vite + TypeScript single-page app talks to a Node/Express + TypeScript REST API, backed by Postgres (Supabase) with Supabase Storage for media, and Resend for transactional email.

**Club contact:** designandanimationclub.iitk@gmail.com

---

## 2. Tech Stack

### Frontend (`/`, root `package.json`)

| Category | Library | Version |
|---|---|---|
| Framework | React | `18.3.1` (peer dep) |
| Build tool | Vite | `^6.4.3` |
| Language | TypeScript | via `@types/react` `^18.3.31` |
| Routing | `react-router` | `^7.17.0` (data-router / `createBrowserRouter`) |
| Styling | Tailwind CSS | `4.1.12` (CSS-first, `@tailwindcss/vite` plugin) |
| Animation | `motion` | `12.23.24` (standalone "Motion" library, imported as `motion/react` — not `framer-motion`) |
| UI primitives | Radix UI (`@radix-ui/react-*`) | various, underpin the shadcn-style `src/app/components/ui/` kit |
| Icons | `lucide-react` | `0.487.0` |
| Component variants | `class-variance-authority`, `clsx`, `tailwind-merge` | — |
| Whiteboard/canvas | `tldraw` | `2.4.4` (Moodboards feature) |
| 3D | `@splinetool/react-spline` | `^4.1.0` (unused in the live tree, see §11) |
| Image cropping | `react-image-crop` | `^11.0.10` |
| Image compression | `browser-image-compression` | `^2.0.2` |
| Carousels | `embla-carousel-react`, `react-slick` | present but unused by the live component tree |
| Confetti | `canvas-confetti` | `1.9.4` (present, no current call site found) |
| Charts | `recharts` | `2.15.2` (backs `ui/chart.tsx`) |
| Forms | `react-hook-form` | `7.55.0` |
| Toasts | `sonner` | `2.0.3` |
| Dates | `date-fns` | `3.6.0` |
| Theming lib | `next-themes` | `0.4.6` (installed but **not used** — the site has its own hand-rolled `ThemeContext`) |
| Misc | `uuid`, `vaul`, `cmdk`, `input-otp`, `react-dnd` (+html5-backend), `react-resizable-panels`, `react-popper`, `@popperjs/core`, `react-responsive-masonry` | supporting the `ui/` kit and admin drag-and-drop |
| Dev tooling | `vite`, `@vitejs/plugin-react` `4.7.0`, `@tailwindcss/vite`, `tailwindcss`, TypeScript types | — |

### Backend (`backend/`, separate `package.json`)

| Category | Library | Version |
|---|---|---|
| Runtime | Node.js | 20 (per Dockerfiles) |
| Framework | Express | `^4.19.2` |
| Language | TypeScript (compiled via `tsc`, dev via `tsx watch`) | `^5.4.5` |
| Database driver | `pg` (node-postgres) | `^8.11.5` |
| Object storage | `@supabase/supabase-js` | `^2.45.4` |
| Auth | `jsonwebtoken` (admin JWT), `bcryptjs` (password hashing) | `^9.0.2` / `^2.4.3` |
| Validation | `zod` | `^3.22.4` |
| File uploads | `multer` (memory storage) | `^1.4.5-lts.1` |
| Image processing | `sharp` (thumbnail generation) | `^0.35.2` |
| Email | `resend` | `^6.14.0` (the **only** email provider actually wired up — `nodemailer` is listed as a dependency but unused in `services/mailer.ts`) |
| Security middleware | `helmet`, `cors`, `express-rate-limit` | `^7.1.0` / `^2.8.5` / `^7.2.0` |
| IDs | `uuid` | `^11.1.1` |
| Env | `dotenv` | `^16.4.5` |

### Infrastructure

- **Database + file storage:** Supabase (Postgres + Storage bucket `dna-media`).
- **Frontend hosting:** Vercel (SPA, `vercel.json` rewrites everything to `index.html`).
- **Backend hosting:** Render (Web Service) — with a Docker Compose alternative (`Dockerfile`, `backend/Dockerfile`, `nginx.conf`, `docker-compose.yml`) for self-hosting.
- **Package manager:** `pnpm` (root `pnpm-workspace.yaml`, `pnpm-lock.yaml`) for the frontend; the backend uses plain `npm` (`package-lock.json`).

---

## 3. Folder & File Structure

```
dna_website/
├── index.html                    # SPA shell — Google Fonts links, Font Awesome CDN, inline FOUC-prevention theme script
├── vite.config.ts                # Vite config: React + Tailwind v4 plugins, "@" → src alias, figma:asset resolver, dev proxy /api → :4000
├── tsconfig.json                 # Frontend TS config (noEmit, bundler resolution)
├── postcss.config.mjs            # Empty — Tailwind v4 self-configures via its Vite plugin
├── vercel.json                   # Vercel SPA rewrite rule
├── nginx.conf                    # Nginx config for the Docker self-host path
├── Dockerfile                    # Frontend multi-stage build (Vite build → nginx:alpine)
├── docker-compose.yml            # Local/self-hosted compose: frontend + backend services
├── .env.example                  # Root env vars for Docker Compose (JWT_SECRET, ADMIN_PASSWORD, CORS_ORIGINS, PORT)
├── .mcp.json                     # Configures the Supabase MCP server for Claude Code
├── skills-lock.json              # Locks two Claude Code skills (supabase, supabase-postgres-best-practices)
├── pnpm-workspace.yaml           # Single-package pnpm workspace + build-script allowlist
├── DEPLOYMENT.md                 # Step-by-step Vercel/Render/Supabase deployment guide
├── AUDIT_REPORT.md               # Dated security/quality audit (2026-06-14) — see §11
├── ATTRIBUTIONS.md                # Third-party asset credits
├── README.md                     # Minimal Figma-Make boilerplate readme
├── default_shadcn_theme.css      # Reference-only stock shadcn theme, NOT imported by the live build
├── public/
│   └── logo.png                  # Favicon/logo
├── tests/
│   └── palette-engine.test.js    # Standalone Node script testing PaletteStudio's color engine (see §11 — not wired to any "test" script)
├── src/
│   ├── main.tsx                  # ReactDOM.createRoot entry point, mounts <App/>
│   ├── styles/
│   │   ├── index.css              # Single entry: imports fonts.css → tailwind.css → theme.css → globals.css
│   │   ├── fonts.css              # Empty (0 bytes) — vestigial; fonts actually load via <link> tags in index.html
│   │   ├── tailwind.css           # 4-line Tailwind v4 bootstrap (`@import 'tailwindcss' source(none)`, explicit `@source`, `tw-animate-css`)
│   │   ├── theme.css              # The real design system: CSS custom properties, dark/light tokens, typography scale, button/card primitives
│   │   └── globals.css            # Resets + tldraw z-index override fixes
│   ├── imports/pasted_text/       # Legacy Figma-Make scaffolding (design spec markdown, unused canvas-animation.js/displacement-map.tsx referenced by orphaned components)
│   └── app/
│       ├── App.tsx                 # Root component — just <RouterProvider router={router}/>
│       ├── routes.tsx               # createBrowserRouter route table (see §10)
│       ├── context/
│       │   ├── ThemeContext.tsx     # Light/dark theme provider (attribute-based, localStorage-persisted)
│       │   ├── StudentContext.tsx   # Student session + learning-progress state (localStorage-persisted)
│       │   └── AppDataContext.tsx   # Central data-fetch layer: domains/artworks/events/team + all CRUD mutators
│       ├── lib/
│       │   ├── api.ts               # Typed fetch client for every backend endpoint
│       │   ├── color-engine.ts      # HSL-based color-theory engine — orphaned, unused (superseded by PaletteStudio's own engine)
│       │   ├── halftone-logic.ts    # Canvas halftone-rendering algorithm used by HalftoneStudio
│       │   └── utils.ts             # `cn()` class-merge helper (clsx + tailwind-merge)
│       ├── pages/                   # One file per route (see §10 for the route map)
│       │   ├── HomePage.tsx
│       │   ├── AcademyPage.tsx
│       │   ├── ResourcesPage.tsx
│       │   ├── GalleryPage.tsx
│       │   ├── EventsPage.tsx
│       │   ├── TeamPage.tsx
│       │   ├── PalettePage.tsx
│       │   ├── DesignStudioPage.tsx
│       │   ├── AdminPage.tsx
│       │   ├── MoodboardsPage.tsx
│       │   ├── BoardPage.tsx
│       │   └── TldrawCanvas.tsx     # Not a route — the tldraw wrapper consumed by BoardPage
│       └── components/
│           ├── Root.tsx             # react-router layout route: providers + nav/footer/modals shell
│           ├── Navigation.tsx       # Site-wide top nav pill bar
│           ├── Footer.tsx           # Site-wide footer + "Schedule a Meet" modal
│           ├── RollModal.tsx        # Roll-number login/registration modal
│           ├── WelcomeOverlay.tsx   # First-time-registration onboarding overlay
│           ├── JoinPrompt.tsx       # Guest-conversion nudge (bottom card, 24h cooldown)
│           ├── LiveSessionBanner.tsx# Top banner for active/upcoming live sessions
│           ├── BackToTop.tsx        # Floating scroll-to-top button
│           ├── Hero.tsx             # Homepage hero + PixelTrail cursor effect
│           ├── FeaturedMarquee.tsx  # Homepage infinite CSS marquee of featured artworks
│           ├── Mission.tsx          # Homepage mission statement section
│           ├── Stats.tsx            # Homepage animated stat counters
│           ├── GalleryPreview.tsx   # Homepage shuffled artwork grid preview
│           ├── EventSpotlight.tsx   # Homepage single-event countdown spotlight
│           ├── DesignStudioCard.tsx # Homepage promo card linking into Design Studio tools
│           ├── ResourcesPreview.tsx # Homepage learning-domains preview grid
│           ├── Team.tsx             # Homepage coordinators preview grid
│           ├── PaletteStudio.tsx    # Full OKLCH color-palette generator engine + UI (2000+ lines)
│           ├── HalftoneStudio.tsx   # Image → halftone-pattern converter tool
│           ├── SvgConverter.tsx     # Image → line-art SVG tracer tool
│           ├── ImageCropper.tsx     # Singleton promise-based crop modal (`openCropModal`/`ImageCropperPortal`)
│           ├── InteractiveRobotSpline.tsx # Spline 3D wrapper — orphaned, unused
│           ├── AnimatedBlobs.tsx    # Decorative gradient blobs — orphaned, unused
│           ├── CustomCursor.tsx     # Custom cursor replacement — orphaned, unused
│           ├── Events.tsx           # Legacy sample events grid — orphaned, superseded by EventsPage
│           ├── HeroScroll.tsx       # Scroll-driven 3D tile gallery — orphaned, superseded by FeaturedMarquee
│           ├── figma/ImageWithFallback.tsx # Figma-Make scaffold image fallback — orphaned, unused
│           ├── hooks/
│           │   ├── use-debounced-dimensions.ts # `useDimensions()` — used by ui/pixel-trail.tsx
│           │   └── use-screen-size.ts          # `useScreenSize()` — used by Hero.tsx
│           └── ui/                  # shadcn/Radix primitive kit (accordion, dialog, dropdown-menu, sheet, sidebar, tabs, pixel-trail, etc. — ~45 files)
├── backend/
│   ├── package.json / package-lock.json
│   ├── tsconfig.json
│   ├── Dockerfile                   # Backend multi-stage build (still rebuilds better-sqlite3 — legacy leftover, see §11)
│   ├── .env.example                 # Backend env var template
│   ├── data/dna.db*                 # Leftover SQLite files from a pre-Postgres era (unused by current code)
│   ├── uploads/                     # Local-disk storage fallback (gallery/, team/) when Supabase Storage env vars are absent
│   ├── scripts/
│   │   └── backfill-thumbnails.ts   # One-time maintenance script: generates missing artwork thumbnails
│   └── src/
│       ├── server.ts                # Entry point: env-var guards, initSchema(), admin-password auto-seed, app.listen()
│       ├── app.ts                   # Express app factory: helmet/cors/rate-limit, route mounting, error handler
│       ├── db/
│       │   ├── client.ts            # `pg.Pool` singleton + `query()` helper
│       │   ├── schema.ts            # `initSchema()` — idempotent CREATE/ALTER TABLE migrations + seed data
│       │   └── seed.ts              # Manual one-time dev seed script (`npm run seed`)
│       ├── middleware/
│       │   └── adminAuth.ts         # `requireAdmin` JWT-verification middleware
│       ├── routes/                  # One file per resource — endpoint tables in §14, per-feature logic in §6
│       │   ├── auth.ts              # POST /api/auth/admin/login
│       │   ├── artworks.ts          # /api/artworks — gallery CRUD, likes, comments
│       │   ├── domains.ts           # /api/domains — Academy domains/videos/quizzes CRUD
│       │   ├── events.ts            # /api/events — event CRUD + RSVP
│       │   ├── students.ts          # /api/students — registration, sessions, progress tracking
│       │   ├── team.ts              # /api/team — team member CRUD
│       │   ├── notify.ts            # /api/notify — email templates + broadcast sends
│       │   ├── liveSessions.ts      # /api/live-sessions — Google Meet session scheduling
│       │   ├── boards.ts            # /api/boards — Moodboards CRUD, membership, canvas persistence
│       │   ├── settings.ts          # /api/settings — app_settings key/value store + passcode gate
│       │   └── coordinators.ts      # /api/coordinators — coordinator role management
│       ├── services/
│       │   └── mailer.ts            # Resend email-sending service, templates, batching
│       └── storage/
│           ├── index.ts             # `getStorage()` factory — picks Supabase vs local backend
│           ├── local.ts             # LocalStorageProvider — writes to backend/uploads/
│           └── supabase.ts          # SupabaseStorageProvider — writes to Supabase Storage bucket
```

---

## 4. Complete Features List

### 4.1 Public / all-visitor features

- **Homepage** (`/`) — hero section, infinite featured-artwork marquee, mission statement, animated stat counters, shuffled gallery preview, single-event countdown spotlight, Design Studio promo card, learning-resources preview, coordinators preview.
- **Gallery** (`/gallery`) — masonry grid of all club artwork (images, videos, PDFs), domain filter pills, full-screen artwork viewer with pinch-zoom/pan for images, native video playback, embedded PDF viewer (Google Docs viewer with fallback link), deep-linkable via `?art=<id>` query param.
- **Events** (`/events`) — grid/list toggle, all/upcoming/past filters, capacity progress bars, live countdown timers per event, a separate "Live & Upcoming Sessions" banner section pulling from the live-session system.
- **Team** (`/team`) — full roster grouped into Faculty/Advisors, Coordinators, Secretaries, Design Team, and Ex-Core alumni (grouped by year), expandable bio cards with social links.
- **Design Studio** (`/design-studio`) — a suite of 7 free-standing design tools (see 4.4).
- **Resources** (`/resources`) — a static, hardcoded curated list of external learning resources with search/type/domain filters (not backed by the CMS/admin panel).
- **Site chrome** — floating pill navigation with active-route highlighting and mobile hamburger menu, footer with nav columns and a coordinator-only "Schedule a Meet" modal, dark/light theme toggle, "back to top" button, live-session announcement banner, guest join-prompt nudge.

### 4.2 Student (registered IITK member) features

- **Registration/login** — two-step roll-number + name/email flow (`RollModal`), IITK-email-only validation (`@iitk.ac.in`), roll-number format validation, automatic club member ID generation (`IITK-DnA-{ROLL}-{suffix}`), welcome email on first registration, one-time onboarding overlay (`WelcomeOverlay`) introducing the 5 flagship features.
- **Academy** (`/academy`) — per-domain video playlists (UI/UX, Photoshop, Illustrator, Animation, extensible via admin), YouTube embed player, watched/unwatched toggle per video, per-domain quiz unlocking a "badge," animated XP/progress rings, XP formula (`10 × videos watched + 20 × quizzes completed`).
- **Gallery interactions** — like/unlike artwork (optimistic UI with heart-burst animation), comment on artwork, save any artwork image directly into a personal Moodboard.
- **Events** — RSVP/un-RSVP with live capacity enforcement, live countdown timers.
- **Live Sessions** — see and join Google Meet sessions targeted at "All Students," restricted team-only sessions show as inaccessible; join-clicks are tracked for admin attendance review.
- **Moodboards** (`/moodboards`, `/moodboards/:id`) — create private/shared collaborative canvases (tldraw-based whiteboard), invite other students by roll number, real-time-feeling autosave (debounced snapshot persistence), share-link copying, visibility (private/shared) and edit-mode (members-only/anyone) controls, "Shared Boards" public discovery tab.
- **Coordinator-only:** approved coordinators get a "Schedule a Meet" action in the footer to self-serve create/manage live sessions without full admin access.

### 4.3 Admin features (`/admin`, password-gated dashboard, 9 tabs)

1. **Academy tab** — create/edit/delete learning domains (title, icon, tagline, description, color); add/edit/delete/reorder videos per domain (YouTube URL normalization, difficulty, duration, drag-free numeric sequence editing).
2. **Gallery tab** — single or bulk artwork upload (drag/drop, auto-parses `title_artist.ext` filenames, auto-captures video first-frame as cover, in-browser image compression + cropping before upload), edit/delete/feature-toggle per artwork.
3. **Team tab** — add/edit/delete team members (name, designation, year, bio, color, socials, photo with cropper), drag-and-drop reordering within Coordinator/Secretary/Other groups, "Reset to A–Z" per group.
4. **Events tab** — create/edit/delete events (title, date, time, location, description, capacity); creating an event triggers an email notification to all students.
5. **Comments tab** — moderate (delete) any comment across all artworks, with artwork context shown.
6. **Settings tab** — toggle + set passcode for the public meet-scheduling gate, approve/revoke/add/remove coordinators, toggle a site-wide "force uppercase" text-styling setting.
7. **Announcements tab** — edit the 3 transactional email templates (welcome, new-artwork, new-event) with variable-chip insertion and live preview; compose and broadcast a one-off custom announcement email to all registered students.
8. **Sessions tab** — create/manage live Google Meet sessions (title, host, link, schedule, target audience group), transition status upcoming→live→ended, review past-session attendance (who joined and when).
9. **Moodboards tab** — site-wide moderation view of every student's boards, force-toggle visibility/edit-mode, delete any board, open any board directly.

### 4.4 Design Studio tools (`/design-studio`, 7 tabs, also reachable individually)

1. **Palette Studio** — generates full 18-slot UI color palettes (bg/surface/text/border/primary/secondary/accent/success/warning/error/info, light+dark) from one seed color using an internal OKLCH color-science engine; 5 harmony modes, per-slot locking, WCAG + APCA accessibility scoring, color-blindness simulation (protanopia/deuteranopia/tritanopia), a "Mood" tab mapping colors to psychology/symbolism, CSS custom-property export. Also mounted standalone at `/palette`.
2. **Font Pairing** — 147 curated Google Font display/body pairings across 7 typographic strategies (Contrast, Humanist, Mono Accent, Slab Power, Serif Stack, Display Drama, Grotesque); live preview with adjustable size/custom text, pairing-quality scoring, undo/redo history.
3. **Contrast Checker** — live WCAG contrast-ratio calculation between two colors, AA/AAA pass/fail matrix, auto-generated harmonious replacement-color suggestions when failing.
4. **Image Converter** — client-side image format conversion (PNG/JPEG/WebP), quality and scale sliders, before/after preview, download.
5. **Grid Calculator** — 9 selectable grid systems (Swiss Modular, Column, Baseline, Golden Ratio, Rule of Thirds, Radial, Isometric, Diagonal, Compound) rendered live on an HTML canvas over 9 page-format presets (A4/A3/A5/Letter/Posters/Square/16:9/Custom), adjustable columns/gutters/margins/baseline/angle parameters.
6. **Halftone** — converts an uploaded image into a halftone pattern (lines/dots/squares), adjustable angle, frequency, contrast, brightness, min/max element width, invert, custom colors; PNG export.
7. **Image → SVG** — hand-rolled pixel-scanning tracer converting an image into a line-art (or filled) SVG, adjustable threshold/fill/invert/edge-dilation, SVG download.

---

## 5. Components Breakdown

### 5.1 Layout & shell

**`Root.tsx`** — the react-router layout component mounted at `/`.
- Renders provider stack: `ThemeProvider` → `StudentProvider` → `AppDataProvider`.
- Renders (unless on a `/moodboards/:id` board page): `LiveSessionBanner`, `Navigation`, `<main>` wrapping `<Outlet/>`, `Footer`, `BackToTop`.
- Always renders `RollModal` (self-controls visibility via `StudentContext`) and a local `SessionGate` component that shows `JoinPrompt` only when no student session exists.
- `isBoardPage = pathname.startsWith('/moodboards/') && pathname !== '/moodboards'` — on board pages, renders **only** `<Outlet/>` (full-bleed canvas, no chrome).
- Smooth-scrolls to top on route change (skipped on board pages).

**`Navigation.tsx`** — floating pill nav bar. Links: Home, Academy, Gallery, Events, Team, Design Studio, Moodboards. Shows student name+roll+logout if logged in, else a "Join" button opening `RollModal`. Desktop active-link highlight uses a shared `layoutId="nav-pill"` motion animation. Mobile hamburger menu with outside-click-to-close. Theme toggle (sun/moon). No Admin link here — Admin is only linked from `Footer`.

**`Footer.tsx`** — brand column + Explore/Club link columns + contact/social row. Contains the **"Schedule a Meet"** modal, shown only if `public_meet_enabled` (from `/api/settings/public`) is true, the visitor is logged in, and `/api/coordinators/check/:roll` confirms they're an approved coordinator. The modal posts to `/api/live-sessions/coordinator` and can toggle a session live/ended or delete it.

**`RollModal.tsx`** — two-step login/registration: (1) enter roll number → `checkExists` → if a complete profile exists, silently logs in via `loginExisting`; else (2) collect name + email (validated `@iitk.ac.in`) → `createSession`. First-time registrants see `WelcomeOverlay` afterward.

**`WelcomeOverlay.tsx`** — full-screen 5-feature onboarding card shown once per roll number (`hasSeenWelcome`/`markWelcomeSeen`, localStorage-gated).

**`JoinPrompt.tsx`** — bottom card nudging guests to register, appears after a 1.5s delay if not dismissed in the last 24h (`shouldShowJoinPrompt`/`markGuestDismissed`).

**`LiveSessionBanner.tsx`** — fixed top banner for the current live/next-upcoming session; polls `/api/live-sessions/active` every 60s and join-count every 30s while live; access-gates the "Join Meet" link based on `canAccess`.

**`BackToTop.tsx`** — appears after 300px scroll, smooth-scrolls to top.

### 5.2 Homepage sections

`Hero`, `FeaturedMarquee`, `Mission`, `Stats`, `GalleryPreview`, `EventSpotlight`, `DesignStudioCard`, `ResourcesPreview`, `Team` — each a self-contained section composed in order by `HomePage.tsx`. Notable internals:
- **`Hero.tsx`** hosts a cursor-reactive `PixelTrail` background grid (from `ui/pixel-trail.tsx`) and CTA buttons that branch on login state.
- **`FeaturedMarquee.tsx`** shows only artworks flagged `featured` by an admin; runs a pure-CSS infinite scroll (pauses on hover).
- **`GalleryPreview.tsx`** shows a viewport-responsive count of non-featured artworks, shuffled (Fisher–Yates) on each mount.
- **`EventSpotlight.tsx`** and **`Team.tsx`** (homepage version, coordinators-only) are separate from the full `EventsPage`/`TeamPage`.
- **`DesignStudioCard.tsx`** deep-links into `/design-studio` with `{ state: { tab } }` to preselect a tool tab.

### 5.3 Design Studio tools

**`PaletteStudio.tsx`** (also used standalone at `/palette` via `PalettePage.tsx`) is the largest single file in the codebase (~2000 lines, `// @ts-nocheck`). It implements its own OKLCH color engine (hex↔RGB↔OKLCH, WCAG + APCA contrast, CIEDE2000 delta-E, color-blindness simulation matrices) independent of `lib/color-engine.ts` — see §6.5 for the algorithm.

**`HalftoneStudio.tsx`** + **`lib/halftone-logic.ts`** — canvas-based halftone renderer; UI in the component, pixel math in the lib (see §6.6).

**`SvgConverter.tsx`** — self-contained; no shared lib, does its own pixel-edge-detection scan (see §6.6).

**`ImageCropper.tsx`** — a singleton "portal" pattern: `openCropModal(file, type)` returns a Promise from anywhere in the app; `ImageCropperPortal()` is mounted once (in `AdminPage.tsx`) to actually render the crop UI (`react-image-crop`).

**`DesignStudioPage.tsx`** (default export `DesignStudio`) is the shell hosting all 7 tools: a `TOOLS` registry array (`palette`, `font`, `contrast`, `image`, `grid`, `halftone`, `svg`) drives a sticky tab bar; the active tab is initialized from `location.state?.tab` (set by `DesignStudioCard`'s deep links) and defaults to `'palette'`. Three of the tools — `FontPairing`, `ContrastChecker`, `ImageConverter`, and `GridCalculator` — are defined locally inside this file (not separate component files):
- `FontPairing` — holds a 147-entry hardcoded `PAIR_DB` of Google Font pairs; dynamically injects a Google Fonts `<link>` for whichever pair is active; tracks `history`/`histIdx` for undo/redo across regenerate/strategy-switch actions; computes a 3-metric pairing score (category, x-height match, weight delta).
- `ContrastChecker` — hand-rolled hex↔RGB↔HSL↔luminance math; `generateSuggestions()` searches lightness/hue space (in 2-3° / 2-4% steps) for the nearest color meeting a target WCAG ratio via 5 strategies (adjusted lightness up/down, complementary, analogous ±30°/±60°, triadic, plus pure black/white fallbacks).
- `ImageConverter` — loads a file into an `<img>`, redraws it to an off-screen `<canvas>` at a chosen `scale`, and calls `canvas.toBlob()` with the chosen MIME type (`image/png|jpeg|webp`) and quality.
- `GridCalculator` — `drawGrid()` is a single large canvas-drawing function with a branch per grid system (`swiss`, `column`, `baseline`, `golden`, `thirds`, `radial`, `isometric`, `diagonal`, `compound`), each with hand-tuned geometry (e.g. the golden-ratio branch recursively subdivides by `φ=1.618` and draws the classic spiral arc; the isometric branch draws 30°-angled line families plus a 3-face cube illustration).

### 5.4 Gallery/Events/Team/Academy page-local components

These are defined **inside** their page files (not separately exported), documented in §6:
- `GalleryPage.tsx`: `LikeBurst`, `ZoomImage`, `MediaViewer`, `ArtworkModal`, `MediaThumbnail`.
- `EventsPage.tsx`: `EventCard`, `CountUnit`, `useCountdown` hook.
- `TeamPage.tsx`: `MemberCard`.
- `AcademyPage.tsx`: `ProgressRing`, `QuizCard`.
- `MoodboardsPage.tsx`: `BoardCard`.
- `AdminPage.tsx`: `AdminLogin`, `Modal`, and one component per tab (`AcademyTab`, `GalleryTab`, `TeamTab`, `EventsTab`, `CommentsTab`, `SettingsTab`, `AnnouncementsTab` with `TemplateEditor`/`CustomAnnouncement`, `SessionsTab`, `MoodboardsAdminTab`).

### 5.5 Moodboards / canvas

**`MoodboardsPage.tsx`** — "My Boards" / "Shared Boards" tabs, board creation, sessionStorage cache-then-revalidate (5-min TTL, `readCache`/`writeCache`/`clearBoardsCache` — the last is also imported by `BoardPage.tsx`), share/invite/delete modals.

**`BoardPage.tsx`** — full-screen board editor shell: loads board metadata + saved canvas snapshot, computes `isOwner`/`isMember`/read-only status, renders `TldrawCanvas` (lazy-loaded), theme-syncs it to the site theme, shows a save-status indicator, member avatar stack, share/invite/delete modals, and a 10-minute keepalive ping to `/api/health` to prevent backend cold-start sleep.

**`TldrawCanvas.tsx`** — thin wrapper around the `tldraw` library: loads an initial snapshot once, debounce-saves (3s) on every store change, force-saves immediately on tab-hide/window-close/offline to avoid losing edits, dedupes identical saves.

### 5.6 Orphaned / dead components (confirmed via repo-wide import search — zero importers)

These exist in the tree but are not reachable from any route or rendered component. Documented here for completeness/cleanup awareness, not as active features:

- `AnimatedBlobs.tsx` — decorative gradient blobs.
- `CustomCursor.tsx` — custom mouse cursor replacement.
- `Events.tsx` — legacy sample events grid (superseded by `pages/EventsPage.tsx`), also depends on a stray legacy import path.
- `HeroScroll.tsx` — scroll-driven 3D tile gallery (superseded by `FeaturedMarquee.tsx` on the homepage).
- `InteractiveRobotSpline.tsx` — Spline 3D scene wrapper.
- `figma/ImageWithFallback.tsx` — Figma-Make scaffold boilerplate.
- `lib/color-engine.ts` — HSL color-theory engine, superseded by `PaletteStudio.tsx`'s own OKLCH engine.

---

## 6. Full Code Logic Reference

### 6.1 Roll-number login & registration (`RollModal.tsx` + `backend/src/routes/students.ts`)

1. User opens `RollModal` (triggered from `Navigation`, `Hero`, `JoinPrompt`, or any gated action across the site calling `openRollModal()` from `StudentContext`).
2. **Step "roll":** user types a roll number → `handleRollContinue()` calls `GET /api/students/:roll/exists`.
   - If `exists && hasProfile` → `handleSubmitRoll()` calls `POST /api/students/sessions/login` (looks up `student_sessions` where `email`/`name` are both non-null) → `login(...)` from `StudentContext` → modal closes.
   - Otherwise → advances to step "profile".
3. **Step "profile":** user enters name + email. Email must end in `@iitk.ac.in` (client-side check, plus a server-side zod `.refine()`). `handleFullSubmit()` calls `POST /api/students/sessions`.
   - Backend validates via `sessionSchema` (roll regex `^[0-9]{2}[a-zA-Z0-9]{4,6}$/i`, name 2-100 chars, IITK-only email).
   - New roll number → generates `uniqueId = IITK-DnA-{ROLL}-{4-char-uuid-suffix}`, inserts with `ON CONFLICT (roll_number) DO UPDATE` (race-safe), fires `sendWelcomeEmail()` fire-and-forget.
   - Existing roll number → reuses `uniqueId`, updates name/email.
   - Returns `{session, progress}`.
4. On success, if `!hasSeenWelcome(roll)`, shows `WelcomeOverlay` before closing; the overlay's "Explore" button navigates to `/gallery`.
5. `StudentContext.login()` persists `{rollNumber, uniqueId, registeredAt, name, email}` to `localStorage['iitk_dna_student_session']`. All subsequent gated calls (`likeArtwork`, `rsvpEvent`, video/quiz progress, board creation) send this roll number via the `X-Roll-Number` header — there is **no password/OTP verification of the roll number itself**, it is trusted as claimed (see §11).

### 6.2 Academy — video watching & quiz completion (`AcademyPage.tsx` + `StudentContext.tsx` + `backend/src/routes/students.ts` + `domains.ts`)

1. `AppDataContext` fetches `GET /api/domains` on mount → returns a keyed object of domains, each with `videos[]` (sorted by `sequence`) and `quizzes[]` (options pre-parsed, **including the correct answer index** — no server-side answer-hiding).
2. User selects a domain (`activeDomainId`) and a video (`activeVideoId`); the video plays via a YouTube iframe embed.
3. Clicking "Watch"/"Watched" calls `handleWatchToggle` → if no session, `openRollModal()`; else `markVideoWatched`/`unmarkVideoWatched` from `StudentContext`, which optimistically updates local state, persists to `localStorage['iitk_dna_student_progress']`, and fires `POST`/`DELETE /api/students/:roll/progress/videos/:videoId`.
4. Backend's `ownerGuard` ensures the `X-Roll-Number` header matches the `:roll` URL param (403 otherwise) before writing to `student_watched_videos`.
5. **Quiz flow (`QuizCard`):** sequential MCQs; correct answer on the last question calls `completeQuiz(domainId)` → same optimistic-update + `POST /api/students/:roll/progress/quizzes/:domainId` pattern → `student_completed_quizzes` row inserted (`ON CONFLICT DO NOTHING`). Once completed, the quiz permanently shows a "badge unlocked" state (`studentProgress.completedQuizzes.includes(domainId)`).
6. **XP** is computed client-side only, in `StudentContext`: `totalXP = watchedVideos.length * 10 + completedQuizzes.length * 20`. Displayed via an animated `ProgressRing` (SVG `strokeDashoffset` driven by `motion.circle`).

### 6.3 Gallery — like, comment, save-to-moodboard (`GalleryPage.tsx` + `AppDataContext.tsx` + `backend/src/routes/artworks.ts`)

1. `AppDataContext` fetches `GET /api/artworks` (optionally sending `X-Roll-Number` to compute `likedByUser` per item) on mount and whenever the logged-in roll number changes.
2. **Like:** `likeArtwork(id)` optimistically flips `likes`/`likedByUser` in local state, then `POST /api/artworks/:id/like` (requires `X-Roll-Number`, rate-limited 30/min/IP). Backend runs an explicit transaction: if a like row exists, deletes it and decrements (floored at 0); else inserts and increments. On request failure, the optimistic update is rolled back. A `LikeBurst` particle animation plays on first-like only.
3. **Comment:** `addComment(artworkId, sender, text)` calls `POST /api/artworks/:id/comments` (rate-limited 10/min/IP, zod-validated 1-1000 chars) — gated behind an active student session.
4. **Save to Moodboard:** clicking the "◈" button (visible only if logged in) opens a board picker that lazy-loads `api.boards.getMyBoards(roll)` once, then `api.boards.addItem(boardId, roll, {image_url, note, source_url})` on selection.
5. **Deep linking:** `?art=<id>` in the URL (via `useSearchParams`) opens `ArtworkModal` for that artwork on load; invalid/missing ids strip the param. Effect runs once per artworks-load (`didDeepLink` ref guard).
6. **Media rendering (`MediaViewer`):** images get pinch-zoom-drag (`ZoomImage`, manual scale/pos state + pointer drag math); videos render as native `<video>`; PDFs render via a Google Docs viewer iframe with a manual "Open PDF" fallback link if the iframe errors.
7. **Admin CRUD** (see §6.4) feeds this same list — `AppDataContext`'s `uploadArtwork`/`updateArtwork`/`deleteArtwork`/`toggleFeatured` all mutate the shared `artworks` array so Gallery and homepage previews update immediately without a refetch.

### 6.4 Admin artwork upload pipeline (`AdminPage.tsx` `GalleryTab` + `backend/src/routes/artworks.ts`)

1. Admin selects one file (or multiple → auto-switches to **bulk mode**, `bulkQueue`).
2. Client-side validation: extension whitelist (`jpg,jpeg,png,webp,gif,pdf,mp4`), 50MB size cap (`MAX_MB`).
3. **Image files** are routed through `openCropModal(file, 'artwork')` (free-form crop with 3:4/1:1/4:5/2:3 presets) before compression.
4. All images pass through `compressImage()` (`browser-image-compression`, max 0.5MB / 1920px, web-worker) — the result is explicitly re-wrapped as a real `File` object (the compression library's returned Blob has a mangled `.name`, which would otherwise cause the backend to reject the upload as `filename="blob"`).
5. **Video files** auto-capture a cover thumbnail via `captureVideoFirstFrame()` (seeks an off-DOM `<video>` to 0.1s, draws to canvas, exports JPEG @0.9 quality); admins can override via "Change cover" → also routed through the cropper.
6. `title`/`artist` auto-fill from `parseFilename()` (`title_artist.ext` convention, artist hyphens→spaces).
7. Submits `multipart/form-data` to `POST /api/artworks` (admin JWT required). Backend:
   - Validates extension against `ALLOWED_EXT` (magic-byte sniffing is defined but only actually invoked for the optional `cover` field on the **update** path, not the primary upload path — see §11).
   - Uploads to `gallery/{uuid}.{ext}` via the active `StorageProvider`.
   - If the media type is `image`, generates a 400px WebP thumbnail via `sharp` → `thumbs/{uuid}.webp` → sets `cover_url`.
   - If video/pdf and a `cover` file was sent, uploads it to `covers/{uuid}.jpg`.
   - Inserts the `artworks` row (`id = art-{uuid8}`); on DB failure, best-effort deletes the just-uploaded file.
8. Response is prepended to `AppDataContext`'s local `artworks` array, and `api.notify.artwork({title, artist, domain})` fires (fire-and-forget) → `POST /api/notify/artwork` → `sendArtworkNotification()` broadcasts an email to every student with a saved email address, in batches of 50 via BCC.
9. **Bulk mode** repeats steps 3-8 sequentially per queued item via "Publish All," tracking each item's status (`pending→capturing→uploading→done/error`).

### 6.5 Palette Studio color engine (`components/PaletteStudio.tsx`)

Entirely self-contained OKLCH-based color science (no external color library):

1. **Conversion pipeline:** hex → sRGB → linear RGB → OKLCH (`rgbToOKLCH`), and back (`oklchToRgbRaw` → `oklchToHex`), with a binary-search `gamutMap()` that reduces chroma until the color fits back in sRGB gamut.
2. **`derivePalette(seedHex, darkMode, harmonyKey, lockedColors)`** — the core generator:
   - Picks a random, non-repeating strategy from a 10-entry `STRATEGY_POOL` (hue offsets + chroma scaling factors, informed by an internal comment referencing an analysis of 1149 real Figma palettes — median hue shift 57°, average chroma 0.092).
   - Derives secondary/accent hues with a fixed harmony offset (from `HARMONY_MODES`: complementary 180°, analogous 30°, triadic 120°, split-complementary 150°, tetradic 90°) plus ±16° random jitter.
   - For text/border tokens, runs `findAccessibleLightness()`/`nudgeLightnessForContrast()` — binary-searches the OKLCH lightness channel until the WCAG contrast ratio against the generated background meets a target (default 4.5:1).
   - Any slot present in `lockedColors` is preserved byte-identical across regenerations (verified by `tests/palette-engine.test.js`).
3. **Scoring (`scorePalette`)** — aggregates WCAG pass/fail across all text/bg, primary/bg, primaryFg/primary, textMuted/bg pairs into a 0-100 score.
4. **Color-blindness (`analyzeCB`/`simulateCB`)** — applies fixed 3×3 transform matrices per deficiency type (protanopia/deuteranopia/tritanopia) to every palette color, then recomputes contrast ratios against the simulated backgrounds.
5. **Mood tab (`deriveVisualPalette`, `getSeedSymbolism`)** — a separate, non-UI-token palette generator plus a hardcoded hue/lightness/chroma → color-psychology lookup (label, emoji, keywords, mood, use-case) for ~11 color families.
6. **Export** — `exportCSS()` serializes the current 18-slot palette into `:root { --color-x: ...; }` CSS and copies it to the clipboard.

### 6.6 Halftone & SVG converters (client-side canvas algorithms)

**Halftone (`lib/halftone-logic.ts` → `processHalftone()`):**
1. Downscales the source image to a max working dimension (700px) and caches its `ImageData` to avoid re-decoding on every settings tweak (debounced via `requestAnimationFrame`).
2. Rotates the canvas context by the chosen `angle` so scanning can happen in axis-aligned rotated space.
3. `getBrightness(x,y)` samples the rotated coordinate, computes luminance, applies contrast/brightness adjustment.
4. For `type: 'lines'` — scans horizontal bands `frequency` px apart, draws a variable-height filled rectangle per band sized by sampled brightness (`getWidth()` maps brightness into `[minWidth, maxWidth]`).
5. For `type: 'dots'`/`'squares'` — scans a `frequency`-spaced grid, draws a circle or square per cell sized by brightness.
6. Renders live to a `<canvas>`; "Download" exports via `canvas.toDataURL('image/png')`.

**Image → SVG (`SvgConverter.tsx`, self-contained, no shared lib):**
1. Draws the source image to an offscreen canvas (max 1000px longest edge).
2. Computes per-pixel grayscale, thresholds into dark/light per the `threshold` slider (and `useInvert`).
3. Unless `useFill` is on, keeps only **edge pixels** (a dark pixel adjacent to a non-dark 4-neighbor) — producing a line drawing rather than a silhouette.
4. If `useDilate` is on, thickens kept edge pixels by adding their 3×3 neighborhood to the output set.
5. Emits one `<rect width="1" height="1"/>` per surviving pixel inside a single `<svg>` string; warns if pixel/rect count exceeds 40,000 (may be slow to open).

### 6.7 Live Sessions & the two "weak token" gates

There are **three** ways a live Google Meet session can be created, each with different auth:

1. **Admin** — `POST /api/live-sessions` behind `requireAdmin` (JWT).
2. **Approved coordinator** — `POST /api/live-sessions/coordinator` behind `requireCoordinator` (checks `audience_group_members` for `group_id='coordinators' AND approved=true` for the caller's roll number).
3. **Public-token flow** — `POST /api/live-sessions/public`, gated by `verifyPublicMeetToken()`. This token is minted by `POST /api/settings/verify-passcode` after checking a shared passcode (`app_settings.public_meet_passcode`, default `DNA2025`) — but the token itself is just **base64-encoded JSON** (`{type:'public_meet', exp}`), not cryptographically signed. This means anyone who understands the format could construct a valid-looking token without ever knowing the passcode (flagged in §11).
   - Public/coordinator-created sessions can only be **deleted** within 24 hours of creation (`created_at >= cutoff`), limiting blast radius.

`GET /api/live-sessions/active` is public and filters each session's visibility: if a session targets a specific non-`all_students` audience group and the requester isn't a member, `meet_link` is nulled out in the response (the session is visible as existing, but not joinable) — surfaced in the UI as "Team only."

### 6.8 Moodboards — canvas persistence (`BoardPage.tsx` + `TldrawCanvas.tsx` + `backend/src/routes/boards.ts`)

1. `BoardPage` loads board metadata (`GET /api/boards/:id`) and, once, the saved canvas JSON (`GET /api/boards/:id/canvas`) — access is gated: private boards require `X-Roll-Number` + membership; shared boards' canvas is fully public.
2. `TldrawCanvas` loads the snapshot into the tldraw store once (`loadSnapshot`), then `editor.store.listen()` triggers `handleChange()` on every edit, which debounces `handleSave()` by 3000ms.
3. `handleSave()` serializes the store (`getSnapshot`), skips the network call if the serialized string is identical to the last save (dedupe), and calls the `onSave` prop.
4. `BoardPage.handleSave(snapshot)` → `PUT /api/boards/:id/canvas` (requires `X-Roll-Number` + `isMember`) → server validates the body is parseable JSON, then stores it verbatim as TEXT.
5. Safety nets: `visibilitychange`/`beforeunload`/`offline` listeners force an immediate (non-debounced) save to avoid losing edits when a tab is hidden, the window closes, or the network drops.
6. **Permission model:** `isOwner = board.owner_roll === me`; `isMember = isOwner || board.members.includes(me)`; the canvas is rendered `readOnly` when `!isMember && board.edit_mode === 'members_only'` (i.e. non-members can only edit boards explicitly set to `edit_mode: 'anyone'`).
7. Inviting requires the invitee to already have a `student_sessions` row (backend 404s with "must register first" otherwise, surfaced as a friendly UI error).

### 6.9 Admin authentication

1. `POST /api/auth/admin/login` (rate-limited 10/15min/IP) — zod-validates a non-empty password, `bcrypt.compare()`s against the single hash stored in `admin_config.admin_password_hash`, and on success signs a JWT (`{role:'admin'}`, HS256, 8h expiry) with `JWT_SECRET`.
2. The password hash is seeded **once**, on first server boot (`server.ts`), from the `ADMIN_PASSWORD` env var — changing the env var afterward has no effect unless the DB row is manually cleared.
3. The token is stored client-side in `sessionStorage` (`dna_admin_token`) and attached as `Authorization: Bearer <token>` on every admin-scoped `api.ts` call (`{admin: true}` option).
4. Every admin-mutating route is protected by `requireAdmin` middleware (`middleware/adminAuth.ts`), which just verifies the JWT signature/expiry — it does not check any additional claim.
5. On a 401 from an admin call, `api.ts`'s `request()` clears the token and throws `'SESSION_EXPIRED'`; `AppDataContext.onAdminErr()` catches this and redirects the browser to `/admin`, forcing re-login.
6. **The `/admin` route itself has no server-side gate** — `AdminPage.tsx` is a normal client-rendered route; the real security boundary is that all its mutating API calls require a valid JWT. An unauthenticated visitor can load the page shell (and see the login form) but cannot read or write any protected data.

---

## 7. Styling Approach

**Method:** Tailwind CSS v4 (CSS-first configuration — there is **no** `tailwind.config.js`/`.ts` file). Tailwind is wired in two places:

- `vite.config.ts` includes the `@tailwindcss/vite` plugin (v4's native Vite integration, replacing the old PostCSS-plugin approach).
- `src/styles/tailwind.css` is a 4-line bootstrap: `@import 'tailwindcss' source(none)` (disables Tailwind's automatic content scanning) + an explicit `@source '../**/*.{js,ts,jsx,tsx}'` glob + `@import 'tw-animate-css'` (animation utilities, the v4-era replacement for `tailwindcss-animate`).

**Design tokens live in `src/styles/theme.css`**, not in a Tailwind config — a custom "Framer Design System" of CSS custom properties:

| Token | Dark (default) | Light (`[data-theme="light"]`) |
|---|---|---|
| `--color-ink` | `#ffffff` | `#111110` |
| `--color-ink-muted` | `#999999` | `#555550` |
| `--color-canvas` | `#111110` | `#ffffff` |
| `--color-surface-1` | `#1c1c1a` | `#f5f5f5` |
| `--color-surface-2` | `#252523` | `#ebebeb` |
| `--color-hairline` | `rgba(255,255,255,.10)` | `rgba(0,0,0,.10)` |
| `--color-brand` | `#E91E8C` (unchanged both themes) | |
| `--color-accent-blue` | `#0099ff` | |
| `--color-success` / `--color-error` | `#22c55e` / `#ef4444` (unchanged) | |

Plus a gradient-spotlight set (`--gradient-violet/magenta/orange/coral`), a radius scale (`--radius-xs:4px` → `--radius-xxl:30px`, `--radius-pill:100px`), a 5px-base spacing scale, and shadow tokens.

**Fonts:**
```css
--font-display: 'Mona Sans', 'Inter', system-ui, sans-serif;
--font-body:    'Inter Variable', 'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', 'Fira Code', monospace;
```
Loaded via `<link>` tags to Google Fonts in `index.html` (Mona Sans, Inter, JetBrains Mono) plus Font Awesome 6.4.0 from cdnjs (used for Academy domain icons). **`src/styles/fonts.css` is empty/vestigial** — not the actual font source, despite being part of the import chain.

**Tailwind ↔ token bridge:** a `@theme inline { ... }` block in `theme.css` maps `--color-background`, `--color-foreground`, `--color-primary`, etc. (shadcn-style legacy names) onto the custom tokens above, so utility classes like `bg-background`/`rounded-lg` resolve correctly. `default_shadcn_theme.css` at the repo root is a **reference-only** copy of the stock shadcn OKLCH theme — it is not imported anywhere in the live build (the project diverged from it into the current hex/rgba, attribute-based system).

**Dark/light mode mechanism:** attribute-based (`document.documentElement.setAttribute('data-theme', theme)`), **not** class-based and **not** using the installed-but-unused `next-themes` package. Implemented by hand in `ThemeContext.tsx` (see §9), with an inline `<script>` in `index.html` running before React hydrates to set `data-theme` and a matching background color immediately (prevents a flash of the wrong theme).

**Utility layer** (also in `theme.css`): a full typographic scale (`.type-display-xxl` → `.type-micro`), button primitives (`.btn-primary`, `.btn-secondary`, `.btn-translucent`, `.btn-icon`), card/spotlight primitives, `.glass`/`.glass-strong`/`.gradient-text` legacy classes, an `.eyebrow` pill, fade-in/fade-up utility animations, a `.page-container` (max-width 1440px, responsive padding, tighter on `≤768px`), and thin custom scrollbar styling.

**`src/styles/globals.css`** — resets (`html, body, #root` full-size), a `spin` keyframe, and `!important` z-index overrides specifically to make the `tldraw` library's toolbar/popover/menu UI render above the site's own navigation bar.

**Responsive approach:** plain Tailwind breakpoints (`sm/md/lg/xl/2xl`) plus a custom `useScreenSize()` hook (`hooks/use-screen-size.ts`) for JS-side breakpoint logic (e.g. `Hero.tsx` sizing its `PixelTrail` grid), and manual `window.resize` listeners in a few places (`GalleryPreview`, `TeamPage`) for responsive column counts.

---

## 8. Animations

**Primary library:** `motion` v12 (the standalone successor to Framer Motion), imported everywhere as `from 'motion/react'`.

| Component | Technique |
|---|---|
| `Navigation.tsx` | Shared-layout animation (`motion.span layoutId="nav-pill"`) so the active-link highlight visually slides between nav items on route change (spring: stiffness 400, damping 38). Mobile menu icon cross-fades `Menu ⇄ X` via `AnimatePresence mode="wait"`. |
| `Hero.tsx` + `ui/pixel-trail.tsx` | A grid of `motion.div` "pixels" sized to the container (`useDimensions`); each pixel attaches an imperative `__animatePixel` function directly to its DOM node (an escape hatch letting `Hero`'s own `onMouseMove` — needed because the trail layer is `pointer-events:none` — trigger a specific pixel's flash-then-fade `opacity:[1,0]` animation by ID lookup). |
| `FeaturedMarquee.tsx` | Pure CSS `@keyframes marquee { 0%{translateX(0)} 100%{translateX(-50%)} }` injected via a `<style>` tag at mount; the artwork list is duplicated once so a `-50%` loop is seamless; paused on hover via `animationPlayState`. |
| `HeroScroll.tsx` (orphaned) | `useScroll` + `useSpring` (stiffness 100, damping 30) smooths raw scroll progress; `useTransform` maps it to `rotateX: [20,0]`, `scale`, `y` for a 3D card-flattening effect as it scrolls into view. |
| `Stats.tsx` | `useSpring(0, {duration:1800})` + `useTransform(v => Math.floor(v))` for animated count-up numbers, triggered by a manual `IntersectionObserver` (not `whileInView`). |
| `Mission.tsx` | Also uses a manual `IntersectionObserver` (threshold 0.25) rather than `whileInView`, driving staggered `motion` fade-ins. |
| `AcademyPage.tsx` `ProgressRing` | `motion.circle` animates `strokeDashoffset` over 1.4s ease-out for the XP/completion rings. |
| `GalleryPage.tsx` `LikeBurst` | 8 particles radiate outward via `Math.cos/sin(angle)` position math, fading opacity/scale to 0 over 0.45s, triggered only on first-like. |
| `GalleryPage.tsx` masonry grid | `motion.div layout` for automatic re-flow animation when the domain filter changes; `AnimatePresence` for modal enter/exit with different transitions for the mobile bottom-sheet vs. desktop centered-card layouts. |
| `EventsPage.tsx` | `AnimatePresence mode="popLayout"` + `layout` for grid/list re-arrangement; a live pulsing dot (`animate-pulse` Tailwind class) for "live" events; capacity bars animate width. |
| `TeamPage.tsx` `MemberCard` | Bio panel expand/collapse animates `height`/`opacity`; cards fade up on `whileInView` (`viewport once:true`). |
| `CustomCursor.tsx` (orphaned) | Two `motion.div` layers (dot + trailing ring) driven by spring physics (`damping/stiffness/mass` tuned differently per layer so the ring visibly lags the dot), `mix-blend-difference` for a color-inverting look. |
| `RollModal.tsx` | Step transitions slide horizontally inside `AnimatePresence mode="wait"`; error states trigger a horizontal shake keyframe (`x:[-10,10,-8,8,0]`). |
| `LiveSessionBanner.tsx` | The "live" indicator layers a pulsing dot (`animate={{scale:[1,1.6,1], opacity:[1,0,1]}}`, infinite loop, 1.8s) behind a static dot. |
| `AdminPage.tsx` | Login-failure shake (same pattern as `RollModal`); tab switches cross-fade via `AnimatePresence mode="wait"`; the "New Domain" form expands via animated `height: 0 → auto`. |

**Non-`motion` animation:** the Halftone/SVG/Grid Calculator/Contrast-checker tools all render via imperative `<canvas>` drawing (no animation library — see §6.6 for the algorithms); tldraw manages its own internal canvas rendering/animation for the Moodboards feature.

---

## 9. Data & State Management

**No global state-management library** (no Redux/Zustand/Jotai) — the app uses plain React Context + component-local `useState`, split into three layered providers (all wired in `Root.tsx`):

1. **`ThemeContext.tsx`** — `{theme, toggle}`. Single `useState<'light'|'dark'>`, default `'dark'`, read/written to `localStorage['dna-theme']` (both operations wrapped in try/catch to survive Firefox Private Browsing's `localStorage` throw), applied via `document.documentElement.setAttribute('data-theme', theme)` in a `useLayoutEffect`.

2. **`StudentContext.tsx`** — `{studentSession, studentProgress, isRollModalOpen, login, logout, openRollModal, closeRollModal, markVideoWatched, unmarkVideoWatched, completeQuiz, totalXP}`. Both `studentSession` and `studentProgress` are initialized from and persisted to `localStorage` (`iitk_dna_student_session` / `iitk_dna_student_progress`). Progress-mutating actions optimistically update local state immediately, persist to `localStorage`, and fire a background API call (errors just logged, not rolled back — client state is the source of truth here, unlike `AppDataContext`'s optimistic-with-rollback pattern).

3. **`AppDataContext.tsx`** — the central server-data cache: `{domains, artworks, events, team, loading, error}` plus ~20 mutator callbacks. On mount (and whenever the logged-in roll number changes), fetches all four resources in parallel (`Promise.all([domains.list(), artworks.list(roll), events.list(roll), team.list()])`). Every mutator follows one of two patterns:
   - **Optimistic-with-rollback** (`likeArtwork`, `rsvpEvent`, `toggleFeatured`) — updates local state immediately, calls the API, and reverts on failure.
   - **Await-then-merge** (`uploadArtwork`, `updateEvent`, `addDomain`, etc.) — calls the API first, then merges the confirmed server response into local state.
   - A shared `onAdminErr()` helper catches the special `'SESSION_EXPIRED'` error thrown by `api.ts` and redirects to `/admin`.

**Data NOT in these contexts** (fetched directly via `api.ts` inside the pages/components that need them, since they're either admin-only, session-scoped, or too infrequently used to justify a global cache): `boards` (Moodboards), `liveSessions`, `settings`, `coordinators`. This is a deliberate scoping choice, not an oversight — these resources are only read by 1-3 specific components each.

**`ResourcesPage.tsx`** is the one page with **fully static, hardcoded data** (a local `Resource[]` array) — it is not connected to the backend/admin panel at all.

**Client-side caches outside React state:**
- `MoodboardsPage.tsx` uses `sessionStorage` as a 5-minute stale-while-revalidate cache for board lists (`readCache`/`writeCache`/`clearBoardsCache`).
- `GalleryTab` (admin) and `GalleryPage`/`GalleryPreview` share a cross-tab-synced `localStorage['forceUppercase']` flag (toggled in `SettingsTab`, propagated via a manually-dispatched `storage` event so already-open tabs update without a reload).
- `api.ts` stores the admin JWT in `sessionStorage['dna_admin_token']` (cleared automatically on any 401 from an admin-scoped call).

**Backend data flow:** Express routes → `pg.Pool` (single shared connection pool, `backend/src/db/client.ts`) → Postgres (Supabase-hosted). File uploads go through a small `StorageProvider` abstraction (`backend/src/storage/index.ts`) that picks Supabase Storage or local disk based on whether `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` are both set. No ORM — all queries are hand-written parameterized SQL via `pg`.

---

## 10. Routing

**Library:** `react-router` v7, data-router style (`createBrowserRouter`), defined entirely in `src/app/routes.tsx`:

```
/                       → Root (layout: providers + nav/footer/modals)
├── (index)             → HomePage
├── academy             → AcademyPage
├── resources           → ResourcesPage
├── gallery             → GalleryPage
├── events              → EventsPage
├── team                → TeamPage
├── palette             → PalettePage        (standalone Palette Studio; marked PALETTE_STUDIO_FEATURE — removable)
├── design-studio       → DesignStudioPage (default export `DesignStudio`)
├── admin               → AdminPage
├── moodboards          → MoodboardsPage
└── moodboards/:id      → BoardPage
```

All routes are children of the single `Root` layout route — there is no route-level code-splitting/lazy-loading of pages (only `TldrawCanvas` inside `BoardPage` is `React.lazy`-loaded).

**Navigation entry points:**
- `Navigation.tsx`'s `NAV_LINKS`: Home, Academy, Gallery, Events, Team, Design Studio, Moodboards (Palette is not separately linked — it's reachable via `DesignStudioCard`'s tab-state deep link and directly by URL).
- `Footer.tsx`'s "Club" column additionally links to `/admin` (the only nav-level link to the admin panel) and `/` ("About DnA"), `/events` ("Join Us").
- `DesignStudioCard.tsx` (homepage) links into `/design-studio` with React Router's `state: { tab }` to preselect one of the 7 tool tabs.
- `WelcomeOverlay.tsx`'s "Explore" button navigates to `/gallery`.
- `GalleryPage.tsx` syncs the open artwork modal into the URL via `?art=<id>` (using `useSearchParams`, not a nested route) for shareable deep links.

**Vercel routing:** `vercel.json` rewrites every path to `/index.html`, so client-side routing owns all navigation in production (no server-side route handling beyond static asset serving).

---

## 11. Known Issues / TODOs

No `TODO`/`FIXME`/`HACK`/`XXX` comments exist anywhere in `src/` or `backend/src/` (confirmed by repo-wide search) — the project doesn't use inline TODO markers. The items below come from direct code inspection and the repo's own `AUDIT_REPORT.md` (dated 2026-06-14), cross-checked against the current code:

**Already fixed since the audit** (kept here only so the audit document doesn't mislead a future reader):
- ✅ `index.html`'s inline FOUC-prevention theme script and `ThemeContext.tsx`'s `localStorage` calls are now wrapped in try/catch (Firefox Private Browsing safe).
- ✅ Rate limiting now exists on `/api/artworks/:id/like` (30/min), `/api/artworks/:id/comments` (10/min), and `/api/events/:id/rsvp` (20/min).
- ✅ `backend/src/db/seed.ts` now throws if `ADMIN_PASSWORD` is unset, instead of silently falling back to a weak default.

**Still open:**
- **No server-side route guard on `/admin`** — the page shell is publicly loadable; the only real protection is that every mutating API call requires a valid admin JWT. This is a reasonable design (SPA routing can't be a real security boundary anyway) but worth knowing.
- **Roll-number identity is fully self-asserted** — `POST /api/students/sessions/login` and all `X-Roll-Number`-header-authenticated endpoints trust whatever roll number the client sends, with no OTP/email verification step. Anyone who knows (or guesses) another student's roll number could act as them (like/comment/RSVP/board access) since likes/comments/RSVPs aren't otherwise tied to a verified account.
- **The "public meet" token is not cryptographically signed** (`liveSessions.ts`'s `verifyPublicMeetToken`) — it's base64-encoded JSON (`{type, exp}`), not an HMAC/JWT. A client could construct a valid-looking token without knowing the real passcode. Blast radius is limited by a 24-hour delete window and the fact that it only gates live-session creation, not any data read.
- **Artwork magic-byte content sniffing is inconsistently applied** — `ALLOWED_EXT.check()` functions exist for every file type but are only invoked for the optional `cover` field on the artwork **update** (`PUT`) path; the main upload (`POST`) path and the main-file replace path only check the file extension string, not real file content.
- **`POST /api/boards/:id/canvas-files`** trusts the client-reported MIME type for the output file extension with no server-side allowlist/magic-byte check (unlike `artworks.ts`/`team.ts`).
- **Email HTML injection risk (low severity):** `services/mailer.ts`'s template `resolve()` does naive `String.replaceAll` substitution with no HTML-escaping of user-supplied values (e.g. a student's registered `name`) before injecting into the welcome-email HTML.
- **`AUDIT_REPORT.md`'s remaining MEDIUM items** not yet addressed: JWT expiry (8h) has no user-visible re-login prompt (fails silently to console); `EventsPage`/`GalleryPage`/`AcademyPage` don't surface `useAppData()`'s `loading`/`error` state, so backend downtime renders an empty page with no feedback; no `z.string().url()` validation on `socialInstagram`/`socialLinkedin` in `team.ts` (just length-capped strings); double-submit is possible on `AcademyTab.handleAddVideo`/`EventsTab.handleAdd` (no disabled-while-submitting guard, unlike `GalleryTab`/`TeamTab` which do this correctly); no Row-Level Security assumed on the Supabase Postgres connection (the app connects directly via `DATABASE_URL`, so the Express layer is the only access-control boundary).
- **Debug `console.log` statements left in `AdminPage.tsx`'s `TeamTab.handleEditMember`** (photo-upload state) — not gated behind a dev flag.
- **`GalleryPage.tsx`'s `forceUppercase` setting is purely cosmetic/client-side** — it's a `localStorage` flag with no server-side enforcement, toggled from `SettingsTab`.
- **Legacy/dead code left in the repo:**
  - `backend/data/dna.db*` (SQLite files) and `backend/Dockerfile`'s `better-sqlite3` rebuild step are leftovers from a pre-Postgres version of the backend — the live backend uses `pg`/Supabase exclusively; `better-sqlite3` is not even a listed dependency in `backend/package.json`.
  - `src/styles/fonts.css` is empty — fonts are actually loaded via `<link>` tags in `index.html`; this file should either be deleted or repurposed.
  - `default_shadcn_theme.css` at the repo root is unused reference material, not part of the live import chain.
  - 7 orphaned/unreferenced components (see §5.6) — safe candidates for deletion if confirmed unneeded.
  - `tests/palette-engine.test.js` is a real, working test suite (esbuild-bundles `PaletteStudio.tsx` and runs 6 assertion groups) but is **not wired to any `npm test`/`package.json` script** and there's no CI to run it — currently must be invoked manually via `node tests/palette-engine.test.js`.
  - Root `.env.example` only documents Docker-Compose/backend variables; it does not mention the frontend's `VITE_API_BASE_URL`, which is required for a non-Docker (Vercel) deployment and is only documented in `DEPLOYMENT.md`.
  - `RESEND_API_KEY` (required for all email functionality) is used throughout `services/mailer.ts` but is absent from `backend/.env.example`.
  - `pnpm-workspace.yaml` has a literal unresolved placeholder string `core-js: set this to true or false` in its build-script allowlist instead of an actual boolean.

---

## 12. How to Run Locally

### Prerequisites
- Node.js 20+
- `pnpm` (frontend) — `npm install -g pnpm` if not already installed
- A Postgres database (a free Supabase project is the path of least resistance, since it also provides file storage)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and set at minimum:
#   DATABASE_URL=<your Postgres connection string>
#   JWT_SECRET=<any random string, 32+ chars recommended>
#   ADMIN_PASSWORD=<the password you'll use to log into /admin>
# Optional: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (both together) to enable
#   Supabase Storage for uploads instead of the local backend/uploads/ folder.
# Optional: RESEND_API_KEY to enable outgoing email (welcome/notification/announcement).
npm run dev        # tsx watch — starts the API on http://localhost:4000
```

On first boot, `initSchema()` creates all tables and seeds default email templates, audience groups, and coordinator roster automatically. To also seed sample domains/videos/artworks/events/team members for local development:

```bash
npm run seed        # only runs if the `domains` table is empty
```

### 2. Frontend

```bash
# from the repo root
pnpm install
pnpm dev             # Vite dev server on http://localhost:5173
```

The Vite dev server proxies `/api/*` requests to `http://localhost:4000` automatically (configured in `vite.config.ts`), so no `VITE_API_BASE_URL` env var is needed for local development — it's only required when the frontend and backend are deployed to different origins (see `DEPLOYMENT.md`).

### 3. Log in as admin

Visit `http://localhost:5173/admin` and enter the `ADMIN_PASSWORD` you set in `backend/.env`.

### 4. (Optional) Docker Compose — self-hosted alternative

```bash
cp .env.example .env   # root-level, sets JWT_SECRET / ADMIN_PASSWORD / CORS_ORIGINS / PORT
docker compose up --build
```
This builds the frontend into an nginx container (port 80 by default, proxying `/api/` to the backend container) and the backend into a Node container with a persistent `/data` volume — an alternative to the Vercel+Render+Supabase path described in `DEPLOYMENT.md`.

### 5. Running the palette-engine test

```bash
node tests/palette-engine.test.js
```
(Not wired into any `npm test` script — see §11.)

---

## 13. Database Schema

PostgreSQL (Supabase in production). All tables are created on server startup by `backend/src/db/schema.ts` via `CREATE TABLE IF NOT EXISTS`, so the schema is code-defined rather than migration-file-driven. Some columns are added **after** their table's initial `CREATE` via idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements (called out per-table below); a dedicated `schema_migrations` table gates one-time **data** migrations so they run at most once.

> Verified against `backend/src/db/schema.ts` on 2026-07-16. Differences from the pre-rewrite documentation are noted inline.

### `schema_migrations`
| Column | Type | Notes |
|---|---|---|
| `key` | TEXT | PRIMARY KEY — name of a one-time migration that has run |

Guards destructive one-time data migrations (e.g. `clear_pre_email_sessions_v1`, which deletes pre-OTP `student_sessions` rows missing name/email exactly once).

### `admin_config`
| Column | Type | Notes |
|---|---|---|
| `key` | TEXT | PRIMARY KEY |
| `value` | TEXT | NOT NULL |

Seeded with `admin_password_hash` (bcrypt hash of the admin password).

### `domains`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (slug, e.g. `motion-graphics`) |
| `title` | TEXT | Short label (e.g. `Motion`) |
| `full_name` | TEXT | Full display name |
| `icon` | TEXT | DEFAULT `fa-layer-group` |
| `tagline` | TEXT | DEFAULT `''` |
| `description` | TEXT | DEFAULT `''` |
| `color` | TEXT | DEFAULT `#007AFF` |
| `display_order` | INT | DEFAULT 0 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

### `videos`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`{domain_id}-{uuid8}`) |
| `domain_id` | TEXT | FK → `domains.id` ON DELETE CASCADE |
| `title` | TEXT | |
| `yt_id` | TEXT | YouTube video ID |
| `difficulty` | TEXT | CHECK IN ('Beginner','Intermediate','Advanced') |
| `duration` | TEXT | Human-readable (e.g. `12:34`) |
| `sequence` | INT | DEFAULT 0 — **added via `ALTER TABLE`** and back-filled by per-domain insertion order |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

### `quiz_questions`
| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY |
| `domain_id` | TEXT | FK → `domains.id` ON DELETE CASCADE |
| `question` | TEXT | |
| `options` | TEXT | JSON array of strings, serialized |
| `answer_index` | INT | 0-based index into options |

### `events`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`evt-{uuid8}`) |
| `title` | TEXT | |
| `date` | TEXT | YYYY-MM-DD |
| `time` | TEXT | Human-readable |
| `location` | TEXT | |
| `content` | TEXT | |
| `capacity` | INT | |
| `registered_count` | INT | DEFAULT 0, maintained by the rsvp endpoint |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

### `event_rsvps`
| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT | FK → `events.id` ON DELETE CASCADE |
| `roll_number` | TEXT | |
| PRIMARY KEY | (`event_id`, `roll_number`) | |

The RSVP endpoint uses `SELECT … FOR UPDATE` inside a transaction to avoid capacity races.

### `artworks`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`art-{uuid8}`) |
| `title` | TEXT | |
| `artist` | TEXT | |
| `domain` | TEXT | Domain label string |
| `image_url` | TEXT | Legacy field (nullable) |
| `media_type` | TEXT | DEFAULT `image`, CHECK IN ('image','pdf','video') |
| `storage_path` | TEXT | Storage path (nullable) |
| `original_filename` | TEXT | |
| `mime_type` | TEXT | |
| `file_size` | BIGINT | CHECK ≤ 52428800 (50 MB) or NULL |
| `likes` | INT | DEFAULT 0, maintained by the like endpoint |
| `featured` | BOOLEAN | DEFAULT false — **added via `ALTER TABLE`** |
| `cover_url` | TEXT | DEFAULT NULL — **added via `ALTER TABLE`** (cover for video/PDF) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

### `artwork_likes`
| Column | Type | Notes |
|---|---|---|
| `artwork_id` | TEXT | FK → `artworks.id` ON DELETE CASCADE |
| `roll_number` | TEXT | |
| PRIMARY KEY | (`artwork_id`, `roll_number`) | |

Like/unlike is a transaction: inserts/deletes the row and increments/decrements `artworks.likes`.

### `artwork_comments`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`c-{uuid8}`) |
| `artwork_id` | TEXT | FK → `artworks.id` ON DELETE CASCADE |
| `sender` | TEXT | Student name |
| `text` | TEXT | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

### `student_sessions`
| Column | Type | Notes |
|---|---|---|
| `roll_number` | TEXT | PRIMARY KEY |
| `unique_id` | TEXT | `IITK-DnA-{ROLL}-{XXXX}` |
| `registered_at` | TEXT | Formatted date string (en-IN) |
| `name` | TEXT | DEFAULT NULL — **added via `ALTER TABLE`** |
| `email` | TEXT | DEFAULT NULL — **added via `ALTER TABLE`** |
| `welcome_email_sent_at` | TIMESTAMPTZ | DEFAULT NULL — **added via `ALTER TABLE`**; NULL = welcome email not yet sent |

> **Drift from old docs:** `welcome_email_sent_at` is new (welcome-email-once tracking). The base `CREATE` only has `roll_number`/`unique_id`/`registered_at`; `name`/`email`/`welcome_email_sent_at` are `ALTER TABLE` additions.

### `student_otps` *(new — OTP login)*
| Column | Type | Notes |
|---|---|---|
| `roll_number` | TEXT | PRIMARY KEY |
| `email` | TEXT | Address the code was sent to |
| `code_hash` | TEXT | bcrypt hash — plaintext code is never stored |
| `name` | TEXT | Pending name for a new registration |
| `expires_at` | TIMESTAMPTZ | |
| `attempts` | INT | DEFAULT 0 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

### `student_email_change_otps` *(new — email change)*
| Column | Type | Notes |
|---|---|---|
| `roll_number` | TEXT | PRIMARY KEY |
| `new_email` | TEXT | Target address; `student_sessions.email` is only updated once verified |
| `code_hash` | TEXT | bcrypt hash |
| `expires_at` | TIMESTAMPTZ | |
| `attempts` | INT | DEFAULT 0 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

Kept separate from `student_otps` so login and email-change flows can't collide.

### `student_watched_videos`
| Column | Type | Notes |
|---|---|---|
| `roll_number` | TEXT | |
| `video_id` | TEXT | FK → `videos.id` ON DELETE CASCADE |
| PRIMARY KEY | (`roll_number`, `video_id`) | |

### `student_completed_quizzes`
| Column | Type | Notes |
|---|---|---|
| `roll_number` | TEXT | |
| `domain_id` | TEXT | FK → `domains.id` ON DELETE CASCADE |
| PRIMARY KEY | (`roll_number`, `domain_id`) | |

### `team_members`
| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY |
| `name` | TEXT | |
| `designation` | TEXT | Used for grouping on the team page |
| `year` | TEXT | Nullable |
| `bio` | TEXT | Nullable |
| `color` | TEXT | DEFAULT `#007AFF` |
| `photo_path` | TEXT | Nullable |
| `display_order` | INT | DEFAULT 0 |
| `social_instagram` | TEXT | Nullable |
| `social_linkedin` | TEXT | Nullable |
| `social_email` | TEXT | Nullable |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

### `email_templates`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (`welcome`, `new_event`, `new_artwork`) |
| `name` | TEXT | Human-readable name |
| `subject` | TEXT | Supports `{{placeholders}}` |
| `body` | TEXT | HTML, supports `{{placeholders}}` |
| `updated_at` | TEXT | ISO string |

Seeded with standalone welcome / new-event / new-artwork templates on first boot.

### `audience_groups`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (e.g. `all_students`, `all_team`, `coordinators`) |
| `name` | TEXT | |
| `description` | TEXT | Nullable |
| `created_at` | TEXT | ISO string |

Seeded on first boot with `all_students` + `all_team` (the latter pre-populated with ~45 team member roll numbers).

### `audience_group_members`
| Column | Type | Notes |
|---|---|---|
| `group_id` | TEXT | FK → `audience_groups.id` ON DELETE CASCADE |
| `roll_number` | TEXT | |
| `name` | TEXT | Nullable |
| `added_at` | TEXT | ISO string |
| `approved` | BOOLEAN | DEFAULT false — **added via `ALTER TABLE`** |
| PRIMARY KEY | (`group_id`, `roll_number`) | |

The coordinator-check middleware queries this table for `group_id='coordinators' AND approved=true`.

### `live_sessions`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (UUID) |
| `title` | TEXT | |
| `host` | TEXT | |
| `meet_link` | TEXT | URL |
| `scheduled_at` | TEXT | ISO string |
| `status` | TEXT | DEFAULT `upcoming` — `upcoming` / `live` / `ended` |
| `audience_group_id` | TEXT | FK → `audience_groups.id` ON DELETE SET NULL, nullable (null = everyone) |
| `description` | TEXT | Nullable |
| `created_at` | TEXT | ISO string |

If `audience_group_id` is null or `all_students`, the session (and its meet link) is visible to every logged-in student.

### `session_joins`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (UUID) |
| `session_id` | TEXT | FK → `live_sessions.id` ON DELETE CASCADE |
| `roll_number` | TEXT | |
| `name` | TEXT | Nullable |
| `joined_at` | TEXT | ISO string |
| UNIQUE | (`session_id`, `roll_number`) | Re-joining updates `joined_at` |

### `boards`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (UUID) |
| `name` | TEXT | |
| `description` | TEXT | Nullable |
| `owner_roll` | TEXT | |
| `owner_name` | TEXT | Nullable |
| `visibility` | TEXT | DEFAULT `private` — `private` / `shared` |
| `room_id` | TEXT | UUID — **added via `ALTER TABLE`**, back-filled |
| `edit_mode` | TEXT | DEFAULT `members_only` — **added via `ALTER TABLE`** (`members_only` / `anyone`) |
| `canvas_data` | TEXT | DEFAULT NULL — **added via `ALTER TABLE`** (tldraw canvas JSON) |
| `created_at` | TEXT | ISO string |

### `board_members`
| Column | Type | Notes |
|---|---|---|
| `board_id` | TEXT | FK → `boards.id` ON DELETE CASCADE |
| `roll_number` | TEXT | |
| `name` | TEXT | Nullable |
| `added_at` | TEXT | ISO string |
| PRIMARY KEY | (`board_id`, `roll_number`) | |

### `board_items`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | PRIMARY KEY (UUID) |
| `board_id` | TEXT | FK → `boards.id` ON DELETE CASCADE |
| `image_url` | TEXT | |
| `note` | TEXT | Nullable |
| `source_url` | TEXT | Nullable |
| `added_by_roll` | TEXT | |
| `added_by_name` | TEXT | Nullable |
| `created_at` | TEXT | ISO string |

### `app_settings`
| Column | Type | Notes |
|---|---|---|
| `key` | TEXT | PRIMARY KEY |
| `value` | TEXT | NOT NULL |
| `updated_at` | TEXT | ISO string |

Seeded with `public_meet_enabled = 'false'` and `public_meet_passcode = 'DNA2025'`.

---

## 14. API Reference

**Base URL:** the frontend calls `${VITE_API_BASE_URL}/api` (`src/app/lib/api.ts`). `VITE_API_BASE_URL` is empty for local dev (same-origin via the Vite proxy) and set to the Render backend URL in production. All paths below are under `/api`.

**Common headers**
- `X-Roll-Number: {ROLL}` — student identity (required for student-protected endpoints)
- `Authorization: Bearer {token}` — admin JWT (required for admin-protected endpoints)
- `Content-Type: application/json` — JSON bodies
- `Content-Type: multipart/form-data` — file-upload endpoints

**Legend**: 🔓 Public · 🎓 Student (roll number header) · 🛡 Admin (JWT) · 📡 Coordinator

> Verified against `backend/src/routes/*.ts` on 2026-07-16. The auth/registration model changed substantially since the pre-rewrite docs — see the **⚠ drift** notes.

---

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | 🔓 | Returns `{ ok: true }`. Rate-limit exempt. |

---

### Auth (`/api/auth`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/login` | 🔓 | Body `{ password }` → `{ token }`. Rate-limited (10 / 15 min). |
| POST | `/student/request-otp` | 🔓 | Body `{ rollNumber, name?, email? }`. Emails a 6-digit code. New students must supply a valid name + `@iitk.ac.in` email; existing students omit them (the code always goes to the address on file). Returns `{ sent: true, isNew, email: <masked> }`. Rate-limited. |
| POST | `/student/verify-otp` | 🔓 | Body `{ rollNumber, code }`. On success returns `{ session: { rollNumber, uniqueId, registeredAt, name, email }, progress: { watchedVideos, completedQuizzes } }` and fires the welcome email once. **This is the combined registration + login.** |
| POST | `/student/change-email/request` | 🎓 | Body `{ rollNumber, newEmail }` (roll taken from the header; owner-guarded). Sends a code to `newEmail`. Returns `{ sent: true, email: <masked> }`. |
| POST | `/student/change-email/verify` | 🎓 | Body `{ code }`. On success updates `student_sessions.email`. |

> **⚠ drift:** the pre-rewrite docs listed only `POST /admin/login` here. The entire student email-OTP flow (`request-otp`, `verify-otp`, `change-email/*`) is new and lives in `auth.ts`.

---

### Domains (`/api/domains`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | 🔓 | All domains with their videos and quiz questions (object keyed by domain id). |
| POST | `/` | 🛡 | Create domain. Body `{ title, fullName, icon?, tagline?, description?, color? }`. |
| PUT | `/:id` | 🛡 | Update domain fields (all optional). |
| DELETE | `/:id` | 🛡 | Delete domain. 204. |
| POST | `/:id/videos` | 🛡 | Add video. Body `{ title, ytUrl, difficulty, duration, sequence? }`. |
| PUT | `/:id/videos/:videoId` | 🛡 | Update video (fields optional). |
| PATCH | `/:id/videos/:videoId` | 🛡 | Update sequence only. Body `{ sequence }`. |
| DELETE | `/:id/videos/:videoId` | 🛡 | Delete video. 204. |
| POST | `/:id/quiz/submit` | 🎓 | Submit quiz answers; graded against `quiz_questions`, marks `student_completed_quizzes` on pass. |

> **⚠ drift:** `POST /:id/quiz/submit` is where quiz completion now lives — it moved here from the old `POST /api/students/:roll/progress/quizzes/:domainId`.

`GET /api/domains` response is keyed by domain id:
```json
{
  "motion-graphics": {
    "id": "motion-graphics", "title": "Motion", "fullName": "Motion Graphics",
    "icon": "fa-film", "tagline": "...", "description": "...", "color": "#007AFF",
    "videos": [{ "id": "...", "title": "...", "ytId": "...", "difficulty": "Beginner", "duration": "12:00", "sequence": 1 }],
    "quizzes": [{ "q": "...", "options": ["A","B","C","D"], "ans": 2 }]
  }
}
```

---

### Students (`/api/students`)
| Method | Path | Auth | Rate limit |
|---|---|---|---|
| GET | `/:roll/exists` | 🔓 | — |
| GET | `/:roll/progress` | 🔓 | 60 / min |
| POST | `/:roll/progress/videos/:videoId` | 🎓 (owner) | 30 / min |
| DELETE | `/:roll/progress/videos/:videoId` | 🎓 (owner) | 30 / min |

**Owner guard:** the video-progress writes require `X-Roll-Number` to equal `:roll` (403 otherwise).

`GET /:roll/exists` → `{ exists, hasProfile }`, where `hasProfile` is true only when the row has both a name and an email.

> **⚠ drift:** the pre-rewrite docs listed `POST /sessions`, `POST /sessions/login`, `GET /:roll/profile`, and `POST /:roll/progress/quizzes/:domainId` under Students. All are gone: registration + login moved to the `/auth` OTP flow, profile data is folded into `/:roll/exists`, and quiz submission moved to `/domains/:id/quiz/submit`.

---

### Artworks (`/api/artworks`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | 🔓 / 🎓 | All artworks, `created_at DESC`. With roll header: includes `likedByUser`. |
| POST | `/` | 🛡 | Multipart: `file` (required), `cover` (optional), `title`, `artist`, `domain`. |
| PUT | `/:id` | 🛡 | Multipart update; fields + `file`/`cover` optional. |
| PATCH | `/:id/featured` | 🛡 | Body `{ featured }` → `{ id, featured }`. |
| DELETE | `/:id` | 🛡 | Deletes file from storage + DB. 204. |
| POST | `/:id/like` | 🎓 | Toggle like → `{ likes, likedByUser }`. Rate-limited (30 / min). |
| POST | `/:id/comments` | 🎓 | Body `{ sender, text }` → created comment. Rate-limited (10 / min). |
| DELETE | `/:id/comments/:commentId` | 🛡 | Delete comment → `{ success, deletedId }`. |

Artwork response shape:
```json
{
  "id": "art-abc12345", "title": "...", "artist": "...", "domain": "Illustration",
  "mediaUrl": "https://...", "mediaType": "image", "originalFilename": "design.jpg",
  "likes": 12, "likedByUser": false, "featured": true, "coverUrl": null,
  "comments": [{ "id": "c-xxxx", "sender": "Name", "text": "...", "date": "5 minutes ago" }]
}
```

---

### Events (`/api/events`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | 🔓 / 🎓 | All events, date ASC. With roll header: includes `isRegistered`. |
| POST | `/` | 🛡 | Body `{ title, date, time, location, content, capacity }`. |
| PUT | `/:id` | 🛡 | Fields optional. |
| DELETE | `/:id` | 🛡 | 204. |
| POST | `/:id/rsvp` | 🎓 | Toggle RSVP (uses `FOR UPDATE` row lock) → `{ registeredCount, isRegistered }`. 409 if full. |

---

### Team (`/api/team`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | 🔓 | All members, `display_order ASC, id ASC`. |
| POST | `/` | 🛡 | Multipart: `photo` (optional) + member fields. |
| PUT | `/:id` | 🛡 | Multipart update (replaces record). |
| PATCH | `/:id/order` | 🛡 | Body `{ display_order }`. |
| DELETE | `/:id` | 🛡 | Deletes photo + DB. 204. |

Member response shape:
```json
{
  "id": 1, "name": "Jane Doe", "designation": "Coordinator", "year": "2025",
  "bio": "...", "color": "#007AFF", "photoUrl": "https://...", "displayOrder": 1,
  "social": { "instagram": null, "linkedin": "https://...", "email": null }
}
```

---

### Notify / Email (`/api/notify`)
All endpoints require admin JWT.

| Method | Path | Description |
|---|---|---|
| GET | `/test-email` | Sends a test email to the club Gmail. |
| POST | `/event` | Body `{ title, date?, venue?, description? }`. Queues an event notification to all students. |
| POST | `/artwork` | Body `{ title, artist, domain? }`. Queues an artwork notification to all students. |
| GET | `/templates` | All email templates. |
| GET | `/templates/:id` | Single template by id. |
| POST | `/templates/:id/preview` | Renders the template with sample data and returns the resolved subject + HTML (accurate per-template preview). |
| POST | `/templates/:id/test` | Sends the template as a one-off test email. |
| PUT | `/templates/:id` | Body `{ subject, body }`. Updates the template. |
| POST | `/announce` | Body `{ subject, html }`. Emails all registered students → `{ sent: N }`. |

> **⚠ drift:** `POST /templates/:id/preview` and `POST /templates/:id/test` are new (accurate per-template preview + send-test).

---

### Live Sessions (`/api/live-sessions`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/active` | 🔓 / 🎓 | Active + upcoming sessions; audience-checks `meet_link` per student. |
| GET | `/past` | 🛡 | Ended sessions with join counts. |
| GET | `/groups` | 🛡 | Audience groups with member counts. |
| GET | `/` | 🛡 | All sessions, `scheduled_at DESC`. |
| POST | `/` | 🛡 | Create. Body `{ title, host, meet_link, scheduled_at, audience_group_id?, description? }`. |
| POST | `/public` | 🔓 (token) | Create via public meet token. |
| DELETE | `/public/:id` | 🔓 (token) | Delete within 24h of creation. |
| POST | `/coordinator` | 📡 | Create (same body as admin create). |
| DELETE | `/coordinator/:id` | 📡 | Delete own session within 24h. |
| PUT | `/coordinator/:id/status` | 📡 | Body `{ status }`. |
| GET | `/:id/joins` | 🛡 | `{ session_id, count, joins: [...] }`. |
| GET | `/:id/joins/count` | 🔓 | `{ count }` — polled by `LiveSessionBanner` (~30s). |
| POST | `/:id/join` | 🎓 | Track a join event (silently succeeds on error). |
| PUT | `/:id/status` | 🛡 | Body `{ status }`. |
| PUT | `/:id` | 🛡 | Partial update. |
| DELETE | `/:id` | 🛡 | Delete any session. |

**Public meet token:** minted by `POST /api/settings/verify-passcode`; base64 JSON `{ type:'public_meet', exp }`, valid 24h. Not cryptographically signed (see §11).

---

### Boards (`/api/boards`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | 🎓 | Boards owned by or shared with the caller. |
| GET | `/shared` | 🔓 | All `visibility='shared'` boards. |
| GET | `/admin/all` | 🛡 | All boards from all users. |
| DELETE | `/admin/:id` | 🛡 | Admin delete any board. |
| PUT | `/admin/:id` | 🛡 | Admin update `visibility` / `edit_mode`. |
| POST | `/` | 🎓 | Create. Body `{ name, description?, visibility? }`. |
| GET | `/:id` | 🔓 / 🎓 | Board + items + members (private boards require membership). |
| PUT | `/:id` | 🎓 (owner) | Update `name` / `description` / `visibility` / `edit_mode`. |
| DELETE | `/:id` | 🎓 (owner) | Delete board. |
| GET | `/:id/canvas` | 🎓 (member) | `{ canvas_data: string\|null }`. |
| PUT | `/:id/canvas` | 🎓 (member) | Body `{ canvas_data }`. |
| POST | `/:id/members` | 🎓 (owner) | Invite. Body `{ roll_number }` (student must be registered). |
| DELETE | `/:id/members/:roll` | 🎓 (owner) | Remove collaborator. |
| POST | `/:id/items` | 🎓 (member) | Add item. Body `{ image_url, note?, source_url? }`. |
| DELETE | `/:id/items/:itemId` | 🎓 (item/board owner) | Delete item. |
| GET | `/:id/items` | 🎓 / 🔓 (shared) | Items only (polling). |
| POST | `/:id/canvas-files` | 🎓 (member) | Upload a canvas image. Multipart `file` → `{ fileId, url }`. |

---

### Coordinators (`/api/coordinators`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | 🛡 | All coordinators with approval status + email. |
| POST | `/` | 🛡 | Add. Body `{ roll_number, name }` (`approved=false` by default). |
| PUT | `/:roll/approve` | 🛡 | Toggle approval. Body `{ approved }`. |
| DELETE | `/:roll` | 🛡 | Remove coordinator. |
| GET | `/check` | 🎓 | Whether the caller (roll from header) may schedule → `{ canSchedule }`. Used by the Footer scheduler. |

> **⚠ drift:** this is `GET /check` (roll read from the `X-Roll-Number` header via `requireStudent`), not the old `GET /check/:roll` path parameter.

---

### Settings (`/api/settings`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/public` | 🔓 | `{ public_meet_enabled: 'true'\|'false' }`. |
| GET | `/` | 🛡 | All settings as `{ key: value }`. |
| PUT | `/` | 🛡 | Body `{ key: value, … }` — upserts. |
| POST | `/verify-passcode` | 🔓 | Body `{ passcode }` → `{ success, token }` (24h base64 token). |
