# 开发状态与接续说明

更新于 2026-10-19。基于上游 `niyongsheng/mythpen` v0.0.9，提交 `be30119f85fe5d1206c80f7202cab1d1bc0d9ba9`。当前是社区开发预览，不是正式发行版。

## 已实现

- 独立应用标识与数据目录 `~/.mythpen-sync-dev`，本机后台端口 3101；不自动迁移或覆盖原版作品。
- Google 桌面 OAuth、PKCE、本地回调、刷新与取消；系统凭证存储，无明文 Token 回退；账号和应用配置隔离。
- 作品数据库与封面的不可变快照、稳定身份、父修订、大小/哈希/数据库校验；上传后取回验证。
- 手动同步、按作品可选自动上传、云端作品发现与导入；显式确认远端下载、冲突副本、本机版本解决冲突、云端历史恢复。
- 离线本地备份恢复、替换前备份、崩溃恢复日志；损坏备份不会遮蔽有效备份。
- 全局同步状态、前台/联网检查、具体错误指引、去除敏感信息的诊断；大文件分块可恢复上传，历史摘要扫描。
- 历史清理预览和明确确认永久删除；保护基线、最新分支、本机内容和近期版本，未解决分叉不清理。默认不删除。
- macOS 系统 HTTPS 代理 / Windows 手动代理；平台原生凭证资源和 Bun 服务打包；退出只关闭自己启动的后台。

具体行为和限制见 [同步规则](SYNC_DESIGN.zh.md)，配置见 [Google 教程](GOOGLE_SETUP.zh.md)，构建和手动验收见 [桌面构建](DESKTOP_BUILD.zh.md)。

## 已验证的证据

- 当前 56 项自动化测试通过：真实 sql.js、快照校验、崩溃恢复、分叉/长修订图、账号取消、上传进度恢复、保留计划和旧预览令牌拒绝等；完整应用 TypeScript 检查通过。
- Mac ARM 安装版此前已验证本地作品/备份、真实 Google 往返、保存后自动上传、完全退出后重新打开仍保持登录。第二“设备”为同一 Mac 的隔离数据目录，不等于两台实体设备。
- 新版核心与旧 Mac 安装版互通成功；真实 Google 上传 10387912 字节 JSON，跨越两个分块，下载内容完全一致；同一修订重试不重复创建。真实网络中断由协议模拟覆盖，未人为破坏当前网络。
- 旧预览 GitHub Actions `39246596908` 的 Windows x64 与 Mac ARM 构建成功。Windows 已产生 NSIS/MSI 并校验下载摘要；Windows 真机登录未验收。旧 Intel 构建在 CI 钥匙串检查失败。
- 新版 CI 增加独立 macOS 测试钥匙串，以及 Windows 静默安装后资源、凭证、本地备份和原生宿主冷启动检查；运行结果以 Actions 最新任务和交付验收报告为准，不能把脚本存在当成通过。

## 尚待验收及发行条件

1. 新版原生界面目视检查、Windows 个人电脑真实 Google 登录及两台实体设备往返、离线冲突与封面恢复。
2. 真实云端永久删除（目前仅预览；mock 已测）、极端故障与长时间压力。当前不执行无人值守真实删除。
3. Mac Intel 独立验证，Windows ARM 不支持；应用签名、Apple 公证和 Windows 信任提示处理。
4. 统一上游许可证：LICENSE/README 为 GPLv3，package.json 为 CC BY-NC-SA 4.0，Cargo 声明 MIT；保留原声明，尚未联系作者或取得澄清。
5. Google 应用仍处测试模式，公开发行的品牌/隐私政策/受众和必要审核尚未完成。安装包不含个人配置或 Token。

## 恢复开发

仅向自己的 fork `YMY-github/mythpen` 的开发分支提交，不推送原作者仓库，不自动打 tag 或发布 Release。先检查当前分支、已有构建与测试结果，避免重做上传/删除。独立开发环境使用 Node 24、pnpm 10.10.0、Bun 1.4.3 和稳定 Rust。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test:sync
pnpm exec tsc --project tsconfig.app.json --noEmit
pnpm build:sidecar
pnpm test:sidecar
pnpm tauri build
```

运行及限制：快照原始文件合计 64 MiB；最多 10000 个历史文件，仍逐份远程读取；历史不自动清理。开发启动不执行 seed。多窗口并发、持续实时协作、差量同步和端到端加密尚未提供。
