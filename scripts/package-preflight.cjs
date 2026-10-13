/**
 * CrediTAD desktop packaging contract.
 *
 * Packaged layout (electron-builder extraResources):
 *   resources/backend/   → Python app (main.py + tad_vci + …)
 *   resources/runtime/   → embedded Python (python.exe + Lib/… on Windows, bin/python on Linux)
 *   resources/example_data/multicell/ → six demo packages (required)
 *
 * Inputs are read from package_stage/{backend,runtime,example_data} inside this
 * repository, or from explicit paths (see README.md, "Packaging"):
 *   CREDITAD_PACKAGE_BACKEND=/path/to/backend
 *   CREDITAD_PACKAGE_RUNTIME=/path/to/runtime   (must contain python.exe on Windows builds)
 *   CREDITAD_PACKAGE_EXAMPLE_DATA=/path/to/example_data
 */
const fs = require('node:fs')
const path = require('node:path')

function exists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function resolvePackageInputs() {
  const frontendDir = path.resolve(__dirname, '..')
  const creditadRoot = path.resolve(frontendDir, '..')

  const backendDir = process.env.CREDITAD_PACKAGE_BACKEND
    ? path.resolve(process.env.CREDITAD_PACKAGE_BACKEND)
    : path.resolve(frontendDir, 'package_stage', 'backend')

  const runtimeDir = process.env.CREDITAD_PACKAGE_RUNTIME
    ? path.resolve(process.env.CREDITAD_PACKAGE_RUNTIME)
    : path.resolve(frontendDir, 'package_stage', 'runtime')

  const exampleDataDir = process.env.CREDITAD_PACKAGE_EXAMPLE_DATA
    ? path.resolve(process.env.CREDITAD_PACKAGE_EXAMPLE_DATA)
    : path.resolve(frontendDir, 'package_stage', 'example_data')

  // Dev fallback: live tree if stage not prepared (explicit opt-in)
  const allowLive = process.env.CREDITAD_PACKAGE_USE_LIVE === '1'
  const liveBackend = path.resolve(creditadRoot, 'backend')
  const liveExample = path.resolve(creditadRoot, 'example_data')
  const liveRuntime = path.resolve(creditadRoot, 'runtime')

  const resolvedBackend = isDir(backendDir)
    ? backendDir
    : allowLive && isDir(liveBackend)
      ? liveBackend
      : null

  const resolvedExample = isDir(exampleDataDir)
    ? exampleDataDir
    : allowLive && isDir(liveExample)
      ? liveExample
      : null

  const resolvedRuntime = isDir(runtimeDir)
    ? runtimeDir
    : allowLive && isDir(liveRuntime)
      ? liveRuntime
      : null

  const errors = []

  if (!resolvedBackend) {
    errors.push(
      `Backend stage missing: ${backendDir}\n  Set CREDITAD_PACKAGE_BACKEND=…`,
    )
  } else {
    const mainPy = path.join(resolvedBackend, 'main.py')
    if (!isFile(mainPy)) {
      errors.push(`backend/main.py not found under ${resolvedBackend}`)
    }
  }

  if (!resolvedRuntime) {
    errors.push(
      `Embedded Python runtime missing: ${runtimeDir}\n` +
        `  Expected python.exe (Windows) or bin/python (Linux)\n` +
        `  Or set CREDITAD_PACKAGE_RUNTIME=…`,
    )
  } else {
    const pyWin = path.join(resolvedRuntime, 'python.exe')
    const pyUnix = path.join(resolvedRuntime, 'bin', 'python')
    const pyUnix2 = path.join(resolvedRuntime, 'python')
    if (!isFile(pyWin) && !isFile(pyUnix) && !isFile(pyUnix2)) {
      errors.push(
        `Runtime has no python.exe / python under ${resolvedRuntime}`,
      )
    }
  }

  if (!resolvedExample) {
    errors.push(`example_data stage missing: ${exampleDataDir}`)
  } else {
    const multi = path.join(resolvedExample, 'multicell')
    if (!isDir(multi)) {
      errors.push(`example_data/multicell missing under ${resolvedExample}`)
    } else {
      // Require at least one full demo package
      const need = ['GM12878_25kb', 'IMR90_25kb', 'HepG2_25kb']
      for (const name of need) {
        // Either form: the repo keeps the plain table, the staged package gzips it
        // (139 MB -> ~16 MB). The backend resolves both — tad_vci.api_routes._annotation_path.
        const ann = path.join(multi, name, 'annotation.tsv')
        if (!isFile(ann) && !isFile(`${ann}.gz`)) {
          errors.push(`Demo package incomplete: ${ann}[.gz]`)
        }
      }
    }
  }

  if (errors.length) {
    throw new Error(
      [
        'CrediTAD desktop packaging preflight failed.',
        ...errors.map((e) => ` - ${e}`),
        '',
        'Contract: resources/{backend,runtime,example_data} + /api/health after launch.',
        'See README.md, section "Packaging".',
      ].join('\n'),
    )
  }

  const launcher = isFile(path.join(resolvedRuntime, 'python.exe'))
    ? 'embedded-python-win'
    : 'embedded-python'

  return {
    mode: launcher,
    launcher,
    backendDir: resolvedBackend,
    runtimeDir: resolvedRuntime,
    exampleDataDir: resolvedExample,
    creditadRoot,
  }
}

if (require.main === module) {
  try {
    const inputs = resolvePackageInputs()
    process.stdout.write(
      `CrediTAD package inputs ready (${inputs.mode})\n` +
        `  backend:  ${inputs.backendDir}\n` +
        `  runtime:  ${inputs.runtimeDir}\n` +
        `  examples: ${inputs.exampleDataDir}\n`,
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { resolvePackageInputs }
