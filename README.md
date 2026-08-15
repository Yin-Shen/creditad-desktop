# creditad-desktop

Electron + Vue desktop client for **CrediTAD** — structured per-boundary evidence
records for post-calling review of TAD boundaries.

This repository holds the **desktop client source only**. The analysis engine, the
CLI and the six delivered evidence packages live in the main repository:
<https://github.com/Yin-Shen/creditad>.

## Pre-built binaries (v1.0.1)

**This repository ships source, not installers — no packaged application is committed
here.** Built applications for version 1.0.1 are distributed as assets of the
[v1.0.1 release of the main
repository](https://github.com/Yin-Shen/creditad/releases/tag/v1.0.1):

| asset | platform | what it is |
|---|---|---|
| `CrediTAD-Linux.AppImage` | Linux x86_64 | self-contained AppImage; `chmod +x` and run |
| `CrediTAD-Windows-Setup.exe` | Windows x64 | NSIS installer, per-user (no admin rights) |
| `CrediTAD-Windows-1.0.1.zip` | Windows x64 | portable archive of the same application |

Each asset carries a **published SHA-256** in those release notes; verify a download
against it before running (`sha256sum <file>`). All three are built from this source at
version 1.0.1, embed the same backend (identical SHA-256 for every shipped `.py`) and
their own Python runtime, so no separate Python installation is required.

The Linux AppImage was built and started by the authors. The Windows installer was
cross-built on Linux and confirmed to run on Windows by the authors; no Windows version
matrix was exercised.

Each build also embeds the three chr7 demo contact maps under
`resources/example_data/chr7_tracks/` — these are not in either git repository, because
they exceed the file-size policy.

## What this is, and what it is not

CrediTAD is a downstream evidence-audit workflow. It takes boundaries that some
caller already produced and attaches to each one a checkable evidence record over
four named criteria, plus a deterministic evidence tier. It is not a TAD caller, not
a caller benchmark, not a consensus method, and the tier is neither a probability nor
a ground-truth label.

## Criteria, and the paper-to-software correspondence

| paper wording | software column | what is measured |
|---|---|---|
| caller support | `caller_support` | which callers in the named panel support this position |
| CTCF evidence | `ctcf_*` | CTCF ChIP signal in the window |
| RAD21/cohesin evidence | `rad21_*` | RAD21 ChIP signal in the window |
| **loop-anchor engagement (number of loop ends in the window)** | **`loop_anchor_count`** | count of loop ends falling in the window |

The delivered column name is `loop_anchor_count` and is **not** renamed. The
manuscript phrase "loop-anchor engagement" refers to exactly this column.

Absence of CTCF, cohesin or loop-anchor signal at a position means no CTCF, cohesin
or loop-anchor support was measured at this position. It is not evidence that the
boundary is false: CTCF/cohesin looping does not account for all human TAD
boundaries.

## Build

The build embeds a Python backend and an interpreter runtime, which are **not** in
this repository — they are staged from the main repository's tree.

```bash
npm ci
export CREDITAD_PACKAGE_BACKEND=/path/to/creditad/package_stage_linux/backend
export CREDITAD_PACKAGE_RUNTIME=/path/to/creditad/package_stage_linux/runtime
export CREDITAD_PACKAGE_EXAMPLE_DATA=/path/to/creditad/package_stage_linux/example_data
export CREDITAD_PACKAGE_OS=linux CREDITAD_RELEASE_DIR=release/linux
npm run build:desktop -- --linux AppImage      # Linux AppImage
npm run build:win                              # Windows NSIS installer (needs wine on Linux)
```

`npm run package:preflight` checks the three staged inputs before any build starts and
fails with the missing path rather than producing a bundle with nothing to show.

Building the Windows **NSIS installer** on Linux requires `wine`: electron-builder runs
the freshly built installer once to generate its uninstaller. The unpacked Windows tree
and the portable zip do not need it.

## Tests

```bash
npm run test:unit     # node --test
npm run test:e2e      # prerequisites are probed; a missing one skips rather than fails
npm run type-check
```

`tests/e2e` resolves a Python via `CREDITAD_PYTHON`, then `python3`, then `python`.

## Licence

MIT — see [LICENSE](LICENSE).
