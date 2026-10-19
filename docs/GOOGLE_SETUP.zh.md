# Google Drive 开发配置教程

状态：桌面 OAuth、系统凭证存储适配、连接界面和同步服务已接入开发预览；macOS 凭证存储、真实 Google 登录、刷新令牌及云端往返同步已实测。Windows 和第二台实体设备尚未实测。

1. 打开 [Google Cloud 控制台](https://console.cloud.google.com/)，创建一个由你持有的开发项目。
2. 在 API Library 启用 Google Drive API。
3. 在 Google Auth Platform 配置应用名称、联系邮箱和受众。个人 Google 账号一般使用 External；组织账号根据组织设置决定。开发阶段保持测试状态，并把你自己的 Google 账号加入测试用户。
4. 创建 OAuth Client，应用类型选择 Desktop app。开发阶段下载客户端配置并保存在仓库外。不要把个人 Token 或授权码贴到聊天、提交进 Git 或写入作品。
5. 在开发预览的“设置 → Google Drive → 客户端配置 JSON”中选择刚下载的文件。此文件只提交给本机后端。点击“连接 Google”，在系统浏览器完成授权；如浏览器未自动打开，点击设置中的授权页面链接。
6. 本实现初步选择 `https://www.googleapis.com/auth/drive.appdata`，仅存储应用私有数据；真实接入时验证当前 Google 配额、授权及发行要求。
7. 两台设备必须使用同一个 Google 应用配置及同一个用户账号，才能访问同一组应用数据。
8. 应用私有数据不会作为普通文件夹显示在 Google Drive 文件列表中。软件必须提供项目发现、历史查看和导出功能。
9. 测试模式的授权可能受 Google 的有效期等限制。正式发行前按 Google 当时的要求配置发布状态、隐私政策、应用品牌和必要审核，不能把测试账号设置当作公开发行方案。

OAuth 核心采用系统浏览器授权、随机本地回调端口、state 校验、PKCE、超时取消和授权刷新。凭证存储接口强制由桌面安全存储提供；没有明文文件回退。

公开发行时，维护者配置 Google 应用；普通用户只需通过浏览器授权。贡献者才需要参考本教程创建自己的开发配置。

官方参考：

- [桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [应用私有存储](https://developers.google.com/workspace/drive/api/guides/appdata)
- [上传文件](https://developers.google.com/workspace/drive/api/guides/manage-uploads)


## 本次配置记录

已创建 Google Cloud 项目：Mythpen Sync（项目 ID：mythpen-sync），并在控制台确认 Google Drive API 已启用。

OAuth 应用已创建：名称 Mythpen Sync，外部受众，保持测试模式，使用当前 Google 账号作为支持及联系邮箱。用户数据政策经项目持有人确认后已提交，测试用户仅添加持有人自己的账号。

已创建桌面 OAuth 客户端 Mythpen Sync Desktop，下载配置并导入本机开发预览。客户端配置存放在仓库外，已通过项目持有人自己的 Google 账号完成授权。

控制台的范围列表保存暂未单独确认，但已检查实际授权和刷新响应，权限仅为 `drive.appdata`。首次登录等待时间已调整为 10 分钟，OAuth 的 4 项协议测试通过。

真实云端验证通过：设备 A 上传合成作品并取回校验；隔离目录 B 发现并导入作品；B 修改并上传后，A 提示下载且保留原文；A 确认下载后内容一致，替换前备份存在，再次同步不重复上传。B 使用同一台 Mac 上独立的数据目录，不能代替 Windows 或第二台电脑的真机验证。合成测试作品和历史保留在应用私有云端空间。

本机开发预览使用已有本地 HTTP 代理访问 Google。Node 24 可使用 `NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY` 和 `HTTP_PROXY`；同时将 `127.0.0.1,localhost` 加入 `NO_PROXY`，避免本机 API 请求经过代理。此项是当前开发进程的配置，桌面安装包网络行为仍需实测。

## 桌面版网络与本机限制

桌面启动已加入 macOS 系统 HTTPS 代理及 Windows 用户手动代理读取，详见 [桌面构建与验收](DESKTOP_BUILD.zh.md)。本机安装版已完成 Google 浏览器登录回调，但保存 Token 时出现系统钥匙串错误；系统自带钥匙串命令随后也报相同错误。需要恢复本机钥匙串访问后重新授权并复测。安装包本身不包含用户账号配置或凭证。
