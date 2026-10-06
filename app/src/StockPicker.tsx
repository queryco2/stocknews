import { useEffect, useState } from "react";
import { MagnifyingGlass, ArrowClockwise } from "@phosphor-icons/react";
import { api } from "./api";
export type StockChoice = { key: string; name: string; symbol: string; market: string; exchange: string; source_url: string; updated_at: string };
type Status = {count: number; updated_at: string | null; refreshing: boolean; error: string | null; source: {name:string;url:string}};
export function StockPicker({market, onSelect}: {market: string; onSelect:(s:StockChoice|null)=>void}) {
  const [value,setValue]=useState("");
  const [matches,setMatches]=useState<StockChoice[]>([]);
  const [chosen,setChosen]=useState<StockChoice|null>(null);
  const [status,setStatus]=useState<Status|null>(null);
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(-1);
  const [error,setError]=useState("");
  const [refreshing,setRefreshing]=useState(false);
  const [loading,setLoading]=useState(false);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let live=true;
    const timer=setTimeout(()=>{
      setLoading(true);
      api<{items:StockChoice[];status:Status}>(`/stocks/search?market=${market}&q=${encodeURIComponent(chosen ? chosen.symbol : value)}`)
        .then(r=>{if(live){setMatches(r.items);setStatus(r.status);setError("");setActive(-1);}})
        .catch(e=>{if(live)setError(e.message);})
        .finally(()=>{if(live)setLoading(false);});
    },150);
    return()=>{live=false;clearTimeout(timer);};
  },[value,market,chosen,revision]);
  useEffect(()=>{
    if(!status?.refreshing)return;
    const timer=setTimeout(()=>setRevision(r=>r+1),2000);
    return()=>clearTimeout(timer);
  },[status]);
  const select=(s:StockChoice)=>{setChosen(s);setValue(`${s.name} · ${s.symbol}`);setOpen(false);onSelect(s);};
  return <div className="stock-picker">
    <label className="search"><MagnifyingGlass size={18}/><input
      role="combobox" aria-label="股票名称或代码" aria-expanded={open} aria-controls="stock-matches" aria-autocomplete="list" aria-activedescendant={open&&active>=0?`stock-match-${active}`:undefined}
      placeholder="名称、代码或拼音首字母" value={value} maxLength={100}
      onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}
      onChange={e=>{setValue(e.target.value);setChosen(null);onSelect(null);setMatches([]);setActive(-1);setOpen(true);}}
      onKeyDown={e=>{
        if(e.key==="ArrowDown"){e.preventDefault();setOpen(true);setActive(i=>Math.min(i+1,matches.length-1));}
        if(e.key==="ArrowUp"){e.preventDefault();setActive(i=>Math.max(i-1,0));}
        if(e.key==="Escape")setOpen(false);
        if(e.key==="Enter"&&open&&!chosen){e.preventDefault();if(active>=0&&matches[active])select(matches[active]);}
      }}/></label>
    {open&&value.trim()&&!chosen&&<div className="stock-suggestions" id="stock-matches" role="listbox" aria-label="匹配股票">
      {matches.map((s,i)=><button type="button" role="option" aria-selected={i===active} id={`stock-match-${i}`} key={s.key} onMouseDown={e=>e.preventDefault()} onClick={()=>select(s)}>
        <strong>{s.name}</strong><span>{s.symbol} · {s.exchange}</span>
      </button>)}
      {!matches.length&&<p>{loading?"正在搜索…":status?.refreshing?"股票库更新中…":"未找到匹配股票，可更新股票库后重试"}</p>}
    </div>}
    <div className="stock-catalog-status">
      {status&&<span><a href={status.source.url} target="_blank" rel="noopener noreferrer">{status.source.name}</a> · {status.count} 只{status.updated_at?` · ${new Date(status.updated_at).toLocaleDateString("zh-CN")}`:" · 待更新"}</span>}
      <button type="button" disabled={refreshing||status?.refreshing} onClick={async()=>{
        setRefreshing(true);setError("");try{const r=await api<Status>("/stocks/refresh",{market});setStatus(r);setRevision(v=>v+1);if(r.error)setError(r.error);}catch(e){setError((e as Error).message);}finally{setRefreshing(false);}
      }}><ArrowClockwise size={13}/>{refreshing||status?.refreshing?"更新中…":"更新股票库"}</button>
    </div>
    {(error||status?.error)&&<p className="stock-picker-error" role="alert">{error||`更新失败：${status?.error}。保留上次股票库。`}</p>}
  </div>;
}
