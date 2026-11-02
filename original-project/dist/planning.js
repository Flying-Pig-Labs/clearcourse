(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./model.js') : root.RaceModel;
  const normalize = (v) =>
    String(v ?? '')
      .trim()
      .toLowerCase();
  // The dataset version is stamped into data.js from a hash of the street graph (tools/enrich_data.py).
  // Worksheets and sessions store node and edge IDs, which are only meaningful for that exact graph.
  function datasetVersion(data) {
    return (data && data.datasetVersion) || 'unversioned';
  }
  // Distance used for the brief: street centerline, or the shortest-possible-route estimate.
  function briefDistance(score, basis) {
    return basis === 'shortest' ? score.shortestRoute : score.length;
  }
  function constraints(net, route, brief = {}) {
    const names = new Set(route.edges.map((i) => normalize(net.data.edges[i].n))),
      issues = [],
      score = M.evaluate(net, route, brief.settings, brief.overrides);
    const measured = briefDistance(score, brief.basis),
      target = brief.target || measured;
    if (Math.abs(measured - target) / target > (brief.tolerance ?? 0.02) + 1e-8)
      issues.push(
        brief.basis === 'shortest'
          ? 'Shortest-route distance estimate is outside the selected tolerance.'
          : 'Distance is outside the selected tolerance.'
      );
    for (const name of brief.required || [])
      if (!names.has(normalize(name))) issues.push('Required street not visited: ' + name);
    const avoid = new Set((brief.avoid || []).map(normalize));
    const touched = new Set(route.nodes);
    for (const e of net.data.edges)
      if (avoid.has(normalize(e.n)) && (touched.has(e.a) || touched.has(e.b)))
        issues.push('Touches keep-open street: ' + e.n);
    if (brief.maxPeak !== null && brief.maxPeak !== undefined && score.officers > brief.maxPeak)
      issues.push('Estimated officers exceed the selected cap.');
    return [...new Set(issues)];
  }
  function makeAccessGraph(net) {
    const adj = net.data.nodes.map(() => []);
    net.data.edges.forEach((e, i) => {
      if (!(e.publicRoad === true || (e.publicRoad === undefined && e.c >= 0))) return;
      adj[e.a].push([e.b, i]);
      adj[e.b].push([e.a, i]);
    });
    return adj;
  }
  function labels(adj, blocked) {
    const out = new Int32Array(adj.length).fill(-1),
      sizes = [];
    for (let i = 0; i < adj.length; i++) {
      if (out[i] !== -1 || !adj[i].length) continue;
      const id = sizes.length,
        stack = [i];
      out[i] = id;
      let count = 0;
      while (stack.length) {
        const x = stack.pop();
        count++;
        for (const [v, e] of adj[x])
          if (!blocked.has(e) && out[v] === -1) {
            out[v] = id;
            stack.push(v);
          }
      }
      sizes.push(count);
    }
    return { labels: out, sizes, main: sizes.indexOf(Math.max(...sizes)) };
  }
  function shortest(net, adj, start, end, blocked) {
    if (start < 0 || end < 0) return null;
    const dist = new Float64Array(adj.length).fill(Infinity),
      heap = new M.Heap();
    dist[start] = 0;
    heap.push([0, start]);
    while (heap.a.length) {
      const [d, u] = heap.pop();
      if (d !== dist[u]) continue;
      if (u === end) return d;
      for (const [v, e] of adj[u]) {
        if (blocked.has(e)) continue;
        const nd = d + net.data.edges[e].l;
        if (nd < dist[v]) {
          dist[v] = nd;
          heap.push([nd, v]);
        }
      }
    }
    return null;
  }
  function closedEdges(net, route) {
    const closed = new Set(route.edges),
      byName = new Map();
    for (const i of closed) {
      const e = net.data.edges[i],
        key = normalize(e.n);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(e);
    }
    const pointSegment = (p, a, b) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    net.data.edges.forEach((e, i) => {
      if (closed.has(i) || !byName.has(normalize(e.n))) return;
      const a = net.data.nodes[e.a],
        b = net.data.nodes[e.b],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      for (const r of byName.get(normalize(e.n))) {
        const c = net.data.nodes[r.a],
          d = net.data.nodes[r.b],
          vx = d[0] - c[0],
          vy = d[1] - c[1];
        if (
          Math.abs(dx * vx + dy * vy) / (Math.hypot(dx, dy) * Math.hypot(vx, vy) || 1) > 0.9 &&
          pointSegment(mid, c, d) < 30
        ) {
          closed.add(i);
          break;
        }
      }
    });
    return closed;
  }
  /* ---------- Directed access: one-way streets and fire/EMS travel time ---------- */
  const MPH = 0.44704;
  // Driving speed in m/s: posted speed when known, otherwise a default by road class.
  function travelSpeed(e) {
    const posted = Number(e.speed);
    if (Number.isFinite(posted) && posted >= 5 && posted <= 80) return posted * MPH;
    if (M.isLimitedAccess(e)) return 45 * MPH;
    return ([25, 30, 35, 40][e.c] || 25) * MPH;
  }
  // Public roads as a directed graph. DPW one-way codes: FT = digitized direction only, TF = reverse only.
  function makeDirectedGraph(net) {
    const n = net.data.nodes.length,
      out = Array.from({ length: n }, () => []),
      inn = Array.from({ length: n }, () => []);
    net.data.edges.forEach((e, i) => {
      if (!(e.publicRoad === true || (e.publicRoad === undefined && e.c >= 0))) return;
      if (e.oneWay !== 'TF') {
        out[e.a].push([e.b, i]);
        inn[e.b].push([e.a, i]);
      }
      if (e.oneWay !== 'FT') {
        out[e.b].push([e.a, i]);
        inn[e.a].push([e.b, i]);
      }
    });
    return { out, inn };
  }
  // Largest strongly connected component (iterative Kosaraju), ignoring blocked edges.
  function largestStrongComponent(g, blocked) {
    const n = g.out.length,
      seen = new Uint8Array(n),
      order = [];
    for (let s = 0; s < n; s++) {
      if (seen[s] || (!g.out[s].length && !g.inn[s].length)) continue;
      seen[s] = 1;
      const stack = [[s, 0]];
      while (stack.length) {
        const top = stack[stack.length - 1],
          list = g.out[top[0]];
        if (top[1] < list.length) {
          const [v, e] = list[top[1]++];
          if (!blocked.has(e) && !seen[v]) {
            seen[v] = 1;
            stack.push([v, 0]);
          }
        } else {
          order.push(top[0]);
          stack.pop();
        }
      }
    }
    const comp = new Int32Array(n).fill(-1);
    let best = -1,
      bestSize = 0,
      id = 0;
    for (let k = order.length - 1; k >= 0; k--) {
      const s = order[k];
      if (comp[s] >= 0) continue;
      let size = 0;
      const stack = [s];
      comp[s] = id;
      while (stack.length) {
        const u = stack.pop();
        size++;
        for (const [v, e] of g.inn[u])
          if (!blocked.has(e) && comp[v] < 0) {
            comp[v] = id;
            stack.push(v);
          }
      }
      if (size > bestSize) {
        bestSize = size;
        best = id;
      }
      id++;
    }
    return { comp, main: best, size: bestSize };
  }
  function reachable(list, start, blocked, n) {
    const seen = new Uint8Array(n);
    if (start < 0) return seen;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const u = stack.pop();
      for (const [v, e] of list[u])
        if (!blocked.has(e) && !seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
    }
    return seen;
  }
  // Fastest travel time in seconds from any source node, following one-way rules.
  function travelTimes(net, g, sources, blocked) {
    const time = new Float64Array(g.out.length).fill(Infinity),
      heap = new M.Heap();
    for (const s of sources)
      if (s >= 0 && time[s] > 0) {
        time[s] = 0;
        heap.push([0, s]);
      }
    while (heap.a.length) {
      const [t, u] = heap.pop();
      if (t > time[u]) continue;
      for (const [v, ei] of g.out[u]) {
        if (blocked.has(ei)) continue;
        const e = net.data.edges[ei],
          nt = t + e.l / travelSpeed(e);
        if (nt < time[v]) {
          time[v] = nt;
          heap.push([nt, v]);
        }
      }
    }
    return time;
  }
  // Streets most affected, by number of affected intersections.
  function streetsOf(net, nodes, blocked, limit = 5) {
    const counts = new Map();
    for (const n of nodes) {
      const names = new Set();
      net.approach[n].forEach(([, ei]) => {
        if (!blocked.has(ei)) names.add(net.data.edges[ei].n);
      });
      for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }
  // Assumes emergency vehicles follow one-way rules and cannot cross the closed course (conservative).
  function screenDirected(net, route, blocked, facilityNodes) {
    const g = makeDirectedGraph(net),
      n = g.out.length,
      none = new Set(),
      base = largestStrongComponent(g, none),
      after = largestStrongComponent(g, blocked),
      onCourse = new Set(route.nodes);
    let root = -1;
    for (let i = 0; i < n && root < 0; i++) if (after.comp[i] === after.main) root = i;
    const enter = reachable(g.out, root, blocked, n),
      exit = reachable(g.inn, root, blocked, n);
    const trapped = [],
      noEntry = [],
      cutOff = [],
      considered = [];
    for (let i = 0; i < n; i++) {
      if (base.comp[i] !== base.main || onCourse.has(i)) continue;
      if (!g.out[i].some(([, e]) => !blocked.has(e)) && !g.inn[i].some(([, e]) => !blocked.has(e))) continue;
      considered.push(i);
      if (enter[i] && !exit[i]) trapped.push(i);
      else if (!enter[i] && exit[i]) noEntry.push(i);
      else if (!enter[i] && !exit[i]) cutOff.push(i);
    }
    const stations = [
      ...new Set(facilityNodes.filter((f) => f.kind === 'Fire' || f.kind === 'EMS').map((f) => f.node)),
    ];
    const before = travelTimes(net, g, stations, none),
      later = travelTimes(net, g, stations, blocked);
    const slower = [],
      unreachable = [];
    let worst = 0,
      worstNode = -1;
    for (const i of considered) {
      if (!Number.isFinite(before[i])) continue;
      if (!Number.isFinite(later[i])) {
        unreachable.push(i);
        continue;
      }
      const delta = later[i] - before[i];
      if (delta > 120) slower.push(i);
      if (delta > worst) {
        worst = delta;
        worstNode = i;
      }
    }
    const facilityAccess = facilityNodes.map((f) => ({
      name: f.name,
      kind: f.kind,
      canLeave: f.node >= 0 ? !!exit[f.node] : null,
      canReach: f.node >= 0 ? !!enter[f.node] : null,
    }));
    return {
      directed: {
        trapped: trapped.length,
        noEntry: noEntry.length,
        cutOff: cutOff.length,
        streets: streetsOf(net, [...trapped, ...noEntry, ...cutOff], blocked),
        facilities: facilityAccess.filter((f) => f.canLeave === false || f.canReach === false),
      },
      response: {
        stations: stations.length,
        considered: considered.length,
        slower: slower.length,
        unreachable: unreachable.length,
        worst,
        worstStreets: worstNode >= 0 ? streetsOf(net, [worstNode], blocked, 2).map((s) => s.name) : [],
        streets: streetsOf(net, [...slower, ...unreachable], blocked),
      },
    };
  }
  function screenAccess(net, route) {
    const adj = makeAccessGraph(net),
      blocked = closedEdges(net, route),
      base = labels(adj, new Set()),
      after = labels(adj, blocked),
      D = net.data;
    const nearest = (p, max = 200) => {
      let id = -1,
        dist = max;
      D.nodes.forEach((n, i) => {
        if (!adj[i].length) return;
        const d = Math.hypot(p[0] - n[0], p[1] - n[1]);
        if (d < dist) {
          id = i;
          dist = d;
        }
      });
      return id;
    };
    const facilities = (D.facilities || []).map((f) => {
      const node = nearest(f.p);
      let status = 'not-assessed';
      if (node >= 0 && base.labels[node] === base.main) {
        status = after.labels[node] === after.main ? 'connected' : 'separated';
        if (!adj[node].some(([, e]) => !blocked.has(e))) status = 'closed-node';
      }
      return { ...f, node, status };
    });
    const points = route.nodes.map((i) => D.nodes[i]),
      xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]),
      minx = Math.min(...xs) - 600,
      maxx = Math.max(...xs) + 600,
      miny = Math.min(...ys) - 600,
      maxy = Math.max(...ys) + 600,
      midx = (minx + maxx) / 2,
      midy = (miny + maxy) / 2;
    const probes = [
      ['West → east', [minx, midy], [maxx, midy]],
      ['North → south', [midx, miny], [midx, maxy]],
    ].map(([name, a, b]) => {
      const from = nearest(a, 500),
        to = nearest(b, 500),
        before = shortest(net, adj, from, to, new Set()),
        closed = before !== null ? shortest(net, adj, from, to, blocked) : null;
      return {
        name,
        from,
        to,
        before,
        after: closed,
        added: before !== null && closed !== null ? Math.max(0, closed - before) : null,
      };
    });
    const warnings = facilities.filter((f) => f.status === 'separated' || f.status === 'closed-node');
    let isolatedNodes = 0;
    for (let i = 0; i < after.labels.length; i++)
      if (base.labels[i] === base.main && after.labels[i] !== after.main) isolatedNodes++;
    const { directed, response } = screenDirected(net, route, blocked, facilities);
    return {
      facilities,
      probes,
      warnings,
      isolatedNodes,
      directed,
      response,
      closedEdges: blocked.size,
      screened: facilities.filter((f) => f.status !== 'not-assessed').length,
      unknown: facilities.filter((f) => f.status === 'not-assessed').length,
      baselineComponentSize: base.sizes[base.main] || 0,
    };
  }
  // Exports prefix cells that start with = + @ or - with an apostrophe so spreadsheets do not run them.
  function guard(value) {
    const text = String(value ?? '');
    return /^[=+@\-\t\r]/.test(text) ? "'" + text : text;
  }
  function unguard(value) {
    const text = String(value ?? '');
    return /^'[=+@\-\t\r]/.test(text) ? text.slice(1) : text;
  }
  function toCSV(rows) {
    return rows.map((row) => row.map((v) => '"' + guard(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  }
  function parseCSV(text) {
    const rows = [];
    let row = [],
      cell = '',
      quote = false;
    text = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quote && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (!quote && cell.length) throw new Error('Malformed CSV quoting.');
        else quote = !quote;
      } else if (c === ',' && !quote) {
        row.push(cell);
        cell = '';
      } else if ((c === '\n' || c === '\r') && !quote) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        if (row.some((v) => v !== '')) rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    if (quote) throw new Error('The CSV contains an unfinished quoted field.');
    row.push(cell);
    if (row.some((v) => v !== '')) rows.push(row);
    return rows;
  }
  // A worksheet must carry the route ID and dataset version it was exported with.
  function importActuals(text, score, routeId, dataset) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('Add actual observations to the CSV template first.');
    const headers = rows.shift().map((v) => normalize(v).replace(/\s+/g, '_'));
    const idIndex = headers.indexOf('site_id');
    if (idIndex < 0) throw new Error('The CSV needs a site_id column. Download the template for this route.');
    if (!headers.includes('route_id') || !headers.includes('dataset_version'))
      throw new Error(
        'The CSV needs route_id and dataset_version columns. Download the worksheet for this route.'
      );
    const known = new Set(score.sites.map((s) => String(s.id))),
      records = [],
      unmatched = [],
      unmatchedRecords = [],
      seen = new Set();
    for (const row of rows) {
      const obj = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])),
        id = String(obj.site_id).trim();
      if (String(obj.dataset_version).trim() !== dataset)
        throw new Error('The CSV uses a different street snapshot. Export a fresh worksheet.');
      if (String(obj.route_id).trim() !== routeId)
        throw new Error('The CSV belongs to a different route. Select its original route before importing.');
      const record = {
        site_id: id,
        category: unguard(obj.discrepancy_type) || 'Unclassified',
        note: unguard(obj.note).slice(0, 500),
      };
      let hasActual = false;
      for (const [column, key, max] of [
        ['actual_officers', 'officers', 100],
        ['actual_barricades', 'barriers', 1000],
        ['actual_hours', 'hours', 72],
      ]) {
        const raw = String(obj[column] ?? '').trim();
        if (raw === '') continue;
        const value = Number(raw);
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          value > max ||
          (key !== 'hours' && !Number.isInteger(value))
        )
          throw new Error('Invalid ' + column + ' at site ' + id + '.');
        record[key] = value;
        hasActual = true;
      }
      if (!hasActual) continue;
      if (seen.has(id)) throw new Error('Duplicate observed site_id: ' + id);
      seen.add(id);
      if (!known.has(id)) {
        unmatched.push(id);
        unmatchedRecords.push(record);
        continue;
      }
      records.push(record);
    }
    if (!records.length)
      throw new Error(
        'No actual values matched this route. Fill the actual columns and use the matching route template.'
      );
    return { records, unmatched, unmatchedRecords };
  }
  function calibration(score, records = []) {
    const sites = new Map(score.sites.map((s) => [String(s.id), s])),
      pairs = [];
    for (const o of records) {
      const s = sites.get(String(o.site_id));
      if (s) pairs.push({ actual: o, predicted: s });
    }
    const metrics = {};
    for (const [key, predict] of [
      ['officers', 'officers'],
      ['barriers', 'barriers'],
      ['hours', 'hours'],
    ]) {
      const valid = pairs.filter((p) => Number.isFinite(p.actual[key]));
      metrics[key] = {
        count: valid.length,
        mae: valid.length
          ? valid.reduce((sum, p) => sum + Math.abs(p.actual[key] - p.predicted[predict]), 0) / valid.length
          : null,
      };
    }
    return { pairs, metrics, matched: pairs.length, unmatched: records.length - pairs.length };
  }
  /* ---------- Share links: a scenario compressed into the URL fragment ---------- */
  const base64url = {
    encode(bytes) {
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode(text) {
      const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    },
  };
  async function streamBytes(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }
  // Token: 'z' + base64url(deflate-raw(JSON)) when CompressionStream exists, else 'j' + base64url(JSON).
  async function packShare(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (typeof CompressionStream === 'function')
      return 'z' + base64url.encode(await streamBytes(bytes, new CompressionStream('deflate-raw')));
    return 'j' + base64url.encode(bytes);
  }
  async function unpackShare(token) {
    const text = String(token || '');
    if (text.length > 200000) throw new Error('The shared link is too long.');
    let bytes;
    try {
      bytes = base64url.decode(text.slice(1));
      if (text[0] === 'z') {
        if (typeof DecompressionStream !== 'function')
          throw new Error('This browser cannot open compressed links.');
        bytes = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
      } else if (text[0] !== 'j') throw new Error('Unknown link format.');
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error('The shared link is damaged or incomplete. ' + (e.message || ''));
    }
  }
  // Rebuild a route's node sequence from its start node and ordered edge IDs.
  function routeFromEdges(data, start, edges) {
    if (!Number.isInteger(start) || !Array.isArray(edges) || !edges.length)
      throw new Error('A shared route is empty.');
    const nodes = [start];
    let current = start;
    for (const ei of edges) {
      const e = data.edges[ei];
      const next = !e ? -1 : e.a === current ? e.b : e.b === current ? e.a : -1;
      if (next < 0) throw new Error('A shared route does not connect through the bundled street network.');
      nodes.push(next);
      current = next;
    }
    return { nodes, edges: edges.slice() };
  }

  const api = {
    datasetVersion,
    packShare,
    unpackShare,
    routeFromEdges,
    briefDistance,
    constraints,
    screenAccess,
    closedEdges,
    makeDirectedGraph,
    travelSpeed,
    parseCSV,
    toCSV,
    importActuals,
    calibration,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RacePlanning = api;
})(typeof window !== 'undefined' ? window : globalThis);
