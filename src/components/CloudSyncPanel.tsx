import { open } from '@tauri-apps/plugin-shell'
import { useRef, useState } from 'react'
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
  const [browserError, setBrowserError] = useState('')
  const [copied, setCopied] = useState(false)
  const configInput = useRef<HTMLInputElement>(null)
  const linkInput = useRef<HTMLInputElement>(null)
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
  const url = connecting ? account.authorizationUrl : undefined
  async function openAuthorization(link: string) {
    setBrowserError('')
    try {
      if ('__TAURI_INTERNALS__' in window) await open(link)
      else window.open(link, '_blank', 'noopener,noreferrer')
    } catch {
      setBrowserError(
        zh
          ? '未能打开系统浏览器。请复制下面的授权链接，在这台电脑的浏览器中打开。'
          : 'Could not open the system browser. Copy the authorization link below into a browser on this computer.',
      )
    }
  }
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
                ref={configInput}
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
          <p className="text-xs mb-3" role="status">
            {!account?.configured
              ? zh
                ? '这台电脑尚未配置 Google 登录。请先导入与 Mac 相同的客户端 JSON，安装包不会携带此文件。'
                : 'Google sign-in is not configured on this computer. Import the same client JSON as your other device; installers do not include it.'
              : !connecting
                ? zh
                  ? '客户端配置已就绪。点击下方按钮，在系统浏览器中登录 Google。'
                  : 'Client configuration is ready. Sign in with Google in your system browser below.'
                : zh
                  ? '请在这台电脑的浏览器中完成授权，再回到软件。浏览器未打开时，可重新打开或复制下方链接。'
                  : 'Complete authorization in a browser on this computer, then return here. Reopen or copy the link below if needed.'}
          </p>
          <button
            type="button"
            className={button}
            disabled={busy || connecting}
            onClick={() => {
              if (!account?.configured) {
                configInput.current?.focus()
                setError(
                  zh
                    ? '请先选择上方的 Google 客户端 JSON 文件，再连接 Google。'
                    : 'Select the Google client JSON file above before connecting.',
                )
                return
              }
              void action(async () => {
                const login = await cloudCall<{ url: string }>('/connect', {})
                setCopied(false)
                useCloudDocumentStore.setState({
                  account: { ...account, phase: 'connecting', authorizationUrl: login.url },
                })
                await openAuthorization(login.url)
              })
            }}
          >
            {busy
              ? zh
                ? '正在处理…'
                : 'Working…'
              : connecting
                ? zh
                  ? '等待 Google 授权…'
                  : 'Waiting for Google…'
                : zh
                  ? '连接 Google，开启自动同步'
                  : 'Connect Google and sync'}
          </button>
          {connecting && url && (
            <div className="mt-3">
              <div className="flex gap-3 mb-2">
                <button type="button" className="underline text-xs" onClick={() => void openAuthorization(url)}>
                  {zh ? '重新打开授权页面' : 'Reopen authorization page'}
                </button>
                <button
                  type="button"
                  className="underline text-xs"
                  onClick={async () => {
                    linkInput.current?.focus()
                    linkInput.current?.select()
                    try {
                      await navigator.clipboard.writeText(url)
                      setCopied(true)
                    } catch {
                      setBrowserError(
                        zh
                          ? '授权链接已选中，请按 Ctrl+C（Mac 为 ⌘C）复制，再粘贴到这台电脑的浏览器。'
                          : 'Link selected. Press Ctrl+C (⌘C on Mac), then paste it into a browser on this computer.',
                      )
                    }
                  }}
                >
                  {copied ? (zh ? '已复制链接' : 'Link copied') : zh ? '复制授权链接' : 'Copy authorization link'}
                </button>
              </div>
              <input
                ref={linkInput}
                type="text"
                readOnly
                value={url}
                aria-label={zh ? 'Google 授权链接' : 'Google authorization link'}
                className="w-full text-xs p-2 rounded border border-[var(--hairline)] bg-transparent"
                onFocus={(event) => event.currentTarget.select()}
              />
              {browserError && (
                <p role="alert" className="text-xs mt-2">
                  {browserError}
                </p>
              )}
            </div>
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
              setBrowserError('')
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
