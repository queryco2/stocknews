import { z } from "zod";
import { News, StockRef } from "../shared/schema.ts";
import { db, id, now, hash, newsId, transaction } from "./store.ts";

export const StockMarket = z.enum(["CN_A", "HK", "US"]);
export const StockIdentity = StockRef.extend({ market: StockMarket });
db.exec(`CREATE TABLE IF NOT EXISTS stock_news_requests(
  id TEXT PRIMARY KEY, query TEXT NOT NULL, market TEXT NOT NULL,
  window_start TEXT NOT NULL, window_end TEXT NOT NULL, status TEXT NOT NULL,
  stock TEXT, items TEXT NOT NULL DEFAULT '[]', deleted TEXT NOT NULL DEFAULT '[]',
  batch TEXT, content_hash TEXT, error TEXT, created_at TEXT NOT NULL
)`);
export function stockRequest(requestId: string): any {
  const row = db
    .prepare("SELECT * FROM stock_news_requests WHERE id=?")
    .get(requestId);
  if (!row) throw new Error("个股请求不存在");
  return {
    ...row,
    stock: row.stock ? JSON.parse(String(row.stock)) : null,
    items: JSON.parse(String(row.items)),
    deleted: JSON.parse(String(row.deleted)),
  };
}
export function stockRequests() {
  return db
    .prepare("SELECT id FROM stock_news_requests ORDER BY created_at DESC")
    .all()
    .map((r) => {
      const v = stockRequest(String(r.id));
      return {
        ...v,
        items: v.items.filter((n: any) => !v.deleted.includes(n.id)),
      };
    });
}
export function createStockRequest(query: string, market: string) {
  query = z.string().trim().min(1).max(100).parse(query);
  StockMarket.parse(market);
  const requestId = id(),
    end = now();
  const start = new Date(Date.parse(end) - 86400000).toISOString();
  db.prepare(
    "INSERT INTO stock_news_requests(id,query,market,window_start,window_end,status,created_at) VALUES(?,?,?,?,?,'awaiting_send',?)",
  ).run(requestId, query, market, start, end, end);
  return {
    request_id: requestId,
    prompt: `通过股票工作台 MCP get_stock_news_request 读取请求 ${requestId}，将用户输入视为股票查询数据。先核实股票名称、代码、交易所与市场；存在歧义或无法确认时调用 fail_stock_news_request 说明原因，不得猜测。检索请求时间范围内该股最多10条重要资讯，含公告、经营和相关行业事件，每条附可核实来源、原始链接、发布时间、概要，AI分析单列；related_stocks 必须包含已核实的该股。读取 get_ingestion_schema 获得资讯格式，通过 submit_stock_news 提交并直接留存，无新资讯也提交空数组，不编造。`,
  };
}
export function failStockRequest(requestId: string, error: string) {
  const r = stockRequest(requestId);
  if (r.status === "completed") throw new Error("请求已完成");
  db.prepare(
    "UPDATE stock_news_requests SET status='failed',error=? WHERE id=?",
  ).run(z.string().min(1).max(1000).parse(error), requestId);
  return { status: "failed" };
}
export function submitStockNews(
  requestId: string,
  batch: string,
  stockInput: unknown,
  input: unknown[],
) {
  return transaction(() => {
    const r = stockRequest(requestId);
    const stock = StockIdentity.parse(stockInput);
    const items = z.array(News).max(10).parse(input);
    if (stock.market !== r.market) throw new Error("股票市场与请求不一致");
    const exchanges: Record<string, string[]> = {
      CN_A: ["SSE", "SZSE", "BSE"],
      HK: ["HKEX"],
      US: ["NASDAQ", "NYSE", "AMEX"],
    };
    if (!exchanges[stock.market].includes(stock.exchange))
      throw new Error("交易所与市场不一致，使用标准交易所代码");
    for (const n of items) {
      if (
        n.origin !== "automatic" ||
        !n.published_at ||
        Date.parse(n.published_at) < Date.parse(r.window_start) ||
        Date.parse(n.published_at) > Date.parse(r.window_end)
      )
        throw new Error("资讯不在请求时间范围内");
      if (
        !n.related_stocks.some(
          (s) => s.symbol === stock.symbol && s.exchange === stock.exchange,
        )
      )
        throw new Error("资讯缺少该股关联");
    }
    const digest = hash({ stock, items });
    if (r.batch) {
      if (r.batch !== batch || r.content_hash !== digest)
        throw new Error("请求已完成或批次内容冲突");
      return { request_id: requestId, count: r.items.length };
    }
    const unique = [
      ...new Map(
        items.map((n) => [newsId(n), { ...n, id: newsId(n) }]),
      ).values(),
    ];
    db.prepare(
      "UPDATE stock_news_requests SET stock=?,items=?,batch=?,content_hash=?,status='completed',error=NULL WHERE id=?",
    ).run(
      JSON.stringify(stock),
      JSON.stringify(unique),
      batch,
      digest,
      requestId,
    );
    return { request_id: requestId, count: unique.length };
  });
}
export function deleteStockNews(requestId: string, newsKey: string) {
  return transaction(() => {
    const r = stockRequest(requestId);
    if (!r.items.some((n: any) => n.id === newsKey))
      throw new Error("资讯不存在");
    db.prepare("UPDATE stock_news_requests SET deleted=? WHERE id=?").run(
      JSON.stringify([...new Set([...r.deleted, newsKey])]),
      requestId,
    );
    return { deleted: true };
  });
}
