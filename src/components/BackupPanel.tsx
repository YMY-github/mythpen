import { useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { cloudErrorText } from '@/lib/cloudErrors'
import { refreshAllData } from '@/lib/dataEvents'
import { useAgentStore } from '@/stores/useAgentStore'
import { useChapterStore } from '@/stores/useChapterStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

type Backup = { revisionId: string; createdAt: string; bytes: number; invalid?: boolean }
const base = '__TAURI_INTERNALS__' in window ? 'http://127.0.0.1:3101/api/sync' : '/api/sync'

export function BackupPanel() {
  const zh = useSettingsStore((s) => s.settings.uiLanguage) === 'zh'
  const [projects, setProjects] = useState<{ name: string }[]>([])
  const [name, setName] = useState('')
  const [backups, setBackups] = useState<Backup[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    projectsApi
      .list()
      .then(setProjects)
      .catch(() => setError(zh ? '无法读取作品列表' : 'Unable to load projects'))
  }, [zh])
  useEffect(() => {
    const controller = new AbortController()
    setBackups([])
    if (name)
      readBackups(name, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setBackups(data)
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message)
        })
    return () => controller.abort()
  }, [name])
  async function backup() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${base}/projects/${encodeURIComponent(name)}/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error((await response.json()).error?.message || 'Backup failed')
      setBackups(await readBackups(name))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed')
    } finally {
      setBusy(false)
    }
  }
  async function restoreBackup(revision: Backup) {
    if (useAgentStore.getState().isRunning || useChapterStore.getState().saveStatus !== 'saved') {
      setError(zh ? '请等待写作完成并保存正文，再恢复备份。' : 'Finish writing and save the editor before restoring.')
      return
    }
    if (
      !window.confirm(
        zh
          ? `恢复“${name}”在 ${new Date(revision.createdAt).toLocaleString()} 的本机备份？会先备份当前已保存稿件。`
          : `Restore the local backup of “${name}” from ${new Date(revision.createdAt).toLocaleString()}? Current saved content will be backed up first.`,
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const status = await fetch(`${base}/projects/${encodeURIComponent(name)}/local-status`, {
        signal: AbortSignal.timeout(10000),
      })
      const current = await status.json()
      if (!status.ok) throw new Error(cloudErrorText(current.error?.code, zh))
      const response = await fetch(
        `${base}/projects/${encodeURIComponent(name)}/backups/${revision.revisionId}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedHash: current.currentHash }),
          signal: AbortSignal.timeout(30000),
        },
      )
      if (!response.ok) throw new Error(cloudErrorText((await response.json()).error?.code, zh))
      await refreshAllData()
      setBackups(await readBackups(name))
    } catch (error) {
      setError(error instanceof Error ? error.message : cloudErrorText('operation', zh))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mb-7" aria-label={zh ? '作品备份' : 'Project backups'}>
      {busy && (
        <div role="status" className="fixed inset-0 z-[999] bg-black/60 flex items-center justify-center">
          <p className="bg-[var(--canvas-card)] p-6 rounded">{zh ? '正在处理本机备份…' : 'Processing local backup…'}</p>
        </div>
      )}
      <h3 className="text-sm font-medium mb-2">
        {zh ? '作品备份 · 开发预览' : 'Project backups · Development preview'}
      </h3>
      <p className="text-xs text-[var(--ink-mute)] mb-3">
        {zh
          ? '本机备份独立于云端同步。备份包含已保存内容，不包含登录凭证。'
          : 'Local backups are independent of cloud sync. They contain saved content and exclude credentials.'}
      </p>
      <select
        disabled={busy}
        aria-label={zh ? '选择作品' : 'Select project'}
        value={name}
        onChange={(e) => {
          setError('')
          setName(e.target.value)
        }}
        className="w-full mb-2 bg-[var(--canvas-elevated)] p-2 rounded"
      >
        <option value="">{zh ? '选择作品' : 'Select project'}</option>
        {projects.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!name || busy}
        onClick={backup}
        className="px-3 py-2 rounded bg-[var(--accent-gold)] text-[var(--canvas)] disabled:opacity-40"
      >
        {busy ? (zh ? '正在备份…' : 'Backing up…') : zh ? '创建本机备份' : 'Create local backup'}
      </button>
      {error && (
        <p role="alert" className="text-sm mt-2">
          {error}
        </p>
      )}
      <ul className="mt-2 text-xs">
        {backups.slice(0, 10).map((b) => (
          <li key={b.revisionId}>
            {b.invalid
              ? zh
                ? '备份损坏或不兼容，已保留文件。'
                : 'Damaged or incompatible backup; file retained.'
              : `${new Date(b.createdAt).toLocaleString()} · ${Math.ceil(b.bytes / 1024)} KB`}
            <button
              type="button"
              disabled={busy || b.invalid}
              className="ml-2 underline disabled:opacity-40"
              onClick={() => restoreBackup(b)}
            >
              {zh ? '恢复此备份' : 'Restore this backup'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

async function readBackups(project: string, signal?: AbortSignal): Promise<Backup[]> {
  const response = await fetch(`${base}/projects/${encodeURIComponent(project)}/backups`, { signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Backup failed')
  return data
}
