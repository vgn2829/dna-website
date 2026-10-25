import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { applyRsvpResult, formActionLabel, safeFormUrl } from '../lib/eventForm';
import { useStudent } from './StudentContext';
import { toast } from 'sonner';

// Maps an RSVP failure to the existing user-facing messages.
function rsvpErrorToast(err: unknown): void {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  if (message.includes('no longer accepting')) toast.error('This event is no longer accepting registrations.');
  else if (message.includes('capacity')) toast.error('This event is full. Please try another event.');
  else if (message === 'session_expired') toast.error('Your session expired. Please verify your roll number again.');
  else toast.error('We could not update your registration. Please try again.');
}

// Opens an external page in a new tab without giving it a handle back to
// this one. Returns false when the browser blocked the tab.
function openInNewTab(url: string): boolean {
  const w = window.open(url, '_blank');
  if (!w) return false;
  w.opener = null;
  return true;
}

function onAdminErr(err: unknown): void {
  if (err instanceof Error && err.message === 'SESSION_EXPIRED') {
    window.location.href = '/admin';
  } else {
    console.error(err);
  }
}

export interface ArtworkComment { id: string; sender: string; text: string; date: string; }

export interface Artwork {
  id: string;
  title: string;
  artist: string;
  domain: string;
  mediaUrl: string;
  mediaType: 'image' | 'pdf' | 'video';
  originalFilename?: string | null;
  likes: number;
  likedByUser: boolean;
  featured: boolean;
  coverUrl: string | null;
  notifiedAt: string | null;
  comments: ArtworkComment[];
}

export interface ClubEvent {
  id: string; title: string; date: string; time: string; location: string;
  content: string; capacity: number; registeredCount: number; isRegistered: boolean;
  notifiedAt: string | null;
  // Machine-readable start instant (ISO 8601) used by the reminder job. The
  // free-text `time` field above remains the display label; startsAt is null
  // until an admin sets it via the datetime input.
  startsAt: string | null;
  // Optional extras, independent of each other (backend routes/events.ts):
  // a validated Google Forms link students complete after registering, and
  // one attachment such as a problem statement. null when not configured.
  registrationFormUrl: string | null;
  attachment: EventAttachment | null;
}

export interface EventAttachment {
  name: string;
  size: number | null;
  url: string;
}

// What an admin create/edit sends: JSON fields, or FormData when it carries
// an attachment file (see api.events.add / update).
export type EventInput = Omit<ClubEvent, 'id' | 'registeredCount' | 'isRegistered' | 'notifiedAt' | 'attachment'>;

// Outcome of a "Notify Students" send. Because Resend's free tier caps daily/
// monthly volume, a send may not fully complete immediately: sentNow is what
// went out now, queued is what's waiting for a later tick to drain.
export interface NotifyResult {
  notifiedAt: string;
  sentNow: number;
  queued: number;
}

export interface VideoResource { id: string; title: string; ytId: string; difficulty: 'Beginner' | 'Intermediate' | 'Advanced'; duration: string; sequence: number; }
export interface QuizQuestion  { q: string; options: string[]; }

export interface Domain {
  id: string; title: string; fullName: string; icon: string;
  tagline: string; description: string; color: string;
  videos: VideoResource[]; quizzes: QuizQuestion[];
}

export interface TeamMember {
  id: number; name: string; designation: string;
  year: string | null; bio: string | null; color: string;
  photoUrl: string | null; displayOrder: number;
  social: { instagram: string | null; linkedin: string | null; email: string | null };
}

interface AppDataContextValue {
  domains:  Record<string, Domain>;
  artworks: Artwork[];
  events:   ClubEvent[];
  team:     TeamMember[];
  loading:  boolean;
  error:    string | null;
  // Artwork
  likeArtwork:    (id: string) => void;
  addComment:     (artworkId: string, sender: string, text: string) => void;
  uploadArtwork:  (formData: FormData) => Promise<void>;
  updateArtwork:  (id: string, formData: FormData) => Promise<void>;
  deleteArtwork:  (id: string) => void;
  toggleFeatured: (id: string, featured: boolean) => void;
  deleteComment:  (artworkId: string, commentId: string) => Promise<void>;
  notifyArtwork:  (id: string) => Promise<NotifyResult>;
  // Events
  rsvpEvent:   (id: string) => void;
  // Form-enabled events only: an explicit, idempotent cancel (their Register
  // never toggles off). Events without a form cancel through rsvpEvent.
  cancelRegistration: (id: string) => void;
  rsvpPendingId: string | null;
  // Both resolve only once the server has saved, and reject with its error.
  addEvent:    (event: EventInput | FormData) => Promise<void>;
  updateEvent: (id: string, data: Partial<EventInput> | FormData) => Promise<void>;
  deleteEvent: (id: string) => void;
  notifyEvent: (id: string, audience?: 'all' | 'registered') => Promise<NotifyResult>;
  // Domains / videos
  addDomain:          (domain: { title: string; fullName: string; icon: string; tagline: string; description: string; color: string }) => Promise<void>;
  updateDomain:       (id: string, data: Partial<{ title: string; fullName: string; icon: string; tagline: string; description: string; color: string }>) => Promise<void>;
  deleteDomain:       (id: string) => void;
  addVideo:           (domainId: string, video: Omit<VideoResource, 'id' | 'sequence'> & { ytUrl: string; sequence?: number }) => void;
  updateVideo:        (domainId: string, videoId: string, data: Partial<Omit<VideoResource, 'id'> & { ytUrl: string }>) => Promise<void>;
  deleteVideo:        (domainId: string, videoId: string) => void;
  updateVideoSequence:(domainId: string, videoId: string, sequence: number) => Promise<void>;
  // Team
  addTeamMember:       (formData: FormData) => Promise<void>;
  updateTeamMember:    (id: number, formData: FormData) => Promise<void>;
  deleteTeamMember:    (id: number) => void;
  reorderTeamSection:  (ordered: TeamMember[]) => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { studentSession } = useStudent();
  const roll = studentSession?.rollNumber;

  const [domains,  setDomains]  = useState<Record<string, Domain>>({});
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [events,   setEvents]   = useState<ClubEvent[]>([]);
  const [rsvpPendingId, setRsvpPendingId] = useState<string | null>(null);
  const [team,     setTeam]     = useState<TeamMember[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.domains.list(),
      api.artworks.list(roll),
      api.events.list(roll),
      api.team.list(),
    ]).then(([d, a, e, t]) => {
      if (cancelled) return;
      setDomains(d as Record<string, Domain>);
      setArtworks(a as Artwork[]);
      setEvents(e as ClubEvent[]);
      setTeam(t as TeamMember[]);
      setError(null);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load app data:', err);
      if (!cancelled) { setError(String(err?.message ?? 'Failed to load data')); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [roll]);

  const likeArtwork = useCallback((id: string) => {
    if (!roll) return;
    setArtworks(prev => prev.map(a => a.id !== id ? a : { ...a, likes: a.likedByUser ? a.likes - 1 : a.likes + 1, likedByUser: !a.likedByUser }));
    api.artworks.like(id, roll)
      .then(({ likes, likedByUser }) => setArtworks(prev => prev.map(a => a.id !== id ? a : { ...a, likes, likedByUser })))
      .catch(() => setArtworks(prev => prev.map(a => a.id !== id ? a : { ...a, likes: a.likedByUser ? a.likes + 1 : a.likes - 1, likedByUser: !a.likedByUser })));
  }, [roll]);

  const addComment = useCallback((artworkId: string, sender: string, text: string) => {
    if (!roll) return;
    api.artworks.addComment(artworkId, roll, sender, text)
      .then(comment => setArtworks(prev => prev.map(a => a.id !== artworkId ? a : { ...a, comments: [...a.comments, comment] })))
      .catch(onAdminErr);
  }, [roll]);

  const uploadArtwork = useCallback(async (formData: FormData) => {
    const newArt = await api.artworks.upload(formData);
    // Creation no longer auto-notifies students — the admin sends explicitly via
    // notifyArtwork (with a confirm dialog). New artwork starts as "Not sent".
    setArtworks(prev => [newArt as Artwork, ...prev]);
  }, []);

  // Sends the student notification for an already-created artwork and updates the
  // record's notifiedAt from the server response. Returns the new timestamp plus
  // how many recipients got mail now vs. were queued (quota-gated free tier).
  const notifyArtwork = useCallback(async (id: string): Promise<{ notifiedAt: string; sentNow: number; queued: number }> => {
    const { notifiedAt, sentNow, queued } = await api.notify.artwork(id);
    setArtworks(prev => prev.map(a => a.id !== id ? a : { ...a, notifiedAt }));
    return { notifiedAt, sentNow, queued };
  }, []);

  const updateArtwork = useCallback(async (id: string, formData: FormData) => {
    const updated = await api.artworks.update(id, formData);
    setArtworks(prev => prev.map(a => a.id !== id ? a : updated as Artwork));
  }, []);

  const deleteArtwork = useCallback((id: string) => {
    api.artworks.delete(id).then(() => setArtworks(prev => prev.filter(a => a.id !== id))).catch(onAdminErr);
  }, []);

  const toggleFeatured = useCallback((id: string, featured: boolean) => {
    const prev_artworks = artworks;
    setArtworks(prev => prev.map(a => a.id !== id ? a : { ...a, featured }));
    api.artworks.toggleFeatured(id, featured)
      .then(({ featured: confirmed }) => setArtworks(prev => prev.map(a => a.id !== id ? a : { ...a, featured: confirmed })))
      .catch(err => { setArtworks(prev_artworks); onAdminErr(err); });
  }, [artworks]);

  const rsvpEvent = useCallback((id: string) => {
    if (!roll || rsvpPendingId) return;
    const target = events.find(e => e.id === id);
    if (target && safeFormUrl(target.registrationFormUrl)) {
      registerThenOpenForm(target);
      return;
    }
    setRsvpPendingId(id);
    setEvents(prev => prev.map(e => {
      if (e.id !== id) return e;
      if (!e.isRegistered && e.registeredCount >= e.capacity) return e;
      return { ...e, isRegistered: !e.isRegistered, registeredCount: e.isRegistered ? Math.max(0, e.registeredCount - 1) : e.registeredCount + 1 };
    }));
    api.events.rsvp(id, roll)
      .then(result => {
        setEvents(prev => prev.map(e => e.id !== id ? e : applyRsvpResult(e, result)));
        toast.success(result.isRegistered ? 'You are registered for this event.' : 'Your RSVP has been cancelled.');
      })
      .catch((err: unknown) => {
        setEvents(prev => prev.map(e => {
          if (e.id !== id) return e;
          return { ...e, isRegistered: !e.isRegistered, registeredCount: e.isRegistered ? e.registeredCount + 1 : Math.max(0, e.registeredCount - 1) };
        }));
        rsvpErrorToast(err);
      })
      .finally(() => setRsvpPendingId(null));
  // registerThenOpenForm is recreated with roll; listing it would only churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll, rsvpPendingId, events]);

  // Form-enabled event: record the registration (idempotent 'register' — a
  // repeat or retry can never cancel it), and only once the server confirms
  // it, open the form link the SERVER returned. No optimistic update: the
  // form must never open for a registration that wasn't recorded. If the
  // browser blocks the new tab, the card's persistent form action remains.
  const registerThenOpenForm = (target: ClubEvent) => {
    if (!roll) return;
    setRsvpPendingId(target.id);
    api.events.rsvp(target.id, roll, 'register')
      .then(result => {
        // The server's answer decides the form link: if the admin removed the
        // form since this page loaded, the stale link is cleared, not kept.
        setEvents(prev => prev.map(e => e.id !== target.id ? e : applyRsvpResult(e, result)));
        const url = safeFormUrl(result.registrationFormUrl);
        if (!result.isRegistered || !url) {
          toast.success('You are registered for this event.');
          return;
        }
        const label = formActionLabel(!!target.attachment);
        const opened = openInNewTab(url);
        toast.success(opened
          ? `Your place is reserved. Finish by completing the form in the new tab (${label}).`
          : `Your place is reserved. Select “${label}” to open the form and finish.`);
      })
      .catch(rsvpErrorToast)
      .finally(() => setRsvpPendingId(null));
  };

  const cancelRegistration = useCallback((id: string) => {
    if (!roll || rsvpPendingId) return;
    setRsvpPendingId(id);
    api.events.rsvp(id, roll, 'cancel')
      .then(result => {
        setEvents(prev => prev.map(e => e.id !== id ? e : applyRsvpResult(e, result)));
        toast.success('Your registration has been cancelled.');
      })
      .catch(rsvpErrorToast)
      .finally(() => setRsvpPendingId(null));
  }, [roll, rsvpPendingId]);

  const addEvent = useCallback(async (event: EventInput | FormData) => {
    // Creation no longer auto-notifies students — the admin sends explicitly via
    // notifyEvent (with a confirm dialog). New events start as "Not sent".
    // Resolves only after the server saved it; a failure rejects so the admin
    // form can keep what was entered and show why.
    const created = await api.events.add(event);
    setEvents(prev => [created as ClubEvent, ...prev]);
  }, []);

  // Sends the student notification for an already-created event and updates the
  // record's notifiedAt from the server response. Returns the new timestamp plus
  // how many recipients got mail now vs. were queued (quota-gated free tier).
  const notifyEvent = useCallback(async (
    id: string,
    options?: { audienceType?: 'all' | 'registered' | 'active'; batch?: string | null; limit?: number; excludeEventIds?: string[]; excludeCampaignIds?: string[] }
  ): Promise<NotifyResult> => {
    const { notifiedAt, sentNow, queued } = await api.notify.event(id, options);
    setEvents(prev => prev.map(e => e.id !== id ? e : { ...e, notifiedAt }));
    return { notifiedAt, sentNow, queued };
  }, []);

  const updateEvent = useCallback(async (id: string, data: Partial<EventInput> | FormData) => {
    const updated = await api.events.update(id, data);
    setEvents(prev => prev.map(e => e.id !== id ? e : updated as ClubEvent));
  }, []);

  const deleteEvent = useCallback((id: string) => {
    api.events.delete(id).then(() => setEvents(prev => prev.filter(e => e.id !== id))).catch(onAdminErr);
  }, []);

  const addDomain = useCallback(async (domain: Parameters<AppDataContextValue['addDomain']>[0]) => {
    const newDomain = await api.domains.create(domain);
    setDomains(prev => ({ ...prev, [(newDomain as Domain).id]: newDomain as Domain }));
  }, []);

  const updateDomain = useCallback(async (id: string, data: Partial<{ title: string; fullName: string; icon: string; tagline: string; description: string; color: string }>) => {
    const updated = await api.domains.update(id, data);
    setDomains(prev => {
      const existing = prev[id];
      if (!existing) return prev;
      return { ...prev, [id]: { ...existing, ...(updated as Domain) } };
    });
  }, []);

  const deleteDomain = useCallback((id: string) => {
    api.domains.delete(id).then(() => setDomains(prev => { const next = { ...prev }; delete next[id]; return next; })).catch(onAdminErr);
  }, []);

  const addVideo = useCallback((domainId: string, video: Omit<VideoResource, 'id' | 'sequence'> & { ytUrl: string; sequence?: number }) => {
    const { ytUrl, ytId: _ytId, ...rest } = video;
    api.domains.addVideo(domainId, { ...rest, ytUrl })
      .then(newVid => setDomains(prev => {
        const d = prev[domainId];
        if (!d) return prev;
        const videos = [...d.videos, newVid as VideoResource]
          .sort((a, b) => a.sequence - b.sequence);
        return { ...prev, [domainId]: { ...d, videos } };
      }))
      .catch(onAdminErr);
  }, []);

  const updateVideo = useCallback(async (domainId: string, videoId: string, data: Partial<Omit<VideoResource, 'id'> & { ytUrl: string }>) => {
    const updated = await api.domains.updateVideo(domainId, videoId, data);
    setDomains(prev => {
      const d = prev[domainId];
      if (!d) return prev;
      const videos = d.videos
        .map(v => v.id === videoId ? { ...v, ...(updated as VideoResource) } : v)
        .sort((a, b) => a.sequence - b.sequence);
      return { ...prev, [domainId]: { ...d, videos } };
    });
  }, []);

  const deleteVideo = useCallback((domainId: string, videoId: string) => {
    api.domains.deleteVideo(domainId, videoId)
      .then(() => setDomains(prev => {
        const d = prev[domainId];
        if (!d) return prev;
        return { ...prev, [domainId]: { ...d, videos: d.videos.filter(v => v.id !== videoId) } };
      }))
      .catch(onAdminErr);
  }, []);

  const updateVideoSequence = useCallback(async (domainId: string, videoId: string, sequence: number) => {
    await api.domains.patchVideoSequence(domainId, videoId, sequence);
    setDomains(prev => {
      const d = prev[domainId];
      if (!d) return prev;
      const videos = d.videos
        .map(v => v.id === videoId ? { ...v, sequence } : v)
        .sort((a, b) => a.sequence - b.sequence);
      return { ...prev, [domainId]: { ...d, videos } };
    });
  }, []);

  const addTeamMember = useCallback(async (formData: FormData) => {
    const m = await api.team.add(formData);
    setTeam(prev => [...prev, m as TeamMember].sort((a, b) => a.displayOrder - b.displayOrder));
  }, []);

  const updateTeamMember = useCallback(async (id: number, formData: FormData) => {
    const m = await api.team.update(id, formData);
    setTeam(prev => prev.map(t => t.id !== id ? t : m as TeamMember).sort((a, b) => a.displayOrder - b.displayOrder));
  }, []);

  const deleteTeamMember = useCallback((id: number) => {
    api.team.delete(id).then(() => setTeam(prev => prev.filter(t => t.id !== id))).catch(onAdminErr);
  }, []);

  const reorderTeamSection = useCallback(async (ordered: TeamMember[]) => {
    await Promise.all(ordered.map((m, i) => api.team.patchOrder(m.id, i + 1)));
    const updated = ordered.map((m, i) => ({ ...m, displayOrder: i + 1 }));
    setTeam(prev => {
      const ids = new Set(updated.map(m => m.id));
      return [...prev.filter(m => !ids.has(m.id)), ...updated]
        .sort((a, b) => a.displayOrder - b.displayOrder);
    });
  }, []);

  const deleteComment = useCallback(async (artworkId: string, commentId: string) => {
    await api.artworks.deleteComment(artworkId, commentId);
    setArtworks(prev => prev.map(artwork =>
      artwork.id !== artworkId ? artwork :
      { ...artwork, comments: artwork.comments.filter(c => c.id !== commentId) }
    ));
  }, []);

  return (
    <AppDataContext.Provider value={{
      domains, artworks, events, team, loading, error,
      likeArtwork, addComment, uploadArtwork, updateArtwork, deleteArtwork, toggleFeatured, deleteComment, notifyArtwork,
      rsvpEvent, cancelRegistration, rsvpPendingId, addEvent, updateEvent, deleteEvent, notifyEvent,
      addDomain, updateDomain, deleteDomain, addVideo, updateVideo, deleteVideo, updateVideoSequence,
      addTeamMember, updateTeamMember, deleteTeamMember, reorderTeamSection,
    }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
