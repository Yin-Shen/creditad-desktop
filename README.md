# creditad-desktop — CrediTAD desktop client (Electron + Vue 3)

Desktop front end for **CrediTAD**, the per-boundary evidence-audit workflow for
already-called Hi-C TAD boundaries. The scientific engine, the `creditad` CLI and the
HTTP/JSON API server live in the main repository: <https://github.com/Yin-Shen/creditad>.
This repository is the client only — it calls that API and renders the result.

**This repository contains source, not installers.** No `node_modules/`, no build output
and no packaged application is committed here.

## Build

```bash
npm ci            # exact dependency tree from package-lock.json
npm run build     # vite build + electron-builder
```

`npm run build` also needs a staged backend, an embedded Python runtime and the example
data (see `electron-builder.config.cjs` and `scripts/package-preflight.cjs`); the preflight
step names any input that is missing. To develop against a running backend instead, start
the API server from the main repository and run `npm run dev`.

## Tests

```bash
node --test tests/reviewExport.test.mjs      # 8 tests, no dependencies required
CREDITAD_BACKEND_DIR=/path/to/creditad/backend node --test tests/reviewExport.test.mjs
```

Three assertions in that suite are a contract on the **backend** (it must not re-expose the
retired consensus/tadshop routes). They run when the backend tree is reachable — set
`CREDITAD_BACKEND_DIR`, or check both repositories out side by side — and are skipped with
a printed reason when it is not.

---

# CrediTAD frontend

Vue 3 + Vite frontend for the local CrediTAD post-calling evidence-card
prototype. The active interface visualizes Hi-C and boundary tracks, runs the
five-method caller panel through the backend, displays named BD1–BD4 evidence
fields and D1–D5 evidence tiers, and records optional local review decisions.

The Home page exposes one canonical built-in genome-wide view, GM12878. User
imports remain available for compatible Hi-C matrices, boundary BEDs and
optional signal/loop tracks. The import form requires an explicit genome
assembly so a user dataset is never assigned an assembly from its cell-line
label.

The retired BoundaryNet/BCP, conformal routing and active-learning claims are
not part of the active scientific workflow. The backend does not register the
legacy `/api/deeptad/*` routes, and the active TAD pipeline rejects BCP
activation. Do not use historical model metrics or checkpoints as evidence.
The active renderer has no legacy boundary-prediction/probability overlay.

The Local Reviews page exports only versioned local review assertions. JSON
and BED export is fail-closed unless the active application context supplies
assembly, cell, resolution and source, and every record's embedded context
matches it. Because the backend record schema does not contain the input source,
the frontend stores a local source binding keyed by each record checksum; a
missing or mismatched binding blocks export. No hg19 or 25 kb export fallback is
used.

## Development

From the repository root, start the backend in one terminal:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[app]'
python backend/main.py
```

Then start the frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend is served at `http://127.0.0.1:5173`; the backend listens on
`http://127.0.0.1:5001`.

## Verification

```bash
node --test tests/reviewExport.test.mjs
npm run type-check
npx vite build
```

See the repository [README](../README.md) and [user guide](../USER_GUIDE.md)
for the current scope, data formats, API surface and audit limitations. Built-in
cell views are audit-server conveniences and remain fail-closed unless a complete
manifest-gated ICE-v2 annotation exists. Desktop packaging excludes research
analysis archives and does not promise those server-local built-ins; users can
import their own compatible matrices and tracks.

## License

MIT; see [LICENSE](../LICENSE).
