import { boundRepositoryRecord } from "./repository-record.js";
import { discoverRepositories } from "./touched-repositories.js";
import { captureRepository, compareRepository } from "./repository-capture.js";

// The host awaits this wrapper. Session events alone cannot establish pre-state.
export function createRepositoryObserver({
  store,
  discover = discoverRepositories,
  capture = captureRepository,
  compare = compareRepository,
  onError = () => {},
  timeoutMs = 5000,
}) {
  const known = new Map(),
    pending = new Map(),
    writes = new Set(),
    controllers = new Set(),
    reported = new Map();
  let disposed = false,
    active = 0,
    writingBytes = 0;
  const size = (value) => Buffer.byteLength(JSON.stringify(value));
  const meaningful = (row) =>
    (row.hunks?.length ?? 0) + (row.files?.length ?? 0) > 0;
  const key = (id, call) => JSON.stringify([id, call]);
  const report = (id, error) => {
    try {
      onError(id, error);
    } catch {}
  };
  async function bounded(fn) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await Promise.race([
        fn(controller.signal),
        new Promise((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(Error("Repository capture timed out or stopped.")),
            { once: true },
          ),
        ),
      ]);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  return {
    async execute(exec, next) {
      const sessionId = exec.agent?.session?.id;
      const args = exec.arguments;
      // File-tool metadata already records edits. Observe commands and shell polls.
      const relevant =
        typeof args?.command === "string" ||
        ["bash", "shell", "exec_command", "write_stdin", "run_code"].includes(
          exec.name,
        );
      if (disposed || !sessionId || !exec.callId || !relevant) return next();
      if (active >= 4) {
        report(
          sessionId,
          Error("Concurrent repository capture limit reached."),
        );
        return next();
      }
      active++;
      const notices = [],
        before = [];
      let roots = known.get(sessionId) ?? [],
        baselineBytes = 0;
      try {
        await bounded(async (signal) => {
          const found = await discover({ exec, knownRoots: roots, signal });
          if (signal.aborted) throw Error("Capture cancelled");
          notices.push(...found.notices);
          roots = (
            found.complete === false
              ? [...new Set([...roots, ...found.roots])]
              : found.roots
          ).slice(0, 8);
          if (known.size >= 100 && !known.has(sessionId)) {
            const oldest = known.keys().next().value;
            known.delete(oldest);
            reported.delete(oldest);
          }
          known.set(sessionId, roots);
          for (const root of roots) {
            if (signal.aborted) break;
            try {
              const baseline = await capture(root, { signal });
              if (!signal.aborted) {
                baselineBytes += size(baseline);
                if (baselineBytes > 4000000) {
                  notices.push(
                    "Repository baseline memory limit reached; remaining roots omitted.",
                  );
                  break;
                }
                before.push(baseline);
              }
            } catch {
              notices.push(
                `Pre-command state unavailable for ${root}; no session delta will be claimed.`,
              );
            }
          }
        });
      } catch {
        notices.push(
          "Repository baseline capture was incomplete; some command edits may be unavailable.",
        );
      }
      let outcome;
      try {
        outcome = await next();
        return outcome;
      } finally {
        if (["background", "promoted"].includes(outcome?.value?.kind))
          notices.push(
            "This shell job continues in the background; repository observation covers only changes before this tool returned. Later job writes may be unavailable.",
          );
        if (!disposed) {
          const observations = [];
          let observationBytes = 0;
          try {
            await bounded(async (signal) => {
              for (const baseline of before) {
                if (signal.aborted) break;
                try {
                  const observation = await compare(baseline, { signal });
                  if (!signal.aborted) {
                    observationBytes += size(observation);
                    if (observationBytes > 4000000) {
                      notices.push(
                        "Repository observation memory limit reached; remaining roots omitted.",
                      );
                      break;
                    }
                    observations.push(observation);
                  }
                } catch {
                  notices.push(
                    `Post-command comparison unavailable for ${baseline.root}.`,
                  );
                }
              }
              const found = await discover({
                exec: { ...exec, signal },
                knownRoots: [
                  ...new Set([...roots, ...(known.get(sessionId) ?? [])]),
                ],
                signal,
              });
              if (signal.aborted) throw Error("Capture cancelled");
              for (const root of found.roots)
                if (!roots.includes(root))
                  notices.push(
                    `Discovered ${root} after execution; earlier changes have no pre-command baseline.`,
                  );
              notices.push(...found.notices);
              known.set(
                sessionId,
                (found.complete === false
                  ? [
                      ...new Set([
                        ...roots,
                        ...(known.get(sessionId) ?? []),
                        ...found.roots,
                      ]),
                    ]
                  : found.roots
                ).slice(0, 8),
              );
            });
          } catch {
            notices.push(
              "Repository comparison timed out; some command edits may be unavailable.",
            );
          }
          const owner = exec.rootCallId ?? exec.callId;
          const id = key(sessionId, owner);
          if (pending.size >= 128 && !pending.has(id)) {
            pending.delete(pending.keys().next().value);
            report(
              sessionId,
              Error("Repository capture pending-result limit reached."),
            );
          }
          let records = pending.get(id) ?? [];
          // Collapse identical nested evidence only; an outer partial capture
          // must not erase a child delta for a different or omitted file.
          if (exec.callId === owner) {
            const hkey = (h) =>
              JSON.stringify([h.path, h.oldStart, h.newStart, h.lines]);
            const outerHunks = new Set(
              observations.flatMap((row) => row.hunks ?? []).map(hkey),
            );
            records = records.map((record) => ({
              ...record,
              observations: record.observations.map((row) => {
                const retained = (row.hunks ?? []).filter(
                  (h) => !outerHunks.has(hkey(h)),
                );
                const removedPaths = new Set(
                  (row.hunks ?? [])
                    .filter((h) => outerHunks.has(hkey(h)))
                    .map((h) => h.path),
                );
                return {
                  ...row,
                  hunks: retained,
                  files: (row.files ?? []).filter(
                    (f) =>
                      !removedPaths.has(f.path) ||
                      retained.some((h) => h.path === f.path),
                  ),
                };
              }),
            }));
          }
          notices.push(...observations.flatMap((row) => row.notices ?? []));
          const seen = reported.get(sessionId) ?? new Set();
          const freshNotices = [...new Set(notices)].filter(
            (n) => !seen.has(n),
          );
          for (const n of freshNotices) if (seen.size < 200) seen.add(n);
          reported.set(sessionId, seen);
          if (observations.some(meaningful) || freshNotices.length) {
            if (records.length < 16)
              records.push(
                boundRepositoryRecord({
                  callId: exec.callId,
                  observations,
                  notices: freshNotices,
                  capturedAt: Date.now(),
                }),
              );
            else
              report(
                sessionId,
                Error("Nested repository capture limit reached."),
              );
          }
          records = records.filter(
            (record) =>
              record.observations.some(meaningful) || record.notices.length,
          );
          while (size(records) > 4000000 && records.length > 1) {
            records.shift();
            report(
              sessionId,
              Error("Nested capture evidence byte limit reached."),
            );
          }
          if (records.length) pending.set(id, records);
          else pending.delete(id);
          let pendingBytes = [...pending.values()].reduce(
            (n, records) => n + size(records),
            0,
          );
          while (pendingBytes > 16000000 && pending.size) {
            const oldest = pending.keys().next().value;
            pendingBytes -= size(pending.get(oldest));
            pending.delete(oldest);
            report(
              sessionId,
              Error("Pending capture memory limit reached; evidence omitted."),
            );
          }
        }
        active--;
      }
    },
    onEvent(session, event) {
      if (disposed || event.type !== "tool/result") return;
      const callId = event.data?.message?.toolCallId;
      const id = key(session.id, callId),
        records = pending.get(id);
      if (!records) return;
      pending.delete(id);
      for (const record of records) {
        const recordBytes = size(record);
        if (writes.size >= 32 || writingBytes + recordBytes > 16000000) {
          report(
            session.id,
            Error(
              "Repository persistence queue limit reached; observation omitted.",
            ),
          );
          continue;
        }
        writingBytes += recordBytes;
        const write = Promise.resolve()
          .then(() =>
            store.putRepositoryCapture(session.id, event.seq, record.callId, {
              ...record,
              sessionId: session.id,
              seq: event.seq,
              rootCallId: callId,
            }),
          )
          .catch((error) => report(session.id, error))
          .finally(() => {
            writes.delete(write);
            writingBytes -= recordBytes;
          });
        writes.add(write);
      }
    },
    async flush(sessionId) {
      try {
        await bounded(() => Promise.all([...writes]));
      } catch (error) {
        report(sessionId, error);
      }
    },
    dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
      known.clear();
      pending.clear();
      reported.clear();
    },
  };
}
