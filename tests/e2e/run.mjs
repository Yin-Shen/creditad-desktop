#!/usr/bin/env node
/**
 * Runner for the CrediTAD end-to-end scripts.
 *
 *   npm run test:e2e                 # all scripts
 *   npm run test:e2e -- demoPackages # one script (prefix match)
 *
 * Aggregate exit code:
 *   0  every script passed
 *   1  at least one script failed
 *   2  nothing failed but at least one script skipped (prerequisite missing) —
 *      deliberately not 0, so a run that could not execute is never green.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const SCRIPTS = [
  'cliApiParity.e2e.mjs',   // no browser needed; fails fastest
  'demoPackages.e2e.mjs',
  'importGui.e2e.mjs',
]

const filters = process.argv.slice(2)
const selected = filters.length
  ? SCRIPTS.filter((s) => filters.some((f) => s.startsWith(f)))
  : SCRIPTS

if (!selected.length) {
  console.error(`no e2e script matches ${filters.join(', ')}. Available: ${SCRIPTS.join(', ')}`)
  process.exit(1)
}

const results = []
for (const script of selected) {
  console.log(`\n${'='.repeat(64)}\n${script}\n${'='.repeat(64)}`)
  const code = await runOne(path.join(HERE, script))
  results.push({ script, code })
}

const label = { 0: 'PASS', 1: 'FAIL', 2: 'SKIP' }
console.log(`\n${'='.repeat(64)}\nsummary`)
for (const r of results) console.log(`  ${label[r.code] || `EXIT ${r.code}`}  ${r.script}`)

const failed = results.filter((r) => r.code === 1).length
const skipped = results.filter((r) => r.code === 2).length
const other = results.filter((r) => ![0, 1, 2].includes(r.code)).length
const exit = failed || other ? 1 : (skipped ? 2 : 0)
console.log(`  ${results.length - failed - skipped - other} passed, ${failed} failed, ${skipped} skipped -> exit ${exit}`)
process.exit(exit)

function runOne(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit' })
    child.on('close', (code) => resolve(code))
  })
}
