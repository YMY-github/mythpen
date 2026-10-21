import { useState } from 'react'
import { type Field, SimpleCreateDialog } from '@/components/SimpleCreateDialog'
import { useT } from '@/hooks/useT'
import { charactersApi, foreshadowsApi, memoriesApi, relationsApi, scienceApi, timelineApi, worldApi } from '@/lib/api'
import { notifyDataChanged } from '@/lib/dataEvents'
import type { Character } from '@/types'

export type ElementKind = 'characters' | 'world' | 'science' | 'foreshadows' | 'relations' | 'memories' | 'timeline'
const apis = {
  characters: charactersApi,
  world: worldApi,
  science: scienceApi,
  foreshadows: foreshadowsApi,
  relations: relationsApi,
  memories: memoriesApi,
  timeline: timelineApi,
}

export function useElementFields(kind: ElementKind, characters: Character[] = []): Field[] {
  const { t } = useT()
  const text = (key: string, label: string, required = false): Field => ({ key, label: t(label), required })
  const long = (key: string, label: string, required = false): Field => ({
    ...text(key, label, required),
    type: 'textarea',
  })
  const select = (key: string, label: string, options: [string, string][]): Field => ({
    key,
    label: t(label),
    type: 'select',
    required: true,
    options: options.map(([value, label]) => ({ value, label: t(label) })),
  })
  switch (kind) {
    case 'characters':
      return [
        text('name', 'pages.name', true),
        text('age', 'pages.age'),
        text('gender', 'pages.gender'),
        long('appearance', 'pages.appearance'),
        long('personality', 'pages.personality'),
        long('background', 'pages.background'),
        long('motivation', 'pages.motivation'),
        long('arc', 'pages.arc'),
        long('ext_markers', 'elements.extMarkers'),
        long('notes', 'elements.notes'),
      ]
    case 'world':
      return [
        select(
          'category',
          'world.category',
          ['location', 'organization', 'concept', 'event', 'technology'].map((v) => [
            v,
            `world.category${v[0].toUpperCase()}${v.slice(1)}`,
          ]),
        ),
        text('name', 'world.name', true),
        long('description', 'world.description'),
        text('tags', 'elements.tags'),
      ]
    case 'science':
      return [
        select(
          'label',
          'science.category',
          ['known', 'extrapolation', 'hypothesis'].map((v) => [v, `science.${v}Label`]),
        ),
        text('name', 'science.name', true),
        long('description', 'science.description'),
        long('references', 'elements.references'),
      ]
    case 'foreshadows':
      return [
        text('title', 'foreshadow.titleField', true),
        long('description', 'foreshadow.descriptionField'),
        select('priority', 'foreshadow.priorityField', [
          ['high', 'foreshadow.priorityHigh'],
          ['normal', 'foreshadow.priorityNormal'],
          ['low', 'foreshadow.priorityLow'],
        ]),
        select(
          'status',
          'foreshadow.statusField',
          ['planted', 'progressing', 'resolved', 'abandoned'].map((v) => [v, `foreshadow.${v}`]),
        ),
        { ...text('expected_resolve_chapter', 'elements.expectedChapter'), type: 'number', min: 0 },
      ]
    case 'memories':
      return [
        select(
          'category',
          'elements.category',
          ['character', 'location', 'item', 'event', 'promise', 'other'].map((v) => [
            v,
            `memory.category${v[0].toUpperCase()}${v.slice(1)}`,
          ]),
        ),
        long('content', 'elements.content', true),
      ]
    case 'timeline':
      return [
        text('year', 'timeline.yearLabel', true),
        text('title', 'timeline.titleLabel', true),
        long('description', 'timeline.descriptionLabel'),
        { ...text('importance', 'timeline.importanceLabel'), type: 'number', min: 1, max: 5 },
      ]
    case 'relations':
      return [
        ...['character_a_id', 'character_b_id'].map(
          (key, index): Field => ({
            key,
            label: t(index ? 'elements.characterB' : 'elements.characterA'),
            type: 'select',
            required: true,
            options: characters.map((c) => ({ value: c.id, label: c.name })),
          }),
        ),
        text('relation_type', 'elements.relationType', true),
        long('description', 'elements.description'),
        { ...text('intensity', 'elements.intensity'), type: 'number', min: 1, max: 5 },
        text('started_at', 'elements.startedAt'),
        text('ended_at', 'elements.endedAt'),
      ]
  }
}

export function useElementDetails(
  kind: ElementKind,
  project: string,
  reload: () => void,
  characters: Character[] = [],
) {
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const fields = useElementFields(kind, characters)
  const { t } = useT()
  return {
    open: (entry: object) => setSelected({ ...entry }),
    dialog: selected && (
      <SimpleCreateDialog
        key={`${project}:${selected.id}`}
        viewFirst
        title={String(selected.name || selected.title || t(`elements.${kind}`))}
        fields={fields}
        initialValues={selected}
        onClose={() => setSelected(null)}
        onSubmit={async (values) => {
          const data: Record<string, string | number> = {}
          for (const field of fields) {
            if (values[field.key] === String(selected[field.key] ?? '')) continue
            data[field.key] =
              field.type === 'number'
                ? values[field.key] === ''
                  ? field.key === 'expected_resolve_chapter'
                    ? 0
                    : 3
                  : Number(values[field.key])
                : values[field.key]
          }
          // Editing one field must not overwrite another field changed by the AI
          // or a background refresh after this dialog was opened.
          if (Object.keys(data).length) {
            await apis[kind].update(project, String(selected.id), data)
            notifyDataChanged('stats')
            if (kind === 'characters') notifyDataChanged('character')
          }
          setSelected(null)
          reload()
        }}
      />
    ),
  }
}

// Explicit entry point is available on every card, including keyboard navigation.
export function ElementDetailsButton({ onClick }: { onClick: () => void }) {
  const { t } = useT()
  return (
    <button type="button" className="btn-secondary mt-3 px-3 py-1.5 text-xs" onClick={onClick}>
      {t('elements.viewEdit')}
    </button>
  )
}
