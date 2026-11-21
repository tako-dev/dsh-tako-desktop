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

/**
 * The names the pinned upstream server really advertises for the refused
 * tools (`windows_computer_use_<tool>` under the `wincu` namespace), spelled
 * out here so a broken name mapping cannot pass by matching its own output.
 */
const REFUSED_REGISTERED = [
  'mcp__wincu__windows_computer_use_click',
  'mcp__wincu__windows_computer_use_double_click',
  'mcp__wincu__windows_computer_use_move',
  'mcp__wincu__windows_computer_use_drag',
  'mcp__wincu__windows_computer_use_scroll',
  'mcp__wincu__windows_computer_use_type_text',
  'mcp__wincu__windows_computer_use_keypress',
  'mcp__wincu__windows_computer_use_focus',
  'mcp__wincu__windows_computer_use_invoke',
  'mcp__wincu__windows_computer_use_set_value',
  'mcp__wincu__windows_computer_use_activate_window',
  'mcp__wincu__windows_computer_use_close_window',
  'mcp__wincu__windows_computer_use_move_window',
  'mcp__wincu__windows_computer_use_launch_app',
  'mcp__wincu__windows_computer_use_batch',
  'mcp__wincu__windows_computer_use_tools',
] as const

describe('tool inventory', () => {
  it('covers every upstream name with admission or refusal, disjointly', () => {
    const observation: ReadonlySet<string> = new Set(OBSERVATION_TOOLS)
    const refused: ReadonlySet<string> = new Set(REFUSED_TOOLS)
    for (const name of observation) expect(refused.has(name)).toBe(false)
    expect(observation.size).toBe(OBSERVATION_TOOLS.length)
    expect(refused.size).toBe(REFUSED_TOOLS.length)
  })

  it('names observation tools by their real registered names', () => {
    expect(publicName('snapshot')).toBe('mcp__wincu__windows_computer_use_snapshot')
    expect(publicName('screenshot')).toBe(`mcp__${SERVER_NAME}__windows_computer_use_screenshot`)
  })

  it('maps every refused tool onto its real registered name', () => {
    expect(REFUSED_TOOLS.map(tool => publicName(tool))).toEqual([...REFUSED_REGISTERED])
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

  it.each(REFUSED_TOOLS)('rejects the refused tool %s at config validation in every spelling', (tool) => {
    for (const spelling of [tool, `windows_computer_use_${tool}`, `mcp__wincu__windows_computer_use_${tool}`]) {
      expect(() => Config({ enabledTools: [spelling] })).toThrow('refused')
      expect(() => Config({ enabledTools: ['snapshot', spelling] })).toThrow(JSON.stringify(tool))
    }
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

  it('denies every refused registered name at both pre-dispatch layers and logs the refusal', async () => {
    const { ctx, captured, logger } = fakeContext()
    await apply(ctx, Config({}))
    for (const registered of REFUSED_REGISTERED) {
      const decision = await captured.preExecute!({ name: registered }, next)
      expect(decision).toEqual(expect.objectContaining({ kind: 'deny' }))
      expect((decision as { reason?: string }).reason).toContain('refused')
      expect(captured.guard!({ name: registered })).toContain('refused')
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(registered))
    }
    expect(captured.guard!({ name: 'shell' })).toBeUndefined()
  })

  it('denies unadmitted names inside the wincu namespace instead of forwarding them', async () => {
    const { ctx, captured } = fakeContext()
    await apply(ctx, Config({ enabledTools: ['snapshot'] }))
    for (const registered of [
      'mcp__wincu__windows_computer_use_screenshot',
      'mcp__wincu__windows_computer_use_teleport',
      'mcp__wincu__click',
      'mcp__wincu__windows_computer_use_windows_computer_use_click',
    ]) {
      const decision = await captured.preExecute!({ name: registered }, next)
      expect(decision).toEqual(expect.objectContaining({ kind: 'deny' }))
      expect(captured.guard!({ name: registered })).toEqual(expect.any(String))
    }
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
    const decision = await captured.preExecute!({ name: 'mcp__wincu__windows_computer_use_snapshot' }, next)
    expect(decision).toEqual({ kind: 'allow' })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('mcp__wincu__windows_computer_use_snapshot'))
  })

  it('asks for approval on observation calls when configured', async () => {
    const { ctx, captured } = fakeContext()
    await apply(ctx, Config({ enabledTools: ['snapshot'], requireApproval: true }))
    const decision = await captured.preExecute!({ name: 'mcp__wincu__windows_computer_use_snapshot' }, next)
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
