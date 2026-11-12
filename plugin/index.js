import { createCaptureQueue } from "./capture-queue.js";
import { captureReview } from "./checkpoints.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { readChanges } from "./git.js";
import { readReview } from "./review-service.js";
import { createHistoryStore } from "./history-store.js";
export const name = "agent-xray";
export const inject = ["webServer"];
const assets = new Map(
  [
    "index.html",
    "app.js",
    "examples.js",
    "style.css",
    "core/model.js",
    "core/verification.js",
    "ui/state.js",
    "ui/render.js",
    "ui/diff.js",
    "ui/figures.js",
    "ui/paths.js",
    "ui/graph.js",
  ].map((path) => [
    "/agent-xray/" + path,
    [
      path,
      path.endsWith(".html")
        ? "text/html"
        : path.endsWith(".css")
          ? "text/css"
          : "text/javascript",
    ],
  ]),
);
export function apply(ctx) {
  const store = createHistoryStore(
    join(
      process.env.DSH_HOME ?? join(homedir(), ".dsh"),
      "agent-xray",
      "history",
    ),
  );
  const services = () => ({
    sessionQuery: ctx.get("sessionQuery"),
    workspaceChanges: ctx.get("workspaceChanges"),
    readCheckpoint: (id, seq) => store.getCheckpoint(id, seq),
  });
  const captureFailures = new Map();
  const queue = createCaptureQueue({
    capture: (sessionId, seq, type, signal) =>
      captureReview({
        services: services(),
        store,
        sessionId,
        seq,
        type,
        signal,
      }),
    onError: (id, seq) => {
      if (captureFailures.size >= 100 && !captureFailures.has(id))
        captureFailures.delete(captureFailures.keys().next().value);
      captureFailures.set(
        id,
        `Background history capture could not retain event ${seq}. Some exact historical ranges may be unavailable.`,
      );
    },
  });
  if (typeof ctx.on === "function")
    ctx.on("session/event", (session, event) => {
      if (["workspace/changes", "turn/end"].includes(event.type))
        queue.enqueue(session.id, event.seq, event.type);
    });
  ctx.effect(() => () => queue.dispose());
  ctx.effect(
    () =>
      ctx.get("webServer").register({
        kind: "prefix",
        path: "/agent-xray",
        handler: async (req, res) => {
          const connection = ctx.get("connection");
          if (!connection?.admit) {
            res.writeHead(503);
            res.end("Authentication unavailable");
            return;
          }
          const admission = connection.admit(req);
          if ("rejection" in admission) {
            res.writeHead(admission.rejection);
            res.end("Authentication required");
            return;
          }
          if (req.method !== "GET") {
            res.writeHead(405, { Allow: "GET" });
            res.end();
            return;
          }
          const url = new URL(req.url, "http://localhost");
          const json = (status, value) => {
            res.writeHead(status, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            });
            res.end(JSON.stringify(value));
          };
          try {
            if (url.pathname === "/agent-xray/review") {
              const sessionId = url.searchParams.get("session");
              const result = await readReview({
                services: services(),
                store,
                sessionId,
                snapshotId: url.searchParams.get("snapshot"),
                scope: url.searchParams.get("scope"),
              });
              if (captureFailures.has(sessionId))
                result.notices = [
                  ...result.notices,
                  captureFailures.get(sessionId),
                ];
              json(200, result);
              return;
            }
            // Explicit lab endpoint retained for smoke tests; normal panels never use it.
            if (url.pathname === "/agent-xray/changes") {
              if (!process.env.XRAY_TEST_REPOSITORY)
                throw Error("Lab repository is not configured");
              json(200, await readChanges(process.env.XRAY_TEST_REPOSITORY));
              return;
            }
            const asset = assets.get(url.pathname);
            if (!asset) {
              res.writeHead(404);
              res.end();
              return;
            }
            const content = await readFile(
              new URL("../" + asset[0], import.meta.url),
            );
            res.writeHead(200, {
              "Content-Type": asset[1] + "; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(content);
          } catch (error) {
            json(error.statusCode === 404 ? 404 : 503, {
              error: error.message,
            });
          }
        },
      }),
    "agent-xray: routes",
  );
}
