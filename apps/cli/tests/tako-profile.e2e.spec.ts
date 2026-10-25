/**
 * Keyless source-entry smoke for the Tako profile. The test starts the same
 * ESM source launcher used by repository development and observes the default
 * configuration without issuing a provider request or requiring a credential.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/src/bin.ts')

describe('Tako profile source composition', () => {
  it('loads the Tako bundle through the source CLI without a key', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-tako-profile-'))
    const result = await execa(process.execPath, ['--import', 'tsx/esm', dshBin, '--profile', 'tako', '--dump-default-config'], {
      env: { ...process.env, DSH_HOME: dshHome },
      reject: false,
      timeout: 30_000,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('# == @deepseek-ai/dsh-tako')
    expect(result.stdout).toContain('name: \'@deepseek-ai/dsh-tako\'')
    expect(result.stdout).toContain('apiKeyEnv: TAKO_API_KEY')
    expect(result.stdout).toContain('id: tako')
    expect(result.stdout).toContain('# == @deepseek-ai/dsh-experimental-tako-browser-bundle')
    expect(result.stdout).toContain("name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'")
  })
})
