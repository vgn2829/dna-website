import { describe, it, expect, vi } from "vitest";
import { WorkerClient, JobOwner, dimensions } from "./jobs";
class FakeWorker {
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
}
describe("job lifecycle", () => {
  it("invalidates replaced and cancelled input revisions", () => {
    const jobs = new JobOwner();
    const a = jobs.next(),
      b = jobs.next();
    expect(jobs.current(a)).toBe(false);
    expect(jobs.current(b)).toBe(true);
    jobs.cancel();
    expect(jobs.current(b)).toBe(false);
  });
  it("rejects all pending calls on crash and creates a fresh worker for retry", async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient<string>(
      () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      (m) => m.svg,
    );
    const a = client.request({ type: "run" }),
      b = client.request({ type: "run" });
    const failures = Promise.all([
      expect(a).rejects.toThrow("crash"),
      expect(b).rejects.toThrow("crash"),
    ]);
    workers[0].onerror!({ message: "crash" });
    await failures;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const c = client.request({ type: "run" });
    workers[1].onmessage!({ data: { id: 3, type: "result", svg: "ok" } });
    await expect(c).resolves.toBe("ok");
  });
  it("settles cancellation and ignores late progress/results", async () => {
    const w = new FakeWorker(),
      progress = vi.fn();
    const c = new WorkerClient<string>(
      () => w as unknown as Worker,
      (m) => m.svg,
      progress,
    );
    const p = c.request({});
    const check = expect(p).rejects.toMatchObject({ name: "AbortError" });
    const lateMessage = w.onmessage!;
    c.cancel();
    await check;
    lateMessage({ data: { id: 1, type: "progress" } });
    expect(progress).not.toHaveBeenCalled();
  });
  it("handles postMessage failure and rejects invalid output sizes", async () => {
    const w = new FakeWorker();
    w.postMessage.mockImplementation(() => {
      throw new Error("clone failed");
    });
    const c = new WorkerClient(
      () => w as unknown as Worker,
      (m) => m,
    );
    await expect(c.request({})).rejects.toThrow("clone failed");
    expect(() => dimensions(0, 1)).toThrow();
    expect(() => dimensions(9000, 2)).toThrow();
    expect(() => dimensions(5000, 5000)).toThrow();
  });
});

it("isolates replacement requests from queued errors on the old worker", async () => {
  const workers: FakeWorker[] = [];
  const c = new WorkerClient<string>(
    () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
    (m) => m.svg,
  );
  const a = c.request({});
  const check = expect(a).rejects.toMatchObject({ name: "AbortError" });
  const oldError = workers[0].onerror!,
    oldMessageError = workers[0].onmessageerror!;
  c.cancel();
  await check;
  const b = c.request({});
  oldError({ message: "old crash" });
  oldMessageError();
  workers[1].onmessage!({ data: { id: 2, type: "result", svg: "current" } });
  await expect(b).resolves.toBe("current");
});
