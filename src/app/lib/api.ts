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
  item_count: number;
  member_count: number;
  created_at: string;
}

export interface BoardDetail extends Board {
  items: BoardItem[];
  members: BoardMember[];
}

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
    event: (id: string, audience: 'all' | 'registered' = 'all') =>
      request<{ success: boolean; notifiedAt: string; sentNow: number; queued: number }>('POST', `/notify/event/${id}?audience=${audience}`, { admin: true }),
    artwork: (id: string) =>
      request<{ success: boolean; notifiedAt: string; sentNow: number; queued: number }>('POST', `/notify/artwork/${id}`, { admin: true }),
    // Preview the exact email + recipient count for the admin confirm dialog.
    previewEvent: (id: string, audience: 'all' | 'registered' = 'all') =>
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
  },
  boards: {
    getMyBoards: (roll: string) =>
      request<Board[]>('GET', '/boards', { roll }),
    getShared: () =>
      request<Board[]>('GET', '/boards/shared'),
    create: (roll: string, data: { name: string; description?: string; visibility?: 'private' | 'shared' }) =>
      request<Board>('POST', '/boards', { body: data, roll }),
    update: (id: string, roll: string, data: { name?: string; description?: string; visibility?: 'private' | 'shared'; edit_mode?: 'members_only' | 'anyone' }) =>
      request<Board>('PUT', `/boards/${id}`, { body: data, roll }),
    getBoard: (id: string, roll?: string) =>
      request<BoardDetail>('GET', `/boards/${id}`, { roll }),
    delete: (id: string, roll: string) =>
      request<{ success: boolean }>('DELETE', `/boards/${id}`, { roll }),
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
};
