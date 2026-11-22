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
 try{gl=canvas.getContext("webgl2",{alpha:true,antialias:true,premultipliedAlpha:false,depth:false,stencil:false,powerPreference:"high-performance"});}catch(_){}
 if(!gl){canvas.remove();nav.dataset.optics="fallback";return;}
 function makeProgram(fragment){
  const makeShader=(type,src)=>{
   const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
   if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
   return s;
  };
  const v=makeShader(gl.VERTEX_SHADER,vertex),f=makeShader(gl.FRAGMENT_SHADER,fragment);
  const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
  gl.deleteShader(v);gl.deleteShader(f);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
  return p;
 }
 let blurProgram,glassProgram;
 try{blurProgram=makeProgram(blur);glassProgram=makeProgram(glass);}
 catch(e){console.warn("Glass refraction compilation failed",e);canvas.remove();nav.dataset.optics="fallback";return;}
 const ul=(program,name)=>gl.getUniformLocation(program,name);
 const bu={tex:ul(blurProgram,"t"),step:ul(blurProgram,"stepUV")};
 const gu={source:ul(glassProgram,"backgroundTex"),blur:ul(glassProgram,"blurredTex"),
   size:ul(glassProgram,"size"),patch:ul(glassProgram,"patchSize"),
   finger:ul(glassProgram,"finger"),alpha:ul(glassProgram,"fingerAlpha"),
   width:ul(glassProgram,"tabWidth"),margin:ul(glassProgram,"marginPx"),
   ior:ul(glassProgram,"ior"),dark:ul(glassProgram,"darkMode")};
 function texture(){
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return t;
 }
 const source=texture(),blurX=texture(),blurY=texture();
 function framebuffer(tex){
  const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);return f;
 }
 const fbX=framebuffer(blurX),fbY=framebuffer(blurY);
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 const backdrop=document.createElement("canvas"),ctx=backdrop.getContext("2d",{alpha:false});
 let dpr=1,patchW=0,patchH=0,last=0,raf=0;
 const finger={id:null,startX:0,startY:0,x:0,active:false,opacity:0};
 function pointer(e){
  if((e.type==="pointerup"||e.type==="pointercancel")&&finger.id===e.pointerId){
   finger.id=null;finger.active=false;return;
  }
  if(e.type==="pointerdown"){
   if(finger.id!==null || !["touch","pen"].includes(e.pointerType))return;
   if(e.target.closest?.(".view-tabs")!==nav)return;
   finger.id=e.pointerId;finger.active=true;
   finger.startX=e.clientX;finger.startY=e.clientY;
   finger.x=e.clientX-nav.getBoundingClientRect().left;return;
  }
  if(e.type==="pointermove"&&finger.id===e.pointerId){
   const dx=e.clientX-finger.startX,dy=e.clientY-finger.startY;
   if(Math.abs(dy)>11&&Math.abs(dy)>Math.abs(dx)){
    finger.id=null;finger.active=false;return;
   }
   finger.x=e.clientX-nav.getBoundingClientRect().left;
  }
 }
 for(const event of ["pointerdown","pointermove","pointerup","pointercancel"])
  document.addEventListener(event,pointer,true);
 function resize(rect){
  const pixelRatio=Math.min(devicePixelRatio||1,2);
  const cw=Math.max(1,Math.round(rect.width*pixelRatio));
  const ch=Math.max(1,Math.round(rect.height*pixelRatio));
  const pw=Math.max(1,Math.round((rect.width+2*MARGIN)*pixelRatio));
  const ph=Math.max(1,Math.round((rect.height+2*MARGIN)*pixelRatio));
  if(cw===canvas.width&&ch===canvas.height&&pw===patchW&&ph===patchH)return;
  dpr=pixelRatio;canvas.width=cw;canvas.height=ch;
  patchW=pw;patchH=ph;backdrop.width=pw;backdrop.height=ph;
  for(const tex of [source,blurX,blurY]){
   gl.bindTexture(gl.TEXTURE_2D,tex);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,pw,ph,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  }
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
  const decorative=document.getElementById("liquid-studio-canvas");
  if(decorative && decorative.width && decorative.height){
   try{ctx.globalAlpha=dark?.55:.66;ctx.drawImage(decorative,0,0,w,h);}catch(_){}
   ctx.globalAlpha=1;
  }
  ctx.setTransform(1,0,0,1,0,0);
 }
 function drawBlur(target,input,dx,dy){
  gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.viewport(0,0,patchW,patchH);
  gl.useProgram(blurProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);
  gl.uniform1i(bu.tex,0);gl.uniform2f(bu.step,dx,dy);gl.drawArrays(gl.TRIANGLES,0,3);
 }
 function frame(t){
  raf=requestAnimationFrame(frame);
  if(document.visibilityState==="hidden"||t-last<30||!nav.isConnected)return;
  last=t;
  try{
  const rect=nav.getBoundingClientRect();
  if(!rect.width||!rect.height||rect.bottom<0||rect.top>innerHeight)return;
  resize(rect);
  const dark=document.documentElement.dataset.theme==="dark";
  finger.opacity+=(Number(finger.active)-finger.opacity)*(finger.active?.42:.26);
  if(finger.opacity<.001)finger.opacity=0;
  drawBackdrop(rect,dark);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.bindTexture(gl.TEXTURE_2D,source);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,backdrop);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  drawBlur(fbX,source,1/patchW,0);
  drawBlur(fbY,blurX,0,1/patchH);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(glassProgram);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);
  gl.uniform1i(gu.source,0);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,blurY);
  gl.uniform1i(gu.blur,1);
  const width=Math.max(20,(rect.width-12)/5);
  const xpos=Math.max(width/2,Math.min(rect.width-width/2,finger.x));
  gl.uniform2f(gu.size,rect.width,rect.height);
  gl.uniform2f(gu.patch,patchW/dpr,patchH/dpr);
  gl.uniform2f(gu.finger,xpos,rect.height/2);
  gl.uniform1f(gu.alpha,finger.opacity);
  gl.uniform1f(gu.width,width);
  gl.uniform1f(gu.margin,MARGIN);
  gl.uniform1f(gu.ior,IOR);
  gl.uniform1f(gu.dark,dark?1:0);
  gl.drawArrays(gl.TRIANGLES,0,3);
  }catch(error){
   console.warn("Navigation refraction stopped; restoring single-surface fallback",error);
   cancelAnimationFrame(raf);nav.dataset.optics="fallback";canvas.remove();
  }
 }
 canvas.addEventListener("webglcontextlost",e=>{
  e.preventDefault();cancelAnimationFrame(raf);nav.dataset.optics="fallback";canvas.remove();
 },{once:true});
 nav.dataset.optics="webgl";
 raf=requestAnimationFrame(frame);
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
