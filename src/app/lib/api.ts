const BASE = (import.meta.env.VITE_API_BASE_URL ?? '') + '/api';
export const API_BASE = BASE;

export interface LiveSession {
  id: string;
  title: string;
  host: string;
  meet_link: string | null;
  scheduled_at: string;
  status: 'upcoming' | 'live' | 'ended';
  audience_group_id: string | null;
  audience_name: string | null;
  description: string | null;
  created_at: string;
  canAccess: boolean;
}

export interface AudienceGroup {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
}

export interface SessionJoin {
  roll_number: string;
  name: string | null;
  joined_at: string;
}

export interface SessionJoins {
  session_id: string;
  count: number;
  joins: SessionJoin[];
}

export interface EventRegistrant {
  roll_number: string;
  name: string | null;
  email: string | null;
  rsvped_at: string | null;
}

export interface EventRegistrants {
  event_id: string;
  count: number;
  registrants: EventRegistrant[];
}

export interface PastSession {
  id: string;
  title: string;
  host: string;
  scheduled_at: string;
  status: string;
  audience_name: string | null;
  join_count: number;
  description: string | null;
}

export interface StudentBatchCount {
  batch: string;
  count: number;
}

export interface DailyActivityDay {
  date: string; // YYYY-MM-DD
  batches: Record<string, number>;
  total: number;
}

export interface DailyActivity {
  since: string;
  days: DailyActivityDay[];
}

export interface StudentOverview {
  total: number;
  active7d: number;
  active30d: number;
  batches: StudentBatchCount[];
  // null until MIN_DAYS_OF_DATA worth of login_events has accumulated —
  // render a "collecting data" placeholder instead of a sparse chart.
  dailyActivity: DailyActivity | null;
  collectingSince: string | null;
}

export interface StudentRosterEntry {
  roll_number: string;
  name: string | null;
  registered_at: string;
  last_login: string | null;
}

export interface BoardMember {
  roll_number: string;
  name: string | null;
  added_at: string;
}

export interface BoardItem {
  id: string;
  board_id: string;
  image_url: string;
  note: string | null;
  source_url: string | null;
  added_by_roll: string;
  added_by_name: string | null;
  created_at: string;
  // Set once the item has been placed on the saved canvas; the board
  // endpoints only return rows where this is still null (pending).
  placed_at?: string | null;
}

export interface Board {
  id: string;
  owner_roll: string;
  owner_name: string | null;
  name: string;
  description: string | null;
  visibility: 'private' | 'shared';
  room_id: string | null;
  edit_mode: 'members_only' | 'anyone';
  // Visible canvas items (+ not-yet-placed gallery items) — see
  // backend lib/boardRows.ts BOARD_ITEM_COUNT_SQL.
  item_count: number;
  // Card preview primitives derived server-side from the persisted canvas
  // (backend lib/canvasSummary.ts); null for an empty board. Optional:
  // not every endpoint returning a Board includes it.
  canvas_preview?: CanvasPreview | null;
  // Board LIST responses only (read-time, never stored): original preview
  // image src → its ready t512 thumbnail URL. Absent src = use the original.
  preview_thumbnails?: Record<string, string>;
  member_count: number;
  created_at: string;
  updated_at: string;
  is_archived: boolean;
  is_favorite: boolean;
  thumbnail_url: string | null;
  realtime_enabled: boolean;
  workspace_id: string;
  // V2.2 Projects layer — null means "ungrouped, workspace-level board",
  // a permanent valid state, not a migration placeholder. Every V1/V2.0
  // board stays null unless explicitly moved into a project.
  project_id: string | null;
  // Display-only, joined server-side (GET /api/boards only, for the
  // MoodboardsPage card grid) — not present on every board response
  // (e.g. GET /api/boards/:id detail doesn't join it, since BoardPage's
  // canvas UI has no project-association display today); optional so
  // TypeScript reflects that honestly rather than claiming it's always
  // populated.
  project_name?: string | null;
}

export interface BoardDetail extends Board {
  items: BoardItem[];
  members: BoardMember[];
}

// Workspace/organization layer — mirrors backend/src/routes/workspaces.ts's
// response shapes. `role` on Workspace is the CALLER's role in that
// workspace (owner/admin/member), joined server-side per-request — it is
// NOT a property of the workspace itself, so it changes per viewer.
export interface Workspace {
  id: string;
  name: string;
  is_personal: boolean;
  owner_roll: string;
  created_at: string;
  role: 'owner' | 'admin' | 'member';
  member_count: number;
  board_count: number;
}

export interface WorkspaceMember {
  roll_number: string;
  name: string | null;
  role: 'owner' | 'admin' | 'member';
  added_at: string;
}

export interface WorkspaceDetail extends Workspace {
  members: WorkspaceMember[];
}

// Projects (V2.2) — mirrors backend/src/routes/projects.ts. A pure
// organizational grouping between a workspace and its boards; no
// project-level role — access is entirely derived from the caller's
// workspace_members row (see api.workspaces above), never stored here.
export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  owner_roll: string;
  owner_name: string | null;
  created_at: string;
  is_archived: boolean;
  board_count: number;
}

// Templates (V2.3) — mirrors backend/src/routes/templates.ts's
// toPublicTemplate(). No canvas_data here (never sent to the list/detail
// response — only POST /:id/use reads it, server-side); no template-level
// role — access is entirely derived from workspace_members, same as
// Project above. source_board_id is provenance only (the board a
// template was originally saved from), never a live dependency — it may
// be null if that board was later deleted.
// Shared Creative Library — mirrors backend/src/lib/libraryVisibility.ts.
// personal: only the owner sees/uses it. community: every member of the
// item's workspace can discover and use it (never public, never another
// workspace). Only the owner manages it either way.
export type LibraryVisibility = 'personal' | 'community';
// List scope: all = mine + other members' community items; mine; community.
export type LibraryScope = 'all' | 'mine' | 'community';
// Admin moderation: a hidden item is out of every normal flow until an admin
// restores it (normal list/detail responses only ever contain 'active').
export type LibraryStatus = 'active' | 'hidden';
// Admin list filters (GET /…/admin/all) and the workspace label rows carry.
export interface LibraryAdminFilters { q?: string; status?: LibraryStatus | 'all'; visibility?: LibraryVisibility | 'all' }
interface LibraryAdminExtra { workspace_name: string; workspace_is_personal: boolean }

export interface Template {
  id: string;
  workspace_id: string;
  source_board_id: string | null;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  owner_roll: string;
  owner_name: string | null;
  created_at: string;
  is_archived: boolean;
  visibility: LibraryVisibility;
  status: LibraryStatus;
}
export type AdminTemplate = Template & LibraryAdminExtra;

// Mirrors backend/src/routes/assets.ts's toPublicAsset() — note there is
// no storage_key here (an internal StorageProvider path, never sent to
// the frontend); `url` is the derived public URL the backend already
// resolved via getStorage().getPublicUrl().
// Mirrors backend/src/lib/canvasSummary.ts's CanvasPreview.
export interface CanvasPreviewItem {
  k: 'geo' | 'frame' | 'image' | 'note' | 'text' | 'path' | 'box';
  x: number; y: number; r: number; w: number; h: number;
  c?: string; g?: string; f?: string; src?: string; t?: string; fs?: number;
  p?: number[]; hl?: boolean; sw?: number;
}
export interface CanvasPreview {
  v: 1;
  x: number; y: number; w: number; h: number;
  items: CanvasPreviewItem[];
}

// Mirrors backend/src/routes/assets.ts's toPublicAsset(). kind 'image' is
// the only kind that can be inserted onto a board; 'file' is any other
// library resource (PSD/AI/PDF/ZIP/...), whose url is a download URL;
// 'link' is an external http(s) URL (link_url) with no stored object
// (url is null).
export type AssetKind = 'image' | 'file' | 'link';

export interface Asset {
  id: string;
  workspace_id: string;
  owner_roll: string;
  owner_name: string | null;
  kind: AssetKind;
  collection_id: string | null;
  extension: string | null;
  filename: string;
  link_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
  visibility: LibraryVisibility;
  status: LibraryStatus;
  url: string | null;
  // Read-time t512 WebP derivative of an image asset, set only when one is
  // ready (null otherwise). For card/preview rendering ONLY — `url` stays
  // the original for opening, downloading and placing on a board.
  thumb_url?: string | null;
}

export type AdminAsset = Asset & LibraryAdminExtra;

function libraryAdminQuery(filters: LibraryAdminFilters): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.visibility && filters.visibility !== 'all') params.set('visibility', filters.visibility);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// Mirrors backend/src/routes/assetCollections.ts.
export interface AssetCollection {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_by_roll: string;
  created_at: string;
  updated_at: string;
  asset_count: number;
}

// Mirrors backend/src/routes/notifications.ts's toPublicNotification().
// boardId/workspaceId/commentId are whichever subset the event type
// actually populates (see notificationService.ts's own comment on the
// type -> populated-columns mapping) — the frontend navigates using
// whichever of these is present, never assumes all three.
export type NotificationType =
  | 'board_shared' | 'workspace_added' | 'workspace_role_changed'
  | 'comment_created' | 'comment_replied' | 'comment_mentioned';

export interface Notification {
  id: string;
  actorRoll: string | null;
  actorName: string | null;
  type: NotificationType;
  boardId: string | null;
  boardName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  commentId: string | null;
  read: boolean;
  createdAt: string;
}

// Mirrors backend/src/realtime/history/versionStorage.ts's BoardVersion —
// deliberately metadata only, no snapshot content (see that file's own
// comment on why: the timeline list must stay cheap regardless of history
// length or board size — never download all snapshots on board open).
export type VersionTrigger =
  | 'explicit' | 'inactivity' | 'major_change' | 'restore' | 'rename' | 'archive';

export interface BoardVersion {
  id: string;
  boardId: string;
  createdByRoll: string | null;
  createdByName: string | null;
  createdAt: string;
  trigger: VersionTrigger;
  description: string | null;
  restoredFromVersionId: string | null;
}

export interface VersionPage {
  versions: BoardVersion[];
  hasMore: boolean;
}

// Mirrors backend/src/realtime/comments/commentsStorage.ts's BoardComment
// exactly (camelCase, same field set) — see that file's own comment on why
// comments are a dedicated table/type, never tldraw shape data.
export type CommentAnchorType = 'canvas' | 'shape';

export interface BoardComment {
  id: string;
  boardId: string;
  parentCommentId: string | null;
  authorRoll: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedByRoll: string | null;
  deletedAt: string | null;
  anchorType: CommentAnchorType;
  anchorShapeId: string | null;
  anchorX: number;
  anchorY: number;
  // Which tldraw page this anchor lives on (V2.6 Phase B). null for
  // comments created before pages were tracked — those render on every
  // page, preserving their pre-Phase-B behaviour. See CommentsOverlay.
  anchorPageId: string | null;
  content: string;
}

export type CommentEventType = 'create' | 'edit' | 'delete' | 'resolve' | 'reopen';

export interface CommentEvent {
  type: CommentEventType;
  comment: BoardComment;
}

// Mirrors backend/src/realtime/roomAccess.ts's RoomAccessDenialReason and
// RoomRole exactly (Commit 7) — the frontend's copy of the SAME enum
// values the server computes, never re-derived client-side. See
// TldrawCanvasSync.tsx for how each denial reason maps to a distinct
// user-facing message.
export type RoomAccessDenialReason =
  | 'realtime_disabled'
  | 'session_expired'
  | 'board_not_found'
  | 'board_archived'
  | 'permission_denied';

export type RoomRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export type RealtimeAccessCheck =
  | { ok: true; role: RoomRole; canWriteCanvas: boolean; canComment: boolean }
  | { ok: false; reason: RoomAccessDenialReason };

export interface AppSettings {
  public_meet_enabled: string;
  public_meet_passcode?: string;
}

export interface CoordinatorMember {
  roll_number: string;
  name: string;
  approved: boolean;
  added_at: string;
  email: string | null;
  registered_at: string | null;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  updated_at: string;
}

const ADMIN_TOKEN_KEY = 'dna_admin_token';
const STUDENT_TOKEN_KEY = 'dna_student_token';

export function getAdminToken(): string | null  { return sessionStorage.getItem(ADMIN_TOKEN_KEY); }
export function setAdminToken(token: string)    { sessionStorage.setItem(ADMIN_TOKEN_KEY, token); }
export function clearAdminToken()               { sessionStorage.removeItem(ADMIN_TOKEN_KEY); }

export function getStudentToken(): string | null { return localStorage.getItem(STUDENT_TOKEN_KEY); }
export function setStudentToken(token: string)   { localStorage.setItem(STUDENT_TOKEN_KEY, token); }
export function clearStudentToken()              { localStorage.removeItem(STUDENT_TOKEN_KEY); }

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; roll?: string; admin?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Student identity travels as a signed JWT (Bearer), not a spoofable roll header.
  // `roll` is retained by callers only to build resource paths.
  if (opts.admin) {
    const tok = getAdminToken(); if (tok) headers['Authorization'] = `Bearer ${tok}`;
  } else if (opts.roll !== undefined) {
    const tok = getStudentToken(); if (tok) headers['Authorization'] = `Bearer ${tok}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json() as T | { error: unknown };
  if (res.status === 401 && opts.admin) { clearAdminToken(); throw new Error('SESSION_EXPIRED'); }
  if (res.status === 401 && opts.roll !== undefined) { clearStudentToken(); throw new Error('SESSION_EXPIRED'); }
  if (!res.ok) throw new Error(String((data as { error: unknown }).error ?? res.statusText));
  return data as T;
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const tok = getAdminToken();
  if (tok) headers['Authorization'] = `Bearer ${tok}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData });
  if (res.status === 204) return undefined as T;
  const data = await res.json() as T | { message?: unknown; error?: unknown };
  if (!res.ok) {
    console.log('Upload error response:', data);
    const d = data as { message?: unknown; error?: unknown };
    const msg = d.message ?? d.error ?? res.statusText;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}

async function uploadPutRequest<T>(path: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const tok = getAdminToken();
  if (tok) headers['Authorization'] = `Bearer ${tok}`;
  const res = await fetch(`${BASE}${path}`, { method: 'PUT', headers, body: formData });
  if (res.status === 204) return undefined as T;
  const data = await res.json() as T | { message?: unknown; error?: unknown };
  if (!res.ok) {
    console.log('Upload error response:', data);
    const d = data as { message?: unknown; error?: unknown };
    const msg = d.message ?? d.error ?? res.statusText;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}

async function studentUploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const tok = getStudentToken();
  if (tok) headers['Authorization'] = `Bearer ${tok}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData });
  const data = await res.json() as T | { message?: unknown; error?: unknown };
  if (res.status === 401) { clearStudentToken(); throw new Error('SESSION_EXPIRED'); }
  if (!res.ok) {
    const d = data as { message?: unknown; error?: unknown };
    const msg = d.message ?? d.error ?? res.statusText;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export const api = {
  auth: {
    adminLogin: (password: string) =>
      request<{ token: string }>('POST', '/auth/admin/login', { body: { password } }),
  },
  domains: {
    list: () => request<Record<string, unknown>>('GET', '/domains'),
    submitQuiz: (domainId: string, roll: string, answers: number[]) =>
      request<{ passed: boolean; correct: number; total: number; results: boolean[] }>(
        'POST', `/domains/${domainId}/quiz/submit`, { body: { answers }, roll }),
    create: (domain: { title: string; fullName: string; icon: string; tagline: string; description: string; color: string }) =>
      request<unknown>('POST', '/domains', { body: domain, admin: true }),
    update: (id: string, data: object) => request<unknown>('PUT', `/domains/${id}`, { body: data, admin: true }),
    delete: (id: string) => request<void>('DELETE', `/domains/${id}`, { admin: true }),
    addVideo: (domainId: string, video: { title: string; ytUrl: string; difficulty: string; duration: string; sequence?: number }) =>
      request<unknown>('POST', `/domains/${domainId}/videos`, { body: video, admin: true }),
    updateVideo: (domainId: string, videoId: string, data: object) =>
      request<unknown>('PUT', `/domains/${domainId}/videos/${videoId}`, { body: data, admin: true }),
    deleteVideo: (domainId: string, videoId: string) =>
      request<void>('DELETE', `/domains/${domainId}/videos/${videoId}`, { admin: true }),
    patchVideoSequence: (domainId: string, videoId: string, sequence: number) =>
      request<unknown>('PATCH', `/domains/${domainId}/videos/${videoId}`, { body: { sequence }, admin: true }),
  },
  artworks: {
    list:    (roll?: string) => request<unknown[]>('GET', '/artworks', { roll }),
    upload:  (formData: FormData) => uploadRequest<unknown>('/artworks', formData),
    update:  (id: string, formData: FormData) => uploadPutRequest<unknown>(`/artworks/${id}`, formData),
    delete:  (id: string)   => request<void>('DELETE', `/artworks/${id}`, { admin: true }),
    like:    (id: string, roll: string) =>
      request<{ likes: number; likedByUser: boolean }>('POST', `/artworks/${id}/like`, { roll }),
    addComment: (id: string, roll: string, sender: string, text: string) =>
      request<{ id: string; sender: string; text: string; date: string }>('POST', `/artworks/${id}/comments`, { body: { sender, text }, roll }),
    toggleFeatured: (id: string, featured: boolean) =>
      request<{ id: string; featured: boolean }>('PATCH', `/artworks/${id}/featured`, { body: { featured }, admin: true }),
    deleteComment: (artworkId: string, commentId: string) =>
      request<void>('DELETE', `/artworks/${artworkId}/comments/${commentId}`, { admin: true }),
  },
  events: {
    list: (roll?: string) => request<unknown[]>('GET', '/events', { roll }),
    add:  (event: { title: string; date: string; time: string; location: string; content: string; capacity: number; startsAt?: string | null }) =>
      request<unknown>('POST', '/events', { body: event, admin: true }),
    update: (id: string, data: object) => request<unknown>('PUT', `/events/${id}`, { body: data, admin: true }),
    delete: (id: string)  => request<void>('DELETE', `/events/${id}`, { admin: true }),
    rsvp:  (id: string, roll: string) =>
      request<{ registeredCount: number; isRegistered: boolean }>('POST', `/events/${id}/rsvp`, { roll }),
    registrants: (id: string) =>
      request<EventRegistrants>('GET', `/events/${id}/registrants`, { admin: true }),
  },
  team: {
    list:   () => request<unknown[]>('GET', '/team'),
    add:    (formData: FormData) => uploadRequest<unknown>('/team', formData),
    update: (id: number, formData: FormData) => uploadPutRequest<unknown>(`/team/${id}`, formData),
    delete:     (id: number) => request<void>('DELETE', `/team/${id}`, { admin: true }),
    patchOrder: (id: number, displayOrder: number) =>
      request<void>('PATCH', `/team/${id}/order`, { body: { display_order: displayOrder }, admin: true }),
  },
  notify: {
    // Send the student notification for an already-created event/artwork, keyed
    // by id. The server reads the record, sends, and stamps notified_at (returned
    // here so the UI badge updates without a refetch). Because Resend's free
    // tier caps daily/monthly volume, a send may not fully complete immediately:
    // sentNow is what went out now, queued is what's waiting for a later tick
    // (see mailer.ts sendBroadcast / drainMailQueue).
    // audience: 'all' (default, every student) or 'registered' (only students
    // who RSVP'd to this event). Artwork has no RSVP concept, so it's always 'all'.
    event: (
      id: string,
      data?: {
        audienceType?: 'all' | 'registered' | 'active';
        batch?: string | null;
        limit?: number;
        excludeEventIds?: string[];
        excludeCampaignIds?: string[];
      }
    ) =>
      request<{ success: boolean; notifiedAt: string; sentNow: number; queued: number; totalEligible: number; campaignId: string }>(
        'POST',
        `/notify/event/${id}`,
        { body: data, admin: true }
      ),
    artwork: (id: string) =>
      request<{ success: boolean; notifiedAt: string; sentNow: number; queued: number }>('POST', `/notify/artwork/${id}`, { admin: true }),
    getBatches: () =>
      request<{ batches: string[] }>('GET', '/notify/batches', { admin: true }),
    getUsage: () =>
      request<{ dailyLimit: number; sentToday: number; remainingToday: number; broadcastBudget: number }>('GET', '/notify/usage', { admin: true }),
    getPastCampaigns: () =>
      request<{ campaigns: Array<{ id: string; eventId: string | null; eventTitle: string | null; title: string; sentCount: number; createdAt: string }> }>('GET', '/notify/past-campaigns', { admin: true }),
    preview: (data: {
      eventId?: string;
      audienceType: 'all' | 'registered' | 'active';
      batch?: string | null;
      limit?: number;
      excludeEventIds?: string[];
      excludeCampaignIds?: string[];
    }) =>
      request<{
        totalEligible: number;
        requestedLimit: number;
        candidates: Array<{
          rollNumber: string;
          name: string | null;
          email: string;
          batch: string;
          activityScore: number;
          breakdown: {
            recencyScore: number;
            loginScore: number;
            rsvpScore: number;
            sessionScore: number;
            learningScore: number;
            daysSinceLastLogin: number | null;
          };
          lastLogin: string | null;
          registeredAt: string;
        }>;
        quotaStatus: {
          dailyQuota: number;
          sentToday: number;
          remainingToday: number;
          otpReserve: number;
          broadcastBudget: number;
          willExceed: boolean;
          sentNowCount: number;
          queuedCount: number;
        };
      }>('POST', '/notify/preview', { body: data, admin: true }),
    // Preview the exact email + recipient count for the admin confirm dialog.
    previewEvent: (id: string, audience: 'all' | 'registered' | 'active' = 'all') =>
      request<{ subject: string; html: string; recipientCount: number }>('GET', `/notify/event/${id}/preview?audience=${audience}`, { admin: true }),
    previewArtwork: (id: string) =>
      request<{ subject: string; html: string; recipientCount: number }>('GET', `/notify/artwork/${id}/preview`, { admin: true }),
    getTemplates: () =>
      request<EmailTemplate[]>('GET', '/notify/templates', { admin: true }),
    getTemplate: (id: string) =>
      request<EmailTemplate>('GET', `/notify/templates/${id}`, { admin: true }),
    updateTemplate: (id: string, data: { subject: string; body: string }) =>
      request<EmailTemplate>('PUT', `/notify/templates/${id}`, { body: data, admin: true }),
    previewTemplate: (id: string, data: { subject: string; body: string }) =>
      request<{ subject: string; html: string; variables: string[] }>(
        'POST', `/notify/templates/${id}/preview`, { body: data, admin: true }),
    sendTemplateTest: (id: string, data: { email: string; subject: string; body: string }) =>
      request<{ success: boolean; sentTo: string }>(
        'POST', `/notify/templates/${id}/test`, { body: data, admin: true }),
    sendAnnouncement: (data: { subject: string; html: string }) =>
      request<{ success: boolean; message: string; sent: number; queued: number }>('POST', '/notify/announce', { body: data, admin: true }),
  },
  students: {
    checkExists: (roll: string) =>
      request<{ exists: boolean; hasProfile: boolean }>('GET', `/students/${roll}/exists`),
    // Step 1: request a 6-digit code by email. New users must pass name + email.
    requestOtp: (rollNumber: string, opts?: { name?: string; email?: string }) =>
      request<{ sent: boolean; isNew: boolean; email: string }>(
        'POST', '/auth/student/request-otp', { body: { rollNumber, ...opts } }),
    // Step 2: verify the code; on success the server returns a signed student JWT.
    verifyOtp: (rollNumber: string, code: string) =>
      request<{
        token: string;
        isNew: boolean;
        session: { rollNumber: string; uniqueId: string; registeredAt: string; name: string; email: string };
        progress: { watchedVideos: string[]; completedQuizzes: string[] };
      }>('POST', '/auth/student/verify-otp', { body: { rollNumber, code } }),
    // Temporary email-delivery-incident bypass — only usable while an admin has
    // enabled it (see settings.getPublic's student_otp_bypass_enabled), and only
    // for a roll number that already has a verified profile. Issues a short-lived
    // (1-day) token instead of the normal 90-day one.
    bypassLogin: (rollNumber: string) =>
      request<{
        token: string;
        isNew: boolean;
        session: { rollNumber: string; uniqueId: string; registeredAt: string; name: string; email: string };
        progress: { watchedVideos: string[]; completedQuizzes: string[] };
      }>('POST', '/auth/student/bypass-login', { body: { rollNumber } }),
    markVideoWatched:   (roll: string, videoId: string) => request<void>('POST', `/students/${roll}/progress/videos/${videoId}`, { roll }),
    unmarkVideoWatched: (roll: string, videoId: string) => request<void>('DELETE', `/students/${roll}/progress/videos/${videoId}`, { roll }),
    // Email change (OTP-gated, sent to the NEW address). `roll` is passed only so
    // the student JWT is attached; the server derives identity from the token.
    requestEmailChange: (roll: string, email: string) =>
      request<{ sent: boolean; email: string }>('POST', '/auth/student/change-email/request', { body: { email }, roll }),
    verifyEmailChange: (roll: string, code: string) =>
      request<{ success: boolean; email: string }>('POST', '/auth/student/change-email/verify', { body: { code }, roll }),
    // Admin-only — powers the Overview tab's stat cards and batch chart.
    getOverview: () =>
      request<StudentOverview>('GET', '/students/overview', { admin: true }),
    // Public — just the registered-student total, for the homepage stat card.
    getCount: () =>
      request<{ total: number }>('GET', '/students/count'),
    // Admin-only — lightweight roster (no email) for the batch filter list.
    getRoster: () =>
      request<StudentRosterEntry[]>('GET', '/students', { admin: true }),
  },
  boards: {
    // workspaceId is optional and purely additive (workspace/organization
    // layer). Omitted, getMyBoards/getArchived keep their exact pre-
    // existing unscoped meaning ("every board I own or am a member of /
    // my own archived boards, across ALL of MY workspaces") — always
    // bounded by the caller's own ownership/membership, never global.
    // getShared, omitted, is scoped the same way (every shared board
    // across every workspace the caller is a MEMBER of) — see
    // backend/src/routes/boards.ts's own comment: as of V2.0 Phase 0
    // there is no unscoped-across-the-whole-app fallback for /shared
    // anymore (that was a cross-tenant leak once multiple workspaces
    // exist); passing workspaceId narrows to exactly that one workspace
    // and 403s a signed-in caller who isn't a member of it.
    getMyBoards: (roll: string, workspaceId?: string) =>
      request<Board[]>('GET', `/boards${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`, { roll }),
    getArchived: (roll: string, workspaceId?: string) =>
      request<Board[]>('GET', `/boards/archived${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`, { roll }),
    getShared: (roll?: string, workspaceId?: string) =>
      request<Board[]>('GET', `/boards/shared${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`, roll ? { roll } : {}),
    create: (roll: string, data: { name: string; description?: string; visibility?: 'private' | 'shared'; workspace_id?: string; project_id?: string }) =>
      request<Board>('POST', '/boards', { body: data, roll }),
    update: (id: string, roll: string, data: { name?: string; description?: string; visibility?: 'private' | 'shared'; edit_mode?: 'members_only' | 'anyone'; is_archived?: boolean; project_id?: string | null }) =>
      request<Board>('PUT', `/boards/${id}`, { body: data, roll }),
    getBoard: (id: string, roll?: string) =>
      request<BoardDetail>('GET', `/boards/${id}`, { roll }),
    delete: (id: string, roll: string) =>
      request<{ success: boolean }>('DELETE', `/boards/${id}`, { roll }),
    duplicate: (id: string, roll: string) =>
      request<Board>('POST', `/boards/${id}/duplicate`, { roll }),
    favorite: (id: string, roll: string) =>
      request<{ success: boolean; is_favorite: boolean }>('POST', `/boards/${id}/favorite`, { roll }),
    unfavorite: (id: string, roll: string) =>
      request<{ success: boolean; is_favorite: boolean }>('DELETE', `/boards/${id}/favorite`, { roll }),
    // Board items API — kept for potential future use
    // Currently the canvas uses Excalidraw for content
    getItems: (id: string, roll?: string) =>
      request<BoardItem[]>('GET', `/boards/${id}/items`, { roll }),
    addItem: (boardId: string, roll: string, data: { image_url: string; note?: string; source_url?: string }) =>
      request<BoardItem>('POST', `/boards/${boardId}/items`, { body: data, roll }),
    deleteItem: (boardId: string, itemId: string, roll: string) =>
      request<{ success: boolean }>('DELETE', `/boards/${boardId}/items/${itemId}`, { roll }),
    addMember: (boardId: string, roll: string, memberRoll: string) =>
      request<{ success: boolean; name: string | null }>('POST', `/boards/${boardId}/members`, { body: { roll_number: memberRoll }, roll }),
    removeMember: (boardId: string, roll: string, memberRoll: string) =>
      request<{ success: boolean }>('DELETE', `/boards/${boardId}/members/${memberRoll}`, { roll }),
    adminGetAll: () =>
      request<Board[]>('GET', '/boards/admin/all', { admin: true }),
    adminDelete: (id: string) =>
      request<{ success: boolean }>('DELETE', `/boards/admin/${id}`, { admin: true }),
    adminUpdate: (id: string, data: { visibility?: 'private' | 'shared'; edit_mode?: 'members_only' | 'anyone' }) =>
      request<Board>('PUT', `/boards/admin/${id}`, { body: data, admin: true }),
    saveCanvas: (boardId: string, roll: string, canvasData: string) =>
      request<{ success: boolean }>(
        'PUT', `/boards/${boardId}/canvas`,
        { body: { canvas_data: canvasData }, roll }
      ),
    loadCanvas: (boardId: string, roll?: string) =>
      request<{ canvas_data: string | null }>(
        'GET', `/boards/${boardId}/canvas`,
        roll ? { roll } : {}
      ),
    uploadCanvasFile: (boardId: string, file: File, fileId: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fileId', fileId);
      return studentUploadRequest<{ fileId: string; url: string }>(
        `/boards/${boardId}/canvas-files`, formData
      );
    },
    // Builds the @tldraw/sync connection URL for a realtime-enabled board's
    // room. This is the ONLY thing the frontend knows about realtime
    // persistence — everything past this URL (Postgres, canvas_data,
    // snapshot load/save timing, room lifecycle/cleanup) is entirely a
    // backend concern (see backend/src/realtime/). `roomId` is board.room_id,
    // not board.id — the backend keys rooms by room_id specifically so a
    // board's primary key is never exposed over the realtime protocol.
    // sessionId/storeId are NOT appended here: @tldraw/sync's own useSync
    // hook appends those itself (tab-scoped via tldraw's TAB_ID), and
    // minting our own would break its reconnect-resumes-the-same-session
    // behavior — see backend/src/realtime/connectionHandler.ts's matching
    // comment on the server side of this same contract.
    getRealtimeUrl: (roomId: string): string => {
      const token = getStudentToken();
      // BASE may be a bare path ("/api", when VITE_API_BASE_URL is unset —
      // REST calls resolve that fine via fetch()'s implicit same-origin
      // base, but `new URL()` needs an explicit one) or a full origin
      // ("https://api.example.com/api"). window.location.origin covers
      // both: it's a no-op base when BASE is already absolute.
      const url = new URL(`${BASE}/realtime/boards/${roomId}`, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      if (token) url.searchParams.set('token', token);
      return url.toString();
    },
    // Version history (Commit 5) — lazily called only when the Version
    // History panel is actually opened (see VersionHistoryPanel.tsx), never
    // on board load, per the "never download all snapshots on board open"
    // requirement — this endpoint doesn't return snapshot content at all,
    // only metadata, so it's cheap even so.
    getVersions: (boardId: string, roll: string, opts?: { limit?: number; before?: string }) => {
      const params = new URLSearchParams();
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (opts?.before) params.set('before', opts.before);
      const qs = params.toString();
      return request<VersionPage>('GET', `/boards/${boardId}/versions${qs ? `?${qs}` : ''}`, { roll });
    },
    createVersion: (boardId: string, roll: string, description?: string) =>
      request<BoardVersion>('POST', `/boards/${boardId}/versions`, { body: { description }, roll }),
    restoreVersion: (boardId: string, roll: string, versionId: string) =>
      request<{ success: boolean; version: BoardVersion; hadLiveRoom: boolean }>(
        'POST', `/boards/${boardId}/versions/${versionId}/restore`, { roll }
      ),
    // Comments (Commit 6). REST is the source of truth (initial load, and
    // the only way to mutate — see backend/src/routes/comments.ts's own
    // "do NOT trust the client" note: every write is server-validated
    // here, never assumed from a WS message); getCommentsRealtimeUrl below
    // is the live-delta channel, deliberately separate from
    // getRealtimeUrl's tldraw document sync (see
    // backend/src/realtime/comments/commentBroadcaster.ts for why).
    getComments: (boardId: string, roll: string, opts?: { includeResolved?: boolean }) =>
      request<{ comments: BoardComment[] }>(
        'GET', `/boards/${boardId}/comments${opts?.includeResolved ? '?includeResolved=true' : ''}`, { roll }
      ),
    createComment: (boardId: string, roll: string, data: {
      content: string;
      parentCommentId?: string;
      anchorType?: CommentAnchorType;
      anchorShapeId?: string;
      anchorX?: number;
      anchorY?: number;
      anchorPageId?: string;
    }) =>
      request<BoardComment>('POST', `/boards/${boardId}/comments`, { body: data, roll }),
    // Persistent per-(board, user) unread watermark (V2.6 Phase E).
    // lastSeenAt is null when this user has never opened the board's
    // comments, which the UI renders as "everything unread".
    getCommentReadState: (boardId: string, roll: string) =>
      request<{ lastSeenAt: string | null }>('GET', `/boards/${boardId}/comments/read-state`, { roll }),
    // The server stamps the time, so a client cannot mark itself read into
    // the future and permanently suppress real activity.
    markCommentsSeen: (boardId: string, roll: string) =>
      request<{ lastSeenAt: string }>('POST', `/boards/${boardId}/comments/read-state`, { roll }),
    editComment: (boardId: string, roll: string, commentId: string, content: string) =>
      request<BoardComment>('PUT', `/boards/${boardId}/comments/${commentId}`, { body: { content }, roll }),
    deleteComment: (boardId: string, roll: string, commentId: string) =>
      request<{ success: boolean }>('DELETE', `/boards/${boardId}/comments/${commentId}`, { roll }),
    resolveComment: (boardId: string, roll: string, commentId: string) =>
      request<BoardComment>('POST', `/boards/${boardId}/comments/${commentId}/resolve`, { roll }),
    reopenComment: (boardId: string, roll: string, commentId: string) =>
      request<BoardComment>('POST', `/boards/${boardId}/comments/${commentId}/reopen`, { roll }),
    // WS URL for live comment events — same URL-building approach as
    // getRealtimeUrl (token as a query param, ws(s) protocol swap), but a
    // DIFFERENT path suffix (/comments) that the backend's
    // connectionHandler.ts routes to CommentBroadcaster instead of
    // RoomManager/TLSocketRoom. No sessionId is appended here (unlike
    // getRealtimeUrl) — this channel has no per-session document state to
    // resume; a reconnect just starts receiving live events again, with
    // the REST GET above as the catch-up mechanism for whatever happened
    // while disconnected.
    getCommentsRealtimeUrl: (roomId: string): string => {
      const token = getStudentToken();
      const url = new URL(`${BASE}/realtime/boards/${roomId}/comments`, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      if (token) url.searchParams.set('token', token);
      return url.toString();
    },
  },
  // Workspace/organization layer — mirrors backend/src/routes/workspaces.ts.
  // Every board belongs to exactly one workspace (see boards.workspace_id);
  // this namespace manages the workspaces themselves and their membership,
  // separate from board-level sharing (visibility/edit_mode/board members),
  // which is untouched by any of this.
  workspaces: {
    list: (roll: string) =>
      request<Workspace[]>('GET', '/workspaces', { roll }),
    create: (roll: string, data: { name: string }) =>
      request<Workspace>('POST', '/workspaces', { body: data, roll }),
    get: (id: string, roll: string) =>
      request<WorkspaceDetail>('GET', `/workspaces/${id}`, { roll }),
    update: (id: string, roll: string, data: { name: string }) =>
      request<Workspace>('PUT', `/workspaces/${id}`, { body: data, roll }),
    delete: (id: string, roll: string) =>
      request<{ success: boolean }>('DELETE', `/workspaces/${id}`, { roll }),
    leave: (id: string, roll: string) =>
      request<{ success: boolean }>('POST', `/workspaces/${id}/leave`, { roll }),
    getMembers: (id: string, roll: string) =>
      request<WorkspaceMember[]>('GET', `/workspaces/${id}/members`, { roll }),
    addMember: (id: string, roll: string, memberRoll: string) =>
      request<{ success: boolean; name: string | null }>('POST', `/workspaces/${id}/members`, { body: { roll_number: memberRoll }, roll }),
    removeMember: (id: string, roll: string, memberRoll: string) =>
      request<{ success: boolean }>('DELETE', `/workspaces/${id}/members/${memberRoll}`, { roll }),
    setMemberRole: (id: string, roll: string, memberRoll: string, role: 'admin' | 'member') =>
      request<{ success: boolean; role: string }>('PUT', `/workspaces/${id}/members/${memberRoll}/role`, { body: { role }, roll }),
  },
  // Projects (V2.2) — mirrors backend/src/routes/projects.ts. workspace_id
  // is required on list (unlike boards.getMyBoards/getArchived, which
  // default to "across all my workspaces" when omitted) — a project has
  // no meaningful cross-workspace view, so this namespace never offers an
  // unscoped call shape to begin with.
  projects: {
    list: (roll: string, workspaceId: string) =>
      request<Project[]>('GET', `/projects?workspace_id=${encodeURIComponent(workspaceId)}`, { roll }),
    create: (roll: string, data: { workspace_id: string; name: string; description?: string }) =>
      request<Project>('POST', '/projects', { body: data, roll }),
    get: (id: string, roll: string) =>
      request<Project>('GET', `/projects/${id}`, { roll }),
    getBoards: (id: string, roll: string) =>
      request<Board[]>('GET', `/projects/${id}/boards`, { roll }),
    update: (id: string, roll: string, data: { name?: string; description?: string | null; is_archived?: boolean }) =>
      request<Project>('PATCH', `/projects/${id}`, { body: data, roll }),
    delete: (id: string, roll: string) =>
      request<{ success: boolean }>('DELETE', `/projects/${id}`, { roll }),
  },
  // Templates (V2.3) — mirrors backend/src/routes/templates.ts.
  // workspace_id is required on list, same reasoning as api.projects.list
  // above. create() takes source_board_id (never workspace_id — the
  // backend always derives it from the board, ignoring anything else
  // sent). use() creates a new, fully independent board from the
  // template's snapshot; project_id is optional and must belong to the
  // template's own workspace (enforced server-side).
  templates: {
    list: (roll: string, workspaceId: string, scope: LibraryScope = 'all') =>
      request<Template[]>('GET', `/templates?workspace_id=${encodeURIComponent(workspaceId)}&scope=${scope}`, { roll }),
    create: (roll: string, data: { name: string; description?: string; source_board_id: string; visibility?: LibraryVisibility }) =>
      request<Template>('POST', '/templates', { body: data, roll }),
    get: (id: string, roll: string) =>
      request<Template>('GET', `/templates/${id}`, { roll }),
    update: (id: string, roll: string, data: { name?: string; description?: string | null; is_archived?: boolean; visibility?: LibraryVisibility }) =>
      request<Template>('PATCH', `/templates/${id}`, { body: data, roll }),
    delete: (id: string, roll: string) =>
      request<{ success: boolean }>('DELETE', `/templates/${id}`, { roll }),
    use: (id: string, roll: string, data: { name?: string; project_id?: string }) =>
      request<Board>('POST', `/templates/${id}/use`, { body: data, roll }),
    // Admin moderation (admin token; requireAdmin server-side).
    adminList: (filters: LibraryAdminFilters = {}) =>
      request<{ templates: AdminTemplate[] }>('GET', `/templates/admin/all${libraryAdminQuery(filters)}`, { admin: true }),
    adminUpdate: (id: string, body: { visibility?: LibraryVisibility; status?: LibraryStatus }) =>
      request<AdminTemplate>('PATCH', `/templates/admin/${id}`, { body, admin: true }),
  },
  // Asset Manager (Phase B) — mirrors backend/src/routes/assets.ts. A
  // persistent, workspace-scoped file library, distinct from
  // boards.uploadCanvasFile (which stores objects the same way but keeps
  // no reusable/listable record — see that route's own comment).
  assets: {
    // opts.kind 'file' opts in to general (non-image) library files; an
    // allowlisted image is always stored as an image regardless.
    upload: (workspaceId: string, file: File, opts?: { kind?: 'file'; collectionId?: string | null; visibility?: LibraryVisibility }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workspace_id', workspaceId);
      formData.append('filename', file.name);
      if (opts?.kind) formData.append('kind', opts.kind);
      if (opts?.collectionId) formData.append('collection_id', opts.collectionId);
      if (opts?.visibility) formData.append('visibility', opts.visibility);
      return studentUploadRequest<Asset>('/assets', formData);
    },
    createLink: (roll: string, body: { workspace_id: string; name: string; url: string; collection_id?: string | null; visibility?: LibraryVisibility }) =>
      request<Asset>('POST', '/assets/links', { roll, body }),
    // collection_id: an id, or null to ungroup. filename: rename (owner only).
    // visibility: publish/unpublish (owner only).
    update: (roll: string, id: string, body: { filename?: string; collection_id?: string | null; visibility?: LibraryVisibility }) =>
      request<Asset>('PATCH', `/assets/${id}`, { roll, body }),
    // filters.collectionId: an id, or 'none' for ungrouped assets.
    list: (roll: string, workspaceId: string, cursor?: string, filters?: { kind?: AssetKind; q?: string; collectionId?: string; limit?: number; scope?: LibraryScope }) => {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (filters?.scope && filters.scope !== 'all') params.set('scope', filters.scope);
      if (cursor) params.set('cursor', cursor);
      if (filters?.kind) params.set('kind', filters.kind);
      if (filters?.collectionId) params.set('collection_id', filters.collectionId);
      if (filters?.q?.trim()) params.set('q', filters.q.trim());
      if (filters?.limit) params.set('limit', String(filters.limit));
      return request<{ assets: Asset[]; nextCursor: string | null }>('GET', `/assets?${params}`, { roll });
    },
    get: (roll: string, id: string) =>
      request<Asset>('GET', `/assets/${id}`, { roll }),
    delete: (roll: string, id: string) =>
      request<{ success: boolean; storageWarning?: string }>('DELETE', `/assets/${id}`, { roll }),
    // Admin moderation (admin token; requireAdmin server-side).
    adminList: (filters: LibraryAdminFilters = {}) =>
      request<{ assets: AdminAsset[] }>('GET', `/assets/admin/all${libraryAdminQuery(filters)}`, { admin: true }),
    adminUpdate: (id: string, body: { visibility?: LibraryVisibility; status?: LibraryStatus }) =>
      request<AdminAsset>('PATCH', `/assets/admin/${id}`, { body, admin: true }),
  },
  // Asset collections ("asset packs") — mirrors backend/src/routes/assetCollections.ts.
  assetCollections: {
    list: (roll: string, workspaceId: string) =>
      request<{ collections: AssetCollection[] }>('GET', `/asset-collections?workspace_id=${encodeURIComponent(workspaceId)}`, { roll }),
    create: (roll: string, body: { workspace_id: string; name: string; description?: string | null }) =>
      request<AssetCollection>('POST', '/asset-collections', { roll, body }),
    update: (roll: string, id: string, body: { name?: string; description?: string | null }) =>
      request<AssetCollection>('PATCH', `/asset-collections/${id}`, { roll, body }),
    delete: (roll: string, id: string) =>
      request<{ success: boolean; ungroupedAssets: number }>('DELETE', `/asset-collections/${id}`, { roll }),
  },
  // Basic Notifications (Phase C) — mirrors backend/src/routes/notifications.ts.
  // No realtime channel: the panel refetches on open (see NotificationBell.tsx).
  notifications: {
    list: (roll: string, opts?: { unreadOnly?: boolean; cursor?: string }) => {
      const params = new URLSearchParams();
      if (opts?.unreadOnly) params.set('unread_only', 'true');
      if (opts?.cursor) params.set('cursor', opts.cursor);
      const qs = params.toString();
      return request<{ notifications: Notification[]; unreadCount: number; nextCursor: string | null }>(
        'GET', `/notifications${qs ? `?${qs}` : ''}`, { roll }
      );
    },
    markRead: (roll: string, id: string) =>
      request<Notification>('POST', `/notifications/${id}/read`, { roll }),
    markAllRead: (roll: string) =>
      request<{ success: boolean; markedCount: number }>('POST', '/notifications/read-all', { roll }),
  },
  liveSessions: {
    getActive: (roll?: string) =>
      request<LiveSession[]>('GET', '/live-sessions/active', { roll }),
    getAll: () =>
      request<LiveSession[]>('GET', '/live-sessions', { admin: true }),
    getGroups: () =>
      request<AudienceGroup[]>('GET', '/live-sessions/groups', { admin: true }),
    create: (data: {
      title: string;
      host: string;
      meet_link: string;
      scheduled_at: string;
      audience_group_id: string | null;
      description?: string;
    }) => request<LiveSession>('POST', '/live-sessions', { body: data, admin: true }),
    updateStatus: (id: string, status: string) =>
      request<LiveSession>('PUT', `/live-sessions/${id}/status`, { body: { status }, admin: true }),
    update: (id: string, data: Partial<{
      title: string;
      host: string;
      meet_link: string;
      scheduled_at: string;
      audience_group_id: string | null;
      description: string;
    }>) => request<LiveSession>('PUT', `/live-sessions/${id}`, { body: data, admin: true }),
    delete: (id: string) =>
      request<void>('DELETE', `/live-sessions/${id}`, { admin: true }),
    trackJoin: (sessionId: string, roll: string) =>
      request<{ success: boolean }>('POST', `/live-sessions/${sessionId}/join`, { roll }),
    getJoins: (sessionId: string) =>
      request<SessionJoins>('GET', `/live-sessions/${sessionId}/joins`, { admin: true }),
    getJoinCount: (sessionId: string) =>
      request<{ count: number }>('GET', `/live-sessions/${sessionId}/joins/count`),
    getPast: () =>
      request<PastSession[]>('GET', '/live-sessions/past', { admin: true }),
    createPublic: (
      token: string,
      roll: string,
      data: {
        title: string;
        host: string;
        meet_link: string;
        scheduled_at: string;
        audience_group_id: string | null;
        description?: string;
      }
    ) =>
      request<LiveSession>(
        'POST', '/live-sessions/public',
        { body: { token, ...data }, roll }
      ),
    deletePublic: (id: string, token: string) =>
      request<{ success: boolean }>(
        'DELETE', `/live-sessions/public/${id}`,
        { body: { token } }
      ),
  },
  coordinators: {
    getAll: () =>
      request<CoordinatorMember[]>('GET', '/coordinators', { admin: true }),

    add: (roll_number: string, name: string) =>
      request<CoordinatorMember>('POST', '/coordinators', { body: { roll_number, name }, admin: true }),

    setApproval: (roll: string, approved: boolean) =>
      request<{ success: boolean; approved: boolean }>(
        'PUT', `/coordinators/${roll}/approve`,
        { body: { approved }, admin: true }
      ),

    remove: (roll: string) =>
      request<{ success: boolean }>('DELETE', `/coordinators/${roll}`, { admin: true }),

    check: (roll: string) =>
      request<{ canSchedule: boolean }>('GET', '/coordinators/check', { roll }),
  },
  settings: {
    getPublic: () =>
      request<Record<string, string>>('GET', '/settings/public'),
    getAll: () =>
      request<Record<string, string>>('GET', '/settings', { admin: true }),
    update: (data: Record<string, string>) =>
      request<{ success: boolean }>('PUT', '/settings', { body: data, admin: true }),
    verifyPasscode: (passcode: string) =>
      request<{ success: boolean; token: string }>(
        'POST', '/settings/verify-passcode',
        { body: { passcode } }
      ),
  },
  realtime: {
    // The global REALTIME_ENABLED kill switch's value, and nothing else —
    // see backend/src/routes/realtime.ts's own doc comment on why this is
    // unauthenticated and deliberately minimal. BoardPage combines this
    // with board.realtime_enabled to decide which canvas component to render.
    getStatus: () =>
      request<{ enabled: boolean }>('GET', '/realtime/status'),
    // Commit 7 — the REST pre-check TldrawCanvasSync.tsx calls BEFORE
    // opening the document-sync WebSocket, so a rejection reason
    // (permission_denied / session_expired / board_archived /
    // board_not_found / realtime_disabled) is known up front rather than
    // inferred from a WS close code — see backend/src/routes/realtime.ts's
    // own comment on why a close code alone isn't reliable here (any code
    // other than tldraw's own 4099 NOT_FOUND is treated as a transient
    // "offline" state by @tldraw/sync's ReconnectManager, which then
    // retries forever against a condition that will never change).
    getAccess: (roomId: string, roll: string) =>
      request<RealtimeAccessCheck>('GET', `/realtime/boards/${roomId}/access`, { roll }),
  },
};
