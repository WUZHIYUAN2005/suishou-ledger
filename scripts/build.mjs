import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
const root=new URL("../",import.meta.url);
const baseline=await readFile(new URL("design-baseline/suishou-preview-v29.html",root),"utf8");
const readSource=async file=>(await readFile(new URL(file,root),"utf8")).replace(/\r\n/g,"\n");
const worker=await readSource("src/service-worker.js");
const businessFiles=["scripts/build.mjs","src/preview-bridge.js","src/actions.js","src/ledger.js","src/covers.js","src/drive.js","auth-client.js"];
const businessSources=await Promise.all(businessFiles.map(readSource));
const hash=createHash("sha256").update(baseline).update(worker);
for(const source of businessSources)hash.update(source);
const revision=hash.digest("hex").slice(0,12);

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
 original=original.replaceAll("${money(r.value)}","${money(r.value,r.currency)}");
 replaceOne('data-action="detail:${r.id}"','data-action="detail:${htmlSafe(r.id)}"',"legacy record identifiers");
 for(const total of ["income","expense","total","g[1]","yearly","yearly/12"]){
   original=original.replaceAll("money("+total+")","money("+total+",S.currency)");
 }
 replaceOne("function subs(){const yearly=S.subscriptions.reduce((a,x)=>a+x.price*(x.cycle==='每月'?12:1),0);",
 "function subs(){const yearly=S.subscriptions.filter(x=>x.active&&x.currency===S.currency).reduce((a,x)=>a+x.price*(x.rawCycle==='month'?12:x.rawCycle==='quarter'?4:x.rawCycle==='year'?1:0),0);","subscription annual total");
 replaceOne("${money(x.price)}","${money(x.price,x.currency)}","subscription currency");
 replaceOne("i===0&&S.editedCover","S.card===i&&S.editedCover","selected card cover");
 replaceOne("${money(c.balance)}","${money(c.balance,c.currency)}","card currency");
 replaceOne("htmlSafe(S.cards[S.card].name)","htmlSafe(S.cards[S.card]?.name||'暂无储值卡')","zero-card safe name");
 replaceOne("money(S.cards[S.card].balance)} · CNY","money(S.cards[S.card]?.balance||0,S.cards[S.card]?.currency||'CNY')} · ${S.cards[S.card]?.currency||'CNY'}","zero-card safe balance and currency");
 replaceOne('aria-label="云同步模拟"','aria-label="打开云端备份"',"real cloud sync label");
 replaceOne("render();\n})();\n</script>",
 "S.records=[];S.subscriptions=[];S.cards=[];window.__suishouPreview={state:S,render,go,modal,closeModal,toast};\nrender();\n})();\n</script>","expose preview, clear demo data");
 replaceOne("</head>",
 '<link rel="manifest" href="./manifest.webmanifest">\n<link rel="icon" type="image/png" sizes="192x192" href="./icon-192.png">\n<link rel="apple-touch-icon" href="./icon-180.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="随手账本">\n</head>',
 "preserve invisible PWA metadata");
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
