import { Cloud } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '@/lib/api'
import { useChapterStore } from '@/stores/useChapterStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useUIStore } from '@/stores/useUIStore'

type Account = { phase: string; configured: boolean; message: string }
type Project = {
  enabled: boolean
  auto: boolean
  busy: boolean
  pending: boolean
  action?: string
  lastSync: string | null
}

export function CloudSyncStatus() {
  const name = useProjectStore((s) => s.currentProject)
  const saveStatus = useChapterStore((s) => s.saveStatus)
  const zh = useSettingsStore((s) => s.settings.uiLanguage) === 'zh'
  const [account, setAccount] = useState<Account | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [offline, setOffline] = useState(false)
  const request = useRef(0)

  useEffect(() => {
    let stopped = false
    let pending = false
    setProject(null)
    const sequence = ++request.current
    async function read(path: string) {
      const response = await fetch(apiUrl(`/sync${path}`), { signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error('Cloud status unavailable')
      return response.json()
    }
    async function refresh() {
      if (pending || document.hidden) return
      pending = true
      try {
        const next: Account = await read('/status')
        const state: Project | null =
          name && next.phase === 'connected' ? await read(`/projects/${encodeURIComponent(name)}/status`) : null
        if (!stopped && sequence === request.current) {
          setAccount(next)
          setProject(state)
          setOffline(false)
        }
      } catch {
        if (!stopped) setOffline(true)
      } finally {
        pending = false
      }
    }
    function wake() {
      if (document.hidden) return
      // The backend checks only opted-in auto-sync projects and never applies downloads.
      fetch(apiUrl('/sync/wake'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(90000),
      }).catch(() => {})
      void refresh()
    }
    void refresh()
    const timer = setInterval(refresh, 10000)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [name])

  let text = zh ? '本机保存' : 'Local storage'
  let attention = false
  if (offline) text = zh ? '同步状态暂不可用' : 'Sync status unavailable'
  else if (account?.phase === 'connecting') text = zh ? '等待 Google 授权' : 'Waiting for Google'
  else if (account?.configured && account.phase !== 'connected') text = zh ? 'Google 未连接' : 'Google disconnected'
  else if (project?.enabled) {
    if (project.busy) text = zh ? '正在同步…' : 'Syncing…'
    else if (project.action === 'conflict') {
      text = zh ? '同步冲突 · 请处理' : 'Sync conflict · review'
      attention = true
    } else if (project.action === 'download-ready') {
      text = zh ? '云端有更新 · 查看' : 'Cloud update · review'
      attention = true
    } else if (project.action === 'remote-missing') {
      text = zh ? '云端版本缺失 · 查看' : 'Cloud version missing'
      attention = true
    } else if (project.action === 'error') {
      text = zh ? '同步失败 · 查看' : 'Sync failed · review'
      attention = true
    } else if (saveStatus !== 'saved' || project.pending) text = zh ? '本机改动待同步' : 'Local changes pending'
    else text = zh ? '云端已更新' : 'Cloud up to date'
  } else if (account?.phase === 'connected') text = zh ? 'Google 已连接 · 设置同步' : 'Google connected · set up sync'

  const last = project?.lastSync ? new Date(project.lastSync).toLocaleString() : ''
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] hover:underline"
      style={{ color: attention ? 'var(--accent-gold)' : undefined }}
      onClick={() => useUIStore.setState({ settingsOpen: true })}
      title={last ? `${zh ? '上次同步' : 'Last synced'}: ${last}` : text}
      aria-label={text}
    >
      <Cloud className={`w-3 h-3 ${project?.busy ? 'animate-pulse' : ''}`} />
      <span aria-live="polite">{text}</span>
    </button>
  )
}
