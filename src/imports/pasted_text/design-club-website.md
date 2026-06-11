Build a premium Design & Animation Club website for IIT Kanpur with Apple-level UI/UX and iOS 26 Liquid Glass aesthetics. UI IS THE MOST IMPORTANT THING — every pixel, animation, and interaction must feel intentional, fluid, and premium. Reference Apple.com, Airbnb, and iOS 26 Liquid Glass design language.

---

## DESIGN SYSTEM (MANDATORY)

- Liquid Glass effects throughout: backdrop-filter blur (12px-24px), subtle white borders (0.5px-1px rgba(255,255,255,0.2)), inner glow, depth layering, translucent floating cards
- Color palette: Deep space black (#000000) / charcoal (#0A0A0F) backgrounds, pure white text, accent gradients (electric blue #007AFF → soft purple #BF5AF2 → coral #FF375F)
- Typography: SF Pro / Inter / similar clean sans-serif. Display 64px, H1 48px, H2 32px, Body 16px, Caption 14px
- Global smooth scroll with momentum (Lenis or native smooth-scroll)
- Custom cursor: dot + ring, expands on clickable elements, glassmorphism blend
- NO solid opaque backgrounds except deep blacks. NO default browser components. NO generic Bootstrap/Material UI. Respect prefers-reduced-motion.
- All animations must be 60fps. Use GPU-accelerated transforms only (translate3d, scale, opacity).

---

## PAGES & SECTIONS

### 1. HOME PAGE
- Hero: Full viewport, animated liquid glass blobs morphing in background (WebGL/Canvas or CSS), club name with character-by-character reveal animation, tagline "Where Design Meets Motion"
- Mission Statement: Scroll-triggered line-by-line text reveal (translateY 40px→0, opacity 0→1, stagger 0.1s)
- Stats: Animated counters with liquid glass floating cards, count-up on scroll
- Featured Artwork Marquee: Horizontal auto-scroll, pause on hover, glass overlay on thumbnails
- Upcoming Event Spotlight: Large glass card with live countdown timer, location pin animation

### 2. RESOURCES & PROGRESS TRACKING
- Roll Number Input: IITK format validation (YYXXXXX), liquid glass input field, loading shimmer state
- Unique ID Generation: On validation, display unique tracker ID with copy-to-clipboard animation
- Personal Dashboard:
  * Progress ring charts per domain (SVG stroke-dashoffset animate on scroll, 1.5s)
  * YouTube resource cards with thumbnail, title, duration, custom animated checkbox
  * Streak counter with flame animation
  * Domain categories: UI/UX, Illustrator, Photoshop, 3D Animation, After Effects, Figma, Blender
- STRICT DATA ISOLATION: Users only see their own progress. Roll number → Unique ID mapping only. localStorage fallback.

### 3. ARTWORK GALLERY
- Filter pills: All, UI/UX, Illustrator, Photoshop, 3D Animation, Motion Graphics, Photography
- Masonry/Pinterest grid with aspect-ratio preservation, lazy loading blur-up effect
- Artwork cards: Thumbnail, artist name, domain tag, like count, glass info overlay on hover
- POPUP DETAIL VIEW:
  * Full-resolution artwork with custom pan/zoom (NOT browser zoom, momentum-based)
  * Artist avatar + info
  * Like button: Heart fill + 8-particle radial burst animation
  * Comment system: Nested replies, timestamps, user avatars (requires Unique ID, read-only for guests)
  * Share button with Web Share API
  * Close: Swipe down mobile, X button rotation desktop, ESC key, backdrop click
- Progressive image loading: Low-res → High-res. Keyboard navigation (arrow keys between artworks).

### 4. EVENTS
- Event cards: Date badge (day/month, 3D flip on hover), time + clock icon, location + map pin, description, Register CTA
- States: Upcoming (active), Live (pulsing red glow), Past (grayscale + 50% opacity)
- Calendar/List toggle with morphing transition
- Registration form: Name, roll number, email — success confetti + glass modal slide-up

### 5. TEAM
- 2 Coordinators: Large portrait photos, names, roles, social links
- Secretaries: Grid layout, consistent card design
- Portrait parallax: Image moves opposite cursor (10px range)
- Card 3D tilt on hover (perspective + rotateX/Y based on mouse position)
- Social icons: Scale + color fill + bounce easing

### 6. CLUB ARTWORKS (Public Gallery)
- Same as Artwork Gallery but exclusively for club-created works
- Click artwork → same popup modal with like/comment/share

---

## ADMIN DASHBOARD (COMPREHENSIVE CMS)

### ADMIN AUTHENTICATION
- Login page: Password field with liquid glass styling, visibility toggle, SHAKE animation on wrong password, lock icon morphs to unlock on success
- Password must be hashed (bcrypt/argon2). Session timeout: 30 minutes.
- Protected routes: Redirect unauthenticated users to login. NO localStorage for auth tokens (use httpOnly cookies or secure session storage).

### ADMIN DASHBOARD LAYOUT
- Sidebar navigation: Glassmorphism, active indicator slides to selected item, icons + labels
- Top bar: Admin profile, logout, real-time notification bell
- Breadcrumb navigation with glass styling

### CONTENT MANAGEMENT MODULES

#### A. HOMEPAGE EDITOR
- Edit hero text (club name, tagline) with live preview
- Replace hero background blobs (upload video/WebGL shader code)
- Edit mission statement text with rich text formatting
- Update stats numbers (members count, workshops, artworks)
- Toggle featured artwork marquee on/off
- Upload/replace event spotlight content
- ALL changes reflect immediately in live preview panel

#### B. RESOURCES MANAGER
- CRUD for YouTube resources: Title, URL, thumbnail upload, duration, assigned domain, difficulty level
- Set prerequisites (completion of Resource A required before Resource B)
- View global analytics: Most watched resources, completion rates per domain, active users count
- Manage user progress: Search by roll number, view individual dashboards, reset progress
- Export data: CSV/JSON download of all user progress

#### C. ARTWORK MODERATION
- Approve/reject pending artwork submissions with glass card preview
- Feature/unfeature artworks (controls homepage marquee + gallery priority)
- Edit artwork metadata: Title, artist name, domain, description
- Delete artworks with shake + red flash confirmation
- Bulk actions: Select multiple, approve/reject/delete batch

#### D. EVENTS MANAGER
- CRUD events: Title, date-time picker, location, description, registration link, max capacity
- Upload event cover image
- Toggle event status: Draft → Upcoming → Live → Past
- View registrants list per event with roll number, name, email
- Export registrants to CSV
- Clone past event to create new (duplicate with editable fields)

#### E. TEAM MANAGER
- Upload coordinator/secretary photos (auto-crop to consistent aspect ratio)
- Edit names, roles, social media links
- Reorder team members with drag-and-drop (glass ghost preview while dragging)
- Toggle visibility (show/hide members without deleting)

#### F. WEBSITE SETTINGS
- Global theme controls: Accent color shifts, glass blur intensity (slider 8px-32px)
- Animation speed toggle: Slow / Normal / Fast (affects all transition durations)
- Maintenance mode toggle with custom message editor
- SEO settings: Meta title, description, OG image upload

### ADMIN ANIMATIONS
- Sidebar: Active indicator slides with spring physics (not linear)
- Tables: Row hover with glass highlight, sort columns with smooth reorder animation
- Forms: Floating labels, input focus with glow expansion
- Save button: Morphs to checkmark icon on success, toast notification slides from top-right with glassmorphism
- Delete: Shake + red border pulse, confirmation modal scales in with backdrop blur
- Drag-and-drop: Glass ghost card follows cursor, drop zone highlights with animated border
- Data tables: Skeleton loading states, infinite scroll with glass shimmer

---

## TECHNICAL REQUIREMENTS

- Framework: React 18+ / Next.js 14+ with App Router OR Vue 3 / Nuxt 3
- Animation: GSAP + ScrollTrigger (complex timelines), Framer Motion (gestures/layout), Lottie (complex icons)
- Styling: Tailwind CSS with custom glass utilities (backdrop-blur-xl, bg-white/5, border-white/10, shadow-glass)
- State Management: Zustand / Redux Toolkit (global UI + auth), React Query (server state)
- Icons: Lucide React, custom animated SVGs
- Images: Next-Image optimization, WebP/AVIF format, blur placeholder
- Forms: React Hook Form + Zod validation
- Backend/API: Next.js API routes / Express (if separate) with Prisma ORM + PostgreSQL OR MongoDB
- Auth: NextAuth.js / Lucia Auth with bcrypt password hashing
- Real-time: Server-Sent Events or WebSocket for live admin notifications

---

## CRITICAL CONSTRAINTS

DO:
- 60fps animations, GPU transforms only
- Semantic HTML + ARIA labels, full keyboard navigation
- Mobile-first responsive design
- Image optimization, lazy loading, blur placeholders
- Intersection Observer for scroll triggers (NOT constant scroll listeners)
- Cache API responses, debounce search inputs
- Dark mode default, glassmorphism everywhere

DON'T:
- Solid opaque backgrounds (except deep blacks)
- Default browser components without heavy customization
- Heavy unoptimized assets
- Ignore accessibility (screen readers, keyboard nav, focus states)
- Light mode as primary
- Require mouse for all interactions
- Uncompressed PNGs/JPEGs
- Expose other users' data (strict isolation per unique ID)
- Store plain text passwords anywhere

---

## PHASE ORDER (Build in this sequence)

1. Design System + Navigation + Global scroll/smoothness
2. Home Page (all hero + scroll animations)
3. Team Section (simplest, establish card patterns)
4. Events Section (card + form patterns)
5. Artwork Gallery (complex grid + modal interactions)
6. Resources + Progress Tracking (data structure + auth flow)
7. Admin Dashboard (authentication + ALL CMS modules)
8. Global polish: Custom cursor, loading screen, 404 page, footer, sound design (muted default), performance optimization

---

## SUCCESS METRICS

- Lighthouse Performance: >90
- Lighthouse Accessibility: >95
- First Contentful Paint: <1.5s
- Time to Interactive: <3.5s
- Animation: Consistent 60fps on mid-tier devices
- Admin dashboard load: <2s for all modules

---

FINAL INSTRUCTION: This is a PREMIUM PRODUCT WEBSITE, not a generic college page. Every animation, transition, and micro-interaction must justify the "UI is everything" philosophy. The Liquid Glass aesthetic should feel native and physical, not like an overlay. Build it as if Apple designed a design club website.