# creditad-desktop

Electron + Vue 3 desktop client for **CrediTAD**, which attaches a structured evidence
record to each boundary of an already-called TAD boundary list.

This repository holds the client source only. The evidence engine, the `creditad`
command-line interface, the local HTTP/JSON service and the six evidence packages are in
the main repository, <https://github.com/Yin-Shen/creditad>. The client calls that
service on `http://127.0.0.1:5001` and renders what it returns: the contact map, the
caller calls, the ChIP and loop tracks, the tier track and the evidence card of a
selected boundary, plus an optional local review record. It computes no evidence
itself.

CrediTAD is not a TAD caller and not a caller benchmark. The tier is neither a
probability nor a ground-truth label, and absence of CTCF, cohesin or loop-anchor signal
at a position is not evidence that the boundary is false.

## Released builds and the source they come from

Pre-built applications are attached to the
[v1.0.2 release of the main repository](https://github.com/Yin-Shen/creditad/releases/tag/v1.0.2)
(the same files as v1.0.1, carried forward unchanged):

| file | platform | size (bytes) | SHA-256 |
|---|---|---|---|
| `CrediTAD-Linux.AppImage` | Linux x86_64 | 536,584,356 | `a991dc39b7477b10d28a954e513cd6b7c54e6bdea5ae8c81d000bda604120f4e` |
| `CrediTAD-Windows-Setup.exe` | Windows x64, per-user NSIS installer | 452,125,658 | `a7b162421fc6171f27a52dad658e437215e98df3d037daa2d8ac8e1726688d81` |
| `CrediTAD-Windows-1.0.1.zip` | Windows x64, portable archive | 512,613,927 | `9f5f2c2649a515d9a116ef251fd990e7a9c65c48c9766c7007cd71c247c3c57c` |

Tag `v1.0.1` of this repository is the client source of all three. Each build holds the
client in `resources/app.asar`, the same file in all three (1,475,414 bytes, SHA-256
`e120384f64ea4a65667f9c5738da1db2487b95369393bbc0e9bbd0f7036698f4`). Building this tag
as described under [Packaging](#packaging) writes a byte-identical `app.asar`. To check
the client part alone, compare the bundles:

```bash
npm ci && npx vite build                      # writes dist/ and dist-electron/
npx asar extract <path>/resources/app.asar /tmp/released_app
diff -r dist /tmp/released_app/dist && diff -r dist-electron /tmp/released_app/dist-electron
```

The rest of each build (`resources/backend`, `resources/runtime`,
`resources/example_data`) is not built from this repository; see [Packaging](#packaging).

## Requirements

Node.js and npm. The commands below were run with Node.js 22.22.2 and npm 10.9.7 on
Linux x86_64. `npm ci` installs the exact dependency tree in `package-lock.json`,
including the Electron 30.5.1 binary.

## Build and test the client

```bash
npm ci
npm run type-check      # vue-tsc over the TypeScript sources (Electron main/preload, src/main.ts)
npm run test:unit       # node --test tests/reviewExport.test.mjs
npx vite build          # renderer -> dist/, Electron main and preload -> dist-electron/
```

Three assertions in the unit suite check the backend (that it does not re-expose retired
routes). They run when the main repository's `backend/` directory is reachable, through
`CREDITAD_BACKEND_DIR` or at `../backend`, and otherwise print a skip line; the suite
still reports 8 of 8 tests passed.

## Run the client against a local backend

Start the HTTP/JSON service from a checkout of the main repository, as described in its
`REPRODUCE.md` ("Running the API server"). The Home-page demo registers the per-caller
tracks of a package only as plain `*_boundaries.bed` files, and the main repository ships
them gzipped, so give the service a copy of the packages with those files decompressed:

```bash
# in the main repository
pip install '.[server]'
mkdir -p ~/.creditad/multicell
cp -r data/multicell/. ~/.creditad/multicell/
gunzip ~/.creditad/multicell/*/*_boundaries.bed.gz
export CREDITAD_PACKAGES_DIR="$HOME/.creditad/multicell"
export CREDITAD_CHR7_DIR="$PWD/data/chr7_preview_tracks"
cd backend
TAD_DB_PATH="sqlite:///$HOME/.creditad/tad_tokens.db" CREDITAD_PORT=5001 python main.py
```

Without the decompressed copy the demo loads with no caller tracks and the client
reports "No caller BED tracks registered".

Then, in this repository:

```bash
npm run dev             # browser build of the client at http://127.0.0.1:5173
```

`npm run test:e2e` drives that page with Playwright against the running service; see
[tests/e2e/README.md](tests/e2e/README.md) for its prerequisites. A missing prerequisite
makes a script exit 2 (skipped), never 0. Run this way against release v1.0.4 of the main
repository, with `CREDITAD_BACKEND_DIR` pointing at its `backend/`, all three scripts
passed.

## Packaging

`npm run build:desktop` checks its inputs (`npm run package:preflight`), runs
`vite build` and then electron-builder, which places three staged directories next to
`app.asar`:

| input | variable | content |
|---|---|---|
| backend | `CREDITAD_PACKAGE_BACKEND` | the main repository's `backend/` with `main.py`; the files and directories in `scripts/package_excludes.json` are left out |
| runtime | `CREDITAD_PACKAGE_RUNTIME` | a Python environment directory: `python.exe` at its top level for Windows, `bin/python` for Linux |
| example data | `CREDITAD_PACKAGE_EXAMPLE_DATA` | `multicell/<CELL>_<RES>/annotation.tsv` or `.tsv.gz` for GM12878, IMR90 and HepG2 at 25 kb at least, and optionally `chr7_tracks/` |

Without the variables, the inputs are read from `package_stage/{backend,runtime,example_data}`
in this repository (ignored by git).

```bash
# Linux AppImage
export CREDITAD_PACKAGE_BACKEND=... CREDITAD_PACKAGE_RUNTIME=... CREDITAD_PACKAGE_EXAMPLE_DATA=...
CREDITAD_PACKAGE_OS=linux CREDITAD_RELEASE_DIR=release/linux npm run build:desktop -- --linux AppImage

# Windows NSIS installer (on Linux this needs wine: electron-builder runs the installer
# once to generate its uninstaller); build:win:portable and build:win:all also exist
npm run build:win
```

To package this tag exactly as it was released, stage the three directories from a
released build: they are `resources/backend`, `resources/runtime` and `resources/example_data`
inside it (an AppImage unpacks with `--appimage-extract`). The three chr7 `.mcool`
contact maps of the demo exist only there, because they exceed the main repository's
file-size limit. The Python environment in the released builds was assembled from
conda-forge with unpinned package versions, so a newly assembled runtime will not be
byte-identical to it.

## Known issues in the v1.0.1 builds

These are properties of the released v1.0.1 application, kept unchanged at tag `v1.0.1`
so that the source matches the binaries:

- The Linux AppImage does not start its bundled backend. The main process looks for the
  interpreter at `resources/runtime/python`, but the AppImage ships it at
  `resources/runtime/bin/python`, so the window opens and reports "Backend launcher not
  found". The bundled Linux runtime also lacks `cooler` and `pyBigWig`, which the backend
  imports at startup. With the AppImage, start the backend separately as described
  above; the client then connects to it on port 5001. The Windows builds ship
  `resources/runtime/python.exe` together with `cooler` and `winbbi`, so neither defect
  applies to them.
- On exit the main process stops its backend and then also terminates any process
  listening on port 5001 (and, on Windows, any process named `main.exe`).
- The client is built on Electron 30, which no longer receives security updates.

## Criteria shown by the client

| criterion | measured value | grade column |
|---|---|---|
| BD1 cross-caller support | `votes`, `supporting_callers`, `supporting_offsets_bp` | `BD1_caller_support` |
| BD2 CTCF | `ctcf`, `ctcf_fold`, `ctcf_null_pct` | `BD2_ctcf` |
| BD3 RAD21 (cohesin) | `rad21`, `rad21_fold`, `rad21_null_pct` | `BD3_rad21` |
| BD4 loop-anchor engagement (number of loop ends in the window) | `loop_anchor_count` | `BD4_loop_anchor` |

The tier is `D_tier` (D1–D5), and `not_assessable_criteria` lists the criteria whose
input was not supplied. The column definitions are in the main repository.

## Licence

MIT; see [LICENSE](LICENSE). Third-party components bundled into the application are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
