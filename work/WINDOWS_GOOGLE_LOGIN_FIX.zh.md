# Windows Google 登录修复进度（2026-10-21）

用户反馈：Windows 点击 Google 登录无反应。尚无 Windows 截图或运行日志，具体现场原因未确认。

代码检查发现：未导入客户端 JSON 时按钮静默禁用；Windows 的 open 默认只确认 cmd.exe 启动，可能掩盖实际 URL 打开失败；授权链接仅存在组件内，重开设置后丢失。

已改：首次配置清晰提示与点击反馈；Windows 启用 open 5.3.6 的 shellexecute-on-windows 特性，保留现有权限范围；授权中提供重新打开、复制/手动复制链接，链接保存在后端内存并随状态返回，取消/失败清除，不写磁盘。版本 0.0.11。

已验证：80 项核心/协议/HTTP 测试、10 项内存 DOM 测试、完整 TypeScript、本机 cargo check 与网页构建通过。Windows 依赖特性树确认 tauri-plugin-shell 与应用共用启用 shellexecute-on-windows 的 open 5.3.6。

源码已发布：66e0eecfb26a1afec62678c5170636d466a625e8。Actions 39590420084 的 Windows x64 任务 119189685165 成功，日志确认 80 项核心测试和 10 项编辑器测试全部通过，NSIS/MSI 生成、安装后包内服务资源与安全存储、原生桌面冷启动检查通过。Windows Artifact 12342411685，SHA256 24bef32f0ddaae4779d12c9fb10b6763e9b514f7810db969536afc373180fe09。

Mac ARM 任务也成功；Intel 实验任务仍在系统凭证合成检查失败。用户 Windows 上真实 Google 登录仍待确认，不将合成测试或冷启动当作现场问题已解决。
