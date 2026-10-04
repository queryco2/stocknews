# 股票工作台

React + TypeScript + SQLite 本地工作台。资讯中心包括按日期查看的早盘板块资讯、收盘板块资金与个股涨跌榜；知识库读取本地 Markdown 目录。

## 运行

需要 Node.js 24.14+。首次 `npm --prefix app install`，随后 `npm run dev`。

- 界面：http://127.0.0.1:5173
- 本机 API：127.0.0.1:4318
- `npm test`、`npm run typecheck`、`npm run build`
- `npm run seed` 显式加载演示内容；演示不代表实时行情。
- SQLite、知识库示例和备份位于 `.data/`，不进入 Git。

## WorkBuddy

在设置与连接页复制 MCP 配置，添加到 WorkBuddy。服务使用 stdio，启动命令为本机 Node + tsx + `app/server/mcp.ts`。两端必须使用相同的 `STOCKNEWS_DATA_DIR`。

初始采集依次调用 `get_ingestion_schema`、`get_report_context`、`begin_ingestion`、`submit_morning_report` 或 `submit_close_report`、`finish_ingestion`；失败调用 `fail_ingestion`。每批有稳定批次 ID，发布在事务中生成不可变历史版本。

资讯仅支持删除和获取更多。点击获取更多会通过 `workbuddy://task?action=start` 打开 WorkBuddy 并预填带请求 ID 的任务。**本机 WorkBuddy 5.5.6 此接口仅预填，仍需用户点发送，不是后台自动执行。** 未配置 MCP 时无法完成回传。WorkBuddy 使用 `get_supplement_request` 读取范围，检索后调用 `submit_supplement`，每批最多10条；校验来源和时间范围，排除已删除和重复资讯后直接追加。页面定期读取新版本。已退出的应用、尚未发送的草稿不会被误报为采集完成。

## 连接器

设置页支持飞书 CLI、企业微信 CLI 检查与目标表配置。发布报告写入本地同步队列，可重试。当前适配飞书电子表格、企业微信在线表格，需要预先创建专用工作表并填写对应 ID；企业微信智能表格尚未适配。未配置或未授权不会同步。本项目尚未使用真实目标表完成端到端验证。

## 知识库与数据

选择 Obsidian vault 或 Markdown 目录，提供文档和卡片视图，定期重建索引；外部源文件不被编辑。资讯可另存 Markdown。数据库可在设置中备份。

当前 SQLite 使用不可变报告 JSON 快照及独立运行、删除排除、补充请求、索引、同步队列表；项目说明中的规范化表为后续演进设计。数据库容量随版本数量增长，未实现自动历史清理。

## 个股资讯

资讯中心右上角进入“个股资讯”，输入股票名称或代码，选择 A 股/港股/美股后点击获取。每次请求固定近24小时时间范围，WorkBuddy先核实股票身份，使用 `get_stock_news_request` 读取请求，再用 `submit_stock_news` 提交最多10条，无法确定身份时调用 `fail_stock_news_request`。首次接入或更新后须让 WorkBuddy 重新连接 MCP 以发现新工具。

结果保存到 SQLite 的 `stock_news_requests` 表，独立于行业榜单；查询记录保留当次快照，支持查看来源、原文和删除。每批去重，重复回传不会重复写入或恢复删除条目。默认不向飞书/企业微信同步个股查询快照。与板块补充相同，当前 WorkBuddy 入口预填任务，仍需在 WorkBuddy 点发送；未执行真实外部检索的端到端验证。
