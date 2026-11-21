const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../dist/model.js');
const data = {
  nodes: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [200, 0],
    [100, 200],
    [-100, 100],
  ],
  edges: [],
};
function add(a, b, c = 0) {
  data.edges.push({ a, b, c, n: 'Road ' + a + '-' + b, l: 100, p: [data.nodes[a], data.nodes[b]] });
}
add(0, 1);
add(1, 2);
add(2, 3);
add(3, 0);
add(1, 4, 3);
add(2, 5, 1);
add(3, 6, 0);
const net = M.createNetwork(data),
  route = net.via([0, 1, 2, 3, 0]);
assert.equal(route.length, 400, 'Connected square length must be 400 m');
assert.deepEqual(new Set(route.edges), new Set([0, 1, 2, 3]));
const full = M.evaluate(net, route);
assert.equal(full.sites.length, 3, 'Count side-road junctions, not every route vertex');
assert.equal(full.peak, 5, 'Principal arterial proxy needs 3; collector and local need 1 each');
assert.equal(full.barricades, 5, 'Barricades apply per external approach');
assert.equal(full.index, 10, 'Index is 7+2+1 before approach multipliers');
const expectedWindow = (45 + 4.8 + 15 + 20) / 60;
assert.ok(
  Math.abs(full.officerHours - expectedWindow * 5) < 1e-9,
  'Use actual route length and pace for duty duration'
);
const edited = M.evaluate(net, route, M.DEFAULTS, {
  1: { officers: 7, barriers: 9, note: 'Local knowledge' },
});
assert.equal(edited.peak, 9, 'A site override must update staffing');
assert.equal(edited.barricades, 11, 'A site override must update equipment totals');
assert.equal(edited.index, full.index, 'Staffing-only edits do not change road complexity');
const reclassified = M.evaluate(net, route, M.DEFAULTS, { 1: { class: 0 } });
assert.equal(reclassified.index, 4, 'A category edit changes burden weight');
const rolling = M.evaluate(net, route, { ...M.DEFAULTS, mode: 'rolling' });
assert.ok(rolling.officerHours < full.officerHours, 'Rolling estimates should use location passage windows');
const paid = M.evaluate(net, route, { ...M.DEFAULTS, minimumShift: 4 });
assert.equal(paid.paidHours, 20, 'Minimum paid shift applies per officer per site');
assert.equal(paid.postCost, 1700, 'Rate multiplies paid hours');
assert.equal(paid.trafficCost, 100, 'GO 04-06 §6f adds $5 per billed traffic-control hour');
assert.deepEqual(
  [paid.supervision.acting, paid.supervision.firstLine, paid.supervision.command],
  [0, 1, 0],
  'Five officers at once need one first-line supervisor'
);
assert.equal(
  paid.supervision.cost,
  4 * (85 + 3 + 5),
  'A supervisor bills the event window at rate + $3 + $5'
);
assert.equal(paid.cost, 1700 + 100 + 372, 'Cost sums posts, traffic premium and supervision');
assert.equal(paid.headcount, 6);
const postsOnly = M.evaluate(net, route, { ...M.DEFAULTS, supervision: 'off', trafficPremium: 0 });
assert.equal(postsOnly.cost, 1700, 'With supervision off and no premium, cost is the version 4 formula');
// General Order 04-06 §7c, both readings.
const sv = (n, rule) => Object.values(M.supervision(n, rule));
assert.deepEqual(sv(2), [0, 0, 0]);
assert.deepEqual(sv(3), [1, 0, 0], '3-4 officers: one is paid as supervisor');
assert.deepEqual(sv(4), [1, 0, 0]);
assert.deepEqual(sv(5), [0, 1, 0]);
assert.deepEqual(sv(10), [0, 1, 0]);
assert.deepEqual(sv(11), [0, 2, 1], '11-15: 2 supervisors and a lieutenant');
assert.deepEqual(sv(15), [0, 2, 1]);
assert.deepEqual(sv(16), [0, 3, 1]);
assert.deepEqual(sv(400), [0, 3, 1], 'The examples cap at 3 + 1');
for (const n of [3, 5, 10, 11, 15, 16, 20])
  assert.deepEqual(sv(n, 'perFive'), sv(n), `The two readings agree at ${n}`);
assert.deepEqual(sv(21, 'perFive'), [0, 4, 1], 'The text adds one supervisor per further five');
assert.deepEqual(sv(400, 'perFive'), [0, 79, 1]);
assert.deepEqual(sv(400, 'off'), [0, 0, 0]);
// A bridge adds officers on top of the post's base, including a planner's own count.
const bridged = M.evaluate(net, route, M.DEFAULTS, { 1: { bridge: true, note: 'Bridge' } });
const site1 = bridged.sites.find((s) => s.id === 1),
  plain1 = full.sites.find((s) => s.id === 1);
assert.equal(site1.officers, plain1.officers + 1, 'Default bridge adds one officer');
assert.equal(site1.baseOfficers, plain1.officers);
assert.ok(site1.reasons.includes('BRIDGE'));
assert.equal(bridged.bridges, 1);
const bridgedEdit = M.evaluate(
  net,
  route,
  { ...M.DEFAULTS, bridgeOfficers: 2 },
  {
    1: { officers: 4, bridge: true, note: 'Bridge' },
  }
);
assert.equal(bridgedEdit.sites.find((s) => s.id === 1).officers, 6);
const twice = { nodes: [0, 1, 2, 3, 0, 1, 2, 3, 0], edges: [0, 1, 2, 3, 0, 1, 2, 3], length: 800 };
const repeat = M.evaluate(net, twice, { ...M.DEFAULTS, mode: 'rolling' });
assert.equal(repeat.sites.length, 3, 'Repeated passages must not duplicate physical sites');
assert.equal(repeat.repeat, 0.5, 'Repeated distance is measured from unique edge IDs');
assert.ok(
  repeat.sites.find((s) => s.id === 1).hours > rolling.sites.find((s) => s.id === 1).hours,
  'Keep a site staffed across repeat visits'
);
const zero = M.evaluate(net, route, { ...M.DEFAULTS, officers: [0, 0, 0, 0], barriers: [0, 0, 0, 0] });
assert.equal(zero.peak, 0);
assert.equal(zero.cost, 0);
assert.equal(
  M.createNetwork({
    nodes: [
      [0, 0],
      [100, 0],
    ],
    edges: [{ a: 0, b: 1, c: -1, l: 100 }],
  }).path(0, 1),
  null,
  'Excluded roads must not enter race paths'
);
let sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../dist/data.js'), 'utf8'), sandbox);
const real = M.createNetwork(sandbox.window.RACE_DATA);
(async () => {
  for (const km of [5, 10]) {
    let start = real.nearest(...M.xy(-77.4662, 37.5532)),
      t = Date.now();
    let routes = await M.generate(real, { start, target: km * 1000 });
    assert.ok(routes.length >= 2, 'Provide multiple real-network candidates');
    for (const r of routes) {
      assert.equal(r.nodes[0], r.nodes.at(-1), 'Generated routes must close');
      for (let i = 0; i < r.edges.length; i++) {
        const e = real.data.edges[r.edges[i]];
        assert.ok(
          (e.a === r.nodes[i] && e.b === r.nodes[i + 1]) || (e.b === r.nodes[i] && e.a === r.nodes[i + 1]),
          'Each street must connect'
        );
        assert.ok(e.c >= 0, 'No excluded streets');
      }
      assert.ok(
        Math.abs(r.length - km * 1000) / (km * 1000) < 0.15,
        'Example loops should be close to the requested distance'
      );
    }
    console.log(
      km + 'K candidates',
      routes.map((r) => ({
        name: r.name,
        km: +(r.length / 1000).toFixed(2),
        sites: r.score.sites.length,
        index: +r.score.index.toFixed(1),
        turns: r.score.turns,
      })),
      Date.now() - t + 'ms'
    );
  }
  // Reroute: the bundled 2026 marathon section with the N Lombardy St bridge closed.
  const courseBox = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/courses.js'), 'utf8'), courseBox);
  const bundle = courseBox.window.RACE_COURSES,
    course = bundle.courses[0],
    closed = course.closures[0].edges;
  assert.equal(
    bundle.datasetVersion,
    sandbox.window.RACE_DATA.datasetVersion,
    'Courses match the street snapshot'
  );
  assert.ok(
    Math.abs(course.match.streetMeters - course.match.trackMeters) < 100,
    'Course section matches its track'
  );
  for (const ei of closed) assert.ok(course.edges.includes(ei), 'The closed bridge is on the course');
  const fixed = { nodes: [...course.nodes], edges: [...course.edges] };
  let t = Date.now();
  const rr = M.reroute(real, fixed, closed);
  const rerouteMs = Date.now() - t;
  assert.ok(rr.candidates.length >= 2, 'Several reroutes are offered');
  assert.equal(rr.baseline.officers > 0 && Number.isFinite(rr.baseline.cost), true, 'Baseline is scored');
  const at = [0];
  course.edges.forEach((ei, i) => at.push(at[i] + real.data.edges[ei].l));
  for (const c of rr.candidates) {
    for (const ei of closed) assert.ok(!c.edges.includes(ei), 'A reroute never uses the closed street');
    for (let i = 0; i < c.edges.length; i++) {
      const e = real.data.edges[c.edges[i]];
      assert.ok(
        (e.a === c.nodes[i] && e.b === c.nodes[i + 1]) || (e.b === c.nodes[i] && e.a === c.nodes[i + 1]),
        'A reroute is a connected course'
      );
    }
    assert.equal(c.nodes[0], course.nodes[0], 'Same start');
    assert.equal(c.nodes.at(-1), course.nodes.at(-1), 'Same finish');
    const { detach, rejoin } = c.change;
    assert.deepEqual(
      c.edges.slice(0, detach.index),
      fixed.edges.slice(0, detach.index),
      'Course before is kept'
    );
    assert.deepEqual(
      c.edges.slice(c.edges.length - (course.edges.length - rejoin.index)),
      fixed.edges.slice(rejoin.index),
      'Course after is kept'
    );
    assert.ok(Math.abs(c.length - at.at(-1) - c.change.delta) < 0.01, 'Length change is reported exactly');
    assert.notEqual(
      c.change.addedEdges[0],
      fixed.edges[detach.index],
      'Leave point is where the course changes'
    );
    assert.notEqual(
      c.change.addedEdges.at(-1),
      fixed.edges[rejoin.index - 1],
      'Rejoin point is where it changes'
    );
    assert.ok(Math.abs(c.change.delta) <= M.REROUTE.tolerance, 'Within the length tolerance');
    // The replacement never reuses a street the kept course runs on.
    const kept = new Set([...fixed.edges.slice(0, detach.index), ...fixed.edges.slice(rejoin.index)]);
    for (const ei of c.change.addedEdges) assert.ok(!kept.has(ei), 'No reuse of the kept course');
    assert.ok(
      detach.at <= at[rr.first] && rejoin.at >= at[rr.last + 1],
      'The replacement covers the closure'
    );
  }
  assert.throws(() => M.reroute(real, fixed, [0]), /not on this course/, 'Closure must be on the course');
  // A tiny tolerance with nothing in reach fails with an explanation, not an empty list.
  assert.throws(
    () => M.reroute(real, fixed, closed, { tolerance: 0.001, before: 1, after: 1 }),
    /No replacement/
  );
  console.log(
    'Lombardy reroutes',
    rr.candidates.map((c) => ({
      name: c.name,
      delta: Math.round(c.change.delta),
      officers: c.score.officers,
      baseline: rr.baseline.officers,
      crossings: c.change.crossings,
      closurePoints: c.score.sites.length,
    })),
    rerouteMs + 'ms'
  );
  console.log('All model tests passed.');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
