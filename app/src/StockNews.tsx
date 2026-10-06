import { StockPicker, type StockChoice } from "./StockPicker";
import { useEffect, useState } from "react";
import { ArrowSquareOut, Trash, MagnifyingGlass } from "@phosphor-icons/react";
import { api } from "./api";
import type { NewsItem } from "../shared/schema";

type Request = {
  id: string;
  query: string;
  market: string;
  status: string;
  created_at: string;
  error?: string;
  stock?: { name: string; symbol: string; exchange: string };
  items: NewsItem[];
};
const time = (v: string) =>
  new Date(v).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export function StockNews() {
  const [choice, setChoice] = useState<StockChoice | null>(null);
  const [market, setMarket] = useState("CN_A");
  const [rows, setRows] = useState<Request[]>([]);
  const [selected, setSelected] = useState("");
  const [itemId, setItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      api<Request[]>("/stock-news")
        .then((v) => {
          if (active) setRows(v);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const current = rows.find((r) => r.id === selected) || rows[0];
  const item = current?.items.find((n) => n.id === itemId) || current?.items[0];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api<{ request_id: string }>("/stock-news", {
        query: choice.symbol,
        catalog_key: choice.key,
        market,
      });
      setSelected(r.request_id);
      setItemId("");
      setNotice("已打开 WorkBuddy，请发送预填任务，结果会自动留存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        setRows(await api<Request[]>("/stock-news"));
      } catch (e) {
        setError((e as Error).message);
      }
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!current || !item || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/stock-news/delete", {
        request_id: current.id,
        news_id: item.id,
      });
      setRows(await api<Request[]>("/stock-news"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <form className="filter-row stock-search" onSubmit={submit}>
        <StockPicker key={market} market={market} onSelect={setChoice} />
        <select
          aria-label="个股市场"
          value={market}
          onChange={(e) => { setMarket(e.target.value); setChoice(null); }}
        >
          <option value="CN_A">A 股</option>
          <option value="HK">港股</option>
          <option value="US">美股</option>
        </select>
        <button className="primary" disabled={busy || !choice}>
          {busy ? "正在打开…" : "获取个股资讯"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="stock-notice">
          {notice}
        </p>
      )}
      <div className="stock-history">
        <select
          aria-label="个股查询记录"
          value={current?.id || ""}
          onChange={(e) => {
            setSelected(e.target.value);
            setItemId("");
            setNotice("");
          }}
        >
          {!rows.length && <option value="">暂无查询记录</option>}
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.stock ? `${r.stock.name} ${r.stock.symbol}` : r.query} ·{" "}
              {r.market === "CN_A"
                ? "A股"
                : r.market === "HK"
                  ? "港股"
                  : "美股"}{" "}
              · {time(r.created_at)}
            </option>
          ))}
        </select>
        <span className="muted">
          {current?.status === "completed"
            ? `${current.items.length} 条资讯`
            : current?.status === "failed"
              ? "获取失败"
              : "待更新"}
        </span>
      </div>
      {current?.error && (
        <p className="error-banner" role="alert">
          {current.error}
        </p>
      )}
      <div className="news-workspace">
        <section className="news-list" aria-label="个股资讯列表">
          {current?.items.length ? (
            current.items.map((n, i) => (
              <button
                className={`news-row ${item?.id === n.id ? "selected" : ""}`}
                key={n.id}
                onClick={() => setItemId(n.id)}
              >
                <div className="news-row-top">
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <span className="news-row-source">{n.sources[0]?.name}</span>
                  <small>{time(n.published_at!)}</small>
                </div>
                <h3>{n.title}</h3>
                <p>{n.summary}</p>
              </button>
            ))
          ) : (
            <div className="news-row pending-row">
              <h3>
                {current?.status === "completed" ? "本次无新增资讯" : "待更新"}
              </h3>
            </div>
          )}
        </section>
        <section className="news-detail" aria-label="个股资讯详情">
          <div className="detail-top">
            <span className="badge">
              {current?.stock
                ? `${current.stock.name} · ${current.stock.symbol} · ${current.stock.exchange}`
                : current?.query || "个股资讯"}
            </span>
            {item && (
              <button
                aria-label="删除个股资讯"
                onClick={remove}
                disabled={busy}
              >
                <Trash size={17} />
              </button>
            )}
          </div>
          {item ? (
            <>
              <h2>{item.title}</h2>
              <div className="detail-meta">
                {time(item.published_at!)}
                {item.verification === "summary_only" && " · 仅摘要"}
              </div>
              <div className="detail-section">
                <p>{item.summary}</p>
              </div>
              {item.ai_analysis && (
                <div className="analysis-box">
                  <h3>AI 解读</h3>
                  <p>{item.ai_analysis}</p>
                </div>
              )}
              <div className="detail-section">
                <h3>信息来源</h3>
                {item.sources.map((s) => (
                  <div className="source-row" key={s.url}>
                    <strong>{s.name}</strong>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      查看原文 <ArrowSquareOut size={14} />
                    </a>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">
              <h3>
                {current?.status === "completed" ? "本次无新增资讯" : "待更新"}
              </h3>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
