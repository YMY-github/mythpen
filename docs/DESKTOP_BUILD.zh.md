# 桌面预览构建与双设备验收

这是一份开发预览，应用名称为 **Mythpen Sync Dev**，与原版 Mythpen 分开安装。默认数据目录为 `~/.mythpen-sync-dev`，本机服务使用端口 3101。原版的作品目录不会自动迁入。

## 本地构建

需要 Node.js 24、pnpm 10.10.0、Bun 1.4.3、稳定版 Rust，以及 Tauri 对应平台的系统工具。Mac 使用 Xcode Command Line Tools；Windows x64 使用 MSVC 构建工具和 WebView2。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test:sync
pnpm exec tsc --project tsconfig.app.json --noEmit
pnpm build:sidecar
pnpm test:sidecar
pnpm tauri build
```

`build:sidecar` 会嵌入数据库 WASM，按当前系统暂存原生凭证组件，并生成正确的平台文件名。后台服务和原生资源必须一起打包，不能复制另一个平台的生成文件。

`test:sidecar` 使用独立临时目录和合成数据，验证操作系统凭证写入/读取/删除、数据库创建、章节与封面读写、备份恢复及旧哈希拦截、诊断隐私和只关闭自己的进程。它不使用真实 Google 账号，不能代替云端验收。

构建结果在 `src-tauri/target/release/bundle/` 下。当前预览尚无开发者签名及 Apple 公证，不应将其描述成正式发行版。

## GitHub 构建

`.github/workflows/build.yml` 提供开发预览分支推送、手动运行及针对 main 的 PR 检查，矩阵为 Mac Apple Silicon、Mac Intel、Windows x64。每个系统先运行自动化检查和打包服务测试，再生成安装包并保存 Actions 构建产物。Windows 还会静默安装 NSIS 包，在安装资源上重复后台检查并启动原生宿主，核对隔离目录和健康接口；这不代替 WebView 操作或真实 Google 登录。macOS CI 使用临时测试钥匙串，Intel 暂为实验任务。流程不自动发布 Release。

推送到自己的 fork 后，在 Actions 中选择 **Desktop preview builds → Run workflow**。下载对应系统的构建产物。不要向原作者仓库推送本地开发分支；公开发布前先处理上游许可证声明不一致的问题。

GitHub 构建成功仅证明构建环境通过，还需实际 Windows 与第二台电脑验收。Windows ARM 暂不列入支持范围。

## 网络与登录

桌面后台启动时，若没有显式代理环境变量，会读取 macOS 的系统 HTTPS 代理，或 Windows 当前用户的手动代理。现有环境变量优先。程序会排除 localhost、127.0.0.1、::1，以保留本地接口直连。

暂不解析 PAC 自动配置脚本、自动发现代理或只设置 SOCKS 的系统配置。修改系统代理后请重新打开应用。普通直连网络无需设置代理。

客户端配置及 Google Token 不随安装包分发。每台新设备按 [Google 配置教程](GOOGLE_SETUP.zh.md) 导入同一个桌面 OAuth 客户端并独立授权同一个 Google 账号。Token 保存在系统凭证存储中；两台设备不会通过云端同步登录凭证。

## 双设备验收清单

1. 两台电脑安装同一预览版，导入同一个 Google 客户端，用同一个 Google 账号登录。
2. Mac 创建一份合成测试作品，添加章节与封面；手动同步后检查云端历史。
3. Windows 在“云端作品”发现并导入，检查章节与封面一致。
4. Windows 修改文本并保存、上传；Mac 同步应提示有可下载版本，确认下载前本地文本保持原样，确认后内容一致且存在替换前备份。
5. 两台同时离线修改同一作品，再分别联网同步，应出现冲突；保留冲突副本后确认两个版本都能打开。
6. 打开自动同步，在其中一台保存后等待上传，再在另一台检查远端变化。
7. 断网、重启程序、重新授权和恢复历史时，确认已保存作品没有丢失。测试期间只使用合成作品，验证通过后再迁入真实稿件。

目前原始快照上限 64 MiB、远端文件最多 10000 个，历史逐份下载校验；大文件采用分块可恢复上传，云端历史只在预览并明确确认后清理。大作品、长时间使用、多窗口压力、签名和正式发布仍需后续工作。
