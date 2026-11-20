// @vitest-environment jsdom
/** Sparse model-capacity edits preserve catalog and unrelated user fields. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ProviderEditor, pathOps } from '../src/client/ProviderEditor.tsx'
import type { ProviderEditorProps } from '../src/client/ProviderEditor.tsx'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const catalog = [
  { id: 'alpha', name: 'Alpha', contextWindow: 128_000, maxTokens: 8192, input: ['text', 'image'] },
  { id: 'beta', contextWindow: 64_000, maxTokens: 4096 },
]
const schema = Schema.object({
  providers: Schema.dict(Schema.object({
    api: Schema.string(), baseURL: Schema.string(),
    models: Schema.array(Schema.object({ id: Schema.string().required() })),
  })),
  modelCapacityOverrides: Schema.dict(Schema.dict(Schema.object({ contextWindow: Schema.number(), maxTokens: Schema.number() }))),
})

function namespace(capacities: Record<string, JsonValue> = {}, base: Record<string, JsonValue> = {}): SettingsNamespaceView {
  const baseProfile = {
    api: 'openai-completions', baseURL: 'https://fixture.invalid/v1',
    defaultContextWindow: 262_144, defaultMaxTokens: 32_768, models: catalog, ...base,
  }
  return {
    ns: 'llm-pi-ai', schema: JSON.parse(JSON.stringify(schema.toJSON())) as JsonValue,
    base: { providers: { tako: baseProfile } },
    user: { modelCapacityOverrides: { tako: capacities } },
    value: { providers: { tako: baseProfile }, modelCapacityOverrides: { tako: capacities } },
    revision: 3, secrets: [], autoGenerate: true, applies: 'live',
  }
}

function mount(user: Record<string, JsonValue> = {}, base: Record<string, JsonValue> = {}) {
  const view = namespace(user, base)
  const writeSettings = vi.fn(async () => ({ kind: 'written' as const, view }))
  const onClose = vi.fn()
  const props: ProviderEditorProps = {
    provider: 'tako', displayName: 'Tako', declared: true,
    namespace: view, schema: settingsSchema, settingsPath: ['providers', 'tako'],
    operations: {
      writeSettings, storeCredential: vi.fn(), discoverModels: vi.fn(),
      removeCredential: vi.fn(),
    },
    readOnly: false, t: key => en[key], onClose,
  }
  const rendered = render(<ProviderEditor {...props} />)
  fireEvent.click(screen.getByText(en.customized))
  const expand = (id = 'alpha'): void => {
    const summary = screen.getByText(id, { exact: true }).closest('summary')
    if (summary === null) throw new Error(`No disclosure for ${id}`)
    fireEvent.click(summary)
  }
  return { ...rendered, props, writeSettings, onClose, expand }
}

function input(field: 'contextWindow' | 'maxTokens', id = 'alpha'): HTMLInputElement {
  return screen.getByRole('textbox', { name: `${en[field]} · ${id}`, hidden: true })
}

async function save(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: en.apply }))
}

describe('Tako model capacity overrides', () => {
  it('opens inherited values without writing or copying the catalog', async () => {
    const { expand, writeSettings, onClose } = mount()
    expand()
    expect(input('contextWindow').value).toBe('128K')
    expect(input('maxTokens').value).toBe('8192')
    expect(screen.queryByRole('textbox', { name: `${en.modelId} 1` })).toBeNull()
    expect(screen.queryByRole('button', { name: en.addModel })).toBeNull()
    await save()
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writeSettings).not.toHaveBeenCalled()
  })

  it('writes only edited fields and preserves sibling models and hidden override metadata', async () => {
    const original = { alpha: { contextWindow: 100_000 }, beta: { maxTokens: 2000 } }
    const { expand, writeSettings } = mount(original)
    expand()
    fireEvent.change(input('contextWindow'), { target: { value: '256K' } })
    fireEvent.change(input('maxTokens'), { target: { value: '16K' } })
    expect(input('maxTokens').value).toBe('16K')
    await save()
    await waitFor(() => { expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'set', path: ['modelCapacityOverrides', 'tako', 'alpha', 'contextWindow'], value: 256_000 },
      { op: 'set', path: ['modelCapacityOverrides', 'tako', 'alpha', 'maxTokens'], value: 16_000 },
    ], 3) })
    expect(original.alpha.contextWindow).toBe(100_000)
  })

  it('keeps a draft during catalog refresh and restores the latest inherited field', async () => {
    const { expand, rerender, props, writeSettings } = mount({ alpha: { contextWindow: 256_000, maxTokens: 16_000 } })
    expand()
    fireEvent.change(input('contextWindow'), { target: { value: '300000' } })
    const refreshed = catalog.map(model => ({ ...model, contextWindow: 512_000, maxTokens: 32_000 }))
    rerender(<ProviderEditor {...props} namespace={namespace({}, { models: refreshed })} />)
    expect(input('contextWindow').value).toBe('300000')
    fireEvent.click(screen.getByRole('button', { name: en.resetModelCapacity.replace('{field}', en.contextWindow).replace('{model}', 'alpha') }))
    expect(input('contextWindow').value).toBe('512K')
    expect(input('maxTokens').value).toBe('16K')
    await save()
    await waitFor(() => { expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'unset', path: ['modelCapacityOverrides', 'tako', 'alpha', 'contextWindow'] },
    ], 3) })
  })

  it('restores both capacities without deleting sibling overrides', async () => {
    const { expand, writeSettings } = mount({
      alpha: { contextWindow: 256_000, maxTokens: 16_000 },
      beta: { maxTokens: 2000 },
    })
    expand()
    fireEvent.click(screen.getByRole('button', { name: en.resetModelOverride.replace('{model}', 'alpha') }))
    expect(input('contextWindow').value).toBe('128K')
    expect(input('maxTokens').value).toBe('8192')
    await save()
    await waitFor(() => { expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'unset', path: ['modelCapacityOverrides', 'tako', 'alpha'] },
    ], 3) })
  })

  it('clears the last capacity without retaining empty override dictionaries', async () => {
    const { expand, writeSettings } = mount({ alpha: { contextWindow: 256_000 } })
    expand()
    fireEvent.change(input('contextWindow'), { target: { value: '' } })
    fireEvent.blur(input('contextWindow'))
    expect(input('contextWindow').value).toBe('128K')
    await save()
    await waitFor(() => { expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'unset', path: ['modelCapacityOverrides', 'tako', 'alpha'] },
    ], 3) })
  })

  it.each(['0', '-1', '1.5', 'abc', '9007199254740992', '1.0000000000000001', '1.0000000000000001M'])(
    'keeps invalid text %s visible and disables save', async (text) => {
      const { expand, writeSettings } = mount()
      expand()
      fireEvent.change(input('contextWindow'), { target: { value: text } })
      fireEvent.blur(input('contextWindow'))
      expect(input('contextWindow').value).toBe(text)
      expect(input('contextWindow').getAttribute('aria-invalid')).toBe('true')
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.apply }).disabled).toBe(true)
      await save()
      expect(writeSettings).not.toHaveBeenCalled()
    },
  )

  it('cancels without persisting a staged override', () => {
    const { expand, writeSettings, onClose } = mount()
    expand()
    fireEvent.change(input('contextWindow'), { target: { value: '256K' } })
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(onClose).toHaveBeenCalledWith(false)
    expect(writeSettings).not.toHaveBeenCalled()
  })

  it('keeps removed model overrides visible and removable', async () => {
    const { writeSettings } = mount({ removed: { contextWindow: 256_000 } })
    const summary = screen.getByText('removed').closest('details')
    if (summary === null) throw new Error('Missing removed-model entry')
    expect(within(summary).getByText(en.modelOverrideUnavailable)).toBeTruthy()
    fireEvent.click(within(summary).getByText('removed'))
    fireEvent.click(within(summary).getByRole('button', { name: en.resetModelOverride.replace('{model}', 'removed') }))
    expect(screen.queryByText('removed')).toBeNull()
    await save()
    await waitFor(() => { expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'unset', path: ['modelCapacityOverrides', 'tako', 'removed'] },
    ], 3) })
  })

  it('disables capacity and reset actions for read-only settings', () => {
    const { props, rerender, expand, writeSettings } = mount({ alpha: { contextWindow: 256_000 } })
    rerender(<ProviderEditor {...props} readOnly />)
    expand()
    expect(input('contextWindow').disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.resetModelOverride.replace('{model}', 'alpha') }).disabled).toBe(true)
    expect(writeSettings).not.toHaveBeenCalled()
  })
})

describe('model override path operations', () => {
  it('treats a model id spelled modelOverrides as an id rather than a settings field', () => {
    expect(pathOps(['modelCapacityOverrides', 'tako', 'modelOverrides'], {}, { contextWindow: 256_000 }))
      .toEqual([{ op: 'set', path: ['modelCapacityOverrides', 'tako', 'modelOverrides', 'contextWindow'], value: 256_000 }])
  })
})
