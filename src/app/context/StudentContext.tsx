import React, { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../lib/api';

export interface StudentSession {
  rollNumber: string;
  uniqueId: string;
  registeredAt: string;
}

export interface StudentProgress {
  watchedVideos: string[];
  completedQuizzes: string[];
}

interface StudentContextValue {
  studentSession: StudentSession | null;
  studentProgress: StudentProgress;
  isRollModalOpen: boolean;
  openRollModal: () => void;
  closeRollModal: () => void;
  login: (rollNumber: string) => Promise<StudentSession>;
  logout: () => void;
  markVideoWatched: (videoId: string) => void;
  unmarkVideoWatched: (videoId: string) => void;
  completeQuiz: (domainId: string) => void;
  totalXP: number;
}

const EMPTY_PROGRESS: StudentProgress = { watchedVideos: [], completedQuizzes: [] };
const SESSION_KEY  = 'iitk_dna_student_session';
const PROGRESS_KEY = 'iitk_dna_student_progress';

function loadSession(): StudentSession | null {
  try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function loadProgress(): StudentProgress {
  try { const r = localStorage.getItem(PROGRESS_KEY); return r ? JSON.parse(r) : EMPTY_PROGRESS; } catch { return EMPTY_PROGRESS; }
}

const StudentContext = createContext<StudentContextValue | null>(null);

export function StudentProvider({ children }: { children: React.ReactNode }) {
  const [studentSession, setStudentSession] = useState<StudentSession | null>(loadSession);
  const [studentProgress, setStudentProgress] = useState<StudentProgress>(loadProgress);
  const [isRollModalOpen, setIsRollModalOpen] = useState(false);

  const persist = (session: StudentSession | null, progress: StudentProgress) => {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  };

  const openRollModal  = useCallback(() => setIsRollModalOpen(true), []);
  const closeRollModal = useCallback(() => setIsRollModalOpen(false), []);

  const login = useCallback(async (rollNumber: string): Promise<StudentSession> => {
    const { session, progress } = await api.students.createSession(rollNumber);
    setStudentSession(session);
    setStudentProgress(progress);
    persist(session, progress);
    return session;
  }, []);

  const logout = useCallback(() => {
    setStudentSession(null);
    setStudentProgress(EMPTY_PROGRESS);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PROGRESS_KEY);
  }, []);

  const markVideoWatched = useCallback((videoId: string) => {
    setStudentProgress(prev => {
      if (prev.watchedVideos.includes(videoId)) return prev;
      const next = { ...prev, watchedVideos: [...prev.watchedVideos, videoId] };
      if (studentSession) {
        api.students.markVideoWatched(studentSession.rollNumber, videoId).catch(console.error);
        persist(studentSession, next);
      }
      return next;
    });
  }, [studentSession]);

  const unmarkVideoWatched = useCallback((videoId: string) => {
    setStudentProgress(prev => {
      const next = { ...prev, watchedVideos: prev.watchedVideos.filter(id => id !== videoId) };
      if (studentSession) {
        api.students.unmarkVideoWatched(studentSession.rollNumber, videoId).catch(console.error);
        persist(studentSession, next);
      }
      return next;
    });
  }, [studentSession]);

  const completeQuiz = useCallback((domainId: string) => {
    setStudentProgress(prev => {
      if (prev.completedQuizzes.includes(domainId)) return prev;
      const next = { ...prev, completedQuizzes: [...prev.completedQuizzes, domainId] };
      if (studentSession) {
        api.students.completeQuiz(studentSession.rollNumber, domainId).catch(console.error);
        persist(studentSession, next);
      }
      return next;
    });
  }, [studentSession]);

  const totalXP =
    studentProgress.watchedVideos.length * 10 +
    studentProgress.completedQuizzes.length * 20;

  return (
    <StudentContext.Provider value={{
      studentSession, studentProgress, isRollModalOpen,
      openRollModal, closeRollModal, login, logout,
      markVideoWatched, unmarkVideoWatched, completeQuiz, totalXP,
    }}>
      {children}
    </StudentContext.Provider>
  );
}

export function useStudent() {
  const ctx = useContext(StudentContext);
  if (!ctx) throw new Error('useStudent must be used within StudentProvider');
  return ctx;
}
