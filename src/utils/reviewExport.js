const REQUIRED_CONTEXT_FIELDS = ['assembly', 'cell', 'resolution', 'source']
const SOURCE_BINDINGS_KEY = 'creditad_review_source_bindings_v1'

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

const asPositiveInteger = (value) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function resolveReviewExportContext(fileViewObject = {}) {
  const context = {
    assembly: asNonEmptyString(fileViewObject.assembly),
    cell: asNonEmptyString(fileViewObject.cell_line),
    resolution: asPositiveInteger(fileViewObject.resolution),
    source: asNonEmptyString(fileViewObject.source) || asNonEmptyString(fileViewObject.mcoolPath),
  }
  const missing = REQUIRED_CONTEXT_FIELDS.filter((field) => context[field] == null)
  return { context, missing, ready: missing.length === 0 }
}

function readSourceBindings(storage) {
  if (!storage) return {}
  try {
    const parsed = JSON.parse(storage.getItem(SOURCE_BINDINGS_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function bindReviewRecordSource(contentHash, source, storage = globalThis.localStorage) {
  const hash = asNonEmptyString(contentHash)
  const sourceValue = asNonEmptyString(source)
  if (!hash || !sourceValue || !storage) return false
  try {
    const bindings = readSourceBindings(storage)
    bindings[hash] = sourceValue
    storage.setItem(SOURCE_BINDINGS_KEY, JSON.stringify(bindings))
    return true
  } catch {
    return false
  }
}

export function attachReviewRecordSources(records, storage = globalThis.localStorage) {
  if (!Array.isArray(records)) return records
  const bindings = readSourceBindings(storage)
  return records.map((record) => ({
    ...record,
    source: asNonEmptyString(record?.source) || asNonEmptyString(bindings[record?.content_hash]) || null,
  }))
}

/**
 * The records log is global across every dataset the user has opened, but an
 * export belongs to one dataset. Select on the triple the *backend* stamps on
 * each record at sign-out — cell / assembly / resolution, the same scope key
 * TADVCIEvidence uses for history — and never on `source`, which is a local
 * binding and is therefore the thing validation has to check rather than assume.
 */
export function selectRecordsForContext(records, context) {
  if (!Array.isArray(records) || !context) return []
  return records.filter((record) => (
    asNonEmptyString(record?.assembly) === context.assembly &&
    asNonEmptyString(record?.cell_line) === context.cell &&
    asPositiveInteger(record?.resolution) === context.resolution
  ))
}

export function validateReviewRecordsForContext(records, context) {
  if (!Array.isArray(records)) return ['record payload is not an array']

  const issues = []
  records.forEach((record, index) => {
    const recordId = asNonEmptyString(record?.boundary_id) || `row ${index + 1}`
    const recordAssembly = asNonEmptyString(record?.assembly)
    const recordCell = asNonEmptyString(record?.cell_line)
    const recordResolution = asPositiveInteger(record?.resolution)
    const recordSource = asNonEmptyString(record?.source)

    if (!recordAssembly) issues.push(`${recordId}: record assembly is missing`)
    else if (recordAssembly !== context.assembly) {
      issues.push(`${recordId}: record assembly ${recordAssembly} != current ${context.assembly}`)
    }

    if (!recordCell) issues.push(`${recordId}: record cell is missing`)
    else if (recordCell !== context.cell) {
      issues.push(`${recordId}: record cell ${recordCell} != current ${context.cell}`)
    }

    if (!recordResolution) issues.push(`${recordId}: record resolution is missing`)
    else if (recordResolution !== context.resolution) {
      issues.push(`${recordId}: record resolution ${recordResolution} != current ${context.resolution}`)
    }

    if (!recordSource) issues.push(`${recordId}: record source binding is missing`)
    else if (recordSource !== context.source) {
      issues.push(`${recordId}: record source ${recordSource} != current ${context.source}`)
    }

    if (!record?.review_decision?.verdict) {
      issues.push(`${recordId}: local review assertion is missing`)
    }
  })
  return issues
}

function assertionRows(records, context) {
  // Validating the whole log against one dataset made every export impossible as
  // soon as two datasets had been reviewed — and switching back did not help,
  // because the other dataset's rows then mismatched in the other direction.
  const scoped = selectRecordsForContext(records, context)
  if (!scoped.length) {
    throw new Error('Review export blocked: no local review assertion belongs to the loaded dataset '
      + `(${context.cell} · ${context.assembly} · ${context.resolution} bp).`)
  }
  const issues = validateReviewRecordsForContext(scoped, context)
  if (issues.length) {
    throw new Error(`Review export blocked: ${issues.join('; ')}`)
  }

  return scoped.map((record) => ({
    boundary_id: record.boundary_id,
    auto_tier: record.auto_tier,
    reviewed_tier: record.final_tier,
    local_review_assertion: record.review_decision.verdict,
    rationale: record.review_decision.rationale ?? null,
    actor_label: record.actor_label || null,
    created_at: record.created_at,
    version: record.version,
    content_hash: record.content_hash,
    assembly: context.assembly,
    cell: context.cell,
    resolution: context.resolution,
    source: context.source,
    evidence: record.evidence,
  }))
}

export function buildReviewAssertionsJSON(records, context, exportTime = new Date().toISOString()) {
  const assertions = assertionRows(records, context)
  return {
    format: 'creditad-local-review-assertions/v1',
    context: { ...context },
    assertions,
    n: assertions.length,
    export_time: exportTime,
    limitations: 'Local actor labels are not authenticated; each content hash covers one record only. '
      + 'n counts only the records made against this context, not the whole local review log.',
  }
}

const bedSafe = (value) => String(value ?? '').replace(/[\t\r\n|]/g, '_')

export function buildReviewAssertionsBED(records, context) {
  const assertions = assertionRows(records, context)
  const metadata = [
    '# CrediTAD local review assertions',
    `# assembly=${bedSafe(context.assembly)}`,
    `# cell=${bedSafe(context.cell)}`,
    `# resolution=${context.resolution}`,
    `# source=${bedSafe(context.source)}`,
    '# columns=chrom,start,end,local_review_assertion|reviewed_tier|version|content_hash',
  ]
  const rows = assertions.map((record) => {
    const match = String(record.boundary_id).match(/^(?:chr)?([^:]+):(\d+)$/i)
    if (!match) throw new Error(`Review export blocked: invalid boundary_id ${record.boundary_id}`)
    const chrom = `chr${match[1]}`
    const start = Number.parseInt(match[2], 10)
    const end = start + context.resolution
    const name = [
      record.local_review_assertion,
      record.reviewed_tier,
      `v${record.version}`,
      record.content_hash,
    ].map(bedSafe).join('|')
    return `${chrom}\t${start}\t${end}\t${name}`
  })
  return [...metadata, ...rows].join('\n')
}
