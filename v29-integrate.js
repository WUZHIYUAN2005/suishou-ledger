/* v29 production presentation; no writes to ledger data or sync settings. */
(() => {
 "use strict";
 if (window.__suishouV29Installed) return;
 window.__suishouV29Installed = true;
 const root=document.documentElement;
 const KEY="suishou-ledger.v29.";
 const VIEWS=[["overview","总览"],["bills","账单"],["stats","分类统计"],["members","订阅"],["cards","卡包"]];
 const THEMES=[["original","经典渐变"],["garden","兔子花园"],["cosmos","星际漫游"],["tech","科技生活"]];
 const PARAMS=[
  {key:"ior",label:"折射率",min:1.30,max:1.70,step:.01,value:1.49},
  {key:"alpha",label:"玻璃透明度",min:.18,max:.86,step:.01,value:.62},
  {key:"rim",label:"边缘高光",min:.08,max:.80,step:.01,value:.33},
  {key:"blur",label:"背景模糊",min:8,max:38,step:1,value:23},
  {key:"spring",label:"水滴弹性",min:0,max:100,step:1,value:58}
 ];
 const allowed=(list,v,fallback)=>list.includes(v)?v:fallback;
 const get=(key,fallback)=>{try{return localStorage.getItem(KEY+key)??fallback}catch(_){return fallback}};
 const put=(key,v)=>{try{localStorage.setItem(KEY+key,String(v))}catch(_){}};
 const settings={};
 for(const p of PARAMS){const n=Number(get("param."+p.key,p.value));settings[p.key]=Number.isFinite(n)?Math.min(p.max,Math.max(p.min,n)):p.value}
 let choice=allowed(["auto","desktop","mobile"],get("layout","auto"),"auto");
 let wallpaper=allowed(THEMES.map(t=>t[0]),get("wallpaper","garden"),"garden");
 let strength=Math.min(1,Math.max(.15,Number(get("strength",".88"))||.88));
 let menuOpen=false,previousFocus=null, swipeStart=null;
 let summary=window.__suishouV29Summary||null;
 const htmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const modeControls=()=>'<div class="v29-mode-row" role="group" aria-label="显示方式">'+[["auto","自动"],["desktop","电脑"],["mobile","手机"]].map(([v,t])=>'<button type="button" data-v29-layout="'+v+'" aria-pressed="false">'+t+'</button>').join("")+'</div>';
 const links=()=>VIEWS.map(([id,label])=>'<button type="button" class="v29-link" data-v29-view="'+id+'"><span>'+label+'</span><span aria-hidden="true">›</span></button>').join("");
 const extraLinks=()=>[
  ["new","记一笔"],["cloud","云端备份"],["manage","数据管理与备份"],["recover","安全恢复订阅与卡包"],["gallery","背景图库"]
 ].map(([id,label])=>'<button class="v29-link" type="button" data-v29-action="'+id+'"><span>'+label+'</span><span aria-hidden="true">›</span></button>').join("");
 const settingsFields=()=>'<div class="v29-settings-fields">'+PARAMS.map(p=>
 '<label class="v29-setting"><span><b>'+p.label+'</b><output data-v29-output="'+p.key+'"></output></span><input type="range" data-v29-param="'+p.key+'" min="'+p.min+'" max="'+p.max+'" step="'+p.step+'" value="'+settings[p.key]+'"></label>').join("")+
 '<button type="button" class="v29-text-button" data-v29-action="reset">恢复默认参数</button></div>';
 function build(){
  const shell=document.querySelector(".app-shell");
  if(!shell||document.getElementById("v29-drawer-backdrop"))return false;
  const left=document.createElement("aside");
  left.className="v29-side-left";left.setAttribute("aria-label","电脑端账本菜单");
  left.innerHTML='<div class="v29-brand"><span class="v29-brand-icon" aria-hidden="true">▣</span>随手账本</div>'+
    '<div class="v29-side-title">账本</div><nav class="v29-links" aria-label="电脑端页面">'+links()+'</nav>'+
    '<div class="v29-side-title">操作</div><div class="v29-links">'+extraLinks()+'</div>'+
    '<div class="v29-side-title">显示方式</div>'+modeControls()+
    '<details class="v29-drawer-settings" style="margin-top:13px"><summary>玻璃参数 <span aria-hidden="true">⌄</span></summary>'+settingsFields()+'</details>';
  const right=document.createElement("aside");
  right.className="v29-side-right";right.setAttribute("aria-label","财务摘要");
  right.innerHTML='<div class="v29-summary-card"><h3>本月财务摘要</h3>'+
   '<div class="v29-metric"><small>收入</small><strong data-v29-metric="income">—</strong></div>'+
   '<div class="v29-metric expense"><small>支出</small><strong data-v29-metric="expense">—</strong></div>'+
   '<div class="v29-summary-row"><span>账单数量</span><strong data-v29-metric="count">—</strong></div>'+
   '<div class="v29-summary-row"><span>0 元记录</span><strong data-v29-metric="zero">—</strong></div>'+
   '</div><div class="v29-summary-card"><h3>快捷查看</h3>'+
   '<div class="v29-summary-row"><span>订阅项目</span><strong data-v29-metric="members">—</strong></div>'+
   '<div class="v29-summary-row"><span>卡包卡片</span><strong data-v29-metric="cards">—</strong></div>'+
   '<div class="v29-summary-row"><span>当前页面</span><strong data-v29-metric="page">总览</strong></div>'+
   '<button class="v29-text-button" style="width:100%;margin-top:12px" data-v29-view="stats">查看分类统计</button></div>';
  shell.append(left,right);
  const backdrop=document.createElement("div");
  backdrop.id="v29-drawer-backdrop";backdrop.className="v29-backdrop";backdrop.setAttribute("aria-hidden","true");
  backdrop.innerHTML='<aside class="v29-drawer" role="dialog" aria-modal="true" aria-labelledby="v29-drawer-title" tabindex="-1">'+
   '<header class="v29-drawer-head"><h2 id="v29-drawer-title">随手账本</h2><button type="button" class="v29-close" aria-label="关闭菜单" data-v29-action="close">×</button></header>'+
   '<div class="v29-drawer-groups"><nav class="v29-links" aria-label="页面">'+links()+'</nav><nav class="v29-links" aria-label="管理">'+extraLinks()+'</nav>'+
   '<details class="v29-drawer-settings"><summary>玻璃参数 <span aria-hidden="true">⌄</span></summary>'+settingsFields()+'</details></div>'+
   '<footer class="v29-drawer-footer"><div class="v29-side-title" style="margin:0 0 2px">显示方式</div>'+modeControls()+'</footer></aside>';
  document.body.append(backdrop);
  const gallery=document.createElement("dialog");
  gallery.className="v29-wallpaper-dialog";gallery.id="v29-wallpaper-dialog";
  const thumbs=THEMES.map(([k,label])=>{
   if(k==="original")return '<button type="button" class="v29-choice" data-v29-wallpaper="original"><span class="v29-choice-images"><span style="background:linear-gradient(135deg,#382948,#176077)"></span><span style="background:linear-gradient(135deg,#f1d5e7,#c7e6f9)"></span></span><span class="v29-choice-title">'+label+'</span></button>';
   return '<button type="button" class="v29-choice" data-v29-wallpaper="'+k+'"><span class="v29-choice-images"><img alt="" loading="lazy" src="./assets/wallpapers/'+k+'-dark-mobile.webp"><img alt="" loading="lazy" src="./assets/wallpapers/'+k+'-light-mobile.webp"></span><span class="v29-choice-title">'+label+'</span></button>';
  }).join("");
  gallery.innerHTML='<div class="v29-dialog-title"><h2>背景图库</h2><button type="button" class="v29-close" data-v29-action="close-gallery" aria-label="关闭">×</button></div>'+
   '<div class="v29-gallery-grid">'+thumbs+'</div>'+
   '<div class="v29-strength"><label for="v29-strength">背景图案强度</label><input id="v29-strength" type="range" min=".15" max="1" step=".05" value="'+strength+'"><output id="v29-strength-value"></output></div>';
  document.body.append(gallery);
  const repair=document.createElement("dialog");repair.id="v29-restore-dialog";repair.className="v29-wallpaper-dialog";
  repair.style.cssText="width:min(94vw,780px);height:min(92dvh,850px);padding:12px;display:none;flex-direction:column";
  repair.innerHTML='<div class="v29-dialog-title"><h2>安全恢复订阅与卡包</h2><button class="v29-close" type="button" data-v29-action="close-restore">×</button></div><iframe title="随手账本安全恢复" src="about:blank" style="width:100%;min-height:0;flex:1;border:0;background:#f2f0fa;border-radius:12px"></iframe>';
  document.body.append(repair);
  gallery.addEventListener("click",e=>{if(e.target===gallery)gallery.close()});
  repair.addEventListener("click",e=>{if(e.target===repair)repair.close()});
  repair.addEventListener("close",()=>{repair.style.display="none";const frame=repair.querySelector("iframe");if(frame?.src!=="about:blank")location.reload()});
  backdrop.addEventListener("pointerdown",e=>{if(e.target.closest(".v29-drawer"))swipeStart={x:e.clientX,y:e.clientY}});
  backdrop.addEventListener("pointerup",e=>{if(!swipeStart)return;const dx=e.clientX-swipeStart.x,dy=e.clientY-swipeStart.y;swipeStart=null;if(dx< -85&&Math.abs(dy)<Math.abs(dx)*.8)closeDrawer()});
  backdrop.addEventListener("click",e=>{if(e.target===backdrop)closeDrawer()});
  document.addEventListener("keydown",e=>{
   if(menuOpen&&e.key==="Escape"){e.preventDefault();closeDrawer()}
   if(menuOpen&&e.key==="Tab"){
    const focus=[...backdrop.querySelectorAll('button:not([disabled]),input:not([disabled]),summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);
    if(!focus.length)return;
    if(e.shiftKey&&document.activeElement===focus[0]){e.preventDefault();focus.at(-1).focus()}
    else if(!e.shiftKey&&document.activeElement===focus.at(-1)){e.preventDefault();focus[0].focus()}
   }
  });
  // Capture on document: React delegates clicks at its root and may stop bubbling for injected controls.
  document.addEventListener("click",actions,true);
  document.addEventListener("input",inputs);
  document.addEventListener("click",e=>{
   const menu=e.target.closest?.(".menu-trigger");
   if(!menu)return;
   e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();
   openDrawer(menu);
  },true);
  updateThemeLayout();
  updateSelected();
  applyParams();
  renderSummary();
  const tabs=document.querySelector(".view-tabs");
  if(tabs){
   new MutationObserver(updateSelected).observe(tabs,{attributes:true,subtree:true,attributeFilter:["aria-selected"]});
  }
  new MutationObserver(updateThemeLayout).observe(root,{attributes:true,attributeFilter:["data-theme"]});
  window.addEventListener("resize",updateThemeLayout,{passive:true});
  window.addEventListener("hashchange",updateSelected);
  window.addEventListener("suishou-v29-summary",e=>{summary=e.detail;renderSummary()});
  return true;
 }
 function openDrawer(el){
  const d=document.getElementById("v29-drawer-backdrop");if(!d)return;
  previousFocus=el||document.activeElement;menuOpen=true;
  d.classList.add("is-open");d.setAttribute("aria-hidden","false");
  document.body.classList.add("v29-drawer-open");
  document.querySelector(".menu-trigger")?.setAttribute("aria-expanded","true");
  requestAnimationFrame(()=>d.querySelector(".v29-close")?.focus({preventScroll:true}));
 }
 function closeDrawer(){
  const d=document.getElementById("v29-drawer-backdrop");if(!d||!menuOpen)return;
  menuOpen=false;d.classList.remove("is-open");d.setAttribute("aria-hidden","true");
  document.body.classList.remove("v29-drawer-open");
  document.querySelector(".menu-trigger")?.setAttribute("aria-expanded","false");
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
 }
 function nav(id){
  const tab=document.getElementById("tab-"+id);
  if(tab)tab.click();
  closeDrawer();setTimeout(updateSelected,0);
 }
 function reactButton(selector){closeDrawer();requestAnimationFrame(()=>document.querySelector(selector)?.click())}
 function actions(e){
  const v=e.target.closest?.("[data-v29-view]");if(v){nav(v.dataset.v29View);return}
  const lay=e.target.closest?.("[data-v29-layout]");if(lay){choice=allowed(["auto","desktop","mobile"],lay.dataset.v29Layout,"auto");put("layout",choice);updateThemeLayout();closeDrawer();return}
  const wp=e.target.closest?.("[data-v29-wallpaper]");if(wp){wallpaper=allowed(THEMES.map(t=>t[0]),wp.dataset.v29Wallpaper,"garden");put("wallpaper",wallpaper);updateThemeLayout();return}
  const act=e.target.closest?.("[data-v29-action]");if(!act)return;
  switch(act.dataset.v29Action){
   case "close":closeDrawer();break;
   case "close-gallery":document.getElementById("v29-wallpaper-dialog")?.close();break;
   case "close-restore":document.getElementById("v29-restore-dialog")?.close();break;
   case "gallery":closeDrawer();document.getElementById("v29-wallpaper-dialog")?.showModal();break;
   case "cloud":reactButton(".cloud-trigger");break;
   case "manage":reactButton(".avatar-button");break;
   case "new":reactButton(".compose-button");break;
   case "recover":{
    closeDrawer();const d=document.getElementById("v29-restore-dialog");
    if(d){d.style.display="flex";d.querySelector("iframe").src="./restore-data.html?embedded=1";d.showModal()}
    break;
   }
   case "reset":for(const p of PARAMS){settings[p.key]=p.value;put("param."+p.key,p.value)}applyParams();break;
  }
 }
 function inputs(e){
  const el=e.target;
  const k=el?.dataset?.v29Param;
  if(k && PARAMS.some(p=>p.key===k)){settings[k]=Number(el.value);put("param."+k,settings[k]);applyParams();return}
  if(el?.id==="v29-strength"){strength=Math.min(1,Math.max(.15,Number(el.value)||.88));put("strength",strength);updateThemeLayout()}
 }
 function applyParams(){
  root.style.setProperty("--v29-ior",settings.ior.toFixed(2));
  root.style.setProperty("--v29-alpha",settings.alpha.toFixed(2));
  root.style.setProperty("--v29-rim",settings.rim.toFixed(2));
  root.style.setProperty("--v29-blur",settings.blur+"px");
  const amount=settings.spring/100;
  root.style.setProperty("--pop","cubic-bezier(.18,"+(0.7+amount*.3).toFixed(2)+",.24,"+(1.02+amount*.4).toFixed(2)+")");
  for(const p of PARAMS){
   document.querySelectorAll('[data-v29-param="'+p.key+'"]').forEach(x=>{if(Number(x.value)!==settings[p.key])x.value=settings[p.key]});
   document.querySelectorAll('[data-v29-output="'+p.key+'"]').forEach(x=>x.textContent=
    p.key==="alpha"||p.key==="rim"?Math.round(settings[p.key]*100)+"%":
    p.key==="blur"?settings[p.key]+"px":
    p.key==="spring"?settings[p.key]+"%":settings[p.key].toFixed(2));
  }
 }
 function updateThemeLayout(){
  const auto=matchMedia("(min-width:1100px) and (hover:hover) and (pointer:fine)").matches;
  const desktop=choice==="desktop" ? innerWidth>=980 :choice==="auto"&&auto;
  const layout=desktop?"desktop":"mobile";
  if(root.dataset.v29Layout!==layout)root.dataset.v29Layout=layout;
  root.dataset.v29Wallpaper=wallpaper;
  const mode=root.dataset.theme==="light"?"light":"dark";
  if(wallpaper!=="original")root.style.setProperty("--v29-wallpaper-image",'url("./assets/wallpapers/'+wallpaper+'-'+mode+'-'+layout+'.webp")');
  else root.style.removeProperty("--v29-wallpaper-image");
  root.style.setProperty("--v29-wallpaper-strength",strength);
  document.querySelectorAll("[data-v29-layout]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v29Layout===choice)));
  document.querySelectorAll("[data-v29-wallpaper]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v29Wallpaper===wallpaper)));
  const slider=document.getElementById("v29-strength");if(slider)slider.value=strength;
  const output=document.getElementById("v29-strength-value");if(output)output.textContent=Math.round(strength*100)+"%";
 }
 function updateSelected(){
  const el=document.querySelector('.view-tabs [role="tab"][aria-selected="true"]');
  const view=el?.id?.replace("tab-","")||"overview";
  document.querySelectorAll("[data-v29-view]").forEach(b=>{
   if(b.dataset.v29View===view)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
  });
  const label=VIEWS.find(([key])=>key===view)?.[1]||"总览";
  const page=document.querySelector('[data-v29-metric="page"]');if(page&&page.textContent!==label)page.textContent=label;
 }
 function renderSummary(){
  if(!summary)return;
  for(const [key,value] of Object.entries(summary)){
   document.querySelectorAll('[data-v29-metric="'+key+'"]').forEach(n=>{if(n.textContent!==String(value))n.textContent=String(value)});
  }
  updateSelected();
 }
 if(!build()){
  const obs=new MutationObserver(()=>{if(build())obs.disconnect()});
  obs.observe(document.getElementById("root")||document.body,{childList:true,subtree:true});
 }
})();
