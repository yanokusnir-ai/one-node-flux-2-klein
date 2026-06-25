import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const LIME = "#f0ff41";
const C = {
  lime:LIME, bg0:"#0b0b0b", bg1:"#111111", bg2:"#181818",
  bg3:"#222222", border:"#2a2a2a", borderH:"#3c3c3c",
  text:"#dedede", muted:"#565656", dim:"#2e2e2e",
  warn:"#ffb347", err:"#ff6767",
};

const NODE_W = 980;
const NODE_H = Math.round(NODE_W * 9 / 16);

// ── Workflow node IDs ─────────────────────────────────────────────────────────
// Shared by both t2i_workflow.json and edit_workflow.json
const WF = {
  model:        "FK:165",   // UNETLoader
  kvCache:      "FK:KV",    // FluxKVCache — injected dynamically between model and ModelSamplingAuraFlow
  textEnc:      "FK:155",   // CLIPLoader
  vae:          "FK:153",   // VAELoader
  promptPos:    "FK:166",   // CLIPTextEncode positive
  promptNeg:    "FK:156",   // CLIPTextEncode negative
  sampling:     "FK:169",   // ModelSamplingAuraFlow — receives model input
  latent:       "FK:170",   // EmptyFlux2LatentImage (T2I) — width/height set here
  sampler:      "FK:171",   // KSampler — receives seed
  saveImage:    "FK:86",    // SaveImage
  // EDIT-only nodes
  loadImage1:   "FK:91",    // LoadImage Image 1
  loadImage2:   "FK:88",    // LoadImage Image 2
  scaleImg1:    "FK:163",   // ImageScaleToTotalPixels Image 1
  scaleImg2:    "FK:163b",  // ImageScaleToTotalPixels Image 2
  getSize:      "FK:167",   // GetImageSize (feeds width/height to EmptyFlux2LatentImage)
  vaeEnc1:      "FK:132",   // VAEEncode Image 1
  vaeEnc2:      "FK:232",   // VAEEncode Image 2
  refPos1:      "FK:133",   // ReferenceLatent positive img1
  refNeg1:      "FK:131",   // ReferenceLatent negative img1
  refPos2:      "FK:233",   // ReferenceLatent positive img2
  refNeg2:      "FK:231",   // ReferenceLatent negative img2
};

const LS_KEY = "one_node_flux_klein_state";
const DEFAULT_NEG_PROMPT = "low quality, deformed, blurry, watermark, ugly, bad anatomy, disfigured, mutated, extra limbs, poorly drawn face, bad proportions, gross proportions, jpeg artifacts, overexposed, underexposed";
const DEFAULT_FACESWAP_PROMPT = "Replace the head in image 1 with the head from image 2, adapting the facial features to match the artistic style, focus, and environmental lighting of the image 1.";

// ── Resolution presets (Flux-friendly, divisible by 16) ──────────────────────
const RES_PRESETS = [
  { label:"1024 × 1024", w:1024, h:1024 },
  { label:"1920 × 1088", w:1920, h:1088 },
  { label:"1088 × 1920", w:1088, h:1920 },
  { label:"1280 × 720",  w:1280, h:720  },
  { label:"720 × 1280",  w:720,  h:1280 },
  { label:"Custom…",     w:0,    h:0    },
];
function snapRes(v){ return Math.max(16, Math.round(v/16)*16); }

// ── DOM helpers ───────────────────────────────────────────────────────────────
const mk  = (tag,css={},props={}) => { const e=document.createElement(tag); Object.assign(e.style,css); Object.assign(e,props); return e; };
const tx  = (e,t) => { e.textContent=t; return e; };
const cap = (t)   => tx(mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",
  textTransform:"uppercase",color:C.muted,marginBottom:"5px"}),t);

// ── Notification sound ────────────────────────────────────────────────────────
function playDone(){
  try{
    const AC=window.AudioContext||/** @type {any} */(window).webkitAudioContext;
    const ctx=new AC();
    // Two soft sine tones: a gentle rising chime
    [[660,0,0.09],[990,0.1,0.07]].forEach(([freq,delay,vol])=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.connect(gain);gain.connect(ctx.destination);
      osc.type="sine";osc.frequency.value=freq;
      gain.gain.setValueAtTime(0,ctx.currentTime+delay);
      gain.gain.linearRampToValueAtTime(vol,ctx.currentTime+delay+0.03);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+delay+0.55);
      osc.start(ctx.currentTime+delay);osc.stop(ctx.currentTime+delay+0.6);
    });
  }catch(e){}
}

function fmtErr(v){
  try{
    if(!v) return "Unknown error.";
    if(typeof v === "string") return v;
    if(v.message) return String(v.message);
    if(v.error){
      if(typeof v.error === "string") return v.error;
      if(v.error.message) return String(v.error.message);
    }
    return JSON.stringify(v);
  }catch(e){ return String(v); }
}

// ── Dimmer ────────────────────────────────────────────────────────────────────
let _dim=null;
const showDimmer=()=>{ if(!_dim){_dim=mk("div",{position:"fixed",inset:"0",background:"rgba(0,0,0,.7)",zIndex:"999990",display:"none",pointerEvents:"none"});document.body.appendChild(_dim);} _dim.style.display="block"; };
const hideDimmer=()=>{ if(_dim)_dim.style.display="none"; };

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle(labelTxt,checked,onChange,activeColor){
  const onClr=activeColor||LIME;
  const onThumb=activeColor?"#fff":"#111";
  const wrap=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",
    padding:"9px 0",borderBottom:`1px solid ${C.border}`});
  const lbl=mk("span",{fontSize:"12px",color:C.text});tx(lbl,labelTxt);
  const track=mk("div",{width:"34px",height:"18px",borderRadius:"9px",
    background:checked?onClr:C.dim,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:"0"});
  const thumb=mk("div",{position:"absolute",top:"2px",left:checked?"16px":"2px",
    width:"14px",height:"14px",borderRadius:"50%",
    background:checked?onThumb:"#888",transition:"left .2s,background .2s"});
  track.appendChild(thumb);
  let val=checked;
  track.onclick=()=>{
    val=!val;track.style.background=val?onClr:C.dim;
    thumb.style.left=val?"16px":"2px";thumb.style.background=val?onThumb:"#888";onChange(val);
  };
  wrap.append(lbl,track);
  const _setChecked=(v)=>{
    val=v;track.style.background=val?onClr:C.dim;
    thumb.style.left=val?"16px":"2px";thumb.style.background=val?onThumb:"#888";
  };
  return{el:wrap,get value(){return val;},_setChecked};
}

// ── Dropdown ──────────────────────────────────────────────────────────────────
function DD(items,selected,onChange){
  let val=selected;
  const wrap=mk("div",{position:"relative",width:"100%",minWidth:"0",overflow:"hidden"});
  const trig=mk("div",{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:"7px",
    padding:"0 8px",height:"28px",display:"flex",alignItems:"center",
    justifyContent:"space-between",cursor:"pointer",boxSizing:"border-box",
    transition:"border-color .15s",userSelect:"none",overflow:"hidden"});
  const trigTxt=mk("span",{fontSize:"11px",color:C.text,overflow:"hidden",
    textOverflow:"ellipsis",whiteSpace:"nowrap",flex:"1",minWidth:"0"});
  tx(trigTxt,val); trigTxt.style.color=val?LIME:C.muted;
  const arr=mk("span",{fontSize:"8px",color:C.muted,marginLeft:"5px",flexShrink:"0",transition:"transform .18s"});
  tx(arr,"▾");
  trig.append(trigTxt,arr);
  const panel=mk("div",{display:"none",position:"fixed",background:C.bg1,
    border:`1px solid ${C.borderH}`,borderRadius:"8px",zIndex:"999999",
    flexDirection:"column",boxShadow:"0 8px 28px rgba(0,0,0,.9)",
    overflow:"hidden",minWidth:"140px",maxWidth:"400px"});
  const srch=mk("input",{background:C.bg2,border:"none",borderBottom:`1px solid ${C.border}`,
      padding:"7px 10px",color:C.text,fontSize:"11px",outline:"none",
      width:"100%",boxSizing:"border-box"},{type:"text",placeholder:"Type to filter…"});
  const list=mk("div",{overflowY:"auto",maxHeight:"200px"});
  const render=q=>{
    const _norm=(s)=>(s||"").replace(/\\/g,"/").toLowerCase();
    list.innerHTML="";
    items.filter(i=>!q||i.toLowerCase().includes(q.toLowerCase())).forEach(item=>{
      const isSel=_norm(item)===_norm(val);
      const r=mk("div",{padding:"7px 12px",fontSize:"11px",cursor:"pointer",
        color:isSel?LIME:C.text,background:isSel?C.bg2:"transparent",
        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",transition:"background .1s"});
      tx(r,item);
      r.onmouseenter=()=>r.style.background=C.bg3;
      r.onmouseleave=()=>r.style.background=_norm(item)===_norm(val)?C.bg2:"transparent";
      r.onclick=()=>{val=item;tx(trigTxt,item);trigTxt.style.color=item?LIME:C.muted;close();onChange(item);};
      list.appendChild(r);
    });
  };
  const reposition=()=>{
    const rect=trig.getBoundingClientRect();
    panel.style.left=rect.left+"px";
    panel.style.width=Math.max(rect.width,140)+"px";
    const ph=Math.min(items.length*28+44,220);
    panel.style.top=(rect.top-ph-4>8?rect.top-ph-4:rect.bottom+4)+"px";
  };
  const open=()=>{
    document.body.appendChild(panel);panel.style.display="flex";
    reposition();arr.style.transform="rotate(180deg)";
    trig.style.borderColor=LIME;showDimmer();
    srch.value="";srch.focus();render("");
  };
  const close=()=>{
    panel.style.display="none";
    if(panel.parentNode)panel.parentNode.removeChild(panel);
    arr.style.transform="";trig.style.borderColor=C.border;hideDimmer();
  };
  srch.oninput=()=>render(srch.value);
  trig.onclick=e=>{e.stopPropagation();panel.style.display==="flex"?close():open();};
  document.addEventListener("click",e=>{if(!wrap.contains(e.target)&&!panel.contains(e.target))close();});
  trig.onmouseenter=()=>{if(panel.style.display!=="flex")trig.style.background=C.bg2;};
  trig.onmouseleave=()=>{if(panel.style.display!=="flex")trig.style.background=C.bg3;};
  panel.appendChild(srch);
  panel.appendChild(list);
  wrap.appendChild(trig);
  render("");
  return{
    el:wrap,get value(){return val;},
    set(v){val=v;tx(trigTxt,v);trigTxt.style.color=v?LIME:C.muted;render("");},
    updateItems(ni){items=ni;if(!ni.some(i=>(i||"").replace(/\\/g,"/").toLowerCase()===(val||"").replace(/\\/g,"/").toLowerCase())){val=ni[0]||val;tx(trigTxt,val);trigTxt.style.color=val?LIME:C.muted;onChange(val);}render(srch.value||"");},
  };
}

// ── Pill button ───────────────────────────────────────────────────────────────
function Pill(txt,active,onClick){
  const b=mk("button",{
    background:active?LIME:C.bg2,color:active?"#111":C.text,
    border:`1px solid ${active?LIME:C.border}`,
    borderRadius:"20px",padding:"3px 9px",fontSize:"9px",
    fontWeight:active?"700":"400",cursor:"pointer",
    transition:"all .14s",outline:"none",whiteSpace:"nowrap",
  });
  tx(b,txt);
  b.onmousedown=()=>b.style.transform="scale(.95)";
  b.onmouseup=()=>b.style.transform="";
  b.onmouseleave=()=>b.style.transform="";
  b.onclick=onClick;
  return b;
}

// Parse a float that may use a comma as the decimal separator (common on EU
// locales, where parseFloat("0,5") returns 0). Returns NaN for empty/invalid.
function _pf(v){ return parseFloat(String(v).replace(",",".")); }

// ── Number input ──────────────────────────────────────────────────────────────
function NI(_label,val,min,max,_step,onChange,width="72px"){
  const wrap=mk("div",{
    width,height:"28px",background:C.bg2,border:`1px solid ${C.border}`,
    borderRadius:"6px",boxSizing:"border-box",display:"flex",alignItems:"center",
    padding:"0 7px",transition:"border-color .15s",overflow:"hidden",
  });
  const inp=mk("input",{
    flex:"1 1 0",minWidth:"0",background:"transparent",border:"none",outline:"none",
    color:C.text,fontSize:"11px",padding:"0",textAlign:"left",
  },{type:"number",min:String(min),max:String(max),value:String(val)});
  inp.oninput=()=>{ const v=Math.max(min,Math.min(max,_pf(inp.value)||min)); onChange(v); };
  inp.onfocus=()=>{ inp.select(); wrap.style.borderColor=LIME; };
  inp.onblur=()=>{ inp.value=String(Math.max(min,Math.min(max,_pf(inp.value)||min))); wrap.style.borderColor=C.border; };
  inp.addEventListener("keydown",e=>{
    if(e.key==="Enter"){ inp.blur(); return; }
    if(e.key==="ArrowUp"||e.key==="ArrowDown"){
      e.preventDefault();
      const step=wrap._arrowStep||8;
      const cur=Math.max(min,Math.min(max,_pf(inp.value)||min));
      const next=e.key==="ArrowUp"
        ? Math.min(max, Math.round((cur+step)/step)*step)
        : Math.max(min, Math.round((cur-step)/step)*step);
      inp.value=String(next); onChange(next);
    }
  });
  inp.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
  wrap.appendChild(inp);
  wrap.onclick=()=>inp.focus();
  wrap._inp=inp;
  wrap.setVal=(v)=>{inp.value=String(v);};
  Object.defineProperty(wrap,"numVal",{get(){return _pf(inp.value)||min;}});
  return wrap;
}

// ── Remove button ─────────────────────────────────────────────────────────────
function mkRmBtn(){
  const b=mk("button",{
    position:"absolute",top:"4px",right:"4px",width:"18px",height:"18px",
    borderRadius:"50%",background:"rgba(0,0,0,.85)",border:`1px solid ${C.border}`,
    color:"rgba(255,255,255,.7)",fontSize:"9px",cursor:"pointer",display:"none",
    alignItems:"center",justifyContent:"center",padding:"0",
    transition:"background .15s, color .15s, border-color .15s",lineHeight:"1",zIndex:"2",
  });
  tx(b,"✕");
  b.onmouseenter=()=>{ b.style.borderColor=LIME; b.style.color=LIME; };
  b.onmouseleave=()=>{ b.style.borderColor=C.border; b.style.color="rgba(255,255,255,.7)"; };
  return b;
}

// ── Global node-local fullscreen overlay factory (set per node instance) ─────
let _fkActiveFsFactory=null;

// ── Image upload slot ─────────────────────────────────────────────────────────
// Returns {el, name, hasFile(), setDimsLabel(w,h), _restorePreview(name)}
function ImgSlot(optional, onFile, onDims){
  const wrap=mk("div",{
    width:"88px",height:"88px",borderRadius:"12px",
    border:`1.5px dashed ${C.border}`,background:C.bg2,
    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
    cursor:"pointer",position:"relative",
    transition:"border-color .18s, background .18s",
    overflow:"hidden",flexShrink:"0",boxSizing:"border-box",
  });

  // Empty state
  const icoWrap=mk("div",{
    position:"absolute",inset:"0",
    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
    gap:"5px",pointerEvents:"none",
  });
  const ico=document.createElementNS("http://www.w3.org/2000/svg","svg");
  ico.setAttribute("viewBox","0 0 24 24");
  ico.setAttribute("width","24");ico.setAttribute("height","24");
  ico.setAttribute("fill","none");ico.setAttribute("stroke","currentColor");
  ico.setAttribute("stroke-width","1.4");ico.setAttribute("stroke-linecap","round");
  ico.setAttribute("stroke-linejoin","round");
  ico.style.color=C.muted;ico.style.transition="color .18s";ico.style.pointerEvents="none";
  ico.innerHTML=`<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`;
  const lbl=mk("div",{fontSize:"8px",color:C.muted,pointerEvents:"none",letterSpacing:".04em",fontWeight:"600",transition:"color .18s"});
  tx(lbl,"Add image");
  if(optional){
    const optPill=mk("div",{fontSize:"6px",color:C.muted,letterSpacing:".06em",fontWeight:"700",
      border:`1px solid ${C.border}`,borderRadius:"20px",padding:"1px 5px",pointerEvents:"none",
      textTransform:"uppercase",background:"transparent",lineHeight:"1.7"});
    tx(optPill,"Optional");icoWrap.append(ico,lbl,optPill);icoWrap._optPill=optPill;
  } else { icoWrap.append(ico,lbl); }

  // Preview image
  const prevEl=mk("img",{
    position:"absolute",inset:"0",width:"100%",height:"100%",
    objectFit:"cover",display:"none",borderRadius:"11px",
  });

  // Remove button (top-right)
  const rm=mkRmBtn();

  // Fullscreen button (top-right next to rm, circular, hidden until file loaded)
  const fsBtn=mk("button",{
    position:"absolute",top:"4px",right:"26px",width:"18px",height:"18px",
    borderRadius:"50%",background:"rgba(0,0,0,.85)",border:`1px solid ${C.border}`,
    color:"rgba(255,255,255,.7)",cursor:"pointer",display:"none",
    alignItems:"center",justifyContent:"center",padding:"0",
    transition:"border-color .15s, color .15s",lineHeight:"1",zIndex:"2",
  });
  fsBtn.innerHTML=`<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
  fsBtn.onmouseenter=()=>{ fsBtn.style.borderColor=LIME; fsBtn.style.color=LIME; };
  fsBtn.onmouseleave=()=>{ fsBtn.style.borderColor=C.border; fsBtn.style.color="rgba(255,255,255,.7)"; };

  const inp=mk("input",{display:"none"},{type:"file",accept:"image/*"});
  wrap.append(icoWrap,prevEl,fsBtn,rm,inp);

  wrap.onmouseenter=()=>{
    if(prevEl.style.display==="none"){ wrap.style.borderColor=LIME;wrap.style.background=C.bg1;ico.style.color=LIME;lbl.style.color=LIME;if(icoWrap._optPill){icoWrap._optPill.style.color=LIME;icoWrap._optPill.style.borderColor=LIME;} }
    else { wrap.style.borderColor=LIME; }
  };
  wrap.onmouseleave=()=>{ wrap.style.borderColor=C.border;wrap.style.background=C.bg2;ico.style.color=C.muted;lbl.style.color=C.muted;if(icoWrap._optPill){icoWrap._optPill.style.color=C.muted;icoWrap._optPill.style.borderColor=C.border;} };
  wrap.onclick=()=>inp.click();

  let _dragDepth=0;
  wrap.addEventListener("dragenter",e=>{e.preventDefault();e.stopPropagation();_dragDepth++;wrap.style.borderColor=LIME;wrap.style.background=C.bg1;});
  wrap.addEventListener("dragover",e=>{e.preventDefault();e.stopPropagation();});
  wrap.addEventListener("dragleave",()=>{ _dragDepth--;if(_dragDepth<=0){_dragDepth=0;wrap.style.borderColor=C.border;wrap.style.background=C.bg2;} });
  wrap.addEventListener("drop",e=>{
    e.preventDefault();e.stopPropagation();
    _dragDepth=0;wrap.style.borderColor=C.border;wrap.style.background=C.bg2;
    const f=e.dataTransfer.files[0];if(f&&f.type.startsWith("image/"))_load(f);
  });

  let _currentName=null;
  let _fsSrc="", _fsFileName="";

  const _showLoaded=(src,fname)=>{
    prevEl.src=src;prevEl.style.display="block";
    icoWrap.style.display="none";rm.style.display="flex";fsBtn.style.display="flex";
    wrap.style.borderColor=LIME;
    _fsSrc=src;_fsFileName=fname;
    // Read natural dims once image loads
    const _tmpImg=new Image();
    _tmpImg.onload=()=>{ if(onDims) onDims(_tmpImg.naturalWidth,_tmpImg.naturalHeight); };
    _tmpImg.src=src;
  };

  fsBtn.onclick=e=>{
    e.stopPropagation();
    const factory=_fkActiveFsFactory;
    if(factory) factory()._open("image",_fsSrc,_fsFileName);
  };

  const _load=async(file)=>{
    const objUrl=URL.createObjectURL(file);
    _showLoaded(objUrl,file.name);
    // Use ComfyUI image upload endpoint
    const fd=new FormData();fd.append("image",file);fd.append("overwrite","true");
    try{
      const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
      const d=await r.json();_currentName=d.name||file.name;
      onFile(_currentName);
    }catch(err){console.warn("[FluxKlein] upload:",err);_currentName=file.name;onFile(_currentName);}
  };

  inp.onchange=()=>{if(inp.files[0])_load(inp.files[0]);};

  rm.onclick=e=>{
    e.stopPropagation();
    prevEl.src="";prevEl.style.display="none";
    rm.style.display="none";fsBtn.style.display="none";icoWrap.style.display="flex";
    wrap.style.borderColor=C.border;
    inp.value="";_currentName=null;onFile(null);
    if(onDims) onDims(0,0);
  };

  // Restore a previously-uploaded input image by name (state restore or programmatic set).
  // Calls onFile so hasFile() returns true and size controls update correctly.
  // Safe to call only after all dependents (resDD, updateSizeControls) are initialized.
  const _restorePreview=(name)=>{
    if(!name){ rm.onclick({stopPropagation:()=>{}}); return; }
    const src=api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&subfolder=`);
    _currentName=name;
    _showLoaded(src,name);
    // onFile intentionally NOT called here — callers set S.imageXName directly and call
    // updateSizeControls/persist themselves to avoid initialization-order issues.
  };

  // Restore from a fully-formed URL (e.g. output images from gallery)
  // storedName is what gets written to S.image1Name — it must be usable with /upload/image later
  const _restorePreviewUrl=(url,displayName,storedName)=>{
    _currentName=storedName||displayName||url;
    _showLoaded(url,displayName||url);
  };

  return {
    el:wrap,
    get name(){return _currentName;},
    hasFile(){return !!_currentName;},
    _restorePreview,
    _restorePreviewUrl,
    loadFile:_load,
  };
}

// ── State helpers ─────────────────────────────────────────────────────────────
function loadState(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY)||"{}"); }catch(e){return{};}
}
function saveState(s){
  try{ localStorage.setItem(LS_KEY,JSON.stringify(s)); }catch(e){}
}

// ── Active refs for event handlers ────────────────────────────────────────────
let _activeS=null, _activeShowFinal=null, _activeResetBtn=null, _activeShowError=null, _activePromptIdRef=null, _activeShowPreview=null;

// ── API events ────────────────────────────────────────────────────────────────
(()=>{
  api.addEventListener("progress",(evt)=>{
    const {node,value,max}=evt.detail||{};
    if(!_activeS?.generating||!node) return;
    const pct=max>0?Math.round(value/max*100):0;
    if(_activeSetStage) _activeSetStage("Generating…",`Step ${value}/${max}`,pct);
  });

  api.addEventListener("execution_success",async()=>{
    if(!_activeS?.generating) return;
    try{
      const r=await api.fetchApi(`/flux_klein/gallery?offset=0&limit=20&subfolder=one-node-flux-2-klein`);
      const d=await r.json();
      const prev=_activeS?._preRunFiles||new Set();
      const v=(d.images||d.videos||[]).find(v=>!prev.has(v.key||((v.subfolder?`${v.subfolder}/`:"")+v.filename)))||(d.images||d.videos||[])[0];
      if(v){
        const cb=Date.now();
        const url=api.apiURL(`/view?filename=${encodeURIComponent(v.filename)}&type=output&subfolder=${encodeURIComponent(v.subfolder||"")}&t=${cb}`);
        _activeShowFinal?.(url,v.filename,v.subfolder||"");
      }else{
        _activeResetBtn?.();
      }
    }catch(e){
      console.error("[FluxKlein] execution_success:",e);
      _activeResetBtn?.();
    }
  });

  api.addEventListener("execution_error",evt=>{
    const errorPromptId=evt.detail?.prompt_id;
    if(errorPromptId && _activePromptIdRef && errorPromptId!==_activePromptIdRef()) return;
    const msg=fmtErr(evt.detail?.exception_message||evt.detail?.error||evt.detail||"Execution failed.");
    _activeShowError?.(msg);
    _activeResetBtn?.();
  });

  api.addEventListener("b_preview",evt=>{
    if(!_activeS?.generating) return;
    const blob=evt.detail;
    if(!blob) return;
    const url=URL.createObjectURL(blob);
    _activeShowPreview?.(url);
  });
})();

let _activeSetStage=null;

// ─────────────────────────────────────────────────────────────────────────────
app.registerExtension({
  name:"FluxKleinPlayground.v1",
  async beforeRegisterNodeDef(nodeType,nodeData){
    if(nodeData.name!=="FluxKleinOneNode") return;


    nodeType.prototype.onNodeCreated=function(){
      this.color=C.bg0;this.bgcolor=C.bg0;this.resizable=false;
      this.outputs=[];
      if(this.widgets)this.widgets=[];

      if(!window.__fluxklein_nodes) window.__fluxklein_nodes={};
      const nodeId=this.id;
      const cached=window.__fluxklein_nodes[nodeId];
      if(cached){
        _activeS=cached.S;
        _activeShowFinal=cached.fns.showFinal;
        _activeShowPreview=cached.fns.showPreview;
        _activeResetBtn=cached.fns.resetBtn;
        _activeShowError=cached.fns.showError;
        _activeSetStage=cached.fns.setStage;
        _activePromptIdRef=cached.fns.getPromptId;
        this.addDOMWidget("fk_ui","div",cached.root,{
          getValue(){return null;},setValue(){},serialize:false,
          computeSize(){const slotH=(LiteGraph.NODE_SLOT_HEIGHT||20);const n=(self.inputs||[]).length;return[NODE_W,NODE_H+n*slotH];},
        });
        this.setSize([NODE_W,NODE_H]);
        requestAnimationFrame(()=>{
          let el=cached.root;
          for(let i=0;i<6;i++){ el=el?.parentElement; if(!el)break; el.querySelectorAll("[class*='bg-node-component-surface']").forEach(b=>b.style.display="none"); }
        });
        return;
      }
      this._buildUI();
    };

    nodeType.prototype.onResize=function(){
      const slotH=(LiteGraph.NODE_SLOT_HEIGHT||20);
      const n=(this.inputs||[]).length;
      this.size=[NODE_W,NODE_H+n*slotH];
    };
    nodeType.prototype.onDrawConnections=function(){};
    nodeType.prototype.getSlotMenuOptions=function(){return[];};


    nodeType.prototype._buildUI=function(){
      const self=this;
      const saved=loadState();

      if(!self._fk_S){
        self._fk_S={
          // Settings
          modelVariant: saved.modelVariant||"9b",      // "9b" | "9b-kv"
          model:        saved.model||"",
          textEncoder:  saved.textEncoder||"",
          vae:          saved.vae||"",
          // Pill mode
          pill:         saved.pill||"t2i",              // "t2i" | "edit" | "inpaint" | "faceswap"
          // Resolution
          resLabel:     saved.resLabel||RES_PRESETS[0].label,
          resW:         saved.resW||1024,
          resH:         saved.resH||1024,
          isCustomRes:  saved.isCustomRes||false,
          customW:      saved.customW||1024,
          customH:      saved.customH||1024,
          useSizeFromImage1: saved.useSizeFromImage1||false,
          // Seed
          randomizeSeed: saved.randomizeSeed!==undefined?saved.randomizeSeed:true,
          seed:          saved.seed||0,
          i2iImage:      saved.i2iImage||null,
          i2iDenoise:    saved.i2iDenoise!==undefined?saved.i2iDenoise:0.75,
          i2iResizeLonger: saved.i2iResizeLonger||0,
          promptI2i:     saved.promptI2i||"",
          advancedUI:    saved.advancedUI||false,
          steps:         saved.steps||4,
          cfg:           saved.cfg!==undefined?saved.cfg:1,
          sampler:       saved.sampler||"er_sde",
          scheduler:     saved.scheduler||"simple",
          denoise:       saved.denoise!==undefined?saved.denoise:1,
          // Images
          image1Name:   saved.image1Name||null,
          image2Name:   saved.image2Name||null,
          fsTarget:     saved.fsTarget||null,   // faceswap: image to swap face IN
          fsSource:     saved.fsSource||null,   // faceswap: image whose face to use
          fsLora:       saved.fsLora||"",       // faceswap: LoRA filename
          fsResizeLonger: saved.fsResizeLonger||0, // 0 = disabled, >0 = resize longer side to this px
          bgRemovalModel: saved.bgRemovalModel||"",  // birefnet model for remove bg
          // Prompt — shared (active pill's value) + per-pill storage
          prompt:       saved.prompt||"",
          promptT2i:    saved.promptT2i!==undefined?saved.promptT2i:((!saved.pill||saved.pill==="t2i")?saved.prompt||"":""),
          promptEdit:   saved.promptEdit!==undefined?saved.promptEdit:(saved.pill==="edit"?saved.prompt||"":""),
          promptPaint:  saved.promptPaint!==undefined?saved.promptPaint:(saved.pill==="inpaint"?saved.prompt||"":""),
          promptFs:     saved.promptFs!==undefined?saved.promptFs:(saved.pill==="faceswap"?saved.prompt||"":""),
          // LoRAs
          userLoras:    saved.userLoras||[{name:"",strength:1.0},{name:"",strength:1.0},{name:"",strength:1.0}],
          // Generation state
          generating:   false,
          _pendingMeta: null,
          _preRunFiles: new Set(),
          soundEnabled: saved.soundEnabled!==undefined?saved.soundEnabled:true,
          extLoaders:   saved.extLoaders||false,
          // Downscale reference images (EDIT + I2I input slots) before VAE encode.
          // Default ON at 1 MP = the existing behaviour, so existing users see no change.
          downscaleRef:   saved.downscaleRef!==undefined?saved.downscaleRef:true,
          downscaleRefMP: saved.downscaleRefMP!==undefined?saved.downscaleRefMP:1.0,
          // UI layout: "classic" = wide prompt under the preview (default),
          // "tall" = prompt in the left column so the preview gets full height.
          layoutMode:   saved.layoutMode||"classic",
          // Outpaint seam feather (px the mask fades into the original). 0 = auto
          // (the previous min(48, edge/6) heuristic), so existing users see no change.
          opFeather:    saved.opFeather!==undefined?saved.opFeather:0,
          previewUrl:   null,
        };
      }
      const S=self._fk_S;
      // Sync S.prompt to the active pill's slot on init (covers first load before _pillPromptKey is available)
      {
        const _initKey=S.pill==="edit"?"promptEdit":S.pill==="inpaint"?"promptPaint":S.pill==="faceswap"?"promptFs":S.pill==="i2i"?"promptI2i":"promptT2i";
        S.prompt=S[_initKey]||S.prompt||"";
        S[_initKey]=S.prompt;
      }
      let soundEnabled=S.soundEnabled;

      const persist=()=>{
        S.soundEnabled=soundEnabled;
        saveState({
          modelVariant:S.modelVariant, model:S.model,
          textEncoder:S.textEncoder, vae:S.vae,
          pill:S.pill,
          resLabel:S.resLabel, resW:S.resW, resH:S.resH,
          isCustomRes:S.isCustomRes, customW:S.customW, customH:S.customH,
          useSizeFromImage1:S.useSizeFromImage1,
          randomizeSeed:S.randomizeSeed, seed:S.seed,
          advancedUI:S.advancedUI, steps:S.steps, cfg:S.cfg, sampler:S.sampler, scheduler:S.scheduler, denoise:S.denoise,
          image1Name:S.image1Name, image2Name:S.image2Name,
          fsTarget:S.fsTarget, fsSource:S.fsSource, fsLora:S.fsLora, fsResizeLonger:S.fsResizeLonger, bgRemovalModel:S.bgRemovalModel,
          prompt:S.prompt, promptT2i:S.promptT2i, promptEdit:S.promptEdit,
          promptPaint:S.promptPaint, promptFs:S.promptFs, promptI2i:S.promptI2i,
          i2iImage:S.i2iImage, i2iDenoise:S.i2iDenoise, i2iResizeLonger:S.i2iResizeLonger,
          userLoras:S.userLoras, soundEnabled, extLoaders:S.extLoaders,
          downscaleRef:S.downscaleRef, downscaleRefMP:S.downscaleRefMP,
          layoutMode:S.layoutMode, opFeather:S.opFeather,
        });
      };

      // getW/getH: 0 = "use image size via GetImageSize node", otherwise explicit pixels
      const getW=()=>{
        if(activePill==="edit"&&_useSizeSource) return 0;
        return S.isCustomRes?snapRes(S.customW):S.resW;
      };
      const getH=()=>{
        if(activePill==="edit"&&_useSizeSource) return 0;
        return S.isCustomRes?snapRes(S.customH):S.resH;
      };
      // Returns actual pixel dims for metadata (reads from dims badge when using image size)
      const _slotNaturalDims=(slotKey)=>{
        // Read naturalWidth/Height from the preview img element inside the slot as fallback
        const slot=slotKey==="img1"?img1Slot:img2Slot;
        if(!slot) return {w:0,h:0};
        const imgEl=slot.el&&slot.el.querySelector("img");
        return imgEl?{w:imgEl.naturalWidth||0,h:imgEl.naturalHeight||0}:{w:0,h:0};
      };
      const getEffectiveW=()=>{
        if(activePill==="inpaint"&&_paintMode==="sketch") return _sketchCanvasW||S.resW;
        if(activePill==="inpaint"&&_paintMode==="inpaint"){
          if(_paintUseDimsFromImg&&_paintDimsW) return _paintDimsW;
          const res=RES_PRESETS.find(r=>r.label===(_paintResDD?.value));
          return res&&res.w>0?res.w:snapRes(_paintWInp?.numVal||S.customW||1024);
        }
        if(activePill==="edit"&&_useSizeSource){
          const lbl=_useSizeSource==="img1"?dims1Lbl:dims2Lbl;
          if(lbl._w) return lbl._w;
          return _slotNaturalDims(_useSizeSource).w||S.resW;
        }
        if(activePill==="i2i"){
          try{
            const d=_i2iDims._getDims();
            if(d.w&&d.h&&!_i2iUseOrigSize&&S.i2iResizeLonger>0){
              return Math.round(d.w*(S.i2iResizeLonger/Math.max(d.w,d.h))/16)*16;
            }
            return d.w||0;
          }catch(ex){}
          return S.resW;
        }
        if(activePill==="faceswap"){
          try{
            const d=_fsTargetDims._getDims();
            if(d.w&&d.h&&!_fsUseOrigSize&&S.fsResizeLonger>0){
              return Math.round(d.w*(S.fsResizeLonger/Math.max(d.w,d.h))/16)*16;
            }
            return d.w||0;
          }catch(ex){}
          return S.resW;
        }
        return S.isCustomRes?snapRes(S.customW):S.resW;
      };
      const getEffectiveH=()=>{
        if(activePill==="inpaint"&&_paintMode==="sketch") return _sketchCanvasH||S.resH;
        if(activePill==="inpaint"&&_paintMode==="inpaint"){
          if(_paintUseDimsFromImg&&_paintDimsH) return _paintDimsH;
          const res=RES_PRESETS.find(r=>r.label===(_paintResDD?.value));
          return res&&res.h>0?res.h:snapRes(_paintHInp?.numVal||S.customH||1024);
        }
        if(activePill==="edit"&&_useSizeSource){
          const lbl=_useSizeSource==="img1"?dims1Lbl:dims2Lbl;
          if(lbl._h) return lbl._h;
          return _slotNaturalDims(_useSizeSource).h||S.resH;
        }
        if(activePill==="i2i"){
          try{
            const d=_i2iDims._getDims();
            if(d.w&&d.h&&!_i2iUseOrigSize&&S.i2iResizeLonger>0){
              return Math.round(d.h*(S.i2iResizeLonger/Math.max(d.w,d.h))/16)*16;
            }
            return d.h||0;
          }catch(ex){}
          return S.resH;
        }
        if(activePill==="faceswap"){
          try{
            const d=_fsTargetDims._getDims();
            if(d.w&&d.h&&!_fsUseOrigSize&&S.fsResizeLonger>0){
              return Math.round(d.h*(S.fsResizeLonger/Math.max(d.w,d.h))/16)*16;
            }
            return d.h||0;
          }catch(ex){}
          return S.resH;
        }
        return S.isCustomRes?snapRes(S.customH):S.resH;
      };

      // ── ROOT ────────────────────────────────────────────────────────────────
      if(!document.getElementById("fk-styles")){
        const styleEl=document.createElement("style");
        styleEl.id="fk-styles";
        styleEl.textContent=`
          @keyframes fk-gradient {
            0%   { background-position: 0% 50%; }
            50%  { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          @keyframes fk-error-pulse {
            0%   { box-shadow: inset 0 0 0 1px rgba(255,103,103,.24), 0 0 0 0 rgba(255,103,103,.10); }
            50%  { box-shadow: inset 0 0 0 1px rgba(255,103,103,.46), 0 0 0 6px rgba(255,103,103,0); }
            100% { box-shadow: inset 0 0 0 1px rgba(255,103,103,.24), 0 0 0 0 rgba(255,103,103,0); }
          }
          @keyframes fk-light-sweep {
            0%   { left: -80%; opacity: 0; }
            15%  { opacity: 1; }
            85%  { opacity: 1; }
            100% { left: 120%; opacity: 0; }
          }
          @keyframes fk-heart-shake {
            0%  { transform: scale(1); }
            30% { transform: scale(1.22); }
            55% { transform: scale(0.95); }
            75% { transform: scale(1.1); }
            100%{ transform: scale(1); }
          }
          .fk-heart-anim { animation: fk-heart-shake .6s ease; }
          @keyframes fk-manage-flash {
            0%   { background: linear-gradient(135deg,rgba(26,20,60,0) 0%,rgba(15,52,96,0) 50%,rgba(83,52,131,0) 100%); }
            25%  { background: linear-gradient(135deg,rgba(26,20,60,.7) 0%,rgba(15,52,96,.5) 50%,rgba(83,52,131,.6) 100%); }
            60%  { background: linear-gradient(135deg,rgba(26,20,60,.5) 0%,rgba(15,52,96,.35) 50%,rgba(83,52,131,.45) 100%); }
            100% { background: linear-gradient(135deg,rgba(26,20,60,.35) 0%,rgba(15,52,96,.2) 50%,rgba(83,52,131,.3) 100%); }
          }
          .fk-manage-on { background: linear-gradient(135deg,rgba(26,20,60,.35) 0%,rgba(15,52,96,.2) 50%,rgba(83,52,131,.3) 100%) !important; }
          .fk-manage-flash { animation: fk-manage-flash .5s ease forwards; }
          input[type=number]::-webkit-inner-spin-button,
          input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
          input[type=number] { -moz-appearance:textfield; }
          /* Nodes 2.0: hide the auto-injected node-type label rendered below the DOM widget */
          .fk-root ~ .node_title, .fk-root + .node_title { display:none !important; }
        `;
        document.head.appendChild(styleEl);
      }

      const root=mk("div",{width:"100%",background:C.bg0,boxSizing:"border-box",
        fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        color:C.text,overflow:"hidden",position:"relative"});
      root.classList.add("fk-root");


      // Nodes 2.0 compatibility: inherit border-radius from the DOM widget wrapper so overlays
      // clip correctly. The wrapper gets its radius from the litegraph node shape.
      const _syncNodeRadius=()=>{
        const wrapper=root.parentElement;
        if(!wrapper) return;
        const r=getComputedStyle(wrapper).borderRadius;
        // Only apply if non-zero and different from current
        const effective=(r&&r!=="0px")?r:"0px";
        root.style.borderRadius=effective;
      };
      // Sync once after mount and observe changes (theme switches, etc.)
      requestAnimationFrame(()=>{
        _syncNodeRadius();
        if(typeof ResizeObserver!=="undefined"){
          new ResizeObserver(_syncNodeRadius).observe(root.parentElement||root);
        }
      });

      const titleH=(typeof LiteGraph!=="undefined"&&LiteGraph.NODE_TITLE_HEIGHT)||30;
      const _uiH=NODE_H-titleH-4;
      const scrollEl=mk("div",{
        width:"100%",height:_uiH+"px",
        overflowY:"hidden",overflowX:"hidden",boxSizing:"border-box",
      });
      const _fwdCv=document.querySelector("canvas.litegraph");
      scrollEl.addEventListener("wheel",e=>{
        // Always forward wheel to canvas for zoom — node content doesn't scroll
        if(_fwdCv) _fwdCv.dispatchEvent(new WheelEvent("wheel",{deltaY:e.deltaY,deltaX:e.deltaX,
          clientX:e.clientX,clientY:e.clientY,ctrlKey:e.ctrlKey,metaKey:e.metaKey,
          bubbles:true,cancelable:true}));
        e.preventDefault();
      },{passive:false});

      const pad=mk("div",{padding:"12px",display:"flex",flexDirection:"column",
        gap:"10px",boxSizing:"border-box",width:"100%",
        height:_uiH+"px"});

      // ── SETTINGS OVERLAY ──────────────────────────────────────────────────
      const settingsOverlay=mk("div",{
        position:"absolute",inset:"0",background:"#0a0a0a",
        display:"none",flexDirection:"column",padding:"16px",
        boxSizing:"border-box",zIndex:"50",borderRadius:"8px",
        overflowY:"auto",
        opacity:"0",transition:"opacity .22s ease, transform .22s ease",
        transform:"translateY(6px)",
      });

      const settHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",
        marginBottom:"16px",flexShrink:"0"});
      const settTitle=mk("div",{fontSize:"13px",fontWeight:"700",letterSpacing:".06em",
        textTransform:"uppercase",color:C.text});tx(settTitle,"Settings");
      const settClose=mk("button",{background:"transparent",border:`1px solid #e05555`,
        borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:"#e05555",
        cursor:"pointer",outline:"none",transition:"opacity .15s"});
      tx(settClose,"✕  Close");
      settClose.onmouseenter=()=>settClose.style.opacity=".7";
      settClose.onmouseleave=()=>settClose.style.opacity="1";
      const settRefresh=mk("button",{background:"transparent",border:`1px solid ${C.border}`,
        borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:C.muted,
        cursor:"pointer",outline:"none",transition:"opacity .15s",marginRight:"8px"});
      tx(settRefresh,"↻  Refresh models");
      settRefresh.onmouseenter=()=>settRefresh.style.opacity=".7";
      settRefresh.onmouseleave=()=>settRefresh.style.opacity="1";
      settRefresh.onclick=()=>{ tx(settRefresh,"↻  Refreshing…"); _loadModels().then(()=>tx(settRefresh,"↻  Refresh models")); };
      const settBtnRow=mk("div",{display:"flex",alignItems:"center",gap:"0"});
      settBtnRow.append(settRefresh,settClose);
      settHdr.append(settTitle,settBtnRow);


      // ── Model dropdowns ───────────────────────────────────────────────────
      const mkPathLabel=(txt)=>mk("div",{fontSize:"10px",color:C.muted,marginTop:"-2px",marginBottom:"5px",lineHeight:"1.3",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},{textContent:txt});
      const mkModDD=(capTxt,pathTxt,defVal,onCh,autoKeyword=null)=>{
        const wrap=mk("div",{minWidth:"0",overflow:"hidden"});
        wrap.appendChild(cap(capTxt));
        wrap.appendChild(mkPathLabel(pathTxt));
        const row=mk("div",{display:"flex",gap:"4px",alignItems:"center",minWidth:"0",overflow:"hidden"});
        const dd=DD([defVal||"—"],[defVal||"—"][0],v=>{onCh(v);persist();});
        dd.el.style.flex="1";dd.el.style.minWidth="0";
        dd._items=[defVal||""];
        const origUpdate=dd.updateItems.bind(dd);
        dd.updateItems=ni=>{
          dd._items=ni;
          const _norm=(s)=>(s||"").replace(/\\/g,"/").toLowerCase();
          const currentVal=dd.value||"";
          // If the current value exists in the new list, keep it — don't auto-select by keyword
          const existsInList=ni.some(i=>_norm(i)===_norm(currentVal));
          if(existsInList){
            origUpdate(ni); // keeps current selection
          } else {
            // Current value not in list — try keyword auto-select, else first item
            origUpdate(ni);
            if(autoKeyword&&ni.length){
              const kws=autoKeyword.split(',').map(k=>k.trim().toLowerCase());
              const best=ni.find(f=>kws.every(k=>f.toLowerCase().includes(k)));
              if(best){dd.set(best);onCh(best);persist();}
            }
          }
        };
        row.append(dd.el);
        wrap.appendChild(row);
        return{wrap,dd};
      };

      // Row 1: Model / Text Encoder / VAE
      const modGrid=mk("div",{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"4px"});
      const modelF  =mkModDD("Model",         "/models/diffusion_models", S.model,       v=>{S.model=v;if(typeof _kvUpdateNote==="function")_kvUpdateNote();},"klein");
      const teF     =mkModDD("Text Encoder",  "/models/text_encoders",   S.textEncoder, v=>S.textEncoder=v, "qwen");
      const vaeF    =mkModDD("VAE",           "/models/vae",             S.vae,         v=>S.vae=v,         "flux2");
      modGrid.append(modelF.wrap,teF.wrap,vaeF.wrap);
      // KV info note — shown below Model dropdown when selected model name contains "kv"
      const _isBaseModel=()=>(S.model||"").toLowerCase().includes("base");

      const _kvNote=mk("div",{fontSize:"9px",color:"#f0a040",marginTop:"0px",marginBottom:"4px",display:"none"});
      tx(_kvNote,"⚙ KV model version detected. Settings adjusted for KV model.");

      const _baseNote=mk("div",{fontSize:"9px",color:"#f0a040",marginTop:"0px",marginBottom:"8px",display:"none"});
      tx(_baseNote,"⚙ Base model detected. Settings adjusted for base model.");

      let _advControlsReady=false;
      const _kvUpdateNote=()=>{
        const name=(S.model||"").toLowerCase();
        _kvNote.style.display=name.includes("kv")?"block":"none";
        const isBase=name.includes("base");
        _baseNote.style.display=isBase?"block":"none";
        // Sync advanced control defaults when base model selected
        if(!_advControlsReady) return;
        if(isBase){
          if(S.steps===4||S.steps===20){ S.steps=20; stepsInp.setVal(20); }
          if(S.cfg===1||S.cfg===5){ S.cfg=5; cfgInp.setVal(5); }
        } else {
          if(S.steps===20){ S.steps=4; stepsInp.setVal(4); }
          if(S.cfg===5){ S.cfg=1; cfgInp.setVal(1); }
        }
      };
      _kvUpdateNote();

      // ── Trigger words system ───────────────────────────────────────────────
      // Custom trigger words stored in config.json under key "lora_triggers_custom"
      // key = lora basename (no path), value = user-saved trigger string
      if(!window.__fkCustomTriggers) window.__fkCustomTriggers=null; // null = not loaded yet

      const _loadCustomTriggers=async()=>{
        if(window.__fkCustomTriggers!==null) return window.__fkCustomTriggers;
        try{
          const r=await api.fetchApi("/flux_klein/config");
          const d=await r.json();
          window.__fkCustomTriggers=d.lora_triggers_custom||{};
        }catch(e){ window.__fkCustomTriggers={}; }
        return window.__fkCustomTriggers;
      };

      const _saveCustomTrigger=async(loraName,triggerText)=>{
        const base=loraName.split(/[\\/]/).pop();
        if(!window.__fkCustomTriggers) window.__fkCustomTriggers={};
        if(triggerText.trim()) window.__fkCustomTriggers[base]=triggerText.trim();
        else delete window.__fkCustomTriggers[base];
        try{
          await api.fetchApi("/flux_klein/config",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({lora_triggers_custom:window.__fkCustomTriggers}),
          });
        }catch(e){ console.warn("[FluxKlein] save custom trigger:",e); }
      };

      const _getCustomTrigger=(loraName)=>{
        if(!loraName||loraName==="none"||!window.__fkCustomTriggers) return "";
        const base=loraName.split(/[\\/]/).pop();
        return window.__fkCustomTriggers[base]||"";
      };

      // Row 2: Faceswap LoRA + Remove BG model
      const modGrid2=mk("div",{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"16px"});
      const fsLoraF=mkModDD("Faceswap LoRA","/models/loras",S.fsLora,v=>{S.fsLora=v;persist();});
      const bgF=mkModDD("Remove BG Model","models/background_removal","none",v=>{S.bgRemovalModel=v==="none"?"":v;persist();});
      api.fetchApi("/flux_klein/bgremoval_models").then(r=>r.json()).then(d=>{
        const models=d.models||[];
        bgF.dd.updateItems(["none",...models]);
        if(S.bgRemovalModel&&models.includes(S.bgRemovalModel)) bgF.dd.set(S.bgRemovalModel);
        else bgF.dd.set("none");
      }).catch(()=>{});
      modGrid2.append(fsLoraF.wrap,bgF.wrap,mk("div"));

      // ── Preferences ───────────────────────────────────────────────────────
      const prefTitle=mk("div",{fontSize:"10px",fontWeight:"700",letterSpacing:".1em",
        textTransform:"uppercase",color:C.muted,padding:"10px 0 2px",
        borderBottom:`1px solid ${C.border}`,marginBottom:"4px"});
      tx(prefTitle,"Preferences");
      const soundToggle=Toggle("Notification sound on complete",soundEnabled,v=>{soundEnabled=v;persist();});
      const advUIToggle=Toggle("Advanced control (steps, CFG, sampler…)",S.advancedUI,v=>{S.advancedUI=v;persist();_advRefresh();},"#6450b4");

      const _slotH=LiteGraph.NODE_SLOT_HEIGHT||20;
      const _extInputNames=["model","clip","vae"];
      const _extInputColors=["#b39ddb","#80cbc4","#ef9a9a"];

      const _applyExtLoaders=(enabled)=>{
        const node=app.graph.getNodeById(self.id)||self;
        if(!node) return;
        if(enabled){
          // Add any missing ext slots individually — some may already exist if a
          // connected one (e.g. GGUF) was kept after a previous toggle-off.
          _extInputNames.forEach((name,i)=>{
            const has=(node.inputs||[]).some(inp=>inp.name===name);
            if(!has){
              const type=i===0?"MODEL":i===1?"CLIP":"VAE";
              node.addInput(name,type);
              const slot=node.inputs[node.inputs.length-1];
              if(slot) slot.color_on=_extInputColors[i];
            }
          });
          const n=(node.inputs||[]).filter(i=>_extInputNames.includes(i.name)).length;
          node.size=[NODE_W, NODE_H+n*_slotH];
          node.setDirtyCanvas(true,true);
        } else {
          // Turning the toggle off removes the empty slots, but KEEPS any slot that
          // still has a wire connected (e.g. a GGUF loader). That way you can flip the
          // toggle off to expose the fp8 dropdowns without losing your GGUF hookup —
          // switching fp8 <-> GGUF is then just connecting/disconnecting the wire.
          if(node.inputs&&node.inputs.length>0){
            for(let i=node.inputs.length-1;i>=0;i--){
              const inp=node.inputs[i];
              if(_extInputNames.includes(inp.name)&&inp.link==null) node.removeInput(i);
            }
          }
          const remaining=(node.inputs||[]).filter(i=>_extInputNames.includes(i.name)).length;
          node.size=[NODE_W, NODE_H+remaining*_slotH];
          node.setDirtyCanvas(true,true);
        }
      };

      const extLoadersToggle=Toggle("External model/clip/vae inputs (for GGUF etc.)",S.extLoaders||false,v=>{
        S.extLoaders=v;persist();
        _applyExtLoaders(v);
        _refreshExtInputUI();
      });

      // ── Downscale reference images (EDIT + I2I) ──────────────────────────────
      const _dsRow=mk("div",{display:"flex",flexDirection:"column",gap:"5px",padding:"9px 0",borderBottom:`1px solid ${C.border}`});
      const _dsTop=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"});
      const _dsLblWrap=mk("div",{display:"flex",alignItems:"center",gap:"8px",flex:"1",minWidth:"0"});
      const _dsLbl=mk("span",{fontSize:"12px",color:C.text});tx(_dsLbl,"Downscale reference images to");
      // MP number input — only enabled when the toggle is ON
      const _dsMP=mk("input",{
        width:"52px",textAlign:"center",background:"rgba(255,255,255,.05)",
        border:`1px solid rgba(255,255,255,.12)`,borderRadius:"6px",
        color:LIME,fontSize:"11px",fontWeight:"700",padding:"4px 0",outline:"none",
        transition:"border-color .15s,opacity .15s",flexShrink:"0",
      },{type:"number",step:"0.1",min:"0.1",max:"16",value:String(S.downscaleRefMP)});
      const _dsMPUnit=mk("span",{fontSize:"11px",color:C.muted,flexShrink:"0"});tx(_dsMPUnit,"MP");
      _dsLblWrap.append(_dsLbl,_dsMP,_dsMPUnit);
      // Toggle track (reuse the same visual style as Toggle())
      const _dsTrack=mk("div",{width:"34px",height:"18px",borderRadius:"9px",
        background:S.downscaleRef?LIME:C.dim,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:"0"});
      const _dsThumb=mk("div",{position:"absolute",top:"2px",left:S.downscaleRef?"16px":"2px",
        width:"14px",height:"14px",borderRadius:"50%",background:S.downscaleRef?"#111":"#888",transition:"left .2s,background .2s"});
      _dsTrack.appendChild(_dsThumb);
      const _dsHint=mk("div",{fontSize:"9px",color:C.muted,lineHeight:"1.5"});
      _dsHint.innerHTML="Shrinks the input image before it enters the model - in <b>EDIT</b> and <b>Sketch</b> modes. Lower MP = faster generation and lower VRAM, but finer details may be lost and the result can shift slightly, since the image gets resized to fit the model. Recommended if you have limited VRAM or hit out-of-memory errors on large images. Turn it <b>off</b> for maximum fidelity when your GPU can handle the full resolution.";
      const _dsApplyEnabled=()=>{
        const on=S.downscaleRef;
        _dsMP.disabled=!on;
        _dsMP.style.opacity=on?"1":"0.4";
        _dsLbl.style.opacity=on?"1":"0.6";
      };
      _dsTrack.onclick=()=>{
        S.downscaleRef=!S.downscaleRef;
        _dsTrack.style.background=S.downscaleRef?LIME:C.dim;
        _dsThumb.style.left=S.downscaleRef?"16px":"2px";
        _dsThumb.style.background=S.downscaleRef?"#111":"#888";
        _dsApplyEnabled();persist();
      };
      _dsMP.onfocus=()=>_dsMP.style.borderColor=LIME;
      _dsMP.onblur=()=>{
        let v=_pf(_dsMP.value); if(isNaN(v)||v<=0) v=1.0; v=Math.min(16,Math.max(0.1,v));
        S.downscaleRefMP=v; _dsMP.value=String(v); _dsMP.style.borderColor="rgba(255,255,255,.12)"; persist();
      };
      _dsTop.append(_dsLblWrap,_dsTrack);
      _dsRow.append(_dsTop,_dsHint);
      _dsApplyEnabled();

      settingsOverlay.append(settHdr,modGrid,_kvNote,_baseNote,modGrid2,prefTitle,soundToggle.el,advUIToggle.el,extLoadersToggle.el,_dsRow);

      // ── Overlay helpers ───────────────────────────────────────────────────
      const openOverlay=(el)=>{
        el.style.display="flex";
        el.offsetHeight;
        el.style.opacity="1";
        el.style.transform="translateY(0)";
      };
      const closeOverlayFade=(el,cb)=>{
        el.style.opacity="0";
        el.style.transform="translateY(6px)";
        setTimeout(()=>{el.style.display="none";if(cb)cb();},220);
      };

      // ── TOP BAR ──────────────────────────────────────────────────────────
      const topBar=mk("div",{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"6px",marginBottom:"-2px"});

      // Gallery button (placeholder — will be wired when gallery is implemented)
      const galleryBtn=mk("button",{
        background:"linear-gradient(90deg,#1a1a2e,#0f3460,#533483)",
        border:"1.5px solid rgba(255,255,255,.15)",
        borderRadius:"6px",padding:"4px 11px",cursor:"pointer",color:"#e0e0ff",
        fontSize:"11px",fontWeight:"700",display:"flex",alignItems:"center",gap:"5px",
        transition:"opacity .15s, filter .15s",outline:"none",
      });
      const galleryIcon=mk("span",{fontSize:"12px"});tx(galleryIcon,"▦");
      const galleryLbl=mk("span");tx(galleryLbl,"Gallery");
      galleryBtn.append(galleryIcon,galleryLbl);
      galleryBtn.onmouseenter=()=>galleryBtn.style.filter="brightness(1.3)";
      galleryBtn.onmouseleave=()=>galleryBtn.style.filter="";
      galleryBtn.onclick=()=>{}; // TODO: gallery overlay

      // Help button (placeholder)
      const tipsBtn=mk("button",{
        background:"transparent",border:`1.5px solid ${C.borderH}`,
        borderRadius:"6px",padding:"4px 11px",cursor:"pointer",color:C.muted,
        fontSize:"11px",fontWeight:"700",display:"flex",alignItems:"center",gap:"5px",
        transition:"opacity .15s, border-color .15s, color .15s",outline:"none",
      });
      tx(tipsBtn,"✦ Help");
      tipsBtn.onmouseenter=()=>{tipsBtn.style.borderColor=C.text;tipsBtn.style.color=C.text;};
      tipsBtn.onmouseleave=()=>{tipsBtn.style.borderColor=C.borderH;tipsBtn.style.color=C.muted;};
      // ── Help Overlay ──────────────────────────────────────────────────────
      const helpOverlay=mk("div",{
        position:"absolute",inset:"0",background:"#0a0a0a",
        display:"none",flexDirection:"column",padding:"16px",
        boxSizing:"border-box",zIndex:"50",borderRadius:"8px",overflowY:"auto",
        opacity:"0",transition:"opacity .22s ease, transform .22s ease",
        transform:"translateY(6px)",
      });

      const helpHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",flexShrink:"0"});
      const helpTitle=mk("div",{fontSize:"13px",fontWeight:"700",letterSpacing:".06em",textTransform:"uppercase",color:C.text});
      tx(helpTitle,"✦ Help");
      const helpClose=mk("button",{background:"transparent",border:`1px solid #e05555`,borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:"#e05555",cursor:"pointer",transition:"opacity .15s",outline:"none"});
      tx(helpClose,"✕  Close");
      helpClose.onmouseenter=()=>helpClose.style.opacity=".7";
      helpClose.onmouseleave=()=>helpClose.style.opacity="1";
      helpClose.onclick=()=>closeOverlayFade(helpOverlay);
      helpHdr.append(helpTitle,helpClose);

      // ── Where to Get Models ───────────────────────────────────────────────
      const _mkHelpSectionTitle=(text)=>{
        const t=mk("div",{fontSize:"11px",fontWeight:"700",color:C.text,marginBottom:"10px",paddingTop:"12px",borderTop:`1px solid ${C.border}`,letterSpacing:".02em"});
        tx(t,text); return t;
      };
      const _mkModelLink=(name,url)=>{
        const a=document.createElement("a");
        a.href=url; a.target="_blank"; a.rel="noopener";
        Object.assign(a.style,{fontSize:"10px",color:C.text,background:C.bg3,border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 9px",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:"4px",transition:"border-color .15s,color .15s",flexShrink:"0"});
        const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
        svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("width","9");svg.setAttribute("height","9");svg.style.fill="currentColor";svg.style.flexShrink="0";
        const p=document.createElementNS("http://www.w3.org/2000/svg","path");
        p.setAttribute("d","M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z");
        svg.appendChild(p);
        const span=document.createElement("span"); span.textContent=name; a.append(svg,span);
        a.addEventListener("mouseenter",()=>{a.style.borderColor=LIME;a.style.color=LIME;});
        a.addEventListener("mouseleave",()=>{a.style.borderColor=C.border;a.style.color=C.text;});
        return a;
      };
      const _mkOrSep=()=>{ const s=mk("span",{fontSize:"8px",color:C.muted,alignSelf:"center",flexShrink:"0"}); tx(s,"or"); return s; };
      const _mkModelRow=(label,path,links,note)=>{
        const wrap=mk("div",{marginBottom:"7px"});
        const row=mk("div",{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"});
        const lbl=mk("span",{fontSize:"9px",fontWeight:"700",color:LIME,letterSpacing:".06em",textTransform:"uppercase",minWidth:"110px",flexShrink:"0"});
        tx(lbl,label);
        const cw=mk("div",{display:"flex",gap:"4px",flexWrap:"wrap",flex:"1",alignItems:"center"});
        links.forEach((l,i)=>{ if(i>0) cw.appendChild(_mkOrSep()); cw.appendChild(_mkModelLink(l.name,l.url)); });
        const dest=mk("span",{fontSize:"9px",color:"#888",fontFamily:"monospace",whiteSpace:"nowrap",fontWeight:"600"});
        tx(dest,"→ "+path);
        row.append(lbl,cw,dest);
        wrap.appendChild(row);
        if(note){ const n=mk("div",{fontSize:"8px",color:C.muted,fontStyle:"italic",marginTop:"2px",paddingLeft:"116px"}); tx(n,note); wrap.appendChild(n); }
        return wrap;
      };

      // ── Gated model warning ───────────────────────────────────────────────
      const gatedWarn=mk("div",{
        display:"flex",gap:"10px",alignItems:"flex-start",
        background:"rgba(255,165,0,.07)",border:"1px solid rgba(255,165,0,.35)",
        borderRadius:"8px",padding:"10px 13px",marginBottom:"14px",
      });
      const gatedIcon=mk("div",{fontSize:"18px",lineHeight:"1",flexShrink:"0",marginTop:"1px"});
      tx(gatedIcon,"🔐");
      const gatedText=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const gatedTitle=mk("div",{fontSize:"10px",fontWeight:"700",color:"#ffb347",letterSpacing:".03em"});
      tx(gatedTitle,"9B models require HuggingFace access");
      const gatedBody=mk("div",{fontSize:"9px",color:"#ccc",lineHeight:"1.6"});
      tx(gatedBody,"These models are gated under the FLUX Non-Commercial License. You must log in to HuggingFace, visit the model page, and click \"Agree\" to accept the license terms before the download links will work.\nNon-commercial use only.");
      gatedBody.style.whiteSpace="pre-line";
      const gatedLink=document.createElement("a");
      gatedLink.href="https://huggingface.co/black-forest-labs/FLUX.2-klein-9B";
      gatedLink.target="_blank"; gatedLink.rel="noopener";
      Object.assign(gatedLink.style,{fontSize:"9px",color:"#ffb347",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:"3px",marginTop:"3px",width:"fit-content"});
      gatedLink.innerHTML=`<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg> Request access on HuggingFace`;
      gatedLink.addEventListener("mouseenter",()=>gatedLink.style.opacity=".75");
      gatedLink.addEventListener("mouseleave",()=>gatedLink.style.opacity="1");
      gatedText.append(gatedTitle,gatedBody,gatedLink);
      gatedWarn.append(gatedIcon,gatedText);

      const modelsSectionTitle=_mkHelpSectionTitle("Where to Get Models");
      modelsSectionTitle.style.borderTop="none"; modelsSectionTitle.style.paddingTop="0";
      const modelsList=mk("div",{display:"flex",flexDirection:"column",gap:"2px",marginBottom:"8px"});
      modelsList.append(
        _mkModelRow("Diffusion Model","models/diffusion_models/",[
          {name:"flux-2 klein 9b distilled",url:"https://huggingface.co/black-forest-labs/FLUX.2-klein-9B/resolve/main/flux-2-klein-9b.safetensors"},
          {name:"flux-2 klein 9b fp8 distilled",url:"https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors"},
          {name:"flux-2 klein 9b kv",url:"https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-kv/resolve/main/flux-2-klein-9b-kv.safetensors"},
          {name:"flux-2 klein 9b kv fp8",url:"https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-kv-fp8/resolve/main/flux-2-klein-9b-kv-fp8.safetensors"},
          {name:"flux-2 klein 4b distilled",url:"https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/resolve/main/flux-2-klein-4b.safetensors"},
          {name:"flux-2 klein 4b fp8 distilled",url:"https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/main/flux-2-klein-4b-fp8.safetensors"},
        ]),
        _mkModelRow("Text Encoder (9b)","models/text_encoders/",[
          {name:"qwen_3_8b_fp8mixed",url:"https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors"},
          {name:"qwen_3_8b_fp4mixed",url:"https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/text_encoders/qwen_3_8b_fp4mixed.safetensors"},
        ],"For flux-2 klein 9b models"),
        _mkModelRow("Text Encoder (4b)","models/text_encoders/",[
          {name:"qwen_3_4b",url:"https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors"},
          {name:"qwen_3_4b_fp4",url:"https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/text_encoders/qwen_3_4b_fp4_flux2.safetensors"},
        ],"For flux-2 klein 4b model"),
        _mkModelRow("VAE","models/vae/",[
          {name:"flux2-vae",url:"https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/vae/flux2-vae.safetensors"},
        ]),
        _mkModelRow("Faceswap LoRA","models/loras/",[
          {name:"bfs head swap v1 (9b)",url:"https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/main/bfs_head_v1_flux-klein_9b_step3500_rank128.safetensors"},
          {name:"bfs head swap v1 (4b)",url:"https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/resolve/main/bfs_head_v1_flux-klein_4b.safetensors"},
        ]),
        _mkModelRow("BG Removal","models/background_removal/",[
          {name:"birefnet",url:"https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors"},
        ]),
      );

      // ── Bottom row: Official Links (left) + My channels (right) ─────────
      const bottomRow=mk("div",{
        display:"flex",gap:"16px",alignItems:"flex-start",
        paddingTop:"12px",borderTop:`1px solid ${C.border}`,marginBottom:"8px",
      });

      // Left: Official Links
      const linksCol=mk("div",{display:"flex",flexDirection:"column",gap:"6px",flex:"1"});
      const linksSectionTitle=mk("div",{fontSize:"11px",fontWeight:"700",color:C.text,letterSpacing:".02em",marginBottom:"6px"});
      tx(linksSectionTitle,"Official Links");
      const linksRow=mk("div",{display:"flex",gap:"5px",flexWrap:"wrap"});
      [
        {name:"🌐 FLUX.2-klein",url:"https://bfl.ai/models/flux-2-klein"},
        {name:"⚙ GitHub",url:"https://github.com/black-forest-labs/flux2"},
        {name:"🤗 HuggingFace",url:"https://huggingface.co/black-forest-labs"},
      ].forEach(({name,url})=>{
        const a=document.createElement("a");
        a.href=url; a.target="_blank"; a.rel="noopener";
        Object.assign(a.style,{fontSize:"10px",color:C.muted,background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"5px",padding:"4px 10px",textDecoration:"none",transition:"border-color .15s,color .15s",display:"inline-block"});
        a.textContent=name;
        a.addEventListener("mouseenter",()=>{a.style.borderColor=C.text;a.style.color=C.text;});
        a.addEventListener("mouseleave",()=>{a.style.borderColor=C.border;a.style.color=C.muted;});
        linksRow.appendChild(a);
      });
      linksCol.append(linksSectionTitle,linksRow);

      // Right: My channels
      const authorCol=mk("div",{display:"flex",flexDirection:"column",gap:"6px",alignItems:"flex-end"});
      const authorSectionTitle=mk("div",{fontSize:"11px",fontWeight:"700",color:LIME,letterSpacing:".02em",marginBottom:"6px",textAlign:"right"});
      tx(authorSectionTitle,"Follow along");
      const authorRow=mk("div",{display:"flex",gap:"5px",flexWrap:"wrap",justifyContent:"flex-end"});
      [
        {name:"▶ YouTube",url:"https://www.youtube.com/@LateNodeWithYano",color:"#ff4444"},
        {name:"⚙ GitHub",url:"https://github.com/yanokusnir-ai",color:C.text},
        {name:"● Reddit",url:"https://www.reddit.com/user/yanokusnir/",color:"#ff6314"},
      ].forEach(({name,url,color})=>{
        const a=document.createElement("a");
        a.href=url; a.target="_blank"; a.rel="noopener";
        Object.assign(a.style,{fontSize:"10px",color,background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"5px",padding:"4px 10px",textDecoration:"none",transition:"border-color .15s,color .15s,background .15s",display:"inline-block",fontWeight:"600"});
        a.textContent=name;
        a.addEventListener("mouseenter",()=>{a.style.borderColor=color;a.style.background=C.bg3;});
        a.addEventListener("mouseleave",()=>{a.style.borderColor=C.border;a.style.background=C.bg2;});
        authorRow.appendChild(a);
      });
      const authorCredit=mk("div",{fontSize:"8px",color:C.muted,textAlign:"right",marginTop:"2px"});
      tx(authorCredit,"node by yanokusnir");
      authorCol.append(authorSectionTitle,authorRow,authorCredit);

      bottomRow.append(linksCol,authorCol);

      helpOverlay.append(helpHdr,modelsSectionTitle,gatedWarn,modelsList,bottomRow);

      tipsBtn.onclick=()=>openOverlay(helpOverlay);

      // Settings button
      const settingsBtn=mk("button",{
        background:"transparent",border:`1.5px solid ${C.borderH}`,
        borderRadius:"6px",padding:"4px 11px",
        cursor:"pointer",color:C.muted,fontSize:"11px",fontWeight:"700",
        display:"flex",alignItems:"center",gap:"5px",
        transition:"opacity .15s",outline:"none",
      });
      const settGear=mk("span",{fontSize:"12px",transition:"transform .3s",lineHeight:"1"});tx(settGear,"⚙");
      const settLblEl=mk("span");tx(settLblEl,"Settings");
      settingsBtn.append(settGear,settLblEl);
      settingsBtn.onmouseenter=()=>{settingsBtn.style.borderColor=C.text;settingsBtn.style.color=C.text;settGear.style.transform="rotate(30deg)";};
      settingsBtn.onmouseleave=()=>{settingsBtn.style.borderColor=C.borderH;settingsBtn.style.color=C.muted;settGear.style.transform="";};
      const _refreshExtInputUI=()=>{
        const n=app.graph.getNodeById(self.id);
        // Only dim a dropdown when external inputs are ENABLED and that slot is wired.
        // With the toggle off, the dropdowns are always live (their model is used),
        // even if a GGUF wire is still physically connected.
        const isActive=(name)=>{
          if(!S.extLoaders||!n||!n.inputs) return false;
          const slot=n.inputs.find(i=>i.name===name);
          return slot&&slot.link!=null;
        };
        const dim=(wrap,connected)=>{
          wrap.style.opacity=connected?"0.4":"1";
          wrap.style.pointerEvents=connected?"none":"";
          wrap.title=connected?"Connected externally — disconnect to use dropdown":"";
        };
        dim(modelF.wrap,isActive("model"));
        dim(teF.wrap,  isActive("clip"));
        dim(vaeF.wrap, isActive("vae"));
      };
      settingsBtn.onclick=e=>{e.stopPropagation();_refreshExtInputUI();openOverlay(settingsOverlay);};
      settClose.onclick=()=>closeOverlayFade(settingsOverlay);

      // ── Layout toggle (classic wide-prompt ↔ tall preview) ────────────────
      const layoutBtn=mk("button",{
        background:"transparent",border:`1.5px solid ${C.borderH}`,
        borderRadius:"6px",padding:"4px 8px",
        cursor:"pointer",color:C.muted,
        display:"flex",alignItems:"center",gap:"4px",
        transition:"opacity .15s, border-color .15s, color .15s",outline:"none",
      });
      const _setLayoutBtnIcon=()=>{
        // Icon hints the layout you'll switch TO; lime when "tall" is active.
        const tall=S.layoutMode==="tall";
        layoutBtn.title=tall?"Layout: tall preview (click for classic wide prompt)":"Layout: classic (click for tall preview)";
        layoutBtn.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`;
        layoutBtn.style.color=tall?LIME:C.muted;
        layoutBtn.style.borderColor=tall?LIME:C.borderH;
      };
      _setLayoutBtnIcon();
      layoutBtn.onmouseenter=()=>{layoutBtn.style.borderColor=LIME;layoutBtn.style.color=LIME;};
      layoutBtn.onmouseleave=()=>{_setLayoutBtnIcon();};
      layoutBtn.onclick=()=>{
        S.layoutMode=S.layoutMode==="tall"?"classic":"tall";
        _applyLayout(S.layoutMode);_setLayoutBtnIcon();persist();
      };

      // Fullscreen node button
      const fsNodeBtn=mk("button",{
        background:"transparent",border:`1.5px solid ${C.borderH}`,
        borderRadius:"6px",padding:"4px 8px",
        cursor:"pointer",color:C.muted,
        display:"flex",alignItems:"center",gap:"4px",
        transition:"opacity .15s, border-color .15s, color .15s",outline:"none",
      });
      fsNodeBtn.title="Fullscreen";
      fsNodeBtn.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
      fsNodeBtn.onmouseenter=()=>{fsNodeBtn.style.borderColor=LIME;fsNodeBtn.style.color=LIME;};
      fsNodeBtn.onmouseleave=()=>{fsNodeBtn.style.borderColor=C.borderH;fsNodeBtn.style.color=C.muted;};

      let _inFullscreen=false;
      let _fsNodeOverlay=null;
      let _rootOrigParent=null,_rootOrigNextSibling=null;

      const _enterFullscreen=()=>{
        if(_inFullscreen) return;
        if(!_fsNodeOverlay){
          _fsNodeOverlay=mk("div",{
            position:"fixed",inset:"0",zIndex:"99990",
            background:"rgba(6,6,8,.97)",
            display:"none",flexDirection:"column",
            alignItems:"center",justifyContent:"center",
            boxSizing:"border-box",overflow:"hidden",
          });
          // No keydown handler — Esc is blocked globally via capture handler below
          document.body.appendChild(_fsNodeOverlay);
        }
        _rootOrigParent=root.parentNode;
        _rootOrigNextSibling=root.nextSibling;
        root.style.width=NODE_W+"px";
        root.style.height=NODE_H+"px";
        root.style.overflow="hidden";
        root.style.borderRadius="0";
        root.style.position="absolute";
        root.style.top="0";root.style.left="0";root.style.margin="0";
        const _vw=window.innerWidth,_vh=window.innerHeight;
        const _scale=Math.min(_vw/NODE_W,_vh/NODE_H)*0.97;
        root.style.transformOrigin="top left";
        root.style.transform=`scale(${_scale})`;
        const _scW=Math.round(NODE_W*_scale),_scH=Math.round(NODE_H*_scale);
        const _scWrap=mk("div",{width:_scW+"px",height:_scH+"px",position:"relative",flexShrink:"0",overflow:"hidden"});
        _scWrap.appendChild(root);
        _fsNodeOverlay.appendChild(_scWrap);
        _fsNodeOverlay._scWrap=_scWrap;
        _fsNodeOverlay.style.display="flex";
        _fsNodeOverlay.setAttribute("tabindex","-1");
        _fsNodeOverlay.focus();
        fsNodeBtn.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></svg>`;
        _inFullscreen=true;
      };

      const _exitFullscreen=()=>{
        if(!_inFullscreen) return;
        if(_rootOrigParent){
          if(_rootOrigNextSibling) _rootOrigParent.insertBefore(root,_rootOrigNextSibling);
          else _rootOrigParent.appendChild(root);
        }
        root.style.position="";root.style.inset="";root.style.width="100%";root.style.height="";
        root.style.borderRadius="";root.style.overflow="hidden";
        root.style.transform="";root.style.transformOrigin="";root.style.margin="";
        root.style.top="";root.style.left="";
        scrollEl.style.height=_uiH+"px";
        if(_fsNodeOverlay._scWrap) _fsNodeOverlay._scWrap.remove();
        _fsNodeOverlay._scWrap=null;
        _fsNodeOverlay.style.display="none";
        fsNodeBtn.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
        _inFullscreen=false;
      };

      fsNodeBtn.onclick=()=>{ if(_inFullscreen) _exitFullscreen(); else _enterFullscreen(); };

      const topBarLeft=mk("div",{display:"flex",gap:"3px",alignItems:"center",flexWrap:"nowrap"});
      const topBarRight=mk("div",{display:"flex",gap:"6px",alignItems:"center",flexShrink:"0"});
      topBarRight.append(galleryBtn,tipsBtn,settingsBtn,layoutBtn,fsNodeBtn);
      topBar.append(topBarLeft,topBarRight);

      // ── PILLS ─────────────────────────────────────────────────────────────
      let activePill=S.pill||"t2i";

      const pillT2I     =Pill("T2I",     activePill==="t2i",      ()=>setPill("t2i"));
      const pillI2I     =Pill("I2I",     activePill==="i2i",      ()=>setPill("i2i"));
      const pillEdit    =Pill("EDIT",    activePill==="edit",     ()=>setPill("edit"));
      const pillInpaint =Pill("PAINT",   activePill==="inpaint",  ()=>setPill("inpaint"));
      const pillFaceswap=Pill("FACESWAP",activePill==="faceswap", ()=>setPill("faceswap"));
      topBarLeft.append(pillT2I,pillI2I,pillEdit,pillInpaint,pillFaceswap);

      let _promptTARef=null; // set after promptTA is created

      const _pillPromptKey=(p)=>p==="t2i"?"promptT2i":p==="edit"?"promptEdit":p==="inpaint"?"promptPaint":p==="i2i"?"promptI2i":"promptFs";

      function setPill(p){
        // Save current prompt to old pill's slot before switching
        if(_promptTARef&&activePill){
          S[_pillPromptKey(activePill)]=_promptTARef.value;
        }
        activePill=p;S.pill=p;
        // Restore prompt for new pill
        const newPrompt=S[_pillPromptKey(p)];
        // Pre-fill faceswap default prompt only if both shared and per-pill are empty
        if(p==="faceswap"&&!newPrompt&&!S.prompt.trim()){
          S[_pillPromptKey(p)]=DEFAULT_FACESWAP_PROMPT;
        }
        S.prompt=S[_pillPromptKey(p)];
        if(_promptTARef){ _promptTARef.value=S.prompt; if(typeof _promptOvTA!=="undefined"&&_promptOvTA) _promptOvTA.value=S.prompt; }
        persist();
        [pillT2I,pillI2I,pillEdit,pillInpaint,pillFaceswap].forEach(b=>{
          const isActive=
            (b===pillT2I&&p==="t2i")||
            (b===pillI2I&&p==="i2i")||
            (b===pillEdit&&p==="edit")||
            (b===pillInpaint&&p==="inpaint")||
            (b===pillFaceswap&&p==="faceswap");
          b.style.background=isActive?LIME:C.bg2;
          b.style.color=isActive?"#111":C.text;
          b.style.borderColor=isActive?LIME:C.border;
          b.style.fontWeight=isActive?"700":"400";
        });
        updatePillVisibility();
        updateSizeControls();
      }

      // ── MAIN ROW ─────────────────────────────────────────────────────────
      const mainRow=mk("div",{display:"flex",gap:"12px",alignItems:"stretch",flex:"1",minHeight:"0"});
      const leftPanel=mk("div",{display:"flex",flexDirection:"column",gap:"7px",
        width:"300px",flexShrink:"0",minHeight:"0",overflowY:"auto",overflowX:"hidden"});

      // Switch prompt placement between the two layouts. promptWrap is defined
      // further down but captured by closure; this only runs at assemble time / on toggle.
      const _applyLayout=(mode)=>{
        if(mode==="tall"){
          // Prompt in the left column → preview (mainRow) takes the full height.
          leftPanel.appendChild(promptWrap);
          promptTA.style.height="94px"; // a little taller to use the column space
        } else {
          // Classic: wide prompt under the preview (original 80px height).
          pad.appendChild(promptWrap);
          promptTA.style.height="80px";
        }
      };

      // ── Node-local fullscreen overlay ────────────────────────────────────
      let _nodeFsOv=null;
      const _initNodeFsOverlay=()=>{
        if(_nodeFsOv) return _nodeFsOv;
        const ov=mk("div",{position:"absolute",inset:"0",zIndex:"9999",
          background:"rgba(28,28,32,.97)",display:"none",flexDirection:"column",
          alignItems:"stretch",borderRadius:"inherit",overflow:"hidden"});
        const _nfTopBar=mk("div",{display:"flex",alignItems:"center",
          padding:"10px 12px",gap:"10px",flexShrink:"0",
          background:"linear-gradient(to bottom,rgba(0,0,0,.7),rgba(0,0,0,0))",
          position:"absolute",top:"0",left:"0",right:"0",zIndex:"3"});
        const _nfName=mk("div",{fontSize:"11px",fontWeight:"700",color:"#fff",
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
          letterSpacing:".01em",textAlign:"center",width:"100%",padding:"0 36px",boxSizing:"border-box"});
        const _nfCloseBtn=mk("button",{width:"26px",height:"26px",borderRadius:"50%",
          position:"absolute",right:"12px",top:"10px",
          background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",
          color:"rgba(255,255,255,.85)",fontSize:"10px",cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",padding:"0",outline:"none"});
        _nfCloseBtn.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
        _nfCloseBtn.onmouseenter=()=>{_nfCloseBtn.style.background="rgba(255,255,255,.2)";};
        _nfCloseBtn.onmouseleave=()=>{_nfCloseBtn.style.background="rgba(255,255,255,.08)";};
        _nfTopBar.append(_nfName,_nfCloseBtn);
        const _nfMediaWrap=mk("div",{width:"100%",height:"100%",display:"flex",
          alignItems:"center",justifyContent:"center",padding:"48px 16px 16px",boxSizing:"border-box"});
        const _nfClose=()=>{
          if(ov._cleanupCmp){ov._cleanupCmp();ov._cleanupCmp=null;}
          if(ov._fsUseBtn){ov._fsUseBtn.remove();ov._fsUseBtn=null;}
          ov.style.display="none";
          const img=_nfMediaWrap.querySelector("img");
          if(img) img.src="";
          _nfMediaWrap.innerHTML="";
          // Restore preview action buttons
          if(typeof previewUseWrap!=="undefined") previewUseWrap.style.visibility="";
          if(typeof previewDelBtn!=="undefined") previewDelBtn.style.visibility="";
        };
        _nfCloseBtn.onclick=_nfClose;
        ov.addEventListener("keydown",e=>{if(e.key==="Escape")_nfClose();});
        ov.setAttribute("tabindex","-1");
        ov._close=_nfClose;
        ov.append(_nfTopBar,_nfMediaWrap);
        ov._open=(type,src,name,opts)=>{
          _nfMediaWrap.innerHTML="";
          _nfMediaWrap.style.padding="0"; // image and comparer both fill the full area
          tx(_nfName,name||"");
          // Hide preview action buttons while fullscreen overlay is open (image-only mode)
          if(type==="image"){
            if(typeof previewUseWrap!=="undefined"&&previewUseWrap) previewUseWrap.style.visibility="hidden";
            if(typeof previewDelBtn!=="undefined"&&previewDelBtn) previewDelBtn.style.visibility="hidden";
          }
          if(type==="image"){
            // Image fills the whole overlay (like the comparer): no dims badge, no
            // top/bottom reserved space — just the largest possible contained image.
            _nfMediaWrap.style.padding="0";
            const img=mk("img",{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",
              borderRadius:"8px",boxShadow:"0 4px 24px rgba(0,0,0,.5)",display:"block"});
            img.src=src;
            _nfMediaWrap.appendChild(img);
          } else if(type==="comparer"){
            // Full-screen before/after comparer with "Use as input" in top-right
            const {genSrc,baseSrc,onUse}=opts||{};
            const cWrap=mk("div",{position:"relative",width:"100%",height:"100%",
              overflow:"hidden",borderRadius:"8px",cursor:"col-resize",userSelect:"none",
              minHeight:"0",flex:"1"});
            const cBase=mk("img",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain"});
            cBase.src=baseSrc||"";
            const cGen=mk("div",{position:"absolute",top:"0",left:"0",bottom:"0",overflow:"hidden",width:"100%"});
            const cGenImg=mk("img",{position:"absolute",top:"0",left:"0",height:"100%",objectFit:"contain"});
            cGen.appendChild(cGenImg);
            cGenImg.src=genSrc||"";
            const cLine=mk("div",{position:"absolute",top:"0",bottom:"0",width:"2px",
              background:LIME,left:"calc(100% - 1px)",boxShadow:"0 0 8px rgba(240,255,65,.5)",
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:"4"});
            const cHandle=mk("div",{width:"30px",height:"30px",borderRadius:"50%",background:LIME,
              border:"2px solid #111",flexShrink:"0",display:"flex",alignItems:"center",justifyContent:"center",
              boxShadow:"0 2px 10px rgba(0,0,0,.7)",pointerEvents:"none"});
            cHandle.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"><path d="M8 4l-4 8 4 8M16 4l4 8-4 8"/></svg>`;
            cLine.appendChild(cHandle);
            const _fsSetPct=(pct)=>{
              pct=Math.max(0,Math.min(100,pct));
              cGen.style.width=pct+"%";
              cLine.style.left=`calc(${pct}% - 1px)`;
              cGenImg.style.width=(cWrap.offsetWidth||900)+"px";
            };
            let _fsDrag=false;
            cWrap.addEventListener("mousedown",e=>{_fsDrag=true;e.preventDefault();});
            const _fsMM=(e)=>{if(!_fsDrag)return;const r=cWrap.getBoundingClientRect();_fsSetPct((e.clientX-r.left)/r.width*100);};
            const _fsMU=()=>{_fsDrag=false;};
            document.addEventListener("mousemove",_fsMM);
            document.addEventListener("mouseup",_fsMU);
            cWrap.addEventListener("touchstart",()=>{_fsDrag=true;},{passive:true});
            cWrap.addEventListener("touchmove",e=>{if(!_fsDrag)return;const r=cWrap.getBoundingClientRect();_fsSetPct((e.touches[0].clientX-r.left)/r.width*100);},{passive:true});
            cWrap.addEventListener("touchend",()=>{_fsDrag=false;});
            ov._cleanupCmp=()=>{document.removeEventListener("mousemove",_fsMM);document.removeEventListener("mouseup",_fsMU);};
            cWrap.append(cBase,cGen,cLine);
            _nfMediaWrap.style.position="relative";
            _nfMediaWrap.style.padding="0"; // comparer fills full area
            _nfMediaWrap.appendChild(cWrap);
            cGenImg.onload=()=>{ _fsSetPct(100); };
            // "Use as input" button — top-right corner of the overlay
            if(onUse){
              const useBtn=mk("button",{
                position:"absolute",top:"54px",right:"14px",zIndex:"10",
                background:"rgba(20,20,20,.82)",color:"rgba(255,255,255,.82)",
                border:"1px solid rgba(255,255,255,.18)",
                borderRadius:"6px",padding:"5px 12px",fontSize:"10px",fontWeight:"600",
                cursor:"pointer",outline:"none",whiteSpace:"nowrap",
                backdropFilter:"blur(4px)",letterSpacing:".04em",
                boxShadow:"0 2px 8px rgba(0,0,0,.5)",
                transition:"background .15s, color .15s, border-color .15s",
              });
              tx(useBtn,"Use as input");
              useBtn.onmouseenter=()=>{useBtn.style.background="rgba(40,40,40,.95)";useBtn.style.color="#fff";useBtn.style.borderColor="rgba(255,255,255,.35)";};
              useBtn.onmouseleave=()=>{useBtn.style.background="rgba(20,20,20,.82)";useBtn.style.color="rgba(255,255,255,.82)";useBtn.style.borderColor="rgba(255,255,255,.18)";};
              useBtn.onclick=(e)=>{e.stopPropagation();onUse();_nfClose();};
              ov.appendChild(useBtn);
              ov._fsUseBtn=useBtn;
            }
          }
          ov.style.display="flex";ov.focus();
        };
        root.appendChild(ov);
        _nodeFsOv=ov;
        return ov;
      };
      _fkActiveFsFactory=_initNodeFsOverlay;

      // ── I2I PANEL ─────────────────────────────────────────────────────────
      const i2iPanel=mk("div",{display:"none",flexDirection:"column",gap:"5px"});

      // _i2iDims: same helper pattern as _fsTargetDims
      const _i2iDims=(()=>{
        let _w=0,_h=0;
        const el=mk("div",{
          fontSize:"9px",fontWeight:"700",letterSpacing:".04em",
          textAlign:"center",cursor:"pointer",display:"none",
          borderRadius:"5px",padding:"2px 6px",boxSizing:"border-box",
          background:C.bg3,border:`1px solid ${C.borderH}`,color:LIME,
          background:"rgba(240,255,65,.13)",borderColor:"rgba(240,255,65,.5)",
        });
        el._getDims=()=>({w:_w,h:_h});
        el._set=(w,h)=>{ _w=w;_h=h; if(w&&h){ tx(el,`${w}×${h}`);el.style.display="block"; } else el.style.display="none"; };
        return el;
      })();

      let _i2iUseOrigSize=S.i2iResizeLonger<=0; // true = lime badge, locked; false = unlocked

      const _i2iResizePreview=mk("span",{fontSize:"9px",fontWeight:"700",color:LIME,letterSpacing:".03em",whiteSpace:"nowrap"});
      const _i2iResizeLongerInp=NI("px",S.i2iResizeLonger||1024,64,8192,8,v=>{
        S.i2iResizeLonger=Math.round(v)||1024;
        _i2iResizeUpdatePreview();
        persist();
      },52);

      const _i2iUseOrigNote=mk("div",{fontSize:"8px",color:LIME,display:"none",marginTop:"0"});
      tx(_i2iUseOrigNote,"Using size from Input image.");

      const _i2iResizeRow=mk("div",{display:"none",alignItems:"center",gap:"6px",marginTop:"2px"});
      const _i2iResizeRowLbl=mk("span",{fontSize:"8px",color:C.muted,whiteSpace:"nowrap",flexShrink:"0"});
      tx(_i2iResizeRowLbl,"Scale by longer side");
      _i2iResizeRow.append(_i2iResizeRowLbl,_i2iResizeLongerInp,_i2iResizePreview);

      const _i2iResizeUpdatePreview=()=>{
        const dims=_i2iDims._getDims();
        if(!_i2iUseOrigSize&&dims.w&&dims.h&&S.i2iResizeLonger>0){
          const scale=S.i2iResizeLonger/Math.max(dims.w,dims.h);
          const nw=Math.round(dims.w*scale/16)*16;
          const nh=Math.round(dims.h*scale/16)*16;
          tx(_i2iResizePreview,`→ ${nw}×${nh}`);
        } else {
          tx(_i2iResizePreview,"");
        }
      };

      const _i2iApplyState=()=>{
        const dims=_i2iDims._getDims();
        if(!dims.w||!dims.h) return;
        if(_i2iUseOrigSize){
          _i2iDims.style.color=LIME;
          _i2iDims.style.background="rgba(240,255,65,.13)";
          _i2iDims.style.borderColor="rgba(240,255,65,.5)";
          _i2iUseOrigNote.style.display="block";
          _i2iResizeRow.style.opacity="0.35";
          _i2iResizeRow.style.pointerEvents="none";
          _i2iResizeLongerInp._inp.disabled=true;
        } else {
          _i2iDims.style.color=C.text;
          _i2iDims.style.background=C.bg3;
          _i2iDims.style.borderColor=C.borderH;
          _i2iUseOrigNote.style.display="none";
          _i2iResizeRow.style.opacity="1";
          _i2iResizeRow.style.pointerEvents="auto";
          _i2iResizeLongerInp._inp.disabled=false;
          if(S.i2iResizeLonger<=0){ S.i2iResizeLonger=_i2iResizeLongerInp.numVal||1024; persist(); }
        }
        _i2iResizeUpdatePreview();
      };

      _i2iDims.onclick=()=>{
        const dims=_i2iDims._getDims();
        if(!dims.w||!dims.h) return;
        _i2iUseOrigSize=!_i2iUseOrigSize;
        if(_i2iUseOrigSize){ S.i2iResizeLonger=0; persist(); }
        _i2iApplyState();
      };

      const i2iSlotRow=mk("div",{display:"flex",gap:"10px",alignItems:"flex-start"});
      const i2iSlotCard=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
      const i2iSlot=ImgSlot(false,(name)=>{
        S.i2iImage=name||null;
        if(!name){
          _i2iDims._set(0,0);
          _i2iResizeRow.style.display="none";
          _i2iUseOrigNote.style.display="none";
          _i2iUseOrigSize=true;
          S.i2iResizeLonger=0;
        }
        if(name){ i2iSlot.el.style.borderColor=""; tx(i2iSlotLbl,"Input Image"); i2iSlotLbl.style.color=C.muted; }
        persist();
      },(w,h)=>{
        if(w&&h){
          _i2iDims._set(w,h);
          _i2iResizeRow.style.display="flex";
          _i2iApplyState();
        } else {
          _i2iDims._set(0,0);
          _i2iResizeRow.style.display="none";
          _i2iUseOrigNote.style.display="none";
        }
      });
      const i2iSlotLbl=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em",textAlign:"center"});
      tx(i2iSlotLbl,"Input Image");
      i2iSlotCard.append(i2iSlot.el,i2iSlotLbl,_i2iDims);
      i2iSlotRow.append(i2iSlotCard);

      // Denoise slider — 0 = no change, 100 = full generation
      const i2iSliderWrap=mk("div",{display:"flex",flexDirection:"column",gap:"2px"});
      const i2iSliderHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between"});
      const i2iSliderLbl=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,letterSpacing:".05em",textTransform:"uppercase"});
      tx(i2iSliderLbl,"Change strength");
      const i2iSliderVal=mk("div",{fontSize:"9px",fontWeight:"700",color:LIME});
      tx(i2iSliderVal,`${Math.round((S.i2iDenoise||0.75)*100)}%`);
      i2iSliderHdr.append(i2iSliderLbl,i2iSliderVal);

      const i2iSlider=mk("input",{
        width:"100%",cursor:"pointer",accentColor:LIME,height:"18px",display:"block",
      },{type:"range",min:"0",max:"100",step:"1",value:String(Math.round((S.i2iDenoise||0.75)*100))});
      const _i2iSliderSet=(pct)=>{
        pct=Math.max(0,Math.min(100,pct));
        i2iSlider.value=String(pct);
        S.i2iDenoise=pct/100;
        tx(i2iSliderVal,`${pct}%`);
        persist();
      };
      i2iSlider.oninput=()=>_i2iSliderSet(parseInt(i2iSlider.value));
      i2iSlider.addEventListener("mouseup",()=>i2iSlider.blur());
      i2iSlider.addEventListener("touchend",()=>i2iSlider.blur());
      i2iSlider.addEventListener("wheel",(e)=>{
        e.preventDefault();e.stopPropagation();
        _i2iSliderSet(parseInt(i2iSlider.value)+(e.deltaY<0?1:-1)*(e.shiftKey?10:1));
      },{passive:false});

      i2iSliderWrap.append(i2iSliderHdr,i2iSlider);
      i2iPanel.append(i2iSlotRow,_i2iUseOrigNote,_i2iResizeRow,i2iSliderWrap);

      if(S.i2iImage) i2iSlot._restorePreview(S.i2iImage);

      // ── IMAGE SLOTS (EDIT mode) ───────────────────────────────────────────
      const editPanel=mk("div",{display:"flex",flexDirection:"column",gap:"6px"});
      const imgSlotsRow=mk("div",{display:"flex",gap:"10px",alignItems:"flex-start"});

      // Track which image is the "use size" source: null | "img1" | "img2"
      // When set, that image's dimensions drive EmptyFlux2LatentImage instead of manual size
      // useSizeFromImage1 is kept in S for backward compat (true = img1 active)
      let _useSizeSource=S.useSizeFromImage1?"img1":null; // "img1"|"img2"|null
      S.useSizeFromImage1=_useSizeSource==="img1";

      // Dims badge: shows WxH, click toggles "Use size" for that image
      const _mkDimsLbl=(slotKey)=>{
        const el=mk("div",{
          fontSize:"9px",fontWeight:"700",letterSpacing:".04em",
          textAlign:"center",minHeight:"16px",cursor:"default",
          transition:"color .2s, background .15s, border-color .15s",
          borderRadius:"5px",padding:"2px 6px",boxSizing:"border-box",
        });
        let _w=0,_h=0;
        const _refresh=()=>{
          const active=_useSizeSource===slotKey;
          if(_w&&_h){
            tx(el,`${_w}×${_h}`);
            if(active){
              el.style.color=LIME;
              el.style.background="rgba(240,255,65,.13)";
              el.style.border=`1px solid rgba(240,255,65,.5)`;
              el.style.boxShadow="0 0 0 1px rgba(240,255,65,.12)";
            } else {
              el.style.color=C.text;
              el.style.background=C.bg3;
              el.style.border=`1px solid ${C.borderH}`;
              el.style.boxShadow="none";
            }
            el.style.cursor="pointer";
            el.title=active?"Click to use manual size instead":"Click to use this image's size";
          } else {
            tx(el,"");
            el.style.background="transparent";
            el.style.border="1px solid transparent";
            el.style.boxShadow="none";
            el.style.cursor="default";
            el.title="";
          }
        };
        el._getDims=()=>({w:_w,h:_h});
        el._setRaw=(w,h)=>{ _w=w;_h=h;_refresh(); };
        el._set=(w,h)=>{
          const hadDims=!!(_w&&_h);
          _w=w;_h=h;
          // Auto-activate img1 the first time dimensions are loaded, if nothing is active yet
          if(!hadDims&&_w&&_h&&slotKey==="img1"&&!_useSizeSource){
            _useSizeSource="img1";
            S.useSizeFromImage1=true;
          }
          // If aspect ratio lock is active, update ratio from this new image
          if(_w&&_h&&typeof _arLocked!=="undefined"&&_arLocked){
            _arRatio=_w/_h;
          }
          _refresh();
        };
        el._refresh=_refresh;
        el.onclick=()=>{
          if(!_w||!_h) return;
          _useSizeSource=(_useSizeSource===slotKey)?null:slotKey;
          S.useSizeFromImage1=_useSizeSource==="img1";
          persist();updateSizeControls();
          dims1Lbl._refresh();dims2Lbl._refresh();
        };
        return el;
      };

      const dims1Lbl=_mkDimsLbl("img1");
      const dims2Lbl=_mkDimsLbl("img2");

      // Image card builder
      const _mkImgCard=(labelTxt,optional,onFile,dimsLbl)=>{
        const card=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
        const slot=ImgSlot(optional,onFile,(w,h)=>dimsLbl._set(w,h));
        const nameLbl=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,
          textTransform:"uppercase",letterSpacing:".07em",textAlign:"center"});
        tx(nameLbl,labelTxt);
        card.append(slot.el,nameLbl,dimsLbl);
        return{card,slot,nameLbl};
      };

      const {card:img1Card,slot:img1Slot,nameLbl:img1NameLbl}=_mkImgCard("Image 1",false,
        name=>{
          S.image1Name=name;persist();
          if(!name&&_useSizeSource==="img1"){ _useSizeSource=null;S.useSizeFromImage1=false;dims1Lbl._refresh(); }
          updateSizeControls();
          if(name){ img1Slot.el.style.borderColor=""; tx(img1NameLbl,"Image 1"); img1NameLbl.style.color=C.muted; }
        },
        dims1Lbl
      );

      const {card:img2Card,slot:img2Slot}=_mkImgCard("Image 2",true,
        name=>{
          S.image2Name=name;persist();
          if(!name&&_useSizeSource==="img2"){ _useSizeSource=null;S.useSizeFromImage1=false;dims2Lbl._refresh(); }
        },
        dims2Lbl
      );
      // Image 2 is always visible — optional but always shown

      // Swap button between Edit image slots — marginTop aligns it to center of the 88px slot
      const _editSwapBtn=mk("button",{
        background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",
        width:"24px",height:"24px",padding:"0",cursor:"pointer",color:C.muted,outline:"none",
        flexShrink:"0",marginTop:"32px",
        display:"flex",alignItems:"center",justifyContent:"center",lineHeight:"0",
        transition:"border-color .15s,color .15s",
      });
      _editSwapBtn.title="Swap Image 1 ↔ Image 2";
      _editSwapBtn.innerHTML=`<svg viewBox="0 0 10 14" width="9" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1L1 3.5L3 6"/><line x1="1" y1="3.5" x2="9" y2="3.5"/><path d="M7 8L9 10.5L7 13"/><line x1="9" y1="10.5" x2="1" y2="10.5"/></svg>`;
      _editSwapBtn.onmouseenter=()=>{_editSwapBtn.style.borderColor=LIME;_editSwapBtn.style.color=LIME;};
      _editSwapBtn.onmouseleave=()=>{_editSwapBtn.style.borderColor=C.border;_editSwapBtn.style.color=C.muted;};
      _editSwapBtn.onclick=()=>{
        const n1=S.image1Name,n2=S.image2Name;
        S.image1Name=n2||null;S.image2Name=n1||null;
        img1Slot._restorePreview(S.image1Name);
        img2Slot._restorePreview(S.image2Name);
        const d1=dims1Lbl._getDims(),d2=dims2Lbl._getDims();
        // Swap dims without triggering auto-activate logic
        dims1Lbl._setRaw(d2.w||0,d2.h||0);
        dims2Lbl._setRaw(d1.w||0,d1.h||0);
        if(S.image1Name){ img1Slot.el.style.borderColor=""; tx(img1NameLbl,"Image 1"); img1NameLbl.style.color=C.muted; }
        // Keep _useSizeSource consistent — if it was on img1, swap to img2 and vice versa
        if(_useSizeSource==="img1") _useSizeSource="img2";
        else if(_useSizeSource==="img2") _useSizeSource="img1";
        S.useSizeFromImage1=_useSizeSource==="img1";
        dims1Lbl._refresh(); dims2Lbl._refresh();
        updateSizeControls();persist();
      };

      const sizeFromImg1Note=mk("div",{fontSize:"8px",color:LIME,display:"none",marginTop:"0"});
      imgSlotsRow.append(img1Card,_editSwapBtn,img2Card);
      editPanel.append(imgSlotsRow,sizeFromImg1Note);

      // Restore saved images
      if(S.image1Name) img1Slot._restorePreview(S.image1Name);
      if(S.image2Name) img2Slot._restorePreview(S.image2Name);

      // ── INPAINT PANEL (placeholder) ───────────────────────────────────────
      // ── PAINT PANEL ──────────────────────────────────────────────────────
      const inpaintPanel=mk("div",{display:"flex",flexDirection:"column",gap:"8px"});

      // Image slot + action buttons row
      const _paintTopRow=mk("div",{display:"flex",gap:"10px",alignItems:"flex-start"});

      // PAINT dims label — always locked to image size, not clickable
      const _paintDimsLbl=mk("div",{
        fontSize:"9px",fontWeight:"600",letterSpacing:".03em",
        textAlign:"center",cursor:"default",display:"none",
        borderRadius:"5px",padding:"2px 6px",boxSizing:"border-box",
        border:`1px solid rgba(240,255,65,.4)`,background:"rgba(240,255,65,.08)",color:LIME,
      });
      const _paintSnapLbl=mk("span",{
        fontSize:"9px",fontWeight:"700",color:LIME,letterSpacing:".03em",
        display:"none",whiteSpace:"nowrap",
        position:"absolute",left:"calc(100% + 4px)",top:"50%",transform:"translateY(-50%)",
      });
      const _paintDimsBadgeRow=mk("div",{
        position:"relative",display:"none",
      });
      let _paintDimsW=0,_paintDimsH=0;
      let _paintUseDimsFromImg=true; // always true in PAINT
      const _paintRefreshDimsLbl=()=>{
        if(typeof _paintUpdateSizeNote==="function") _paintUpdateSizeNote();
        if(_paintDimsW&&_paintDimsH){
          tx(_paintDimsLbl,`${_paintDimsW}×${_paintDimsH}`);
          _paintDimsLbl.style.display="block";
          _paintUseDimsFromImg=true;
          // Snap preview only for sketch mode (EmptyLatent used); inpaint/outpaint output = input dims
          if(_paintMode==="sketch"){
            const sw=snapRes(_paintDimsW), sh=snapRes(_paintDimsH);
            if(sw!==_paintDimsW||sh!==_paintDimsH){
              tx(_paintSnapLbl,`→ ${sw}×${sh}`);
              _paintSnapLbl.style.display="block";
            } else {
              _paintSnapLbl.style.display="none"; tx(_paintSnapLbl,"");
            }
          } else {
            _paintSnapLbl.style.display="none"; tx(_paintSnapLbl,"");
          }
          _paintDimsBadgeRow.style.display="block";
        } else {
          _paintDimsBadgeRow.style.display="none";
          _paintDimsLbl.style.display="none";
          _paintSnapLbl.style.display="none";
          tx(_paintDimsLbl,""); tx(_paintSnapLbl,"");
          _paintUseDimsFromImg=false;
        }
      };

      // Uploaded mask filename — declared here so _paintSlot callback can reset it on new image load
      let _maskName=null;
      let _opMaskName=null;  // uploaded outpaint mask (white=new area)
      let _inpaintPromptSet=false;  // true after first inpaint Apply — prevents overwriting user prompt
      let _outpaintPromptSet=false; // true after first outpaint Apply Changes
      let _sketchPromptSet=false;   // true after first Save sketch
      let _opPaddedW=0,_opPaddedH=0; // actual dims of uploaded padded image
      let _opLetterbox=null; // {dx,dy,dw,dh,fw,fh} when letterbox resize was applied

      const _paintSlotCard=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
      const _paintSlot=ImgSlot(false,(name)=>{
        if(!name){ _paintDimsW=0;_paintDimsH=0;_paintUseDimsFromImg=false;_paintRefreshDimsLbl(); }
        // New image loaded — old mask/outpaint are no longer valid (skip during overlay internal uploads)
        if(!_sketchSaving){
          _maskName=null;_opMaskName=null;_opPaddedW=0;_opPaddedH=0;_opLetterbox=null;
          _sketchLoadedSlotName=null;
          _inpaintPromptSet=false;_outpaintPromptSet=false;
          if(typeof _maskSavedData!=="undefined"){ _maskSavedData=null;_maskSavedW=0;_maskSavedH=0; }
        }
        const sub=_inpaintBtn?.querySelectorAll("div")[1];
        if(sub) tx(sub,"Paint mask over image");
        if(name){ _paintSlot.el.style.borderColor=""; tx(_paintSlotLbl,"Image"); _paintSlotLbl.style.color=C.muted; }
      },(w,h)=>{
        _paintDimsW=w;_paintDimsH=h;
        if(w&&h&&!_paintUseDimsFromImg){ _paintUseDimsFromImg=true; }
        _paintRefreshDimsLbl();
      });
      const _paintSlotLbl=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em",textAlign:"center"});
      tx(_paintSlotLbl,"Image");
      _paintDimsBadgeRow.append(_paintDimsLbl,_paintSnapLbl);
      _paintSlotCard.append(_paintSlot.el,_paintSlotLbl,_paintDimsBadgeRow);

      // Action buttons column
      const _paintActCol=mk("div",{display:"flex",flexDirection:"column",gap:"6px",flex:"1"});

      const _mkPaintActionBtn=(label,sublabel)=>{
        const b=mk("button",{
          background:C.bg2,border:`1px solid ${C.borderH}`,borderRadius:"8px",
          cursor:"pointer",outline:"none",padding:"8px 10px",
          display:"flex",flexDirection:"column",gap:"2px",alignItems:"flex-start",
          transition:"border-color .15s,background .15s",width:"100%",textAlign:"left",
        });
        const lbl=mk("div",{fontSize:"10px",fontWeight:"700",color:C.text,letterSpacing:".03em"});
        tx(lbl,label);
        b.appendChild(lbl);
        if(sublabel){
          const sub=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.4"});
          tx(sub,sublabel);
          b.appendChild(sub);
        }
        b.onmouseenter=()=>{b.style.borderColor=LIME;b.style.background=C.bg3;};
        b.onmouseleave=()=>{b.style.borderColor=C.borderH;b.style.background=C.bg2;};
        return b;
      };

      const _sketchBtn=_mkPaintActionBtn("✏ Sketch","Draw on a blank canvas");
      const _inpaintBtn=_mkPaintActionBtn("◈ Inpaint / Outpaint","Paint mask over image");

      // Paint sub-mode: which workflow button is active
      let _paintMode=null; // "sketch" | "inpaint" | null
      const _setPaintMode=(mode)=>{
        _paintMode=mode;
        const sketchActive=mode==="sketch";
        const inpaintActive=mode==="inpaint";
        _sketchBtn.style.background=sketchActive?"rgba(240,255,65,.12)":C.bg2;
        _sketchBtn.style.borderColor=sketchActive?LIME:C.borderH;
        _sketchBtn.querySelector("div").style.color=sketchActive?LIME:C.text;
        _inpaintBtn.style.background=inpaintActive?"rgba(240,255,65,.12)":C.bg2;
        _inpaintBtn.style.borderColor=inpaintActive?LIME:C.borderH;
        _inpaintBtn.querySelector("div").style.color=inpaintActive?LIME:C.text;
      };

      _paintActCol.append(_sketchBtn,_inpaintBtn);
      _paintTopRow.append(_paintSlotCard,_paintActCol);

      // Paint size — always from image (fixed). No dropdown, no label.
      const _paintResDD={value:"Custom…",updateItems:()=>{},set:()=>{}};
      const _paintCustomRow=mk("div",{display:"none"});
      const _paintWInp=NI("w",S.customW||1024,64,4096,8,()=>{},"80px");
      const _paintHInp=NI("h",S.customH||1024,64,4096,8,()=>{},"80px");
      _paintCustomRow.append(_paintWInp,_paintHInp);
      const _paintUpdateSizeNote=()=>{}; // no-op — no visible note

      inpaintPanel.append(_paintTopRow);

      // ── SKETCH OVERLAY (inside root, full node area) ──────────────────────
      const _sketchOv=mk("div",{
        position:"absolute",inset:"0",zIndex:"270",background:C.bg0,
        display:"none",flexDirection:"column",boxSizing:"border-box",
        opacity:"0",transition:"opacity 0.15s ease",
      });

      // ── Sketch state ──────────────────────────────────────────────────────
      let _sketchZoom=1;
      let _sketchPanX=0,_sketchPanY=0;
      let _sketchTool="move";    // "brush"|"eraser"|"move"|"rect"|"circle"
      let _sketchColor="#000000";
      let _sketchSize=8;
      let _sketchDrawing=false;
      let _sketchLastX=0,_sketchLastY=0;

      // Layers: each layer has {canvas, ctx, name, visible, _ox, _oy}
      let _sketchLayers=[];
      let _sketchActiveLayer=0;
      let _sketchLoadedSlotName=null; // name of paint slot image currently loaded as sketch layer
      let _sketchSaving=false; // true during sketch save upload — suppresses slot onFile reset

      // ── Shared helpers ────────────────────────────────────────────────────
      const _skBtnSep=()=>mk("div",{width:"1px",height:"16px",background:C.border,flexShrink:"0"});
      const _mkSkTool=(label,title)=>{
        const b=mk("button",{
          background:"transparent",border:"none",borderRadius:"7px",
          padding:"0",width:"44px",height:"44px",flexShrink:"0",
          cursor:"pointer",outline:"none",transition:"all .15s",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"3px",
          color:C.muted,
        });
        const icon=mk("div",{fontSize:"15px",lineHeight:"1",pointerEvents:"none"});
        tx(icon,label.split(" ")[0]);
        const lbl=mk("div",{fontSize:"7px",fontWeight:"700",letterSpacing:".04em",
          textTransform:"uppercase",pointerEvents:"none",lineHeight:"1"});
        tx(lbl,label.split(" ").slice(1).join(" ")||label);
        b.append(icon,lbl);
        b.title=title;
        b._setActive=(on)=>{
          b._active=on;
          b.style.background=on?"rgba(240,255,65,.15)":"transparent";
          b.style.color=on?LIME:C.muted;
          if(on) b.style.boxShadow=`inset 2px 0 0 ${LIME}`; else b.style.boxShadow="none";
        };
        b.onmouseenter=()=>{if(!b._active){b.style.background="rgba(255,255,255,.06)";b.style.color="#fff";}};
        b.onmouseleave=()=>{if(!b._active){b.style.background="transparent";b.style.color=C.muted;}};
        return b;
      };

      // ── Top bar ───────────────────────────────────────────────────────────
      const _sketchTopBar=mk("div",{
        display:"flex",alignItems:"center",gap:"8px",flexShrink:"0",
        padding:"12px 12px",borderBottom:`1px solid ${C.border}`,background:C.bg1,
        minWidth:"0",overflow:"visible",position:"relative",
      });

      // ── Canvas Size group (framed) ───────────────────────────────────────
      const _sketchSizeGroup=mk("div",{
        display:"flex",alignItems:"center",gap:"5px",flexShrink:"0",
        border:`1.5px solid rgba(240,255,65,.35)`,borderRadius:"7px",
        padding:"3px 8px",background:"rgba(240,255,65,.04)",
      });
      const _skSzLabel=mk("div",{fontSize:"8px",fontWeight:"700",color:LIME,letterSpacing:".07em",
        textTransform:"uppercase",flexShrink:"0"});
      tx(_skSzLabel,"Canvas");
      let _skArLocked=false;
      let _skArRatio=null;
      const _skArLockBtn=mk("button",{
        width:"20px",height:"20px",borderRadius:"4px",flexShrink:"0",
        background:"transparent",border:`1px solid ${C.border}`,
        color:C.muted,cursor:"pointer",outline:"none",padding:"0",
        display:"flex",alignItems:"center",justifyContent:"center",
        transition:"border-color .15s,color .15s,background .15s",
      });
      const _skLockIconOpen=`<svg viewBox="0 0 12 14" width="10" height="11" fill="currentColor"><rect x="1" y="6" width="10" height="8" rx="1.5"/><path d="M3.5 6V4a2.5 2.5 0 015 0" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
      const _skLockIconClosed=`<svg viewBox="0 0 12 14" width="10" height="11" fill="currentColor"><rect x="1" y="6" width="10" height="8" rx="1.5"/><path d="M3.5 6V4a2.5 2.5 0 015 0v2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
      _skArLockBtn.innerHTML=_skLockIconOpen;
      _skArLockBtn.title="Lock aspect ratio";
      _skArLockBtn.onclick=()=>{
        _skArLocked=!_skArLocked;
        if(_skArLocked) _skArRatio=(_sketchWInp.numVal||1024)/(_sketchHInp.numVal||1024);
        _skArLockBtn.style.borderColor=_skArLocked?LIME:C.border;
        _skArLockBtn.style.color=_skArLocked?LIME:C.muted;
        _skArLockBtn.style.background=_skArLocked?"rgba(240,255,65,.08)":"transparent";
        _skArLockBtn.innerHTML=_skArLocked?_skLockIconClosed:_skLockIconOpen;
      };
      const _sketchWInp=NI("W",1024,64,4096,8,(v)=>{
        if(_skArLocked&&_skArRatio) _sketchHInp.setVal(Math.max(64,Math.round(v/_skArRatio)));
      },"66px");
      const _sketchHInp=NI("H",1024,64,4096,8,(v)=>{
        if(_skArLocked&&_skArRatio) _sketchWInp.setVal(Math.max(64,Math.round(v*_skArRatio)));
      },"66px");
      _sketchWInp._inp.addEventListener("keydown",e=>{ if(e.key==="Tab"&&!e.shiftKey){ e.preventDefault(); _sketchHInp._inp.focus(); _sketchHInp._inp.select(); } });
      _sketchHInp._inp.addEventListener("keydown",e=>{ if(e.key==="Tab"&&e.shiftKey){ e.preventDefault(); _sketchWInp._inp.focus(); _sketchWInp._inp.select(); } });
      const _sketchXLbl=mk("button",{
        background:"transparent",border:"none",cursor:"pointer",padding:"0 1px",
        color:C.muted,outline:"none",flexShrink:"0",lineHeight:"0",
        transition:"color .12s",display:"flex",alignItems:"center",
      });
      _sketchXLbl.innerHTML=`<svg viewBox="0 0 10 14" width="9" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1L1 3.5L3 6"/><line x1="1" y1="3.5" x2="9" y2="3.5"/><path d="M7 8L9 10.5L7 13"/><line x1="9" y1="10.5" x2="1" y2="10.5"/></svg>`;
      _sketchXLbl.title="Swap W and H";
      _sketchXLbl.onmouseenter=()=>_sketchXLbl.style.color=LIME;
      _sketchXLbl.onmouseleave=()=>_sketchXLbl.style.color=C.muted;
      _sketchXLbl.onclick=()=>{
        if(_sketchSizeApplied) return;
        const w=_sketchWInp.numVal, h=_sketchHInp.numVal;
        _sketchWInp.setVal(h); _sketchHInp.setVal(w);
      };
      const _sketchResApplyBtn=mk("button",{
        background:"rgba(240,255,65,.15)",border:`1px solid ${LIME}`,borderRadius:"4px",
        padding:"3px 8px",fontSize:"9px",fontWeight:"700",color:LIME,
        cursor:"pointer",outline:"none",transition:"background .12s",whiteSpace:"nowrap",flexShrink:"0",
      });
      tx(_sketchResApplyBtn,"Apply");
      let _sketchSizeApplied=false;
      const _sketchSetSizeApplied=(applied)=>{
        _sketchSizeApplied=applied;
        _sketchResApplyBtn.innerHTML=applied?`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:3px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit`:"Apply";
        _sketchResApplyBtn.style.background=applied?"rgba(255,255,255,.08)":"rgba(240,255,65,.15)";
        _sketchResApplyBtn.style.borderColor=applied?"rgba(255,255,255,.25)":LIME;
        _sketchResApplyBtn.style.color=applied?"rgba(255,255,255,.6)":LIME;
        _sketchResApplyBtn.style.fontStyle="normal";
        _sketchResApplyBtn.style.display="flex";
        _sketchResApplyBtn.style.alignItems="center";
        _sketchWInp._inp.disabled=applied;
        _sketchHInp._inp.disabled=applied;
        _sketchWInp.style.opacity=applied?"0.4":"1";
        _sketchHInp.style.opacity=applied?"0.4":"1";
        _sketchXLbl.style.opacity=applied?"0.4":"1";
      };
      _sketchResApplyBtn.onmouseenter=()=>{
        if(_sketchSizeApplied){ _sketchResApplyBtn.style.background="rgba(255,255,255,.15)";_sketchResApplyBtn.style.color="#fff"; }
        else _sketchResApplyBtn.style.background="rgba(240,255,65,.28)";
      };
      _sketchResApplyBtn.onmouseleave=()=>{
        if(_sketchSizeApplied){ _sketchResApplyBtn.style.background="rgba(255,255,255,.08)";_sketchResApplyBtn.style.color="rgba(255,255,255,.6)"; }
        else _sketchResApplyBtn.style.background="rgba(240,255,65,.15)";
      };
      _sketchSizeGroup.append(_skSzLabel,_sketchWInp,_sketchXLbl,_sketchHInp,_skArLockBtn,_sketchResApplyBtn);

      // _sketchColorSwatch placeholder — real swatch built in left toolbar below
      const _sketchColorSwatch=mk("div",{display:"none"});
      // _sketchSizeSlider/_sketchSizeNumInp — referenced by toolbar for sync
      const _sketchSizeSlider=mk("input",{display:"none"},{type:"range",min:"1",max:"500",value:"8"});
      const _sketchSizeNumInp=mk("input",{display:"none"},{type:"number",min:"1",max:"500",value:"8"});

      // ── Zoom ─────────────────────────────────────────────────────────────
      const _mkZBtn=(t,icon)=>{
        const b=mk("button",{background:C.bg3,border:`1px solid ${C.borderH}`,borderRadius:"4px",
          width:"22px",height:"22px",cursor:"pointer",outline:"none",color:C.muted,fontSize:"13px",
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:"0",transition:"color .12s,border-color .12s"});
        tx(b,icon);b.title=t;
        b.onmouseenter=()=>{b.style.borderColor=LIME;b.style.color=LIME;};
        b.onmouseleave=()=>{b.style.borderColor=C.borderH;b.style.color=C.muted;};
        return b;
      };
      const _sketchZoomIn=_mkZBtn("Zoom in","+");
      const _sketchZoomOut=_mkZBtn("Zoom out","−");
      const _sketchZoomReset=mk("button",{background:C.bg3,border:`1px solid ${C.borderH}`,borderRadius:"4px",
        padding:"0 6px",height:"22px",cursor:"pointer",outline:"none",color:C.muted,fontSize:"9px",fontWeight:"700",
        display:"flex",alignItems:"center",justifyContent:"center",flexShrink:"0",whiteSpace:"nowrap",
        transition:"color .12s,border-color .12s"});
      tx(_sketchZoomReset,"⊙ Fit");
      _sketchZoomReset.onmouseenter=()=>{_sketchZoomReset.style.borderColor=LIME;_sketchZoomReset.style.color=LIME;};
      _sketchZoomReset.onmouseleave=()=>{_sketchZoomReset.style.borderColor=C.borderH;_sketchZoomReset.style.color=C.muted;};

      const _mkActBtn=(label,hoverColor)=>{
        const hc=hoverColor||LIME;
        const b=mk("button",{background:C.bg3,border:`1px solid ${C.borderH}`,borderRadius:"4px",
          padding:"0 8px",height:"22px",cursor:"pointer",outline:"none",color:C.muted,fontSize:"9px",fontWeight:"700",
          display:"flex",alignItems:"center",gap:"3px",flexShrink:"0",transition:"color .12s,border-color .12s"});
        tx(b,label);
        b.onmouseenter=()=>{b.style.borderColor=hc;b.style.color=hc;};
        b.onmouseleave=()=>{b.style.borderColor=C.borderH;b.style.color=C.muted;};
        return b;
      };
      const _sketchUndoBtn=_mkActBtn("↩ Undo");
      const _sketchClearBtn=_mkActBtn("Clear","#e05555");

      const _sketchSaveBtn=mk("button",{
        background:LIME,color:"#111",border:"none",borderRadius:"4px",
        padding:"0 12px",height:"22px",fontSize:"9px",fontWeight:"700",
        cursor:"pointer",outline:"none",whiteSpace:"nowrap",transition:"opacity .15s",flexShrink:"0",
      });
      tx(_sketchSaveBtn,"Save sketch");
      _sketchSaveBtn.onmouseenter=()=>_sketchSaveBtn.style.opacity=".8";
      _sketchSaveBtn.onmouseleave=()=>_sketchSaveBtn.style.opacity="1";

      const _sketchCloseBtn=mk("button",{background:"none",border:"none",cursor:"pointer",
        color:C.muted,fontSize:"18px",lineHeight:"1",padding:"2px 6px",outline:"none",
        display:"flex",alignItems:"center",borderRadius:"4px",transition:"color .15s",flexShrink:"0"});
      tx(_sketchCloseBtn,"×");
      _sketchCloseBtn.onmouseenter=()=>_sketchCloseBtn.style.color="#fff";
      _sketchCloseBtn.onmouseleave=()=>_sketchCloseBtn.style.color=C.muted;
      const _closeSketch=()=>{
        if(_sketchFullscreen) _sketchFsExit();
        _sketchOv.style.opacity="0";
        setTimeout(()=>{
          _sketchOv.style.display="none";
          // Return focus to canvas so node shortcuts work again
          if(document.activeElement&&_sketchOv.contains(document.activeElement)){
            document.activeElement.blur();
          }
        },160);
      };
      _sketchCloseBtn.onclick=_closeSketch;

      const _sketchTopCenter=mk("div",{
        display:"flex",alignItems:"center",gap:"8px",flexShrink:"0",
        position:"absolute",left:"50%",transform:"translateX(-50%)",
      });
      _sketchTopCenter.append(_sketchSizeGroup,_skBtnSep(),_sketchZoomOut,_sketchZoomReset,_sketchZoomIn,_skBtnSep(),_sketchUndoBtn,_sketchClearBtn);
      const _sketchTopRight=mk("div",{display:"flex",alignItems:"center",gap:"8px",marginLeft:"auto"});

      // Fullscreen toggle for sketch
      let _sketchFullscreen=false;
      const _sketchFsBtn=mk("button",{background:"none",border:"none",cursor:"pointer",
        color:C.muted,padding:"2px 4px",outline:"none",display:"flex",alignItems:"center",
        borderRadius:"4px",transition:"color .15s",flexShrink:"0"});
      _sketchFsBtn.innerHTML=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
      _sketchFsBtn.title="Toggle fullscreen sketch";
      _sketchFsBtn.onmouseenter=()=>_sketchFsBtn.style.color="#fff";
      _sketchFsBtn.onmouseleave=()=>_sketchFsBtn.style.color=C.muted;
      let _sketchFsOrigParent=null;
      let _sketchFsOrigZoom=1,_sketchFsOrigPanX=0,_sketchFsOrigPanY=0;
      const _sketchFsExit=()=>{
        _sketchFullscreen=false;
        if(_sketchFsOrigParent) _sketchFsOrigParent.appendChild(_sketchOv);
        _sketchOv.style.position="absolute";
        _sketchOv.style.inset="0";
        _sketchOv.style.zIndex="270";
        _sketchToolbar.style.zoom="";
        _sketchLayersPanel.style.zoom="";
        _sketchTopBar.style.zoom="";
        _sketchShortcutBar.style.zoom="";
        _sketchCloseBtn.style.display="";
        requestAnimationFrame(()=>_sketchDoFit());
      };
      _sketchFsBtn.onclick=()=>{
        _sketchFullscreen=!_sketchFullscreen;
        if(_sketchFullscreen){
          _sketchFsOrigZoom=_sketchZoom;
          _sketchFsOrigPanX=_sketchPanX;
          _sketchFsOrigPanY=_sketchPanY;
          _sketchFsOrigParent=_sketchOv.parentElement;
          document.body.appendChild(_sketchOv);
          _sketchOv.style.position="fixed";
          _sketchOv.style.inset="0";
          _sketchOv.style.zIndex="99999";
          _sketchToolbar.style.zoom="2";
          _sketchLayersPanel.style.zoom="2";
          _sketchTopBar.style.zoom="2";
          _sketchShortcutBar.style.zoom="2";
          _sketchCloseBtn.style.display="none";
          requestAnimationFrame(()=>_sketchDoFit());
        } else {
          _sketchFsExit();
        }
      };

      _sketchTopRight.append(_sketchSaveBtn,_sketchFsBtn,_sketchCloseBtn);
      _sketchTopBar.append(_sketchTopCenter,_sketchTopRight);

      // ── Tool buttons ──────────────────────────────────────────────────────
      const _sketchBrushBtn=_mkSkTool("✏ Brush","Brush [B]");
      const _sketchEraserBtn=_mkSkTool("◻ Eraser","Eraser [E]");
      const _sketchCircleBtn=_mkSkTool("○ Circle","Circle / Ellipse [C]");
      const _sketchRectBtn=_mkSkTool("□ Rect","Rectangle [R]");
      const _sketchMoveBtn=_mkSkTool("✥ Transform","Move / Scale / Rotate layer [V]");

      // ── Left tool sidebar ─────────────────────────────────────────────────
      const _sketchToolbar=mk("div",{
        width:"96px",flexShrink:"0",display:"flex",flexDirection:"column",
        alignItems:"stretch",gap:"0",padding:"6px 0",
        background:C.bg1,borderRight:`1px solid ${C.border}`,overflowY:"auto",
        boxSizing:"border-box",
      });

      // ── Brush Size & Hardness ─────────────────────────────────────────────
      // _sketchSoftness: 0=hard, 1=fully soft. Hardness slider is inverted: 100=hard, 0=soft.
      let _sketchSoftness=0;

      // Shared slider+number row builder
      const _mkSliderRow=(lbl,min,max,init,onSet)=>{
        const row=mk("div",{display:"grid",gridTemplateColumns:"1fr 32px",gap:"4px",alignItems:"center"});
        const lblEl=mk("div",{fontSize:"7px",color:C.muted,letterSpacing:".06em",
          textTransform:"uppercase",marginBottom:"1px",gridColumn:"1/-1"});
        tx(lblEl,lbl);
        const slider=mk("input",{width:"100%",cursor:"pointer",accentColor:LIME,
          display:"block",boxSizing:"border-box"},
          {type:"range",min:String(min),max:String(max),value:String(init)});
        const numInp=mk("input",{
          background:C.bg2,border:`1px solid ${C.borderH}`,borderRadius:"4px",
          color:C.text,fontSize:"9px",textAlign:"center",padding:"1px 2px",
          outline:"none",width:"100%",boxSizing:"border-box",
        },{type:"number",min:String(min),max:String(max),value:String(init)});
        numInp.onfocus=()=>numInp.style.borderColor=LIME;
        numInp.onblur=()=>numInp.style.borderColor=C.borderH;
        const set=(v)=>{
          v=Math.max(min,Math.min(max,parseInt(v)||min));
          slider.value=String(v);numInp.value=String(v);
          onSet(v);
        };
        slider.oninput=()=>set(slider.value);
        slider.addEventListener("mouseup",()=>slider.blur());
        slider.addEventListener("touchend",()=>slider.blur());
        numInp.oninput=()=>set(numInp.value);
        row.append(lblEl,slider,numInp);
        row._set=set;
        return row;
      };

      const _skSizeRow=_mkSliderRow("Size",1,500,8,(v)=>{
        _sketchSize=v;
        _sketchSizeSlider.value=String(Math.min(v,500));_sketchSizeNumInp.value=String(v);
      });
      _skSizeRow.title="Brush size — [ smaller · ] larger  (Shift = ×10)";
      // Allow typing beyond slider max — number input has no hard cap
      _skSizeRow.querySelector("input[type=number]").removeAttribute("max");
      const _skSoftRow=_mkSliderRow("Hardness",0,100,100,(v)=>{ _sketchSoftness=1-v/100; });
      _skSoftRow.addEventListener("wheel",(e)=>{
        e.preventDefault();e.stopPropagation();
        const delta=e.deltaY<0?1:-1;
        const cur=Math.round((1-_sketchSoftness)*100);
        const next=Math.max(0,Math.min(100,cur+delta*(e.shiftKey?10:1)));
        _sketchSoftness=1-next/100;
        _skSoftRow._set(next);
      },{passive:false});

      const _sketchSetSize=(v)=>{
        v=Math.max(1,Math.min(2000,parseInt(v)||1));
        _sketchSize=v;
        _sketchSizeSlider.value=String(Math.min(v,500));
        _sketchSizeNumInp.value=String(v);
        _skSizeRow._set(Math.min(v,500));
      };
      _sketchSizeSlider.oninput=()=>_sketchSetSize(_sketchSizeSlider.value);
      _sketchSizeNumInp.oninput=()=>_sketchSetSize(_sketchSizeNumInp.value);
      // Scroll wheel on size slider → change brush size
      _skSizeRow.addEventListener("wheel",(e)=>{
        e.preventDefault();e.stopPropagation();
        const delta=e.deltaY<0?1:-1;
        _sketchSetSize(_sketchSize+delta*(e.shiftKey?10:1));
      },{passive:false});

      // ── Color: foreground swatch + color picker ───────────────────────────
      const _skFgSwatch=mk("div",{
        width:"100%",height:"26px",borderRadius:"5px",background:"#000000",
        border:`1.5px solid ${C.borderH}`,cursor:"pointer",position:"relative",
        boxSizing:"border-box",
      });
      const _sketchColorNative=mk("input",{
        position:"absolute",inset:"0",opacity:"0",cursor:"pointer",width:"100%",height:"100%",
      },{type:"color",value:"#000000"});
      _skFgSwatch.appendChild(_sketchColorNative);
      _sketchColorNative.oninput=()=>{
        _sketchColor=_sketchColorNative.value;
        _skFgSwatch.style.background=_sketchColor;
        _sketchColorSwatch.style.background=_sketchColor;
      };
      // Release focus after picking so keyboard shortcuts keep working
      _sketchColorNative.onchange=()=>{ _sketchColorNative.blur(); };

      // ── Stroke/Fill toggle ────────────────────────────────────────────────
      const _mkSFBtnInline=(lbl)=>{
        const b=mk("button",{
          flex:"1",background:C.bg3,border:"none",padding:"3px 2px",fontSize:"8px",
          fontWeight:"700",cursor:"pointer",outline:"none",
          transition:"background .12s,color .12s",color:C.muted,whiteSpace:"nowrap",
        });
        tx(b,lbl);return b;
      };
      const _sketchStrokeBtn=_mkSFBtnInline("Stroke");
      const _sketchFillModeBtn=_mkSFBtnInline("Fill");
      const _skSFGroup=mk("div",{display:"flex",borderRadius:"4px",overflow:"hidden",
        border:`1px solid ${C.borderH}`});
      _skSFGroup.append(_sketchStrokeBtn,_sketchFillModeBtn);


      // Toolbar assembly — no scrollbar needed, compact groups
      const _mkGrp=(items)=>{
        const g=mk("div",{
          display:"flex",flexDirection:"column",gap:"5px",
          padding:"7px 8px",borderBottom:`1px solid ${C.border}`,
        });
        items.forEach(i=>g.appendChild(i));
        return g;
      };
      const _mkGrpLbl=(t)=>{
        const d=mk("div",{fontSize:"7px",fontWeight:"700",color:C.muted,
          letterSpacing:".1em",textTransform:"uppercase",textAlign:"center",marginBottom:"1px"});
        tx(d,t);return d;
      };
      const _mkBtnRow=(btns)=>{
        const r=mk("div",{display:"grid",gap:"3px",
          gridTemplateColumns:`repeat(${btns.length},1fr)`});
        btns.forEach(b=>{
          b.style.width="100%";b.style.height="32px";b.style.fontSize="8px";
          r.appendChild(b);
        });
        return r;
      };

      // ── Rotate slider — live preview, commits on mouseup ─────────────────
      let _skRotateAngle=0;
      let _skRotateOrigCanvas=null; // snapshot of layer at drag start
      let _skRotateOrigOX=0,_skRotateOrigOY=0;
      let _skRotateLayerIdx=-1;

      const _skRotateApply=(angle,commit)=>{
        const layer=_sketchLayers[_sketchActiveLayer];
        if(!layer||!_skRotateOrigCanvas) return;
        const rad=angle*Math.PI/180;
        const ow=_skRotateOrigCanvas.width, oh=_skRotateOrigCanvas.height;
        const cos=Math.abs(Math.cos(rad)), sin=Math.abs(Math.sin(rad));
        const nw=Math.ceil(ow*cos+oh*sin), nh=Math.ceil(ow*sin+oh*cos);
        const tmp=document.createElement("canvas");
        tmp.width=nw; tmp.height=nh;
        const tctx=tmp.getContext("2d");
        tctx.translate(nw/2,nh/2);
        tctx.rotate(rad);
        tctx.drawImage(_skRotateOrigCanvas,-ow/2,-oh/2);
        layer.canvas.width=nw; layer.canvas.height=nh;
        layer.ctx.drawImage(tmp,0,0);
        // Keep visual center of layer at same canvas position
        const origCx=_skRotateOrigOX+ow/2, origCy=_skRotateOrigOY+oh/2;
        layer._ox=Math.round(origCx-nw/2);
        layer._oy=Math.round(origCy-nh/2);
        layer._tightBBox=null;
        _sketchComposite();
        if(commit){
          _sketchComputeTightBBox(layer);
          _sketchRebuildLayerUI();
          _skRotateOrigCanvas=null;
        }
      };

      const _skRotateRow=_mkSliderRow("Rotate",-180,180,0,(v)=>{
        _skRotateAngle=v;
        const layer=_sketchLayers[_sketchActiveLayer];
        if(!layer) return;
        // Snapshot layer on first move
        if(!_skRotateOrigCanvas||_skRotateLayerIdx!==_sketchActiveLayer){
          if(!_skRotateOrigCanvas) _sketchSaveHistory();
          _skRotateLayerIdx=_sketchActiveLayer;
          _skRotateOrigCanvas=document.createElement("canvas");
          _skRotateOrigCanvas.width=layer.canvas.width;
          _skRotateOrigCanvas.height=layer.canvas.height;
          _skRotateOrigCanvas.getContext("2d").drawImage(layer.canvas,0,0);
          _skRotateOrigOX=layer._ox||0; _skRotateOrigOY=layer._oy||0;
        }
        _skRotateApply(v,false);
      });
      // Commit on mouseup/touchend
      _skRotateRow.querySelector("input[type=range]").addEventListener("change",()=>{
        _skRotateApply(_skRotateAngle,true);
      });
      // Reset to 0 on double-click of slider
      _skRotateRow.querySelector("input[type=range]").addEventListener("dblclick",()=>{
        _skRotateAngle=0; _skRotateRow._set(0);
        _skRotateOrigCanvas=null;
        _sketchRebuildLayerUI();
      });

      _sketchToolbar.append(
        _mkGrp([_mkGrpLbl("Draw"),_mkBtnRow([_sketchBrushBtn,_sketchEraserBtn])]),
        _mkGrp([_mkGrpLbl("Brush"),_skSizeRow,_skSoftRow]),
        _mkGrp([_mkGrpLbl("Color"),_skFgSwatch]),
        _mkGrp([_mkGrpLbl("Shapes"),_mkBtnRow([_sketchCircleBtn,_sketchRectBtn]),_skSFGroup]),
        _mkGrp([_mkBtnRow([_sketchMoveBtn])]),
      );

      // ── Sketch main row: left toolbar + viewport + layers panel ──────────
      const _sketchMainRow=mk("div",{display:"flex",flex:"1",minHeight:"0",overflow:"hidden"});

      // Viewport (pan/zoom container)
      const _sketchViewport=mk("div",{
        flex:"1",position:"relative",overflow:"hidden",background:"#1a1a1a",cursor:"crosshair",
      });
      _sketchViewport.classList.add("_fk_sketch_vp");

      // Placeholder shown before first Apply
      const _sketchPlaceholder=mk("div",{
        position:"absolute",inset:"0",display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",gap:"12px",pointerEvents:"none",
      });
      const _skPh1=mk("div",{fontSize:"13px",fontWeight:"700",color:"rgba(255,255,255,.35)",
        letterSpacing:".02em",textAlign:"center"});
      tx(_skPh1,"Set your canvas size above and click Apply");
      const _skPh2=mk("div",{fontSize:"10px",color:"rgba(255,255,255,.18)",textAlign:"center"});
      tx(_skPh2,"Enter width × height, then press Apply to create your drawing canvas");
      _sketchPlaceholder.append(_skPh1,_skPh2);
      _sketchViewport.appendChild(_sketchPlaceholder);

      // Inner transform container — hidden until first Apply
      const _sketchCanvasWrap=mk("div",{
        position:"absolute",top:"0",left:"0",
        transformOrigin:"0 0",
        boxShadow:"0 4px 32px rgba(0,0,0,.8)",
        overflow:"visible",display:"none",
      });
      _sketchViewport.appendChild(_sketchCanvasWrap);

      // Checkerboard background canvas (shows transparency)
      const _sketchCheckerCanvas=mk("canvas",{
        position:"absolute",top:"0",left:"0",display:"block",pointerEvents:"none",
      });
      _sketchCanvasWrap.appendChild(_sketchCheckerCanvas);

      const _sketchDrawChecker=(w,h)=>{
        _sketchCheckerCanvas.width=w;_sketchCheckerCanvas.height=h;
        const cc=_sketchCheckerCanvas.getContext("2d");
        const sz=12;
        for(let y=0;y<h;y+=sz) for(let x=0;x<w;x+=sz){
          cc.fillStyle=((x/sz+y/sz)%2===0)?"#b0b0b0":"#808080";
          cc.fillRect(x,y,sz,sz);
        }
      };

      // Display canvas — absolute inside wrapper, same size as canvas
      const _sketchDisplayCanvas=mk("canvas",{
        position:"absolute",top:"0",left:"0",display:"block",
      });
      const _sketchDisplayCtx=_sketchDisplayCanvas.getContext("2d");
      _sketchCanvasWrap.appendChild(_sketchDisplayCanvas);

      // ── Layer system ──────────────────────────────────────────────────────
      const _sketchLayersPanel=mk("div",{
        width:"190px",flexShrink:"0",display:"flex",flexDirection:"column",
        background:C.bg1,borderLeft:`1px solid ${C.border}`,
      });
      const _sketchLayersPHdr=mk("div",{
        display:"flex",flexDirection:"column",gap:"6px",
        padding:"8px 8px 7px",borderBottom:`1px solid ${C.border}`,flexShrink:"0",
      });
      const _sketchLayersPTitle=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,
        letterSpacing:".1em",textTransform:"uppercase"});
      tx(_sketchLayersPTitle,"Layers");

      // Helper: small layer-panel button, same style for both
      const _mkLayerPanelBtn=(label,title,accent)=>{
        const col=accent;
        const b=mk("button",{
          flex:"1",background:"transparent",
          border:`1px solid ${col}22`,borderRadius:"4px",
          padding:"4px 0",fontSize:"9px",fontWeight:"600",
          color:col,cursor:"pointer",outline:"none",letterSpacing:".03em",
          transition:"background .12s,border-color .12s",whiteSpace:"nowrap",
        });
        tx(b,label);b.title=title;
        b.onmouseenter=()=>{b.style.background=`${col}18`;b.style.borderColor=`${col}88`;};
        b.onmouseleave=()=>{b.style.background="transparent";b.style.borderColor=`${col}22`;};
        return b;
      };

      const _sketchAddLayerBtn=_mkLayerPanelBtn("＋ Layer","Add new blank layer",LIME);
      const _sketchAddImgLayerBtn=_mkLayerPanelBtn("＋ Image","Add image as layer",C.text);
      const _sketchImgLayerInp=mk("input",{display:"none"},{type:"file",accept:"image/*"});
      {
        let _imgBtnDownX=0,_imgBtnDownY=0,_imgBtnMoved=false;
        _sketchAddImgLayerBtn.addEventListener("mousedown",e=>{
          if(_sketchSpaceHeld){ e.preventDefault();e.stopImmediatePropagation();_sketchStartPan(e.clientX,e.clientY);return; }
          _imgBtnDownX=e.clientX;_imgBtnDownY=e.clientY;_imgBtnMoved=false;
        });
        _sketchAddImgLayerBtn.addEventListener("mousemove",e=>{
          if(Math.abs(e.clientX-_imgBtnDownX)>4||Math.abs(e.clientY-_imgBtnDownY)>4) _imgBtnMoved=true;
        });
        _sketchAddImgLayerBtn.addEventListener("mouseup",()=>{
          if(_sketchSpaceHeld||_sketchWasPanning||_imgBtnMoved) return;
          _sketchImgLayerInp.click();
        });
      }
      _sketchLayersPHdr.appendChild(_sketchImgLayerInp);

      // Multi-select state
      let _sketchSelectedLayers=new Set(); // indices of selected layers

      // Merge button — shown only when ≥2 layers selected
      const _sketchMergeBtn=_mkLayerPanelBtn("⊕ Merge","Merge selected layers","#f0b040");
      _sketchMergeBtn.style.display="none";
      _sketchMergeBtn.onclick=()=>{
        if(_sketchSelectedLayers.size<2) return;
        _sketchSaveHistory();
        // Sort indices bottom→top (higher index = lower in stack)
        const idxs=[..._sketchSelectedLayers].sort((a,b)=>b-a);
        // Merged canvas = full sketch size, draw from bottom layer up
        const merged=document.createElement("canvas");
        merged.width=_sketchCanvasW; merged.height=_sketchCanvasH;
        const mctx=merged.getContext("2d");
        // Draw in reverse (bottom to top = highest index first)
        [...idxs].reverse().forEach(i=>{
          const l=_sketchLayers[i];
          if(!l.visible) return;
          mctx.drawImage(l.canvas,l._ox||0,l._oy||0);
        });
        // Replace top selected layer with merged, remove the rest
        const topIdx=Math.min(...idxs); // lowest index = topmost layer
        _sketchLayers[topIdx].canvas=merged;
        _sketchLayers[topIdx].ctx=merged.getContext("2d",{willReadFrequently:true});
        _sketchLayers[topIdx]._ox=0; _sketchLayers[topIdx]._oy=0;
        _sketchLayers[topIdx].name="Merged";
        _sketchLayers[topIdx]._tightBBox=null;
        _sketchLayers[topIdx]._layerType=null;
        // Remove other selected layers (skip topIdx)
        const toRemove=idxs.filter(i=>i!==topIdx).sort((a,b)=>b-a);
        toRemove.forEach(i=>_sketchLayers.splice(i,1));
        _sketchActiveLayer=Math.min(topIdx,_sketchLayers.length-1);
        _sketchSelectedLayers.clear();
        _sketchComposite(); _sketchRebuildLayerUI();
      };

      // ── Remove BG (no longer a panel button — moved to layer row hover) ─────
      const _skRemoveBgBtn=mk("div"); // dummy — kept for _sketchRebuildLayerUI ref

      const _skRemoveBgRun=async()=>{
        const model=S.bgRemovalModel;
        if(!model){ alert("Select a BiRefNet model in Settings first."); return; }
        const layer=_sketchLayers[_sketchActiveLayer];
        if(!layer||layer._layerType!=="image"){ return; }
        // Show loading state on header button
        _skRmbgHdrBtn.disabled=true;
        _skRmbgHdrBtn.innerHTML=`<svg style="animation:fk-galSpin .7s linear infinite;display:inline-block;vertical-align:middle;margin-right:4px" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10" stroke-opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/></svg>Removing…`;
        try{
          // 1. Upload layer canvas as input image
          const flat=document.createElement("canvas");
          flat.width=layer.canvas.width; flat.height=layer.canvas.height;
          flat.getContext("2d").drawImage(layer.canvas,0,0);
          const blob=await new Promise(res=>flat.toBlob(res,"image/png"));
          const fname=`rmbg_src_${Date.now()}.png`;
          const fd=new FormData();
          fd.append("image",new File([blob],fname,{type:"image/png"}));
          fd.append("overwrite","false");
          const upR=await api.fetchApi("/upload/image",{method:"POST",body:fd});
          const upD=await upR.json();
          const uploadedName=upD.name||fname;

          // 2. Build prompt
          const wfR=await api.fetchApi("/flux_klein/workflow_remove_bg");
          const wf=await wfR.json();
          const prompt=JSON.parse(JSON.stringify(wf));
          prompt["rmbg:img"].inputs.image=uploadedName;
          prompt["rmbg:load"].inputs.bg_removal_name=model;

          // 3. Snapshot pre-run output files
          const preR=await api.fetchApi("/flux_klein/gallery?offset=0&limit=200&subfolder=one-node-flux-2-klein/assets");
          const preD=await preR.json();
          const preFiles=new Set((preD.images||[]).map(v=>v.filename));

          // 4. Submit
          const qR=await api.fetchApi("/prompt",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({prompt,client_id:api.clientId}),
          });
          const qD=await qR.json();
          if(qD.error){ throw new Error(fmtErr(qD.error)); }
          const promptId=qD.prompt_id;

          // 5. Wait for executed event
          await new Promise((resolve,reject)=>{
            const timeout=setTimeout(()=>{ cleanup(); reject(new Error("Timeout")); },120000);
            const cleanup=()=>{ api.removeEventListener("executed",handler); clearTimeout(timeout); };
            const handler=(ev)=>{
              const d=ev.detail||ev;
              if(d.prompt_id!==promptId) return;
              cleanup(); resolve(d);
            };
            api.addEventListener("executed",handler);
          });

          // 6. Find new output file
          await new Promise(r=>setTimeout(r,500));
          const postR=await api.fetchApi("/flux_klein/gallery?offset=0&limit=200&subfolder=one-node-flux-2-klein/assets");
          const postD=await postR.json();
          const newFile=(postD.images||[]).find(v=>v.filename.startsWith("rmbg")&&!preFiles.has(v.filename));
          if(!newFile) throw new Error("Output file not found");

          // 7. Load result back — fetch as blob, draw onto layer canvas preserving size/position
          const imgUrl=api.apiURL(`/view?filename=${encodeURIComponent(newFile.filename)}&type=output&subfolder=${encodeURIComponent(newFile.subfolder||"")}`);
          const imgResp=await fetch(imgUrl);
          const imgBlob=await imgResp.blob();
          const objUrl=URL.createObjectURL(imgBlob);
          await new Promise((res,rej)=>{
            const img=new Image(); img.crossOrigin="anonymous";
            img.onload=()=>{
              _sketchSaveHistory();
              layer.canvas.width=img.naturalWidth; layer.canvas.height=img.naturalHeight;
              layer.ctx.clearRect(0,0,img.naturalWidth,img.naturalHeight);
              layer.ctx.drawImage(img,0,0);
              layer._tightBBox=null;
              layer._bgRemoved=true;
              URL.revokeObjectURL(objUrl);
              _sketchComputeTightBBox(layer);
              _sketchComposite();
              _sketchRebuildLayerUI();
              res();
            };
            img.onerror=rej;
            img.src=objUrl;
          });
          // Show checkerboard (transparency visible)
          _sketchDrawChecker(_sketchCanvasW,_sketchCanvasH);
        }catch(err){
          console.warn("[FluxKlein] remove bg:",err);
          alert("Remove BG failed: "+fmtErr(err));
        }finally{
          _skRmbgHdrBtn.disabled=false;
          tx(_skRmbgHdrBtn,"Remove BG");
          _sketchRebuildLayerUI();
        }
      };
      _skRemoveBgBtn.onclick=_skRemoveBgRun;

      // ── Duplicate layer button ────────────────────────────────────────────
      const _skDupBtn=_mkLayerPanelBtn("⧉ Duplicate","Duplicate active layer",C.text);
      {
        let _dupBtnDownX=0,_dupBtnDownY=0,_dupBtnMoved=false;
        _skDupBtn.addEventListener("mousedown",e=>{
          if(_sketchSpaceHeld){e.preventDefault();e.stopImmediatePropagation();_sketchStartPan(e.clientX,e.clientY);return;}
          _dupBtnDownX=e.clientX;_dupBtnDownY=e.clientY;_dupBtnMoved=false;
        });
        _skDupBtn.addEventListener("mousemove",e=>{
          if(Math.abs(e.clientX-_dupBtnDownX)>4||Math.abs(e.clientY-_dupBtnDownY)>4) _dupBtnMoved=true;
        });
        _skDupBtn.addEventListener("mouseup",()=>{
          if(_sketchSpaceHeld||_sketchWasPanning||_dupBtnMoved) return;
          const src=_sketchLayers[_sketchActiveLayer];
          if(!src) return;
          _sketchSaveHistory();
          // Copy canvas
          const c=document.createElement("canvas");
          c.width=src.canvas.width; c.height=src.canvas.height;
          c.getContext("2d",{willReadFrequently:true}).drawImage(src.canvas,0,0);
          // Copy mask
          const {maskCanvas,maskCtx}=_sketchMakeMask();
          maskCanvas.width=src.maskCanvas.width; maskCanvas.height=src.maskCanvas.height;
          if(src.maskEnabled) maskCtx.drawImage(src.maskCanvas,0,0);
          const dupLayer={
            canvas:c, ctx:c.getContext("2d",{willReadFrequently:true}),
            maskCanvas, maskCtx, maskEnabled:src.maskEnabled,
            name:src.name+" copy", visible:src.visible,
            _ox:src._ox, _oy:src._oy,
            _tightBBox:src._tightBBox?{...src._tightBBox}:null,
            _layerType:src._layerType, _layerColor:src._layerColor,
            _shapeData:src._shapeData?{...src._shapeData}:null,
            _bgRemoved:src._bgRemoved||false,
          };
          // Insert directly above the source layer (index 0 = topmost)
          _sketchLayers.splice(_sketchActiveLayer,0,dupLayer);
          // Active layer stays at same index (now pointing to the duplicate on top)
          _sketchComposite();_sketchRebuildLayerUI();
        });
      }

      // ── Layer panel header: title + merge (multi-select) + "+" add menu ─────
      // "+" button opens a small dropdown: Blank Layer / Image Layer
      const _skAddMenuBtn=mk("button",{
        background:"transparent",border:`1px solid ${C.border}`,borderRadius:"4px",
        width:"22px",height:"22px",cursor:"pointer",color:C.muted,fontSize:"15px",lineHeight:"1",
        display:"flex",alignItems:"center",justifyContent:"center",padding:"0",outline:"none",
        flexShrink:"0",transition:"border-color .12s,color .12s",
      });
      tx(_skAddMenuBtn,"+");
      _skAddMenuBtn.onmouseenter=()=>{_skAddMenuBtn.style.borderColor=LIME;_skAddMenuBtn.style.color=LIME;};
      _skAddMenuBtn.onmouseleave=()=>{_skAddMenuBtn.style.borderColor=C.border;_skAddMenuBtn.style.color=C.muted;};

      // Dropdown menu
      const _skAddMenu=mk("div",{
        position:"absolute",top:"100%",right:"0",marginTop:"3px",
        background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"7px",
        display:"none",flexDirection:"column",zIndex:"50",
        boxShadow:"0 4px 16px rgba(0,0,0,.6)",overflow:"hidden",minWidth:"130px",
      });
      const _mkAddMenuItem=(label,icon,fn)=>{
        const item=mk("div",{display:"flex",alignItems:"center",gap:"7px",
          padding:"8px 12px",fontSize:"10px",fontWeight:"500",color:C.text,
          cursor:"pointer",transition:"background .1s,color .1s",userSelect:"none"});
        const ico=mk("span",{fontSize:"11px",width:"14px",textAlign:"center",color:C.muted,flexShrink:"0"});
        tx(ico,icon);const lbl=mk("span");tx(lbl,label);
        item.append(ico,lbl);
        item.onmouseenter=()=>{item.style.background="rgba(240,255,65,.10)";item.style.color=LIME;ico.style.color=LIME;};
        item.onmouseleave=()=>{item.style.background="";item.style.color=C.text;ico.style.color=C.muted;};
        item.onmousedown=e=>{e.preventDefault();e.stopPropagation();};
        item.onclick=e=>{e.stopPropagation();_skAddMenu.style.display="none";fn();};
        return item;
      };
      _skAddMenu.append(
        _mkAddMenuItem("Blank layer","▭",()=>{ if(_sketchSpaceHeld||_sketchWasPanning) return; _sketchSaveHistory();_sketchAddLayer();_sketchComposite(); }),
        _mkAddMenuItem("Image layer","⬚",()=>{ if(_sketchSpaceHeld||_sketchWasPanning) return; _sketchImgLayerInp.click(); }),
      );

      let _skAddMenuOpen=false;
      const _skAddMenuContainer=mk("div",{position:"relative"});
      _skAddMenuContainer.append(_skAddMenuBtn,_skAddMenu);
      _skAddMenuBtn.onclick=e=>{
        e.stopPropagation();
        _skAddMenuOpen=!_skAddMenuOpen;
        _skAddMenu.style.display=_skAddMenuOpen?"flex":"none";
      };
      document.addEventListener("click",()=>{if(_skAddMenuOpen){_skAddMenuOpen=false;_skAddMenu.style.display="none";}});

      // Remove BG header button — shown when active layer is image + model set
      const _skRmbgHdrBtn=mk("button",{
        background:"transparent",border:`1px solid rgba(224,112,112,.4)`,borderRadius:"4px",
        padding:"2px 6px",fontSize:"8px",fontWeight:"700",color:"#e07070",cursor:"pointer",
        outline:"none",flexShrink:"0",transition:"border-color .12s,background .12s",display:"none",
        whiteSpace:"nowrap",
      });
      tx(_skRmbgHdrBtn,"Remove BG");
      _skRmbgHdrBtn.onmouseenter=()=>{_skRmbgHdrBtn.style.borderColor="#e07070";_skRmbgHdrBtn.style.background="rgba(224,112,112,.12)";};
      _skRmbgHdrBtn.onmouseleave=()=>{_skRmbgHdrBtn.style.borderColor="rgba(224,112,112,.4)";_skRmbgHdrBtn.style.background="transparent";};
      _skRmbgHdrBtn.onclick=()=>_skRemoveBgRun();

      // Title row: "LAYERS" + merge btn + remove bg + add menu
      const _skLayerHdrRow=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"6px"});
      const _skLayerHdrRight=mk("div",{display:"flex",alignItems:"center",gap:"5px"});
      _sketchMergeBtn.style.fontSize="8px"; _sketchMergeBtn.style.padding="3px 7px";
      _skLayerHdrRight.append(_sketchMergeBtn,_skRmbgHdrBtn,_skAddMenuContainer);
      _skLayerHdrRow.append(_sketchLayersPTitle,_skLayerHdrRight);
      _sketchLayersPHdr.appendChild(_skLayerHdrRow);

      const _sketchLayersList=mk("div",{
        flex:"1",overflowY:"auto",display:"flex",flexDirection:"column",
        scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`,
      });
      _sketchLayersList.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
      _sketchLayersPanel.append(_sketchLayersPHdr,_sketchLayersList);

      // Block all clicks in layer panel while Space is held or immediately after panning ends
      _sketchLayersPanel.addEventListener("click",e=>{
        if(_sketchSpaceHeld||_sketchWasPanning) e.stopImmediatePropagation();
      },{capture:true});
      _sketchLayersPanel.addEventListener("mousedown",e=>{
        if(_sketchSpaceHeld){ e.preventDefault();e.stopImmediatePropagation();
          _sketchStartPan(e.clientX,e.clientY); }
      },{capture:true});

      let _sketchCanvasW=1024,_sketchCanvasH=1024;

      // Composite all visible layers with optional mask support.
      // Display canvas has NO white background fill — layers with alpha show as transparent
      // (checkerboard canvas underneath provides visual reference).
      const _sketchComposite=()=>{
        _sketchDisplayCtx.clearRect(0,0,_sketchCanvasW,_sketchCanvasH);
        for(let i=_sketchLayers.length-1;i>=0;i--){
          const l=_sketchLayers[i];
          if(!l.visible) continue;
          const ox=l._ox||0, oy=l._oy||0;
          if(l.maskEnabled&&l.maskCanvas){
            // Composite: draw layer through mask (white=reveal, black=hide)
            const tmp=document.createElement("canvas");
            tmp.width=_sketchCanvasW;tmp.height=_sketchCanvasH;
            const tx2=tmp.getContext("2d");
            tx2.drawImage(l.canvas,ox,oy);
            tx2.globalCompositeOperation="destination-in";
            tx2.drawImage(l.maskCanvas,0,0);
            _sketchDisplayCtx.drawImage(tmp,0,0);
          } else {
            _sketchDisplayCtx.drawImage(l.canvas,ox,oy);
          }
        }
      };

      // Drag-reorder state for layer panel
      let _skDragSrcIdx=-1;
      let _skDragOverIdx=-1;

      // Rebuild layer list UI — drag-to-reorder only via grip handle (⠿)
      const _sketchRebuildLayerUI=()=>{
        _sketchLayersList.innerHTML="";
        // Update merge button visibility
        _sketchMergeBtn.style.display=_sketchSelectedLayers.size>=2?"":"none";
        const _activeL2=_sketchLayers[_sketchActiveLayer];
        _skRmbgHdrBtn.style.display=(_activeL2&&_activeL2._layerType==="image"&&!_activeL2._bgRemoved&&!!S.bgRemovalModel)?"":"none";
        _sketchLayers.forEach((layer,i)=>{
          const isActive=i===_sketchActiveLayer;
          const isSelected=_sketchSelectedLayers.has(i);
          const row=mk("div",{
            display:"flex",alignItems:"center",gap:"5px",
            padding:"5px 7px",cursor:"default",
            background:isSelected?"rgba(240,180,40,.13)":(isActive?"rgba(240,255,65,.08)":"transparent"),
            borderLeft:isSelected?`2px solid #f0b040`:(isActive?`2px solid ${LIME}`:"2px solid transparent"),
            borderBottom:`1px solid ${C.border}`,
            borderTop:"2px solid transparent",
            transition:"background .1s, border-top-color .08s",boxSizing:"border-box",
          });

          // Drop target handlers on each row
          row.addEventListener("dragover",(e)=>{
            if(_skDragSrcIdx<0) return;
            e.preventDefault();e.stopPropagation();
            e.dataTransfer.dropEffect="move";
            if(_skDragOverIdx!==i){
              _skDragOverIdx=i;
              _sketchLayersList.querySelectorAll("[data-layerrow]").forEach(r=>r.style.borderTopColor="transparent");
              row.style.borderTopColor=LIME;
            }
          });
          row.addEventListener("dragleave",()=>{ row.style.borderTopColor="transparent"; });
          row.addEventListener("drop",(e)=>{
            e.preventDefault();e.stopPropagation();
            row.style.borderTopColor="transparent";
            const src=_skDragSrcIdx;const dst=i;
            if(src<0||src===dst) return;
            _sketchSaveHistory();
            const [moved]=_sketchLayers.splice(src,1);
            const insertAt=dst>src?dst-1:dst;
            _sketchLayers.splice(insertAt,0,moved);
            _sketchActiveLayer=insertAt;
            _sketchComposite();_sketchRebuildLayerUI();
          });
          row.dataset.layerrow="1";

          // ── Grip handle — drag starts only from here ──
          const gripBtn=mk("div",{
            cursor:"grab",padding:"2px 4px 2px 2px",fontSize:"10px",
            color:"#555",flexShrink:"0",lineHeight:"1",userSelect:"none",
          });
          tx(gripBtn,"⠿");gripBtn.title="Drag to reorder";
          gripBtn.draggable=true;
          gripBtn.addEventListener("dragstart",(e)=>{
            _skDragSrcIdx=i;
            e.dataTransfer.effectAllowed="move";
            e.dataTransfer.setData("text/plain",String(i));
            setTimeout(()=>row.style.opacity="0.4",0);
          });
          gripBtn.addEventListener("dragend",()=>{
            row.style.opacity="1";
            _skDragSrcIdx=-1;_skDragOverIdx=-1;
            _sketchLayersList.querySelectorAll("[data-layerrow]").forEach(r=>r.style.borderTopColor="transparent");
          });
          gripBtn.onmouseenter=()=>gripBtn.style.color=C.muted;
          gripBtn.onmouseleave=()=>gripBtn.style.color="#555";

          // Visibility toggle
          const visBtn=mk("button",{
            background:"none",border:"none",cursor:"pointer",padding:"4px 5px",
            fontSize:"11px",color:layer.visible?C.text:"#444",outline:"none",flexShrink:"0",
            lineHeight:"1",
          });
          tx(visBtn,layer.visible?"◉":"○");
          visBtn.title=layer.visible?"Hide layer":"Show layer";
          visBtn.onclick=(e)=>{e.stopPropagation();_sketchSaveHistory();layer.visible=!layer.visible;_sketchComposite();_sketchRebuildLayerUI();};

          // Name — click to select, Shift+click to multi-select
          const nameLbl=mk("div",{
            fontSize:"9px",
            color:_sketchSelectedLayers.has(i)?"#f0b040":(i===_sketchActiveLayer?LIME:C.text),
            flex:"1",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
            cursor:"default",userSelect:"none",
          });
          tx(nameLbl,layer.name);
          nameLbl.onclick=(ev)=>{
            ev.stopPropagation();
            if(ev.shiftKey){
              // Include active layer in selection on first Shift+click
              if(_sketchSelectedLayers.size===0) _sketchSelectedLayers.add(_sketchActiveLayer);
              // Toggle clicked layer
              if(_sketchSelectedLayers.has(i)) _sketchSelectedLayers.delete(i);
              else _sketchSelectedLayers.add(i);
            } else {
              // Normal click — clear selection, set active
              _sketchSelectedLayers.clear();
              _sketchActiveLayer=i;
            }
            _sketchRebuildLayerUI();
          };

          // Rename button
          const _doRename=()=>{
            const inp=mk("input",{
              fontSize:"9px",color:C.text,background:C.bg3,border:`1px solid ${LIME}`,
              borderRadius:"3px",padding:"1px 4px",outline:"none",flex:"1",minWidth:"0",
              boxSizing:"border-box",
            },{value:layer.name});
            inp.addEventListener("keydown",(ke)=>{
              ke.stopPropagation();ke.stopImmediatePropagation();
              if(ke.key==="Enter"||ke.key==="Escape") inp.blur();
            },{capture:true});
            inp.onblur=()=>{layer.name=(inp.value.trim()||layer.name);_sketchRebuildLayerUI();};
            nameLbl.replaceWith(inp);inp.focus();inp.select();
          };
          const renameBtn=mk("button",{
            background:"none",border:"none",cursor:"pointer",padding:"0 2px",
            fontSize:"9px",color:"#444",outline:"none",flexShrink:"0",transition:"color .12s",lineHeight:"1",
          });
          tx(renameBtn,"✎");renameBtn.title="Rename layer";
          renameBtn.onmouseenter=()=>renameBtn.style.color=LIME;
          renameBtn.onmouseleave=()=>renameBtn.style.color="#444";
          renameBtn.onclick=(e)=>{e.stopPropagation();_doRename();};

          // Delete button
          const delBtn=mk("button",{
            background:"none",border:"none",cursor:"pointer",padding:"0",
            fontSize:"10px",color:"#555",outline:"none",flexShrink:"0",transition:"color .12s",
          });
          tx(delBtn,"✕");
          delBtn.onmouseenter=()=>delBtn.style.color="#e05555";
          delBtn.onmouseleave=()=>delBtn.style.color="#555";
          delBtn.onclick=(e)=>{
            e.stopPropagation();
            if(_sketchLayers.length<=1) return;
            _sketchSaveHistory();
            _sketchLayers.splice(i,1);
            if(i<_sketchActiveLayer) _sketchActiveLayer--;
            _sketchActiveLayer=Math.min(_sketchActiveLayer,_sketchLayers.length-1);
            _sketchComposite();_sketchRebuildLayerUI();_sketchDrawBoundingBox();
          };

          // Duplicate button (always shown on hover)
          const dupRowBtn=mk("button",{
            background:"none",border:"none",cursor:"pointer",padding:"0 2px",
            fontSize:"10px",color:"#444",outline:"none",flexShrink:"0",transition:"color .12s",lineHeight:"1",
            display:"none",
          });
          tx(dupRowBtn,"⧉");dupRowBtn.title="Duplicate layer";
          dupRowBtn.onmouseenter=()=>dupRowBtn.style.color=LIME;
          dupRowBtn.onmouseleave=()=>dupRowBtn.style.color="#444";
          dupRowBtn.onclick=(e)=>{
            e.stopPropagation();
            const src=_sketchLayers[i];if(!src) return;
            _sketchSaveHistory();
            const c=document.createElement("canvas");c.width=src.canvas.width;c.height=src.canvas.height;
            c.getContext("2d",{willReadFrequently:true}).drawImage(src.canvas,0,0);
            const {maskCanvas:mc2,maskCtx:mctx2}=_sketchMakeMask();
            mc2.width=src.maskCanvas.width;mc2.height=src.maskCanvas.height;
            if(src.maskEnabled) mctx2.drawImage(src.maskCanvas,0,0);
            const dup={canvas:c,ctx:c.getContext("2d",{willReadFrequently:true}),maskCanvas:mc2,maskCtx:mctx2,
              maskEnabled:src.maskEnabled,name:src.name+" copy",visible:src.visible,
              _ox:src._ox,_oy:src._oy,_tightBBox:src._tightBBox?{...src._tightBBox}:null,
              _layerType:src._layerType,_layerColor:src._layerColor,
              _shapeData:src._shapeData?{...src._shapeData}:null,_bgRemoved:src._bgRemoved||false};
            _sketchLayers.splice(i,0,dup);
            _sketchComposite();_sketchRebuildLayerUI();
          };

          // Show/hide hover-only buttons on row hover
          row.onmouseenter=()=>{ dupRowBtn.style.display=""; };
          row.onmouseleave=()=>{ dupRowBtn.style.display="none"; };

          row.append(gripBtn,visBtn,nameLbl,dupRowBtn,renameBtn,delBtn);
          _sketchLayersList.appendChild(row);
        });
        _sketchDrawBoundingBox();
      };

      // Create a blank mask canvas — starts WHITE (fully visible); user paints black to hide
      const _sketchMakeMask=()=>{
        const mc=document.createElement("canvas");
        mc.width=_sketchCanvasW;mc.height=_sketchCanvasH;
        const mctx=mc.getContext("2d");
        mctx.fillStyle="#ffffff";
        mctx.fillRect(0,0,_sketchCanvasW,_sketchCanvasH);
        return {maskCanvas:mc,maskCtx:mctx};
      };

      // Create a new blank layer
      // Draw a rect or circle shape onto ctx using stored shapeData and given color.
      const _sketchDrawShape=(ctx,layerType,sd,color)=>{
        let {sx,sy,ex,ey,size,fillMode,shiftKey}=sd;
        if(shiftKey){
          const dw=ex-sx,dh=ey-sy,mn=Math.min(Math.abs(dw),Math.abs(dh));
          ex=sx+Math.sign(dw)*mn; ey=sy+Math.sign(dh)*mn;
        }
        ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
        ctx.save();
        ctx.strokeStyle=color;ctx.fillStyle=color;
        ctx.lineWidth=size;ctx.lineCap="round";
        if(layerType==="rect"){
          if(fillMode==="fill") ctx.fillRect(sx,sy,ex-sx,ey-sy);
          else ctx.strokeRect(sx,sy,ex-sx,ey-sy);
        } else {
          const rx=(ex-sx)/2,ry=(ey-sy)/2,cx2=sx+rx,cy2=sy+ry;
          ctx.beginPath();ctx.ellipse(cx2,cy2,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);
          if(fillMode==="fill") ctx.fill(); else ctx.stroke();
        }
        ctx.restore();
      };

      // Recolor the active layer if it supports recoloring (brush/rect/circle).
      const _sketchAddLayer=(name)=>{
        const c=document.createElement("canvas");
        c.width=_sketchCanvasW;c.height=_sketchCanvasH;
        const ctx=c.getContext("2d",{willReadFrequently:true});
        const {maskCanvas,maskCtx}=_sketchMakeMask();
        const layer={
          canvas:c,ctx,maskCanvas,maskCtx,maskEnabled:false,
          name:name||`Layer ${_sketchLayers.length+1}`,visible:true,_ox:0,_oy:0,
          _tightBBox:null,
          _layerType:null,   // "brush"|"rect"|"circle"|null
          _layerColor:null,  // color at creation
          _shapeData:null,   // for rect/circle: {sx,sy,ex,ey,size,fillMode}
        };
        _sketchLayers.unshift(layer);
        _sketchActiveLayer=0;
        _sketchRebuildLayerUI();
        return layer;
      };
      // Use mousedown+mouseup instead of onclick to reliably detect drag vs click
      {
        let _addBtnDownX=0,_addBtnDownY=0,_addBtnMoved=false;
        _sketchAddLayerBtn.addEventListener("mousedown",e=>{
          if(_sketchSpaceHeld){ e.preventDefault();e.stopImmediatePropagation();_sketchStartPan(e.clientX,e.clientY);return; }
          _addBtnDownX=e.clientX;_addBtnDownY=e.clientY;_addBtnMoved=false;
        });
        _sketchAddLayerBtn.addEventListener("mousemove",e=>{
          if(Math.abs(e.clientX-_addBtnDownX)>4||Math.abs(e.clientY-_addBtnDownY)>4) _addBtnMoved=true;
        });
        _sketchAddLayerBtn.addEventListener("mouseup",()=>{
          if(_sketchSpaceHeld||_sketchWasPanning||_addBtnMoved) return;
          _sketchSaveHistory();_sketchAddLayer();_sketchComposite();
        });
      }

      // Load an image file as a new layer.
      // Strategy: layer canvas = image natural size (1:1 pixels, no scaling).
      // _ox/_oy positions it centered on the sketch canvas.
      // If sketch canvas doesn't exist yet → initialise canvas to image size first.
      const _sketchAddImageLayer=(file)=>{
        const url=URL.createObjectURL(file);
        const img=new Image();
        img.onload=()=>{
          URL.revokeObjectURL(url);
          const iw=img.naturalWidth, ih=img.naturalHeight;
          // If canvas not yet initialised, create it at image size
          if(_sketchCanvasWrap.style.display==="none"){
            _sketchWInp.setVal(iw);_sketchHInp.setVal(ih);
            _sketchResApply(); // creates canvas + Layer 1
          }
          // Layer canvas = exact image size (no scaling, full quality)
          const c=document.createElement("canvas");
          c.width=iw; c.height=ih;
          const ctx=c.getContext("2d",{willReadFrequently:true});
          ctx.drawImage(img,0,0);
          // Position centered on sketch canvas
          const ox=Math.round((_sketchCanvasW-iw)/2);
          const oy=Math.round((_sketchCanvasH-ih)/2);
          const {maskCanvas,maskCtx}=_sketchMakeMask();
          const baseName=(file.name||"").replace(/\.[^.]+$/,"").slice(0,24)||"Image";
          const layer={
            canvas:c,ctx,maskCanvas,maskCtx,maskEnabled:false,
            name:baseName,visible:true,_ox:ox,_oy:oy,
            _tightBBox:null,_layerType:"image",_layerColor:null,_shapeData:null,
          };
          _sketchSaveHistory();
          _sketchLayers.unshift(layer);
          _sketchActiveLayer=0;
          _sketchComposite();_sketchRebuildLayerUI();
        };
        img.onerror=()=>{ URL.revokeObjectURL(url); };
        img.src=url;
      };
      _sketchImgLayerInp.onchange=()=>{
        if(_sketchImgLayerInp.files[0]) _sketchAddImageLayer(_sketchImgLayerInp.files[0]);
        _sketchImgLayerInp.value="";
      };

      // ── Apply canvas size (resize all layers) ────────────────────────────
      const _sketchResApply=()=>{
        const w=Math.max(64,Math.min(4096,Math.round(_sketchWInp.numVal)||1024));
        const h=Math.max(64,Math.min(4096,Math.round(_sketchHInp.numVal)||1024));
        _sketchCanvasW=w;_sketchCanvasH=h;
        // Set canvas attribute size (this IS the rendered size, CSS follows naturally)
        _sketchDisplayCanvas.width=w;_sketchDisplayCanvas.height=h;
        _sketchDrawChecker(w,h);
        if(_sketchPreviewCanvas){_sketchPreviewCanvas.width=w;_sketchPreviewCanvas.height=h;}
        // Set explicit CSS size on wrapper so transform works correctly
        _sketchCanvasWrap.style.width=w+"px";_sketchCanvasWrap.style.height=h+"px";
        // Show canvas wrap (hidden until first apply)
        _sketchCanvasWrap.style.display="block";
        _sketchPlaceholder.style.display="none";
        // Create first layer if none exist — fill with white as background
        if(_sketchLayers.length===0){
          const bg=_sketchAddLayer("Background");
          bg.ctx.fillStyle="#ffffff";
          bg.ctx.fillRect(0,0,w,h);
        }
        // Resize only full-canvas layers (scaled layers keep their own canvas size)
        _sketchLayers.forEach(layer=>{
          const isBg=layer.name==="Background"&&!layer._layerType;
          // "Scaled" = image layer positioned off-center with its own canvas size — skip resize
          const isScaled=!isBg
                        &&(layer._layerType==="image"||layer._ox!==0||layer._oy!==0)
                        &&(layer.canvas.width!==w||layer.canvas.height!==h);
          if(isScaled) return; // scaled layer: leave canvas alone, only position changes
          let prev=null;
          try{prev=layer.ctx.getImageData(0,0,layer.canvas.width,layer.canvas.height);}catch(ex){}
          layer.canvas.width=w;layer.canvas.height=h;
          if(isBg){ layer.ctx.fillStyle="#ffffff"; layer.ctx.fillRect(0,0,w,h); }
          if(prev) try{layer.ctx.putImageData(prev,0,0);}catch(ex){}
          layer._ox=0; layer._oy=0;
          layer._tightBBox=isBg?{minX:0,minY:0,maxX:w-1,maxY:h-1}:null;
        });
        _sketchComposite();
        _sketchRebuildLayerUI();
        // Re-center in viewport
        requestAnimationFrame(()=>{
          const vw=_sketchViewport.offsetWidth,vh=_sketchViewport.offsetHeight;
          if(!vw||!vh) return;
          const scale=Math.min(1,(vw-40)/w,(vh-40)/h);
          _sketchZoom=scale;
          _sketchPanX=Math.round((vw-w*scale)/2);
          _sketchPanY=Math.round((vh-h*scale)/2);
          _sketchApplyTransform();
          _sketchDrawBoundingBox();
        });
      };
      _sketchResApplyBtn.onclick=()=>{
        if(_sketchSizeApplied){ _sketchSetSizeApplied(false); return; }
        _sketchSaveHistory();
        _sketchResApply();
        _sketchSetSizeApplied(true);
      };

      // ── Pan / Zoom ────────────────────────────────────────────────────────
      const _sketchApplyTransform=()=>{
        _sketchCanvasWrap.style.transform=`translate(${_sketchPanX}px,${_sketchPanY}px) scale(${_sketchZoom})`;
        _sketchDrawBoundingBox();
      };
      const _sketchSetZoom=(z,cx,cy)=>{
        z=Math.max(0.1,Math.min(10,z));
        // cx,cy = viewport coords to zoom around
        if(cx!==undefined){
          _sketchPanX=cx-((cx-_sketchPanX)/(_sketchZoom))*z;
          _sketchPanY=cy-((cy-_sketchPanY)/(_sketchZoom))*z;
        }
        _sketchZoom=z;
        _sketchApplyTransform();
      };
      _sketchViewport.addEventListener("wheel",e=>{
        e.preventDefault();e.stopPropagation();
        const r=_sketchViewport.getBoundingClientRect();
        const cx=e.clientX-r.left, cy=e.clientY-r.top;
        const delta=e.deltaY<0?1.1:1/1.1;
        _sketchSetZoom(_sketchZoom*delta,cx,cy);
        _sketchLastX=NaN;_sketchLastY=NaN; // invalidate after zoom so brush doesn't jump
      },{passive:false});
      const _mkZoomBtnHandler=(btn,factor)=>{
        let _zDownX=0,_zDownY=0,_zMoved=false;
        btn.addEventListener("mousedown",e=>{
          if(_sketchSpaceHeld){e.preventDefault();e.stopImmediatePropagation();_sketchStartPan(e.clientX,e.clientY);return;}
          _zDownX=e.clientX;_zDownY=e.clientY;_zMoved=false;
        });
        btn.addEventListener("mousemove",e=>{
          if(Math.abs(e.clientX-_zDownX)>4||Math.abs(e.clientY-_zDownY)>4) _zMoved=true;
        });
        btn.addEventListener("mouseup",()=>{
          if(_sketchSpaceHeld||_sketchWasPanning||_zMoved) return;
          const vw=_sketchViewport.offsetWidth,vh=_sketchViewport.offsetHeight;
          _sketchSetZoom(_sketchZoom*factor,vw/2,vh/2);
        });
      };
      _mkZoomBtnHandler(_sketchZoomIn,1.25);
      _mkZoomBtnHandler(_sketchZoomOut,1/1.25);
      const _sketchDoFit=()=>{
        const vw=_sketchViewport.offsetWidth,vh=_sketchViewport.offsetHeight;
        const scale=Math.min(1,(vw-40)/_sketchCanvasW,(vh-40)/_sketchCanvasH);
        _sketchZoom=scale;
        _sketchPanX=Math.round((vw-_sketchCanvasW*scale)/2);
        _sketchPanY=Math.round((vh-_sketchCanvasH*scale)/2);
        _sketchApplyTransform();
      };
      _sketchZoomReset.onclick=_sketchDoFit;

      // Panning state
      let _sketchPanning=false,_sketchPanStartX=0,_sketchPanStartY=0,_sketchPanOX=0,_sketchPanOY=0;
      let _sketchSpaceHeld=false;
      let _sketchWasPanning=false; // true briefly after panning ends — suppresses stray clicks
      // Space pan is handled inside _sketchKeyHandler on document.
      document.addEventListener("keyup",e=>{
        if(_sketchOv.style.display==="none") return;
        if(e.code==="Space"){
          _sketchSpaceHeld=false;
          if(!_sketchPanning) _sketchViewport.style.cursor=_sketchTool==="move"?"default":"none";
        }
      });
      // Document-level pan move+up so panning continues outside viewport
      document.addEventListener("pointermove",e=>{
        if(_sketchOv.style.display==="none") return;
        _sketchUpdateCursorFromClient(e.clientX,e.clientY);
        if(_sketchPanning){
          _sketchPanX=_sketchPanOX+(e.clientX-_sketchPanStartX);
          _sketchPanY=_sketchPanOY+(e.clientY-_sketchPanStartY);
          _sketchApplyTransform();
          _sketchLastX=NaN;_sketchLastY=NaN;
          return;
        }
        if(_sketchDrawing&&(_skScaling||_sketchTool==="move")){
          _sketchPressure=(e.pressure&&e.pressure>0)?e.pressure:1;
          _sketchVpMove(e);
        }
      });
      document.addEventListener("pointerup",e=>{
        if(_sketchOv.style.display==="none") return;
        if(_sketchPanning){
          _sketchPanning=false;
          _sketchWasPanning=true;
          setTimeout(()=>{ _sketchWasPanning=false; },50);
          _sketchViewport.style.cursor=_sketchSpaceHeld?"grab":"none";
          return;
        }
        if(_sketchDrawing&&(_skScaling||_sketchTool==="move")){
          _sketchVpUp(e);
        }
      });
      _sketchOv.setAttribute("tabindex","-1");

      // ── Drawing ───────────────────────────────────────────────────────────

      // ── History ───────────────────────────────────────────────────────────
      let _sketchHistory=[];
      const _sketchSaveHistory=()=>{
        const snap={
          activeLayer:_sketchActiveLayer,
          canvasW:_sketchCanvasW,
          canvasH:_sketchCanvasH,
          layers:_sketchLayers.map(l=>{
            let maskImgd=null;
            if(l.maskEnabled&&l.maskCanvas.width>0&&l.maskCanvas.height>0){
              try{ maskImgd=l.maskCtx.getImageData(0,0,l.maskCanvas.width,l.maskCanvas.height); }catch(ex){}
            }
            return {
              imgd:l.ctx.getImageData(0,0,l.canvas.width,l.canvas.height),
              cw:l.canvas.width,ch:l.canvas.height,
              ox:l._ox||0,oy:l._oy||0,
              name:l.name,visible:l.visible,
              layerType:l._layerType,layerColor:l._layerColor,
              shapeData:l._shapeData?{...l._shapeData}:null,
              maskEnabled:l.maskEnabled||false,
              maskImgd,maskW:l.maskCanvas.width,maskH:l.maskCanvas.height,
              bgRemoved:l._bgRemoved||false,
            };
          }),
        };
        _sketchHistory.push(snap);
        if(_sketchHistory.length>20) _sketchHistory.shift();
      };
      const _sketchDoUndo=()=>{
        if(!_sketchHistory.length) return;
        const snap=_sketchHistory.pop();
        const layers=snap.layers||snap; // compat with old format
        // Restore exact layer count
        while(_sketchLayers.length>layers.length) _sketchLayers.pop();
        layers.forEach((s,i)=>{
          if(!_sketchLayers[i]){
            const c=document.createElement("canvas");
            const {maskCanvas,maskCtx}=_sketchMakeMask();
            _sketchLayers[i]={canvas:c,ctx:c.getContext("2d",{willReadFrequently:true}),
              maskCanvas,maskCtx,maskEnabled:false,name:"",visible:true,
              _ox:0,_oy:0,_tightBBox:null,_layerType:null,_layerColor:null,_shapeData:null,_bgRemoved:false};
          }
          const l=_sketchLayers[i];
          if(l.canvas.width!==s.cw||l.canvas.height!==s.ch){
            l.canvas.width=s.cw; l.canvas.height=s.ch;
          } else {
            l.ctx.clearRect(0,0,s.cw,s.ch);
          }
          l.ctx.putImageData(s.imgd,0,0);
          l._ox=s.ox; l._oy=s.oy; l._tightBBox=null;
          l.name=s.name; l.visible=s.visible;
          l._layerType=s.layerType; l._layerColor=s.layerColor;
          l._shapeData=s.shapeData; l._bgRemoved=s.bgRemoved||false;
          l.maskEnabled=s.maskEnabled||false;
          if(s.maskImgd&&s.maskW>0&&s.maskH>0){
            l.maskCanvas.width=s.maskW; l.maskCanvas.height=s.maskH;
            try{ l.maskCtx.putImageData(s.maskImgd,0,0); }catch(ex){}
          } else {
            l.maskCanvas.width=l.canvas.width; l.maskCanvas.height=l.canvas.height;
            l.maskCtx.clearRect(0,0,l.maskCanvas.width,l.maskCanvas.height);
          }
        });
        _sketchActiveLayer=Math.min(snap.activeLayer||0,Math.max(0,_sketchLayers.length-1));
        // Restore canvas dimensions if they changed
        if(snap.canvasW&&snap.canvasH&&(snap.canvasW!==_sketchCanvasW||snap.canvasH!==_sketchCanvasH)){
          _sketchCanvasW=snap.canvasW; _sketchCanvasH=snap.canvasH;
          _sketchDisplayCanvas.width=_sketchCanvasW; _sketchDisplayCanvas.height=_sketchCanvasH;
          if(_sketchPreviewCanvas){ _sketchPreviewCanvas.width=_sketchCanvasW; _sketchPreviewCanvas.height=_sketchCanvasH; }
          _sketchDrawChecker(_sketchCanvasW,_sketchCanvasH);
          _sketchCanvasWrap.style.width=_sketchCanvasW+"px"; _sketchCanvasWrap.style.height=_sketchCanvasH+"px";
          _sketchWInp.setVal(_sketchCanvasW); _sketchHInp.setVal(_sketchCanvasH);
        }
        _sketchComposite();_sketchRebuildLayerUI();
        _sketchDrawBoundingBox();
      };
      _sketchUndoBtn.onclick=_sketchDoUndo;
      _sketchClearBtn.onclick=()=>{
        _sketchSaveHistory();
        _sketchLayers=[];
        _sketchActiveLayer=0;
        const bgClr=_sketchAddLayer("Background");
        bgClr.ctx.fillStyle="#ffffff";bgClr.ctx.fillRect(0,0,_sketchCanvasW,_sketchCanvasH);
        _sketchComposite();_sketchRebuildLayerUI();
        _sketchPromptSet=false;
      };

      // Stroke/Fill logic
      let _sketchFillMode="stroke";
      const _sfActivate=(mode)=>{
        _sketchFillMode=mode;
        _sketchStrokeBtn.style.background=mode==="stroke"?C.bg2:C.bg3;
        _sketchStrokeBtn.style.color=mode==="stroke"?LIME:C.muted;
        _sketchFillModeBtn.style.background=mode==="fill"?C.bg2:C.bg3;
        _sketchFillModeBtn.style.color=mode==="fill"?LIME:C.muted;
      };
      _sketchStrokeBtn.onclick=()=>_sfActivate("stroke");
      _sketchFillModeBtn.onclick=()=>_sfActivate("fill");
      _sfActivate("fill");

      // ── Custom cursor (round, follows mouse inside viewport only) ─────────
      const _sketchCursorEl=mk("div",{
        position:"absolute",pointerEvents:"none",borderRadius:"50%",
        border:"1.5px solid rgba(0,0,0,.9)",boxShadow:"0 0 0 1px rgba(255,255,255,.8)",
        zIndex:"5",transform:"translate(-50%,-50%)",display:"none",boxSizing:"border-box",
      });
      _sketchViewport.appendChild(_sketchCursorEl);
      _sketchViewport.style.cursor="none";

      const _sketchRefreshCursor=(vx,vy)=>{
        if(_sketchTool!=="move") { _sketchCursorEl.innerHTML=""; _sketchCursorEl.style.display="block"; }
        const brushTools=["brush","eraser"];
        if(brushTools.includes(_sketchTool)){
          const sz=Math.max(2,(_sketchSize/2)*_sketchZoom);
          _sketchCursorEl.style.width=sz+"px";_sketchCursorEl.style.height=sz+"px";
          _sketchCursorEl.style.borderRadius="50%";
          _sketchCursorEl.style.background=_sketchTool==="eraser"?"rgba(255,255,255,.2)":"transparent";
          _sketchCursorEl.style.borderColor=_sketchTool==="eraser"?"rgba(80,80,80,.9)":"rgba(0,0,0,.9)";
        } else if(_sketchTool==="move"){
          _sketchCursorEl.style.width="20px";_sketchCursorEl.style.height="20px";
          _sketchCursorEl.style.borderRadius="0";_sketchCursorEl.style.background="none";
          _sketchCursorEl.style.borderColor="transparent";
          _sketchCursorEl.innerHTML="✥";
          _sketchCursorEl.style.fontSize="16px";_sketchCursorEl.style.color="#fff";
          _sketchCursorEl.style.textShadow="0 0 3px rgba(0,0,0,.9)";
          _sketchCursorEl.style.display="flex";_sketchCursorEl.style.alignItems="center";_sketchCursorEl.style.justifyContent="center";
        } else {
          _sketchCursorEl.style.width="10px";_sketchCursorEl.style.height="10px";
          _sketchCursorEl.style.borderRadius="50%";_sketchCursorEl.style.background="none";
          _sketchCursorEl.style.borderColor="rgba(0,0,0,.9)";
        }
        if(vx!==undefined){ _sketchCursorEl.style.left=vx+"px"; _sketchCursorEl.style.top=vy+"px"; }
      };

      // ── Shape preview canvas — same size as canvas, for shape drag preview only ──
      const _sketchPreviewCanvas=mk("canvas",{
        position:"absolute",top:"0",left:"0",pointerEvents:"none",display:"block",
      });
      _sketchCanvasWrap.appendChild(_sketchPreviewCanvas);
      const _sketchPreviewCtx=_sketchPreviewCanvas.getContext("2d");

      // ── Corner handle divs — positioned in viewport coords, clickable ──────
      // pointerEvents:auto so mousedown fires directly on the handle — no canvas-space
      // hit detection needed, cursor is always exactly on the handle when clicking.
      const _skHandleDivs=Array.from({length:4},(_,ci)=>{
        const d=mk("div",{
          position:"absolute",width:"22px",height:"22px",
          background:"#111",border:`2px solid ${LIME}`,
          boxSizing:"border-box",pointerEvents:"auto",
          transform:"translate(-50%,-50%)",display:"none",
          zIndex:"11",cursor:"nwse-resize",
        });
        if(ci===1||ci===2) d.style.cursor="nesw-resize";
        // mousedown on handle → start scale drag for this corner
        d.addEventListener("pointerdown",ev=>{
          if(ev.button!==0) return;
          ev.preventDefault();ev.stopPropagation();
          const al=_sketchLayers[_sketchActiveLayer];if(!al||!_skBBox) return;
          _sketchSaveHistory();
          _sketchDrawing=true;
          _skScaling=true;
          const {bx,by,bw,bh}=_skBBox;
          // Store original bbox + aspect ratio
          _skScaleOrigBBox={bx,by,bw,bh,aspect:bw/bh};
          // Fixed corner = opposite of dragged corner
          // ci: 0=TL→fixed BR, 1=TR→fixed BL, 2=BL→fixed TR, 3=BR→fixed TL
          const fixedCorners=[[bx+bw,by+bh],[bx,by+bh],[bx+bw,by],[bx,by]];
          const draggedCorners=[[bx,by],[bx+bw,by],[bx,by+bh],[bx+bw,by+bh]];
          _skScaleFixedX=fixedCorners[ci][0];
          _skScaleFixedY=fixedCorners[ci][1];
          // Compute cursor canvas-space position at mousedown to calculate drag offset
          const r=_sketchViewport.getBoundingClientRect();
          const scaleX=r.width/_sketchViewport.offsetWidth||1;
          const scaleY=r.height/_sketchViewport.offsetHeight||1;
          const mouseVx=(ev.clientX-r.left)/scaleX, mouseVy=(ev.clientY-r.top)/scaleY;
          const mouseCanvasX=(mouseVx-_sketchPanX)/_sketchZoom;
          const mouseCanvasY=(mouseVy-_sketchPanY)/_sketchZoom;
          // Offset = cursor minus dragged corner; applied each frame so corner tracks cursor exactly
          _skScaleDragOffsetX=mouseCanvasX-draggedCorners[ci][0];
          _skScaleDragOffsetY=mouseCanvasY-draggedCorners[ci][1];
          // Content crop offset in local canvas coords
          _skScaleOrigCropX=bx-(al._ox||0);
          _skScaleOrigCropY=by-(al._oy||0);
          // Snapshot layer canvas
          _skScaleOrigFull=document.createElement("canvas");
          _skScaleOrigFull.width=al.canvas.width;
          _skScaleOrigFull.height=al.canvas.height;
          _skScaleOrigFull.getContext("2d").drawImage(al.canvas,0,0);
        });
        _sketchViewport.appendChild(d);
        return d;
      });
      // Dashed border overlay for bbox (in viewport space)
      const _skBBoxDiv=mk("div",{
        position:"absolute",pointerEvents:"none",
        border:`1.5px dashed ${LIME}`,boxSizing:"border-box",
        display:"none",zIndex:"9",
      });
      _sketchViewport.appendChild(_skBBoxDiv);

      // ── Rotate handle — circle above bbox center ──────────────────────────
      const _skRotateHandle=mk("div",{
        position:"absolute",width:"18px",height:"18px",borderRadius:"50%",
        background:"#111",border:`2px solid #aaffcc`,
        boxSizing:"border-box",pointerEvents:"auto",
        transform:"translate(-50%,-50%)",display:"none",
        zIndex:"12",cursor:"grab",
      });
      // Line connecting bbox top-center to rotate handle
      const _skRotateLine=mk("div",{
        position:"absolute",width:"1px",background:"rgba(170,255,200,.4)",
        transformOrigin:"top center",display:"none",zIndex:"8",pointerEvents:"none",
      });
      _sketchViewport.appendChild(_skRotateLine);
      _sketchViewport.appendChild(_skRotateHandle);

      let _skRotDragging=false;
      let _skRotCenterVx=0,_skRotCenterVy=0;
      let _skRotPrevAngle=0;   // previous frame atan2 angle for unwrap
      let _skRotAccum=0;       // accumulated total rotation in radians (unwrapped)
      let _skRotOrigForHandle=null;
      let _skRotOrigOXH=0,_skRotOrigOYH=0;

      const _skRotGetVpScale=()=>{
        const r=_sketchViewport.getBoundingClientRect();
        return {r,sx:r.width/_sketchViewport.offsetWidth||1,sy:r.height/_sketchViewport.offsetHeight||1};
      };

      _skRotateHandle.addEventListener("pointerdown",ev=>{
        if(ev.button!==0) return;
        ev.preventDefault();ev.stopPropagation();
        const layer=_sketchLayers[_sketchActiveLayer];if(!layer||!_skBBox) return;
        _sketchSaveHistory();
        _skRotDragging=true;
        _skRotAccum=0;
        _skRotateHandle.style.cursor="grabbing";
        // Freeze center in viewport coords at drag start — never recalculate during drag
        const {bx,by,bw,bh}=_skBBox;
        const cVp=_skCanvasToVp(bx+bw/2,by+bh/2);
        _skRotCenterVx=cVp.vx; _skRotCenterVy=cVp.vy;
        const {r,sx,sy}=_skRotGetVpScale();
        const mvx=(ev.clientX-r.left)/sx, mvy=(ev.clientY-r.top)/sy;
        _skRotPrevAngle=Math.atan2(mvy-_skRotCenterVy,mvx-_skRotCenterVx);
        // Snapshot layer
        _skRotOrigForHandle=document.createElement("canvas");
        _skRotOrigForHandle.width=layer.canvas.width;
        _skRotOrigForHandle.height=layer.canvas.height;
        _skRotOrigForHandle.getContext("2d").drawImage(layer.canvas,0,0);
        _skRotOrigOXH=layer._ox||0; _skRotOrigOYH=layer._oy||0;
      });

      document.addEventListener("pointermove",ev=>{
        if(!_skRotDragging||_sketchOv.style.display==="none") return;
        const layer=_sketchLayers[_sketchActiveLayer];if(!layer||!_skRotOrigForHandle) return;
        const {r,sx,sy}=_skRotGetVpScale();
        const mvx=(ev.clientX-r.left)/sx, mvy=(ev.clientY-r.top)/sy;
        const curAngle=Math.atan2(mvy-_skRotCenterVy,mvx-_skRotCenterVx);
        // Unwrap: detect wraparound from +π to -π and vice versa
        let delta=curAngle-_skRotPrevAngle;
        if(delta>Math.PI) delta-=2*Math.PI;
        if(delta<-Math.PI) delta+=2*Math.PI;
        _skRotAccum+=delta;
        _skRotPrevAngle=curAngle;
        // Apply accumulated rotation to original snapshot
        const rad=_skRotAccum;
        const ow=_skRotOrigForHandle.width, oh=_skRotOrigForHandle.height;
        const cos=Math.abs(Math.cos(rad)), sin=Math.abs(Math.sin(rad));
        const nw=Math.ceil(ow*cos+oh*sin), nh=Math.ceil(ow*sin+oh*cos);
        const tmp=document.createElement("canvas");
        tmp.width=nw; tmp.height=nh;
        const tctx=tmp.getContext("2d");
        tctx.translate(nw/2,nh/2); tctx.rotate(rad);
        tctx.drawImage(_skRotOrigForHandle,-ow/2,-oh/2);
        layer.canvas.width=nw; layer.canvas.height=nh;
        layer.ctx.drawImage(tmp,0,0);
        const origCx=_skRotOrigOXH+ow/2, origCy=_skRotOrigOYH+oh/2;
        layer._ox=Math.round(origCx-nw/2); layer._oy=Math.round(origCy-nh/2);
        layer._tightBBox=null;
        _sketchComposite();
        // Only update handle position, not full bbox recalc (would reset center)
        const newTL=_skCanvasToVp(layer._ox,layer._oy);
        const newBR=_skCanvasToVp(layer._ox+nw,layer._oy+nh);
        const hVx=(newTL.vx+newBR.vx)/2, hVy=newTL.vy-28;
        _skRotateHandle.style.left=hVx+"px";
        _skRotateHandle.style.top=hVy+"px";
        _skRotateLine.style.left=hVx+"px";
        _skRotateLine.style.top=(hVy+9)+"px";
      });

      document.addEventListener("pointerup",()=>{
        if(!_skRotDragging) return;
        _skRotDragging=false;
        _skRotateHandle.style.cursor="grab";
        const layer=_sketchLayers[_sketchActiveLayer];
        if(layer){ _sketchComputeTightBBox(layer); _sketchRebuildLayerUI(); }
        _skRotOrigForHandle=null;
        _skRotAccum=0;
        // Reset slider too
        _skRotateAngle=0; _skRotateOrigCanvas=null;
      });

      // ── Bounding box — pixel-accurate content bounds ─────────────────────
      let _skBBox=null; // {bx,by,bw,bh} canvas-space, null when move tool inactive

      // Synchronous pixel scan → tight content bbox in local canvas coords.
      // Returns null if canvas is empty. Cached in layer._tightBBox.
      const _sketchScanTightBBox=(layer)=>{
        if(layer._tightBBox) return layer._tightBBox;
        const cw=layer.canvas.width, ch=layer.canvas.height;
        let imgd;
        try{ imgd=layer.ctx.getImageData(0,0,cw,ch); }catch(ex){ return null; }
        const d=imgd.data;
        let minX=cw,minY=ch,maxX=-1,maxY=-1;
        for(let y=0;y<ch;y++){
          for(let x=0;x<cw;x++){
            if(d[(y*cw+x)*4+3]>8){
              if(x<minX)minX=x;if(x>maxX)maxX=x;
              if(y<minY)minY=y;if(y>maxY)maxY=y;
            }
          }
        }
        if(maxX<0) return null;
        layer._tightBBox={minX,minY,maxX,maxY};
        return layer._tightBBox;
      };

      // Layer bounds with tight pixel scan (used for bbox display & handles).
      const _sketchGetLayerBounds=(layer)=>{
        const ox=layer._ox||0, oy=layer._oy||0;
        const t=_sketchScanTightBBox(layer);
        if(t) return {bx:t.minX+ox, by:t.minY+oy, bw:t.maxX-t.minX+1, bh:t.maxY-t.minY+1};
        return {bx:ox, by:oy, bw:layer.canvas.width, bh:layer.canvas.height};
      };
      // Fast bounds without pixel scan (used for move snap during drag).
      const _sketchGetLayerBoundsFast=(layer)=>{
        const ox=layer._ox||0, oy=layer._oy||0;
        return {bx:ox, by:oy, bw:layer.canvas.width, bh:layer.canvas.height};
      };

      // Invalidate tight bbox cache (call after any draw on layer).
      const _sketchComputeTightBBox=(layer)=>{ layer._tightBBox=null; };

      // Convert canvas-space point to viewport-space (px from viewport top-left).
      const _skCanvasToVp=(cx,cy)=>({
        vx: cx*_sketchZoom+_sketchPanX,
        vy: cy*_sketchZoom+_sketchPanY,
      });

      const _sketchDrawBoundingBox=()=>{
        // Clear canvas preview (used only for shape drag preview, not bbox)
        _sketchPreviewCtx.clearRect(0,0,_sketchPreviewCanvas.width,_sketchPreviewCanvas.height);
        _skBBox=null;
        // Hide all DOM handles and bbox border
        _skHandleDivs.forEach(d=>d.style.display="none");
        _skBBoxDiv.style.display="none";
        _skRotateHandle.style.display="none";
        _skRotateLine.style.display="none";
        if(_sketchTool!=="move") return;
        const layer=_sketchLayers[_sketchActiveLayer];if(!layer) return;
        const {bx,by,bw,bh}=_sketchGetLayerBounds(layer);
        _skBBox={bx,by,bw,bh};
        // Position bbox border div in viewport coords
        const tl=_skCanvasToVp(bx,by);
        const br=_skCanvasToVp(bx+bw,by+bh);
        _skBBoxDiv.style.left=tl.vx+"px";
        _skBBoxDiv.style.top=tl.vy+"px";
        _skBBoxDiv.style.width=(br.vx-tl.vx)+"px";
        _skBBoxDiv.style.height=(br.vy-tl.vy)+"px";
        _skBBoxDiv.style.display="block";
        // Position corner handle divs in viewport coords
        [[bx,by],[bx+bw,by],[bx,by+bh],[bx+bw,by+bh]].forEach(([cx,cy],i)=>{
          const vp=_skCanvasToVp(cx,cy);
          _skHandleDivs[i].style.left=vp.vx+"px";
          _skHandleDivs[i].style.top=vp.vy+"px";
          _skHandleDivs[i].style.display="block";
        });
        // Rotate handle — above top-center of bbox
        const topCVp=_skCanvasToVp(bx+bw/2,by);
        const ROTATE_OFFSET=28; // px above bbox top in viewport space
        const rhVx=topCVp.vx, rhVy=topCVp.vy-ROTATE_OFFSET;
        _skRotateHandle.style.left=rhVx+"px";
        _skRotateHandle.style.top=rhVy+"px";
        _skRotateHandle.style.display="block";
        // Line from top-center of bbox to handle
        const lineLen=ROTATE_OFFSET;
        _skRotateLine.style.left=topCVp.vx+"px";
        _skRotateLine.style.top=(topCVp.vy-lineLen)+"px";
        _skRotateLine.style.height=lineLen+"px";
        _skRotateLine.style.display="block";
      };



      // Cursor for move tool on viewport (handles have their own cursor CSS).
      const _sketchUpdateMoveCursor=(x,y)=>{
        if(_skBBox){
          const {bx,by,bw,bh}=_skBBox;
          if(x>=bx&&x<=bx+bw&&y>=by&&y<=by+bh){
            _sketchViewport.style.cursor="move"; return;
          }
        }
        _sketchViewport.style.cursor="default";
      };

      // ── Pointer state ─────────────────────────────────────────────────────
      let _sketchShapeStartX=0,_sketchShapeStartY=0;
      let _sketchMoveStartX=0,_sketchMoveStartY=0;
      let _sketchMoveOrigOX=0,_sketchMoveOrigOY=0;
      let _skScaling=false;
      const SNAP_THRESH=8; // pixels

      // ── Tool selection ────────────────────────────────────────────────────
      const _sketchSetTool=(t)=>{
        _sketchTool=t;
        _sketchBrushBtn._setActive(t==="brush");
        _sketchEraserBtn._setActive(t==="eraser");
        _sketchCircleBtn._setActive(t==="circle");
        _sketchRectBtn._setActive(t==="rect");
        _sketchMoveBtn._setActive(t==="move");
        _sketchViewport.style.cursor=t==="move"?"default":"none";
        _sketchCursorEl.style.display="none";
        _sketchDrawBoundingBox();
      };
      _sketchBrushBtn.onclick=()=>_sketchSetTool("brush");
      _sketchEraserBtn.onclick=()=>_sketchSetTool("eraser");
      _sketchCircleBtn.onclick=()=>_sketchSetTool("circle");
      _sketchRectBtn.onclick=()=>_sketchSetTool("rect");
      _sketchMoveBtn.onclick=()=>_sketchSetTool("move");
      _sketchSetTool("move");

      // ── Pointer events — all on viewport, cursor computed from viewport rect ──
      const _sketchVpPos=(e)=>{
        const r=_sketchViewport.getBoundingClientRect();
        const src=e.touches?e.touches[0]:e;
        // getBoundingClientRect returns screen px; divide by CSS scale to get CSS px for left/top positioning
        const scaleX=r.width/_sketchViewport.offsetWidth||1;
        const scaleY=r.height/_sketchViewport.offsetHeight||1;
        return {vx:(src.clientX-r.left)/scaleX, vy:(src.clientY-r.top)/scaleY};
      };
      const _sketchCanvasFromVp=(vx,vy)=>({
        x:(vx-_sketchPanX)/_sketchZoom,
        y:(vy-_sketchPanY)/_sketchZoom,
      });

      const _sketchStartPan=(clientX,clientY)=>{
        _sketchPanning=true;_sketchViewport.style.cursor="grabbing";
        _sketchPanStartX=clientX;_sketchPanStartY=clientY;
        _sketchPanOX=_sketchPanX;_sketchPanOY=_sketchPanY;
      };

      // ── Soft dot helper — draws a soft filled circle using offscreen canvas ──
      // Used for both normal brush softness and soft eraser (destination-out).
      // Parse any CSS color to [r,g,b] — supports #rgb, #rrggbb, rgb(...), rgba(...)
      const _parseColorRGB=(c)=>{
        if(c.startsWith("#")){
          const h=c.slice(1);
          if(h.length===3) return[parseInt(h[0]+h[0],16),parseInt(h[1]+h[1],16),parseInt(h[2]+h[2],16)];
          return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
        }
        const m=c.match(/\d+/g);if(m&&m.length>=3) return[+m[0],+m[1],+m[2]];
        return[0,0,0];
      };

      const _skSoftDot=(targetCtx,x,y,r,softness,color,compOp)=>{
        if(softness>0){
          // Radial gradient for true soft brush — fade to same color at alpha=0 to avoid dark fringing
          const sz=Math.ceil(r*2)+4;
          const off=document.createElement("canvas");
          off.width=sz;off.height=sz;
          const octx=off.getContext("2d");
          const cx=sz/2,cy=sz/2;
          const coreR=r*(1-softness)*0.9;
          const [cr,cg,cb]=_parseColorRGB(color);
          const colorTransparent=`rgba(${cr},${cg},${cb},0)`;
          const grad=octx.createRadialGradient(cx,cy,Math.max(0,coreR),cx,cy,r);
          grad.addColorStop(0,color);
          grad.addColorStop(1,colorTransparent);
          octx.fillStyle=grad;
          octx.beginPath();octx.arc(cx,cy,r,0,Math.PI*2);octx.fill();
          targetCtx.save();
          targetCtx.globalCompositeOperation=compOp;
          targetCtx.drawImage(off,x-cx,y-cy);
          targetCtx.restore();
        } else {
          targetCtx.save();
          targetCtx.globalCompositeOperation=compOp;
          targetCtx.fillStyle=color;
          targetCtx.beginPath();targetCtx.arc(x,y,r,0,Math.PI*2);targetCtx.fill();
          targetCtx.restore();
        }
      };

      // ── Core draw primitive — brush or eraser on layer canvas ────────────
      let _sketchPressure=1;
      const _skApplyDot=(layer,x,y)=>{
        const r=(_sketchSize/2)*(_sketchPressure>0?_sketchPressure:1);
        if(_sketchTool==="eraser"){
          _skSoftDot(layer.ctx,x,y,r,_sketchSoftness,"rgba(0,0,0,1)","destination-out");
        } else {
          _skSoftDot(layer.ctx,x,y,r,_sketchSoftness,_sketchColor,"source-over");
        }
      };

      // ── Scale state ───────────────────────────────────────────────────────
      // _skScaleOrigFull  : copy of layer canvas at drag start
      // _skScaleOrigBBox  : {bx,by,bw,bh,aspect} — bbox in canvas-space + original aspect ratio
      // _skScaleFixedX/Y  : canvas-space coords of the FIXED (opposite) corner — never changes
      // _skScaleOrigCropX/Y : local px offset of content in _skScaleOrigFull (tight bbox offset)
      let _skScaleOrigFull=null;
      let _skScaleOrigBBox=null;
      let _skScaleFixedX=0, _skScaleFixedY=0;
      let _skScaleOrigCropX=0, _skScaleOrigCropY=0;
      let _skScaleDragOffsetX=0, _skScaleDragOffsetY=0;

      // Apply scale. cursor x,y = canvas-space position of the mouse (not the corner).
      // Fixed corner stays at _skScaleFixedX/_skScaleFixedY.
      const _skApplyScale=(layer,cursorX,cursorY)=>{
        const ob=_skScaleOrigBBox;
        const fx=_skScaleFixedX, fy=_skScaleFixedY;
        // Subtract drag offset so the dragged corner tracks the cursor exactly (no initial jump)
        const cx=cursorX-_skScaleDragOffsetX, cy=cursorY-_skScaleDragOffsetY;
        // Raw new rect from adjusted cursor to fixed corner
        let x0=Math.min(cx,fx), y0=Math.min(cy,fy);
        let x1=Math.max(cx,fx), y1=Math.max(cy,fy);
        let nw=Math.max(4,x1-x0), nh=Math.max(4,y1-y0);
        // Lock aspect ratio: expand the shorter axis to match original aspect
        if(nw/nh>ob.aspect){ nh=nw/ob.aspect; }
        else { nw=nh*ob.aspect; }
        // Re-anchor: fixed corner stays fixed, dragged corner = cursor direction
        let newBx,newBy;
        // Determine which direction the drag is going relative to fixed corner (use adjusted corner pos)
        const goLeft=cx<fx, goUp=cy<fy;
        newBx=goLeft ? fx-nw : fx;
        newBy=goUp   ? fy-nh : fy;
        // Snap
        if(Math.abs(newBx)<SNAP_THRESH) newBx=0;
        if(Math.abs(newBy)<SNAP_THRESH) newBy=0;
        if(Math.abs(newBx+nw-_sketchCanvasW)<SNAP_THRESH) nw=_sketchCanvasW-newBx;
        if(Math.abs(newBy+nh-_sketchCanvasH)<SNAP_THRESH) nh=_sketchCanvasH-newBy;
        const dw=Math.round(Math.max(1,nw)), dh=Math.round(Math.max(1,nh));
        layer.canvas.width=dw; layer.canvas.height=dh;
        layer.ctx.drawImage(_skScaleOrigFull, _skScaleOrigCropX,_skScaleOrigCropY,ob.bw,ob.bh, 0,0,dw,dh);
        layer._ox=newBx; layer._oy=newBy;
        layer._tightBBox=null;
      };



      const _sketchVpDown=(e)=>{
        if(_sketchCanvasWrap.style.display==="none") return;
        if(e.button===1){ e.preventDefault();_sketchStartPan(e.clientX,e.clientY);return; }
        if(e.button!==0) return;
        if(_sketchSpaceHeld){ e.preventDefault();_sketchStartPan(e.clientX,e.clientY);return; }
        e.preventDefault();
        const {vx,vy}=_sketchVpPos(e);
        const {x,y}=_sketchCanvasFromVp(vx,vy);

        if(_sketchTool==="move"){
          // Scale is started by mousedown directly on handle divs (above).
          // Mousedown reaching viewport = move drag (not scale).
          if(_skScaling) return; // already handled by handle div mousedown
          const al=_sketchLayers[_sketchActiveLayer];if(!al) return;
          _sketchSaveHistory();
          _sketchDrawing=true;
          _skScaling=false;
          _sketchMoveStartX=vx; _sketchMoveStartY=vy;
          _sketchMoveOrigOX=al._ox||0; _sketchMoveOrigOY=al._oy||0;
          return;
        }
        _sketchSaveHistory();
        _sketchDrawing=true;
        _sketchShapeStartX=x;_sketchShapeStartY=y;
        _sketchShapeSpaceLastVx=vx;_sketchShapeSpaceLastVy=vy;
        if(_sketchTool==="brush"||_sketchTool==="eraser"){
          let layer=_sketchLayers[_sketchActiveLayer];if(!layer) return;
          if(_sketchTool==="brush"){
            // If active layer is Background, create a new layer on top for drawing
            if(layer.name==="Background"){
              layer=_sketchAddLayer("brush");
              _sketchActiveLayer=0;
              layer._layerType="brush";
              layer._layerColor=_sketchColor;
              layer._tightBBox=null;
              _sketchRebuildLayerUI();
            } else if(!layer._layerType){
              const brushCount=_sketchLayers.filter(l=>l.name==="brush"||l.name.startsWith("brush ")).length;
              layer.name=brushCount===0?"brush":"brush "+brushCount;
              layer._layerType="brush";
              _sketchRebuildLayerUI();
            }
            layer._layerColor=_sketchColor;
            layer._tightBBox=null;
          }
          const lx=x-(layer._ox||0), ly=y-(layer._oy||0);
          _sketchLastX=lx;_sketchLastY=ly;
          _skApplyDot(layer,lx,ly);
          _sketchComposite();
        } else {
          _sketchLastX=x;_sketchLastY=y;
        }
      };

      const _sketchVpMove=(e)=>{
        const {vx,vy}=_sketchVpPos(e);
        const {x,y}=_sketchCanvasFromVp(vx,vy);

        // Hover cursor update (no drag)
        if(!_sketchDrawing){
          if(_sketchTool==="move") _sketchUpdateMoveCursor(x,y);
        }
        if(!_sketchDrawing) return;

        if(_sketchTool==="move"){
          const al=_sketchLayers[_sketchActiveLayer];if(!al) return;
          if(_skScaling&&_skScaleOrigBBox){
            // Cursor x,y = new position of dragged corner. Pass directly to _skApplyScale.
            _skApplyScale(al,x,y);
            _sketchComposite();_sketchDrawBoundingBox();
          } else {
            // Move with snap
            let nx=_sketchMoveOrigOX+(vx-_sketchMoveStartX)/_sketchZoom;
            let ny=_sketchMoveOrigOY+(vy-_sketchMoveStartY)/_sketchZoom;
            // Snap to canvas edges and other layers' edges
            const myB=_sketchGetLayerBoundsFast({canvas:al.canvas,ctx:al.ctx,_ox:nx,_oy:ny});
            const edgesX=[0,_sketchCanvasW];
            const edgesY=[0,_sketchCanvasH];
            _sketchLayers.forEach((l,li)=>{
              if(li===_sketchActiveLayer||!l.visible) return;
              const b=_sketchGetLayerBoundsFast(l);
              edgesX.push(b.bx,b.bx+b.bw); edgesY.push(b.by,b.by+b.bh);
            });
            for(const ref of edgesX){
              if(Math.abs(myB.bx-ref)<SNAP_THRESH){nx+=ref-myB.bx;break;}
              if(Math.abs(myB.bx+myB.bw-ref)<SNAP_THRESH){nx+=ref-(myB.bx+myB.bw);break;}
            }
            for(const ref of edgesY){
              if(Math.abs(myB.by-ref)<SNAP_THRESH){ny+=ref-myB.by;break;}
              if(Math.abs(myB.by+myB.bh-ref)<SNAP_THRESH){ny+=ref-(myB.by+myB.bh);break;}
            }
            al._ox=nx; al._oy=ny;
            _sketchComposite();_sketchDrawBoundingBox();
          }
          return;
        }

        if(_sketchTool==="brush"||_sketchTool==="eraser"){
          const layer=_sketchLayers[_sketchActiveLayer];if(!layer) return;
          const lx=x-(layer._ox||0), ly=y-(layer._oy||0);
          if(isNaN(_sketchLastX)||isNaN(_sketchLastY)){
            // First move after zoom/pan — just place dot, no interpolation
            _skApplyDot(layer,lx,ly);
          } else {
            const dist=Math.sqrt((lx-_sketchLastX)**2+(ly-_sketchLastY)**2);
            const step=Math.max(1,_sketchSize*0.25);
            const steps=Math.ceil(dist/step);
            for(let s=1;s<=steps;s++){
              const t=s/steps;
              _skApplyDot(layer,_sketchLastX+t*(lx-_sketchLastX),_sketchLastY+t*(ly-_sketchLastY));
            }
          }
          _sketchLastX=lx;_sketchLastY=ly;
          _sketchComposite();
          return;
        }

        // Shape preview
        if(_sketchSpaceHeld){
          const dx=vx-_sketchShapeSpaceLastVx, dy=vy-_sketchShapeSpaceLastVy;
          _sketchShapeStartX+=dx/_sketchZoom; _sketchShapeStartY+=dy/_sketchZoom;
        }
        _sketchShapeSpaceLastVx=vx; _sketchShapeSpaceLastVy=vy;
        _sketchPreviewCtx.clearRect(0,0,_sketchPreviewCanvas.width,_sketchPreviewCanvas.height);
        let sx=_sketchShapeStartX,sy=_sketchShapeStartY,ex=x,ey=y;
        const shiftKey=e.shiftKey&&!_sketchSpaceHeld;
        _sketchPreviewCtx.save();
        _sketchPreviewCtx.strokeStyle=_sketchColor;
        _sketchPreviewCtx.fillStyle=_sketchColor;
        _sketchPreviewCtx.lineWidth=_sketchSize;
        _sketchPreviewCtx.lineCap="round";
        if(_sketchTool==="rect"){
          let w=ex-sx,h=ey-sy;
          if(shiftKey){ const s=Math.min(Math.abs(w),Math.abs(h));w=Math.sign(w)*s;h=Math.sign(h)*s; }
          if(_sketchFillMode==="fill") _sketchPreviewCtx.fillRect(sx,sy,w,h);
          else _sketchPreviewCtx.strokeRect(sx,sy,w,h);
        } else if(_sketchTool==="circle"){
          let rx=(ex-sx)/2,ry=(ey-sy)/2;
          if(shiftKey){ const r=Math.min(Math.abs(rx),Math.abs(ry));rx=Math.sign(rx)*r;ry=Math.sign(ry)*r; }
          const cx=sx+rx,cy=sy+ry;
          _sketchPreviewCtx.beginPath();_sketchPreviewCtx.ellipse(cx,cy,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);
          if(_sketchFillMode==="fill") _sketchPreviewCtx.fill(); else _sketchPreviewCtx.stroke();
        }
        _sketchPreviewCtx.restore();
      };

      const _sketchVpUp=(e)=>{
        if(_sketchPanning){_sketchPanning=false;_sketchViewport.style.cursor="default";return;}
        if(!_sketchDrawing){return;}
        _sketchDrawing=false;
        if(_sketchTool==="move"){
          _skScaling=false;_skScaleOrigBBox=null;_skScaleOrigFull=null;_skScaleFixedX=0;_skScaleFixedY=0;_skScaleOrigCropX=0;_skScaleOrigCropY=0;_skScaleDragOffsetX=0;_skScaleDragOffsetY=0;
          _sketchRebuildLayerUI();
          return;
        }
        if(_sketchTool==="brush"||_sketchTool==="eraser"){
          // Brush stroke done — compute tight bbox in background
          const bl=_sketchLayers[_sketchActiveLayer];
          if(bl) _sketchComputeTightBBox(bl);
          return;
        }
        // Commit shape to a NEW named layer
        const {vx,vy}=_sketchVpPos(e);
        const {x:ex,y:ey}=_sketchCanvasFromVp(vx,vy);
        let sx=_sketchShapeStartX,sy=_sketchShapeStartY;
        const shiftKey=e.shiftKey;
        const shapeName=_sketchTool==="rect"?"rectangle":"circle";
        const shapeCount=_sketchLayers.filter(l=>l.name.startsWith(shapeName)).length+1;
        const newLayer=_sketchAddLayer(`${shapeName} ${shapeCount}`);
        newLayer._layerType=_sketchTool; // "rect" or "circle"
        newLayer._layerColor=_sketchColor;
        newLayer._shapeData={sx,sy,ex:ex,ey:ey,size:_sketchSize,fillMode:_sketchFillMode,shiftKey};
        _sketchDrawShape(newLayer.ctx,_sketchTool,newLayer._shapeData,_sketchColor);
        _sketchComputeTightBBox(newLayer);
        _sketchPreviewCtx.clearRect(0,0,_sketchPreviewCanvas.width,_sketchPreviewCanvas.height);
        _sketchComposite();_sketchRebuildLayerUI();
      };

      // Shape space-drag: while drawing a shape with Space held, move the start point
      let _sketchShapeSpaceLastVx=0,_sketchShapeSpaceLastVy=0;

      _sketchViewport.addEventListener("pointerdown",e=>{
        if(e.pointerType==="pen"||e.pointerType==="touch") _sketchViewport.setPointerCapture(e.pointerId);
        _sketchPressure=(e.pressure&&e.pressure>0)?e.pressure:1;
        _sketchVpDown(e);
      });
      // Track raw client position for smooth cursor — updated on any mousemove anywhere in sketch
      const _sketchUpdateCursorFromClient=(clientX,clientY)=>{
        const r=_sketchViewport.getBoundingClientRect();
        const scaleX=r.width/_sketchViewport.offsetWidth||1;
        const scaleY=r.height/_sketchViewport.offsetHeight||1;
        const vx=(clientX-r.left)/scaleX, vy=(clientY-r.top)/scaleY;
        const inside=clientX>=r.left&&clientY>=r.top&&clientX<=r.right&&clientY<=r.bottom;
        if(inside&&_sketchTool!=="move"&&!_sketchSpaceHeld&&!_sketchPanning&&_sketchCanvasWrap.style.display!=="none"){
          _sketchCursorEl.style.left=vx+"px";
          _sketchCursorEl.style.top=vy+"px";
          _sketchRefreshCursor(vx,vy);
        } else {
          _sketchCursorEl.style.display="none";
        }
      };

      _sketchViewport.addEventListener("pointermove",e=>{
        _sketchPressure=(e.pressure&&e.pressure>0)?e.pressure:1;
        _sketchUpdateCursorFromClient(e.clientX,e.clientY);
        if(_sketchPanning) return;
        _sketchVpMove(e);
      });
      _sketchViewport.addEventListener("pointerup",_sketchVpUp);
      _sketchViewport.addEventListener("pointerleave",()=>{
        _sketchCursorEl.style.display="none";
        if(!_sketchPanning&&_sketchTool!=="move") _sketchDrawing=false;
      });
      // On re-enter: resync last brush position so no jump/offset occurs
      _sketchViewport.addEventListener("pointerenter",e=>{
        if(!_sketchDrawing) return;
        if(_sketchTool==="brush"||_sketchTool==="eraser"){
          const {vx,vy}=_sketchVpPos(e);
          const {x,y}=_sketchCanvasFromVp(vx,vy);
          const layer=_sketchLayers[_sketchActiveLayer];
          if(layer){
            _sketchLastX=x-(layer._ox||0);
            _sketchLastY=y-(layer._oy||0);
          }
        }
      });
      _sketchViewport.addEventListener("touchstart",e=>{e.preventDefault();_sketchVpDown(e);},{passive:false});
      _sketchViewport.addEventListener("touchmove",e=>{e.preventDefault();_sketchVpMove(e);},{passive:false});
      _sketchViewport.addEventListener("touchend",_sketchVpUp);

      // Drag & drop image file into viewport → add as image layer
      let _sketchVpDragDepth=0;
      _sketchViewport.addEventListener("dragenter",e=>{
        if([...e.dataTransfer.types].includes("Files")){
          e.preventDefault();e.stopPropagation();_sketchVpDragDepth++;
          _sketchViewport.style.outline=`2px solid ${LIME}`;
        }
      });
      _sketchViewport.addEventListener("dragover",e=>{
        if([...e.dataTransfer.types].includes("Files")){e.preventDefault();e.stopPropagation();}
      });
      _sketchViewport.addEventListener("dragleave",()=>{
        _sketchVpDragDepth--;
        if(_sketchVpDragDepth<=0){_sketchVpDragDepth=0;_sketchViewport.style.outline="";}
      });
      _sketchViewport.addEventListener("drop",e=>{
        e.preventDefault();e.stopPropagation();
        _sketchVpDragDepth=0;_sketchViewport.style.outline="";
        const f=e.dataTransfer.files[0];
        if(f&&f.type.startsWith("image/")) _sketchAddImageLayer(f);
      });

      // Keyboard shortcuts — document-level so they work regardless of focus
      const _sketchKeyHandler=(e)=>{
        if(_sketchOv.style.display==="none") return;
        // Space = pan (handled first, always)
        if(e.code==="Space"&&!e.repeat){
          e.preventDefault();e.stopPropagation();
          _sketchSpaceHeld=true;
          if(!_sketchDrawing) _sketchViewport.style.cursor="grab";
          return;
        }
        const tag=(e.target||{}).tagName||"";
        if((e.ctrlKey||e.metaKey)&&(e.key==="z"||e.key==="Z")){
          e.preventDefault();e.stopPropagation();_sketchDoUndo();return;
        }
        // Block shortcuts only when typing in a text field. Color picker and
        // range sliders keep focus after use but don't need keyboard — let
        // shortcuts (b/e/r/c/v…) keep working after picking a color.
        const _it=(e.target||{}).type||"";
        if((tag==="INPUT"&&_it!=="color"&&_it!=="range")||tag==="TEXTAREA") return;
        if(e.ctrlKey||e.metaKey||e.altKey) return;
        switch(e.key){
          case"b":case"B":e.preventDefault();e.stopPropagation();_sketchSetTool("brush");break;
          case"e":case"E":e.preventDefault();e.stopPropagation();_sketchSetTool("eraser");break;
          case"r":case"R":e.preventDefault();e.stopPropagation();_sketchSetTool("rect");break;
          case"c":case"C":e.preventDefault();e.stopPropagation();_sketchSetTool("circle");break;
          case"v":case"V":e.preventDefault();e.stopPropagation();_sketchSetTool("move");break;
          // Photoshop / Krita style brush-size shortcuts ( [ smaller, ] larger; shift = ×10 )
          case"[":e.preventDefault();e.stopPropagation();_sketchSetSize(_sketchSize-1);break;
          case"]":e.preventDefault();e.stopPropagation();_sketchSetSize(_sketchSize+1);break;
          case"{":e.preventDefault();e.stopPropagation();_sketchSetSize(_sketchSize-10);break;
          case"}":e.preventDefault();e.stopPropagation();_sketchSetSize(_sketchSize+10);break;
          case"Delete":case"Backspace":
            e.preventDefault();e.stopPropagation();
            if(_sketchLayers.length>1){
              _sketchSaveHistory();
              _sketchLayers.splice(_sketchActiveLayer,1);
              if(_sketchActiveLayer>=_sketchLayers.length) _sketchActiveLayer=_sketchLayers.length-1;
              _sketchComposite();_sketchRebuildLayerUI();_sketchDrawBoundingBox();
            }
            break;
        }
      };
      document.addEventListener("keydown",_sketchKeyHandler,{capture:true});

      // ── Open sketch ───────────────────────────────────────────────────────
      const _openSketch=()=>{
        _sketchOv.style.display="flex";
        _sketchOv.getBoundingClientRect();
        _sketchOv.style.opacity="1";
        // Canvas is shown only after Apply — no auto-init
        _sketchOv.focus();
      };

      // Save sketch → flatten all visible layers with masks (same as _sketchComposite) → upload
      _sketchSaveBtn.onclick=async()=>{
        const flat=document.createElement("canvas");
        flat.width=_sketchCanvasW;flat.height=_sketchCanvasH;
        const fctx=flat.getContext("2d");
        fctx.fillStyle="#ffffff";fctx.fillRect(0,0,_sketchCanvasW,_sketchCanvasH);
        for(let i=_sketchLayers.length-1;i>=0;i--){
          const l=_sketchLayers[i];
          if(!l.visible) continue;
          const ox=l._ox||0,oy=l._oy||0;
          if(l.maskEnabled&&l.maskCanvas){
            const tmp=document.createElement("canvas");
            tmp.width=_sketchCanvasW;tmp.height=_sketchCanvasH;
            const tx2=tmp.getContext("2d");
            tx2.drawImage(l.canvas,ox,oy);
            tx2.globalCompositeOperation="destination-in";
            tx2.drawImage(l.maskCanvas,0,0);
            fctx.drawImage(tmp,0,0);
          } else {
            fctx.drawImage(l.canvas,ox,oy);
          }
        }
        flat.toBlob(async(blob)=>{
          if(!blob) return;
          const fname=`sketch_${Date.now()}.png`;
          const fd=new FormData();
          fd.append("image",new File([blob],fname,{type:"image/png"}));
          fd.append("overwrite","false");
          try{
            const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
            const d=await r.json();
            const uploadedName=d.name||fname;
            _sketchSaving=true;
            _paintSlot._restorePreview(uploadedName);
            _sketchSaving=false;
            _sketchLoadedSlotName=uploadedName;
            // Auto-fill the Paint prompt with a sketch-to-photo template
            if(!_sketchPromptSet){
              const _sketchPrompt=_autofillPrompts.sketch;
              S.prompt=_sketchPrompt;S[_pillPromptKey("inpaint")]=_sketchPrompt;
              if(_promptTARef){_promptTARef.value=_sketchPrompt;}
              if(typeof _promptOvTA!=="undefined"&&_promptOvTA)_promptOvTA.value=_sketchPrompt;
              persist();
              _sketchPromptSet=true;
            }
            // Close overlay but keep layers intact — user can reopen and continue editing
            _closeSketch();
          }catch(e){ console.warn("[FluxKlein] sketch save:",e); }
        },"image/png");
      };

      // Block toolbar clicks during Space pan too
      _sketchToolbar.addEventListener("click",e=>{
        if(_sketchSpaceHeld||_sketchWasPanning) e.stopImmediatePropagation();
      },{capture:true});
      _sketchToolbar.addEventListener("mousedown",e=>{
        if(_sketchSpaceHeld){ e.preventDefault();e.stopImmediatePropagation();
          _sketchStartPan(e.clientX,e.clientY); }
      },{capture:true});

      _sketchMainRow.append(_sketchToolbar,_sketchViewport,_sketchLayersPanel);
      const _sketchShortcutBar=mk("div",{
        display:"flex",alignItems:"center",justifyContent:"center",gap:"0",flexShrink:"0",
        background:"rgba(0,0,0,.35)",borderTop:`1px solid ${C.border}`,
        padding:"3px 10px",flexWrap:"wrap",rowGap:"0",
      });
      const _skShortcuts=[
        ["B","Brush"],["E","Eraser"],["R","Rect"],["C","Circle"],["V","Move/Scale"],
        ["Ctrl+Z","Undo"],["Space+drag","Pan"],["Scroll","Zoom"],
      ];
      _skShortcuts.forEach(([key,desc],idx)=>{
        if(idx>0){
          const sep=mk("div",{width:"1px",height:"12px",background:C.border,margin:"0 8px",flexShrink:"0"});
          _sketchShortcutBar.appendChild(sep);
        }
        const item=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
        const kbd=mk("span",{
          fontSize:"8px",fontWeight:"700",color:"#111",background:C.muted,
          borderRadius:"3px",padding:"1px 4px",letterSpacing:".02em",flexShrink:"0",lineHeight:"1.6",
        });
        tx(kbd,key);
        const lbl=mk("span",{fontSize:"8px",color:C.muted,whiteSpace:"nowrap"});
        tx(lbl,desc);
        item.append(kbd,lbl);
        _sketchShortcutBar.appendChild(item);
      });

      _sketchOv.append(_sketchTopBar,_sketchMainRow,_sketchShortcutBar);


      // Open sketch with canvas sized to current paint size selection
      _sketchBtn.onclick=()=>{
        _setPaintMode("sketch");
        _openSketch();
        const _currentSlotName=(_paintSlot.hasFile()&&_paintSlot.name)||null;
        // If layers exist AND the slot image hasn't changed, just reopen — don't reset
        if(_sketchLayers.length>0 && _sketchLoadedSlotName===_currentSlotName){
          _sketchComposite();_sketchRebuildLayerUI();
          return;
        }
        const res=RES_PRESETS.find(r=>r.label===_paintResDD.value);
        let w=1024,h=1024;
        if(_paintUseDimsFromImg&&_paintDimsW&&_paintDimsH){ w=_paintDimsW;h=_paintDimsH; }
        else if(res&&res.w){ w=res.w;h=res.h; }
        else if(_paintResDD.value==="Custom…"){ w=Math.round(_paintWInp.numVal)||1024;h=Math.round(_paintHInp.numVal)||1024; }
        _sketchWInp.setVal(w);_sketchHInp.setVal(h);
        // If paint slot has an image, load it as background layer
        if(_currentSlotName){
          const imgUrl=api.apiURL(`/view?filename=${encodeURIComponent(_currentSlotName)}&type=input&subfolder=`);
          const bgImg=new Image();
          bgImg.crossOrigin="anonymous";
          bgImg.onload=()=>{
            const iw=bgImg.naturalWidth||w, ih=bgImg.naturalHeight||h;
            _sketchWInp.setVal(iw);_sketchHInp.setVal(ih);
            _sketchResApply();
            _sketchLayers=[];_sketchHistory=[];
            _sketchLoadedSlotName=_currentSlotName;
            const baseName=_currentSlotName.replace(/\.[^.]+$/,"").replace(/^.*[\\/]/,"").trim()||"Background";
            const bgLayer=_sketchAddLayer(baseName);
            bgLayer._layerType="image";
            bgLayer.ctx.drawImage(bgImg,0,0,_sketchCanvasW,_sketchCanvasH);
            _sketchAddLayer("Paint");
            _sketchComposite();_sketchRebuildLayerUI();
          };
          bgImg.src=imgUrl;
        }
      };

      // ── MASK / OUTPAINT EDITOR OVERLAY ───────────────────────────────────
      const _maskOv=mk("div",{
        position:"absolute",inset:"0",zIndex:"275",background:C.bg0,
        display:"none",flexDirection:"column",boxSizing:"border-box",
        opacity:"0",transition:"opacity 0.15s ease",
      });
      _maskOv.setAttribute("tabindex","-1"); // focusable so keyboard shortcuts work

      // ── Shared state ──────────────────────────────────────────────────────
      let _maskMode="inpaint";   // "inpaint" | "outpaint"
      let _maskZoom=1;
      let _maskPanX=0,_maskPanY=0;
      let _maskTool="brush";
      let _maskSize=30;
      let _maskHardness=1; // 1=hard, 0=fully soft
      let _maskDrawing=false;
      let _maskLastX=0,_maskLastY=0;
      let _maskRectStart=null,_maskRectEnd=null; // marquee (rectangle select) drag corners, canvas coords
      let _maskCanvasW=512,_maskCanvasH=512;
      let _maskHistory=[];
      let _maskSourceImgEl=null;

      // Outpaint expand amounts (pixels on each side)
      let _opTop=0,_opRight=0,_opBottom=0,_opLeft=0;

      // Offscreen canvases
      const _maskDisplayCanvas=mk("canvas",{position:"absolute",top:"0",left:"0"});
      const _maskCanvas=mk("canvas",{display:"none"});

      const _maskCanvasWrap=mk("div",{position:"relative",transformOrigin:"0 0",cursor:"inherit"});
      _maskCanvasWrap.appendChild(_maskDisplayCanvas);

      // Cursor circle (inside wrap so it scales with zoom for correct visual size)
      const _maskCursor=mk("div",{
        position:"absolute",borderRadius:"50%",border:`2px solid ${LIME}`,
        pointerEvents:"none",display:"none",zIndex:"10",boxSizing:"border-box",
        transform:"translate(-50%,-50%)",
      });
      _maskCanvasWrap.appendChild(_maskCursor);

      // Marquee (rectangle select) preview — inside the wrap so it scales with zoom
      const _maskRectPreview=mk("div",{
        position:"absolute",border:`2px dashed ${LIME}`,background:"rgba(240,255,65,.18)",
        pointerEvents:"none",display:"none",zIndex:"11",boxSizing:"border-box",
      });
      _maskCanvasWrap.appendChild(_maskRectPreview);

      // Outpaint handles overlay (sits on top of canvas wrap, same coordinate space)
      const _opHandleOv=mk("div",{
        position:"absolute",inset:"0",pointerEvents:"none",zIndex:"5",overflow:"visible",
      });
      _maskCanvasWrap.appendChild(_opHandleOv);

      const _maskViewport=mk("div",{
        flex:"1",overflow:"hidden",position:"relative",background:"#111",cursor:"default",
      });
      _maskViewport.classList.add("_fk_mask_vp");
      _maskViewport.appendChild(_maskCanvasWrap);

      const _maskCtx=()=>_maskCanvas.getContext("2d");
      const _maskDispCtx=()=>_maskDisplayCanvas.getContext("2d");

      const _maskApplyTransform=()=>{
        _maskCanvasWrap.style.width=_maskCanvasW+"px";
        _maskCanvasWrap.style.height=_maskCanvasH+"px";
        _maskCanvasWrap.style.transform=`translate(${_maskPanX}px,${_maskPanY}px) scale(${_maskZoom})`;
      };

      const _maskComposite=()=>{
        const dctx=_maskDispCtx();
        dctx.clearRect(0,0,_maskCanvasW,_maskCanvasH);
        if(_maskSourceImgEl) dctx.drawImage(_maskSourceImgEl,0,0,_maskCanvasW,_maskCanvasH);
        // Red tint for painted area
        const tmpC=document.createElement("canvas");
        tmpC.width=_maskCanvasW;tmpC.height=_maskCanvasH;
        const tmpX=tmpC.getContext("2d");
        tmpX.drawImage(_maskCanvas,0,0);
        tmpX.globalCompositeOperation="source-in";
        tmpX.fillStyle="rgba(255,80,80,1)";
        tmpX.fillRect(0,0,_maskCanvasW,_maskCanvasH);
        dctx.save();dctx.globalAlpha=0.55;dctx.drawImage(tmpC,0,0);dctx.restore();
      };

      const _maskSaveHistory=()=>{
        _maskHistory.push(_maskCtx().getImageData(0,0,_maskCanvasW,_maskCanvasH));
        if(_maskHistory.length>40)_maskHistory.shift();
      };
      const _maskUndo=()=>{
        if(!_maskHistory.length)return;
        _maskCtx().putImageData(_maskHistory.pop(),0,0);
        _maskComposite();
      };
      const _maskClear=()=>{
        _maskSaveHistory();_maskCtx().clearRect(0,0,_maskCanvasW,_maskCanvasH);
        _maskSavedData=null;_maskSavedW=0;_maskSavedH=0; // reset persisted mask
        _maskComposite();
      };

      const _maskFitView=()=>{
        const vw=_maskViewport.clientWidth||620, vh=_maskViewport.clientHeight||400;
        // In outpaint mode zoom out extra so handles outside the image are visible
        const margin=_maskMode==="outpaint"?120:60;
        const s=Math.min((vw-margin)/_maskCanvasW,(vh-margin)/_maskCanvasH,4);
        _maskZoom=s;
        _maskPanX=(vw-_maskCanvasW*s)/2;
        _maskPanY=(vh-_maskCanvasH*s)/2;
        _maskApplyTransform();
      };

      // ── Correct canvas coords: use offsetX/Y on the canvas itself ─────────
      // getBoundingClientRect includes CSS scale — dividing by zoom would double-correct.
      // Instead we use the raw clientX/Y relative to the wrap's top-left, then divide by zoom.
      const _maskVpScale=()=>{
        const r=_maskViewport.getBoundingClientRect();
        return {
          scaleX:r.width/_maskViewport.offsetWidth||1,
          scaleY:r.height/_maskViewport.offsetHeight||1,
          r,
        };
      };
      const _maskCanvasCoords=(e)=>{
        const {scaleX,scaleY,r}=_maskVpScale();
        const vx=(e.clientX-r.left)/scaleX-_maskPanX;
        const vy=(e.clientY-r.top)/scaleY-_maskPanY;
        return { x:vx/_maskZoom, y:vy/_maskZoom };
      };

      const _maskDraw=(x,y)=>{
        const r=_maskSize/2;
        const softness=1-_maskHardness;
        const isEraser=_maskTool==="eraser";
        if(softness>0){
          // Soft brush via offscreen canvas + shadowBlur (same technique as Sketch)
          const sz=Math.ceil(r*2+r*softness*5+4);
          const off=document.createElement("canvas");
          off.width=sz;off.height=sz;
          const octx=off.getContext("2d");
          const cx=sz/2,cy=sz/2;
          octx.fillStyle="rgba(255,255,255,1)";
          octx.shadowColor="rgba(255,255,255,1)";
          octx.shadowBlur=r*softness*2.5;
          octx.beginPath();octx.arc(cx,cy,r,0,Math.PI*2);octx.fill();
          const ctx=_maskCtx();
          ctx.save();
          ctx.globalCompositeOperation=isEraser?"destination-out":"source-over";
          ctx.drawImage(off,x-cx,y-cy);
          ctx.restore();
        } else {
          const ctx=_maskCtx();
          ctx.save();
          ctx.globalCompositeOperation=isEraser?"destination-out":"source-over";
          ctx.fillStyle="rgba(255,255,255,1)";
          ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
          ctx.restore();
        }
        _maskComposite();
      };
      const _maskDrawLine=(x1,y1,x2,y2)=>{
        const dist=Math.sqrt((x2-x1)**2+(y2-y1)**2);
        const steps=Math.max(1,Math.floor(dist/(_maskSize*0.25)));
        for(let i=0;i<=steps;i++){const t=i/steps;_maskDraw(x1+t*(x2-x1),y1+t*(y2-y1));}
      };

      // ── Marquee (rectangle select) — drag a box to mask a rectangular area ──
      const _maskUpdateRectPreview=()=>{
        if(!_maskRectStart||!_maskRectEnd){ _maskRectPreview.style.display="none"; return; }
        const x0=Math.min(_maskRectStart.x,_maskRectEnd.x);
        const y0=Math.min(_maskRectStart.y,_maskRectEnd.y);
        const w=Math.abs(_maskRectEnd.x-_maskRectStart.x);
        const h=Math.abs(_maskRectEnd.y-_maskRectStart.y);
        _maskRectPreview.style.display="block";
        _maskRectPreview.style.left=x0+"px";_maskRectPreview.style.top=y0+"px";
        _maskRectPreview.style.width=w+"px";_maskRectPreview.style.height=h+"px";
      };
      const _maskCommitRect=()=>{
        _maskRectPreview.style.display="none";
        if(!_maskRectStart||!_maskRectEnd){ _maskRectStart=null;_maskRectEnd=null; return; }
        const x0=Math.max(0,Math.min(_maskRectStart.x,_maskRectEnd.x));
        const y0=Math.max(0,Math.min(_maskRectStart.y,_maskRectEnd.y));
        const x1=Math.min(_maskCanvasW,Math.max(_maskRectStart.x,_maskRectEnd.x));
        const y1=Math.min(_maskCanvasH,Math.max(_maskRectStart.y,_maskRectEnd.y));
        _maskRectStart=null;_maskRectEnd=null;
        const w=x1-x0,h=y1-y0;
        if(w<1||h<1) return;
        _maskSaveHistory();
        const ctx=_maskCtx();
        ctx.save();
        ctx.globalCompositeOperation="source-over";
        ctx.fillStyle="rgba(255,255,255,1)";
        ctx.fillRect(x0,y0,w,h);
        ctx.restore();
        _maskComposite();
      };

      // ── Top bar ───────────────────────────────────────────────────────────
      const _maskTopBar=mk("div",{
        display:"flex",alignItems:"center",gap:"6px",padding:"6px 10px",
        borderBottom:`1px solid ${C.border}`,flexShrink:"0",background:C.bg1,
        flexWrap:"nowrap",overflow:"hidden",minWidth:"0",
      });

      // Mode tabs
      const _mkMaskTab=(label)=>{
        const b=mk("button",{
          background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",
          padding:"5px 14px",fontSize:"11px",fontWeight:"700",cursor:"pointer",outline:"none",
          color:C.muted,letterSpacing:".03em",transition:"all .15s",
        });
        tx(b,label);
        b._setActive=(on)=>{
          b.style.background=on?"rgba(240,255,65,.15)":"transparent";
          b.style.borderColor=on?LIME:C.border;
          b.style.color=on?LIME:C.muted;
        };
        b.onmouseenter=()=>{ if(!b._on)b.style.borderColor=LIME; };
        b.onmouseleave=()=>{ if(!b._on)b.style.borderColor=C.border; };
        return b;
      };
      const _maskTabInpaint=_mkMaskTab("Inpaint");
      const _maskTabOutpaint=_mkMaskTab("Outpaint");

      const _mkMaskSep=()=>mk("div",{width:"1px",height:"20px",background:C.border,flexShrink:"0"});

      // Brush tool buttons (only visible in inpaint mode)
      const _mkMaskToolBtn=(icon,label)=>{
        const b=mk("button",{
          background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",
          padding:"4px 10px",fontSize:"11px",cursor:"pointer",outline:"none",
          display:"flex",alignItems:"center",gap:"5px",color:C.text,
          transition:"border-color .15s,background .15s,color .15s",
        });
        const sp=mk("span",{fontSize:"13px"});tx(sp,icon);
        const l=mk("span");tx(l,label);
        b.append(sp,l);
        b._setActive=(on)=>{
          b._on=on;
          b.style.background=on?"rgba(240,255,65,.15)":C.bg2;
          b.style.borderColor=on?LIME:C.border;
          b.style.color=on?LIME:C.text;
        };
        b.onmouseenter=()=>{ if(!b._on)b.style.borderColor=LIME; };
        b.onmouseleave=()=>{ if(!b._on)b.style.borderColor=C.border; };
        return b;
      };
      const _maskBrushBtn=_mkMaskToolBtn("●","Brush");
      const _maskEraserBtn=_mkMaskToolBtn("○","Eraser");
      const _maskRectBtn=_mkMaskToolBtn("▭","Rect");
      _maskRectBtn.title="Rectangle marquee — drag to mask a rectangular area [R]";

      const _maskSetTool=(t)=>{
        _maskTool=t;
        _maskBrushBtn._setActive(t==="brush");
        _maskEraserBtn._setActive(t==="eraser");
        _maskRectBtn._setActive(t==="rect");
        if(_maskMode==="inpaint") _maskViewport.style.cursor=t==="rect"?"crosshair":"none";
        if(t==="rect") _maskCursor.style.display="none";
      };
      _maskBrushBtn.onclick=()=>_maskSetTool("brush");
      _maskEraserBtn.onclick=()=>_maskSetTool("eraser");
      _maskRectBtn.onclick=()=>_maskSetTool("rect");

      // Brush size group — compact for single-row layout
      const _maskSizeLbl=mk("div",{fontSize:"8px",color:C.muted,whiteSpace:"nowrap",flexShrink:"0"});tx(_maskSizeLbl,"Size");
      _maskSizeLbl.title="Brush size — [ smaller · ] larger  (Shift = larger steps)";
      const _maskSizeSlider=mk("input",{width:"60px",accentColor:LIME,flexShrink:"0"},{type:"range",min:"2",max:"500",step:"1",value:String(_maskSize)});
      const _maskSizeNum=mk("input",{
width:"34px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"4px",
        color:C.text,fontSize:"10px",textAlign:"center",padding:"1px 2px",outline:"none",flexShrink:"0",
      },{type:"number",min:"2",max:"200",step:"1",value:String(_maskSize)});
      const _maskSyncSize=(v)=>{
        _maskSize=Math.max(2,Math.min(500,+v||30));
        _maskSizeSlider.value=String(_maskSize);_maskSizeNum.value=String(_maskSize);
        // cursor size in viewport px = brush diameter * zoom
        const sz=_maskSize*_maskZoom;
        _maskCursor.style.width=sz+"px";_maskCursor.style.height=sz+"px";
      };
      _maskSizeSlider.oninput=()=>_maskSyncSize(_maskSizeSlider.value);
      _maskSizeNum.oninput=()=>_maskSyncSize(_maskSizeNum.value);

      const _maskUndoBtn=_mkMaskToolBtn("↩","Undo");_maskUndoBtn.onclick=_maskUndo;
      const _maskClearBtn=_mkMaskToolBtn("✕","Reset Mask");_maskClearBtn.onclick=_maskClear;

      // Hardness slider — compact
      const _maskHardLbl=mk("div",{fontSize:"8px",color:C.muted,whiteSpace:"nowrap",flexShrink:"0"});tx(_maskHardLbl,"Hard");
      const _maskHardSlider=mk("input",{width:"60px",accentColor:LIME,flexShrink:"0"},{type:"range",min:"0",max:"100",step:"1",value:"100"});
      const _maskHardNum=mk("input",{
        width:"34px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"4px",
        color:C.text,fontSize:"10px",textAlign:"center",padding:"1px 2px",outline:"none",flexShrink:"0",
      },{type:"number",min:"0",max:"100",step:"1",value:"100"});
      const _maskSyncHard=(v)=>{
        const val=Math.max(0,Math.min(100,+v||100));
        _maskHardness=val/100;
        _maskHardSlider.value=String(val);_maskHardNum.value=String(val);
      };
      _maskHardSlider.oninput=()=>_maskSyncHard(_maskHardSlider.value);
      _maskHardNum.oninput=()=>_maskSyncHard(_maskHardNum.value);

      // Brush-only controls group (hidden in outpaint mode)
      const _maskBrushGroup=[_maskBrushBtn,_maskEraserBtn,_maskRectBtn,_mkMaskSep(),_maskSizeLbl,_maskSizeSlider,_maskSizeNum,_mkMaskSep(),_maskHardLbl,_maskHardSlider,_maskHardNum,_mkMaskSep(),_maskUndoBtn,_maskClearBtn,_mkMaskSep()];

      // Confirm / Cancel
      const _maskSpacer=mk("div",{flex:"1"});
      const _maskConfirmBtn=mk("button",{
        background:LIME,color:"#111",border:"none",borderRadius:"6px",
        padding:"5px 14px",fontSize:"11px",fontWeight:"700",cursor:"pointer",outline:"none",
        transition:"opacity .15s",whiteSpace:"nowrap",flexShrink:"0",
      });
      tx(_maskConfirmBtn,"Apply Changes");
      _maskConfirmBtn.onmouseenter=()=>_maskConfirmBtn.style.opacity=".82";
      _maskConfirmBtn.onmouseleave=()=>_maskConfirmBtn.style.opacity="1";

      const _maskCancelBtn=mk("button",{
        background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",
        padding:"5px 12px",fontSize:"11px",color:C.muted,cursor:"pointer",outline:"none",
        transition:"border-color .15s,color .15s",whiteSpace:"nowrap",flexShrink:"0",
      });
      tx(_maskCancelBtn,"Cancel");
      _maskCancelBtn.onmouseenter=()=>{ _maskCancelBtn.style.borderColor=C.err;_maskCancelBtn.style.color=C.err; };
      _maskCancelBtn.onmouseleave=()=>{ _maskCancelBtn.style.borderColor=C.border;_maskCancelBtn.style.color=C.muted; };

      // Hint bar shown below top bar in outpaint mode only
      const _opHintBar=mk("div",{
        display:"none",padding:"7px 14px",background:"rgba(255,255,255,.05)",
        borderBottom:`1px solid ${C.border}`,flexShrink:"0",
        fontSize:"11px",color:LIME,lineHeight:"1.5",fontWeight:"300",
        textAlign:"center",
      });
      tx(_opHintBar,"Expand your image — set how many pixels to add on each side, then click Apply Changes.");

      const _rebuildMaskTopBar=()=>{
        _maskTopBar.innerHTML="";
        const isInp=_maskMode==="inpaint";
        _maskTabInpaint._setActive(isInp);_maskTabInpaint._on=isInp;
        _maskTabOutpaint._setActive(!isInp);_maskTabOutpaint._on=!isInp;
        _maskTopBar.append(_maskTabInpaint,_maskTabOutpaint,_mkMaskSep());
        if(isInp) _maskBrushGroup.forEach(el=>_maskTopBar.appendChild(el));
        _opHintBar.style.display=isInp?"none":"block";
        tx(_maskConfirmBtn,isInp?"Apply":"Apply Changes");
        _maskTopBar.append(_maskSpacer,_maskConfirmBtn,_maskCancelBtn);
      };

      // ── Outpaint controls bar ─────────────────────────────────────────────
      const _opBar=mk("div",{
        display:"none",flexDirection:"column",gap:"0",
        borderTop:`1px solid ${C.border}`,background:C.bg1,flexShrink:"0",
      });

      // Helper: compact number input for expand fields
      const _mkOpField=(label)=>{
        const wrap=mk("div",{display:"flex",flexDirection:"column",alignItems:"center",gap:"2px"});
        const inp=mk("input",{
          width:"52px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"5px",
          color:C.text,fontSize:"9px",fontWeight:"600",textAlign:"center",
          padding:"3px 2px",outline:"none",transition:"border-color .15s",boxSizing:"border-box",
        },{type:"number",min:"0",max:"8192",step:"8",value:"0"});
        inp.onfocus=()=>inp.style.borderColor=LIME;
        inp.onblur=()=>{
          inp.style.borderColor=C.border;
          const v=Math.max(0,Math.round((+inp.value||0)/8)*8);
          inp.value=String(v);
          _opCommitFromFields();
        };
        inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); inp.blur(); } });
        const lbl=mk("div",{fontSize:"7px",fontWeight:"600",letterSpacing:".06em",
          textTransform:"uppercase",color:C.muted,whiteSpace:"nowrap"});
        tx(lbl,label);
        wrap.append(inp,lbl);
        wrap._inp=inp;
        return wrap;
      };

      const _opTopField   =_mkOpField("Top");
      const _opRightField =_mkOpField("Right");
      const _opBottomField=_mkOpField("Bottom");
      const _opLeftField  =_mkOpField("Left");

      // _opResW/_opResH aliases so Apply Changes logic still works
      const _opResW={value:""};
      const _opResH={value:""};

      // ── Size badge state: lime=use expanded size (locked), plain=scale unlocked ──
      let _opUseExpandedSize=true;

      const _opDimsLbl=mk("div",{
        fontSize:"9px",fontWeight:"700",whiteSpace:"nowrap",
        padding:"5px 10px",borderRadius:"6px",cursor:"default",
        border:`1px solid ${C.borderH}`,background:C.bg3,color:C.text,
        transition:"color .15s,background .15s,border-color .15s",
      });

      const _opResLonger=mk("input",{
        width:"62px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"5px",
        color:C.text,fontSize:"9px",fontWeight:"600",textAlign:"center",
        padding:"3px 4px",outline:"none",transition:"border-color .15s",
      },{type:"number",min:"0",max:"8192",step:"8",placeholder:"px",value:"1024"});
      _opResLonger.onfocus=()=>_opResLonger.style.borderColor=LIME;
      _opResLonger.onblur=()=>_opResLonger.style.borderColor=C.border;

      const _opResResultLbl=mk("span",{
        fontSize:"9px",color:LIME,fontWeight:"700",whiteSpace:"nowrap",
      });

      const _opScaleRow=mk("div",{
        display:"flex",alignItems:"center",gap:"6px",
        border:`1px solid ${C.border}`,borderRadius:"6px",padding:"5px 10px",
        background:C.bg1,transition:"opacity .15s",
      });
      const _opScaleLbl=mk("span",{fontSize:"9px",fontWeight:"600",color:C.muted,whiteSpace:"nowrap"});
      tx(_opScaleLbl,"Scale by longer side");
      _opScaleRow.append(_opScaleLbl,_opResLonger,_opResResultLbl);

      const _opApplyBadgeState=()=>{
        const w=_maskCanvasW+_opLeft+_opRight, h=_maskCanvasH+_opTop+_opBottom;
        const hasExpand=w!==_maskCanvasW||h!==_maskCanvasH;
        if(_opUseExpandedSize){
          tx(_opDimsLbl,`${w}×${h}`);
          _opDimsLbl.style.color=hasExpand?LIME:C.muted;
          _opDimsLbl.style.background=hasExpand?"rgba(240,255,65,.1)":C.bg3;
          _opDimsLbl.style.borderColor=hasExpand?"rgba(240,255,65,.4)":C.borderH;
          _opDimsLbl.style.cursor=hasExpand?"pointer":"default";
          _opDimsLbl.title=hasExpand?"Click to set custom scale instead":"";
          _opScaleRow.style.opacity="0.35";
          _opScaleRow.style.pointerEvents="none";
          _opResLonger.disabled=true;
          _opResW.value=""; _opResH.value="";
          tx(_opResResultLbl,"");
        } else {
          tx(_opDimsLbl,`${w}×${h}`);
          _opDimsLbl.style.color=C.text;
          _opDimsLbl.style.background=C.bg3;
          _opDimsLbl.style.borderColor=C.borderH;
          _opDimsLbl.style.cursor="pointer";
          _opDimsLbl.title="Click to use expanded size";
          _opScaleRow.style.opacity="1";
          _opScaleRow.style.pointerEvents="auto";
          _opResLonger.disabled=false;
        }
      };

      const _opUpdateDimsLbl=()=>{
        _opRow2.style.display="flex";
        _opApplyBadgeState();
        if(!_opUseExpandedSize) _opResRefresh();
      };

      _opDimsLbl.onclick=()=>{
        const w=_maskCanvasW+_opLeft+_opRight, h=_maskCanvasH+_opTop+_opBottom;
        if(w===_maskCanvasW&&h===_maskCanvasH) return;
        _opUseExpandedSize=!_opUseExpandedSize;
        if(_opUseExpandedSize){ _opResLonger.value=""; _opResW.value=""; _opResH.value=""; tx(_opResResultLbl,""); }
        _opApplyBadgeState();
        _opResRefresh();
      };

      // Feather width (px) the mask fades into the original at the seam.
      // S.opFeather === 0 means "auto": the original min(cap, edge/div) heuristic.
      // A user value overrides it, clamped so it never exceeds half the original region.
      const _opFeatherPx=(edgeMin,autoCap,autoDiv)=>{
        const auto=Math.floor(edgeMin/(autoDiv||6));
        const base=(+S.opFeather>0)?+S.opFeather:Math.min(autoCap,auto);
        return Math.max(1,Math.min(base,Math.floor(edgeMin/2)));
      };

      const _opCalcDims=()=>{
        const curTop=Math.max(0,Math.round((+_opTopField._inp.value||0)/8)*8);
        const curRight=Math.max(0,Math.round((+_opRightField._inp.value||0)/8)*8);
        const curBottom=Math.max(0,Math.round((+_opBottomField._inp.value||0)/8)*8);
        const curLeft=Math.max(0,Math.round((+_opLeftField._inp.value||0)/8)*8);
        const expW=_maskCanvasW+curLeft+curRight;
        const expH=_maskCanvasH+curTop+curBottom;
        if(_opUseExpandedSize||expW<=0||expH<=0) return {w:expW,h:expH,resized:false};
        const longer=parseInt(_opResLonger.value)||0;
        if(!longer) return {w:expW,h:expH,resized:false};
        const ar=expW/expH;
        let fw,fh;
        if(expW>=expH){ fw=longer; fh=Math.round(longer/ar); }
        else { fh=longer; fw=Math.round(longer*ar); }
        fw=Math.max(16,Math.round(fw/16)*16); fh=Math.max(16,Math.round(fh/16)*16);
        return {w:fw,h:fh,resized:true};
      };
      const _opResRefresh=()=>{
        const {w,h,resized}=_opCalcDims();
        if(resized){ _opResW.value=String(w); _opResH.value=String(h); tx(_opResResultLbl,`→ ${w}×${h}`); }
        else { _opResW.value=""; _opResH.value=""; tx(_opResResultLbl,""); }
        _paintDimsW=w||_maskCanvasW; _paintDimsH=h||_maskCanvasH;
        _paintRefreshDimsLbl();
      };
      _opResLonger.oninput=_opResRefresh;
      _opResLonger.onblur=()=>{ _opResLonger.style.borderColor=C.border; _opResRefresh(); };

      // ── Row 1: EXPAND IMAGE — 4 fields in one row ─────────────────────────
      const _opRow1=mk("div",{
        display:"flex",flexDirection:"column",alignItems:"center",gap:"6px",
        padding:"10px 16px 8px",
      });
      const _opExpandLbl=mk("div",{fontSize:"8px",fontWeight:"700",letterSpacing:".1em",
        textTransform:"uppercase",color:C.muted,whiteSpace:"nowrap"});
      tx(_opExpandLbl,"Expand Image");
      const _opFieldsRow=mk("div",{display:"flex",alignItems:"flex-start",gap:"6px"});
      _opFieldsRow.append(_opTopField,_opRightField,_opBottomField,_opLeftField);
      _opRow1.append(_opExpandLbl,_opFieldsRow);

      // ── Feather control: how far the mask fades into the original at the seam ──
      // 0 = Auto (the original heuristic). Higher = softer blend, fewer visible seams.
      const _opFeatherRow=mk("div",{
        display:"flex",alignItems:"center",gap:"6px",
        border:`1px solid ${C.border}`,borderRadius:"6px",padding:"5px 10px",
        background:C.bg1,
      });
      const _opFeatherLbl=mk("span",{fontSize:"9px",fontWeight:"600",color:C.muted,whiteSpace:"nowrap"});
      tx(_opFeatherLbl,"Seam feather");
      const _opFeatherSlider=mk("input",{width:"82px",accentColor:LIME,flexShrink:"0"},
        {type:"range",min:"0",max:"256",step:"4",value:String(+S.opFeather||0)});
      const _opFeatherVal=mk("span",{fontSize:"9px",color:LIME,fontWeight:"700",whiteSpace:"nowrap",minWidth:"30px"});
      const _opFeatherFmt=()=>{ const v=+S.opFeather||0; tx(_opFeatherVal, v>0?`${v}px`:"Auto"); };
      _opFeatherFmt();
      _opFeatherRow.title="How far the mask fades into the original at the seam. Higher = softer blend, fewer visible seams. 0 = Auto.";
      _opFeatherSlider.oninput=()=>{ S.opFeather=+_opFeatherSlider.value||0; _opFeatherFmt(); persist(); };
      _opFeatherRow.append(_opFeatherLbl,_opFeatherSlider,_opFeatherVal);

      // ── Row 2: size badge + scale + feather ───────────────────────────────
      const _opRow2=mk("div",{
        display:"none",alignItems:"center",justifyContent:"center",gap:"10px",
        padding:"6px 16px 10px",borderTop:`1px solid rgba(255,255,255,.05)`,
      });
      _opRow2.append(_opDimsLbl,_opScaleRow,_opFeatherRow);
      _opBar.append(_opRow1,_opRow2);

      // ── Outpaint drag handles (canvas-space, inside _opHandleOv) ─────────
      const GRIP_R=10; // grip circle radius in canvas px

      const _mkOpHandle=(edge)=>{
        // line + grip both live in canvas-space; positioned via style.left/top in px
        const line=mk("div",{position:"absolute",pointerEvents:"none",
          background:"rgba(240,255,65,.4)"});
        const grip=mk("div",{
          position:"absolute",
          width:`${GRIP_R*2}px`,height:`${GRIP_R*2}px`,
          borderRadius:"50%",background:LIME,border:"2px solid #111",
          boxSizing:"border-box",pointerEvents:"auto",zIndex:"3",
          boxShadow:"0 1px 6px rgba(0,0,0,.7)",
        });
        grip.onmouseenter=()=>{ grip.style.transform="translate(-50%,-50%) scale(1.3)"; };
        grip.onmouseleave=()=>{ grip.style.transform="translate(-50%,-50%)"; };
        grip.style.transform="translate(-50%,-50%)";
        const grp=mk("div",{position:"absolute",inset:"0",pointerEvents:"none",overflow:"visible"});
        grp.append(line,grip);
        _opHandleOv.appendChild(grp);
        return {grp,line,grip,edge};
      };

      const _opHandles={
        top:   _mkOpHandle("top"),
        right: _mkOpHandle("right"),
        bottom:_mkOpHandle("bottom"),
        left:  _mkOpHandle("left"),
      };

      // Position a single handle based on current _op* values and canvas size
      const _opPositionHandle=(h)=>{
        const {edge,line,grip}=h;
        const W=_maskCanvasW, H=_maskCanvasH;
        if(edge==="top"){
          const y=-_opTop;
          Object.assign(line.style,{left:"0",top:`${y-1}px`,width:`${W}px`,height:"2px"});
          Object.assign(grip.style,{left:`${W/2}px`,top:`${y}px`,cursor:"ns-resize"});
        } else if(edge==="bottom"){
          const y=H+_opBottom;
          Object.assign(line.style,{left:"0",top:`${y-1}px`,width:`${W}px`,height:"2px"});
          Object.assign(grip.style,{left:`${W/2}px`,top:`${y}px`,cursor:"ns-resize"});
        } else if(edge==="left"){
          const x=-_opLeft;
          Object.assign(line.style,{top:"0",left:`${x-1}px`,height:`${H}px`,width:"2px"});
          Object.assign(grip.style,{top:`${H/2}px`,left:`${x}px`,cursor:"ew-resize"});
        } else { // right
          const x=W+_opRight;
          Object.assign(line.style,{top:"0",left:`${x-1}px`,height:`${H}px`,width:"2px"});
          Object.assign(grip.style,{top:`${H/2}px`,left:`${x}px`,cursor:"ew-resize"});
        }
      };

      // Reposition all handles + refresh dims label + sync input fields
      const _opPositionAllHandles=()=>{
        Object.values(_opHandles).forEach(_opPositionHandle);
        _opUpdateDimsLbl();
        _opResRefresh();
        // Write current _op* values back to fields (only when NOT currently focused)
        const fields={top:_opTopField,right:_opRightField,bottom:_opBottomField,left:_opLeftField};
        const vals={top:_opTop,right:_opRight,bottom:_opBottom,left:_opLeft};
        Object.entries(fields).forEach(([k,f])=>{
          if(document.activeElement!==f._inp) f._inp.value=String(vals[k]);
        });
      };

      // Read all four fields → snap to 8px → update _op* state → refresh handles
      const _opCommitFromFields=()=>{
        _opTop   =Math.max(0,Math.round((+_opTopField._inp.value   ||0)/8)*8);
        _opRight =Math.max(0,Math.round((+_opRightField._inp.value ||0)/8)*8);
        _opBottom=Math.max(0,Math.round((+_opBottomField._inp.value||0)/8)*8);
        _opLeft  =Math.max(0,Math.round((+_opLeftField._inp.value  ||0)/8)*8);
        _opPositionAllHandles();
        _opResRefresh();
      };

      const _opShowHandles=(on)=>{
        _opHandleOv.style.display=on?"block":"none";
        _opBar.style.display=on?"flex":"none";
      };

      // ── Drag logic ────────────────────────────────────────────────────────
      let _opDragging=null;
      let _opDragStartPx=0, _opDragStartVal=0;

      Object.values(_opHandles).forEach(({grip,edge})=>{
        grip.addEventListener("mousedown",(e)=>{
          if(e.button!==0) return;
          e.preventDefault();e.stopPropagation();
          _opDragging=edge;
          _opDragStartPx=(edge==="top"||edge==="bottom")?e.clientY:e.clientX;
          _opDragStartVal=edge==="top"?_opTop:edge==="right"?_opRight:
                          edge==="bottom"?_opBottom:_opLeft;
        });
      });

      document.addEventListener("mousemove",(e)=>{
        if(!_opDragging) return;
        const curPx=((_opDragging==="top")||(_opDragging==="bottom"))?e.clientY:e.clientX;
        const rawDelta=(curPx-_opDragStartPx)/_maskZoom;
        // top/left expand by dragging away (negative delta)
        const sign=(_opDragging==="top"||_opDragging==="left")?-1:1;
        const snapped=Math.round((rawDelta*sign)/8)*8;
        const newVal=Math.max(0,_opDragStartVal+snapped);
        if(_opDragging==="top")         _opTop=newVal;
        else if(_opDragging==="right")  _opRight=newVal;
        else if(_opDragging==="bottom") _opBottom=newVal;
        else                            _opLeft=newVal;
        _opPositionAllHandles();
      });

      document.addEventListener("mouseup",()=>{ _opDragging=null; });

      // ── Mode switch ───────────────────────────────────────────────────────
      const _setMaskMode=(m)=>{
        _maskMode=m;
        _rebuildMaskTopBar();
        const isInp=m==="inpaint";
        _maskViewport.style.cursor=isInp?(_maskTool==="rect"?"crosshair":"none"):"default";
        _maskDropZone.style.cursor=isInp?"none":"pointer";
        _maskCursor.style.display="none";
        _opShowHandles(!isInp);
        if(!isInp) _opPositionAllHandles();
        _opBar.style.display=isInp?"none":"flex";
        _inpBar.style.display=(isInp&&!!_maskSourceImgEl)?"flex":"none";
        if(isInp&&_maskSourceImgEl) _inpApplyBadgeState();
      };
      _maskTabInpaint.onclick=()=>_setMaskMode("inpaint");
      _maskTabOutpaint.onclick=()=>_setMaskMode("outpaint");

      // ── Image drop zone (shown when no image loaded) ───────────────────────
      const _maskDropZone=mk("div",{
        position:"absolute",inset:"0",display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",gap:"10px",
        background:"rgba(0,0,0,.65)",zIndex:"20",cursor:"pointer",
      });
      const _maskDropIcon=mk("div",{fontSize:"36px",lineHeight:"1",color:C.muted});
      tx(_maskDropIcon,"⬆");
      const _maskDropLbl=mk("div",{fontSize:"13px",color:C.muted,fontWeight:"600"});
      tx(_maskDropLbl,"Drop image here or click to upload");
      const _maskDropInp=mk("input",{position:"absolute",opacity:"0",width:"0",height:"0",pointerEvents:"none"},{type:"file",accept:"image/*"});
      _maskDropZone.append(_maskDropIcon,_maskDropLbl);
      _maskViewport.appendChild(_maskDropZone);
      _maskViewport.appendChild(_maskDropInp);

      const _maskLoadImageIntoEditor=(file)=>{
        const objUrl=URL.createObjectURL(file);
        const img=new Image();
        img.onload=async()=>{
          _maskSourceImgEl=img;
          _maskCanvasW=img.naturalWidth;_maskCanvasH=img.naturalHeight;
          _maskDisplayCanvas.width=_maskCanvasW;_maskDisplayCanvas.height=_maskCanvasH;
          _maskCanvas.width=_maskCanvasW;_maskCanvas.height=_maskCanvasH;
          _maskCtx().clearRect(0,0,_maskCanvasW,_maskCanvasH);
          _maskComposite();
          _maskDropZone.style.display="none";
          _maskViewport.style.cursor=_maskMode==="inpaint"?"none":"default";
          requestAnimationFrame(_maskFitView);
          if(_maskMode==="outpaint") _opPositionAllHandles();
          // Refresh size badges after canvas dims are known
          if(_maskMode==="inpaint"){ _inpBar.style.display="flex"; _inpApplyBadgeState(); }
          else { _opRow2.style.display="flex"; _opUpdateDimsLbl(); }
          // Update paint slot dims so size calculations work correctly
          _paintDimsW=img.naturalWidth;_paintDimsH=img.naturalHeight;
          if(!_paintUseDimsFromImg) _paintUseDimsFromImg=true;
          _paintRefreshDimsLbl();
          const fd=new FormData();fd.append("image",file);fd.append("overwrite","true");
          try{
            const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
            const d=await r.json();
            // Use flag to prevent onFile callback from clearing mask/outpaint state
            _sketchSaving=true;
            _paintSlot._restorePreview(d.name||file.name);
            _sketchSaving=false;
          }catch(err){console.warn("[FluxKlein] overlay upload:",err);}
        };
        img.src=objUrl;
      };

      _maskDropZone.onclick=()=>_maskDropInp.click();
      _maskDropInp.onchange=()=>{ if(_maskDropInp.files[0])_maskLoadImageIntoEditor(_maskDropInp.files[0]); };
      _maskDropZone.addEventListener("dragover",e=>{e.preventDefault();e.stopPropagation();});
      _maskDropZone.addEventListener("drop",e=>{
        e.preventDefault();e.stopPropagation();
        const f=e.dataTransfer.files[0];
        if(f&&f.type.startsWith("image/"))_maskLoadImageIntoEditor(f);
      });

      // Inline error banner inside overlay (so it's visible when overlay is open)
      const _maskErrBar=mk("div",{
        display:"none",background:"rgba(220,60,60,.18)",borderTop:`1px solid rgba(220,60,60,.4)`,
        padding:"7px 14px",fontSize:"11px",color:"#ff8a8a",flexShrink:"0",
      });
      const _maskShowErr=(msg)=>{
        tx(_maskErrBar,msg);_maskErrBar.style.display="block";
        clearTimeout(_maskErrBar._t);
        _maskErrBar._t=setTimeout(()=>{_maskErrBar.style.display="none";},4000);
      };

      // ── Inpaint bottom bar — size badge + scale by longer side ───────────
      let _inpUseOrigSize=true;
      let _inpResizeLonger=0;

      const _inpDimsLbl=mk("div",{
        fontSize:"9px",fontWeight:"700",whiteSpace:"nowrap",
        padding:"5px 10px",borderRadius:"6px",cursor:"pointer",
        border:`1px solid rgba(240,255,65,.5)`,background:"rgba(240,255,65,.1)",color:LIME,
        transition:"color .15s,background .15s,border-color .15s",
      });

      const _inpResLongerInp=mk("input",{
        width:"62px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"5px",
        color:C.text,fontSize:"9px",fontWeight:"600",textAlign:"center",
        padding:"3px 4px",outline:"none",transition:"border-color .15s",
      },{type:"number",min:"0",max:"8192",step:"8",placeholder:"px",value:"1024"});
      _inpResLongerInp.onfocus=()=>_inpResLongerInp.style.borderColor=LIME;
      _inpResLongerInp.onblur=()=>_inpResLongerInp.style.borderColor=C.border;

      const _inpResResultLbl=mk("span",{fontSize:"9px",color:LIME,fontWeight:"700",whiteSpace:"nowrap"});

      const _inpScaleRow=mk("div",{
        display:"flex",alignItems:"center",gap:"6px",
        border:`1px solid ${C.border}`,borderRadius:"6px",padding:"5px 10px",
        background:C.bg1,transition:"opacity .15s",opacity:"0.35",pointerEvents:"none",
      });
      const _inpScaleLbl=mk("span",{fontSize:"9px",fontWeight:"600",color:C.muted,whiteSpace:"nowrap"});
      tx(_inpScaleLbl,"Scale by longer side");
      _inpScaleRow.append(_inpScaleLbl,_inpResLongerInp,_inpResResultLbl);

      const _inpCalcDims=()=>{
        const w=_maskCanvasW, h=_maskCanvasH;
        if(_inpUseOrigSize||!w||!h) return {w,h,resized:false};
        const longer=parseInt(_inpResLongerInp.value)||0;
        if(!longer) return {w,h,resized:false};
        const ar=w/h;
        let fw,fh;
        if(w>=h){ fw=longer; fh=Math.round(longer/ar); }
        else { fh=longer; fw=Math.round(longer*ar); }
        fw=Math.max(16,Math.round(fw/16)*16); fh=Math.max(16,Math.round(fh/16)*16);
        return {w:fw,h:fh,resized:true};
      };
      const _inpResRefresh=()=>{
        const {w,h,resized}=_inpCalcDims();
        if(resized){ tx(_inpResResultLbl,`→ ${w}×${h}`); }
        else { tx(_inpResResultLbl,""); }
        // Sync _paintDimsW/H so getEffectiveW/H and metadata use the correct value
        _paintDimsW=w||_maskCanvasW; _paintDimsH=h||_maskCanvasH;
        _paintRefreshDimsLbl();
      };
      _inpResLongerInp.oninput=_inpResRefresh;
      _inpResLongerInp.onblur=()=>{ _inpResLongerInp.style.borderColor=C.border; _inpResRefresh(); };

      const _inpApplyBadgeState=()=>{
        if(_inpUseOrigSize){
          tx(_inpDimsLbl,`${_maskCanvasW}×${_maskCanvasH}`);
          _inpDimsLbl.style.color=LIME;
          _inpDimsLbl.style.background="rgba(240,255,65,.1)";
          _inpDimsLbl.style.borderColor="rgba(240,255,65,.5)";
          _inpDimsLbl.title="Click to set custom scale";
          _inpScaleRow.style.opacity="0.35";
          _inpScaleRow.style.pointerEvents="none";
          _inpResLongerInp.disabled=true;
        } else {
          tx(_inpDimsLbl,`${_maskCanvasW}×${_maskCanvasH}`);
          _inpDimsLbl.style.color=C.text;
          _inpDimsLbl.style.background=C.bg3;
          _inpDimsLbl.style.borderColor=C.borderH;
          _inpDimsLbl.title="Click to use original size";
          _inpScaleRow.style.opacity="1";
          _inpScaleRow.style.pointerEvents="auto";
          _inpResLongerInp.disabled=false;
        }
        _inpResRefresh();
      };

      _inpDimsLbl.onclick=()=>{
        if(!_maskCanvasW||!_maskCanvasH) return;
        _inpUseOrigSize=!_inpUseOrigSize;
        if(_inpUseOrigSize){ _inpResizeLonger=0; tx(_inpResResultLbl,""); }
        _inpApplyBadgeState();
      };

      const _inpBar=mk("div",{
        display:"none",alignItems:"center",justifyContent:"center",gap:"10px",
        padding:"6px 16px 10px",borderTop:`1px solid rgba(255,255,255,.05)`,
        background:C.bg1,flexShrink:"0",
      });
      _inpBar.append(_inpDimsLbl,_inpScaleRow);

      _maskOv.append(_maskTopBar,_opHintBar,_maskViewport,_opBar,_inpBar,_maskErrBar);

      // ── Open / Close ──────────────────────────────────────────────────────
      // Saved mask pixels — persisted across overlay open/close for the same image
      let _maskSavedData=null;   // ImageData | null
      let _maskSavedW=0,_maskSavedH=0;

      const _maskInitCanvas=(w,h)=>{
        _maskCanvasW=w;_maskCanvasH=h;
        _maskDisplayCanvas.width=w;_maskDisplayCanvas.height=h;
        _maskCanvas.width=w;_maskCanvas.height=h;
        _maskCtx().clearRect(0,0,w,h);
        // Restore saved mask if dimensions match
        if(_maskSavedData&&_maskSavedW===w&&_maskSavedH===h){
          _maskCtx().putImageData(_maskSavedData,0,0);
        }
      };

      const _openMaskOv=(imgName,mode)=>{
        _maskHistory=[];
        _opTop=0;_opRight=0;_opBottom=0;_opLeft=0;
        _opTopField._inp.value="0";_opRightField._inp.value="0";
        _opBottomField._inp.value="0";_opLeftField._inp.value="0";
        // In outpaint mode always start with a clean mask — old mask from previous round
        // is irrelevant and confusing (shows as red overlay). Mask is rebuilt at Apply Changes.
        if(mode==="outpaint"){ _maskSavedData=null;_maskSavedW=0;_maskSavedH=0; }
        _opRow2.style.display="none";
        _maskRectStart=null;_maskRectEnd=null;_maskRectPreview.style.display="none";
        _maskOv.style.display="flex";
        _maskOv.focus();
        requestAnimationFrame(()=>_maskOv.style.opacity="1");
        _setMaskMode(mode||"inpaint");
        _maskSetTool("brush");_maskSyncSize(_maskSize);

        if(imgName){
          _maskDropZone.style.display="none";
          const url=api.apiURL(`/view?filename=${encodeURIComponent(imgName)}&type=input&subfolder=`);
          const img=new Image();img.crossOrigin="anonymous";
          img.onload=()=>{
            _maskSourceImgEl=img;
            _maskInitCanvas(img.naturalWidth,img.naturalHeight);
            _maskComposite();
            if(mode==="outpaint"){ _opRow2.style.display="flex"; _opUpdateDimsLbl(); }
            else { _inpBar.style.display="flex"; _inpApplyBadgeState(); }
            requestAnimationFrame(()=>{ _maskFitView(); if(mode==="outpaint") _opPositionAllHandles(); });
          };
          img.src=url;
        } else {
          _maskSourceImgEl=null;
          _maskInitCanvas(512,512);_maskComposite();
          _maskDropZone.style.display="flex";
          requestAnimationFrame(_maskFitView);
        }
      };

      const _closeMaskOv=()=>{
        _maskOv.style.opacity="0";
        setTimeout(()=>_maskOv.style.display="none",160);
        _maskSourceImgEl=null;
      };

      // ── Mouse events ──────────────────────────────────────────────────────
      let _maskPanning=false;
      let _maskPanStartX=0,_maskPanStartY=0,_maskPanStartPX=0,_maskPanStartPY=0;
      let _maskSpaceDown=false;
      document.addEventListener("keydown",e=>{
        if(_maskOv.style.display==="none") return;
        if(e.code==="Space"&&e.target.tagName!=="INPUT"){ e.preventDefault(); _maskSpaceDown=true; _maskViewport.style.cursor="grab"; }
      });
      document.addEventListener("keyup",e=>{
        if(_maskOv.style.display==="none") return;
        if(e.code==="Space"){ _maskSpaceDown=false; if(!_maskPanning) _maskViewport.style.cursor=_maskMode==="inpaint"?"none":"default"; }
      });

      _maskViewport.addEventListener("wheel",(e)=>{
        e.preventDefault();
        const {scaleX,scaleY,r}=_maskVpScale();
        // Outpaint: zoom around center; Inpaint: zoom around cursor (in CSS px)
        const mx=_maskMode==="outpaint"?_maskViewport.offsetWidth/2:(e.clientX-r.left)/scaleX;
        const my=_maskMode==="outpaint"?_maskViewport.offsetHeight/2:(e.clientY-r.top)/scaleY;
        const factor=e.deltaY<0?1.12:1/1.12;
        const nz=Math.max(0.08,Math.min(12,_maskZoom*factor));
        _maskPanX=mx-(mx-_maskPanX)*(nz/_maskZoom);
        _maskPanY=my-(my-_maskPanY)*(nz/_maskZoom);
        _maskZoom=nz;
        _maskApplyTransform();
        _maskSyncSize(_maskSize);
      },{passive:false});

      _maskViewport.addEventListener("mousedown",(e)=>{
        if(e.button===1||(e.button===0&&e.altKey)||(e.button===0&&_maskSpaceDown)){
          e.preventDefault();
          _maskPanning=true;
          _maskPanStartX=e.clientX;_maskPanStartY=e.clientY;
          _maskPanStartPX=_maskPanX;_maskPanStartPY=_maskPanY;
          _maskViewport.style.cursor="grab";
          return;
        }
        if(e.button!==0||_maskMode!=="inpaint") return;
        const pos=_maskCanvasCoords(e);
        if(pos.x<0||pos.y<0||pos.x>_maskCanvasW||pos.y>_maskCanvasH) return;
        if(_maskTool==="rect"){
          _maskDrawing=true;
          _maskRectStart={x:pos.x,y:pos.y};_maskRectEnd={x:pos.x,y:pos.y};
          _maskUpdateRectPreview();
          return;
        }
        _maskSaveHistory();
        _maskDrawing=true;_maskLastX=pos.x;_maskLastY=pos.y;
        _maskDraw(pos.x,pos.y);
      });

      document.addEventListener("mousemove",(e)=>{
        if(_maskOv.style.display==="none") return;
        if(_maskPanning){
          _maskPanX=_maskPanStartPX+(e.clientX-_maskPanStartX);
          _maskPanY=_maskPanStartPY+(e.clientY-_maskPanStartY);
          _maskApplyTransform();
          return;
        }
        if(_maskMode!=="inpaint") return;
        if(_maskTool==="rect"){
          _maskCursor.style.display="none";
          if(_maskDrawing&&_maskRectStart){
            const pos=_maskCanvasCoords(e);
            _maskRectEnd={x:Math.max(0,Math.min(_maskCanvasW,pos.x)),y:Math.max(0,Math.min(_maskCanvasH,pos.y))};
            _maskUpdateRectPreview();
          }
          return;
        }
        const {r}=_maskVpScale();
        if(e.clientX>=r.left&&e.clientY>=r.top&&e.clientX<=r.right&&e.clientY<=r.bottom){
          const pos=_maskCanvasCoords(e);
          _maskCursor.style.display="block";
          _maskCursor.style.left=pos.x+"px";
          _maskCursor.style.top=pos.y+"px";
          _maskCursor.style.width=_maskSize+"px";
          _maskCursor.style.height=_maskSize+"px";
          if(_maskDrawing){
            _maskDrawLine(_maskLastX,_maskLastY,pos.x,pos.y);
            _maskLastX=pos.x;_maskLastY=pos.y;
          }
        } else {
          _maskCursor.style.display="none";
        }
      });

      document.addEventListener("mouseup",()=>{
        if(_maskPanning){_maskPanning=false;_maskViewport.style.cursor=_maskSpaceDown?"grab":(_maskMode==="inpaint"?(_maskTool==="rect"?"crosshair":"none"):"default");}
        if(_maskDrawing&&_maskTool==="rect") _maskCommitRect();
        _maskDrawing=false;
      });

      _maskViewport.addEventListener("mouseleave",()=>_maskCursor.style.display="none");

      // ── Keyboard shortcuts ────────────────────────────────────────────────
      _maskOv.addEventListener("keydown",(e)=>{
        e.stopPropagation();
        if(e.target.tagName==="INPUT") return;
        if(e.key==="b"||e.key==="B"){_setMaskMode("inpaint");_maskSetTool("brush");}
        if(e.key==="e"||e.key==="E"){_setMaskMode("inpaint");_maskSetTool("eraser");}
        if(e.key==="r"||e.key==="R"){_setMaskMode("inpaint");_maskSetTool("rect");}
        if((e.ctrlKey||e.metaKey)&&e.key==="z") _maskUndo();
        if(e.key==="Escape") _maskCancelBtn.click();
        if(e.key==="[") _maskSyncSize(_maskSize-5);
        if(e.key==="]") _maskSyncSize(_maskSize+5);
        if(e.key==="{") _maskSyncSize(_maskSize-25);
        if(e.key==="}") _maskSyncSize(_maskSize+25);
      },{capture:true});

      // ── Confirm ───────────────────────────────────────────────────────────
      // _maskName declared near _paintSlot above; reset to null when new image loaded

      const _maskUploadAndRun=async()=>{
        if(!_maskSourceImgEl){ _maskShowErr("Load an image first.");return; }
        _maskConfirmBtn.disabled=true;tx(_maskConfirmBtn,"Uploading…");

        if(_maskMode==="outpaint"){
          // Force-read all fields even if none were blurred
          _opTop   =Math.max(0,Math.round((+_opTopField._inp.value   ||0)/8)*8);
          _opRight =Math.max(0,Math.round((+_opRightField._inp.value ||0)/8)*8);
          _opBottom=Math.max(0,Math.round((+_opBottomField._inp.value||0)/8)*8);
          _opLeft  =Math.max(0,Math.round((+_opLeftField._inp.value  ||0)/8)*8);
          if(_opTop===0&&_opRight===0&&_opBottom===0&&_opLeft===0){
            _maskConfirmBtn.disabled=false;tx(_maskConfirmBtn,"Apply Changes");
            _maskShowErr("Set at least one side to expand (Top/Right/Bottom/Left > 0) then click Apply Changes.");
            return;
          }
          const newW=_maskCanvasW+_opLeft+_opRight;
          const newH=_maskCanvasH+_opTop+_opBottom;

          // Build padded source (black fill + original offset)
          const padC=document.createElement("canvas");
          padC.width=newW;padC.height=newH;
          const padX=padC.getContext("2d");
          padX.fillStyle="#000000";padX.fillRect(0,0,newW,newH);
          padX.drawImage(_maskSourceImgEl,_opLeft,_opTop,_maskCanvasW,_maskCanvasH);

          // Build outpaint mask: white=new area (AI fills), black=original content
          // Feather bites INTO the original (~f px) so the model sees original context at the seam
          const mskC=document.createElement("canvas");
          mskC.width=newW;mskC.height=newH;
          const mskX=mskC.getContext("2d");
          // Start all white (new areas = AI fills)
          mskX.fillStyle="#ffffff";mskX.fillRect(0,0,newW,newH);
          // Paint black hard rectangle over original image area
          mskX.fillStyle="#000000";
          mskX.fillRect(_opLeft,_opTop,_maskCanvasW,_maskCanvasH);
          // Feather: gradient bites INTO the original f px — white(new)→black(orig) transition
          // This lets the model see original content at the boundary and blend naturally
          const f=_opFeatherPx(Math.min(_maskCanvasW,_maskCanvasH),48);
          const L=_opLeft,T=_opTop,R=_opLeft+_maskCanvasW,B=_opTop+_maskCanvasH;
          const fade=(x0,y0,x1,y1,gStartX,gStartY,gEndX,gEndY)=>{
            const g=mskX.createLinearGradient(gStartX,gStartY,gEndX,gEndY);
            g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(1,"rgba(255,255,255,0)");
            mskX.fillStyle=g;mskX.fillRect(x0,y0,x1-x0,y1-y0);
          };
          // Each fade covers the strip where new area meets original, going f px INTO original
          // gradient: white at the outer edge → transparent f px inside original
          if(_opTop>0)    fade(L,T-(_opTop),R,T+f,    L,T,    L,T+f);
          if(_opBottom>0) fade(L,B-f,R,B+(_opBottom), L,B,    L,B-f);
          if(_opLeft>0)   fade(L-(_opLeft),T,L+f,B,   L,T,    L+f,T);
          if(_opRight>0)  fade(R-f,T,R+(_opRight),B,  R,T,    R-f,T);

          const uploadBlob=async(canvas,fname)=>{
            return new Promise((res,rej)=>canvas.toBlob(async blob=>{
              if(!blob){rej(new Error("toBlob failed"));return;}
              const fd=new FormData();
              fd.append("image",new File([blob],fname,{type:"image/png"}));
              fd.append("overwrite","false");
              try{
                const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
                const d=await r.json();res(d.name||fname);
              }catch(e){rej(e);}
            },"image/png"));
          };

          // If source image already has black areas from a previous outpaint round,
          // add them to the mask so InpaintCropImproved sees and fills them too.
          try{
            const srcC=document.createElement("canvas");
            srcC.width=_maskCanvasW; srcC.height=_maskCanvasH;
            srcC.getContext("2d").drawImage(_maskSourceImgEl,0,0,_maskCanvasW,_maskCanvasH);
            const srcPx=srcC.getContext("2d").getImageData(0,0,_maskCanvasW,_maskCanvasH).data;
            const mskCtxX=mskC.getContext("2d");
            const mskPxData=mskCtxX.getImageData(0,0,newW,newH);
            const md=mskPxData.data;
            const thr=18;
            for(let y=0;y<_maskCanvasH;y++){
              for(let x=0;x<_maskCanvasW;x++){
                const si=(y*_maskCanvasW+x)*4;
                if(srcPx[si]<thr&&srcPx[si+1]<thr&&srcPx[si+2]<thr){
                  // Map to padded canvas coords (original sits at _opLeft, _opTop)
                  const px=x+_opLeft, py=y+_opTop;
                  const mi=(py*newW+px)*4;
                  md[mi]=255;md[mi+1]=255;md[mi+2]=255;md[mi+3]=255;
                }
              }
            }
            mskCtxX.putImageData(mskPxData,0,0);
          }catch(ex){ console.warn("[FluxKlein] outpaint prev-black merge:",ex); }

          // Apply resize if target dimensions are set — letterbox to preserve AR, black fill new areas
          _opLetterbox=null;
          let finalPadC=padC, finalMskC=mskC, finalW=newW, finalH=newH;
          {
            const rwinput=parseInt(_opResW.value)||0;
            const rhinput=parseInt(_opResH.value)||0;
            if(rwinput>0||rhinput>0){
              // Derive missing dimension from aspect ratio when only one is given
              let tw=rwinput, th=rhinput;
              const ar=newW/newH;
              if(tw>0&&th<=0) th=Math.round(tw/ar);
              else if(th>0&&tw<=0) tw=Math.round(th*ar);
              tw=Math.max(8,Math.round(tw/8)*8);
              th=Math.max(8,Math.round(th/8)*8);
              if(tw!==newW||th!==newH){
                finalW=tw; finalH=th;
                // Letterbox: fit padded image inside target, preserve AR, fill remainder with black
                const scale=Math.min(tw/newW,th/newH);
                const dw=Math.round(newW*scale), dh=Math.round(newH*scale);
                const dx=Math.round((tw-dw)/2), dy=Math.round((th-dh)/2);
                _opLetterbox={dx,dy,dw,dh,fw:tw,fh:th,srcW:newW,srcH:newH};

                const rPad=document.createElement("canvas"); rPad.width=tw; rPad.height=th;
                const rpX=rPad.getContext("2d");
                rpX.fillStyle="#000000"; rpX.fillRect(0,0,tw,th);
                rpX.drawImage(padC,dx,dy,dw,dh);

                // Mask: black (preserve) where image is, white (AI fills) for letterbox bars
                const rMsk=document.createElement("canvas"); rMsk.width=tw; rMsk.height=th;
                const rmX=rMsk.getContext("2d");
                rmX.fillStyle="#ffffff"; rmX.fillRect(0,0,tw,th);  // all white = AI fills
                // Scale the original mask into the letterbox area
                rmX.drawImage(mskC,dx,dy,dw,dh);

                finalPadC=rPad; finalMskC=rMsk;
              }
            }
          }

          try{
            const ts=Date.now();
            const [paddedName,maskName]=await Promise.all([
              uploadBlob(finalPadC,`op_src_${ts}.png`),
              uploadBlob(finalMskC,`op_msk_${ts}.png`),
            ]);
            _opMaskName=maskName;
            _maskName="__outpaint__";
            _opPaddedW=finalW; _opPaddedH=finalH;
            _paintSlot._restorePreview(paddedName);
            const sub=_inpaintBtn.querySelectorAll("div")[1];
            if(sub) tx(sub,`Outpaint ready ✓ (${finalW}×${finalH})`);
            // Save expand amounts before resetting (needed in img.onload for auto-mask)
            const _savedOpTop=_opTop,_savedOpRight=_opRight,_savedOpBottom=_opBottom,_savedOpLeft=_opLeft;
            _opTop=0;_opRight=0;_opBottom=0;_opLeft=0;
            _opTopField._inp.value="0";_opRightField._inp.value="0";
            _opBottomField._inp.value="0";_opLeftField._inp.value="0";
            const img=new Image();img.crossOrigin="anonymous";
            img.onload=()=>{
              _maskSourceImgEl=img;
              // Clear saved mask so _maskInitCanvas starts with a blank canvas (no old mask restore)
              _maskSavedData=null;_maskSavedW=0;_maskSavedH=0;
              _maskInitCanvas(img.naturalWidth,img.naturalHeight);

              // Paint auto-mask: new (expanded) areas = white (AI fills), original = black (preserve)
              const ctx=_maskCtx();
              ctx.globalCompositeOperation="source-over";
              ctx.globalAlpha=1;
              const W=img.naturalWidth, H=img.naturalHeight;
              // If letterbox resize was applied, map the original-image rect into letterboxed coords.
              // _opLetterbox.dx/dy/dw/dh describe where the *padded* image sits in the letterboxed canvas.
              // The original image occupied (_savedOpLeft, _savedOpTop) inside the padded canvas,
              // so we scale those offsets by the same letterbox scale factor.
              let L,T,R,B;
              if(_opLetterbox){
                const scaleX=_opLetterbox.dw/_opLetterbox.srcW;
                const scaleY=_opLetterbox.dh/_opLetterbox.srcH;
                L=_opLetterbox.dx+Math.round(_savedOpLeft*scaleX);
                T=_opLetterbox.dy+Math.round(_savedOpTop*scaleY);
                R=_opLetterbox.dx+Math.round((_opLetterbox.srcW-_savedOpRight)*scaleX);
                B=_opLetterbox.dy+Math.round((_opLetterbox.srcH-_savedOpBottom)*scaleY);
              } else {
                L=_savedOpLeft; T=_savedOpTop;
                R=W-_savedOpRight; B=H-_savedOpBottom;
              }
              const feather=_opFeatherPx(Math.min(R-L,B-T),128,4);

              // Step 1: fill everything white (all new areas will be masked)
              ctx.fillStyle="#ffffff";
              ctx.fillRect(0,0,W,H);

              // Step 2: paint hard black rect over original content area (no mask = preserve)
              ctx.fillStyle="#000000";
              ctx.fillRect(L,T,R-L,B-T);

              // Step 3: soft gradient painted INSIDE the original black rect, 40px band at each edge
              // Gradient = white-to-transparent over the black → creates soft blend from new into original
              // Top feather band: inside original area, from T to T+feather
              if(_savedOpTop>0){
                const g=ctx.createLinearGradient(0,T,0,Math.min(T+feather,B));
                g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(1,"rgba(255,255,255,0)");
                ctx.fillStyle=g;ctx.fillRect(L,T,R-L,Math.min(feather,B-T));
              }
              // Bottom feather band: inside original area, from B-feather to B
              if(_savedOpBottom>0){
                const g=ctx.createLinearGradient(0,B,0,Math.max(B-feather,T));
                g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(1,"rgba(255,255,255,0)");
                ctx.fillStyle=g;ctx.fillRect(L,Math.max(B-feather,T),R-L,Math.min(feather,B-T));
              }
              // Left feather band: inside original area, from L to L+feather
              if(_savedOpLeft>0){
                const g=ctx.createLinearGradient(L,0,Math.min(L+feather,R),0);
                g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(1,"rgba(255,255,255,0)");
                ctx.fillStyle=g;ctx.fillRect(L,T,Math.min(feather,R-L),B-T);
              }
              // Right feather band: inside original area, from R-feather to R
              if(_savedOpRight>0){
                const g=ctx.createLinearGradient(R,0,Math.max(R-feather,L),0);
                g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(1,"rgba(255,255,255,0)");
                ctx.fillStyle=g;ctx.fillRect(Math.max(R-feather,L),T,Math.min(feather,R-L),B-T);
              }

              // Save auto-mask for persistence
              try{
                _maskSavedData=ctx.getImageData(0,0,W,H);
                _maskSavedW=W;_maskSavedH=H;
              }catch(ex){}

              _maskComposite();

              // Export _maskCanvas and upload as inpaint mask — routes outpaint through inpaint workflow
              // which uses InpaintCropImproved+InpaintStitchImproved and produces correct results
              const exportC=document.createElement("canvas");
              exportC.width=W;exportC.height=H;
              const ectx=exportC.getContext("2d");
              ectx.fillStyle="#000000";ectx.fillRect(0,0,W,H);
              ectx.drawImage(_maskCanvas,0,0);
              exportC.toBlob(async(blob)=>{
                if(!blob){ _setPaintMode("inpaint");_closeMaskOv();return; }
                const fname=`op_automask_${Date.now()}.png`;
                const fd=new FormData();
                fd.append("image",new File([blob],fname,{type:"image/png"}));
                fd.append("overwrite","false");
                try{
                  const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
                  const d=await r.json();
                  _maskName=d.name||fname;
                }catch(e){ console.warn("[FluxKlein] outpaint automask upload:",e); }
                if(!_outpaintPromptSet){
                  const _op=_autofillPrompts.outpaint;
                  S.prompt=_op;S[_pillPromptKey("inpaint")]=_op;
                  if(_promptTARef) _promptTARef.value=_op;
                  if(typeof _promptOvTA!=="undefined"&&_promptOvTA) _promptOvTA.value=_op;
                  persist();
                  _outpaintPromptSet=true;
                }
                _setPaintMode("inpaint");
                _closeMaskOv();
              },"image/png");
            };
            img.src=api.apiURL(`/view?filename=${encodeURIComponent(paddedName)}&type=input&subfolder=`);
          }catch(err){
            console.warn("[FluxKlein] outpaint upload:",err);
            _maskShowErr("Upload failed: "+fmtErr(err));
          }finally{
            _maskConfirmBtn.disabled=false;tx(_maskConfirmBtn,_maskMode==="inpaint"?"Apply":"Apply Changes");
          }
          return;
        }

        // ── Inpaint: export white-on-black mask, stay in overlay ─────────
        const exportC=document.createElement("canvas");
        exportC.width=_maskCanvasW;exportC.height=_maskCanvasH;
        const ectx=exportC.getContext("2d");
        ectx.fillStyle="#000000";ectx.fillRect(0,0,_maskCanvasW,_maskCanvasH);
        ectx.drawImage(_maskCanvas,0,0);
        exportC.toBlob(async(blob)=>{
          if(!blob){_maskConfirmBtn.disabled=false;tx(_maskConfirmBtn,"Apply");return;}
          const fname=`mask_${Date.now()}.png`;
          const fd=new FormData();
          fd.append("image",new File([blob],fname,{type:"image/png"}));
          fd.append("overwrite","false");
          try{
            const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
            const d=await r.json();
            _maskName=d.name||fname;
            // Save mask pixels so they persist when overlay is reopened
            let _maskHasContent=false;
            try{
              const imgd=_maskCtx().getImageData(0,0,_maskCanvasW,_maskCanvasH);
              _maskSavedData=imgd;_maskSavedW=_maskCanvasW;_maskSavedH=_maskCanvasH;
              // Check if any non-zero pixel exists
              for(let i=0;i<imgd.data.length;i+=4){ if(imgd.data[i]>0||imgd.data[i+1]>0||imgd.data[i+2]>0){_maskHasContent=true;break;} }
            }catch(ex){}
            const sub=_inpaintBtn.querySelectorAll("div")[1];
            if(sub) tx(sub,_maskHasContent?"Mask ready ✓":"Paint mask over image");
            if(!_inpaintPromptSet){
              const _ip=_autofillPrompts.inpaint;
              S.prompt=_ip;S[_pillPromptKey("inpaint")]=_ip;
              if(_promptTARef) _promptTARef.value=_ip;
              if(typeof _promptOvTA!=="undefined"&&_promptOvTA) _promptOvTA.value=_ip;
              persist();
              _inpaintPromptSet=true;
            }
            _closeMaskOv();
            _setPaintMode("inpaint");
          }catch(err){
            console.warn("[FluxKlein] mask upload:",err);
            _maskShowErr("Mask upload failed: "+fmtErr(err));
          }finally{ _maskConfirmBtn.disabled=false; }
        },"image/png");
      };

      _maskConfirmBtn.onclick=_maskUploadAndRun;
      _maskCancelBtn.onclick=()=>{
        _closeMaskOv();
        if(!_maskName) _setPaintMode(null);
      };

      _inpaintBtn.onclick=()=>{
        _setPaintMode("inpaint");
        // If previous outpaint exists, re-open in outpaint mode so user can expand further
        const mode=_opMaskName?"outpaint":"inpaint";
        _openMaskOv(_paintSlot.hasFile()?_paintSlot.name:null,mode);
      };

      // ── RESOLUTION ───────────────────────────────────────────────────────
      const resSect=mk("div",{display:"flex",flexDirection:"column",gap:"4px"});
      const _sizeLabelRow=mk("div",{display:"flex",alignItems:"center",gap:"6px"});
      _sizeLabelRow.appendChild(cap("Size"));
      resSect.appendChild(_sizeLabelRow);

      const resDD=DD(RES_PRESETS.map(p=>p.label),S.resLabel,val=>{
        const p=RES_PRESETS.find(r=>r.label===val);
        if(p&&p.w>0){
          S.resLabel=val;S.resW=p.w;S.resH=p.h;S.isCustomRes=false;
          customResRow.style.display="none";
        }else{
          S.resLabel=val;S.isCustomRes=true;
          customResRow.style.display="flex";
        }
        // Deactivate "use image size" badge when user explicitly picks a size
        if(_useSizeSource){ _useSizeSource=null;S.useSizeFromImage1=false;dims1Lbl._refresh();dims2Lbl._refresh();sizeFromImg1Note.style.display="none"; }
        persist();_arRefreshDimsPreview();
      });
      resSect.appendChild(resDD.el);

      const customResRow=mk("div",{display:S.isCustomRes?"flex":"none",gap:"5px",alignItems:"center",marginTop:"5px"});

      // Swap W↔H button
      const _arSwapBtn=mk("button",{
        width:"18px",height:"22px",borderRadius:"4px",flexShrink:"0",
        background:"transparent",border:`1px solid ${C.border}`,
        color:C.muted,cursor:"pointer",outline:"none",padding:"0",
        display:"flex",alignItems:"center",justifyContent:"center",
        transition:"border-color .15s,color .15s",
      });
      _arSwapBtn.innerHTML=`<svg viewBox="0 0 10 14" width="9" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1L1 3.5L3 6"/><line x1="1" y1="3.5" x2="9" y2="3.5"/><path d="M7 8L9 10.5L7 13"/><line x1="9" y1="10.5" x2="1" y2="10.5"/></svg>`;
      _arSwapBtn.title="Swap W and H";
      _arSwapBtn.onmouseenter=()=>{_arSwapBtn.style.borderColor=LIME;_arSwapBtn.style.color=LIME;};
      _arSwapBtn.onmouseleave=()=>{_arSwapBtn.style.borderColor=C.border;_arSwapBtn.style.color=C.muted;};
      _arSwapBtn.onclick=()=>{
        const oldW=wInp.numVal||S.customW;
        const oldH=hInp.numVal||S.customH;
        S.customW=Math.max(1,Math.round(oldH));
        S.customH=Math.max(1,Math.round(oldW));
        wInp.setVal(S.customW);hInp.setVal(S.customH);
        if(_arLocked&&_arRatio) _arRatio=1/_arRatio;
        persist();_arRefreshDimsPreview();
      };

      // Aspect ratio lock
      let _arLocked=false;
      let _arRatio=null;
      const _arLockBtn=mk("button",{
        width:"22px",height:"22px",borderRadius:"5px",flexShrink:"0",
        background:"transparent",border:`1px solid ${C.border}`,
        color:C.muted,cursor:"pointer",outline:"none",padding:"0",
        display:"flex",alignItems:"center",justifyContent:"center",
        transition:"border-color .15s,color .15s,background .15s",
      });
      // Flat SVG lock icons
      const _lockIconOpen=`<svg viewBox="0 0 12 14" width="11" height="12" fill="currentColor"><rect x="1" y="6" width="10" height="8" rx="1.5"/><path d="M3.5 6V4a2.5 2.5 0 015 0" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
      const _lockIconClosed=`<svg viewBox="0 0 12 14" width="11" height="12" fill="currentColor"><rect x="1" y="6" width="10" height="8" rx="1.5"/><path d="M3.5 6V4a2.5 2.5 0 015 0v2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
      _arLockBtn.innerHTML=_lockIconOpen;
      const _arSetLocked=(locked)=>{
        _arLocked=locked;
        _arLockBtn.style.borderColor=locked?LIME:C.border;
        _arLockBtn.style.color=locked?LIME:C.muted;
        _arLockBtn.style.background=locked?"rgba(240,255,65,.08)":"transparent";
        _arLockBtn.innerHTML=locked?_lockIconClosed:_lockIconOpen;
      };
      // Get best available aspect ratio: prefer loaded image dims, fallback to current W/H
      const _arGetRatio=()=>{
        // Try image from active slot
        const src=activePill==="edit"?(_useSizeSource||"img1"):null;
        if(src){
          const lbl=src==="img2"?dims2Lbl:dims1Lbl;
          if(lbl._w&&lbl._h) return lbl._w/lbl._h;
        }
        // Fallback: current W/H
        const cw=wInp.numVal||S.customW||1024;
        const ch=hInp.numVal||S.customH||1024;
        return cw/ch;
      };
      _arLockBtn.title="Lock aspect ratio";

      const snap8=(v)=>Math.max(16,Math.round(v/16)*16);

      // W/H inputs store raw values — no snapping in the field itself.
      // snap8 is applied only in getEffectiveW/H (workflow) and in the preview label.
      const _deactivateImgSize=()=>{
        if(_useSizeSource){ _useSizeSource=null;S.useSizeFromImage1=false;dims1Lbl._refresh();dims2Lbl._refresh();sizeFromImg1Note.style.display="none"; }
      };
      const wInp=NI("w",S.customW,1,8192,1,v=>{
        S.customW=Math.max(1,Math.round(v));
        if(_arLocked&&_arRatio){
          S.customH=Math.max(1,Math.round(S.customW/_arRatio));
          hInp.setVal(S.customH);
        }
        _deactivateImgSize();
        persist(); _arRefreshDimsPreview();
      },"80px");
      const xLbl=mk("span",{fontSize:"10px",color:C.muted,flexShrink:"0"});tx(xLbl,"×");
      const hInp=NI("h",S.customH,1,8192,1,v=>{
        S.customH=Math.max(1,Math.round(v));
        if(_arLocked&&_arRatio){
          S.customW=Math.max(1,Math.round(S.customH*_arRatio));
          wInp.setVal(S.customW);
        }
        _deactivateImgSize();
        persist(); _arRefreshDimsPreview();
      },"80px");

      wInp._inp.addEventListener("keydown",e=>{ if(e.key==="Tab"&&!e.shiftKey){ e.preventDefault(); hInp._inp.focus(); hInp._inp.select(); } });
      hInp._inp.addEventListener("keydown",e=>{ if(e.key==="Tab"&&e.shiftKey){ e.preventDefault(); wInp._inp.focus(); wInp._inp.select(); } });

      _arLockBtn.onclick=()=>{
        const nowLocked=!_arLocked;
        if(nowLocked) _arRatio=_arGetRatio();
        _arSetLocked(nowLocked);
        _arRefreshDimsPreview();
      };

      // Live dims preview — shows actual W×H after snap, lime colored
      const _arDimsPreview=mk("div",{
        fontSize:"9px",color:LIME,fontWeight:"600",whiteSpace:"nowrap",
        letterSpacing:".02em",opacity:"0.85",alignSelf:"center",
      });
      const _arRefreshDimsPreview=()=>{
        const rawW=S.isCustomRes?(wInp.numVal||S.customW||1024):S.resW;
        const rawH=S.isCustomRes?(hInp.numVal||S.customH||1024):S.resH;
        const sw=snap8(rawW), sh=snap8(rawH);
        // Show snapped dims (what will actually generate); dim if same as raw
        const changed=(sw!==rawW||sh!==rawH);
        tx(_arDimsPreview,`→ ${sw}×${sh}`);
        _arDimsPreview.style.opacity=changed?"1":"0.5";
        _arDimsPreview.title=changed?`Input: ${rawW}×${rawH} → snapped to ${sw}×${sh}`:"";
      };
      _arRefreshDimsPreview();

      customResRow.append(wInp,_arSwapBtn,hInp,_arLockBtn,_arDimsPreview);
      resSect.appendChild(customResRow);

      function updateSizeControls(){
        const useImgSize=activePill==="edit"&&!!_useSizeSource;
        resDD.el.style.opacity=useImgSize?"0.35":"1";
        resDD.el.style.pointerEvents=useImgSize?"none":"auto";
        resDD.el.style.filter=useImgSize?"grayscale(1)":"none";
        customResRow.style.display=useImgSize?"none":(S.isCustomRes?"flex":"none");
        if(useImgSize){
          const lbl=_useSizeSource==="img1"?dims1Lbl:dims2Lbl;
          const w=lbl._w,h=lbl._h;
          tx(sizeFromImg1Note,`Using size from ${_useSizeSource==="img1"?"Image 1":"Image 2"}.`);
          sizeFromImg1Note.style.display="block";
        } else {
          sizeFromImg1Note.style.display="none";
        }
      }

      // ── Seed (hidden standalone — seed control lives in advPanel only) ──────
      const seedRow=mk("div",{display:"none"}); // always hidden, kept for DOM/compat refs
      const seedInp=NI("seed",S.seed||0,0,999999999999,1,v=>{ S.seed=Math.round(v)||0; persist(); },"90px");

      // ── Advanced control panel ────────────────────────────────────────────
      let SAMPLERS=["euler","euler_cfg_pp","euler_ancestral","euler_ancestral_cfg_pp","heun","heunpp2","exp_heun_2_x0","exp_heun_2_x0_sde","dpm_2","dpm_2_ancestral","lms","dpm_fast","dpm_adaptive","dpmpp_2s_ancestral","dpmpp_2s_ancestral_cfg_pp","dpmpp_sde","dpmpp_sde_gpu","dpmpp_2m","dpmpp_2m_cfg_pp","dpmpp_2m_sde","dpmpp_2m_sde_gpu","dpmpp_2m_sde_heun","dpmpp_2m_sde_heun_gpu","dpmpp_3m_sde","dpmpp_3m_sde_gpu","ddpm","lcm","ipndm","ipndm_v","deis","res_multistep","res_multistep_cfg_pp","res_multistep_ancestral","res_multistep_ancestral_cfg_pp","gradient_estimation","gradient_estimation_cfg_pp","er_sde","seeds_2","seeds_3","sa_solver","sa_solver_pece","ddim","uni_pc","uni_pc_bh2"];
      let SCHEDULERS=["simple","sgm_uniform","karras","exponential","ddim_uniform","beta","normal","linear_quadratic","kl_optimal"];
      const ADV_BORDER="rgba(100,80,180,.5)";
      const ADV_BG="rgba(26,20,60,.55)";
      const ADV_LABEL="rgba(160,140,220,.7)";

      const advPanel=mk("div",{
        display:"none",flexDirection:"column",gap:"4px",
        border:`1px solid ${ADV_BORDER}`,borderRadius:"6px",
        padding:"5px",background:ADV_BG,
      });

      const _advNIStyle=(ni)=>{ ni._inp.style.fontSize="9px"; ni._inp.style.padding="1px 2px"; ni._inp.style.height="22px"; return ni; };
      const stepsInp=_advNIStyle(NI("steps",S.steps,1,150,1,v=>{S.steps=Math.round(v)||4;persist();},"100%"));
      const cfgInp=_advNIStyle(NI("cfg",S.cfg,0,30,0.1,v=>{S.cfg=parseFloat(v.toFixed(2));persist();},"100%"));
      _advControlsReady=true;

      const _advDDStyle=(dd)=>{
        const trig=dd.el.querySelector("div");
        if(trig){ trig.style.height="22px"; trig.style.fontSize="9px"; trig.style.padding="0 6px"; }
        return dd;
      };
      const samplerDD=_advDDStyle(DD(SAMPLERS,S.sampler,v=>{S.sampler=v;persist();}));
      const schedulerDD=_advDDStyle(DD(SCHEDULERS,S.scheduler,v=>{S.scheduler=v;persist();}));

      // Fetch available samplers/schedulers from ComfyUI (includes custom node samplers)
      api.fetchApi("/object_info/KSampler").then(r=>r.json()).then(d=>{
        const info=d?.KSampler?.input?.required;
        const slist=info?.sampler_name?.[0];
        const schlist=info?.scheduler?.[0];
        if(Array.isArray(slist)&&slist.length){
          SAMPLERS=slist;
          samplerDD.updateItems(slist);
          if(slist.includes(S.sampler)) samplerDD.set(S.sampler);
          else{ S.sampler=slist[0]; samplerDD.set(slist[0]); persist(); }
        }
        if(Array.isArray(schlist)&&schlist.length){
          SCHEDULERS=schlist;
          schedulerDD.updateItems(schlist);
          if(schlist.includes(S.scheduler)) schedulerDD.set(S.scheduler);
          else{ S.scheduler=schlist[0]; schedulerDD.set(schlist[0]); persist(); }
        }
      }).catch(()=>{});


      // Seed controls
      const _advSeedInp=_advNIStyle(NI("seed",S.seed||0,0,999999999999,1,v=>{
        S.seed=Math.round(v)||0; seedInp.setVal(S.seed); persist();
      },"60px"));
      _advSeedInp._inp.disabled=S.randomizeSeed;
      _advSeedInp.style.opacity=S.randomizeSeed?"0.4":"1";

      const _advSeedIconLock=`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
      const _advSeedIconDice=`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="16" cy="8" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="8" cy="16" r="1.3" fill="currentColor"/><circle cx="16" cy="16" r="1.3" fill="currentColor"/></svg>`;

      const _advSeedLockBtn=mk("button",{
        background:"transparent",border:"none",padding:"0 1px",cursor:"pointer",outline:"none",
        display:"flex",alignItems:"center",gap:"3px",flexShrink:"0",color:ADV_LABEL,transition:"color .15s",
      });
      const _advSeedStateLbl=mk("span",{fontSize:"7px",fontWeight:"700",letterSpacing:".06em",textTransform:"uppercase",whiteSpace:"nowrap",transition:"color .15s"});
      const _advSeedRefresh=()=>{
        _advSeedLockBtn.innerHTML="";
        const ico=mk("span"); ico.innerHTML=S.randomizeSeed?_advSeedIconDice:_advSeedIconLock;
        tx(_advSeedStateLbl,S.randomizeSeed?"Random":"Locked");
        const col=S.randomizeSeed?ADV_LABEL:"#c0a0ff";
        _advSeedLockBtn.style.color=col;
        _advSeedStateLbl.style.color=col;
        _advSeedLockBtn.append(ico,_advSeedStateLbl);
        _advSeedInp._inp.disabled=S.randomizeSeed;
        _advSeedInp.style.opacity=S.randomizeSeed?"0.4":"1";
      };
      _advSeedRefresh();
      _advSeedLockBtn.onclick=()=>{ S.randomizeSeed=!S.randomizeSeed; persist(); _advSeedRefresh(); _advRefresh(); };
      _advSeedLockBtn.onmouseenter=()=>{ _advSeedLockBtn.style.color="#d0b0ff"; _advSeedStateLbl.style.color="#d0b0ff"; };
      _advSeedLockBtn.onmouseleave=()=>_advSeedRefresh();

      // Helper: inline label+control pair
      const _mkInline=(lbl,el)=>{
        const w=mk("div",{display:"flex",alignItems:"center",gap:"3px",flexShrink:"0"});
        const l=mk("span",{fontSize:"7px",fontWeight:"700",color:ADV_LABEL,letterSpacing:".06em",textTransform:"uppercase",whiteSpace:"nowrap"});
        tx(l,lbl); w.append(l,el); return w;
      };

      // Single flat row: Steps · CFG · 🎲seed · Sampler · Scheduler
      const advRow1=mk("div",{display:"flex",gap:"5px",alignItems:"center",flexWrap:"wrap"});
      stepsInp.style.width="34px"; stepsInp.style.minWidth="0";
      cfgInp.style.width="30px"; cfgInp.style.minWidth="0";
      samplerDD.el.style.width="80px";
      schedulerDD.el.style.width="70px";
      const _advSeedGroup=mk("div",{display:"flex",alignItems:"center",gap:"2px",flexShrink:"0"});
      _advSeedGroup.append(_mkInline("Seed",_advSeedInp),_advSeedLockBtn);
      advRow1.append(
        _mkInline("Steps",stepsInp),
        _mkInline("CFG",cfgInp),
        _advSeedGroup,
        _mkInline("Sampler",samplerDD.el),
        _mkInline("Scheduler",schedulerDD.el),
      );

      advPanel.append(advRow1);

      // Seed locked warning — shown when advanced UI is off but seed is fixed
      const _seedLockedWarn=mk("div",{
        display:"none",alignItems:"center",gap:"8px",
        background:"rgba(160,120,255,.10)",border:"1px solid rgba(160,120,255,.35)",
        borderRadius:"6px",padding:"6px 10px",
      });
      const _seedLockedIcon=mk("span",{fontSize:"12px",flexShrink:"0"});tx(_seedLockedIcon,"🔒");
      const _seedLockedText=mk("div",{fontSize:"8px",color:"rgba(200,180,255,.9)",lineHeight:"1.5",flex:"1"});
      tx(_seedLockedText,"Seed is locked — you left it fixed.");
      const _seedLockedBtn=mk("button",{
        background:"rgba(160,120,255,.25)",border:"1px solid rgba(160,120,255,.6)",
        borderRadius:"4px",padding:"3px 8px",fontSize:"8px",fontWeight:"700",
        color:"#d0b8ff",cursor:"pointer",outline:"none",flexShrink:"0",
        transition:"background .15s,border-color .15s",whiteSpace:"nowrap",
      });
      tx(_seedLockedBtn,"Set to random");
      _seedLockedBtn.onmouseenter=()=>{_seedLockedBtn.style.background="rgba(160,120,255,.4)";};
      _seedLockedBtn.onmouseleave=()=>{_seedLockedBtn.style.background="rgba(160,120,255,.25)";};
      _seedLockedBtn.onclick=()=>{
        S.randomizeSeed=true; persist();
        _advSeedRefresh();
        _advRefresh();
      };
      _seedLockedWarn.append(_seedLockedIcon,_seedLockedText,_seedLockedBtn);

      const _advRefresh=()=>{
        advPanel.style.display=S.advancedUI?"flex":"none";
        _seedLockedWarn.style.display=(!S.advancedUI&&!S.randomizeSeed)?"flex":"none";
      };
      _advRefresh();

      const genRow=mk("div",{display:"flex",gap:"0",alignItems:"stretch",marginTop:"auto",width:"100%",boxSizing:"border-box"});
      const genBtn=mk("button",{
        background:LIME,color:"#111",border:"2px solid transparent",borderRadius:"8px",
        padding:"0",height:"38px",fontSize:"13px",fontWeight:"700",
        cursor:"pointer",flex:"1",letterSpacing:".02em",
        transition:"background .3s,color .3s,border-color .3s,box-shadow .15s,transform .1s",
        outline:"none",position:"relative",overflow:"hidden",
      });
      tx(genBtn,"Generate");
      const _genSweep=mk("div",{
        position:"absolute",top:"0",left:"-80%",width:"50%",height:"100%",
        background:"linear-gradient(90deg,transparent 0%,rgba(255,255,255,.75) 50%,transparent 100%)",
        transform:"skewX(-20deg)",pointerEvents:"none",opacity:"0",transition:"none",
      });
      genBtn.appendChild(_genSweep);
      genBtn.onmouseenter=()=>{
        if(!S.generating){
          _genSweep.style.animation="none";void _genSweep.offsetWidth;
          _genSweep.style.animation="fk-light-sweep 1s ease forwards";
        }
      };

      const stopBtn=mk("button",{
        background:"transparent",border:`1px solid ${C.border}`,borderRadius:"8px",
        color:C.muted,fontSize:"12px",cursor:"pointer",
        maxWidth:"0",minWidth:"0",width:"0",opacity:"0",padding:"0",height:"38px",
        transition:"max-width .25s ease, opacity .25s ease, padding .25s ease",outline:"none",
        overflow:"hidden",flexShrink:"0",whiteSpace:"nowrap",
      });
      tx(stopBtn,"■ Stop");
      stopBtn.onmouseenter=()=>{stopBtn.style.borderColor=C.err;stopBtn.style.color=C.err;};
      stopBtn.onmouseleave=()=>{stopBtn.style.borderColor=C.border;stopBtn.style.color=C.muted;};
      let _activePromptId=null;
      stopBtn.onclick=async()=>{
        // 1. Interrupt the currently running execution immediately
        try{ await api.fetchApi("/interrupt",{method:"POST"}); }catch(e){}
        // 2. Delete our prompt from the queue if it's still pending
        if(_activePromptId){
          try{
            await api.fetchApi("/queue",{
              method:"POST",
              headers:{"Content-Type":"application/json"},
              body:JSON.stringify({delete:[_activePromptId]}),
            });
          }catch(e){}
          _activePromptId=null;
        }
        resetBtn();
      };
      genRow.append(genBtn,stopBtn);
      // seedRow is prepended to genRow's parent in leftPanel.append below

      // ── LEFT PANEL ASSEMBLY ──────────────────────────────────────────────
      // ── FACESWAP PANEL ────────────────────────────────────────────────────
      const faceswapPanel=mk("div",{display:"flex",flexDirection:"column",gap:"6px"});

      // Dims labels for faceswap slots (same pattern as EDIT)
      const _mkFsDimsLbl=()=>{
        const el=mk("div",{
          fontSize:"9px",fontWeight:"700",letterSpacing:".04em",
          textAlign:"center",cursor:"default",display:"none",
          borderRadius:"5px",padding:"2px 6px",boxSizing:"border-box",
          background:C.bg3,border:`1px solid ${C.borderH}`,color:C.text,
          transition:"color .2s,background .15s,border-color .15s",
        });
        let _fw=0,_fh=0;
        el._set=(w,h)=>{
          _fw=w||0;_fh=h||0;
          if(_fw&&_fh){ tx(el,`${_fw}×${_fh}`);el.style.display="block"; }
          else { tx(el,"");el.style.display="none"; }
        };
        el._getDims=()=>({w:_fw,h:_fh});
        return el;
      };
      const _fsTargetDims=_mkFsDimsLbl();
      const _fsSourceDims=_mkFsDimsLbl();

      // ── Resize by longer side ─────────────────────────────────────────────
      // _fsUseOrigSize=true (default): badge LIME, resize row locked
      // _fsUseOrigSize=false: badge plain, resize row unlocked
      let _fsUseOrigSize=S.fsResizeLonger<=0; // restore from state

      const _fsResizePreview=mk("span",{fontSize:"9px",fontWeight:"700",color:LIME,letterSpacing:".03em",whiteSpace:"nowrap"});
      const _fsResizeLongerInp=NI("px",S.fsResizeLonger||1024,64,8192,8,v=>{
        S.fsResizeLonger=Math.round(v)||1024;
        _fsResizeUpdatePreview();
        persist();
      },52);

      const _fsUseOrigNote=mk("div",{fontSize:"8px",color:LIME,display:"none",marginTop:"0"});
      tx(_fsUseOrigNote,"Using size from Target image.");

      // Single row, no border/background
      const _fsResizeRow=mk("div",{display:"none",alignItems:"center",gap:"6px",marginTop:"2px"});
      const _fsResizeRowLbl=mk("span",{fontSize:"8px",color:C.muted,whiteSpace:"nowrap",flexShrink:"0"});
      tx(_fsResizeRowLbl,"Scale by longer side");
      _fsResizeRow.append(_fsResizeRowLbl,_fsResizeLongerInp,_fsResizePreview);

      const _fsResizeUpdatePreview=()=>{
        const dims=_fsTargetDims._getDims();
        if(!_fsUseOrigSize&&dims.w&&dims.h&&S.fsResizeLonger>0){
          const scale=S.fsResizeLonger/Math.max(dims.w,dims.h);
          const nw=Math.round(dims.w*scale/16)*16;
          const nh=Math.round(dims.h*scale/16)*16;
          tx(_fsResizePreview,`→ ${nw}×${nh}`);
        } else {
          tx(_fsResizePreview,"");
        }
      };

      const _fsApplyState=()=>{
        const dims=_fsTargetDims._getDims();
        if(!dims.w||!dims.h) return;
        if(_fsUseOrigSize){
          _fsTargetDims.style.color=LIME;
          _fsTargetDims.style.background="rgba(240,255,65,.13)";
          _fsTargetDims.style.borderColor="rgba(240,255,65,.5)";
          _fsTargetDims.title="Click to use custom resize instead";
          _fsUseOrigNote.style.display="block";
          _fsResizeRow.style.opacity="0.35";
          _fsResizeRow.style.pointerEvents="none";
          _fsResizeLongerInp._inp.disabled=true;
        } else {
          _fsTargetDims.style.color=C.text;
          _fsTargetDims.style.background=C.bg3;
          _fsTargetDims.style.borderColor=C.borderH;
          _fsTargetDims.title="Click to use original target size";
          _fsUseOrigNote.style.display="none";
          _fsResizeRow.style.opacity="1";
          _fsResizeRow.style.pointerEvents="auto";
          _fsResizeLongerInp._inp.disabled=false;
          if(S.fsResizeLonger<=0){ S.fsResizeLonger=_fsResizeLongerInp.numVal||1024; persist(); }
        }
        _fsResizeUpdatePreview();
      };

      const _fsTargetDimsSetOrig=_fsTargetDims._set.bind(_fsTargetDims);
      _fsTargetDims._set=(w,h)=>{
        _fsTargetDimsSetOrig(w,h);
        if(w&&h){
          _fsTargetDims.style.cursor="pointer";
          _fsResizeRow.style.display="flex";
          _fsApplyState();
        } else {
          _fsTargetDims.style.cursor="default";
          _fsTargetDims.title="";
          _fsResizeRow.style.display="none";
          _fsUseOrigNote.style.display="none";
          _fsUseOrigSize=true;
          S.fsResizeLonger=0;
        }
      };
      _fsTargetDims.onclick=()=>{
        const dims=_fsTargetDims._getDims();
        if(!dims.w||!dims.h) return;
        _fsUseOrigSize=!_fsUseOrigSize;
        if(_fsUseOrigSize){ S.fsResizeLonger=0; persist(); }
        _fsApplyState();
      };

      // Slots — identical structure to EDIT imgSlotsRow
      const _fsSlotRow=mk("div",{display:"flex",gap:"10px",alignItems:"flex-start"});

      const _fsTargetCard=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
      const _fsTargetSlot=ImgSlot(false,(name)=>{
        S.fsTarget=name||null;
        if(!name){ _fsResizeRow.style.display="none"; _fsUseOrigNote.style.display="none"; _fsUseOrigSize=true; S.fsResizeLonger=0; }
        if(name){ _fsTargetSlot.el.style.borderColor=""; tx(_fsTargetLbl,"Target"); _fsTargetLbl.style.color=C.muted; }
        persist();
      },(w,h)=>_fsTargetDims._set(w,h));
      const _fsTargetLbl=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,
        textTransform:"uppercase",letterSpacing:".07em",textAlign:"center"});
      tx(_fsTargetLbl,"Target");
      _fsTargetCard.append(_fsTargetSlot.el,_fsTargetLbl,_fsTargetDims);

      const _fsSourceCard=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
      const _fsSourceSlot=ImgSlot(false,(name)=>{
        S.fsSource=name||null;
        if(name){ _fsSourceSlot.el.style.borderColor=""; tx(_fsSourceLbl,"Source"); _fsSourceLbl.style.color=C.muted; }
        persist();
      },(w,h)=>_fsSourceDims._set(w,h));
      const _fsSourceLbl=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,
        textTransform:"uppercase",letterSpacing:".07em",textAlign:"center"});
      tx(_fsSourceLbl,"Source");
      _fsSourceCard.append(_fsSourceSlot.el,_fsSourceLbl,_fsSourceDims);

      // Swap button between Faceswap slots — marginTop aligns it to center of the 88px slot
      const _fsSwapBtn=mk("button",{
        background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",
        width:"24px",height:"24px",padding:"0",cursor:"pointer",color:C.muted,outline:"none",
        flexShrink:"0",marginTop:"32px",
        display:"flex",alignItems:"center",justifyContent:"center",lineHeight:"0",
        transition:"border-color .15s,color .15s",
      });
      _fsSwapBtn.title="Swap Target ↔ Source";
      _fsSwapBtn.innerHTML=`<svg viewBox="0 0 10 14" width="9" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1L1 3.5L3 6"/><line x1="1" y1="3.5" x2="9" y2="3.5"/><path d="M7 8L9 10.5L7 13"/><line x1="9" y1="10.5" x2="1" y2="10.5"/></svg>`;
      _fsSwapBtn.onmouseenter=()=>{_fsSwapBtn.style.borderColor=LIME;_fsSwapBtn.style.color=LIME;};
      _fsSwapBtn.onmouseleave=()=>{_fsSwapBtn.style.borderColor=C.border;_fsSwapBtn.style.color=C.muted;};
      _fsSwapBtn.onclick=()=>{
        const nt=S.fsTarget,ns=S.fsSource;
        S.fsTarget=ns||null;S.fsSource=nt||null;
        _fsTargetSlot._restorePreview(S.fsTarget);
        _fsSourceSlot._restorePreview(S.fsSource);
        const dt=_fsTargetDims._getDims(),ds=_fsSourceDims._getDims();
        _fsTargetDims._set(ds.w||0,ds.h||0);
        _fsSourceDims._set(dt.w||0,dt.h||0);
        if(!S.fsTarget){ _fsResizeRow.style.display="none"; _fsUseOrigNote.style.display="none"; _fsUseOrigSize=true; S.fsResizeLonger=0; }
        if(S.fsTarget){ _fsTargetSlot.el.style.borderColor=""; tx(_fsTargetLbl,"Target"); _fsTargetLbl.style.color=C.muted; }
        if(S.fsSource){ _fsSourceSlot.el.style.borderColor=""; tx(_fsSourceLbl,"Source"); _fsSourceLbl.style.color=C.muted; }
        persist();
      };

      _fsSlotRow.append(_fsTargetCard,_fsSwapBtn,_fsSourceCard);
      faceswapPanel.append(_fsSlotRow,_fsUseOrigNote,_fsResizeRow);

      // Restore faceswap slots from state
      if(S.fsTarget) _fsTargetSlot._restorePreview(S.fsTarget);
      if(S.fsSource) _fsSourceSlot._restorePreview(S.fsSource);

      leftPanel.append(i2iPanel,editPanel,inpaintPanel,faceswapPanel,resSect,advPanel,seedRow,_seedLockedWarn,genRow);

      // ── RIGHT PANEL — Preview area fills available height ──
      const rightPanel=mk("div",{flex:"1",minWidth:"0",display:"flex",flexDirection:"column",overflow:"hidden"});
      const previewBox=mk("div",{
        width:"100%",flex:"1",minHeight:"0",background:"#000",
        borderRadius:"10px",border:`1px solid ${C.border}`,
        position:"relative",overflow:"hidden",
      });

      // Placeholder
      const placeholder=mk("div",{
        position:"absolute",inset:"0",display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",gap:"10px",
      });
      const placeholderSvg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      placeholderSvg.setAttribute("viewBox","0 0 24 24");placeholderSvg.setAttribute("width","40");placeholderSvg.setAttribute("height","40");
      placeholderSvg.setAttribute("fill","none");placeholderSvg.setAttribute("stroke","currentColor");
      placeholderSvg.setAttribute("stroke-width","1");placeholderSvg.setAttribute("stroke-linecap","round");
      placeholderSvg.style.color=C.border;
      placeholderSvg.innerHTML=`<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`;
      const placeholderLbl=mk("div",{fontSize:"11px",color:C.muted});
      tx(placeholderLbl,"Generated image will appear here");
      placeholder.append(placeholderSvg,placeholderLbl);

      // Final image
      const finalImg=mk("img",{
        position:"absolute",inset:"0",width:"100%",height:"100%",
        objectFit:"contain",display:"none",borderRadius:"10px",
      });

      // Progress bar — overlaid at the bottom of the preview box
      const progWrap=mk("div",{
        position:"absolute",bottom:"0",left:"0",right:"0",
        background:"linear-gradient(transparent,rgba(0,0,0,.88))",
        padding:"16px 14px 12px",display:"none",
        flexDirection:"column",gap:"4px",boxSizing:"border-box",pointerEvents:"none",
      });
      const progTop=mk("div",{display:"flex",justifyContent:"space-between",alignItems:"center"});
      const progStageL=mk("div",{fontSize:"11px",fontWeight:"600",color:C.text,textAlign:"center",flex:"1"});
      tx(progStageL,"Generating…");
      const progPct=mk("div",{fontSize:"10px",color:C.muted,flexShrink:"0"});tx(progPct,"0%");
      progTop.append(progStageL,progPct);
      const progBar=mk("div",{height:"3px",borderRadius:"2px",background:"rgba(255,255,255,.15)",overflow:"hidden",marginTop:"4px"});
      const progFill=mk("div",{height:"100%",background:LIME,width:"0%",transition:"width .3s ease",borderRadius:"2px"});
      progBar.appendChild(progFill);
      const progDetailL=mk("div",{fontSize:"9px",color:"rgba(255,255,255,.5)",textAlign:"center",marginTop:"2px"});
      progWrap.append(progTop,progBar,progDetailL);

      const setStage=(l,d,p)=>{
        tx(progStageL,l);tx(progDetailL,d);
        progFill.style.width=p+"%";tx(progPct,Math.round(p)+"%");
      };

      // ── Image Comparer — always active after EDIT generation ─────────────
      // Generated image fills the box; Image 1 revealed from the right by dragging divider left.
      // Divider starts at 100% (full generated shown), user drags left to reveal Image 1.
      const comparerWrap=mk("div",{
        position:"absolute",inset:"0",display:"none",cursor:"col-resize",
        userSelect:"none",borderRadius:"10px",overflow:"hidden",
      });

      // Image 1 (reference) — full-size background, visible on the right of divider
      const comparerBase=mk("img",{
        position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",
      });

      // Generated image — clipped to left portion
      const comparerGen=mk("div",{
        position:"absolute",top:"0",left:"0",bottom:"0",overflow:"hidden",
        width:"100%", // starts at 100% so only generated is visible
      });
      const comparerGenImg=mk("img",{
        position:"absolute",top:"0",left:"0",height:"100%",objectFit:"contain",
      });
      comparerGen.appendChild(comparerGenImg);

      // Divider line
      const comparerLine=mk("div",{
        position:"absolute",top:"0",bottom:"0",width:"2px",
        background:LIME,left:"calc(100% - 1px)",
        boxShadow:"0 0 8px rgba(240,255,65,.5)",
        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
        gap:"6px",zIndex:"4",
      });

      // Handle circle on divider
      const comparerHandle=mk("div",{
        width:"30px",height:"30px",borderRadius:"50%",background:LIME,
        border:"2px solid #111",flexShrink:"0",
        display:"flex",alignItems:"center",justifyContent:"center",
        boxShadow:"0 2px 10px rgba(0,0,0,.7)",pointerEvents:"none",
      });
      comparerHandle.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"><path d="M8 4l-4 8 4 8M16 4l4 8-4 8"/></svg>`;
      comparerLine.append(comparerHandle);
      comparerWrap.append(comparerBase,comparerGen,comparerLine);

      // Drag logic
      let _cmpDragging=false;
      const _cmpSetPct=(pct)=>{
        pct=Math.max(0,Math.min(100,pct));
        comparerGen.style.width=pct+"%";
        comparerLine.style.left=`calc(${pct}% - 1px)`;
        comparerGenImg.style.width=(comparerWrap.offsetWidth||620)+"px";
      };

      comparerWrap.addEventListener("mousedown",e=>{
        _cmpDragging=true;e.preventDefault();
      });
      document.addEventListener("mousemove",e=>{
        if(!_cmpDragging) return;
        const r=comparerWrap.getBoundingClientRect();
        _cmpSetPct((e.clientX-r.left)/r.width*100);
      });
      document.addEventListener("mouseup",()=>{ _cmpDragging=false; });
      comparerWrap.addEventListener("touchstart",()=>{_cmpDragging=true;},{passive:true});
      comparerWrap.addEventListener("touchmove",e=>{
        if(!_cmpDragging) return;
        const r=comparerWrap.getBoundingClientRect();
        _cmpSetPct((e.touches[0].clientX-r.left)/r.width*100);
      },{passive:true});
      comparerWrap.addEventListener("touchend",()=>{ _cmpDragging=false; });

      // "Use as…" dropdown — top-right of previewBox, visible after generation
      const previewUseWrap=mk("div",{
        position:"absolute",top:"10px",right:"10px",zIndex:"5",display:"none",
      });
      const previewUseBtn=mk("button",{
        background:"rgba(20,20,20,.88)",color:"rgba(255,255,255,.88)",
        border:"1px solid rgba(255,255,255,.22)",
        borderRadius:"6px",padding:"4px 11px",fontSize:"9px",fontWeight:"600",
        cursor:"pointer",outline:"none",whiteSpace:"nowrap",
        backdropFilter:"blur(4px)",letterSpacing:".04em",
        boxShadow:"0 2px 8px rgba(0,0,0,.5)",
        display:"flex",alignItems:"center",gap:"5px",
        transition:"background .15s,color .15s,border-color .15s",
      });
      previewUseBtn.innerHTML=`Use as… <svg viewBox="0 0 10 6" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="1,1 5,5 9,1"/></svg>`;
      previewUseBtn.onmouseenter=()=>{previewUseBtn.style.background="rgba(40,40,40,.97)";previewUseBtn.style.color="#fff";previewUseBtn.style.borderColor="rgba(255,255,255,.4)";};
      previewUseBtn.onmouseleave=()=>{previewUseBtn.style.background="rgba(20,20,20,.88)";previewUseBtn.style.color="rgba(255,255,255,.88)";previewUseBtn.style.borderColor="rgba(255,255,255,.22)";};

      const previewUseDrop=mk("div",{
        position:"absolute",top:"calc(100% + 4px)",right:"0",
        background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"8px",
        minWidth:"160px",overflow:"hidden",display:"none",zIndex:"200",
        boxShadow:"0 4px 20px rgba(0,0,0,.7)",flexDirection:"column",
      });
      const _mkPUSection=(label)=>{ const h=mk("div",{padding:"6px 12px 3px",fontSize:"8px",fontWeight:"700",letterSpacing:".08em",textTransform:"uppercase",color:C.muted,userSelect:"none"});tx(h,label);return h; };
      const _mkPUItem=(label,icon,fn)=>{ const row=mk("div",{padding:"7px 12px",fontSize:"10px",fontWeight:"500",color:C.text,cursor:"pointer",display:"flex",alignItems:"center",gap:"7px",transition:"background .1s,color .1s",userSelect:"none"});const ico=mk("span",{fontSize:"11px",width:"14px",textAlign:"center",flexShrink:"0",color:C.muted});tx(ico,icon);const lbl=mk("span");tx(lbl,label);row.append(ico,lbl);row.onmouseenter=()=>{row.style.background="rgba(240,255,65,.10)";row.style.color=LIME;ico.style.color=LIME;};row.onmouseleave=()=>{row.style.background="";row.style.color=C.text;ico.style.color=C.muted;};row.onclick=()=>{previewUseDrop.style.display="none";_puDropOpen=false;fn();};return row; };
      const _mkPUDivider=()=>mk("div",{height:"1px",background:C.border,margin:"2px 0"});

      const _getLastSrc=()=>_lastGenObj||(_galImages&&_galImages[0]);
      const _puUpload=async(fn)=>{ const v=_getLastSrc();if(!v)return;try{const n=await _uploadOutputToInput(v);fn(n);}catch(e){console.warn("[FluxKlein] use-as:",e);} };

      previewUseDrop.append(
        _mkPUSection("I2I"),
        _mkPUItem("I2I slot","⟳",()=>_puUpload(n=>{setPill("i2i");S.i2iImage=n;i2iSlot._restorePreview(n);persist();})),
        _mkPUDivider(),
        _mkPUSection("Edit"),
        _mkPUItem("Image 1","①",()=>_puUpload(n=>{setPill("edit");S.image1Name=n;img1Slot._restorePreview(n);updateSizeControls();persist();})),
        _mkPUItem("Image 2","②",()=>_puUpload(n=>{setPill("edit");S.image2Name=n;img2Slot._restorePreview(n);updateSizeControls();persist();})),
        _mkPUDivider(),
        _mkPUSection("Paint"),
        _mkPUItem("Paint slot","✏",()=>_puUpload(n=>{setPill("inpaint");_paintSlot._restorePreview(n);_maskName=null;_opMaskName=null;_maskSavedData=null;_maskSavedW=0;_maskSavedH=0;const sub=_inpaintBtn.querySelectorAll("div")[1];if(sub)tx(sub,"Paint mask over image");persist();})),
        _mkPUDivider(),
        _mkPUSection("Faceswap"),
        _mkPUItem("Target","◎",()=>_puUpload(n=>{setPill("faceswap");S.fsTarget=n;_fsTargetSlot._restorePreview(n);persist();})),
        _mkPUItem("Source","◈",()=>_puUpload(n=>{setPill("faceswap");S.fsSource=n;_fsSourceSlot._restorePreview(n);persist();})),
      );

      let _puDropOpen=false;
      previewUseBtn.onclick=e=>{ e.stopPropagation();_puDropOpen=!_puDropOpen;previewUseDrop.style.display=_puDropOpen?"flex":"none"; };
      document.addEventListener("click",()=>{ if(_puDropOpen){previewUseDrop.style.display="none";_puDropOpen=false;} });
      previewUseDrop.addEventListener("click",e=>e.stopPropagation());
      previewUseWrap.append(previewUseBtn,previewUseDrop);

      // ── Delete helper ─────────────────────────────────────────────────────
      // Confirm popover for delete — shows "Sure? Yes / Keep" near the trigger button
      const _confirmPop=mk("div",{
        position:"fixed",zIndex:"99999",
        background:"#18181c",border:`1px solid rgba(255,80,80,.45)`,
        borderRadius:"10px",padding:"10px 14px",
        display:"none",flexDirection:"column",alignItems:"center",gap:"8px",
        boxShadow:"0 6px 24px rgba(0,0,0,.7)",
        minWidth:"110px",
      });
      const _confirmTxt=mk("div",{fontSize:"11px",fontWeight:"600",color:"rgba(255,200,200,.9)",
        letterSpacing:".02em",whiteSpace:"nowrap"});
      tx(_confirmTxt,"Sure?");
      const _confirmBtns=mk("div",{display:"flex",gap:"6px"});
      const _mkConfBtn=(label,bg,hoverBg,color,border)=>{
        const b=mk("button",{
          background:bg,border:`1px solid ${border}`,borderRadius:"6px",
          padding:"4px 13px",fontSize:"10px",fontWeight:"700",
          color,cursor:"pointer",outline:"none",letterSpacing:".04em",
          transition:"background .12s,border-color .12s",
        });
        tx(b,label);
        b.onmouseenter=()=>{b.style.background=hoverBg;};
        b.onmouseleave=()=>{b.style.background=bg;};
        return b;
      };
      const _confirmYes=_mkConfBtn("Yes","rgba(180,30,30,.8)","rgba(220,40,40,.95)","#ffb0b0","rgba(255,80,80,.5)");
      const _confirmKeep=_mkConfBtn("Keep","rgba(255,255,255,.06)","rgba(255,255,255,.13)","rgba(255,255,255,.7)","rgba(255,255,255,.18)");
      _confirmBtns.append(_confirmYes,_confirmKeep);
      _confirmPop.append(_confirmTxt,_confirmBtns);
      document.body.appendChild(_confirmPop);

      let _confirmResolve=null;
      const _showConfirm=(anchorEl)=>new Promise(res=>{
        _confirmResolve=res;
        const r=anchorEl.getBoundingClientRect();
        // Position above the button, centered
        _confirmPop.style.display="flex";
        const pw=_confirmPop.offsetWidth||120;
        let left=r.left+r.width/2-pw/2;
        let top=r.top-_confirmPop.offsetHeight-8;
        if(top<8) top=r.bottom+8;
        left=Math.max(8,Math.min(left,window.innerWidth-pw-8));
        _confirmPop.style.left=left+"px";
        _confirmPop.style.top=top+"px";
      });
      const _hideConfirm=()=>{ _confirmPop.style.display="none"; _confirmResolve=null; };
      _confirmYes.onclick=()=>{ const r=_confirmResolve; _hideConfirm(); r?.(true); };
      _confirmKeep.onclick=()=>{ const r=_confirmResolve; _hideConfirm(); r?.(false); };
      document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&_confirmPop.style.display!=="none"){ _hideConfirm(); _confirmResolve?.(false); } });
      document.addEventListener("click",e=>{ if(_confirmPop.style.display!=="none"&&!_confirmPop.contains(e.target)) { _hideConfirm(); _confirmResolve?.(false); } },{capture:true});

      const _deleteImage=async(imgObj,anchorEl,onSuccess)=>{
        if(!imgObj||!imgObj.filename) return;
        const ok=await _showConfirm(anchorEl);
        if(!ok) return;
        try{
          const r=await api.fetchApi("/flux_klein/delete",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({filename:imgObj.filename,subfolder:imgObj.subfolder||""}),
          });
          const d=await r.json();
          if(d.ok){ onSuccess?.(); }
          else{ console.warn("[FluxKlein] delete failed:",(d.error||"unknown")); }
        }catch(e){ console.warn("[FluxKlein] delete error:",fmtErr(e)); }
      };

      // Preview delete button — bottom-right of previewBox
      const previewDelBtn=mk("button",{
        position:"absolute",bottom:"10px",right:"10px",zIndex:"5",
        width:"28px",height:"28px",borderRadius:"8px",
        background:"rgba(180,30,30,.75)",border:"1px solid rgba(255,80,80,.35)",
        color:"rgba(255,200,200,.9)",cursor:"pointer",outline:"none",
        display:"none",alignItems:"center",justifyContent:"center",padding:"0",
        backdropFilter:"blur(4px)",transition:"background .15s,border-color .15s",
      });
      previewDelBtn.title="Delete image";
      previewDelBtn.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
      previewDelBtn.onmouseenter=()=>{previewDelBtn.style.background="rgba(220,40,40,.95)";previewDelBtn.style.borderColor="rgba(255,80,80,.7)";};
      previewDelBtn.onmouseleave=()=>{previewDelBtn.style.background="rgba(180,30,30,.75)";previewDelBtn.style.borderColor="rgba(255,80,80,.35)";};
      previewDelBtn.onclick=()=>{
        const src=_getLastSrc();
        if(!src) return;
        _deleteImage(src,previewDelBtn,()=>{
          // Hide preview, show placeholder, clear _lastGenObj
          finalImg.src="";finalImg.style.display="none";
          comparerWrap.style.display="none";
          previewUseWrap.style.display="none";
          previewDelBtn.style.display="none";
          placeholder.style.display="flex";
          _lastGenObj=null;
          _galNeedsRefresh=true;
        });
      };

      // Comparer activates automatically in EDIT mode after generation

      previewBox.append(placeholder,finalImg,comparerWrap,previewUseWrap,previewDelBtn,progWrap);
      rightPanel.appendChild(previewBox);

      mainRow.append(leftPanel,rightPanel);

      // ── PROMPT ───────────────────────────────────────────────────────────
      const promptWrap=mk("div",{display:"flex",flexDirection:"column",gap:"5px"});
      const promptHdr=mk("div",{display:"flex",alignItems:"center",gap:"5px"});
      const promptCap=cap("Prompt");

      // ── LoRA overlay ──────────────────────────────────────────────────────
      // Overlay covers the node widget (like the prompt/sketch overlays), not the whole screen.
      const _ulOverlay=mk("div",{
        position:"absolute",inset:"0",zIndex:"250",display:"none",
        alignItems:"center",justifyContent:"center",
        padding:"14px",boxSizing:"border-box",
      });
      const _ulBg=mk("div",{position:"absolute",inset:"0",background:"rgba(0,0,0,.6)"});
      const _ulPanel=mk("div",{
        position:"relative",
        background:"linear-gradient(145deg,#111 0%,#0d0d0d 100%)",
        border:`1px solid rgba(240,255,65,.18)`,
        borderRadius:"16px",padding:"18px 20px 20px",width:"100%",maxWidth:"560px",
        maxHeight:"100%",
        boxShadow:"0 20px 60px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,255,255,.04)",
        display:"flex",flexDirection:"column",gap:"14px",boxSizing:"border-box",
      });
      const _ulPHdr=mk("div",{display:"flex",alignItems:"center",gap:"8px"});
      const _ulPTitle=mk("div",{fontSize:"12px",fontWeight:"700",color:"#fff",flex:"1",
        letterSpacing:".06em",textTransform:"uppercase"});
      tx(_ulPTitle,"LoRA");
      const _ulPClose=mk("button",{background:"none",border:"none",cursor:"pointer",
        color:C.muted,fontSize:"16px",lineHeight:"1",padding:"0",outline:"none",flexShrink:"0"});
      tx(_ulPClose,"×");
      _ulPClose.onmouseenter=()=>_ulPClose.style.color="#fff";
      _ulPClose.onmouseleave=()=>_ulPClose.style.color=C.muted;
      const _ulCloseFn=()=>{ _ulOverlay.style.display="none"; };
      _ulPClose.onclick=_ulCloseFn;
      _ulBg.onclick=_ulCloseFn;
      const _ulRefreshBtn=mk("button",{background:"none",border:"none",cursor:"pointer",
        color:C.muted,fontSize:"13px",lineHeight:"1",padding:"0 6px 0 0",outline:"none",flexShrink:"0"});
      tx(_ulRefreshBtn,"↻");
      _ulRefreshBtn.title="Refresh model list";
      _ulRefreshBtn.onmouseenter=()=>_ulRefreshBtn.style.color="#fff";
      _ulRefreshBtn.onmouseleave=()=>_ulRefreshBtn.style.color=C.muted;
      _ulRefreshBtn.onclick=()=>{ tx(_ulRefreshBtn,"↻"); _loadModels(); };
      _ulPHdr.append(_ulPTitle,_ulRefreshBtn,_ulPClose);
      const _ulPSub=mk("div",{width:"100%",height:"1px",background:"rgba(240,255,65,.10)",marginTop:"-6px"});
      const _ulRows=mk("div",{display:"flex",flexDirection:"column",gap:"10px",
        overflowY:"auto",overflowX:"hidden",flex:"1 1 auto",minHeight:"0",paddingRight:"4px"});

      const _UL_DEFAULT=3;   // default number of LoRA slots
      const _UL_MAX=6;       // maximum slots the user can add

      const _mkULRow=(idx)=>{
        const row=mk("div",{display:"flex",flexDirection:"column",gap:"6px",
          paddingBottom:"12px",borderBottom:`1px solid rgba(255,255,255,.06)`});
        const rowCtrl=mk("div",{display:"flex",alignItems:"center",gap:"7px"});
        // Slot number badge — sits in front of the dropdown
        const _rowNum=mk("span",{
          display:"inline-flex",alignItems:"center",justifyContent:"center",
          width:"17px",height:"17px",borderRadius:"50%",fontSize:"8px",fontWeight:"700",
          background:"rgba(240,255,65,.1)",color:LIME,flexShrink:"0",
        });
        tx(_rowNum,String(idx+1));

        // Enable/disable toggle — lets the user keep a LoRA loaded but inactive,
        // instead of zeroing its strength. Sits at the front of the row.
        const _enInit=S.userLoras[idx].enabled!==false;
        const enTog=mk("div",{
          width:"30px",height:"16px",borderRadius:"8px",position:"relative",
          cursor:"pointer",flexShrink:"0",transition:"background .18s",
          background:_enInit?"rgba(240,255,65,.85)":"rgba(255,255,255,.13)",
        });
        enTog.title="Toggle this LoRA on/off (keeps it loaded when off)";
        const enThumb=mk("div",{position:"absolute",top:"2px",left:_enInit?"16px":"2px",
          width:"12px",height:"12px",borderRadius:"50%",
          background:_enInit?"#111":"#888",transition:"left .18s,background .18s"});
        enTog.appendChild(enThumb);

        // Trigger words area — shown below the control row (subtle, not a heavy block).
        // paddingLeft aligns it under the dropdown: badge(17)+gap(7).
        const trigRow=mk("div",{display:"none",flexDirection:"column",gap:"6px",
          marginTop:"1px",paddingLeft:"24px",
        });
        const trigTopRow=mk("div",{display:"flex",alignItems:"baseline",gap:"6px"});
        const trigLbl=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,whiteSpace:"nowrap",
          flexShrink:"0",letterSpacing:".06em",textTransform:"uppercase",opacity:".8"});
        tx(trigLbl,"Trigger");
        const trigVal=mk("div",{fontSize:"10px",color:LIME,flex:"1",minWidth:"0",
          wordBreak:"break-word",lineHeight:"1.4"});
        tx(trigVal,"—");
        // Edit pencil — shown only when a trigger value exists, toggles the input row
        const trigEditBtn=mk("button",{
          background:"none",border:"none",cursor:"pointer",color:C.muted,
          padding:"0 2px",lineHeight:"1",flexShrink:"0",outline:"none",
          transition:"color .15s",display:"none",fontSize:"10px",
        });
        trigEditBtn.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
        trigEditBtn.title="Edit trigger words";
        trigEditBtn.onmouseenter=()=>trigEditBtn.style.color=LIME;
        trigEditBtn.onmouseleave=()=>trigEditBtn.style.color=C.muted;
        trigTopRow.append(trigLbl,trigVal,trigEditBtn);

        // Custom trigger input row
        const trigCustomRow=mk("div",{display:"flex",alignItems:"center",gap:"5px"});
        const trigCustomInp=mk("input",{
          flex:"1",background:"rgba(255,255,255,.04)",border:`1px solid rgba(255,255,255,.1)`,
          borderRadius:"6px",color:C.text,fontSize:"10px",padding:"5px 9px",
          outline:"none",transition:"border-color .15s",
        },{type:"text",placeholder:"Add custom trigger words…"});
        trigCustomInp.onfocus=()=>trigCustomInp.style.borderColor=LIME;
        trigCustomInp.onblur=()=>trigCustomInp.style.borderColor="rgba(255,255,255,.12)";
        const trigSaveBtn=mk("button",{
          background:"rgba(255,255,255,.07)",border:`1px solid rgba(255,255,255,.15)`,
          borderRadius:"5px",cursor:"pointer",color:C.muted,fontSize:"9px",fontWeight:"700",
          padding:"3px 9px",outline:"none",transition:"all .15s",flexShrink:"0",whiteSpace:"nowrap",
        });
        tx(trigSaveBtn,"Save");
        trigSaveBtn.onmouseenter=()=>{trigSaveBtn.style.background="rgba(240,255,65,.12)";trigSaveBtn.style.borderColor=LIME;trigSaveBtn.style.color=LIME;};
        trigSaveBtn.onmouseleave=()=>{trigSaveBtn.style.background="rgba(255,255,255,.07)";trigSaveBtn.style.borderColor="rgba(255,255,255,.15)";trigSaveBtn.style.color=C.muted;};
        trigSaveBtn.onclick=async()=>{
          const name=ulDD.value;
          if(!name||name==="none") return;
          const txt=trigCustomInp.value.trim();
          await _saveCustomTrigger(name,txt);
          // Update displayed value and collapse the input row
          tx(trigVal,txt||"—");
          trigCustomInp.value="";
          trigSaveBtn.style.color=LIME; tx(trigSaveBtn,"Saved ✓");
          setTimeout(()=>{ trigSaveBtn.style.color=C.muted; tx(trigSaveBtn,"Save"); },1500);
          _setTrigEditMode(false);
        };
        trigCustomRow.append(trigCustomInp,trigSaveBtn);
        trigRow.append(trigTopRow,trigCustomRow);

        // The input row is never shown automatically — only after clicking the pencil.
        // The trigger value (or "—") is always visible under the dropdown, so the user
        // already sees whether one is set; the pencil just opens the editor.
        const _setTrigEditMode=(editing)=>{
          trigCustomRow.style.display=editing?"flex":"none";
          trigEditBtn.style.display=editing?"none":"inline-flex";
        };
        trigEditBtn.onclick=()=>{ trigCustomInp.value=(trigVal.textContent==="—"||trigVal.textContent==="…")?"":trigVal.textContent; _setTrigEditMode(true); trigCustomInp.focus(); };

        // Load and display trigger words when lora changes
        const _refreshTrigWords=async(loraName)=>{
          if(!loraName||loraName==="none"){ trigRow.style.display="none"; return; }
          trigRow.style.display="flex";
          tx(trigVal,"…");
          trigCustomInp.value="";
          await _loadCustomTriggers();
          const custom=_getCustomTrigger(loraName);
          if(custom){
            // Custom always wins over metadata
            tx(trigVal,custom);
          } else {
            try{
              const r=await api.fetchApi(`/flux_klein/lora_triggers?name=${encodeURIComponent(loraName)}`);
              const d=await r.json();
              tx(trigVal,(d.ok&&d.triggers?.length)?d.triggers.join(", "):"—");
            }catch(e){ tx(trigVal,"—"); }
          }
          // Collapse to display mode if a value exists, else show the input
          _setTrigEditMode(false);
        };

        const ulDD=DD(["none"],"none",v=>{
          const has=v&&v!=="none";
          S.userLoras[idx].name=has?v:"";
          if(!has){
            S.userLoras[idx].strength=0; ulStr.value="0";
          } else {
            // Selecting a LoRA: default to 1 only when strength is unset/zero
            // (negative values are valid — concept sliders — so keep those),
            // then always sync the input to the stored value, since an empty slot
            // shows "0" while its state strength may already be 1.
            const cur=+(S.userLoras[idx].strength);
            if(!isFinite(cur)||cur===0) S.userLoras[idx].strength=1;
            ulStr.value=String(S.userLoras[idx].strength);
          }
          _ulUpdateBtn();persist();
          _refreshTrigWords(v);
        });
        ulDD.el.style.flex="1";ulDD.el.style.minWidth="0";

        // type:"text" + inputmode:"decimal" so the numpad "." is accepted regardless
        // of OS locale (type:"number" rejects "." on comma-locales). _pf() parses both.
        const ulStr=mk("input",{
          width:"46px",textAlign:"center",background:"rgba(255,255,255,.05)",
          border:`1px solid rgba(255,255,255,.1)`,borderRadius:"7px",
          color:LIME,fontSize:"11px",fontWeight:"700",cursor:"ew-resize",
          padding:"6px 0",outline:"none",transition:"border-color .15s",flexShrink:"0",
        },{type:"text",inputMode:"decimal",value:String(S.userLoras[idx].name&&S.userLoras[idx].name!=="none"?S.userLoras[idx].strength||1:0)});
        ulStr.onfocus=()=>{ ulStr.style.borderColor=LIME; ulStr.select(); };
        ulStr.onblur=()=>{ const p=_pf(ulStr.value); S.userLoras[idx].strength=isNaN(p)?1:p;
          ulStr.value=String(S.userLoras[idx].strength);persist(); };
        ulStr.oninput=()=>{ S.userLoras[idx].strength=_pf(ulStr.value)||0;persist(); };

        // Drag-on-number: hold and drag horizontally to scrub the strength value,
        // like native ComfyUI number widgets. A plain click (no drag) still focuses
        // the field for typing — we only hijack the pointer once a real drag starts.
        (()=>{
          let armed=false,dragging=false,justDragged=false,startX=0,startVal=0,pid=0;
          const STEP=0.01;       // value change per pixel
          const THRESHOLD=3;     // px before it counts as a drag (vs a click)
          ulStr.addEventListener("pointerdown",(e)=>{
            armed=true;dragging=false;startX=e.clientX;pid=e.pointerId;
            startVal=_pf(ulStr.value); if(isNaN(startVal)) startVal=0;
            // Capture the pointer up front so every move/up is delivered even once the
            // cursor leaves this 46px-wide box. Without it, pre-threshold pointermove
            // only fires while over the field, so fast or edge-started drags exit the
            // box before crossing THRESHOLD and the scrub silently no-ops (the "sometimes
            // works" bug). Capture doesn't preventDefault, so a plain click still focuses
            // the field for typing; the drag only kicks in past THRESHOLD.
            try{ ulStr.setPointerCapture(pid); }catch(_){}
          });
          ulStr.addEventListener("pointermove",(e)=>{
            if(!armed) return;
            const dx=e.clientX-startX;
            if(!dragging){
              if(Math.abs(dx)<THRESHOLD) return; // still within click tolerance
              dragging=true;
              if(document.activeElement===ulStr) ulStr.blur(); // leave edit mode when a drag begins
            }
            let v=startVal+dx*STEP;
            v=Math.round(v*100)/100;
            ulStr.value=String(v);
            S.userLoras[idx].strength=v; persist();
          });
          ulStr.addEventListener("pointerup",()=>{
            if(!armed) return;
            armed=false;
            try{ ulStr.releasePointerCapture(pid); }catch(_){} // always release (captured on every pointerdown)
            if(dragging){
              ulStr.blur();           // committed via drag — don't enter edit mode
              justDragged=true;       // swallow the trailing click
              setTimeout(()=>{ justDragged=false; },0);
            }
            dragging=false;
          });
          ulStr.addEventListener("pointercancel",()=>{ try{ ulStr.releasePointerCapture(pid); }catch(_){} armed=false;dragging=false; });
          // Swallow the click that immediately follows a real drag (so it doesn't focus)
          ulStr.addEventListener("click",(e)=>{ if(justDragged){ e.preventDefault();e.stopPropagation(); } });
        })();

        // Reflect the slot's enabled state: move the switch and dim the controls
        // when off (values are kept — only generation skips a disabled slot).
        // To fully empty a slot, set the dropdown to "none" (handled in ulDD onChange).
        const _applyEnabled=()=>{
          const en=S.userLoras[idx].enabled!==false;
          enTog.style.background=en?"rgba(240,255,65,.85)":"rgba(255,255,255,.13)";
          enThumb.style.left=en?"16px":"2px";
          enThumb.style.background=en?"#111":"#888";
          const op=en?"1":"0.4";
          _rowNum.style.opacity=op; ulDD.el.style.opacity=op;
          ulStr.style.opacity=op; trigRow.style.opacity=op;
        };
        enTog.onclick=()=>{
          S.userLoras[idx].enabled=!(S.userLoras[idx].enabled!==false);
          _applyEnabled();_ulUpdateBtn();persist();
        };

        rowCtrl.append(_rowNum,ulDD.el,ulStr,enTog);
        row.append(rowCtrl,trigRow);
        row._dd=ulDD;row._str=ulStr;
        // Clear the slot's UI completely, including the trigger row (used on restore).
        row._reset=()=>{ ulDD.set("none"); ulStr.value="0"; trigRow.style.display="none"; _applyEnabled(); };
        row._applyEnabled=_applyEnabled;
        row._refreshTrig=_refreshTrigWords;
        _applyEnabled();

        // Restore trigger words display if lora already selected
        if(S.userLoras[idx].name&&S.userLoras[idx].name!=="none"){
          _refreshTrigWords(S.userLoras[idx].name);
        }
        return row;
      };
      // Dynamic LoRA slots: default 3, user can add up to _UL_MAX.
      let _ulRowEls=[];
      let _ulAddBtn=null, _ulRemoveBtn=null;  // assigned below; declared here for _ulRebuildRows
      const _ulSyncBtnRow=()=>{
        if(_ulAddBtn) _ulAddBtn.style.display=S.userLoras.length>=_UL_MAX?"none":"flex";
        if(_ulRemoveBtn) _ulRemoveBtn.style.display=S.userLoras.length>_UL_DEFAULT?"flex":"none";
      };
      // Normalize older saved slots that predate the enable/disable toggle so every
      // slot carries an explicit `enabled` flag (missing `enabled` is treated as on).
      S.userLoras=(S.userLoras||[]).map(l=>({name:l.name||"",strength:l.strength===undefined?1.0:l.strength,enabled:l.enabled!==false}));
      // Clamp restored state to [_UL_DEFAULT, _UL_MAX]
      while(S.userLoras.length<_UL_DEFAULT) S.userLoras.push({name:"",strength:1.0,enabled:true});
      if(S.userLoras.length>_UL_MAX) S.userLoras.length=_UL_MAX;

      const _ulRebuildRows=()=>{
        _ulRows.innerHTML="";
        _ulRowEls=S.userLoras.map((_,i)=>_mkULRow(i));
        _ulRowEls.forEach(r=>_ulRows.appendChild(r));
        _ulSyncBtnRow();
      };

      // Re-populate every slot's dropdown from the current model list (used after
      // adding/removing a slot so freshly-built rows show the available LoRAs).
      // Never wipe a saved name when the model list is empty (e.g. models not loaded
      // yet) — that would silently drop the user's selections in the other slots.
      const _ulSyncSlotsToModels=()=>{
        const haveList=Array.isArray(_loraList)&&_loraList.length>0;
        const loraOpts=["none",...(_loraList||[])];
        _ulRowEls.forEach((r,i)=>{
          r._dd.updateItems(loraOpts);
          const saved=S.userLoras[i]?.name;
          if(saved&&saved!=="none"){
            const nd=(s)=>s.replace(/\\/g,"/").toLowerCase();
            const match=loraOpts.find(o=>nd(o)===nd(saved))||
              loraOpts.find(o=>nd(o).split("/").pop()===nd(saved).split("/").pop());
            if(match){ r._dd.set(match); S.userLoras[i].name=match; }
            else if(haveList){ r._dd.set("none"); S.userLoras[i].name=""; }
            // else: list not loaded — keep the saved name, leave the dropdown as-is
          } else r._dd.set("none");
        });
      };

      const _ulAddSlot=()=>{
        if(S.userLoras.length>=_UL_MAX) return;
        S.userLoras.push({name:"",strength:1.0,enabled:true});
        _ulRebuildRows();
        _ulSyncSlotsToModels();
        persist();
      };

      const _ulRemoveSlot=()=>{
        if(S.userLoras.length<=_UL_DEFAULT) return;
        S.userLoras.pop();
        _ulRebuildRows();
        _ulSyncSlotsToModels();
        _ulUpdateBtn();persist();
      };

      _ulRebuildRows();

      // Add / Remove-last slot buttons — sit together in one row below the slots
      const _ulBtnRow=mk("div",{display:"flex",gap:"8px"});
      _ulAddBtn=mk("button",{
        flex:"1",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",
        background:"rgba(240,255,65,.06)",border:`1px dashed rgba(240,255,65,.3)`,
        borderRadius:"8px",cursor:"pointer",color:LIME,fontSize:"10px",fontWeight:"700",
        letterSpacing:".05em",padding:"8px",outline:"none",transition:"all .15s",
      });
      tx(_ulAddBtn,"+ Add slot");
      _ulAddBtn.onmouseenter=()=>{ _ulAddBtn.style.background="rgba(240,255,65,.12)";_ulAddBtn.style.borderColor=LIME; };
      _ulAddBtn.onmouseleave=()=>{ _ulAddBtn.style.background="rgba(240,255,65,.06)";_ulAddBtn.style.borderColor="rgba(240,255,65,.3)"; };
      _ulAddBtn.onclick=_ulAddSlot;

      _ulRemoveBtn=mk("button",{
        flex:"1",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",
        background:"rgba(255,80,80,.05)",border:`1px dashed rgba(255,80,80,.25)`,
        borderRadius:"8px",cursor:"pointer",color:"rgba(255,120,120,.8)",fontSize:"10px",fontWeight:"700",
        letterSpacing:".05em",padding:"8px",outline:"none",transition:"all .15s",
      });
      tx(_ulRemoveBtn,"− Remove last slot");
      _ulRemoveBtn.onmouseenter=()=>{ _ulRemoveBtn.style.background="rgba(255,80,80,.12)";_ulRemoveBtn.style.borderColor="rgba(255,80,80,.45)";_ulRemoveBtn.style.color="#ff8888"; };
      _ulRemoveBtn.onmouseleave=()=>{ _ulRemoveBtn.style.background="rgba(255,80,80,.05)";_ulRemoveBtn.style.borderColor="rgba(255,80,80,.25)";_ulRemoveBtn.style.color="rgba(255,120,120,.8)"; };
      _ulRemoveBtn.onclick=_ulRemoveSlot;

      _ulBtnRow.append(_ulAddBtn,_ulRemoveBtn);
      _ulSyncBtnRow();

      // Info note at bottom of panel
      const _ulInfoNote=mk("div",{
        fontSize:"9px",color:C.muted,lineHeight:"1.5",
        padding:"8px 10px",background:"rgba(255,255,255,.03)",
        borderRadius:"6px",border:`1px solid ${C.border}`,
      });
      tx(_ulInfoNote,"✦ Trigger words are applied automatically if saved and set for the selected LoRA.");

      // OK button — confirm/close the panel (Enter also closes it)
      const _ulOkBtn=mk("button",{
        alignSelf:"flex-end",background:LIME,border:"none",borderRadius:"8px",
        color:"#0a0a0a",fontSize:"11px",fontWeight:"700",letterSpacing:".06em",
        padding:"8px 22px",cursor:"pointer",outline:"none",transition:"filter .12s",
      });
      tx(_ulOkBtn,"OK");
      _ulOkBtn.onmouseenter=()=>_ulOkBtn.style.filter="brightness(1.1)";
      _ulOkBtn.onmouseleave=()=>_ulOkBtn.style.filter="";
      _ulOkBtn.onclick=_ulCloseFn;

      _ulPanel.append(_ulPHdr,_ulPSub,_ulRows,_ulBtnRow,_ulInfoNote,_ulOkBtn);
      _ulOverlay.append(_ulBg,_ulPanel);
      root.appendChild(_ulOverlay);

      // Enter / Escape close the panel (unless focus is in a text field that needs Enter)
      document.addEventListener("keydown",(e)=>{
        if(_ulOverlay.style.display==="none") return;
        if(e.key==="Escape"){ e.preventDefault();e.stopPropagation();_ulCloseFn();return; }
        if(e.key!=="Enter") return;
        const t=e.target||{};
        if(t.tagName==="TEXTAREA") return;
        if(t.tagName==="INPUT"&&(t.type==="text"||t.type==="search")) return;
        e.preventDefault();e.stopPropagation();
        _ulCloseFn();
      },{capture:true});

      // ── Collect trigger words for all active LoRAs at generate time ────────
      const _buildPromptWithTriggers=async(basePrompt)=>{
        await _loadCustomTriggers();
        const trigParts=[];
        for(const ul of S.userLoras){
          if(!ul.name||ul.name==="none"||ul.enabled===false||!(+(ul.strength||0)>0)) continue;
          // Custom trigger words override metadata
          const custom=_getCustomTrigger(ul.name);
          if(custom){ trigParts.push(custom); continue; }
          // Try metadata
          try{
            const r=await api.fetchApi(`/flux_klein/lora_triggers?name=${encodeURIComponent(ul.name)}`);
            const d=await r.json();
            if(d.ok&&d.triggers?.length) trigParts.push(d.triggers.join(", "));
          }catch(e){}
        }
        if(!trigParts.length) return basePrompt;
        const prefix=trigParts.join(", ");
        return basePrompt.trim()?`${prefix}, ${basePrompt.trim()}`:prefix;
      };

      // ── Add LoRA button — identical style/layout to LTX node ─────────────
      const _ulBtn=mk("button",{
        background:"linear-gradient(135deg,rgba(240,255,65,.10),rgba(240,255,65,.04))",
        border:"1.5px solid rgba(240,255,65,.35)",cursor:"pointer",
        padding:"2px 8px 2px 6px",color:LIME,outline:"none",
        display:"flex",alignItems:"center",gap:"5px",borderRadius:"5px",
        transition:"all .15s",flexShrink:"0",marginLeft:"auto",
        boxShadow:"0 0 0 0 rgba(240,255,65,0)",
      });
      const _ulBtnIco=document.createElementNS("http://www.w3.org/2000/svg","svg");
      _ulBtnIco.setAttribute("viewBox","0 0 24 24");_ulBtnIco.setAttribute("width","9");_ulBtnIco.setAttribute("height","9");
      _ulBtnIco.setAttribute("fill","none");_ulBtnIco.setAttribute("stroke","currentColor");
      _ulBtnIco.setAttribute("stroke-width","2");_ulBtnIco.setAttribute("stroke-linecap","round");
      _ulBtnIco.innerHTML=`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`;
      const _ulBtnTxt=mk("span",{fontSize:"9px",fontWeight:"700",letterSpacing:".04em"});
      tx(_ulBtnTxt,"Add LoRA");
      const _ulBtnBadge=mk("span",{fontSize:"7px",fontWeight:"700",background:LIME,color:"#111",
        borderRadius:"20px",padding:"0 4px",lineHeight:"1.6",display:"none",flexShrink:"0"});
      _ulBtn.append(_ulBtnIco,_ulBtnTxt,_ulBtnBadge);
      _ulBtn.onmouseenter=()=>{ _ulBtn.style.background="linear-gradient(135deg,rgba(240,255,65,.18),rgba(240,255,65,.08))";_ulBtn.style.borderColor=LIME;_ulBtn.style.boxShadow="0 0 8px rgba(240,255,65,.12)"; };
      _ulBtn.onmouseleave=()=>{ _ulBtn.style.background="linear-gradient(135deg,rgba(240,255,65,.10),rgba(240,255,65,.04))";_ulBtn.style.borderColor="rgba(240,255,65,.35)";_ulBtn.style.boxShadow="0 0 0 0 rgba(240,255,65,0)"; };
      _ulBtn.onclick=()=>{ _ulOverlay.style.display="flex"; };

      const _ulUpdateBtn=()=>{
        const n=S.userLoras.filter(l=>l.name&&l.name!=="none"&&l.enabled!==false).length;
        tx(_ulBtnBadge,String(n));
        _ulBtnBadge.style.display=n>0?"":"none";
        _ulBtn.style.borderColor=n>0?LIME:"rgba(240,255,65,.35)";
        _ulBtn.style.color=n>0?LIME:LIME;
      };
      _ulUpdateBtn();

      // ── Expand prompt button — identical style to LTX node ────────────────
      const _promptExpandBtn=mk("button",{
        background:"none",border:`1px solid ${C.border}`,cursor:"pointer",
        padding:"2px 7px 2px 5px",color:C.muted,outline:"none",
        display:"flex",alignItems:"center",gap:"5px",borderRadius:"5px",
        transition:"color .15s,border-color .15s",flexShrink:"0",
      });
      _promptExpandBtn.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg><span style="font-size:9px;font-weight:700;letter-spacing:.04em">Expand prompt</span>`;
      _promptExpandBtn.onmouseenter=()=>{ _promptExpandBtn.style.color="#fff";_promptExpandBtn.style.borderColor="#555"; };
      _promptExpandBtn.onmouseleave=()=>{ _promptExpandBtn.style.color=C.muted;_promptExpandBtn.style.borderColor=C.border; };

      // Error chip (shown when error is minimized)
      const errMinChip=mk("button",{
        display:"none",alignItems:"center",gap:"4px",
        background:"none",border:`1px solid rgba(255,103,103,.35)`,
        borderRadius:"5px",padding:"2px 7px",cursor:"pointer",outline:"none",
        color:"rgba(255,103,103,.8)",fontSize:"9px",fontWeight:"700",
        letterSpacing:".03em",transition:"border-color .15s,color .15s",flexShrink:"0",
      });
      tx(errMinChip,"⚠ Error");

      // ── Get Inspired overlay ──────────────────────────────────────────────
      // Per-pill prompt suggestions
      // INSPIRE_BY_PILL is loaded from config.json on first Discover open.
      // This object serves as the default — written to config.json if discover_prompts is empty.
      let INSPIRE_BY_PILL={
        t2i:{
          categories:[],
        },
        edit:{
          categories:[
            {cat:"ANGLES",items:[
              {label:"Close-up",prompt:"Shift to a tight close-up on the subject. Crop the frame closely to focus on the main details while keeping the background sharp and visible. Ensure all colors, textures, and environmental elements from the original scene remain identical and perfectly clear, simply viewed from a much shorter camera distance."},
              {label:"Wide-angle",prompt:"Switch to a wide-angle lens while keeping the subject at the center. Reveal more of the existing environment, ensuring the architecture, lighting, and background elements remain identical to the original scene."},
              {label:"Aerial view",prompt:"Transition to a high-altitude aerial view. Reinterpret the original environment's layout from above, keeping all landmarks, colors, and lighting consistent with the source image."},
              {label:"Low-angle",prompt:"Move the camera to a low-angle ground position. Keep the environment identical but show more of the sky or ceiling, ensuring the subject and background maintain their established relationship and scale."},
            ]},
            {cat:"RELIGHT",items:[
              {label:"Soft Azure Drift",prompt:"relight with gentle soft blue lighting emanating from the upper right corner"},
              {label:"Dramatic Slats",prompt:"Relight the image with a strong directional light source from the bottom left, creating distinct shadows and casting linear shadows on the background"},
              {label:"Amber Sideglow",prompt:"relight with noticeable warm amber daylight emanating from the right side"},
              {label:"Shadow Fade Mystery",prompt:"add soft, warm lighting from the right side that gradually fades to shadows on the left, creating a dim, mysterious atmosphere with gentle gradients from light to dark"},
              {label:"High-Top Backlight",prompt:"Relight the image with a strong backlight like lighting from the top"},
              {label:"Soft Foggy Bloom",prompt:"Relight the scene with a soft, diffused foggy glow emanating from the top left side"},
              {label:"Dim Silver Moon",prompt:"relight with dim silver moonlight coming from the top right"},
              {label:"Dappled Canopy",prompt:"add dappled sunlight filtered through leaves from the top creating the shadows, source out of the scene"},
              {label:"Subtle Cool Bloom",prompt:"relight with a subtle cool white glow from the right side, source off-camera"},
              {label:"Warm Hearth Flicker",prompt:"relight with flickering warm orange light from the bottom center, source out of frame"},
              {label:"Sharp Cool Burst",prompt:"add a sharp burst of cool white light from the upper left, source off-camera"},
              {label:"Golden Doorway Glow",prompt:"add a warm yellow glow coming through a doorway from the side, source out of frame"},
              {label:"Faint Moon Hue",prompt:"relight with a faint desaturated blue moonlight from the top left, source out of frame"},
              {label:"Neutral Studio Soft",prompt:"relight with soft neutral white studio lighting from the top left, source out of frame"},
              {label:"Golden Rim Halo",prompt:"add a strong golden hour backlight, creating a glowing outline, source off-camera"},
              {label:"Blue-Magenta Split",prompt:"relight with a mix of cool blue and deep magenta light from opposite sides, source off-camera"},
              {label:"Low-Key Beam",prompt:"add low-key dramatic lighting with a narrow beam of light from the side, source out of frame"},
              {label:"Harsh Top-Down Noir",prompt:"relight with a harsh cool white top-down light, source off-camera, heavy shadows"},
              {label:"Dawn Flare",prompt:"relight with a low-angle warm orange sunrise from the horizon, long soft shadows, hazy morning glow, source out of frame."},
              {label:"Amber Beams",prompt:"relight with warm volumetric light beams from the top right, hazy atmosphere, source out of frame."},
              {label:"Teal-Orange Mix",prompt:"relight with a teal ambient fill and a warm orange key light from the opposite side, classic cinematic color grade, source out of frame."},
              {label:"Deep Kicker",prompt:"add a strong cool white kicker light from the back-left, grazing the edges of the subject, deep shadows in front, source out of frame."},
              {label:"Cross Light",prompt:"relight with two opposing light sources from the left and right sides, high contrast, creating a bright central highlight, source out of frame."},
              {label:"Cold Fill",prompt:"add a subtle desaturated cold blue fill light to the shadow areas, keeping the main light warm, professional color contrast, source out of frame."},
              {label:"Vignette Rim",prompt:"add a sharp white rim light from the back-right, separating the subject from a dark background, source out of frame."},
              {label:"Velvet Shadow",prompt:"relight with low-intensity soft light from the top, creating deep velvet-like shadows and subtle highlights on top surfaces, source out of frame."},
            ]},
            {cat:"STYLES",items:[
              {label:"35mm",prompt:"Change style to a grainy 35mm film photograph, shot on Kodak Portra 400, vintage aesthetic, natural colors."},
              {label:"Polaroid",prompt:"Change style to an authentic 1980s Polaroid photo, faded edges, soft focus, square format with white border."},
              {label:"NatGeo",prompt:"Change style to a raw documentary photograph, high-detail texture, natural sunlight, National Geographic aesthetic."},
              {label:"3D Render",prompt:"Change style to a clean 3D isometric render, soft clay-like textures, pastel color palette, Octane Render, studio lighting."},
              {label:"Oil Paint",prompt:"Change style to a classical oil painting, thick impasto brushstrokes, rich canvas texture, dramatic chiaroscuro."},
              {label:"VHS",prompt:"Change style to a 1990s VHS recording, tracking lines, chromatic aberration, low resolution, analog video glitch."},
              {label:"Portrait",prompt:"Change style to a high-end studio portrait, dramatic Rembrandt lighting, deep shadows, sharp focus on eyes, 8k professional photography."},
              {label:"Sketch",prompt:"Change style to a detailed graphite pencil sketch on textured paper, hand-drawn strokes, cross-hatching, artistic shading."},
              {label:"Digicam",prompt:"Change style to a 2000s consumer digital camera photo, overexposed flash, slight motion blur, dated date stamp in right corner \"01-08-2002\", low dynamic range."},
              {label:"Impressionist",prompt:"Change style to impressionist painting, vibrant dappled light, short thick brushstrokes, focus on light's movement, Monet-inspired palette."},
              {label:"Double Exp",prompt:"Change style to a double exposure photograph, blending the subject with a lush forest landscape, surreal overlays, ethereal atmosphere."},
              {label:"Gothic",prompt:"Change style to a dark moody gothic aesthetic, desaturated colors, misty atmosphere, sharp contrast, cinematic shadows."},
              {label:"Ukiyo-e",prompt:"Change style to traditional Japanese Ukiyo-e woodblock print, flat colors, bold outlines, decorative patterns, antique paper texture."},
              {label:"Charcoal",prompt:"Change style to a rough charcoal drawing, smudged textures, heavy dark strokes, expressive hand-drawn feel on textured canvas."},
              {label:"Marble",prompt:"Change style to a classical marble sculpture, smooth white stone texture, fine chiseled details, soft museum spotlighting."},
              {label:"Watercolor",prompt:"Change style to a delicate watercolor painting, soft pigment bleeds, wet-on-wet technique, hand-painted on cold-press paper."},
              {label:"Daguerreotype",prompt:"Change style to an 1800s daguerreotype, antique silver plate texture, sepia tones, heavy scratches, blurred edges, historical look."},
              {label:"Embroidery",prompt:"Change style to detailed needlepoint embroidery, textured silk threads, hand-stitched patterns, fabric canvas texture."},
              {label:"Claymation",prompt:"Change style to a stop-motion claymation figure, handmade plasticine texture, thumbprint details, studio macro lighting."},
              {label:"Low Poly",prompt:"Change style to a low-poly geometric art, sharp triangular facets, flat shading, minimalist 3D aesthetic."},
              {label:"Vector Art",prompt:"Change style to clean flat vector illustration, geometric shapes, bold solid colors, minimalist digital art."},
              {label:"16-Bit Pixel",prompt:"Change style to 16-bit retro pixel art, limited color palette, clean sprites, nostalgic SNES aesthetic."},
              {label:"Fortnite 3D",prompt:"Change style to Fortnite stylized 3D, vibrant colors, clean cartoonish textures, smooth lighting, battle royale aesthetic."},
            ]},
            {cat:"OTHER",items:[
              {label:"Enhance",prompt:"Enhance the overall image quality by restoring fine details and sharpening the focus. Remove all types of blur, including motion and lens blur, while preserving the original features, textures, and likeness. Increase clarity and micro-contrast without introducing artifacts, ensuring a clean, high-definition result that stays true to the source."},
              {label:"Text edit",prompt:"Replace the existing text \"[OLD TEXT]\" with the new text \"[NEW TEXT]\" in the image. Replicate the exact typography, font family, letter shapes, color palette, effects, and texturing of the original text perfectly. Maintain the exact same position, scale, and alignment within the scene."},
              {label:"Try-on",prompt:"Using Image 1 as the subject reference and Image 2 as the outfit reference: Modify only the clothing of the person from Image 1, completely replacing it with the exact outfit, style, textures, materials, and colors shown in Image 2. Retain the exact face, identity, hair, expression, pose, and background from Image 1. Conform the new clothing from Image 2 realistically to the subject's body shape and the lighting environment of Image 1. Maintain the original camera framing.",dual:true},
              {label:"Texture transfer",prompt:"Using Image 1 as the subject and geometry reference, and Image 2 as the texture and material reference: Completely replace the surface material of the subject in Image 1 with the exact tactile texture, pattern, and material characteristics shown in Image 2. Conform the new texture perfectly to the 3D contours, shapes, curves, and lighting of Image 1. Maintain the original face, pose, anatomy, and background from Image 1 perfectly.",dual:true},
            ]},
          ],
        },
        _edit_unused:{
          tabs:[
            {cat:"Single Input",items:[
              "Replace the [Original Subject] with a [New Subject], maintaining the exact same scale and placement. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Modify the [Subject] to appear [Age - e.g., much older/as a child], keeping the facial structure and expression recognizable. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Change the expression of the [Subject] from [Original Expression] to [New Expression], ensuring the facial features remain consistent. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Change the subject's hair to a [New Style/Length] in [Color], ensuring it flows naturally with the head's position. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Add a well-groomed [Type of Beard/Facial Hair] to the subject's face. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Modify the subject's physique to be more [Trait - e.g., muscular/slender] while preserving their identity and clothing fit. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Redesign the [Subject] to look like a [Theme - e.g., cyberpunk/fantasy] version of themselves. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Replace the subject's [Original Clothing] with [New Clothing Item] made of [Material]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Change the subject's shoes into [New Footwear Type] that match the overall scene style. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Place a [Type of Hat/Helmet] onto the subject's head, ensuring it fits the perspective and casts appropriate shadows. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Modify the material of the [Clothing Item] to appear as [New Material - e.g., iridescent silk/liquid chrome]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Add a [Accessory - e.g., luxury watch/ornate necklace] to the subject, ensuring realistic skin contact and placement. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Swap the current glasses with [New Eyewear Style] that features realistic lens reflections. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Transform the subject's outfit into a set of [Type of Armor - e.g., medieval plate/sci-fi plating]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Replace the sky with a [New Sky Type - e.g., dramatic sunset/starry cosmos], ensuring no light bleeding onto the landscape. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Change the ground surface from [Original Texture] to [New Texture - e.g., cracked ice/black sand]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Modify the walls of the [Building/Room] to be made of [New Material - e.g., polished concrete/dark wood]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Replace the existing trees and plants with [New Flora Type - e.g., glowing alien plants/autumnal maples]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Add a layer of [Weather - e.g., heavy rain/swirling dust motes] to the scene. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Modify the view seen through the window to show a [New Location - e.g., underwater scene/Parisian street]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Completely remove the [Object] and fill the empty space with the matching background texture. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Replace the [Furniture/Prop] with a [New Furniture/Prop] of similar dimensions and perspective. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Transform the [Old Device] into a [Futuristic/Advanced Device], maintaining its position and usage. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Change the [Original Vehicle] into a [New Vehicle Model] while keeping the exact same angle and perspective. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Change the contents of the [Container/Glass] from [Original Liquid] to [New Liquid - e.g., glowing lava/mercury]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Modify the [Mechanical Object] so it appears to be covered in [Organic Element - e.g., moss and wild flowers]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Replace the [Food/Drink item] on the table with a [New Food/Drink item]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Add a [Color] neon glow effect to the edges and contours of the [Object]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
              "Apply a layer of [Effect - e.g., heavy rust/cracked paint] to the [Object]. Ensure all other elements, lighting, composition, and color grading remain exactly as they are in the original image.",
            ]},
            {cat:"2 Input Images",items:[
              "Take the [Subject] from Input 2 and place them into the scene of Input 1, replacing the [Target Subject]. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
              "Transfer the facial features of the person in Input 1 onto the person's head in Input 2. Ensure all other elements, lighting, composition, and color grading of Input 2 remain exactly as they are.",
              "In Input 1, replace the [Original Object] with the [New Object] seen in Input 2, matching the perspective. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
              "Replace whatever the person is holding in Input 1 with the [Item] shown in Input 2. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
              "Change the clothing of the subject in Input 1 to match the specific outfit worn by the subject in Input 2. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
              "Keep the foreground subject of Input 1, but replace the entire background with the environment shown in Input 2. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
              "Insert the [Animal] from Input 2 into the landscape of Input 1, ensuring a natural interaction with the ground. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
              "Take the specific [Pattern/Logo] from the object in Input 2 and apply it onto the [Target Object] in Input 1. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
              "Add the subject from Input 2 into the frame of Input 1 so they are standing next to the original subject. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
              "Replace the architectural style of the building in Input 1 with the architectural style shown in Input 2. Ensure all other elements, lighting, composition, and color grading of Input 1 remain exactly as they are.",
            ]},
          ],
        },
        i2i:{categories:[{cat:"I2I",items:[]}]},
        inpaint:{categories:[
          {cat:"SKETCH",items:[{label:"Sketch to photo",prompt:"Transform this sketch into a hyper-realistic photographic scene. Interpret the lines as real-world objects with high-quality textures, cinematic lighting, and natural shadows. Maintain the original composition while adding depth, realistic materials, and 8k resolution details."}]},
          {cat:"COLLAGE",items:[{label:"Collage to scene",prompt:"Transform this image collage into a cohesive, fully realized and unified scene. Seamlessly blend all the disparate elements into a singular, logical style, strictly maintaining the exact spatial arrangement and relative composition of the original collage while logically generating the missing environment, shadows, and context to naturally connect all objects. Scene Description: [Specify the overall art style or level of realism, the new specific lighting conditions, background environment setting, and overall mood here]"}]},
          {cat:"INPAINT",items:[{label:"Edit masked area",prompt:"Edit the masked area: [DESCRIBE THE CHANGE — add, remove, replace, or modify the content]. Seamlessly blend with the surrounding scene, preserving the original lighting, shadows, depth of field, and photo grain."}]},
          {cat:"OUTPAINT",items:[{label:"Extend composition",prompt:"Extend the composition of this image. Replace all black or empty spaces with a logical continuation of the background and foreground. Ensure the transition is invisible and the new elements perfectly match the perspective and color palette of the original image. Scene description: [briefly describe what should appear in the expanded areas]"}]},
        ]},
        faceswap:{categories:[
          {cat:"FACE SWAP (make sure you have a Faceswap LoRA selected in Settings)",items:[{label:"Head swap",prompt:"Replace the head in image 1 with the head from image 2, adapting the facial features to match the artistic style, focus, and environmental lighting of the image 1."}]},
        ]},
      };

      // ── Get Inspired overlay — inside root (position:absolute like _promptOverlay) ──
      const _inspireOverlay=mk("div",{
        position:"absolute",inset:"0",zIndex:"260",background:C.bg0,
        display:"none",flexDirection:"column",
        padding:"12px",boxSizing:"border-box",gap:"0",
        opacity:"0",transition:"opacity 0.15s ease",overflow:"hidden",
      });
      // Manage mode gradient flash layer — sits behind content, above bg0
      const _inspireManageFlash=mk("div",{
        position:"absolute",inset:"0",zIndex:"0",pointerEvents:"none",
        background:"transparent",transition:"background .4s ease",
      });
      _inspireOverlay.appendChild(_inspireManageFlash);

      const _closeInspire=()=>{
        _inspireOverlay.style.opacity="0";
        setTimeout(()=>_inspireOverlay.style.display="none",160);
      };

      // Header (static)
      const _inspireHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",
        marginBottom:"10px",flexShrink:"0"});
      const _inspireTitleEl=mk("div",{fontSize:"10px",fontWeight:"700",color:C.muted,
        letterSpacing:".07em",textTransform:"uppercase"});
      tx(_inspireTitleEl,"✦ Discover");
      let _inspireShowFull=false;
      let _t2iTemplates=[]; // persistent across _buildInspireBody rebuilds
      let _t2iTemplatesLoaded=false;
      const _inspireShowFullBtn=mk("button",{
        background:"rgba(83,52,131,.15)",border:"1px solid rgba(83,52,131,.4)",borderRadius:"5px",
        padding:"3px 8px",fontSize:"8px",fontWeight:"700",letterSpacing:".05em",textTransform:"uppercase",
        cursor:"pointer",outline:"none",color:"rgba(180,160,220,.7)",transition:"all .15s",marginRight:"6px",flexShrink:"0",
      });
      tx(_inspireShowFullBtn,"Edit mode (E)");
      _inspireShowFullBtn.style.display="none";
      const _inspireShowFullUpdate=()=>{
        tx(_inspireShowFullBtn,_inspireShowFull?"Exit edit mode":"Edit mode (E)");
        _inspireShowFullBtn.style.background=_inspireShowFull?"rgba(180,140,255,.15)":"rgba(83,52,131,.15)";
        _inspireShowFullBtn.style.borderColor=_inspireShowFull?"rgba(220,180,255,.8)":"rgba(83,52,131,.4)";
        _inspireShowFullBtn.style.color=_inspireShowFull?"#f0e8ff":"rgba(180,160,220,.7)";
      };
      _inspireShowFullBtn.onmouseenter=()=>{
        _inspireShowFullBtn.style.background="linear-gradient(90deg,rgba(26,26,46,.8),rgba(15,52,96,.6),rgba(83,52,131,.6))";
        _inspireShowFullBtn.style.borderColor="rgba(180,140,255,.8)";
        _inspireShowFullBtn.style.color="#e0e0ff";
      };
      _inspireShowFullBtn.onmouseleave=()=>_inspireShowFullUpdate();
      _inspireShowFullBtn.onclick=async()=>{
        _inspireShowFull=!_inspireShowFull; _inspireShowFullUpdate();
        await _loadDiscoverPrompts(); _buildInspireBody();
        if(_inspireShowFull){
          _inspireManageFlash.style.transition="none";
          _inspireManageFlash.style.background="linear-gradient(135deg,rgba(26,20,60,.9) 0%,rgba(15,52,96,.7) 50%,rgba(83,52,131,.8) 100%)";
          void _inspireManageFlash.offsetWidth;
          _inspireManageFlash.style.transition="background .6s ease";
          _inspireManageFlash.style.background="linear-gradient(135deg,rgba(26,20,60,.45) 0%,rgba(15,52,96,.25) 50%,rgba(83,52,131,.35) 100%)";
        } else {
          _inspireManageFlash.style.transition="background .3s ease";
          _inspireManageFlash.style.background="transparent";
        }
      };
      const _inspireCloseBtn=mk("button",{background:"none",border:"none",cursor:"pointer",
        color:C.muted,fontSize:"14px",lineHeight:"1",padding:"2px 4px",outline:"none",
        display:"flex",alignItems:"center",borderRadius:"4px",transition:"color .15s"});
      tx(_inspireCloseBtn,"×");
      _inspireCloseBtn.onmouseenter=()=>_inspireCloseBtn.style.color="#fff";
      _inspireCloseBtn.onmouseleave=()=>_inspireCloseBtn.style.color=C.muted;
      _inspireCloseBtn.onclick=_closeInspire;
      const _inspireHdrRight=mk("div",{display:"flex",alignItems:"center"});
      _inspireHdrRight.append(_inspireShowFullBtn,_inspireCloseBtn);
      _inspireHdr.append(_inspireTitleEl,_inspireHdrRight);

      // Dynamic content area — rebuilt each time overlay opens
      const _inspireBody=mk("div",{display:"flex",flexDirection:"column",flex:"1",minHeight:"0",gap:"0"});

      const _usePrompt=(p)=>{
        S.prompt=p;
        if(_promptTARef) _promptTARef.value=p;
        if(typeof _promptOvTA!=="undefined") _promptOvTA.value=p;
        persist();_closeInspire();
      };

      const _buildInspireBody=()=>{
        _inspireBody.innerHTML="";
        const def=INSPIRE_BY_PILL[activePill]||INSPIRE_BY_PILL.t2i;

        // ── Categories mode (new format) ────────────────────────────────────
        if(def.categories){
          const hasShortLabels=def.categories.some(({items})=>items.some(it=>typeof it==="object"&&it.label!==it.prompt));
          // T2I: show toggle for templates (name ≠ prompt). EDIT also has short labels.
          _inspireShowFullBtn.style.display=(hasShortLabels||activePill==="t2i"||activePill==="i2i")?"":"none";
          const scroll=mk("div",{
            flex:"1",overflowY:"auto",display:"flex",flexDirection:"column",gap:"12px",
            scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`,
          });
          scroll.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});

          // ── T2I Templates ────────────────────────────────────────────────
          if(activePill==="t2i"){
            // Use persistent vars so rebuilds don't lose state
            const _templates=_t2iTemplates;
            let _editIdx=-1;
            let _tmplPillsRow=null;

            const _saveTmpl=async()=>{
              try{ await api.fetchApi("/flux_klein/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({t2i_templates:_templates})}); }
              catch(e){ console.warn("[FluxKlein] save templates:",e); }
            };

            // Form (create/edit) — framed, compact
            const tmplForm=mk("div",{
              display:"none",flexDirection:"column",gap:"6px",marginBottom:"6px",
              border:`1px solid rgba(240,255,65,.3)`,borderRadius:"16px",
              padding:"10px 12px",background:"rgba(240,255,65,.04)",boxSizing:"border-box",
            });
            const tmplFormTitle=mk("div",{fontSize:"8px",fontWeight:"700",color:LIME,letterSpacing:".08em",textTransform:"uppercase",marginBottom:"2px"});
            tx(tmplFormTitle,"New Template");
            const tmplNameInp=mk("input",{
              background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"999px",
              color:C.text,fontSize:"10px",padding:"6px 14px",outline:"none",
              transition:"border-color .15s",width:"100%",boxSizing:"border-box",
            },{placeholder:"Title…"});
            tmplNameInp.onfocus=()=>tmplNameInp.style.borderColor=LIME;
            tmplNameInp.onblur=()=>tmplNameInp.style.borderColor=C.border;
            const tmplPromptTA=mk("textarea",{
              background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"16px",
              color:C.text,fontSize:"10px",padding:"8px 14px",outline:"none",lineHeight:"1.5",
              resize:"vertical",minHeight:"60px",fontFamily:"inherit",
              transition:"border-color .15s",width:"100%",boxSizing:"border-box",
            },{placeholder:"Prompt…"});
            tmplPromptTA.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
            tmplPromptTA.onfocus=()=>tmplPromptTA.style.borderColor=LIME;
            tmplPromptTA.onblur=()=>tmplPromptTA.style.borderColor=C.border;
            const tmplFormBtns=mk("div",{display:"flex",gap:"6px",justifyContent:"flex-end"});
            const tmplCancelBtn=mk("button",{
              background:"transparent",border:`1px solid ${C.borderH}`,borderRadius:"999px",
              padding:"5px 16px",fontSize:"9px",fontWeight:"700",color:C.muted,
              cursor:"pointer",outline:"none",transition:"border-color .15s,color .15s",
            });
            tx(tmplCancelBtn,"Cancel");
            tmplCancelBtn.onmouseenter=()=>{tmplCancelBtn.style.borderColor=C.text;tmplCancelBtn.style.color=C.text;};
            tmplCancelBtn.onmouseleave=()=>{tmplCancelBtn.style.borderColor=C.borderH;tmplCancelBtn.style.color=C.muted;};
            const tmplSaveBtn=mk("button",{
              background:LIME,color:"#111",border:"none",borderRadius:"999px",
              padding:"5px 16px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",
              transition:"opacity .15s",
            });
            tx(tmplSaveBtn,"Save");
            tmplSaveBtn.onmouseenter=()=>tmplSaveBtn.style.opacity=".85";
            tmplSaveBtn.onmouseleave=()=>tmplSaveBtn.style.opacity="1";
            tmplFormBtns.append(tmplCancelBtn,tmplSaveBtn);
            tmplFormBtns.style.justifyContent="flex-end";
            tmplForm.append(tmplFormTitle,tmplNameInp,tmplPromptTA,tmplFormBtns);

            // Header: "MY TEMPLATES" only
            const tmplHdr=mk("div",{display:"flex",alignItems:"center",marginBottom:"5px"});
            const tmplHdrLbl=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",textTransform:"uppercase",color:C.muted});
            tx(tmplHdrLbl,"My Templates");
            tmplHdr.append(tmplHdrLbl);

            // Pills container + details area (same pattern as categories)
            _tmplPillsRow=mk("div",{display:"flex",flexWrap:"wrap",gap:"6px",minHeight:"16px"});
            const _tmplDetailsArea=mk("div",{display:"flex",flexDirection:"column",gap:"4px",marginTop:"2px"});
            let _tmplOpenIdx=-1;

            const _renderTmplPills=()=>{
              _tmplPillsRow.innerHTML=""; _tmplDetailsArea.innerHTML=""; _tmplOpenIdx=-1;
              _templates.forEach((t,idx)=>{
                // Pill
                const pill=mk("button",{padding:"7px 14px",borderRadius:"999px",cursor:"pointer",fontSize:"10px",fontWeight:"500",lineHeight:"1.5",border:`1px solid ${C.border}`,background:C.bg1,color:C.text,outline:"none",transition:"background .12s,border-color .12s,color .12s"});
                tx(pill,t.name);
                pill.onmouseenter=()=>{ if(_tmplOpenIdx!==idx){pill.style.background="rgba(240,255,65,.10)";pill.style.borderColor=LIME;pill.style.color=LIME;} };
                pill.onmouseleave=()=>{ if(_tmplOpenIdx!==idx){pill.style.background=C.bg1;pill.style.borderColor=C.border;pill.style.color=C.text;} };

                // Detail panel
                const detail=mk("div",{display:"none",flexDirection:"column",gap:"6px",border:`1px solid rgba(180,140,255,.4)`,borderRadius:"12px",padding:"10px 14px",background:"rgba(26,20,60,.55)",boxSizing:"border-box"});
                const detailTop=mk("div",{display:"flex",alignItems:"center",gap:"6px"});
                const detailLbl=mk("span",{fontSize:"9px",fontWeight:"700",color:"rgba(255,255,255,.85)",flex:"1"});tx(detailLbl,t.name);
                // Copy
                const dCopyBtn=mk("button",{background:"transparent",border:`1px solid rgba(100,220,120,.4)`,borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:"rgba(100,220,120,.8)",cursor:"pointer",outline:"none",transition:"all .15s",flexShrink:"0"});
                tx(dCopyBtn,"Copy");
                dCopyBtn.onmouseenter=()=>{dCopyBtn.style.background="rgba(100,220,120,.12)";dCopyBtn.style.borderColor="rgba(100,220,120,.8)";};
                dCopyBtn.onmouseleave=()=>{dCopyBtn.style.background="transparent";dCopyBtn.style.borderColor="rgba(100,220,120,.4)";};
                dCopyBtn.onclick=(e)=>{ e.stopPropagation(); navigator.clipboard.writeText(t.prompt).then(()=>{ tx(dCopyBtn,"✓ Copied"); setTimeout(()=>tx(dCopyBtn,"Copy"),1500); }).catch(()=>{}); };
                // Edit
                const dEditBtn=mk("button",{background:"transparent",border:`1px solid rgba(160,140,220,.4)`,borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:"rgba(160,140,220,.8)",cursor:"pointer",outline:"none",transition:"all .15s",flexShrink:"0"});
                tx(dEditBtn,"Edit");
                dEditBtn.onmouseenter=()=>{dEditBtn.style.background="rgba(160,140,220,.1)";dEditBtn.style.borderColor="rgba(160,140,220,.8)";dEditBtn.style.color="#e0d0ff";};
                dEditBtn.onmouseleave=()=>{dEditBtn.style.background="transparent";dEditBtn.style.borderColor="rgba(160,140,220,.4)";dEditBtn.style.color="rgba(160,140,220,.8)";};
                // Delete
                const dDelWrap=mk("div",{position:"relative",display:"inline-flex",flexShrink:"0"});
                const dDelBtn=mk("button",{background:"transparent",border:"1px solid rgba(220,80,80,.4)",borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:"rgba(220,80,80,.8)",cursor:"pointer",outline:"none",transition:"all .15s"});
                tx(dDelBtn,"Delete");
                dDelBtn.onmouseenter=()=>{dDelBtn.style.background="rgba(220,80,80,.1)";dDelBtn.style.borderColor="rgba(220,80,80,.8)";};
                dDelBtn.onmouseleave=()=>{dDelBtn.style.background="transparent";dDelBtn.style.borderColor="rgba(220,80,80,.4)";};
                const dDelPop=mk("div",{display:"none",position:"absolute",right:"0",top:"calc(100% + 4px)",background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"7px",padding:"6px 8px",zIndex:"10",whiteSpace:"nowrap",boxShadow:"0 4px 12px rgba(0,0,0,.5)",flexDirection:"column",gap:"5px",alignItems:"center"});
                const dDelQ=mk("div",{fontSize:"9px",color:C.text,fontWeight:"600"});tx(dDelQ,"Sure?");
                const dDelBtns=mk("div",{display:"flex",gap:"4px"});
                const dDelYes=mk("button",{background:"rgba(160,25,25,.7)",border:"1px solid rgba(255,80,80,.3)",borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:"rgba(255,180,180,.9)",cursor:"pointer",outline:"none"});tx(dDelYes,"Yes");
                const dDelNo=mk("button",{background:C.bg3,border:`1px solid ${C.borderH}`,borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none"});tx(dDelNo,"Keep");
                dDelBtns.append(dDelYes,dDelNo); dDelPop.append(dDelQ,dDelBtns); dDelWrap.append(dDelBtn,dDelPop);
                dDelBtn.onclick=(e)=>{ e.stopPropagation(); dDelPop.style.display=dDelPop.style.display==="flex"?"none":"flex"; };
                dDelYes.onclick=async(e)=>{ e.stopPropagation(); dDelPop.style.display="none"; _templates.splice(idx,1); await _saveTmpl(); _renderTmplPills(); };
                dDelNo.onclick=(e)=>{ e.stopPropagation(); dDelPop.style.display="none"; };
                const dUseBtn=mk("button",{background:LIME,color:"#111",border:"none",borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",cursor:"pointer",outline:"none",transition:"opacity .15s",flexShrink:"0"});
                tx(dUseBtn,"Use"); dUseBtn.onmouseenter=()=>dUseBtn.style.opacity=".85"; dUseBtn.onmouseleave=()=>dUseBtn.style.opacity="1";
                dUseBtn.onclick=(e)=>{ e.stopPropagation(); _usePrompt(t.prompt); };
                detailTop.append(detailLbl,dUseBtn,dCopyBtn,dEditBtn,dDelWrap);
                const detailPromptTxt=mk("div",{fontSize:"9px",color:"rgba(200,185,230,.7)",lineHeight:"1.55",fontStyle:"italic"});tx(detailPromptTxt,t.prompt);
                // Inline edit form
                const dEditForm=mk("div",{display:"none",flexDirection:"column",gap:"6px",borderTop:`1px solid rgba(180,140,255,.2)`,paddingTop:"8px"});
                const dETitleInp=mk("input",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"999px",color:C.text,fontSize:"10px",padding:"6px 14px",outline:"none",transition:"border-color .15s",width:"100%",boxSizing:"border-box"},{placeholder:"Title…"});
                dETitleInp.onfocus=()=>dETitleInp.style.borderColor=LIME; dETitleInp.onblur=()=>dETitleInp.style.borderColor=C.border;
                const dEPromptTA=mk("textarea",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"16px",color:C.text,fontSize:"10px",padding:"8px 14px",outline:"none",lineHeight:"1.5",resize:"vertical",minHeight:"60px",fontFamily:"inherit",transition:"border-color .15s",width:"100%",boxSizing:"border-box"},{placeholder:"Prompt…"});
                dEPromptTA.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
                dEPromptTA.onfocus=()=>dEPromptTA.style.borderColor=LIME; dEPromptTA.onblur=()=>dEPromptTA.style.borderColor=C.border;
                const dECancelBtn=mk("button",{background:"transparent",border:`1px solid ${C.borderH}`,borderRadius:"999px",padding:"5px 16px",fontSize:"9px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none",transition:"all .15s"});
                tx(dECancelBtn,"Cancel"); dECancelBtn.onmouseenter=()=>{dECancelBtn.style.borderColor=C.text;dECancelBtn.style.color=C.text;}; dECancelBtn.onmouseleave=()=>{dECancelBtn.style.borderColor=C.borderH;dECancelBtn.style.color=C.muted;};
                const dEUpdateBtn=mk("button",{background:LIME,color:"#111",border:"none",borderRadius:"999px",padding:"5px 16px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",transition:"opacity .15s"});
                tx(dEUpdateBtn,"Update"); dEUpdateBtn.onmouseenter=()=>dEUpdateBtn.style.opacity=".85"; dEUpdateBtn.onmouseleave=()=>dEUpdateBtn.style.opacity="1";
                const dEBtmRow=mk("div",{display:"flex",alignItems:"center",gap:"6px"});
                dEBtmRow.append(mk("div",{flex:"1"}),dECancelBtn,dEUpdateBtn);
                dEditForm.append(dETitleInp,dEPromptTA,dEBtmRow);
                const _tmplSetEditMode=(on)=>{ dUseBtn.style.display=on?"none":""; dCopyBtn.style.display=on?"none":""; dEditBtn.style.display=on?"none":""; dDelWrap.style.display=on?"none":"inline-flex"; };
                dEditBtn.onclick=(e)=>{ e.stopPropagation(); const opening=dEditForm.style.display!=="flex"; dETitleInp.value=t.name; dEPromptTA.value=t.prompt; dEditForm.style.display=opening?"flex":"none"; _tmplSetEditMode(opening); if(opening) setTimeout(()=>dETitleInp.focus(),30); };
                dECancelBtn.onclick=()=>{ dEditForm.style.display="none"; _tmplSetEditMode(false); };
                dEUpdateBtn.onclick=async()=>{ const n=dETitleInp.value.trim(),p=dEPromptTA.value.trim(); if(!n||!p) return; _templates[idx]={name:n,prompt:p}; await _saveTmpl(); _renderTmplPills(); _tmplOpenIdx=idx; const det=_tmplDetailsArea.children[idx]; if(det){det.style.display="flex";det.dataset.open="1";} const pil=_tmplPillsRow.querySelectorAll("button:not([data-addpill])")[idx]; if(pil){pil.style.background="rgba(180,140,255,.15)";pil.style.borderColor="rgba(180,140,255,.6)";pil.style.color="#e0d0ff";} };
                detail.append(detailTop,detailPromptTxt,dEditForm);
                _tmplDetailsArea.appendChild(detail);

                const _closeTmplDetail=()=>{ detail.style.display="none"; _tmplOpenIdx=-1; pill.style.background=C.bg1;pill.style.borderColor=C.border;pill.style.color=C.text; };
                pill.onclick=()=>{
                  if(!_inspireShowFull){ _usePrompt(t.prompt); return; }
                  if(_tmplOpenIdx===idx){ _closeTmplDetail(); return; }
                  _tmplDetailsArea.querySelectorAll("div[data-open]").forEach(d=>{d.style.display="none";delete d.dataset.open;});
                  _tmplPillsRow.querySelectorAll("button").forEach(p2=>{p2.style.background=C.bg1;p2.style.borderColor=C.border;p2.style.color=C.text;});
                  _tmplOpenIdx=idx; detail.style.display="flex"; detail.dataset.open="1";
                  pill.style.background="rgba(180,140,255,.15)";pill.style.borderColor="rgba(180,140,255,.6)";pill.style.color="#e0d0ff";
                };
                _tmplPillsRow.appendChild(pill);
              });
              // "+ Add" pill always at the end
              const tmplAddPill=mk("button",{
                padding:"5px 12px",borderRadius:"999px",cursor:"pointer",
                fontSize:"10px",fontWeight:"600",lineHeight:"1.5",
                border:`1px dashed rgba(240,255,65,.4)`,
                background:"rgba(240,255,65,.05)",color:"rgba(240,255,65,.6)",
                outline:"none",transition:"all .15s",flexShrink:"0",
              });
              tx(tmplAddPill,"+ Add"); tmplAddPill.dataset.addpill="1";
              tmplAddPill.onmouseenter=()=>{ tmplAddPill.style.borderColor=LIME;tmplAddPill.style.background="rgba(240,255,65,.12)";tmplAddPill.style.color=LIME; };
              tmplAddPill.onmouseleave=()=>{ tmplAddPill.style.borderColor="rgba(240,255,65,.4)";tmplAddPill.style.background="rgba(240,255,65,.05)";tmplAddPill.style.color="rgba(240,255,65,.6)"; };
              tmplAddPill.onclick=()=>{
                _editIdx=-1; tmplNameInp.value=""; tmplPromptTA.value=S.prompt||"";
                tx(tmplFormTitle,"New Template"); tx(tmplSaveBtn,"Save");
                tmplForm.style.display=tmplForm.style.display==="flex"?"none":"flex";
                if(tmplForm.style.display==="flex") setTimeout(()=>tmplNameInp.focus(),30);
              };
              _tmplPillsRow.appendChild(tmplAddPill);
            };


            tmplCancelBtn.onclick=()=>{ tmplForm.style.display="none"; };
            tmplSaveBtn.onclick=async()=>{
              const name=tmplNameInp.value.trim(), prompt=tmplPromptTA.value.trim();
              if(!name||!prompt) return;
              if(_editIdx>=0) _templates[_editIdx]={name,prompt};
              else _templates.push({name,prompt});
              await _saveTmpl();
              tmplForm.style.display="none";
              _editIdx=-1; _renderTmplPills();
            };

            // Load & render — only fetch from server once
            if(!_t2iTemplatesLoaded){
              _t2iTemplatesLoaded=true;
              (async()=>{
                try{ const r=await api.fetchApi("/flux_klein/config"); const d=await r.json(); _t2iTemplates.length=0; (d.t2i_templates||[]).forEach(t=>_t2iTemplates.push(t)); }
                catch(e){}
                _renderTmplPills();
              })();
            } else {
              _renderTmplPills();
            }

            const tmplSection=mk("div",{});
            tmplSection.append(tmplHdr,tmplForm,_tmplPillsRow,_tmplDetailsArea);
            scroll.appendChild(tmplSection);
          }

          let _hasDual=false;
          def.categories.forEach(({cat,items})=>{
            // Category label — if cat contains "(note)", render note part smaller without uppercase
            const catLbl=mk("div",{
              display:"flex",alignItems:"baseline",gap:"5px",flexWrap:"wrap",
              marginBottom:"5px",
            });
            const parenIdx=cat.indexOf("(");
            if(parenIdx>0){
              const mainPart=mk("span",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",textTransform:"uppercase",color:C.muted});
              tx(mainPart,cat.slice(0,parenIdx).trim());
              const notePart=mk("span",{fontSize:"8px",fontWeight:"400",color:C.muted,opacity:".7",textTransform:"none",letterSpacing:".01em"});
              tx(notePart,cat.slice(parenIdx));
              catLbl.append(mainPart,notePart);
            } else {
              catLbl.style.fontSize="9px";catLbl.style.fontWeight="700";
              catLbl.style.letterSpacing=".1em";catLbl.style.textTransform="uppercase";
              catLbl.style.color=C.muted;
              tx(catLbl,cat);
            }
            // Pills always render as pills; in preview mode click shows inline detail instead of inserting
            const pillsRow=mk("div",{display:"flex",flexWrap:"wrap",gap:"6px"});
            // Container for detail panels (below pills row)
            const detailsArea=mk("div",{display:"flex",flexDirection:"column",gap:"4px",marginTop:"2px"});
            let _openDetailIdx=-1; // which pill's detail is currently open

            items.forEach(({label,prompt,dual},itemIdx)=>{
              if(dual) _hasDual=true;
              const pill=mk("button",{
                padding:dual?"5px 10px 5px 8px":"7px 14px",
                borderRadius:"999px",cursor:"pointer",
                fontSize:"10px",fontWeight:"500",lineHeight:"1.5",
                border:`1px solid ${dual?"rgba(100,160,255,.35)":C.border}`,
                background:dual?"rgba(80,120,220,.08)":C.bg1,
                color:dual?"rgba(140,190,255,.9)":C.text,
                outline:"none",textAlign:"left",
                display:"flex",alignItems:"center",gap:"6px",
                transition:"background .12s,border-color .12s,color .12s",
              });
              if(dual){
                const badge=mk("span",{fontSize:"7px",fontWeight:"800",letterSpacing:".06em",background:"rgba(100,160,255,.2)",color:"rgba(140,190,255,.8)",border:"1px solid rgba(100,160,255,.3)",borderRadius:"4px",padding:"1px 4px",flexShrink:"0",lineHeight:"1.6"});
                tx(badge,"2 imgs"); const lbl=mk("span");tx(lbl,label); pill.append(badge,lbl);
                pill.onmouseenter=()=>{ pill.style.background="rgba(80,140,255,.18)";pill.style.borderColor="rgba(100,160,255,.7)";pill.style.color="#9bbfff"; };
                pill.onmouseleave=()=>{ if(_openDetailIdx!==itemIdx){pill.style.background="rgba(80,120,220,.08)";pill.style.borderColor="rgba(100,160,255,.35)";pill.style.color="rgba(140,190,255,.9)";} };
              } else {
                tx(pill,label);
                pill.onmouseenter=()=>{ if(_openDetailIdx!==itemIdx){pill.style.background="rgba(240,255,65,.10)";pill.style.borderColor=LIME;pill.style.color=LIME;} };
                pill.onmouseleave=()=>{ if(_openDetailIdx!==itemIdx){pill.style.background=C.bg1;pill.style.borderColor=C.border;pill.style.color=C.text;} };
              }

              // Detail panel (shown in preview mode)
              const detail=mk("div",{
                display:"none",flexDirection:"column",gap:"6px",
                border:`1px solid rgba(180,140,255,.4)`,borderRadius:"12px",
                padding:"10px 14px",background:"rgba(26,20,60,.55)",boxSizing:"border-box",
              });
              const detailTop=mk("div",{display:"flex",alignItems:"center",gap:"6px"});
              const detailLbl=mk("span",{fontSize:"9px",fontWeight:"700",color:"rgba(255,255,255,.85)",flex:"1"});
              tx(detailLbl,label);
              // Copy button
              const detailCopyBtn=mk("button",{background:"transparent",border:`1px solid rgba(100,220,120,.4)`,borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:"rgba(100,220,120,.8)",cursor:"pointer",outline:"none",transition:"all .15s",flexShrink:"0"});
              tx(detailCopyBtn,"Copy");
              detailCopyBtn.onmouseenter=()=>{detailCopyBtn.style.background="rgba(100,220,120,.12)";detailCopyBtn.style.borderColor="rgba(100,220,120,.8)";};
              detailCopyBtn.onmouseleave=()=>{detailCopyBtn.style.background="transparent";detailCopyBtn.style.borderColor="rgba(100,220,120,.4)";};
              detailCopyBtn.onclick=(e)=>{ e.stopPropagation(); navigator.clipboard.writeText(prompt).then(()=>{ tx(detailCopyBtn,"✓ Copied"); setTimeout(()=>tx(detailCopyBtn,"Copy"),1500); }).catch(()=>{}); };
              // Edit button
              const detailEditBtn=mk("button",{background:"transparent",border:`1px solid rgba(160,140,220,.4)`,borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:"rgba(160,140,220,.8)",cursor:"pointer",outline:"none",transition:"all .15s",flexShrink:"0"});
              tx(detailEditBtn,"Edit");
              detailEditBtn.onmouseenter=()=>{detailEditBtn.style.background="rgba(160,140,220,.1)";detailEditBtn.style.borderColor="rgba(160,140,220,.8)";detailEditBtn.style.color="#e0d0ff";};
              detailEditBtn.onmouseleave=()=>{detailEditBtn.style.background="transparent";detailEditBtn.style.borderColor="rgba(160,140,220,.4)";detailEditBtn.style.color="rgba(160,140,220,.8)";};
              // Delete button with confirm popover
              const detailDelWrap=mk("div",{position:"relative",display:"inline-flex",flexShrink:"0"});
              const detailDelBtn=mk("button",{background:"transparent",border:"1px solid rgba(220,80,80,.4)",borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:"rgba(220,80,80,.8)",cursor:"pointer",outline:"none",transition:"all .15s"});
              tx(detailDelBtn,"Delete");
              detailDelBtn.onmouseenter=()=>{detailDelBtn.style.background="rgba(220,80,80,.1)";detailDelBtn.style.borderColor="rgba(220,80,80,.8)";};
              detailDelBtn.onmouseleave=()=>{detailDelBtn.style.background="transparent";detailDelBtn.style.borderColor="rgba(220,80,80,.4)";};
              const detailDelPop=mk("div",{display:"none",position:"absolute",right:"0",top:"calc(100% + 4px)",background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"7px",padding:"6px 8px",zIndex:"10",whiteSpace:"nowrap",boxShadow:"0 4px 12px rgba(0,0,0,.5)",flexDirection:"column",gap:"5px",alignItems:"center"});
              const detailDelQ=mk("div",{fontSize:"9px",color:C.text,fontWeight:"600"});tx(detailDelQ,"Sure?");
              const detailDelBtns=mk("div",{display:"flex",gap:"4px"});
              const detailDelYes=mk("button",{background:"rgba(160,25,25,.7)",border:"1px solid rgba(255,80,80,.3)",borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:"rgba(255,180,180,.9)",cursor:"pointer",outline:"none"});tx(detailDelYes,"Yes");
              const detailDelNo=mk("button",{background:C.bg3,border:`1px solid ${C.borderH}`,borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none"});tx(detailDelNo,"Keep");
              detailDelBtns.append(detailDelYes,detailDelNo); detailDelPop.append(detailDelQ,detailDelBtns); detailDelWrap.append(detailDelBtn,detailDelPop);
              detailDelBtn.onclick=(e)=>{ e.stopPropagation(); detailDelPop.style.display=detailDelPop.style.display==="flex"?"none":"flex"; };
              detailDelYes.onclick=async(e)=>{ e.stopPropagation(); detailDelPop.style.display="none"; items.splice(itemIdx,1); await _saveDiscoverPrompts(); _inspirePromptsLoaded=false; _buildInspireBody(); };
              detailDelNo.onclick=(e)=>{ e.stopPropagation(); detailDelPop.style.display="none"; };
              const detailUseBtn=mk("button",{background:LIME,color:"#111",border:"none",borderRadius:"999px",padding:"2px 10px",fontSize:"8px",fontWeight:"700",cursor:"pointer",outline:"none",transition:"opacity .15s",flexShrink:"0"});
              tx(detailUseBtn,"Use"); detailUseBtn.onmouseenter=()=>detailUseBtn.style.opacity=".85"; detailUseBtn.onmouseleave=()=>detailUseBtn.style.opacity="1";
              detailUseBtn.onclick=(e)=>{ e.stopPropagation(); _usePrompt(prompt); };
              detailTop.append(detailLbl,detailUseBtn,detailCopyBtn,detailEditBtn,detailDelWrap);
              const detailPromptTxt=mk("div",{fontSize:"9px",color:"rgba(200,185,230,.7)",lineHeight:"1.55",fontStyle:"italic"});
              tx(detailPromptTxt,prompt);
              // Edit form inside detail
              const editForm=mk("div",{display:"none",flexDirection:"column",gap:"6px",borderTop:`1px solid rgba(180,140,255,.2)`,paddingTop:"8px"});
              const editTitleInp=mk("input",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"999px",color:C.text,fontSize:"10px",padding:"6px 14px",outline:"none",transition:"border-color .15s",width:"100%",boxSizing:"border-box"},{placeholder:"Title…"});
              editTitleInp.onfocus=()=>editTitleInp.style.borderColor=LIME; editTitleInp.onblur=()=>editTitleInp.style.borderColor=C.border;
              const editPromptTA=mk("textarea",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"16px",color:C.text,fontSize:"10px",padding:"8px 14px",outline:"none",lineHeight:"1.5",resize:"vertical",minHeight:"60px",fontFamily:"inherit",transition:"border-color .15s",width:"100%",boxSizing:"border-box"},{placeholder:"Prompt…"});
              editPromptTA.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
              editPromptTA.onfocus=()=>editPromptTA.style.borderColor=LIME; editPromptTA.onblur=()=>editPromptTA.style.borderColor=C.border;
              const editBtns=mk("div",{display:"flex",gap:"6px",justifyContent:"flex-end"});
              const editCancelBtn=mk("button",{background:"transparent",border:`1px solid ${C.borderH}`,borderRadius:"999px",padding:"5px 16px",fontSize:"9px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none",transition:"all .15s"});
              tx(editCancelBtn,"Cancel"); editCancelBtn.onmouseenter=()=>{editCancelBtn.style.borderColor=C.text;editCancelBtn.style.color=C.text;}; editCancelBtn.onmouseleave=()=>{editCancelBtn.style.borderColor=C.borderH;editCancelBtn.style.color=C.muted;};
              const editUpdateBtn=mk("button",{background:LIME,color:"#111",border:"none",borderRadius:"999px",padding:"5px 16px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",transition:"opacity .15s"});
              tx(editUpdateBtn,"Update"); editUpdateBtn.onmouseenter=()=>editUpdateBtn.style.opacity=".85"; editUpdateBtn.onmouseleave=()=>editUpdateBtn.style.opacity="1";
              let _editDualVal=false;
              const editDualChk={get checked(){return _editDualVal;},set checked(v){_editDualVal=v;_editDualRefresh();}};
              const editDualToggle=mk("button",{background:"transparent",border:`1px solid rgba(160,140,220,.35)`,borderRadius:"999px",padding:"3px 10px",fontSize:"8px",fontWeight:"600",color:"rgba(160,140,220,.6)",cursor:"pointer",outline:"none",transition:"all .15s",textAlign:"left"});
              tx(editDualToggle,"Requires 2 images");
              const _editDualRefresh=()=>{
                if(_editDualVal){editDualToggle.style.background="rgba(100,160,255,.15)";editDualToggle.style.borderColor="rgba(100,160,255,.7)";editDualToggle.style.color="#9bbfff";}
                else{editDualToggle.style.background="transparent";editDualToggle.style.borderColor="rgba(160,140,220,.35)";editDualToggle.style.color="rgba(160,140,220,.6)";}
              };
              editDualToggle.onclick=(e)=>{e.stopPropagation();_editDualVal=!_editDualVal;_editDualRefresh();};
              editBtns.append(editCancelBtn,editUpdateBtn);
              const editBottomRow=mk("div",{display:"flex",alignItems:"center",gap:"6px"});
              if(activePill==="i2i"||activePill==="inpaint") editDualToggle.style.display="none";
              editBottomRow.append(editDualToggle,mk("div",{flex:"1"}),editBtns);
              editForm.append(editTitleInp,editPromptTA,editBottomRow);
              const _setDetailEditMode=(on)=>{ detailUseBtn.style.display=on?"none":""; detailCopyBtn.style.display=on?"none":""; detailEditBtn.style.display=on?"none":""; detailDelWrap.style.display=on?"none":"inline-flex"; };
              detailEditBtn.onclick=(e)=>{ e.stopPropagation(); const opening=editForm.style.display!=="flex"; editTitleInp.value=label; editPromptTA.value=prompt; editDualChk.checked=!!dual; editForm.style.display=opening?"flex":"none"; _setDetailEditMode(opening); if(opening) setTimeout(()=>editTitleInp.focus(),30); };
              editCancelBtn.onclick=()=>{ editForm.style.display="none"; _setDetailEditMode(false); };
              editUpdateBtn.onclick=async()=>{
                const t=editTitleInp.value.trim(),p=editPromptTA.value.trim(); if(!t||!p) return;
                const entry={label:t,prompt:p}; if(editDualChk.checked) entry.dual=true;
                items[itemIdx]=entry; await _saveDiscoverPrompts(); _inspirePromptsLoaded=false; _buildInspireBody();
              };
              detail.append(detailTop,detailPromptTxt,editForm);
              detailsArea.appendChild(detail);

              const _closeDetail=()=>{
                detail.style.display="none"; _openDetailIdx=-1;
                pill.style.background=dual?"rgba(80,120,220,.08)":C.bg1;
                pill.style.borderColor=dual?"rgba(100,160,255,.35)":C.border;
                pill.style.color=dual?"rgba(140,190,255,.9)":C.text;
              };
              pill.onclick=()=>{
                if(!_inspireShowFull){ _usePrompt(prompt); return; }
                if(_openDetailIdx===itemIdx){ _closeDetail(); return; }
                // Close previously open detail
                detailsArea.querySelectorAll("div[data-detail-open]").forEach(d=>{ d.style.display="none"; delete d.dataset.detailOpen; });
                // Reset all pills in this category
                pillsRow.querySelectorAll("button").forEach(p2=>{ p2.style.background=C.bg1;p2.style.borderColor=C.border;p2.style.color=C.text; });
                _openDetailIdx=itemIdx;
                detail.style.display="flex"; detail.dataset.detailOpen="1";
                pill.style.background="rgba(180,140,255,.15)"; pill.style.borderColor="rgba(180,140,255,.6)"; pill.style.color="#e0d0ff";
              };
              pillsRow.appendChild(pill);
            });
            // ── + Add pill at end of each category ──────────────────────
            const addPill=mk("button",{
              padding:"5px 12px",borderRadius:"999px",cursor:"pointer",
              fontSize:"10px",fontWeight:"600",lineHeight:"1.5",
              border:`1px dashed rgba(240,255,65,.4)`,
              background:"rgba(240,255,65,.05)",color:"rgba(240,255,65,.6)",
              outline:"none",transition:"all .15s",flexShrink:"0",
            });
            tx(addPill,"+ Add");
            addPill.onmouseenter=()=>{ addPill.style.borderColor=LIME;addPill.style.background="rgba(240,255,65,.12)";addPill.style.color=LIME; };
            addPill.onmouseleave=()=>{ addPill.style.borderColor="rgba(240,255,65,.4)";addPill.style.background="rgba(240,255,65,.05)";addPill.style.color="rgba(240,255,65,.6)"; };

            // Inline form (hidden, appears below pills row)
            const addForm=mk("div",{
              display:"none",flexDirection:"column",gap:"6px",marginTop:"4px",
              border:`1px solid rgba(240,255,65,.3)`,borderRadius:"16px",
              padding:"10px 12px",background:"rgba(240,255,65,.04)",boxSizing:"border-box",
            });
            const addFormTitle=mk("div",{fontSize:"8px",fontWeight:"700",color:LIME,letterSpacing:".08em",textTransform:"uppercase",marginBottom:"2px"});
            tx(addFormTitle,"Add to "+cat.split("(")[0].trim());
            const addTitleInp=mk("input",{
              background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"999px",
              color:C.text,fontSize:"10px",padding:"6px 14px",outline:"none",
              transition:"border-color .15s",width:"100%",boxSizing:"border-box",
            },{placeholder:"Title…"});
            addTitleInp.onfocus=()=>addTitleInp.style.borderColor=LIME;
            addTitleInp.onblur=()=>addTitleInp.style.borderColor=C.border;
            const addPromptTA=mk("textarea",{
              background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"16px",
              color:C.text,fontSize:"10px",padding:"8px 14px",outline:"none",lineHeight:"1.5",
              resize:"vertical",minHeight:"60px",fontFamily:"inherit",
              transition:"border-color .15s",width:"100%",boxSizing:"border-box",
            },{placeholder:"Prompt…"});
            addPromptTA.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
            addPromptTA.onfocus=()=>addPromptTA.style.borderColor=LIME;
            addPromptTA.onblur=()=>addPromptTA.style.borderColor=C.border;
            const addFormBtns=mk("div",{display:"flex",gap:"6px",justifyContent:"flex-end"});
            const addCancelBtn=mk("button",{background:"transparent",border:`1px solid ${C.borderH}`,borderRadius:"999px",padding:"5px 16px",fontSize:"9px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none",transition:"all .15s"});
            tx(addCancelBtn,"Cancel");
            addCancelBtn.onmouseenter=()=>{addCancelBtn.style.borderColor=C.text;addCancelBtn.style.color=C.text;};
            addCancelBtn.onmouseleave=()=>{addCancelBtn.style.borderColor=C.borderH;addCancelBtn.style.color=C.muted;};
            const addSaveBtn=mk("button",{background:LIME,color:"#111",border:"none",borderRadius:"999px",padding:"5px 16px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",transition:"opacity .15s"});
            tx(addSaveBtn,"Save");
            addSaveBtn.onmouseenter=()=>addSaveBtn.style.opacity=".85";
            addSaveBtn.onmouseleave=()=>addSaveBtn.style.opacity="1";
            // Dual checkbox
            let _addDualVal=false;
            const addDualChk={get checked(){return _addDualVal;},set checked(v){_addDualVal=v;_addDualRefresh();}};
            const addDualToggle=mk("button",{background:"transparent",border:`1px solid rgba(160,140,220,.35)`,borderRadius:"999px",padding:"3px 10px",fontSize:"8px",fontWeight:"600",color:"rgba(160,140,220,.6)",cursor:"pointer",outline:"none",transition:"all .15s"});
            tx(addDualToggle,"Requires 2 images");
            const _addDualRefresh=()=>{
              if(_addDualVal){addDualToggle.style.background="rgba(100,160,255,.15)";addDualToggle.style.borderColor="rgba(100,160,255,.7)";addDualToggle.style.color="#9bbfff";}
              else{addDualToggle.style.background="transparent";addDualToggle.style.borderColor="rgba(160,140,220,.35)";addDualToggle.style.color="rgba(160,140,220,.6)";}
            };
            addDualToggle.onclick=(e)=>{e.stopPropagation();_addDualVal=!_addDualVal;_addDualRefresh();};
            addFormBtns.append(addCancelBtn,addSaveBtn);
            const addBottomRow=mk("div",{display:"flex",alignItems:"center",gap:"6px"});
            if(activePill==="i2i"||activePill==="inpaint") addDualToggle.style.display="none";
            addBottomRow.append(addDualToggle,mk("div",{flex:"1"}),addFormBtns);
            addForm.append(addFormTitle,addTitleInp,addPromptTA,addBottomRow);

            addPill.onclick=()=>{
              addTitleInp.value=""; addPromptTA.value=""; _addDualVal=false; _addDualRefresh();
              addForm.style.display=addForm.style.display==="flex"?"none":"flex";
              if(addForm.style.display==="flex") setTimeout(()=>addTitleInp.focus(),30);
            };
            addCancelBtn.onclick=()=>{ addForm.style.display="none"; };
            addSaveBtn.onclick=async()=>{
              const title=addTitleInp.value.trim(), prompt=addPromptTA.value.trim();
              if(!title||!prompt) return;
              const entry={label:title,prompt};
              if(addDualChk.checked) entry.dual=true;
              items.push(entry);
              await _saveDiscoverPrompts();
              _inspirePromptsLoaded=false;
              addForm.style.display="none";
              _buildInspireBody();
            };

            pillsRow.append(addPill);
            const section=mk("div",{});
            section.append(catLbl,pillsRow,detailsArea,addForm);
            scroll.appendChild(section);
          });
          _inspireBody.appendChild(scroll);
          // Legend for dual-input pills
          if(_hasDual){
            const legend=mk("div",{
              display:"flex",alignItems:"center",gap:"5px",
              marginTop:"8px",flexShrink:"0",
            });
            const badge=mk("span",{
              fontSize:"7px",fontWeight:"800",letterSpacing:".06em",
              background:"rgba(100,160,255,.2)",color:"rgba(140,190,255,.8)",
              border:"1px solid rgba(100,160,255,.3)",borderRadius:"4px",
              padding:"1px 4px",lineHeight:"1.6",flexShrink:"0",
            });
            tx(badge,"2 imgs");
            const legendTxt=mk("span",{fontSize:"9px",color:C.muted,lineHeight:"1.5"});
            tx(legendTxt,"requires both Image 1 and Image 2 to be loaded");
            legend.append(badge,legendTxt);
            _inspireBody.appendChild(legend);
          }
          // Optional note — shown below the prompt pills
          if(def.note){
            const noteLbl=mk("div",{
              fontSize:"9px",color:"#f0a040",lineHeight:"1.5",marginTop:"8px",flexShrink:"0",
            });
            tx(noteLbl,"⚠ "+def.note);
            _inspireBody.appendChild(noteLbl);
          }
          return;
        }

        // ── Tabs mode (original format) ─────────────────────────────────────
        _inspireShowFullBtn.style.display="";
        const tabs=def.tabs||[];
        const tabRow=mk("div",{display:"flex",gap:"4px",marginBottom:"8px",flexShrink:"0"});
        const showTabs=tabs.length>1;
        tabRow.style.display=showTabs?"flex":"none";

        const pages=tabs.map(({items},i)=>{
          const page=mk("div",{
            flex:"1",overflowY:"auto",display:i===0?"flex":"none",
            flexDirection:"column",gap:"4px",
            scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`,
          });
          page.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
          if(!items||items.length===0){
            const empty=mk("div",{fontSize:"11px",color:C.muted,padding:"20px 0",textAlign:"center"});
            tx(empty,"No suggestions for this mode yet.");
            page.appendChild(empty);
          } else {
            items.forEach(prompt=>{
              const row=mk("div",{
                padding:"8px 10px",borderRadius:"7px",cursor:"pointer",
                fontSize:"10px",lineHeight:"1.55",
                border:`1px solid ${C.border}`,background:C.bg1,
                transition:"background .12s,border-color .12s,color .12s",
                boxSizing:"border-box",
              });
              if(_inspireShowFull){
                row.style.color=C.text;
                tx(row,prompt);
                let _copied=false;
                row.onmouseenter=()=>{ row.style.background=C.bg3;row.style.borderColor="rgba(100,160,255,.6)";row.style.color="#9bbfff"; };
                row.onmouseleave=()=>{ row.style.background=C.bg1;row.style.borderColor=C.border;row.style.color=C.text; if(_copied){_copied=false;} };
                row.onclick=()=>{
                  navigator.clipboard.writeText(prompt).then(()=>{
                    row.style.borderColor="rgba(100,220,120,.7)";row.style.color="#7ddd9a";
                    setTimeout(()=>{ row.style.borderColor=C.border;row.style.color=C.text; },1200);
                  }).catch(()=>{});
                };
              } else {
                row.style.color=C.text;
                // In normal mode items are plain strings — show truncated label
                const short=prompt.length>72?prompt.slice(0,70).trimEnd()+"…":prompt;
                tx(row,short);
                row.title=prompt;
                row.onmouseenter=()=>{ row.style.background=C.bg3;row.style.borderColor=LIME;row.style.color="#fff"; };
                row.onmouseleave=()=>{ row.style.background=C.bg1;row.style.borderColor=C.border;row.style.color=C.text; };
                row.onclick=()=>_usePrompt(prompt);
              }
              page.appendChild(row);
            });
          }
          return page;
        });
        if(showTabs){
          tabs.forEach((_tab,i)=>{
            const cat=_tab.cat;
            const tab=mk("button",{
              border:`1px solid ${i===0?LIME:C.border}`,cursor:"pointer",
              padding:"3px 10px",fontSize:"9px",fontWeight:"700",letterSpacing:".04em",
              borderRadius:"5px",outline:"none",transition:"all .15s",
              color:i===0?LIME:C.muted,
              background:i===0?"rgba(240,255,65,.08)":"transparent",
            });
            tx(tab,cat);
            tab.onclick=()=>{
              tabRow.querySelectorAll("button").forEach((t,j)=>{
                t.style.color=j===i?LIME:C.muted;
                t.style.borderColor=j===i?LIME:C.border;
                t.style.background=j===i?"rgba(240,255,65,.08)":"transparent";
              });
              pages.forEach((p,j)=>p.style.display=j===i?"flex":"none");
            };
            tabRow.appendChild(tab);
          });
        }
        _inspireBody.append(tabRow,...pages);
      };

      let _inspirePromptsLoaded=false;
      const _saveDiscoverPrompts=async()=>{
        try{
          const toSave={};
          ["edit","inpaint","faceswap","i2i"].forEach(pill=>{
            const d=INSPIRE_BY_PILL[pill];
            if(d&&d.categories) toSave[pill]={categories:d.categories};
            else if(d&&d.tabs) toSave[pill]={tabs:d.tabs};
          });
          await api.fetchApi("/flux_klein/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({discover_prompts:toSave})});
        }catch(e){ console.warn("[FluxKlein] save discover_prompts:",e); }
      };
      // Autofill prompts loaded from config.json — fallbacks used if config missing
      let _autofillPrompts={
        sketch:"Transform this sketch into a hyper-realistic photographic scene. Interpret the lines as real-world objects with high-quality textures, cinematic lighting, and natural shadows. Maintain the original composition while adding depth, realistic materials, and 8k resolution details. Scene description: [briefly describe what your sketch shows]",
        inpaint:"Edit the masked area: [DESCRIBE THE CHANGE — add, remove, replace, or modify the content]. Seamlessly blend with the surrounding scene, preserving the original lighting, shadows, depth of field, and photo grain.",
        outpaint:"Extend the composition of this image. Replace all black or empty spaces with a logical continuation of the background and foreground. Ensure the transition is invisible and the new elements perfectly match the perspective and color palette of the original image. Scene description: [briefly describe what should appear in the expanded areas]",
      };

      const _loadDiscoverPrompts=async()=>{
        if(_inspirePromptsLoaded) return;
        _inspirePromptsLoaded=true;
        try{
          const r=await api.fetchApi("/flux_klein/config");
          const d=await r.json();
          if(d.autofill_prompts&&Object.keys(d.autofill_prompts).length){
            _autofillPrompts={..._autofillPrompts,...d.autofill_prompts};
          }
          if(d.discover_prompts){
            ["edit","inpaint","faceswap","i2i"].forEach(pill=>{
              if(d.discover_prompts[pill]) INSPIRE_BY_PILL[pill]=d.discover_prompts[pill];
            });
          }
        }catch(e){ console.warn("[FluxKlein] load discover_prompts:",e); }
      };

      const _openInspire=async()=>{
        await _loadDiscoverPrompts();
        _buildInspireBody();
        _inspireOverlay.style.display="flex";
        _inspireOverlay.getBoundingClientRect();
        _inspireOverlay.style.opacity="1";
      };

      _inspireHdr.style.position="relative"; _inspireHdr.style.zIndex="1";
      _inspireBody.style.position="relative"; _inspireBody.style.zIndex="1";
      _inspireOverlay.append(_inspireHdr,_inspireBody);

      // ── Get Inspired button ───────────────────────────────────────────────
      const _inspireBtn=mk("button",{
        background:"none",border:`1px solid ${C.border}`,cursor:"pointer",
        padding:"2px 7px",color:C.muted,outline:"none",
        display:"flex",alignItems:"center",gap:"4px",borderRadius:"5px",
        transition:"color .15s,border-color .15s",flexShrink:"0",
      });
      _inspireBtn.innerHTML=`<span style="font-size:9px;font-weight:700;letter-spacing:.04em">✦ Discover</span>`;
      _inspireBtn.onmouseenter=()=>{_inspireBtn.style.color="#fff";_inspireBtn.style.borderColor="#555";};
      _inspireBtn.onmouseleave=()=>{_inspireBtn.style.color=C.muted;_inspireBtn.style.borderColor=C.border;};
      _inspireBtn.onclick=_openInspire;

      // Order: cap | Get Inspired | errChip | [spacer via marginLeft:auto on _ulBtn] | Add LoRA | Expand prompt
      promptCap.style.marginBottom="0";
      promptHdr.append(promptCap,_inspireBtn,errMinChip,_ulBtn,_promptExpandBtn);
      promptWrap.appendChild(promptHdr);

      const promptTA=mk("textarea",{
        width:"100%",height:"80px",resize:"none",
        background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"8px",
        color:C.text,fontSize:"12px",padding:"9px 12px",
        boxSizing:"border-box",outline:"none",lineHeight:"1.55",
        fontFamily:"inherit",transition:"border-color .15s",display:"block",
      },{placeholder:"Describe what you want to generate…"});
      promptTA.value=S.prompt;
      _promptTARef=promptTA;
      promptTA.onfocus=()=>promptTA.style.borderColor=LIME;
      promptTA.onblur=()=>promptTA.style.borderColor=C.border;
      promptTA.oninput=()=>{S.prompt=promptTA.value;S[_pillPromptKey(activePill)]=promptTA.value;persist();};
      promptTA.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();promptTA.blur();}});
      promptTA.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});

      // ── Error panel ───────────────────────────────────────────────────────
      const errPanel=mk("div",{display:"none",borderRadius:"8px",overflow:"hidden"});
      const errMain=mk("div",{background:"linear-gradient(180deg,rgba(255,103,103,.12),rgba(255,103,103,.05))",
        border:`1px solid rgba(255,103,103,.34)`,borderRadius:"8px",
        padding:"10px 12px",boxSizing:"border-box",
        animation:"fk-error-pulse 1.8s ease-in-out infinite"});
      const errTopRow=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"6px"});
      const errTitle=mk("div",{fontSize:"11px",fontWeight:"700",color:C.err});tx(errTitle,"Generation error");
      const _errMinBtn=mk("button",{
        background:"none",border:"none",cursor:"pointer",padding:"2px 6px",
        color:C.muted,fontSize:"9px",fontWeight:"700",letterSpacing:".04em",
        outline:"none",borderRadius:"4px",textTransform:"uppercase",
        border:`1px solid rgba(255,103,103,.25)`,transition:"color .15s,border-color .15s",
      });
      tx(_errMinBtn,"Hide");
      errTopRow.append(errTitle,_errMinBtn);
      const errMsg=mk("div",{fontSize:"11px",lineHeight:"1.55",color:C.text,whiteSpace:"pre-wrap",wordBreak:"break-word"});
      const errHint=mk("div",{fontSize:"10px",lineHeight:"1.5",color:C.warn,marginTop:"6px"});
      tx(errHint,"Check the console log for details and make sure the correct models are selected in Settings.");
      errMain.append(errTopRow,errMsg,errHint);
      errPanel.appendChild(errMain);

      let _errMinimized=false;
      const _toggleErrMin=()=>{
        _errMinimized=!_errMinimized;
        errPanel.style.display=_errMinimized?"none":"block";
        errMain.style.display=_errMinimized?"none":"block";
        errMinChip.style.display=_errMinimized?"flex":"none";
        promptTA.style.display=_errMinimized?"block":"none";
        tx(_errMinBtn,_errMinimized?"Show":"Hide");
      };
      _errMinBtn.onclick=_toggleErrMin;
      errMinChip.onclick=_toggleErrMin;

      function showError(msg){
        _errMinimized=false;tx(_errMinBtn,"Hide");
        errMsg.textContent=msg||"Unknown error.";
        errMain.style.display="block";errMinChip.style.display="none";
        promptTA.style.display="none";errPanel.style.display="block";
      }
      function clearError(){
        _errMinimized=false;errPanel.style.display="none";promptTA.style.display="block";
        errMinChip.style.display="none";
      }

      promptWrap.append(promptTA,errPanel);

      // ── Prompt expand overlay ─────────────────────────────────────────────
      const _promptOverlay=mk("div",{
        position:"absolute",inset:"0",zIndex:"250",background:C.bg0,
        display:"none",flexDirection:"column",
        padding:"14px",boxSizing:"border-box",gap:"8px",
        opacity:"0",transition:"opacity 0.15s ease",
      });
      const _promptOvHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:"0"});
      const _promptOvCap=mk("div",{fontSize:"10px",fontWeight:"700",color:C.muted,letterSpacing:".07em",textTransform:"uppercase"});
      tx(_promptOvCap,"Prompt");
      const _promptCollapseBtn=mk("button",{
        background:"none",border:"none",cursor:"pointer",padding:"2px 4px",
        color:C.muted,lineHeight:"1",outline:"none",
        display:"flex",alignItems:"center",borderRadius:"4px",transition:"color .15s",
      });
      _promptCollapseBtn.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`;
      _promptCollapseBtn.onmouseenter=()=>_promptCollapseBtn.style.color=LIME;
      _promptCollapseBtn.onmouseleave=()=>_promptCollapseBtn.style.color=C.muted;
      _promptOvHdr.append(_promptOvCap,_promptCollapseBtn);
      const _promptOvTA=mk("textarea",{
        flex:"1",width:"100%",resize:"none",minHeight:"0",
        background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"8px",
        color:C.text,fontSize:"12px",padding:"10px 12px",
        boxSizing:"border-box",outline:"none",lineHeight:"1.6",
        fontFamily:"inherit",transition:"border-color .15s",
      },{placeholder:"Describe what you want to generate…"});
      _promptOvTA.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
      _promptOvTA.onfocus=()=>_promptOvTA.style.borderColor=LIME;
      _promptOvTA.onblur=()=>_promptOvTA.style.borderColor=C.border;
      _promptOvTA.oninput=()=>{S.prompt=_promptOvTA.value;S[_pillPromptKey(activePill)]=_promptOvTA.value;promptTA.value=_promptOvTA.value;persist();};
      const _openPromptOverlay=()=>{
        _promptOvTA.value=S.prompt;_promptOverlay.style.display="flex";
        _promptOverlay.getBoundingClientRect();_promptOverlay.style.opacity="1";
        setTimeout(()=>{_promptOvTA.focus();_promptOvTA.setSelectionRange(_promptOvTA.value.length,_promptOvTA.value.length);},50);
      };
      const _closePromptOverlay=()=>{
        S.prompt=_promptOvTA.value;promptTA.value=_promptOvTA.value;persist();
        _promptOverlay.style.opacity="0";
        setTimeout(()=>_promptOverlay.style.display="none",160);
      };
      _promptExpandBtn.onclick=_openPromptOverlay;
      _promptCollapseBtn.onclick=_closePromptOverlay;
      _promptOverlay.append(_promptOvHdr,_promptOvTA);
      _promptOverlay.addEventListener("keydown",e=>{if(e.key==="Escape")_closePromptOverlay();});

      // ── GENERATION ────────────────────────────────────────────────────────
      const _resetGenBtn=()=>{
        genBtn.disabled=false;tx(genBtn,"Generate");
        genBtn.style.background=LIME;genBtn.style.backgroundSize="";
        genBtn.style.animation="none";genBtn.style.color="#111";
        genBtn.style.border="2px solid transparent";
        stopBtn.style.maxWidth="0";stopBtn.style.minWidth="0";stopBtn.style.width="0";stopBtn.style.opacity="0";stopBtn.style.padding="0";stopBtn.style.marginLeft="0";
        progWrap.style.display="none";
        if(_lastGenObj) previewDelBtn.style.display="flex";
      };

      const resetBtn=()=>{
        S.generating=false;S._pendingMeta=null;_activePromptId=null;
        S._preRunFiles=new Set();persist();_resetGenBtn();
      };

      let _lastGenObj=null; // {filename, subfolder} of the most recently generated image

      let _previewBlobUrl=null;
      const showPreview=(url)=>{
        if(_previewBlobUrl) URL.revokeObjectURL(_previewBlobUrl);
        _previewBlobUrl=url;
        placeholder.style.display="none";
        finalImg.src=url;
        finalImg.style.display="block";
      };

      const showFinal=(url,filename,subfolder)=>{
        if(_previewBlobUrl){ URL.revokeObjectURL(_previewBlobUrl); _previewBlobUrl=null; }
        clearError();S.generating=false;S.previewUrl=null;_activePromptId=null;persist();
        _resetGenBtn();
        if(soundEnabled)playDone();
        _galNeedsRefresh=true;
        if(filename) _lastGenObj={filename,subfolder:subfolder||""};
        placeholder.style.display="none";

        // Save metadata — use snapshot captured at Generate click time
        const meta=S._pendingMeta?{v:1,...S._pendingMeta}:{v:1,prompt:S.prompt,w:getEffectiveW(),h:getEffectiveH(),mode:activePill};
        if(filename){
          api.fetchApi("/flux_klein/save_meta",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({filename,subfolder:subfolder||"",meta}),
          }).catch(e=>console.warn("[FluxKlein] save_meta:",e));
        }

        const _showComparer=(img1InputName)=>{
          finalImg.style.display="none";
          comparerGenImg.src=url;
          comparerGenImg.style.width=(previewBox.offsetWidth||620)+"px";
          comparerBase.src=api.apiURL(`/view?filename=${encodeURIComponent(img1InputName)}&type=input&subfolder=`);
          comparerWrap.style.display="block";
          previewUseWrap.style.display="block";
          _cmpSetPct(100);
        };
        // Use snapshot mode/image so switching pills mid-generation doesn't corrupt comparer
        const _snapMode=S._pendingMeta?.mode||activePill;
        const _snapImg1=S._pendingMeta?.image1||null;
        const _isSketchResult=_snapMode==="sketch"&&_snapImg1;
        const _isPaintResult=(_snapMode==="inpaint"||_snapMode==="outpaint")&&_snapImg1;
        if(_snapMode==="edit"&&_snapImg1){
          _showComparer(_snapImg1);
        } else if(_isSketchResult||_isPaintResult){
          _showComparer(_snapImg1);
        } else if(_snapMode==="faceswap"&&_snapImg1){
          _showComparer(_snapImg1);
        } else if(_snapMode==="i2i"&&_snapImg1){
          _showComparer(_snapImg1);
        } else {
          comparerWrap.style.display="none";
          finalImg.src=url;finalImg.style.display="block";
        }
        previewUseWrap.style.display="block";
        if(filename) previewDelBtn.style.display="flex";
      };

      const _slotErr=(slot,lbl)=>{ slot.el.style.borderColor="#e05555"; tx(lbl,"Required!"); lbl.style.color="#e05555"; };

      genBtn.onclick=async()=>{
        if(!S.prompt.trim()&&activePill!=="faceswap"){showError("Please enter a prompt.");return;}
        if(activePill==="inpaint"){
          if(_paintMode==="sketch"){
            if(!_paintSlot.hasFile()){ _slotErr(_paintSlot,_paintSlotLbl); return; }
          } else if(_paintMode==="inpaint"){
            if(!_maskName){ showError("PAINT / Inpaint: open Inpaint, draw a mask and confirm it first."); return; }
            if(_maskName!=="__outpaint__"&&!_paintSlot.hasFile()){ _slotErr(_paintSlot,_paintSlotLbl); return; }
          } else {
            _slotErr(_paintSlot,_paintSlotLbl); return;
          }
        }
        if(activePill==="i2i"&&!i2iSlot.hasFile()){_slotErr(i2iSlot,i2iSlotLbl);return;}
        if(activePill==="edit"&&!img1Slot.hasFile()){_slotErr(img1Slot,img1NameLbl);return;}
        if(activePill==="faceswap"){
          if(!_fsTargetSlot.hasFile()){_slotErr(_fsTargetSlot,_fsTargetLbl);return;}
          if(!_fsSourceSlot.hasFile()){_slotErr(_fsSourceSlot,_fsSourceLbl);return;}
          if(!S.fsLora||S.fsLora==="none") {showError("FACESWAP: select a Faceswap LoRA in Settings.");return;}
        }
        const _hasExtModel=(()=>{ const n=app.graph.getNodeById(self.id); const inputs=n?.inputs||[]; const slot=inputs.find(i=>i.name==="model"); return slot?.link!=null; })();
        if(!S.model&&!_hasExtModel){showError("No model selected. Open Settings and choose a model.");return;}

        clearError();S.generating=true;

        // Snapshot all meta-relevant state at click time so mid-generation UI changes don't corrupt metadata
        const _isSketchSnap=activePill==="inpaint"&&_paintMode==="sketch";
        const _isInpaintSnap=activePill==="inpaint"&&_paintMode==="inpaint"&&_maskName!=="__outpaint__";
        const _isOutpaintSnap=activePill==="inpaint"&&_paintMode==="inpaint"&&_maskName==="__outpaint__";
        const _isFaceswapSnap=activePill==="faceswap";
        const _isPaintSnap=_isSketchSnap||_isInpaintSnap||_isOutpaintSnap;
        let _snapMode;
        if(_isSketchSnap) _snapMode="sketch";
        else if(_isInpaintSnap) _snapMode="inpaint";
        else if(_isOutpaintSnap) _snapMode="outpaint";
        else if(_isFaceswapSnap) _snapMode="faceswap";
        else _snapMode=activePill;
        S._pendingMeta={
          prompt:S.prompt,
          w:getEffectiveW(), h:getEffectiveH(),
          mode:_snapMode,
          image1:activePill==="i2i"?(S.i2iImage||null):(_isPaintSnap?(_paintSlot.name||null):(_isFaceswapSnap?(S.fsTarget||null):(activePill==="edit"?(S.image1Name||null):null))),
          i2iDenoise:activePill==="i2i"?S.i2iDenoise:undefined,
          image2:(_isFaceswapSnap?(S.fsSource||null):(activePill==="edit"?(S.image2Name||null):null)),
          mask:_isInpaintSnap?(_maskName||null):null,
          outpaintExpand:_isOutpaintSnap?{top:_opTop,right:_opRight,bottom:_opBottom,left:_opLeft}:null,
          useSizeSource:(activePill==="edit")?(_useSizeSource||null):null,
          userLoras:S.userLoras.filter(l=>l.name&&l.name!=="none"&&l.enabled!==false&&+(l.strength||0)>0).map(l=>({n:l.name.split(/[\\/]/).pop(),s:l.strength})),
          ...(S.advancedUI?{steps:S.steps||4, cfg:S.cfg!==undefined?S.cfg:1,
            sampler:S.sampler||"er_sde", scheduler:S.scheduler||"simple",
            advancedUI:true}:{}),
          seed:S.seed||0, randomizeSeed:S.randomizeSeed,
        };

        S._preRunFiles=new Set();persist();

        // Keep existing image visible until the new one arrives
        const _hadImage=finalImg.style.display!=="none"||comparerWrap.style.display!=="none";
        if(!_hadImage) placeholder.style.display="none";
        progWrap.style.display="flex";
        setStage("Generating…","Preparing workflow…",0);

        genBtn.disabled=true;tx(genBtn,"Generating…");
        genBtn.style.background="linear-gradient(270deg,#f0ff41,#00e5ff,#a259ff,#f0ff41)";
        genBtn.style.backgroundSize="300% 300%";
        genBtn.style.animation="fk-gradient 2.4s ease infinite";
        genBtn.style.color=LIME;genBtn.style.border="2px solid transparent";
        previewDelBtn.style.display="none";
        requestAnimationFrame(()=>{
          stopBtn.style.maxWidth="120px";stopBtn.style.minWidth="";stopBtn.style.width="";stopBtn.style.opacity="1";stopBtn.style.padding="0 14px";stopBtn.style.marginLeft="6px";
        });

        // Snapshot pre-run gallery files so we can identify the new output
        try{
          const prevR=await api.fetchApi("/flux_klein/gallery?offset=0&limit=200&subfolder=one-node-flux-2-klein");
          const prevD=await prevR.json();
          S._preRunFiles=new Set((prevD.images||[]).map(v=>v.key||((v.subfolder?`${v.subfolder}/`:"")+v.filename)));
        }catch(e){ S._preRunFiles=new Set(); }

        // Load correct workflow
        const isSketchMode=activePill==="inpaint"&&_paintMode==="sketch";
        const isInpaintMode=activePill==="inpaint"&&_paintMode==="inpaint"&&_maskName!=="__outpaint__";
        const isOutpaintMode=activePill==="inpaint"&&_paintMode==="inpaint"&&_maskName==="__outpaint__";
        const isFaceswapMode=activePill==="faceswap";
        const isI2IMode=activePill==="i2i";
        let wfUrl;
        if(activePill==="edit"||isSketchMode) wfUrl="/flux_klein/workflow_edit";
        else if(isInpaintMode) wfUrl="/flux_klein/workflow_inpaint";
        else if(isOutpaintMode) wfUrl="/flux_klein/workflow_outpaint";
        else if(isFaceswapMode) wfUrl="/flux_klein/workflow_faceswap";
        else if(isI2IMode) wfUrl="/flux_klein/workflow_i2i";
        else wfUrl="/flux_klein/workflow_t2i";

        let wfData;
        try{
          const r=await api.fetchApi(wfUrl);
          if(!r.ok) throw new Error("HTTP "+r.status);
          wfData=await r.json();
        }catch(e){
          showError("Could not load workflow (HTTP 404 = restart ComfyUI): "+fmtErr(e));resetBtn();return;
        }

        const prompt=JSON.parse(JSON.stringify(wfData));
        const set=(id,key,val)=>{ if(prompt[id]) prompt[id].inputs[key]=val; };
        const _isBase=_isBaseModel();
        const _setAdv=(samplerNodeId,skipDenoise)=>{
          const steps=S.advancedUI?(S.steps||4):(_isBase?20:4);
          const cfg=S.advancedUI?(S.cfg!==undefined?S.cfg:1):(_isBase?5:1);
          set(samplerNodeId,"steps",steps);
          set(samplerNodeId,"cfg",cfg);
          if(S.advancedUI){
            set(samplerNodeId,"sampler_name",S.sampler||"er_sde");
            set(samplerNodeId,"scheduler",S.scheduler||"simple");
            if(!skipDenoise) set(samplerNodeId,"denoise",S.denoise!==undefined?S.denoise:1);
          }
        };

        // Build effective prompt — trigger words from all active LoRAs prepended
        const _effectivePrompt=await _buildPromptWithTriggers(S.prompt||"");

        const useKV=(S.model||"").toLowerCase().includes("kv");

        // ── External model/clip/vae input detection ─────────────────────────
        // If the node has optional inputs wired from outside (e.g. a GGUF loader),
        // skip internal loaders and use the external node's output instead.
        // The external node is serialized and added to the prompt so ComfyUI can find it.
        const _selfNode=app.graph.getNodeById(self.id);
        const _extSlot=(name)=>{
          // Toggle off = external inputs are ignored even if a wire is still connected;
          // the internal dropdown model is used. The toggle is the single source of truth.
          if(!S.extLoaders) return null;
          if(!_selfNode) return null;
          const inputs=_selfNode.inputs||[];
          const slot=inputs.find(i=>i.name===name);
          if(!slot||slot.link==null) return null;
          const link=app.graph.links[slot.link];
          if(!link) return null;
          // Serialize the external node and all its upstream dependencies into prompt
          const _addNodeToPrompt=(nodeId)=>{
            if(prompt[String(nodeId)]) return; // already added
            const extNode=app.graph.getNodeById(nodeId);
            if(!extNode) return;
            const serialized={class_type:extNode.comfyClass||extNode.type,inputs:{},_meta:{title:extNode.title||extNode.type}};
            // Add widget values as inputs
            (extNode.widgets||[]).forEach(w=>{ if(w.name) serialized.inputs[w.name]=w.value; });
            // Add connected inputs
            (extNode.inputs||[]).forEach((inp,i)=>{
              if(inp.link!=null){
                const l=app.graph.links[inp.link];
                if(l){ _addNodeToPrompt(l.origin_id); serialized.inputs[inp.name]=[String(l.origin_id),l.origin_slot||0]; }
              }
            });
            prompt[String(nodeId)]=serialized;
          };
          _addNodeToPrompt(link.origin_id);
          return [String(link.origin_id),link.origin_slot||0];
        };
        const extModel=_extSlot("model");
        const extClip =_extSlot("clip");
        const extVae  =_extSlot("vae");

        // ── LoRA chain helper ───────────────────────────────────────────────
        const _applyLoRAs=(chainSrc,idPrefix)=>{
          const toPrev=(p)=>typeof p==="string"?[p,0]:p;
          let prev=chainSrc;
          (S.userLoras||[]).forEach((ul,i)=>{
            if(!ul.name||ul.name==="none"||ul.enabled===false||!(+(ul.strength||0)>0)) return;
            const id=`${idPrefix}UL${i+1}`;
            prompt[id]={
              inputs:{lora_name:ul.name,strength_model:+(ul.strength??1.0),model:toPrev(prev)},
              class_type:"LoraLoaderModelOnly",
              _meta:{title:`User LoRA ${i+1}`},
            };
            prev=[id,0];
          });
          return prev;
        };

        // ── INPAINT workflow patching ───────────────────────────────────────
        if(isInpaintMode){
          const WFI={
            model:"FKI:194", kv:"FKI:216", textEnc:"FKI:195", vae:"FKI:196",
            promptPos:"FKI:6", promptNeg:"FKI:190",
            loadImg:"FKI:198", loadMask:"FKI:199",
            crop:"FKI:209", sampler:"FKI:163", save:"FKI:203",
          };
          if(extModel){ delete prompt[WFI.model]; if(useKV) prompt[WFI.kv].inputs.model=extModel; }
          else set(WFI.model,"unet_name",S.model||"flux-2-klein-9b-kv.safetensors");
          if(extClip){ delete prompt[WFI.textEnc]; prompt[WFI.promptPos].inputs.clip=extClip; }
          else set(WFI.textEnc,"clip_name",S.textEncoder||"qwen_3_8b_fp8mixed.safetensors");
          if(extVae){ delete prompt[WFI.vae]; prompt["FKI:206"].inputs.vae=extVae; prompt["FKI:210"].inputs.vae=extVae; prompt["FKI:164"].inputs.vae=extVae; }
          else set(WFI.vae,"vae_name",S.vae||"flux2-vae.safetensors");
          set(WFI.promptPos,"text",      _effectivePrompt);
          set(WFI.loadImg,  "image",     _paintSlot.name||"example.png");
          set(WFI.loadMask, "image",     _maskName||"example_mask.png");

          // Resize source image + mask by longer side if enabled in inpaint bar
          const {w:_inpFW,h:_inpFH,resized:_inpResized}=_inpCalcDims();
          if(_inpResized){
            prompt["FKI:scaleInp"]={
              class_type:"ImageScale",
              inputs:{image:["FKI:198",0],upscale_method:"lanczos",width:_inpFW,height:_inpFH,crop:"center"},
              _meta:{title:"Scale Inpaint Source"},
            };
            prompt["FKI:scaleMask"]={
              class_type:"ImageScale",
              inputs:{image:["FKI:199",0],upscale_method:"nearest-exact",width:_inpFW,height:_inpFH,crop:"center"},
              _meta:{title:"Scale Inpaint Mask"},
            };
            prompt["FKI:200"].inputs.image=["FKI:scaleMask",0];
            if(prompt["FKI:209"]) prompt["FKI:209"].inputs.image=["FKI:scaleInp",0];
          }

          const seed=S.randomizeSeed?Math.floor(Math.random()*999999999999):S.seed;
          if(S.randomizeSeed){S.seed=seed;seedInp.setVal(seed);_advSeedInp.setVal(seed);_advSeedRefresh();persist();}
          set(WFI.sampler,"seed",seed); _setAdv(WFI.sampler);
          set(WFI.save,"filename_prefix","one-node-flux-2-klein/FK");

          // KV cache: inpaint workflow already has FKI:216 FluxKVCache wired.
          // If KV not selected, bypass it by wiring UNETLoader directly to KSampler model chain.
          if(extModel&&useKV){ prompt[WFI.kv].inputs.model=extModel; }
          if(!useKV){ delete prompt[WFI.kv]; }

          // LoRA chain: inject between UNETLoader (or KV) and KSampler
          const inpaintModelSrc=extModel?(useKV?WFI.kv:extModel):(useKV?WFI.kv:WFI.model);
          const inpaintFinalRef=_applyLoRAs(inpaintModelSrc,"FKI:");
          set(WFI.sampler,"model",typeof inpaintFinalRef==="string"?[inpaintFinalRef,0]:inpaintFinalRef);

          // Output crop size
          let cropW=_paintDimsW||1024, cropH=_paintDimsH||1024;
          if(!_paintUseDimsFromImg){
            const res=RES_PRESETS.find(r=>r.label===_paintResDD.value);
            if(res&&res.w){ cropW=res.w;cropH=res.h; }
            else { cropW=Math.round(_paintWInp.numVal)||1024;cropH=Math.round(_paintHInp.numVal)||1024; }
          }
          // Outpaint: crop = full padded image size so AI sees entire context
          // Inpaint: always 1024 — InpaintCropImproved crops to mask area, 1024 is sufficient and fast
          let cropTargetW, cropTargetH;
          if(_opMaskName){
            // Outpaint: crop = actual padded image dimensions (stored at Apply Changes time)
            cropTargetW=_opPaddedW||cropW; cropTargetH=_opPaddedH||cropH;
          } else {
            // Estimate mask bounding box from _maskCanvas to pick crop target size.
            let maskMaxDim=0;
            try{
              const mc=_maskCanvas;
              if(mc&&mc.width>0&&mc.height>0){
                const id=mc.getContext("2d").getImageData(0,0,mc.width,mc.height);
                const d=id.data;
                let minX=mc.width,maxX=0,minY=mc.height,maxY=0,found=false;
                for(let y=0;y<mc.height;y++) for(let x=0;x<mc.width;x++){
                  if(d[(y*mc.width+x)*4+3]>16){
                    if(x<minX)minX=x;if(x>maxX)maxX=x;
                    if(y<minY)minY=y;if(y>maxY)maxY=y;found=true;
                  }
                }
                if(found) maskMaxDim=Math.max(maxX-minX+1,maxY-minY+1);
              }
            }catch(e){}
            // mask bbox × 1.5 for context, round to nearest 64, clamp 512–1536
            const t=maskMaxDim>0
              ?Math.min(1536,Math.max(512,Math.ceil(maskMaxDim*1.5/64)*64))
              :1024;
            cropTargetW=t; cropTargetH=t;
          }
          set(WFI.crop,"output_target_width",cropTargetW);
          set(WFI.crop,"output_target_height",cropTargetH);

        } else if(isOutpaintMode){
          // outpaint_workflow.json receives:
          //   FKO:198 = padded source image (uploaded by Confirm Outpaint)
          //   FKO:maskload = outpaint mask (white=new area, uploaded by Confirm Outpaint)
          const WFO={
            model:"FKO:194", kv:"FKO:216", textEnc:"FKO:195", vae:"FKO:196",
            promptPos:"FKO:6",
            loadImg:"FKO:198", loadMask:"FKO:maskload",
            sampler:"FKO:163", save:"FKO:203",
          };
          if(extModel){ delete prompt[WFO.model]; if(useKV) prompt[WFO.kv].inputs.model=extModel; }
          else set(WFO.model,"unet_name",S.model||"flux-2-klein-9b-kv.safetensors");
          if(extClip){ delete prompt[WFO.textEnc]; prompt[WFO.promptPos].inputs.clip=extClip; }
          else set(WFO.textEnc,"clip_name",S.textEncoder||"qwen_3_8b_fp8mixed.safetensors");
          if(extVae){ delete prompt[WFO.vae]; prompt["FKO:210"].inputs.vae=extVae; prompt["FKO:164"].inputs.vae=extVae; }
          else set(WFO.vae,"vae_name",S.vae||"flux2-vae.safetensors");
          set(WFO.promptPos,"text",       _effectivePrompt);
          // _paintSlot.name now holds the pre-padded image uploaded by Confirm Changes
          set(WFO.loadImg,  "image",      _paintSlot.name||"example.png");
          // _opMaskName holds the white-on-black mask uploaded alongside the padded image
          set(WFO.loadMask, "image",      _opMaskName||"example_mask.png");

          const seed=S.randomizeSeed?Math.floor(Math.random()*999999999999):S.seed;
          if(S.randomizeSeed){S.seed=seed;seedInp.setVal(seed);_advSeedInp.setVal(seed);_advSeedRefresh();persist();}
          set(WFO.sampler,"seed",seed); _setAdv(WFO.sampler);
          set(WFO.save,"filename_prefix","one-node-flux-2-klein/FK");

          // Resize padded image + mask by longer side if enabled
          const {w:_opFW,h:_opFH,resized:_opResized}=_opCalcDims();
          if(_opResized){
            prompt["FKO:scaleImg"]={
              class_type:"ImageScale",
              inputs:{image:["FKO:198",0],upscale_method:"lanczos",width:_opFW,height:_opFH,crop:"center"},
              _meta:{title:"Scale Outpaint Image"},
            };
            prompt["FKO:scaleMask"]={
              class_type:"ImageScale",
              inputs:{image:["FKO:maskload",0],upscale_method:"nearest-exact",width:_opFW,height:_opFH,crop:"center"},
              _meta:{title:"Scale Outpaint Mask"},
            };
            prompt["FKO:tomask"].inputs.image=["FKO:scaleMask",0];
            prompt["FKO:210"].inputs.pixels=["FKO:scaleImg",0];
          }

          if(extModel&&useKV){ prompt[WFO.kv].inputs.model=extModel; }
          if(!useKV) delete prompt[WFO.kv];
          const opModelSrc=extModel?(useKV?WFO.kv:extModel):(useKV?WFO.kv:WFO.model);
          const opFinalRef=_applyLoRAs(opModelSrc,"FKO:");
          set(WFO.sampler,"model",typeof opFinalRef==="string"?[opFinalRef,0]:opFinalRef);

        } else if(isFaceswapMode){
          // ── FACESWAP workflow patching ────────────────────────────────────
          const WFF={
            model:"FKF:225", lora:"FKF:226", textEnc:"FKF:223", vae:"FKF:235",
            target:"FKF:234", source:"FKF:236",
            sampling:"FKF:239", sampler:"FKF:228", save:"FKF:232",
          };
          if(extModel){ delete prompt[WFF.model]; prompt[WFF.lora].inputs.model=extModel; }
          else set(WFF.model,"unet_name",S.model||"flux-2-klein-9b.safetensors");
          if(extClip){ delete prompt[WFF.textEnc]; prompt["FKF:227"].inputs.clip=extClip; prompt["FKF:229"].inputs.clip=extClip; }
          else set(WFF.textEnc,"clip_name",S.textEncoder||"qwen_3_8b_fp8mixed.safetensors");
          if(extVae){ delete prompt[WFF.vae]; prompt["FKF:171t"].inputs.vae=extVae; prompt["FKF:174s"].inputs.vae=extVae; prompt["FKF:224"].inputs.vae=extVae; }
          else set(WFF.vae,"vae_name",S.vae||"flux2-vae.safetensors");
          set(WFF.target, "image",          S.fsTarget||"placeholder.png");
          set(WFF.source, "image",          S.fsSource||"placeholder.png");

          // Resize target by longer side if enabled
          if(S.fsResizeLonger>0){
            const dims=_fsTargetDims._getDims();
            if(dims.w&&dims.h){
              const longer=Math.max(dims.w,dims.h);
              const scale=S.fsResizeLonger/longer;
              const newW=Math.round(dims.w*scale/16)*16;
              const newH=Math.round(dims.h*scale/16)*16;
              // Inject ImageScale node between LoadImage(target) and the rest
              prompt["FKF:scaleTarget"]={
                class_type:"ImageScale",
                inputs:{image:["FKF:234",0],upscale_method:"lanczos",width:newW,height:newH,crop:"center"},
                _meta:{title:"Scale Target"},
              };
              // Rewire all consumers of FKF:234 output to FKF:scaleTarget
              prompt["FKF:171t"].inputs.pixels=["FKF:scaleTarget",0];
              // Use explicit dims on EmptyFlux2LatentImage instead of GetImageSize
              prompt["FKF:230"].inputs.width=newW;
              prompt["FKF:230"].inputs.height=newH;
              delete prompt["FKF:231"]; // GetImageSize no longer needed
            }
          }
          set(WFF.save,   "filename_prefix","one-node-flux-2-klein/FK");
          // Face LoRA — always set from Settings (validated before reaching here)
          set(WFF.lora,"lora_name",S.fsLora);

          const seed=S.randomizeSeed?Math.floor(Math.random()*999999999999):S.seed;
          if(S.randomizeSeed){S.seed=seed;seedInp.setVal(seed);_advSeedInp.setVal(seed);_advSeedRefresh();persist();}
          set(WFF.sampler,"seed",seed); _setAdv(WFF.sampler);

          // Prompt: use user prompt if non-empty, otherwise keep hardcoded workflow prompt
          if(_effectivePrompt.trim()) set("FKF:227","text",_effectivePrompt);

          // LoRA chain: workflow already has FKF:226 (face LoRA) hardcoded.
          // User LoRAs (from Settings) are injected after FKF:226 before ModelSamplingAuraFlow.
          // If no user LoRAs, wire FKF:226 directly into ModelSamplingAuraFlow.
          const fsLoRaRef=_applyLoRAs("FKF:226","FKF:");
          set(WFF.sampling,"model",typeof fsLoRaRef==="string"?[fsLoRaRef,0]:fsLoRaRef);

        } else if(isI2IMode){
          // ── I2I workflow patching ──────────────────────────────────────────
          if(extModel){ delete prompt["FK:165"]; }
          else set("FK:165","unet_name",S.model||"flux-2-klein-9b.safetensors");
          if(extClip){ delete prompt["FK:155"]; prompt["FK:166"].inputs.clip=extClip; prompt["FK:156"].inputs.clip=extClip; }
          else set("FK:155","clip_name",S.textEncoder||"qwen_3_8b_fp8mixed.safetensors");
          if(extVae){ delete prompt["FK:153"]; prompt["FKI2I:vae"].inputs.vae=extVae; prompt["FK:152"].inputs.vae=extVae; }
          else set("FK:153","vae_name",S.vae||"flux2-vae.safetensors");
          set("FK:166","text",       _effectivePrompt);
          set("FKI2I:img","image",   S.i2iImage||"placeholder.png");
          set("FK:86","filename_prefix","one-node-flux-2-klein/FK");

          // Resize input image by longer side if enabled (explicit user override).
          // NOTE: the global "downscale reference" toggle is intentionally NOT applied
          // in I2I — here the latent IS the input image (img2img with denoise < 1),
          // so the encoded size also defines the OUTPUT size. Shrinking it would shrink
          // the result. Output size is therefore driven by the size badge or this
          // longer-side resize only.
          if(S.i2iResizeLonger>0){
            const dims=_i2iDims._getDims();
            if(dims.w&&dims.h){
              const scale=S.i2iResizeLonger/Math.max(dims.w,dims.h);
              const newW=Math.round(dims.w*scale/16)*16;
              const newH=Math.round(dims.h*scale/16)*16;
              prompt["FKI2I:scale"]={
                class_type:"ImageScale",
                inputs:{image:["FKI2I:img",0],upscale_method:"lanczos",width:newW,height:newH,crop:"center"},
                _meta:{title:"Scale I2I Input"},
              };
              prompt["FKI2I:vae"].inputs.pixels=["FKI2I:scale",0];
            }
          }

          // KV + LoRA chain → ModelSamplingAuraFlow → KSampler
          let i2iModelSrc=extModel||"FK:165";
          if(useKV){
            prompt["FK:KV"]={class_type:"FluxKVCache",inputs:{model:extModel||["FK:165",0]},_meta:{title:"Flux KV Cache"}};
            i2iModelSrc="FK:KV";
          }
          const i2iLoraRef=_applyLoRAs(i2iModelSrc,"FK:");
          set("FK:169","model",typeof i2iLoraRef==="string"?[i2iLoraRef,0]:i2iLoraRef);

          const seed=S.randomizeSeed?Math.floor(Math.random()*999999999999):S.seed;
          if(S.randomizeSeed){S.seed=seed;seedInp.setVal(seed);_advSeedInp.setVal(seed);_advSeedRefresh();persist();}
          set("FK:171","seed",seed);
          set("FK:171","denoise",S.i2iDenoise!==undefined?S.i2iDenoise:0.75);
          _setAdv("FK:171",true); // skipDenoise=true — denoise controlled by slider, not advanced

        } else {
          // ── T2I / EDIT / SKETCH: original model chain ─────────────────────
          if(extModel){ delete prompt[WF.model]; }
          else set(WF.model,"unet_name",S.model||"flux-2-klein-9b.safetensors");
          if(extClip){ delete prompt[WF.textEnc]; prompt[WF.promptPos].inputs.clip=extClip; prompt[WF.promptNeg].inputs.clip=extClip; }
          else set(WF.textEnc,"clip_name",S.textEncoder||"qwen_3_8b_fp8mixed.safetensors");
          if(extVae){ delete prompt[WF.vae]; if(prompt["FK:132"]) prompt["FK:132"].inputs.vae=extVae; if(prompt["FK:232"]) prompt["FK:232"].inputs.vae=extVae; prompt["FK:152"].inputs.vae=extVae; }
          else set(WF.vae,"vae_name",S.vae||"flux2-vae.safetensors");

          // Build chain: UNETLoader → (KV?) → (LoRAs?) → ModelSamplingAuraFlow
          let modelSrc=extModel||WF.model;
          if(useKV){
            prompt["FK:KV"]={
              inputs:{model:extModel||[WF.model,0]},
              class_type:"FluxKVCache",
              _meta:{title:"Flux KV Cache"},
            };
            modelSrc="FK:KV";
          }
          const finalModelRef=_applyLoRAs(modelSrc,"FK:");
          set(WF.sampling,"model",typeof finalModelRef==="string"?[finalModelRef,0]:finalModelRef);

          const seed=S.randomizeSeed?Math.floor(Math.random()*999999999999):S.seed;
          if(S.randomizeSeed){S.seed=seed;seedInp.setVal(seed);_advSeedInp.setVal(seed);_advSeedRefresh();persist();}
          set(WF.sampler,"seed",seed); _setAdv(WF.sampler);

          set(WF.promptPos,"text",_effectivePrompt);
          set(WF.promptNeg,"text",DEFAULT_NEG_PROMPT);
          set(WF.saveImage,"filename_prefix","one-node-flux-2-klein/FK");

          // ── T2I ──────────────────────────────────────────────────────────
          if(activePill==="t2i"){
            const w=getW(), h=getH();
            set(WF.latent,"width",  w||1024);
            set(WF.latent,"height", h||1024);
          }

          // ── EDIT / SKETCH ─────────────────────────────────────────────────
          if(activePill==="edit"||isSketchMode){
            const img1Name=isSketchMode?(_paintSlot.name||"placeholder.png"):(S.image1Name||"placeholder.png");
            set(WF.loadImage1,"image", img1Name);

            // Resolve effective size source:
            // sketch   → use raw img1 (no scale), GetImageSize reads img1 from JSON default
            // img1 src → use raw img1, GetImageSize reads img1 from JSON default
            // img2 src → rewire GetImageSize to img2, scale img1 for VAE; fallback to img1 if img2 missing
            // null     → manual size from dropdown/custom, set latent width/height explicitly
            // effectiveSrc: sketch always uses img1; otherwise only if user explicitly selected a source
            const effectiveSrc=isSketchMode?"img1":(_useSizeSource||null);
            if(effectiveSrc==="img1"){
              // Size comes from img1 via GetImageSize (JSON default wiring FK:167→FK:91 already correct)
              set(WF.vaeEnc1,"pixels",[WF.loadImage1,0]); // skip scale, use raw resolution
            } else if(effectiveSrc==="img2"&&S.image2Name){
              // Rewire GetImageSize to read img2
              if(prompt[WF.getSize]) prompt[WF.getSize].inputs.image=[WF.loadImage2,0];
              set(WF.vaeEnc1,"pixels",[WF.scaleImg1,0]);
            } else {
              // Manual size — set explicit dimensions on EmptyFlux2LatentImage
              const w=S.isCustomRes?snapRes(S.customW):S.resW;
              const h=S.isCustomRes?snapRes(S.customH):S.resH;
              if(prompt[WF.latent]){
                prompt[WF.latent].inputs.width=w||1024;
                prompt[WF.latent].inputs.height=h||1024;
              }
              set(WF.vaeEnc1,"pixels",[WF.scaleImg1,0]);
            }

            const hasImg2=!isSketchMode&&!!S.image2Name;
            if(hasImg2){
              set(WF.loadImage2,"image", S.image2Name);
              set(WF.sampler,"positive",[WF.refPos2,0]);
              set(WF.sampler,"negative",[WF.refNeg2,0]);
            } else {
              delete prompt[WF.loadImage2];
              delete prompt[WF.scaleImg2];
              delete prompt[WF.vaeEnc2];
              delete prompt[WF.refPos2];
              delete prompt[WF.refNeg2];
              set(WF.sampler,"positive",[WF.refPos1,0]);
              set(WF.sampler,"negative",[WF.refNeg1,0]);
            }

            // Reference downscale toggle — applies to EDIT and SKETCH (both send
            // the input/canvas into the VAE encoder through this workflow).
            if(S.downscaleRef){
              // ON: route VAE encode through the scale node and set megapixels.
              // (Sketch + img1-source paths normally bypass the scale node, so we
              // must re-wire the encoder onto it here, not just set megapixels.)
              const mp=+(S.downscaleRefMP)>0?+(S.downscaleRefMP):1.0;
              if(prompt[WF.scaleImg1]){
                prompt[WF.scaleImg1].inputs.megapixels=mp;
                if(prompt[WF.vaeEnc1]) prompt[WF.vaeEnc1].inputs.pixels=[WF.scaleImg1,0];
              }
              if(prompt[WF.scaleImg2]){
                prompt[WF.scaleImg2].inputs.megapixels=mp;
                if(prompt[WF.vaeEnc2]) prompt[WF.vaeEnc2].inputs.pixels=[WF.scaleImg2,0];
              }
            } else {
              // OFF: bypass scale nodes — VAE-encode the full-resolution inputs.
              if(prompt[WF.vaeEnc1]) prompt[WF.vaeEnc1].inputs.pixels=[WF.loadImage1,0];
              if(prompt[WF.vaeEnc2]) prompt[WF.vaeEnc2].inputs.pixels=[WF.loadImage2,0];
              delete prompt[WF.scaleImg1];
              delete prompt[WF.scaleImg2];
            }
          }
        }

        try{
          const resp=await api.fetchApi("/prompt",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({prompt,client_id:api.clientId,extra_data:{enable_previews:true}}),
          });
          const result=await resp.json();
          const wfErrs=Object.entries(result.node_errors||{}).filter(([k])=>k!==String(self.id));
          if(result.error){
            showError(fmtErr(result.error));resetBtn();
          }else if(wfErrs.length){
            showError(fmtErr(wfErrs[0][1]));resetBtn();
          }else{
            _activePromptId=result.prompt_id||null;
            console.log("[FluxKlein] queued:",result.prompt_id);
          }
        }catch(err){
          showError(fmtErr(err));resetBtn();
        }
      };

      // ── PILL VISIBILITY ───────────────────────────────────────────────────
      function updatePillVisibility(){
        i2iPanel.style.display=activePill==="i2i"?"flex":"none";
        editPanel.style.display=activePill==="edit"?"flex":"none";
        inpaintPanel.style.display=activePill==="inpaint"?"flex":"none";
        faceswapPanel.style.display=activePill==="faceswap"?"flex":"none";
        resSect.style.display=(activePill==="inpaint"||activePill==="faceswap"||activePill==="i2i")?"none":"flex";
        updateSizeControls();
      }

      // ── mkHeart helper (used by gallery) ─────────────────────────────────
      const _mkHeart=(size)=>{
        const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
        svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("width",size||"12px");svg.setAttribute("height",size||"12px");
        svg.style.fill="currentColor";svg.style.display="block";svg.style.flexShrink="0";
        const p=document.createElementNS("http://www.w3.org/2000/svg","path");
        p.setAttribute("d","M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z");
        svg.appendChild(p);return svg;
      };

      // ── GALLERY OVERLAY ───────────────────────────────────────────────────
      const galleryOverlay=mk("div",{
        position:"absolute",inset:"0",background:"#0a0a0a",
        display:"none",flexDirection:"column",padding:"16px",
        boxSizing:"border-box",zIndex:"50",borderRadius:"8px",
        opacity:"0",transition:"opacity .22s ease, transform .22s ease",
        transform:"translateY(6px)",
      });

      // ── Gallery thumbnail right-click context menu ────────────────────────
      let _galCtxImg=null;
      const _galCtxMenu=mk("div",{
        position:"fixed",zIndex:"999999",background:C.bg1,
        border:`1px solid ${C.borderH}`,borderRadius:"8px",
        minWidth:"170px",display:"none",flexDirection:"column",
        boxShadow:"0 4px 20px rgba(0,0,0,.7)",overflow:"hidden",
      });
      const _mkGalCtxItem=(label,icon,onClick)=>{
        const row=mk("div",{
          padding:"7px 12px",fontSize:"10px",fontWeight:"500",color:C.text,
          cursor:"pointer",display:"flex",alignItems:"center",gap:"7px",
          transition:"background .1s,color .1s",userSelect:"none",
        });
        const ico=mk("span",{fontSize:"11px",width:"14px",textAlign:"center",flexShrink:"0",color:C.muted});
        tx(ico,icon);
        const lbl=mk("span",{}); tx(lbl,label);
        row.append(ico,lbl);
        row.onmouseenter=()=>{row.style.background="rgba(240,255,65,.10)";row.style.color=LIME;ico.style.color=LIME;};
        row.onmouseleave=()=>{row.style.background="";row.style.color=C.text;ico.style.color=C.muted;};
        row.onclick=()=>{ _galCtxMenu.style.display="none"; onClick(); };
        return row;
      };
      const _mkGalCtxSec=(label)=>{
        const h=mk("div",{padding:"6px 12px 3px",fontSize:"8px",fontWeight:"700",
          letterSpacing:".08em",textTransform:"uppercase",color:C.muted,userSelect:"none"});
        tx(h,label);return h;
      };
      const _mkGalCtxDiv=()=>mk("div",{height:"1px",background:C.border,margin:"2px 0"});
      _galCtxMenu.append(
        _mkGalCtxSec("I2I"),
        _mkGalCtxItem("I2I slot","⟳",()=>{ if(_galCtxImg)_loadIntoI2ISlot(_galCtxImg); }),
        _mkGalCtxDiv(),
        _mkGalCtxSec("Edit"),
        _mkGalCtxItem("Image 1","①",()=>{ if(_galCtxImg)_loadIntoSlot(_galCtxImg,1); }),
        _mkGalCtxItem("Image 2","②",()=>{ if(_galCtxImg)_loadIntoSlot(_galCtxImg,2); }),
        _mkGalCtxDiv(),
        _mkGalCtxSec("Paint"),
        _mkGalCtxItem("Paint slot","✏",()=>{ if(_galCtxImg)_loadIntoPaintSlot(_galCtxImg); }),
        _mkGalCtxDiv(),
        _mkGalCtxSec("Faceswap"),
        _mkGalCtxItem("Target","◎",()=>{ if(_galCtxImg)_loadIntoFsSlot(_galCtxImg,"target"); }),
        _mkGalCtxItem("Source","◈",()=>{ if(_galCtxImg)_loadIntoFsSlot(_galCtxImg,"source"); }),
      );
      document.body.appendChild(_galCtxMenu);
      document.addEventListener("click",()=>{ _galCtxMenu.style.display="none"; });
      document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") _galCtxMenu.style.display="none"; });

      // Gallery header
      const galHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",
        marginBottom:"12px",flexShrink:"0",gap:"8px"});
      const galTitle=mk("div",{fontSize:"13px",fontWeight:"700",letterSpacing:".06em",
        textTransform:"uppercase",color:C.text});tx(galTitle,"Gallery");

      const galHdrRight=mk("div",{display:"flex",gap:"6px",alignItems:"center"});

      // Favorites toggle
      let _galFavOnly=false;
      const galFavBtn=mk("button",{background:"transparent",border:`1px solid ${C.border}`,
        borderRadius:"6px",padding:"4px 10px",fontSize:"11px",color:C.muted,
        cursor:"pointer",outline:"none",transition:"border-color .15s,color .15s,background .15s",
        display:"flex",alignItems:"center",gap:"5px"});
      galFavBtn.appendChild(_mkHeart("11px"));
      const _galFavLbl=mk("span");tx(_galFavLbl,"Favorites");galFavBtn.appendChild(_galFavLbl);
      const _setGalFavBtn=(active)=>{
        _galFavOnly=active;
        galFavBtn.style.background=active?`rgba(240,255,65,.18)`:"transparent";
        galFavBtn.style.borderColor=active?LIME:C.border;
        galFavBtn.style.color=active?LIME:C.muted;
        galleryOverlay.style.background=active?
          "linear-gradient(180deg,rgba(240,255,65,.06) 0%,rgba(240,255,65,.02) 40%,rgba(0,0,0,0) 100%), #0a0a0a":
          "#0a0a0a";
      };
      galFavBtn.onmouseenter=()=>{if(!_galFavOnly){galFavBtn.style.borderColor=LIME;galFavBtn.style.color=LIME;}};
      galFavBtn.onmouseleave=()=>{if(!_galFavOnly){galFavBtn.style.borderColor=C.border;galFavBtn.style.color=C.muted;}};
      galFavBtn.onclick=()=>{ _setGalFavBtn(!_galFavOnly); galLoad(true); };

      const galRefreshBtn=mk("button",{background:C.bg3,border:`1px solid ${C.border}`,
        borderRadius:"6px",padding:"4px 10px",fontSize:"11px",color:C.muted,
        cursor:"pointer",outline:"none",transition:"border-color .15s,color .15s"});
      tx(galRefreshBtn,"↺ Refresh");
      galRefreshBtn.onmouseenter=()=>{galRefreshBtn.style.borderColor=C.text;galRefreshBtn.style.color=C.text;};
      galRefreshBtn.onmouseleave=()=>{galRefreshBtn.style.borderColor=C.border;galRefreshBtn.style.color=C.muted;};

      const galClose=mk("button",{background:"transparent",border:`1px solid #e05555`,
        borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:"#e05555",
        cursor:"pointer",outline:"none",transition:"opacity .15s"});
      tx(galClose,"✕  Close");
      galClose.onmouseenter=()=>galClose.style.opacity=".7";
      galClose.onmouseleave=()=>galClose.style.opacity="1";

      galHdrRight.append(galFavBtn,galRefreshBtn,galClose);
      galHdr.append(galTitle,galHdrRight);

      // Grid + scroll area
      const galScroll=mk("div",{flex:"1",overflowY:"auto",scrollbarWidth:"thin",
        scrollbarColor:`${C.border} transparent`});
      const galGrid=mk("div",{
        display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",
        gap:"6px",paddingBottom:"12px",
      });
      const galEmpty=mk("div",{fontSize:"12px",color:C.muted,textAlign:"center",
        padding:"40px 0",display:"none"});
      tx(galEmpty,"No images found.");
      // Infinite scroll sentinel inside galScroll — must be a child of the scroll container
      const galSentinel=mk("div",{height:"2px",flexShrink:"0",marginTop:"4px"});
      // Loading spinner shown below grid while fetching next page
      const galMoreWrap=mk("div",{display:"none",justifyContent:"center",alignItems:"center",
        padding:"14px 0",gap:"8px",flexShrink:"0"});
      const galSpinner=mk("div",{
        width:"16px",height:"16px",borderRadius:"50%",flexShrink:"0",
        border:"2px solid rgba(240,255,65,.2)",borderTopColor:LIME,
        animation:"fk-galSpin .7s linear infinite",
      });
      if(!document.getElementById("fk-galspin-style")){
        const ss=document.createElement("style");ss.id="fk-galspin-style";
        ss.textContent="@keyframes fk-galSpin{to{transform:rotate(360deg)}}";
        document.head.appendChild(ss);
      }
      const galMoreBtn=mk("div"); // kept for compatibility
      galMoreWrap.appendChild(galSpinner);
      // Sentinel and spinner are inside galScroll so IntersectionObserver root works correctly
      galScroll.append(galGrid,galEmpty,galMoreWrap,galSentinel);

      let _galLoading=false;
      const _galIo=new IntersectionObserver(entries=>{
        if(!entries[0].isIntersecting) return;
        if(_galLoading||_galFavOnly||_galOffset>=_galTotal) return;
        galLoad(false,GAL_MORE);
      },{root:galScroll,threshold:0});
      _galIo.observe(galSentinel);

      galleryOverlay.append(galHdr,galScroll);

      // ── LIGHTBOX ──────────────────────────────────────────────────────────
      const lightbox=mk("div",{
        position:"absolute",inset:"0",background:"#0a0a0a",
        display:"none",flexDirection:"column",zIndex:"60",borderRadius:"8px",
        boxSizing:"border-box",
      });

      // Top bar: filename (left) + close (right)
      const lbTop=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"8px 10px 4px",flexShrink:"0",gap:"8px"});
      const lbFilename=mk("div",{fontSize:"11px",color:C.muted,flex:"1",
        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"});
      const lbClose=mk("button",{background:"transparent",border:`1px solid #e05555`,
        borderRadius:"6px",padding:"3px 12px",fontSize:"11px",color:"#e05555",
        cursor:"pointer",outline:"none",transition:"opacity .15s"});
      tx(lbClose,"✕");
      lbClose.onmouseenter=()=>lbClose.style.opacity=".7";
      lbClose.onmouseleave=()=>lbClose.style.opacity="1";
      lbTop.append(lbFilename,lbClose);

      // Body: arrows + image wrap as flex siblings (full-height arrows like LTX node)
      const lbBody=mk("div",{display:"flex",alignItems:"center",flex:"1",
        minHeight:"0",position:"relative",gap:"8px",padding:"0 8px"});
      const lbImgWrap=mk("div",{flex:"1",minWidth:"0",display:"flex",alignItems:"center",
        justifyContent:"center",overflow:"hidden",height:"100%",minHeight:"0"});
      const lbImg=mk("img",{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",
        borderRadius:"8px",display:"block"});
      lbImgWrap.appendChild(lbImg);
      // Prev / Next arrows — flex siblings, full height
      const lbArrowL=mk("button",{background:"rgba(255,255,255,.08)",border:"none",
        borderRadius:"6px",width:"36px",flexShrink:"0",alignSelf:"stretch",
        cursor:"pointer",fontSize:"18px",color:C.text,outline:"none",
        transition:"background .15s",display:"flex",alignItems:"center",justifyContent:"center"});
      tx(lbArrowL,"‹");
      lbArrowL.onmouseenter=()=>lbArrowL.style.background="rgba(255,255,255,.15)";
      lbArrowL.onmouseleave=()=>lbArrowL.style.background="rgba(255,255,255,.08)";
      const lbArrowR=mk("button",{background:"rgba(255,255,255,.08)",border:"none",
        borderRadius:"6px",width:"36px",flexShrink:"0",alignSelf:"stretch",
        cursor:"pointer",fontSize:"18px",color:C.text,outline:"none",
        transition:"background .15s",display:"flex",alignItems:"center",justifyContent:"center"});
      tx(lbArrowR,"›");
      lbArrowR.onmouseenter=()=>lbArrowR.style.background="rgba(255,255,255,.15)";
      lbArrowR.onmouseleave=()=>lbArrowR.style.background="rgba(255,255,255,.08)";
      lbBody.append(lbArrowL,lbImgWrap,lbArrowR);

      // Metadata panel — shown below image
      const lbMeta=mk("div",{
        flexShrink:"0",margin:"0 8px 4px",
        background:"linear-gradient(180deg,rgba(240,255,65,.07),rgba(240,255,65,.02))",
        border:"1px solid rgba(240,255,65,.2)",borderRadius:"10px",
        padding:"9px 12px",display:"none",flexDirection:"column",gap:"6px",
      });

      // Prompt row
      const lbPromptRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const lbPromptLbl=mk("div",{fontSize:"9px",color:C.muted,fontWeight:"700",
        letterSpacing:".08em",textTransform:"uppercase"});
      tx(lbPromptLbl,"Prompt");
      const lbPromptText=mk("div",{fontSize:"10px",color:C.text,lineHeight:"1.5",
        maxHeight:"42px",overflowY:"auto",scrollbarWidth:"thin"});
      lbPromptRow.append(lbPromptLbl,lbPromptText);

      // Info chips row: resolution chip + input thumb + restore btn + fav + open folder
      const lbInfoRow=mk("div",{display:"flex",gap:"6px",alignItems:"stretch",flexWrap:"wrap"});

      const _lbChip=(label,val)=>{
        const chip=mk("div",{display:"flex",flexDirection:"column",gap:"1px",
          background:C.bg3,borderRadius:"5px",padding:"4px 8px",minWidth:"50px"});
        const cl=mk("div",{fontSize:"8px",color:C.muted,fontWeight:"700",
          letterSpacing:".07em",textTransform:"uppercase"});
        tx(cl,label);
        const cv=mk("div",{fontSize:"10px",color:C.text,fontWeight:"600"});
        tx(cv,val||"—");
        chip.append(cl,cv);
        return chip;
      };
      const lbChipRes=_lbChip("Size","—");
      const lbChipMode=_lbChip("Mode","—");
      const lbChipAdv=mk("div",{
        display:"none",alignItems:"center",gap:"4px",
        background:C.bg3,borderRadius:"5px",padding:"4px 8px",
        fontSize:"9px",color:C.muted,fontWeight:"700",letterSpacing:".05em",
        cursor:"default",title:"Advanced settings saved",
      });
      lbChipAdv.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg><span>ADV</span>`;

      // Input image thumbnails (shown when meta has image1 / image2)
      const lbImgThumb=mk("img",{height:"40px",borderRadius:"4px",objectFit:"cover",
        display:"none",alignSelf:"center",border:`1px solid ${C.border}`});
      const lbImgThumb2=mk("img",{height:"40px",borderRadius:"4px",objectFit:"cover",
        display:"none",alignSelf:"center",border:`1px solid ${C.border}`});

      // Restore button
      const lbRestoreBtn=mk("button",{
        background:LIME,color:"#111",border:"none",borderRadius:"5px",
        padding:"0 14px",fontSize:"11px",fontWeight:"700",
        cursor:"pointer",outline:"none",transition:"opacity .15s",
        display:"none",alignSelf:"stretch",whiteSpace:"nowrap",
        alignItems:"center",justifyContent:"center"});
      tx(lbRestoreBtn,"Load settings into UI");
      lbRestoreBtn.onmouseenter=()=>lbRestoreBtn.style.opacity=".85";
      lbRestoreBtn.onmouseleave=()=>lbRestoreBtn.style.opacity="1";

      // Fav button
      let _lbFavActive=false;
      const lbFavBtn=mk("button",{
        background:"rgba(20,20,30,.85)",border:"1px solid rgba(240,255,65,.2)",
        borderRadius:"6px",width:"40px",height:"40px",flexShrink:"0",
        cursor:"pointer",outline:"none",
        transition:"background .2s,border-color .2s,color .2s",
        display:"flex",alignItems:"center",justifyContent:"center",
        color:"rgba(240,255,65,.35)",alignSelf:"stretch"});
      const _lbFavApplyStyle=(hover)=>{
        if(_lbFavActive){
          lbFavBtn.style.background=hover?"rgba(240,255,65,.22)":"rgba(240,255,65,.15)";
          lbFavBtn.style.borderColor=hover?LIME:LIME;
          lbFavBtn.style.color=hover?"#fff":LIME;
          lbFavBtn.style.boxShadow=hover?"0 0 10px rgba(240,255,65,.3)":"0 0 6px rgba(240,255,65,.15)";
        } else {
          lbFavBtn.style.background=hover?"rgba(240,255,65,.08)":"rgba(20,20,30,.85)";
          lbFavBtn.style.borderColor=hover?"rgba(240,255,65,.5)":"rgba(240,255,65,.2)";
          lbFavBtn.style.color=hover?"rgba(240,255,65,.85)":"rgba(240,255,65,.35)";
          lbFavBtn.style.boxShadow="none";
        }
      };
      lbFavBtn.onmouseenter=()=>_lbFavApplyStyle(true);
      lbFavBtn.onmouseleave=()=>_lbFavApplyStyle(false);
      lbFavBtn.appendChild(_mkHeart("14px"));

      // Open folder button
      const lbOpenBtn=mk("button",{
        background:"transparent",border:`1px solid ${C.border}`,
        borderRadius:"6px",padding:"0 10px",fontSize:"10px",color:C.muted,
        cursor:"pointer",outline:"none",transition:"border-color .15s,color .15s",
        alignSelf:"stretch",display:"flex",alignItems:"center",gap:"4px",
        marginLeft:"auto",whiteSpace:"nowrap"});
      // Folder SVG icon
      const _lbFolderSvg=(()=>{
        const s=document.createElementNS("http://www.w3.org/2000/svg","svg");
        s.setAttribute("viewBox","0 0 24 24");s.setAttribute("width","12");s.setAttribute("height","12");
        s.style.fill="currentColor";s.style.flexShrink="0";
        const p=document.createElementNS("http://www.w3.org/2000/svg","path");
        p.setAttribute("d","M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z");
        s.appendChild(p);return s;
      })();
      lbOpenBtn.appendChild(_lbFolderSvg);
      const _lbOpenLbl=mk("span");tx(_lbOpenLbl,"Show in folder");lbOpenBtn.appendChild(_lbOpenLbl);
      lbOpenBtn.onmouseenter=()=>{lbOpenBtn.style.borderColor=C.text;lbOpenBtn.style.color=C.text;};
      lbOpenBtn.onmouseleave=()=>{lbOpenBtn.style.borderColor=C.border;lbOpenBtn.style.color=C.muted;};
      lbOpenBtn.onclick=async()=>{
        const v=_lbActiveImg; if(!v) return;
        try{
          await api.fetchApi("/flux_klein/open_folder",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({filename:v.filename,subfolder:v.subfolder||""}),
          });
        }catch(e){ console.warn("[FluxKlein] open_folder:",e); }
      };

      // ── "Use as…" dropdown button ─────────────────────────────────────────
      const _lbUseWrap=mk("div",{position:"relative",alignSelf:"stretch",display:"flex"});

      const _lbUseBtn=mk("button",{
        background:C.bg3,color:C.text,border:`1px solid ${C.borderH}`,
        borderRadius:"5px",padding:"0 11px",fontSize:"10px",fontWeight:"600",
        cursor:"pointer",outline:"none",whiteSpace:"nowrap",
        display:"flex",alignItems:"center",gap:"5px",
        transition:"border-color .15s,color .15s,background .15s",
      });
      _lbUseBtn.innerHTML=`Use as… <svg viewBox="0 0 10 6" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="1,1 5,5 9,1"/></svg>`;

      // Dropdown panel — appears above the button (bottom-anchored)
      const _lbUseDrop=mk("div",{
        position:"absolute",bottom:"calc(100% + 5px)",left:"0",
        background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"8px",
        minWidth:"170px",overflow:"hidden",display:"none",zIndex:"200",
        boxShadow:"0 4px 20px rgba(0,0,0,.7)",flexDirection:"column",
      });

      // Section header inside dropdown
      const _mkDropSection=(label)=>{
        const h=mk("div",{
          padding:"6px 12px 3px",fontSize:"8px",fontWeight:"700",letterSpacing:".08em",
          textTransform:"uppercase",color:C.muted,userSelect:"none",
        });
        tx(h,label);return h;
      };

      // Clickable slot item inside dropdown
      const _mkDropItem=(label,icon,onClick)=>{
        const row=mk("div",{
          padding:"7px 12px",fontSize:"10px",fontWeight:"500",color:C.text,
          cursor:"pointer",display:"flex",alignItems:"center",gap:"7px",
          transition:"background .1s,color .1s",userSelect:"none",
        });
        const ico=mk("span",{fontSize:"11px",width:"14px",textAlign:"center",flexShrink:"0",color:C.muted});
        tx(ico,icon);
        const lbl=mk("span",{}); tx(lbl,label);
        row.append(ico,lbl);
        row.onmouseenter=()=>{row.style.background="rgba(240,255,65,.10)";row.style.color=LIME;ico.style.color=LIME;};
        row.onmouseleave=()=>{row.style.background="";row.style.color=C.text;ico.style.color=C.muted;};
        row.onclick=()=>{ _lbCloseDrop(); onClick(); };
        return row;
      };

      // Thin divider between sections
      const _mkDropDivider=()=>mk("div",{height:"1px",background:C.border,margin:"2px 0"});

      // Build dropdown items
      _lbUseDrop.append(
        _mkDropSection("I2I"),
        _mkDropItem("I2I slot","⟳",()=>{ const v=_lbActiveImg;if(v)_loadIntoI2ISlot(v); }),
        _mkDropDivider(),
        _mkDropSection("Edit"),
        _mkDropItem("Image 1","①",()=>{ const v=_lbActiveImg;if(v)_loadIntoSlot(v,1); }),
        _mkDropItem("Image 2","②",()=>{ const v=_lbActiveImg;if(v)_loadIntoSlot(v,2); }),
        _mkDropDivider(),
        _mkDropSection("Paint"),
        _mkDropItem("Paint slot","✏",()=>{ const v=_lbActiveImg;if(v)_loadIntoPaintSlot(v); }),
        _mkDropDivider(),
        _mkDropSection("Faceswap"),
        _mkDropItem("Target","◎",()=>{ const v=_lbActiveImg;if(v)_loadIntoFsSlot(v,"target"); }),
        _mkDropItem("Source","◈",()=>{ const v=_lbActiveImg;if(v)_loadIntoFsSlot(v,"source"); }),
      );

      let _lbDropOpen=false;
      const _lbCloseDrop=()=>{
        _lbDropOpen=false;
        _lbUseDrop.style.display="none";
      };
      const _lbToggleDrop=()=>{
        _lbDropOpen=!_lbDropOpen;
        _lbUseDrop.style.display=_lbDropOpen?"flex":"none";
      };

      _lbUseBtn.onmouseenter=()=>{_lbUseBtn.style.borderColor=LIME;_lbUseBtn.style.color=LIME;_lbUseBtn.style.background=C.bg2;};
      _lbUseBtn.onmouseleave=()=>{_lbUseBtn.style.borderColor=C.borderH;_lbUseBtn.style.color=C.text;_lbUseBtn.style.background=C.bg3;};
      _lbUseBtn.onclick=(e)=>{ e.stopPropagation(); _lbToggleDrop(); };

      // Close dropdown when clicking outside
      document.addEventListener("click",()=>{ if(_lbDropOpen) _lbCloseDrop(); });
      _lbUseDrop.addEventListener("click",e=>e.stopPropagation());

      _lbUseWrap.append(_lbUseBtn,_lbUseDrop);

      // Delete button in lightbox
      const lbDelBtn=mk("button",{
        background:"rgba(160,25,25,.7)",border:"1px solid rgba(255,80,80,.3)",
        borderRadius:"6px",width:"42px",height:"40px",flexShrink:"0",
        cursor:"pointer",outline:"none",transition:"background .15s,border-color .15s",
        display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,180,180,.9)",
        alignSelf:"stretch"});
      lbDelBtn.title="Delete image";
      lbDelBtn.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
      lbDelBtn.onmouseenter=()=>{lbDelBtn.style.background="rgba(210,35,35,.9)";lbDelBtn.style.borderColor="rgba(255,80,80,.6)";};
      lbDelBtn.onmouseleave=()=>{lbDelBtn.style.background="rgba(160,25,25,.7)";lbDelBtn.style.borderColor="rgba(255,80,80,.3)";};
      lbDelBtn.onclick=()=>{
        const v=_lbActiveImg; if(!v) return;
        const delIdx=_lbIdx;
        _deleteImage(v,lbDelBtn,()=>{
          // Remove from _galImages and _lbNavList
          const galIdx=_galImages.indexOf(v);
          if(galIdx!==-1){ _galImages.splice(galIdx,1); }
          _galTotal=Math.max(0,_galTotal-1);
          delete _galMetas[v.filename];
          // Remove from navList too (may differ from galImages in fav-only mode)
          const navIdx=_lbNavList.indexOf(v);
          if(navIdx!==-1){ _lbNavList.splice(navIdx,1); }
          // Rebuild grid
          galGrid.innerHTML="";
          if(_galFavOnly){
            const favs=_galImages.filter(img=>_galMetas[img.filename]?.favorite===true);
            _galAppend(favs,0);
            tx(galTitle,`Gallery  (${favs.length} fav)`);
            galEmpty.style.display=favs.length?"none":"block";
          } else {
            _galAppend(_galImages,0);
            tx(galTitle,`Gallery  (${_galTotal})`);
            galEmpty.style.display=_galImages.length?"none":"block";
          }
          // Navigate to next image or close
          if(_lbNavList.length===0){ _lbClose(); }
          else { _lbNav(Math.min(delIdx,_lbNavList.length-1)); }
        });
      };

      lbInfoRow.append(lbChipRes,lbChipMode,lbChipAdv,lbImgThumb,lbImgThumb2,lbRestoreBtn,_lbUseWrap,lbFavBtn,lbDelBtn,lbOpenBtn);

      // LoRA row — subtle, hidden when no loras
      const lbLoraRow=mk("div",{display:"none",gap:"4px",flexWrap:"wrap",alignItems:"center"});
      const lbLoraLbl=mk("span",{fontSize:"8px",color:C.muted,fontWeight:"700",
        letterSpacing:".07em",textTransform:"uppercase",marginRight:"2px"});
      tx(lbLoraLbl,"LoRA");
      lbLoraRow.appendChild(lbLoraLbl);

      lbMeta.append(lbPromptRow,lbLoraRow,lbInfoRow);

      // Bottom counter
      const lbBottom=mk("div",{display:"flex",justifyContent:"center",
        alignItems:"center",padding:"4px 10px 8px",flexShrink:"0",position:"relative"});
      const lbCounter=mk("div",{fontSize:"10px",color:C.muted});
      const lbFShortcut=mk("div",{
        position:"absolute",right:"12px",display:"flex",alignItems:"center",gap:"4px",
      });
      const _lbFKbd=mk("span",{fontSize:"7px",fontWeight:"700",color:"#111",background:C.muted,borderRadius:"3px",padding:"0px 3px",letterSpacing:".02em",lineHeight:"1.7"});
      tx(_lbFKbd,"F");
      const _lbFLbl=mk("span",{fontSize:"7px",color:C.muted,whiteSpace:"nowrap"});
      tx(_lbFLbl,"Fullscreen");
      lbFShortcut.append(_lbFKbd,_lbFLbl);
      lbBottom.append(lbCounter,lbFShortcut);

      lightbox.append(lbTop,lbBody,lbMeta,lbBottom);
      galleryOverlay.appendChild(lightbox);

      // ── Gallery state ────────────────────────────────────────────────────
      let _galImages=[];
      let _galTotal=0;
      let _galOffset=0;
      let _galNeedsRefresh=false;
      let _galMetas={};
      let _lbActiveImg=null;
      let _loraList=[];
      let _lbIdx=0;
      const GAL_LIMIT=50;
      const GAL_MORE=50;

      const _galImgUrl=(v)=>`/view?filename=${encodeURIComponent(v.filename)}&type=output&subfolder=${encodeURIComponent(v.subfolder||"")}`;

      const _fetchMeta=async(v,force=false)=>{
        const key=v.filename;
        if(!force&&_galMetas[key]!==undefined) return _galMetas[key];
        try{
          const r=await api.fetchApi(`/flux_klein/meta?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder||"")}`);
          const d=await r.json();
          _galMetas[key]=d.ok?d.meta:null;
        }catch(e){ _galMetas[key]=null; }
        return _galMetas[key];
      };

      const _setLbFav=(isFav)=>{
        _lbFavActive=isFav;
        _lbFavApplyStyle(false);
        lightbox.style.background=isFav?
          "linear-gradient(180deg,rgba(240,255,65,.18) 0%,rgba(240,255,65,.06) 50%,rgba(0,0,0,0) 100%), #0a0a0a":
          "#0a0a0a";
      };

      const _lbClose=()=>{ lightbox.style.display="none"; _lbActiveImg=null; };

      // Active navigation list — all images or favorites-only depending on current filter
      let _lbNavList=[];

      const _lbNav=async(i)=>{
        if(!_lbNavList.length) return;
        // Load more when reaching end in non-fav mode
        if(i>=_lbNavList.length&&_galOffset<_galTotal&&!_galFavOnly){
          await galLoad(false,GAL_MORE);
          _lbNavList=_galImages; // refresh after load
        }
        i=Math.max(0,Math.min(_lbNavList.length-1,i));
        lbShow(_lbNavList[i],i);
      };
      lbArrowL.onclick=()=>_lbNav(_lbIdx-1);
      lbArrowR.onclick=()=>_lbNav(_lbIdx+1);

      // Keyboard handler for lightbox — capture phase so we beat ComfyUI canvas handlers
      document.addEventListener("keydown",(e)=>{
        if(lightbox.style.display!=="flex") return;
        if(e.key==="Escape"){ e.preventDefault(); e._lbHandled=true; _lbClose(); return; }
        if(e.key==="ArrowLeft"){ e.preventDefault(); e.stopPropagation(); _lbNav(_lbIdx-1); return; }
        if(e.key==="ArrowRight"){ e.preventDefault(); e.stopPropagation(); _lbNav(_lbIdx+1); return; }
        if(e.key==="f"||e.key==="F"){
          e.preventDefault();
          if(!document.fullscreenElement) lbImg.requestFullscreen().catch(()=>{});
          else document.exitFullscreen().catch(()=>{});
        }
      },{capture:true});

      // Open lightbox
      const lbShow=async(v,idx)=>{
        _lbActiveImg=v;
        _lbIdx=idx??0;
        tx(lbFilename,v.filename);
        lbImg.src=_galImgUrl(v)+"&t="+v.mtime;
        lbMeta.style.display="none";lbRestoreBtn.style.display="none";
        lbPromptText.textContent="";
        lightbox.style.display="flex";
        const total=_lbNavList.length||_galImages.length;
        tx(lbCounter,`${_lbIdx+1} / ${total}`);
        lbArrowL.style.opacity=_lbIdx>0?"1":".25";
        lbArrowR.style.opacity=_lbIdx<total-1?"1":".25";

        const meta=await _fetchMeta(v);
        // Reset lora row
        while(lbLoraRow.children.length>1) lbLoraRow.removeChild(lbLoraRow.lastChild);
        lbLoraRow.style.display="none";
        if(meta){
          lbPromptText.textContent=meta.prompt||"(no prompt saved)";
          const w=meta.w,h=meta.h;
          tx(lbChipRes.querySelector("div:last-child"),w&&h?`${w}×${h}`:"—");
          tx(lbChipMode.querySelector("div:last-child"),(meta.mode||"").toUpperCase()||"—");
          const _hasAdv=meta.advancedUI===true;
          lbChipAdv.style.display=_hasAdv?"flex":"none";
          if(_hasAdv) lbChipAdv.title=`Steps:${meta.steps||4} CFG:${meta.cfg??1} Sampler:${meta.sampler||"er_sde"}`;
          if(meta.image1){
            lbImgThumb.src=api.apiURL(`/view?filename=${encodeURIComponent(meta.image1)}&type=input&subfolder=`);
            lbImgThumb.style.display="block";
          } else { lbImgThumb.style.display="none"; }
          if(meta.image2){
            lbImgThumb2.src=api.apiURL(`/view?filename=${encodeURIComponent(meta.image2)}&type=input&subfolder=`);
            lbImgThumb2.style.display="block";
          } else { lbImgThumb2.style.display="none"; }
          // LoRA chips
          if(Array.isArray(meta.userLoras)&&meta.userLoras.length){
            meta.userLoras.forEach(ul=>{
              const chip=mk("span",{
                fontSize:"9px",color:C.muted,background:C.bg3,
                borderRadius:"4px",padding:"2px 6px",lineHeight:"1.6",
                border:`1px solid ${C.border}`,whiteSpace:"nowrap",
              });
              const name=(ul.n||"").replace(/\.safetensors$/i,"");
              chip.textContent=`${name} ×${+(ul.s??1).toFixed(2)}`;
              lbLoraRow.appendChild(chip);
            });
            lbLoraRow.style.display="flex";
          }
          lbMeta.style.display="flex";
          lbRestoreBtn.style.display="flex";
          lbRestoreBtn.onclick=()=>_lbApplyMeta(meta);
          _setLbFav(meta.favorite===true);
        } else {
          lbPromptText.textContent="⚠ No metadata.";
          tx(lbChipRes.querySelector("div:last-child"),"—");
          tx(lbChipMode.querySelector("div:last-child"),"—");
          lbChipAdv.style.display="none";
          lbImgThumb.style.display="none";
          lbImgThumb2.style.display="none";
          lbMeta.style.display="flex";
          _setLbFav(false);
        }
      };


      // Resolve an image name from metadata: if it's an output path (contains "/"), upload to input first.
      const _resolveMetaImage=async(name)=>{
        if(!name) return null;
        if(!name.includes("/")) return name;
        const parts=name.split("/");
        const filename=parts[parts.length-1];
        const subfolder=parts.slice(0,-1).join("/");
        try{
          return await _uploadOutputToInput({filename,subfolder});
        }catch(e){
          console.warn("[FluxKlein] resolveMetaImage:",e);
          return filename;
        }
      };

      // Apply meta — restores prompt, mode, resolution AND image slots (the source images stored in metadata).
      // "Use as Image 1/2" buttons handle loading the currently-viewed gallery image into a slot instead.
      const _lbApplyMeta=async(meta)=>{
        // Close gallery immediately — don't wait for async image uploads
        lightbox.style.display="none"; _lbActiveImg=null;
        closeOverlayFade(galleryOverlay);

        try{
          const mode=meta.mode||"t2i";
          // Map meta.mode → pill name
          const pillMap={"sketch":"inpaint","outpaint":"inpaint","inpaint":"inpaint","edit":"edit","i2i":"i2i","faceswap":"faceswap","t2i":"t2i"};
          const pill=pillMap[mode]||"t2i";
          // Prompt
          if(meta.prompt){
            S.prompt=meta.prompt; S[_pillPromptKey(pill)]=meta.prompt;
            promptTA.value=meta.prompt; _promptOvTA.value=meta.prompt;
          }
          // Pill
          setPill(pill);
          // Resolution (T2I / Edit only)
          if(meta.w&&meta.h&&(pill==="t2i"||pill==="edit")){
            const preset=RES_PRESETS.find(r=>r.w===meta.w&&r.h===meta.h);
            if(preset){ S.resLabel=preset.label;S.resW=preset.w;S.resH=preset.h;S.isCustomRes=false;
              resDD.set(preset.label);customResRow.style.display="none"; }
            else { S.isCustomRes=true;S.customW=meta.w;S.customH=meta.h;S.resLabel="Custom…";
              resDD.set("Custom…");customResRow.style.display="flex";
              wInp.setVal(meta.w);hInp.setVal(meta.h); }
          }
          // Image slots — by mode
          const _ri=async(name)=>{ try{ return await _resolveMetaImage(name); }catch(e){ return null; } };
          if(mode==="edit"){
            if(meta.image1){ const n=await _ri(meta.image1); if(n){S.image1Name=n;img1Slot._restorePreview(n);} }
            else { S.image1Name=null; img1Slot._restorePreview(null); }
            if(meta.image2){ const n=await _ri(meta.image2); if(n){S.image2Name=n;img2Slot._restorePreview(n);} }
            else { S.image2Name=null; img2Slot._restorePreview(null); }
            if(meta.useSizeSource!==undefined){
              _useSizeSource=meta.useSizeSource||null; S.useSizeFromImage1=_useSizeSource==="img1";
              dims1Lbl._refresh(); dims2Lbl._refresh();
            }
          } else if(mode==="i2i"){
            if(meta.image1){ const n=await _ri(meta.image1); if(n){S.i2iImage=n;i2iSlot._restorePreview(n);} }
            if(meta.i2iDenoise!==undefined){ S.i2iDenoise=meta.i2iDenoise; _i2iSliderSet(Math.round(meta.i2iDenoise*100)); }
          } else if(mode==="faceswap"){
            if(meta.image1){ const n=await _ri(meta.image1); if(n){S.fsTarget=n;_fsTargetSlot._restorePreview(n);} }
            if(meta.image2){ const n=await _ri(meta.image2); if(n){S.fsSource=n;_fsSourceSlot._restorePreview(n);} }
          } else if(mode==="sketch"||mode==="inpaint"||mode==="outpaint"){
            if(meta.image1){ const n=await _ri(meta.image1); if(n){ _sketchSaving=true;_paintSlot._restorePreview(n);_sketchSaving=false; } }
          }
          // Advanced params — only restore if explicitly saved with advancedUI:true
          if(meta.advancedUI===true){
            if(meta.steps){ S.steps=meta.steps; stepsInp.setVal(meta.steps); }
            if(meta.cfg!==undefined){ S.cfg=meta.cfg; cfgInp.setVal(meta.cfg); }
            if(meta.sampler){ S.sampler=meta.sampler; samplerDD.set(meta.sampler); }
            if(meta.scheduler){ S.scheduler=meta.scheduler; schedulerDD.set(meta.scheduler); }
            if(!S.advancedUI){ S.advancedUI=true; _advRefresh(); advUIToggle._setChecked(true); }
          }
          if(meta.seed!==undefined&&meta.randomizeSeed===false){
            S.randomizeSeed=false; S.seed=meta.seed;
            seedInp.setVal(meta.seed); _advSeedInp.setVal(meta.seed); _advSeedRefresh();
          }
          // LoRAs — grow slots if the saved generation used more than we currently show
          const _metaLoraCount=Array.isArray(meta.userLoras)?meta.userLoras.length:0;
          const _wantSlots=Math.min(_UL_MAX,Math.max(_UL_DEFAULT,_metaLoraCount));
          if(S.userLoras.length!==_wantSlots){
            if(S.userLoras.length<_wantSlots){
              while(S.userLoras.length<_wantSlots) S.userLoras.push({name:"",strength:1.0,enabled:true});
            } else {
              S.userLoras.length=_wantSlots;
            }
            _ulRebuildRows();
          }
          // Always reset all slots first (incl. trigger rows + enabled state), then apply what meta has
          _ulRowEls.forEach((r,i)=>{
            S.userLoras[i]={name:"",strength:0,enabled:true};
            r._reset();
          });
          if(Array.isArray(meta.userLoras)&&meta.userLoras.length&&_loraList.length){
            const nd=(s)=>(s||"").replace(/\\/g,"/").toLowerCase();
            const loraOpts=["none",..._loraList];
            meta.userLoras.forEach((ul,i)=>{
              if(i>=_ulRowEls.length) return;
              const basename=nd(ul.n||"").split("/").pop();
              const match=loraOpts.find(o=>nd(o)===nd(ul.n||""))||
                loraOpts.find(o=>nd(o).split("/").pop()===basename);
              if(match&&match!=="none"){
                S.userLoras[i].name=match; S.userLoras[i].strength=+(ul.s??1); S.userLoras[i].enabled=true;
                _ulRowEls[i]._dd.set(match); _ulRowEls[i]._str.value=String(S.userLoras[i].strength);
                _ulRowEls[i]._refreshTrig(match); _ulRowEls[i]._applyEnabled();
              }
            });
          }
          _ulUpdateBtn();
          updateSizeControls(); persist();
        }catch(err){
          console.warn("[FluxKlein] _lbApplyMeta error:",err);
        }
      };

      lbFavBtn.onclick=async()=>{
        const v=_lbActiveImg; if(!v) return;
        const newFav=!(_galMetas[v.filename]?.favorite===true);
        try{
          const r=await api.fetchApi("/flux_klein/update_meta",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({filename:v.filename,subfolder:v.subfolder||"",patch:{favorite:newFav}}),
          });
          const d=await r.json();
          if(d.ok){
            const cached=_galMetas[v.filename]||{};
            cached.favorite=newFav;_galMetas[v.filename]=cached;
            _setLbFav(newFav);
            lbFavBtn.classList.remove("fk-heart-anim");
            void lbFavBtn.offsetWidth;
            lbFavBtn.classList.add("fk-heart-anim");
            galGrid.querySelectorAll("[data-filename]").forEach(cell=>{
              if(cell.dataset.filename===v.filename){
                const ico=cell.querySelector("._favico");
                if(ico){ ico.style.opacity=newFav?"1":"0"; }
              }
            });
            if(_galFavOnly&&!newFav) galGrid.querySelector(`[data-filename="${CSS.escape(v.filename)}"]`)?.remove();
          }
        }catch(e){ console.warn("[FluxKlein] fav:",e); }
      };

      lbClose.onclick=_lbClose;

      // Upload an output image into ComfyUI's input folder so LoadImage can reference it.
      // Returns the uploaded input filename, or null on failure.
      const _uploadOutputToInput=async(v)=>{
        const outputUrl=api.apiURL(`/view?filename=${encodeURIComponent(v.filename)}&type=output&subfolder=${encodeURIComponent(v.subfolder||"")}`);
        const resp=await fetch(outputUrl);
        if(!resp.ok) throw new Error("fetch "+resp.status);
        const blob=await resp.blob();
        const fd=new FormData();
        fd.append("image",new File([blob],v.filename,{type:blob.type||"image/png"}));
        fd.append("overwrite","true");
        const up=await api.fetchApi("/upload/image",{method:"POST",body:fd});
        const upd=await up.json();
        return upd.name||v.filename;
      };

      // Loads a gallery output image into Image 1 slot and switches to EDIT. Does not touch the preview box.
      const _lbLoadIntoUI=async(v)=>{
        if(activePill!=="edit") setPill("edit");
        let inputName;
        try{
          inputName=await _uploadOutputToInput(v);
        }catch(err){
          console.warn("[FluxKlein] load-into-ui upload:",err);
          inputName=v.filename;
        }
        S.image1Name=inputName;
        img1Slot._restorePreview(inputName);
        updateSizeControls();persist();
        lightbox.style.display="none";_lbActiveImg=null;
        closeOverlayFade(galleryOverlay);
      };

      // Load a gallery image into a specific slot (1 or 2), switch to EDIT
      const _loadIntoSlot=async(v, slotNum)=>{
        if(activePill!=="edit") setPill("edit");
        let inputName;
        try{
          inputName=await _uploadOutputToInput(v);
        }catch(err){
          console.warn("[FluxKlein] load-into-slot upload:",err);
          inputName=v.filename;
        }
        if(slotNum===2){
          S.image2Name=inputName;
          img2Slot._restorePreview(inputName);
        } else {
          S.image1Name=inputName;
          img1Slot._restorePreview(inputName);
        }
        updateSizeControls();persist();
        lightbox.style.display="none";_lbActiveImg=null;
        closeOverlayFade(galleryOverlay);
      };

      // Load into PAINT slot — switches to PAINT pill
      const _loadIntoPaintSlot=async(v)=>{
        if(activePill!=="inpaint") setPill("inpaint");
        let inputName;
        try{ inputName=await _uploadOutputToInput(v); }
        catch(err){ console.warn("[FluxKlein] load-into-paint:",err); inputName=v.filename; }
        _paintSlot._restorePreview(inputName);
        _maskName=null;_opMaskName=null;_opPaddedW=0;_opPaddedH=0;_opLetterbox=null;_maskSavedData=null;_maskSavedW=0;_maskSavedH=0;
        const sub=_inpaintBtn.querySelectorAll("div")[1];
        if(sub) tx(sub,"Paint mask over image");
        persist();
        lightbox.style.display="none";_lbActiveImg=null;
        closeOverlayFade(galleryOverlay);
      };

      // Load into FACESWAP target or source slot — switches to FACESWAP pill
      const _loadIntoI2ISlot=async(v)=>{
        if(activePill!=="i2i") setPill("i2i");
        let inputName;
        try{ inputName=await _uploadOutputToInput(v); }
        catch(err){ console.warn("[FluxKlein] load-into-i2i:",err); inputName=v.filename; }
        S.i2iImage=inputName; i2iSlot._restorePreview(inputName);
        persist();
        lightbox.style.display="none";_lbActiveImg=null;
        closeOverlayFade(galleryOverlay);
      };

      const _loadIntoFsSlot=async(v,which)=>{
        if(activePill!=="faceswap") setPill("faceswap");
        let inputName;
        try{ inputName=await _uploadOutputToInput(v); }
        catch(err){ console.warn("[FluxKlein] load-into-fs:",err); inputName=v.filename; }
        if(which==="source"){
          S.fsSource=inputName; _fsSourceSlot._restorePreview(inputName);
        } else {
          S.fsTarget=inputName; _fsTargetSlot._restorePreview(inputName);
        }
        persist();
        lightbox.style.display="none";_lbActiveImg=null;
        closeOverlayFade(galleryOverlay);
      };

      // mkApplyIcon for Load button (same as LTX node)
      const _mkApplyIcon=(size)=>{
        size=size||"13px";
        const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
        svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("width",size);svg.setAttribute("height",size);
        svg.style.fill="currentColor";svg.style.display="block";svg.style.flexShrink="0";
        const r1=document.createElementNS("http://www.w3.org/2000/svg","rect");
        r1.setAttribute("x","3");r1.setAttribute("y","3");r1.setAttribute("width","13");r1.setAttribute("height","13");
        r1.setAttribute("rx","2");r1.setAttribute("fill","none");r1.setAttribute("stroke","currentColor");r1.setAttribute("stroke-width","2");
        const r2=document.createElementNS("http://www.w3.org/2000/svg","rect");
        r2.setAttribute("x","8");r2.setAttribute("y","8");r2.setAttribute("width","13");r2.setAttribute("height","13");r2.setAttribute("rx","2");
        svg.appendChild(r1);svg.appendChild(r2);return svg;
      };

      // Build / append grid cells
      const _galAppend=(images,startIdx)=>{
        images.forEach((v,i)=>{
          const idx=startIdx+i;
          const cell=mk("div",{
            position:"relative",borderRadius:"8px",overflow:"hidden",
            background:C.bg2,border:`1px solid ${C.border}`,
            cursor:"pointer",transition:"border-color .15s",
            aspectRatio:"1/1",
          });
          cell.dataset.filename=v.filename;
          cell.dataset.idx=String(idx);

          // Thumbnail
          const thumb=mk("img",{
            width:"100%",height:"100%",objectFit:"cover",
            display:"block",background:C.bg3,position:"absolute",inset:"0",
          });
          thumb.loading="lazy";
          thumb.src=_galImgUrl(v)+"&t="+v.mtime;

          // Hover overlay
          const ov=mk("div",{position:"absolute",inset:"0",background:"rgba(0,0,0,.35)",
            opacity:"0",transition:"opacity .15s",pointerEvents:"none"});

          // Filename strip at bottom
          const strip=mk("div",{
            position:"absolute",bottom:"0",left:"0",right:"0",
            padding:"3px 6px",fontSize:"8px",color:"#ccc",
            background:"rgba(0,0,0,.65)",
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
          });
          tx(strip,v.filename);

          // Fav indicator
          const favIco=mk("div",{
            position:"absolute",bottom:"22px",right:"5px",
            opacity:"0",transition:"opacity .15s",
            color:LIME,pointerEvents:"none",
            textShadow:"0 1px 2px rgba(0,0,0,.9)",
          });
          favIco.className="_favico";
          favIco.appendChild(_mkHeart("11px"));

          cell.append(thumb,ov,strip,favIco);

          cell.onmouseenter=()=>{ cell.style.borderColor=LIME;ov.style.opacity="1"; };
          cell.onmouseleave=()=>{ cell.style.borderColor=C.border;ov.style.opacity="0"; };

          cell.onclick=()=>{ _lbNavList=images; lbShow(v,idx); };
          cell.addEventListener("contextmenu",(e)=>{
            e.preventDefault();
            _galCtxImg=v;
            _galCtxMenu.style.display="flex";
            _galCtxMenu.style.left=e.clientX+"px";
            _galCtxMenu.style.top=e.clientY+"px";
          });

          if(v.favorite===true){
            favIco.style.opacity="1";
            cell.style.background="linear-gradient(180deg,rgba(240,255,65,.12) 0%,rgba(240,255,65,.04) 100%)";
            cell.style.borderColor="rgba(240,255,65,.4)";
          }

          galGrid.appendChild(cell);
        });
      };

      const galLoad=async(reset=true,limit=GAL_LIMIT)=>{
        if(_galLoading&&!reset) return;
        _galLoading=true;
        galMoreWrap.style.display="flex";
        if(reset){ _galImages=[];_galMetas={};_galOffset=0;galGrid.innerHTML=""; }
        tx(galTitle,`Gallery  (loading…)`);
        try{
          if(_galFavOnly){
            // Fast path: single request, server resolves favorites index
            const r=await api.fetchApi(`/flux_klein/gallery?offset=${_galOffset}&limit=${limit}&subfolder=one-node-flux-2-klein&favonly=1`);
            const d=await r.json();
            const newImgs=d.images||[];
            _galTotal=d.total||0;
            _galImages.push(...newImgs);
            _galOffset=_galImages.length;
            _galAppend(newImgs,_galImages.length-newImgs.length);
            galEmpty.style.display=_galImages.length?"none":"block";
            tx(galTitle,`Gallery  (${_galTotal} fav)`);
            galMoreWrap.style.display=_galOffset<_galTotal?"flex":"none";
          } else {
            const r=await api.fetchApi(`/flux_klein/gallery?offset=${_galOffset}&limit=${limit}&subfolder=one-node-flux-2-klein`);
            const d=await r.json();
            const newImgs=d.images||[];
            _galTotal=d.total||0;
            const startIdx=_galImages.length;
            _galImages.push(...newImgs);
            _galOffset=_galImages.length;
            galEmpty.style.display=_galImages.length?"none":"block";
            _galAppend(newImgs,startIdx);
            tx(galTitle,`Gallery  (${_galTotal})`);
            galMoreWrap.style.display=_galOffset<_galTotal?"flex":"none";
          }
        }catch(e){
          tx(galTitle,"Gallery  (error)");
          console.warn("[FluxKlein] gallery:",e);
        }finally{
          _galLoading=false;
          if(_galOffset>=_galTotal) galMoreWrap.style.display="none";
        }
      };

      galMoreBtn.onclick=()=>galLoad(false,GAL_MORE); // kept for compatibility
      galRefreshBtn.onclick=()=>galLoad(true);
      galClose.onclick=()=>closeOverlayFade(galleryOverlay,()=>{ lightbox.style.display="none"; _lbActiveImg=null; });
      galleryBtn.onclick=e=>{
        e.stopPropagation();
        openOverlay(galleryOverlay);
        if(_galNeedsRefresh||_galImages.length===0){ galLoad(true); _galNeedsRefresh=false; }
      };

      // Mark gallery as needing refresh after a successful generation
      // _galNeedsRefresh is set to true in showFinal so gallery auto-refreshes on next open

      // ── ASSEMBLE ─────────────────────────────────────────────────────────
      pad.append(topBar,mainRow);
      // Layout mode places promptWrap either in the left column ("tall" → preview
      // gets full height, good for portrait) or full-width under the preview ("classic").
      _applyLayout(S.layoutMode);
      root.appendChild(helpOverlay);
      root.appendChild(settingsOverlay);
      root.appendChild(galleryOverlay);
      root.appendChild(_promptOverlay);
      root.appendChild(_inspireOverlay);
      root.appendChild(_sketchOv);
      root.appendChild(_maskOv);
      scrollEl.appendChild(pad);
      root.appendChild(scrollEl);

      // ── Esc in any number/text input → blur (dismiss focus) ──────────────
      root.addEventListener("keydown",(e)=>{
        if(e.key!=="Escape") return;
        const t=e.target;
        if(t&&(t.tagName==="INPUT")&&t.type!=="range"){ e.stopPropagation(); t.blur(); }
      },true);

      const _creditEl=mk("div",{
        position:"absolute",bottom:"5px",left:"12px",right:"12px",
        fontSize:"8px",color:"#555",pointerEvents:"none",
        letterSpacing:".04em",userSelect:"none",zIndex:"1",
        display:"flex",alignItems:"center",justifyContent:"space-between",
      });
      const _shortcutsEl=mk("span",{color:"#444",letterSpacing:".03em"});
      tx(_shortcutsEl,"D · discover  G · gallery  Space · generate  F · fullscreen");
      const _creditTxt=mk("div",{fontSize:"8px",color:"#555",letterSpacing:".04em",whiteSpace:"nowrap"});
      tx(_creditTxt,"created by yanokusnir");
      _creditEl.style.justifyContent="";
      _creditEl.innerHTML="";
      _creditEl.style.pointerEvents="auto";

      // Left: shortcuts toggle button + expanded bar
      const _scLeft=mk("div",{flex:"1",display:"flex",alignItems:"center",gap:"6px"});
      const _scToggleBtn=mk("button",{
        background:"transparent",border:`1px solid ${C.border}`,borderRadius:"4px",
        padding:"1px 6px",fontSize:"7px",fontWeight:"600",color:C.muted,
        cursor:"pointer",outline:"none",letterSpacing:".05em",textTransform:"uppercase",
        transition:"border-color .15s,color .15s",whiteSpace:"nowrap",flexShrink:"0",
      });
      tx(_scToggleBtn,"Shortcuts");
      _scToggleBtn.onmouseenter=()=>{_scToggleBtn.style.borderColor=C.text;_scToggleBtn.style.color=C.text;};
      _scToggleBtn.onmouseleave=()=>{_scToggleBtn.style.borderColor=C.border;_scToggleBtn.style.color=C.muted;};

      const _scBar=mk("div",{display:"none",alignItems:"center",flexShrink:"0",gap:"0",cursor:"pointer"});
      [["D","Discover"],["F","Fullscreen preview"],["G","Gallery"],["Esc","Exit prompt"],["Space","Generate"]].forEach(([key,desc],idx)=>{
        if(idx>0){ const sep=mk("div",{width:"1px",height:"8px",background:C.border,margin:"0 6px",flexShrink:"0"});_scBar.appendChild(sep); }
        const item=mk("div",{display:"flex",alignItems:"center",gap:"3px"});
        const kbd=mk("span",{fontSize:"7px",fontWeight:"700",color:"#111",background:C.muted,borderRadius:"3px",padding:"0px 3px",letterSpacing:".02em",flexShrink:"0",lineHeight:"1.7"});
        tx(kbd,key);
        const lbl=mk("span",{fontSize:"7px",color:C.muted,whiteSpace:"nowrap"});
        tx(lbl,desc);
        item.append(kbd,lbl);
        _scBar.appendChild(item);
      });
      _scBar.onclick=()=>{ _scBar.style.display="none"; _scToggleBtn.style.display=""; };
      _scToggleBtn.onclick=()=>{ _scToggleBtn.style.display="none"; _scBar.style.display="flex"; };

      _scLeft.append(_scToggleBtn,_scBar);

      // Right: credit
      const _creditRight=mk("div",{flex:"1",display:"flex",justifyContent:"flex-end",pointerEvents:"none"});
      _creditRight.appendChild(_creditTxt);

      _creditEl.append(_scLeft,_creditRight);
      root.appendChild(_creditEl);


      // Initialize visibility
      updatePillVisibility();
      updateSizeControls();

      // ── F key → fullscreen current preview image inside the node overlay ──
      // Listen on document; only fire when mouse is over this node's root element.
      let _mouseOverRoot=false;
      root.addEventListener("mouseenter",()=>{ _mouseOverRoot=true; });
      root.addEventListener("mouseleave",()=>{ _mouseOverRoot=false; });

      const _fKeyHandler=(e)=>{
        if(e.key!=="f"&&e.key!=="F") return;
        if(!_mouseOverRoot) return;
        // Don't fire when typing in a text field
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        // Don't fire when any overlay is open inside the node
        if(settingsOverlay.style.display!=="none") return;
        if(galleryOverlay.style.display!=="none") return;
        if(_promptOverlay.style.display!=="none") return;
        if(_inspireOverlay.style.display!=="none") return;
        if(_sketchOv.style.display!=="none") return;
        if(_nodeFsOv&&_nodeFsOv.style.display!=="none"){_nodeFsOv._close();return;}

        // Get currently visible image
        let src="", name="", fsType="image", fsOpts=null;
        if(comparerWrap.style.display!=="none"&&comparerGenImg.src){
          src=comparerGenImg.src;
          name="Before / After";
          fsType="comparer";
          fsOpts={
            genSrc:comparerGenImg.src,
            baseSrc:comparerBase.src,
          };
        } else if(finalImg.style.display!=="none"&&finalImg.src){
          src=finalImg.src;
          name="Preview";
        }
        if(!src) return;

        e.preventDefault();
        e.stopPropagation();
        _initNodeFsOverlay()._open(fsType,src,name,fsOpts);
      };
      document.addEventListener("keydown",_fKeyHandler);

      // ── D key → open/close Discover (Get Inspired) ───────────────────────
      document.addEventListener("keydown",(e)=>{
        if(e.key!=="d"&&e.key!=="D") return;
        if(!_mouseOverRoot) return;
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        if(settingsOverlay.style.display!=="none") return;
        if(galleryOverlay.style.display!=="none") return;
        if(_sketchOv.style.display!=="none") return;
        if(_maskOv.style.display!=="none") return;
        if(_nodeFsOv&&_nodeFsOv.style.display!=="none") return;
        e.preventDefault();e.stopPropagation();
        if(_inspireOverlay.style.display!=="none"){ _closeInspire(); }
        else { _openInspire(); }
      });

      // ── G key → open Gallery (grid view) ─────────────────────────────────
      document.addEventListener("keydown",(e)=>{
        if(e.key!=="g"&&e.key!=="G") return;
        if(!_mouseOverRoot) return;
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        if(settingsOverlay.style.display!=="none") return;
        if(_promptOverlay.style.display!=="none") return;
        if(_inspireOverlay.style.display!=="none") return;
        if(_sketchOv.style.display!=="none") return;
        if(_maskOv.style.display!=="none") return;
        if(_nodeFsOv&&_nodeFsOv.style.display!=="none") return;
        // If gallery is open (grid view, no lightbox) → close it
        if(galleryOverlay.style.display!=="none"&&lightbox.style.display==="none"){
          closeOverlayFade(galleryOverlay,()=>{ lightbox.style.display="none"; _lbActiveImg=null; });
          e.preventDefault();e.stopPropagation();return;
        }
        if(galleryOverlay.style.display!=="none") return;
        e.preventDefault();e.stopPropagation();
        galleryBtn.click();
      });

      // ── Space → trigger Generate (main UI only) ───────────────────────────
      document.addEventListener("keydown",(e)=>{
        if(e.code!=="Space") return;
        if(!_mouseOverRoot) return;
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        if(settingsOverlay.style.display!=="none") return;
        if(galleryOverlay.style.display!=="none") return;
        if(_promptOverlay.style.display!=="none") return;
        if(_inspireOverlay.style.display!=="none") return;
        if(_sketchOv.style.display!=="none") return;
        if(_maskOv.style.display!=="none") return;
        if(_nodeFsOv&&_nodeFsOv.style.display!=="none") return;
        e.preventDefault();e.stopPropagation();
        genBtn.click();
      });

      // (fullscreen Esc guard is applied per-handler below)

      // ── Escape → close Get Inspired overlay ──────────────────────────────
      document.addEventListener("keydown",(e)=>{
        if(e.key!=="Escape") return;
        if(_inspireOverlay.style.display==="none") return;
        e.preventDefault();e.stopPropagation();
        _closeInspire();
      });

      // ── E → toggle Edit mode in Discover overlay ──────────────────────────
      document.addEventListener("keydown",(e)=>{
        if(e.key!=="e"&&e.key!=="E") return;
        if(_inspireOverlay.style.display==="none") return;
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        e.preventDefault();e.stopPropagation();
        _inspireShowFullBtn.click();
      });

      // ── Escape in gallery grid → close gallery ────────────────────────────
      document.addEventListener("keydown",(e)=>{
        if(e.key!=="Escape") return;
        if(!_mouseOverRoot) return;
        if(galleryOverlay.style.display==="none") return;
        if(e._lbHandled) return; // lightbox already handled this Escape — stay in grid
        e.preventDefault();e.stopPropagation();
        closeOverlayFade(galleryOverlay,()=>{ lightbox.style.display="none"; _lbActiveImg=null; });
      });

      // ── Escape → close Settings / Help overlays ──────────────────────────
      document.addEventListener("keydown",(e)=>{
        if(e.key!=="Escape") return;
        if(settingsOverlay.style.display!=="none"){ e.preventDefault();e.stopPropagation();closeOverlayFade(settingsOverlay);return; }
        if(helpOverlay.style.display!=="none"){ e.preventDefault();e.stopPropagation();closeOverlayFade(helpOverlay);return; }
      });

      // ── Paste image from clipboard (Ctrl+V) ──────────────────────────────────
      document.addEventListener("paste",async(e)=>{
        const _sketchOpen=_sketchOv&&_sketchOv.style.display!=="none";
        if(!_mouseOverRoot&&!_sketchOpen) return;
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        const items=[...(e.clipboardData?.items||[])];
        const imgItem=items.find(i=>i.type.startsWith("image/"));
        if(!imgItem) return;
        e.preventDefault();e.stopPropagation();
        const raw=imgItem.getAsFile();
        if(!raw) return;
        // Clipboard files all share the same generic name ("image.png"), so two
        // pastes would overwrite each other in the input folder (overwrite:true)
        // and both slots would end up pointing at the same file. Give each paste
        // a unique name so the slots stay independent.
        const ext=(raw.type.split("/")[1]||"png").replace("jpeg","jpg");
        const uniqueName=`pasted_${Date.now()}_${Math.floor(Math.random()*1e4)}.${ext}`;
        let file;
        try{ file=new File([raw],uniqueName,{type:raw.type}); }
        catch(_){ file=raw; file.name=uniqueName; } // fallback for older browsers
        // If the Sketch canvas is open, paste the image as a new layer instead.
        if(_sketchOv&&_sketchOv.style.display!=="none"){
          _sketchAddImageLayer(file);
          return;
        }
        // Pick target slot based on active pill and slot state
        let targetSlot=null;
        if(activePill==="edit"){
          targetSlot=!img1Slot.hasFile()?img1Slot:img2Slot;
        } else if(activePill==="i2i"){
          targetSlot=i2iSlot;
        } else if(activePill==="inpaint"){
          targetSlot=_paintSlot;
        } else if(activePill==="faceswap"){
          targetSlot=!_fsTargetSlot.hasFile()?_fsTargetSlot:_fsSourceSlot;
        }
        if(targetSlot) targetSlot.loadFile(file);
      },{capture:true});

      // Fetch models
      const _loadModels=()=>api.fetchApi("/flux_klein/models")
        .then(r=>r.json())
        .then(d=>{
          const _norm=(s)=>(s||"").replace(/\\/g,"/").toLowerCase();
          // pick: saved value takes priority; keyword auto-select only when no saved value matches
          const pick=(list,saved,kw)=>{
            if(!list?.length) return saved;
            const ns=_norm(saved||"");
            // 1. exact match
            let r=list.find(i=>_norm(i)===ns);
            if(r) return r;
            // 2. basename match
            if(ns){
              const base=ns.split("/").pop();
              r=list.find(i=>_norm(i).split("/").pop()===base);
              if(r) return r;
            }
            // 3. no saved value — use keyword auto-select
            if(kw){
              const kws=kw.split(',').map(k=>k.trim().toLowerCase());
              r=list.find(f=>kws.every(k=>_norm(f).includes(k)));
              if(r) return r;
            }
            // 4. fallback: first item
            return list[0]||saved;
          };
          const modelList=(d.diffusion_models||[]).filter(f=>f!=="none");
          if(modelList.length){const v=pick(modelList,S.model,"klein");S.model=v;modelF.dd.updateItems(modelList);modelF.dd.set(v);}
          else{S.model="";modelF.dd.updateItems(["none"]);modelF.dd.set("none");}
          const teList=(d.text_encoders||[]).filter(f=>f!=="none");
          if(teList.length){const v=pick(teList,S.textEncoder,"qwen");S.textEncoder=v;teF.dd.updateItems(teList);teF.dd.set(v);}
          else{S.textEncoder="";teF.dd.updateItems(["none"]);teF.dd.set("none");}
          const vaeList=(d.vaes||[]).filter(f=>f!=="none");
          if(vaeList.length){const v=pick(vaeList,S.vae,"flux2");S.vae=v;vaeF.dd.updateItems(vaeList);vaeF.dd.set(v);}
          else{S.vae="";vaeF.dd.updateItems(["none"]);vaeF.dd.set("none");}
          persist();
          // Populate LoRA dropdowns
          const loraList=(d.loras||[]).filter(f=>f!=="none");
          _loraList=loraList;
          const loraOpts=["none",...loraList];
          _ulRowEls.forEach((r,i)=>{
            r._dd.updateItems(loraOpts);
            const saved=S.userLoras[i].name;
            if(saved&&saved!=="none"&&loraList.length){
              const nd=(s)=>s.replace(/\\/g,"/").toLowerCase();
              const match=loraOpts.find(o=>nd(o)===nd(saved))||
                loraOpts.find(o=>nd(o).split("/").pop()===nd(saved).split("/").pop());
              if(match){r._dd.set(match);S.userLoras[i].name=match;}
              else{r._dd.set("none");S.userLoras[i].name="";}
            } else{r._dd.set("none");S.userLoras[i].name="";}
          });
          _ulUpdateBtn();
          // Faceswap LoRA dropdown
          fsLoraF.dd.updateItems(loraOpts);
          if(loraList.length){
            const nd=(s)=>(s||"").replace(/\\/g,"/").toLowerCase();
            const fsMatch=loraOpts.find(o=>nd(o)===nd(S.fsLora||""))||
              loraOpts.find(o=>nd(o).split("/").pop()===nd(S.fsLora||"").split("/").pop());
            if(fsMatch&&fsMatch!=="none"){fsLoraF.dd.set(fsMatch);S.fsLora=fsMatch;}
            else{fsLoraF.dd.set("none");S.fsLora="";}
          } else{fsLoraF.dd.set("none");S.fsLora="";}
          persist();
        })
        .catch(e=>console.warn("[FluxKlein] models:",e));
      _loadModels();
      if(S.extLoaders){
        _applyExtLoaders(true);
      } else {
        // Toggle is off, but a GGUF wire may have been kept connected (and restored
        // by litegraph from the saved workflow). Resize the node to fit any such slots.
        const _n=app.graph.getNodeById(self.id)||self;
        if(_n){
          const _keep=(_n.inputs||[]).filter(i=>_extInputNames.includes(i.name)).length;
          if(_keep>0){ _n.size=[NODE_W, NODE_H+_keep*_slotH]; _n.setDirtyCanvas(true,true); }
        }
      }
      _refreshExtInputUI();

      // Auto-refresh Settings dropdowns when connections change
      self.onConnectionsChange=function(){ _refreshExtInputUI(); };



      const _slotHInit=(self.inputs||[]).length*(LiteGraph.NODE_SLOT_HEIGHT||20);
      this.addDOMWidget("fk_ui","div",root,{
        getValue(){return null;},setValue(){},serialize:false,
        computeSize(){const slotH=(LiteGraph.NODE_SLOT_HEIGHT||20);const n=(self.inputs||[]).length;return[NODE_W,NODE_H+n*slotH];},
      });
      this.setSize([NODE_W,NODE_H+_slotHInit]);

      // Nodes 2.0: hide the auto-injected node-type name badge rendered in the node footer.
      // The badge has class "bg-node-component-surface" (Tailwind) and contains the node type string.
      const _hideNodes2Badge=()=>{
        // Walk up from root to find the node-level container (up to 6 levels)
        let el=root;
        for(let i=0;i<6;i++){
          el=el?.parentElement;
          if(!el) break;
          el.querySelectorAll("[class*='bg-node-component-surface']").forEach(badge=>{
            badge.style.display="none";
          });
        }
      };
      requestAnimationFrame(()=>{
        _hideNodes2Badge();
        if(typeof MutationObserver!=="undefined"){
          let obs=root;
          for(let i=0;i<4;i++) obs=obs?.parentElement||obs;
          new MutationObserver(_hideNodes2Badge).observe(obs,{childList:true,subtree:true});
        }
      });

      if(!window.__fluxklein_nodes) window.__fluxklein_nodes={};
      window.__fluxklein_nodes[this.id]={
        root,S,
        fns:{showFinal,showPreview,resetBtn,setStage,showError,clearError,getPromptId:()=>_activePromptId},
      };
      _activeS=S;
      _activeShowFinal=showFinal;
      _activeShowPreview=showPreview;
      _activeResetBtn=resetBtn;
      _activeSetStage=setStage;
      _activeShowError=showError;
      _activePromptIdRef=()=>_activePromptId;
    };
  },
});
