import { z } from "zod";
const text = z.string().trim().min(1).max(20000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v),
    "无效日期",
  );
export const time = z.string().datetime({ offset: true });
export const url = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//.test(v), "仅允许 http/https");
export const Source = z.object({
  name: text,
  url,
  published_at: time.optional(),
});
export const StockRef = z.object({
  symbol: z.string().min(1).max(20),
  exchange: z.string().min(1).max(20),
  name: text,
});
export const News = z
  .object({
    id: z.string().optional(),
    title: text.max(300),
    summary: text,
    published_at: time.nullable(),
    fetched_at: time,
    sources: z.array(Source).max(20),
    ai_analysis: z.string().max(20000).default(""),
    tags: z.array(z.string().max(50)).max(20).default([]),
    related_stocks: z.array(StockRef).max(30).default([]),
    verification: z.enum(["full_text_read", "summary_only", "user_provided"]),
    origin: z.enum(["automatic", "manual"]).default("automatic"),
  })
  .superRefine((v, ctx) => {
    if (
      v.origin === "automatic" &&
      (!v.sources.length ||
        !v.published_at ||
        v.verification === "user_provided")
    )
      ctx.addIssue({
        code: "custom",
        message: "自动资讯必须提供发布时间、来源与核验状态",
      });
  });
export type NewsItem = z.infer<typeof News> & {
  id: string;
  locked?: boolean;
  removed?: boolean;
  role?: string;
};
export const Sector = z.object({
  key: text.max(100),
  name: text.max(100),
  rank: z.number().int().min(1).max(10),
  reason: text,
  news: z.array(News).max(10),
  supplements: z.array(News).default([]),
});
const Metric = z.number().finite().nullable();
export const Explanation = z
  .object({
    fact: z.string().max(20000).default(""),
    analysis: z.string().max(20000).default(""),
    status: z.enum(["verified", "hypothesis", "unknown"]).default("unknown"),
    sources: z.array(Source).default([]),
  })
  .superRefine((v, c) => {
    if (v.status === "verified" && !v.sources.length)
      c.addIssue({ code: "custom", message: "已核实原因必须提供依据" });
  });
const MarketSource = z.object({
  provider: text,
  source_url: url,
  as_of: time,
  currency: z.string().default("CNY"),
  flow_method: z.string().nullable().default(null),
});
export const SectorStat = MarketSource.extend({
  key: text,
  name: text,
  change_pct: Metric,
  turnover: Metric,
  net_inflow: Metric,
  up_count: Metric,
  down_count: Metric,
  limit_up_count: Metric,
  explanation: Explanation,
});
export const StockStat = MarketSource.extend({
  symbol: text,
  exchange: text,
  name: text,
  sector: text,
  close: Metric,
  change_pct: Metric,
  turnover: Metric,
  turnover_pct: Metric,
  net_inflow: Metric,
  limit_status: z
    .enum(["up", "down", "touched", "none", "unknown", "na"])
    .default("unknown"),
  streak: Metric,
  explanation: Explanation,
});
export const Report = z
  .object({
    date,
    session: z.enum(["morning", "close"]),
    market: z.string().default("CN_A"),
    window_start: time,
    window_end: time,
    data_as_of: time,
    demo: z.boolean().default(false),
    coverage: z.string().min(1),
    sectors: z.array(Sector).max(10).default([]),
    sector_stats: z.array(SectorStat).max(1000).default([]),
    stock_stats: z.array(StockStat).max(10000).default([]),
  })
  .superRefine((r, c) => {
    if (Date.parse(r.window_start) > Date.parse(r.window_end))
      c.addIssue({ code: "custom", message: "时间范围倒置" });
    if (r.session === "morning") {
      if (!r.sectors.length)
        c.addIssue({ code: "custom", message: "早盘至少需要一个板块" });
      if (
        new Set(r.sectors.map((s) => s.key)).size !== r.sectors.length ||
        new Set(r.sectors.map((s) => s.rank)).size !== r.sectors.length
      )
        c.addIssue({ code: "custom", message: "板块或排名重复" });
      for (const s of r.sectors)
        for (const n of s.news)
          if (
            n.origin === "automatic" &&
            n.published_at &&
            (Date.parse(n.published_at) < Date.parse(r.window_start) ||
              Date.parse(n.published_at) > Date.parse(r.window_end))
          )
            c.addIssue({ code: "custom", message: "新闻不在检索时间范围内" });
    } else if (!r.stock_stats.length && !r.sector_stats.length)
      c.addIssue({ code: "custom", message: "收盘至少需要一条行情" });
    for (const rows of [r.stock_stats, r.sector_stats])
      for (const row of rows)
        if (row.net_inflow !== null && !row.flow_method)
          c.addIssue({ code: "custom", message: "资金流向必须注明口径" });
    if (
      new Set(r.stock_stats.map((s) => s.exchange + ":" + s.symbol)).size !==
      r.stock_stats.length
    )
      c.addIssue({ code: "custom", message: "个股行情重复" });
  });
export type ReportData = z.infer<typeof Report>;
export type SavedReport = Omit<ReportData, "sectors"> & {
  id: string;
  version: number;
  created_at: string;
  sectors: (Omit<z.infer<typeof Sector>, "news" | "supplements"> & {
    news: NewsItem[];
    supplements: NewsItem[];
  })[];
};
