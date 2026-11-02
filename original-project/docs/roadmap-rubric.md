# Roadmap fit rubric

How well each research recommendation fits the existing Race Lab, graded on 2026-11-02. Items scoring 4.0 or higher were integrated in version 4.

## Criteria

| Criterion            | Weight | 1                                                     | 3                                              | 5                                                                         |
| -------------------- | ------ | ----------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| Decision value       | 30%    | Rarely changes a number or flag for 1–15 km races     | Improves a secondary number                    | Changes a headline number or a go/no-go flag planners act on              |
| No added user effort | 20%    | Adds required inputs or a new workflow                | Adds an optional input                         | No new inputs; hidden until asked, or replaces a number with a better one |
| Architecture fit     | 20%    | Needs a backend or service                            | Needs a runtime dependency or offline pipeline | Static, buildless, no runtime dependency, works in the Lovable iframe     |
| Data readiness       | 15%    | Needs data not obtainable from this build environment | Partly verified or partly bundled              | Uses bundled data or rules verified from primary sources                  |
| Build risk           | 15%    | Months, or high regression risk                       | Weeks, moderate risk                           | Days, testable with existing suites                                       |

Score = Σ weight × grade (maximum 5.0). Cutoff for integration: 4.0.

## Grades

| Rank | Item                                                                                        | Value | Effort | Fit | Data | Risk | Score | Decision   |
| ---- | ------------------------------------------------------------------------------------------- | ----- | ------ | --- | ---- | ---- | ----- | ---------- |
| 1    | Q1 · Encode Richmond PD billing rules; show headcount range                                 | 5     | 5      | 5   | 5    | 4    | 4.85  | Integrated |
| 2    | Q3 · "Explain this number", scenario compare, shareable links                               | 4     | 5      | 5   | 5    | 4    | 4.55  | Integrated |
| 3    | M6 · Printable closure packet (no mobile field verification)                                | 4     | 5      | 5   | 5    | 4    | 4.55  | Integrated |
| 4    | M4 · Directed access and fire/EMS response screen (lite: no time-of-day volumes or transit) | 4     | 5      | 5   | 4    | 4    | 4.40  | Integrated |
| 5    | Q2 · Permit deadline and fee helper                                                         | 3     | 4      | 5   | 3    | 5    | 3.90  | Deferred   |
| 6    | M7 · Calibration pipeline (Gamma–Poisson update)                                            | 3     | 5      | 5   | 2    | 4    | 3.80  | Deferred   |
| 7    | M2 · Runner-flow Monte Carlo (P50/P90)                                                      | 3     | 5      | 5   | 2    | 3    | 3.65  | Deferred   |
| 8    | Q4 · GIS-derived street widths for the shortest-route estimate                              | 4     | 5      | 4   | 1    | 3    | 3.60  | Deferred   |
| 9    | M3 · ALNS route search with Pareto archive                                                  | 3     | 4      | 4   | 5    | 2    | 3.55  | Deferred   |
| 10   | Q5 · USGS 3DEP elevation profile                                                            | 3     | 5      | 4   | 1    | 3    | 3.30  | Deferred   |
| 11   | M1 · Staffing optimizer with officer redeployment                                           | 1     | 4      | 5   | 3    | 3    | 3.00  | Deferred   |
| 12   | R4 · Commercial probe volumes                                                               | 3     | 5      | 3   | 1    | 2    | 2.95  | Deferred   |
| 13   | R1 · Offline exact MIP benchmark                                                            | 2     | 5      | 2   | 5    | 1    | 2.90  | Deferred   |
| 14   | M5 · MapLibre GL + PMTiles basemap                                                          | 3     | 4      | 2   | 2    | 3    | 2.85  | Deferred   |
| 15   | R2 · LLM-assisted brief entry                                                               | 2     | 4      | 1   | 4    | 2    | 2.50  | Deferred   |
| 16   | R3 · Corridor microsimulation (SUMO)                                                        | 2     | 5      | 1   | 1    | 1    | 2.10  | Deferred   |

## Evidence behind the grades

- **Q1 (4.85).** Average duty is 1.2–2.4 h, under the 4-hour minimum (PD-119SPE ¶13), so v3 understated billed hours by roughly 2×. Rules verified on rva.gov forms PD-119SPE (rev. 06/09/2025) and PD-119SE (rev. 07/14/2025).
- **Q3 (4.55).** Uses native CompressionStream; no new inputs. Scenario pinning deferred: route cards already compare options under one set of assumptions.
- **M6 (4.55).** Turns the plan into the per-post sheet RPD and DPW use on race day; field verification needs a backend and is excluded.
- **M4 (4.40).** One-way flags (3,693 edges), posted speeds and fire/EMS locations are already bundled; Richmond street closing permits are judged on access. Turn restrictions are not in the DPW data.
- **Q2 (3.90).** Only RPD lead times (30 calendar days / 7 working days), the 15-business-day street closing rule (City Code §90-361) and 48-hour No Parking signs were verifiable. The 45/90-day Parks deadlines and $50-per-street fee were not. The RPD agreement and lead time are folded into Q1.
- **M7 (3.80).** Cheap to code, but no observations exist yet; value waits on FOIA data.
- **M2 (3.65).** No Richmond finish-time data bundled; under the 4-hour minimum, duty-window spread rarely changes billed hours below 15K.
- **Q4 (3.60).** Needs Richmond GeoHub Roads polygons, which this build environment cannot download; the polygons date from 1999–2009 imagery.
- **M3 (3.55).** 3–5 weeks; the current sampler already matches GraphHopper round-trip practice; stochastic results complicate share links.
- **Q5 (3.30).** Needs lidar tiles not reachable from this build environment; bridges need special handling.
- **M1 (3.00).** Measured: 0 chainable post pairs at 5K and 10K from all three start areas, even with instant travel; at 15K with a 15-minute setup the instant-move bound is only 4–8% lower. Also depends on whether RPD leapfrogs.
- **R4 (2.95).** Licensed data; procurement-bound; redistribution limits.
- **R1 (2.90).** Measures the heuristic gap; ships nothing to users; months of work.
- **M5 (2.85).** Adds a WebGL runtime dependency, needs an OSM extract build and byte-range hosting on Lovable (unverified).
- **R2 (2.50).** Needs a serverless proxy for the API key; prompts may become public records.
- **R3 (2.10).** Needs a calibrated demand model; only for a specific corridor dispute.

## What changes the grades

- **FOIA invoices or RPD post sheets** raise M7 data readiness to 5 (score 4.25) and make M2 worth building.
- **RPD confirming that officers leapfrog**, plus marathon-length courses, raise M1 decision value.
- **Downloading the GeoHub Roads polygons and 3DEP tiles** in an environment with access raises Q4 to 4.20 and Q5 to 3.90.
- **Verifying the Parks deadlines and street-closure fee** raises Q2 data readiness to 5 (score 4.20).
