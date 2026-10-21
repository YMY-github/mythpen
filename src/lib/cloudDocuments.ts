import { apiUrl } from '@/lib/api'
import { refreshAllData } from '@/lib/dataEvents'
import { chapterDrafts, flushEditors } from '@/lib/editorDrafts'
import { useAgentStore } from '@/stores/useAgentStore'
import { useChapterStore } from '@/stores/useChapterStore'
import { type CloudAccount, type CloudDocumentResult, useCloudDocumentStore } from '@/stores/useCloudDocumentStore'
import { useProjectStore } from '@/stores/useProjectStore'

export async function cloudCall<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(`/sync${route}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  })
  const data = await response.json()
  if (!response.ok)
    throw Object.assign(new Error('Cloud document request failed'), { code: data.error?.code || 'operation' })
  return data
}
export async function openCloudDocument(name: string, signal: AbortSignal) {
  // Recover durable local edits before reconciling them against cloud state.
  await chapterDrafts.flush(name)
  const result = await cloudCall<CloudDocumentResult>('/documents/open', { name }, signal)
  if (signal.aborted) return
  if (useProjectStore.getState().currentProject === name) {
    await useChapterStore.getState().loadChapters(name)
    if (!signal.aborted && useProjectStore.getState().currentProject === name)
      useCloudDocumentStore.setState((state) => ({
        opened: name,
        result,
        errorCode: null,
        syncedVersion: result.pending ? state.syncedVersion : state.editVersion,
      }))
  }
}
export function startCloudDocuments() {
  const controller = new AbortController()
  let stopped = false,
    running = false,
    lastCatalog = 0
  let soon: ReturnType<typeof setTimeout> | undefined
  async function check() {
    if (stopped || running || document.hidden || useCloudDocumentStore.getState().applying) return
    running = true
    try {
      const account = await cloudCall<CloudAccount>('/status', undefined, controller.signal)
      if (stopped) return
      const previous = useCloudDocumentStore.getState().account
      useCloudDocumentStore.setState({ account })
      if (account.phase !== 'connected') return
      if (previous?.phase !== 'connected') lastCatalog = 0
      if (Date.now() - lastCatalog > 30000) {
        lastCatalog = Date.now()
        const catalog = await cloudCall<{ imported: number }>('/documents/catalog', {}, controller.signal)
        if (catalog.imported) await useProjectStore.getState().loadProjects()
      }
      const name = useProjectStore.getState().currentProject
      if (!name || useCloudDocumentStore.getState().opened !== name || useAgentStore.getState().isRunning) return
      await flushEditors(name)
      if (useChapterStore.getState().saveStatus !== 'saved' || chapterDrafts.pending(name)) return
      useCloudDocumentStore.setState({ checking: true })
      const checkedVersion = useCloudDocumentStore.getState().editVersion
      const result = await cloudCall<CloudDocumentResult>('/documents/check', { name }, controller.signal)
      if (stopped || useProjectStore.getState().currentProject !== name) return
      useCloudDocumentStore.setState((state) => ({
        result,
        errorCode: null,
        syncedVersion:
          ['uploaded', 'synced'].includes(result.action) && !result.pending ? checkedVersion : state.syncedVersion,
      }))
      if (result.action !== 'download-ready') return
      if (document.querySelector('[data-unsaved-form="true"]')) return
      // Defer while another form has focus; its unsubmitted fields are not a
      // saved document yet. Chapter text/title and outline have durable savers.
      const active = document.activeElement
      if (active?.matches('input,textarea,select') && !active.hasAttribute('data-cloud-draft')) return
      if (useAgentStore.getState().isRunning) return
      useCloudDocumentStore.setState({ applying: true })
      await flushEditors(name)
      if (
        useProjectStore.getState().currentProject !== name ||
        chapterDrafts.pending(name) ||
        !!document.querySelector('[data-unsaved-form="true"]') ||
        useAgentStore.getState().isRunning
      )
        return
      const local = await cloudCall<{ currentHash: string }>(
        `/projects/${encodeURIComponent(name)}/local-status`,
        undefined,
        controller.signal,
      )
      const applied = await cloudCall<CloudDocumentResult>(
        '/documents/apply',
        {
          name,
          expectedHash: local.currentHash,
        },
        controller.signal,
      )
      if (useProjectStore.getState().currentProject === name) {
        await refreshAllData(name)
        window.dispatchEvent(new Event('mythpen-cloud-applied'))
        useCloudDocumentStore.setState((state) => ({
          result: applied,
          errorCode: null,
          syncedVersion: state.editVersion,
        }))
      }
    } catch (error) {
      if (!stopped) useCloudDocumentStore.setState({ errorCode: (error as { code?: string }).code || 'network' })
    } finally {
      running = false
      if (!stopped) useCloudDocumentStore.setState({ applying: false, checking: false })
    }
  }
  const wake = () => {
    clearTimeout(soon)
    soon = setTimeout(check, 700)
  }
  const saved = () => {
    useCloudDocumentStore.setState((state) => ({ editVersion: state.editVersion + 1 }))
    wake()
  }
  const timer = setInterval(check, 3000)
  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)
  window.addEventListener('mythpen-draft-changed', wake)
  window.addEventListener('mythpen-document-saved', saved)
  document.addEventListener('visibilitychange', wake)
  void check()
  return () => {
    stopped = true
    controller.abort()
    clearInterval(timer)
    clearTimeout(soon)
    window.removeEventListener('focus', wake)
    window.removeEventListener('online', wake)
    window.removeEventListener('mythpen-draft-changed', wake)
    window.removeEventListener('mythpen-document-saved', saved)
    document.removeEventListener('visibilitychange', wake)
  }
}
