import {CATEGORY,CURRENCIES,BACKUP_FREQUENCIES,getSnapshot,subscribe,localDatetime,saveCurrency,getCategoryInfo,money,loadGoogleAuthorization,getGoogleTokenFromClick,syncCloud,disconnectCloud,setBackupFrequency,listBackupFolders,createBackupFolder,setBackupFolder,commit,validateRecords,validateCards,validateMemberships} from "./ledger.js";
import {amountInput,saveEntry,deleteEntry,saveCard,deleteCard,topupCard,CYCLE_NAMES,saveMember,deleteMember,downloadBackup,downloadMigrationBackup,importBackup} from "./actions.js";
import {readCovers,putCover,removeCover,readCoverImage} from "./covers.js";

function bootPreviewBridge(){
  "use strict";
  const view=window.__suishouPreview;
  if(!view)throw new Error("v29 界面接口未就绪，无法接入真实账本");
  const S=view.state;
  const $=(id)=>document.getElementById(id);
  const safe=(v)=>String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const currency=(code)=>CURRENCIES.find(c=>c.code===code)||CURRENCIES[0];
  const amount=(minor,code)=>minor/10**currency(code).digits;
  const fmt=(minor,code)=>money(minor,code);
  const now=()=>localDatetime();
  const error=(e)=>{console.error("随手账本真实数据操作失败",e);view.toast(e?.message||"操作失败");};
  const field=(label,control)=>`<div class="field"><label>${safe(label)}${control}</label></div>`;
  const input=(name,value="",type="text",attrs="")=>`<input name="${name}" type="${type}" value="${safe(value)}" ${attrs}>`;
  const btn=(label,action)=>`<button type="button" class="glass" data-real="${action}">${label}</button>`;
  const submit=(label)=>`<button class="glass" type="submit">${label}</button>`;
  const opts=(items,value)=>items.map(([id,label])=>`<option value="${safe(id)}" ${id===value?"selected":""}>${safe(label)}</option>`).join("");
  const select=(name,items,value,attrs="")=>`<select name="${name}" ${attrs}>${opts(items,value)}</select>`;
  const actions=(body)=>`<div class="form-actions">${btn("取消","close")}${body}</div>`;
  const modal=(title,html)=>view.modal(title,html);
  const formatDate=(date)=>{const x=String(date||"");return /^\d{4}-\d{2}-\d{2}$/.test(x)?`${x.slice(5,7)}月${x.slice(8,10)}日`:x;};
  const values=(form)=>Object.fromEntries(new FormData(form));
  const initial=getSnapshot();
  S.currency=initial.statsCurrency||"CNY";
  const today=new Date();
  S.year=today.getFullYear();S.month=today.getMonth()+1;
  let coverUrl="",coverId="";
  async function loadCover(id){
    if(coverUrl){URL.revokeObjectURL(coverUrl);coverUrl="";}
    S.editedCover=null;coverId=id||"";
    view.render();
    if(!id)return;
    try{
      const covers=await readCovers();
      if(coverId!==id)return;
      const blob=covers.get(id);
      if(blob){coverUrl=URL.createObjectURL(blob);S.editedCover=coverUrl;view.render();}
    }catch(e){console.warn("卡片封面暂不可用",e);}
  }
  function updateView(){
    const snap=getSnapshot();
    S.currency=snap.statsCurrency||S.currency||"CNY";
    S.records=snap.records.filter(r=>r.currency===S.currency).map(r=>({
      id:r.id,title:r.name,category:r.category,kind:r.type,
      value:amount(r.amountMinor,r.currency),currency:r.currency,
      year:Number(r.occurredAt.slice(0,4)),ym:r.occurredAt.slice(0,7),
      date:r.occurredAt.slice(5,7)+"-"+r.occurredAt.slice(8,10)+" "+r.occurredAt.slice(11,16),
      icon:getCategoryInfo(r.type,r.category).icon
    })).sort((a,b)=>b.ym.localeCompare(a.ym)||b.date.localeCompare(a.date));
    S.subscriptions=snap.memberships.map(m=>({
      id:m.id,name:m.name,cycle:CYCLE_NAMES[m.cycle]||m.cycle,
      due:formatDate(m.nextDate),price:amount(m.amountMinor,m.currency),
      currency:m.currency,icon:"✦",active:m.active,rawCycle:m.cycle
    }));
    S.cards=snap.cards.map((c,i)=>({
      id:c.id,name:c.name,balance:amount(c.balanceMinor,c.currency),
      currency:c.currency,type:c.currency,kind:i%2?"second":"first"
    }));
    if(S.cards.length===0)S.card=0;
    else S.card=Math.min(S.card,S.cards.length-1);
    view.render();
    const id=S.cards[S.card]?.id;
    if(coverId!==id)void loadCover(id);
    if(snap.storageError)view.toast(snap.storageError);
    const status=$("real-cloud-status");
    if(status)status.textContent=snap.cloudMessage;
  }
  function openEntry(id=null){
    const entry=getSnapshot().records.find(r=>r.id===id);
    const type=entry?.type||"expense",code=entry?.currency||S.currency;
    modal(entry?"编辑账单":"记一笔",`<form id="real-entry" data-id="${safe(id||"")}">
      ${field("收支类型",select("type",[["expense","支出"],["income","收入"]],type,"id='real-entry-type'"))}
      ${field("事件 / 备注",input("name",entry?.name||"","text","maxlength='80' required"))}
      ${field("金额（支持 0 元）",input("amount",entry?amountInput(entry.amountMinor,code):"0","number","step='any' min='0' required"))}
      ${field("币种",select("currency",CURRENCIES.map(c=>[c.code,`${c.name} · ${c.code}`]),code,"id='real-entry-currency'"))}
      ${field("分类",select("category",CATEGORY[type].map(c=>[c.name,c.name]),entry?.category||CATEGORY[type][0].name,"id='real-entry-category'"))}
      ${field("日期时间",input("occurredAt",entry?.occurredAt||now(),"datetime-local","required"))}
      ${field("储值卡付款（仅支出）",select("paymentCardId",[["","不使用储值卡"],...getSnapshot().cards.filter(c=>c.currency===code).map(c=>[c.id,c.name+" · "+fmt(c.balanceMinor,c.currency)])],entry?.paymentCardId||"","id='real-entry-card'"))}
      ${actions(submit(entry?"保存修改":"保存账单")+(entry?btn("删除账单","delete-entry:"+id):""))}
    </form>`);
  }
  function entryOptions(){
    const form=$("real-entry");if(!form)return;
    const type=form.elements.type.value,code=form.elements.currency.value;
    const oldCategory=form.elements.category.value;
    form.elements.category.innerHTML=opts(CATEGORY[type].map(c=>[c.name,c.name]),oldCategory);
    const record=getSnapshot().records.find(r=>r.id===form.dataset.id);
    const previous=form.elements.paymentCardId.value;
    const valid=getSnapshot().cards.filter(c=>c.currency===code).map(c=>[c.id,c.name+" · "+fmt(c.balanceMinor,c.currency)]);
    form.elements.paymentCardId.innerHTML=opts([["","不使用储值卡"],...valid],previous||record?.paymentCardId||"");
    form.elements.paymentCardId.disabled=type==="income";
  }
  function openMember(id=null){
    const m=getSnapshot().memberships.find(x=>x.id===id);
    const next=new Date();next.setMonth(next.getMonth()+1);
    const date=m?.nextDate||localDatetime(next).slice(0,10);
    modal(m?"编辑订阅":"新增订阅",`<form id="real-member" data-id="${safe(id||"")}">
      ${field("订阅名称",input("name",m?.name||"","text","maxlength='50' required"))}
      ${field("价格",input("amount",m?amountInput(m.amountMinor,m.currency):"","number","min='0.01' step='any' required"))}
      ${field("币种",select("currency",CURRENCIES.map(c=>[c.code,c.name+" · "+c.code]),m?.currency||"CNY"))}
      ${field("周期",select("cycle",Object.entries(CYCLE_NAMES),m?.cycle||"month"))}
      ${field("下次扣费日期",input("nextDate",date,"date","required"))}
      ${field("备注",input("note",m?.note||"","text","maxlength='100'"))}
      ${field("状态",`<label><input type="checkbox" name="active" ${m?.active!==false?"checked":""}> 订阅有效</label>`)}
      ${field("自动续订",`<label><input type="checkbox" name="autoRenew" ${m?.autoRenew!==false?"checked":""}> 自动续订</label>`)}
      ${actions(submit(m?"保存修改":"添加订阅")+(m?btn("删除订阅","delete-member:"+m.id):""))}
    </form>`);
  }
  function openCard(id=null){
    const c=getSnapshot().cards.find(x=>x.id===id);
    modal(c?"编辑储值卡":"添加储值卡",`<form id="real-card" data-id="${safe(id||"")}">
      ${field("卡片名称",input("name",c?.name||"","text","maxlength='40' required"))}
      ${field("币种",select("currency",CURRENCIES.map(x=>[x.code,x.name+" · "+x.code]),c?.currency||"CNY",c?"disabled":""))}
      ${field("余额",input("balance",c?amountInput(c.balanceMinor,c.currency):"0","number","min='0' step='any' required"))}
      ${actions(submit(c?"保存卡片":"添加卡片")+(c?btn("删除卡片","delete-card:"+c.id):""))}
    </form>`);
  }
  function openTopup(){
    const c=getSnapshot().cards.find(x=>x.id===S.cards[S.card]?.id);
    if(!c){view.toast("请先添加储值卡");return;}
    modal("储值卡充值",`<form id="real-topup" data-id="${safe(c.id)}">
      <p>${safe(c.name)} · 当前余额 ${fmt(c.balanceMinor,c.currency)}</p>
      ${field("充值金额",input("amount","","number","min='0.01' step='any' required"))}
      ${actions(submit("确认充值"))}</form>`);
  }
  function openCloud(only=false){
    const l=getSnapshot();
    modal(only?"Google Drive 云端同步":"数据管理与备份",`
     <section class="management-section"><h3>Google Drive</h3>
       <p id="real-cloud-status" role="status">${safe(l.cloudMessage)}</p>
       <p class="subtext">云端备份沿用原版同步格式，不保存 Google 密码。</p>
       <div class="form-actions">
         ${btn(l.cloudReady?"重新授权":"连接 Google Drive","connect-cloud")}
         ${btn(l.cloudFileId?"立即同步":"首次备份","sync-cloud")}
         ${btn("停止同步","disconnect-cloud")}
       </div>
       ${field("显示账单币种",select("statsCurrency",CURRENCIES.map(c=>[c.code,c.name+" · "+c.code]),S.currency,"id='real-stats-currency'"))}
       ${field("自动备份频率",select("backupFrequency",Object.entries(BACKUP_FREQUENCIES).map(([id,b])=>[id,b.label]),l.cloudFrequency,"id='real-backup-frequency'"))}
       <div class="form-actions">${btn("管理云端备份位置","cloud-folder")}</div>
     </section>
     <section class="management-section"><h3>本地 JSON 备份</h3>
       <p class="subtext">导出包含账目、卡包与订阅。迁移备份还包含卡片封面。</p>
       <div class="form-actions">${btn("导出 JSON","export-json")}${btn("导出迁移备份（含封面）","export-migration")}${btn("选择 JSON 恢复","pick-import")}</div>
       <input type="file" id="real-import-file" accept=".json,application/json" hidden>
       <p class="subtext">导入前会再次确认覆盖范围。旧版 V1 备份仅替换账单。</p>
     </section>`);
    void loadGoogleAuthorization().catch(e=>console.warn("Google 授权库暂不可用",e));
  }
  async function chooseFolder(){
    const folders=await listBackupFolders();
    modal("云端备份位置",`<form id="real-cloud-folder">
    ${field("文件夹",select("folderId",folders.map(f=>[f.id,f.name]),"root"))}
    ${field("或创建新文件夹",input("newFolder","","text","maxlength='100' placeholder='留空使用选中位置'"))}
    ${actions(submit("保存备份位置"))}</form>`);
  }
  async function importAny(file){
    if(!file||file.size>30*1024*1024)throw Error("备份文件过大（上限 30 MB）");
    const data=JSON.parse(await file.text());
    if(data?.app!=="随手账本")throw Error("不是随手账本备份");
    if(data.version===1||data.version===2){await importBackup(file);return;}
    if(data.version!==3)throw Error("不支持的备份版本");
    const records=validateRecords(data.records);
    const cards=validateCards(data.cards||[]);
    const memberships=validateMemberships(data.memberships||[]);
    if(!Array.isArray(data.covers)||data.covers.length>100)throw Error("卡片封面数据无效");
    if(!confirm(`将覆盖现有 ${getSnapshot().records.length} 笔账单、卡包和订阅，恢复 ${records.length} 笔账单、${cards.length} 张卡、${memberships.length} 项订阅。确定吗？`))return;
    const covered=new Set(cards.map(x=>x.id));
    const binary=[];
    for(const x of data.covers){
      if(!x||!covered.has(x.id)||typeof x.data!=="string"||!/^data:image\/(png|jpeg|webp);base64,/.test(x.data))throw Error("封面备份数据无效");
      const blob=await (await fetch(x.data)).blob();
      if(blob.size>15*1024*1024)throw Error("封面文件过大");
      binary.push([x.id,blob]);
    }
    commit({records,cards,memberships},true);
    for(const [id,blob] of binary)await putCover(id,blob);
    view.toast(`已恢复 ${records.length} 笔账单`);
  }
  function stop(event){
    event.preventDefault();event.stopImmediatePropagation();
  }
  const intercepted=new Set(["detail","cloud","backups","add-sub","add-card","select-card","topup","cover"]);
  document.addEventListener("click",e=>{
    const action=e.target.closest?.("[data-real]")?.dataset.real;
    if(action){
      stop(e);
      try{void handleReal(action).catch(error);}catch(err){error(err);}
      return;
    }
    const node=e.target.closest?.("[data-action]");
    const key=node?.dataset.action?.split(":")[0];
    if(key&&intercepted.has(key)){
      stop(e);
      try{void handlePrototype(node.dataset.action).catch(error);}catch(err){error(err);}
      return;
    }
    const add=e.target.closest?.("#new-entry,[data-side-action='new-entry']");
    if(add){stop(e);openEntry();}
  },true);
  async function handlePrototype(action){
    const [key,value]=action.split(":");
    if(key==="detail")openEntry(value);
    else if(key==="cloud")openCloud(true);
    else if(key==="backups")openCloud(false);
    else if(key==="add-sub")openMember();
    else if(key==="add-card")openCard();
    else if(key==="select-card"){S.card=Number(value);updateView();}
    else if(key==="topup")openTopup();
    else if(key==="cover"){
      const c=S.cards[S.card];
      if(!c){view.toast("请先添加储值卡");return;}
      const choose=document.createElement("input");choose.type="file";choose.accept="image/png,image/jpeg,image/webp";
      choose.onchange=async()=>{try{const file=choose.files?.[0];if(!file)return;await readCoverImage(file);await putCover(c.id,file);await loadCover(c.id);view.toast("卡片封面已保存");}catch(e){error(e);}};
      choose.click();
    }
  }
  async function handleReal(action){
    const [kind,...rest]=action.split(":");const id=rest.join(":");
    if(kind==="close"){view.closeModal();return;}
    if(kind==="new-entry"){openEntry();return;}
    if(kind==="edit-sub"){openMember(id);return;}
    if(kind==="edit-card"){openCard(id);return;}
    if(kind==="edit-selected-card"){openCard(S.cards[S.card]?.id);return;}
    if(kind==="delete-entry"&&deleteEntry(id)){view.closeModal();view.toast("账单已删除");return;}
    if(kind==="delete-member"&&deleteMember(id)){view.closeModal();view.toast("订阅已删除");return;}
    if(kind==="delete-card"&&deleteCard(id)){await removeCover(id);view.closeModal();view.toast("储值卡已删除");return;}
    if(kind==="connect-cloud"){
      if(!getGoogleTokenFromClick())view.toast("正在加载 Google 授权服务，稍后再次点击");
      return;
    }
    if(kind==="sync-cloud"){await syncCloud(true);return;}
    if(kind==="disconnect-cloud"){disconnectCloud();return;}
    if(kind==="export-json"){downloadBackup();return;}
    if(kind==="export-migration"){await downloadMigrationBackup();return;}
    if(kind==="pick-import"){$("real-import-file")?.click();return;}
    if(kind==="cloud-folder"){await chooseFolder();return;}
  }
  document.addEventListener("change",e=>{
    const element=e.target;
    if(element?.id==="real-import-file"){
      const file=element.files?.[0];element.value="";
      if(file)void importAny(file).then(()=>view.closeModal()).catch(error);
    }
    if(element?.id==="real-entry-type"||element?.id==="real-entry-currency")entryOptions();
    if(element?.id==="real-backup-frequency")setBackupFrequency(element.value);
    if(element?.id==="real-stats-currency"||element?.id==="real-stat-page-currency")saveCurrency(element.value);
  });
  document.addEventListener("submit",e=>{
    const form=e.target;
    if(!["real-entry","real-member","real-card","real-topup","real-cloud-folder"].includes(form.id))return;
    e.preventDefault();e.stopImmediatePropagation();
    void (async()=>{
      const d=values(form),id=form.dataset.id||null;
      if(form.id==="real-entry")saveEntry(id,{type:d.type,name:d.name,amount:d.amount,currency:d.currency,category:d.category,occurredAt:d.occurredAt,paymentCardId:d.type==="expense"?d.paymentCardId:""});
      if(form.id==="real-member")await saveMember(id,{name:d.name,amount:d.amount,currency:d.currency,cycle:d.cycle,nextDate:d.nextDate,note:d.note||"",active:!!form.elements.active.checked,autoRenew:!!form.elements.autoRenew.checked,paid:false});
      if(form.id==="real-card"){const newId=saveCard(id,{name:d.name,balance:d.balance,currency:d.currency});S.card=getSnapshot().cards.findIndex(c=>c.id===newId);}
      if(form.id==="real-topup")topupCard(id,d.amount);
      if(form.id==="real-cloud-folder"){
        const folder=d.newFolder?.trim()?await createBackupFolder(d.newFolder.trim()):null;
        await setBackupFolder(folder?.id||d.folderId);
      }
      view.closeModal();view.toast("已保存");
    })().catch(error);
  },true);
  document.addEventListener("keydown",e=>{
    const target=e.target.closest?.(".sub-row[data-real],.wallet-card[data-real]");
    if(target&&(e.key==="Enter"||e.key===" ")){e.preventDefault();target.click();}
  });
  // Keep the original v29 DOM, typography and glass CSS. Only attach click
  // targets to existing rows; do not wrap them in new glass cards.
  function attachRowActions(){
    if(S.tab==="stats"){
      const sel=document.querySelector("#content select[aria-label='统计币种']");
      if(sel){sel.innerHTML=opts(CURRENCIES.map(c=>[c.code,c.name+" · "+c.code]),S.currency);sel.id="real-stat-page-currency";}
    }
    if(S.tab==="subs"){
      document.querySelectorAll(".sub-row").forEach((el,i)=>{
        if(S.subscriptions[i]){el.dataset.real="edit-sub:"+S.subscriptions[i].id;el.tabIndex=0;el.setAttribute("role","button");el.setAttribute("aria-label","编辑 "+S.subscriptions[i].name);}
      });
    }
    if(S.tab==="cards"){
      const card=S.cards[S.card];
      const actions=[...document.querySelectorAll("#content [data-action='topup']")];
      if(card&&actions.length&&!document.getElementById("edit-selected-card")){
        const b=document.createElement("button");b.type="button";b.id="edit-selected-card";b.className="glass";b.dataset.real="edit-selected-card";b.textContent="编辑卡片";actions[0].parentElement.append(b);
      }
    }
  }
  const originalRender=view.render;
  view.render=()=>{originalRender();attachRowActions();};
  const contentRoot=$("content");
  if(contentRoot)new MutationObserver(()=>attachRowActions()).observe(contentRoot,{childList:true});
  subscribe(updateView);
  updateView();
  if("serviceWorker" in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(e=>console.warn("离线缓存暂不可用",e));
  window.__suishouBusinessBridge={getSnapshot,openEntry,openCloud};
}
bootPreviewBridge();
