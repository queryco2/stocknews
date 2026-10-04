import { useEffect, useState, useCallback } from "react";
import {
  ChartBar,
  Newspaper,
  Books,
  GearSix,
  ArrowSquareOut,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  Plus,
  ArrowClockwise,
  Link as LinkIcon,
  Robot,
  ArrowRight,
  FileText,
  Sparkle,
  Trash,
  Lock,
  LockOpen,
  BookmarkSimple,
  X,
  Copy,
  CheckCircle,
  WarningCircle,
  FolderOpen,
  SquaresFour,
  List,
  Download,
  Star,
  TrendUp,
  TrendDown,
  Database,
  Plugs,
  Clock,
  Check,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SavedReport, NewsItem } from "../shared/schema";
import { api, setToken } from "./api";
const dayTime = (s: string | undefined | null) =>
  s
    ? new Date(s).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "未提供";
const pct = (n: number | null) =>
  n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const money = (n: number | null) =>
  n === null
    ? "—"
    : Math.abs(n) >= 1e8
      ? `${(n / 1e8).toFixed(2)}亿`
      : n.toLocaleString("zh-CN");
const color = (n: number | null) =>
  n === null || n === 0 ? "" : n > 0 ? "up" : "down";
function SourceLink({
  url,
  children,
}: {
  url: string;
  children?: React.ReactNode;
}) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children || "查看原文"} <ArrowSquareOut size={14} />
    </a>
  );
}
function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Newspaper size={42} weight="light" />
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function App() {
  const [page, setPage] = useState("news"),
    [session, setSession] = useState("morning"),
    [date, setDate] = useState(""),
    [market, setMarket] = useState("CN_A"),
    [boot, setBoot] = useState<any>(null),
    [report, setReport] = useState<SavedReport | null>(null),
    [version, setVersion] = useState(""),
    [sector, setSector] = useState(""),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [source, setSource] = useState(""),
    [modal, setModal] = useState<React.ReactNode>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const tell = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 4500);
  };
  const refresh = useCallback(async () => {
    const b = await api("/bootstrap");
    setToken(b.token);
    setBoot(b);
    setDate(
      (d) => d || b.reports[0]?.date || new Date().toISOString().slice(0, 10),
    );
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!date) return;
    let active = true;
    setLoading(true);
    api<SavedReport | null>(
      version
        ? `/report?id=${version}`
        : `/report?date=${date}&session=${session}&market=${market}`,
    )
      .then((r) => {
        if (active) {
          setReport(r);
          setSector((k) =>
            r?.sectors.some((s) => s.key === k) ? k : r?.sectors[0]?.key || "",
          );
          setSelected("");
          setError("");
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [date, session, version, market, boot]);
  useEffect(() => {
    const timer = setInterval(() => {
      api("/bootstrap")
        .then((b) => {
          setToken(b.token);
          setBoot((old: any) =>
            JSON.stringify(old?.reports) === JSON.stringify(b.reports)
              ? old
              : b,
          );
        })
        .catch(() => {});
    }, 12000);
    return () => clearInterval(timer);
  }, []);
  const run = async (fn: () => Promise<any>, message?: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (message) tell(message);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const changeSession = (s: string) => {
    setSession(s);
    setVersion("");
    setSource("");
    setQuery("");
  };
  const current = report?.sectors.find((s) => s.key === sector);
  const news = [
    ...(current?.news || []),
    ...(current?.supplements || []),
  ].filter(
    (n) =>
      (!query ||
        [n.title, n.summary, ...n.tags].some((t) => t.includes(query))) &&
      (!source || n.sources.some((s) => s.name === source)),
  );
  const item = news.find((n) => n.id === selected) || news[0];
  const commit = async (action: string, newsId?: string, input?: any) => {
    if (!report) return;
    const result = await run(
      () =>
        api("/news/action", {
          report_id: report.id,
          version: report.version,
          sector,
          action,
          news_id: newsId,
          news: input,
        }),
      action === "delete"
        ? "已移除，下次获取不会自动恢复"
        : "已保存到本地资讯库",
    );
    if (result) {
      setVersion("");
      await refresh();
    }
    return result;
  };
  const deleteNews = () =>
    setModal(
      <Confirm
        title="移除这条资讯？"
        detail="只从当前日期和板块移除，历史版本仍然保留。自动更新不会将它重新加入。"
        onConfirm={async () => {
          await commit("delete", item?.id);
          setModal(null);
        }}
        onCancel={() => setModal(null)}
      />,
    );
  const more = async () => {
    if (!report || busy) return;
    const result = await run(() =>
      api("/supplements", {
        report_id: report.id,
        sector,
        query: `${current?.name}更多主要资讯`,
      }),
    );
    if (result) {
      setVersion("");
      tell("已打开 WorkBuddy，请发送预填任务；结果将自动追加");
    }
  };
  const today = new Date().toLocaleDateString("en-CA");
  const reportDayLabel = !date || date === today ? "今日" : `${date.slice(5, 7)}月${date.slice(8, 10)}日`;
  const newsHeading = `${reportDayLabel}${session === "morning" ? "热点资讯" : "收盘复盘"}`;
  const versions =
    boot?.reports.filter(
      (r: any) =>
        r.date === date && r.session === session && r.market === market,
    ) || [];
  const prevDay = (delta: number) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
    setVersion("");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <ChartBar size={28} weight="duotone" />
          <span>股票工作台</span>
        </div>
        <nav>
          <button
            className={page === "news" ? "active" : ""}
            onClick={() => setPage("news")}
          >
            <Newspaper size={21} />
            资讯中心
          </button>
          <button
            className={page === "knowledge" ? "active" : ""}
            onClick={() => setPage("knowledge")}
          >
            <Books size={21} />
            知识库
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => setPage("settings")}
          >
            <GearSix size={20} />
            设置与连接
          </button>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <h1>
              {page === "news"
                ? newsHeading
                : page === "knowledge"
                  ? "知识库"
                  : "设置与连接"}
            </h1>
          </div>
          <div className="header-actions">
            {page === "news" && <></>}
            {page === "knowledge" && (
              <button onClick={() => setPage("settings")}>
                <FolderOpen size={18} />
                管理文件夹
              </button>
            )}
          </div>
        </header>
        {error && (
          <div role="alert" className="error-banner">
            <WarningCircle size={18} />
            {error}
            <button aria-label="关闭错误" onClick={() => setError("")}>
              <X />
            </button>
          </div>
        )}
        {page === "news" && (
          <>
            <div className="toolbar">
              <div className="date-picker">
                <button aria-label="前一天" onClick={() => prevDay(-1)}>
                  <CaretLeft />
                </button>
                <CalendarBlank />
                <input
                  aria-label="报告日期"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setVersion("");
                  }}
                />
                <button aria-label="后一天" onClick={() => prevDay(1)}>
                  <CaretRight />
                </button>
              </div>
              <div className="segment">
                <button
                  className={session === "morning" ? "active" : ""}
                  onClick={() => changeSession("morning")}
                >
                  早盘资讯
                </button>
                <button
                  className={session === "close" ? "active" : ""}
                  onClick={() => changeSession("close")}
                >
                  收盘复盘
                </button>
              </div>
              <select
                aria-label="市场"
                value={market}
                onChange={(e) => {
                  setMarket(e.target.value);
                  setVersion("");
                }}
              >
                <option value="CN_A">A 股市场</option>
                <option value="HK">港股市场</option>
                <option value="US">美股市场</option>
              </select>
              <div className="toolbar-end">
                {report?.demo && (
                  <span className="badge warm">演示数据 · 非实时</span>
                )}
                {report && (
                  <span className="muted cutoff">
                    <Clock size={14} />
                    截至 {dayTime(report.data_as_of)}
                  </span>
                )}
                <select
                  aria-label="报告版本"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  <option value="">最新版本</option>
                  {versions.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      v{v.version} · {dayTime(v.created_at)}
                    </option>
                  ))}
                </select>
                <button aria-label="刷新报告" onClick={() => run(refresh)}>
                  <ArrowClockwise />
                </button>
              </div>
            </div>
            {loading ? (
              <Empty title="正在读取本地报告…" />
            ) : !report ? (
              <Empty
                title="这一天还没有报告"
                detail="在 WorkBuddy 执行采集任务，通过 MCP 写入后即可查看。"
              >
                {!boot?.reports.length && (
                  <button
                    className="primary"
                    onClick={() =>
                      run(async () => {
                        await api("/demo", {});
                        await refresh();
                      }, "演示数据已加载")
                    }
                  >
                    加载演示数据，体验工作台
                  </button>
                )}
                <button onClick={() => setPage("settings")}>
                  查看接入方式 <ArrowRight />
                </button>
              </Empty>
            ) : session === "morning" ? (
              <>
                <div className="sector-strip">
                  {report.sectors.map((s) => (
                    <button
                      key={s.key}
                      className={sector === s.key ? "selected" : ""}
                      onClick={() => {
                        setSector(s.key);
                        setSelected("");
                        setQuery("");
                        setSource("");
                      }}
                    >
                      <span className="rank">
                        {String(s.rank === 99 ? "留" : s.rank).padStart(2, "0")}
                      </span>
                      <strong>{s.name}</strong>
                    </button>
                  ))}
                </div>
                <div className="filter-row">
                  <label className="search">
                    <MagnifyingGlass size={18} />
                    <input
                      placeholder="搜索消息、股票或关键词"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="资讯来源"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">全部来源</option>
                    {[
                      ...new Set(
                        [
                          ...(current?.news || []),
                          ...(current?.supplements || []),
                        ].flatMap((n) => n.sources.map((s) => s.name)),
                      ),
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <span className="muted">{news.length} 条资讯</span>
                  <button
                    className="more-button"
                    disabled={!current}
                    onClick={more}
                  >
                    获取更多资讯 <ArrowRight size={16} />
                  </button>
                </div>
                <div className="news-workspace">
                  <section className="news-list" aria-label="资讯列表">
                    {news.length ? (
                      news.map((n, i) => (
                        <button
                          key={n.id}
                          className={
                            "news-row " + (item?.id === n.id ? "selected" : "")
                          }
                          onClick={() => setSelected(n.id)}
                        >
                          <div className="news-row-top">
                            <span>{String(i + 1).padStart(2, "0")}</span>
                            <span className="news-row-source">{n.sources[0]?.name || "用户提供"}</span>
                            <small>{dayTime(n.published_at)}</small>
                          </div>
                          <h3>{n.title}</h3>
                          <p>{n.summary}</p>
                        </button>
                      ))
                    ) : (
                      <Empty
                        title="没有匹配的资讯"
                        detail="试试其他关键词或来源"
                      />
                    )}
                  </section>
                  <section className="news-detail">
                    {item ? (
                      <>
                        <div className="detail-top">
                          <span className="badge">{current?.name}</span>
                          <div className="detail-tools">
                            <button
                              title="删除资讯"
                              aria-label="删除资讯"
                              onClick={deleteNews}
                            >
                              <Trash size={17} />
                            </button>
                          </div>
                        </div>
                        <h2>{item.title}</h2>
                        <div className="detail-meta">
                          {item.sources[0]?.name || "用户提供"} ·{" "}
                          {dayTime(item.published_at)}
                          {item.verification === "summary_only" && (
                            <span>仅摘要</span>
                          )}
                        </div>
                        <div className="detail-section">
                          <p>{item.summary}</p>
                        </div>
                        <div className="analysis-box">
                          <h3>AI 解读</h3>
                          <p>
                            {item.ai_analysis ||
                              "这条资讯暂无 AI 解读，保留原始事实。"}
                          </p>
                        </div>
                        <div className="detail-section">
                          <h3>
                            <LinkIcon size={19} />
                            信息来源 <span>{item.sources.length}</span>
                          </h3>
                          {item.sources.length ? (
                            item.sources.map((s, i) => (
                              <div className="source-row" key={s.url}>
                                <span className="source-number">{i + 1}</span>
                                <div>
                                  <strong>{s.name}</strong>
                                  <small>{new URL(s.url).hostname}</small>
                                </div>
                                <SourceLink url={s.url} />
                              </div>
                            ))
                          ) : (
                            <p className="muted">
                              用户提供的内容，未填写原文链接。
                            </p>
                          )}
                        </div>
                        {item.related_stocks.length > 0 && (
                          <div className="detail-section">
                            <h3>
                              <TrendUp size={19} />
                              关联股票
                            </h3>
                            <div className="related-stocks">
                              {item.related_stocks.map((s) => (
                                <span key={s.symbol}>
                                  {s.name} <small>{s.symbol}</small>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="detail-footer">
                          <button
                            onClick={() =>
                              run(
                                () =>
                                  api("/knowledge/export", {
                                    report_id: report.id,
                                    sector,
                                    news_id: item.id,
                                  }),
                                "已保存为 Markdown，可在知识库查看",
                              )
                            }
                          >
                            <BookmarkSimple size={17} />
                            保存到知识库
                          </button>
                        </div>
                      </>
                    ) : (
                      <Empty title="选择一条资讯，开始阅读" />
                    )}
                  </section>
                </div>
              </>
            ) : (
              <CloseView
                report={report}
                watched={boot?.watchlist || []}
                onWatch={async (s, active) => {
                  await run(() =>
                    api("/watchlist", {
                      key: s.exchange + ":" + s.symbol,
                      name: s.name,
                      active,
                    }),
                  );
                  await refresh();
                }}
              />
            )}
          </>
        )}
        {page === "knowledge" && (
          <Knowledge onSettings={() => setPage("settings")} />
        )}
        {page === "settings" && (
          <Settings report={report} notify={tell} onError={setError} />
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle size={19} />
          {notice}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {modal}
          </div>
        </div>
      )}
    </div>
  );
}
function Confirm({ title, detail, onConfirm, onCancel }: any) {
  return (
    <>
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="modal-actions">
        <button onClick={onCancel}>取消</button>
        <button className="danger" onClick={onConfirm}>
          确定移除
        </button>
      </div>
    </>
  );
}
function CloseView({
  report,
  watched,
  onWatch,
}: {
  report: SavedReport;
  watched: any[];
  onWatch: (s: any, active: boolean) => void;
}) {
  const [tab, setTab] = useState("overview"),
    [count, setCount] = useState(10),
    [selected, setSelected] = useState<any>(null);
  const sorted = (sign: number) =>
    report.stock_stats
      .filter((s) => s.change_pct !== null && s.change_pct * sign > 0)
      .sort(
        (a, b) =>
          sign * ((b.change_pct || 0) - (a.change_pct || 0)) ||
          (b.turnover || 0) - (a.turnover || 0) ||
          a.symbol.localeCompare(b.symbol),
      )
      .slice(0, count);
  const up = sorted(1),
    down = sorted(-1);
  const isWatched = (s: any) =>
    watched.some((w) => w.key === s.exchange + ":" + s.symbol);
  const rows =
    tab === "up"
      ? up
      : tab === "down"
        ? down
        : tab === "limit"
          ? report.stock_stats.filter(
              (s) => s.limit_status === "up" || s.limit_status === "down",
            )
          : report.stock_stats.filter(isWatched);
  const stockTable = (data: any[]) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>排名</th>
            <th>股票 / 板块</th>
            <th>收盘价</th>
            <th>涨跌幅</th>
            <th>成交额</th>
            <th>原因与依据</th>
            <th>关注</th>
          </tr>
        </thead>
        <tbody>
          {data.map((s, i) => (
            <tr key={s.exchange + s.symbol}>
              <td className="rank-cell">{i + 1}</td>
              <td>
                <strong>{s.name}</strong>
                <small>
                  {s.symbol} · {s.sector}
                </small>
              </td>
              <td>{s.close?.toFixed(2) || "—"}</td>
              <td className={color(s.change_pct)}>
                <strong>{pct(s.change_pct)}</strong>
              </td>
              <td>{money(s.turnover)}</td>
              <td>
                <button className="text-button" onClick={() => setSelected(s)}>
                  {" "}
                  {s.explanation.status === "unknown"
                    ? "原因待核实"
                    : "查看异动原因"}{" "}
                  <ArrowRight size={14} />
                </button>
              </td>
              <td>
                <button
                  aria-label={"关注" + s.name}
                  className={isWatched(s) ? "starred" : ""}
                  onClick={() => onWatch(s, !isWatched(s))}
                >
                  <Star size={17} weight={isWatched(s) ? "fill" : "regular"} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && <Empty title="暂无匹配的股票" />}
    </div>
  );
  return (
    <>
      <p className="coverage-note">{report.coverage}</p>
      <div className="close-tabs">
        {[
          ["overview", "市场概览"],
          ["sectors", "板块表现"],
          ["up", "涨幅榜"],
          ["down", "跌幅榜"],
          ["limit", "涨跌停"],
          ["watch", "我的关注"],
        ].map(([k, n]) => (
          <button
            className={tab === k ? "active" : ""}
            key={k}
            onClick={() => setTab(k)}
          >
            {n}
          </button>
        ))}
        <select
          aria-label="榜单数量"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        >
          <option value={10}>前 10 名</option>
          <option value={20}>前 20 名</option>
          <option value={50}>前 50 名</option>
        </select>
      </div>
      {tab === "overview" ? (
        <div className="ranking-pair">
          {[
            [up, "涨幅前列", 1],
            [down, "跌幅前列", -1],
          ].map(([data, title, sign]: any) => (
            <section className="ranking-panel" key={title}>
              <h3>
                {sign === 1 ? (
                  <TrendUp className="up" />
                ) : (
                  <TrendDown className="down" />
                )}
                {title}
                <span>TOP {count}</span>
              </h3>
              {data.map((s: any, i: number) => (
                <button
                  className="rank-stock"
                  key={s.symbol}
                  onClick={() => setSelected(s)}
                >
                  <span className="rank-cell">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{s.name}</strong>
                    <small>
                      {s.symbol} · {s.sector}
                    </small>
                  </div>
                  <strong className={color(s.change_pct)}>
                    {pct(s.change_pct)}
                  </strong>
                  <ArrowRight size={16} />
                </button>
              ))}
            </section>
          ))}
        </div>
      ) : tab === "sectors" ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>板块</th>
                <th>涨跌幅</th>
                <th>成交额</th>
                <th>资金净流入</th>
                <th>资金口径</th>
                <th>上涨 / 下跌</th>
                <th>热点原因</th>
              </tr>
            </thead>
            <tbody>
              {[...report.sector_stats]
                .sort(
                  (a, b) =>
                    (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity),
                )
                .map((s) => (
                  <tr key={s.key}>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td className={color(s.change_pct)}>{pct(s.change_pct)}</td>
                    <td>{money(s.turnover)}</td>
                    <td className={color(s.net_inflow)}>
                      {money(s.net_inflow)}
                    </td>
                    <td>
                      <small>{s.flow_method || "暂无口径"}</small>
                    </td>
                    <td>
                      {s.up_count ?? "—"} / {s.down_count ?? "—"}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setSelected(s)}
                      >
                        查看依据 <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        stockTable(rows)
      )}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <h2>
                {selected.name}{" "}
                <span className={color(selected.change_pct)}>
                  {pct(selected.change_pct)}
                </span>
              </h2>
              <button aria-label="关闭" onClick={() => setSelected(null)}>
                <X />
              </button>
            </div>
            <p className="muted">
              {selected.provider} · {dayTime(selected.as_of)}
            </p>
            <div className="detail-section">
              <h3>已披露事实</h3>
              <p>{selected.explanation.fact || "原因待核实"}</p>
            </div>
            <div className="analysis-box">
              <h3>
                可能催化 <small>AI 分析</small>
              </h3>
              <p>{selected.explanation.analysis || "暂无分析"}</p>
            </div>
            <div className="detail-section">
              <h3>资金流向</h3>
              <p>
                {money(selected.net_inflow)} ·{" "}
                {selected.flow_method || "暂无数据口径"}
              </p>
            </div>
            <h3>原因依据</h3>
            {selected.explanation.sources.map((s: any) => (
              <div className="source-row" key={s.url}>
                <span>{s.name}</span>
                <SourceLink url={s.url} />
              </div>
            ))}
            <div className="source-row">
              <span>行情数据来源</span>
              <SourceLink url={selected.source_url} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function Knowledge({ onSettings }: { onSettings: () => void }) {
  const [files, setFiles] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [view, setView] = useState("board"),
    [q, setQ] = useState(""),
    [tag, setTag] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    api("/knowledge")
      .then((f) => {
        setFiles(f);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  const filtered = files.filter(
    (f) =>
      (!q || f.title.includes(q) || f.content.includes(q)) &&
      (!tag || f.tags.includes(tag)),
  );
  const active = files.find((f) => f.path === selected) || filtered[0];
  const markdown = (f: any) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith("http"))
            return <SourceLink url={href}>{children}</SourceLink>;
          return (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                const name = decodeURIComponent(href || "").replace(
                  /\.md$/,
                  "",
                );
                const match = files.find(
                  (v) =>
                    v.path.replace(/\.md$/, "") === name || v.title === name,
                );
                if (match) {
                  setSelected(match.path);
                  setView("docs");
                } else setError("未找到该内部文档");
              }}
            >
              {children}
            </a>
          );
        },
        img: ({ src, alt }) => {
          if (!src || /^https?:/.test(src))
            return (
              <span className="muted">{alt || "远程图片（未自动加载）"}</span>
            );
          const base = f.path.split("/").slice(0, -1).join("/");
          return (
            <img
              src={
                "/api/knowledge/asset?path=" +
                encodeURIComponent(base ? base + "/" + src : src)
              }
              alt={alt}
            />
          );
        },
      }}
    >
      {f.content.replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_: string, name: string, alias: string) =>
          `[${alias || name}](${encodeURI(name + ".md")})`,
      )}
    </ReactMarkdown>
  );
  return (
    <>
      <div className="toolbar">
        <label className="search">
          <MagnifyingGlass />
          <input
            placeholder="搜索笔记标题或正文"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="segment">
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => setView("board")}
          >
            <SquaresFour />
            看板
          </button>
          <button
            className={view === "docs" ? "active" : ""}
            onClick={() => setView("docs")}
          >
            <List />
            文档
          </button>
        </div>
        <select
          aria-label="知识标签"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">全部主题</option>
          {[...new Set(files.flatMap((f) => f.tags))].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <div className="toolbar-end">
          <span className="muted">{files.length} 篇 Markdown</span>
          <button aria-label="重新扫描" onClick={load}>
            <ArrowClockwise />
          </button>
        </div>
      </div>
      {error && <p className="error-banner">{error}</p>}
      {!files.length ? (
        <Empty
          title={loading ? "正在读取 Markdown…" : "连接你的知识文件夹"}
          detail="直接读取本地 Markdown 或 Obsidian 库，文件始终留在原处。"
        >
          <button className="primary" onClick={onSettings}>
            选择文件夹
          </button>
        </Empty>
      ) : view === "board" ? (
        <>
          <div className="knowledge-grid">
            {filtered.map((f) => (
              <button
                className="knowledge-card"
                key={f.path}
                onClick={() => {
                  setSelected(f.path);
                  setView("docs");
                }}
              >
                <div>
                  <FileText size={24} />
                  <span className="badge">{f.status}</span>
                </div>
                <h3>{f.title}</h3>
                <p>{f.content.replace(/[#>*|\-]/g, "").slice(0, 115)}</p>
                <div className="tags">
                  {f.tags
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((t: string) => (
                      <span key={t}>{t}</span>
                    ))}
                </div>
                <footer>
                  <span>{f.date || "未设置日期"}</span>
                  <ArrowRight />
                </footer>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="document-workspace">
          <div className="document-list">
            {filtered.map((f) => (
              <button
                className={active?.path === f.path ? "selected" : ""}
                key={f.path}
                onClick={() => setSelected(f.path)}
              >
                <FileText />
                <span>
                  {f.title}
                  <small>{f.path}</small>
                </span>
              </button>
            ))}
          </div>
          <article className="markdown">
            {active ? (
              <>
                <div className="detail-meta">
                  <FolderOpen />
                  {active.path}
                  <span>原文件只读 · 外部编辑自动更新</span>
                </div>
                {markdown(active)}
              </>
            ) : (
              <Empty title="没有匹配的笔记" />
            )}
          </article>
        </div>
      )}
    </>
  );
}
function Settings({
  report,
  notify,
  onError,
}: {
  report: SavedReport | null;
  notify: (s: string) => void;
  onError: (s: string) => void;
}) {
  const [data, setData] = useState<any>(null),
    [root, setRoot] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/settings").then((d) => {
      setData(d);
      setRoot(d.knowledgeRoot);
    });
  useEffect(() => {
    load().catch((e) => onError(e.message));
  }, []);
  const act = async (fn: () => Promise<any>, message: string) => {
    setBusy(true);
    try {
      await fn();
      notify(message);
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <Empty title="正在加载设置…" />;
  return (
    <div className="settings">
      <section className="settings-panel">
        <div className="settings-heading">
          <Robot size={25} />
          <div>
            <h2>WorkBuddy · MCP 接入</h2>
            <p>在 WorkBuddy 创建任务，将结果写入这个工作台。</p>
          </div>
          <span className="badge">本地 stdio</span>
        </div>
        <p className="muted">
          将以下配置添加到支持 MCP 的客户端。任务和定时设置留在
          WorkBuddy，工作台不主动发起采集。
        </p>
        <pre>
          {JSON.stringify({ mcpServers: { stocknews: data.mcp } }, null, 2)}
        </pre>
        <button
          onClick={() =>
            act(
              () =>
                navigator.clipboard.writeText(
                  JSON.stringify(
                    { mcpServers: { stocknews: data.mcp } },
                    null,
                    2,
                  ),
                ),
              "MCP 配置已复制",
            )
          }
        >
          <Copy />
          复制配置
        </button>
        <details>
          <summary>查看早盘任务提示词</summary>
          <p>
            读取
            get_ingestion_schema。检索近24小时，选出10个重点行业板块并按关注优先级排序，每板块最多10条新闻。每条附来源、原文链接、发布时间与事实概要，AI分析单列；不凑数、不编造。先
            get_report_context 读取已有与排除项，再
            begin_ingestion、submit_morning_report、finish_ingestion。完成后报告实际入库数量。
          </p>
        </details>
        <details>
          <summary>查看收盘任务提示词</summary>
          <p>
            获取目标交易日A股收盘行情，包含板块资金流向、涨跌幅，以及涨幅和跌幅各前10名、关注个股。注明来源、截至时间、资金口径和排名覆盖范围；分别说明上涨、下跌、涨停的已知原因，推测单列并附依据。无法核实写待核实，缺失数值用null。通过MCP提交收盘报告并完成发布。
          </p>
        </details>
      </section>
      <section className="settings-panel">
        <div className="settings-heading">
          <FolderOpen size={25} />
          <div>
            <h2>知识库文件夹</h2>
            <p>本地 Markdown 或 Obsidian 库目录，已有文件只读。</p>
          </div>
        </div>
        <div className="inline-form">
          <input
            aria-label="知识库路径"
            placeholder="/Users/你的用户名/Documents/知识库"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
          />
          <button
            disabled={busy || !root}
            onClick={() =>
              act(
                () => api("/knowledge/root", { path: root }),
                "知识库已连接并完成扫描",
              )
            }
          >
            连接文件夹
          </button>
        </div>
      </section>
      <div className="connector-grid">
        {(["lark", "wecom"] as const).map((p) => (
          <ConnectorForm
            key={p}
            platform={p}
            config={data.connectors[p]}
            busy={busy}
            onSave={(c: any) =>
              act(() => api(`/connectors/${p}`, c), "连接器配置已保存")
            }
            onCheck={() =>
              act(async () => {
                const r = await api(`/connectors/${p}/check`, {});
                if (!r.authorized) throw new Error(r.message);
              }, "授权检查通过")
            }
            onSync={() =>
              act(
                () => api("/sync", { platform: p, report_id: report!.id }),
                "已加入同步队列",
              )
            }
            canSync={!!report && !report.demo}
          />
        ))}
      </div>
      <section className="settings-panel">
        <div className="settings-heading">
          <ArrowClockwise size={24} />
          <div>
            <h2>同步记录</h2>
            <p>本地入库与云端同步独立，失败不会丢失本地数据。</p>
          </div>
          <button aria-label="刷新同步记录" onClick={load}>
            <ArrowClockwise />
          </button>
        </div>
        {data.jobs.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>平台</th>
                  <th>状态</th>
                  <th>尝试</th>
                  <th>时间</th>
                  <th>说明</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j: any) => (
                  <tr key={j.id}>
                    <td>{j.platform === "lark" ? "飞书" : "企业微信"}</td>
                    <td>
                      {
                        (
                          {
                            pending: "待同步",
                            running: "同步中",
                            success: "已核验",
                            failed: "失败",
                            skipped: "已跳过旧版本",
                          } as any
                        )[j.status]
                      }
                    </td>
                    <td>{j.attempts}</td>
                    <td>{dayTime(j.created_at)}</td>
                    <td>{j.error || "—"}</td>
                    <td>
                      {j.status === "failed" && (
                        <button
                          onClick={() =>
                            act(
                              () => api("/sync/retry", { id: j.id }),
                              "已重新排队",
                            )
                          }
                        >
                          重试
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">尚无同步记录。配置目标后，新报告会自动排队。</p>
        )}
      </section>
      <section className="settings-panel">
        <div className="settings-heading">
          <Database size={24} />
          <div>
            <h2>本地数据</h2>
            <p>SQLite 保存历史报告。备份不包含原始 Markdown 文件。</p>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              act(() => api("/backup", {}), "一致性备份已保存到本地 .data 目录")
            }
          >
            <Download />
            备份数据库
          </button>
        </div>
      </section>
    </div>
  );
}
function ConnectorForm({
  platform,
  config,
  busy,
  onSave,
  onCheck,
  onSync,
  canSync,
}: any) {
  const [url, setUrl] = useState(config.url),
    [enabled, setEnabled] = useState(config.enabled),
    [sheets, setSheets] = useState<Record<string, string>>(config.sheets || {});
  const names = [
    "每日板块",
    "早盘资讯",
    "收盘板块",
    "个股涨幅榜",
    "个股跌幅榜",
    "关注个股",
  ];
  return (
    <section className="settings-panel">
      <div className="settings-heading">
        <Plugs size={24} />
        <div>
          <h2>{platform === "lark" ? "飞书表格" : "企业微信在线表格"}</h2>
          <p>{platform === "lark" ? "lark-cli" : "wecom-cli"} · 单向同步</p>
        </div>
        <span className={"badge " + (config.auth?.authorized ? "green" : "")}>
          {config.auth?.authorized ? "授权已验证" : "未验证授权"}
        </span>
      </div>
      <label>
        目标表格链接
        <input
          type="url"
          placeholder={
            platform === "lark"
              ? "https://...feishu.cn/sheets/..."
              : "https://doc.weixin.qq.com/sheet/..."
          }
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <details>
        <summary>工作表映射（6张专属空白子表）</summary>
        <p className="muted">
          填写目标子表的内部标识。首次写入建立工作台表头，已有非工作台数据会拒绝覆盖。
        </p>
        {names.map((name) => (
          <label key={name}>
            {name}
            <input
              value={sheets[name] || ""}
              onChange={(e) => setSheets({ ...sheets, [name]: e.target.value })}
            />
          </label>
        ))}
      </details>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        自动同步正式报告（演示数据不上传）
      </label>
      <div className="connector-actions">
        <button
          disabled={busy}
          onClick={() => onSave({ url, enabled, sheets })}
        >
          保存配置
        </button>
        <button disabled={busy} onClick={onCheck}>
          检查授权
        </button>
        <button disabled={busy || !canSync || !config.enabled} onClick={onSync}>
          同步当前报告
        </button>
      </div>
      <small className="muted">
        {platform === "wecom"
          ? "当前实现在线表格 /sheet/；智能表格适配尚未启用。"
          : "首次使用需在本机 CLI 完成授权，并准备专属子表。"}
      </small>
    </section>
  );
}
