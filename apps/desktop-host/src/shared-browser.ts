/** Model tools for the user's explicitly shared Desktop tab. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { createBrowserTransport, type BrowserTransport } from './browser-transport.ts'

/** Cordis identity for the Desktop-owned bridge. */
export const name = 'desktop-shared-browser'
/** Services used to dispatch and durably present browser results. */
export const inject = ['tools', 'attachments']

/** Private application composition; tests replace only the cross-process transport. */
export interface Config {
  /** Owned transport; absent in production to select process IPC. */
  transport?: BrowserTransport
}

/** @param ctx - Desktop Host scope. @param config - optional injected shell transport. */
export function apply(ctx: Context, config: Config = {}): void {
  const transport = config.transport ?? createBrowserTransport()
  ctx.effect(() => () => { transport.dispose() }, 'desktop-browser.transport')
  ctx.tools.register(defineTool({
    name: 'desktop_browser',
    description: 'Operate the user’s live Browser tab shared with this chat, including its existing login and page state. '
      + 'Check status before browser work. When shared, use this tool instead of the isolated browser. '
      + 'Only the user can share a tab. Snapshot gives text and CSS selectors; screenshot gives an image. '
      + 'Evaluate runs a JavaScript expression in the page (use an async IIFE for multiple actions); do not schedule future work. '
      + 'Click uses viewport CSS coordinates; type inserts text into the focused field; press uses an Electron key name. '
      + 'Scroll uses x/y deltas in CSS pixels. Inspect the result after actions; cancellation cannot undo completed page changes.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'snapshot', 'evaluate', 'navigate', 'click', 'type', 'press', 'scroll', 'screenshot'] },
      value: { type: 'string', description: 'URL for navigate, JavaScript expression for evaluate, text for type, key name for press.' },
      x: { type: 'number', description: 'Click x coordinate or horizontal scroll delta.' },
      y: { type: 'number', description: 'Click y coordinate or vertical scroll delta.' },
    },
    timeoutMs: 25_000,
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          shared: { type: 'boolean', required: true }, text: { type: 'string', required: true },
          image: { type: 'object', additionalProperties: false, properties: {
            attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true },
            bytes: { type: 'number', required: true }, width: { type: 'number', required: true }, height: { type: 'number', required: true },
            name: { type: 'string' },
          } },
        },
      },
      render: (_args, value) => {
        const content: ContentBlock[] = [{ type: 'text', text: value.text }]
        if (value.image !== undefined) content.push({ type: 'image', attachment: value.image as ImageAttachmentRef })
        return content
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('Shared browser requires the calling chat.')
      const result = await transport.run(String(exec.agent.session.id), args, exec.signal)
      exec.signal.throwIfAborted()
      const image = result.image === undefined ? undefined : await ctx.attachments.saveImage({
        data: Uint8Array.from(Buffer.from(result.image, 'base64')), mediaType: 'image/png', name: 'shared-browser.png',
      })
      return { shared: result.shared, text: result.text, ...image === undefined ? {} : { image } }
    },
    presentCall: args => ({ card: 'generic', title: `Shared browser: ${args.action}`, kind: args.action === 'snapshot' || args.action === 'status' ? 'read' : 'execute' }),
  }))
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.agent === undefined || !/^mcp__(playwright-mcp|chrome-devtools-mcp)__/.test(exec.name)) return next()
    const result = await transport.run(String(exec.agent.session.id), { action: 'status' }, exec.signal)
    if (result.shared) throw new Error('This chat shares the user’s live browser tab. Use desktop_browser for that page; the isolated browser has different state.')
    return next()
  })
}
