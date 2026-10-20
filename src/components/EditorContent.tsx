import { Pen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/hooks/useT'
import { chapterDrafts, queueChapterDraft, registerEditorSaver } from '@/lib/editorDrafts'
import { useChapterStore } from '@/stores/useChapterStore'
import { useCloudDocumentStore } from '@/stores/useCloudDocumentStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSidebarStore } from '@/stores/useSidebarStore'

function inlineHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}
function renderContent(content: string) {
  return content
    ? content
        .split('\n')
        .map((line) => {
          if (line.startsWith('## ')) return `<h2>${inlineHtml(line.slice(3))}</h2>`
          if (line.startsWith('# ')) return `<h1>${inlineHtml(line.slice(2))}</h1>`
          if (line === '---') return '<hr>'
          return `<p>${line ? inlineHtml(line) : '<br>'}</p>`
        })
        .join('')
    : ''
}
function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (!(node instanceof HTMLElement)) return ''
  const tag = node.tagName.toLowerCase(),
    inner = [...node.childNodes].map(inlineText).join('')
  if (tag === 'br') return '\n'
  if (tag === 'b' || tag === 'strong') return `**${inner}**`
  if (tag === 'i' || tag === 'em') return `*${inner}*`
  if (tag === 'u') return `__${inner}__`
  if (tag === 'code') return `\`${inner}\``
  return inner
}
function extractContent(editor: HTMLElement): string {
  const lines: string[] = []
  let loose = ''
  for (const child of editor.childNodes) {
    if (child instanceof HTMLElement && /^(P|DIV|H1|H2|PRE|HR)$/.test(child.tagName)) {
      if (loose) {
        lines.push(loose)
        loose = ''
      }
      let value = child.childNodes.length === 1 && child.firstChild?.nodeName === 'BR' ? '' : inlineText(child)
      if (child.tagName === 'H1') value = `# ${value}`
      if (child.tagName === 'H2') value = `## ${value}`
      if (child.tagName === 'HR') value = '---'
      if (child.tagName === 'PRE') value = `\`\`\`\n${child.textContent || ''}\n\`\`\``
      lines.push(value)
    } else loose += inlineText(child)
  }
  if (loose || !lines.length) lines.push(loose)
  return lines.join('\n')
}

export function EditorContent() {
  const { fontSize, fontFamily } = useEditorStore()
  const chapter = useChapterStore((s) => s.currentChapter)
  const volumes = useChapterStore((s) => s.volumes)
  const project = useProjectStore((s) => s.currentProject)
  const { t } = useT()
  const editor = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const composing = useRef(false)
  const identity = useRef('')
  const lastSaved = useRef('')
  const saver = useRef<() => Promise<void>>(async () => {})
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState('')
  const titleRef = useRef('')
  const editingTitleRef = useRef(false)
  const key = `${project}:${chapter?.volumeId}:${chapter?.id}`
  const setStatus = useChapterStore.getState().setSaveStatus

  const save = useCallback(async () => {
    if (!project || !chapter || !editor.current) return
    if (composing.current) throw new Error('Input method composition is in progress')
    const content = extractContent(editor.current)
    if (content !== lastSaved.current)
      queueChapterDraft({ project, num: chapter.num, volumeId: chapter.volumeId, data: { content } })
    if (!chapterDrafts.pending(project)) return
    const hasTitle = chapterDrafts
      .entries(project)
      .some(
        ([, draft]) =>
          draft.num === chapter.num && draft.volumeId === chapter.volumeId && draft.data.title !== undefined,
      )
    setStatus('saving')
    try {
      await chapterDrafts.flush(project)
      if (identity.current !== key) return
      const current = editor.current ? extractContent(editor.current) : content
      lastSaved.current = current
      const pending = chapterDrafts.pending(project)
      setStatus(pending ? 'unsaved' : 'saved')
      if (!pending)
        useChapterStore.setState((state) => {
          if (state.currentChapter?.id !== chapter.id || state.projectName !== project) return state
          const updated = {
            ...state.currentChapter,
            content: current,
            title: hasTitle ? titleRef.current : state.currentChapter.title,
          }
          return {
            currentChapter: updated,
            volumes: state.volumes.map((v) => ({
              ...v,
              chapters: v.chapters.map((c) => (c.id === updated.id ? updated : c)),
            })),
          }
        })
    } catch (error) {
      setStatus('unsaved')
      throw error
    }
  }, [project, chapter, key, setStatus])
  saver.current = save
  useEffect(() => registerEditorSaver(() => saver.current()), [])
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void saver.current().catch(() => {})
    }, 500)
  }
  function changed() {
    if (!project || !chapter || !editor.current) return
    try {
      queueChapterDraft({
        project,
        num: chapter.num,
        volumeId: chapter.volumeId,
        data: { content: extractContent(editor.current) },
      })
    } catch {
      useCloudDocumentStore.setState({ errorCode: 'disk-space' })
    }
    setStatus('unsaved')
    if (!composing.current) schedule()
  }
  useEffect(() => {
    if (!editor.current) return
    const switched = identity.current !== key
    if (!switched && (composing.current || (project && chapterDrafts.pending(project)))) return
    const saved = chapter?.content || ''
    const draft =
      switched && project && chapter
        ? chapterDrafts
            .entries(project)
            .find(([, entry]) => entry.num === chapter.num && entry.volumeId === chapter.volumeId)?.[1]
        : null
    const content = typeof draft?.data.content === 'string' ? draft.data.content : saved
    if (switched || extractContent(editor.current) !== content) editor.current.innerHTML = renderContent(content)
    lastSaved.current = saved
    identity.current = key
    if (!editingTitleRef.current) {
      titleRef.current = chapter?.title || ''
      if (!switched) setTitle(chapter?.title || '')
    }
    if (switched) {
      setEditingTitle(false)
      editingTitleRef.current = false
      const restoredTitle = typeof draft?.data.title === 'string' ? draft.data.title : chapter?.title || ''
      setTitle(restoredTitle)
      titleRef.current = restoredTitle
      setStatus(draft ? 'unsaved' : 'saved')
    }
  }, [key, chapter, project, setStatus])
  useEffect(() => {
    const saveNow = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saver.current().catch(() => {})
      }
    }
    window.addEventListener('keydown', saveNow)
    return () => {
      window.removeEventListener('keydown', saveNow)
      if (timer.current) clearTimeout(timer.current)
      if (project) void chapterDrafts.flush(project).catch(() => {})
    }
  }, [project])
  const create = async () => {
    if (project) await useChapterStore.getState().createChapter(project, t('chapter.defaultTitle'))
    useSidebarStore.getState().setActivePage('page-writing')
  }
  return (
    <div className="flex-1 overflow-y-auto px-16 pb-32 pt-12 flex justify-center custom-scrollbar">
      <div
        className="w-full max-w-[var(--editor-max-w)] leading-[1.9] tracking-[0.01em]"
        style={{ fontFamily, fontSize: `${fontSize}px`, color: 'var(--ink)' }}
      >
        {chapter ? (
          <>
            {editingTitle ? (
              <input
                data-cloud-draft="title"
                aria-label={t('editor.clickToEditTitle')}
                className="font-display text-[36px] mb-[1.5em] w-full bg-transparent outline-none"
                value={title}
                onChange={(event) => {
                  const value = event.target.value
                  setTitle(value)
                  titleRef.current = value
                  if (project)
                    queueChapterDraft({ project, num: chapter.num, volumeId: chapter.volumeId, data: { title: value } })
                  setStatus('unsaved')
                  schedule()
                }}
                onBlur={() => {
                  setEditingTitle(false)
                  editingTitleRef.current = false
                  void saver.current().catch(() => {})
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            ) : (
              <button
                type="button"
                className="font-display text-[36px] font-semibold mb-[1.5em] text-left w-full bg-transparent"
                onClick={() => {
                  setTitle(chapter.title)
                  titleRef.current = chapter.title
                  setEditingTitle(true)
                  editingTitleRef.current = true
                }}
              >
                {t('sidebar.chapterTitle', { num: chapter.num, title: title || chapter.title })}
              </button>
            )}
            {/* biome-ignore lint/a11y/useSemanticElements: the rich text toolbar requires contenteditable. */}
            <div
              ref={editor}
              className="editor-body outline-none cursor-text whitespace-pre-wrap"
              contentEditable
              tabIndex={0}
              suppressContentEditableWarning
              role="textbox"
              aria-label={t('editor.startWriting')}
              aria-multiline="true"
              onInput={changed}
              onBlur={() => {
                void saver.current().catch(() => {})
              }}
              onCompositionStart={() => {
                composing.current = true
                if (timer.current) clearTimeout(timer.current)
              }}
              onCompositionEnd={() => {
                composing.current = false
                changed()
              }}
            />
          </>
        ) : (
          <div className="text-center pt-20">
            <p className="text-[var(--ink-mute)] mb-4">
              {volumes.some((v) => v.chapters.length) ? t('editor.chooseChapter') : t('editor.noChaptersYet')}
            </p>
            <button type="button" className="btn-primary px-6 py-2" onClick={create}>
              <Pen className="inline w-3.5 h-3.5 mr-2" />
              {t('editor.writeFirst')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
