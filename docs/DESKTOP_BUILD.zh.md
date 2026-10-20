# 桌面自动云文档预览构建与验收

版本 0.0.10，应用名称 Mythpen Sync Dev，与原版分开安装；默认数据目录 ~/.mythpen-sync-dev，端口 3101。升级前保存作品并完全退出旧开发版，不替换原版 Mythpen。

## 构建

需要 Node 24、pnpm 10.10.0、Bun 1.4.3、稳定 Rust。Mac 需要 Xcode 命令行工具；Windows x64 需要 MSVC 与 WebView2。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test:sync
pnpm test:editor
pnpm exec tsc --project tsconfig.app.json --noEmit
pnpm build:sidecar
pnpm test:sidecar
pnpm tauri build
```

产物在 src-tauri/target/release/bundle/。原生凭证资源按平台暂存，不能跨平台复制二进制。test:sidecar 使用隔离合成数据验证凭证、数据库、章节/封面、备份恢复、旧哈希拒绝、诊断和进程归属；不读取用户真实账号。

Actions 在 feature/cloud-sync-preview 推送时构建 Windows x64、Mac ARM、实验 Mac Intel。Windows 静默安装后再次检查包内服务和原生宿主冷启动；macOS CI 使用独立临时钥匙串。流程不自动发布 Release。应用尚未完成签名和公证，Intel 构建此前的系统凭证失败不算支持已验收。

## Google 与网络

两台导入同一个桌面客户端 JSON，各自独立授权同一个 Google 账号。已有开发版配置和系统凭证保留在独立数据目录/系统存储中，新安装器不内嵌个人配置。配置教程见 GOOGLE_SETUP.zh.md。

桌面后台读取 macOS 系统 HTTPS 代理或 Windows 当前用户手动代理；显式环境优先，loopback 排除代理。暂不解析 PAC/SOCKS 自动配置。修改代理后重启应用。

## 双设备验收（不再手动选择版本）

1. 两台都装 0.0.10 并连接同一 Google 应用与账号。
2. Mac 新建合成作品，输入一个字；不点保存/同步，等状态显示“已同步至 Google”。
3. Windows 打开软件，作品自动出现；打开后自动取得同一个字。检查封面与其他作品资料。
4. Windows 再加一个字，等待已同步；Mac 回到前台或重新打开作品，应自动更新，不出现下载/版本确认。
5. 连续输入、中文输入法、切章节与切项目时确认不丢字、不跳回旧章节；同一章号的其他分卷不被改写。
6. 断网写作再联网，确认自动恢复上传；两台都改过时按云端优先，后台本机恢复点存在，不要求用户处理版本冲突。
7. 完全退出再打开，检查草稿恢复、登录保持与云端自动更新。

正常切设备前只需确认云端状态成功。尚未上传的数据无法在另一台下载，网络故障时界面应明确显示本机稿保留而非假报已同步。此模式面向轮流写作，不提供逐字同时合并。
