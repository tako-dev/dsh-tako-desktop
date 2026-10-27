import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureTakoDefaultModel, TAKO_DEFAULT_MODEL, TAKO_DEFAULT_PROVIDER } from '../src/tako-default-model.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function profile(): string {
  const root = mkdtempSync(join(tmpdir(), 'tako-default-model-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  return root
}

describe('ensureTakoDefaultModel', () => {
  it('writes Tako DeepSeek v4.1 flash when the patch is empty', () => {
    const dir = profile()
    writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
    expect(ensureTakoDefaultModel(dir)).toBe(true)
    const body = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(body).toContain(`provider: ${TAKO_DEFAULT_PROVIDER}`)
    expect(body).toContain(`model: ${TAKO_DEFAULT_MODEL}`)
    expect(body).not.toContain('[]')
  })

  it('replaces the factory official default and leaves a user selection', () => {
    const dir = profile()
    writeFileSync(join(dir, 'cordis.patch.yml'), `- id: agent-default-model
  config:
    provider: deepseek-official
    model: deepseek-flash
`)
    expect(ensureTakoDefaultModel(dir)).toBe(true)
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain(`model: ${TAKO_DEFAULT_MODEL}`)
    writeFileSync(join(dir, 'cordis.patch.yml'), `- id: agent-default-model
  config:
    provider: tako
    model: deepseek-v4.1-flash-1017
`)
    expect(ensureTakoDefaultModel(dir)).toBe(false)
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('deepseek-v4.1-flash-1017')
  })
})
