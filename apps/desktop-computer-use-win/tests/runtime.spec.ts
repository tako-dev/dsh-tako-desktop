/**
 * Adapter behavior: observation-only tool admission, the config-time and
 * dispatch-time refusals, the upstream server environment, and the backend
 * sweep's platform gate. The contexts here are fakes, so this spec proves the
 * adapter's own wiring without an MCP child.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import {
  Config,
  OBSERVATION_TOOLS,
  publicName,
  refusalReason,
  REFUSED_TOOLS,
  resolveUpstreamServer,
  SERVER_NAME,
  sweepBackendProcesses,
  UPSTREAM_PACKAGE,
  apply,
} from '../src/index.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

describe('tool inventory', () => {
  it('covers every upstream name with admission or refusal, disjointly', () => {
    const observation: ReadonlySet<string> = new Set(OBSERVATION_TOOLS)
    const refused: ReadonlySet<string> = new Set(REFUSED_TOOLS)
    for (const name of observation) expect(refused.has(name)).toBe(false)
    expect(observation.size).toBe(OBSERVATION_TOOLS.length)
    expect(refused.size).toBe(REFUSED_TOOLS.length)
  })

  it('names observation tools under the wincu namespace', () => {
    expect(publicName('snapshot')).toBe('mcp__wincu__snapshot')
    expect(publicName('screenshot')).toBe(`mcp__${SERVER_NAME}__screenshot`)
  })

  it('describes every refusal as a desktop-state change', () => {
    for (const rawName of REFUSED_TOOLS) {
      expect(refusalReason(rawName)).toContain('observation-only')
      expect(refusalReason(rawName)).toContain(JSON.stringify(rawName))
    }
  })
})

describe('Config', () => {
  it('defaults to every observation tool', () => {
    const config = Config({})
    expect(config.enabledTools).toEqual([...OBSERVATION_TOOLS])
    expect(config.requireApproval).toBe(false)
  })

  it('accepts an observation subset', () => {
    const config = Config({ enabledTools: ['snapshot', 'screenshot'] })
    expect(config.enabledTools).toEqual(['snapshot', 'screenshot'])
  })

  it.each(REFUSED_TOOLS)('rejects the refused tool %s at config validation', (rawName) => {
    expect(() => Config({ enabledTools: [rawName] })).toThrow('refused')
    expect(() => Config({ enabledTools: ['snapshot', rawName] })).toThrow(JSON.stringify(rawName))
  })

  it('rejects names the pinned upstream does not declare', () => {
    expect(() => Config({ enabledTools: ['teleport'] })).toThrow('unknown')
  })
})

describe('resolveUpstreamServer', () => {
  it('resolves the installed upstream MCP entry', () => {
    const serverPath = resolveUpstreamServer(join(packageDir, 'package.json'))
    expect(serverPath).toContain(UPSTREAM_PACKAGE)
    expect(serverPath.endsWith(join('mcp', 'server.mjs'))).toBe(true)
    expect(existsSync(serverPath)).toBe(true)
  })
})

describe('sweepBackendProcesses', () => {
  it('is a no-op outside Windows', async () => {
    if (process.platform === 'win32') return
    await expect(sweepBackendProcesses('/nonexistent/mcp/server.mjs')).resolves.toBeUndefined()
  })
})

interface ExecProbe {
  name: string
}

/** A context carrying only the wiring `apply` uses, with every registration captured. */
function fakeContext() {
  const captured: {
    preExecute?: (execution: ExecProbe, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>
    guard?: (execution: ExecProbe) => string | undefined
    plugin?: { plugin: unknown; config: { serverName?: string; command?: string; args?: string[]; env?: Record<string, string> } }
    readonly disposers: Array<() => unknown>
  } = { disposers: [] }
  const child = {
    dispose: vi.fn(),
    await: vi.fn().mockResolvedValue(undefined),
  }
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
  const ctx = Object.assign(new Context(), {
    on: (event: string, listener: never) => {
      if (event === 'tools/pre-execute') captured.preExecute = listener
      return () => {}
    },
    effect: (body: () => unknown) => {
      const result = body()
      if (result !== undefined && result !== null && typeof result === 'object' && Symbol.iterator in result) {
        for (const disposer of result as Iterable<() => unknown>) captured.disposers.push(disposer)
      } else if (typeof result === 'function') captured.disposers.push(result as () => unknown)
      return () => {}
    },
    plugin: vi.fn((plugin: unknown, config: unknown) => {
      captured.plugin = { plugin, config: config as NonNullable<typeof captured.plugin>['config'] }
      return child
    }),
    logger,
    tools: {
      guard: (guard: (execution: ExecProbe) => string | undefined) => {
        captured.guard = guard
        return () => { delete captured.guard }
      },
    },
  })
  return { ctx, captured, child, logger }
}

const next = (): Promise<PreToolDecision> => Promise.resolve({ kind: 'allow' })

describe('apply', () => {
  it('mounts the upstream server through mcp-client with observation env only', async () => {
    const { ctx, captured, child } = fakeContext()
    await apply(ctx, Config({ enabledTools: ['snapshot', 'screenshot'] }))
    expect(captured.plugin).toBeDefined()
    const mounted = captured.plugin!.config
    expect(mounted.serverName).toBe('wincu')
    expect(mounted.command).toBe(process.execPath)
    expect(mounted.args?.[0]?.endsWith(join('mcp', 'server.mjs'))).toBe(true)
    expect(mounted.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(mounted.env?.WCU_IMAGE_MODE).toBe('file')
    expect(mounted.env?.WCU_TOOL_MODE).toBe('full')
    expect(JSON.parse(mounted.env?.WCU_ENABLED_TOOLS ?? '[]')).toEqual(['snapshot', 'screenshot'])
    expect(child.await).toHaveBeenCalledOnce()
  })

  it('denies refused names before dispatch and logs the refusal', async () => {
    const { ctx, captured } = fakeContext()
    await apply(ctx, Config({}))
    for (const rawName of REFUSED_TOOLS) {
      const decision = await captured.preExecute!({ name: publicName(rawName) }, next)
      expect(decision).toEqual(expect.objectContaining({ kind: 'deny' }))
      expect((decision as { reason?: string }).reason).toContain('observation-only')
    }
    const guard = captured.guard!
    expect(guard({ name: publicName('click') })).toContain('refused')
    expect(guard({ name: 'shell' })).toBeUndefined()
  })

  it('lets non-wincu tools pass through untouched', async () => {
    const { ctx, captured } = fakeContext()
    await apply(ctx, Config({}))
    const decision = await captured.preExecute!({ name: 'read_file' }, next)
    expect(decision).toEqual({ kind: 'allow' })
    expect(captured.guard!({ name: 'read_file' })).toBeUndefined()
  })

  it('lets enabled observation calls through and logs each observation', async () => {
    const { ctx, captured, logger } = fakeContext()
    await apply(ctx, Config({ enabledTools: ['snapshot'] }))
    const decision = await captured.preExecute!({ name: publicName('snapshot') }, next)
    expect(decision).toEqual({ kind: 'allow' })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(publicName('snapshot')))
  })

  it('asks for approval on observation calls when configured', async () => {
    const { ctx, captured } = fakeContext()
    await apply(ctx, Config({ enabledTools: ['snapshot'], requireApproval: true }))
    const decision = await captured.preExecute!({ name: publicName('snapshot') }, next)
    expect(decision).toEqual(expect.objectContaining({ kind: 'ask' }))
  })

  it('registers the child shutdown and the backend sweep effect', async () => {
    const { ctx, captured, child } = fakeContext()
    await apply(ctx, Config({}))
    const dispose = captured.disposers.find(entry => entry === child.dispose)
    expect(dispose).toBeDefined()
    // The sweep effect registered one disposer that schedules the delayed cleanup.
    expect(captured.disposers.length).toBeGreaterThanOrEqual(2)
  })
})
