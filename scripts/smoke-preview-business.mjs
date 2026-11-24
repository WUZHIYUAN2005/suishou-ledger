import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
import {chromium} from "playwright";

async function checkBackupDialog(page, title) {
 const dialog=page.getByRole('dialog',{name:title});
 const close=dialog.getByRole('button',{name:'关闭',exact:true});
 const panel=dialog.locator('#suishou-long-auth');
 const enable=panel.getByRole('button',{name:'启用长期授权'});
 const revoke=panel.getByRole('button',{name:'撤销本设备长期授权'});
 const regular=dialog.locator('[data-real="connect-cloud"]');
 const gradient=button=>button.evaluate(element=>getComputedStyle(element).backgroundImage);
 assert.notEqual(await gradient(regular),'none');
 assert.equal(await gradient(enable),await gradient(regular),'Long-term authorization should use the v29 button style');
 assert.equal(await gradient(revoke),await gradient(regular));
 await enable.click();
 assert.match(await panel.getByRole('status').innerText(),/有效的 HTTPS/);

 const closeY=(await close.boundingBox()).y;
 const last=dialog.getByRole('button',{name:'清空账单'});
 await last.evaluate(button=>button.scrollIntoView({block:'nearest'}));
 const [button,frame]=await Promise.all([last.boundingBox(),dialog.boundingBox()]);
 assert.ok(button.y+button.height<=frame.y+frame.height,'The last backup button should scroll inside the dialog');
 assert.equal((await close.boundingBox()).y,closeY,'Closing should remain available while scrolling the backup controls');
 const overflow=await dialog.getByRole('region',{name:'备份设置'}).evaluate(el=>el.scrollWidth-el.clientWidth);
 assert.ok(overflow<=1,'The backup actions should fit the width of the dialog');
}

async function checkMobileGlassSave(browser, url) {
 const phone=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 try {
  await phone.goto(url,{waitUntil:'domcontentloaded'});
  const drawer=phone.locator('#menu-drawer-layer');
  const settings=drawer.locator('.drawer-glass-settings');
  const slider=id=>settings.locator(`[data-drawer-glass="${id}"]`);
  const openSettings=async()=>{
   await phone.locator('#menu-open').tap();
   await phone.locator('#menu-drawer-layer.is-open').waitFor();
   await settings.locator('summary').tap();
  };
  await openSettings();
  await slider('opacity').evaluate(input=>{
   const {x,y,width,height}=input.getBoundingClientRect();
   const start=new Touch({identifier:1,target:input,clientX:x+width-12,clientY:y+height/2});
   const end=new Touch({identifier:1,target:input,clientX:x+18,clientY:start.clientY});
   input.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[start],changedTouches:[start]}));
   input.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,touches:[end],changedTouches:[end]}));
   input.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[end]}));
  });
  assert.equal(await drawer.evaluate(el=>el.classList.contains('is-open')),true,'Dragging a slider must leave the drawer open');

  const edited={strength:'1.4',opacity:'65',rim:'55','blur-slider':'8',settle:'0.76'};
  for(const [id,value] of Object.entries(edited))await slider(id).fill(value);
  assert.equal(await phone.locator('#blur-out').textContent(),'8px');
  await settings.locator('summary').tap();
  await drawer.getByRole('button',{name:'关闭菜单'}).tap();
  await phone.keyboard.press('Escape');
  assert.equal(await settings.evaluate(el=>el.open),true,'Only saving should exit the glass editor');
  await settings.getByRole('button',{name:'保存配置'}).tap();
  await drawer.waitFor({state:'detached'});
  await phone.reload({waitUntil:'domcontentloaded'});
  assert.equal(await phone.locator('#blur-out').textContent(),'8px');
  await openSettings();
  for(const [id,value] of Object.entries(edited))assert.equal(await slider(id).inputValue(),value);

  await settings.getByRole('button',{name:'恢复默认'}).tap();
  assert.equal(await slider('blur-slider').inputValue(),'0');
  await phone.reload({waitUntil:'domcontentloaded'});
  assert.equal(await phone.locator('#blur-out').textContent(),'8px','Reload should keep the last saved profile');
  await openSettings();
  await settings.getByRole('button',{name:'恢复默认'}).tap();
  await settings.getByRole('button',{name:'保存配置'}).tap();
  await drawer.waitFor({state:'detached'});
  await phone.reload({waitUntil:'domcontentloaded'});
  assert.equal(await phone.locator('#blur-out').textContent(),'0px');
 } finally {
  await phone.close();
 }
}

async function visualSnapshot(browser, url, layout) {
 const mobile=layout==='mobile';
 const baseline=url.includes('/design-baseline/');
 const page=await browser.newPage({
  viewport:mobile?{width:390,height:844}:{width:1440,height:900},
  hasTouch:mobile,isMobile:mobile,
 });
 try {
  if(mobile&&!baseline)await page.addInitScript(()=>{
   const samples=window.__mobileGlassFrames=[];
   function sample() {
    const root=document.documentElement;
    if(root?.dataset.layout==='mobile'){
     const panel=document.querySelector('.kpi');
     samples.push({
      blur:getComputedStyle(root).getPropertyValue('--blur').trim(),
      panel:panel?getComputedStyle(panel).backdropFilter:null,
      wallpaperReady:window.__suishouWallpaperImage?.naturalWidth>0,
     });
    }
    if(samples.length<12||!samples.at(-1)?.wallpaperReady)requestAnimationFrame(sample);
   }
   requestAnimationFrame(sample);
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(expected=>document.documentElement.dataset.layout===expected,layout);
  if(!baseline)await page.waitForFunction(()=>!!window.__suishouBusinessBridge);
  if(mobile&&!baseline){
   await page.waitForFunction(()=>window.__mobileGlassFrames.length>=12&&window.__mobileGlassFrames.at(-1).wallpaperReady);
   const samples=await page.evaluate(()=>window.__mobileGlassFrames);
   assert.ok(samples.every(frame=>frame.blur==='0px'),'The mobile glass must start sharp and stay sharp');
   assert.ok(samples.some(frame=>frame.panel?.startsWith('blur(0px)')));
   assert.ok(samples.every(frame=>!frame.panel||frame.panel.startsWith('blur(0px)')));
  }
  const snapshot=() => page.evaluate(async()=>{
   await document.fonts.ready;
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   await Promise.allSettled(document.getAnimations()
    .filter(animation=>Number.isFinite(animation.effect.getComputedTiming().endTime))
    .map(animation=>animation.finished));
   const elements=['.desktop-stage','.desktop-side','.desktop-aside','.topbar','#nav','.kpi-grid','.kpi','.menu-drawer','.wp-choice'];
   const properties=['display','gridTemplateColumns','gap','borderRadius','backgroundColor','backdropFilter'];
   return Object.fromEntries(elements.map(selector=>{
    const el=document.querySelector(selector);
    if(!el)return [selector,null];
    const {x,y,width}=el.getBoundingClientRect();
    const css=getComputedStyle(el);
    return [selector,{x,y,width,styles:properties.map(name=>css[name])}];
   }));
  });
  const dark=await snapshot();
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  let drawer=null;
  if(layout==='mobile'){
   await page.locator('#menu-open').click();
   await page.locator('#menu-drawer-layer.is-open').waitFor();
   const panel=page.locator('.menu-drawer');
   await panel.locator('summary').click();
   const opacity=panel.locator('[data-drawer-glass="opacity"]');
   const blur=panel.locator('[data-drawer-glass="blur-slider"]');
   assert.equal(Number(await opacity.inputValue()),73);
   assert.equal(Number(await blur.inputValue()),baseline?23:0);
   await opacity.fill('65');
   assert.equal(Number(await page.locator('#opacity').inputValue()),65);
   await blur.fill('8');
   assert.equal(await page.locator('.kpi').first().evaluate(el=>getComputedStyle(el).backdropFilter),'blur(8px) saturate(1.45)');
   await panel.locator('[data-drawer-glass-reset]').click();
   assert.equal(Number(await opacity.inputValue()),73);
   assert.equal(Number(await blur.inputValue()),baseline?23:0);
   drawer=await snapshot();
   if(!baseline){
    await panel.getByRole('button',{name:'保存配置'}).tap();
    await panel.waitFor({state:'detached'});
    await page.locator('#menu-open').click();
   }
  }
  await page.locator(layout==='desktop'?'[data-wallpaper-open]':'#menu-drawer-layer [data-action="wallpaper"]').click();
  assert.equal(await page.locator('[data-wallpaper-choice]').count(),4);
  await page.locator('[data-wallpaper-choice="cosmos"]').click();
  await page.waitForFunction(device=>{
   const library=JSON.parse(document.getElementById('suishou-wallpaper-library').textContent);
   return window.__suishouWallpaperImage?.src===library.cosmos.light[device];
  },layout);
  const light=await snapshot();
  await page.locator('[data-wallpaper-close]').click();
  await page.locator('[data-wallpaper-close]').waitFor({state:'detached'});
  return {dark,drawer,light};
 }finally{
  await page.close();
 }
}

async function smokePreviewBusiness(){
 const ROOT=resolve(".");
 const MIME={".html":"text/html;charset=utf-8",".js":"text/javascript;charset=utf-8",".css":"text/css;charset=utf-8",".webp":"image/webp",".png":"image/png",".json":"application/json"};
 const server=createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,"http://localhost").pathname;
   const path=resolve(ROOT,"."+(pathname==="/"?"/index.html":pathname));
   if(path!==ROOT&&!path.startsWith(ROOT+sep)){res.writeHead(403).end();return;}
   if(!(await stat(path)).isFile()){res.writeHead(404).end();return;}
   res.writeHead(200,{"content-type":MIME[extname(path)]||"application/octet-stream"});
   res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
 });
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const browser=await chromium.launch({headless:true,channel:process.env.SUISHOU_BROWSER_CHANNEL,args:["--no-sandbox"]});
 const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const base=`http://127.0.0.1:${server.address().port}/`;
 try{
  const baselinePath='design-baseline/suishou-preview-v29.html';
  const baseline=await readFile(baselinePath,'utf8');
  for(const entry of ['index.html','cloud.html']){
   const html=await readFile(entry,'utf8');
   assert.deepEqual(html.match(/<style\b[^>]*>[\s\S]*?<\/style>/g),baseline.match(/<style\b[^>]*>[\s\S]*?<\/style>/g));
   const wallpaper=/<script id="suishou-wallpaper-library"[^>]*>[\s\S]*?<\/script>/;
   assert.ok(baseline.match(wallpaper));
   assert.equal(html.match(wallpaper)?.[0],baseline.match(wallpaper)[0]);
  }
  await checkMobileGlassSave(browser,base+'cloud.html');
  for(const [layout,entry] of [['desktop','index.html'],['mobile','cloud.html']]){
   const original=await visualSnapshot(browser,base+baselinePath,layout);
   if(layout==='mobile'){
    for(const snapshot of Object.values(original).filter(Boolean)){
     for(const el of Object.values(snapshot).filter(Boolean)){
      el.styles[5]=el.styles[5].replace('blur(23px)','blur(0px)').replace('blur(25px)','blur(2px)');
     }
    }
   }
   assert.deepEqual(await visualSnapshot(browser,base+entry,layout),original,`${layout} visual mismatch`);
  }

  const searchRecords=[
   {id:'search-cny',name:'Morning Coffee',currency:'CNY',category:'餐饮美食',occurredAt:'2026-10-15T09:00',amountMinor:125},
   {id:'search-usd',name:'Night Train',currency:'USD',category:'交通出行',occurredAt:'2026-10-15T21:30',amountMinor:0},
   {id:'search-other-day',name:'Night Train (another day)',currency:'CNY',category:'交通出行',occurredAt:'2026-10-16T21:30',amountMinor:350},
  ].map(record=>({...record,type:'expense'}));

  // Verify date selection and search together at desktop and phone widths.
  for(const mobile of [false,true]){
   const datePage=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile});
   try{
    await datePage.addInitScript(records=>{
     localStorage.setItem('suishou-ledger.records.v1',JSON.stringify(records));
    },searchRecords);
    await datePage.goto(base+"cloud.html",{waitUntil:"domcontentloaded"});
    await datePage.waitForFunction(()=>!!window.__suishouBusinessBridge);
    const trigger=datePage.getByRole("button",{name:"精确日期筛选"});
    assert.equal(await trigger.count(),1);
    assert.equal(await datePage.locator(".ledger-day-filter").count(),0,"Date chooser must not add a row");
    await trigger.click();
    const dialog=datePage.getByRole("dialog",{name:"选择日期"});
    await dialog.locator('input[type=date]').fill("2026-10-15");
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),"Date dialog must fit its viewport");
    await dialog.getByRole("button",{name:"按日筛选"}).click();
    assert.equal(await trigger.textContent(),"10/15");
    const summary=datePage.locator(".ledger-day-summary");
    const dayTotals=await summary.innerText();
    assert.match(dayTotals,/2026-10-15 · 2 笔/);
    const search=datePage.locator('#search');
    const list=datePage.locator('#content .bill-list');
    const titles=()=>list.locator('.bill-info b').allTextContents();
    assert.deepEqual(await titles(),['Night Train','Morning Coffee']);
    for(const query of ['NIGHT TRAIN','交通出行','10-15 21:30']){
     await search.fill(query);
     assert.deepEqual(await titles(),['Night Train'],`Overview search for ${query} must stay within the selected date`);
     assert.equal(await summary.innerText(),dayTotals,'The summary must still cover the full day');
    }
    await search.fill('no matching record');
    assert.deepEqual(await titles(),[]);
    assert.match(await list.innerText(),/没有符合条件的记录/);
    await search.fill('');
    assert.deepEqual(await titles(),['Night Train','Morning Coffee']);
    await trigger.click();
    await dialog.getByRole("button",{name:"恢复月份"}).click();
    assert.equal(await trigger.textContent(),"10月");
   }finally{await datePage.close()}
  }

  await page.addInitScript(()=>{
   window.google={accounts:{oauth2:{
    initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'local-test',expires_in:3600})}),
    revoke:()=>{},
   }}};
  });
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>!!window.__suishouBusinessBridge,{timeout:15000});
  await page.setViewportSize({width:1440,height:768});
  await page.locator('.desktop-side [data-action="cloud"]').click();
  await checkBackupDialog(page,'Google Drive 云端同步');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>localStorage.setItem("preview.smoke.sentinel","retain"));
  assert.equal(await page.locator("#nav .tab").count(),5);
  assert.equal(await page.locator(".bill-row").count(),0,"Demo records must not appear in production");
  await page.locator("#new-entry").click();
  await page.locator("#real-entry input[name=name]").fill("0元测试事件");
  await page.locator("#real-entry input[name=amount]").fill("0");
  await page.locator("#real-entry button[type=submit]").click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().records.length===1);
  const legacyRecord=await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records[0]);
  assert.equal(legacyRecord.amountMinor,0);
  assert.equal(legacyRecord.paymentMethod,undefined);
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.__suishouBusinessBridge?.getSnapshot().records.length===1);
  await page.locator('.tab[data-tab="bills"]').click();
  await page.waitForSelector(".bill-row");
  assert.match(await page.locator(".bill-row").innerText(),/0元测试事件/);
  await page.locator(".bill-row").click();
  const entry=page.locator('#real-entry');
  const entryPayment=entry.locator('[name=paymentMethod]');
  assert.deepEqual(await entryPayment.locator('option').allTextContents(),['未指定','借记卡','信用卡','微信','支付宝']);
  assert.equal(await entryPayment.inputValue(),'');
  await entry.locator('[name=currency]').selectOption('INR');
  await entryPayment.selectOption('debit');
  await page.locator('#real-entry input[name=amount]').fill("5.42");
  await page.locator("#real-entry button[type=submit]").click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().records[0].amountMinor===542);
  const inrExpense=await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records[0]);
  assert.equal(inrExpense.currency,'INR');
  assert.equal(inrExpense.paymentMethod,'debit');
  await page.locator('.tab[data-tab="stats"]').click();
  const statsCurrency=page.getByRole('combobox',{name:'统计币种'});
  await statsCurrency.selectOption('INR');
  assert.match(await page.locator('.donut').innerText(),/₹5\.42/);
  await page.locator('.tab[data-tab="bills"]').click();
  await page.locator('.bill-row').click();
  assert.equal(await entryPayment.inputValue(),'debit');
  await entry.getByRole('button',{name:'取消'}).click();
  await page.locator('.tab[data-tab="stats"]').click();
  await statsCurrency.selectOption('CNY');
  await page.locator('.tab[data-tab="subs"]').click();
  await page.locator('[data-action="add-sub"]').first().click();
  const member = page.locator('#real-member');
  const memberPayment = page.locator('#real-member-payment');
  const paymentEntry = memberPayment.getByRole('button',{name:'确认记入付款'});
  assert.equal(await member.locator('[name=when], [name=paid], [name=actualCny]').count(),0);
  await member.locator('input[name=name]').fill("订阅测试");
  await member.locator('input[name=amount]').fill("12");
  await member.getByRole('button',{name:'添加订阅',exact:true}).click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().memberships.length===1);
  assert.equal(await memberPayment.count(),0);
  await page.locator(".sub-row").first().click();
  await page.waitForSelector('#real-member[data-id]:not([data-id=""])');
  await member.getByRole('button',{name:'保存并登记付款'}).click();
  await memberPayment.waitFor();
  assert.equal(await member.count(),0);
  await page.keyboard.press('Escape');
  await memberPayment.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records.length),1);
  await page.locator(".sub-row").first().click();
  await member.getByRole('button',{name:'保存并登记付款'}).click();
  const beforePayment = await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().memberships[0]);
  await memberPayment.locator('[name=category]').selectOption('数码电子');
  await memberPayment.locator('[name=paymentMethod]').selectOption('credit');
  await paymentEntry.click();
  await memberPayment.waitFor({state:'detached'});
  const afterPayment = await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot());
  assert.deepEqual(afterPayment.memberships[0],beforePayment);
  assert.equal(afterPayment.records[0].membershipId,beforePayment.id);
  assert.equal(afterPayment.records[0].category,'数码电子');
  assert.equal(afterPayment.records[0].amountMinor,1200);
  assert.equal(afterPayment.records[0].paymentMethod,'credit');
  await page.locator(".sub-row").first().click();
  await member.getByRole('button',{name:'保存并登记付款'}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await paymentEntry.click();
  await page.waitForFunction(()=>document.getElementById('real-member-payment')?.getAttribute('aria-busy')===null);
  assert.equal(await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records.length),2);
  await memberPayment.getByRole('button',{name:'取消'}).click();

  await page.locator('[data-action="add-sub"]').first().click();
  await member.locator('[name=name]').fill('外币订阅');
  await member.locator('[name=currency]').selectOption('INR');
  await member.locator('[name=amount]').fill('900.50');
  await member.getByRole('button',{name:'保存并登记付款'}).click();
  await memberPayment.locator('[name=paymentMethod]').selectOption('wechat');
  let quoteRequests = 0;
  await page.route('https://api.frankfurter.dev/**',async route=>{
   quoteRequests++;
   await route.fulfill({status:503,body:'Test offline exchange rate'});
  });
  await paymentEntry.click();
  await memberPayment.getByRole('alert').waitFor();
  assert.match(await memberPayment.getByRole('alert').innerText(),/汇率/);
  assert.equal(quoteRequests,1);
  assert.equal(await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records.length),2);
  await memberPayment.locator('[name=actualCny]').fill('42.35');
  await paymentEntry.click();
  await memberPayment.waitFor({state:'detached'});
  const foreign = await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records[0]);
  assert.equal(foreign.amountMinor,4235);
  assert.equal(foreign.currency,'CNY');
  assert.equal(foreign.fx.originalCurrency,'INR');
  assert.equal(foreign.fx.originalAmountMinor,90050);
  assert.equal(foreign.fx.source,'实际扣款');
  assert.equal(foreign.paymentMethod,'wechat');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__suishouBusinessBridge?.getSnapshot().records.length===3);

  await page.locator('.tab[data-tab="cards"]').click();
  await page.locator('[data-action="add-card"]').click();
  await page.locator('#real-card input[name=name]').fill("储值卡测试");
  await page.locator('#real-card input[name=balance]').fill("100");
  await page.locator('#real-card button[type=submit]').click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().cards.length===1);
  await page.locator('[data-action=topup]').click();
  await page.locator('#real-topup input[name=amount]').fill("10");
  await page.locator('#real-topup button[type=submit]').click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().cards[0].balanceMinor===11000);
  const cardId=await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().cards[0].id);
  await page.locator('#new-entry').click();
  await entry.locator('[name=name]').fill('验储值卡扣款');
  await entry.locator('[name=amount]').fill('5');
  await entryPayment.selectOption(`card:${cardId}`);
  await entry.getByRole('button',{name:'保存账单'}).click();
  assert.equal(await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().cards[0].balanceMinor),10500);
  await page.locator('.tab[data-tab="bills"]').click();
  await page.locator('.bill-row').filter({hasText:'验储值卡扣款'}).click();
  assert.equal(await entryPayment.inputValue(),`card:${cardId}`);
  await entryPayment.selectOption('debit');
  await entry.getByRole('button',{name:'保存修改'}).click();
  assert.equal(await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().cards[0].balanceMinor),11000);
  await page.locator('.bill-row').filter({hasText:'验储值卡扣款'}).click();
  page.once('dialog',dialog=>dialog.accept());
  await entry.getByRole('button',{name:'删除账单'}).click();
  await page.locator('.tab[data-tab="cards"]').click();
  const cover=await readFile('icon-180.png');
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('[data-action=cover]').click()]);
  await chooser.setFiles({name:'cover.png',mimeType:'image/png',buffer:cover});
  await page.waitForFunction(()=>document.querySelector('.wallet-card img')?.naturalWidth>0);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__suishouBusinessBridge);
  await page.locator('.tab[data-tab="cards"]').click();
  await page.waitForFunction(()=>document.querySelector('.wallet-card img')?.naturalWidth>0);
  await page.evaluate(()=>window.__suishouLayout.set("mobile"));
  await page.waitForFunction(()=>document.documentElement.dataset.layout==="mobile");
  await page.setViewportSize({width:390,height:844});
  await page.locator("#menu-open").click();
  await page.waitForSelector("#menu-drawer-layer.is-open");
  await page.locator('[data-action="backups"]').click();
  await page.waitForSelector("#real-import-file",{state:"attached"});
  await checkBackupDialog(page,'数据管理与备份');
  assert.match(await page.locator("#real-cloud-status").innerText(),/本地账本|Drive|同步/);
  const [download]=await Promise.all([page.waitForEvent("download"),page.locator('[data-real="export-json"]').click()]);
  const name=download.suggestedFilename();
  assert.match(name,/备份.*json$/);
  const exportPath=await download.path();
  const backup=JSON.parse(await readFile(exportPath,"utf8"));
  assert.equal(backup.version,2);
  assert.deepEqual(backup.records.find(record=>record.id===inrExpense.id),inrExpense);
  assert.deepEqual(backup.records.find(record=>record.id===foreign.id),foreign);
  assert.equal(backup.cards.length,1);assert.equal(backup.memberships.length,2);

  const [migration]=await Promise.all([page.waitForEvent('download'),page.locator('[data-real="export-migration"]').click()]);
  const migrationBackup=JSON.parse(await readFile(await migration.path(),'utf8'));
  assert.equal(migrationBackup.version,3);
  assert.deepEqual(migrationBackup.covers,[{id:backup.cards[0].id,data:`data:image/png;base64,${cover.toString('base64')}`}]);

  const openBackup=async()=>{
   await page.locator('#menu-open').click();
   await page.locator('#menu-drawer-layer.is-open [data-action="backups"]').click();
  };
  const restore=async data=>{
   page.once('dialog',dialog=>dialog.accept());
   await page.locator('#real-import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
   await page.locator('#real-import-file').waitFor({state:'detached'});
  };
  const oldRecord={...legacyRecord,id:'v1:old-record'};
  await restore({app:'随手账本',version:1,records:[oldRecord]});
  const restoredV1=await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot());
  assert.equal(restoredV1.records[0].id,oldRecord.id);
  assert.deepEqual(restoredV1.cards,backup.cards);
  assert.deepEqual(restoredV1.memberships,backup.memberships);
  await page.locator('.tab[data-tab="bills"]').click();
  await page.locator('.bill-row').click();
  assert.equal(await page.locator('#real-entry').getAttribute('data-id'),oldRecord.id);
  await page.locator('[data-real="close"]').click();
  await openBackup();
  await restore(backup);
  assert.equal(await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records.length),3);
  await openBackup();
  await restore(migrationBackup);

  await openBackup();
  await page.locator('#suishou-long-auth').waitFor();
  await page.route('https://www.googleapis.com/drive/v3/files?**',route=>route.fulfill({json:{files:[]}}));
  let cloudBackup;
  await page.route('https://www.googleapis.com/upload/drive/v3/files?**',async route=>{
   const request=route.request();
   const body=request.postData().split('\r\n');
   cloudBackup=JSON.parse(body.find(line=>line.includes('"syncVersion"')));
   await route.fulfill({json:{id:'local-test-backup',name:'随手账本-云端同步.json',mimeType:'application/json'}});
  });
  await page.locator('[data-real="connect-cloud"]').click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().cloudChecked);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-real="sync-cloud"]').click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().cloudStatus==='ok');
  assert.equal(cloudBackup.syncVersion,1);
  assert.deepEqual(cloudBackup.records,backup.records);
  assert.deepEqual(cloudBackup.cards,backup.cards);
  assert.deepEqual(cloudBackup.memberships,backup.memberships);
  await page.locator('[data-real="disconnect-cloud"]').click();
  assert.match(await page.locator('#real-cloud-status').innerText(),/已停止同步/);
  assert.equal(await page.evaluate(()=>localStorage.getItem("preview.smoke.sentinel")),"retain");

  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.setViewportSize({width:320,height:667});
  await page.locator('.tab[data-tab="subs"]').click();
  await page.locator('.sub-row').filter({hasText:'外币订阅'}).click();
  const overflow = await member.evaluate(form=>{
   const right=form.getBoundingClientRect().right;
   return [...form.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>right+1)
    .map(el=>[el.tagName,el.getAttribute('name'),el.getBoundingClientRect().right,right]);
  });
  assert.deepEqual(overflow,[],'Subscription edit must fit the mobile dialog');
  await member.getByRole('button',{name:'保存并登记付款'}).click();
  assert.ok(await memberPayment.evaluate(form=>form.scrollWidth<=form.clientWidth+1));
  const paidAt=await memberPayment.locator('[name=when]').inputValue();
  await memberPayment.locator('[name=paymentMethod]').selectOption('alipay');
  await page.unroute('https://api.frankfurter.dev/**');
  await page.route('https://api.frankfurter.dev/v2/rate/INR/CNY',route=>route.fulfill({
   json:{base:'INR',quote:'CNY',rate:0.08,date:paidAt.slice(0,10)},
  }));
  page.once('dialog',dialog=>dialog.accept());
  await paymentEntry.click();
  await memberPayment.waitFor({state:'detached'});
  const referencePayment=await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records[0]);
  assert.equal(referencePayment.amountMinor,7204);
  assert.equal(referencePayment.fx.source,'Frankfurter');
  assert.equal(referencePayment.paymentMethod,'alipay');

  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.context().setOffline(true);
  await page.goto(base+'cloud.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__suishouBusinessBridge?.getSnapshot().records.length===4);
  assert.equal(errors.length,0,"Browser page errors: "+errors.join("; "));
  console.log("PASS: v29 desktop/mobile visuals, mobile glass save and touch drag, ledger and payment, card cover, V1/V2/V3 restore, mocked Google Drive backup, offline reload");
 }finally{
  await browser.close();
  await new Promise(ok=>server.close(ok));
 }
}
await smokePreviewBusiness();
