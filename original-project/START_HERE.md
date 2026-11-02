# Richmond Race Lab v4 — complete project export

## Run locally

Node.js or Python 3 is enough to serve the app; there is no build step.

    cd Richmond_Race_Lab_v4
    node tools/serve.cjs 8000
    # or: python3 -m http.server 8000 --directory dist

Open http://localhost:8000 in your browser. The bundled GIS snapshot is included.

## Run the checks

    npm install          # Prettier and ESLint only
    npm test             # model, planning and regression suites
    npm run lint
    npm run format:check
    npm i -D playwright && npx playwright install chromium
    npm run test:ui      # 17 browser tests

## Contents

- dist/: complete static app and bundled Richmond GIS data (dataset richmond-centerlines-2026-11-02-64e8dbb27033)
- tests/: model, planning, regression and browser tests
- tools/: GIS ingestion, graph preparation, enrichment and a static server
- tools/raw-streets.json and tools/enrichment-raw.json: input snapshots
- README.md: model, staffing and billing rules, distance, import matching, access screening, data provenance, version 3 and 4 changes and remaining validation work
- docs/roadmap-rubric.md: how each research recommendation was graded for fit, and which were built
- .openai/hosting.json: the existing ChatGPT Sites configuration; other hosts ignore it
- EXPORT_MANIFEST.json: SHA-256 hashes of exported project files

No Git history, repository credentials, browser-local sessions or actual staffing observations are included. Browser-local work can be downloaded through the app's Export → Full session option. Version-1 session files and browser sessions migrate automatically.

Staffing and access outputs remain planning estimates pending local validation. See README.md for limitations and source details.
