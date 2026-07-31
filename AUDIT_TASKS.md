# Audit Task List

Generated 2026-07-31. Ground-truth re-audit; prior `AUDIT_REPORT.md` (2026-06-14,
commit 326a463) is 172 commits stale and used only as a reference for delta-checking,
not as a source of truth.

**STATUS: COMPLETE.** Full findings written to `AUDIT_REPORT.md`.

Status legend: not started / in progress / done

| # | Unit | Scope | Status |
|---|------|-------|--------|
| 1 | Architecture map | Directory structure, stack, deploy config, data flow | done |
| 2 | Backend: auth & admin | `routes/auth.ts`, `middleware/adminAuth.ts`, `middleware/studentAuth.ts` | done |
| 3 | Backend: students & OTP | `routes/students.ts`, `services/mailer.ts` (OTP path) | done |
| 4 | Backend: events + notify + live sessions | `routes/events.ts`, `routes/notify.ts`, `routes/liveSessions.ts`, `routes/internal.ts` | done |
| 5 | Backend: artworks/gallery + storage | `routes/artworks.ts`, `storage/local.ts`, `storage/supabase.ts`, `storage/index.ts` | done |
| 6 | Backend: boards (moodboards) | `routes/boards.ts` | done |
| 7 | Backend: team/coordinators/domains/settings | `routes/team.ts`, `routes/coordinators.ts`, `routes/domains.ts`, `routes/settings.ts` | done |
| 8 | Backend: db schema, client, seed | `db/schema.ts`, `db/client.ts`, `db/seed.ts` | done |
| 9 | Backend: app/server bootstrap | `app.ts`, `server.ts`, CORS/helmet/rate-limit config | done |
| 10 | Frontend: routing & app shell | `routes.tsx`, `App.tsx`, `Root.tsx`, `Navigation.tsx` | done |
| 11 | Frontend: contexts | `AppDataContext.tsx`, `StudentContext.tsx`, `ThemeContext.tsx` | done |
| 12 | Frontend: API client | `lib/api.ts` | done |
| 13 | Frontend: HomePage + marketing components | `HomePage.tsx`, `Hero.tsx`, `Mission.tsx`, `Stats.tsx`, `FeaturedMarquee.tsx`, etc. | done |
| 14 | Frontend: Events page + RSVP flow | `EventsPage.tsx`, `Events.tsx`, `RollModal.tsx`, `EventSpotlight.tsx` | done |
| 15 | Frontend: Gallery page | `GalleryPage.tsx`, `GalleryPreview.tsx` | done |
| 16 | Frontend: Team/Board pages | `TeamPage.tsx`, `Team.tsx`, `BoardPage.tsx` (moodboard canvas) | done |
| 17 | Frontend: Admin page | `AdminPage.tsx` (3782 lines) | done |
| 18 | Frontend: Design Studio (Palette/SVG/BgRemoval) | `DesignStudioPage.tsx`, `PaletteStudio.tsx` (wiring only, per prior decision), `SvgConverter.tsx`, `background-removal/*`, `svg-converter/*` | done |
| 19 | Frontend: Moodboards / TldrawCanvas | `MoodboardsPage.tsx`, `TldrawCanvas.tsx` | done |
| 20 | Frontend: Academy/Resources pages | `AcademyPage.tsx`, `ResourcesPage.tsx`, `ResourcesPreview.tsx` | done |
| 21 | Frontend: auth-adjacent modals | `ChangeEmailModal.tsx`, `WelcomeOverlay.tsx`, `JoinPrompt.tsx` | done |
| 22 | Frontend: shared UI kit | `components/ui/*` (shadcn) — spot check only | done |
| 23 | Config/build/deploy | `vite.config.ts`, `Dockerfile`(s), `docker-compose.yml`, `vercel.json`, `nginx.conf`, `.env.example` files | done |
| 24 | Dependencies | root + backend `package.json`, lockfile drift, outdated/unused pkgs | done |
| 25 | Tests | `tests/palette-engine.test.js` — coverage assessment | done |
| 26 | Dead code / repo hygiene | `dist/`, `brag-output-*/`, stray `.DS_Store`, unused files | done |
| 27 | UI/UX pass | Navigation, loading/empty/error states, forms, accessibility, responsive | done |
| 28 | Final report assembly | Write `AUDIT_REPORT.md` | done |
