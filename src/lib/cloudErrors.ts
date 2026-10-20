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
    '暂时无法连接云端，网络恢复后会自动重试；本机稿件仍保留。',
    'Cloud connection failed. Changes will retry automatically; local work is retained.',
  ],
  credentials: [
    '系统凭证存储需要处理，请核对 macOS 钥匙串或 Windows 凭证提示。',
    'System credential storage needs attention. Review the Keychain or Windows credential prompt.',
  ],
  changed: [
    '正在保存或处理其他任务，稍后会自动继续同步。',
    'Saving or another task is in progress. Sync will continue automatically.',
  ],
  size: [
    '作品达到当前大小限制，请减小封面或拆分过大的作品；原稿已保留。',
    'The document size limit was reached. Reduce the cover or split large projects; local work is retained.',
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
