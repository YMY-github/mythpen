import { type ReactNode, useEffect, useState } from 'react'
import { openCloudDocument } from '@/lib/cloudDocuments'
import { useChapterStore } from '@/stores/useChapterStore'
import { useCloudDocumentStore } from '@/stores/useCloudDocumentStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
export function CloudDocumentGate({ name, children }: { name: string; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const zh = useSettingsStore((s) => s.settings.uiLanguage) === 'zh'
  useEffect(() => {
    const controller = new AbortController()
    useCloudDocumentStore.setState({ opened: null, result: null })
    openCloudDocument(name, controller.signal)
      .catch(async (error) => {
        if (controller.signal.aborted) return
        useCloudDocumentStore.setState({ errorCode: error.code || 'network' })
        await useChapterStore.getState().loadChapters(name)
        if (!controller.signal.aborted && useProjectStore.getState().currentProject === name)
          useCloudDocumentStore.setState({ opened: name })
      })
      .finally(() => {
        if (!controller.signal.aborted) setReady(true)
      })
    return () => {
      controller.abort()
    }
  }, [name])
  if (!ready)
    return (
      <div role="status" className="flex-1 flex items-center justify-center text-sm text-[var(--ink-tertiary)]">
        {zh ? '正在打开作品并检查云端更新…' : 'Opening document and checking cloud…'}
      </div>
    )
  return <>{children}</>
}
