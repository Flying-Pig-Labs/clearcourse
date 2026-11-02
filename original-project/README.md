# Richmond Race Lab

A browser-local exploratory prototype for discussing race-route closures and staffing with Richmond event planners. This is a working planning experiment, not an operational traffic-control or police staffing plan.

## What works

- A bundled, pannable Richmond vector street map with DPW street geometry and functional classes.
- Approximate 5K, 10K and custom-distance street-loop candidates, using a chosen start area or a point on the map.
- Three route preferences that search differently: balanced, smaller streets, and fewer turns.
- Separate measurements for officers needed, billed officer-hours and staffing cost under Richmond PD's billing rules, a relative burden index, route distance, turns and repeated street distance.
- "How these numbers are calculated": a formula trace for every headline number, tagged Data, Assumption or Rule.
- Street-centerline distance plus a shortest-possible-route estimate, the basis used for certified courses.
- Drawing a connected route through waypoints, including out-and-back legs on one street.
- Importing a single GPX track or GeoJSON LineString, matched to street segments.
- Editable global road-class assumptions, timing, full/rolling closure estimates, hourly rates and minimum shifts.
- Individual junction overrides, planner notes and review filters.
- Closure worksheets and observation worksheets (CSV), a printable closure packet, share links, GeoJSON route downloads, JSON session export/import and browser-local persistence.
- An access screen that checks car access with one-way streets and fire/EMS travel time.

No third-party runtime libraries, map tiles or remote route services are required. The server only serves the static files in `dist/`.

## Model contract

Every modeled location is a visited route junction with at least one public road the route does not use. Public roads include freeway ramps, highways and interchange connections even though the race router never uses them. Neighboring junctions within 22 m sharing a street name are grouped for review. This heuristic needs local inspection, especially at divided roads and roundabouts. It does not infer driveways or every possible barrier position.

The highest functional class among the route and side approaches selects one editable category. A junction with a freeway ramp or interchange connection defaults to the principal-arterial category and carries the reason code `FREEWAY_CONNECTION`. That default is an assumption; planners can change it per site.

Alley mouths that touch the course are counted per route and per site (`ALLEY_MOUTHS_n`). They receive barricades only when a planner sets "Barricades / alley mouth" above its default of zero. Private streets are not counted.

The initial officer counts `[1, 1, 2, 3]`, barricades per side approach `[1, 1, 2, 3]`, road weights `[1, 2, 4, 7]`, $85/hour rate and all timing values are illustrative assumptions. They are not published Richmond requirements.

Burden points at a site = class weight × (1 + 0.2 × additional side approaches) plus the evidence factors below, with no fixed 100-point ceiling. The index is a relative weighting. Road weights run 1 to 7 while default officer counts run 1 to 3, so index differences overstate staffing differences. The interface therefore compares routes on officers and cost first and shows the index last. Road closures also prevent crashes with runners, so a lower index is not automatically safer.

Full closures use one shared pre-start to last-finisher window. Rolling estimates use the earliest fastest-runner arrival and latest last-finisher passage at each site, including repeated route visits.

## Staffing and billing

**Officers needed** is the sum of officers at each post; each post keeps its officers for its whole window. The app also reports the lower bound if officers could move between posts instantly (the most posts staffed at one moment). For 5K and 10K courses the two are equal: across all three start areas, no post closes before another opens, even with instant travel and a 15-minute setup. At 15K with a 15-minute setup the lower bound is 4–8% below. Officer redeployment is therefore not modeled. Supervision, relief and reserves are not modeled either.

**Billing** follows Richmond PD's extra-duty agreements, verified on rva.gov on November 2, 2026:

| Rule                                                                                                   | Source                                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 10 or more officers: special-event agreement; the City bills 1.5 × each officer's personal hourly rate | PD-119SPE (revised 06/09/2025), definitions ¶4, ¶12 |
| Each officer bills at least 4 hours                                                                    | PD-119SPE ¶13; PD-119SE §19                         |
| A started hour bills in full once it passes 15 minutes                                                 | PD-119SPE ¶18; PD-119SE §22                         |
| Request due at least 30 calendar days ahead (10+ officers) or 7 working days (9 or fewer)              | PD-119SPE ¶5; PD-119SE §5                           |
| RPD's Outside Employment Coordinator sets the number of officers                                       | PD-119SPE ¶11                                       |
| 9 or fewer officers: PD-119SE lists $50/hour (+$6/hour for primary traffic control) as one rate option | PD-119SE (revised 07/14/2025)                       |

Billed hours per officer = max(4, whole hours + 1 if the remainder exceeds 15 minutes). Cost = billed officer-hours × the billed rate. The $85 billed rate stays an illustrative placeholder, because personal hourly rates vary and no invoices are bundled. Because typical 5K/10K duty runs 1.2–2.4 hours, the 4-hour minimum sets billed hours for most posts; on the default Fan 5K the estimate rises from $11,921 in v3 to $20,400 (60 officers × 4 h × $85). The "Billing rule" setting can switch to modeled hours.

Sessions saved before version 4 with the old minimum of 0 hours take the 4-hour minimum on load.

## Distance

Route length is measured on street centerlines with a local planar approximation. Against an ellipsoidal calculation the planar error was at most 6 m on a 10 km route (0.06%).

Certified courses are measured on the shortest possible route, 0.30 m from the curb. Runners cut corners, so a centerline course measures short. The app estimates the shortest route by subtracting, at each turn,

    2 × (centerline-to-curb distance − 0.30 m) × tan(turn angle ÷ 2)

capped at half the shorter adjacent segment and at a 120° turn. The centerline-to-curb distance defaults to 4.5 m and is editable. On the default Fan 5K this estimate is 134 m (2.7%) below the centerline length, which is larger than the default ±2% distance tolerance.

The brief's "Distance basis" control applies the tolerance to either the centerline (default) or the shortest-route estimate. Neither is a certified measurement.

## Route search

The candidate search samples 64 loop shapes, adjusts their radii toward the distance target, and connects waypoints using road-class-weighted A* paths. Candidate routing excludes mapped freeways, ramps, alleys and private streets; ignores vehicle one-way restrictions on the hypothetical closed race roads; and favors distinct candidates. It is a heuristic search, not proof of a global optimum.

- **Balanced** ranks candidates within the tolerance by distance, turns and repeated streets. Within ±2% the distance term adds at most 3 points, so turns and repetition decide most picks.
- **Favor smaller streets** raises the road-class penalty during the search and adds the burden index to the ranking.
- **Favor fewer turns** searches with an extra 150 m equivalent cost for each turn over 45°, using an edge-based A* so the turn is known at each junction. Across the three start areas at 5K and 10K it cut the mean turn count of the returned routes by 22–53% (41% on average).

Each returned route gets a content-hash ID (`r` + 16 hex characters) computed from its ordered street segments. The same route always gets the same ID, and different routes get different IDs.

## Drawing and importing

Drawing connects clicks with the shortest street path and may retrace a street, so out-and-back courses stay on one street.

GPX and GeoJSON tracks are matched to street segments with a hidden Markov model:

1. Tracks that already lie on street geometry (an export from this app or a route builder) are resampled every 20 m and matched on their own along-track distances.
2. GPS tracks are first thinned to points at least 20 m apart, then resampled every 20 m and matched on straight-line distances, which GPS jitter does not inflate.
3. Each sample keeps up to 8 street candidates within 50 m. A Viterbi pass chooses the sequence whose street distances best agree with the track.
4. Route ends are rounded to the nearer intersection, because routes run between intersections. In GPS tracks, a turnaround inside one block is kept only if it covers half the block and at least 25 m.

Measured on the bundled network across 51 distinct generated routes:

| Input                                                 | Within the stated bound                          |
| ----------------------------------------------------- | ------------------------------------------------ |
| The app's own GeoJSON exports                         | 51 of 51 reproduce the identical street sequence |
| 1 Hz GPS with correlated 6 m error                    | 50 of 51 within 2% of true length; worst 2.1%    |
| Route-builder lines simplified to 5 m and shifted 6 m | 51 of 51 within 2%                               |

A track more than 50 m from any routable street for more than 200 m is rejected with the location.

## Sessions, IDs and dataset versions

`tools/enrich_data.py` stamps `datasetVersion` into `dist/data.js` from a SHA-256 hash of the street graph (`richmond-centerlines-2026-11-02-64e8dbb27033` for the bundled snapshot). Worksheets, sessions and the audit log record it. Node and edge IDs are only meaningful for one graph, so:

- A worksheet must carry `route_id` and `dataset_version` columns, and both must match the selected route and the loaded data.
- A version-2 session saved with a different dataset version is rejected with a message rather than silently dropped.
- Version-1 sessions (fixed IDs such as `proposed`) migrate on load. Routes get content-hash IDs, and their overrides and observations move with them.

## Data provenance

Snapshot retrieved November 2, 2026:

- [Richmond DPW Carriageway Centerlines](https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/CarriagewayCenterlines/FeatureServer)
- [Richmond GIS Water_Poly](https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/Water_Poly/FeatureServer)
- [Richmond GIS Park](https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/Park/FeatureServer)

Context, not numerical staffing rules:

- [Richmond Police permit guidance](https://rva.gov/police/permits)
- [FHWA Managing Travel for Planned Special Events, chapter 13](https://ops.fhwa.dot.gov/publications/fhwaop04010/chapter13.htm)

The street query envelope is longitude -77.515 to -77.405, latitude 37.525 to 37.605. The pipeline runs in order:

1. `tools/prepare_data.py` downloads the street snapshot to `tools/raw-streets.json`.
2. `tools/build_data.py` builds the compact map and routing graph in `dist/data.js`.
3. `tools/enrich_data.py` adds signals, traffic, facilities, road types, functional classes, freeway flags and the dataset version. It reuses `tools/enrichment-raw.json` when present, so it runs offline.

Rebuilding the graph from a new snapshot renumbers nodes and edges. The dataset version changes with it, and old worksheets and sessions are refused.

## Research-informed factors

`tools/enrich_data.py` preserves graph and edge IDs while adding a November 2, 2026 snapshot of:

- Richmond `Signalized_Intersections/FeatureServer/15`: 383 source records in the query area; 359 in-service signal points retained. A site uses the nearest in-service signal within 35 m. Retired, planned, design and construction records are not scored.
- VDOT `VDOT_Bidirectional_Traffic_Volume_2025/FeatureServer/0`: 721 source features, with positive ADT values associated with 3,915 eligible street edges. Matching requires aligned geometry and the same VDOT feature within 25 m at two of three segment samples. These associations are not field-verified.
- Richmond `HealthAndSafety1`: hospital, EMS, fire and police inventories. Thirty-two source rows are consolidated into 22 mapped facility locations when proximity and a shared address or fire-station number agree. Source inventory categories can overlap and need review.

The index is the sum of separately displayed hierarchy, side-approach, signal, traffic-volume and posted-speed components. Illustrative defaults add 2 points for a matched signal, 0.3 points per 10,000 ADT, and 1 point per 10 mph above 30. Extra signal staffing defaults to zero. None of these coefficients is a Richmond staffing mandate. Unknown factors are unscored and coverage is displayed, so low scores can reflect missing data.

## Access and disruption screen

`dist/planning.js` compares undirected public-road connectivity before and after simultaneous closure of the course and nearby parallel same-name carriageway segments. It screens mapped facilities against the largest remaining study-area component and runs two illustrative cross-route distance probes. Its facility entrance snapping, grouping and closure footprint require review.

The directed check applies DPW one-way codes (FT: digitized direction only; TF: reverse only) and compares the largest strongly connected component before and after closure. It reports intersections that can be entered but not left by car, left but not entered, or cut off, and the streets most affected. On the default Fan 5K it finds 9 intersections that lose car access; 7 of them (5 can be entered but not left, 2 can be left but not entered) are invisible to the undirected check. It also flags Richmond Fire Station 10.

Fire/EMS travel time runs a multi-source Dijkstra from all 14 mapped fire and EMS stations at posted speeds (25/30/35/40 mph by road class when unposted, 45 mph on freeway connections), before and after closure. Increases over 2 minutes are flagged. It assumes emergency vehicles follow one-way rules and do not cross the closed course, which is conservative: crossings can be agreed with RPD and Richmond Fire. Both checks run in under 100 ms.

It ignores turn restrictions, capacity, live traffic and external roads outside the bundled network. Connected does not mean approved, safe or operationally usable; separated can reflect a study-boundary or GIS error. Rolling closures are still screened under the all-course-closed scenario.

## Actual-observation workflow

1. Select a route and download its observation worksheet (Export → Observation worksheet, or the button in "Compare with a real event").
2. Fill `actual_officers`, `actual_barricades` and/or `actual_hours`. Optional `discrepancy_type` and `note` columns record the planner's explanation.
3. Re-import it with `site_id`, `route_id` and `dataset_version` intact.

The app reports matched-site mean absolute errors only for available observed values, retains unmatched observations and lists their IDs, and does not silently fit or alter the rules. Without observations it reports that accuracy is unmeasured.

Routes that carry observations or location edits survive a new route search. They stay in the session, marked "Kept", until a planner removes them; removal asks for confirmation. A session holds up to eight routes.

## Run, test and check

Serve `dist/` with any static HTTP server. With Node.js:

```sh
npm run serve            # http://localhost:8000
```

Or with Python: `python3 -m http.server 8000 --directory dist`.

Development checks:

```sh
npm install              # formatting and lint tools only
npm test                 # model, planning and regression suites
npm run lint             # ESLint, recommended rules
npm run format:check     # Prettier
npm i -D playwright && npx playwright install chromium
npm run test:ui          # 17 browser tests
```

`tests/regression.test.cjs` and `tests/ui.test.cjs` guard each defect fixed in version 3 and each feature added in version 4. All 17 browser tests pass on version 4.

`.openai/hosting.json` is the configuration for the existing ChatGPT Sites deployment. Other hosts ignore it.

## Calibrate with the event team

Use one past race and its real closure/staffing plan. Import its GPX, review detected junctions, replace default weights and staffing counts, assess route suitability, width, transit, construction, emergency and residential access, and compare predicted resources with the actual deployment. No staffing reduction is established by this prototype.

Remaining production work includes operational staffing data, local validation, lane/width and turning-movement data, directional/capacity-aware access analysis, formally governed GIS refreshes, durable shared records, full immutable audit/version histories, and a constrained solver if the validated pilot warrants it. Type checking (for example JSDoc with `tsc --checkJs`) is not set up.

## Version 4 changes

The research roadmap was graded for fit with this app in [docs/roadmap-rubric.md](docs/roadmap-rubric.md). Items scoring 4.0 or higher out of 5 were built:

| Item                                     | Score | What changed                                                                                                                                              |
| ---------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Richmond PD billing rules and headcount  | 4.85  | 4-hour minimum, 15-minute rounding, PD-119SPE/PD-119SE threshold and lead time; "Officers needed" with the instant-move lower bound; billing-rule setting |
| Explain this number, share links         | 4.55  | Formula trace per headline number tagged Data/Assumption/Rule; compressed share links (`#s=`) with a dataset check                                        |
| Printable closure packet                 | 4.55  | Export → Closure packet: summary, route map with numbered posts, one row per post in course order, verified permit reminders                              |
| Directed access and fire/EMS travel time | 4.40  | One-way traps and fire/EMS delays added to the access screen                                                                                              |

Deferred, with the evidence in the rubric: permit deadline helper (3.90; Parks deadlines and the street fee could not be verified), calibration pipeline (3.80; no observations yet), Monte Carlo (3.65), GIS street widths (3.60) and elevation (3.30) (data not reachable from this build), ALNS search (3.55), officer redeployment (3.00; no effect at 5K/10K), MapLibre basemap (2.85) and the research bets.

## Version 3 changes

| Defect in version 2                                                                                                      | Version 3                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Freeway ramps meeting the course got no review site: 67 junctions across 22 of 34 generated routes.                      | Ramps, highways and interchange connections are side approaches with a principal-arterial default. 0 uncounted ramp junctions across 51 routes. Alley mouths are counted. |
| Import snapped to the nearest intersection: 8 of 34 own exports came back within 1%; 6 were rejected; one grew 2.86×.    | Hidden-Markov matching to street segments. 51 of 51 own exports reproduce exactly.                                                                                        |
| Drawn out-and-back legs detoured onto parallel streets, adding 12–22%.                                                   | Drawing retraces streets. Out-and-back legs match 2× the one-way length.                                                                                                  |
| A new search deleted imported observations; route IDs repeated, so a 5K worksheet loaded onto a 10K route.               | Routes with data are kept. Content-hash IDs; worksheets must carry matching route and dataset IDs.                                                                        |
| "Closure worksheet · CSV" exported the observation template; the closure-worksheet code never ran.                       | The menu has both worksheets. The closure worksheet includes times, coordinates, freeway connections and alley mouths.                                                    |
| The page scrolled sideways on phones (746 px at a 390 px viewport).                                                      | Fixed.                                                                                                                                                                    |
| A "51% lower modeled index" tag led the comparison for 18% fewer officers.                                               | Officers and cost lead; tags show officer and cost changes.                                                                                                               |
| "Favor fewer turns" returned the same three routes as Balanced in 6 of 6 cases; "Distance-first" ranked mostly on turns. | Turn-penalized search; "Balanced loop" label.                                                                                                                             |
| ±2% tolerance and two-decimal km implied certified precision.                                                            | Shortest-route estimate shown; tolerance can apply to it.                                                                                                                 |
| Dataset version was a hand-typed constant.                                                                               | Derived from a graph hash at build time.                                                                                                                                  |
| Custom distance started a search before a value was entered.                                                             | It waits for a value and Enter or Explore routes.                                                                                                                         |
| Code was hand-minified one-liners with no lint or UI tests.                                                              | Prettier formatting, ESLint, regression and browser test suites.                                                                                                          |
