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

### Client version 1.0.2: Linux AppImage only

Version 1.0.2 of this client changes the Linux AppImage; the two Windows files above
remain the Windows builds. Relative to v1.0.1:

- The main process finds the interpreter of a Linux runtime at
  `resources/runtime/bin/python` (and still accepts `resources/runtime/python`), so the
  AppImage starts its bundled backend. On Windows it still uses
  `resources/runtime/python.exe`.
- The Linux runtime is built by `scripts/build_linux_runtime.sh` from two pinned lists
  in `scripts/linux-runtime/`: the 128 conda-forge builds of the v1.0.1 runtime, and
  hash-pinned PyPI files for `cooler` 0.10.4, `pyBigWig` 0.3.25 and the rest of
  `cooler`'s dependencies, which the v1.0.1 runtime lacked.
- Outside Windows the bundled interpreter runs with `PYTHONNOUSERSITE=1`, so packages in
  the user's `~/.local` are not imported; review records are written to
  `<userData>/records` (the AppImage mounts `resources/` read-only, and recording a review
  failed there); and the exit cleanup stops only the process listening on port 5001
  instead of every process connected to it.
- Backup files (`*.bak_*`, `*.before_*`) and the backend's `requirements.lock.txt` are
  left out of the package, and `package.json` declares `"license": "MIT"`.

These changes alter `package.json` and the main-process bundle, so a 1.0.2 build writes
an `app.asar` that differs from the v1.0.1 file above.

The 1.0.2 AppImage is built from tag `v1.0.2` of this repository with the backend of
release v1.0.5 of the main repository (tag `v1.0.5`, commit `ec9a85e`; this backend grades
a chromosome that a ChIP track lists without data as `not_assessable`), and is attached to
that release:

| file | platform | size (bytes) | SHA-256 |
|---|---|---|---|
| `CrediTAD-Linux.AppImage` (client 1.0.2, backend v1.0.5) | Linux x86_64 | 540,753,908 | `63d2cfbd637ab1e1083b7a2d313aac23697fe451ed3f347836e69a715c938ba3` |

Its `resources/app.asar` is 1,475,995 bytes with SHA-256
`5bd7697596b0b983521db91d385bcd9bfaaa3d9f5afe0cff2eaefe8e58c02359`; two independent
builds of this source wrote the same file. The AppImage itself is not byte-reproducible
(two builds with identical contents differ in their image hash).

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
tracks of a package only as plain `*_boundaries.bed` files in releases v1.0.4 and earlier
of the main repository, which ship them gzipped; with those releases give the service a
copy of the packages with those files decompressed (from v1.0.5 the gzipped files are
read as shipped and this step is not needed):

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

With v1.0.4 or earlier and without the decompressed copy, the demo loads with no caller
tracks and the client reports "No caller BED tracks registered".

Then, in this repository:

```bash
npm run dev             # browser build of the client at http://127.0.0.1:5173
```

`npm run test:e2e` drives that page with Playwright against the running service; see
[tests/e2e/README.md](tests/e2e/README.md) for its prerequisites. A missing prerequisite
makes a script exit 2 (skipped), never 0. Run against the backend of release v1.0.5 of the
main repository as bundled in the 1.0.2 AppImage (mounted read-only, as the AppImage runtime
mounts it), with `CREDITAD_BACKEND_DIR` pointing at that `backend/`, all three scripts
passed.

## Packaging

`npm run build:desktop` checks its inputs (`npm run package:preflight`), runs
`vite build` and then electron-builder, which places three staged directories next to
`app.asar`:

| input | variable | content |
|---|---|---|
| backend | `CREDITAD_PACKAGE_BACKEND` | the main repository's `backend/` with `main.py`; the files and directories in `scripts/package_excludes.json` are left out |
| runtime | `CREDITAD_PACKAGE_RUNTIME` | a Python environment directory: `python.exe` at its top level for Windows; for Linux the output of `scripts/build_linux_runtime.sh` (`bin/python`) |
| example data | `CREDITAD_PACKAGE_EXAMPLE_DATA` | `multicell/<CELL>_<RES>/annotation.tsv` or `.tsv.gz` for GM12878, IMR90 and HepG2 at 25 kb at least, and optionally `chr7_tracks/` |

Without the variables, the inputs are read from `package_stage/{backend,runtime,example_data}`
in this repository (ignored by git).

```bash
# Windows NSIS installer (on Linux this needs wine: electron-builder runs the installer
# once to generate its uninstaller); build:win:portable and build:win:all also exist
npm run build:win
```

`CREDITAD_PACKAGE_OS` (`linux`, or unset for Windows) chooses which files of the runtime
are left out, and the two rule sets are not interchangeable; the configuration refuses a
value that does not match the layout of the staged runtime.

### Linux AppImage

Three steps, each writing into a new directory. The first needs conda 23.10 or later on
`PATH` and network access to conda-forge and PyPI; the second reads a clone of the main
repository with `git archive` and changes nothing in it.

```bash
# 1. Python runtime from the pinned lists in scripts/linux-runtime/
scripts/build_linux_runtime.sh /path/to/stage/runtime

# 2. backend/ and example_data/ from a tag of the main repository
scripts/stage_linux_package.sh --repo /path/to/creditad --tag v1.0.5 \
  --released-resources /path/to/linux-unpacked/resources --out /path/to/stage/v1.0.5

# 3. the AppImage
export CREDITAD_PACKAGE_RUNTIME=/path/to/stage/runtime \
       CREDITAD_PACKAGE_BACKEND=/path/to/stage/v1.0.5/backend \
       CREDITAD_PACKAGE_EXAMPLE_DATA=/path/to/stage/v1.0.5/example_data
CREDITAD_PACKAGE_OS=linux CREDITAD_RELEASE_DIR=release/linux npm run build:desktop -- --linux AppImage
```

`build_linux_runtime.sh` builds the environment at `/tmp/creditad-linux-runtime` and then
copies it, because conda writes the install prefix into scripts and some binaries. It
writes the versions, licences and hashes of everything it installed to
`<runtime>.manifest/`, and the licence files of the conda packages to
`share/licenses/conda/` inside the runtime.

`stage_linux_package.sh` lays the files out as in the v1.0.1 package and writes
`STAGE_MANIFEST.tsv` (size, SHA-256 and source of every file). `--released-resources` is
`resources/` of a released Linux build (`linux-unpacked/resources`, or
`squashfs-root/resources` after `CrediTAD-Linux.AppImage --appimage-extract`); it supplies
the files the main repository does not hold: the three chr7 `.mcool` contact maps, which
exceed the main repository's file-size limit, the gap masks and `labels.json` of
`backend/extra_mode/`, `example_data/README.md` and `multicell/index.json`. The main
repository ships the caller tracks as `*_boundaries.bed.gz`; the script stages them
decompressed, because the Home-page demo registers only plain `*_boundaries.bed` files.

To repackage tag `v1.0.1` exactly as it was released, stage the three directories from a
released v1.0.1 build: they are `resources/backend`, `resources/runtime` and
`resources/example_data` inside it (an AppImage unpacks with `--appimage-extract`). The
Windows runtime was assembled from conda-forge with unpinned package versions and is not
reproducible from this repository.

## Known issues

Fixed in 1.0.2 for Linux: the v1.0.1 AppImage did not start its bundled backend. Its main
process looked for the interpreter at `resources/runtime/python` while the AppImage ships
`resources/runtime/bin/python`, so the window opened and reported "Backend launcher not
found"; and its runtime lacked `cooler` and `pyBigWig`, which the backend imports at
startup. The Windows builds ship `resources/runtime/python.exe` together with `cooler` and
`winbbi`, so neither defect applies to them.

Fixed by the v1.0.5 backend bundled in the 1.0.2 AppImage: the Import page failed with
"output_dir cannot be created: Read-only file system", because it asks the backend to
write its results to `./tad_results`, which resolves inside the read-only
`resources/backend/`. A relative results directory now goes under the per-user data
directory (`$XDG_DATA_HOME/CrediTAD`, by default `~/.local/share/CrediTAD`) when the
backend directory is not writable.

Still present:

- The Windows builds are client 1.0.1 and embed the backend of release v1.0.1 of the main
  repository, which reads a gzip-compressed loop file as empty without reporting it, so
  every boundary is graded BD4 `none`. Decompress loop files before loading them there.
- The AppImage needs FUSE 2 (`libfuse.so.2`) to mount itself. Without it, start it with
  `--appimage-extract-and-run`, or unpack it with `--appimage-extract` and start
  `squashfs-root/CrediTAD`.
- Where unprivileged user namespaces are restricted
  (`kernel.apparmor_restrict_unprivileged_userns=1`, as on the Ubuntu 26.04 host this
  was observed on), Electron's sandbox cannot start inside an AppImage and the app
  aborts unless it is started with `--no-sandbox`.
- On exit the main process stops its backend and then also terminates whatever process
  is listening on port 5001 (and, on Windows, any process named `main.exe`).
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
