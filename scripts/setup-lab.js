import { mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const home = join(root, ".lab", "dsh-home");
const profile = join(home, "profiles", "web");
mkdirSync(profile, { recursive: true });
const env = { ...process.env, DSH_HOME: home };
const dsh = process.env.DSH_BIN || "dsh";
execFileSync(dsh, ["web", "--help"], { env, stdio: "inherit" });
const manifestPath = join(profile, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.dependencies["dsh-agent-xray"] = "link:" + root;
if (!manifest.dsh.profile.bundles.includes("dsh-agent-xray")) manifest.dsh.profile.bundles.push("dsh-agent-xray");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
mkdirSync(join(profile, "node_modules"), { recursive: true });
const link = join(profile, "node_modules", "dsh-agent-xray");
if (!existsSync(link)) symlinkSync(root, link, "dir");

const repo = join(root, ".lab", "sample-repo");
mkdirSync(repo, { recursive: true });
if (!existsSync(join(repo, ".git"))) {
  const git = (args) => execFileSync("git", ["-C", repo, ...args], { stdio: "inherit" });
  git(["init", "-b", "main"]);
  writeFileSync(join(repo, "greet.js"), 'export function greet(name) {\n  return "Hello " + name;\n}\n');
  git(["add", "greet.js"]);
  git(["-c", "user.name=X-Ray Lab", "-c", "user.email=lab@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Create test fixture"]);
  writeFileSync(join(repo, "greet.js"), 'export function greet(name) {\n  if (!name.trim()) throw new Error("Name is required");\n  return "Hello " + name.trim();\n}\n');
}
console.log("Lab ready. Run npm run lab:start");
