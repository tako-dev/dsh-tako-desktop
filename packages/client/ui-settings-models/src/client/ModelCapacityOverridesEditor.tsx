/** Sparse user capacity overrides over a provider-owned model catalog. */
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Token-capacity fields whose absence restores the catalog value. */
export type CapacityField = 'contextWindow' | 'maxTokens'

/**
 * Read an optional object from a redacted settings document.
 * @param value - serialized settings value, absent when the layer has no override.
 * @returns its fields, or an empty object for an absent or non-object value.
 */
export function overrideRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Data and actions for the user-owned fields of a synchronized model catalog. */
interface ModelCapacityOverridesEditorProps {
  models: readonly DeepSeekModelDraft[]
  overrides: Record<string, unknown>
  inheritedOverrides: Record<string, unknown>
  defaultContextWindow: number | undefined
  defaultMaxTokens: number | undefined
  disabled: boolean
  t: (key: ModelsKey) => string
  onFieldChange: (id: string, field: CapacityField, value: number | undefined) => void
  onReset: (id: string) => void
}

/**
 * Edit capacities without copying catalog metadata into the user layer.
 * @param props - latest catalog, sparse user values, inherited values, and writes.
 * @returns a per-model disclosure with field-level restore actions.
 */
export function ModelCapacityOverridesEditor(props: ModelCapacityOverridesEditorProps): ReactNode {
  const { models, overrides, inheritedOverrides, disabled, t } = props
  const errorId = useId()
  const [editing, setEditing] = useState<ReadonlyMap<string, ReadonlyMap<CapacityField, string>>>(() => new Map())
  const ids = new Set(models.flatMap(model => typeof model['id'] === 'string' ? [model['id']] : []))
  const rows: readonly DeepSeekModelDraft[] = [
    ...models,
    ...Object.keys(overrides).filter(id => !ids.has(id)).map(id => ({ id })),
  ]
  const clearBuffer = (id: string, field?: CapacityField): void => {
    setEditing((current) => {
      const next = new Map(current)
      if (field === undefined) next.delete(id)
      else {
        const fields = new Map(next.get(id))
        fields.delete(field)
        next.set(id, fields)
      }
      return next
    })
  }
  return (
    <section className={styles['modelCatalog']} aria-label={t('modelCapacityOverrides')}>
      <div className={styles['modelCatalogHeading']}>
        <span className={styles['modelCatalogTitle']}>{t('modelCapacityOverrides')}</span>
        <p className={styles['advancedHint']}>{t('modelOverridesHint')}</p>
      </div>
      <div className={styles['modelList']}>
        {rows.map((model) => {
          const id = model['id']
          if (typeof id !== 'string') return null
          const own = overrideRecord(overrides[id])
          const inherited = overrideRecord(inheritedOverrides[id])
          const available = ids.has(id)
          const customized = own['contextWindow'] !== undefined || own['maxTokens'] !== undefined
          return (
            <details key={id} className={styles['modelEntry']}>
              <summary className={styles['capacityOverrideSummary']}>
                <span className={styles['capacityOverrideIdentity']}>{id}</span>
                <span className={styles['modelCatalogMeta']}>
                  {t(!available ? 'modelOverrideUnavailable' : customized ? 'modelValueCustom' : 'modelValueInherited')}
                </span>
              </summary>
              {!customized ? null : (
                <button
                  type="button" className={styles['linkButton']} disabled={disabled}
                  aria-label={t('resetModelOverride').replace('{model}', () => id)}
                  onClick={() => { clearBuffer(id); props.onReset(id) }}
                >
                  {t('restoreInheritance')}
                </button>
              )}
              {!available ? null : (
                <div className={styles['modelAdvanced']}>
                  {(['contextWindow', 'maxTokens'] as const).map((field) => {
                    const fallback = field === 'contextWindow' ? props.defaultContextWindow : props.defaultMaxTokens
                    const inheritedValue = inherited[field] ?? model[field] ?? fallback
                    const value = own[field] ?? inheritedValue
                    const text = editing.get(id)?.get(field)
                      ?? (typeof value === 'number' ? formatCapacity(value) : '')
                    const parsed = parseCapacity(text)
                    const invalid = parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed <= 0)
                    const label = `${t(field)} · ${id}`
                    const messageId = `${errorId}-${field}-${id}`
                    return (
                      <div className={styles['modelField']} key={field}>
                        <label className={styles['modelField']}>
                          <span className={styles['modelFieldLabel']}>{t(field)}</span>
                          <input
                            className={styles['input']} type="text" inputMode="decimal"
                            aria-label={label} aria-invalid={invalid}
                            aria-describedby={invalid ? messageId : undefined}
                            value={text} disabled={disabled}
                            placeholder={typeof inheritedValue === 'number' ? formatCapacity(inheritedValue) : t(field === 'contextWindow' ? 'contextWindowPlaceholder' : 'maxTokensPlaceholder')}
                            onChange={(event) => {
                              const text = event.target.value
                              setEditing(current => new Map(current).set(id, new Map(current.get(id)).set(field, text)))
                              props.onFieldChange(id, field, parseCapacity(text))
                            }}
                            onBlur={() => { if (!invalid) clearBuffer(id, field) }}
                          />
                        </label>
                        <div className={styles['capacityOverrideStatus']}>
                          <span className={styles['modelCatalogMeta']}>
                            {t(own[field] === undefined ? 'modelValueInherited' : 'modelValueCustom')}
                          </span>
                          {own[field] === undefined ? null : (
                            <button
                              type="button" className={styles['linkButton']} disabled={disabled}
                              aria-label={t('resetModelCapacity').replace('{field}', () => t(field)).replace('{model}', () => id)}
                              onClick={() => { clearBuffer(id, field); props.onFieldChange(id, field, undefined) }}
                            >
                              {t('restoreInheritance')}
                            </button>
                          )}
                        </div>
                        {invalid ? <p id={messageId} className={styles['error']} role="alert">{t(field === 'contextWindow' ? 'modelContextInvalid' : 'modelMaxTokensInvalid')}</p> : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </details>
          )
        })}
      </div>
    </section>
  )
}
