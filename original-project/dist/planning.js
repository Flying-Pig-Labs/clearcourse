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
    if (brief.maxPeak !== null && brief.maxPeak !== undefined && score.peak > brief.maxPeak)
      issues.push('Estimated peak staffing exceeds the selected cap.');
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
    return {
      facilities,
      probes,
      warnings,
      isolatedNodes,
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
  const api = {
    datasetVersion,
    briefDistance,
    constraints,
    screenAccess,
    closedEdges,
    parseCSV,
    toCSV,
    importActuals,
    calibration,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RacePlanning = api;
})(typeof window !== 'undefined' ? window : globalThis);
