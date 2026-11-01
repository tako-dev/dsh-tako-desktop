/** Fresh-profile welcome selection using the real Loader, settings and bundled Tako provider. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import Credentials from '@deepseek-ai/dsh-credentials'
import * as Tako from '@deepseek-ai/dsh-tako'
import { connectDesktopWelcome, takoCredentialSettings } from '../src/welcome-backend.ts'

it('recognizes the fresh bundled Tako profile before the npm plugin is installed', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-welcome-composition-')))
  const dir = join(home, 'profiles', 'test')
  const originalFetch = globalThis.fetch
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    globalThis.fetch = vi.fn(async () => Response.json({ data: [] }))
    initProfile(dir, ['test-tako-bundle'])
    const bundle = join(dir, 'node_modules', 'test-tako-bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(home, 'package.json'), '{"name":"welcome-test"}\n')
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-tako-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' },
      { id: 'settings', name: 'cordis:settings' },
      { id: 'system-prompt', name: 'cordis:prompt' },
      { id: 'tools', name: 'cordis:tools' },
      { id: 'llm', name: 'cordis:llm' },
      { id: 'credentials', name: 'cordis:credentials' },
      { id: 'tako', name: 'cordis:tako', config: { apiKeyEnv: 'TAKO_API_KEY', baseURL: 'https://tako.example.test', models: [{ id: 'fixture-model' }] } },
    ] }]))
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    const profile: ProfileContext = {
      name: 'test', startedBundles: ['test-tako-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
    }
    ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (root) => {
      root.provide('profileContext', profile)
      root.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(root.loader.builtins, {
        editor: ConfigEditor, settings: Settings, prompt: SystemPrompt, tools: ToolRuntime,
        llm: LlmRuntime, credentials: Credentials, tako: Tako,
      })
    })
    const namespaces = ctx.settings.describe({ redactSecrets: true })
    expect(takoCredentialSettings(namespaces)).toEqual({ apiKeyEnv: 'TAKO_API_KEY', baseURL: 'https://tako.example.test' })
    const send: Parameters<typeof connectDesktopWelcome>[1] = async (_input, init) => {
      if (init?.method !== 'POST') return new Response('app')
      const request = JSON.parse(init.body as string) as { rpcId: string; method: string; payload: { args: { refs?: string[] } } }
      const value = request.method === 'settings/describe'
        ? { namespaces: [...namespaces, { ns: 'locale', value: {} }] }
        : request.method === 'llm/listConfigurableProviders' ? []
          : Object.fromEntries((request.payload.args.refs ?? []).map(ref => [ref, { configured: false, writable: true }]))
      return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } })
    }
    const backend = await connectDesktopWelcome('http://127.0.0.1:12345/?token=fixture', send)
    expect(await backend.read()).toMatchObject({ hasApiKey: false, writable: true })
    expect(backend.provider).toBe('tako')
  } finally {
    await ctx?.fiber.dispose()
    globalThis.fetch = originalFetch
    rmSync(home, { recursive: true, force: true })
  }
})
