import { useCallback, useEffect, useRef, useState } from "react";
import { WorkerClient } from "../lib/studio/jobs";
export function useWorkerTask<T, P>(
  create: () => Worker,
  decode: (message: any) => T,
  toProgress?: (message: any) => P,
) {
  const [status, setStatus] = useState<
    "idle" | "processing" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null),
    [progress, setProgress] = useState<P | null>(null);
  const active = useRef(true),
    revision = useRef(0),
    client = useRef<WorkerClient<T> | null>(null);
  const reset = useCallback(() => {
    ++revision.current;
    client.current?.cancel();
    if (active.current) {
      setStatus("idle");
      setError(null);
      setProgress(null);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      ++revision.current;
      client.current?.cancel();
    };
  }, []);
  const run = useCallback(
    async (message: Record<string, unknown>, transfer: Transferable[] = []) => {
      client.current?.cancel();
      const id = ++revision.current;
      if (!client.current)
        client.current = new WorkerClient<T>(create, decode, (msg) => {
          if (active.current && toProgress) setProgress(toProgress(msg));
        });
      setStatus("processing");
      setError(null);
      setProgress(null);
      try {
        const result = await client.current.request(message, transfer);
        if (active.current && id === revision.current) {
          setStatus("done");
          setProgress(null);
        }
        return result;
      } catch (err) {
        if (active.current && id === revision.current) {
          setProgress(null);
          setStatus((err as Error).name === "AbortError" ? "idle" : "error");
          if ((err as Error).name !== "AbortError")
            setError((err as Error).message);
        }
        throw err;
      }
    },
    [],
  );
  return { status, error, progress, run, reset };
}
