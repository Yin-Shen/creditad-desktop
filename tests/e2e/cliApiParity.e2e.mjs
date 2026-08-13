/**
 * H4 — CLI and HTTP API must grade identical inputs identically.
 *
 * The same four BED files go through
 *   python -m tad_vci.cli annotate ...        (scripted path)
 *   POST /api/tadvci/annotate                 (the path the GUI uses)
 * and the two evidence tables are compared row by row on the fields that decide
 * what a reviewer sees:
 *
 *   votes, n_methods_effective, BD1_caller_support, D_tier, vote_tol_bp
 *
 * vote_tol_bp is in the list on purpose: the two entry points once disagreed on
 * the BD1 matching tolerance (the API used a hardcoded 50 kb while the CLI used
 * 2 x resolution), which silently changed votes and therefore tiers at 10 kb.
 * This test is the regression guard for that class of drift, not just for the
 * tier column.
 *
 * Both runs write into a temp dir. Nothing is written into the repository.
 *
 * Exit codes: 0 pass, 1 fail, 2 skipped. See lib/harness.mjs.
 */
import fs from 'node:fs'
import path from 'node:path'

import {
  API, BACKEND_DIR, deepEqual, equal, log, ok, postJson, readTsv,
  requireBackend, requirePython, run, runScript, writeBoundaryFixtures,
} from './lib/harness.mjs'

const PARITY_COLUMNS = ['votes', 'n_methods_effective', 'BD1_caller_support', 'D_tier', 'vote_tol_bp']

// Two resolutions: the tolerance is derived from the resolution, so a single
// resolution would not have caught the original CLI/API divergence.
const CASES = [
  { resolution: 25000, cell_line: 'GM12878', assembly: 'hg38' },
  { resolution: 10000, cell_line: 'GM12878', assembly: 'hg38' },
]

runScript('cliApiParity.e2e', async (tmp) => {
  await requireBackend()
  const python = requirePython()

  for (const kase of CASES) {
    const tag = `res${kase.resolution}`
    log(`\n── ${kase.resolution} bp ──`)
    const fx = writeBoundaryFixtures(path.join(tmp, tag, 'fixtures'), { resolution: kase.resolution })
    const cliOut = path.join(tmp, tag, 'cli')
    const apiOut = path.join(tmp, tag, 'api')

    // ── scripted path ──
    const args = [
      '-m', 'tad_vci.cli', 'annotate',
      '--boundaries', fx.primary,
      ...fx.panel.flatMap((p) => ['--panel', `${p.name}=${p.path}`]),
      '--resolution', String(kase.resolution),
      '--cell-line', kase.cell_line,
      '--assembly', kase.assembly,
      '--out', cliOut,
      '--tag', 'parity',
      '--json',
    ]
    const cli = await run(python, args, { cwd: BACKEND_DIR })
    if (cli.status !== 0) {
      throw new Error(`python -m tad_vci.cli annotate exited ${cli.status}\n${cli.stderr}\n${cli.stdout}`)
    }
    const cliResult = JSON.parse(lastJsonObject(cli.stdout))

    // ── HTTP path ──
    const api = await postJson(`${API}/tadvci/annotate`, {
      primary_bed: fx.primary,
      primary_name: 'primary',
      method_beds: fx.panel.map((p) => ({ path: p.path, name: p.name })),
      ctcf_bw: null,
      rad21_bw: null,
      loops_path: null,
      cell_line: kase.cell_line,
      assembly: kase.assembly,
      resolution: kase.resolution,
      hash_tag: 'parity',
      output_dir: apiOut,
    })
    ok(api.ok, `POST /api/tadvci/annotate -> HTTP ${api.status}: ${api.text.slice(0, 300)}`)

    // ── summaries ──
    equal(api.json.n_boundaries, cliResult.n_boundaries, 'n_boundaries (CLI vs API)')
    equal(api.json.n_methods, cliResult.n_methods, 'n_methods (CLI vs API)')
    deepEqual(api.json.bd1_panel, cliResult.bd1_panel, 'bd1_panel (CLI vs API)')
    deepEqual(api.json.tier_dist, cliResult.tier_dist, 'tier_dist (CLI vs API)')

    // ── row-by-row evidence tables ──
    const cliTable = readTsv(cliResult.TADVCI_annotation)
    ok(fs.existsSync(api.json.TADVCI_annotation),
      `API wrote its evidence table to ${api.json.TADVCI_annotation}`)
    ok(api.json.TADVCI_annotation.startsWith(apiOut),
      'API honoured the requested output_dir (nothing written into the repo)')
    const apiTable = readTsv(api.json.TADVCI_annotation)

    equal(apiTable.rows.length, cliTable.rows.length, 'row count')
    ok(cliTable.rows.length > 0, 'the fixture produced graded boundaries')
    for (const col of [...PARITY_COLUMNS, 'chrom', 'pos']) {
      ok(cliTable.columns.includes(col), `CLI table has column ${col}`)
      ok(apiTable.columns.includes(col), `API table has column ${col}`)
    }

    for (let i = 0; i < cliTable.rows.length; i++) {
      const a = cliTable.rows[i]
      const b = apiTable.rows[i]
      equal(`${b.chrom}:${b.pos}`, `${a.chrom}:${a.pos}`, `row ${i} position`)
      for (const col of PARITY_COLUMNS) {
        equal(b[col], a[col], `row ${i} (${a.chrom}:${a.pos}) column ${col}`)
      }
    }

    // The tolerance must be the derived one, not a leftover constant.
    // 1 x resolution since 2026-07-29 (was 2 x); see docs/MEASURED_LIMITATIONS.md §11.
    const tol = Number(cliTable.rows[0].vote_tol_bp)
    equal(tol, kase.resolution * 1,
      'vote_tol_bp is derived from the resolution (1 x resolution) in both entry points')
    // BD4's proximity window is its own parameter and must NOT scale with the resolution.
    const loopWin = Number(cliTable.rows[0].loop_window_bp)
    equal(loopWin, 50000,
      'loop_window_bp is a fixed 50 kb, independent of the vote tolerance')

    log(`   ${cliTable.rows.length} rows identical on ${PARITY_COLUMNS.join(', ')}; vote_tol_bp=${tol}`)
  }
})

/**
 * The CLI prints a progress line before its --json payload, and that line
 * contains braces of its own, so take the last top-level JSON object.
 */
function lastJsonObject(stdout) {
  const lines = stdout.split('\n')
  const start = lines.lastIndexOf('{')
  if (start === -1) throw new Error(`no JSON object in CLI stdout:\n${stdout}`)
  return lines.slice(start).join('\n')
}
