import { type TextareaHTMLAttributes, useState } from 'react'
import { useT } from '@/hooks/useT'

export function ExpandableTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [expanded, setExpanded] = useState(false)
  const { t } = useT()
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="text-xs text-[var(--accent-gold)] mb-1"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {t(expanded ? 'elements.collapse' : 'elements.expand')}
      </button>
      <textarea {...props} style={{ ...props.style, ...(expanded ? { minHeight: '50vh' } : {}), resize: 'vertical' }} />
    </div>
  )
}
