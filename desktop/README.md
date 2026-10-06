# macOS 安装包

运行 `npm run package:mac`，产物为 `release/Stocknews_0.1.0_arm64.dmg`。版本号取自 app/package.json。构建要求 Apple Silicon、Node 24.14+、Xcode Command Line Tools；运行要求 macOS 13+，无需另装 Node。

参考 zerone.Desktop 的运行环境内置、AppData 独立存储、冻结 Git 快照、hdiutil staging + Applications 快捷方式、挂载验证流程。本项目使用 Objective-C / WKWebView 原生外壳，未引入 Zerone 的 Tauri 业务代码、授权或签名密钥。

应用内置 Node、Express API、React 静态文件与 MCP 源码，API 绑定随机本地端口，退出应用结束子进程。SQLite 与日志放在 `~/Library/Application Support/Stocknews`。安装包不包含开发数据库、知识库文件、机器人配置或本机 CLI 授权。开发数据不自动迁移。

MCP 配置可在安装后的设置页复制，使用包内 Node 和相同数据目录；请先把应用移入 Applications 再配置 MCP，以免路径变化。

当前为 ad-hoc 签名的本地测试包，未做 Developer ID 签名或 Apple 公证，不提供自动更新。飞书/企业微信独立账号接入、多维表格一键创建功能尚未完成，本安装包不代表这些功能已交付；桌面模式关闭旧版 CLI 自动同步。

验证：类型检查、测试、生产构建、codesign 验证、DMG 挂载、包内 Node API 与 MCP 启动、原生窗口启动。每次修改源文件后都应重新提交快照并重新打包。

## 对外分发：Developer ID 签名与 Apple 公证

`npm run package:mac` 仍然仅生成本地测试包。对外分发使用 `npm run package:mac:release`，必须先在本机配置：

- 带私钥的有效 **Developer ID Application** 证书（Apple Developer Program）。
- 通过 `xcrun notarytool store-credentials` 存到钥匙串的公证凭据；账号密码不要写入仓库或聊天。
- 环境变量 `STOCKNEWS_SIGN_IDENTITY`：证书完整名称或 SHA-1。
- 环境变量 `STOCKNEWS_NOTARY_PROFILE`：上述钥匙串配置名称。

正式流程逐个签名内嵌 Mach-O，启用 Hardened Runtime 和安全时间戳，再签主应用。只给 Node 设置运行 JIT 所需的例外；不带调试权限或禁用库校验权限。随后上传应用 ZIP 到 Apple 公证，确认 Accepted 后附加公证票据并运行 Gatekeeper 校验，再生成、签名、公证及验证 DMG。只有全部成功才交付 `_notarized.dmg`，最后生成 SHA-256 校验文件。失败时保留日志与提交 ID，不回退为临时签名。`Stocknews-pending.dmg` 不可作为正式安装包发送。

当前机器没有 Developer ID 签名证书，因此这里只完成流程代码、语法检查和缺少配置时阻止构建的验证，尚未完成真实签名、公证及 Hardened Runtime 下的运行验证。正式包产出后还需在另一台 Mac 上验证启动、个股检索、MCP、知识库选择和退出。

签名及公证用于解决开发者无法验证类拦截；macOS 仍可能显示正常的“从互联网下载，是否打开”提示。如果对方提示“应用已损坏”，先核对文件 SHA-256 与签名/公证结果，再确认传输后文件是否改变。不要通过移除 quarantine 或关闭 Gatekeeper 作为发布方案。

参考：[Apple Developer ID](https://developer.apple.com/developer-id/)、[公证流程](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。
