// Browser tests for the workflows that broke in v2. Requires Playwright with Chromium:
//   npm i -D playwright && npx playwright install chromium
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServer } = require('../tools/serve.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'race-lab-ui-'));
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
}

(async () => {
  const server = createServer().listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const snapshot = () => page.evaluate(() => RaceLab.getSnapshot());
  const idle = () =>
    page.waitForFunction(() => RaceLab.ready && !document.getElementById('generateButton').disabled);
  const toast = () => page.evaluate(() => document.getElementById('toast').textContent);
  async function download(trigger) {
    const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
    const target = path.join(tmp, file.suggestedFilename());
    await file.saveAs(target);
    return { name: file.suggestedFilename(), text: fs.readFileSync(target, 'utf8'), path: target };
  }
  async function exportMenu(kind) {
    await page.click('#exportButton');
    return download(() => page.click(`[data-export="${kind}"]`));
  }

  await page.goto(url);
  await idle();

  await step('loads with content-hash route IDs and honest names', async () => {
    const s = await snapshot();
    assert.equal(s.state.routes.length, 3);
    for (const r of s.state.routes) assert.match(r.id, /^r[0-9a-f]{16}$/);
    assert.equal(s.state.routes[0].name, 'Balanced loop');
    assert.match(s.state.datasetVersion, /^richmond-centerlines-/);
    const metrics = await page.locator('#metrics .metric-label').allTextContents();
    assert.deepEqual(metrics.slice(0, 2), ['Officers needed', 'Est. staffing cost']);
  });

  await step('closure worksheet menu item exports the closure worksheet', async () => {
    const f = await exportMenu('csv');
    assert.match(f.name, /^richmond-closure-worksheet-/);
    for (const col of [
      'duty_start',
      'duty_end',
      'latitude',
      'longitude',
      'freeway_connection',
      'alley_mouths',
    ])
      assert.ok(f.text.split('\r\n')[0].includes(col), col);
    const w = await exportMenu('worksheet');
    assert.ok(w.text.startsWith('"site_id","route_id","dataset_version"'));
  });

  let worksheet;
  await step('observations survive a new search and cannot attach to another route', async () => {
    const before = await snapshot();
    const routeId = before.state.selected;
    const w = await download(() => page.click('#actualTemplate'));
    const lines = w.text.split('\r\n');
    const col = lines[0].split(',').indexOf('"actual_officers"');
    worksheet = path.join(tmp, 'filled.csv');
    fs.writeFileSync(
      worksheet,
      lines
        .map((line, i) => {
          if (!i) return line;
          const cells = line.match(/"([^"]|"")*"/g);
          cells[col] = '"2"';
          return cells.join(',');
        })
        .join('\r\n')
    );
    await page.setInputFiles('#actualsInput', worksheet);
    await page.waitForFunction(
      (id) => (RaceLab.getSnapshot().state.calibration[id] || []).length > 0,
      routeId
    );
    const loaded = (await snapshot()).state.calibration[routeId].length;
    await page.click('#generateButton');
    await idle();
    const after = await snapshot();
    assert.equal(after.state.calibration[routeId]?.length, loaded, 'Observations were deleted');
    assert.ok(
      after.state.routes.some((r) => r.id === routeId),
      'Route with observations was dropped'
    );
    await page.click('[data-distance="10"]');
    await idle();
    const ten = await snapshot();
    assert.notEqual(ten.state.selected, routeId);
    await page.setInputFiles('#actualsInput', worksheet);
    await page.waitForTimeout(300);
    assert.match(await toast(), /different route/);
    assert.equal((ten.state.calibration[ten.state.selected] || []).length, 0);
  });

  await step('removing a route without data works; routes with data ask first', async () => {
    const s = await snapshot();
    const plain = s.state.routes.find((r) => !(s.state.calibration[r.id] || []).length);
    await page.click(`[data-remove="${plain.id}"]`);
    const after = await snapshot();
    assert.equal(after.state.routes.length, s.state.routes.length - 1);
    const withData = after.state.routes.find((r) => (after.state.calibration[r.id] || []).length);
    page.once('dialog', (d) => d.dismiss());
    await page.click(`[data-remove="${withData.id}"]`);
    assert.equal(
      (await snapshot()).state.routes.length,
      after.state.routes.length,
      'Dismissed confirm removed it'
    );
  });

  await step('custom distance waits for a value', async () => {
    const before = (await snapshot()).state.routes.map((r) => r.edges.join('.')).join();
    await page.click('[data-distance="custom"]');
    await page.waitForTimeout(1500);
    assert.equal(
      (await snapshot()).state.routes.map((r) => r.edges.join('.')).join(),
      before,
      'Custom started a search'
    );
    await page.fill('#customDistance', '7.5');
    await page.press('#customDistance', 'Enter');
    await idle();
    const s = await snapshot();
    assert.equal(s.state.distance, 7.5);
    assert.ok(Math.abs(s.selectedScore.length - 7500) / 7500 <= 0.02);
  });

  await step('re-importing an exported route matches it exactly', async () => {
    const s = await snapshot();
    const f = await exportMenu('geojson');
    await page.setInputFiles('#fileInput', f.path);
    await page.waitForTimeout(500);
    assert.match(await toast(), /already in the session/);
    assert.equal((await snapshot()).state.routes.length, s.state.routes.length);
  });

  await step('a noisy GPX of a route imports within 2.5% of its length', async () => {
    const s = await snapshot();
    const gpx = await page.evaluate(() => {
      const D = window.RACE_DATA,
        s = RaceLab.getSnapshot(),
        r = s.state.routes.find((x) => x.id === s.state.selected);
      let seed = 7;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
      const pts = [];
      r.edges.forEach((ei, i) => {
        const e = D.edges[ei],
          p = e.a === r.nodes[i] ? e.p : e.p.slice().reverse();
        for (const v of i ? p.slice(1) : p) pts.push(v);
      });
      let ex = 0,
        ey = 0,
        out = '';
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]],
          k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
        for (let j = 0; j < k; j++) {
          ex = 0.95 * ex + 0.31 * 6 * gauss();
          ey = 0.95 * ey + 0.31 * 6 * gauss();
          const [lon, lat] = RaceModel.lonlat(
            a[0] + ((b[0] - a[0]) * j) / k + ex,
            a[1] + ((b[1] - a[1]) * j) / k + ey
          );
          out += `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>`;
        }
      }
      return { xml: `<?xml version="1.0"?><gpx><trk><trkseg>${out}</trkseg></trk></gpx>`, length: r.length };
    });
    const file = path.join(tmp, 'watch.gpx');
    fs.writeFileSync(file, gpx.xml);
    await page.setInputFiles('#fileInput', file);
    // A good match either adds a near-identical route or reproduces the original exactly.
    await page
      .waitForFunction(
        () => /Imported|already in the session/.test(document.getElementById('toast').textContent),
        null,
        {
          timeout: 15000,
        }
      )
      .catch(async () => {
        throw new Error('GPX import failed: ' + (await toast()));
      });
    assert.ok((await snapshot()).state.routes.length <= s.state.routes.length + 1);
    const added = (await snapshot()).selectedScore.length;
    assert.ok(Math.abs(added / gpx.length - 1) <= 0.025, `${added} vs ${gpx.length}`);
  });

  await step('drawing back along a street retraces it', async () => {
    await page.click('#drawButton');
    const result = await page.evaluate(() => {
      const D = window.RACE_DATA,
        net = RaceModel.createNetwork(D),
        name = 'W Grace St';
      const nodes = [...new Set(D.edges.filter((e) => e.c >= 0 && e.n === name).flatMap((e) => [e.a, e.b]))];
      let best = null;
      for (const a of nodes.slice(0, 40))
        for (const c of nodes) {
          const q = net.path(a, c, 0);
          if (q && q.edges.every((ei) => D.edges[ei].n === name) && Math.abs(q.length - 800) < 150)
            if (!best || Math.abs(q.length - 800) < Math.abs(best.q.length - 800)) best = { a, c, q };
        }
      const map = document.getElementById('map');
      const click = (pt) => {
        const v = RaceLab.getSnapshot().view,
          r = map.getBoundingClientRect();
        const x = r.left + ((pt[0] - v.x) / v.w) * r.width,
          y = r.top + ((pt[1] - v.y) / v.h) * r.height;
        for (const type of ['pointerdown', 'pointerup'])
          map.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
      };
      click(D.nodes[best.a]);
      click(D.nodes[best.c]);
      click(D.nodes[best.a]);
      return { oneWay: best.q.length, label: document.getElementById('mapRouteName').textContent };
    });
    const km = Number(result.label.match(/([\d.]+) km/)[1]);
    assert.ok(Math.abs(km * 1000 - 2 * result.oneWay) < 10, `${km} km vs ${(2 * result.oneWay) / 1000}`);
    await page.click('#cancelDraw');
  });

  await step('fewer-turns preference returns fewer-turn routes', async () => {
    await page.click('[data-distance="5"]');
    await idle();
    const balanced = await snapshot();
    await page.selectOption('#characterSelect', 'turns');
    await page.click('#generateButton');
    await idle();
    const turns = await snapshot();
    assert.equal(turns.state.routes.find((r) => r.id === turns.state.selected).name, 'Fewest-turns loop');
    assert.ok(turns.selectedScore.turns < balanced.selectedScore.turns);
    await page.selectOption('#characterSelect', 'balanced');
  });

  await step('model dialog saves the new curb-offset and alley settings', async () => {
    await page.click('#assumptionsButton');
    await page.fill('#settingCurbOffset', '0');
    await page.fill('#settingAlleyBarriers', '1');
    await page.click('#saveModel');
    const s = await snapshot();
    assert.equal(s.state.settings.curbOffset, 0);
    assert.equal(
      s.selectedScore.shortestRoute,
      s.selectedScore.length,
      'Zero offset means no corner cutting'
    );
    assert.equal(s.selectedScore.alleyBarricades, s.selectedScore.alleyMouths);
    await page.click('#assumptionsButton');
    await page.click('#resetModel');
    await page.keyboard.press('Escape');
  });

  await step('version-1 sessions migrate to hashed IDs with their edits', async () => {
    const legacy = await page.evaluate(() => {
      const s = RaceLab.getSnapshot().state;
      const route = s.routes[0];
      const site = RaceLab.getSnapshot().selectedScore.sites[0].id;
      return {
        version: 1,
        distance: 5,
        seed: '0',
        preference: 'balanced',
        settings: s.settings,
        routes: [{ ...route, id: 'proposed' }],
        selected: 'proposed',
        overrides: { proposed: { [site]: { officers: 9, barriers: 4, class: 2, note: 'legacy edit' } } },
        constraints: s.constraints,
        calibration: {},
        audit: [],
        ruleRevision: 3,
        expected: route.id,
        site,
      };
    });
    await page.evaluate((v1) => {
      localStorage.removeItem('richmond-race-lab-v2');
      localStorage.setItem('richmond-race-lab-v1', JSON.stringify(v1));
    }, legacy);
    await page.reload();
    await idle();
    const s = await snapshot();
    assert.equal(s.state.routes.length, 1);
    assert.equal(s.state.routes[0].id, legacy.expected);
    assert.equal(s.state.routes[0].role, 'proposed');
    assert.equal(s.state.overrides[legacy.expected][legacy.site].officers, 9);
  });

  await step('cost follows the Richmond PD 4-hour minimum and the explain panel shows it', async () => {
    await page.click('[data-distance="5"]');
    await idle();
    const s = await snapshot();
    const billed = s.selectedScore.sites.reduce((a, x) => a + x.officers * Math.max(4, x.billedHoursEach), 0);
    assert.equal(s.selectedScore.paidHours, billed);
    assert.ok(s.selectedScore.sites.every((x) => x.billedHoursEach >= 4));
    await page.click('#explainPanel summary');
    const text = await page.locator('#explainBody').innerText();
    for (const phrase of ['PD-119SPE', 'at least 4 hours', 'Officers needed', 'Distance'])
      assert.ok(text.includes(phrase), phrase);
  });

  await step('share links open the same scenario in a new browser', async () => {
    const s = await snapshot();
    await page.click('#exportButton');
    await page.click('[data-export="share"]');
    await page.waitForFunction(() => document.getElementById('shareLink').value.includes('#s='));
    const link = await page.inputValue('#shareLink');
    assert.match(link, /#s=z/);
    await page.click('#shareDialog [data-close]');
    const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await other.newPage();
    await p.goto(link);
    await p.waitForFunction(() => window.RaceLab && RaceLab.ready);
    const t = await p.evaluate(() => RaceLab.getSnapshot());
    assert.deepEqual(
      t.state.routes.map((r) => r.id),
      s.state.routes.map((r) => r.id)
    );
    assert.equal(t.state.selected, s.state.selected);
    assert.equal(await p.evaluate(() => location.hash), '', 'The fragment is cleared after loading');
    assert.match(
      await p.evaluate(() => document.getElementById('toast').textContent),
      /Shared scenario loaded/
    );
    await other.close();
  });

  await step('access screen reports one-way access and fire/EMS travel time', async () => {
    await page.click('#accessButton');
    await page.waitForFunction(() => document.getElementById('accessButton').textContent.includes('Run'));
    const text = await page.locator('#accessSummary').innerText();
    assert.ok(text.includes('With one-way streets'));
    assert.match(text, /From \d+ fire and EMS stations/);
  });

  await step('closure packet lists every post in course order', async () => {
    await page.evaluate(() => (window.print = () => {}));
    await page.click('#exportButton');
    await page.click('[data-export="packet"]');
    const s = await snapshot();
    const rows = await page.locator('#packet .packet-table tbody tr').count();
    assert.equal(rows, s.selectedScore.sites.length);
    const text = await page.locator('#packet').evaluate((el) => el.textContent);
    for (const phrase of ['Closure packet', 'PD-119SPE', '48 hours', 'Access screen'])
      assert.ok(text.includes(phrase), phrase);
    assert.ok(await page.evaluate(() => document.body.classList.contains('printing-packet')));
    assert.equal(await page.locator('#packet svg circle').count(), rows);
  });

  await step('"How this was built" explains data and method with live counts', async () => {
    await page.click('#builtNav');
    await page
      .waitForFunction(
        () => Math.abs(document.getElementById('howBuilt').getBoundingClientRect().top) < 200,
        null,
        {
          timeout: 5000,
        }
      )
      .catch(() => {
        throw new Error('The nav link did not scroll to the section');
      });
    const stats = await page.locator('#builtStats').innerText();
    const routable = await page.evaluate(() => window.RACE_DATA.edges.filter((e) => e.c >= 0).length);
    assert.ok(stats.includes(routable.toLocaleString('en-US')), 'Counts come from the bundled data');
    const text = await page.locator('#howBuilt').innerText();
    for (const phrase of [
      'The data',
      'From brief to course',
      'Staffing and cost',
      'Distance',
      'Design choices',
      'Build history',
      'PD-119SPE',
    ])
      assert.ok(text.includes(phrase), phrase);
    assert.ok((await page.locator('#howBuilt .built-sources a').count()) >= 10, 'Sources are linked');
  });

  await step('page does not scroll sideways at phone width', async () => {
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const p = await phone.newPage();
    await p.goto(url);
    await p.waitForFunction(() => window.RaceLab && RaceLab.ready);
    const widths = await p.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    assert.ok(widths[0] <= widths[1], `scrollWidth ${widths[0]} > ${widths[1]}`);
    await phone.close();
  });

  await step('no browser errors', async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  for (const [status, name, message] of results) console.log(status, name, message ? '— ' + message : '');
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(failed ? `${failed} UI test(s) failed.` : `All ${results.length} UI tests passed.`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
