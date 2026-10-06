import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { Converter } from "opencc-js";
import { db, now, transaction, setting, setSetting } from "./store.ts";
export type Market = "CN_A" | "HK" | "US";
export type CatalogStock = { key: string; market: Market; exchange: string; symbol: string; name: string; aliases: string[]; source_url: string; updated_at?: string };
const simplify = Converter({ from: "hk", to: "cn" });
export const sources: Record<Market, { name: string; url: string }> = {
  CN_A: { name: "巨潮资讯", url: "https://www.cninfo.com.cn/new/data/szse_stock.json" },
  HK: { name: "香港交易所", url: "https://www.hkex.com.hk/chi/services/trading/securities/securitieslists/ListOfSecurities_c.xlsx" },
  US: { name: "Nasdaq Trader", url: "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt" },
};
db.exec(`CREATE TABLE IF NOT EXISTS stock_catalog(
  key TEXT PRIMARY KEY, market TEXT NOT NULL, exchange TEXT NOT NULL, symbol TEXT NOT NULL,
  name TEXT NOT NULL, aliases TEXT NOT NULL, search_text TEXT NOT NULL,
  source_url TEXT NOT NULL, updated_at TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1
); CREATE INDEX IF NOT EXISTS stock_catalog_market_symbol ON stock_catalog(market,symbol);`);
const normalized = (s: string) => simplify(s).toUpperCase().replace(/\s/g, "");
function stock(market: Market, exchange: string, symbol: string, name: string, aliases: string[] = []): CatalogStock {
  return { key: `${market}:${exchange}:${symbol}`, market, exchange, symbol, name: name.trim(), aliases, source_url: sources[market].url };
}
export function parseCN(data: any): CatalogStock[] {
  if (!Array.isArray(data.stockList)) throw new Error("A股目录格式发生变化");
  return data.stockList.flatMap((r: any) => {
    if (r.category !== "A股" || !/^\d{6}$/.test(r.code) || typeof r.zwjc !== "string") return [];
    const exchange = /^6/.test(r.code) ? "SSE" : /^(00|30)/.test(r.code) ? "SZSE" : /^(4|8|92)/.test(r.code) ? "BSE" : "";
    return exchange ? [stock("CN_A", exchange, r.code, r.zwjc, [r.pinyin || ""])] : [];
  });
}
export function parseUS(text: string): CatalogStock[] {
  const lines = text.trim().split(/\r?\n/), headers = lines.shift()!.split("|");
  if (!headers.includes("Listing Exchange") || !text.includes("File Creation Time")) throw new Error("美股目录不完整或格式发生变化");
  const exchanges: Record<string, string> = { Q: "NASDAQ", N: "NYSE", A: "AMEX" };
  return lines.flatMap(line => {
    const values = line.split("|"), r = Object.fromEntries(headers.map((h,i)=>[h, values[i]]));
    const exchange = exchanges[r["Listing Exchange"]];
    if (!exchange || r.ETF !== "N" || r["Test Issue"] !== "N" || !r.Symbol || !r["Security Name"]) return [];
    // Keep ordinary/common equity and depositary shares; exclude warrants, units and preferred issues.
    if (!/common (stock|shares)|ordinary shares|depositary (shares|receipts)|american depository/i.test(r["Security Name"]) || /\b(warrants?|units?|preferred)\b/i.test(r["Security Name"])) return [];
    return [stock("US", exchange, r.Symbol, r["Security Name"], [r["CQS Symbol"], r["NASDAQ Symbol"]].filter(Boolean))];
  });
}
export async function parseHK(buffer: Buffer): Promise<CatalogStock[]> {
  const wanted = ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"];
  const files = unzipSync(buffer, { filter: f => wanted.includes(f.name) && f.originalSize < 40_000_000 });
  if (wanted.some(name=>!files[name])) throw new Error("港股目录文件不完整或超出大小限制");
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: false, isArray: tag=>["si","r","row","c"].includes(tag) });
  const shared = parser.parse(strFromU8(files[wanted[0]])).sst?.si;
  const sheet = parser.parse(strFromU8(files[wanted[1]])).worksheet?.sheetData?.row;
  if (!Array.isArray(shared) || !Array.isArray(sheet)) throw new Error("港股目录格式发生变化");
  const cellText = (v: any): string => typeof v === "string" ? v : v?.["#text"] || "";
  const strings = shared.map((si:any)=>si.r ? si.r.map((r:any)=>cellText(r.t)).join("") : cellText(si.t));
  const values = sheet.map((r:any)=>Object.fromEntries((r.c || []).map((c:any)=>[String(c["@_r"]).replace(/[0-9]/g,""), c["@_t"] === "s" ? strings[Number(c.v)] : String(c.v || "")])));
  if (!values.some(r=>r.A === "股份代號" && r.B === "股份名稱")) throw new Error("港股目录格式发生变化");
  const rows: CatalogStock[] = [];
  for (const r of values) {
    const symbol = r.A?.padStart(5,"0"), name = r.B;
    if (/^\d{5}$/.test(symbol || "") && r.C === "股本" && name) rows.push(stock("HK", "HKEX", symbol, name, [simplify(name)]));
  }
  return rows;
}
export function publishCatalog(market: Market, rows: CatalogStock[]) {
  const unique = [...new Map(rows.map(r=>[r.key,r])).values()];
  if (!unique.length || unique.some(r => r.market !== market || !r.name || !r.symbol || r.key !== `${r.market}:${r.exchange}:${r.symbol}`)) throw new Error("股票目录内容无效");
  return transaction(() => {
    const updated = now();
    db.prepare("UPDATE stock_catalog SET available=0 WHERE market=?").run(market);
    const upsert = db.prepare(`INSERT INTO stock_catalog VALUES(?,?,?,?,?,?,?,?,?,1) ON CONFLICT(key) DO UPDATE SET name=excluded.name,aliases=excluded.aliases,search_text=excluded.search_text,source_url=excluded.source_url,updated_at=excluded.updated_at,available=1`);
    for (const r of unique) {
      const old = db.prepare("SELECT name,aliases FROM stock_catalog WHERE key=?").get(r.key);
      const aliases = [...new Set([...r.aliases, ...(old ? [String(old.name), ...JSON.parse(String(old.aliases))] : [])])].filter(Boolean);
      upsert.run(r.key,r.market,r.exchange,r.symbol,r.name,JSON.stringify(aliases),normalized([r.symbol,r.name,...aliases].join("|")),r.source_url,updated);
    }
    setSetting(`catalog:${market}`, { updated_at: updated, attempted_at: updated, count: unique.length, error: null });
    return unique.length;
  });
}
export function catalogStock(key: string): CatalogStock {
  const r = db.prepare("SELECT * FROM stock_catalog WHERE key=? AND available=1").get(key);
  if (!r) throw new Error("股票不在当前基础库，请更新后重新选择");
  return { ...r, aliases: JSON.parse(String(r.aliases)) } as unknown as CatalogStock;
}
export function searchStocks(query: string, market: Market) {
  const q = normalized(query.trim());
  if (!q) return [];
  const numeric = /^\d+$/.test(q) ? q.padStart(market === "HK" ? 5 : 6,"0") : q;
  return db.prepare(`SELECT key,market,exchange,symbol,name,source_url,updated_at FROM stock_catalog
    WHERE market=? AND available=1 AND (instr(search_text,?)>0 OR symbol=?)
    ORDER BY CASE WHEN symbol=? THEN 0 WHEN symbol=? THEN 1 WHEN name=? THEN 2 WHEN substr(symbol,1,length(?))=? THEN 3 ELSE 4 END,symbol LIMIT 12`)
    .all(market,q,numeric,q,numeric,query,q,q);
}
const inFlight = new Map<Market, Promise<unknown>>();
export function catalogStatus() {
  return Object.entries(sources).map(([market, source]) => ({ market, source, ...setting<any>(`catalog:${market}`, {count:0,updated_at:null,error:null}), refreshing: inFlight.has(market as Market) }));
}
export function refreshCatalog(market: Market): Promise<unknown> {
  const running = inFlight.get(market); if (running) return running;
  const task = (async () => {
    try {
      const res = await fetch(sources[market].url, { signal: AbortSignal.timeout(45000), headers: { "User-Agent": "Mozilla/5.0 Stocknews/1.0" } });
      if (!res.ok) throw new Error(`来源返回 HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > 20_000_000) throw new Error("来源文件超出大小限制");
      const rows = market === "CN_A" ? parseCN(JSON.parse(buffer.toString())) : market === "US" ? parseUS(buffer.toString()) : await parseHK(buffer);
      const old = setting<any>(`catalog:${market}`, {count:0});
      if (rows.length < 1000 || rows.length < old.count * 0.8) throw new Error("目录数量异常，保留上次数据");
      publishCatalog(market, rows);
    } catch (e) {
      setSetting(`catalog:${market}`, { ...setting<any>(`catalog:${market}`,{count:0,updated_at:null}), attempted_at: now(), error: (e as Error).message });
    } finally { inFlight.delete(market); }
    return catalogStatus().find(s=>s.market===market);
  })();
  inFlight.set(market,task); return task;
}
export async function refreshStaleCatalogs() {
  await Promise.all((Object.keys(sources) as Market[]).filter(m => {
    const state=setting<any>(`catalog:${m}`,{});
    return !state.attempted_at || Date.now()-Date.parse(state.attempted_at) > (state.error ? 3600000 : 86400000);
  }).map(refreshCatalog));
}
