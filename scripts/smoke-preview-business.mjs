import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
import {chromium} from "playwright";

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
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const base=`http://127.0.0.1:${server.address().port}/`;
 try{
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
  await page.locator('#real-member input[name=name]').fill("订阅测试");
  await page.locator('#real-member input[name=amount]').fill("12");
  await page.locator('#real-member button[type=submit]').click();
  await page.waitForFunction(()=>window.__suishouBusinessBridge.getSnapshot().memberships.length===1);
  await page.locator(".sub-row").first().click();
  await page.waitForSelector('#real-member[data-id]:not([data-id=""])');
  await page.locator('[data-real="close"]').click();
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
  await page.locator("#menu-open").click();
  await page.waitForSelector("#menu-drawer-layer.is-open");
  await page.locator('[data-action="backups"]').click();
  await page.waitForSelector("#real-import-file");
  assert.match(await page.locator("#real-cloud-status").innerText(),/本地账本|Drive|同步/);
  const [download]=await Promise.all([page.waitForEvent("download"),page.locator('[data-real="export-json"]').click()]);
  const name=download.suggestedFilename();
  assert.match(name,/备份.*json$/);
  const exportPath=await download.path();
  const backup=JSON.parse(await readFile(exportPath,"utf8"));
  assert.equal(backup.version,2);assert.equal(backup.records[0].amountMinor,542);
  assert.equal(backup.cards.length,1);assert.equal(backup.memberships.length,1);
  assert.equal(await page.evaluate(()=>localStorage.getItem("preview.smoke.sentinel")),"retain");
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"/tmp/v29-mobile-smoke.png"});
  assert.equal(errors.length,0,"Browser page errors: "+errors.join("; "));
  console.log("PASS: original v29 DOM; persisted 0¥; edit; subscriptions; cards; topup; backup; mobile");
 }finally{
  await browser.close();
  await new Promise(ok=>server.close(ok));
 }
}
await smokePreviewBusiness();
