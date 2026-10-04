import express from "express";
import { openWorkBuddy } from "./workbuddy.ts";
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import * as store from "./store.ts";
import * as knowledge from "./knowledge.ts";
import { check, runSync, type Platform } from "./connectors.ts";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));
const csrf = randomBytes(24).toString("hex");
app.use("/api", (req, res, next) => {
  const host = (req.headers.host || "").split(":")[0];
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host))
    return res.status(403).json({ error: "仅允许本机访问" });
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
        throw new Error();
    } catch {
      return res.status(403).json({ error: "来源不允许" });
    }
  }
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers["x-stocknews-token"] !== csrf
  )
    return res.status(403).json({ error: "会话过期，请刷新" });
  next();
});
const route = (fn: (req: any) => any) => (req: any, res: any, next: any) =>
  Promise.resolve()
    .then(() => fn(req))
    .then((r) => res.json(r))
    .catch(next);
app.get(
  "/api/bootstrap",
  route(() => ({
    token: csrf,
    reports: store.reports(),
    watchlist: store.db.prepare("SELECT * FROM watchlist").all(),
    knowledgeRoot: store.setting("knowledgeRoot", ""),
    runs: store.db
      .prepare(
        "SELECT id,status,created_at,error FROM ingestion_runs ORDER BY created_at DESC LIMIT 10",
      )
      .all(),
  })),
);
app.get(
  "/api/report",
  route((req) => {
    const report = req.query.id
      ? store.byId(String(req.query.id))
      : store.latest(
          String(req.query.date),
          String(req.query.session),
          String(req.query.market || "CN_A"),
        );
    return report?.demo ? null : report;
  }),
);
app.post(
  "/api/news/action",
  route((req) => {
    const a = z
      .object({
        report_id: z.string(),
        version: z.number().int(),
        sector: z.string(),
        action: z.literal("delete"),
        news_id: z.string().optional(),
        news: z.unknown().optional(),
      })
      .parse(req.body);
    return store.mutate(
      a.report_id,
      a.version,
      a.sector,
      a.action,
      a.news_id,
      a.news,
    );
  }),
);
app.post(
  "/api/supplements",
  route(async (req) => {
    const b = z
      .object({
        report_id: z.string(),
        sector: z.string(),
        query: z.string().max(1000),
      })
      .parse(req.body);
    const request = store.createSupplement(b.report_id, b.sector, b.query);
    try {
      await openWorkBuddy(request.prompt);
      return { request_id: request.request_id, status: "awaiting_send" };
    } catch {
      store.db
        .prepare("UPDATE supplements SET status='failed' WHERE id=?")
        .run(request.request_id);
      throw new Error("无法打开 WorkBuddy，请确认本机已安装并可正常启动");
    }
  }),
);
app.get(
  "/api/supplements",
  route((req) => {
    const report = store.byId(String(req.query.report_id));
    return store.db
      .prepare(
        "SELECT s.* FROM supplements s JOIN reports r ON r.id=s.report_id WHERE r.date=? AND r.market=? AND s.sector=? ORDER BY s.created_at DESC",
      )
      .all(report.date, report.market, String(req.query.sector))
      .map((row) => ({ ...row, items: JSON.parse(String(row.items)) }));
  }),
);
app.post(
  "/api/watchlist",
  route((req) => {
    const b = z
      .object({
        key: z.string().max(50),
        name: z.string().max(100),
        active: z.boolean(),
      })
      .parse(req.body);
    if (b.active)
      store.db
        .prepare("INSERT OR REPLACE INTO watchlist VALUES(?,?)")
        .run(b.key, b.name);
    else store.db.prepare("DELETE FROM watchlist WHERE key=?").run(b.key);
    return { ok: true };
  }),
);
app.get(
  "/api/knowledge",
  route(() => knowledge.scan()),
);
app.post(
  "/api/knowledge/root",
  route((req) => knowledge.setRoot(z.string().min(1).parse(req.body.path))),
);
app.post(
  "/api/knowledge/export",
  route((req) =>
    knowledge.exportNews(req.body.report_id, req.body.sector, req.body.news_id),
  ),
);
app.get("/api/knowledge/asset", async (req, res, next) => {
  try {
    const target = await knowledge.safePath(String(req.query.path));
    if (!/\.(png|jpe?g|gif|webp)$/i.test(target))
      throw new Error("仅支持安全图片格式");
    res.sendFile(target);
  } catch (e) {
    next(e);
  }
});
app.get(
  "/api/settings",
  route(() => ({
    connectors: Object.fromEntries(
      ["lark", "wecom"].map((p) => [
        p,
        {
          ...store.setting<any>(`connector:${p}`, {
            enabled: false,
            url: "",
            sheets: {},
          }),
          auth: store.setting(`auth:${p}`, null),
        },
      ]),
    ),
    jobs: store.db
      .prepare("SELECT * FROM sync_jobs ORDER BY created_at DESC LIMIT 30")
      .all(),
    knowledgeRoot: store.setting("knowledgeRoot", ""),
    mcp: {
      command: process.execPath,
      args: [
        path.join(store.projectRoot, "app/node_modules/tsx/dist/cli.mjs"),
        path.join(store.projectRoot, "app/server/mcp.ts"),
      ],
      env: { STOCKNEWS_DATA_DIR: store.dataDir },
    },
  })),
);
app.post(
  "/api/connectors/:platform",
  route((req) => {
    const p = z.enum(["lark", "wecom"]).parse(req.params.platform);
    const c = z
      .object({
        enabled: z.boolean(),
        url: z.string(),
        sheets: z.record(z.string(), z.string()),
      })
      .parse(req.body);
    if (c.url) {
      const u = new URL(c.url);
      if (
        u.protocol !== "https:" ||
        !(p === "lark"
          ? /(^|\.)(feishu\.cn|larksuite\.com)$/.test(u.hostname)
          : u.hostname === "doc.weixin.qq.com" &&
            u.pathname.startsWith("/sheet/"))
      )
        throw new Error("请提供支持的平台电子表格链接");
    }
    if (c.enabled && !c.url) throw new Error("请先填写目标表格");
    store.setSetting(`connector:${p}`, c);
    return { ok: true };
  }),
);
app.post(
  "/api/connectors/:platform/check",
  route((req) => check(z.enum(["lark", "wecom"]).parse(req.params.platform))),
);
app.post(
  "/api/sync",
  route((req) => {
    const p = z.enum(["lark", "wecom"]).parse(req.body.platform);
    store.byId(req.body.report_id);
    store.enqueue(p, req.body.report_id);
    return { queued: true };
  }),
);
app.post(
  "/api/sync/retry",
  route((req) => {
    store.db
      .prepare(
        "UPDATE sync_jobs SET status='pending',attempts=0,next_at=? WHERE id=? AND status!='running'",
      )
      .run(store.now(), String(req.body.id));
    return { ok: true };
  }),
);
app.post(
  "/api/backup",
  route(() => store.backupDb()),
);
const staticRoot = path.join(store.projectRoot, "app/dist/client");
app.use(express.static(staticRoot));
app.get("/{*path}", async (_req, res) => {
  try {
    await fs.access(path.join(staticRoot, "index.html"));
    res.sendFile(path.join(staticRoot, "index.html"));
  } catch {
    res.status(404).send("请运行 npm run dev 或先 npm run build");
  }
});
app.use((error: any, _req: any, res: any, _next: any) =>
  res.status(error.message?.includes("冲突") ? 409 : 400).json({
    error:
      error instanceof z.ZodError
        ? error.issues.map((i) => i.message).join("；")
        : error.message || "请求失败",
  }),
);
store.db
  .prepare("UPDATE sync_jobs SET status='pending' WHERE status='running'")
  .run();
const timer = setInterval(() => void runSync(), 15000);
timer.unref();
app.listen(Number(process.env.PORT || 4318), "127.0.0.1", () =>
  console.log("Stocknews API http://127.0.0.1:" + (process.env.PORT || 4318)),
);
