/*
 * Suishou navigation: screen-space refraction in WebGL2.
 * Architecture references iyinchao/liquid-glass-studio (MIT).
 * Two-pass Gaussian blur, actual wallpaper texture sampling, RGB dispersion,
 * Snell refraction (IOR 1.49), Schlick Fresnel and per-pixel SDF normals.
 *
 * Browsers cannot read arbitrary live DOM pixels into a WebGL texture.
 * Here the actual wallpaper CSS and the decorative WebGL canvas are sampled
 * separately; tab labels remain accessible DOM content above the shader.
 */
(() => {
"use strict";
if(window.__suishouNavOptics)return;
window.__suishouNavOptics=true;
const MARGIN=34, IOR=1.49;
const vertex=[
"#version 300 es","precision highp float;","out vec2 uv;",
"void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}"
].join("\n");
const blur=[
"#version 300 es","precision highp float;","in vec2 uv;","uniform sampler2D t;",
"uniform vec2 stepUV;","out vec4 color;",
"void main(){",
"vec4 s=texture(t,uv)*.227027;",
"s+=(texture(t,uv+stepUV)+texture(t,uv-stepUV))*.1945946;",
"s+=(texture(t,uv+stepUV*2.)+texture(t,uv-stepUV*2.))*.1216216;",
"s+=(texture(t,uv+stepUV*3.)+texture(t,uv-stepUV*3.))*.054054;",
"s+=(texture(t,uv+stepUV*4.)+texture(t,uv-stepUV*4.))*.016216;",
"color=s;}"
].join("\n");
const glass=[
"#version 300 es","precision highp float;","in vec2 uv;",
"uniform sampler2D backgroundTex;","uniform sampler2D blurredTex;",
"uniform vec2 size;","uniform vec2 patchSize;","uniform vec2 finger;",
"uniform float fingerAlpha;","uniform float tabWidth;","uniform float marginPx;",
"uniform float ior;","uniform float darkMode;","out vec4 color;",
"float boxSdf(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+vec2(r);return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}",
"vec2 sampleUV(vec2 p){vec2 q=(p+vec2(marginPx))/patchSize;return clamp(vec2(q.x,1.-q.y),vec2(.001),vec2(.999));}",
"vec3 sampleBg(vec2 p){return texture(backgroundTex,sampleUV(p)).rgb;}",
"vec3 sampleBlur(vec2 p){return texture(blurredTex,sampleUV(p)).rgb;}",
"vec2 normalAt(vec2 p,vec2 center,vec2 halfSize,float r){",
"float e=.65;",
"vec2 n=vec2(boxSdf(p+vec2(e,0.)-center,halfSize,r)-boxSdf(p-vec2(e,0.)-center,halfSize,r),",
"boxSdf(p+vec2(0.,e)-center,halfSize,r)-boxSdf(p-vec2(0.,e)-center,halfSize,r));",
"return normalize(n+vec2(.00001));}",
"vec3 refracted(vec2 p,float sdf,vec2 n,float thick,float slope,float tint,out float F){",
"float edge=pow(1.-smoothstep(0.,thick,max(0.,-sdf)),1.15);",
"vec3 surfaceN=normalize(vec3(n*edge*slope,1.));",
"vec3 ray=refract(vec3(0.,0.,-1.),surfaceN,1./ior);",
"vec2 shift=clamp(ray.xy/max(.35,-ray.z)*(thick*1.12),vec2(-28.),vec2(28.));",
"vec3 rgb=vec3(sampleBg(p+shift*1.055).r,sampleBg(p+shift).g,sampleBg(p+shift*.946).b);",
"rgb=mix(rgb,sampleBlur(p+shift),.13+.39*edge);",
"float r0=pow((ior-1.)/(ior+1.),2.);",
"F=r0+(1.-r0)*pow(1.-clamp(surfaceN.z,0.,1.),5.);",
"vec3 tintColor=mix(vec3(.93,.965,1.),vec3(.28,.38,.56),darkMode);",
"return mix(rgb,tintColor,tint);}",
"void main(){",
"vec2 p=vec2(uv.x,1.-uv.y)*size;",
"vec2 center=size*.5;",
"vec2 halfSize=max(center-vec2(1.1),vec2(1.));",
"float radius=min(29.,size.y*.49);",
"float dist=boxSdf(p-center,halfSize,radius);",
"float coverage=1.-smoothstep(-1.,1.,dist);",
"if(coverage<.001){color=vec4(0.);return;}",
"vec2 n=normalAt(p,center,halfSize,radius);",
"float F;",
"vec3 c=refracted(p,dist,n,17.,1.13,mix(.105,.17,darkMode),F);",
"float rim=exp(-abs(dist)*1.25);",
"float top=max(dot(n,normalize(vec2(-.65,-.76))),0.);",
"float bottom=max(dot(n,normalize(vec2(.55,.83))),0.);",
"c+=vec3(1.,.98,1.)*(rim*(.13+.31*top)+F*.22);",
"c-=vec3(.05,.075,.12)*rim*bottom;",
"if(fingerAlpha>.001){",
"vec2 lensCenter=vec2(finger.x,center.y);",
"vec2 lensHalf=vec2(max(10.,tabWidth*.5-2.4),max(9.,center.y-7.));",
"float lr=min(22.,lensHalf.y);",
"float ld=boxSdf(p-lensCenter,lensHalf,lr);",
"float a=(1.-smoothstep(-1.2,1.2,ld))*fingerAlpha;",
"if(a>.001){",
"vec2 ln=normalAt(p,lensCenter,lensHalf,lr);",
"float LF;",
"vec3 lc=refracted(p,ld,ln,23.,1.75,mix(.12,.18,darkMode),LF);",
"float edge=exp(-abs(ld)*.77);",
"float light=max(dot(ln,normalize(vec2(-.65,-.75))),0.);",
"lc+=vec3(.95,.97,1.)*(edge*(.23+.46*light)+LF*.38);",
"lc-=vec3(.06,.06,.10)*edge*(1.-light)*.47;",
"c=mix(c,lc,a);",
"}}",
"color=vec4(clamp(c,0.,1.),coverage*.98);",
"}"
].join("\n");
function channel(color){
 const value=color.trim(),found=value.match(/[\d.]+/g);
 if(value[0]==="#"){
  const c=value.slice(1),six=c.length===3?[...c].map(x=>x+x).join(""):c;
  return [0,2,4].map(i=>parseInt(six.slice(i,i+2),16));
 }
 return found?found.slice(0,3).map(Number):[30,30,45];
}
function ellipse(ctx,value,x,y,rx,ry,limit,w,h){
 const rgb=channel(value);ctx.save();ctx.translate(x*w,y*h);ctx.scale(rx*w,ry*h);
 const grad=ctx.createRadialGradient(0,0,0,0,0,1);
 grad.addColorStop(0,value.trim().startsWith("rgba(")?value:"rgb("+rgb.join(",")+")");
 grad.addColorStop(limit,"rgba("+rgb.join(",")+",0)");
 grad.addColorStop(1,"rgba("+rgb.join(",")+",0)");
 ctx.fillStyle=grad;ctx.fillRect(-1.05,-1.05,2.1,2.1);ctx.restore();
}
function install(nav){
 if(nav.dataset.optics==="webgl")return;
 const canvas=document.createElement("canvas");
 canvas.className="nav-optics-canvas";
 canvas.setAttribute("aria-hidden","true");
 nav.prepend(canvas);
 let gl;
 try{gl=canvas.getContext("webgl2",{
  alpha:true,antialias:true,premultipliedAlpha:false,
  depth:false,stencil:false,powerPreference:"high-performance"
 });}catch(_){}
 if(!gl){canvas.remove();nav.dataset.optics="fallback";return;}

 function program(fragment){
  function shader(type,code){
   const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);
   if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
    const error=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(error);
   }
   return s;
  }
  const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
  const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
  gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
  return p;
 }
 let blurProgram,glassProgram;
 try{blurProgram=program(blur);glassProgram=program(glass);}
 catch(e){console.warn("Navigation optical shader error",e);canvas.remove();nav.dataset.optics="fallback";return;}
 const u=(program,name)=>gl.getUniformLocation(program,name);
 const bu={tex:u(blurProgram,"t"),step:u(blurProgram,"stepUV")};
 const gu={
  source:u(glassProgram,"backgroundTex"),blur:u(glassProgram,"blurredTex"),
  size:u(glassProgram,"size"),patch:u(glassProgram,"patchSize"),
  finger:u(glassProgram,"finger"),alpha:u(glassProgram,"fingerAlpha"),
  width:u(glassProgram,"tabWidth"),margin:u(glassProgram,"marginPx"),
  ior:u(glassProgram,"ior"),dark:u(glassProgram,"darkMode")
 };
 function texture(){
  const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return tex;
 }
 const sourceTex=texture(),blurX=texture(),blurY=texture();
 function framebuffer(tex){
  const f=gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER,f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
  return f;
 }
 const fbX=framebuffer(blurX),fbY=framebuffer(blurY);
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 const backdrop=document.createElement("canvas");
 const ctx=backdrop.getContext("2d",{alpha:false});
 if(!ctx){canvas.remove();nav.dataset.optics="fallback";return;}

 let dpr=1,patchW=0,patchH=0,raf=0;
 let cached=null,geometryDirty=true,sceneDirty=true,lastScene=-Infinity;
 let previousDark=null,lensX=NaN;
 let lastTarget=-1,lastDrag=false,lastDraw=0;
 const debug=new URLSearchParams(location.search).has("glassDebug");
 const info={fps:0,sceneMs:0,sceneUpdates:0,drawMs:0,dragFrames:0};
 window.__suishouGlassPerf=info;
 let readout=null,sampleStart=0,sampleFrames=0;
 if(debug){
  readout=document.createElement("output");
  readout.id="suishou-glass-perf";
  readout.setAttribute("aria-label","玻璃导航渲染诊断");
  readout.style.cssText="position:fixed;top:calc(env(safe-area-inset-top) + 5px);left:8px;z-index:9999;padding:5px 7px;background:#121826e6;color:white;border-radius:7px;font:11px/1.35 monospace;pointer-events:none;white-space:pre;max-width:95vw;";
  document.body.append(readout);
 }

 function updateGeometry(){
  const rect=nav.getBoundingClientRect();
  const tabs=[...nav.querySelectorAll('[role="tab"]')];
  const centers=tabs.map(tab=>{
   const bounds=tab.getBoundingClientRect();
   return bounds.left-rect.left+bounds.width/2;
  });
  cached={rect,centers,width:tabs[0]?.getBoundingClientRect().width||rect.width/5};
  geometryDirty=false;
  sceneDirty=true;
 }
 function resize(rect){
  // Retain the existing 2x optical resolution and full RGB/Fresnel effects.
  const ratio=Math.min(devicePixelRatio||1,2);
  const cw=Math.max(1,Math.round(rect.width*ratio));
  const ch=Math.max(1,Math.round(rect.height*ratio));
  const pw=Math.max(1,Math.round((rect.width+2*MARGIN)*ratio));
  const ph=Math.max(1,Math.round((rect.height+2*MARGIN)*ratio));
  if(cw===canvas.width&&ch===canvas.height&&pw===patchW&&ph===patchH)return;
  dpr=ratio;canvas.width=cw;canvas.height=ch;
  patchW=pw;patchH=ph;backdrop.width=pw;backdrop.height=ph;
  for(const tex of [sourceTex,blurX,blurY]){
   gl.bindTexture(gl.TEXTURE_2D,tex);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,pw,ph,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  }
  sceneDirty=true;
 }
 function drawBackdrop(rect,dark){
  const w=innerWidth,h=innerHeight,s=getComputedStyle(document.documentElement);
  const paper=s.getPropertyValue("--paper").trim();
  const light=s.getPropertyValue("--page-light").trim();
  const cool=s.getPropertyValue("--page-cool").trim();
  const bottom=s.getPropertyValue("--page-bottom").trim();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,backdrop.width/dpr,backdrop.height/dpr);
  ctx.translate(MARGIN-rect.left,MARGIN-rect.top);
  ctx.fillStyle=paper;ctx.fillRect(0,0,w,h);
  ellipse(ctx,bottom,.49,.98,.78,.55,.90,w,h);
  ellipse(ctx,"rgba(233,231,255,.52)",.49,.54,.28,.28,.90,w,h);
  ellipse(ctx,cool,.94,.23,.66,.62,.83,w,h);
  ellipse(ctx,light,.13,.08,.68,.54,.82,w,h);
  // Reading a second WebGL canvas forces GPU -> CPU synchronization in Safari.
  // Refresh that sample at a separate cadence, never every finger movement.
  const decorative=document.getElementById("liquid-studio-canvas");
  if(decorative&&decorative.width&&decorative.height){
   try{
    ctx.globalAlpha=dark?.55:.66;
    ctx.drawImage(decorative,0,0,w,h);
   }catch(_){}
   ctx.globalAlpha=1;
  }
  ctx.setTransform(1,0,0,1,0,0);
 }
 function drawBlur(fb,tex,dx,dy){
  gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
  gl.viewport(0,0,patchW,patchH);
  gl.useProgram(blurProgram);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.uniform1i(bu.tex,0);gl.uniform2f(bu.step,dx,dy);
  gl.drawArrays(gl.TRIANGLES,0,3);
 }
 function refreshScene(rect,dark){
  const start=performance.now();
  drawBackdrop(rect,dark);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.bindTexture(gl.TEXTURE_2D,sourceTex);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,backdrop);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  drawBlur(fbX,sourceTex,1/patchW,0);
  drawBlur(fbY,blurX,0,1/patchH);
  sceneDirty=false;
  info.sceneUpdates++;
  info.sceneMs=performance.now()-start;
 }
 function getTarget(){
  const centers=cached.centers;
  if(!centers.length)return {x:cached.rect.width*.1,dragging:false};
  const selected=Number.parseInt(nav.style.getPropertyValue("--selected-tab"),10);
  const index=Number.isFinite(selected)?Math.max(0,Math.min(centers.length-1,selected)):
   Math.max(0,[...nav.querySelectorAll('[role="tab"]')].findIndex(tab=>tab.getAttribute("aria-selected")==="true"));
  // Gesture code writes a numeric offset directly. Avoid synchronous DOM layout
  // and computed-style reads while dragging at 60 or 120 Hz.
  const offset=nav.__suishouDragOffset;
  const dragging=typeof offset==="number"&&Number.isFinite(offset);
  return {
   x:dragging?Math.max(centers[0],Math.min(centers[centers.length-1],centers[0]+offset)):centers[index],
   dragging
  };
 }
 function drawGlass(rect,dark,targetX){
  const start=performance.now();
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(glassProgram);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sourceTex);
  gl.uniform1i(gu.source,0);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,blurY);
  gl.uniform1i(gu.blur,1);
  gl.uniform2f(gu.size,rect.width,rect.height);
  gl.uniform2f(gu.patch,patchW/dpr,patchH/dpr);
  gl.uniform2f(gu.finger,targetX,rect.height/2);
  gl.uniform1f(gu.alpha,1.0);
  gl.uniform1f(gu.width,cached.width);
  gl.uniform1f(gu.margin,MARGIN);
  gl.uniform1f(gu.ior,IOR);
  gl.uniform1f(gu.dark,dark?1:0);
  gl.drawArrays(gl.TRIANGLES,0,3);
  info.drawMs=performance.now()-start;
 }
 function updateStats(t,dragging){
  if(!debug || !readout)return;
  if(!sampleStart)sampleStart=t;
  if(dragging)sampleFrames++;
  if(t-sampleStart>=600){
   info.fps=Math.round(sampleFrames*1000/(t-sampleStart));
   readout.textContent="Glass drag: "+info.fps+" FPS\nScene: "+info.sceneMs.toFixed(1)+" ms\nComposite: "+info.drawMs.toFixed(1)+" ms";
   sampleStart=t;sampleFrames=0;
  }
 }
 function tick(t){
  raf=requestAnimationFrame(tick);
  if(document.visibilityState==="hidden"||!nav.isConnected||nav.dataset.optics!=="webgl")return;
  try{
   if(geometryDirty||!cached)updateGeometry();
   const rect=cached.rect;
   if(!rect.width||!rect.height||rect.bottom<0||rect.top>innerHeight)return;
   resize(rect);
   const dark=document.documentElement.dataset.theme==="dark";
   if(dark!==previousDark){previousDark=dark;sceneDirty=true;}
   const target=getTarget();
   if(!Number.isFinite(lensX))lensX=target.x;
   // During touch, move the lens exactly to the finger-derived position:
   // no spring or interpolation latency. Animate only after release/click.
   if(target.dragging)lensX=target.x;
   else{
    lensX+=(target.x-lensX)*.54;
    if(Math.abs(target.x-lensX)<.12)lensX=target.x;
   }
   const changing=Math.abs(lastTarget-lensX)>.08;
   // Background capture + 2 blur passes run ~10-12Hz for animated wallpaper.
   // The refractive optical lens composites at display RAF speed, uncapped.
   // Transparency, DPR, dispersion, IOR and shader quality are unchanged.
   const decorated=!!document.getElementById("liquid-studio-canvas");
   const sceneInterval=target.dragging?115:95;
   const needScene=sceneDirty||(decorated && t-lastScene>=sceneInterval);
   if(needScene){refreshScene(rect,dark);lastScene=t;}
   const redraw=needScene||changing||lastDrag!==target.dragging;
   if(redraw){drawGlass(rect,dark,lensX);lastTarget=lensX;lastDraw=t;if(target.dragging)info.dragFrames++;}
   lastDrag=target.dragging;
   updateStats(t,target.dragging&&redraw);
  }catch(error){
   console.warn("Navigation optics stopped; retaining accessible single-lens fallback",error);
   dispose();nav.dataset.optics="fallback";canvas.remove();
  }
 }
 const onLayout=()=>{geometryDirty=true;sceneDirty=true;};
 const onTheme=()=>{sceneDirty=true;};
 const resizeObserver=typeof ResizeObserver==="function"?new ResizeObserver(onLayout):null;
 resizeObserver?.observe(nav);
 const themeObserver=new MutationObserver(onTheme);
 themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
 window.addEventListener("resize",onLayout,{passive:true});
 window.addEventListener("scroll",onLayout,{passive:true});
 window.addEventListener("orientationchange",onLayout,{passive:true});
 function dispose(){
  cancelAnimationFrame(raf);
  resizeObserver?.disconnect();themeObserver.disconnect();
  window.removeEventListener("resize",onLayout);
  window.removeEventListener("scroll",onLayout);
  window.removeEventListener("orientationchange",onLayout);
  readout?.remove();
 }
 canvas.addEventListener("webglcontextlost",event=>{
  event.preventDefault();dispose();canvas.remove();nav.dataset.optics="fallback";
 },{once:true});
 nav.dataset.optics="webgl";
 raf=requestAnimationFrame(tick);
}
function init(){
 const nav=document.querySelector(".view-tabs");
 if(!nav)return false;
 if(matchMedia("(prefers-reduced-transparency: reduce)").matches){
  nav.dataset.optics="fallback";return true;
 }
 install(nav);return true;
}
if(!init()){
 const observer=new MutationObserver(()=>{if(init())observer.disconnect();});
 observer.observe(document.getElementById("root")||document.body,{childList:true,subtree:true});
}
})();
