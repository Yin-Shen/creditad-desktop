# End-to-end tests

Browser-level checks that drive the real UI with real clicks against a running
backend. They exist because the demo-package load, the Import form and the
CLI/API agreement were previously only ever verified by hand.

| script | covers |
|---|---|
| `cliApiParity.e2e.mjs` | `python -m tad_vci.cli annotate` and `POST /api/tadvci/annotate` on identical inputs must produce identical `votes`, `n_methods_effective`, `BD1_caller_support`, `D_tier`, `vote_tol_bp` (two resolutions) |
| `demoPackages.e2e.mjs` | two of the six demo packages loaded through the Home-page picker; header badge `<assembly> · <res>kb` matches the package manifest; every tier tick drawn matches the tier the backend serves |
| `importGui.e2e.mjs` | the Import page driven by typing and clicking with a small BED + 3-file BD1 panel; resulting tier distribution and per-boundary tiers equal a direct `annotate_from_beds()` call on the same files |

## Running

```bash
# from frontend/
npm run test:unit          # node unit tests, no services needed
npm run test:e2e           # all three scripts
npm run test:e2e -- demoPackages     # one script (prefix match)
node tests/e2e/importGui.e2e.mjs     # or run a script directly
```

Prerequisites (each is probed; a missing one skips rather than fails):

- backend on `http://127.0.0.1:5001` (`CREDITAD_E2E_BACKEND` to override)
- vite dev server on `http://127.0.0.1:5173` (`CREDITAD_E2E_FRONTEND` to override)
- a Playwright install with a downloaded chromium — auto-discovered from
  `NODE_PATH`, `frontend/node_modules`, and `~/.npm/_npx/*/node_modules`;
  `CREDITAD_PLAYWRIGHT_DIR` points at a specific `node_modules` directory
- a Python that can `import tad_vci` from `backend/` — tries
  `CREDITAD_PYTHON`, then `python3`, then `python`

## Exit codes

| code | meaning |
|---|---|
| 0 | pass |
| 1 | an assertion failed |
| 2 | skipped: a prerequisite was missing, so the run proved nothing |

Skips are **not** exit 0 on purpose. A suite that could not reach the backend
must not look green.

Two runtime conditions also produce a skip rather than a failure, because they
invalidate the run without saying anything about the product: the vite dev
server reloading the page mid-run (HMR, i.e. someone edited a watched file),
and the tier track never settling to a stable tick count.

## Where output goes

Every script works in `mkdtemp()` under the OS temp dir and removes it on
success (`CREDITAD_E2E_KEEP=1` keeps it; a failing run always keeps it and
prints the path). Fixture BEDs are generated in-process from a fixed seed, so
no script depends on a data file that might be absent on another host.

One exception is out of the test's hands: the Import page hardcodes
`output_dir: "./tad_results"`, so the backend writes its evidence table there
during `importGui.e2e.mjs`. That script snapshots the directory first, deletes
the files the run created, and restores any same-named file that already
existed.

## Other environment variables

- `CREDITAD_E2E_PACKAGES` — which demo packages `demoPackages.e2e.mjs` loads,
  e.g. `GM12878:25000,HepG2:10000`, or `all` for all six. Default is
  `GM12878:25000,IMR90:10000`.
