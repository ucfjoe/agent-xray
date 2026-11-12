import { isAbsolute, normalize, relative, resolve } from "node:path";

// Interpret only the supplied location. Never inspect an evidence file on disk.
export function sessionPath(rawPath, cwd, root = cwd) {
  if (typeof rawPath !== "string" || !rawPath.length || rawPath.includes("\0"))
    return undefined;
  const absolute = isAbsolute(rawPath)
    ? normalize(rawPath)
    : resolve(cwd, rawPath);
  for (const base of [cwd, root]) {
    const rel = relative(base, absolute);
    if (!rel) return undefined;
    if (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel))
      return { path: rel, rawPath, locationScope: "workspace" };
  }
  return { path: absolute, rawPath, locationScope: "outside-workspace" };
}
