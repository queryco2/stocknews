import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
const temp = mkdtempSync(path.join(os.tmpdir(), "stocknews-test-"));
process.env.STOCKNEWS_DATA_DIR = temp;
const s = await import("../server/store.ts");
const k = await import("../server/knowledge.ts");
const { Report } = await import("../shared/schema.ts");
const { exportRows, parseRead } = await import("../server/connectors.ts");
after(() => {
  s.db.close();
  rmSync(temp, { recursive: true, force: true });
});
const news = (n = 0) => ({
  title: `事件${n}`,
  summary: "可核实事实",
  published_at: "2026-09-30T07:00:00+08:00",
  fetched_at: "2026-09-30T08:00:00+08:00",
  sources: [{ name: "测试来源", url: `https://example.com/${n}` }],
  verification: "full_text_read",
  origin: "automatic",
});
const morning = () => ({
  date: "2026-09-30",
  session: "morning",
  market: "CN_A",
  window_start: "2026-09-29T08:30:00+08:00",
  window_end: "2026-09-30T08:30:00+08:00",
  data_as_of: "2026-09-30T08:30:00+08:00",
  coverage: "测试",
  sectors: [
    {
      key: "chip",
      name: "半导体",
      rank: 1,
      reason: "政策与订单",
      news: Array.from({ length: 10 }, (_, i) => news(i)),
    },
  ],
});
let latest: any;
function ingest(batch: string, report = morning()) {
  const r = s.begin({
    batch_id: batch,
    date: report.date,
    session: report.session,
    market: report.market,
  });
  s.stage(String(r.run_id), report);
  const result = s.finish(String(r.run_id));
  return { r, result, report: s.byId(result.report_id) };
}
test("strict sources, timestamp, URL and rank validation", () => {
  assert.equal(Report.safeParse(morning()).success, true);
  for (const modify of [
    (r: any) => (r.sectors[0].news[0].sources = []),
    (r: any) => (r.sectors[0].news[0].sources[0].url = "javascript:alert(1)"),
    (r: any) =>
      (r.sectors[0].news[0].published_at = "2026-09-28T07:00:00+08:00"),
    (r: any) => r.sectors.push(r.sectors[0]),
  ]) {
    const r = morning();
    modify(r);
    assert.equal(Report.safeParse(r).success, false);
  }
});
test("publish idempotence, duplicate batch conflicts, atomic staging", () => {
  const { r, result, report } = ingest("first");
  latest = report;
  assert.deepEqual(s.finish(String(r.run_id)), result);
  assert.equal(s.reports().length, 1);
  assert.throws(
    () =>
      s.begin({
        batch_id: "first",
        date: "2026-10-01",
        session: "morning",
        market: "CN_A",
      }),
    /冲突/,
  );
  const changed = morning();
  changed.coverage = "changed";
  assert.throws(() => s.stage(String(r.run_id), changed), /冲突/);
});
test("delete persists across refresh; historical version immutable", () => {
  const original = latest;
  latest = s.mutate(
    latest.id,
    latest.version,
    "chip",
    "delete",
    latest.sectors[0].news[1].id,
  );
  assert.equal(latest.sectors[0].news.length, 9);
  assert.equal(s.byId(original.id).sectors[0].news.length, 10);
  latest = ingest("refresh").report;
  assert.equal(latest.sectors[0].news.length, 9);
  assert.ok(!latest.sectors[0].news.some((n: any) => n.title === "事件1"));
});
test("only deletion is allowed and stale versions are rejected", () => {
  assert.throws(
    () =>
      s.mutate(
        latest.id,
        latest.version,
        "chip",
        "retain",
        undefined,
        news(100),
      ),
    /仅支持删除/,
  );
  assert.throws(
    () =>
      s.mutate(
        latest.id,
        latest.version - 1,
        "chip",
        "delete",
        latest.sectors[0].news[0].id,
      ),
    /版本冲突/,
  );
});
test("supplement appends directly, excludes duplicates/deletions and survives refresh", () => {
  const original = latest;
  const req = s.createSupplement(latest.id, "chip", "更多");
  const items = [news(200), news(200), news(0), news(1)];
  assert.equal(s.submitSupplement(req.request_id, "supp1", items).added, 1);
  latest = s.latest("2026-09-30", "morning");
  assert.equal(latest.sectors[0].supplements.length, 1);
  assert.equal(s.byId(original.id).sectors[0].supplements.length, 0);
  assert.equal(s.submitSupplement(req.request_id, "supp1", items).count, 4);
  assert.equal(s.latest("2026-09-30", "morning")!.version, latest.version);
  assert.throws(
    () => s.submitSupplement(req.request_id, "supp1", [news(201)]),
    /冲突/,
  );
  latest = ingest("refresh-2").report;
  assert.equal(latest.sectors[0].supplements.length, 1);
});
test("WorkBuddy task link encodes prompt as a single value", async () => {
  const { workBuddyTaskUrl } = await import("../server/workbuddy.ts");
  const prompt = "半导体 & action=other # \n来源";
  const url = new URL(workBuddyTaskUrl(prompt));
  assert.equal(url.protocol, "workbuddy:");
  assert.equal(url.searchParams.get("action"), "start");
  assert.equal(url.searchParams.get("prompt"), prompt);
});
test("MCP JSON schema can be generated", async () => {
  const { z } = await import("zod");
  const schema = z.toJSONSchema(Report);
  assert.equal(schema.type, "object");
});
test("knowledge indexed, external edits recognized, symlink escape rejected", async () => {
  const root = path.join(temp, "notes");
  mkdirSync(root);
  writeFileSync(
    path.join(root, "note.md"),
    "---\ntitle: 测试笔记\ntags: [半导体]\n---\n# 原内容",
  );
  await k.setRoot(root);
  assert.equal((await k.scan())[0].title, "测试笔记");
  writeFileSync(path.join(root, "note.md"), "# 更新后的笔记");
  assert.equal((await k.scan())[0].title, "更新后的笔记");
  symlinkSync("/etc", path.join(root, "outside"));
  await assert.rejects(k.safePath("outside/hosts"), /授权/);
  await assert.rejects(k.safePath("../stocknews.sqlite"), /授权/);
});
test("export markdown non-destructive and indexed", async () => {
  const n = latest.sectors[0].news[0];
  const exported = await k.exportNews(latest.id, "chip", n.id);
  assert.ok(
    readFileSync(path.join(temp, "notes", exported.path), "utf8").includes(
      "https://example.com/0",
    ),
  );
  assert.ok((await k.scan()).length >= 2);
});
test("sync exports preserve stock codes and percentage numeric types", () => {
  const r: any = {
    ...latest,
    sectors: [],
    session: "close",
    stock_stats: [
      {
        symbol: "000001",
        exchange: "SZSE",
        name: "测试",
        sector: "银行",
        change_pct: 3.26,
        turnover: 100,
        net_inflow: null,
        flow_method: null,
        provider: "source",
        source_url: "https://example.com",
        as_of: "2026-09-30",
        explanation: { fact: "", analysis: "", sources: [] },
      },
    ],
    sector_stats: [],
  };
  const rows = exportRows(r)["个股涨幅榜"];
  assert.equal(rows[0][5], "000001");
  assert.equal(rows[0][9], 0.0326);
  assert.equal(rows[0][11], null);
});
test("sync read rejects truncated responses", () => {
  assert.throws(() => parseRead("lark", { has_more: true }), /截断/);
  const r = parseRead("wecom", {
    grid_data: {
      start_row: 1,
      rows: [
        {
          values: [
            { cell_value: { text: "000001" } },
            { cell_value: { number: 0.0326 } },
          ],
        },
      ],
    },
  });
  assert.deepEqual(r.get(2), ["000001", 0.0326]);
});
test("consistent database backup exists", async () => {
  const result = await s.backupDb();
  assert.ok(readFileSync(path.join(temp, result.file)).length > 1000);
});
