# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## User design preference (2026-10-04)
Keep the interface simple, clean, direct. Remove decorative English headings, subtitles, explanatory slogans, repeated status text and unnecessary cards. Only two primary navigation items: 资讯中心 and 知识库. Use compact sector text tabs, understated borders, a news list and readable detail pane. Keep important demo/source/error facts, but avoid duplicating them.

## User feedback (2026-10-05)
News cards in the left list should be compact: smaller vertical padding and gaps, one-line summary preview, readable full titles. News actions should only expose delete and 获取更多资讯; no manual entry, retain, replace, lock, or edit. More news is appended directly through WorkBuddy and MCP.

Clarification: “新闻左边的卡片” means the news list beside the article detail, not the far-left navigation. Restore the navigation's original 216px desktop / 184px medium / 70px narrow proportions. Compact only `.news-row`; combine source and time in its metadata line.

The news page heading explicitly identifies 今日热点资讯 for today's morning report, or the selected historical date's 热点资讯. Close reports use 收盘复盘. Keep the navigation label 资讯中心 and avoid an additional subtitle.

Do not display example/demo reports or provide a demo-loading button. Without real data, show only 待更新 in the content area. Hide demo versions from history. Demo knowledge files must not be the default connected directory.

News runs every calendar day, including weekends and holidays; label the tab 每日资讯. Only close-market reports depend on actual trading days. 待更新 means no ingested report, never no news because of a holiday. Keep the morning protocol value for compatibility.

Clarification of 待更新: preserve the sector tabs, news list slots and detail pane when data is absent; display 待更新 inside those areas. Default sector names are navigation categories only, without fabricated rankings, articles or sources. Replace with actual AI-ranked sectors once a real report arrives. Close reports retain table sections with pending cells.
