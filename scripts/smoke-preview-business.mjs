import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
import {chromium} from "playwright";

async function visualSnapshot(browser, url, layout) {
 const page=await browser.newPage({viewport:layout==='desktop'?{width:1440,height:900}:{width:390,height:844}});
 try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(expected=>document.documentElement.dataset.layout===expected,layout);
  if(!url.includes('/design-baseline/'))await page.waitForFunction(()=>!!window.__suishouBusinessBridge);
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
   assert.equal(Number(await opacity.inputValue()),73);
   await opacity.fill('65');
   assert.equal(Number(await page.locator('#opacity').inputValue()),65);
   await panel.locator('[data-drawer-glass-reset]').click();
   assert.equal(Number(await opacity.inputValue()),73);
   drawer=await snapshot();
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
  for(const [layout,entry] of [['desktop','index.html'],['mobile','cloud.html']]){
   const original=await visualSnapshot(browser,base+baselinePath,layout);
   assert.deepEqual(await visualSnapshot(browser,base+entry,layout),original,`${layout} visual mismatch`);
  }

  await page.addInitScript(()=>{
   window.google={accounts:{oauth2:{
    initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'local-test',expires_in:3600})}),
    revoke:()=>{},
   }}};
  });
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>!!window.__suishouBusinessBridge,{timeout:15000});
  await page.evaluate(()=>localStorage.setItem("preview.smoke.sentinel","retain"));
  assert.equal(await page.locator("#nav .tab").count(),5);
  assert.equal(await page.locator(".bill-row").count(),0,"Demo records must not appear in production");
  await page.locator("#new-entry").click();
  await page.locator("#real-entry input[name=name]").fill("0元测试事件");
  await page.locator("#real-entry input[name=amount]").fill("0");
  await page.locator("#real-entry button[type=submit]").click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().records.length===1);
  assert.equal(await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records[0].amountMinor),0);
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.__suishouBusinessBridge?.getSnapshot().records.length===1);
  await page.locator('.tab[data-tab="bills"]').click();
  await page.waitForSelector(".bill-row");
  assert.match(await page.locator(".bill-row").innerText(),/0元测试事件/);
  await page.locator(".bill-row").click();
  await page.locator('#real-entry input[name=amount]').fill("5.42");
  await page.locator("#real-entry button[type=submit]").click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().records[0].amountMinor===542);
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
  await paymentEntry.click();
  await memberPayment.waitFor({state:'detached'});
  const afterPayment = await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot());
  assert.deepEqual(afterPayment.memberships[0],beforePayment);
  assert.equal(afterPayment.records[0].membershipId,beforePayment.id);
  assert.equal(afterPayment.records[0].category,'数码电子');
  assert.equal(afterPayment.records[0].amountMinor,1200);
  await page.locator(".sub-row").first().click();
  await member.getByRole('button',{name:'保存并登记付款'}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await paymentEntry.click();
  await page.waitForFunction(()=>document.getElementById('real-member-payment')?.getAttribute('aria-busy')===null);
  assert.equal(await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records.length),2);
  await memberPayment.getByRole('button',{name:'取消'}).click();

  await page.locator('[data-action="add-sub"]').first().click();
  await member.locator('[name=name]').fill('外币订阅');
  await member.locator('[name=currency]').selectOption('JPY');
  await member.locator('[name=amount]').fill('900');
  await member.getByRole('button',{name:'保存并登记付款'}).click();
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
  assert.equal(foreign.fx.originalCurrency,'JPY');
  assert.equal(foreign.fx.originalAmountMinor,900);
  assert.equal(foreign.fx.source,'实际扣款');
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
  assert.match(await page.locator("#real-cloud-status").innerText(),/本地账本|Drive|同步/);
  const [download]=await Promise.all([page.waitForEvent("download"),page.locator('[data-real="export-json"]').click()]);
  const name=download.suggestedFilename();
  assert.match(name,/备份.*json$/);
  const exportPath=await download.path();
  const backup=JSON.parse(await readFile(exportPath,"utf8"));
  assert.equal(backup.version,2);
  assert.equal(backup.records.find(record=>record.name==='0元测试事件').amountMinor,542);
  assert.equal(backup.records.find(record=>record.id===foreign.id).fx.originalCurrency,'JPY');
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
  const oldRecord={...backup.records[0],id:'v1:old-record'};
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
  await page.unroute('https://api.frankfurter.dev/**');
  await page.route('https://api.frankfurter.dev/**',route=>route.fulfill({
   json:{base:'JPY',quote:'CNY',rate:0.048,date:paidAt.slice(0,10)},
  }));
  page.once('dialog',dialog=>dialog.accept());
  await paymentEntry.click();
  await memberPayment.waitFor({state:'detached'});
  const referencePayment=await page.evaluate(()=>window.__suishouBusinessBridge.getSnapshot().records[0]);
  assert.equal(referencePayment.amountMinor,4320);
  assert.equal(referencePayment.fx.source,'Frankfurter');

  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.context().setOffline(true);
  await page.goto(base+'cloud.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__suishouBusinessBridge?.getSnapshot().records.length===4);
  assert.equal(errors.length,0,"Browser page errors: "+errors.join("; "));
  console.log("PASS: v29 desktop/mobile visuals, ledger and payment, card cover, V1/V2/V3 restore, mocked Google Drive backup, offline reload");
 }finally{
  await browser.close();
  await new Promise(ok=>server.close(ok));
 }
}
await smokePreviewBusiness();
