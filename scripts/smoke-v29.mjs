import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";

const ROOT=resolve(".");
const MIME={".html":"text/html;charset=utf-8",".js":"application/javascript;charset=utf-8",".css":"text/css;charset=utf-8",".webp":"image/webp",".png":"image/png",".json":"application/json"};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url||"/","http://127.0.0.1").pathname;
  const file=resolve(ROOT,"."+ (path==="/"?"/index.html":path));
  if(file!==ROOT&&!file.startsWith(ROOT+sep)){res.writeHead(403).end();return}
  if(!(await stat(file)).isFile()){res.writeHead(404).end();return}
  res.writeHead(200,{"content-type":MIME[extname(file)]||"application/octet-stream"});
  res.end(await readFile(file));
 }catch(_){res.writeHead(404).end()}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:"dark"});
const errors=[];
page.on("pageerror",e=>errors.push(e.message));
try{
 const base="http://127.0.0.1:"+server.address().port+"/";
 await page.goto(base,{waitUntil:"load"});
 await page.waitForSelector(".v29-side-left");
 await page.evaluate(()=>{
  localStorage.setItem("suishou-ledger.v29.layout","desktop");
  localStorage.setItem("v29.smoke.sentinel","preserve");
 });
 await page.reload({waitUntil:"load"});
 await page.waitForFunction(()=>document.documentElement.dataset.v29Layout==="desktop");
 assert.equal(await page.locator('.view-tabs [role="tab"]').count(),5);
 const left=await page.locator(".v29-side-left").boundingBox();
 const nav=await page.locator(".view-tabs").boundingBox();
 const right=await page.locator(".v29-side-right").boundingBox();
 assert(left&&nav&&right,"desktop columns must all be visible");
 assert(Math.abs(left.y-nav.y)<3,"left rail must align to nav top");
 assert(Math.abs(right.y-nav.y)<3,"right rail must align to nav top");
 await page.locator('.v29-side-left [data-v29-view="bills"]').click();
 await page.waitForFunction(()=>document.querySelector('#tab-bills')?.getAttribute("aria-selected")==="true");
 await page.locator('.v29-side-left [data-v29-action="gallery"]').click();
 await page.waitForFunction(()=>document.querySelector("#v29-wallpaper-dialog")?.open);
 await page.locator('#v29-wallpaper-dialog [data-v29-wallpaper="cosmos"]').click();
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.v29Wallpaper),"cosmos");
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body,"::before").backgroundImage.includes("cosmos-dark-desktop.webp")),true);
 await page.locator('#v29-wallpaper-dialog [data-v29-action="close-gallery"]').click();
 await page.locator('.v29-side-left [data-v29-layout="mobile"]').click();
 await page.waitForFunction(()=>document.documentElement.dataset.v29Layout==="mobile");
 await page.locator('.menu-trigger').click();
 await page.waitForFunction(()=>document.getElementById("v29-drawer-backdrop")?.classList.contains("is-open"));
 await page.locator('.v29-drawer [data-v29-view="stats"]').click();
 await page.waitForFunction(()=>document.querySelector('#tab-stats')?.getAttribute("aria-selected")==="true");
 assert.equal(await page.locator("#v29-drawer-backdrop").getAttribute("aria-hidden"),"true");
 await page.locator('.compose-button').click();
 await page.waitForSelector(".sheet[open]");
 await page.locator('.sheet[open] [aria-label="关闭"]').first().click();
 await page.waitForFunction(()=>!document.querySelector(".sheet[open]"));
 await page.locator(".cloud-trigger").click();
 await page.waitForSelector(".sheet[open]");
 await page.locator('.sheet[open] [aria-label="关闭"]').first().click();
 await page.waitForFunction(()=>!document.querySelector(".sheet[open]"));
 assert.equal(await page.evaluate(()=>localStorage.getItem("v29.smoke.sentinel")),"preserve");
 assert.equal(errors.length,0,"page errors: "+errors.join("; "));
 console.log("PASS: desktop grid, five tabs, gallery, wallpaper, mobile drawer, navigation, compose, cloud, unchanged localStorage");
}finally{
 await browser.close();
 await new Promise(r=>server.close(r));
}
