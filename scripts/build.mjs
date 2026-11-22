import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
const root=new URL("../",import.meta.url);
const baseline=await readFile(new URL("design-baseline/suishou-preview-v29.html",root),"utf8");
const bridge=await readFile(new URL("src/preview-bridge.js",root),"utf8");
const worker=await readFile(new URL("src/service-worker.js",root),"utf8");
const revision=createHash("sha256").update(baseline).update(bridge).update(worker).digest("hex").slice(0,12);

function applyPreviewPatch(original,revision="integrated"){
 const replaceOne=(from,to,label)=>{
   const first=original.indexOf(from);
   if(first<0||original.indexOf(from,first+from.length)>=0)throw Error("Patch anchor invalid: "+label);
   original=original.slice(0,first)+to+original.slice(first+from.length);
 };
 replaceOne("const inPeriod=r=>S.all||r.date.slice(0,2)===String(S.month).padStart(2,'0');",
 "const inPeriod=r=>S.all||r.ym===String(S.year)+'-'+String(S.month).padStart(2,'0');","year-aware month");
 replaceOne("const money=(n)=>'¥'+Math.abs(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});",
 "const money=(n,c='CNY')=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:c,minimumFractionDigits:['JPY','TWD','KRW'].includes(c)?0:2,maximumFractionDigits:['JPY','TWD','KRW'].includes(c)?0:2}).format(Math.abs(n));","per-currency amount");
 replaceOne("${money(r.value)}","${money(r.value,r.currency)}","record currency");
 replaceOne("function subs(){const yearly=S.subscriptions.reduce((a,x)=>a+x.price*(x.cycle==='每月'?12:1),0);",
 "function subs(){const yearly=S.subscriptions.filter(x=>x.currency===S.currency).reduce((a,x)=>a+x.price*(x.rawCycle==='month'?12:x.rawCycle==='quarter'?4:x.rawCycle==='year'?1:0),0);","subscription annual total");
 replaceOne("${money(x.price)}","${money(x.price,x.currency)}","subscription currency");
 replaceOne("i===0&&S.editedCover","S.card===i&&S.editedCover","selected card cover");
 replaceOne("${money(c.balance)}","${money(c.balance,c.currency)}","card currency");
 replaceOne("htmlSafe(S.cards[S.card].name)","htmlSafe(S.cards[S.card]?.name||'暂无储值卡')","zero-card safe name");
 replaceOne("money(S.cards[S.card].balance)","money(S.cards[S.card]?.balance||0,S.cards[S.card]?.currency||'CNY')","zero-card safe balance");
 replaceOne("render();\n})();\n</script>",
 "S.records=[];S.subscriptions=[];S.cards=[];window.__suishouPreview={state:S,render,go,modal,closeModal,toast};\nrender();\n})();\n</script>","expose preview, clear demo data");
 replaceOne("</body>",
 `<script type="module" src="./src/preview-bridge.js?v=${revision}"></script>\n<script defer src="./auth-client.js?v=${revision}"></script>\n</body>`,
 "load real business bridge");
 return original;
}
const html=applyPreviewPatch(baseline,revision);
await Promise.all([
 writeFile(new URL("index.html",root),html),
 writeFile(new URL("cloud.html",root),html),
 writeFile(new URL("sw.js",root),worker.replace("__LEDGER_REVISION__",revision))
]);
console.log("Built exact v29 visual shell with original ledger APIs ("+revision+")");
