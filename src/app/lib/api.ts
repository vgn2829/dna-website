const BASE = (import.meta.env.VITE_API_BASE_URL ?? '') + '/api';

const ADMIN_TOKEN_KEY = 'dna_admin_token';

export function getAdminToken(): string | null  { return sessionStorage.getItem(ADMIN_TOKEN_KEY); }
export function setAdminToken(token: string)    { sessionStorage.setItem(ADMIN_TOKEN_KEY, token); }
export function clearAdminToken()               { sessionStorage.removeItem(ADMIN_TOKEN_KEY); }

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; roll?: string; admin?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.roll)  headers['X-Roll-Number'] = opts.roll;
  if (opts.admin) { const tok = getAdminToken(); if (tok) headers['Authorization'] = `Bearer ${tok}`; }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json() as T | { error: unknown };
  if (res.status === 401 && opts.admin) { clearAdminToken(); throw new Error('SESSION_EXPIRED'); }
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
    add:  (event: { title: string; date: string; time: string; location: string; content: string; capacity: number }) =>
      request<unknown>('POST', '/events', { body: event, admin: true }),
    update: (id: string, data: object) => request<unknown>('PUT', `/events/${id}`, { body: data, admin: true }),
    delete: (id: string)  => request<void>('DELETE', `/events/${id}`, { admin: true }),
    rsvp:  (id: string, roll: string) =>
      request<{ registeredCount: number; isRegistered: boolean }>('POST', `/events/${id}/rsvp`, { roll }),
  },
  team: {
    list:   () => request<unknown[]>('GET', '/team'),
    add:    (formData: FormData) => uploadRequest<unknown>('/team', formData),
    update: (id: number, formData: FormData) => uploadPutRequest<unknown>(`/team/${id}`, formData),
    delete:     (id: number) => request<void>('DELETE', `/team/${id}`, { admin: true }),
    patchOrder: (id: number, displayOrder: number) =>
      request<void>('PATCH', `/team/${id}/order`, { body: { display_order: displayOrder }, admin: true }),
  },
  students: {
    createSession:     (rollNumber: string) =>
      request<{ session: { rollNumber: string; uniqueId: string; registeredAt: string }; progress: { watchedVideos: string[]; completedQuizzes: string[] } }>('POST', '/students/sessions', { body: { rollNumber } }),
    markVideoWatched:  (roll: string, videoId: string) => request<void>('POST', `/students/${roll}/progress/videos/${videoId}`, { roll }),
    unmarkVideoWatched:(roll: string, videoId: string) => request<void>('DELETE', `/students/${roll}/progress/videos/${videoId}`, { roll }),
    completeQuiz:      (roll: string, domainId: string) => request<void>('POST', `/students/${roll}/progress/quizzes/${domainId}`, { roll }),
  },
};
