# macOS 安装包

运行 `npm run package:mac`，产物为 `release/Stocknews_0.1.0_arm64.dmg`。版本号取自 app/package.json。构建要求 Apple Silicon、Node 24.14+、Xcode Command Line Tools；运行要求 macOS 13+，无需另装 Node。

参考 zerone.Desktop 的运行环境内置、AppData 独立存储、冻结 Git 快照、hdiutil staging + Applications 快捷方式、挂载验证流程。本项目使用 Swift / WKWebView 原生外壳，未引入 Zerone 的 Tauri 业务代码、授权或签名密钥。

应用内置 Node、Express API、React 静态文件与 MCP 源码，API 绑定随机本地端口，退出应用结束子进程。SQLite 与日志放在 `~/Library/Application Support/Stocknews`。安装包不包含开发数据库、知识库文件、机器人配置或本机 CLI 授权。开发数据不自动迁移。

MCP 配置可在安装后的设置页复制，使用包内 Node 和相同数据目录；请先把应用移入 Applications 再配置 MCP，以免路径变化。

当前为 ad-hoc 签名的本地测试包，未做 Developer ID 签名或 Apple 公证，不提供自动更新。飞书/企业微信独立账号接入、多维表格一键创建功能尚未完成，本安装包不代表这些功能已交付；桌面模式关闭旧版 CLI 自动同步。

验证：类型检查、测试、生产构建、codesign 验证、DMG 挂载、包内 Node API 与 MCP 启动、原生窗口启动。每次修改源文件后都应重新提交快照并重新打包。
