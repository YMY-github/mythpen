import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '@/hooks/useT'

export interface Field {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'select' | 'number'
  options?: { value: string; label: string }[]
  required?: boolean
  placeholder?: string
  min?: number
  max?: number
}

interface Props {
  title: string
  fields: Field[]
  initialValues?: Record<string, unknown>
  viewFirst?: boolean
  onSubmit: (values: Record<string, string>) => Promise<void>
  onClose: () => void
}

export function SimpleCreateDialog({ title, fields, initialValues, viewFirst = false, onSubmit, onClose }: Props) {
  const [baseline] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.key, String(initialValues?.[f.key] ?? '')])),
  )
  const [values, setValues] = useState(baseline)
  const [editing, setEditing] = useState(!viewFirst)
  const [submitting, setSubmitting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [fullscreen, setFullscreen] = useState(false)
  const { t } = useT()
  const [error, setError] = useState('')
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const dirty = fields.some((f) => values[f.key] !== baseline[f.key])
  const requestClose = () => {
    if (busy.current) return
    if (dirty) setDiscarding(true)
    else onClose()
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
      }
      if (event.key === 'Tab') {
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) || []),
        ]
        const first = items[0],
          last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    document.addEventListener('keydown', keydown, true)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  })

  const handleSubmit = async () => {
    if (busy.current) return
    for (const f of fields) {
      if (f.required && !values[f.key]?.trim()) {
        setError(t('common.requiredField', { label: f.label }))
        return
      }
      if (f.type === 'number' && values[f.key] !== '') {
        const number = Number(values[f.key])
        if (
          !Number.isInteger(number) ||
          (f.min !== undefined && number < f.min) ||
          (f.max !== undefined && number > f.max)
        ) {
          setError(t('elements.invalidNumber', { label: f.label }))
          return
        }
      }
    }
    busy.current = true
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(values)
      onClose()
    } catch (e) {
      setError((e as Error).message || t('elements.saveFailed'))
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[300] p-3">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        data-unsaved-form={editing || submitting ? 'true' : undefined}
        className={`bg-[var(--canvas-card)] border border-[var(--hairline-light)] rounded-xl p-5 shadow-2xl flex flex-col min-h-0 max-w-full outline-none ${fullscreen ? 'w-full h-full' : 'w-[800px] max-h-[92vh]'}`}
      >
        <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
          <h3 id={`${id}-title`} className="font-display text-xl font-semibold break-words min-w-0">
            {title}
          </h3>
          <button type="button" className="btn-secondary shrink-0 px-3 py-2" onClick={() => setFullscreen(!fullscreen)}>
            {t(fullscreen ? 'elements.restoreSize' : 'elements.fullscreen')}
          </button>
        </div>
        {error && (
          <div role="alert" className="mb-3 p-3 rounded-lg bg-red-500/10 text-red-500 break-words">
            {error}
          </div>
        )}
        <div className="overflow-y-auto min-h-0 space-y-4 pr-2 pb-4 custom-scrollbar">
          {fields.map((f) => {
            const value = values[f.key] || ''
            const options = f.options || []
            return (
              <div key={f.key}>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <label
                    htmlFor={editing ? `${id}-${f.key}` : undefined}
                    className="text-xs font-medium text-[var(--ink-secondary)]"
                  >
                    {f.label}
                  </label>
                  {editing && f.type === 'textarea' && (
                    <button
                      type="button"
                      className="text-xs text-[var(--accent-gold)]"
                      aria-expanded={expanded.has(f.key)}
                      onClick={() =>
                        setExpanded((old) => {
                          const next = new Set(old)
                          if (next.has(f.key)) next.delete(f.key)
                          else next.add(f.key)
                          return next
                        })
                      }
                    >
                      {t(expanded.has(f.key) ? 'elements.collapse' : 'elements.expand')}
                    </button>
                  )}
                </div>
                {!editing ? (
                  <div
                    className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--ink)]"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {f.type === 'select' ? options.find((o) => o.value === value)?.label || value || '—' : value || '—'}
                  </div>
                ) : f.type === 'textarea' ? (
                  <textarea
                    id={`${id}-${f.key}`}
                    className="w-full bg-[var(--canvas-elevated)] border border-[var(--hairline)] rounded p-3 text-sm leading-6 outline-none focus:border-[var(--accent-gold)]"
                    style={{ minHeight: expanded.has(f.key) ? '50vh' : 140, resize: 'vertical' }}
                    placeholder={f.placeholder}
                    value={value}
                    disabled={submitting}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                ) : f.type === 'select' ? (
                  <select
                    id={`${id}-${f.key}`}
                    className="setting-select w-full"
                    value={value}
                    disabled={submitting}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  >
                    <option value="">{t('common.select')}</option>
                    {value && !options.some((o) => o.value === value) && <option value={value}>{value}</option>}
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`${id}-${f.key}`}
                    type={f.type === 'number' ? 'number' : 'text'}
                    min={f.min}
                    max={f.max}
                    step={f.type === 'number' ? 1 : undefined}
                    className="w-full bg-[var(--canvas-elevated)] border border-[var(--hairline)] rounded p-2 text-sm outline-none focus:border-[var(--accent-gold)]"
                    placeholder={f.placeholder}
                    value={value}
                    disabled={submitting}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            )
          })}
        </div>
        {discarding && (
          <div role="alert" className="border-t border-[var(--hairline)] py-3 text-sm">
            <p>{t('elements.unsaved')}</p>
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                className="btn-secondary px-4 py-2 disabled:opacity-40"
                onClick={() => setDiscarding(false)}
              >
                {t('elements.keepEditing')}
              </button>
              <button type="button" className="btn-secondary px-4 py-2 disabled:opacity-40" onClick={onClose}>
                {t('elements.discard')}
              </button>
            </div>
          </div>
        )}
        <div className="flex gap-3 justify-end border-t border-[var(--hairline)] pt-4 shrink-0">
          <button
            type="button"
            className="btn-secondary px-4 py-2 disabled:opacity-40"
            onClick={requestClose}
            disabled={submitting}
          >
            {t(editing ? 'project.cancel' : 'elements.close')}
          </button>
          {editing ? (
            <button
              type="button"
              className="btn-primary px-4 py-2 disabled:opacity-40"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {t(submitting ? 'common.saving' : viewFirst ? 'elements.save' : 'common.create')}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary px-4 py-2 disabled:opacity-40"
              onClick={() => setEditing(true)}
            >
              {t('elements.edit')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
