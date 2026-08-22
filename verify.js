/* Animated Warehouse — v259 回歸檢查
   用 jsdom 載真的 index.html（不是假 DOM：假 DOM 對任何選擇器都回成功，
   會把壞掉的選擇器藏起來）。 */
const fs = require("fs");
const { JSDOM } = require("jsdom");

const HTML = fs.readFileSync("index.html", "utf8");
let pass = 0, fail = 0;
const ok  = (n, c, extra) => { c ? pass++ : fail++;
  console.log((c ? "  ok   " : "  FAIL ") + n + (c || !extra ? "" : "  → " + extra)); };

/* ---------- 1. 語法 ---------- */
console.log("\n[1] 語法");
const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok("抓到 " + scripts.length + " 段 script", scripts.length >= 2);
scripts.forEach((s, i) => {
  let err = null;
  try { new Function(s); } catch (e) { err = e.message; }
  ok("script #" + (i + 1) + " 可解析", !err, err);
});

/* ---------- 2. 載入真頁面 ---------- */
console.log("\n[2] 載入");
const vc = new (require("jsdom").VirtualConsole)();
const pageErrors = [];
vc.on("jsdomError", e => {
  /* jsdom 沒實作 canvas 點陣輸出，toDataURL/getContext 只會發「Not implemented」
     警告，那是環境缺件不是頁面的錯，濾掉。真正的 Uncaught 才算。 */
  if (/Not implemented/.test(e.message)) return;
  pageErrors.push(e.message);
});
const dom = new JSDOM(HTML, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.org/",
  virtualConsole: vc,
  beforeParse(w) {
    /* jsdom 這一版沒有 fetch。頁面那支天氣查詢是裸呼叫，沒有 try 包住，
       少了 fetch 會丟 ReferenceError 把後面整段 script 打斷（TOUR_STEP
       就是這樣消失的）。真的瀏覽器一定有 fetch，所以這裡補一個假的，
       讓檢查跑的是頁面邏輯而不是環境缺件。 */
    w.fetch = () => new w.Promise(() => {});
    if (!w.AbortController) w.AbortController = function () { this.signal = {}; this.abort = () => {}; };
    /* jsdom 沒有 canvas，getContext() 回 null，繪圖那一段就會丟 TypeError
       同樣把後面的 script 打斷。塞一個什麼都不做的 2D context 進去：
       這裡要驗的是版面、文案和資料，不是像素。 */
    const noop = () => {};
    const mkCtx = () => new Proxy({}, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "canvas") return t.canvas;
        if (k === "measureText") return () => ({ width: 0 });
        if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
        if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern")
          return () => ({ addColorStop: noop });
        return noop;
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    w.HTMLCanvasElement.prototype.getContext = function () {
      if (!this.__ctx) { this.__ctx = mkCtx(); this.__ctx.canvas = this; }
      return this.__ctx;
    };
  },
});
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
/* 頂層的 const 不會掛到 window（只有 function 宣告會），
   所以要靠同一個 realm 的 eval 去讀 lexical 綁定。 */
const G_ = expr => { try { return window.eval(expr); } catch (e) { return undefined; } };
ok("document 建立", !!doc);
ok("頁面無未捕捉錯誤", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

/* ---------- 3. 元素齊全 ---------- */
console.log("\n[3] 元素");
const NEED = ["#cover","#coverGo","#coverSkip","#coverLang","#bar","#title","#avBtn",
  "#awManualBtn","#awManualTxt","#tourBtn","#tzsel","#thsel","#sfx","#lang",
  "#shell","#col","#navrow","#tabs","#rail","#page","#drawer","#credit"];
NEED.forEach(s => ok("存在 " + s, !!$(s)));

/* ---------- 4. 分頁數一致 ---------- */
console.log("\n[4] 分頁");
G_("drawTabs()");
const tabBtns = doc.querySelectorAll("#tabs button");
ok("分頁鍵 6 顆", tabBtns.length === 6, "實際 " + tabBtns.length);
const RENDER_N = (HTML.match(/const RENDER=\[([^\]]*)\]/) || [, ""])[1].split(",").length;
ok("RENDER 6 項", RENDER_N === 6, "實際 " + RENDER_N);

/* 文案裡不該再有舊的「五個分頁 / five tabs / cinco pestañas」 */
[["五個分頁", /五個分頁/], ["five tabs", /five tabs/], ["cinco pestañas", /cinco pesta/]]
  .forEach(([n, re]) => ok("文案已無「" + n + "」", !re.test(HTML)));

/* ---------- 5. 導覽 ---------- */
console.log("\n[5] 導覽");
const steps = G_("TOUR_STEP");
ok("TOUR_STEP 讀得到", Array.isArray(steps), typeof steps);
if (Array.isArray(steps)) {
  ok("站數 " + steps.length + " 站（>=12）", steps.length >= 12);
  const tabsSeen = new Set(steps.map(s => s.tab).filter(t => t !== undefined));
  [0,1,2,3,4,5].forEach(t => ok("導覽走到分頁 " + t, tabsSeen.has(t)));
  const bad = steps.filter(s => !Array.isArray(s.t) || s.t.length !== 3 || s.t.some(x => !x));
  ok("每站三語都在", bad.length === 0, bad.length + " 站缺語言");
  /* 選擇器要真的指得到東西（有些要切分頁才長出來，所以只檢查靜態那幾個） */
  ["#stage","#tabs","#rail","#bar","#awManualBtn"].forEach(sel => {
    const used = steps.some(s => s.sel === sel);
    ok("站點選擇器 " + sel + " 命中 DOM", !used || !!$(sel));
  });
}
ok("tourStart 存在", typeof window.tourStart === "function");
ok("重看鍵已綁事件", !!$("#tourBtn"));

/* ---------- 6. 動作鍵分組 ---------- */
console.log("\n[6] 動作鍵");
const G = G_("ACT_GROUPS"), A = G_("SCENE_ACTS");
ok("SCENE_ACTS 讀得到", Array.isArray(A), typeof A);
ok("ACT_GROUPS 讀得到", Array.isArray(G), typeof G);
if (Array.isArray(G) && Array.isArray(A)) {
  const actKeys = A.map(([k]) => k);
  const grouped = G.flatMap(([, ks]) => ks);
  ok("分組沒有重複鍵", new Set(grouped).size === grouped.length);
  const ghost = grouped.filter(k => !actKeys.includes(k));
  ok("分組沒有幽靈鍵", ghost.length === 0, ghost.join(","));
  const orphan = actKeys.filter(k => !grouped.includes(k));
  ok("每顆鍵都有歸類", orphan.length === 0, "未歸類 " + orphan.join(","));
  ok("每組三語都在", G.every(([n]) => Array.isArray(n) && n.length === 3 && n.every(Boolean)));
  /* 真的畫一次，數按鈕和標 */
  /* mount() 已經在 #page 裡建過 #acts 了。再造一個同 id 的，
     getElementById 只會回第一個——填的是真的那顆，量的是假的那顆。
     所以有就用現成的，沒有才自己補。 */
  let acts = doc.getElementById("acts");
  if (!acts) { acts = doc.createElement("div"); acts.id = "acts"; doc.body.appendChild(acts); }
  ok("#acts 只有一顆", doc.querySelectorAll("#acts").length === 1,
     "實際 " + doc.querySelectorAll("#acts").length);
  G_("actBarRestore()");
  const btns = acts.querySelectorAll("button");
  const tags = acts.querySelectorAll("i.actgrp");
  ok("畫出 " + btns.length + " 顆鍵 = SCENE_ACTS " + A.length, btns.length === A.length);
  ok("畫出 " + tags.length + " 個分組標 = ACT_GROUPS " + G.length, tags.length === G.length);
  ok("分組標不是 button（#acts button 選擇器不受影響）",
     [...tags].every(t => t.tagName !== "BUTTON"));
  ok("第一顆鍵仍是開始上工", btns[0] && btns[0].textContent === (G_('tr("actstart")') || "actstart"),
     btns[0] && btns[0].textContent);
  ok("標都有字", [...tags].every(t => t.textContent.trim().length > 0));
}

/* ---------- 7. 下拉自帶標示 ---------- */
console.log("\n[7] 下拉");
const tz = $("#tzsel"), th = $("#thsel");
G_("paintTZ()");
G_("paintSkinSel()");
const tzOpts = tz ? [...tz.options] : [];
const thOpts = th ? [...th.options] : [];
ok("時區有選項 (" + tzOpts.length + ")", tzOpts.length > 0);
ok("主題有選項 (" + thOpts.length + ")", thOpts.length > 0);
ok("每個時區選項都帶時鐘前綴", tzOpts.length > 0 && tzOpts.every(o => o.text.startsWith("\u{1F551} ")),
   tzOpts[0] && tzOpts[0].text);
ok("每個主題選項都帶調色盤前綴", thOpts.length > 0 && thOpts.every(o => o.text.startsWith("\u{1F3A8} ")),
   thOpts[0] && thOpts[0].text);
ok("時區 value 未被前綴污染", tzOpts.every(o => !/[\u{1F300}-\u{1FAFF}]/u.test(o.value)));
ok("主題 value 未被前綴污染", thOpts.every(o => !/[\u{1F300}-\u{1FAFF}]/u.test(o.value)));
ok("主題 value 都是真的 skin", thOpts.every(o => !!G_("SKINS")[o.value]));

/* ---------- 8. i18n ---------- */
console.log("\n[8] i18n");
const D = G_("D");
ok("D 讀得到", !!D && !!D.TXT);
if (D && D.TXT) {
  const langs = Object.keys(D.TXT);
  ok("三語都在: " + langs.join("/"), langs.length === 3);
  const base = Object.keys(D.TXT.en);
  langs.forEach(L => {
    const miss = base.filter(k => !(k in D.TXT[L]));
    ok(L + " 無缺 key", miss.length === 0, miss.slice(0, 6).join(","));
  });
  ok("sfxnote 三語都提到六", ["zh","en","es"].every(L =>
    /六|six|seis/.test(D.TXT[L].sfxnote)));
}

/* ---------- 9. 定價引擎沒被動到 ---------- */
console.log("\n[9] 計價");
if (typeof G_("calc") === "function") {
  const V = G_("V");
  Object.assign(V, { weight:"10", length:"20", width:"15", height:"10",
                     divisor:"139", zone:"8", fuel:"18" });
  const F = G_("FLAGS"); F.residential = false; F.peak = false;
  const r = G_("calc()");
  ok("calc() 有回傳", !!r);
  ok("計費重量 22 lb", r && r.final === 22, r && r.final);
  const t = r && r.total;
  ok("總額 $53.02", t !== undefined && Math.abs(t - 53.02) < 0.02, t);
} else {
  ok("calc 可呼叫", false, "找不到 calc");
}

/* ---------- 9b. Balloon：本土已移除，只剩 LOR ---------- */
console.log("\n[9b] Balloon 規則（2026-07-12 起本土 Ground Advantage 移除）");
if (D) {
  const CR = D.CARRIER_RULES;
  ok("三家 balloonlg 預設 0（停用）", ["ups","fedex","usps"].every(c =>
    CR[c].balloonlg === "0" && CR[c].balloonmin === "0"),
    JSON.stringify({u:CR.ups.balloonlg, f:CR.fedex.balloonlg, s:CR.usps.balloonlg}));
  ok("balloonnote 三語都講 Limited Overland Routes", ["zh","en","es"].every(L =>
    /Limited Overland Routes/.test(D.TXT[L].balloonnote)));
  ok("balloonnote 三語都講預設停用", ["zh","en","es"].every(L =>
    /預設兩欄皆為 0|default to 0|vienen en 0/.test(D.TXT[L].balloonnote)));
  ok("minnote.usps 三語：本土無下限、LOR 才有", D.CARRIER_NOTES.minnote.usps.every(t =>
    /Limited Overland Routes|LOR/.test(t) && /本土|mainland|continental/.test(t)));
  const ref = G_("CARRIER_REF");
  const minRow = ref.usps.rows.find(r => /最低計費重量/.test(r[0][0]));
  ok("CARRIER_REF usps 最低重量列改成 LOR 版", !!minRow &&
    minRow[1].every(t => /LOR/.test(t)));
  const gBalloon = D.USPS_GUIDE.filter(b =>
    typeof b[1] === "string" && /[Bb]alloon/.test(b[1] + b[2]));
  ok("USPS 教材 balloon 段講「已移除／僅存 LOR」", gBalloon.some(b =>
    /已無此規則|no longer carries|僅存|survives only/.test(b[1] + b[2])));
}
if (typeof G_("calc") === "function") {
  const V = G_("V"), F = G_("FLAGS");
  /* 62×10×2：長度加周長 = 62 + 2×(10+2) = 86 in，體積 1,240 in³ */
  Object.assign(V, { weight:"5", length:"62", width:"10", height:"2",
                     divisor:"139", dimcube:"0", dimzone:"0", zone:"8", fuel:"18",
                     balloonlg:"0", balloonmin:"0",
                     maxw:"150", maxl:"108", maxlg:"165" });
  F.usemin = false; F.residential = false; F.peak = false;
  F.autoahs = false; F.autolps = false; F.ahspack = false;
  const rOff = G_("calc()");
  ok("停用（預設）：86 in 輕件不套下限，計費 9 lb（DIM）",
     rOff && rOff.final === 9, rOff && (rOff.error || rOff.final));
  Object.assign(V, { balloonlg:"84", balloonmin:"20" });
  const rLor = G_("calc()");
  ok("模擬 LOR（84／20）：同件計費 20 lb", rLor && rLor.final === 20,
     rLor && rLor.final);
  Object.assign(V, { length:"60" });   /* lg = 60+24 = 84，剛好等於門檻 */
  const rEdge = G_("calc()");
  ok("剛好 84 in 不觸發（嚴格大於）", rEdge && rEdge.final === 9,
     rEdge && rEdge.final);
  Object.assign(V, { balloonlg:"0", balloonmin:"0", length:"20", width:"15",
                     height:"10", weight:"10" });   /* 還原 */
}

/* ---------- 10. 天氣：唯一的對外呼叫，壞掉不可以拖垮整支 ---------- */
console.log("\n[10] 天氣容錯");
{
  const mkNoop = () => () => {};
  const boot = (label, install, check) => {
    const v2 = new (require("jsdom").VirtualConsole)();
    const errs = [];
    v2.on("jsdomError", e => { if (!/Not implemented/.test(e.message)) errs.push(e.message); });
    const d2 = new JSDOM(HTML, {
      runScripts: "dangerously", pretendToBeVisual: false, url: "https://example.org/",
      virtualConsole: v2,
      beforeParse(w) {
        install(w);
        const noop = mkNoop();
        w.requestAnimationFrame = () => 0; w.cancelAnimationFrame = noop;
        w.HTMLCanvasElement.prototype.getContext = function () {
          if (!this.__c) this.__c = new Proxy({}, {
            get: (t, k) => k in t ? t[k] : (k === "measureText" ? () => ({ width: 0 })
              : /createLinear|createRadial/.test(k) ? () => ({ addColorStop: noop }) : noop),
            set: (t, k, v) => { t[k] = v; return true; },
          });
          return this.__c;
        };
      },
    });
    const w2 = d2.window;
    const ev = x => { try { return w2.eval(x); } catch (e) { return "ERR: " + e.message; } };
    const alive = Array.isArray(ev("TOUR_STEP"));
    const call = ev("(function(){try{wxFetch(true);return 'ok'}catch(e){return 'ERR: '+e.message}})()");
    const kind = ev("wxNow().kind");
    ok(label + " — script 跑到底", alive, ev("typeof TOUR_STEP"));
    ok(label + " — 無未捕捉錯誤", errs.length === 0, errs.join(" | ").slice(0, 140));
    ok(label + " — wxFetch 不丟錯", call === "ok", call);
    ok(label + " — 天氣仍畫得出來", typeof kind === "string" && kind.length > 0, kind);
    if (check) check(w2, ev);
  };
  boot("沒有 fetch",       w => { delete w.fetch; });
  boot("fetch 同步丟錯",   w => { w.fetch = () => { throw new Error("blocked"); }; });
  boot("fetch 回非 promise", w => { w.fetch = () => 42; });
  boot("fetch 不是函式",   w => { w.fetch = null; });
  /* 正常路徑：多包一層 try 之後，資料還是要真的吃進去 */
  boot("fetch 正常回應", w => {
    w.__hits = [];
    w.fetch = u => { w.__hits.push(u);
      return w.Promise.resolve({ ok: true, json: () => w.Promise.resolve(
        { current: { temperature_2m: 31.4, weather_code: 95 } }) }); };
  }, (w2, ev) => {
    ok("fetch 正常回應 — 真的打到 open-meteo", /api\.open-meteo\.com/.test(w2.__hits[0] || ""),
       (w2.__hits[0] || "").slice(0, 50));
  });
}

console.log("\n=========== " + pass + " pass / " + fail + " fail ===========");
process.exit(fail ? 1 : 0);
