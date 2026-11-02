# Richmond Race Lab

A browser-local exploratory prototype for discussing race-route closures and staffing with Richmond event planners. This is a working planning experiment, not an operational traffic-control or police staffing plan.

## What works

- A bundled, pannable Richmond vector street map with DPW street geometry and functional classes.
- Approximate 5K, 10K and custom-distance street-loop candidates, using a chosen start area or a point on the map.
- Separate measurements for weighted closure burden, route distance, turns and repeated street distance.
- Drawing a connected route through waypoints, and importing a single GPX track or GeoJSON LineString within the bundled area.
- Editable global road-class assumptions, timing, full/rolling closure estimates, hourly rates and minimum shifts.
- Individual junction overrides, planner notes and review filters.
- CSV closure worksheets, GeoJSON route downloads, JSON session export/import and browser-local persistence.

No third-party runtime libraries, map tiles or remote route services are required. The server only serves the static files in `dist/`.

## Model contract

Every modeled location is a visited route junction with at least one incident public-road segment not used by the route. Neighboring junctions within 22 m sharing a street name are grouped for review. This heuristic needs local inspection, especially at divided roads and roundabouts. It does not infer driveways or every possible barrier position.

The highest functional class among the route and side approaches selects one editable category. The initial officer counts `[1, 1, 2, 3]`, barricades per side approach `[1, 1, 2, 3]`, road weights `[1, 2, 4, 7]`, $85/hour rate and all timing values are illustrative assumptions. They are not published Richmond requirements.

Burden points at a site = class weight × (1 + 0.2 × additional side approaches). This is the hierarchy/approach component of model 2.0; the current total also includes the evidence factors described below, with no fixed 100-point ceiling. The index per kilometer is also displayed. Cost and staffing time are separate from that index.

Full closures use one shared pre-start to last-finisher window. Rolling estimates use the earliest fastest-runner arrival and latest last-finisher passage at each site, including repeated route visits. Peak staffing is calculated from overlapping duty intervals. Cost applies the hourly rate and optional minimum paid shift per site. Redeployment, travel, supervision, relief, equipment costs and actual traffic flows are not modeled.

The candidate search samples 64 loop shapes, adjusts their radii toward the distance target, and connects waypoints using road-class-weighted A* paths. Candidate routing excludes mapped freeways, ramps, alleys and private streets; ignores vehicle one-way restrictions on the hypothetical closed race roads; and favors distinct candidates. It is a heuristic search, not proof of a global optimum. Route distances use a local planar approximation and are not certified race measurements.

## Data provenance

Snapshot retrieved November 2, 2026:

- [Richmond DPW Carriageway Centerlines](https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/CarriagewayCenterlines/FeatureServer)
- [Richmond GIS Water_Poly](https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/Water_Poly/FeatureServer)
- [Richmond GIS Park](https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/Park/FeatureServer)

Context, not numerical staffing rules:

- [Richmond Police permit guidance](https://rva.gov/police/permits)
- [FHWA Managing Travel for Planned Special Events, chapter 13](https://ops.fhwa.dot.gov/publications/fhwaop04010/chapter13.htm)

The street query envelope is longitude -77.515 to -77.405, latitude 37.525 to 37.605. `tools/prepare_data.py` downloads the source snapshot, and `tools/build_data.py` constructs the compact map and routing graph. The raw intermediate file is ignored; `dist/data.js` is the bundled deployable data.

## Run and verify

This project is buildless. Serve `dist/` using any static HTTP server. In the Sites environment, use `sites-preview start /workspace/sites/richmond-race-lab`.

Run the model checks with:

```sh
node tests/model.test.cjs
node --check dist/app.js
node --check dist/model.js
```

The tests cover graph connectivity, forbidden roads, junction counting, repeated visits, timing, minimum shifts, local overrides, and approximate 5K/10K candidates on the bundled street network. Browser QA covers selection, changing distance, changing assumptions, overriding a location and drawing a route. The app's read-only `RaceLab.getSnapshot()` diagnostic exposes the current prototype session for inspection.

## Calibrate with the event team

Use one past race and its real closure/staffing plan. Review detected junctions; replace default weights and staffing counts; assess route suitability, width, transit, construction, emergency and residential access; and compare predicted resources with the actual deployment. No staffing reduction is established by this prototype.

## Research-informed update (model 2.0)

The follow-up research has been applied to the existing browser-local prototype. This update does not introduce a server database or claim an operationally validated model.

### Added evidence and explainability

`tools/enrich_data.py` preserves graph and edge IDs while adding a November 2, 2026 snapshot of:

- Richmond `Signalized_Intersections/FeatureServer/15`: 383 source records in the query area; 359 in-service signal points retained for matching within 35 m. Retired, planned, design and construction records are not scored.
- VDOT `VDOT_Bidirectional_Traffic_Volume_2025/FeatureServer/0`: 721 source features, with positive ADT values associated with 3,915 eligible street edges. Matching requires aligned geometry and the same VDOT feature within 25 m at two of three segment samples. These associations are not field-verified.
- Richmond `HealthAndSafety1`: hospital, EMS, fire and police inventories. Thirty-two source rows are consolidated into 22 mapped facility locations when proximity and a shared address or fire-station number agree. Source inventory categories can overlap and need review.

The index is now the sum of separately displayed hierarchy, side-approach, signal, traffic-volume and posted-speed components. Illustrative defaults add 2 points for a matched signal, 0.3 points per 10,000 ADT, and 1 point per 10 mph above 30. Extra signal staffing defaults to zero. None of these coefficients is a Richmond staffing mandate. Unknown factors are unscored and coverage is displayed, so low scores can reflect missing data.

### Route brief and timing

The generator samples 64 loop shapes with up to four radius refinements. It filters candidates by distance tolerance (default ±2%), required streets and optional estimated peak staffing cap. Keep-open streets block candidate edges incident to those streets' mapped junctions, including crossings. Required streets mean visiting at least one mapped segment, not a specified corridor length. This is a bounded heuristic search and can return no candidate despite the existence of a feasible route. It makes no optimality or certified-distance claim.

The new timeline displays setup, active control and clearance for selected locations, plus the simultaneous staffing curve. Rule changes receive local revision numbers; location overrides require a reason. Session exports retain these assumptions, source metadata and the recent review history. Existing version-1 sessions remain readable with defaults for the added fields.

### Access and disruption screen

`dist/planning.js` compares undirected public-road connectivity before and after simultaneous closure of the course and nearby parallel same-name carriageway segments. It screens mapped facilities against the largest remaining study-area component and runs two illustrative cross-route distance probes. Its facility entrance snapping, grouping and closure footprint require review. It ignores one-way restrictions, turn restrictions, capacity, live traffic and external roads outside the bundled network. Connected does not mean approved, safe or operationally usable; separated can reflect a study-boundary or GIS error. Rolling closures are still screened under the all-course-closed scenario.

### Actual-observation workflow

Download a route worksheet and populate `actual_officers`, `actual_barricades` and/or `actual_hours`. Optional `discrepancy_type` and `note` columns record the planner's explanation. Re-import it with its route ID, dataset version and site IDs intact. The app reports matched-site mean absolute errors only for available observed values, retains unmatched observations and lists their IDs, and does not silently fit or alter the rules. Without observations it explicitly reports that accuracy is unmeasured. Multiple imported/drawn historical routes can be retained in one session, up to the eight-route session limit.

The supplementary tests are:

```sh
node tests/planning.test.cjs
```

They cover component calculations, unknown observations, explicit signal staffing assumptions, route constraints, paired carriageway closure screening, isolated facility warnings, quoted CSV fields, zero-valued actual observations, and rejection of duplicate, invalid or mismatched observation files.

Remaining production work includes operational staffing data, local validation, lane/width and turning-movement data, directional/capacity-aware access analysis, formally governed GIS refreshes, durable shared records, full immutable audit/version histories, and a constrained solver if the validated pilot warrants it.
