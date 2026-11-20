/**
 * Observation-only Windows computer use: mounts the pinned upstream
 * `dsh-computer-use-win` MCP server (PowerShell UIA backend) through
 * `dsh-mcp-client` with only read-side tools enabled. Every input, mutation,
 * activation, launch, batch, and tool-management tool is refused in config
 * validation and re-refused by a pre-dispatch guard, so a refused call never
 * reaches the upstream process and never truncates an in-flight upstream
 * `finally` (drag release, dialog restore).
 * @module
 */

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import z from '@deepseek-ai/schemastery'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis plugin identity for the observation-only Windows computer-use adapter. */
export const name = 'desktop-computer-use-win'

/** The shared tool registry must exist before discovery and guards mount. */
export const inject = ['tools']

/** Pinned upstream runtime this adapter drives. */
export const UPSTREAM_PACKAGE = 'dsh-computer-use-win'

/** Read-side tool names the upstream MCP server may expose through this adapter. */
export const OBSERVATION_TOOLS = [
  'health', 'snapshot', 'accessibility_tree', 'list_windows', 'find', 'element_info',
  'wait', 'ocr', 'screenshot', 'wait_for',
] as const

/** One observation tool name. */
export type ObservationTool = typeof OBSERVATION_TOOLS[number]

/**
 * Every upstream tool that reads or changes desktop state beyond observation:
 * input injection, window and value mutation, app launch, batching, and the
 * server's own tool-management entry. Config and dispatch refuse each of them.
 */
export const REFUSED_TOOLS = [
  'click', 'double_click', 'move', 'drag', 'scroll', 'type_text', 'keypress',
  'focus', 'invoke', 'set_value', 'activate_window', 'close_window',
  'move_window', 'launch_app', 'batch', 'tools',
] as const

/** One refused tool name. */
export type RefusedTool = typeof REFUSED_TOOLS[number]

/** Local namespace the adapter reserves for upstream tools (`mcp__wincu__*`). */
export const SERVER_NAME = 'wincu'

const OBSERVATION_SET: ReadonlySet<string> = new Set(OBSERVATION_TOOLS)
const REFUSED_SET: ReadonlySet<string> = new Set(REFUSED_TOOLS)
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`

/**
 * Model-facing public name one raw upstream tool takes under this adapter's
 * namespace; `wincu` is short enough that normalization never hashes.
 * @param rawName - Raw tool name the upstream server declares.
 * @returns The registered tool name.
 */
export function publicName(rawName: string): string {
  return `${TOOL_PREFIX}${rawName}`
}

/** The refusal every refused tool name produces, in config and at dispatch. */
export function refusalReason(rawName: string): string {
  return `windows computer-use tool ${JSON.stringify(rawName)} is refused: this package mounts the upstream server observation-only, and ${JSON.stringify(rawName)} changes desktop state`
}

/**
 * Resolve the upstream `mcp/server.mjs` entry inside the installed
 * `dsh-computer-use-win` package, whose manifest `os` gate and `files` list
 * keep the path stable.
 * @param from - package.json the resolution anchors on.
 * @returns Absolute path of the stdio server entry.
 */
export function resolveUpstreamServer(from: string): string {
  const manifest = createRequire(from).resolve(`${UPSTREAM_PACKAGE}/package.json`)
  return join(dirname(manifest), 'mcp', 'server.mjs')
}

/** Adapter configuration. */
export interface Config {
  /**
   * Observation tools the server may register; defaults to every observation
   * tool. Naming a refused tool rejects the entry before any process starts.
   */
  enabledTools: string[]
  /** Per-call timeout in milliseconds; omission uses the MCP client's default. */
  toolCallTimeoutMs?: number
  /** Ask the approval seam before each observation call; default off. */
  requireApproval: boolean
  /** Reconnection overrides; defaults to the MCP client's policy. */
  reconnect: McpClient.ReconnectConfig
}

/**
 * Validate adapter options: `enabledTools` admits observation names only, so a
 * refused name fails the entry during config validation, before the MCP child,
 * temporary state, or the UIA backend can come up.
 */
export const Config: z<Partial<Config>, Config> = z.object({
  enabledTools: z.transform(z.array(String), (value) => {
    for (const entry of value) {
      if (REFUSED_SET.has(entry)) throw new Error(refusalReason(entry))
      if (!OBSERVATION_SET.has(entry)) {
        throw new Error(`windows computer-use tool ${JSON.stringify(entry)} is unknown to the pinned upstream server`)
      }
    }
    return value
  }).default([...OBSERVATION_TOOLS]),
  toolCallTimeoutMs: z.number().min(1),
  requireApproval: z.boolean().default(false),
  reconnect: z.object({
    enabled: z.boolean(),
    initialDelayMs: z.number().min(1),
    maxDelayMs: z.number().min(1),
    maxAttempts: z.number().min(1).step(1),
  }),
})

/** PowerShell backend names the upstream server leaves behind when it exits badly. */
const BACKEND_SCRIPT = 'windows-uia.ps1'

/**
 * Best-effort sweep of upstream PowerShell backends still alive after the MCP
 * child exits. Runs only on Windows, tolerates a missing `powershell.exe`,
 * and never throws: an unload that could not finish cleanup reports a warning
 * instead of failing the profile shutdown.
 * @param serverPath - The `mcp/server.mjs` path whose sibling script names the backend.
 * @returns Resolves once the sweep attempt finished.
 */
export async function sweepBackendProcesses(serverPath: string): Promise<void> {
  if (process.platform !== 'win32') return
  const script = join(dirname(serverPath), '..', 'scripts', BACKEND_SCRIPT)
  await new Promise<void>((resolvePromise) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process -Filter "Name like \'powershell%.exe\' or Name = \'pwsh.exe\'"'
        + ' | Where-Object { $_.CommandLine -like $env:DSH_WCU_BACKEND + \'*\' }'
        + ' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    ], {
      env: { ...process.env, DSH_WCU_BACKEND: script },
      windowsHide: true,
      timeout: 15_000,
    }, () => { resolvePromise() })
  })
}

/**
 * Mount the upstream MCP server with observation tools only and guard every
 * refused name before dispatch. A refused call returns a clean denial inside
 * the tool pipeline; the upstream server never sees it, and a cancellation
 * during refusal cannot interrupt an upstream `finally` mid-drag.
 * @param ctx - context providing the tool registry.
 * @param config - validated adapter configuration.
 * @returns initial MCP tool-discovery completion.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const serverPath = resolveUpstreamServer(import.meta.filename)
  const allowed = new Set(config.enabledTools.map(tool => publicName(tool)))

  // Per-action audit: every call that touches this server's namespace is
  // decided here, before any upstream dispatch, and the decision is logged.
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next) => {
    if (!exec.name.startsWith(TOOL_PREFIX)) return next()
    const rawName = exec.name.slice(TOOL_PREFIX.length)
    if (REFUSED_SET.has(rawName)) {
      const reason = refusalReason(rawName)
      ctx.logger.warn(`${name}: refused ${exec.name}: ${reason}`)
      return { kind: 'deny', reason }
    }
    if (!allowed.has(exec.name)) return next()
    if (config.requireApproval) {
      return { kind: 'ask', reason: `observe the Windows desktop through ${rawName}` }
    }
    ctx.logger.info(`${name}: observation ${exec.name}`)
    return next()
  })

  // A monotonic guard repeats the refusal behind any listener that re-allows
  // it: ordering can never turn a refused input tool back into permission.
  ctx.effect(() => ctx.tools.guard((exec) => {
    if (!exec.name.startsWith(TOOL_PREFIX)) return undefined
    const rawName = exec.name.slice(TOOL_PREFIX.length)
    if (!REFUSED_SET.has(rawName)) return undefined
    return refusalReason(rawName)
  }), `${name}.observation-guard`)

  const connection = McpClient.Config({
    transport: 'stdio',
    serverName: SERVER_NAME,
    command: process.execPath,
    args: [serverPath],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      WCU_IMAGE_MODE: 'file',
      WCU_TOOL_MODE: 'full',
      WCU_ENABLED_TOOLS: JSON.stringify([...config.enabledTools]),
    },
    ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
    reconnect: config.reconnect,
    failOnStartupError: true,
  })
  // One effect orders the child shutdown before the lazy backend sweep; the
  // server owns its PowerShell children on a clean exit, so the sweep runs
  // unrefereed afterward for the exit paths that leave them.
  let child!: Fiber
  ctx.effect(function* () {
    child = ctx.plugin(McpClient, connection)
    yield child.dispose
  }, `${name}.connection`)
  ctx.effect(() => () => {
    const timer = setTimeout(() => { void sweepBackendProcesses(serverPath) }, 1500)
    timer.unref()
  }, `${name}.backend-sweep`)
  await child.await()
}
