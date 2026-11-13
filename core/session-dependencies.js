import ts from "typescript";
import { posix as path } from "node:path";

const language = (p) =>
  /\.[cm]?[jt]sx?$/.test(p)
    ? "javascript/typescript"
    : p.endsWith(".py")
      ? "python"
      : p.endsWith(".go")
        ? "go"
        : /\.kts?$/.test(p)
          ? "kotlin"
          : path.basename(p) === "go.mod"
            ? "go-module"
            : null;
const unique = (xs) => [...new Set(xs)];

// Only lexical prefixes or explicitly supplied complete recorded sources are safe.
// An arbitrary excerpt can start inside an unseen multiline comment/string.
export function analyzeSessionDependencies(snapshot) {
  const events = new Map(
    (snapshot.events ?? []).map((e, i) => [e.id, e.seq ?? i]),
  );
  const rank = (h, i) => {
    const prefix = snapshot.sessionId ? snapshot.sessionId + ":" : null;
    const suffix =
      prefix && h.sourceId?.startsWith(prefix)
        ? h.sourceId.slice(prefix.length)
        : "";
    return (
      h.seq ??
      events.get(h.sourceId) ??
      (/^\d+$/.test(suffix) ? Number(suffix) : undefined) ??
      events.get(h.eventId) ??
      i
    );
  };
  const latest = new Map();
  for (const [i, h] of (snapshot.hunks ?? []).entries()) {
    const r = rank(h, i),
      prev = latest.get(h.path);
    if (!prev || r > prev.rank) latest.set(h.path, { rank: r, hunks: [h] });
    else if (r === prev.rank) prev.hunks.push(h);
  }
  const sources = new Map(),
    skipped = [];
  for (const [p, item] of latest) {
    if (!language(p)) continue;
    const h = item.hunks.find(
      (x) => x.newStart === 1 && x.rangeKind === "file",
    );
    if (!h) {
      skipped.push({
        path: p,
        reason: "Latest recorded change has no verified file prefix.",
      });
      continue;
    }
    sources.set(p, {
      path: p,
      content: h.lines
        .filter((l) => /^[ +]/.test(l))
        .map((l) => l.slice(1))
        .join("\n"),
      sourceId: h.sourceId,
      hunkId: h.id,
      rank: item.rank,
    });
  }
  for (const s of snapshot.dependencySources ?? []) {
    if (!s.complete || typeof s.content !== "string" || !language(s.path))
      continue;
    const r = Number.isFinite(s.seq) ? s.seq : events.get(s.sourceId);
    if (
      latest.has(s.path) &&
      (!Number.isFinite(r) || r < latest.get(s.path).rank)
    )
      continue;
    sources.set(s.path, s);
    const i = skipped.findIndex((x) => x.path === s.path);
    if (i >= 0) skipped.splice(i, 1);
  }
  const paths = new Set([
    ...(snapshot.hunks ?? []).map((h) => h.path),
    ...(snapshot.files ?? []).map((f) => f.path),
    ...sources.keys(),
  ]);
  for (const f of snapshot.files ?? [])
    if (f.kind === "deleted") {
      paths.delete(f.path);
      sources.delete(f.path);
    }
  let limited = false,
    sourceBytes = 0;
  for (const [p, source] of sources) {
    const bytes = Buffer.byteLength(source.content);
    if (bytes > 512000 || sourceBytes + bytes > 2000000) {
      sources.delete(p);
      limited = true;
      skipped.push({
        path: p,
        reason: "Recorded source analysis limit reached.",
      });
    } else sourceBytes += bytes;
  }
  const scopeCache = new Map();
  const findModuleScope = (p) =>
    [...paths]
      .filter(
        (x) =>
          /(?:^|\/)(?:build\.gradle(?:\.kts)?|pom\.xml)$/.test(x) &&
          (path.dirname(x) === "."
            ? !path.isAbsolute(p)
            : p.startsWith(path.dirname(x) + "/")),
      )
      .map((x) => path.dirname(x))
      .sort((a, b) => b.length - a.length)[0];
  const moduleScope = (p) => {
    if (!scopeCache.has(p)) scopeCache.set(p, findModuleScope(p));
    return scopeCache.get(p);
  };
  const kotlinScopeMatches = (a, b) =>
    path.dirname(a) === path.dirname(b) ||
    (moduleScope(a) !== undefined && moduleScope(a) === moduleScope(b));
  const declarations = [],
    packages = [],
    modules = [];
  for (const source of sources.values()) {
    const kind = language(source.path);
    const add = (spec, extra = {}) => {
      if (declarations.length >= 2000) {
        limited = true;
        return;
      }
      declarations.push({
        ...source,
        content: undefined,
        language: kind,
        specifier: spec,
        ...extra,
      });
    };
    if (kind === "javascript/typescript") {
      const tree = ts.createSourceFile(
        source.path,
        source.content,
        ts.ScriptTarget.Latest,
        true,
      );
      for (const node of tree.statements) {
        const valid = !tree.parseDiagnostics.some(
          (d) => d.start >= node.pos && d.start <= node.end,
        );
        if (
          valid &&
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          add(node.moduleSpecifier.text);
        if (
          valid &&
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference) &&
          node.moduleReference.expression &&
          ts.isStringLiteral(node.moduleReference.expression)
        )
          add(node.moduleReference.expression.text);
      }
      continue;
    }
    // Small header grammars: unsupported constructs stop parsing rather than guess.
    let block = 0,
      goGroup = false,
      pkg;
    for (const raw of source.content.split("\n")) {
      let line = raw.trim();
      if (kind !== "python") {
        let rest = "",
          i = 0;
        while (i < line.length) {
          if (block) {
            if (line.startsWith("/*", i) && kind === "kotlin") {
              block++;
              i += 2;
            } else if (line.startsWith("*/", i)) {
              block--;
              i += 2;
            } else i++;
          } else if (line.startsWith("/*", i) && !rest.trim()) {
            block++;
            i += 2;
          } else {
            rest += line.slice(i);
            break;
          }
        }
        line = rest.trim();
      }
      if (!line || line.startsWith(kind === "python" ? "#" : "//")) continue;
      let m;
      if (kind === "go-module") {
        if ((m = /^module\s+([\w./~-]+)\s*(?:\/\/.*)?$/.exec(line)))
          modules.push({ root: path.dirname(source.path), name: m[1] });
        break;
      }
      if (kind === "python") {
        if (
          (m = /^from\s+(\.*[\w.]*)\s+import\s+([\w*, ]+)(?:\s+#.*)?$/.exec(
            line,
          ))
        ) {
          add(m[1], { names: m[2].split(",").map((x) => x.trim()) });
          continue;
        }
        if ((m = /^import\s+([\w., ]+)(?:\s+#.*)?$/.exec(line))) {
          for (const spec of m[1].split(",")) add(spec.trim());
          continue;
        }
        break;
      }
      if (kind === "go") {
        if (/^package\s+\w+\s*(?:\/\/.*)?$/.test(line)) continue;
        if (/^import\s*\(\s*(?:\/\/.*)?$/.test(line)) {
          goGroup = true;
          continue;
        }
        if (goGroup && /^\)\s*;?$/.test(line)) {
          goGroup = false;
          continue;
        }
        m = (
          goGroup
            ? /^(?:(?:\w+|\.)\s+)?"([^"\\]+)"\s*(?:\/\/.*)?$/
            : /^import\s+(?:(?:\w+|\.)\s+)?"([^"\\]+)"\s*;?\s*(?:\/\/.*)?$/
        ).exec(line);
        if (m) {
          add(m[1]);
          continue;
        }
        break;
      }
      if (kind === "kotlin") {
        if ((m = /^package\s+([\w.]+)\s*;?\s*(?:\/\/.*)?$/.exec(line))) {
          pkg = m[1];
          continue;
        }
        if (
          (m = /^import\s+([\w.*]+)(?:\s+as\s+\w+)?\s*;?\s*(?:\/\/.*)?$/.exec(
            line,
          ))
        ) {
          add(m[1]);
          continue;
        }
        if (
          pkg &&
          (m =
            /^(?:(?:public|internal|private|protected|data|sealed|open|abstract|enum|annotation|value|inline|expect|actual)\s+)*(?:class|object|interface|fun|val|var|typealias)\s+(\w+)\b/.exec(
              line,
            ))
        )
          packages.push({ symbol: pkg + "." + m[1], path: source.path });
        break;
      }
    }
  }
  const dependencies = [],
    unresolved = [];
  const addEdge = (d, to) => {
    if (dependencies.length >= 2000) {
      limited = true;
      return;
    }
    dependencies.push(edge(d, to));
  };
  for (const d of declarations) {
    let candidates = [];
    if (d.language === "javascript/typescript" && d.specifier.startsWith(".")) {
      const base = path.normalize(path.join(path.dirname(d.path), d.specifier));
      candidates = [
        base,
        ...[
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mts",
          ".cts",
          ".mjs",
          ".cjs",
          "/index.ts",
          "/index.tsx",
          "/index.js",
        ].map((x) => base + x),
      ];
      if (/\.[cm]?js$/.test(base))
        candidates.push(
          base
            .replace(/\.js$/, ".ts")
            .replace(/\.mjs$/, ".mts")
            .replace(/\.cjs$/, ".cts"),
        );
    } else if (d.language === "python" && d.specifier.startsWith(".")) {
      const dots = /^\.+/.exec(d.specifier)[0].length;
      let dir = path.dirname(d.path);
      for (let i = 1; i < dots; i++) dir = path.dirname(dir);
      const suffix = d.specifier.slice(dots).replaceAll(".", "/");
      const bases = suffix
        ? [path.join(dir, suffix)]
        : (d.names ?? [])
            .filter((n) => /^\w+$/.test(n))
            .map((n) => path.join(dir, n));
      candidates = bases.flatMap((b) => [
        b + ".py",
        path.join(b, "__init__.py"),
      ]);
    } else if (d.language === "go") {
      const own = modules
        .filter((m) =>
          m.root === "."
            ? !path.isAbsolute(d.path) && !d.path.startsWith("../")
            : d.path.startsWith(m.root + "/"),
        )
        .sort((a, b) => b.root.length - a.root.length)[0];
      if (
        own &&
        (d.specifier === own.name || d.specifier.startsWith(own.name + "/"))
      ) {
        const target = path.join(own.root, d.specifier.slice(own.name.length));
        candidates = [...paths].filter(
          (p) =>
            p.endsWith(".go") &&
            !p.endsWith("_test.go") &&
            path.dirname(p) === target &&
            !modules.some(
              (m) =>
                m !== own &&
                p.startsWith(m.root + "/") &&
                m.root.startsWith(own.root === "." ? "" : own.root + "/"),
            ),
        );
        // Imports identify a package, represented by its recorded files.
        if (candidates.length) {
          for (const to of candidates) addEdge(d, to);
          continue;
        }
      }
    } else if (d.language === "kotlin")
      candidates = packages
        .filter(
          (p) => p.symbol === d.specifier && kotlinScopeMatches(p.path, d.path),
        )
        .map((p) => p.path);
    candidates = unique(candidates.filter((p) => paths.has(p)));
    if (candidates.length === 1) addEdge(d, candidates[0]);
    else
      unresolved.push({
        from: d.path,
        specifier: d.specifier,
        language: d.language,
        sourceId: d.sourceId,
        reason: candidates.length
          ? "Ambiguous recorded targets."
          : "Target cannot be resolved from recorded evidence.",
      });
  }
  return {
    dependencies: [
      ...new Map(
        dependencies.map((d) => [d.from + "\0" + d.to + "\0" + d.specifier, d]),
      ).values(),
    ],
    dependencyAnalysis: {
      status: sources.size ? "partial" : "unavailable",
      analyzedFiles: sources.size,
      limited,
      skipped,
      unresolved,
      summary:
        (limited ? "Analysis limit reached. " : "") +
        (sources.size
          ? `Analyzed recorded prefixes for ${sources.size} files; ${unresolved.length} unresolved imports and ${skipped.length} files without safe source evidence. Coverage is partial.`
          : "Dependency analysis unavailable: no verified source prefixes were recorded."),
      note: "Recorded imports only; incomplete source coverage. Imports are not runtime calls.",
    },
  };
}
function edge(d, to) {
  return {
    from: d.path,
    to,
    kind: "import",
    specifier: d.specifier,
    provenance: "observed",
    sourceId: d.sourceId,
    hunkId: d.hunkId,
    rationale:
      d.language === "go"
        ? "Recorded package import matched using recorded go.mod; target is a recorded package file, not proof of build inclusion."
        : "Import declaration in recorded source; target matched against recorded paths or declarations.",
  };
}
