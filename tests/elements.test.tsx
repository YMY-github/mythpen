import { afterEach, beforeEach, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:5173' })
for (const name of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'InputEvent', 'KeyboardEvent', 'localStorage', 'navigator']) Object.defineProperty(globalThis, name, { configurable: true, value: (dom.window as any)[name] })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { act } = React
const { createRoot } = await import('react-dom/client')
const { useProjectStore } = await import('../src/stores/useProjectStore')
const { setLanguage } = await import('../src/i18n')
const { Characters } = await import('../src/pages/Characters')
const { World } = await import('../src/pages/World')
const { Science } = await import('../src/pages/Science')
const { Foreshadows } = await import('../src/pages/Foreshadows')
const { Memory } = await import('../src/pages/Memory')
const { Timeline } = await import('../src/pages/Timeline')
const { Relations } = await import('../src/pages/Relations')
const { SimpleCreateDialog } = await import('../src/components/SimpleCreateDialog')
const { notifyDataChanged } = await import('../src/lib/dataEvents')
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
let records: Record<string, any[]>, writes: any[], fail = false
const originalFetch = globalThis.fetch
const longText = '第一行\n\n' + '很长的设定描述。'.repeat(1000) + '\n最后一行 '
const wait = () => new Promise(resolve => setTimeout(resolve, 15))
function button(label: string, host: ParentNode = container) { const result = [...host.querySelectorAll('button')].find(b => b.textContent === label); if (!result) throw new Error('Missing button: ' + label); return result }
async function click(label: string, host: ParentNode = container) { await act(async () => { button(label, host).click(); await wait() }) }
function field(label: string) {
  const element = [...container.querySelectorAll('label')].find(l => l.textContent === label)
  if (!element) throw new Error('Missing label: ' + label)
  return document.getElementById(element.htmlFor) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
}
async function change(label: string, value: string) {
  const element = field(label)
  const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
beforeEach(() => {
  setLanguage('zh'); fail = false; writes = []
  records = {
    characters: [{ id: 'character-a', name: '人物甲', background: longText, age: '20', notes: '备注' }, { id: 'character-b', name: '人物乙' }],
    world: [{ id: 'world', name: '世界条目', category: 'technology', description: longText, tags: '保留标签' }],
    science: [{ id: 'science', name: '科学条目', label: 'known', description: longText, references: '参考一' }],
    foreshadows: [{ id: 'foreshadows', title: '伏笔条目', description: longText, status: 'planted', priority: 'normal', expected_resolve_chapter: 5 }],
    memories: [{ id: 'memories', content: longText, category: 'promise', source_chapter_id: 7 }],
    timeline: [{ id: 'timeline', year: '元年', title: '时间条目', description: longText, importance: 3 }],
    relations: [{ id: 'relations', character_a_id: 'character-a', character_b_id: 'character-b', relation_type: '朋友', description: longText, intensity: 3, started_at: '元年', ended_at: '' }], chapters: [],
  }
  useProjectStore.setState({ currentProject: '测试作品', projects: [], showProjectList: false })
  globalThis.fetch = (async (url: string, options: RequestInit = {}) => {
    const parts = decodeURIComponent(url).split('/'), kind = parts[3]
    if (options.method === 'PUT') {
      const data = JSON.parse(String(options.body)); writes.push({ kind, id: parts[4], data })
      if (fail) return Response.json({ error: { message: '合成保存失败' } }, { status: 500 })
      records[kind] = records[kind].map(row => row.id === parts[4] ? { ...row, ...data } : row)
      return Response.json({ success: true })
    }
    return Response.json(records[kind] || [])
  }) as typeof fetch
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch })
const pages = [
  ['characters', Characters, '背景', 'background'], ['world', World, '描述', 'description'], ['science', Science, '描述', 'description'], ['foreshadows', Foreshadows, '描述', 'description'], ['memories', Memory, '内容', 'content'], ['timeline', Timeline, '描述', 'description'], ['relations', Relations, '详细说明', 'description'],
] as const
for (const [kind, Page, label, key] of pages) {
  test(`${kind}: read full text, edit original, save then reopen without creating duplicates`, async () => {
    await act(async () => { root.render(<Page />); await wait() })
    await click('查看全文 / 编辑')
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(longText)
    await click('编辑')
    expect(field(label).value).toBe(longText)
    const modified = longText + '\n补充修改'
    await change(label, modified)
    expect(container.querySelector('[data-unsaved-form="true"]')).not.toBeNull()
    await click('保存修改')
    expect(writes.length).toBe(1)
    expect(writes[0].id).toBe(records[kind][0].id)
    expect(writes[0].data[key]).toBe(modified)
    await click('查看全文 / 编辑')
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(modified)
  })
}
test('cancel asks before discarding and never writes; failed save preserves inputs and can retry', async () => {
  await act(async () => { root.render(<World />); await wait() }); await click('查看全文 / 编辑'); await click('编辑')
  await change('描述', '未保存输入')
  await click('取消'); expect(container.textContent).toContain('有尚未保存的修改'); expect(writes.length).toBe(0)
  await click('继续编辑'); expect(field('描述').value).toBe('未保存输入')
  fail = true; await click('保存修改')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('合成保存失败')
  expect(field('描述').value).toBe('未保存输入')
  fail = false; await click('保存修改'); expect(records.world[0].description).toBe('未保存输入')
  await click('查看全文 / 编辑'); await click('编辑'); await change('描述', '要丢弃的内容'); await click('取消'); await click('放弃修改并关闭')
  expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(records.world[0].description).toBe('未保存输入')
})
test('data refresh keeps a dirty dialog mounted; the second selected character stays selected after saving', async () => {
  await act(async () => { root.render(<Characters />); await wait() })
  const second = [...container.querySelectorAll('div')].find(node => node.className.includes('truncate') && node.textContent === '人物乙')!
  await act(async () => { (second.parentElement!.parentElement as HTMLElement).click(); await wait() })
  await click('查看全文 / 编辑'); await click('编辑'); await change('姓名', '人物乙改名')
  await act(async () => { notifyDataChanged('character'); await wait() })
  expect(field('姓名').value).toBe('人物乙改名')
  await click('保存修改'); expect(writes[0].id).toBe('character-b')
  await click('查看全文 / 编辑'); expect(container.querySelector('[role="dialog"]')?.textContent).toContain('人物乙改名')
})
test('fullscreen, textarea expansion, keyboard close and preventing close during save', async () => {
  let release: () => void = () => {}, submits = 0, closes = 0
  const pending = new Promise<void>(resolve => { release = resolve })
  await act(async () => root.render(<SimpleCreateDialog title="测试详情" fields={[{ key: 'text', label: '正文', type: 'textarea' }]} initialValues={{ text: longText }} viewFirst onSubmit={async () => { submits++; await pending }} onClose={() => { closes++ }} />))
  await click('全屏'); expect(container.querySelector('[role="dialog"]')?.className).toContain('h-full')
  await click('编辑'); await click('展开编辑'); expect(field('正文').style.minHeight).toBe('50vh')
  await change('正文', '')
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(closes).toBe(0); await click('继续编辑')
  await act(async () => { button('保存修改').click(); button('保存修改').click(); await wait() })
  expect(submits).toBe(1)
  await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait() })
  expect(closes).toBe(0)
  await act(async () => { release(); await wait() }); expect(closes).toBe(1)
})
test('editing a foreshadow moves it to the resolved and abandoned columns', async () => {
  await act(async () => { root.render(<Foreshadows />); await wait() }); await click('查看全文 / 编辑'); await click('编辑'); await change('状态', 'resolved'); await click('保存修改')
  expect(records.foreshadows[0].status).toBe('resolved')
  await click('查看全文 / 编辑'); await click('编辑'); await change('状态', 'abandoned'); await click('保存修改')
  expect(container.textContent).toContain('已放弃'); await click('查看全文 / 编辑'); expect(container.querySelector('[role="dialog"]')).not.toBeNull()
})
test('cloud download waits for an open edit dialog even after focus moves to its buttons', async () => {
  const { startCloudDocuments } = await import('../src/lib/cloudDocuments')
  const { useCloudDocumentStore } = await import('../src/stores/useCloudDocumentStore')
  const { useChapterStore } = await import('../src/stores/useChapterStore')
  const { useAgentStore } = await import('../src/stores/useAgentStore')
  const hidden = Object.getOwnPropertyDescriptor(document, 'hidden')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  await act(async () => { root.render(<World />); await wait() }); await click('查看全文 / 编辑'); await click('编辑'); await change('描述', '尚未提交')
  button('全屏').focus()
  let checks = 0, applies = 0
  useCloudDocumentStore.setState({ opened: '测试作品', applying: false, account: { phase: 'connected' } as any })
  useChapterStore.setState({ saveStatus: 'saved' }); useAgentStore.setState({ isRunning: false })
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith('/status')) return Response.json({ phase: 'connected' })
    if (url.endsWith('/documents/catalog')) return Response.json({ imported: 0 })
    if (url.endsWith('/documents/check')) { checks++; return Response.json({ action: 'download-ready' }) }
    if (url.endsWith('/documents/apply')) { applies++; return Response.json({ action: 'downloaded' }) }
    return Response.json({})
  }) as typeof fetch
  let stop = () => {}
  try {
    await act(async () => { stop = startCloudDocuments(); await wait() })
    expect(checks).toBe(1); expect(applies).toBe(0); expect(field('描述').value).toBe('尚未提交')
  } finally { stop(); if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete (document as any).hidden }
})
test('an element save still triggers the existing automatic cloud-upload event', async () => {
  let saved = 0
  const listener = () => { saved++ }
  window.addEventListener('mythpen-document-saved', listener)
  try {
    await act(async () => { root.render(<Science />); await wait() }); await click('查看全文 / 编辑'); await click('编辑'); await change('参考资料', '')
    await click('保存修改'); expect(saved).toBe(1); expect(records.science[0].references).toBe('')
  } finally { window.removeEventListener('mythpen-document-saved', listener) }
})
test('saving one field preserves fields changed by AI since the dialog opened', async () => {
  await act(async () => { root.render(<World />); await wait() }); await click('查看全文 / 编辑'); await click('编辑')
  records.world[0].tags = '后台新标签'
  await change('描述', '我编辑的描述'); await click('保存修改')
  expect(writes[0].data).toEqual({ description: '我编辑的描述' }); expect(records.world[0].tags).toBe('后台新标签')
})
test('a character rename refreshes names in the already mounted relationship graph', async () => {
  await act(async () => { root.render(<><section id="characters"><Characters /></section><section id="relations"><Relations /></section></>); await wait() })
  await click('查看全文 / 编辑', container.querySelector('#characters')!)
  await click('编辑'); await change('姓名', '跨页面改名'); await click('保存修改')
  expect(container.querySelector('#relations')?.textContent).toContain('跨页面改名')
  expect(container.querySelector('#relations')?.textContent).not.toContain('人物甲')
})
