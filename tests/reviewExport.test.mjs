import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  attachReviewRecordSources,
  bindReviewRecordSource,
  buildReviewAssertionsBED,
  buildReviewAssertionsJSON,
  resolveReviewExportContext,
  selectRecordsForContext,
  validateReviewRecordsForContext,
} from '../src/utils/reviewExport.js'

const fixtureContext = {
  assembly: 'hg38',
  cell: 'K562',
  resolution: 10000,
  source: '/data/k562.mcool',
}

const fixtureRecord = {
  boundary_id: 'chr7:50000',
  auto_tier: 'D3',
  final_tier: 'D4',
  review_decision: {
    verdict: 'supported_for_review',
    rationale: 'local visual review',
  },
  actor_label: 'reviewer_1',
  created_at: '2026-07-11T00:00:00Z',
  version: 2,
  content_hash: 'abc123',
  assembly: 'hg38',
  cell_line: 'K562',
  resolution: 10000,
  source: '/data/k562.mcool',
  evidence: { BD1: 'moderate' },
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test('review context is fail-closed and never invents assembly or resolution', () => {
  const state = resolveReviewExportContext({
    cell_line: 'GM12878',
    mcoolPath: '/data/gm.mcool',
  })
  assert.equal(state.ready, false)
  assert.deepEqual(state.missing, ['assembly', 'resolution'])
  assert.equal(state.context.assembly, null)
  assert.equal(state.context.resolution, null)
  assert.equal(state.context.source, '/data/gm.mcool')
})

test('JSON exports local assertions with complete active dataset provenance', () => {
  const payload = buildReviewAssertionsJSON(
    [fixtureRecord],
    fixtureContext,
    '2026-07-11T01:02:03Z',
  )
  assert.equal(payload.format, 'creditad-local-review-assertions/v1')
  assert.deepEqual(payload.context, fixtureContext)
  assert.equal(payload.assertions[0].local_review_assertion, 'supported_for_review')
  assert.equal(payload.assertions[0].assembly, 'hg38')
  assert.equal(payload.assertions[0].cell, 'K562')
  assert.equal(payload.assertions[0].resolution, 10000)
  assert.equal(payload.assertions[0].source, '/data/k562.mcool')
  assert.equal('label' in payload.assertions[0], false)
})

test('BED metadata and interval width come from the active context', () => {
  const bed = buildReviewAssertionsBED([fixtureRecord], fixtureContext)
  assert.match(bed, /^# CrediTAD local review assertions/m)
  assert.match(bed, /^# assembly=hg38$/m)
  assert.match(bed, /^# cell=K562$/m)
  assert.match(bed, /^# resolution=10000$/m)
  assert.match(bed, /^# source=\/data\/k562\.mcool$/m)
  assert.match(bed, /^chr7\t50000\t60000\tsupported_for_review\|D4\|v2\|abc123$/m)
})

test('record/context mismatches block export instead of relabelling records', () => {
  const mismatched = { ...fixtureRecord, assembly: 'hg19' }
  const issues = validateReviewRecordsForContext([mismatched], fixtureContext)
  assert.match(issues[0], /record assembly hg19 != current hg38/)
  assert.throws(
    () => buildReviewAssertionsJSON([mismatched], fixtureContext),
    /Review export blocked/,
  )
})

test('another dataset in the log is excluded, not a reason to block this export', () => {
  const otherDataset = {
    ...fixtureRecord,
    boundary_id: 'chr7:50000',   // same coordinate, different dataset
    cell_line: 'GM12878',
    resolution: 25000,
    source: '/data/gm12878.mcool',
    content_hash: 'def456',
  }
  const log = [otherDataset, fixtureRecord]
  assert.deepEqual(selectRecordsForContext(log, fixtureContext), [fixtureRecord])

  const payload = buildReviewAssertionsJSON(log, fixtureContext, '2026-07-29T00:00:00Z')
  assert.equal(payload.n, 1)
  assert.equal(payload.assertions[0].content_hash, 'abc123')
  assert.equal(payload.assertions[0].cell, 'K562')

  const bed = buildReviewAssertionsBED(log, fixtureContext)
  assert.equal(bed.split('\n').filter((line) => !line.startsWith('#')).length, 1)
})

test('a log holding no record for the loaded dataset blocks with that reason', () => {
  const otherDataset = { ...fixtureRecord, cell_line: 'GM12878', resolution: 25000 }
  assert.throws(
    () => buildReviewAssertionsJSON([otherDataset], fixtureContext),
    /no local review assertion belongs to the loaded dataset/,
  )
})

test('record source is bound by content hash and missing bindings fail closed', () => {
  const storage = memoryStorage()
  const withoutSource = { ...fixtureRecord, source: undefined }
  assert.match(
    validateReviewRecordsForContext([withoutSource], fixtureContext).join('; '),
    /record source binding is missing/,
  )
  assert.equal(bindReviewRecordSource('abc123', '/data/k562.mcool', storage), true)
  const [attached] = attachReviewRecordSources([withoutSource], storage)
  assert.equal(attached.source, '/data/k562.mcool')
  assert.deepEqual(validateReviewRecordsForContext([attached], fixtureContext), [])
})

test('demo scope is 3 cell lines x 2 resolutions, consensus-free, with no version or settings chrome', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const frontend = path.resolve(here, '..')
  const home = readFileSync(path.join(frontend, 'src/components/HomePage.vue'), 'utf8')
  const sidebar = readFileSync(path.join(frontend, 'src/components/Sidebar.vue'), 'utf8')
  const app = readFileSync(path.join(frontend, 'src/App.vue'), 'utf8')
  const importPage = readFileSync(path.join(frontend, 'src/components/ImportPage.vue'), 'utf8')
  const renderer = readFileSync(path.join(frontend, 'src/components/best_porp_bed.vue'), 'utf8')
  const visualization = readFileSync(path.join(frontend, 'src/components/VisualizationPage.vue'), 'utf8')
  const styles = readFileSync(path.join(frontend, 'src/assets/styles.css'), 'utf8')
  // The backend lives in the sibling `creditad` repository. In a standalone checkout of
  // this repository it is absent, so the three cross-repo assertions below are skipped
  // rather than failing the suite -- they are a contract on the BACKEND (it must not
  // re-expose the retired consensus/tadshop routes) and can only be checked when both
  // trees are present. Set CREDITAD_BACKEND_DIR to point at it explicitly.
  const backendDir = process.env.CREDITAD_BACKEND_DIR
    ? path.resolve(process.env.CREDITAD_BACKEND_DIR)
    : path.resolve(frontend, '../backend')
  const routesPath = path.join(backendDir, 'tad_vci/api_routes.py')
  const routes = existsSync(routesPath) ? readFileSync(routesPath, 'utf8') : null
  const electronMain = readFileSync(path.join(frontend, 'electron/electron/main.ts'), 'utf8')
  const pkg = JSON.parse(readFileSync(path.join(frontend, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(path.join(frontend, 'package-lock.json'), 'utf8'))

  // Demo scope = 3 cells × 2 res, loaded through one picker. The worked example
  // (GM12878 25 kb, the only package shipping a contact map, chr7 only) is still
  // singled out — it is now the picker's default selection and is labelled as
  // such, rather than living in its own "Worked example" card.
  assert.match(home, /fullCells\s*=\s*\['GM12878',\s*'IMR90',\s*'HepG2'\]/)
  assert.match(home, /fullResolutions\s*=\s*\[25000,\s*10000\]/)
  assert.match(home, /loadMulticellExample\(fullCell,\s*fullRes\)/)
  assert.match(home, /use_multicell_example/)
  // The chromosome list must come from what the backend resolved, never from a
  // hard-coded cell/resolution pair: pinning GM12878 25 kb to chr7 hid the user's
  // own full-genome matrix behind a one-entry chromosome selector.
  assert.match(home, /scope\.map\?\.available \? \(scope\.map\.chroms \|\| \[\]\) : \[\]/)
  assert.match(home, /scope\.evidence_chroms/)
  assert.doesNotMatch(home, /isWorkedExample/)
  // The card must state both data layers: evidence is genome-wide, browser tracks
  // are a chr7 subset. Conflating the two is the demo's easiest misreading.
  assert.match(home, /All 23 chromosomes/)
  assert.match(home, /chr7 only/)

  // nothing consensus-flavoured reaches the screen (comments may still say "no consensus")
  const homeTemplate = home.slice(0, home.indexOf('<script'))
  assert.doesNotMatch(homeTemplate, /consensus/i)
  assert.doesNotMatch(homeTemplate, /unvalidated/i)
  // and the old consensus demo endpoint is gone from the backend
  if (routes === null) {
    console.log('    # skipped 3 backend-contract assertions: backend tree not present (set CREDITAD_BACKEND_DIR)')
  } else {
    assert.doesNotMatch(routes, /use_tadshop_example/)
    assert.doesNotMatch(routes, /Consensus_boundaries\.bed/)
    // the six panel callers are what the viewer registers — no union/consensus pseudo-track
    assert.doesNotMatch(routes, /union_boundaries\.bed/)
  }

  // K562 is not offered: no calibrated demo data ships for it
  assert.doesNotMatch(importPage, /K562/)

  // no app-version chrome and no settings page
  assert.doesNotMatch(sidebar, /v\{\{\s*version\s*\}\}/)
  assert.doesNotMatch(sidebar, /key: 'settings'/)
  assert.doesNotMatch(app, /SettingsPage/)

  // accessibility floors that were previously violated
  assert.match(styles, /prefers-reduced-motion/)
  assert.match(styles, /:focus-visible/)
  // no render-blocking webfont fetch (a comment may still name the domain it used to hit)
  assert.doesNotMatch(styles, /@import\s+url\(['"]?https?:\/\//)
  assert.doesNotMatch(styles, /--text-muted:\s*#9CA3AF/)  // 2.54:1, below the 4.5:1 floor

  assert.doesNotMatch(renderer, /hasPrediction|\/bed\/prediction|Boundary prob/)
  assert.doesNotMatch(visualization, /hasPrediction|\/bed\/prediction/)
  assert.match(electronMain, /APP_DISPLAY_NAME = 'CrediTAD'/)
  assert.match(electronMain, /AUTO_UPDATE_ENABLED = process\.env\.TAD_ENABLE_AUTO_UPDATE === '1'/)
  assert.doesNotMatch(electronMain, /TADLabeler/)
  assert.equal(pkg.name, 'creditad-desktop')
  assert.equal(lock.name, pkg.name)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].name, pkg.name)
  assert.equal(lock.packages[''].version, pkg.version)
})
