/**
 * Overlay the factory Agent default onto Tako DeepSeek v4.1 flash.
 * Only when the user has never saved a selection (missing overlay, or the
 * shipped official `deepseek-official` / `deepseek-flash` pair).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TAKO_DEFAULT_PROVIDER = 'tako'
export const TAKO_DEFAULT_MODEL = 'deepseek-v4.1-flash'
const FACTORY_PROVIDER = 'deepseek-official'
const FACTORY_MODEL = 'deepseek-flash'
const SNIPPET = `- id: agent-default-model
  config:
    provider: ${TAKO_DEFAULT_PROVIDER}
    model: ${TAKO_DEFAULT_MODEL}
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether this overlay is still the never-chosen official factory default. */
export function isFactoryOfficialDefault(entry: unknown): boolean {
  if (!isRecord(entry) || entry.id !== 'agent-default-model') return false
  const config = isRecord(entry.config) ? entry.config : undefined
  return config?.provider === FACTORY_PROVIDER && config.model === FACTORY_MODEL
}

/**
 * Write `tako` / `deepseek-v4.1-flash` into the profile patch when the user
 * has not chosen a model. Leaves any other saved selection alone.
 * @returns whether the file changed.
 */
export function ensureTakoDefaultModel(profileDir: string): boolean {
  const path = join(profileDir, 'cordis.patch.yml')
  const body = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (/- id: agent-default-model\b/.test(body)) {
    const factory = /(id: agent-default-model\b[\s\S]*?\n    provider: )deepseek-official(\n    model: )deepseek-flash\b/
    if (!factory.test(body)) return false
    writeFileSync(path, body.replace(factory, `$1${TAKO_DEFAULT_PROVIDER}$2${TAKO_DEFAULT_MODEL}`), { mode: 0o600 })
    return true
  }
  const trimmed = body.trim()
  // initProfile writes comments plus `[]`. Replacing that empty array keeps
  // the comments; appending after `[]` is invalid YAML.
  if (trimmed === '' || trimmed === '[]' || /^\s*\[\]\s*$/m.test(body)) {
    const replaced = body.replace(/^\s*\[\]\s*$/m, SNIPPET.trimEnd())
    const next = replaced === body ? SNIPPET : `${replaced.endsWith('\n') ? replaced : `${replaced}\n`}`
    writeFileSync(path, next, { mode: 0o600 })
    return true
  }
  const next = `${body.endsWith('\n') ? body : `${body}\n`}${SNIPPET}`
  writeFileSync(path, next, { mode: 0o600 })
  return true
}
