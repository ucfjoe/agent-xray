import { boundRepositoryRecord } from "./repository-record.js";
import {
  mkdir,
  readFile,
  writeFile,
  link,
  unlink,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const key = (x) => createHash("sha256").update(x).digest("hex");
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function publish(path, value) {
  const tmp = path + "." + randomUUID();
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  try {
    await link(tmp, path);
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    return false;
  } finally {
    await unlink(tmp);
  }
}
export function createHistoryStore(root) {
  return {
    async putRepositoryCapture(sessionId, seq, callId, capture) {
      if (
        capture.sessionId !== sessionId ||
        capture.seq !== seq ||
        !Number.isSafeInteger(seq) ||
        seq < 0 ||
        typeof callId !== "string"
      )
        throw Error("Repository capture identity mismatch");
      const bounded = boundRepositoryRecord(capture);
      const dir = join(root, key(sessionId), "repository-captures");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      return publish(
        join(dir, String(seq).padStart(20, "0") + "-" + key(callId) + ".json"),
        bounded,
      );
    },
    async getRepositoryCaptures(sessionId, throughSeq) {
      if (!Number.isSafeInteger(throughSeq) || throughSeq < 0) return [];
      const dir = join(root, key(sessionId), "repository-captures");
      let names;
      try {
        names = await readdir(dir);
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      const selected = names
        .filter(
          (n) =>
            /^\d{20}-[a-f0-9]{64}\.json$/.test(n) &&
            Number(n.slice(0, 20)) <= throughSeq,
        )
        .sort()
        .reverse()
        .slice(0, 100);
      const result = [];
      let bytes = 0,
        omitted = false;
      for (const name of selected) {
        const file = join(dir, name),
          size = (await stat(file)).size;
        if (bytes + size > 4000000) {
          omitted = true;
          continue;
        }
        const capture = JSON.parse(await readFile(file, "utf8"));
        bytes += size;
        if (capture.sessionId === sessionId && capture.seq <= throughSeq)
          result.push(capture);
      }
      if (
        selected.length <
          names.filter(
            (n) => /^\d{20}-/.test(n) && Number(n.slice(0, 20)) <= throughSeq,
          ).length ||
        result.length < selected.length ||
        omitted
      )
        result.push({
          sessionId,
          seq: throughSeq,
          observations: [],
          notices: [
            "Repository observation history limit reached; older intervals are omitted.",
          ],
        });
      return result.reverse();
    },
    async putCheckpoint(sessionId, seq, checkpoint) {
      if (
        checkpoint.sessionId !== sessionId ||
        checkpoint.seq !== seq ||
        !Number.isSafeInteger(seq)
      )
        throw Error("Checkpoint identity mismatch");
      const dir = join(root, key(sessionId), "checkpoints");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      return publish(
        join(
          dir,
          key(String(seq)) +
            (checkpoint.pathScopeVersion === 2 ? ".scope-v2.json" : ".json"),
        ),
        checkpoint,
      );
    },
    async getCheckpoint(sessionId, seq) {
      for (const suffix of [".scope-v2.json", ".json"]) {
        try {
          const s = JSON.parse(
            await readFile(
              join(
                root,
                key(sessionId),
                "checkpoints",
                key(String(seq)) + suffix,
              ),
              "utf8",
            ),
          );
          if (s.sessionId === sessionId && s.seq === seq) return s;
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      return undefined;
    },
    async put(snapshot) {
      const dir = join(root, key(snapshot.sessionId));
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, key(snapshot.snapshotId) + ".json");
      const meta = path + ".meta";
      const inserted = (await exists(path))
        ? false
        : await publish(path, snapshot);
      if (!(await exists(meta))) {
        const retained = inserted
          ? snapshot
          : JSON.parse(await readFile(path, "utf8"));
        await publish(meta, {
          sessionId: retained.sessionId,
          snapshotId: retained.snapshotId,
          capturedAt: retained.capturedAt,
          title: retained.title,
          count: retained.hunks?.length ?? 0,
        });
      }
      return inserted;
    },
    async list(sessionId) {
      const dir = join(root, key(sessionId));
      let names;
      try {
        names = await readdir(dir);
      } catch (e) {
        if (e.code === "ENOENT") return [];
        throw e;
      }
      const result = [];
      for (const name of names.filter((n) => n.endsWith(".meta"))) {
        const s = JSON.parse(await readFile(join(dir, name), "utf8"));
        if (s.sessionId === sessionId) result.push(s);
      }
      return result.sort((a, b) => a.capturedAt - b.capturedAt);
    },
    async get(sessionId, snapshotId) {
      try {
        const s = JSON.parse(
          await readFile(
            join(root, key(sessionId), key(snapshotId) + ".json"),
            "utf8",
          ),
        );
        return s.sessionId === sessionId ? s : undefined;
      } catch (e) {
        if (e.code === "ENOENT") return undefined;
        throw e;
      }
    },
  };
}
