# Richmond Race Lab v2 — complete project export

## Run locally

Python 3 is enough to serve the app; there is no dependency installation or build step.

    cd Richmond_Race_Lab_v2
    python3 -m http.server 8000 --directory dist

Open http://localhost:8000 in your browser. The bundled GIS snapshot is included.

## Run the tests

With Node.js installed:

    node tests/model.test.cjs
    node tests/planning.test.cjs

## Contents

- dist/: complete static app and bundled Richmond GIS data
- tests/: model, constraints, access-screen and calibration tests
- tools/: GIS ingestion, graph preparation and enrichment scripts
- tools/raw-streets.json and tools/enrichment-raw.json: input snapshots
- README.md: model, data provenance, assumptions and remaining validation work
- .openai/hosting.json: the existing Sites project configuration
- EXPORT_MANIFEST.json: source revision and SHA-256 hashes of exported project files

The two original ingestion scripts use export-relative paths in this ZIP so they can run from another directory. Their app/model behavior is unchanged. No Git history, repository credentials, browser-local sessions or actual staffing observations are included. Browser-local work can be downloaded separately through the app's Export → Full session option.

Staffing and access outputs remain planning estimates pending local validation. See README.md for limitations and source details.
