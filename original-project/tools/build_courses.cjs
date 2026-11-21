// Builds dist/courses.js: fixed race courses matched to the bundled street snapshot, with known closures.
// Run: node tools/build_courses.cjs
'use strict';
const fs = require('fs'),
  path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
require(path.join(ROOT, 'dist/data.js'));
const D = global.window.RACE_DATA;
const M = require(path.join(ROOT, 'dist/model.js'));
const P = require(path.join(ROOT, 'dist/planning.js'));
const net = M.createNetwork(D);

// The N. Lombardy St bridge over CSX. OpenStreetMap way 692891947 puts the bridge deck at
// 37.5589–37.5593 N, -77.4514 to -77.4517 W, between the Admiral St traffic circle and W Leigh St.
// The City describes the project as between Moore and Admiral streets. A full closure closes the street
// between the nearest junctions, so the closed edges run from the circle to W Leigh St.
const LOMBARDY = {
  id: 'lombardy-csx',
  name: 'N Lombardy St bridge over CSX',
  from: 'Admiral St traffic circle',
  to: 'W Leigh St',
  edges: [12905, 12890, 12891, 13884, 13055],
  status:
    'Planned. The City plans a full closure of about two years from spring 2027; it could close earlier because of the bridge condition.',
  sources: [
    'https://www.rva.gov/capital-improvement-projects/n-lombardy-st-over-csxt-bridge-replacement',
    'https://www.richmonder.org/lombardy-street-bridge-near-vuu-could-be-closed-for-two-year-replacement-in-2027/',
    'https://www.openstreetmap.org/way/692891947',
  ],
};

function build(file, closures) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/courses', file), 'utf8'));
  const route = M.matchTrack(
    net,
    raw.track.map(([lon, lat]) => M.xy(lon, lat))
  );
  for (const c of closures) {
    const missing = c.edges.filter((e) => !route.edges.includes(e));
    if (missing.length) throw new Error(`${c.name}: edges ${missing.join(', ')} are not on ${raw.name}.`);
    for (const e of c.edges)
      if (!/lombardy/i.test(D.edges[e].n)) throw new Error(`${c.name}: edge ${e} is ${D.edges[e].n}.`);
  }
  return {
    id: file.replace(/\.json$/, ''),
    name: raw.name,
    source: raw.source,
    section: raw.section,
    match: {
      trackMeters: Math.round(raw.track[raw.track.length - 1][2] - raw.track[0][2]),
      streetMeters: Math.round(route.length),
      meanOffset: Number(route.match.meanOffset.toFixed(1)),
      maxOffset: Number(route.match.maxOffset.toFixed(1)),
    },
    nodes: route.nodes,
    edges: route.edges,
    closures,
  };
}

const courses = [build('richmond-marathon-2026-mile20.json', [LOMBARDY])];
const out = { datasetVersion: P.datasetVersion(D), courses };
fs.writeFileSync(
  path.join(ROOT, 'dist/courses.js'),
  'window.RACE_COURSES=' + JSON.stringify(out, null, 0) + ';\n'
);
for (const c of courses)
  console.log(
    c.name,
    c.edges.length,
    'edges',
    c.match.streetMeters,
    'm of streets from',
    c.match.trackMeters,
    'm of track'
  );
