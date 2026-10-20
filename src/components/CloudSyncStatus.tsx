import { Cloud } from 'lucide-react'
import { useEffect, useState } from 'react'
import { chapterDrafts } from '@/lib/editorDrafts'
import { useChapterStore } from '@/stores/useChapterStore'
import { useCloudDocumentStore } from '@/stores/useCloudDocumentStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useUIStore } from '@/stores/useUIStore'
export function CloudSyncStatus() {
  const { account, result, errorCode, applying, checking, editVersion, syncedVersion } = useCloudDocumentStore()
  const local = useChapterStore((s) => s.saveStatus)
  const project = useProjectStore((s) => s.currentProject)
  const [draft, setDraft] = useState(false)
  useEffect(() => {
    const read = () => {
      try {
        setDraft(chapterDrafts.pending(project || undefined))
      } catch {
        setDraft(true)
      }
    }
    read()
    window.addEventListener('mythpen-draft-changed', read)
    return () => window.removeEventListener('mythpen-draft-changed', read)
  }, [project])
  const zh = useSettingsStore((s) => s.settings.uiLanguage) === 'zh'
  let text = zh ? '已保存到本机' : 'Saved locally'
  if (account?.phase === 'connecting') text = zh ? '等待 Google 授权' : 'Waiting for Google'
  else if (account?.phase === 'connected') {
    if (!project) text = zh ? 'Google 云文档已连接' : 'Google documents connected'
    else if (applying) text = zh ? '正在更新云端稿…' : 'Updating from cloud…'
    else if (errorCode || result?.action === 'error')
      text = zh ? '已保留本机稿 · 等待同步' : 'Local draft kept · waiting to sync'
    else if (result?.action === 'remote-missing')
      text = zh ? '云端暂不可用 · 本机稿已保留' : 'Cloud unavailable · local draft kept'
    else if (local !== 'saved' || draft || editVersion > syncedVersion || result?.pending)
      text = zh ? '正在自动保存同步…' : 'Saving and syncing…'
    else if (result?.action === 'download-ready') text = zh ? '正在接收云端更新…' : 'Receiving cloud update…'
    else if (!result || result.action === 'local') text = zh ? '正在检查云端稿…' : 'Checking cloud document…'
    else text = zh ? '已同步至 Google' : 'Synced to Google'
  } else if (local !== 'saved') text = zh ? '正在保存到本机…' : 'Saving locally…'
  const last = result?.lastSync ? new Date(result.lastSync).toLocaleString() : ''
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] hover:underline"
      title={last ? `${zh ? '上次同步' : 'Last synced'}: ${last}` : text}
      aria-label={text}
      onClick={() => useUIStore.setState({ settingsOpen: true })}
    >
      <Cloud className={`w-3 h-3 ${applying || (checking && result?.pending) ? 'animate-pulse' : ''}`} />
      <span aria-live="polite">{text}</span>
    </button>
  )
}
