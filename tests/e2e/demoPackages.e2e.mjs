/**
 * F4 (a) — demo packages through the real Home-page picker.
 *
 * Loads at least two of the six shipped demo packages by *clicking* the picker
 * (cell-line pill -> resolution pill -> "Load ... demo"), then asserts that
 *
 *   1. the picker's own summary line agrees with the package manifest
 *      (/api/tadvci/multicell_datasets) on assembly and candidate count;
 *   2. the header data badge reads "<assembly> · <resolution>kb" for that
 *      package — this is the regression guard for the old hardcoded
 *      "hg19 · 10kb" badge and for loading an hg38 package under an hg19 label;
 *   3. the session the page stored carries the manifest's assembly/resolution/
 *      cell line, so the review record cannot be signed against the wrong build;
 *   4. the D5–D1 tier track actually rendered, and every tick it drew carries
 *      the tier the backend serves for that boundary on that chromosome.
 *
 * Which packages are exercised: CREDITAD_E2E_PACKAGES="GM12878:25000,IMR90:10000"
 * or "all" for the full six. Default is the two below.
 *
 * Exit codes: 0 pass, 1 fail, 2 skipped. See lib/harness.mjs.
 */
import {
  API, FRONTEND_BASE, deepEqual, equal, launchChromium, log, ok, readTierTrack,
  requireBackend, requireFrontend, runScript, skip, watchForReload,
} from './lib/harness.mjs'

const DEFAULT_PACKAGES = [
  { cell: 'GM12878', resolution: 25000 },
  { cell: 'IMR90', resolution: 10000 },
]

function wantedPackages(manifest) {
  const spec = (process.env.CREDITAD_E2E_PACKAGES || '').trim()
  if (spec.toLowerCase() === 'all') {
    return manifest.map((d) => ({ cell: d.cell_line, resolution: Number(d.resolution) }))
  }
  if (!spec) return DEFAULT_PACKAGES
  return spec.split(',').map((part) => {
    const [cell, res] = part.split(':')
    return { cell: cell.trim(), resolution: Number(res) }
  })
}

const kb = (bp) => `${bp / 1000}kb`

runScript('demoPackages.e2e', async () => {
  const manifest = await requireBackend()
  await requireFrontend()

  const wanted = wantedPackages(manifest)
  const available = wanted.filter((w) =>
    manifest.some((d) => d.cell_line === w.cell && Number(d.resolution) === w.resolution))
  if (available.length < 2) {
    skip(
      `need at least two demo packages, backend offers ${manifest.length} ` +
      `(${manifest.map((d) => `${d.cell_line}:${d.resolution}`).join(', ') || 'none'}). ` +
      'Check example_data/multicell/.',
    )
  }

  const browser = await launchChromium()
  try {
    for (const want of available) {
      const meta = manifest.find(
        (d) => d.cell_line === want.cell && Number(d.resolution) === want.resolution)
      log(`\n── ${meta.cell_line} ${kb(meta.resolution)} (${meta.assembly}) ──`)

      // Fresh context per package: no localStorage carried over from the previous load,
      // so a stale session cannot make the next package look like it loaded.
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
      const page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e)))
      page.on('dialog', async (d) => { pageErrors.push(`dialog: ${d.message()}`); await d.dismiss() })
      const assertNoReload = watchForReload(page)

      await page.goto(FRONTEND_BASE, { waitUntil: 'domcontentloaded' })

      // --- click the picker, do not touch the store or the API directly ---
      await page.getByRole('button', { name: meta.cell_line, exact: true }).click()
      await page.getByRole('button', { name: kb(meta.resolution).replace('kb', ' kb'), exact: true }).click()

      const summary = (await page.locator('.card').nth(1).innerText()).replace(/\s+/g, ' ')
      ok(summary.includes(meta.assembly),
        `picker summary states the manifest assembly ${meta.assembly}; got "${summary.slice(0, 200)}"`)
      ok(summary.includes(meta.n_candidates.toLocaleString('en-US')),
        `picker summary states the manifest candidate count ${meta.n_candidates}`)

      const loadLabel = new RegExp(`^Load ${meta.cell_line} ${kb(meta.resolution).replace('kb', ' kb')} demo$`)
      await page.getByRole('button', { name: loadLabel }).click()

      // --- the tier track must actually paint ---
      await page.waitForSelector('.vci-svg rect.bnd', { timeout: 120000 })

      // --- 2. header assembly · resolution badge ---
      const badge = (await page.textContent('header .font-mono')).trim()
      equal(badge, `${meta.assembly} · ${kb(meta.resolution)}`,
        `header badge for ${meta.cell_line} ${kb(meta.resolution)}`)

      // --- 3. stored session provenance ---
      const fvo = JSON.parse(await page.evaluate(() => localStorage.getItem('creditad_fvo')))
      equal(fvo.assembly, meta.assembly, 'session assembly')
      equal(Number(fvo.resolution), meta.resolution, 'session resolution')
      equal(fvo.cell_line, meta.cell_line, 'session cell line')
      ok(Array.isArray(fvo.bed_tokens) && fvo.bed_tokens.length > 0,
        'session registered caller BED tracks')

      // --- 3b. the initial viewport must be one the chromosome can support ---
      // A track that mounts before the panel has laid out used to publish
      // bpPerPx = chromosomeLength / 1 (canvas.width == 1), which collapsed every row in
      // the browser into a single vertical bar. It depended on layout timing, so it only
      // struck sometimes; this pins the observable consequence.
      const view = await page.evaluate(() => {
        const chip = document.querySelector('.region-chip')
        if (!chip) return null
        const m = chip.textContent.replace(/,/g, '').match(/chr(\w+):(\d+)[^\d]+(\d+)/)
        return m ? { chrom: m[1], start: Number(m[2]), end: Number(m[3]) } : null
      })
      ok(view, 'the viewer reports a visible region')
      const spanBp = view.end - view.start
      const chromLen = Number(
        (fvo.chromosomes || []).find?.((c) => String(c.name) === String(view.chrom))?.length || 0)
      ok(spanBp > 0, `visible span is positive (got ${spanBp})`)
      ok(spanBp >= 10_000,
        `visible span is not collapsed to a sliver — ${spanBp} bp across the panel`)
      if (chromLen) {
        ok(spanBp <= chromLen * 1.5,
          `visible span ${spanBp} bp fits chr${view.chrom} (${chromLen} bp)`)
      }

      // --- 4. rendered ticks vs the tier the backend serves ---
      assertNoReload()
      const { chrom, titles } = await readTierTrack(page)
      ok(titles.length > 0, 'tier track drew at least one tick')

      const token = fvo.annotation_token || fvo.hic_token
      ok(Boolean(token), 'session has an annotation token')
      const res = await fetch(`${API}/tadvci/imported/${encodeURIComponent(token)}/${chrom}`)
      ok(res.ok, `/api/tadvci/imported/${token}/${chrom} -> HTTP ${res.status}`)
      const served = await res.json()
      const byId = new Map((served.boundaries || []).map((b) => [b.boundary_id, b.auto_tier]))
      ok(byId.size > 0, `backend serves tiers for chr${chrom}`)

      const tiers = new Set()
      for (const title of titles) {
        const [id, tier] = title.split(' · ')
        ok(byId.has(id), `rendered tick ${id} exists in the backend tier table for chr${chrom}`)
        equal(tier, byId.get(id), `rendered tier for ${id}`)
        tiers.add(tier)
      }
      ok([...tiers].every((t) => /^D[1-5]$/.test(t)),
        `rendered tiers are D1–D5; got ${[...tiers].join(',')}`)
      log(`   badge "${badge}", ${titles.length} ticks on chr${chrom}, tiers ${[...tiers].sort().join(',')}`)

      assertNoReload()
      deepEqual(pageErrors, [], 'no uncaught page errors or alert dialogs during the load')
      await context.close()
    }
  } finally {
    await browser.close()
  }
})
