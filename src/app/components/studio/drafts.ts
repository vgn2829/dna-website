import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
// Tab-local lightweight drafts only. No files, decoded pixels, workers or URLs.
export const studioDrafts = new Map<string, unknown>();
export function useStudioDraft<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    studioDrafts.has(key) ? (studioDrafts.get(key) as T) : initial,
  );
  useEffect(() => {
    studioDrafts.set(key, value);
  }, [key, value]);
  return [value, setValue];
}
