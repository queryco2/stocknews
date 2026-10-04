import { begin, stage, finish, db, setSetting, dataDir } from "./store.ts";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
const names = [
  "半导体",
  "人工智能",
  "新能源",
  "医药生物",
  "消费电子",
  "机器人",
  "有色金属",
  "电力设备",
  "汽车",
  "消费",
];
export function seed() {
  if (db.prepare("SELECT count(*) AS n FROM reports").get()!.n)
    return { message: "已有报告，未加载演示数据" };
  for (const date of ["2026-09-29", "2026-09-30"]) {
    const window_start = `${date === "2026-09-29" ? "2026-09-28" : "2026-09-29"}T08:45:00+08:00`,
      window_end = `${date}T08:45:00+08:00`;
    const sectors = names.map((name, i) => ({
      key: "sector-" + i,
      name,
      rank: i + 1,
      reason: [
        "技术迭代与设备订单值得持续跟踪",
        "应用需求与产业链进展带来关注",
      ][i % 2],
      news: Array.from({ length: 10 }, (_, j) => ({
        title:
          j === 0
            ? [
                `${name}产业链迎来新进展，关注订单兑现`,
                `${name}行业观察：从技术突破到需求变化`,
              ][i % 2]
            : `${name}观察 ${j + 1}：${["产业政策与需求变化", "企业公告与订单动态", "价格与供需跟踪"][j % 3]}`,
        summary: `${name}产业链披露新的业务进展，涉及技术研发、客户验证和订单交付。后续关注相关公司的正式公告及量产进度。`,
        published_at: `${date}T0${7 - (j % 3)}:20:00+08:00`,
        fetched_at: window_end,
        sources: [
          {
            name: "示例资讯源 " + String.fromCharCode(65 + (j % 3)),
            url: `https://example.com/${date}/${i}/${j}`,
          },
        ],
        ai_analysis:
          "技术进展能否转化为订单仍需观察，可持续跟踪客户验证、产能利用率和交付节奏。",
        tags: [name, "行业动态"],
        verification: "summary_only",
        related_stocks:
          i === 0
            ? [{ symbol: "688981", exchange: "SSE", name: "中芯国际" }]
            : [],
      })),
    }));
    const run = begin({
      batch_id: `demo-${date}-morning`,
      date,
      session: "morning",
      market: "CN_A",
    });
    stage(String(run.run_id), {
      date,
      session: "morning",
      market: "CN_A",
      window_start,
      window_end,
      data_as_of: window_end,
      demo: true,
      coverage: "演示数据 · 10个板块 / 100条示例资讯",
      sectors,
    });
    finish(String(run.run_id));
    const base = {
      provider: "示例行情源",
      source_url: "https://example.com/market",
      as_of: `${date}T15:00:00+08:00`,
      currency: "CNY",
      flow_method: "示例主力资金净流入",
    };
    const explain = {
      fact: "演示：板块内个股出现明显分化，成交活跃度有所变化。",
      analysis: "演示推测：可能与行业事件及市场情绪有关，需结合原文核实。",
      status: "hypothesis",
      sources: [{ name: "示例资讯源", url: "https://example.com/event" }],
    };
    const stockNames = [
      "中芯国际",
      "北方华创",
      "宁德时代",
      "比亚迪",
      "贵州茅台",
      "恒瑞医药",
      "中际旭创",
      "东方财富",
      "中国移动",
      "立讯精密",
      "三一重工",
      "招商银行",
      "海天味业",
      "药明康德",
      "隆基绿能",
      "中国石油",
      "美的集团",
      "科大讯飞",
      "长江电力",
      "京东方A",
    ];
    const symbols = [
      "688981",
      "002371",
      "300750",
      "002594",
      "600519",
      "600276",
      "300308",
      "300059",
      "600941",
      "002475",
      "600031",
      "600036",
      "603288",
      "603259",
      "601012",
      "601857",
      "000333",
      "002230",
      "600900",
      "000725",
    ];
    const stock_stats = stockNames.map((name, i) => ({
      ...base,
      name,
      symbol: symbols[i],
      exchange: symbols[i].startsWith("6") ? "SSE" : "SZSE",
      sector: names[i % 10],
      close: Math.round((20 + i * 8.34) * 100) / 100,
      change_pct: i < 10 ? 10 - i * 0.82 : -(i - 9) * 0.79,
      turnover: (15 + i) * 1e8,
      turnover_pct: 3 + i * 0.3,
      net_inflow: (10 - i) * 1e7,
      limit_status: i === 0 ? "up" : "none",
      streak: i === 0 ? 2 : null,
      explanation: explain,
    }));
    const sector_stats = names.map((name, i) => ({
      ...base,
      key: "sector-" + i,
      name,
      change_pct: 3.26 - i * 0.54,
      turnover: (850 - i * 43) * 1e8,
      net_inflow: (35 - i * 7) * 1e8,
      up_count: 45 - i * 3,
      down_count: 12 + i * 3,
      limit_up_count: Math.max(0, 8 - i),
      explanation: explain,
    }));
    const close = begin({
      batch_id: `demo-${date}-close`,
      date,
      session: "close",
      market: "CN_A",
    });
    stage(String(close.run_id), {
      date,
      session: "close",
      market: "CN_A",
      window_start,
      window_end: `${date}T16:30:00+08:00`,
      data_as_of: base.as_of,
      demo: true,
      coverage: "演示样本20只股票 · 非全市场排名",
      sector_stats,
      stock_stats,
    });
    finish(String(close.run_id));
  }
  const root = path.join(dataDir, "knowledge-demo");
  mkdirSync(root, { recursive: true });
  for (const [i, name] of names.slice(0, 4).entries()) {
    const file = path.join(root, `${name}研究笔记.md`);
    if (!existsSync(file))
      writeFileSync(
        file,
        `---\ntitle: ${name}研究笔记\ntags: [${name}, 行业研究]\ndate: 2026-09-30\nstatus: ${i % 2 ? "待研究" : "研究中"}\n---\n# ${name}研究笔记\n\n这是可自由编辑的本地 Markdown 演示笔记。\n\n## 研究框架\n\n- 记录事实与原文出处\n- 跟踪订单和需求变化\n- 将个人判断与消息摘要分开\n\n## 跟踪清单\n\n| 项目 | 状态 |\n| --- | --- |\n| 产业进展 | 待核实 |\n| 公司公告 | 待补充 |\n\n> 使用 Obsidian 编辑后，工作台重新扫描即可更新。\n`,
      );
  }
  setSetting("knowledgeRoot", root);
  return { message: "已加载两日演示数据与4篇示例笔记" };
}
if (process.argv[1]?.endsWith("seed.ts")) {
  console.log(seed());
  db.close();
}
