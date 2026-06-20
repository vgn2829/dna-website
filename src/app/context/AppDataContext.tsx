import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useStudent } from './StudentContext';

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
  comments: ArtworkComment[];
}

export interface ClubEvent {
  id: string; title: string; date: string; time: string; location: string;
  content: string; capacity: number; registeredCount: number; isRegistered: boolean;
}

export interface VideoResource { id: string; title: string; ytId: string; difficulty: 'Beginner' | 'Intermediate' | 'Advanced'; duration: string; sequence: number; }
export interface QuizQuestion  { q: string; options: string[]; ans: number; }

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
  // Events
  rsvpEvent:   (id: string) => void;
  addEvent:    (event: Omit<ClubEvent, 'id' | 'registeredCount' | 'isRegistered'>) => void;
  updateEvent: (id: string, data: Partial<Omit<ClubEvent, 'id' | 'registeredCount' | 'isRegistered'>>) => Promise<void>;
  deleteEvent: (id: string) => void;
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
    setArtworks(prev => [newArt as Artwork, ...prev]);
    api.notify.artwork({
      title: (newArt as Artwork).title,
      artist: (newArt as Artwork).artist,
      domain: (newArt as Artwork).domain,
    }).catch(err => console.error('Artwork notification failed:', err));
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
    if (!roll) return;
    setEvents(prev => prev.map(e => {
      if (e.id !== id) return e;
      if (!e.isRegistered && e.registeredCount >= e.capacity) return e;
      return { ...e, isRegistered: !e.isRegistered, registeredCount: e.isRegistered ? Math.max(0, e.registeredCount - 1) : e.registeredCount + 1 };
    }));
    api.events.rsvp(id, roll)
      .then(({ registeredCount, isRegistered }) => setEvents(prev => prev.map(e => e.id !== id ? e : { ...e, registeredCount, isRegistered })))
      .catch(() => setEvents(prev => prev.map(e => {
        if (e.id !== id) return e;
        return { ...e, isRegistered: !e.isRegistered, registeredCount: e.isRegistered ? e.registeredCount + 1 : Math.max(0, e.registeredCount - 1) };
      })));
  }, [roll]);

  const addEvent = useCallback((event: Omit<ClubEvent, 'id' | 'registeredCount' | 'isRegistered'>) => {
    api.events.add(event).then(e => {
      setEvents(prev => [e as ClubEvent, ...prev]);
      api.notify.event({
        title: (e as ClubEvent).title,
        date: (e as ClubEvent).date,
        venue: (e as ClubEvent).location,
        description: (e as ClubEvent).content,
      }).catch(err => console.error('Event notification failed:', err));
    }).catch(onAdminErr);
  }, []);

  const updateEvent = useCallback(async (id: string, data: Partial<Omit<ClubEvent, 'id' | 'registeredCount' | 'isRegistered'>>) => {
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
      likeArtwork, addComment, uploadArtwork, updateArtwork, deleteArtwork, toggleFeatured, deleteComment,
      rsvpEvent, addEvent, updateEvent, deleteEvent,
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
