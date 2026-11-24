import {CATEGORY,CURRENCIES,PAYMENT_METHODS,BACKUP_FREQUENCIES,getSnapshot,subscribe,localDatetime,saveCurrency,getCategoryInfo,money,loadGoogleAuthorization,getGoogleTokenFromClick,syncCloud,disconnectCloud,setBackupFrequency,listBackupFolders,createBackupFolder,setBackupFolder,commit,validateRecords,validateCards,validateMemberships} from "./ledger.js";
import {amountInput,saveEntry,deleteEntry,saveCard,deleteCard,topupCard,CYCLE_NAMES,saveMember,recordMemberPayment,deleteMember,downloadBackup,downloadMigrationBackup,importBackup,clearRecords} from "./actions.js";
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
  const btn=(label,action)=>`<button type="button" class="glass" data-real="${safe(action)}">${label}</button>`;
  const submit=(label)=>`<button class="glass" type="submit">${label}</button>`;
  const opts=(items,value)=>items.map(([id,label])=>`<option value="${safe(id)}" ${id===value?"selected":""}>${safe(label)}</option>`).join("");
  const select=(name,items,value,attrs="")=>`<select name="${name}" ${attrs}>${opts(items,value)}</select>`;
  const paymentMethods = [["", "未指定"], ...Object.entries(PAYMENT_METHODS)];
  const actions=(body,wrap=false)=>`<div class="form-actions"${wrap?' style="flex-wrap:wrap"':''}>${btn("取消","close")}${body}</div>`;
  const modal=(title,html)=>view.modal(title,html);
  const formatDate=(date)=>{const x=String(date||"");return /^\d{4}-\d{2}-\d{2}$/.test(x)?`${x.slice(5,7)}月${x.slice(8,10)}日`:x;};
  const values=(form)=>Object.fromEntries(new FormData(form));
  const initial=getSnapshot();
  S.currency=initial.statsCurrency||"CNY";
  const today=new Date();
  S.year=today.getFullYear();S.month=today.getMonth()+1;
  let selectedDay=null;
  const localDay=()=>localDatetime().slice(0,10);
  const dayOf=(record)=>record.occurredAt.slice(0,10);
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
    S.records=snap.records.filter(r=>r.currency===S.currency&&(!selectedDay||dayOf(r)===selectedDay)).map(r=>({
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
  function entryPaymentMethods(code) {
    return [
      ...paymentMethods,
      ...getSnapshot().cards.filter(card => card.currency === code).map(card => [
        `card:${card.id}`, `储值卡 · ${card.name} · ${fmt(card.balanceMinor, card.currency)}`,
      ]),
    ];
  }
  function openEntry(id=null){
    const entry=getSnapshot().records.find(r=>r.id===id);
    const type=entry?.type||"expense",code=entry?.currency||S.currency;
    const payment = entry?.paymentCardId ? `card:${entry.paymentCardId}` : entry?.paymentMethod || "";
    modal(entry?"编辑账单":"记一笔",`<form id="real-entry" data-id="${safe(id||"")}">
      ${field("收支类型",select("type",[["expense","支出"],["income","收入"]],type,"id='real-entry-type'"))}
      ${field("事件 / 备注",input("name",entry?.name||"","text","maxlength='80' required"))}
      ${field("金额（支持 0 元）",input("amount",entry?amountInput(entry.amountMinor,code):"0","number","step='any' min='0' required"))}
      ${field("币种",select("currency",CURRENCIES.map(c=>[c.code,`${c.name} · ${c.code}`]),code,"id='real-entry-currency'"))}
      ${field("分类",select("category",CATEGORY[type].map(c=>[c.name,c.name]),entry?.category||CATEGORY[type][0].name,"id='real-entry-category'"))}
      ${field("日期时间",input("occurredAt",entry?.occurredAt||now(),"datetime-local","required"))}
      ${field("付款方式（仅支出）",select("paymentMethod",entryPaymentMethods(code),payment,type === "income" ? "disabled" : ""))}
      ${actions(submit(entry?"保存修改":"保存账单")+(entry?btn("删除账单","delete-entry:"+id):""))}
    </form>`);
  }
  function entryOptions(){
    const form=$("real-entry");if(!form)return;
    const type=form.elements.type.value,code=form.elements.currency.value;
    const oldCategory=form.elements.category.value;
    form.elements.category.innerHTML=opts(CATEGORY[type].map(c=>[c.name,c.name]),oldCategory);
    const payment = form.elements.paymentMethod;
    payment.innerHTML = opts(entryPaymentMethods(code), payment.value);
    payment.disabled = type === "income";
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
      <div class="field"><label><input type="checkbox" name="active" style="width:auto;padding:0" ${m?.active !== false ? "checked" : ""}> 订阅有效</label></div>
      <div class="field"><label><input type="checkbox" name="autoRenew" style="width:auto;padding:0" ${m?.autoRenew !== false ? "checked" : ""}> 自动续订</label></div>
      ${actions(submit(m ? "保存修改" : "添加订阅") +
        '<button class="glass" type="submit" name="intent" value="payment">保存并登记付款</button>' +
        (m ? btn("删除订阅", "delete-member:" + m.id) : ""), true)}
    </form>`);
  }
  function openMemberPayment(id) {
    const member = getSnapshot().memberships.find((item) => item.id === id);
    if (!member) throw new Error("此订阅已被移除，请重新选择。");
    const originalAmount = safe(fmt(member.amountMinor, member.currency));
    const isForeign = member.currency !== "CNY";
    modal("登记订阅付款", `<form id="real-member-payment" data-id="${safe(id)}">
      <p><b>${safe(member.name)}</b> · ${originalAmount}</p>
      ${field("实际付款时间", input("when", now(), "datetime-local", "required"))}
      ${field("付款支出分类", select("category", CATEGORY.expense.map(c => [c.name, c.name]), "娱乐休闲"))}
      ${field("付款方式", select("paymentMethod", paymentMethods, ""))}
      ${field("实际扣款人民币金额（选填）", input("actualCny", "", "number", "min='0.01' step='0.01'"))}
      <p class="subtext">${isForeign ? "留空时按最新参考汇率折算，确认后记入一笔人民币支出。" : "留空时按订阅价格记入一笔人民币支出。"}</p>
      <p class="subtext" role="alert" hidden></p>
      ${actions(submit("确认记入付款"))}
    </form>`);
    const form = $("real-member-payment");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitMemberPayment(form, member);
    });
    form.elements.when.focus({ preventScroll: true });
  }
  async function submitMemberPayment(form, member) {
    if (form.getAttribute("aria-busy") === "true") return;
    const data = values(form);
    const message = form.querySelector('[role="alert"]');
    const submitButton = form.querySelector('button[type="submit"]');
    message.hidden = true;
    form.setAttribute("aria-busy", "true");
    submitButton.disabled = true;
    try {
      if (await recordMemberPayment(member, data)) {
        view.closeModal();
        view.toast("已记入订阅付款");
      }
    } catch (failure) {
      message.textContent = failure.message;
      message.hidden = false;
    } finally {
      form.removeAttribute("aria-busy");
      submitButton.disabled = false;
    }
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
    const backupActions = (buttons) => `<div class="form-actions" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,8rem),1fr))">${buttons}</div>`;
    modal(only?"Google Drive 云端同步":"数据管理与备份",`
    <div id="real-backup-content" role="region" aria-label="备份设置" tabindex="0" style="min-height:0;overflow:auto">
     <section class="management-section"><h3>Google Drive</h3>
       <p id="real-cloud-status" role="status">${safe(l.cloudMessage)}</p>
       <p class="subtext">云端备份沿用原版同步格式，不保存 Google 密码。</p>
       ${backupActions(btn(l.cloudReady?"重新授权":"连接 Google Drive","connect-cloud") +
         btn(l.cloudFileId?"立即同步":"首次备份","sync-cloud") +
         btn("停止同步","disconnect-cloud"))}
       ${field("显示账单币种",select("statsCurrency",CURRENCIES.map(c=>[c.code,c.name+" · "+c.code]),S.currency,"id='real-stats-currency'"))}
       ${field("自动备份频率",select("backupFrequency",Object.entries(BACKUP_FREQUENCIES).map(([id,b])=>[id,b.label]),l.cloudFrequency,"id='real-backup-frequency'"))}
       <div class="form-actions">${btn("管理云端备份位置","cloud-folder")}</div>
     </section>
     <section class="management-section" style="margin-top:20px"><h3>本地 JSON 备份</h3>
       <p class="subtext">导出包含账目、卡包与订阅。迁移备份还包含卡片封面。</p>
       ${backupActions(btn("导出 JSON","export-json") + btn("导出迁移备份（含封面）","export-migration") +
         btn("选择 JSON 恢复","pick-import") + btn("安全合并恢复","safe-restore") + btn("清空账单","clear-records"))}
       <input type="file" id="real-import-file" accept=".json,application/json" hidden>
       <p class="subtext">导入前会再次确认覆盖范围。旧版 V1 备份仅替换账单。</p>
     </section>
    </div>`);
    const dialog = $("real-backup-content").parentElement;
    dialog.style.display = "flex";
    dialog.style.flexDirection = "column";
    // The v29 desktop glass rule gives the shell visible overflow with !important.
    dialog.style.setProperty("overflow", "hidden", "important");
    dialog.querySelector(".dialog-head").style.flexShrink = "0";
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
    const payment = $("real-member-payment");
    if (payment?.getAttribute("aria-busy") === "true" &&
        (e.target.id === "modal-layer" || e.target.closest?.('#modal-layer [data-action="close"], #real-member-payment [data-real="close"]'))) {
      stop(e);
      return;
    }
    const action=e.target.closest?.("[data-real]")?.dataset.real;
    if(action){
      e.preventDefault();e.stopPropagation();
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
    const [key,...parts]=action.split(":");
    const value=parts.join(":");
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
    if(kind==="safe-restore"){modal("安全恢复 · 合并订阅与卡包",`<iframe title="安全恢复" src="./restore-data.html?embedded=1" style="width:100%;height:65vh;border:0;border-radius:12px"></iframe><p class="subtext">恢复完成后重新打开网页，即可查看更新的数据。</p>`);return;}
    if(kind==="clear-records"){if(clearRecords()){view.closeModal();view.toast("账单已清空");}return;}
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
      if (form.id === "real-entry") {
        const payment = d.paymentMethod || "";
        const paidByStoredValue = payment.startsWith("card:");
        saveEntry(id, {
          ...d,
          paymentMethod: paidByStoredValue ? "" : payment,
          paymentCardId: paidByStoredValue ? payment.slice("card:".length) : "",
        });
      }
      if (form.id === "real-member") {
        const memberId = await saveMember(id, {
          ...d,
          active: form.elements.active.checked,
          autoRenew: form.elements.autoRenew.checked,
        });
        if (e.submitter?.value === "payment") {
          openMemberPayment(memberId);
          return;
        }
      }
      if(form.id==="real-card"){const newId=saveCard(id,{name:d.name,balance:d.balance,currency:d.currency});S.card=getSnapshot().cards.findIndex(c=>c.id===newId);updateView();}
      if(form.id==="real-topup")topupCard(id,d.amount);
      if(form.id==="real-cloud-folder"){
        const folder=d.newFolder?.trim()?await createBackupFolder(d.newFolder.trim()):null;
        await setBackupFolder(folder?.id||d.folderId);
      }
      view.closeModal();view.toast("已保存");
    })().catch(error);
  },true);
  document.addEventListener("keydown",e=>{
    const payment = $("real-member-payment");
    if (payment && e.key === "Escape") {
      e.preventDefault();
      if (payment.getAttribute("aria-busy") !== "true") view.closeModal();
      return;
    }
    const target=e.target.closest?.(".sub-row[data-real],.wallet-card[data-real]");
    if(target&&(e.key==="Enter"||e.key===" ")){e.preventDefault();target.click();}
  });
  // Date filtering and daily totals are view state only; never alter ledger data.
  const enhancements=document.createElement("style");
  enhancements.textContent=`
    #content .ledger-day-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;color:var(--muted);font-size:13px}
    #content .ledger-day-filter label{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
    #content .ledger-day-filter input{width:auto;max-width:100%;min-width:0;font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:7px 9px}
    #content .ledger-day-filter button{min-height:34px;padding:6px 10px;font-size:13px}
    #content .ledger-day-summary{margin-top:14px}
    #content .ledger-day-summary .section-head{flex-wrap:wrap}
    #content .ledger-day-totals{display:grid;gap:0}
    #content .ledger-day-currency{display:grid;grid-template-columns:minmax(46px,.65fr) minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}
    #content .ledger-day-currency:first-child{border-top:0}
    #content .ledger-day-number{display:grid;gap:3px;min-width:0}
    #content .ledger-day-number strong{font-size:clamp(15px,2vw,20px);overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
    #content .ledger-day-number span{font-size:12px;color:var(--muted)}
    html[data-layout="desktop"] .desktop-side[data-group-lens] .desktop-links{position:relative;isolation:isolate}
    html[data-layout="desktop"] .desktop-side[data-group-lens] .desktop-link{position:relative;z-index:1}
    html[data-layout="desktop"] .desktop-side[data-group-lens] .desktop-link:hover,
    html[data-layout="desktop"] .desktop-side[data-group-lens] .desktop-link[aria-current="page"]{background:transparent!important;border-color:transparent!important;box-shadow:none!important}
    html[data-layout="desktop"] .desktop-side[data-group-lens] .ledger-side-lens{pointer-events:none;position:absolute;z-index:0;left:0;top:0;width:100%;height:39px;opacity:0;border-radius:13px;border:1px solid var(--line);background:linear-gradient(125deg,rgba(227,235,255,.21),rgba(163,181,230,.12)),var(--surface);box-shadow:0 3px 12px rgba(8,15,45,.12),inset 0 1px 1px rgba(255,255,255,.28);transition:transform .32s cubic-bezier(.2,.8,.2,1),height .32s cubic-bezier(.2,.8,.2,1),opacity .19s ease}
    @media(prefers-reduced-motion:reduce){html[data-layout="desktop"] .desktop-side[data-group-lens] .ledger-side-lens{transition:none!important}}
  `;
  document.head.append(enhancements);

  function selectDay(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return;
    selectedDay=value;S.year=Number(value.slice(0,4));S.month=Number(value.slice(5,7));S.all=false;updateView();
  }
  function dailyTotals(records){
    const totals=new Map();
    for(const r of records){
      if(!totals.has(r.currency))totals.set(r.currency,{income:0,expense:0});
      const sum=totals.get(r.currency);
      if(r.type==="income"||r.type==="expense")sum[r.type]+=r.amountMinor;
    }
    if(!totals.size)totals.set(S.currency,{income:0,expense:0});
    return totals;
  }
  function dailyRow(r){
    const income=r.type==="income";
    const time=r.occurredAt.slice(11,16);
    return `<button type="button" class="bill-row" data-action="detail:${safe(r.id)}"><span class="bill-icon">${safe(getCategoryInfo(r.type,r.category).icon)}</span><span class="bill-info"><b>${safe(r.name)}</b><span>${safe(time)} · ${safe(r.category)} · ${safe(r.currency)}</span></span><strong class="bill-value ${income?"income":""}">${income?"+":"−"}${safe(fmt(r.amountMinor,r.currency))}</strong></button>`;
  }
  function enhanceDates(){
    if(!["overview","bills","stats"].includes(S.tab))return;
    const page=$("content")?.querySelector(".page");
    if(!page||page.dataset.dailyEnhanced)return;
    page.dataset.dailyEnhanced="true";
    const anchor=page.querySelector(S.tab==="overview"?".overview-top":".page-heading");
    if(anchor){
      const bar=document.createElement("div");
      bar.className="ledger-day-filter";
      bar.innerHTML=`<label>精确日期<input aria-label="按年月日筛选" id="ledger-date-filter" type="date" value="${safe(selectedDay||localDay())}"></label><button type="button" class="glass" id="ledger-date-apply">按日筛选</button>${selectedDay?'<button type="button" class="glass" id="ledger-date-clear">恢复月份</button>':""}<span>${selectedDay?"当前：按日":"当前："+(S.all?"全部时间":"按月")}</span>`;
      anchor.after(bar);
      bar.querySelector("input").addEventListener("change",e=>selectDay(e.target.value));
      bar.querySelector("#ledger-date-apply").addEventListener("click",()=>selectDay(bar.querySelector("input").value));
      bar.querySelector("#ledger-date-clear")?.addEventListener("click",()=>{selectedDay=null;S.all=false;updateView();});
    }
    if(selectedDay){
      const period=$("desktop-period");
      if(period)period.textContent=selectedDay.replace(/^(\d{4})-(\d{2})-(\d{2})$/,"$1 年 $2 月 $3 日");
    }
    if(S.tab!=="overview")return;
    const date=selectedDay||localDay(),isToday=date===localDay();
    const label=isToday?"今日":formatDate(date);
    const records=getSnapshot().records.filter(r=>dayOf(r)===date).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
    const list=page.querySelector(".bill-list");
    const panel=list?.closest(".panel");
    if(!list||!panel)return;
    const head=panel.querySelector(".section-head h2");
    if(head)head.textContent="最近账单 · "+label;
    list.innerHTML=records.map(dailyRow).join("")||'<div class="empty">该日暂无账单记录</div>';
    const summary=document.createElement("section");
    summary.className="panel ledger-day-summary";
    summary.innerHTML=`<div class="section-head"><h2>${safe(label)}收支汇总</h2><span class="subtext">${safe(date)} · ${records.length} 笔</span></div><div class="ledger-day-totals">${[...dailyTotals(records)].map(([code,total])=>`<div class="ledger-day-currency"><strong>${safe(code)}</strong><div class="ledger-day-number"><span>收入</span><strong class="income">${safe(fmt(total.income,code))}</strong></div><div class="ledger-day-number"><span>支出</span><strong class="expense">${safe(fmt(total.expense,code))}</strong></div></div>`).join("")}</div>`;
    panel.after(summary);
  }
  // Switching to monthly/all-time mode clears the exact-day filter before the
  // original navigation handler runs. Preserve the existing calendar controls.
  document.addEventListener("click",e=>{
    const action=e.target.closest?.("[data-action]")?.dataset.action;
    if(selectedDay&&(action==="all"||action?.startsWith("month:"))){
      selectedDay=null;updateView();
    }
  },true);
  let lastLocalDay=localDay();
  function refreshNewDay(){
    const day=localDay();
    if(day!==lastLocalDay){lastLocalDay=day;if(!selectedDay)updateView();}
  }
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshNewDay();});
  window.addEventListener("focus",refreshNewDay);
  setInterval(refreshNewDay,60000);

  // One optical highlight per desktop sidebar group. Move within a group;
  // when crossing groups, fade the old lens and reveal the new one in place.
  function setupGroupedSidebar(){
    const side=document.querySelector(".desktop-side");
    if(!side)return ()=>{};
    const groups=[...side.querySelectorAll(":scope > .desktop-links")];
    if(!groups.length)return ()=>{};
    const lenses=groups.map(group=>{
      const lens=document.createElement("span");lens.className="ledger-side-lens";lens.setAttribute("aria-hidden","true");group.prepend(lens);return lens;
    });
    side.dataset.groupLens="true";
    let currentGroup=-1,hovered=null,focused=null,lastTarget=null;
    const selected=()=>side.querySelector('[data-side-view][aria-current="page"]');
    function paint(target){
      const group=target?.closest(".desktop-links"),index=groups.indexOf(group);
      if(index<0||!target.offsetHeight){lenses.forEach(l=>l.style.opacity="0");currentGroup=-1;lastTarget=null;return;}
      const lens=lenses[index],cross=index!==currentGroup;
      if(cross){
        lenses.forEach((l,i)=>{if(i!==index)l.style.opacity="0";});
        // Reposition the hidden lens without any movement across the gap.
        lens.style.transition="none";lens.style.opacity="0";
      }
      lens.style.transform="translateY("+target.offsetTop+"px)";
      lens.style.height=target.offsetHeight+"px";
      if(cross){void lens.offsetHeight;lens.style.removeProperty("transition");}
      lens.style.opacity="1";currentGroup=index;lastTarget=target;
    }
    function refresh(){paint(hovered||focused||selected());}
    side.addEventListener("pointerover",e=>{
      if(e.pointerType==="touch")return;
      const target=e.target.closest?.(".desktop-links .desktop-link");
      if(target&&side.contains(target)&&target!==hovered){hovered=target;refresh();}
    });
    side.addEventListener("pointerleave",()=>{hovered=null;refresh();});
    side.addEventListener("focusin",e=>{focused=e.target.closest?.(".desktop-links .desktop-link")||null;refresh();});
    side.addEventListener("focusout",e=>{if(!side.contains(e.relatedTarget)){focused=null;refresh();}});
    window.addEventListener("resize",refresh,{passive:true});
    window.addEventListener("suishou-layout-change",refresh);
    if(typeof ResizeObserver==="function"){const observer=new ResizeObserver(refresh);groups.forEach(g=>observer.observe(g));}
    refresh();
    return ()=>{const target=hovered||focused||selected();if(target!==lastTarget)paint(target);};
  }
  const refreshSidebar=setupGroupedSidebar();

  // Keep the original v29 DOM, typography and glass CSS. Only attach click
  // targets to existing rows; do not wrap them in new glass cards.
  function attachRowActions(){
    enhanceDates();refreshSidebar();
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
