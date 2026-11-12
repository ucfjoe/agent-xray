import { readFile } from "node:fs/promises";
import { readChanges } from "./git.js";

export const name = "agent-xray";
export const inject = ["webServer"];
const assets = new Map([
  ["/agent-xray/index.html", ["../index.html", "text/html"]],
  ["/agent-xray/app.js", ["../app.js", "text/javascript"]],
  ["/agent-xray/style.css", ["../style.css", "text/css"]],
]);

export function apply(ctx) {
  const server = ctx.get("webServer");
  ctx.effect(() => server.register({
    kind: "prefix",
    path: "/agent-xray",
    handler: async (req, res) => {
      const connection = ctx.get("connection");
      if (!connection || typeof connection.admit !== "function") {
        res.writeHead(503);
        res.end("DSH connection authentication unavailable");
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
      const path = new URL(req.url, "http://localhost").pathname;
      try {
        if (path === "/agent-xray/changes") {
          if (!process.env.XRAY_TEST_REPOSITORY) throw new Error("Test repository is not configured");
          const result = await readChanges(process.env.XRAY_TEST_REPOSITORY);
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify(result));
          return;
        }
        const asset = assets.get(path);
        if (!asset) { res.writeHead(404); res.end(); return; }
        const content = await readFile(new URL(asset[0], import.meta.url));
        res.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8", "Cache-Control": "no-store" });
        res.end(content);
      } catch (error) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
    },
  }), "agent-xray: routes");
}
