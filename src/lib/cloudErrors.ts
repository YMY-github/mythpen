const descriptions: Record<string, [string, string]> = {
  authorization: [
    'Google 授权已失效，请重新连接；本机稿件仍保留。',
    'Google authorization expired. Reconnect; local work is retained.',
  ],
  permission: [
    'Google 拒绝访问，请检查账号和应用权限。',
    'Google denied access. Check the account and app permissions.',
  ],
  quota: [
    'Google 云端空间不足，请先处理空间；本机写作不受影响。',
    'Google storage is full. Free space; local writing remains available.',
  ],
  'disk-space': ['本机磁盘空间不足，请腾出空间后重试。', 'Local disk space is insufficient. Free space and retry.'],
  network: [
    '暂时无法连接云端，将按同步设置重试；本机内容仍保留。',
    'Cloud connection failed. Retry follows sync settings; local work is retained.',
  ],
  credentials: [
    '系统凭证存储需要处理，请核对 macOS 钥匙串或 Windows 凭证提示。',
    'System credential storage needs attention. Review the Keychain or Windows credential prompt.',
  ],
  changed: [
    '版本或任务状态已变化，请重新检查后再操作。',
    'Versions or task state changed. Check again before continuing.',
  ],
  size: [
    '已达到当前预览版的大小限制，请检查作品大小或预览历史清理。',
    'The preview size limit was reached. Review project size or preview history cleanup.',
  ],
  data: [
    '版本校验未通过，已停止应用；本机稿件保留。',
    'Version validation failed. Applying stopped; local work is retained.',
  ],
  operation: ['操作未完成，请检查当前状态后重试。', 'The operation did not complete. Review the state and retry.'],
}
export function cloudErrorText(code: string | null | undefined, zh: boolean) {
  return (descriptions[code || 'operation'] || descriptions.operation)[zh ? 0 : 1]
}
