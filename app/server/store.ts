import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Report,
  News,
  type SavedReport,
  type NewsItem,
} from "../shared/schema.ts";
export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const dataDir = path.resolve(
  process.env.STOCKNEWS_DATA_DIR || path.join(projectRoot, ".data"),
);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(path.join(dataDir, "stocknews.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT);
INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,date TEXT NOT NULL,session TEXT NOT NULL,market TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(date,session,market,version));
CREATE INDEX IF NOT EXISTS report_date ON reports(date,session,market);
CREATE TABLE IF NOT EXISTS ingestion_runs(id TEXT PRIMARY KEY,batch TEXT UNIQUE NOT NULL,status TEXT NOT NULL,context TEXT NOT NULL,payload TEXT,hash TEXT,result TEXT,error TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pool_actions(id TEXT PRIMARY KEY,date TEXT,market TEXT,sector TEXT,news_id TEXT,action TEXT,payload TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS supplements(id TEXT PRIMARY KEY,report_id TEXT REFERENCES reports(id),sector TEXT,query TEXT,status TEXT,items TEXT,batch TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS watchlist(key TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_files(path TEXT PRIMARY KEY,title TEXT,tags TEXT,date TEXT,status TEXT,content TEXT,hash TEXT);
CREATE TABLE IF NOT EXISTS sync_jobs(id TEXT PRIMARY KEY,platform TEXT,report_id TEXT REFERENCES reports(id),status TEXT,attempts INTEGER DEFAULT 0,error TEXT,created_at TEXT,next_at TEXT,UNIQUE(platform,report_id));
CREATE TABLE IF NOT EXISTS sync_rows(platform TEXT,sheet TEXT,business_key TEXT,row_number INTEGER,hash TEXT,PRIMARY KEY(platform,sheet,business_key));`);
export const now = () => new Date().toISOString();
export const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
export const id = () => randomUUID();
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function setting<T>(key: string, fallback: T): T {
  const r = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return r ? JSON.parse(String(r.value)) : fallback;
}
export function setSetting(key: string, value: unknown) {
  db.prepare(
    "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(value));
}
export function newsId(n: { sources: { url: string }[]; title: string }) {
  return hash(n.sources[0]?.url || n.title).slice(0, 24);
}
function normalizeNews(n: any): NewsItem {
  const parsed = News.parse(n);
  return { ...parsed, id: newsId(parsed) };
}
export function latest(
  date: string,
  session: string,
  market = "CN_A",
): SavedReport | null {
  const r = db
    .prepare(
      "SELECT payload FROM reports WHERE date=? AND session=? AND market=? ORDER BY version DESC LIMIT 1",
    )
    .get(date, session, market);
  return r ? JSON.parse(String(r.payload)) : null;
}
export function byId(reportId: string): SavedReport {
  const r = db.prepare("SELECT payload FROM reports WHERE id=?").get(reportId);
  if (!r) throw new Error("报告不存在");
  return JSON.parse(String(r.payload));
}
export function reports() {
  return db
    .prepare(
      "SELECT id,date,session,market,version,created_at FROM reports ORDER BY date DESC,version DESC",
    )
    .all();
}
function persist(raw: any): SavedReport {
  const prev = latest(raw.date, raw.session, raw.market);
  const result = {
    ...raw,
    id: id(),
    version: (prev?.version || 0) + 1,
    created_at: now(),
  } as SavedReport;
  db.prepare("INSERT INTO reports VALUES(?,?,?,?,?,?,?)").run(
    result.id,
    result.date,
    result.session,
    result.market,
    result.version,
    JSON.stringify(result),
    result.created_at,
  );
  for (const platform of ["lark", "wecom"])
    if (setting<any>(`connector:${platform}`, {}).enabled)
      enqueue(platform, result.id);
  return result;
}
export function enqueue(platform: string, reportId: string) {
  db.prepare(
    "INSERT INTO sync_jobs(id,platform,report_id,status,created_at,next_at) VALUES(?,?,?,?,?,?) ON CONFLICT(platform,report_id) DO UPDATE SET status=CASE WHEN sync_jobs.status='running' THEN 'running' ELSE 'pending' END,error=NULL,next_at=excluded.next_at",
  ).run(id(), platform, reportId, "pending", now(), now());
}
export function begin(context: any) {
  const { batch_id, ...rest } = context;
  if (!batch_id) throw new Error("缺少 batch_id");
  return transaction(() => {
    const existing = db
      .prepare("SELECT * FROM ingestion_runs WHERE batch=?")
      .get(batch_id);
    if (existing) {
      if (existing.context !== JSON.stringify(rest))
        throw new Error("批次参数冲突");
      return { run_id: existing.id, status: existing.status };
    }
    const run = id();
    db.prepare(
      "INSERT INTO ingestion_runs(id,batch,status,context,created_at) VALUES(?,?,?,?,?)",
    ).run(run, batch_id, "receiving", JSON.stringify(rest), now());
    return { run_id: run, status: "receiving" };
  });
}
export function stage(runId: string, input: unknown) {
  const parsed = Report.parse(input);
  for (const sector of parsed.sectors) {
    if (sector.news.some((n) => n.origin !== "automatic"))
      throw new Error("采集接口只接受自动资讯");
    if (new Set(sector.news.map(newsId)).size !== sector.news.length)
      throw new Error("同板块出现重复原文");
  }
  return transaction(() => {
    const r = db.prepare("SELECT * FROM ingestion_runs WHERE id=?").get(runId);
    if (!r) throw new Error("运行不存在");
    const ctx = JSON.parse(String(r.context));
    for (const k of ["date", "session", "market"])
      if (ctx[k] !== parsed[k as keyof typeof parsed])
        throw new Error("报告与批次上下文不一致");
    const digest = hash(parsed);
    if (r.hash && r.hash !== digest)
      throw new Error("同批次内容冲突，请使用新批次编号");
    if (r.status === "published")
      return { status: "published", idempotent: true };
    db.prepare(
      "UPDATE ingestion_runs SET payload=?,hash=?,status='staged',error=NULL WHERE id=?",
    ).run(JSON.stringify(parsed), digest, runId);
    return {
      status: "staged",
      sectors: parsed.sectors.length,
      news: parsed.sectors.reduce((n, s) => n + s.news.length, 0),
    };
  });
}
export function finish(runId: string) {
  return transaction(() => {
    const r = db.prepare("SELECT * FROM ingestion_runs WHERE id=?").get(runId);
    if (!r) throw new Error("运行不存在");
    if (r.result) return JSON.parse(String(r.result));
    if (!r.payload) throw new Error("尚未提交数据");
    const raw = Report.parse(JSON.parse(String(r.payload))) as any;
    raw.sectors = raw.sectors
      .sort((a: any, b: any) => a.rank - b.rank)
      .map((s: any) => ({
        ...s,
        news: s.news.map(normalizeNews),
        supplements: [],
      }));
    const prev = latest(raw.date, raw.session, raw.market);
    if (raw.session === "morning") {
      const actions = db
        .prepare(
          "SELECT * FROM pool_actions WHERE date=? AND market=? ORDER BY created_at,id",
        )
        .all(raw.date, raw.market);
      for (const s of raw.sectors) {
        const blocked = new Set(
          actions
            .filter((a) => a.sector === s.key && a.action === "exclude")
            .map((a) => a.news_id),
        );
        s.news = s.news.filter((n: NewsItem) => !blocked.has(n.id));
        const old = prev?.sectors.find((x) => x.key === s.key);
        if (old) {
          const selectedIds = new Set(s.news.map((n: NewsItem) => n.id));
          s.supplements = old.supplements.filter(
            (n) => !blocked.has(n.id) && !selectedIds.has(n.id),
          );
        }
      }
      for (const old of prev?.sectors || [])
        if (!raw.sectors.some((s: any) => s.key === old.key)) {
          const kept = [...old.supplements];
          if (kept.length)
            raw.sectors.push({
              ...old,
              rank: 99,
              reason: "原板块已退榜 · 补充资讯",
              news: [],
              supplements: kept,
            });
        }
    }
    const result = persist(raw);
    db.prepare(
      "UPDATE ingestion_runs SET status='published',result=? WHERE id=?",
    ).run(
      JSON.stringify({
        report_id: result.id,
        version: result.version,
        status:
          raw.session === "morning" &&
          (raw.sectors.length < 10 ||
            raw.sectors.some((s: any) => s.news.length < 10))
            ? "partial"
            : "complete",
      }),
      runId,
    );
    return JSON.parse(
      String(
        db.prepare("SELECT result FROM ingestion_runs WHERE id=?").get(runId)!
          .result,
      ),
    );
  });
}
export function fail(runId: string, error: string) {
  db.prepare(
    "UPDATE ingestion_runs SET status='failed',error=? WHERE id=? AND status!='published'",
  ).run(error, runId);
  return { status: "failed" };
}
export function mutate(
  reportId: string,
  version: number,
  sectorKey: string,
  action: string,
  newsKey?: string,
  input?: unknown,
) {
  return transaction(() => {
    const report = byId(reportId);
    if (latest(report.date, report.session, report.market)?.version !== version)
      throw new Error("版本冲突，请刷新后重试");
    const s = report.sectors.find((s) => s.key === sectorKey);
    if (!s) throw new Error("板块不存在");
    const old = [...s.news, ...s.supplements].find((n) => n.id === newsKey);
    if (action !== "delete") throw new Error("仅支持删除资讯");
    if (!old) throw new Error("资讯不存在");
    s.news = s.news.filter((n) => n.id !== newsKey);
    s.supplements = s.supplements.filter((n) => n.id !== newsKey);
    db.prepare("INSERT INTO pool_actions VALUES(?,?,?,?,?,?,?,?)").run(
      id(),
      report.date,
      report.market,
      sectorKey,
      newsKey!,
      "exclude",
      "{}",
      now(),
    );
    return persist(report);
  });
}
export function createSupplement(
  reportId: string,
  sector: string,
  query: string,
) {
  const r = byId(reportId);
  if (!r.sectors.some((s) => s.key === sector)) throw new Error("板块不存在");
  const request = id();
  db.prepare("INSERT INTO supplements VALUES(?,?,?,?,?,?,?,?)").run(
    request,
    reportId,
    sector,
    query,
    "pending",
    "[]",
    null,
    now(),
  );
  return {
    request_id: request,
    prompt: `请通过股票工作台 MCP get_supplement_request 读取请求 ${request}。检索该板块在指定时间范围内尚未收录的重要消息，排除已选及已删除内容，每批最多10条，使用 submit_supplement 提交资讯，系统会去重并直接追加到本板块。每条必须有可核实来源、原始链接和发布时间，不得编造；无新增消息请提交空数组。`,
  };
}
export function supplementContext(request: string): any {
  const r = db.prepare("SELECT * FROM supplements WHERE id=?").get(request);
  if (!r) throw new Error("请求不存在");
  const report = byId(String(r.report_id));
  return {
    ...r,
    report: latest(report.date, report.session, report.market),
    excluded: db
      .prepare(
        "SELECT news_id FROM pool_actions WHERE date=? AND market=? AND sector=? AND action='exclude'",
      )
      .all(report.date, report.market, r.sector as string),
  };
}
export function submitSupplement(
  request: string,
  batch: string,
  items: unknown[],
) {
  if (items.length > 10) throw new Error("每批最多10条");
  return transaction(() => {
    const ctx = supplementContext(request);
    const parsed = items.map(normalizeNews);
    const r = byId(String(ctx.report_id));
    for (const n of parsed)
      if (
        n.origin !== "automatic" ||
        !n.published_at ||
        Date.parse(n.published_at) < Date.parse(r.window_start) ||
        Date.parse(n.published_at) > Date.parse(r.window_end)
      )
        throw new Error("资讯不在检索范围内");
    const existing = JSON.parse(String(ctx.items));
    if (ctx.batch === batch) {
      if (hash(existing) !== hash(parsed)) throw new Error("资讯批次内容冲突");
      return { count: existing.length };
    }
    if (ctx.batch) throw new Error("请求已完成，请创建新请求");
    const current = latest(r.date, r.session, r.market)!;
    const sector = current.sectors.find((s) => s.key === ctx.sector);
    if (!sector) throw new Error("板块已退榜，请刷新后选择板块");
    const seen = new Set([
      ...sector.news.map((n) => n.id),
      ...sector.supplements.map((n) => n.id),
      ...ctx.excluded.map((n: any) => n.news_id),
    ]);
    const added = parsed
      .filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      })
      .map((n) => ({ ...n, role: "supplement" as const, locked: false }));
    sector.supplements.push(...added);
    if (added.length) persist(current);
    db.prepare(
      "UPDATE supplements SET items=?,batch=?,status='completed' WHERE id=?",
    ).run(JSON.stringify(parsed), batch, request);
    return { count: parsed.length, added: added.length };
  });
}
export async function backupDb() {
  const name = `backup-${Date.now()}.sqlite`;
  await backup(db, path.join(dataDir, name));
  return { file: name };
}
