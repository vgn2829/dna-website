# DnA Club Website — Pre-Launch Security Audit Report

*Date: 2026-06-14 | Commit: 326a463 — Add: Mood tab with visual palette engine (jitter, adaptive chroma, mood profiles)*

---

## Summary Table

| # | Audit Area | Issues Found | Highest Severity |
|---|---|---|---|
| 1 | Secret Leakage | 2 | CRITICAL |
| 2 | Authentication Security | 3 | HIGH |
| 3 | XSS Prevention | 1 | LOW |
| 4 | Backend API Security | 3 | MEDIUM |
| 5 | Infinite Loops & Memory Leaks | 1 | LOW |
| 6 | Error States & Crashes | 3 | MEDIUM |
| 7 | Form Input Hardening | 3 | MEDIUM |
| 8 | Console & Code Quality | 2 | LOW |
| 9 | Supabase & Database Security | 2 | MEDIUM |
| 10 | Stability Edge Cases | 3 | MEDIUM |

---

## Audit 1: Secret Leakage

### Findings

**CRITICAL — Real production credentials in `backend/.env` on disk**

The file `/Users/venugopal/Downloads/dna_website/backend/.env` exists with the following real production values:

```
JWT_SECRET=dev-only-secret-change-in-production
ADMIN_PASSWORD=Dnaontop19
DATABASE_URL=postgresql://postgres.gecnkkcrprdphbocknru:Dna2019IITkanpur@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
```

Two problems:
1. **`JWT_SECRET` is the literal string `dev-only-secret-change-in-production`** — this is a weak, guessable secret. Anyone who knows this value can forge admin JWT tokens and bypass authentication entirely.
2. **`ADMIN_PASSWORD=Dnaontop19` and the full Supabase `DATABASE_URL` with password `Dna2019IITkanpur` are stored in plaintext** on the developer machine. If this file is ever accidentally committed, or the machine is compromised, all three credentials are exposed simultaneously.

**Git tracking status:** `backend/.env` is correctly listed in `.gitignore` (`backend/.env` appears in the root `.gitignore`) and is NOT tracked in git history. A scan of all git commit content finds no trace of `Dna2019IITkanpur`, `Dnaontop19`, or `dev-only-secret-change-in-production` in any committed file. The current state is not a git leak.

**MEDIUM — Default fallback password in seed script**

`/Users/venugopal/Downloads/dna_website/backend/src/db/seed.ts` line 17:
```ts
const pw = process.env.ADMIN_PASSWORD ?? 'admin123';
```
If the seed script is ever run in an environment where `ADMIN_PASSWORD` is unset, it silently falls back to `admin123` and hashes that into the database. The server startup guard at `server.ts` line 4-9 correctly requires `ADMIN_PASSWORD`, but the seed script does not.

**No frontend secret leakage.** The `src/` directory contains zero references to `SUPABASE`, `JWT`, `SECRET`, `PASSWORD`, `API_KEY`, `DATABASE_URL`, or `service_role`. The frontend only exposes `VITE_API_BASE_URL` (an API endpoint, not a credential) via `src/app/lib/api.ts` line 1. All secrets stay server-side only.

---

## Audit 2: Authentication Security

### Findings

**HIGH — `/admin` route has no server-enforced route guard**

`/Users/venugopal/Downloads/dna_website/src/app/routes.tsx` line 25:
```ts
{ path: 'admin', Component: AdminPage },
```
This is a standard client-side React Router route with no `loader`, `ProtectedRoute` wrapper, or `requireAuth` function. Any user who types `http://yourdomain.com/admin` in the URL bar will have the React bundle loaded and the `AdminPage` component mounted.

The `AdminPage` component itself gates rendering via a local `authed` state (`AdminPage.tsx` line 471-474):
```tsx
const [authed, setAuthed] = useState(false);
if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;
```
This means a logged-out user who navigates to `/admin` **sees the login form, not the dashboard** — the dashboard content does not render. The protection is client-side state only, but since the admin token (`dna_admin_token` in `sessionStorage`) is checked per-request at the backend, and all admin API calls fail without a valid JWT, the practical risk is **low for data access** but **medium for UI exposure**: the admin dashboard skeleton and tab labels are visible to any authenticated admin in the current session only.

**The real security boundary is the backend:** every admin write endpoint (`POST/PUT/PATCH/DELETE` on `/api/domains`, `/api/team`, `/api/artworks`, `/api/events`) is protected by `requireAdmin` middleware (`backend/src/middleware/adminAuth.ts`), which validates the JWT on every request. A logged-out user cannot perform any admin operation via the API.

**MEDIUM — Admin token stored in `sessionStorage`**

`/Users/venugopal/Downloads/dna_website/src/app/lib/api.ts` lines 3-5:
```ts
const ADMIN_TOKEN_KEY = 'dna_admin_token';
export function getAdminToken(): string | null  { return sessionStorage.getItem(ADMIN_TOKEN_KEY); }
export function setAdminToken(token: string)    { sessionStorage.setItem(ADMIN_TOKEN_KEY, token); }
```
`sessionStorage` is accessible to any JavaScript running in the same origin. Because there is no `dangerouslySetInnerHTML` that renders user-provided data, the XSS risk is low, but if any XSS vector were ever introduced, the admin token would be directly accessible via `sessionStorage.getItem('dna_admin_token')`.

**MEDIUM — JWT expiry handling produces no user-visible error**

The JWT is set to expire in 8 hours (`auth.ts` line 28: `expiresIn: '8h'`). The `requireAdmin` middleware correctly returns 401 on an expired token. However, the frontend API wrapper (`api.ts`) converts 401 responses into thrown `Error` objects. Admin mutating callbacks in `AppDataContext.tsx` (e.g., `deleteArtwork`, `addComment`) call `.catch(console.error)` but do not surface expired-token errors to the admin user. If a 401 is received, the operation silently fails with a `console.error` and no prompt to re-login. The admin must manually refresh. This is a UX gap, not a security gap.

**All backend admin endpoints are protected.** Every write endpoint on `domains`, `team`, `artworks`, and `events` routes uses `requireAdmin` as middleware. Public GET endpoints are intentionally open.

---

## Audit 3: XSS Prevention

### Findings

**LOW — `dangerouslySetInnerHTML` in `chart.tsx`**

`/Users/venugopal/Downloads/dna_website/src/app/components/ui/chart.tsx` line 83:
```tsx
dangerouslySetInnerHTML={{
  __html: Object.entries(THEMES).map(([theme, prefix]) => `
    ${prefix} [data-chart=${id}] { ... }`)
```
The content injected via `dangerouslySetInnerHTML` is constructed entirely from:
- `THEMES` — a hard-coded constant: `{ light: "", dark: ".dark" }`
- `id` — a developer-supplied `chartId` prop
- `ChartConfig` — a developer-supplied configuration object, not user input

No user-submitted data flows through this path. This is a shadow-component from a UI library (shadcn/ui pattern) and does not constitute an exploitable XSS risk in the current codebase.

**No other `dangerouslySetInnerHTML` or `innerHTML` usage found anywhere in `src/`.**

**User-submitted text is rendered safely.** Comments in `GalleryPage.tsx` lines 152-161 render `c.sender` and `c.text` as React text nodes (not HTML), so they are automatically escaped by React. Artwork titles, artist names, event titles, and team member names are all rendered via JSX text interpolation.

**Social URL links are rendered directly as `href` values.** In `TeamPage.tsx` lines 51-58 and `Team.tsx` lines 37-44, `member.social.instagram` and `member.social.linkedin` are placed directly into `<a href={...}>`. The backend `memberSchema` does not validate that these are `https://` URLs — a `javascript:` href could be stored. However, exploiting this requires admin access to create the member with a malicious URL, making it a self-inflicted risk.

---

## Audit 4: Backend API Security

### Findings

**MEDIUM — No rate limiting on public write endpoints**

The following endpoints accept writes from any authenticated student and have **no rate limiting**:
- `POST /api/artworks/:id/like` (`artworks.ts` line 149) — unlimited likes/unlikes per minute
- `POST /api/artworks/:id/comments` (`artworks.ts` line 186) — unlimited comment creation
- `POST /api/events/:id/rsvp` (`events.ts` line 63) — unlimited RSVP toggles

The `POST /api/auth/admin/login` endpoint has a rate limiter (10 requests / 15 min window at `auth.ts` lines 10-14). The `POST /api/students/sessions` endpoint has a rate limiter (10 requests / 5 min at `students.ts` lines 9-13). The like/comment/RSVP endpoints do not.

**MEDIUM — No URL format validation on social links (backend)**

`team.ts` line 63-64 — the `memberSchema` uses `z.string().max(200).optional()` for `socialInstagram` and `socialLinkedin`. This permits any string including `javascript:alert(1)` or arbitrary text. While React's JSX href rendering won't execute `javascript:` URLs in modern browsers (most browsers block them), it is not enforced at the server level.

**MEDIUM — No format/length validation on `videoId` and `domainId` path params in student progress routes**

`students.ts` lines 68-97: `req.params.videoId` and `req.params.domainId` are used directly in parameterized SQL queries without any format validation (no regex, no max length). The queries are parameterized so SQL injection is not possible, but an authenticated student can write arbitrary-length strings (limited only by URL length) into `student_watched_videos.video_id` and `student_completed_quizzes.domain_id`. This could bloat the database.

**GOOD — CORS is correctly configured.** `app.ts` lines 16-31 parse `CORS_ORIGINS` from the environment and reject unknown origins with a 403 — no wildcard. The `helmet()` middleware is applied globally.

**GOOD — Error handler does not expose stack traces.** `app.ts` lines 57-73: the catch-all error handler returns `{ error: 'Internal server error' }` for 5xx responses — no stack traces are included in responses.

**GOOD — Login rate limited, uses bcrypt, parameterized queries throughout.** All database operations use the `query()` helper with parameterized `$1, $2` placeholders. No raw string interpolation into SQL is used anywhere.

---

## Audit 5: Infinite Loops and Memory Leaks

### Findings

**No infinite loops detected.**

`AppDataContext.tsx` lines 82-103: The main data-loading `useEffect` has dependency array `[roll]`. It only re-fires when the student's roll number changes (login/logout). The `cancelled` flag correctly prevents state updates on unmounted/re-ran effects. No state variable that changes inside the effect is included in the dependency array.

Individual callback hooks (`likeArtwork`, `addComment`, etc.) depend on `[roll]` only and do not update `roll` inside themselves.

**LOW — `ThemeProvider` calls `localStorage` synchronously on first render**

`ThemeContext.tsx` lines 11-13:
```ts
const [theme, setTheme] = useState<Theme>(
  () => (localStorage.getItem('dna-theme') as Theme) ?? 'dark'
);
```
If `localStorage` throws (Firefox private browsing can throw `SecurityError` on `localStorage` access), the state initializer crashes the `ThemeProvider`, which crashes the entire React tree. This is a stability risk (see Audit 10 for details). It is not an infinite loop.

**Scroll listeners are properly cleaned up.** `Navigation.tsx` lines 26-29 and `BackToTop.tsx` lines 8-11 both use `{ passive: true }` and return cleanup functions that call `removeEventListener`. No leaks.

`ArtworkModal` in `GalleryPage.tsx` lines 83-87 adds a `keydown` listener on mount and removes it on unmount. Correct.

`EventsPage.tsx` countdown timers (`useCountdown`): each event card creates a `setInterval` that is cleared on unmount via `clearInterval(id)` at line 24. Correct.

---

## Audit 6: Error States and Crashes

### Findings

**MEDIUM — `EventsPage` and `GalleryPage` have no loading or error state UI**

`EventsPage.tsx`: The component destructures `{ events, rsvpEvent }` from `useAppData()` but never reads `loading` or `error`. If the API call is in-flight, `events` is an empty array `[]` and the page renders "No events in this category." If the API fails entirely, `events` stays `[]` permanently with no error message. The user sees an empty page with no indication of the problem.

`GalleryPage.tsx`: Same issue. `loading` and `error` are not consumed. An API failure results in an empty masonry grid with no feedback.

**MEDIUM — `AcademyPage` has no loading or error state UI**

`AcademyPage.tsx` lines 114-334: The component does not read `loading` or `error` from `useAppData()`. If `domains` is an empty object (API down), `domainKeys` is `[]`, the sidebar renders nothing, the video theater renders nothing, and no feedback is shown to the user.

**LOW — `Team` component (homepage) shows a spinner during load but no error state**

`Team.tsx` lines 53-64: When `loading` is true, a spinner is rendered. However if the API fails, `loading` becomes `false`, `team` becomes `[]`, `coordinators` is `[]`, and the section renders only the heading with an empty grid — no error message.

**GOOD — `TeamPage.tsx` shows a loading spinner (line 82-88). No error state, but same pattern.**

**GOOD — No crashes from `.map()` on null/undefined.** All data arrays (`team`, `artworks`, `events`, `domain.videos`) are initialized as typed arrays/objects in `useState` and will never be `null` or `undefined`. The AppDataContext initializes with `useState<Artwork[]>([])`, `useState<ClubEvent[]>([])`, `useState<TeamMember[]>([])`, `useState<Record<string, Domain>>({})`, so `.map()` and `Object.keys()` will always receive a valid iterable.

---

## Audit 7: Form Input Hardening

### Findings

**MEDIUM — No `maxLength` on any text input in `AdminPage.tsx`**

The AdminPage forms have no `maxLength` attribute on any `<input>` or `<textarea>`. The backend schemas provide the true length enforcement (e.g., `z.string().max(200)` on team member name), but the client provides no feedback until the API rejects the submission. Examples:

- `AdminPage.tsx` line 40 — password input: no `maxLength`
- `AdminPage.tsx` line 119 — domain title: no `maxLength` (backend allows 100)
- `AdminPage.tsx` line 127 — description textarea: no `maxLength` (backend allows 1000)
- `AdminPage.tsx` line 161 — YouTube URL input: no `maxLength`, no format pre-check
- `AdminPage.tsx` lines 373-378 — team name, designation, bio: no `maxLength`
- `AdminPage.tsx` lines 381-382 — Instagram/LinkedIn URL inputs: no `maxLength`, no URL format validation
- `AdminPage.tsx` line 444 — event description textarea: no `maxLength`

**MEDIUM — YouTube URL input has no client-side format check**

`AdminPage.tsx` line 161: the admin can type any string into the YouTube URL field and submit. The backend validates it (`domains.ts` line 110-116: `normalizeYouTubeId` must return a non-null result), so invalid values are rejected with a 400, but the form silently clears on error via `alert(String(err))` (line 82) and the video is not added. No inline validation.

**LOW — Double-submit possible on some forms**

`AcademyTab.handleAddVideo` (`AdminPage.tsx` lines 92-98) and `EventsTab.handleAdd` (lines 427-431) do not use a loading state or a `disabled` flag during submission. The `button type="submit"` is not disabled while the async API call is in flight, so rapid clicks can submit the form multiple times.

`GalleryTab.handleUpload` (lines 250-265) and `TeamTab.handleAdd` (lines 346-364) correctly use `uploading`/`loading` state and disable the submit button.

**GOOD — File type and size validation on both client and server.** `GalleryTab` validates extension and size before calling the API (lines 241-246). The backend independently verifies magic bytes and enforces 50 MB limit.

---

## Audit 8: Console and Code Quality

### Findings

**LOW — Backend `console.error` calls expose internal error objects to logs**

`app.ts` line 71: `console.error(err)` logs the full Error object (including potential stack traces) to server stdout on any unhandled 500 error. This is appropriate for server-side logging but means the server's stderr/stdout output (e.g., Render.com build/deploy logs or log aggregation services) will contain stack traces. Not exploitable by end users (the API response returns only `{ error: 'Internal server error' }`), but worth noting for log hygiene.

`backend/src/routes/artworks.ts` line 142: `console.error('Storage delete failed:', err)` logs storage errors to server stdout.

`AppDataContext.tsx` lines 99 and 117 use `console.error` for failed API calls — appropriate during development.

**No `console.log` in frontend production code.** The grep confirms zero `console.log` calls in `src/`. Backend `console.log` calls are limited to benign startup messages (`server.ts` lines 32, 39; `seed.ts` lines 12, 133).

**No TODO, FIXME, or HACK comments** found in either `src/` or `backend/src/`.

**TypeScript `any` usage is minimal.** Only one match in `src/app/`: a comment in `Navigation.tsx` line 50 (a comment about columns, not a type annotation). The codebase is well-typed.

---

## Audit 9: Supabase and Database Security

### Findings

**GOOD — `SUPABASE_SERVICE_ROLE_KEY` is server-side only.**

`backend/src/storage/supabase.ts` lines 5-7: The Supabase client is initialized using `process.env.SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY`. These environment variables exist only in the backend Node.js process. There is no Supabase client in the frontend `src/` directory. The service role key is never sent to a browser.

**MEDIUM — No server-side validation of `SUPABASE_SERVICE_ROLE_KEY` presence before upload operations**

`backend/src/storage/supabase.ts` uses `process.env.SUPABASE_SERVICE_ROLE_KEY!` (non-null assertion) at lines 6-7. The startup guard in `server.ts` checks for the pair `(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` together, but it does not require either — it only ensures they are both present or both absent. In the Supabase-mode code path, if for any reason the environment variable is empty at runtime (e.g., a Render.com secret is deleted), the `createClient` call will receive an empty string, which may produce unexpected behavior without a clear error.

**GOOD — File uploads validate type and size before upload on both client and server.**

`artworks.ts` lines 26-34: every allowed extension has a magic-byte verification function. The backend checks both the file extension and the actual binary signature (`spec.check(file.buffer)`) before uploading to storage. The 50 MB limit is enforced by multer (`limits: { fileSize: MAX_BYTES }`) and rechecked on line 101. Same pattern in `team.ts` lines 25-30.

**GOOD — All database queries are parameterized.** No raw string interpolation into SQL queries was found in any route file. All values pass through `$1, $2, ...` placeholders using `pg`'s parameterized query interface.

**MEDIUM — No Row-Level Security inferred for Supabase Postgres.**

The app connects directly to the Supabase PostgreSQL database using a full `DATABASE_URL` connection string (not Supabase's REST client). This means Postgres RLS policies, if any exist in Supabase, are bypassed because the connection authenticates as the `postgres` superuser (from `DATABASE_URL`). The application-layer access control in the backend routes is the only protection. If the `DATABASE_URL` were compromised, an attacker would have full superuser access to the database.

---

## Audit 10: Stability Edge Cases

### Findings

**MEDIUM — `ThemeContext.tsx` and `index.html` inline script both call `localStorage` without try/catch**

`ThemeContext.tsx` lines 11-13:
```ts
const [theme, setTheme] = useState<Theme>(
  () => (localStorage.getItem('dna-theme') as Theme) ?? 'dark'
);
```
`index.html` lines 23-27:
```js
(function () {
  var t = localStorage.getItem('dna-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.background = t === 'light' ? '#ffffff' : '#111110';
})();
```
In Firefox Private Browsing mode (and some hardened browser configurations), `localStorage.getItem()` throws a `SecurityError: The operation is insecure`. The inline script in `index.html` will throw **before React loads**, leaving the page in an unstyled state (no `data-theme` attribute set). The `ThemeProvider` will crash its `useState` initializer, causing the entire React tree to fail to mount.

The `StudentContext.tsx` localStorage calls (`loadSession`, `loadProgress` at lines 33-37) are already correctly wrapped in `try/catch` blocks. The same pattern needs to be applied to `ThemeContext.tsx` and the `index.html` inline script.

**MEDIUM — `AppDataContext` returns `error: string | null` but no page consumes it**

When `AppDataContext.tsx`'s `useEffect` fetch fails, `error` is set to a non-null string (line 100-101). However, `EventsPage.tsx`, `GalleryPage.tsx`, and `AcademyPage.tsx` do not read the `error` field. If the backend is down, these pages render empty content with no message. Only `TeamPage.tsx` and `Team.tsx` display a spinner (but not an error).

**LOW — `member.name[0]` crashes if `name` is an empty string**

`Team.tsx` line 27 and `TeamPage.tsx` line 24 both use `member.name.charAt(0)` / `member.name[0]` as a fallback avatar character. The backend schema enforces `z.string().min(1)` on `name`, so empty-string names cannot be inserted. This is safe in practice but depends entirely on the backend constraint being enforced.

**GOOD — `domains` empty-object case is safe.** `AcademyPage.tsx` uses `Object.keys(domains)` which returns `[]` for an empty object — no crash. `domain?.videos.map(...)` uses optional chaining throughout. `domain?.videos.length ?? 0` safely handles undefined.

**GOOD — `BackToTop.tsx` is safe from SSR issues.** The component uses `useEffect` (not `useLayoutEffect`) and `window.scrollY`, so it only accesses the browser window after mount. No SSR risk with Vite + React SPA.

---

## Priority Fix List

### CRITICAL (fix before launch)

1. **Rotate `JWT_SECRET` immediately** — `backend/.env` contains `JWT_SECRET=dev-only-secret-change-in-production`. This must be replaced with a cryptographically random secret of at least 32 characters (e.g., `openssl rand -hex 32`) in all environments before deploying. The current value is guessable and allows anyone to forge admin JWTs.
   - *File:* `backend/.env` line 2

2. **Confirm production deployment never uses the `backend/.env` credentials** — The `DATABASE_URL` in `backend/.env` contains the real Supabase Postgres connection string with a plaintext password (`Dna2019IITkanpur`). Verify that Render.com (or other deployment host) uses environment variables injected via the platform dashboard, not the `.env` file on disk. The `.env` file must never be committed or transferred to any server.

3. **Fix `index.html` inline script to guard against `localStorage` throws** — Wrap the inline IIFE in `index.html` in a try/catch so Firefox Private Mode and hardened browsers do not crash before React loads:
   ```js
   (function () {
     try {
       var t = localStorage.getItem('dna-theme') || 'dark';
       document.documentElement.setAttribute('data-theme', t);
       document.documentElement.style.background = t === 'light' ? '#ffffff' : '#111110';
     } catch (_) {
       document.documentElement.setAttribute('data-theme', 'dark');
     }
   })();
   ```
   *File:* `index.html` lines 23-27

4. **Fix `ThemeContext.tsx` to guard against `localStorage` throws** — Replace the synchronous `localStorage.getItem` in the `useState` initializer with a try/catch:
   ```ts
   const [theme, setTheme] = useState<Theme>(() => {
     try { return (localStorage.getItem('dna-theme') as Theme) ?? 'dark'; }
     catch { return 'dark'; }
   });
   ```
   *File:* `ThemeContext.tsx` lines 11-13

---

### MEDIUM (fix this week)

5. **Add error UI to `EventsPage`, `GalleryPage`, and `AcademyPage`** — All three pages silently render empty content when the backend is down. Add a check for the `error` field from `useAppData()` and show a user-friendly error message. This is the same pattern already used in `AppDataContext` but not surfaced.
   - *Files:* `EventsPage.tsx`, `GalleryPage.tsx`, `AcademyPage.tsx`

6. **Add loading state to `EventsPage` and `GalleryPage`** — Neither page checks `loading` from `useAppData()`. Add a spinner while data is being fetched to prevent empty-state flicker.
   - *Files:* `EventsPage.tsx`, `GalleryPage.tsx`

7. **Add rate limiting to comment, like, and RSVP endpoints** — `POST /api/artworks/:id/comments`, `POST /api/artworks/:id/like`, and `POST /api/events/:id/rsvp` have no rate limiting. Apply `express-rate-limit` (already installed) with a window of 1 minute and a max of 20-30 requests to prevent abuse.
   - *Files:* `backend/src/routes/artworks.ts`, `backend/src/routes/events.ts`

8. **Validate social link URLs on the backend (team route)** — Add `z.string().url().max(200)` instead of `z.string().max(200)` for `socialInstagram` and `socialLinkedin` in `memberSchema` to prevent non-URL values (including `javascript:` protocol).
   - *File:* `backend/src/routes/team.ts` lines 63-64

9. **Prevent double-submit on AcademyTab video form and EventsTab event form** — Add a `loading` state and disable the submit button while the API call is in-flight, matching the pattern already used in `GalleryTab` and `TeamTab`.
   - *File:* `AdminPage.tsx` `AcademyTab.handleAddVideo` (line 92) and `EventsTab.handleAdd` (line 427)

10. **Add `maxLength` attributes to AdminPage form inputs** — Add `maxLength` attributes matching the backend Zod schema limits to provide immediate client-side feedback. Critical fields: domain title (100), description textarea (1000), team name (100), team designation (100), team bio (500), event title (200), event description (2000).
    - *File:* `AdminPage.tsx` — multiple form inputs

11. **Add length/format validation to `videoId` and `domainId` path params in student routes** — `req.params.videoId` and `req.params.domainId` are written directly to the database without any format check. Add a regex check (e.g., `/^[a-zA-Z0-9_-]{1,100}$/`) to prevent arbitrary long strings being stored.
    - *File:* `backend/src/routes/students.ts` lines 68-97

12. **Seed script should not fall back to `admin123`** — Change line 17 of `seed.ts` to require `ADMIN_PASSWORD` rather than defaulting:
    ```ts
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw) throw new Error('ADMIN_PASSWORD is required to seed');
    ```
    - *File:* `backend/src/db/seed.ts` line 17

---

### LOW (acceptable risk / polish)

13. **Add expired-token feedback in admin UI** — When admin API calls return 401 (token expired), the error is swallowed by `.catch(console.error)` in `AppDataContext.tsx`. Detect the 401 in the API wrapper and either call `clearAdminToken()` + redirect to the login screen, or show a toast. This is a UX gap only; security is unaffected since the backend correctly rejects the call.
    - *Files:* `src/app/lib/api.ts`, `AppDataContext.tsx`

14. **`chart.tsx` `dangerouslySetInnerHTML` is safe but documents a risk** — The shadcn/ui `ChartStyle` component uses `dangerouslySetInnerHTML` to inject CSS custom properties. The values come from hard-coded theme config, not user input, so there is no current XSS risk. However, if a future developer passes user-controlled data as `ChartConfig`, it would become exploitable. Add a comment documenting that `config` must never include user-provided values.
    - *File:* `src/app/components/ui/chart.tsx` line 83

15. **`GalleryPreview` (homepage) renders static mock data, not live API data** — `GalleryPreview.tsx` uses a hard-coded `ARTWORKS` array (6 static entries). The actual gallery artwork uploaded via the admin panel does not appear on the homepage preview. This is a content correctness gap.
    - *File:* `src/app/components/GalleryPreview.tsx`
