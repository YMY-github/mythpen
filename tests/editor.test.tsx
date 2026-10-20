// Memory-DOM integration tests: no browser, user desktop or real account.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:5173' })
for (const name of ['window','document','Node','HTMLElement','Event','InputEvent','CompositionEvent','KeyboardEvent','FocusEvent','localStorage','navigator']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: (dom.window as any)[name] })
}
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { EditorContent } = await import('../src/components/EditorContent')
const { useProjectStore } = await import('../src/stores/useProjectStore')
const { useChapterStore } = await import('../src/stores/useChapterStore')
const { chapterDrafts, flushEditors } = await import('../src/lib/editorDrafts')
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
let writes: Record<string, unknown>[]
const originalFetch = globalThis.fetch
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const chapter = { id: 1, volumeId: 1, num: 1, title: '测试章', content: '原稿', outline: '', wordCount: 2, status: 'writing' }
function input(html: string) {
  const editor = container.querySelector('[contenteditable]') as HTMLElement
  editor.innerHTML = html
  editor.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  return editor
}
beforeEach(async () => {
  localStorage.clear(); writes = []
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => { writes.push(JSON.parse(options.body as string)); return Response.json({ ...chapter, ...writes.at(-1) }) }) as typeof fetch
  useProjectStore.setState({ currentProject: '合成作品', projects: [], showProjectList: false })
  useChapterStore.setState({ currentChapter: { ...chapter }, projectName: '合成作品', volumes: [{ id: 1, sortOrder: 1, title: '卷', chapters: [{ ...chapter }] }], saveStatus: 'saved' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root.render(<EditorContent />) })
})
afterEach(async () => {
  localStorage.clear()
  await act(async () => { root.unmount() })
  container.remove(); globalThis.fetch = originalFetch
})
test('a single changed character automatically reaches the chapter API without blur or save click', async () => {
  await act(async () => { input('<p>原稿字</p>'); await wait(650) })
  expect(writes.at(-1)?.content).toBe('原稿字')
  expect(writes.at(-1)?.volume_id).toBe(1)
  expect(useChapterStore.getState().saveStatus).toBe('saved')
})
test('spaces, empty paragraphs and empty manuscripts are not trimmed away', async () => {
  for (const [html, expected] of [['<p> 字 </p><p><br></p><p>尾</p>',' 字 \n\n尾'],['<p> </p>',' '],['','']]) {
    await act(async () => { input(html); await flushEditors('合成作品') })
    expect(writes.at(-1)?.content).toBe(expected)
  }
})
test('an older in-flight save cannot replace or clear newly typed characters', async () => {
  let release: () => void = () => {}
  const blocked = new Promise<void>(resolve => { release = resolve })
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    writes.push(JSON.parse(options.body as string)); if (writes.length === 1) await blocked
    return Response.json(chapter)
  }) as typeof fetch
  await act(async () => { input('<p>原稿甲</p>'); await wait(550) })
  await act(async () => { input('<p>原稿甲乙</p>'); release(); await wait(100) })
  expect(container.querySelector('[contenteditable]')?.textContent).toBe('原稿甲乙')
  expect(writes.map(w => w.content)).toEqual(['原稿甲','原稿甲乙'])
  expect(chapterDrafts.pending()).toBe(false)
})
test('input-method composition is not uploaded until the committed character is ready', async () => {
  const editor = container.querySelector('[contenteditable]') as HTMLElement
  await act(async () => {
    editor.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }))
    input('<p>pin</p>'); await wait(600)
  })
  expect(writes.length).toBe(0)
  await expect(flushEditors('合成作品')).rejects.toThrow('composition')
  await act(async () => {
    editor.innerHTML = '<p>拼</p>'
    editor.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '拼' }))
    await wait(650)
  })
  expect(writes.map(w => w.content)).toEqual(['拼'])
})
test('cloud content refresh reaches the editor even if it had focus, preserving the selected chapter', async () => {
  const editor = container.querySelector('[contenteditable]') as HTMLElement; editor.focus()
  await act(async () => { useChapterStore.setState({ currentChapter: { ...chapter, content: '云端新稿', title: '云标题' } }) })
  expect(editor.textContent).toBe('云端新稿')
  await act(async () => { input('<p>云端新稿字</p>'); await flushEditors('合成作品') })
  expect(writes.at(-1)?.content).toBe('云端新稿字')
  expect(useChapterStore.getState().currentChapter?.title).toBe('云标题')
})
test('connected settings offer automatic documents without version or manual-update controls', async () => {
  const { CloudSyncPanel } = await import('../src/components/CloudSyncPanel')
  const { useCloudDocumentStore } = await import('../src/stores/useCloudDocumentStore')
  useCloudDocumentStore.setState({ account: { configured: true, phase: 'connected', account: 'synthetic@example.test' }, errorCode: null, result: null })
  await act(async () => { root.render(<CloudSyncPanel />) })
  expect(container.textContent).toContain('自动同步已开启')
  for (const old of ['云端历史','开启并立即同步','采用本机版本','保留版本数量','预览历史清理']) expect(container.textContent).not.toContain(old)
  expect(container.querySelector('input[type="number"]')).toBeNull()
})
test('the open gate waits for cloud reconciliation before mounting an editable document', async () => {
  const { CloudDocumentGate } = await import('../src/components/CloudDocumentGate')
  let release: (response: Response) => void = () => {}
  const cloud = new Promise<Response>(resolve => { release = resolve })
  globalThis.fetch = (async (url: string) => url.includes('/documents/open') ? cloud : Response.json([{ id: 1, sort_order: 1, title: '卷', chapters: [chapter] }])) as typeof fetch
  await act(async () => { root.render(<CloudDocumentGate name="合成作品"><p data-editor-ready>可编辑正文</p></CloudDocumentGate>) })
  expect(container.querySelector('[data-editor-ready]')).toBeNull()
  await act(async () => { release(Response.json({ action: 'applied' })); await wait(10) })
  expect(container.querySelector('[data-editor-ready]')).not.toBeNull()
})
test('a local save alone never reports cloud success before an upload is confirmed', async () => {
  const { CloudSyncStatus } = await import('../src/components/CloudSyncStatus')
  const { useCloudDocumentStore } = await import('../src/stores/useCloudDocumentStore')
  useCloudDocumentStore.setState({ account: { configured: true, phase: 'connected', account: 'synthetic@example.test' }, result: { action: 'synced' }, editVersion: 0, syncedVersion: 0 })
  await act(async () => { root.render(<><EditorContent /><CloudSyncStatus /></>) })
  await act(async () => { input('<p>尚未上传的字</p>'); await wait(650) })
  expect(writes.at(-1)?.content).toBe('尚未上传的字')
  expect(container.textContent).toContain('正在自动保存同步')
  expect(container.textContent).not.toContain('已同步至 Google')
  await act(async () => { useCloudDocumentStore.setState(state => ({ syncedVersion: state.editVersion })) })
  expect(container.textContent).toContain('已同步至 Google')
})
