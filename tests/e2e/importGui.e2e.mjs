/**
 * F4 (b) / H1 — the Import page driven by clicking, not by API injection.
 *
 * Types a small synthetic boundary BED plus a three-file BD1 panel into the
 * real form, sets cell line / assembly / resolution through the real selects,
 * clicks "Start annotation", then clicks through to the viewer. The reference
 * is a direct annotate_from_beds() call on the same four files, run in-process
 * by the backend's own Python.
 *
 * Asserted:
 *   1. the GUI's reported tier distribution, boundary count and BD1 panel size
 *      equal the direct annotate_from_beds() result on the same input;
 *   2. the session the GUI stored carries the assembly / resolution / cell line
 *      that were selected in the form;
 *   3. the header badge and the D5–D1 tier track render for the imported
 *      session, and every tick's tier matches the backend's tier for that
 *      boundary.
 *
 * Fixtures are generated deterministically in a temp dir (fixed seed), so the
 * script depends on no data file. The Import page hardcodes output_dir
 * "./tad_results"; the files the backend writes there during the run are
 * removed afterwards so the run leaves nothing behind.
 *
 * Exit codes: 0 pass, 1 fail, 2 skipped. See lib/harness.mjs.
 */
import path from 'node:path'

import {
  API, BACKEND_DIR, FRONTEND_BASE, deepEqual, equal, launchChromium, log, ok,
  guardDir, readTierTrack, readTsv, requireBackend, requireFrontend,
  requirePython, run, runScript, watchForReload, writeBoundaryFixtures,
} from './lib/harness.mjs'

const RESOLUTION = 10000
const CELL_LINE = 'GM12878'
const ASSEMBLY = 'hg38'

runScript('importGui.e2e', async (tmp) => {
  await requireBackend()
  await requireFrontend()
  const python = requirePython()

  const fx = writeBoundaryFixtures(path.join(tmp, 'fixtures'), { resolution: RESOLUTION })

  // ── reference: the library call the GUI is supposed to be a front end for ──
  const refDir = path.join(tmp, 'reference')
  const refScript = `
import json, sys
from tad_vci.annotate_from_beds import annotate_from_beds
r = annotate_from_beds(
    ${JSON.stringify(fx.primary)},
    method_beds=${JSON.stringify(fx.panel.map((p) => [p.path, p.name]))},
    resolution=${RESOLUTION},
    cell_line=${JSON.stringify(CELL_LINE)},
    assembly=${JSON.stringify(ASSEMBLY)},
    hash_tag="e2e_reference",
    output_dir=${JSON.stringify(refDir)},
)
sys.stdout.write("REFERENCE_JSON:" + json.dumps(r))
`
  const ref = await run(python, ['-c', refScript], { cwd: BACKEND_DIR })
  if (ref.status !== 0) {
    throw new Error(`reference annotate_from_beds failed (exit ${ref.status}):\n${ref.stderr}`)
  }
  const reference = JSON.parse(ref.stdout.split('REFERENCE_JSON:')[1])
  log(`reference: n=${reference.n_boundaries} panel=${reference.bd1_panel.join(',')} dist=${JSON.stringify(reference.tier_dist)}`)

  // The Import page cannot be told where to write (output_dir "./tad_results",
  // hash_tag "sample1" are its hardcoded defaults). Delete what this run creates
  // there, and restore any same-named file the user already had.
  const cleanupTadResults = guardDir(
    path.join(BACKEND_DIR, 'tad_results'),
    ['tadvci_annotation_beds_sample1.tsv', 'tadvci_tier_beds_sample1.bed'],
    tmp,
  )

  const browser = await launchChromium()
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    page.on('dialog', async (d) => { pageErrors.push(`dialog: ${d.message()}`); await d.dismiss() })
    const assertNoReload = watchForReload(page)

    await page.goto(FRONTEND_BASE, { waitUntil: 'domcontentloaded' })

    // ── every step below is a real click / keystroke in the form ──
    await page.getByRole('button', { name: /Import your boundaries/ }).click()
    await page.waitForSelector('.import-card')

    await page.locator('input[placeholder="/data/union_boundaries.bed"]').fill(fx.primary)
    await page.locator('textarea.field-input').fill(fx.panel.map((p) => p.path).join('\n'))

    const selects = page.locator('select.field-input')
    await selects.nth(0).selectOption(CELL_LINE)
    await selects.nth(1).selectOption(ASSEMBLY)
    await page.locator('input[type="number"]').first().fill(String(RESOLUTION))

    const preview = (await page.locator('.preview-box').innerText()).replace(/\s+/g, ' ')
    ok(preview.includes(`BD1 · n_methods = ${fx.panel.length}`),
      `form preview announces the ${fx.panel.length}-method panel; got "${preview}"`)
    ok(preview.includes('BD2 CTCF · not_assessable'),
      'no ChIP supplied -> preview says BD2 not_assessable (never silently borrowed from the demo)')

    await page.getByRole('button', { name: 'Start annotation' }).click()
    await page.waitForSelector('.log-card')
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.log-line'))
        .some((l) => l.textContent.includes('Tier dist:')),
      null, { timeout: 300000 })

    const logs = (await page.locator('.log-line').allTextContents()).map((l) => l.trim())
    const find = (needle) => logs.find((l) => l.includes(needle)) || ''

    // ── 1. GUI result vs direct annotate_from_beds ──
    const distLine = find('Tier dist:')
    const guiDist = JSON.parse(distLine.slice(distLine.indexOf('{')))
    deepEqual(guiDist, reference.tier_dist,
      'tier distribution from the GUI equals annotate_from_beds on the same BEDs')

    const annotatedLine = find('Annotated ')
    const nBoundaries = Number(/Annotated (\d+) boundaries/.exec(annotatedLine)?.[1])
    equal(nBoundaries, reference.n_boundaries, 'boundary count reported by the GUI')
    const nMethods = Number(/n_methods=(\d+)/.exec(annotatedLine)?.[1])
    equal(nMethods, reference.n_methods, 'BD1 panel size reported by the GUI')
    const assessedLine = find('Assessed:')
    ok(/Assessed: BD1\s*$/.test(assessedLine),
      `GUI reports BD1 only — no ChIP was supplied, so BD2–BD4 must not appear; got "${assessedLine}"`)
    log(`GUI:       n=${nBoundaries} n_methods=${nMethods} dist=${JSON.stringify(guiDist)}`)

    await page.getByRole('button', { name: /Go to Visualization/ }).click()

    // ── 3. viewer renders the imported session ──
    await page.waitForSelector('.vci-svg rect.bnd', { timeout: 120000 })
    const badge = (await page.textContent('header .font-mono')).trim()
    equal(badge, `${ASSEMBLY} · ${RESOLUTION / 1000}kb`, 'header badge for the imported session')

    // ── 2. session provenance is what the form said ──
    const fvo = JSON.parse(await page.evaluate(() => localStorage.getItem('creditad_fvo')))
    equal(fvo.assembly, ASSEMBLY, 'session assembly')
    equal(Number(fvo.resolution), RESOLUTION, 'session resolution')
    equal(fvo.cell_line, CELL_LINE, 'session cell line')
    equal(fvo.source, `annotate:${fx.primary}`, 'session records the primary BED as its source')
    equal(fvo.bed_tokens.length, 1 + fx.panel.length, 'primary + panel BEDs registered as tracks')

    assertNoReload()
    const { chrom, titles } = await readTierTrack(page)
    ok(titles.length > 0, 'tier track drew at least one tick for the imported session')

    const token = fvo.annotation_token
    const served = await (await fetch(`${API}/tadvci/imported/${encodeURIComponent(token)}/${chrom}`)).json()
    const byId = new Map((served.boundaries || []).map((b) => [b.boundary_id, b.auto_tier]))
    ok(byId.size > 0, `backend serves imported tiers for chr${chrom}`)

    // Per-boundary, not just the distribution: the tier the API serves for the
    // GUI's session must be the tier annotate_from_beds computed for that
    // position in the reference run.
    const refTable = readTsv(path.join(refDir, 'tadvci_annotation_beds_e2e_reference.tsv'))
    equal(refTable.rows.length, reference.n_boundaries, 'reference table row count')
    // annotate_from_beds normalises chromosome names (chr20 -> 20); compare on the
    // bare name so the check does not depend on which spelling the input used.
    const bare = (id) => String(id).replace(/^chr/i, '')
    const refTier = new Map(refTable.rows.map((r) => [`${bare(r.chrom)}:${r.pos}`, r.D_tier]))
    let compared = 0
    for (const [id, tier] of byId) {
      const key = bare(id)
      ok(refTier.has(key), `served boundary ${id} exists in the reference table`)
      equal(tier, refTier.get(key), `served tier for ${id} equals the reference tier`)
      compared += 1
    }
    ok(compared > 0, 'compared at least one served boundary against the reference table')

    for (const title of titles) {
      const [id, tier] = title.split(' · ')
      ok(byId.has(id), `rendered tick ${id} exists in the imported tier table`)
      equal(tier, byId.get(id), `rendered tier for ${id}`)
    }
    log(`viewer:    badge "${badge}", ${titles.length} ticks on chr${chrom}, ${compared} tiers matched to the reference table`)

    assertNoReload()
    deepEqual(pageErrors, [], 'no uncaught page errors or alert dialogs during the import')
    await context.close()
  } finally {
    await browser.close()
    const { removed, restored } = cleanupTadResults()
    if (removed.length) log(`cleanup:   removed from backend/tad_results: ${removed.join(', ')}`)
    if (restored.length) log(`cleanup:   restored pre-existing: ${restored.join(', ')}`)
  }
})
