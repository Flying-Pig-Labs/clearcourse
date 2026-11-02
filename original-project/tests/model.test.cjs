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
assert.equal(paid.cost, 1700, 'Rate multiplies paid hours');
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
  console.log('All model tests passed.');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
