# Windows Google 登录修复进度（2026-10-21）

用户反馈：Windows 点击 Google 登录无反应。尚无 Windows 截图或运行日志，具体现场原因未确认。

代码检查发现：未导入客户端 JSON 时按钮静默禁用；Windows 的 open 默认只确认 cmd.exe 启动，可能掩盖实际 URL 打开失败；授权链接仅存在组件内，重开设置后丢失。

已改：首次配置清晰提示与点击反馈；Windows 启用 open 5.3.6 的 shellexecute-on-windows 特性，保留现有权限范围；授权中提供重新打开、复制/手动复制链接，链接保存在后端内存并随状态返回，取消/失败清除，不写磁盘。版本 0.0.11。

已验证：80 项核心/协议/HTTP 测试、10 项内存 DOM 测试、完整 TypeScript 与本机 cargo check 通过。下一步：网页构建、发布开发分支、Windows 原生编译和安装验收、交付修复安装包。用户 Windows 上真实 Google 登录仍待确认，不将合成测试当作现场问题已解决。
