import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const child = spawn(process.execPath, ["scripts/start-lab.js"], {
  env: { ...process.env, XRAY_PORT: "3088" }, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const ready = new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error("DSH did not become ready")), 90000);
  function read(chunk) {
    output += chunk;
    const match = output.match(/http:\/\/127\.0\.0\.1:3088\/\?token=[\w-]+/);
    if (match) { clearTimeout(deadline); resolve(match[0]); }
  }
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("error", reject);
  child.on("exit", (code) => { clearTimeout(deadline); reject(new Error("DSH exited before ready: " + code)); });
});
try {
  const loginUrl = await ready;
  const base = new URL(loginUrl).origin;
  const anonymous = await fetch(base + "/agent-xray/changes");
  assert.equal(anonymous.status, 401);
  const login = await fetch(loginUrl, { redirect: "manual" });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const headers = { cookie };
  const response = await fetch(base + "/agent-xray/changes", { headers });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.changes.some((change) => change.path === "greet.js"));
  for (const asset of ["index.html", "app.js", "examples.js", "style.css"]) {
    assert.equal((await fetch(base + "/agent-xray/" + asset, { headers })).status, 200);
  }
  assert.equal((await fetch(base + "/agent-xray/changes", { headers: { ...headers, origin: "https://example.invalid" } })).status, 403);
  console.log("Real DSH smoke test passed: plugin assets, Git changes, and authentication.");
} finally {
  child.kill("SIGTERM");
}
