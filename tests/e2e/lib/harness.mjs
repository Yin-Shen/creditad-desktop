/**
 * Shared harness for the CrediTAD end-to-end scripts.
 *
 * Exit-code contract (the same for every script under tests/e2e/):
 *   0  PASS     every assertion ran and held
 *   1  FAIL     an assertion failed, or the script crashed
 *   2  SKIPPED  a prerequisite (backend / dev server / Playwright / demo package)
 *               is missing. This is deliberately NOT 0: a run that could not
 *               execute must never be reported as a pass.
 *
 * Everything the scripts write goes into an OS temp directory. Nothing is
 * written into the repository.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXIT_PASS = 0
export const EXIT_FAIL = 1
export const EXIT_SKIP = 2

const require_ = createRequire(import.meta.url)

// tests/e2e/lib/harness.mjs -> frontend/ -> repo root
export const FRONTEND_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../..')
export const REPO_ROOT = path.resolve(FRONTEND_DIR, '..')
export const BACKEND_DIR = path.join(REPO_ROOT, 'backend')

export const BACKEND_BASE =
  process.env.CREDITAD_E2E_BACKEND || `http://127.0.0.1:${process.env.CREDITAD_PORT || 5001}`
export const FRONTEND_BASE = process.env.CREDITAD_E2E_FRONTEND || 'http://127.0.0.1:5173'
export const API = `${BACKEND_BASE}/api`

/* ── result reporting ─────────────────────────────────────────────── */

export class SkipError extends Error {}

export function skip(message) {
  throw new SkipError(message)
}

let checks = 0

export function ok(condition, message) {
  checks += 1
  if (!condition) throw new Error(`assertion failed: ${message}`)
}

export function equal(actual, expected, message) {
  checks += 1
  if (!Object.is(actual, expected)) {
    throw new Error(`assertion failed: ${message}\n  expected: ${fmt(expected)}\n  actual:   ${fmt(actual)}`)
  }
}

export function deepEqual(actual, expected, message) {
  checks += 1
  const a = JSON.stringify(sortKeys(actual))
  const b = JSON.stringify(sortKeys(expected))
  if (a !== b) {
    throw new Error(`assertion failed: ${message}\n  expected: ${b}\n  actual:   ${a}`)
  }
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
  }
  return v
}

const fmt = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))

export function log(...args) {
  console.log(...args)
}

/**
 * Run an e2e script body and translate its outcome into the exit-code contract.
 * `body` receives a temp working directory that is removed on success.
 */
export async function runScript(name, body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'creditad-e2e-'))
  const t0 = Date.now()
  checks = 0
  let code = EXIT_PASS
  try {
    await body(tmp)
    log(`\nPASS  ${name}  (${checks} assertions, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (err) {
    if (err instanceof SkipError) {
      code = EXIT_SKIP
      log(`\nSKIP  ${name}: ${err.message}`)
      log('      (exit code 2 — this run proved nothing; it is not a pass)')
    } else {
      code = EXIT_FAIL
      log(`\nFAIL  ${name}`)
      log(err && err.stack ? err.stack : String(err))
    }
  } finally {
    if (process.env.CREDITAD_E2E_KEEP === '1') {
      log(`      temp dir kept: ${tmp}`)
    } else if (code === EXIT_FAIL) {
      log(`      temp dir kept for inspection: ${tmp}`)
    } else {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
  process.exit(code)
}

/* ── prerequisites ────────────────────────────────────────────────── */

export async function requireBackend() {
  let datasets
  try {
    const res = await fetch(`${API}/tadvci/multicell_datasets`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) skip(`backend at ${BACKEND_BASE} answered HTTP ${res.status} for /api/tadvci/multicell_datasets`)
    datasets = await res.json()
  } catch (err) {
    if (err instanceof SkipError) throw err
    skip(`backend not reachable at ${BACKEND_BASE} (${err.message}). Start it, or set CREDITAD_E2E_BACKEND.`)
  }
  return Array.isArray(datasets.datasets) ? datasets.datasets : []
}

export async function requireFrontend() {
  try {
    const res = await fetch(FRONTEND_BASE, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) skip(`dev server at ${FRONTEND_BASE} answered HTTP ${res.status}`)
  } catch (err) {
    if (err instanceof SkipError) throw err
    skip(`dev server not reachable at ${FRONTEND_BASE} (${err.message}). Run "npm run dev", or set CREDITAD_E2E_FRONTEND.`)
  }
}

/**
 * Locate a Playwright install whose chromium is actually downloaded.
 *
 * Playwright normally lives outside this project (the repo does not vendor a
 * browser) and a host can easily carry several npx copies, only one of which
 * has a matching browser build. Resolving the module is therefore not enough —
 * each candidate is accepted only if chromium.executablePath() exists on disk,
 * otherwise the run would fail deep inside launch() instead of skipping.
 */
export function requirePlaywright() {
  const dirs = []
  if (process.env.CREDITAD_PLAYWRIGHT_DIR) dirs.push(process.env.CREDITAD_PLAYWRIGHT_DIR)
  for (const p of (process.env.NODE_PATH || '').split(path.delimiter)) if (p) dirs.push(p)
  dirs.push(path.join(FRONTEND_DIR, 'node_modules'))
  const npxRoot = path.join(os.homedir(), '.npm', '_npx')
  if (fs.existsSync(npxRoot)) {
    for (const entry of fs.readdirSync(npxRoot).sort()) {
      dirs.push(path.join(npxRoot, entry, 'node_modules'))
    }
  }

  const tried = []
  for (const dir of dirs) {
    const mod = path.join(dir, 'playwright')
    if (!fs.existsSync(mod)) continue
    let pw
    try {
      pw = require_(mod)
    } catch {
      continue
    }
    let exe = ''
    try {
      exe = pw.chromium.executablePath()
    } catch { /* treated as "no browser" below */ }
    if (exe && fs.existsSync(exe)) return pw
    tried.push(`${mod} (chromium not downloaded)`)
  }
  skip(
    'no usable playwright install (module present with a downloaded chromium).\n' +
    (tried.length ? `      rejected: ${tried.join('; ')}\n` : '') +
    '      Install one and point CREDITAD_PLAYWRIGHT_DIR at its node_modules directory.',
  )
}

/**
 * Read the rendered tier track once it has stopped moving.
 *
 * The Hi-C viewer settles its viewport a few frames after load and the tier
 * track re-lays-out with it, so a naive read can catch a half-drawn frame or a
 * frame belonging to the previously selected chromosome. This waits for the
 * tick count to be stable across two samples and then reads the chromosome
 * selector and the tick titles in the same JavaScript tick, so the two can
 * never describe different frames.
 */
export async function readTierTrack(page, { timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout
  let previous = -1
  for (;;) {
    const count = await page.locator('.vci-svg rect.bnd').count()
    if (count > 0 && count === previous) break
    if (Date.now() > deadline) {
      skip(`tier track never settled (last two tick counts ${previous} then ${count})`)
    }
    previous = count
    await page.waitForTimeout(400)
  }
  return page.evaluate(() => ({
    chrom: document.querySelector('.controls select')?.value || '',
    titles: Array.from(document.querySelectorAll('.vci-svg rect.bnd'))
      .map((e) => e.querySelector('title')?.textContent || ''),
  }))
}

/**
 * Vite HMR reloads the page when a watched file changes. That is an
 * environment event, not a product defect, and it invalidates the run — report
 * it as a skip instead of as a spurious failure.
 */
export function watchForReload(page) {
  let reloads = 0
  page.on('load', () => { reloads += 1 })
  return function assertNoReload() {
    if (reloads > 1) {
      skip(`the dev server reloaded the page ${reloads - 1}x mid-run (vite HMR — was a watched file edited?)`)
    }
  }
}

export async function launchChromium() {
  const { chromium } = requirePlaywright()
  try {
    return await chromium.launch({ headless: true })
  } catch (err) {
    skip(`chromium could not be launched (${err.message}).`)
  }
}

/** Resolve a Python that can import the backend package. */
export function requirePython() {
  const candidates = [
    process.env.CREDITAD_PYTHON,
    '$HOME/miniforge3/bin/python3.13',
    'python3',
  ].filter(Boolean)
  for (const py of candidates) {
    const probe = runSync(py, ['-c', 'import tad_vci'], { cwd: BACKEND_DIR })
    if (probe.status === 0) return py
  }
  skip(
    `no Python that can "import tad_vci" from ${BACKEND_DIR}. ` +
    'Set CREDITAD_PYTHON to the interpreter that runs the backend.',
  )
}

/* ── small utilities ──────────────────────────────────────────────── */

export function runSync(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

/** Parse a tab-separated table into {columns, rows:[{col:value}]}. */
export function readTsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\n$/, '')
  const lines = text.split('\n')
  const columns = lines[0].split('\t')
  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t')
    return Object.fromEntries(columns.map((c, i) => [c, cells[i]]))
  })
  return { columns, rows }
}

/**
 * Deterministic synthetic boundary BEDs. Generated in-process so the scripts do
 * not depend on any data file that might be absent on another host.
 * Fixed seed -> byte-identical fixtures on every run and every machine.
 */
export function writeBoundaryFixtures(dir, { resolution = 10000, n = 120, chrom = 'chr20' } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const rnd = mulberry32(20260725)
  const primary = []
  for (let i = 0; i < n; i++) primary.push(1_000_000 + i * 4 * resolution)

  const write = (name, positions) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, positions.map((p) => `${chrom}\t${p}\t${p + resolution}\n`).join(''))
    return file
  }

  const panel = []
  for (const [label, keep] of [['A', 0.9], ['B', 0.6], ['C', 0.35]]) {
    const positions = []
    for (const p of primary) {
      const draw = rnd()
      const jitter = [-resolution, 0, resolution][Math.floor(rnd() * 3)]
      if (draw < keep) positions.push(p + jitter)
    }
    panel.push({ name: `panel_${label}`, path: write(`panel_${label}.bed`, positions) })
  }
  return { resolution, primary: write('primary.bed', primary), panel }
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Guard an output directory the app writes to and the test cannot redirect
 * (./tad_results — the Import page hardcodes it).
 *
 * Files the run creates are deleted afterwards, and any pre-existing file the
 * run would overwrite is copied aside first and put back: an e2e run must not
 * destroy a result the user already had on disk.
 *
 * Returns a cleanup() that reports what it removed and restored.
 */
export function guardDir(dir, protectedNames = [], backupRoot = os.tmpdir()) {
  const before = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  const backupDir = fs.mkdtempSync(path.join(backupRoot, 'creditad-e2e-backup-'))
  const backedUp = []
  for (const name of protectedNames) {
    const src = path.join(dir, name)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, name))
      backedUp.push(name)
    }
  }
  return function cleanup() {
    const removed = []
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (before.has(f)) continue
        fs.rmSync(path.join(dir, f), { recursive: true, force: true })
        removed.push(f)
      }
    }
    for (const name of backedUp) fs.copyFileSync(path.join(backupDir, name), path.join(dir, name))
    fs.rmSync(backupDir, { recursive: true, force: true })
    return { removed, restored: backedUp }
  }
}

export async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* keep the raw text for the message */ }
  return { status: res.status, ok: res.ok, json, text }
}
