import { open } from '@tauri-apps/plugin-shell'
import { useCallback, useEffect, useState } from 'react'
import { refreshAllData } from '@/lib/dataEvents'
import { useAgentStore } from '@/stores/useAgentStore'
import { useChapterStore } from '@/stores/useChapterStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

type Revision = { revisionId: string; createdAt: string; deviceId: string }
type Result = { action: string; expectedHash?: string; revision?: Revision; heads?: Revision[] }
type Status = { configured: boolean; phase: string; account: string | null; message: string }
const base = '__TAURI_INTERNALS__' in window ? 'http://127.0.0.1:3101/api/sync' : '/api/sync'
async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Cloud request failed')
  return data
}

export function CloudSyncPanel() {
  const zh = useSettingsStore((s) => s.settings.uiLanguage) === 'zh'
  const projects = useProjectStore((s) => s.projects)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [history, setHistory] = useState<Revision[]>([])
  const [cloud, setCloud] = useState<{ projectId: string; name: string; heads: Revision[] }[]>([])
  const [loginUrl, setLoginUrl] = useState('')
  const [auto, setAuto] = useState(false)
  const [importName, setImportName] = useState('')
  const refresh = useCallback(async () => {
    setStatus(await call<Status>('/status'))
  }, [])
  useEffect(() => {
    refresh().catch((e) => setMessage(e.message))
    const timer = setInterval(() => refresh().catch(() => {}), 4000)
    return () => clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    let cancelled = false
    setResult(null)
    setHistory([])
    if (name && status?.phase === 'connected')
      call<{ auto: boolean; action?: string }>(`/projects/${encodeURIComponent(name)}/status`)
        .then((data) => {
          if (!cancelled) {
            setAuto(data.auto)
            if (data.action) setResult(data as Result)
          }
        })
        .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [name, status?.phase])
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Cloud request failed')
    } finally {
      setBusy(false)
    }
  }
  const projectPath = `/projects/${encodeURIComponent(name)}`
  async function sync() {
    await call(`${projectPath}/enable`, { auto })
    setResult(await call<Result>(`${projectPath}/sync`, {}))
  }
  async function apply(revision: Revision, choice: 'copy' | 'restore' | 'download') {
    if (useAgentStore.getState().isRunning)
      throw new Error(zh ? '请等待 AI 写作完成。' : 'Wait for AI writing to finish.')
    if (useChapterStore.getState().saveStatus !== 'saved')
      throw new Error(zh ? '请先保存正文，等待保存完成。' : 'Save the editor content first.')
    if (
      !window.confirm(
        zh
          ? '请确认所有编辑已保存。应用版本前会保留本机备份。是否继续？'
          : 'Confirm all edits are saved. A local recovery point will be kept. Continue?',
      )
    )
      return
    let expectedHash = result?.expectedHash
    if (!expectedHash) expectedHash = (await call<{ currentHash: string }>(`${projectPath}/status`)).currentHash
    await call(`${projectPath}/apply`, { revisionId: revision.revisionId, expectedHash, choice })
    await refreshAllData()
    setResult(null)
    setMessage(zh ? '已应用，双方历史已保留。' : 'Applied; version history has been kept.')
  }
  const button = 'px-3 py-2 rounded border border-[var(--hairline)] text-xs disabled:opacity-40'
  return (
    <section className="mb-7" aria-label="Google Drive">
      {busy && (
        <div className="fixed inset-0 z-[999] bg-black/60 flex items-center justify-center" role="status">
          <p className="bg-[var(--canvas-card)] p-6 rounded">
            {zh ? '正在处理云端任务，请稍候…' : 'Processing cloud task…'}
          </p>
        </div>
      )}
      <h3 className="text-sm font-medium mb-2">Google Drive · {zh ? '云端与同步' : 'Cloud and sync'}</h3>
      <p className="text-xs text-[var(--ink-mute)] mb-2">
        {zh
          ? '作品存入应用私有空间。自动上传可选；远端更新先提示下载。历史暂不自动清理。'
          : 'Projects use private app storage. Auto-upload is optional; remote updates need confirmation. History is retained.'}
      </p>
      <p className="text-xs mb-2">
        {status?.account ||
          (status?.configured
            ? zh
              ? '已配置 Google 应用'
              : 'Google client configured'
            : zh
              ? '请导入桌面 OAuth 客户端配置'
              : 'Import desktop OAuth client configuration')}
      </p>
      <label className="text-xs block mb-2">
        {zh ? '客户端配置 JSON（开发阶段）' : 'Client JSON (development)'}
        <input
          aria-label={zh ? 'Google 客户端配置' : 'Google client configuration'}
          type="file"
          accept=".json,application/json"
          disabled={busy || status?.phase === 'connected' || status?.phase === 'connecting'}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file)
              action(async () => {
                await call('/configure', JSON.parse(await file.text()))
                await refresh()
              })
          }}
        />
      </label>
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          className={button}
          disabled={busy || !status?.configured || status.phase === 'connected' || status.phase === 'connecting'}
          onClick={() =>
            action(async () => {
              const { url } = await call<{ url: string }>('/connect', {})
              setLoginUrl(url)
              if ('__TAURI_INTERNALS__' in window) await open(url)
              else window.open(url, '_blank', 'noopener,noreferrer')
              await refresh()
            })
          }
        >
          {status?.phase === 'connecting'
            ? zh
              ? '等待浏览器授权…'
              : 'Waiting for authorization…'
            : zh
              ? '连接 Google'
              : 'Connect Google'}
        </button>
        <button
          type="button"
          className={button}
          disabled={busy || !status?.configured}
          onClick={() =>
            action(async () => {
              await call('/disconnect', {})
              setLoginUrl('')
              setCloud([])
              setResult(null)
              await refresh()
            })
          }
        >
          {zh ? '断开 / 取消' : 'Disconnect / cancel'}
        </button>
      </div>
      {status?.phase === 'connecting' && loginUrl && (
        <a href={loginUrl} target="_blank" rel="noreferrer" className="text-xs underline">
          {zh ? '点击打开 Google 授权页面' : 'Open Google authorization page'}
        </a>
      )}
      {status?.phase === 'connected' && (
        <>
          <select
            className="w-full p-2 mb-2 bg-[var(--canvas-elevated)]"
            aria-label={zh ? '同步作品' : 'Sync project'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          >
            <option value="">{zh ? '选择作品' : 'Select project'}</option>
            {projects.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
          <label className="text-xs block mb-2">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            {zh
              ? '自动上传（保存后约 30 秒，定期检查约 2 分钟）'
              : 'Auto-upload (30 seconds after saving; periodic check every 2 minutes)'}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={!name || busy} onClick={() => action(sync)}>
              {zh ? '开启并立即同步' : 'Enable and sync now'}
            </button>
            <button
              type="button"
              className={button}
              disabled={!name || busy}
              onClick={() =>
                action(async () => {
                  await call(`${projectPath}/disable`, {})
                  setMessage(zh ? '已停止该作品同步，历史保留。' : 'Sync disabled; history retained.')
                })
              }
            >
              {zh ? '停止同步' : 'Stop sync'}
            </button>
            <button
              type="button"
              className={button}
              disabled={!name || busy}
              onClick={() => action(async () => setHistory(await call<Revision[]>(`${projectPath}/history`)))}
            >
              {zh ? '云端历史' : 'Cloud history'}
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => action(async () => setCloud(await call('/cloud-projects')))}
            >
              {zh ? '发现云端作品' : 'Find cloud projects'}
            </button>
          </div>
          {result && (
            <p className="text-xs mt-2" role="status">
              {result.action === 'uploaded' || result.action === 'synced'
                ? zh
                  ? '云端已更新'
                  : 'Cloud is up to date'
                : result.action === 'conflict'
                  ? zh
                    ? '发现版本冲突：双方稿件均保留。'
                    : 'Conflict detected; both versions are retained.'
                  : result.action === 'download-ready'
                    ? zh
                      ? '云端有更新，可保存本机内容后下载。'
                      : 'Remote update available. Save locally before downloading.'
                    : result.action}
            </p>
          )}
          {result?.revision && (
            <button
              type="button"
              className={button}
              onClick={() => action(() => apply(result.revision as Revision, 'download'))}
            >
              {zh ? '下载该更新' : 'Download update'}
            </button>
          )}
          {result?.heads?.map((revision) => (
            <div key={revision.revisionId} className="text-xs mt-2">
              {new Date(revision.createdAt).toLocaleString()}
              <button type="button" className={button} onClick={() => action(() => apply(revision, 'copy'))}>
                {zh ? '保留为另一部作品' : 'Keep as separate project'}
              </button>
              <button type="button" className={button} onClick={() => action(() => apply(revision, 'restore'))}>
                {zh ? '采用该版本' : 'Use this version'}
              </button>
            </div>
          ))}
          {result?.action === 'conflict' && (
            <button
              type="button"
              className={button}
              onClick={() =>
                action(async () => {
                  await call(`${projectPath}/resolve-local`, { expectedHash: result.expectedHash })
                  setResult(null)
                })
              }
            >
              {zh ? '采用本机版本（历史保留）' : 'Use local version (keep history)'}
            </button>
          )}
          {history.map((revision) => (
            <div key={revision.revisionId} className="text-xs mt-2">
              {new Date(revision.createdAt).toLocaleString()}
              <button type="button" className={button} onClick={() => action(() => apply(revision, 'restore'))}>
                {zh ? '恢复此历史版本' : 'Restore version'}
              </button>
            </div>
          ))}
          {cloud.length > 0 && (
            <input
              className="w-full bg-[var(--canvas-elevated)] p-2 mt-2"
              aria-label={zh ? '导入后的作品名称' : 'Imported project name'}
              placeholder={zh ? '输入导入后的作品名称' : 'Name for imported project'}
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
            />
          )}
          {cloud.map((project) => (
            <div key={project.projectId} className="text-xs mt-2">
              {zh ? '云端作品' : 'Cloud project'} {project.name}
              {project.heads.map((revision) => (
                <button
                  type="button"
                  key={revision.revisionId}
                  disabled={!importName.trim()}
                  className={button}
                  onClick={() =>
                    action(async () => {
                      await call('/import', {
                        projectId: project.projectId,
                        revisionId: revision.revisionId,
                        name: importName,
                      })
                      await refreshAllData()
                      setMessage(zh ? '作品已导入。' : 'Project imported.')
                    })
                  }
                >
                  {zh ? '导入' : 'Import'} · {new Date(revision.createdAt).toLocaleDateString()}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
      {(message || status?.message) && (
        <p role="alert" className="text-xs mt-2">
          {message || status?.message}
        </p>
      )}
    </section>
  )
}
