import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setStudentToken, clearStudentToken, getStudentToken } from '../lib/api';

export interface StudentSession {
  rollNumber: string;
  uniqueId: string;
  registeredAt: string;
  name: string;
  email: string;
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
  needsReverify: boolean;
  clearReverifyNotice: () => void;
  login: (token: string, session: StudentSession, progress?: StudentProgress) => void;
  logout: () => void;
  markVideoWatched: (videoId: string) => void;
  unmarkVideoWatched: (videoId: string) => void;
  completeQuiz: (domainId: string) => void;
  totalXP: number;
}

const EMPTY_PROGRESS: StudentProgress = { watchedVideos: [], completedQuizzes: [] };
const SESSION_KEY       = 'iitk_dna_student_session';
const PROGRESS_KEY      = 'iitk_dna_student_progress';
const WELCOME_SHOWN_KEY = 'iitk_dna_welcome_shown';

export function hasSeenWelcome(rollNumber: string): boolean {
  return localStorage.getItem(`${WELCOME_SHOWN_KEY}_${rollNumber}`) === 'true';
}

export function markWelcomeSeen(rollNumber: string): void {
  localStorage.setItem(`${WELCOME_SHOWN_KEY}_${rollNumber}`, 'true');
}

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
  const [needsReverify, setNeedsReverify] = useState(false);
  const clearReverifyNotice = useCallback(() => setNeedsReverify(false), []);

  const persist = (session: StudentSession | null, progress: StudentProgress) => {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  };

  const openRollModal  = useCallback(() => setIsRollModalOpen(true), []);
  const closeRollModal = useCallback(() => setIsRollModalOpen(false), []);

  const login = useCallback((token: string, session: StudentSession, progress?: StudentProgress): void => {
    setStudentToken(token);
    setStudentSession(session);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    if (progress) {
      setStudentProgress(progress);
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    }
  }, []);

  const logout = useCallback(() => {
    clearStudentToken();
    setStudentSession(null);
    setStudentProgress(EMPTY_PROGRESS);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PROGRESS_KEY);
  }, []);

  // Sessions created before token-based auth have a stored profile but no JWT.
  // Rather than let every student-scoped write silently 401, clear the stale
  // session on load so the UI shows the sign-in prompt and the user re-verifies
  // via OTP (which restores their existing profile + progress from the server).
  useEffect(() => {
    if (studentSession && !getStudentToken()) {
      logout();
      setNeedsReverify(true);
      setIsRollModalOpen(true);
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Local state only — completion is recorded server-side by the graded quiz
  // submit endpoint, so this just reflects the confirmed result in the UI.
  const completeQuiz = useCallback((domainId: string) => {
    setStudentProgress(prev => {
      if (prev.completedQuizzes.includes(domainId)) return prev;
      const next = { ...prev, completedQuizzes: [...prev.completedQuizzes, domainId] };
      if (studentSession) persist(studentSession, next);
      return next;
    });
  }, [studentSession]);

  const totalXP =
    studentProgress.watchedVideos.length * 10 +
    studentProgress.completedQuizzes.length * 20;

  return (
    <StudentContext.Provider value={{
      studentSession, studentProgress, isRollModalOpen,
      openRollModal, closeRollModal, needsReverify, clearReverifyNotice, login, logout,
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
