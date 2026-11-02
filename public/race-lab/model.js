/* Transparent, illustrative planning model. No local staffing rules are represented. */
(function (root) {
  'use strict';
  const DEFAULTS = {
    officers: [1, 1, 2, 3],
    barriers: [1, 1, 2, 3],
    weights: [1, 2, 4, 7],
    rate: 85,
    setup: 45,
    clear: 20,
    wave: 15,
    fast: 4,
    slow: 12,
    minimumShift: 0,
    mode: 'full',
    start: '08:00',
    turnWeight: 1,
    signalWeight: 2,
    trafficWeight: 0.3,
    speedWeight: 1,
    signalOfficers: 0,
    // Barricades per alley mouth that touches the course. Zero means alley mouths are counted but not resourced.
    alleyBarriers: 0,
    // Typical distance from street centerline to curb, used only for the shortest-route distance estimate.
    curbOffset: 4.5,
  };
  const CLASSES = ['Local', 'Collector', 'Minor arterial', 'Principal arterial'];
  // DPW street types for freeway connections. They are excluded from race routing but are side approaches.
  const LIMITED_ACCESS_TYPES = ['Ramp', 'Highway', 'Highway Interchange'];
  // Assumption: a junction with a freeway connection uses the highest review category. Editable per site.
  const LIMITED_ACCESS_CLASS = 3;
  // Certified courses are measured 0.30 m from the curb on the shortest possible route.
  const RUNNER_OFFSET = 0.3;
  const CLASS_PENALTY = [0, 0.25, 0.7, 1.5];
  const REUSE_PENALTY = 2.8;
  const COS_45 = Math.SQRT1_2;

  class Heap {
    constructor() {
      this.a = [];
    }
    push(x) {
      let a = this.a,
        i = a.length;
      a.push(x);
      while (i) {
        let p = (i - 1) >> 1;
        if (a[p][0] <= x[0]) break;
        a[i] = a[p];
        i = p;
      }
      a[i] = x;
    }
    pop() {
      let a = this.a,
        r = a[0],
        x = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          let l = i * 2 + 1;
          if (l >= a.length) break;
          let q = l + 1 < a.length && a[l + 1][0] < a[l][0] ? l + 1 : l;
          if (a[q][0] >= x[0]) break;
          a[i] = a[q];
          i = q;
        }
        a[i] = x;
      }
      return r;
    }
  }

  function isLimitedAccess(e) {
    return e.limitedAccess === true || LIMITED_ACCESS_TYPES.includes(e.roadType);
  }
  // A side approach is any public road: routable streets plus excluded public roads such as ramps.
  // Alleys and private streets are not approaches; alley mouths are counted separately.
  function isApproach(e) {
    return e.c >= 0 || e.publicRoad === true;
  }
  function isAlley(e) {
    return e.roadType === 'Alley';
  }
  function approachClass(e) {
    if (e.c >= 0) return e.c;
    if (isLimitedAccess(e)) return LIMITED_ACCESS_CLASS;
    return Number.isInteger(e.fc) && e.fc >= 0 && e.fc <= 3 ? e.fc : 0;
  }

  function hashString(text, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
  // Content-addressed route ID: the same ordered street sequence always gets the same ID,
  // and different routes get different IDs.
  function routeId(edges) {
    const text = edges.join(',');
    return 'r' + hashString(text, 0x811c9dc5) + hashString(text, 0x9747b28c);
  }

  function createNetwork(data) {
    const adj = data.nodes.map(() => []),
      approach = data.nodes.map(() => []),
      alleys = data.nodes.map(() => []);
    data.edges.forEach((e, i) => {
      if (e.c >= 0) {
        adj[e.a].push([e.b, i]);
        adj[e.b].push([e.a, i]);
      }
      if (isApproach(e)) {
        approach[e.a].push([e.b, i]);
        approach[e.b].push([e.a, i]);
      } else if (isAlley(e)) {
        alleys[e.a].push(i);
        alleys[e.b].push(i);
      }
    });
    const nearest = (x, y, max = Infinity) => {
      let found = -1,
        best = max * max;
      data.nodes.forEach((p, i) => {
        if (!adj[i].length) return;
        let d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
        if (d < best) {
          best = d;
          found = i;
        }
      });
      return found;
    };
    const edgeCost = (ei, penalty, avoid) => {
      const e = data.edges[ei];
      let cost = e.l * (1 + penalty * CLASS_PENALTY[e.c]);
      if (avoid.has(ei)) cost *= REUSE_PENALTY;
      return cost;
    };
    // True when the path a -> b -> c turns by more than 45 degrees. Same definition as the turn count.
    const turnsAt = (a, b, c) => {
      const A = data.nodes[a],
        B = data.nodes[b],
        C = data.nodes[c];
      const vx = B[0] - A[0],
        vy = B[1] - A[1],
        wx = C[0] - B[0],
        wy = C[1] - B[1];
      const den = Math.hypot(vx, vy) * Math.hypot(wx, wy);
      return den > 0 && (vx * wx + vy * wy) / den < COS_45;
    };
    function unwind(prev, prevEdge, start, end) {
      let nodes = [end],
        edges = [],
        v = end;
      while (v !== start) {
        edges.push(prevEdge[v]);
        v = prev[v];
        if (v < 0) return null;
        nodes.push(v);
      }
      nodes.reverse();
      edges.reverse();
      return { nodes, edges, length: edges.reduce((s, i) => s + data.edges[i].l, 0) };
    }
    // Node-based A*. Edge costs are never below the straight-line distance, so the heuristic is consistent.
    function path(start, end, penalty = 0, avoid = new Set(), blocked = new Set()) {
      if (start === end) return { nodes: [start], edges: [], length: 0 };
      if (start < 0 || end < 0) return null;
      const dist = new Float64Array(data.nodes.length).fill(Infinity),
        prev = new Int32Array(data.nodes.length).fill(-1),
        prevEdge = new Int32Array(data.nodes.length).fill(-1),
        heap = new Heap();
      const target = data.nodes[end];
      const h = (i) => Math.hypot(data.nodes[i][0] - target[0], data.nodes[i][1] - target[1]);
      dist[start] = 0;
      heap.push([h(start), start, 0]);
      while (heap.a.length) {
        let [, n, d] = heap.pop();
        if (d > dist[n] + 0.001) continue;
        if (n === end) break;
        for (const [to, ei] of adj[n]) {
          if (blocked.has(ei)) continue;
          const nd = d + edgeCost(ei, penalty, avoid);
          if (nd < dist[to]) {
            dist[to] = nd;
            prev[to] = n;
            prevEdge[to] = ei;
            heap.push([nd + h(to), to, nd]);
          }
        }
      }
      if (!Number.isFinite(dist[end])) return null;
      return unwind(prev, prevEdge, start, end);
    }
    // Edge-state A* that adds a fixed cost for each turn over 45 degrees. Used by the fewer-turns search.
    function pathWithTurns(start, end, penalty, avoid, blocked, turnPenalty, fromNode = -1) {
      if (start === end) return { nodes: [start], edges: [], length: 0 };
      if (start < 0 || end < 0) return null;
      const E = data.edges.length,
        dist = new Float64Array(E * 2).fill(Infinity),
        prev = new Int32Array(E * 2).fill(-1),
        heap = new Heap();
      const target = data.nodes[end];
      const h = (i) => Math.hypot(data.nodes[i][0] - target[0], data.nodes[i][1] - target[1]);
      const head = (st) => (st & 1 ? data.edges[st >> 1].a : data.edges[st >> 1].b);
      const tail = (st) => (st & 1 ? data.edges[st >> 1].b : data.edges[st >> 1].a);
      for (const [to, ei] of adj[start]) {
        if (blocked.has(ei)) continue;
        const st = ei * 2 + (data.edges[ei].a === start ? 0 : 1);
        const d =
          edgeCost(ei, penalty, avoid) + (fromNode >= 0 && turnsAt(fromNode, start, to) ? turnPenalty : 0);
        if (d < dist[st]) {
          dist[st] = d;
          heap.push([d + h(to), st, d]);
        }
      }
      let goal = -1;
      while (heap.a.length) {
        const [, st, d] = heap.pop();
        if (d > dist[st] + 0.001) continue;
        const n = head(st);
        if (n === end) {
          goal = st;
          break;
        }
        const from = tail(st),
          current = st >> 1;
        for (const [to, ei] of adj[n]) {
          if (ei === current || blocked.has(ei)) continue;
          const next = ei * 2 + (data.edges[ei].a === n ? 0 : 1);
          const nd = d + edgeCost(ei, penalty, avoid) + (turnsAt(from, n, to) ? turnPenalty : 0);
          if (nd < dist[next]) {
            dist[next] = nd;
            prev[next] = st;
            heap.push([nd + h(to), next, nd]);
          }
        }
      }
      if (goal < 0) return null;
      const edges = [],
        nodes = [end];
      for (let st = goal; st >= 0; st = prev[st]) {
        edges.push(st >> 1);
        nodes.push(tail(st));
      }
      edges.reverse();
      nodes.reverse();
      return { nodes, edges, length: edges.reduce((s, i) => s + data.edges[i].l, 0) };
    }
    // Connect waypoints in order. avoidReuse discourages candidate loops from retracing streets;
    // drawing and importing turn it off so out-and-back courses stay on the same street.
    function via(waypoints, penalty = 0, blocked = new Set(), options = {}) {
      const avoidReuse = options.avoidReuse !== false,
        turnPenalty = options.turnPenalty || 0,
        none = new Set();
      let nodes = [],
        edges = [],
        used = new Set();
      for (let i = 1; i < waypoints.length; i++) {
        const avoid = avoidReuse ? used : none,
          fromNode = nodes.length > 1 ? nodes[nodes.length - 2] : -1;
        const p =
          turnPenalty > 0
            ? pathWithTurns(waypoints[i - 1], waypoints[i], penalty, avoid, blocked, turnPenalty, fromNode)
            : path(waypoints[i - 1], waypoints[i], penalty, avoid, blocked);
        if (!p) return null;
        nodes.push(...(i === 1 ? p.nodes : p.nodes.slice(1)));
        edges.push(...p.edges);
        p.edges.forEach((e) => used.add(e));
      }
      return {
        nodes,
        edges,
        waypoints: waypoints.slice(),
        length: edges.reduce((s, i) => s + data.edges[i].l, 0),
      };
    }
    return { data, adj, approach, alleys, nearest, path, via, factCache: new Map() };
  }

  function deflection(D, a, b, c) {
    const A = D.nodes[a],
      B = D.nodes[b],
      C = D.nodes[c];
    const v = [B[0] - A[0], B[1] - A[1]],
      w = [C[0] - B[0], C[1] - B[1]];
    const den = Math.hypot(...v) * Math.hypot(...w);
    if (!den) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (v[0] * w[0] + v[1] * w[1]) / den)));
  }

  // Estimated corner-cutting on the shortest possible route. A runner holding the inside line,
  // RUNNER_OFFSET from the curb, saves about 2 * (curb offset - runner offset) * tan(angle / 2) per turn.
  function cornerCut(D, route, curbOffset) {
    const offset = Math.max(0, Number(curbOffset) - RUNNER_OFFSET),
      n = route.nodes.length;
    if (!offset || n < 3) return 0;
    const closed = route.nodes[0] === route.nodes[n - 1];
    let cut = 0;
    const add = (a, b, c, inEdge, outEdge) => {
      const angle = Math.min(deflection(D, a, b, c), (2 * Math.PI) / 3);
      if (angle < 1e-3) return;
      const limit = Math.min(D.edges[inEdge].l, D.edges[outEdge].l) / 2;
      cut += Math.min(2 * offset * Math.tan(angle / 2), limit);
    };
    for (let i = 1; i < n - 1; i++)
      add(route.nodes[i - 1], route.nodes[i], route.nodes[i + 1], route.edges[i - 1], route.edges[i]);
    if (closed) add(route.nodes[n - 2], route.nodes[0], route.nodes[1], route.edges.at(-1), route.edges[0]);
    return cut;
  }

  function evaluate(net, route, settings = DEFAULTS, overrides = {}) {
    const p = { ...DEFAULTS, ...settings },
      D = net.data,
      used = new Set(route.edges),
      visits = new Map(),
      distances = [0];
    route.edges.forEach((e, i) => distances.push(distances[i] + D.edges[e].l));
    route.nodes.forEach((n, i) => {
      if (!visits.has(n)) visits.set(n, []);
      visits.get(n).push(distances[i] / 1000);
    });
    const sites = [];
    for (const [n, km] of visits) {
      const incident = net.approach[n],
        external = incident.filter(([, e]) => !used.has(e));
      if (!external.length) continue;
      const names = [...new Set(incident.map(([, i]) => D.edges[i].n).filter(Boolean))];
      const roadClass = Math.max(...incident.map(([, i]) => approachClass(D.edges[i])));
      const coord = D.nodes[n];
      let same = sites.find(
        (s) => Math.hypot(s.x - coord[0], s.y - coord[1]) < 22 && s.names.some((v) => names.includes(v))
      );
      if (same) {
        same.members.push(n);
        same.km.push(...km);
        same.external.push(...external.map(([, e]) => e));
        same.c = Math.max(same.c, roadClass);
        same.names = [...new Set([...same.names, ...names])];
        continue;
      }
      sites.push({
        id: n,
        x: coord[0],
        y: coord[1],
        names,
        c: roadClass,
        members: [n],
        km: km.slice(),
        external: external.map(([, e]) => e),
      });
    }
    let rawIndex = 0,
      officerHours = 0,
      paidHours = 0,
      siteBarricades = 0;
    const components = { hierarchy: 0, approaches: 0, signals: 0, traffic: 0, speed: 0 };
    const startMinutes = Number(p.start.split(':')[0]) * 60 + Number(p.start.split(':')[1]);
    for (const s of sites) {
      s.approaches = new Set(s.external).size;
      s.limitedAccess = s.external.some((ei) => isLimitedAccess(D.edges[ei]));
      s.alleys = new Set(s.members.flatMap((m) => net.alleys[m])).size;
      const o = overrides[s.id] || {};
      s.c = o.class === undefined ? s.c : Number(o.class);
      const incident = [...new Set(s.members.flatMap((id) => net.approach[id].map(([, ei]) => ei)))].map(
        (ei) => D.edges[ei]
      );
      const factKey = s.members
        .slice()
        .sort((a, b) => a - b)
        .join(',');
      let facts = net.factCache?.get(factKey);
      if (!facts) {
        let signal = null,
          signalDistance = 35;
        for (const v of D.signals || []) {
          if (v.status !== 'In Service') continue;
          const d = Math.hypot(v.p[0] - s.x, v.p[1] - s.y);
          if (d <= signalDistance) {
            signalDistance = d;
            signal = v;
          }
        }
        const volumes = incident.filter((e) => e.adt?.value > 0).map((e) => e.adt);
        const speeds = incident.map((e) => e.speed).filter((v) => Number.isFinite(v) && v > 0 && v <= 80);
        facts = {
          signal,
          adt: volumes.length ? volumes.sort((a, b) => b.value - a.value)[0] : null,
          speed: speeds.length ? Math.max(...speeds) : null,
        };
        net.factCache?.set(factKey, facts);
      }
      s.facts = facts;
      s.officers =
        o.officers === undefined
          ? Number(p.officers[s.c]) + (facts.signal ? Number(p.signalOfficers) : 0)
          : Number(o.officers);
      s.barriers = o.barriers === undefined ? Number(p.barriers[s.c]) * s.approaches : Number(o.barriers);
      s.note = o.note || '';
      s.begin = p.mode === 'full' ? -p.setup : Math.min(...s.km) * p.fast - p.setup;
      s.end =
        p.mode === 'full'
          ? (route.length / 1000) * p.slow + p.wave + p.clear
          : Math.max(...s.km) * p.slow + p.wave + p.clear;
      s.hours = (s.end - s.begin) / 60;
      s.parts = {
        hierarchy: Number(p.weights[s.c]),
        approaches: Number(p.weights[s.c]) * 0.2 * Math.max(0, s.approaches - 1),
        signals: facts.signal ? Number(p.signalWeight) : 0,
        traffic: facts.adt ? (facts.adt.value / 10000) * Number(p.trafficWeight) : 0,
        speed: facts.speed ? (Math.max(0, facts.speed - 30) / 10) * Number(p.speedWeight) : 0,
      };
      s.points = Object.values(s.parts).reduce((a, b) => a + b, 0);
      for (const [key, v] of Object.entries(s.parts)) components[key] += v;
      s.reasons = [
        'ROAD_CLASS_' + s.c,
        'SIDE_APPROACHES_' + s.approaches,
        ...(s.limitedAccess ? ['FREEWAY_CONNECTION'] : []),
        ...(s.alleys ? ['ALLEY_MOUTHS_' + s.alleys] : []),
        ...(facts.signal ? ['SIGNAL_GIS_MATCH'] : []),
        ...(facts.adt ? ['ADT_SPATIAL_MATCH'] : []),
        ...(facts.speed ? ['POSTED_SPEED'] : []),
        ...(Object.keys(o).length ? ['PLANNER_OVERRIDE'] : []),
      ];
      s.control = p.mode === 'full' ? 0 : Math.min(...s.km) * p.fast;
      s.release = s.end - p.clear;
      s.officerHours = s.officers * s.hours;
      s.paidHours = s.officers * Math.max(s.hours, p.minimumShift);
      s.startTime = startMinutes + s.begin;
      s.endTime = startMinutes + s.end;
      rawIndex += s.points;
      officerHours += s.officerHours;
      paidHours += s.paidHours;
      siteBarricades += s.barriers;
    }
    const alleyMouths = new Set([...visits.keys()].flatMap((n) => net.alleys[n])).size,
      alleyBarricades = alleyMouths * Number(p.alleyBarriers);
    const events = sites
      .flatMap((s) => [
        [s.begin, s.officers, 1],
        [s.end, -s.officers, -1],
      ])
      .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    let current = 0,
      peak = 0;
    for (const [, d] of events) {
      current += d;
      peak = Math.max(peak, current);
    }
    let turns = 0,
      changes = 0;
    for (let i = 1; i < route.edges.length; i++) {
      if (deflection(D, route.nodes[i - 1], route.nodes[i], route.nodes[i + 1]) > Math.PI / 4) turns++;
      if (D.edges[route.edges[i - 1]].n !== D.edges[route.edges[i]].n) changes++;
    }
    const uniqueLength = [...used].reduce((s, e) => s + D.edges[e].l, 0);
    const cut = cornerCut(D, route, p.curbOffset);
    return {
      sites,
      components,
      coverage: {
        signals: sites.filter((s) => s.facts.signal).length,
        traffic: sites.filter((s) => s.facts.adt).length,
        speed: sites.filter((s) => s.facts.speed !== null).length,
        total: sites.length,
      },
      index: rawIndex,
      officerHours,
      paidHours,
      barricades: siteBarricades + alleyBarricades,
      siteBarricades,
      alleyMouths,
      alleyBarricades,
      freewayConnections: sites.filter((s) => s.limitedAccess).length,
      peak,
      cost: paidHours * p.rate,
      turns,
      changes,
      repeat: route.length ? 1 - uniqueLength / route.length : 0,
      length: route.length,
      cornerCut: cut,
      shortestRoute: Math.max(0, route.length - cut),
      major: sites.filter((s) => s.c >= 2).length,
    };
  }

  async function generate(
    net,
    {
      start,
      target = 5000,
      settings = DEFAULTS,
      preference = 'balanced',
      constraints = {},
      onProgress = () => {},
    }
  ) {
    const origin = net.data.nodes[start],
      candidates = [];
    let attempted = 0;
    const norm = (v) => String(v).trim().toLowerCase(),
      avoidNames = new Set((constraints.avoid || []).map(norm)),
      required = (constraints.required || []).map(norm),
      blockedNodes = new Set();
    for (const e of net.data.edges)
      if (avoidNames.has(norm(e.n))) {
        blockedNodes.add(e.a);
        blockedNodes.add(e.b);
      }
    const blocked = new Set(
      net.data.edges.flatMap((e, i) => (blockedNodes.has(e.a) || blockedNodes.has(e.b) ? [i] : []))
    );
    if (blockedNodes.has(start))
      throw new Error(
        'The chosen start touches a keep-open street. Move the start or change that constraint.'
      );
    const mandatory = required.map(
      (name) =>
        net.data.edges
          .map((e, i) => ({ e, i }))
          .filter(({ e, i }) => e.c >= 0 && norm(e.n) === name && !blocked.has(i))
          .sort((a, b) => {
            const mid = (e) => [
              (net.data.nodes[e.a][0] + net.data.nodes[e.b][0]) / 2,
              (net.data.nodes[e.a][1] + net.data.nodes[e.b][1]) / 2,
            ];
            const aa = mid(a.e),
              bb = mid(b.e);
            return (
              Math.hypot(aa[0] - origin[0], aa[1] - origin[1]) -
              Math.hypot(bb[0] - origin[0], bb[1] - origin[1])
            );
          })[0]?.i ?? -1
    );
    if (mandatory.some((i) => i < 0))
      throw new Error(
        'A required street was not found or has no usable segment under the keep-open constraints. Review the names and constraints.'
      );
    const attempts = 64,
      // The fewer-turns preference searches with a cost per turn, so it explores different loops.
      turnPenalty = preference === 'turns' ? 150 : 0,
      curbOffset = { ...DEFAULTS, ...settings }.curbOffset,
      // Distance basis: street centerline (default) or the shortest-possible-route estimate.
      measure = (r) =>
        constraints.basis === 'shortest' ? r.length - cornerCut(net.data, r, curbOffset) : r.length;

    for (let i = 0; i < attempts; i++) {
      const angle = ((i % 32) * Math.PI * 2) / 32,
        penalty = (i < 32 ? 0.25 : 1.6) * (preference === 'local' ? 3.2 : 1);
      let radius = (target / 8) * (i % 2 ? 0.94 : 1.06),
        route = null;
      for (let pass = 0; pass < 4; pass++) {
        const waypoints = [start];
        for (let j = 1; j < 4; j++) {
          const a = angle + (j * Math.PI) / 2;
          waypoints.push(
            net.nearest(
              origin[0] + radius * (Math.cos(a) - Math.cos(angle)),
              origin[1] + radius * (Math.sin(a) - Math.sin(angle))
            )
          );
        }
        if (mandatory.length) {
          const e = net.data.edges[mandatory[0]];
          waypoints.splice(1, 0, e.a, e.b);
          for (const ei of mandatory.slice(1)) {
            const v = net.data.edges[ei];
            waypoints.splice(waypoints.length - 1, 0, v.a, v.b);
          }
        }
        waypoints.push(start);
        route = net.via(waypoints, penalty, blocked, { avoidReuse: true, turnPenalty });
        if (!route || !route.length) break;
        radius *= target / measure(route);
      }
      if (route && measure(route) > target * 0.65 && measure(route) < target * 1.4) {
        const score = evaluate(net, route, settings);
        if (score.repeat < 0.24)
          candidates.push({
            ...route,
            score,
            signature: [...new Set(route.edges)].sort((a, b) => a - b).join(','),
          });
      }
      attempted++;
      if (i % 4 === 3) {
        onProgress(attempted / attempts);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    const tolerance = constraints.tolerance ?? 0.02;
    const pool = candidates.filter(
      (r) =>
        Math.abs(measure(r) - target) / target <= tolerance &&
        required.every((name) => r.edges.some((e) => norm(net.data.edges[e].n) === name)) &&
        (constraints.maxPeak == null || r.score.peak <= constraints.maxPeak)
    );
    if (!pool.length)
      throw new Error(
        'No sampled route meets this brief. Widen the distance tolerance, move the start, or relax the street/staffing constraints. No global feasibility claim is made.'
      );
    const unique = [...new Map(pool.map((r) => [r.signature, r])).values()];
    function pick(fn, selected) {
      const sorted = unique.slice().sort((a, b) => fn(a) - fn(b));
      for (const r of sorted) {
        if (selected.some((s) => s.signature === r.signature)) continue;
        const rs = new Set(r.edges);
        if (
          selected.some((s) => {
            let shared = [...new Set(s.edges)].filter((e) => rs.has(e)).length;
            return shared / Math.max(rs.size, new Set(s.edges).size) > 0.9;
          })
        )
          continue;
        return r;
      }
      return sorted.find((r) => !selected.some((s) => s.signature === r.signature));
    }
    const selected = [];
    const label = (r, role, name, kind) => ({ ...r, id: routeId(r.edges), role, name, kind });
    // Within the distance tolerance the distance term adds at most a few points, so this ranks
    // by turns and repeated streets as much as by distance. The name says "Balanced" for that reason.
    const base = pick(
      (r) =>
        (Math.abs(measure(r) - target) / target) * 150 +
        r.score.turns * (preference === 'turns' ? 6 : 0.5) +
        (preference === 'local' ? r.score.index : 0) +
        r.score.repeat * 100,
      selected
    );
    if (base)
      selected.push(
        label(
          base,
          'proposed',
          preference === 'local'
            ? 'Smaller-streets loop'
            : preference === 'turns'
              ? 'Fewest-turns loop'
              : 'Balanced loop',
          'Example route'
        )
      );
    const lower = pick(
      (r) => r.score.index + (Math.abs(measure(r) - target) / target) * 40 + r.score.repeat * 70,
      selected
    );
    if (lower) selected.push(label(lower, 'lower', 'Lower-burden candidate', 'Compare option'));
    const smooth = pick(
      (r) =>
        r.score.turns * 3 +
        r.score.changes +
        (Math.abs(measure(r) - target) / target) * 90 +
        r.score.repeat * 100,
      selected
    );
    if (smooth) selected.push(label(smooth, 'smooth', 'Fewer-turns candidate', 'Compare option'));
    return selected;
  }

  /* ---------- Track import: hidden-Markov map matching onto street segments ---------- */

  // minTurnaround: an out-and-back inside one street edge is kept only when the track goes at least this far.
  const MATCH = {
    step: 20,
    radius: 50,
    candidates: 8,
    sigma: 10,
    beta: 5,
    maxGap: 200,
    nodeTolerance: 1,
    minTurnaround: 25,
  };

  function segmentIndex(net) {
    if (net.segIndex) return net.segIndex;
    const cells = new Map(),
      size = 100;
    net.data.edges.forEach((e, ei) => {
      if (e.c < 0) return;
      let along = 0;
      for (let k = 1; k < e.p.length; k++) {
        const a = e.p[k - 1],
          b = e.p[k],
          len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const x0 = Math.floor(Math.min(a[0], b[0]) / size),
          x1 = Math.floor(Math.max(a[0], b[0]) / size),
          y0 = Math.floor(Math.min(a[1], b[1]) / size),
          y1 = Math.floor(Math.max(a[1], b[1]) / size);
        for (let gx = x0; gx <= x1; gx++)
          for (let gy = y0; gy <= y1; gy++) {
            const key = gx + ',' + gy;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push([ei, a, b, along, len]);
          }
        along += len;
      }
    });
    net.segIndex = { cells, size };
    return net.segIndex;
  }

  // Routable street segments within radius of a point, nearest first, one entry per street edge.
  function matchCandidates(net, p, radius, limit) {
    const { cells, size } = segmentIndex(net),
      reach = Math.ceil(radius / size),
      gx = Math.floor(p[0] / size),
      gy = Math.floor(p[1] / size),
      best = new Map();
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = -reach; dy <= reach; dy++)
        for (const [ei, a, b, along, len] of cells.get(gx + dx + ',' + (gy + dy)) || []) {
          const vx = b[0] - a[0],
            vy = b[1] - a[1],
            t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (len * len))) : 0;
          const d = Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
          if (d > radius) continue;
          const old = best.get(ei);
          if (!old || d < old.d) {
            const l = net.data.edges[ei].l;
            best.set(ei, { ei, d, s: Math.max(0, Math.min(l, along + t * len)) });
          }
        }
    return [...best.values()].sort((a, b) => a.d - b.d).slice(0, limit);
  }

  function boundedDistances(net, source, limit) {
    const dist = new Map([[source, 0]]),
      heap = new Heap();
    heap.push([0, source]);
    while (heap.a.length) {
      const [d, u] = heap.pop();
      if (d > dist.get(u)) continue;
      for (const [v, ei] of net.adj[u]) {
        const nd = d + net.data.edges[ei].l;
        if (nd <= limit && nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          heap.push([nd, v]);
        }
      }
    }
    return dist;
  }

  // Drop points closer than spacing to the last kept point, so dense GPS jitter does not add length.
  function thin(points, spacing) {
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const p = points[i],
        q = out[out.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= spacing) out.push(p);
    }
    const last = points[points.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }

  // Evenly spaced samples along the polyline. Each sample is [x, y, distance along the polyline].
  function resample(points, step) {
    const out = [[points[0][0], points[0][1], 0]];
    let carry = 0,
      travelled = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1],
        [bx, by] = points[i],
        seg = Math.hypot(bx - ax, by - ay);
      if (!seg) continue;
      let pos = step - carry;
      while (pos <= seg) {
        out.push([ax + ((bx - ax) * pos) / seg, ay + ((by - ay) * pos) / seg, travelled + pos]);
        pos += step;
      }
      carry = seg - (pos - step);
      travelled += seg;
    }
    const last = points[points.length - 1],
      prev = out[out.length - 1];
    if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > 1) out.push([last[0], last[1], travelled]);
    return out;
  }

  // A clean track already lies on street geometry (an export from this app or a route builder).
  // Clean tracks are matched on their own along-track distances with no thinning; GPS tracks are
  // thinned and matched on straight-line distances, which jitter does not inflate.
  function isCleanTrack(net, points) {
    const every = Math.max(1, Math.floor(points.length / 400));
    let on = 0,
      checked = 0;
    for (let i = 0; i < points.length; i += every) {
      checked++;
      if (matchCandidates(net, points[i], 1.5, 1).length) on++;
    }
    return on / checked >= 0.95;
  }

  // Match a track (projected [x, y] points) to a connected route of whole street edges.
  // Points are resampled every 20 m, each sample keeps up to 8 street candidates within 50 m,
  // and a Viterbi pass picks the sequence that best agrees with the track's own distances.
  // The ends are rounded to the nearer intersection because routes run between intersections.
  function matchTrack(net, points, options = {}) {
    const o = { ...MATCH, ...options },
      D = net.data;
    const where = (p) => {
      const [lon, lat] = lonlat(p[0], p[1]);
      return lat.toFixed(5) + ', ' + lon.toFixed(5);
    };
    if (!Array.isArray(points) || points.length < 2) throw new Error('The track needs at least two points.');
    const clean = isCleanTrack(net, points),
      minTurnaround = clean ? 0 : o.minTurnaround,
      samples = resample(clean ? points : thin(points, o.step), o.step);
    if (samples.length > 3000)
      throw new Error('This track is longer than 60 km. Import one race course at a time.');
    const layers = [];
    let gap = 0,
      skipped = 0;
    for (const p of samples) {
      const c = matchCandidates(net, p, o.radius, o.candidates);
      if (!c.length) {
        skipped++;
        gap += o.step;
        if (gap > o.maxGap)
          throw new Error(
            `Part of this track runs more than ${o.radius} m from a mapped public street near ${where(p)}. Import a road route inside the bundled study area.`
          );
        continue;
      }
      gap = 0;
      layers.push({ p, c, along: p[2] });
    }
    if (layers.length < 2) throw new Error('The track does not follow mapped public streets.');
    let cost = layers[0].c.map((c) => 0.5 * (c.d / o.sigma) ** 2);
    const back = [null];
    for (let j = 1; j < layers.length; j++) {
      const A = layers[j - 1],
        B = layers[j],
        straight = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1]),
        expected = clean ? B.along - A.along : straight,
        limit = Math.max(straight, expected) * 2 + 2 * o.radius + 100,
        cache = new Map();
      const reach = (u) => {
        if (!cache.has(u)) cache.set(u, boundedDistances(net, u, limit));
        return cache.get(u);
      };
      const next = [],
        pointers = [];
      for (const c2 of B.c) {
        const e2 = D.edges[c2.ei];
        let best = Infinity,
          arg = null;
        A.c.forEach((c1, k) => {
          if (!Number.isFinite(cost[k])) return;
          const e1 = D.edges[c1.ei];
          let network = c1.ei === c2.ei ? Math.abs(c2.s - c1.s) : Infinity,
            through = null;
          for (const [u, offU] of [
            [e1.a, c1.s],
            [e1.b, e1.l - c1.s],
          ]) {
            if (offU >= network) continue;
            const dist = reach(u);
            for (const [v, offV] of [
              [e2.a, c2.s],
              [e2.b, e2.l - c2.s],
            ]) {
              const mid = dist.get(v);
              if (mid === undefined) continue;
              const total = offU + mid + offV;
              if (total < network - 1e-9) {
                network = total;
                through = [u, v];
              }
            }
          }
          if (!Number.isFinite(network)) return;
          const total = cost[k] + Math.abs(network - expected) / o.beta;
          if (total < best) {
            best = total;
            arg = { k, through };
          }
        });
        next.push(best + 0.5 * (c2.d / o.sigma) ** 2);
        pointers.push(arg);
      }
      if (!next.some(Number.isFinite))
        throw new Error(`The track could not be connected through the street network near ${where(B.p)}.`);
      cost = next;
      back.push(pointers);
    }
    // Backtrack the most likely candidate sequence.
    let k = cost.indexOf(Math.min(...cost));
    const states = [];
    for (let j = layers.length - 1; j >= 0; j--) {
      const pointer = back[j] ? back[j][k] : null;
      states.push({ ...layers[j].c[k], through: pointer ? pointer.through : null });
      if (pointer) k = pointer.k;
    }
    states.reverse();
    // Expand into pieces of travel along edges, in edge offset coordinates.
    const pieces = [];
    const add = (ei, from, to) => {
      if (Math.abs(to - from) > 1e-6) pieces.push({ ei, from, to });
    };
    for (let j = 1; j < states.length; j++) {
      const s1 = states[j - 1],
        s2 = states[j];
      if (!s2.through) {
        add(s1.ei, s1.s, s2.s);
        continue;
      }
      const [u, v] = s2.through,
        e1 = D.edges[s1.ei],
        e2 = D.edges[s2.ei];
      add(s1.ei, s1.s, u === e1.a ? 0 : e1.l);
      if (u !== v) {
        const link = net.path(u, v, 0);
        link.edges.forEach((ei, i) => {
          const e = D.edges[ei],
            forward = link.nodes[i] === e.a;
          add(ei, forward ? 0 : e.l, forward ? e.l : 0);
        });
      }
      add(s2.ei, v === e2.a ? 0 : e2.l, s2.s);
    }
    // Merge consecutive pieces on the same edge into visits.
    const visits = [];
    for (const piece of pieces) {
      const last = visits[visits.length - 1];
      if (last && last.ei === piece.ei && Math.abs(last.exit - piece.from) < 1e-6) {
        last.exit = piece.to;
        last.min = Math.min(last.min, piece.to);
        last.max = Math.max(last.max, piece.to);
      } else
        visits.push({
          ei: piece.ei,
          entry: piece.from,
          exit: piece.to,
          min: Math.min(piece.from, piece.to),
          max: Math.max(piece.from, piece.to),
        });
    }
    if (!visits.length) throw new Error('The track is too short to form a route.');
    const atNode = (e, s) => (s <= o.nodeTolerance ? e.a : s >= e.l - o.nodeTolerance ? e.b : -1);
    const other = (e, n) => (n === e.a ? e.b : e.a);
    const reachFrom = (e, n, v) => (n === e.a ? v.max : e.l - v.min);
    // Round a within-edge excursion to a full out-and-back only when it reached halfway and minTurnaround.
    const keepsTurnaround = (e, depth) => depth >= e.l / 2 && depth >= minTurnaround;
    const nodes = [],
      edges = [];
    const startAt = (n) => {
      if (!nodes.length) nodes.push(n);
    };
    const move = (ei, from, to) => {
      startAt(from);
      edges.push(ei);
      nodes.push(to);
    };
    const first = visits[0],
      last = visits[visits.length - 1],
      closedTrack =
        Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) <
        60;
    const firstMid = atNode(D.edges[first.ei], first.entry) < 0,
      lastMid = atNode(D.edges[last.ei], last.exit) < 0;
    if (visits.length === 1 && firstMid && lastMid)
      throw new Error('The track stays within one block. Import a longer route.');
    // A loop that starts and finishes mid-block on the same street edge is joined at that edge.
    const joinEnds = closedTrack && visits.length > 1 && firstMid && lastMid && first.ei === last.ei;
    visits.forEach((v, idx) => {
      const e = D.edges[v.ei],
        entry = atNode(e, v.entry),
        exit = atNode(e, v.exit);
      if (entry >= 0 && exit >= 0) {
        if (entry !== exit) move(v.ei, entry, exit);
        else if (keepsTurnaround(e, reachFrom(e, entry, v))) {
          move(v.ei, entry, other(e, entry));
          move(v.ei, other(e, entry), entry);
        } else startAt(entry);
      } else if (entry < 0 && exit >= 0 && idx === 0) {
        if (!joinEnds && reachFrom(e, exit, v) >= e.l / 2) move(v.ei, other(e, exit), exit);
        else startAt(exit);
      } else if (entry >= 0 && exit < 0 && idx === visits.length - 1) {
        const startNode = nodes[0];
        if (joinEnds) {
          if (entry !== startNode) move(v.ei, entry, startNode);
          else if (keepsTurnaround(e, Math.max(reachFrom(e, entry, v), reachFrom(e, entry, first)))) {
            move(v.ei, entry, other(e, entry));
            move(v.ei, other(e, entry), entry);
          }
        } else if (reachFrom(e, entry, v) >= e.l / 2) move(v.ei, entry, other(e, entry));
        else startAt(entry);
      }
    });
    if (!edges.length) throw new Error('The track is too short to form a route.');
    edges.forEach((ei, i) => {
      const e = D.edges[ei];
      if (!((e.a === nodes[i] && e.b === nodes[i + 1]) || (e.b === nodes[i] && e.a === nodes[i + 1])))
        throw new Error('The matched track is not continuous. Simplify the track and try again.');
    });
    const offsets = states.map((s) => s.d);
    return {
      nodes,
      edges,
      length: edges.reduce((s, i) => s + D.edges[i].l, 0),
      match: {
        clean,
        samples: samples.length,
        skipped,
        meanOffset: offsets.reduce((a, b) => a + b, 0) / offsets.length,
        maxOffset: Math.max(...offsets),
      },
    };
  }

  function xy(lon, lat) {
    return [(lon + 77.46) * 88152, (37.56 - lat) * 111195];
  }
  function lonlat(x, y) {
    return [x / 88152 - 77.46, 37.56 - y / 111195];
  }
  const VERSION = '3.0';
  const api = {
    VERSION,
    Heap,
    DEFAULTS,
    CLASSES,
    LIMITED_ACCESS_CLASS,
    createNetwork,
    evaluate,
    generate,
    matchTrack,
    routeId,
    isApproach,
    isLimitedAccess,
    xy,
    lonlat,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RaceModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
