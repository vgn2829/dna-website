# Deployment Guide — Free Production Stack

This project deploys to three free-tier services:

| Layer | Service | Free tier |
|---|---|---|
| Frontend | Vercel (or Netlify) | Unlimited static sites |
| Backend API | Render (Web Service) | 750 hrs/month, sleeps after 15 min idle |
| Database + Files | Supabase | 500 MB DB · 1 GB storage · pauses after 7 days inactivity |

---

## 1. Supabase — Database + File Storage

### 1.1 Create project

1. Sign up at [supabase.com](https://supabase.com) → **New project**.
2. Choose a region closest to your users (e.g. `ap-south-1` for India).
3. Set a strong database password and save it.

### 1.2 Run schema

In the Supabase dashboard go to **SQL Editor** → **New query**, paste the entire contents of `backend/src/db/schema.ts` (the SQL string inside `initSchema()`), and run it.

### 1.3 Create storage bucket

1. **Storage** → **New bucket**.
2. Name it `dna-media` (or choose your own name — set `SUPABASE_STORAGE_BUCKET` to match).
3. Set **Public bucket** to **on** so uploaded files are publicly readable.

### 1.4 Collect credentials

From **Project Settings → API**:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | **Settings → Database → Connection string → URI** (use the **Transaction** pooler URI on port 6543 for Render) |
| `SUPABASE_URL` | **Project URL** (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** secret (never expose this in the browser) |

> **Transaction pooler vs session pooler:** Render's free tier uses ephemeral VMs that can exhaust Postgres connections. Use the **Transaction pooler** URI (port 6543) in `DATABASE_URL` — it multiplexes connections and is safe for stateless HTTP APIs.

---

## 2. Render — Backend API

### 2.1 Create Web Service

1. Push the repo to GitHub.
2. [render.com](https://render.com) → **New → Web Service** → connect the repo.
3. Set these in the Render UI:

| Setting | Value |
|---|---|
| **Root directory** | `backend` |
| **Build command** | `npm install && npm run build` |
| **Start command** | `node dist/server.js` |
| **Node version** | 20 (set in `RENDER_NODE_VERSION` env var or `.node-version`) |

### 2.2 Environment variables (Render dashboard → Environment)

```
DATABASE_URL=postgresql://postgres:[password]@[pooler-host].supabase.co:6543/postgres?pgbouncer=true
JWT_SECRET=<generate: openssl rand -base64 48>
ADMIN_PASSWORD=<choose a strong password>
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...
SUPABASE_STORAGE_BUCKET=dna-media
PORT=4000
CORS_ORIGINS=https://your-frontend.vercel.app
API_BASE_URL=https://your-api.onrender.com
NODE_ENV=production
```

> **Never** use `ADMIN_PASSWORD=admin123` or a short `JWT_SECRET` in production. The server will refuse to start if either is missing.

### 2.3 Seed initial data (optional)

After the service is running, open the Render **Shell** tab and run:

```bash
node dist/db/seed.js
```

Or run the seed locally against the Supabase DB by temporarily setting `DATABASE_URL` in your local `.env` to the Supabase URI.

### 2.4 Verify deployment

```bash
curl https://your-api.onrender.com/api/health
# → {"status":"ok"}
```

---

## 3. Vercel — Frontend

### 3.1 Deploy

1. [vercel.com](https://vercel.com) → **Add New Project** → import the same repo.
2. Set **Root directory** to `.` (the repo root).
3. Vercel auto-detects Vite. Build command: `pnpm build`. Output: `dist/`.
   The frontend is a pnpm project — `packageManager` in `package.json` pins the
   pnpm version, and `pnpm-lock.yaml` is the only frontend lockfile. Don't use
   npm here or you'll get a non-reproducible install. (The backend is separate
   and does use npm — see §2.)

### 3.2 Environment variable

In **Project Settings → Environment Variables** add:

```
VITE_API_BASE_URL=https://your-api.onrender.com
```

> The frontend reads this via `import.meta.env.VITE_API_BASE_URL`. Make sure `src/app/lib/api.ts` uses this variable as the API base URL — if it currently hardcodes `localhost:4000`, update it to:
> ```ts
> const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
> ```

### 3.3 CORS

Set `CORS_ORIGINS` on Render to the exact Vercel URL (e.g. `https://dna-website.vercel.app`). The backend rejects all other origins — no wildcard.

---

## 4. Keep-alive — Prevent free-tier sleep

Both Render and Supabase pause on inactivity:

| Service | Pause condition | Wake-up latency |
|---|---|---|
| Render free web service | 15 min of no HTTP traffic | ~30 s cold start |
| Supabase free project | 7 days of no DB activity | instant once un-paused in dashboard |

### Option A — UptimeRobot (easiest, free)

1. [uptimerobot.com](https://uptimerobot.com) → **Add New Monitor**.
2. Monitor type: **HTTP(s)**.
3. URL: `https://your-api.onrender.com/api/health`
4. Monitoring interval: **5 minutes**.

This prevents Render from sleeping and keeps Supabase active.

### Option B — GitHub Actions scheduled ping

Create `.github/workflows/keepalive.yml`:

```yaml
name: Keep-alive ping
on:
  schedule:
    - cron: '*/10 * * * *'   # every 10 minutes
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -sf ${{ secrets.API_URL }}/api/health
```

Add `API_URL=https://your-api.onrender.com` in **Settings → Secrets → Actions**.

> GitHub Actions free tier gives 2 000 minutes/month. Running every 10 min = ~4 320 min/month on a private repo — consider every 14 min (`*/14 * * * *`) to stay within the free limit, or use UptimeRobot instead.

---

## 5. Error handling in production

The global error handler in `backend/src/app.ts` ensures no stack traces leak in production responses:

```ts
} else {
  console.error(err);               // logs full trace server-side only
  res.status(500).json({ error: 'Internal server error' });  // client gets no details
}
```

Server logs are visible only in the Render dashboard under **Logs**.

---

## 6. Quick reference — all environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | Postgres connection URI. Use Supabase transaction pooler (port 6543) on Render. |
| `JWT_SECRET` | **Yes** | — | Minimum 32 chars. Generate: `openssl rand -base64 48` |
| `ADMIN_PASSWORD` | **Yes** | — | Password for `/api/auth/admin/login`. |
| `SUPABASE_URL` | No¹ | — | Project URL from Supabase dashboard. |
| `SUPABASE_SERVICE_ROLE_KEY` | No¹ | — | Service role secret from Supabase dashboard. |
| `SUPABASE_STORAGE_BUCKET` | No | `dna-media` | Bucket name for file uploads. |
| `PORT` | No | `4000` | Render sets this automatically. |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Comma-separated list. Set to production frontend URL. |
| `API_BASE_URL` | No | `http://localhost:4000` | Used by local-disk storage provider to build public file URLs. Not needed when using Supabase Storage. |
| `NODE_ENV` | No | — | Set to `production` on Render. |

¹ `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set **together** (both or neither). If omitted, the server falls back to local-disk storage — only appropriate for local development, not production (uploads are lost on each Render deploy).

---

## 7. Local development

```bash
# Start a local Postgres DB (requires PostgreSQL installed)
createdb dna_club

# Copy env file
cp backend/.env.example backend/.env
# Edit backend/.env: set DATABASE_URL=postgresql://localhost/dna_club
#   Leave SUPABASE_URL/KEY unset to use local-disk storage

# Install dependencies
npx pnpm install

# Run schema migrations + seed
cd backend && npx tsx src/db/schema.ts   # or: npx tsx -e "require('./src/db/schema')"
npx tsx src/db/seed.ts

# Start backend
npx tsx src/server.ts

# Start frontend (separate terminal)
cd .. && npx pnpm dev
```
