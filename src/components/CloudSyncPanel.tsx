import { open } from '@tauri-apps/plugin-shell'
import { useState } from 'react'
import { cloudCall } from '@/lib/cloudDocuments'
import { cloudErrorText } from '@/lib/cloudErrors'
import { type CloudAccount, useCloudDocumentStore } from '@/stores/useCloudDocumentStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

export function CloudSyncPanel() {
  const zh = useSettingsStore((s) => s.settings.uiLanguage) === 'zh'
  const account = useCloudDocumentStore((s) => s.account)
  const cloudError = useCloudDocumentStore((s) => s.errorCode)
  const documentError = useCloudDocumentStore((s) => s.result?.errorCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      useCloudDocumentStore.setState({ account: await cloudCall<CloudAccount>('/status'), errorCode: null })
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? zh
            ? '请选择有效的 Google 桌面客户端 JSON。'
            : 'Select a valid Google desktop client JSON.'
          : cloudErrorText((e as { code?: string }).code, zh),
      )
    } finally {
      setBusy(false)
    }
  }
  const connected = account?.phase === 'connected'
  const connecting = account?.phase === 'connecting'
  const button = 'px-4 py-2 rounded border border-[var(--hairline)] text-sm disabled:opacity-40'
  return (
    <section className="mb-7" aria-label={zh ? 'Google 云文档' : 'Google cloud documents'}>
      <h3 className="text-base font-medium mb-3">{zh ? 'Google 云文档' : 'Google cloud documents'}</h3>
      <p className="text-sm text-[var(--ink-tertiary)] leading-relaxed mb-4">
        {zh
          ? '修改后自动保存并上传，打开另一台电脑时自动更新到云端最新稿。所有作品自动同步，无需选择版本或手动下载。'
          : 'Changes save and upload automatically. Opening another device loads the latest cloud document. All projects sync without version selection.'}
      </p>
      {connected ? (
        <div className="rounded-lg p-4 bg-[var(--canvas-elevated)] mb-3">
          <p className="text-sm mb-1">{zh ? '自动同步已开启' : 'Automatic sync is on'}</p>
          <p className="text-xs text-[var(--ink-tertiary)]">{account.account}</p>
        </div>
      ) : (
        <>
          {!account?.configured && (
            <label className="text-sm block mb-3">
              {zh ? '首次配置：导入 Google 客户端文件' : 'First setup: import Google client file'}
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                aria-label={zh ? 'Google 客户端文件' : 'Google client file'}
                className="block mt-2 text-xs"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file)
                    void action(async () => {
                      await cloudCall('/configure', JSON.parse(await file.text()))
                    })
                }}
              />
            </label>
          )}
          <button
            type="button"
            className={button}
            disabled={busy || !account?.configured || connecting}
            onClick={() =>
              void action(async () => {
                const login = await cloudCall<{ url: string }>('/connect', {})
                setUrl(login.url)
                if ('__TAURI_INTERNALS__' in window) await open(login.url)
                else window.open(login.url, '_blank', 'noopener,noreferrer')
              })
            }
          >
            {connecting
              ? zh
                ? '等待 Google 授权…'
                : 'Waiting for Google…'
              : zh
                ? '连接 Google，开启自动同步'
                : 'Connect Google and sync'}
          </button>
          {connecting && url && (
            <a href={url} target="_blank" rel="noreferrer" className="block underline text-xs mt-2">
              {zh ? '打开授权页面' : 'Open authorization page'}
            </a>
          )}
        </>
      )}
      <p className="text-xs text-[var(--ink-mute)] leading-relaxed mt-3">
        {zh
          ? '适合在 Mac 和 Windows 之间轮流写作。断网可继续写，联网后自动同步；如两台都改过，以云端新稿为准，本机稿会先留恢复副本。'
          : 'For alternating between Mac and Windows. Write offline and sync on reconnect. If both changed, cloud wins and the local draft is retained as a recovery copy.'}
      </p>
      {(error || cloudError || documentError || account?.errorCode) && (
        <p role="alert" className="text-xs mt-3">
          {error || cloudErrorText(cloudError || documentError || account?.errorCode, zh)}
        </p>
      )}
      {(connected || connecting) && (
        <button
          type="button"
          className="text-xs underline mt-4 disabled:opacity-40"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await cloudCall('/disconnect', {})
              setUrl('')
              useCloudDocumentStore.setState({ result: null })
            })
          }
        >
          {zh ? (connecting ? '取消连接' : '断开 Google') : connecting ? 'Cancel' : 'Disconnect Google'}
        </button>
      )}
    </section>
  )
}
