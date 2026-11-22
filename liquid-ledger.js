/*
 * Suishou Ledger – Liquid Glass Studio-inspired renderer (MIT attribution).
 * Reference: https://github.com/iyinchao/liquid-glass-studio
 * The canvas is purely decorative: interactive DOM always remains accessible.
 */
(() => {
  "use strict";
  if (window.__suishouLiquidStudio) return;
  window.__suishouLiquidStudio = true;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const reduceTransparency = matchMedia("(prefers-reduced-transparency: reduce)");
  const springs = new Map();
  const pressed = new Map();
  let canvas = null, frame = 0, stopped = false, pointer = [0.5,0.5];

  // Damped spring: a small overshoot without hijacking React button events.
  function press(el,active,e){
    if(!el || el.disabled || reduceMotion.matches)return;
    if(e){
      const r=el.getBoundingClientRect();
      if(r.width>0&&r.height>0){
        const x=Math.min(100,Math.max(0,(e.clientX-r.left)/r.width*100));
        const y=Math.min(100,Math.max(0,(e.clientY-r.top)/r.height*100));
        el.style.setProperty("--glass-x",x.toFixed(1)+"%");
        el.style.setProperty("--glass-y",y.toFixed(1)+"%");
      }
      pointer=[e.clientX/Math.max(innerWidth,1),1-e.clientY/Math.max(innerHeight,1)];
    }
    let item=springs.get(el);
    if(!item){item={value:1,velocity:0,target:1,raf:0};springs.set(el,item);}
    item.target=active?0.942:1;
    if(item.raf)return;
    const tick=()=>{
      if(!el.isConnected || reduceMotion.matches){
        el.style.removeProperty("--liquid-scale");springs.delete(el);return;
      }
      item.velocity=(item.velocity+(item.target-item.value)*.14)*.72;
      item.value+=item.velocity;
      el.style.setProperty("--liquid-scale",item.value.toFixed(4));
      if(Math.abs(item.target-item.value)<.001&&Math.abs(item.velocity)<.001){
        el.style.removeProperty("--liquid-scale");springs.delete(el);
      }else item.raf=requestAnimationFrame(tick);
    };
    item.raf=requestAnimationFrame(tick);
  }
  document.addEventListener("pointerdown",e=>{
    const el=e.target.closest?.(".glass-button:not(:disabled)");
    if(!el || e.button!==0)return;
    pressed.set(e.pointerId,el);
    press(el,true,e);
  },{passive:true,capture:true});
  document.addEventListener("pointermove",e=>{
    const p=pressed.get(e.pointerId);
    if(p){press(p,true,e);return;}
    if(e.pointerType!=="mouse")return;
    const el=e.target.closest?.(".glass-button:not(:disabled)");
    if(!el)return;
    const r=el.getBoundingClientRect();
    if(!r.width || !r.height)return;
    el.style.setProperty("--glass-x",Math.min(100,Math.max(0,(e.clientX-r.left)/r.width*100)).toFixed(1)+"%");
    el.style.setProperty("--glass-y",Math.min(100,Math.max(0,(e.clientY-r.top)/r.height*100)).toFixed(1)+"%");
  },{passive:true});
  function release(e){
    const el=pressed.get(e.pointerId);
    if(!el)return;
    pressed.delete(e.pointerId);press(el,false,e);
  }
  document.addEventListener("pointerup",release,{passive:true,capture:true});
  document.addEventListener("pointercancel",release,{passive:true,capture:true});

  function start(){
    if(canvas || stopped || reduceMotion.matches || reduceTransparency.matches)return;
    const c=document.createElement("canvas");
    c.id="liquid-studio-canvas";
    c.setAttribute("aria-hidden","true");
    try{
      const gl=c.getContext("webgl2",{
        alpha:true,antialias:false,premultipliedAlpha:false,depth:false,stencil:false,powerPreference:"low-power"
      });
      if(!gl)return;
      // Lightweight original SDF/dispersion shader using Studio's techniques.
      // Unlike Studio's editor, this runs behind accessible React content.
      const vertex=[
        "#version 300 es",
        "precision highp float;",
        "out vec2 uv;",
        "void main(){",
        "vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));",
        "uv=p;gl_Position=vec4(p*2.-1.,0.,1.);",
        "}"
      ].join("\n");
      const fragment=[
        "#version 300 es",
        "precision highp float;",
        "in vec2 uv;",
        "uniform vec2 resolution;",
        "uniform float time;",
        "uniform float isDark;",
        "out vec4 outColor;",
        "float superellipse(vec2 p,vec2 r,float n){",
        "vec2 q=abs(p/r);",
        "return (pow(pow(q.x,n)+pow(q.y,n),1./n)-1.)*min(r.x,r.y);",
        "}",
        "float smin(float a,float b,float k){",
        "float h=max(k-abs(a-b),0.)/k;",
        "return min(a,b)-h*h*k*.25;",
        "}",
        "float field(vec2 p){",
        "vec2 a=p-vec2(-.17+sin(time*.31)*.024,.30+cos(time*.37)*.025);",
        "vec2 b=p-vec2(.19+cos(time*.23)*.023,-.205+sin(time*.27)*.026);",
        "vec2 c=p-vec2(-.04+cos(time*.19)*.018,-.09+sin(time*.22)*.018);",
        "return smin(smin(superellipse(a,vec2(.21,.18),3.7),superellipse(b,vec2(.19,.17),3.8),.045),superellipse(c,vec2(.095,.098),4.),.067);",
        "}",
        "void main(){",
        "vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.);",
        "float d=field(p);",
        "float eps=.003;",
        "vec2 grad=vec2(field(p+vec2(eps,0.))-field(p-vec2(eps,0.)),",
        "field(p+vec2(0.,eps))-field(p-vec2(0.,eps)));",
        "vec2 normal=normalize(grad+vec2(.00001));",
        "float body=1.-smoothstep(-.04,.04,d);",
        "float rim=exp(-abs(d)*82.);",
        "float edge=exp(-abs(d)*27.);",
        "vec2 light=normalize(vec2(.67+sin(time*.23)*.2,.64));",
        "float fresnel=pow(max(dot(normal,light),0.),2.);",
        "float glare=rim*fresnel;",
        "float hue=dot(p,vec2(.45,.60))+dot(normal,vec2(.10,-.075));",
        "vec3 base=mix(vec3(.68,.85,1.),vec3(1.,.78,.91),smoothstep(-.22,.39,hue));",
        "vec3 dispersion=vec3(exp(-abs(d-.006)*100.),exp(-abs(d)*112.),exp(-abs(d+.006)*96.));",
        "vec3 color=mix(base,vec3(.98,1.,1.),glare*.65)+dispersion*edge*.19;",
        "if(isDark>.5)color=mix(color,vec3(.45,.60,.84),.47);",
        "float alpha=(body*.1+edge*.14+glare*.29+rim*.08);",
        "float fade=1.-smoothstep(.19,.62,length(p));",
        "outColor=vec4(clamp(color,0.,1.),clamp(alpha*fade,0.,.46));",
        "}"
      ].join("\n");
      function compile(kind,src){
        const shader=gl.createShader(kind);
        gl.shaderSource(shader,src);
        gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
          const msg=gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error("GLSL: "+msg);
        }
        return shader;
      }
      const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
      const program=gl.createProgram();
      gl.attachShader(program,vs);gl.attachShader(program,fs);
      gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const res=gl.getUniformLocation(program,"resolution");
      const time=gl.getUniformLocation(program,"time");
      const dark=gl.getUniformLocation(program,"isDark");
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      const resize=()=>{
        const factor=Math.min(devicePixelRatio||1,1.25);
        const w=Math.max(1,Math.round(innerWidth*factor)),h=Math.max(1,Math.round(innerHeight*factor));
        if(w!==c.width||h!==c.height){c.width=w;c.height=h;gl.viewport(0,0,w,h);}
        gl.uniform2f(res,w,h);
      };
      let last=0;
      const epoch=performance.now();
      const draw=now=>{
        if(stopped || reduceMotion.matches || reduceTransparency.matches){frame=0;return;}
        frame=requestAnimationFrame(draw);
        if(document.visibilityState==="hidden" || now-last<34)return;
        last=now;resize();
        gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(time,(now-epoch)/1000);
        gl.uniform1f(dark,document.documentElement.dataset.theme==="dark"?1:0);
        gl.drawArrays(gl.TRIANGLES,0,3);
      };
      c.addEventListener("webglcontextlost",e=>{e.preventDefault();stopped=true;cancelAnimationFrame(frame);c.remove();},{once:true});
      document.body.prepend(c);canvas=c;
      window.addEventListener("resize",resize,{passive:true});
      frame=requestAnimationFrame(draw);
    }catch(error){
      console.warn("Liquid Glass Studio backdrop unavailable; CSS fallback remains",error);
      c.remove();
    }
  }
  function stop(){
    cancelAnimationFrame(frame);frame=0;
    if(canvas){canvas.remove();canvas=null;}
  }
  reduceMotion.addEventListener?.("change",()=>{
    if(reduceMotion.matches)stop();else start();
  });
  reduceTransparency.addEventListener?.("change",()=>{
    if(reduceTransparency.matches)stop();else start();
  });
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();