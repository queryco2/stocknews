import { spawn } from "node:child_process";
import { db, setting, setSetting, byId, hash, now } from "./store.ts";
import type { SavedReport } from "../shared/schema.ts";
export type Platform = "lark" | "wecom";
export type Config = {
  enabled: boolean;
  url: string;
  sheets: Record<string, string>;
};
export function cli(
  platform: Platform,
  args: string[],
  input?: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const p = spawn(platform === "lark" ? "lark-cli" : "wecom-cli", args, {
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("CLI超时，请检查登录或网络"));
    }, 60000);
    p.stdout.on("data", (v) => {
      out += v;
      if (out.length > 15_000_000) {
        p.kill();
        reject(new Error("CLI返回超出限制"));
      }
    });
    p.stderr.on("data", (v) => {
      err += v;
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(
          new Error(
            `CLI执行失败（${code}），请在终端检查授权与目标权限。${err.includes("confirmation_required") ? "操作需要人工确认。" : ""}`,
          ),
        );
      try {
        let r = JSON.parse(out);
        if (r.ok === false || r.errcode) throw new Error("平台返回失败");
        resolve(r.data ?? r);
      } catch (e) {
        if (out.trim() === "authorized") resolve({ authorized: true });
        else reject(new Error("CLI返回无法识别，请检查CLI版本"));
      }
    });
    p.stdin.end(input);
  });
}
export async function check(platform: Platform) {
  try {
    const r = await cli(
      platform,
      platform === "lark"
        ? ["auth", "status", "--json", "--verify"]
        : ["auth", "show", "--status"],
    );
    const ok =
      platform === "lark"
        ? r.verified === true || r.identities?.user?.tokenStatus === "valid"
        : r.authorized === true || r.status === "authorized";
    const result = {
      checked_at: now(),
      authorized: ok,
      message: ok ? "授权已验证" : "请在本机CLI完成授权",
    };
    setSetting(`auth:${platform}`, result);
    return result;
  } catch (e) {
    return { authorized: false, message: (e as Error).message };
  }
}
export const headers = [
  "工作台记录键",
  "归档日期",
  "类型",
  "排名",
  "板块",
  "代码",
  "名称或标题",
  "概要或事实",
  "AI分析",
  "涨跌幅",
  "成交额",
  "资金净流入",
  "资金口径",
  "来源",
  "原文链接",
  "数据时间",
  "报告版本",
  "状态",
];
export function exportRows(r: SavedReport) {
  const sheets: Record<string, any[][]> = {};
  const push = (sheet: string, row: any[]) => {
    (sheets[sheet] ??= []).push(row);
  };
  for (const s of r.sectors) {
    push("每日板块", [
      `${r.date}:${r.market}:focus:${s.key}`,
      r.date,
      "重点板块",
      s.rank,
      s.name,
      "",
      s.name,
      s.reason,
      "",
      null,
      null,
      null,
      "",
      "",
      "",
      r.data_as_of,
      r.version,
      "有效",
    ]);
    for (const n of [...s.news, ...s.supplements])
      push("早盘资讯", [
        `${r.date}:${r.market}:news:${s.key}:${n.id}`,
        r.date,
        n.role === "supplement" ? "补充资讯" : "精选资讯",
        s.news.indexOf(n) >= 0 ? s.news.indexOf(n) + 1 : null,
        s.name,
        "",
        n.title,
        n.summary,
        n.ai_analysis,
        null,
        null,
        null,
        "",
        n.sources.map((x) => x.name).join("；"),
        n.sources.map((x) => x.url).join("\n"),
        n.published_at || "",
        r.version,
        "有效",
      ]);
  }
  for (const s of r.sector_stats)
    push("收盘板块", [
      `${r.date}:${r.market}:sector:${s.key}`,
      r.date,
      "板块行情",
      null,
      s.name,
      "",
      s.name,
      s.explanation.fact,
      s.explanation.analysis,
      s.change_pct === null ? null : s.change_pct / 100,
      s.turnover,
      s.net_inflow,
      s.flow_method,
      s.provider,
      [s.source_url, ...s.explanation.sources.map((x) => x.url)].join("\n"),
      s.as_of,
      r.version,
      "有效",
    ]);
  for (const [sheet, sign] of [
    ["个股涨幅榜", 1],
    ["个股跌幅榜", -1],
  ] as const) {
    const rows = r.stock_stats
      .filter((s) => s.change_pct !== null && s.change_pct * sign > 0)
      .sort(
        (a, b) =>
          sign * ((b.change_pct || 0) - (a.change_pct || 0)) ||
          (b.turnover || 0) - (a.turnover || 0) ||
          a.symbol.localeCompare(b.symbol),
      )
      .slice(0, 10);
    rows.forEach((s, i) =>
      push(sheet, [
        `${r.date}:${r.market}:${sheet}:${s.exchange}:${s.symbol}`,
        r.date,
        sheet,
        i + 1,
        s.sector,
        s.symbol,
        s.name,
        s.explanation.fact,
        s.explanation.analysis,
        s.change_pct === null ? null : s.change_pct / 100,
        s.turnover,
        s.net_inflow,
        s.flow_method,
        s.provider,
        [s.source_url, ...s.explanation.sources.map((x) => x.url)].join("\n"),
        s.as_of,
        r.version,
        "有效",
      ]),
    );
  }
  const watched = new Set(
    db
      .prepare("SELECT key FROM watchlist")
      .all()
      .map((x) => x.key),
  );
  for (const s of r.stock_stats.filter((s) =>
    watched.has(s.exchange + ":" + s.symbol),
  ))
    push("关注个股", [
      `${r.date}:${r.market}:watch:${s.exchange}:${s.symbol}`,
      r.date,
      "关注个股",
      null,
      s.sector,
      s.symbol,
      s.name,
      s.explanation.fact,
      s.explanation.analysis,
      s.change_pct === null ? null : s.change_pct / 100,
      s.turnover,
      s.net_inflow,
      s.flow_method,
      s.provider,
      s.source_url,
      s.as_of,
      r.version,
      "有效",
    ]);
  const expected =
    r.session === "morning"
      ? ["每日板块", "早盘资讯"]
      : ["收盘板块", "个股涨幅榜", "个股跌幅榜", "关注个股"];
  for (const key of expected) sheets[key] ??= [];
  return sheets;
}
function docid(url: string) {
  const u = new URL(url);
  if (
    !u.hostname.endsWith("weixin.qq.com") ||
    !u.pathname.startsWith("/sheet/")
  )
    throw new Error("第一版同步需企业微信在线表格 /sheet/ 链接");
  return u.pathname.split("/")[2];
}
export function parseRead(platform: Platform, result: any): Map<number, any[]> {
  if (result.has_more || result.truncated)
    throw new Error("表格读取被截断，停止写入");
  const rows = new Map<number, any[]>();
  if (platform === "lark") {
    if (!Array.isArray(result.ranges)) throw new Error("飞书读取结构不兼容");
    for (const range of result.ranges) {
      if (range.has_more || range.truncated) throw new Error("表格读取被截断");
      if (!range.row_indices || !range.cells) throw new Error("缺少单元格定位");
      range.cells.forEach((row: any[], i: number) =>
        rows.set(
          Number(range.row_indices[i]),
          row.map(
            (c) =>
              c.value ?? c.rich_text?.map((t: any) => t.text).join("") ?? "",
          ),
        ),
      );
    }
  } else {
    const g = result.grid_data;
    if (!g?.rows) throw new Error("企业微信读取结构不兼容");
    g.rows.forEach((row: any, i: number) =>
      rows.set(
        (g.start_row || 0) + i + 1,
        (row.values || []).map(
          (v: any) =>
            v.cell_value?.number ??
            v.cell_value?.text ??
            v.cell_value?.link?.url ??
            "",
        ),
      ),
    );
  }
  return rows;
}
export async function readRange(
  platform: Platform,
  c: Config,
  sheet: string,
  range: string,
) {
  const result = await cli(
    platform,
    platform === "lark"
      ? [
          "sheets",
          "+cells-get",
          "--url",
          c.url,
          "--sheet-id",
          sheet,
          "--range",
          range,
          "--include",
          "value",
        ]
      : [
          "sheet",
          "ranges",
          "get",
          "--json",
          JSON.stringify({
            docid: docid(c.url),
            sheet_id: sheet,
            mode: "default",
            range,
          }),
        ],
  );
  return parseRead(platform, result);
}
export async function writeRows(
  platform: Platform,
  c: Config,
  sheet: string,
  start: number,
  rows: any[][],
) {
  if (platform === "lark") {
    const cells = rows.map((row) =>
      row.map((value, j) =>
        typeof value === "number"
          ? {
              value,
              cell_styles: { number_format: j === 9 ? "0.00%" : "#,##0.00" },
            }
          : {
              rich_text: [{ type: "text", text: String(value ?? "") }],
              cell_styles: { number_format: "@" },
            },
      ),
    );
    await cli(
      platform,
      [
        "sheets",
        "+cells-set",
        "--url",
        c.url,
        "--sheet-id",
        sheet,
        "--range",
        `A${start}:R${start + rows.length - 1}`,
        "--cells",
        "-",
      ],
      JSON.stringify(cells),
    );
  } else {
    await cli(platform, [
      "sheet",
      "contents",
      "update",
      "--json",
      JSON.stringify({
        docid: docid(c.url),
        sheet_id: sheet,
        grid_data: {
          start_row: start - 1,
          start_column: 0,
          rows: rows.map((row) => ({
            values: row.map((value) => ({
              data_type: typeof value === "number" ? "number" : "text",
              cell_value:
                typeof value === "number"
                  ? { number: value }
                  : { text: String(value ?? "") },
              cell_format: {},
            })),
          })),
        },
      }),
    ]);
  }
  const actual = await readRange(
    platform,
    c,
    sheet,
    `A${start}:R${start + rows.length - 1}`,
  );
  for (let i = 0; i < rows.length; i++) {
    const got = actual.get(start + i);
    if (
      !got ||
      rows[i].some((v, j) =>
        typeof v === "number"
          ? Math.abs(Number(got[j]) - v) > 1e-7
          : String(got[j] ?? "") !== String(v ?? ""),
      )
    )
      throw new Error("写入后回读不一致，未标记同步成功");
  }
}
export async function syncReport(
  platform: Platform,
  r: SavedReport,
  c: Config,
) {
  if (!c.enabled) throw new Error("连接器未启用");
  if (r.demo) throw new Error("演示数据默认禁止自动同步，请先接入真实报告");
  const groups = exportRows(r);
  for (const [name, rows] of Object.entries(groups)) {
    const sheet = c.sheets[name];
    if (!sheet) throw new Error(`请配置工作表：${name}`);
    const meta = await cli(
      platform,
      platform === "lark"
        ? ["sheets", "+sheet-info", "--url", c.url, "--sheet-id", sheet]
        : ["sheet", "get", "--json", JSON.stringify({ docid: docid(c.url) })],
    );
    const info =
      platform === "lark"
        ? (meta.sheet ?? meta)
        : (meta.sheets || []).find((s: any) => s.sheet_id === sheet);
    const rowCount = Number(
      info?.row_count ?? info?.properties?.grid_properties?.row_count,
    );
    if (!Number.isInteger(rowCount) || rowCount < 1)
      throw new Error("无法确认工作表行数，停止写入");
    if (rowCount > 5000)
      throw new Error("当前工作表超过5000行，请使用独立归档表");
    const existing = new Map<number, any[]>();
    for (let start = 1; start <= rowCount; start += 200) {
      const chunk = await readRange(
        platform,
        c,
        sheet,
        `A${start}:R${Math.min(rowCount, start + 199)}`,
      );
      for (const [n, row] of chunk)
        if (row.some((v) => v !== "" && v !== null)) existing.set(n, row);
    }
    if ([...existing.keys()].some((k) => k >= 4990))
      throw new Error("工作表接近5000行，请配置新的归档工作表");
    const head = existing.get(1);
    if (head?.some((v) => v !== "")) {
      if (head[0] !== headers[0])
        throw new Error("目标不是工作台专属表，停止覆盖");
    } else await writeRows(platform, c, sheet, 1, [headers]);
    const index = new Map<string, number>();
    for (const [n, row] of existing)
      if (n > 1 && row[0]) {
        if (index.has(String(row[0])))
          throw new Error("远程业务键重复，请处理后重试");
        index.set(String(row[0]), n);
      }
    let last = Math.max(1, ...existing.keys());
    const desired = new Set(rows.map((row) => row[0]));
    for (const row of rows) {
      const n = index.get(row[0]) || ++last;
      if (n > rowCount) throw new Error("工作表行数不足，请先扩充行数");
      if (hash(existing.get(n)) !== hash(row))
        await writeRows(platform, c, sheet, n, [row]);
    }
    const prefix = `${r.date}:${r.market}:`;
    for (const [n, row] of existing)
      if (
        n > 1 &&
        String(row[0]).startsWith(prefix) &&
        !desired.has(row[0]) &&
        row[17] !== "已移除"
      ) {
        const updated = [...row];
        updated[16] = r.version;
        updated[17] = "已移除";
        await writeRows(platform, c, sheet, n, [updated]);
      }
  }
}
let working = false;
export async function runSync() {
  if (working) return;
  working = true;
  try {
    const jobs = db
      .prepare(
        "SELECT * FROM sync_jobs WHERE status='pending' AND next_at<=? ORDER BY created_at LIMIT 50",
      )
      .all(now());
    for (const j of jobs) {
      const c = setting<Config>(`connector:${j.platform}`, {
        enabled: false,
        url: "",
        sheets: {},
      });
      if (!c.enabled) continue;
      const report = byId(String(j.report_id));
      const latest = db
        .prepare(
          "SELECT MAX(version) AS v FROM reports WHERE date=? AND session=? AND market=?",
        )
        .get(report.date, report.session, report.market);
      if (Number(latest?.v) > report.version) {
        db.prepare(
          "UPDATE sync_jobs SET status='skipped',error='已由新版本替代' WHERE id=?",
        ).run(j.id as string);
        continue;
      }
      db.prepare(
        "UPDATE sync_jobs SET status='running',attempts=attempts+1 WHERE id=?",
      ).run(j.id as string);
      try {
        await syncReport(j.platform as Platform, byId(String(j.report_id)), c);
        db.prepare(
          "UPDATE sync_jobs SET status='success',error=NULL WHERE id=?",
        ).run(j.id as string);
      } catch (e) {
        const attempts = Number(j.attempts) + 1;
        db.prepare(
          "UPDATE sync_jobs SET status=?,error=?,next_at=? WHERE id=?",
        ).run(
          attempts >= 3 ? "failed" : "pending",
          (e as Error).message,
          new Date(Date.now() + Math.pow(2, attempts) * 30000).toISOString(),
          j.id as string,
        );
      }
      break;
    }
  } finally {
    working = false;
  }
}
