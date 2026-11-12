// Keep distinguishing directory context visible; full identities remain in tooltips.
export function pathLabel(path, paths = []) {
  if (!path.startsWith("/")) return path;
  const parts = path.split("/").filter(Boolean);
  const others = [...new Set(paths)].filter((other) => other !== path);
  let count = Math.min(2, parts.length);
  while (
    count < parts.length &&
    others.some(
      (other) =>
        other === parts.slice(-count).join("/") ||
        other.endsWith("/" + parts.slice(-count).join("/")),
    )
  )
    count++;
  return (count < parts.length ? "…/" : "/") + parts.slice(-count).join("/");
}
