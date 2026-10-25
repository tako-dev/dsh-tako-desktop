import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DesktopBrowserAction } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import * as sharedBrowser from '../src/shared-browser.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

it('registers desktop_browser and routes the executing chat to the live-tab transport', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const transport = {
    run: vi.fn(async (sessionId: string, action: DesktopBrowserAction, _signal: AbortSignal) => {
      expect(sessionId).toBe('shared-session')
      expect(action).toEqual({ action: 'snapshot' })
      return { shared: true, text: 'Shared tab: https://example.test/' }
    }),
    dispose: vi.fn(),
  }
  ctx.provide('attachments', { saveImage: vi.fn() })
  sharedBrowser.apply(ctx, { transport })

  const session = SessionId('shared-session')
  const agent = { id: session, session: { id: session } } as Agent
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('shared-browser-1'),
    name: 'desktop_browser',
    arguments: { action: 'snapshot' },
    agent,
  })
  expect(result.isError).toBe(false)
  expect(result.value).toEqual({ shared: true, text: 'Shared tab: https://example.test/' })
  expect(transport.run).toHaveBeenCalledOnce()
})
