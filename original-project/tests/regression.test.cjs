// Regression tests for defects found in the v2 review. Each block names the defect it guards.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../dist/model.js');
const P = require('../dist/planning.js');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../dist/data.js'), 'utf8'), sandbox);
const D = sandbox.window.RACE_DATA;
const net = M.createNetwork(D);
const all = D.nodes.map(() => []);
D.edges.forEach((e, i) => {
  all[e.a].push(i);
  all[e.b].push(i);
});
const startOf = (seed) => net.nearest(...M.xy(seed.lon, seed.lat));
// Same geometry the app writes to a GeoJSON export (6-decimal lon/lat), converted back to meters.
function exportedTrack(r) {
  const pts = [];
  r.edges.forEach((ei, i) => {
    const e = D.edges[ei],
      p = e.a === r.nodes[i] ? e.p : e.p.slice().reverse();
    for (const v of i ? p.slice(1) : p) pts.push(M.xy(...M.lonlat(...v).map((c) => +c.toFixed(6))));
  });
  return pts;
}
// Share of street length the two routes have in common (divided-road connectors differ by a few meters).
const overlap = (a, b) => {
  const A = new Set(a),
    B = new Set(b),
    len = (set) => [...set].reduce((sum, e) => sum + D.edges[e].l, 0);
  return len(new Set([...A].filter((x) => B.has(x)))) / len(new Set([...A, ...B]));
};
let seed = 42;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

function fixture() {
  const d = {
    nodes: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [200, 0],
      [100, 200],
      [-100, 100],
      [0, -100],
      [-100, 0],
    ],
    edges: [],
  };
  const add = (a, b, c, extra = {}) =>
    d.edges.push({ a, b, c, n: 'Road ' + a + '-' + b, l: 100, p: [d.nodes[a], d.nodes[b]], ...extra });
  add(0, 1, 0);
  add(1, 2, 0);
  add(2, 3, 0);
  add(3, 0, 0);
  add(1, 4, 0);
  add(2, 5, -1, { roadType: 'Ramp', publicRoad: true, limitedAccess: true });
  add(3, 6, -1, { roadType: 'Alley', publicRoad: false });
  add(0, 7, -1, { roadType: 'Private', publicRoad: false });
  add(0, 8, -1, { roadType: 'Alley', publicRoad: false });
  return d;
}

(async () => {
  // 1. Freeway ramps meeting the course are side approaches; alleys are counted; private streets are not.
  {
    const net1 = M.createNetwork(fixture()),
      route = net1.via([0, 1, 2, 3, 0]),
      sc = M.evaluate(net1, route);
    const rampSite = sc.sites.find((s) => s.members.includes(2));
    assert.ok(rampSite, 'A ramp-only junction must become a review site');
    assert.equal(rampSite.limitedAccess, true);
    assert.equal(rampSite.c, M.LIMITED_ACCESS_CLASS, 'Freeway connections default to the top category');
    assert.ok(rampSite.reasons.includes('FREEWAY_CONNECTION'));
    assert.equal(
      sc.sites.length,
      2,
      'Junction 1 (street) and 2 (ramp); alley and private do not create sites'
    );
    assert.equal(sc.alleyMouths, 2, 'Both alley mouths touching the course are counted');
    assert.equal(sc.alleyBarricades, 0, 'Alley mouths get no barricades unless a planner sets a value');
    const withAlleys = M.evaluate(net1, route, { ...M.DEFAULTS, alleyBarriers: 2 });
    assert.equal(withAlleys.barricades, sc.barricades + 4);
    assert.equal(net1.path(1, 5), null, 'Ramps stay excluded from race routing');
  }
  // 1b. On the real network no generated route has a ramp junction without a site.
  for (const s of D.seeds)
    for (const km of [5, 10]) {
      const routes = await M.generate(net, { start: startOf(s), target: km * 1000 });
      for (const r of routes) {
        const sc = M.evaluate(net, r),
          used = new Set(r.edges),
          siteNodes = new Set(sc.sites.flatMap((x) => x.members));
        for (const node of new Set(r.nodes))
          if (all[node].some((ei) => !used.has(ei) && D.edges[ei].roadType === 'Ramp'))
            assert.ok(siteNodes.has(node), `Ramp junction ${node} on ${s.name} ${km}K has no review site`);
      }
    }

  // 2. Imports: the app's own exports round-trip, noisy GPS stays close, out-and-back stays on its street.
  const generated = [];
  for (const s of D.seeds)
    for (const km of [5, 10])
      generated.push(...(await M.generate(net, { start: startOf(s), target: km * 1000 })));
  for (const r of generated) {
    const m = M.matchTrack(net, exportedTrack(r));
    assert.ok(Math.abs(m.length / r.length - 1) <= 0.005, `${r.name}: ${m.length} vs ${r.length}`);
    assert.ok(overlap(m.edges, r.edges) >= 0.95, `${r.name}: matched streets differ`);
  }
  for (const r of generated.slice(0, 6)) {
    // 1 Hz GPS at about 3 m/s with correlated error (sd 6 m), the usual shape of watch tracks.
    const dense = [];
    const pts = exportedTrack(r);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]],
        k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let j = 0; j < k; j++)
        dense.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    }
    let ex = 0,
      ey = 0;
    const noisy = dense.map((p) => {
      ex = 0.95 * ex + Math.sqrt(1 - 0.95 ** 2) * 6 * gauss();
      ey = 0.95 * ey + Math.sqrt(1 - 0.95 ** 2) * 6 * gauss();
      return [p[0] + ex, p[1] + ey];
    });
    const m = M.matchTrack(net, noisy);
    assert.ok(Math.abs(m.length / r.length - 1) <= 0.025, `Noisy ${r.name}: ${m.length} vs ${r.length}`);
  }
  const grace = [
    ...new Set(D.edges.filter((e) => e.c >= 0 && e.n === 'W Grace St').flatMap((e) => [e.a, e.b])),
  ];
  let leg = null;
  for (const a of grace.slice(0, 40))
    for (const b of grace) {
      const q = net.path(a, b, 0);
      if (q && q.edges.every((ei) => D.edges[ei].n === 'W Grace St') && Math.abs(q.length - 800) < 150)
        if (!leg || Math.abs(q.length - 800) < Math.abs(leg.length - 800)) leg = q;
    }
  const outAndBack = M.matchTrack(
    net,
    exportedTrack({
      ...leg,
      nodes: [...leg.nodes, ...leg.nodes.slice(0, -1).reverse()],
      edges: [...leg.edges, ...leg.edges.slice().reverse()],
    })
  );
  assert.ok(
    Math.abs(outAndBack.length - 2 * leg.length) < 1,
    'Imported out-and-back must retrace the street'
  );

  // 3. Drawing retraces a street instead of detouring around the block.
  const drawn = net.via([leg.nodes[0], leg.nodes.at(-1), leg.nodes[0]], 0, new Set(), { avoidReuse: false });
  assert.ok(
    Math.abs(drawn.length - 2 * leg.length) < 1,
    `Drawn out-and-back ${drawn.length} vs ${2 * leg.length}`
  );

  // 4. Route IDs are content hashes, so a worksheet cannot attach to a different route.
  const fan = D.seeds[0];
  const five = (await M.generate(net, { start: startOf(fan), target: 5000 }))[0],
    ten = (await M.generate(net, { start: startOf(fan), target: 10000 }))[0];
  assert.match(five.id, /^r[0-9a-f]{16}$/);
  assert.notEqual(five.id, ten.id, 'Different routes need different IDs');
  assert.equal(M.routeId(five.edges), five.id, 'The same route always gets the same ID');
  assert.equal(new Set(generated.map((r) => r.id)).size, new Set(generated.map((r) => r.edges.join())).size);
  const DS = P.datasetVersion(D);
  const s5 = M.evaluate(net, five),
    s10 = M.evaluate(net, ten);
  const worksheet = P.toCSV([
    ['site_id', 'route_id', 'dataset_version', 'actual_officers', 'note'],
    ...s5.sites.map((s) => [s.id, five.id, DS, 2, '-starts with a minus']),
  ]);
  assert.throws(() => P.importActuals(worksheet, s10, ten.id, DS), /different route/);
  const ok = P.importActuals(worksheet, s5, five.id, DS);
  assert.equal(ok.records.length, s5.sites.length);
  assert.equal(ok.records[0].note, '-starts with a minus', 'Formula guard is removed on re-import');

  // 5. The dataset version comes from the data file, not a hand-typed constant.
  assert.match(DS, /^richmond-centerlines-2026-11-02-[0-9a-f]{12}$/);
  assert.equal(P.datasetVersion({}), 'unversioned');
  assert.throws(() => P.importActuals(worksheet, s5, five.id, 'other-snapshot'), /different street snapshot/);

  // 6. "Favor fewer turns" searches differently and returns fewer turns.
  for (const s of D.seeds) {
    const bal = await M.generate(net, { start: startOf(s), target: 5000 }),
      turns = await M.generate(net, { start: startOf(s), target: 5000, preference: 'turns' });
    const mean = (rs) => rs.reduce((a, r) => a + r.score.turns, 0) / rs.length;
    assert.notDeepEqual(turns.map((r) => r.id).sort(), bal.map((r) => r.id).sort(), `${s.name}: same routes`);
    assert.ok(mean(turns) < mean(bal), `${s.name}: ${mean(turns)} turns vs ${mean(bal)}`);
    assert.equal(bal[0].name, 'Balanced loop', 'The default pick is labeled for what it ranks');
    assert.equal(turns[0].name, 'Fewest-turns loop');
  }

  // 7. Shortest-route estimate: four right-angle turns, 4.5 m to the curb, runner 0.3 m off the curb.
  {
    const net1 = M.createNetwork(fixture()),
      square = net1.via([0, 1, 2, 3, 0]);
    const sc = M.evaluate(net1, square);
    assert.ok(Math.abs(sc.cornerCut - 4 * 2 * 4.2) < 1e-9, `corner cut ${sc.cornerCut}`);
    assert.ok(Math.abs(sc.shortestRoute - (400 - 33.6)) < 1e-9);
    assert.equal(M.evaluate(net1, square, { ...M.DEFAULTS, curbOffset: 0 }).cornerCut, 0);
    assert.deepEqual(P.constraints(net1, square, { target: 366.4, tolerance: 0.01, basis: 'shortest' }), []);
    assert.ok(
      P.constraints(net1, square, { target: 366.4, tolerance: 0.01 }).length,
      'Centerline basis differs'
    );
  }
  const shortest = await M.generate(net, {
    start: startOf(fan),
    target: 5000,
    constraints: { basis: 'shortest' },
  });
  for (const r of shortest) assert.ok(Math.abs(r.score.shortestRoute - 5000) / 5000 <= 0.02, r.name);

  // 8. Richmond PD billing: 4-hour minimum, started hours bill in full past 15 minutes, agreement by headcount.
  assert.equal(M.billedHours(2.34), 4);
  assert.equal(M.billedHours(4.2), 4, '12 minutes past the hour is within the 15-minute grace');
  assert.equal(M.billedHours(4.3), 5, '18 minutes past the hour bills a full hour');
  assert.equal(M.billedHours(5), 5);
  assert.equal(M.billedHours(4.3, { billing: 'exact' }), 4.3);
  assert.equal(M.billedHours(2.34, { billing: 'exact' }), 4, 'The minimum still applies to modeled hours');
  assert.equal(M.billedHours(0.3, { minimumShift: 0 }), 1);
  assert.equal(M.rpdAgreement(10).form, 'PD-119SPE');
  assert.equal(M.rpdAgreement(9).form, 'PD-119SE');
  {
    const sc = M.evaluate(net, five);
    assert.equal(
      sc.officers,
      sc.sites.reduce((a, s) => a + s.officers, 0)
    );
    const expected = sc.sites.reduce((a, s) => a + s.officers * M.billedHours(s.hours), 0) * M.DEFAULTS.rate;
    assert.ok(Math.abs(sc.cost - expected) < 1e-6);
    assert.equal(sc.agreement.form, 'PD-119SPE');
  }
  // The UI says moving officers cannot help at 5K and 10K: no post closes before another opens.
  for (const s of D.seeds)
    for (const km of [5, 10]) {
      const r = (await M.generate(net, { start: startOf(s), target: km * 1000 }))[0];
      const sc = M.evaluate(net, r, { ...M.DEFAULTS, mode: 'rolling' });
      assert.equal(sc.peak, sc.officers, `${s.name} ${km}K rolling`);
    }

  // 9. Share links round-trip and reject broken routes.
  {
    const payload = { v: 2, routes: [{ s: five.nodes[0], e: five.edges }], note: 'Léon & "quotes"' };
    const token = await P.packShare(payload);
    assert.deepEqual(await P.unpackShare(token), payload);
    assert.deepEqual(P.routeFromEdges(D, five.nodes[0], five.edges).nodes, five.nodes);
    assert.throws(() => P.routeFromEdges(D, five.nodes[0], [five.edges[3]]), /does not connect/);
    await assert.rejects(P.unpackShare('z' + token.slice(5)), /damaged/);
  }

  // 10. Directed access: a one-way street into a pocket whose only exit is the course traps cars.
  {
    const d = {
      nodes: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
        [200, 100],
        [200, 0],
      ],
      edges: [],
      facilities: [],
    };
    const add = (a, b, n, extra = {}) =>
      d.edges.push({ a, b, c: 0, n, l: 100, p: [d.nodes[a], d.nodes[b]], publicRoad: true, ...extra });
    add(0, 1, 'A');
    add(1, 2, 'B');
    add(2, 3, 'C');
    add(3, 0, 'D');
    add(2, 4, 'Into pocket', { oneWay: 'FT' });
    add(4, 5, 'Pocket');
    add(5, 1, 'Course');
    const n1 = M.createNetwork(d);
    const result = P.screenAccess(n1, { nodes: [5, 1], edges: [6], length: 100 });
    assert.equal(result.directed.trapped, 1, 'Node 4 can be entered but not left');
    assert.equal(result.isolatedNodes, 0, 'The undirected check misses it');
  }
  // 11. Fire/EMS travel time: closing the short link forces a 2 km detour (> 2 minutes at 25 mph).
  {
    const d = {
      nodes: [
        [0, 0],
        [100, 0],
        [200, 0],
        [0, 1000],
        [200, 1000],
        [300, 0],
      ],
      edges: [],
      facilities: [{ p: [0, 0], name: 'Test station', kind: 'Fire' }],
    };
    const add = (a, b, l) =>
      d.edges.push({ a, b, c: 0, n: 'S' + a + b, l, p: [d.nodes[a], d.nodes[b]], publicRoad: true });
    add(0, 1, 100);
    add(1, 2, 100);
    add(0, 3, 1000);
    add(3, 4, 200);
    add(4, 2, 800);
    add(2, 5, 100);
    const n1 = M.createNetwork(d);
    const result = P.screenAccess(n1, { nodes: [1, 2], edges: [1], length: 100 });
    assert.equal(result.response.stations, 1);
    assert.equal(result.response.slower, 1, 'Node 5 is reached 1,800 m later');
    assert.ok(Math.abs(result.response.worst - 1800 / (25 * 0.44704)) < 1e-6);
  }
  {
    const t = Date.now(),
      a = P.screenAccess(net, five);
    assert.ok(Date.now() - t < 2000, 'Access screen stays interactive');
    assert.ok(a.response.stations >= 10, 'Fire and EMS stations snap to the network');
  }

  console.log('All regression tests passed.');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
