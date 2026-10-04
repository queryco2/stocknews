import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const temp = mkdtempSync(path.join(os.tmpdir(), "stocknews-stock-"));
process.env.STOCKNEWS_DATA_DIR = temp;
const s = await import("../server/stock-news.ts");
const { db } = await import("../server/store.ts");
after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
const stock = {
  name: "测试股票",
  symbol: "000001",
  exchange: "SZSE",
  market: "CN_A",
};
const item = (time: string) => ({
  title: "测试公告",
  summary: "可核实事实",
  published_at: time,
  fetched_at: time,
  sources: [{ name: "测试来源", url: "https://example.com/stock" }],
  verification: "full_text_read",
  related_stocks: [stock],
});
test("stock news persists without sector report, deduplicates and replays safely after deletion", () => {
  const req = s.createStockRequest("000001", "CN_A");
  const ctx = s.stockRequest(req.request_id);
  assert.equal(
    Date.parse(ctx.window_end) - Date.parse(ctx.window_start),
    86400000,
  );
  const n = item(ctx.window_end);
  const result = s.submitStockNews(req.request_id, "stock1", stock, [n, n]);
  assert.equal(result.count, 1);
  assert.equal(s.stockRequests()[0].stock.symbol, "000001");
  assert.deepEqual(
    s.submitStockNews(req.request_id, "stock1", stock, [n, n]),
    result,
  );
  assert.throws(
    () => s.submitStockNews(req.request_id, "stock1", stock, [n]),
    /冲突/,
  );
  s.deleteStockNews(req.request_id, s.stockRequests()[0].items[0].id);
  s.submitStockNews(req.request_id, "stock1", stock, [n, n]);
  assert.equal(s.stockRequests()[0].items.length, 0);
});
test("invalid sources, wrong stock/market and stale news do not publish", () => {
  const req = s.createStockRequest("测试股票", "CN_A"),
    ctx = s.stockRequest(req.request_id),
    n = item(ctx.window_end);
  assert.throws(
    () =>
      s.submitStockNews(req.request_id, "bad", { ...stock, market: "HK" }, [n]),
    /市场/,
  );
  assert.throws(
    () =>
      s.submitStockNews(req.request_id, "bad", stock, [
        { ...n, related_stocks: [] },
      ]),
    /关联/,
  );
  assert.throws(() =>
    s.submitStockNews(req.request_id, "bad", stock, [{ ...n, sources: [] }]),
  );
  assert.throws(
    () =>
      s.submitStockNews(req.request_id, "bad", stock, [
        { ...n, published_at: "2020-01-01T00:00:00Z" },
      ]),
    /范围/,
  );
  assert.equal(s.stockRequest(req.request_id).status, "awaiting_send");
  s.failStockRequest(req.request_id, "名称有歧义，请输入完整代码");
  assert.equal(s.stockRequest(req.request_id).status, "failed");
  assert.equal(s.submitStockNews(req.request_id, "empty", stock, []).count, 0);
  assert.equal(s.stockRequest(req.request_id).status, "completed");
});
