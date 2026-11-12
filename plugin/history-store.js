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
