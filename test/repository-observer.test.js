import test from "node:test";
import assert from "node:assert/strict";
import { createRepositoryObserver } from "../plugin/repository-observer.js";
const exec = {
  name: "bash",
  callId: "c",
  arguments: { command: "true" },
  agent: { session: { id: "s", header: { cwd: "/repo" } } },
};
const event = (seq) => ({
  type: "tool/result",
  seq,
  data: { message: { toolCallId: "c" } },
});
test("pre-capture is awaited and evidence persists only at matching completion boundary", async () => {
  const order = [],
    saved = [];
  const observer = createRepositoryObserver({
    store: { putRepositoryCapture: async (...args) => saved.push(args) },
    discover: async () => ({ roots: ["/repo"], notices: [] }),
    capture: async () => {
      order.push("before");
      return { root: "/repo" };
    },
    compare: async () => {
      order.push("after");
      return {
        root: "/repo",
        hunks: [{ path: "/repo/a", lines: ["+new"] }],
        files: [],
      };
    },
  });
  const value = { isError: false, value: { kind: "foreground" } };
  assert.equal(
    await observer.execute(exec, async () => {
      order.push("tool");
      return value;
    }),
    value,
  );
  assert.deepEqual(order, ["before", "tool", "after"]);
  assert.equal(saved.length, 0);
  observer.onEvent({ id: "other" }, event(3));
  assert.equal(saved.length, 0);
  observer.onEvent({ id: "s" }, event(3));
  await observer.flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0][1], 3);
  assert.equal(saved[0][3].sessionId, "s");
});
test("capture errors never replace tool errors and partial writes still get observed", async () => {
  let after = 0;
  const error = Error("tool failure");
  const observer = createRepositoryObserver({
    store: { putRepositoryCapture: async () => {} },
    discover: async () => ({ roots: ["/repo"], notices: [] }),
    capture: async () => ({ root: "/repo" }),
    compare: async () => {
      after++;
      throw Error("observer failure");
    },
  });
  await assert.rejects(
    observer.execute(exec, async () => {
      throw error;
    }),
    (e) => e === error,
  );
  assert.equal(after, 1);
});
test("timed out baseline cannot delay or become a false successful capture", async () => {
  let ran = false,
    compared = false;
  const observer = createRepositoryObserver({
    timeoutMs: 10,
    store: {},
    discover: async () => ({ roots: ["/repo"], notices: [] }),
    capture: async () => new Promise(() => {}),
    compare: async () => {
      compared = true;
    },
  });
  assert.equal(
    await observer.execute(exec, async () => {
      ran = true;
      return 42;
    }),
    42,
  );
  assert.ok(ran);
  assert.equal(compared, false);
});
test("background job coverage is explicit and disposal does not suppress tool execution", async () => {
  const saved = [];
  const observer = createRepositoryObserver({
    store: { putRepositoryCapture: async (...a) => saved.push(a[3]) },
    discover: async () => ({ roots: [], notices: [] }),
  });
  await observer.execute(exec, async () => ({
    isError: false,
    value: { kind: "promoted", jobId: "j" },
  }));
  observer.onEvent({ id: "s" }, event(2));
  await observer.flush();
  assert.ok(saved[0].notices.some((n) => n.includes("background")));
  observer.dispose();
  assert.equal(await observer.execute(exec, async () => 7), 7);
});
test("outer intervals subsume nested captures without doubling changed lines", async () => {
  const saved = [];
  const observer = createRepositoryObserver({
    store: { putRepositoryCapture: async (...a) => saved.push(a[3]) },
    discover: async () => ({ roots: ["/repo"], notices: [] }),
    capture: async () => ({ root: "/repo" }),
    compare: async () => ({
      root: "/repo",
      hunks: [{ path: "/repo/a", lines: ["+new"] }],
      files: [],
    }),
  });
  await observer.execute({ ...exec, name: "run_code" }, async () =>
    observer.execute(
      { ...exec, callId: "child", rootCallId: "c" },
      async () => ({ isError: false }),
    ),
  );
  observer.onEvent({ id: "s" }, event(5));
  await observer.flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].callId, "c");
  assert.equal(saved[0].observations[0].hunks.length, 1);
});
test("unchanged commands do not fill observation history with empty records", async () => {
  const saved = [];
  const observer = createRepositoryObserver({
    store: { putRepositoryCapture: async (...a) => saved.push(a) },
    discover: async () => ({
      roots: ["/repo"],
      notices: ["Persistent directory may be unknown."],
    }),
    capture: async () => ({ root: "/repo" }),
    compare: async () => ({ root: "/repo", hunks: [], files: [] }),
  });
  for (let seq = 1; seq <= 3; seq++) {
    await observer.execute(exec, async () => ({}));
    observer.onEvent({ id: "s" }, event(seq));
    await observer.flush();
  }
  assert.equal(saved.length, 1);
});
test("cancellation cannot erase tracked roots and post-discovery uses an independent deadline", async () => {
  const controller = new AbortController();
  let calls = 0;
  const found = [];
  const observer = createRepositoryObserver({
    store: { putRepositoryCapture: async () => {} },
    discover: async ({ exec, knownRoots }) => {
      found.push({ aborted: exec.signal?.aborted, knownRoots });
      calls++;
      return { roots: calls === 1 ? ["/other"] : knownRoots, notices: [] };
    },
    capture: async () => ({ root: "/other" }),
    compare: async () => ({ root: "/other", hunks: [], files: [] }),
  });
  await observer.execute({ ...exec, signal: controller.signal }, async () => {
    controller.abort();
    return { isError: true };
  });
  await observer.execute({ ...exec, callId: "next" }, async () => ({}));
  assert.equal(found[1].aborted, false);
  assert.deepEqual(found[2].knownRoots, ["/other"]);
});
test("partial outer observations never discard a different nested file delta", async () => {
  const saved = [];
  let index = 0;
  const observer = createRepositoryObserver({
    store: { putRepositoryCapture: async (...a) => saved.push(a[3]) },
    discover: async () => ({ roots: ["/repo"], notices: [] }),
    capture: async () => ({ root: "/repo" }),
    compare: async () => ({
      root: "/repo",
      hunks: index++ === 0 ? [{ path: "/repo/child", lines: ["+child"] }] : [],
      files: [{ path: "/repo/other", kind: "unavailable" }],
    }),
  });
  await observer.execute({ ...exec, name: "run_code" }, async () =>
    observer.execute(
      { ...exec, callId: "child", rootCallId: "c" },
      async () => ({}),
    ),
  );
  observer.onEvent({ id: "s" }, event(5));
  await observer.flush();
  assert.ok(
    saved.some((record) =>
      record.observations.some((row) =>
        row.hunks.some((h) => h.path === "/repo/child"),
      ),
    ),
  );
});
test("slow persistence cannot accumulate an unbounded queue", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let started = 0;
  const errors = [];
  const observer = createRepositoryObserver({
    store: {
      putRepositoryCapture: async () => {
        started++;
        await gate;
      },
    },
    onError: (_id, error) => errors.push(error.message),
    discover: async () => ({ roots: ["/repo"], notices: [] }),
    capture: async () => ({ root: "/repo" }),
    compare: async () => ({
      root: "/repo",
      hunks: [{ path: "/repo/a", lines: ["+change"] }],
      files: [],
    }),
  });
  for (let seq = 1; seq <= 40; seq++) {
    await observer.execute(exec, async () => ({}));
    observer.onEvent({ id: "s" }, event(seq));
  }
  assert.equal(started, 32);
  assert.ok(errors.some((error) => error.includes("persistence queue limit")));
  release();
  await observer.flush();
});
