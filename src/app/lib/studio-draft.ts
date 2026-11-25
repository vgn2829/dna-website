import { useState, type Dispatch, type SetStateAction } from 'react';
const memory = new Map<string, unknown>();
/** Lightweight versioned settings. Storage denial degrades to same-tab memory. */
export function useStudioDraft<T>(key: string, initial: T, validate: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `dna-studio-v1:${key}`;
  const [state, update] = useState<T>(() => {
    const cached = memory.get(storageKey); if (validate(cached)) return cached;
    try { const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (validate(parsed)) return parsed; } catch { /* Optional persistence. */ }
    return initial;
  });
  const set: Dispatch<SetStateAction<T>> = value => update(previous => {
    const next = typeof value === 'function' ? (value as (old: T) => T)(previous) : value;
    memory.set(storageKey, next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Optional persistence. */ }
    return next;
  });
  return [state, set];
}
export const isString = (value: unknown): value is string => typeof value === 'string' && value.length <= 10000;
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isHexRecord = (value: unknown): value is Record<string, string> => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length <= 18 && Object.values(value).every(v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));
