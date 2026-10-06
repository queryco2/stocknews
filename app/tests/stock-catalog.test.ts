import {test,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os"; import path from "node:path";
const dir=mkdtempSync(path.join(os.tmpdir(),"catalog-test-"));process.env.STOCKNEWS_DATA_DIR=dir;
const c=await import("../server/stock-catalog.ts");const s=await import("../server/stock-news.ts");const {db}=await import("../server/store.ts");
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
test("catalog isolates markets, retains zeroes, supports aliases and preserves old names",()=>{
 const rows=c.parseCN({stockList:[{code:"000001",zwjc:"平安银行",category:"A股",pinyin:"payh"},{code:"600519",zwjc:"贵州茅台",category:"A股",pinyin:"gzmt"},{code:"200001",zwjc:"B股",category:"B股"}]});
 c.publishCatalog("CN_A",rows);assert.equal(c.searchStocks("payh","CN_A")[0].symbol,"000001");assert.equal(c.searchStocks("茅台","CN_A")[0].symbol,"600519");assert.equal(c.searchStocks("茅台","US").length,0);
 c.publishCatalog("CN_A",[{...rows[0],name:"新名称"}]);assert.equal(c.searchStocks("平安银行","CN_A")[0].name,"新名称");assert.equal(c.searchStocks("茅台","CN_A").length,0);
 c.publishCatalog("HK",[{key:"HK:HKEX:00700",market:"HK",exchange:"HKEX",symbol:"00700",name:"騰訊控股",aliases:[],source_url:c.sources.HK.url}]);
 assert.equal(c.searchStocks("腾讯","HK")[0].symbol,"00700");assert.equal(c.searchStocks("700","HK")[0].symbol,"00700");
 assert.throws(()=>c.publishCatalog("CN_A",[]));assert.equal(c.searchStocks("payh","CN_A").length,1);
});
test("selected stock identity cannot change on MCP callback",()=>{
 const req=s.createStockRequest("000001","CN_A","CN_A:SZSE:000001");
 assert.equal(s.stockRequest(req.request_id).expected_stock.symbol,"000001");
 assert.throws(()=>s.submitStockNews(req.request_id,"wrong",{name:"茅台",symbol:"600519",exchange:"SSE",market:"CN_A"},[]),/选定/);
 assert.equal(s.submitStockNews(req.request_id,"ok",{name:"新名称",symbol:"000001",exchange:"SZSE",market:"CN_A"},[]).count,0);
});
test("US parser filters tests, ETFs, and non-equity issues without excluding United names",()=>{
 const header="Nasdaq Traded|Symbol|Security Name|Listing Exchange|ETF|Test Issue";
 const rows=c.parseUS([header,"Y|UNH|UnitedHealth Group Common Stock|N|N|N","Y|ETF|Fund ETF|Q|Y|N","Y|TST|Test Common Stock|Q|N|Y","Y|W|Company Warrants|Q|N|N","File Creation Time: test"].join("\n"));
 assert.deepEqual(rows.map(r=>r.symbol),["UNH"]);assert.throws(()=>c.parseUS(header),/不完整/);
});
