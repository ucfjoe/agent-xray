const CARD = 230,
  GAP = 42,
  STEP = 14;
const point = (x, y) => ({ x, y });
export function layoutGraph(nodes, inputEdges, compact) {
  const allowed = new Set(nodes),
    seen = new Set();
  const edges = inputEdges
    .filter((e) => allowed.has(e.from) && allowed.has(e.to))
    .filter((e) => {
      const key = JSON.stringify([e.from, e.to, e.kind ?? "dependency"]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((e, id) => ({ ...e, id }));
  const indegree = new Map(nodes.map((n) => [n, 0]));
  for (const e of edges)
    if (e.from !== e.to) indegree.set(e.to, indegree.get(e.to) + 1);
  const ready = nodes.filter((n) => !indegree.get(n)).sort(),
    order = [];
  while (ready.length) {
    const n = ready.shift();
    order.push(n);
    for (const e of edges.filter((e) => e.from === n && e.to !== n)) {
      indegree.set(e.to, indegree.get(e.to) - 1);
      if (!indegree.get(e.to)) {
        ready.push(e.to);
        ready.sort();
      }
    }
  }
  // Cycles remain deterministic; routing does not depend on acyclicity.
  order.push(...nodes.filter((n) => !order.includes(n)).sort());
  const index = new Map(order.map((n, i) => [n, i]));
  const level = new Map(order.map((n) => [n, 0]));
  if (!compact)
    for (const n of order)
      for (const e of edges.filter(
        (e) => e.from === n && index.get(e.to) > index.get(n),
      ))
        level.set(e.to, Math.max(level.get(e.to), level.get(n) + 1));
  const ports = new Map(),
    register = (node, side, key) => {
      const id = node + "\0" + side;
      if (!ports.has(id)) ports.set(id, []);
      ports.get(id).push(key);
    };
  const railSpans = { left: [], right: [] },
    gutters = new Map();
  const lane = (column, key) => {
    if (!gutters.has(column)) gutters.set(column, []);
    const list = gutters.get(column);
    list.push(key);
    return list.length - 1;
  };
  let outerCount = 0;
  for (const e of edges) {
    const a = index.get(e.from),
      b = index.get(e.to),
      ca = level.get(e.from),
      cb = level.get(e.to);
    if (compact) {
      if (b === a + 1) {
        e.mode = "adjacent";
        e.startSide = "bottom";
        e.endSide = "top";
      } else {
        e.mode = "side";
        const span = [Math.min(a, b), Math.max(a, b)];
        const conflicts = (side) =>
          railSpans[side].filter((s) => s[0] <= span[1] && s[1] >= span[0])
            .length;
        e.side = conflicts("right") <= conflicts("left") ? "right" : "left";
        e.lane = railSpans[e.side].length;
        railSpans[e.side].push(span);
        e.startSide = e.endSide = e.side;
      }
    } else if (ca === cb) {
      e.mode = "side";
      e.side = "right";
      e.lane = lane(ca, "same" + e.id);
      e.startSide = e.endSide = "right";
    } else if (cb === ca + 1) {
      e.mode = "across";
      e.lane = lane(ca, "across" + e.id);
      e.startSide = "right";
      e.endSide = "left";
    } else {
      e.mode = "outer";
      e.topLane = outerCount++;
      e.startSide = cb > ca ? "right" : "left";
      e.endSide = cb > ca ? "left" : "right";
      e.startLane = lane(e.startSide === "right" ? ca : ca - 1, "start" + e.id);
      e.endLane = lane(e.endSide === "right" ? cb : cb - 1, "end" + e.id);
    }
    register(e.from, e.startSide, "s" + e.id);
    register(e.to, e.endSide, "t" + e.id);
  }
  const heights = new Map(
    order.map((n) => [
      n,
      Math.max(
        66,
        24 +
          12 *
            (["left", "right"].reduce(
              (count, side) =>
                count + (ports.get(n + "\0" + side)?.length ?? 0),
              0,
            ) -
              1),
      ),
    ]),
  );
  const leftSpace = compact ? 32 + railSpans.left.length * STEP : 20;
  const gutterWidth = Math.max(
    56,
    ...[...gutters.values()].map((list) => 32 + list.length * STEP),
  );
  const positions = new Map(),
    columns = new Map();
  for (const n of order) {
    const col = compact ? 0 : level.get(n);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col).push(n);
  }
  const rowPorts = new Map(),
    nodeRow = new Map();
  for (const ns of columns.values())
    for (const [row, n] of ns.entries()) {
      nodeRow.set(n, row);
      if (!rowPorts.has(row)) rowPorts.set(row, []);
      for (const side of ["left", "right"])
        rowPorts.get(row).push(...(ports.get(n + "\0" + side) ?? []));
    }
  // In a shared gutter, routes to lower rows take the nearer rails. This
  // keeps a short route from crossing a longer sibling's vertical segment.
  for (const col of columns.keys()) {
    const across = edges.filter(
      (e) => e.mode === "across" && level.get(e.from) === col,
    );
    const lanes = across.map((e) => e.lane).sort((a, b) => a - b);
    across.sort(
      (a, b) =>
        nodeRow.get(b.to) - nodeRow.get(a.to) ||
        index.get(a.from) - index.get(b.from),
    );
    across.forEach((e, i) => {
      e.lane = lanes[i];
    });
  }
  const rowHeight = (row) =>
    Math.max(66, 24 + 12 * ((rowPorts.get(row)?.length ?? 1) - 1));
  for (const [col, ns] of columns) {
    let y = 28 + outerCount * STEP;
    for (const n of ns) {
      positions.set(n, {
        x: leftSpace + col * (CARD + gutterWidth),
        y,
        height: compact ? heights.get(n) : rowHeight(nodeRow.get(n)),
      });
      y += (compact ? heights.get(n) : rowHeight(nodeRow.get(n))) + GAP;
    }
  }
  const port = (n, side, key) => {
    const r = positions.get(n),
      // Opposite sides must not reuse the same y on a shared gutter.
      list =
        side === "left" || side === "right"
          ? compact
            ? [
                ...(ports.get(n + "\0left") ?? []),
                ...(ports.get(n + "\0right") ?? []),
              ]
            : rowPorts.get(nodeRow.get(n))
          : ports.get(n + "\0" + side),
      i = list.indexOf(key);
    const along =
      side === "left" || side === "right"
        ? 12 + ((r.height - 24) * (i + 1)) / (list.length + 1)
        : 24 + ((CARD - 48) * (i + 1)) / (list.length + 1);
    return side === "left"
      ? point(r.x, r.y + along)
      : side === "right"
        ? point(r.x + CARD, r.y + along)
        : side === "top"
          ? point(r.x + along, r.y)
          : point(r.x + along, r.y + r.height);
  };
  for (const e of edges) {
    const a = port(e.from, e.startSide, "s" + e.id),
      b = port(e.to, e.endSide, "t" + e.id),
      r = positions.get(e.from),
      t = positions.get(e.to);
    if (e.mode === "adjacent")
      e.points = [
        a,
        point(a.x, (a.y + b.y) / 2),
        point(b.x, (a.y + b.y) / 2),
        b,
      ];
    else if (e.mode === "side") {
      const x =
        e.side === "right"
          ? r.x + CARD + 18 + e.lane * STEP
          : r.x - 18 - e.lane * STEP;
      e.points = [a, point(x, a.y), point(x, b.y), b];
    } else if (e.mode === "across") {
      const x = r.x + CARD + 16 + e.lane * STEP;
      e.points = [a, point(x, a.y), point(x, b.y), b];
    } else {
      const x1 =
        e.startSide === "right"
          ? r.x + CARD + 16 + e.startLane * STEP
          : r.x - gutterWidth + 16 + e.startLane * STEP;
      const x2 =
        e.endSide === "right"
          ? t.x + CARD + 16 + e.endLane * STEP
          : t.x - gutterWidth + 16 + e.endLane * STEP;
      const y = 14 + e.topLane * STEP;
      e.points = [
        a,
        point(x1, a.y),
        point(x1, y),
        point(x2, y),
        point(x2, b.y),
        b,
      ];
    }
    e.path = e.points
      .map((p, i) => (i ? "L" : "M") + p.x + "," + p.y)
      .join(" ");
  }
  return {
    positions,
    edges,
    width: Math.max(
      310,
      ...[...positions.values()].map((r) => r.x + CARD + 20),
      ...edges.flatMap((e) => e.points.map((p) => p.x + 20)),
    ),
    height: Math.max(
      220,
      ...[...positions.values()].map((r) => r.y + r.height + 28),
    ),
  };
}
