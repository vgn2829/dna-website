import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useStudent } from './StudentContext';

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
  comments: ArtworkComment[];
}

export interface ClubEvent {
  id: string; title: string; date: string; time: string; location: string;
  content: string; capacity: number; registeredCount: number; isRegistered: boolean;
}

export interface VideoResource { id: string; title: string; ytId: string; difficulty: 'Beginner' | 'Intermediate' | 'Advanced'; duration: string; }
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
  likeArtwork:   (id: string) => void;
  addComment:    (artworkId: string, sender: string, text: string) => void;
  uploadArtwork: (formData: FormData) => Promise<void>;
  deleteArtwork: (id: string) => void;
  // Events
  rsvpEvent:  (id: string) => void;
  addEvent:   (event: Omit<ClubEvent, 'id' | 'registeredCount' | 'isRegistered'>) => void;
  deleteEvent:(id: string) => void;
  // Domains / videos
  addDomain:    (domain: { title: string; fullName: string; icon: string; tagline: string; description: string; color: string }) => Promise<void>;
  deleteDomain: (id: string) => void;
  addVideo:     (domainId: string, video: Omit<VideoResource, 'id'> & { ytUrl: string }) => void;
  deleteVideo:  (domainId: string, videoId: string) => void;
  // Team
  addTeamMember:    (formData: FormData) => Promise<void>;
  updateTeamMember: (id: number, formData: FormData) => Promise<void>;
  deleteTeamMember: (id: number) => void;
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
      .catch(console.error);
  }, [roll]);

  const uploadArtwork = useCallback(async (formData: FormData) => {
    const newArt = await api.artworks.upload(formData);
    setArtworks(prev => [newArt as Artwork, ...prev]);
  }, []);

  const deleteArtwork = useCallback((id: string) => {
    api.artworks.delete(id).then(() => setArtworks(prev => prev.filter(a => a.id !== id))).catch(console.error);
  }, []);

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
    api.events.add(event).then(e => setEvents(prev => [e as ClubEvent, ...prev])).catch(console.error);
  }, []);

  const deleteEvent = useCallback((id: string) => {
    api.events.delete(id).then(() => setEvents(prev => prev.filter(e => e.id !== id))).catch(console.error);
  }, []);

  const addDomain = useCallback(async (domain: Parameters<AppDataContextValue['addDomain']>[0]) => {
    const newDomain = await api.domains.create(domain);
    setDomains(prev => ({ ...prev, [(newDomain as Domain).id]: newDomain as Domain }));
  }, []);

  const deleteDomain = useCallback((id: string) => {
    api.domains.delete(id).then(() => setDomains(prev => { const next = { ...prev }; delete next[id]; return next; })).catch(console.error);
  }, []);

  const addVideo = useCallback((domainId: string, video: Omit<VideoResource, 'id'> & { ytUrl: string }) => {
    const { ytUrl, ...rest } = video;
    api.domains.addVideo(domainId, { ...rest, ytUrl })
      .then(newVid => setDomains(prev => {
        const d = prev[domainId];
        if (!d) return prev;
        return { ...prev, [domainId]: { ...d, videos: [...d.videos, newVid as VideoResource] } };
      }))
      .catch(console.error);
  }, []);

  const deleteVideo = useCallback((domainId: string, videoId: string) => {
    api.domains.deleteVideo(domainId, videoId)
      .then(() => setDomains(prev => {
        const d = prev[domainId];
        if (!d) return prev;
        return { ...prev, [domainId]: { ...d, videos: d.videos.filter(v => v.id !== videoId) } };
      }))
      .catch(console.error);
  }, []);

  const addTeamMember = useCallback(async (formData: FormData) => {
    const m = await api.team.add(formData);
    setTeam(prev => [...prev, m as TeamMember].sort((a, b) => a.displayOrder - b.displayOrder));
  }, []);

  const updateTeamMember = useCallback(async (id: number, formData: FormData) => {
    const m = await api.team.update(id, formData);
    setTeam(prev => prev.map(t => t.id !== id ? t : m as TeamMember));
  }, []);

  const deleteTeamMember = useCallback((id: number) => {
    api.team.delete(id).then(() => setTeam(prev => prev.filter(t => t.id !== id))).catch(console.error);
  }, []);

  return (
    <AppDataContext.Provider value={{
      domains, artworks, events, team, loading, error,
      likeArtwork, addComment, uploadArtwork, deleteArtwork,
      rsvpEvent, addEvent, deleteEvent,
      addDomain, deleteDomain, addVideo, deleteVideo,
      addTeamMember, updateTeamMember, deleteTeamMember,
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
