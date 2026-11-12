// A bounded, read-only worker. Enqueue never waits for filesystem or host work.
export function createCaptureQueue({
  capture,
  onError,
  maxPending = 32,
  timeoutMs = 10000,
}) {
  const pending = [],
    keys = new Set(),
    waiters = [];
  let running = false,
    disposed = false,
    active;
  const report = (job, error) => {
    try {
      onError?.(job.id, job.seq, error);
    } catch {}
  };
  async function drain() {
    if (running) return;
    running = true;
    while (!disposed && pending.length) {
      const job = pending.shift();
      const controller = new AbortController();
      active = controller;
      let timer;
      const cancelled = new Promise((_, reject) =>
        controller.signal.addEventListener(
          "abort",
          () => reject(Error("Capture cancelled or timed out")),
          { once: true },
        ),
      );
      try {
        timer = setTimeout(() => controller.abort(), timeoutMs);
        await Promise.race([
          capture(job.id, job.seq, job.type, controller.signal),
          cancelled,
        ]);
      } catch (error) {
        if (!disposed) report(job, error);
      } finally {
        clearTimeout(timer);
        keys.delete(job.key);
        active = undefined;
      }
    }
    running = false;
    for (const resolve of waiters.splice(0)) resolve();
  }
  return {
    enqueue(id, seq, type) {
      if (disposed || typeof id !== "string" || !Number.isSafeInteger(seq))
        return;
      const key = JSON.stringify([id, seq]);
      if (keys.has(key)) return;
      const job = { id, seq, type, key };
      if (pending.length >= maxPending) {
        report(job, Error("Capture queue limit reached"));
        return;
      }
      keys.add(key);
      pending.push(job);
      void drain();
    },
    idle() {
      return running
        ? new Promise((resolve) => waiters.push(resolve))
        : Promise.resolve();
    },
    dispose() {
      disposed = true;
      active?.abort();
      pending.length = 0;
      keys.clear();
    },
  };
}
