import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Report, News, date } from "../shared/schema.ts";
import * as store from "./store.ts";
const server = new McpServer({ name: "stocknews-workbench", version: "1.0.0" });
function tool(
  name: string,
  description: string,
  schema: any,
  fn: (args: any) => unknown,
) {
  server.registerTool(
    name,
    { description, inputSchema: schema },
    async (args: any) => {
      try {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(await fn(args)) },
          ],
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: e instanceof Error ? e.message : String(e),
            },
          ],
        };
      }
    },
  );
}
tool(
  "get_ingestion_schema",
  "获取每日资讯10板块×10新闻和收盘行情的JSON Schema。资讯含周末及节假日，先读取规范再提交。",
  {},
  () => ({
    calendar_policy: {
      morning: "每日资讯，按自然日归档，包括周末及节假日；检索截至采集时刻的近24小时。morning为兼容既有接口保留的名称，不表示仅交易日可用。",
      close: "仅实际交易日的收盘行情；先核实市场交易日，不得将上一交易日数据标记为休市当天数据。",
    },
    report: z.toJSONSchema(Report),
    news: z.toJSONSchema(News),
    sequence: [
      "begin_ingestion",
      "submit_morning_report / submit_close_report",
      "finish_ingestion",
    ],
  }),
);
tool(
  "get_report_context",
  "读取指定日期的已选内容与用户排除项",
  {
    date,
    session: z.enum(["morning", "close"]),
    market: z.string().default("CN_A"),
  },
  (a) => ({
    report: store.latest(a.date, a.session, a.market),
    excluded: store.db
      .prepare(
        "SELECT sector,news_id,action FROM pool_actions WHERE date=? AND market=?",
      )
      .all(a.date, a.market),
  }),
);
tool(
  "begin_ingestion",
  "创建批次。相同batch_id和上下文可安全重试。",
  {
    batch_id: z.string().min(1),
    date,
    session: z.enum(["morning", "close"]),
    market: z.string().default("CN_A"),
  },
  store.begin,
);
for (const session of ["morning", "close"])
  tool(
    `submit_${session === "morning" ? "morning" : "close"}_report`,
    "暂存经过来源与时间校验的报告；finish后才发布。",
    { run_id: z.string(), report: Report },
    (a) => {
      if (a.report.session !== session) throw new Error("时段不匹配");
      return store.stage(a.run_id, a.report);
    },
  );
tool(
  "finish_ingestion",
  "发布报告并生成云端同步任务，保留已追加资讯并应用删除排除。",
  { run_id: z.string() },
  (a) => store.finish(a.run_id),
);
tool(
  "fail_ingestion",
  "记录采集失败，不影响旧报告。",
  { run_id: z.string(), error: z.string() },
  (a) => store.fail(a.run_id, a.error),
);
tool(
  "get_supplement_request",
  "读取用户创建的获取更多资讯请求，保留原时间范围。",
  { request_id: z.string() },
  (a) => store.supplementContext(a.request_id),
);
tool(
  "submit_supplement",
  "提交最多10条资讯，去重并直接追加到板块；重复批次不会重复入库。",
  {
    request_id: z.string(),
    batch_id: z.string(),
    items: z.array(News).max(10),
  },
  (a) => store.submitSupplement(a.request_id, a.batch_id, a.items),
);
await server.connect(new StdioServerTransport());
