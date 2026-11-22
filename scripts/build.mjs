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
 // Load the saved mobile material before any panels or optics can paint.
 replaceOne("function apply(){\n   root.dataset.layout=resolve();root.dataset.layoutChoice=choice;", `const mobileGlassKey='suishou-preview.mobile-glass.v1';
 const defaults={strength:1,opacity:73,rim:72,'blur-slider':0,settle:.68};
 const limits={strength:[0,2.5],opacity:[20,100],rim:[0,100],'blur-slider':[0,46],settle:[.1,1]};
 let mobileGlass={...defaults};
 try{
   const saved=JSON.parse(localStorage.getItem(mobileGlassKey));
   for(const [id,[min,max]] of Object.entries(limits)){
     const value=saved?.[id];
     if(Number.isFinite(value)&&value>=min&&value<=max)mobileGlass[id]=value;
   }
 }catch(_){}
 function defaultGlass(layout){return layout==='mobile'?defaults:{...defaults,'blur-slider':23}}
 function glassFor(layout){return layout==='mobile'?mobileGlass:defaultGlass(layout)}
 function apply(){
   const layout=resolve();
   if(root.dataset.layout!==layout){
     const glass=glassFor(layout);
     root.style.setProperty('--glass-alpha',glass.opacity/100);
     root.style.setProperty('--rim-brightness',glass.rim/100);
     root.style.setProperty('--blur',glass['blur-slider']+'px');
   }
   root.dataset.layout=layout;root.dataset.layoutChoice=choice;`, "restore saved mobile glass before paint");
 replaceOne(" },apply};", ` },apply,
 get glassValues(){return glassFor(root.dataset.layout)},
 get glassDefaults(){return defaultGlass(root.dataset.layout)},
 saveMobileGlass(values){
   localStorage.setItem(mobileGlassKey,JSON.stringify(values));
   mobileGlass=values;
 }
 };`, "save only confirmed mobile glass settings");
 replaceOne("for(const [id,key,format] of controls){by(id).addEventListener('input',e=>{const v=Number(e.target.value);S[key]=(id==='opacity'||id==='rim')?v/100:v;by(id.replace('-slider','')+'-out').textContent=format(v);document.documentElement.style.setProperty('--glass-alpha',S.opacity);document.documentElement.style.setProperty('--rim-brightness',S.rim);document.documentElement.style.setProperty('--blur',S.blur+'px');optics?.settingsChanged();})}", `let optics=null;
function previewGlass(){
 for(const [id,key,format] of controls){
   const value=by(id).valueAsNumber;
   S[key]=(id==='opacity'||id==='rim')?value/100:value;
   by(id.replace('-slider','')+'-out').textContent=format(value);
 }
 const style=document.documentElement.style;
 style.setProperty('--glass-alpha',S.opacity);
 style.setProperty('--rim-brightness',S.rim);
 style.setProperty('--blur',S.blur+'px');
 optics?.settingsChanged();
}
function setGlassControls(values){
 for(const [id] of controls)by(id).value=String(values[id]);
 previewGlass();
}
for(const [id] of controls)by(id).addEventListener('input',previewGlass);
setGlassControls(window.__suishouLayout.glassValues);`, "initialize and preview all five glass controls");
 replaceOne("by('tuner-reset').onclick=()=>{const vals={strength:1,opacity:73,rim:72,'blur-slider':23,settle:.68};for(const [id,val] of Object.entries(vals)){by(id).value=val;by(id).dispatchEvent(new Event('input'))}toast('已恢复玻璃默认参数')};", `function resetGlassControls(){
 setGlassControls(window.__suishouLayout.glassDefaults);
 toast('已恢复玻璃默认参数');
}
by('tuner-reset').onclick=resetGlassControls;`, "preview defaults without saving");
 replaceOne("let optics=null;try{optics=createOptics()}", "try{optics=createOptics()}", "initialize optics after saved glass controls");
 replaceOne("function createOptics(){", `const useBlurTexture=()=>document.documentElement.dataset.layout!=='mobile'||S.blur>0;
function createOptics(){`, "select sharp or blurred optics");
 replaceOne("blurred(fx,scene,1/pw,0);blurred(fy,tx,0,1/ph);dirty=false", "if(useBlurTexture()){blurred(fx,scene,1/pw,0);blurred(fy,tx,0,1/ph)}dirty=false", "skip unused mobile Gaussian passes");
 replaceOne("gl.bindTexture(gl.TEXTURE_2D,ty);gl.uniform1i(gu.blur,1);", "gl.bindTexture(gl.TEXTURE_2D,useBlurTexture()?ty:scene);gl.uniform1i(gu.blur,1);", "keep the mobile navigation image sharp");
 replaceOne("// Desktop-only optical cursor light.", `let glassLayout=document.documentElement.dataset.layout;
window.addEventListener('suishou-layout-change',()=>{
 const root=document.documentElement;
 if(glassLayout===root.dataset.layout)return;
 glassLayout=root.dataset.layout;
 setGlassControls(window.__suishouLayout.glassValues);
});

// Desktop-only optical cursor light.`,"match the control and renderer to layout changes");
 replaceOne('<button type="button" class="glass drawer-glass-reset" data-drawer-glass-reset>恢复默认</button></div>', '<button type="button" class="glass drawer-glass-reset" data-drawer-glass-reset>恢复默认</button><button type="button" class="glass" data-drawer-glass-save>保存配置</button><p class="subtext" role="status" data-drawer-glass-status hidden></p></div>', "add a save action to the mobile glass editor");
 replaceOne("   if(!e.target.closest('[data-drawer-glass-reset]'))return;\n   by('tuner-reset')?.click();\n   syncDrawerGlass();", `   if(e.target.closest('[data-drawer-glass-reset]')){
     resetGlassControls();
     syncDrawerGlass();
     return;
   }
   if(!e.target.closest('[data-drawer-glass-save]'))return;
   const settings=sheet.querySelector('.drawer-glass-settings');
   const values=Object.fromEntries(controls.map(([id])=>[id,by(id).valueAsNumber]));
   try{window.__suishouLayout.saveMobileGlass(values)}catch(_){
     glassStatus(settings,'保存失败，请检查浏览器是否允许保存配置后重试。');
     return;
   }
   settings.open=false;
   closeMenuDrawer();
   toast('已保存玻璃配置');`, "persist mobile glass only on save");
 replaceOne("function closeMenuDrawer(){\n const layer=by('menu-drawer-layer');if(!layer)return;", `function glassStatus(settings,message){
 const status=settings.querySelector('[data-drawer-glass-status]');
 status.hidden=false;
 status.textContent=message;
}
function activeGlassEditor(){return by('menu-drawer-layer')?.querySelector('.drawer-glass-settings[open]')}
document.addEventListener('click',event=>{
 const settings=activeGlassEditor();
 if(!settings||(settings.contains(event.target)&&!event.target.closest('summary')))return;
 event.preventDefault();
 event.stopImmediatePropagation();
 glassStatus(settings,'请先保存玻璃配置。');
},true);
function closeMenuDrawer(){
 const layer=by('menu-drawer-layer');if(!layer||activeGlassEditor())return;`, "keep the editor open through swipe and dismissal gestures");
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
