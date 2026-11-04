# Race Lab

Publish the attached, already-complete Richmond Race Lab v2 application as a working Lovable project titled "Richmond Race Lab".

The ZIP is the source of truth. Extract it and inspect START_HERE.md, README.md, dist/, tests/, and EXPORT_MANIFEST.json before making changes. This is an existing working app migration, not a request to invent a replacement. Preserve the exact bundled Richmond GIS data and all model/calibration algorithms and the existing green/ivory UI.

The original is a dependency-free static app in dist/index.html with relative CSS/JS/data/favicon files. Use the current Lovable default runtime as the hosting shell. A full-viewport same-origin iframe pointing to an extracted public/race-lab/index.html is an acceptable, preferred minimal adaptation if direct static entry hosting is awkward. Ensure the entire original app scrolls and works on desktop and mobile, without additional outer navigation or padding. If using a nested static directory, change the original brand/home link from "./" to "./index.html" so clicking it does not load a nested hosting shell. Set the outer page title and favicon appropriately.

Preserve:
- The actual street graph and map, 5K/10K/custom candidate search, drawing/GPX/GeoJSON import, export and browser-local sessions.
- Model v2 decomposition into road hierarchy, approaches, in-service signal matches, GIS-associated 2025 ADT, and speed, with explicit coverage/unknown values.
- Editable staffing/time/cost rules, rule revisions, required override reasons, keep-open streets/required streets/distance tolerance/staffing caps.
- Facility topology/detour screening, staffing phase timeline and overlap curve.
- CSV actual-staffing import, matching/error summaries, unmatched observations, worksheet export.
- Clear disclosures that numerical weights are illustrative, missing factors are unscored, access screening is limited, and actual staffing accuracy is unvalidated.

Use the uploaded code/data, not screenshots or a reconstruction. No external map API or database is required. Do not replace the dataset with samples. Keep original source/scripts/tests/docs available in the repository, e.g. an original-project/ directory, and run both original test suites there:
node tests/model.test.cjs
node tests/planning.test.cjs
Build the Lovable shell and verify there are no missing asset paths. Ignore the original .openai/hosting.json for Lovable hosting; it belongs to the existing Sites deployment and should not be served publicly.
No actual operational staffing observations or browser session data are in this ZIP. Do not provision extra backend services for this static migration.
Finish with a working preview, and report the retained file locations, test/build results, and any migration changes. I will invoke Lovable's deploy tool after this import is complete.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://race-lab.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6d9efd89-8c3c-4e59-85e7-a1d7ccf325c5).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
