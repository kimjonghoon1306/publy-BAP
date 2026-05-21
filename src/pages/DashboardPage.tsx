import React, { useState, useEffect, useCallback, useRef } from "react";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount, upsertAccount, useQuota, addHistory } from "../lib/supabase";
import { supabase } from "../lib/supabase";

type MainTab = "keyword" | "write" | "image" | "publish" | "manage" | "accounts" | "settings";
type PublishConcept = "full" | "body_faq" | "body_only";

const BOT = "http://localhost:3333";
const EXE_DOWNLOAD_URL = "https://github.com/kimjonghoon13/publy-BAP/releases/latest/download/Publy-Setup.exe";
const BATCH = 30;
const MAX_TITLES = 90;
const MAX_KW = 90;
const GEMINI_MODELS = ["gemini-2.0-flash","gemini-2.0-flash-lite","gemini-2.5-flash","gemini-2.5-flash-lite"];
const PLAN_LABELS: Record<string,string> = {free:"FREE",basic:"BASIC",pro:"PRO"};

const WRITE_AI_LIST = [
  {id:"gemini",label:"Gemini Flash",sub:"무료",placeholder:"AIza...",storageKey:"publy_gemini_key",link:"https://aistudio.google.com/app/apikey",color:"#4285F4",logo:"G",free:true},
  {id:"groq",  label:"Groq Llama 3",sub:"무료",placeholder:"gsk_...",storageKey:"publy_groq_key",  link:"https://console.groq.com/keys",          color:"#F55036",logo:"L",free:true},
  {id:"openai",label:"GPT-4o",       sub:"유료",placeholder:"sk-...", storageKey:"publy_openai_key",link:"https://platform.openai.com/api-keys",   color:"#10A37F",logo:"O",free:false},
];
const IMAGE_AI_LIST = [
  {id:"openai_img",label:"DALL-E 3",         sub:"유료",placeholder:"sk-...", storageKey:"publy_openai_key",   link:"https://platform.openai.com/api-keys",     color:"#10A37F",logo:"O"},
  {id:"replicate", label:"Flux (Replicate)", sub:"유료",placeholder:"r8_...", storageKey:"publy_replicate_key",link:"https://replicate.com/account/api-tokens", color:"#8B5CF6",logo:"R"},
];
const MAIN_TABS = [
  {k:"keyword", i:"🔍", l:"키워드/제목"},
  {k:"write",   i:"✍️", l:"글 생성"},
  {k:"image",   i:"🖼️", l:"이미지 생성"},
  {k:"publish", i:"🚀", l:"발행하기"},
  {k:"manage",  i:"📋", l:"발행 관리"},
  {k:"accounts",i:"🔗", l:"계정 관리"},
  {k:"settings",i:"⚙️", l:"설정"},
] as const;

function KeyInput({k}:{k:any; [x:string]:any}) {
  const [val,setVal]=useState(()=>localStorage.getItem(k.storageKey)||"");
  const [show,setShow]=useState(false);
  const [saved,setSaved]=useState(false);
  function save(){if(!val.trim())return;localStorage.setItem(k.storageKey,val.trim());setSaved(true);setTimeout(()=>setSaved(false),2500);}
  return (
    <div style={{marginBottom:10,padding:"12px 14px",borderRadius:12,border:"1px solid var(--border)",background:"var(--bg)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <div style={{width:24,height:24,borderRadius:7,background:`${k.color}20`,color:k.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,flexShrink:0}}>{k.logo}</div>
        <span style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{k.label}</span>
        <span style={{fontSize:10,color:"var(--text2)"}}>{k.sub}</span>
        <a href={k.link} target="_blank" rel="noopener noreferrer" style={{marginLeft:"auto",fontSize:11,color:"var(--accent-text)",textDecoration:"none",fontWeight:600}}>키 발급 →</a>
      </div>
      <div style={{display:"flex",gap:6}}>
        <input className="inp" type={show?"text":"password"} placeholder={k.placeholder} value={val} onChange={e=>setVal(e.target.value)} style={{flex:1,fontSize:13,padding:"9px 12px"}}/>
        <button className="btn-ghost" onClick={()=>setShow(s=>!s)}>{show?"숨김":"표시"}</button>
        <button style={{padding:"9px 16px",borderRadius:8,border:"none",background:saved?"#00c875":"var(--accent)",color:"#000",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",transition:"all .2s"}} onClick={save}>{saved?"✓":"저장"}</button>
      </div>
    </div>
  );
}
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes dlFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.02)}}
@keyframes guideFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes guideIn{from{opacity:0;transform:scale(.92) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes imgIn{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}
.app.dark{
  --bg:#080c10;--bg2:#0d1117;--card:#111820;--card2:#161d27;--card-hover:#1a2230;
  --border:#1e2836;--border2:#2a3a4f;--border-focus:#4da6ff;
  --text:#e8f4ff;--text2:#7a9ab5;--text3:#4a6478;
  --accent:#00ff9d;--accent-dim:rgba(0,255,157,.08);--accent-30:rgba(0,255,157,.3);
  --accent-text:#00ff9d;--accent-bg:rgba(0,255,157,.08);--accent-border:rgba(0,255,157,.25);
  --pink:#FF6B9D;--pink-bg:rgba(255,107,157,.08);--pink-border:rgba(255,107,157,.25);
  --yellow:#FFD93D;--yellow-bg:rgba(255,217,61,.08);--yellow-border:rgba(255,217,61,.25);
  --purple:#9B7DFF;--purple-bg:rgba(155,125,255,.08);
  --naver:#03C75A;--tistory:#FF6B35;
  --danger:#ff5363;--warn:#ff9f3f;--info:#4da6ff;--success:#00d68f;
  --header-bg:rgba(8,12,16,.94);--shadow:0 4px 24px rgba(0,0,0,.4);
}
.app.light{
  --bg:#f0f4f8;--bg2:#ffffff;--card:#ffffff;--card2:#f8fafc;--card-hover:#f0f4f8;
  --border:#d4e0ec;--border2:#b8cfe0;--border-focus:#0969da;
  --text:#0d1f2d;--text2:#4a6478;--text3:#8a9fb5;
  --accent:#0066cc;--accent-dim:rgba(0,102,204,.08);--accent-30:rgba(0,102,204,.3);
  --accent-text:#0066cc;--accent-bg:rgba(0,102,204,.08);--accent-border:rgba(0,102,204,.25);
  --pink:#e0396d;--pink-bg:rgba(224,57,109,.07);--pink-border:rgba(224,57,109,.25);
  --yellow:#cc8800;--yellow-bg:rgba(204,136,0,.08);--yellow-border:rgba(204,136,0,.25);
  --purple:#6d4fcc;--purple-bg:rgba(109,79,204,.07);
  --naver:#03C75A;--tistory:#FF6B35;
  --danger:#cf222e;--warn:#9a6700;--info:#0969da;--success:#1a7f37;
  --header-bg:rgba(240,244,248,.95);--shadow:0 2px 12px rgba(0,0,0,.08);
}
.app{width:100vw;height:100vh;font-family:'Noto Sans KR',sans-serif;color:var(--text);background:var(--bg);display:flex;flex-direction:column;overflow:hidden;transition:background .2s,color .2s;}
*::-webkit-scrollbar{width:5px;}*::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px;}
.header{height:58px;flex-shrink:0;display:flex;align-items:center;padding:0 16px;gap:10px;background:var(--header-bg);border-bottom:1px solid var(--border);backdrop-filter:blur(24px);position:sticky;top:0;z-index:100;}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;flex-shrink:0;}
.logo-ico{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#00ff9d,#00c870);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 12px rgba(0,255,157,.35);}
.logo-text{font-size:17px;font-weight:900;letter-spacing:.18em;color:var(--accent-text);font-family:'Space Grotesk',sans-serif;}
.header-mid{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;flex-wrap:wrap;}
.header-right{display:flex;align-items:center;gap:6px;margin-left:auto;}
.server-chip{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:99px;font-size:11px;font-weight:700;border:1px solid;white-space:nowrap;}
.server-on{background:rgba(0,214,143,.1);color:var(--success);border-color:rgba(0,214,143,.3);}
.server-off{background:rgba(120,120,120,.06);color:var(--text2);border-color:var(--border);}
.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.dot-on{background:var(--success);box-shadow:0 0 6px var(--success);}
.dot-off{background:var(--text3);}
.quota-chip{display:flex;align-items:center;gap:7px;padding:5px 12px;border-radius:99px;background:var(--card);border:1px solid var(--border);font-size:12px;font-weight:600;color:var(--text2);white-space:nowrap;}
.quota-bar-bg{width:56px;height:4px;background:var(--border);border-radius:99px;overflow:hidden;}
.quota-bar-fill{height:100%;background:var(--accent);border-radius:99px;transition:width .4s;}
.plan-badge{font-size:10px;font-weight:800;padding:3px 10px;border-radius:99px;letter-spacing:.08em;}
.plan-free{background:rgba(120,120,120,.1);color:var(--text2);border:1px solid var(--border);}
.plan-basic{background:rgba(77,166,255,.1);color:var(--info);border:1px solid rgba(77,166,255,.25);}
.plan-pro{background:rgba(0,214,143,.1);color:var(--success);border:1px solid rgba(0,214,143,.25);}
.icon-btn{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:15px;transition:all .15s;}
.icon-btn:hover{background:var(--card-hover);color:var(--text);border-color:var(--border-focus);}
.user-chip{display:flex;align-items:center;gap:7px;padding:5px 12px;border-radius:99px;background:var(--card);border:1px solid var(--border);cursor:pointer;font-size:12px;font-weight:600;color:var(--text);transition:all .15s;max-width:140px;}
.user-chip:hover{border-color:var(--border-focus);}
.user-avatar{width:22px;height:22px;border-radius:7px;background:var(--accent-bg);border:1px solid var(--accent-border);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:var(--accent-text);flex-shrink:0;}
.user-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.logout-btn{padding:6px 13px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;font-weight:600;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.logout-btn:hover{border-color:var(--danger);color:var(--danger);}
.dl-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:99px;border:none;background:linear-gradient(135deg,#00ff9d,#00c870);color:#000;font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;text-decoration:none;animation:dlFloat 2.5s ease-in-out infinite;white-space:nowrap;flex-shrink:0;box-shadow:0 3px 14px rgba(0,255,157,.35);}
.guide-open-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border-radius:99px;border:none;background:linear-gradient(135deg,#FF6B9D,#FF3D7F);color:#fff;font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;animation:guideFloat 2.8s ease-in-out infinite;white-space:nowrap;flex-shrink:0;box-shadow:0 3px 14px rgba(255,61,127,.35);}
.layout{flex:1;display:flex;overflow:hidden;min-height:0;}
.sidebar{width:196px;flex-shrink:0;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 8px;gap:2px;overflow-y:auto;}
.nav-lbl{font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--text3);padding:5px 11px 7px;margin-top:4px;}
.nav-item{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:9px;border:none;cursor:pointer;width:100%;font-size:13px;font-weight:500;font-family:'Noto Sans KR',sans-serif;color:var(--text2);background:transparent;transition:all .15s;text-align:left;position:relative;}
.nav-item:hover{background:var(--card-hover);color:var(--text);}
.nav-item.active{background:var(--accent-bg);color:var(--accent-text);font-weight:700;border:1px solid var(--accent-border);}
.nav-item.active::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:3px;border-radius:99px;background:var(--accent);}
.nav-ico{font-size:16px;flex-shrink:0;}
.nav-badge{margin-left:auto;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;background:var(--accent-bg);color:var(--accent-text);border:1px solid var(--accent-border);}
.sidebar-foot{margin-top:auto;padding:12px 6px 4px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.stat-card{padding:10px 12px;border-radius:11px;background:var(--card);border:1px solid var(--border);}
.stat-num{font-size:22px;font-weight:900;color:var(--text);line-height:1;font-family:'Space Grotesk',sans-serif;}
.stat-lbl{font-size:9px;color:var(--text2);margin-top:3px;font-weight:600;}
.main{flex:1;overflow-y:auto;padding:20px;min-width:0;}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin-bottom:14px;transition:border-color .15s;box-shadow:var(--shadow);}
.card:hover{border-color:var(--border2);}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;}
.card-title{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);display:flex;align-items:center;gap:7px;}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;border-radius:10px;border:none;font-size:14px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;white-space:nowrap;}
.btn:disabled{opacity:.42;cursor:not-allowed;}
.btn-primary{background:linear-gradient(135deg,var(--accent),#00cc80);color:#000;box-shadow:0 3px 14px var(--accent-30);}
.btn-primary:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px);}
.btn-secondary{background:var(--card2);color:var(--text);border:1px solid var(--border);}
.btn-secondary:hover:not(:disabled){background:var(--card-hover);border-color:var(--border2);}
.btn-danger{background:rgba(255,83,99,.1);color:var(--danger);border:1px solid rgba(255,83,99,.3);}
.btn-danger:hover:not(:disabled){background:rgba(255,83,99,.18);}
.btn-full{width:100%;}
.btn-xl{padding:16px 28px;font-size:16px;border-radius:12px;}
.btn-sm{padding:8px 16px;font-size:12px;border-radius:8px;}
.btn-ghost{padding:8px 13px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.btn-ghost:hover{background:var(--card-hover);color:var(--text);}
.btn-stop{background:rgba(255,83,99,.1);color:var(--danger);border:1.5px solid rgba(255,83,99,.35);padding:9px 18px;border-radius:99px;font-size:13px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:all .15s;}
.btn-stop:hover{background:rgba(255,83,99,.2);}
.flow-nav{display:flex;align-items:center;justify-content:center;gap:10px;margin:20px 0 4px;flex-wrap:wrap;}
.flow-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 26px;border-radius:99px;border:none;font-size:15px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .18s;}
.flow-btn:hover:not(:disabled){transform:translateY(-2px);}
.flow-btn:disabled{opacity:.4;cursor:not-allowed;}
.flow-btn-g{background:linear-gradient(135deg,var(--accent),#00cc80);color:#000;box-shadow:0 4px 20px var(--accent-30);}
.flow-btn-skip{background:var(--card2);color:var(--text2);border:1px solid var(--border);}
.inp{width:100%;padding:12px 14px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:all .15s;}
.inp:focus{border-color:var(--border-focus);box-shadow:0 0 0 3px rgba(77,166,255,.12);}
.inp::placeholder{color:var(--text3);}
.inp.lg{font-size:17px;padding:15px 16px;}
.inp-label{font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:6px;}
select.inp{cursor:pointer;appearance:auto;}
.dark select.inp{color-scheme:dark;}.light select.inp{color-scheme:light;}
textarea.inp{resize:vertical;line-height:1.75;min-height:80px;}
.spinner{width:16px;height:16px;border-radius:50%;border:2.5px solid rgba(0,0,0,.15);border-top-color:#000;animation:spin .7s linear infinite;display:inline-block;flex-shrink:0;}
.sp-w{border-color:rgba(255,255,255,.2);border-top-color:#fff;}
.sp-g{border-color:rgba(0,255,157,.2);border-top-color:var(--accent);}
.steps{display:flex;border-radius:13px;overflow:hidden;border:1px solid var(--border);margin-bottom:20px;background:var(--bg2);}
.step-item{flex:1;padding:11px 8px;text-align:center;font-size:12px;font-weight:600;color:var(--text3);background:transparent;border-right:1px solid var(--border);transition:all .2s;}
.step-item:last-child{border-right:none;}
.step-item.done{background:rgba(0,214,143,.06);color:var(--success);}
.step-item.active{background:var(--accent-bg);color:var(--accent-text);font-weight:800;}
.step-n{font-size:9px;display:block;margin-bottom:2px;opacity:.7;font-family:'Space Grotesk',sans-serif;font-weight:700;}
.adtype-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
.adtype-btn{padding:15px 16px;border-radius:13px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .18s;position:relative;}
.adtype-btn.sel-adpost{border-color:var(--naver);background:rgba(3,199,90,.07);}
.adtype-btn.sel-adsense{border-color:var(--info);background:rgba(77,166,255,.07);}
.adtype-lbl{font-size:14px;font-weight:800;color:var(--text);margin-bottom:3px;}
.adtype-sub{font-size:11px;color:var(--text2);line-height:1.55;}
.title-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));max-height:420px;overflow-y:auto;padding-right:3px;}
.title-card{padding:14px 15px;border-radius:11px;border:1.5px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .15s;position:relative;}
.title-card:hover{border-color:var(--border-focus);background:var(--card-hover);}
.title-card.sel{border-color:var(--accent);background:var(--accent-bg);}
.title-n{font-size:9px;color:var(--text3);margin-bottom:5px;font-family:'Space Grotesk',sans-serif;font-weight:600;}
.title-card.sel .title-n{color:var(--accent-text);}
.title-t{font-size:13px;font-weight:600;color:var(--text);line-height:1.55;}
.title-card.sel .title-t{color:var(--accent-text);font-weight:700;}
.title-chk{position:absolute;top:9px;right:9px;width:19px;height:19px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:9px;color:#000;font-weight:900;}
.sel-banner{padding:12px 15px;border-radius:11px;background:var(--accent-bg);border:1.5px solid var(--accent-border);margin-bottom:14px;animation:fadeUp .2s ease both;}
.sel-banner-lbl{font-size:10px;color:var(--accent-text);font-weight:700;margin-bottom:3px;}
.sel-banner-txt{font-size:14px;font-weight:800;color:var(--text);}
.img-gallery{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
.img-tw{position:relative;}
.img-th{width:88px;height:88px;object-fit:cover;border-radius:11px;border:2px solid var(--border);display:block;animation:imgIn .25s ease both;}
.img-th.first{border-color:var(--accent);box-shadow:0 0 10px var(--accent-30);}
.img-tb{position:absolute;top:-7px;left:-4px;font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:var(--accent);color:#000;}
.img-td{position:absolute;top:-6px;right:-6px;width:19px;height:19px;border-radius:50%;background:var(--danger);border:none;color:#fff;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;}
.img-td:hover{transform:scale(1.15);}
.img-prog{height:5px;background:var(--border);border-radius:99px;overflow:hidden;margin:10px 0 6px;}
.img-prog-fill{height:100%;background:linear-gradient(90deg,var(--accent),#00cc80);border-radius:99px;transition:width .4s;}
.concept-grid{display:grid;gap:10px;}
.concept-btn{padding:16px 18px;border-radius:13px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .18s;}
.concept-btn.sel-full{border-color:var(--accent);background:var(--accent-bg);}
.concept-btn.sel-faq{border-color:var(--pink);background:var(--pink-bg);}
.concept-btn.sel-body{border-color:var(--yellow);background:var(--yellow-bg);}
.concept-ico{font-size:22px;margin-bottom:7px;}
.concept-name{font-size:15px;font-weight:800;color:var(--text);margin-bottom:4px;}
.concept-sub{font-size:12px;color:var(--text2);line-height:1.6;white-space:pre-line;}
.acc-card{display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:13px;border:1.5px solid var(--border);background:var(--card);margin-bottom:10px;animation:fadeUp .25s ease both;transition:all .18s;flex-wrap:wrap;}
.acc-card.conn-naver{border-color:rgba(3,199,90,.35);}
.acc-card.conn-tistory{border-color:rgba(255,107,53,.35);}
.hist-item{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);animation:fadeUp .25s ease both;}
.hist-info{flex:1;min-width:0;}
.hist-title{font-size:14px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hist-meta{font-size:11px;color:var(--text2);margin-top:2px;font-family:'JetBrains Mono',monospace;}
.sbadge{font-size:11px;font-weight:700;padding:4px 11px;border-radius:99px;white-space:nowrap;}
.sbadge-ok{background:rgba(0,214,143,.1);color:var(--success);border:1px solid rgba(0,214,143,.25);}
.sbadge-fail{background:rgba(255,83,99,.1);color:var(--danger);border:1px solid rgba(255,83,99,.2);}
.sbadge-pend{background:rgba(255,159,63,.1);color:var(--warn);border:1px solid rgba(255,159,63,.25);}
.view-link{font-size:12px;color:var(--accent-text);text-decoration:none;padding:5px 12px;border-radius:8px;background:var(--accent-bg);border:1px solid var(--accent-border);flex-shrink:0;font-weight:600;}
.ai-grid{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px;}
.ai-card{flex:1;min-width:120px;padding:13px 12px;border-radius:12px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;}
.ai-card.sel-ai{transform:translateY(-2px);}
.ai-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.ai-logo{width:27px;height:27px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;}
.ai-name{font-size:12px;font-weight:700;color:var(--text);}
.ai-sub{font-size:10px;color:var(--text2);margin-top:2px;}
.ai-sel-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;color:#000;}
.ai-free{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(0,214,143,.12);color:var(--success);}
.ai-paid{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(255,159,63,.12);color:var(--warn);}
.alert-box{padding:13px 16px;border-radius:11px;font-size:13px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px;line-height:1.6;font-weight:500;}
.alert-warn{background:rgba(255,159,63,.07);border:1px solid rgba(255,159,63,.25);color:var(--warn);}
.alert-info{background:rgba(77,166,255,.07);border:1px solid rgba(77,166,255,.25);color:var(--info);}
.alert-success{background:rgba(0,214,143,.07);border:1px solid rgba(0,214,143,.25);color:var(--success);}
.alert-danger{background:rgba(255,83,99,.07);border:1px solid rgba(255,83,99,.25);color:var(--danger);}
.empty-state{text-align:center;padding:56px 24px;animation:fadeUp .3s ease both;}
.empty-ico{font-size:52px;margin-bottom:14px;display:block;animation:float 3s ease-in-out infinite;}
.empty-title{font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px;}
.empty-sub{font-size:14px;color:var(--text2);margin-bottom:22px;line-height:1.65;}
.key-section{padding:15px 17px;border-radius:12px;border:1px solid var(--border);margin-bottom:12px;}
.key-section-title{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin-bottom:12px;display:flex;align-items:center;gap:6px;}
.info-table{border:1px solid var(--border);border-radius:11px;overflow:hidden;}
.info-row{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border);}
.info-row:last-child{border-bottom:none;}
.info-row:hover{background:var(--card-hover);}
.info-key{font-size:13px;color:var(--text2);}
.info-val{font-size:14px;font-weight:700;color:var(--text);}
.preview-overlay{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:16px;}
.preview-inner{width:100%;max-width:720px;max-height:92vh;overflow-y:auto;background:#fff;border-radius:18px;padding:32px 28px;animation:guideIn .3s ease both;}
.guide-overlay{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:12px;}
.guide-modal{width:100%;max-width:560px;max-height:92vh;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;animation:guideIn .32s cubic-bezier(.34,1.56,.64,1) both;box-shadow:0 32px 80px rgba(0,0,0,.6);position:relative;}
.guide-header{padding:22px 22px 0;background:linear-gradient(135deg,#1a2e1a,#0d1a0d);flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06);}
.guide-logo-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.guide-logo-ico{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#00ff9d,#00c870);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.guide-title{font-size:20px;font-weight:900;color:#fff;}
.guide-subtitle{font-size:12px;color:rgba(255,255,255,.5);margin-top:3px;}
.guide-tabs{display:flex;overflow-x:auto;scrollbar-width:none;}
.guide-tabs::-webkit-scrollbar{display:none;}
.guide-tab{padding:11px 16px;border:none;background:transparent;font-size:12px;font-weight:700;color:rgba(255,255,255,.4);cursor:pointer;font-family:'Noto Sans KR',sans-serif;white-space:nowrap;border-bottom:3px solid transparent;transition:all .15s;flex-shrink:0;}
.guide-tab.active{color:#FFD93D;border-bottom-color:#FFD93D;}
.guide-body{flex:1;overflow-y:auto;background:#0d1a0d;padding:18px 18px 22px;min-height:0;}
.guide-body::-webkit-scrollbar{width:4px;}
.guide-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:99px;}
.guide-close{position:absolute;top:14px;right:16px;width:32px;height:32px;border-radius:99px;background:rgba(255,255,255,.12);border:none;color:#fff;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;z-index:10;}
.guide-close:hover{background:rgba(255,255,255,.22);}
.g-step{border-radius:15px;padding:15px 15px;margin-bottom:10px;border:1.5px solid;}
.g-step-num{font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;display:flex;align-items:center;gap:6px;}
.g-step-title{font-size:15px;font-weight:900;margin-bottom:5px;line-height:1.3;}
.g-step-desc{font-size:13px;line-height:1.85;color:rgba(255,255,255,.82);}
.g-step-desc b{font-weight:900;color:#fff;}
.g-tip{margin-top:9px;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,.05);font-size:12px;line-height:1.75;color:rgba(255,255,255,.7);}
.g-tip b{font-weight:800;color:#FFD93D;}
.g-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 18px;border-radius:99px;border:none;font-size:13px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;margin-top:11px;transition:all .15s;}
.g-btn:hover{filter:brightness(1.1);transform:translateY(-1px);}
.guide-footer{padding:12px 18px;background:#0a150a;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;flex-wrap:wrap;}
.guide-nav-btn{padding:9px 20px;border-radius:99px;border:1.5px solid;font-size:13px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;}
.guide-page{font-size:12px;color:rgba(255,255,255,.35);font-weight:600;}
.mob-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:200;background:var(--header-bg);border-top:1px solid var(--border);backdrop-filter:blur(24px);padding:7px 4px max(12px,env(safe-area-inset-bottom));}
.mob-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 2px;border:none;background:transparent;cursor:pointer;font-family:'Noto Sans KR',sans-serif;transition:all .15s;min-height:50px;border-radius:9px;}
.mob-btn-ico{font-size:21px;}
.mob-btn-lbl{font-size:11px;font-weight:600;color:var(--text2);}
.mob-btn.active{background:var(--accent-bg);}
.mob-btn.active .mob-btn-lbl{color:var(--accent-text);}
.img-split{display:grid;grid-template-columns:300px 1fr;gap:14px;align-items:start;}
@media(max-width:900px){.sidebar{display:none;}.mob-bar{display:flex;}.main-content{padding-bottom:100px;}.guide-overlay{padding:12px 8px 120px;align-items:flex-start;overflow-y:auto;}.guide-modal{max-height:none;width:100%;}}
@media(max-width:768px){
  .header-mid{display:none;}.main{padding:14px 12px 84px;}.card{padding:16px 14px;}
  .adtype-row{grid-template-columns:1fr 1fr;}.title-grid{grid-template-columns:1fr;}.ai-grid{flex-direction:column;}
  .btn-xl{padding:18px 22px;font-size:17px;}.btn{font-size:15px;padding:13px 18px;}.inp{font-size:16px;}.inp.lg{font-size:18px;}
  .concept-grid{grid-template-columns:1fr;}.steps .step-n{display:none;}.step-item{font-size:13px;padding:13px 6px;}
  .g-step-desc{font-size:14px !important;line-height:1.9 !important;}
  .g-step-title{font-size:16px !important;}
  .nav-item{padding:13px 12px;font-size:14px;}
  .guide-modal{max-width:100%;max-height:90vh;border-radius:20px;}.guide-header{padding:16px 16px 0;}
  .guide-body{padding:14px 14px 18px;}.guide-footer{padding:10px 14px;}.preview-inner{padding:20px 14px;}
  .flow-nav{flex-direction:column;align-items:stretch;}.flow-btn{justify-content:center;}
  .img-split{grid-template-columns:1fr !important;}
}
@media(max-width:480px){
  .header{padding:0 8px;gap:5px;}.user-name{display:none;}.logout-btn{display:none;}.quota-chip{display:none;}
  .dl-btn span:last-child{display:none;}.dl-btn{padding:9px 12px;}
  .guide-open-btn{font-size:11px;padding:6px 10px;}
  .adtype-row{grid-template-columns:1fr;}.guide-overlay{padding:6px;}
  .guide-modal{max-height:94vh;border-radius:16px;}.guide-tab{font-size:11px;padding:9px 11px;}
  .acc-form-grid{grid-template-columns:1fr !important;}
  .pub-plat-grid{grid-template-columns:1fr !important;}
}
.right-panel{width:200px;flex-shrink:0;background:var(--bg2);border-left:1px solid var(--border);display:flex;flex-direction:column;padding:14px 12px;gap:10px;overflow-y:auto;}
.rp-section{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 13px;}
.rp-title{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:9px;display:flex;align-items:center;gap:5px;}
.rp-row{display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);gap:6px;}
.rp-row:last-child{border-bottom:none;}
.rp-key{font-size:11px;color:var(--text3);flex-shrink:0;}
.rp-val{font-size:11px;font-weight:700;color:var(--text);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;}
.rp-val.accent{color:var(--accent-text);}
.rp-val.warn{color:var(--warn);}
.rp-thumb{width:100%;border-radius:9px;object-fit:cover;max-height:110px;margin-top:6px;border:1px solid var(--border);}
.rp-btn{width:100%;padding:10px 12px;border-radius:10px;border:none;font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:6px;}
.rp-btn:disabled{opacity:.38;cursor:not-allowed;}
.rp-btn-primary{background:linear-gradient(135deg,var(--accent),#00cc80);color:#000;box-shadow:0 3px 12px var(--accent-30);}
.rp-btn-primary:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px);}
.rp-btn-secondary{background:var(--card2);color:var(--text);border:1px solid var(--border);}
.rp-btn-secondary:hover:not(:disabled){background:var(--card-hover);border-color:var(--border2);}
@media(max-width:1100px){.right-panel{display:none;}}
`;
interface Props {
  user: PublyUser;
  onLogout: () => void;
  onAdminLogin: () => void;
  onThemeToggle: () => void;
  theme: string;
}

export default function DashboardPage({user, onLogout, onAdminLogin, onThemeToggle, theme}: Props) {
  const [tab, setTab] = useState<MainTab>("keyword");
  const [showGuide, setShowGuide] = useState(false);
  const [guideTab, setGuideTab] = useState(0);
  const [botOnline, setBotOnline] = useState(false);
  const [quota, setQuota] = useState<PublyQuota|null>(null);
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [history, setHistory] = useState<PublyHistory[]>([]);
  const [adType, setAdType] = useState<"adpost"|"adsense">("adpost");
  const [platform, setPlatform] = useState<"naver"|"tistory">("naver");
  const [keyword, setKeyword] = useState("");
  const [keywords, setKeywords] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_kws")||"[]");}catch{return [];}});
  const [targetChars, setTargetChars] = useState(1350);
  const [charMode, setCharMode] = useState<"auto"|"manual">("auto");

  // 플랫폼/타입별 랜덤 글자수 계산
  function calcTargetChars():number{
    if(charMode==="manual")return targetChars;
    if(platform==="tistory") return Math.floor(Math.random()*1500)+2500; // 2500~4000
    if(adType==="adpost"){
      // 체험단/맛집 키워드 감지
      if(/체험단|맛집|후기|리뷰|방문|다녀/.test(keyword))
        return Math.floor(Math.random()*1000)+2000; // 2000~3000
      return Math.floor(Math.random()*700)+1800; // 1800~2500
    }
    return Math.floor(Math.random()*700)+1800;
  }
  const [titles, setTitles] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_titles")||"[]");}catch{return[];}});
  const [selectedTitle, setSelectedTitle] = useState("");
  const [loadingTitles, setLoadingTitles] = useState(false);
  const [genContent, setGenContent] = useState("");
  const [genTitle, setGenTitle] = useState("");
  const [genTags, setGenTags] = useState("");
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController|null>(null);
  const [imgSource, setImgSource] = useState<"ai"|"upload"|"none">("ai");
  const [imgCount, setImgCount] = useState(3);
  const [imgCountAuto, setImgCountAuto] = useState(true);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [genImgLoading, setGenImgLoading] = useState(false);
  const [genImgProgress, setGenImgProgress] = useState(0);
  const [captions, setCaptions] = useState<string[]>([]);
  const [videoOn, setVideoOn] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPosition, setVideoPosition] = useState<"top"|"middle"|"bottom">("middle");
  const [imgPattern, setImgPattern] = useState<"A"|"B"|"C"|"random">("random");
  const [currentImgPrompt, setCurrentImgPrompt] = useState("");
  const [genImgCurrent, setGenImgCurrent] = useState(0);
  const imgAbortRef = useRef<AbortController|null>(null);
  const [pubConcept, setPubConcept] = useState<PublishConcept>("full");
  const [pubAccId, setPubAccId] = useState("");
  const [pubTitle, setPubTitle] = useState("");
  const [pubTags, setPubTags] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [pubMsg, setPubMsg] = useState("");
  const [newPlat, setNewPlat] = useState<"naver"|"tistory">("naver");
  const [newUser, setNewUser] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newBlog, setNewBlog] = useState("");
  const [addingAcc, setAddingAcc] = useState(false);
  const [connId, setConnId] = useState<string|null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [writeAI, setWriteAI] = useState(()=>localStorage.getItem("publy_write_ai")||"gemini");
  const [imageAI, setImageAI] = useState(()=>localStorage.getItem("publy_image_ai")||"openai_img");

  const checkBot = useCallback(async()=>{
    try{const r=await fetch(`${BOT}/health`,{signal:AbortSignal.timeout(3000)});setBotOnline(r.ok);}
    catch{setBotOnline(false);}
  },[]);

  useEffect(()=>{
    checkBot();
    getAccounts(user.id).then(setAccounts);
    getHistory(user.id).then(setHistory);
    getQuota(user.id).then(q=>q&&setQuota(q));
    const iv=setInterval(checkBot,30000);
    if(!localStorage.getItem("publy_guide_seen")){setTimeout(()=>setShowGuide(true),900);}
    return()=>clearInterval(iv);
  },[checkBot,user.id]);

  function recommendImgCount(content:string):number{return Math.max(1,Math.min(10,Math.floor(content.length/200)));}

  function buildCaptions(kw:string, count:number):string[]{
    const k=kw||"사진";
    const pool=[
      `${k} 현장 모습`,`직접 경험한 ${k}`,`${k} 상세 사진`,
      `${k} 실제 모습`,`${k} 후기 사진`,`${k} 현장 사진`,
      `${k} 생생 후기`,`${k} 디테일 컷`,
    ];
    return Array.from({length:count},(_,i)=>pool[i%pool.length]);
  }

  // ─── 300+ 키워드 이미지 프롬프트 시스템 ────────────────────
  const NP_TAG = "no people, no person, no face, no human, no text, no watermark";
  const PROMPT_DB: {keywords:string[];prompt:string}[] = [
    // 음식/맛집
    {keywords:["한식","한정식","백반","집밥","가정식"],prompt:"Korean home-style meal spread, banchan side dishes, stone pot bibimbap, wooden table, steam rising, cozy restaurant interior, warm natural lighting"},
    {keywords:["맛집","식당","레스토랑","음식점","맛"],prompt:"cozy Korean restaurant interior, beautifully plated dishes on wooden table, ambient warm lighting, inviting atmosphere, bokeh background"},
    {keywords:["삼겹살","고기","구이","바베큐","BBQ","갈비"],prompt:"Korean BBQ pork belly sizzling on grill, smoke rising, lettuce wraps, sesame oil, glowing charcoal, dark dramatic lighting"},
    {keywords:["회","횟집","사시미","해산물","해물","횟감"],prompt:"fresh Korean sashimi platter, colorful fish slices on ice, glistening presentation, premium seafood restaurant, cinematic lighting"},
    {keywords:["초밥","스시","오마카세","일식"],prompt:"premium omakase sushi assortment, chef-crafted nigiri on wooden platter, minimalist Japanese restaurant, soft dramatic lighting"},
    {keywords:["스테이크","소고기","등심","ribeye","안심"],prompt:"perfectly seared ribeye steak, medium-rare interior, herb butter melting, fine dining plating, dramatic dark background"},
    {keywords:["파스타","이탈리안","피자","양식","스파게티"],prompt:"rustic Italian pasta dish, spaghetti with rich tomato sauce, fresh basil, parmesan, warm restaurant ambiance"},
    {keywords:["라면","라멘","국수","우동","소바"],prompt:"steaming bowl of Korean ramen, rich broth, soft egg, noodles, steam wisps, dark moody background, cinematic"},
    {keywords:["치킨","통닭","후라이드","양념치킨"],prompt:"crispy golden Korean fried chicken on wooden board, sauce cups, casual dining atmosphere, warm lighting"},
    {keywords:["피자","도우","화덕피자"],prompt:"artisan wood-fired pizza bubbling cheese, fresh toppings, rustic wooden table, Italian atmosphere"},
    {keywords:["버거","햄버거","샌드위치"],prompt:"gourmet burger juicy patty, fresh vegetables, sauce dripping, brioche bun, craft paper, casual dining"},
    {keywords:["카페","커피","아메리카노","라떼","에스프레소","카페인"],prompt:"cozy Korean cafe interior, latte art in ceramic cup, morning light through window, wooden table, minimalist aesthetic"},
    {keywords:["빵","베이커리","크루아상","소금빵"],prompt:"artisan bakery display, golden croissants, fresh-baked bread, pastries, warm bakery interior, flour dusted surface"},
    {keywords:["케이크","디저트","마카롱","초콜릿","아이스크림","단것"],prompt:"elegant dessert plating, layered chocolate cake, fresh berry garnish, marble surface, soft studio lighting"},
    {keywords:["빙수","팥빙수","설빙","여름간식"],prompt:"Korean shaved ice bingsu, fluffy snow texture, red bean paste, condensed milk drizzle, pastel tones"},
    {keywords:["떡볶이","분식","순대","어묵","포장마차"],prompt:"Korean street food tteokbokki in red sauce, fish cakes, steam, pojangmacha night market atmosphere"},
    {keywords:["편의점","컵라면","야식","간식"],prompt:"Korean convenience store interior, colorful snack displays, late night warm glow, modern retail"},
    {keywords:["도시락","간편식","밀키트"],prompt:"beautifully arranged Korean lunch box bento, colorful vegetables, rice, clean minimal presentation"},
    {keywords:["채식","비건","샐러드","건강식"],prompt:"vibrant vegan grain bowl, colorful vegetables, quinoa, avocado, hummus, white ceramic bowl, editorial"},
    {keywords:["브런치","아보카도","팬케이크","와플"],prompt:"weekend brunch spread, avocado toast, stacked pancakes with maple syrup, fresh fruit, white marble, morning light"},
    {keywords:["맥주","와인","술","주류","칵테일"],prompt:"artisan craft beer glass, golden bubbles, bar setting, warm amber lighting, premium beverage"},
    {keywords:["국","찌개","탕","설렁탕","감자탕"],prompt:"steaming Korean soup pot, rich broth, ingredients visible, ceramic bowl, restaurant wooden table, comfort food"},
    {keywords:["김밥","주먹밥","쌈밥"],prompt:"colorful Korean gimbap rolls sliced, sesame seeds, bamboo mat, traditional presentation, warm lighting"},
    // 여행
    {keywords:["제주도","제주","한라산","성산일출봉","우도"],prompt:"Jeju island volcanic coastline, dramatic black lava rocks, turquoise ocean waves, Hallasan mountain backdrop, golden hour"},
    {keywords:["부산","해운대","광안리","남포동","감천"],prompt:"Busan Gwangalli beach at sunset, Gwangan Bridge illuminated, warm golden reflection on water, cinematic"},
    {keywords:["서울","경복궁","남산","한강","명동"],prompt:"Seoul cityscape at dusk, Namsan tower glowing, Han River reflection, modern skyscrapers meets traditional palace"},
    {keywords:["경주","불국사","첨성대","신라"],prompt:"ancient Gyeongju Bulguksa temple, cherry blossoms, stone lanterns, misty morning atmosphere, UNESCO heritage"},
    {keywords:["전주","한옥마을","비빔밥"],prompt:"Jeonju Hanok village, traditional Korean architecture, tile roofs, stone paths, warm golden afternoon light"},
    {keywords:["강원","강릉","속초","설악산","동해"],prompt:"Seoraksan mountain peaks with autumn foliage, dramatic rocky cliffs, crisp mountain air, editorial"},
    {keywords:["일본","도쿄","오사카","교토","후쿠오카"],prompt:"Kyoto traditional street at twilight, lantern-lit cobblestone alley, cherry blossom petals, cinematic"},
    {keywords:["유럽","파리","로마","스페인","런던","프랑스"],prompt:"Paris street at golden hour, Eiffel Tower in distance, café tables, warm European ambiance, cobblestone"},
    {keywords:["동남아","베트남","태국","발리","싱가포르"],prompt:"Bali tropical infinity pool overlooking lush jungle, lotus flowers, temple offerings, golden sunset"},
    {keywords:["미국","뉴욕","LA","하와이","라스베가스"],prompt:"Manhattan skyline at blue hour, skyscrapers reflected in Hudson River, city lights, dramatic urban"},
    {keywords:["캠핑","글램핑","텐트","야외","아웃도어"],prompt:"luxury glamping tent in forest clearing, warm lantern glow, campfire embers, starry night sky, misty morning"},
    {keywords:["호텔","리조트","숙소","펜션","풀빌라"],prompt:"luxury hotel suite interior, king bed with crisp white linens, floor-to-ceiling window with city view, elegant"},
    {keywords:["여행준비","패킹","캐리어","배낭여행"],prompt:"open suitcase with neatly packed clothes, travel accessories, passport, camera, clean flat lay on white bed"},
    {keywords:["국내여행","드라이브","도로여행","차박"],prompt:"scenic Korean coastal highway, road trip, mountain pass, autumn foliage, blue sky, freedom"},
    {keywords:["인천","강화도","을왕리","수원"],prompt:"Korean coastal scenery, calm bay water, traditional fishing village, golden morning light"},
    {keywords:["남해","통영","거제","한려수도"],prompt:"Southern Korean sea landscape, islands scattered in blue water, fishing boats, pristine coastal scenery"},
    // 건강/운동/의료
    {keywords:["다이어트","체중감량","살빼기","체중조절"],prompt:"clean healthy meal prep bowls, colorful vegetables, measuring tape, fresh ingredients, bright kitchen, weight loss"},
    {keywords:["운동","헬스","헬스장","피트니스","gym"],prompt:"modern gym interior, barbell rack, dumbbells, exercise equipment, motivating atmosphere, early morning light"},
    {keywords:["요가","필라테스","스트레칭"],prompt:"yoga studio with morning light, warrior pose on mat, peaceful atmosphere, plants, minimal decor"},
    {keywords:["러닝","마라톤","조깅","달리기"],prompt:"runner silhouette at sunrise on empty road, morning mist, dynamic motion, motivational editorial"},
    {keywords:["피부","스킨케어","화장품","로션","에센스"],prompt:"luxury skincare product flat lay, serum bottles, jade roller, white marble, morning light, K-beauty aesthetic"},
    {keywords:["탈모","모발","두피","샴푸"],prompt:"healthy thick hair close-up, shampoo foam, bathroom natural lighting, clean fresh aesthetic"},
    {keywords:["성형","시술","피부과","의원","클리닉"],prompt:"modern medical clinic interior, clean white aesthetic, professional equipment, trust and care atmosphere"},
    {keywords:["영양제","비타민","건강기능식품","보충제"],prompt:"supplement capsules and vitamins on white surface, green plant, morning light, health wellness aesthetic"},
    {keywords:["수면","불면증","숙면","수면습관"],prompt:"cozy bedroom at night, soft bedside lamp, fluffy white pillows, peaceful sleep environment, blue hour"},
    {keywords:["스트레스","번아웃","힐링","멘탈"],prompt:"serene nature meditation spot, calm lake, misty morning, tranquility, mental wellness atmosphere"},
    {keywords:["당뇨","혈당","혈압","심장","혈관"],prompt:"fresh healthy foods for diabetes management, whole grains, vegetables, fruit, blood glucose monitor"},
    {keywords:["치아","치과","구강","칫솔","치실"],prompt:"dental care flat lay, toothbrush, floss, mouthwash, white background, clean clinical aesthetic"},
    {keywords:["병원","진료","의료","건강검진"],prompt:"modern hospital corridor, clean professional healthcare, trust and expertise, bright clinical lighting"},
    {keywords:["한의원","한방","침","뜸","한약"],prompt:"traditional Korean medicine clinic, herbal medicine, acupuncture needles, wooden aesthetic, healing atmosphere"},
    // 재테크/금융
    {keywords:["주식","주식투자","증권","코스피","코스닥"],prompt:"stock market candlestick chart on monitor, trading platform, financial data visualization, dark professional"},
    {keywords:["코인","비트코인","가상화폐","NFT","블록체인"],prompt:"golden bitcoin coins, blockchain network visualization, digital currency concept, blue neon tech aesthetic"},
    {keywords:["부동산","아파트","투자","분양","청약"],prompt:"modern Korean apartment complex aerial view, urban cityscape, real estate development, sunset reflection"},
    {keywords:["재테크","돈","저축","절약","금융"],prompt:"Korean won bills and coins arranged neatly, piggy bank, growth chart, financial planning, clean white background"},
    {keywords:["ETF","펀드","적금","예금","금리","이자"],prompt:"financial investment growth concept, ascending bar chart, coins stacking, plant growing from money, prosperity"},
    {keywords:["경제","금리","환율","인플레이션","뉴스경제"],prompt:"financial newspaper with market data, coffee cup, modern desk, economic analysis aesthetic"},
    {keywords:["사업","창업","스타트업","사업자","CEO"],prompt:"modern startup office, whiteboard with business plan, team collaboration energy, contemporary workspace"},
    {keywords:["프리랜서","부업","N잡러","재택근무","사이드잡"],prompt:"home office setup, laptop on clean desk, plants, natural window light, productive remote work"},
    {keywords:["보험","연금","노후","은퇴"],prompt:"secure family financial planning, warm home setting, documents, trust and stability concept"},
    {keywords:["쇼핑몰","온라인쇼핑몰","판매","셀러","위탁판매"],prompt:"e-commerce product photography setup, clean white background, professional product display, modern"},
    // IT/테크/AI
    {keywords:["AI","인공지능","ChatGPT","GPT","클로드"],prompt:"artificial intelligence neural network visualization, futuristic blue light, data streams, tech concept"},
    {keywords:["스마트폰","아이폰","갤럭시","핸드폰"],prompt:"premium smartphone on minimal surface, app interface glow, clean tech product photography"},
    {keywords:["노트북","맥북","컴퓨터","PC","맥북"],prompt:"MacBook Pro on clean minimal desk, code on screen, soft ambient lighting, developer workspace"},
    {keywords:["앱","어플","앱개발","소프트웨어"],prompt:"smartphone screen with app icons, UI design mockup, colorful interface, mobile development concept"},
    {keywords:["코딩","프로그래밍","개발","개발자","웹개발"],prompt:"dark mode code editor screen, colorful syntax highlighting, developer keyboard, multiple monitors"},
    {keywords:["유튜브","유튜버","영상","콘텐츠","크리에이터"],prompt:"YouTube creator studio setup, ring light, camera, microphone, content creation workspace, professional"},
    {keywords:["인스타","SNS","소셜미디어","틱톡","릴스"],prompt:"social media content creation, smartphone photography setup, aesthetic flat lay, influencer lifestyle"},
    {keywords:["게임","게이밍","PC방","플스","닌텐도","스팀"],prompt:"gaming setup with RGB lighting, multiple monitors, mechanical keyboard, competitive esports atmosphere"},
    {keywords:["드론","항공사진","촬영"],prompt:"aerial drone photography, bird's eye view of Korean landscape, golden hour, dramatic perspective"},
    {keywords:["태블릿","iPad","갤탭","아이패드"],prompt:"tablet device on clean desk with stylus, digital creation, minimal aesthetic, creative workspace"},
    {keywords:["VR","AR","메타버스","가상현실"],prompt:"virtual reality headset, immersive digital world visualization, futuristic tech concept, glowing"},
    {keywords:["보안","해킹","사이버","정보보안"],prompt:"cybersecurity concept, digital lock, data protection visualization, blue code matrix, secure"},
    // 육아/임신/교육
    {keywords:["임신","출산","태교","임산부","만삭"],prompt:"soft nursery room preparation, baby items, gentle morning light, pastel colors, tender atmosphere"},
    {keywords:["육아","아기","신생아","돌잔치"],prompt:"adorable baby toys on soft pastel blanket, tiny shoes, teddy bear, warm nursery, gentle light"},
    {keywords:["유아","어린이","아이","어린이교육","유치원"],prompt:"colorful children learning environment, educational toys, ABC blocks, watercolor paintings, bright playful space"},
    {keywords:["초등","중등","고등","학교","공부","수능","입시"],prompt:"student study desk with books, stationery, planner, focused learning, warm desk lamp"},
    {keywords:["영어","영어공부","어학","토익","토플","회화"],prompt:"language learning setup, English textbooks, headphones, notebook with vocabulary, coffee, productive study"},
    {keywords:["학원","과외","교육","강사","선생님","교사"],prompt:"modern tutoring session, whiteboard with concepts, bright classroom, engaging education atmosphere"},
    // 라이프스타일/인테리어
    {keywords:["인테리어","인테리어디자인","집꾸미기","홈데코"],prompt:"beautifully designed Korean apartment interior, minimalist Scandinavian style, plants, warm natural tones"},
    {keywords:["청소","정리","수납","정돈","미니멀","정리수납"],prompt:"perfectly organized closet with coordinated items, minimalist Korean home, clean aesthetic"},
    {keywords:["이사","새집","아파트","원룸","집구하기"],prompt:"bright modern Korean apartment living room, floor-to-ceiling windows, city view, contemporary furniture"},
    {keywords:["강아지","댕댕이","멍멍이","dog","puppy"],prompt:"fluffy golden retriever puppy in Korean home garden, playful expression, soft natural light, adorable"},
    {keywords:["고양이","냥이","cat","kitty","고냥이"],prompt:"elegant cat lounging on window sill, soft afternoon sunbeam, bokeh background, peaceful domestic"},
    {keywords:["반려동물","펫","애완","동물병원"],prompt:"loving pet care scene, cozy home with happy pet, warm domestic life, lifestyle photography"},
    {keywords:["독서","책","서재","도서관","북카페","독서법"],prompt:"cozy reading nook with books, warm lamp light, coffee cup, wooden shelves, peaceful literary atmosphere"},
    {keywords:["취미","DIY","만들기","핸드메이드","공예"],prompt:"creative craft workspace, artistic materials, handmade projects, organized tools, creative energy"},
    {keywords:["가드닝","정원","식물","화분","홈가드닝"],prompt:"lush indoor plant collection, botanical home aesthetic, morning light through leaves, terra cotta pots"},
    {keywords:["요리","쿠킹","홈쿠킹","레시피","만드는법"],prompt:"home cooking preparation, fresh ingredients on wooden cutting board, kitchen lifestyle, warm cooking"},
    // 패션/뷰티/쇼핑
    {keywords:["패션","옷","코디","스타일링","OOTD","옷잘입는"],prompt:"Korean fashion street style flat lay, seasonal outfit coordination, accessories, clean white background"},
    {keywords:["명품","가방","지갑","액세서리","주얼리","럭셔리"],prompt:"luxury handbag editorial, leather texture, branded accessories, marble surface, premium lifestyle"},
    {keywords:["화장","메이크업","립스틱","파운데이션","뷰티"],prompt:"K-beauty makeup flat lay, cosmetic products arranged artfully, rose gold accents, mirror, beauty editorial"},
    {keywords:["향수","perfume","프래그런스","향"],prompt:"luxury perfume bottle on marble surface, light refraction, soft bokeh, elegant fragrance photography"},
    {keywords:["네일","네일아트","네일샵"],prompt:"artistic nail art close-up, intricate designs, gel polish, hands on marble, beauty editorial"},
    {keywords:["헤어","헤어스타일","미용실","염색","펌","헤어케어"],prompt:"Korean hair salon interior, glossy healthy hair, professional care, bright modern salon"},
    {keywords:["다이어트","바디","몸매","체형"],prompt:"healthy fit lifestyle concept, athletic body care, nutritious food, wellness motivation, inspiring"},
    // 자동차
    {keywords:["자동차","신차","차","자동차구매","차량"],prompt:"sleek modern sedan on mountain road, dramatic landscape, automotive photography, golden hour"},
    {keywords:["전기차","EV","테슬라","아이오닉","전기자동차"],prompt:"electric vehicle charging station, clean energy concept, modern EV design, sustainable future"},
    {keywords:["SUV","4WD","오프로드","크로스오버"],prompt:"powerful SUV on mountain trail, rugged terrain, adventure lifestyle, dramatic sky"},
    {keywords:["중고차","중고자동차","차량거래","중고"],prompt:"used car lot at dusk, selective focus on hood, polished exterior, automotive detail"},
    {keywords:["오토바이","바이크","모터사이클"],prompt:"motorcycle on scenic coastal road, freedom concept, dramatic landscape, lifestyle editorial"},
    // 스포츠/레저
    {keywords:["골프","골프장","골프채","필드","골프연습"],prompt:"golf course at sunrise, morning mist over fairway, lush green grass, dramatic landscape, premium sport"},
    {keywords:["등산","트레킹","산행","백패킹","산악"],prompt:"hiker on Korean mountain summit, vast panoramic view, autumn foliage, achievement, dramatic sky"},
    {keywords:["수영","수영장","수영복","수영강습"],prompt:"outdoor swimming pool with turquoise water, summer sun reflection, tropical resort atmosphere"},
    {keywords:["테니스","배드민턴","스쿼시"],prompt:"tennis court at golden hour, sport photography, athletic energy, dramatic sunlight"},
    {keywords:["자전거","사이클","MTB","자전거여행"],prompt:"cyclist on scenic riverside path at sunrise, motion and speed, Korean landscape, freedom"},
    {keywords:["서핑","수상스포츠","웨이크보드"],prompt:"surfer riding large wave at golden hour, dramatic ocean spray, athletic adventure"},
    {keywords:["축구","농구","야구","배구","스포츠"],prompt:"sports field at golden hour, athletic energy, dramatic stadium lighting, competitive spirit"},
    {keywords:["헬스","PT","퍼스널트레이닝","근육"],prompt:"modern gym barbell training, strong physique concept, motivating gym atmosphere, fitness lifestyle"},
    // 직업/커리어
    {keywords:["취업","구직","이력서","자소서","면접"],prompt:"professional Korean job interview setting, confident candidate, modern office, career opportunity"},
    {keywords:["직장","회사","사무실","직장인","오피스"],prompt:"modern Korean office interior, collaborative workspace, professionals working, clean contemporary"},
    {keywords:["이직","커리어","커리어개발","경력관리"],prompt:"career growth concept, ascending staircase, professional development, business success, ambition"},
    {keywords:["간호사","의사","의료진"],prompt:"professional healthcare setting, doctor in white coat, modern hospital, trust and care"},
    {keywords:["공무원","공직","공시"],prompt:"government office building, professional Korean administrative aesthetic, stability and trust"},
    {keywords:["디자이너","그래픽","UX","UI","디자인"],prompt:"creative designer workspace, color palette, sketches, tablet, Macbook, design studio aesthetic"},
    {keywords:["마케터","마케팅","광고","브랜딩"],prompt:"marketing creative workspace, campaign materials, laptop with analytics, colorful brand elements"},
    // 계절/자연
    {keywords:["봄","벚꽃","봄꽃","개나리","튤립"],prompt:"Korean spring cherry blossom path, soft pink petals falling, warm sunlight through branches, dreamy"},
    {keywords:["여름","바다","해수욕장","여름휴가"],prompt:"Korean summer beach, crystal clear water, white sand, golden hour sunlight, vacation mood"},
    {keywords:["가을","단풍","추석","가을여행","단풍여행"],prompt:"Korean autumn forest, vibrant red and orange foliage, misty mountain morning, fallen leaves path"},
    {keywords:["겨울","눈","스키장","크리스마스","연말","설경"],prompt:"winter wonderland snowscape, frost on pine trees, soft blue twilight, peaceful Korean winter"},
    // 자기계발/심리
    {keywords:["자기계발","성장","동기부여","목표","습관"],prompt:"morning routine motivation, sunrise through window, journal and coffee, goal setting, fresh productive start"},
    {keywords:["명상","마음챙김","힐링","치유","회복"],prompt:"peaceful meditation space, serene pose, soft morning light, minimalist zen atmosphere, calm"},
    {keywords:["심리","상담","멘탈헬스","우울","불안"],prompt:"warm therapy room, comfortable couch, soft lighting, safe healing space, professional care"},
    // 문화/엔터
    {keywords:["영화","OTT","넷플릭스","드라마","영화추천"],prompt:"cozy home cinema setup, dark room with large screen glow, popcorn, blanket, movie night"},
    {keywords:["음악","콘서트","공연","아이돌","K-pop"],prompt:"concert stage with dramatic lighting, spotlights, smoke effects, electric atmosphere, performance energy"},
    {keywords:["독립영화","단편영화","영화제"],prompt:"film festival aesthetic, vintage cinema, reel strips, artistic movie poster concept, dramatic"},
    // 환경/사회
    {keywords:["환경","친환경","제로웨이스트","지속가능","ESG"],prompt:"eco-friendly lifestyle flat lay, reusable items, green plants, sustainable products, earth-tone"},
    {keywords:["반려식물","식물키우기","다육이","관엽식물"],prompt:"lush indoor plant collection, botanical shelf arrangement, morning sunlight through leaves, cozy green aesthetic"},
  ];

  function buildImgPrompt(kw: string, title: string = "", idx: number = 0): string {
    const k = (kw + " " + title).toLowerCase();
    const st = adType === "adpost"
      ? "Korean lifestyle photography, warm emotional, soft natural light"
      : "ultra realistic DSLR 8K magazine editorial photography";
    // 긴 키워드 먼저 매칭
    const sorted = [...PROMPT_DB].sort((a,b) => b.keywords.join("").length - a.keywords.join("").length);
    for (const entry of sorted) {
      if (entry.keywords.some(kw2 => k.includes(kw2))) {
        // idx에 따라 조명 변주 (기계적 반복 방지)
        let p = entry.prompt;
        if (idx === 1) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "golden hour afternoon light");
        if (idx === 2) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "dramatic blue hour lighting");
        if (idx === 3) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "soft overcast diffused light");
        return `${p}, ${NP_TAG}, ${st}`;
      }
    }
    // fallback: 장르 감지
    if (/먹|맛|식|음|요리|카페|커피/.test(k)) return `beautiful Korean food dining experience, warm restaurant, delicious presentation, ${NP_TAG}, ${st}`;
    if (/여행|travel|관광|투어|trip/.test(k)) return `breathtaking Korean travel destination, scenic landscape, golden hour, ${NP_TAG}, ${st}`;
    if (/돈|금|재|투자|경제|수익|부자/.test(k)) return `financial success growth concept, modern professional aesthetic, ${NP_TAG}, ${st}`;
    if (/건강|운동|몸|fitness|diet|다이어트/.test(k)) return `healthy lifestyle motivation, nutritious food, wellness atmosphere, ${NP_TAG}, ${st}`;
    if (/집|방|인테리어|home|house|아파트/.test(k)) return `beautiful modern Korean home interior, warm cozy atmosphere, ${NP_TAG}, ${st}`;
    if (/기술|tech|AI|컴퓨터|폰|앱/.test(k)) return `modern technology concept, clean digital aesthetic, innovation, ${NP_TAG}, ${st}`;
    if (/봄|여름|가을|겨울|자연|꽃/.test(k)) return `beautiful Korean seasonal landscape, nature photography, golden light, ${NP_TAG}, ${st}`;
    return `beautiful Korean lifestyle blog editorial photography, professional, perfect composition, ${NP_TAG}, ${st}`;
  }

  function stripMarkdown(text:string):string{
    return text
      .replace(/^#{1,6}\s+/gm,"")
      .replace(/\*{2,3}(.*?)\*{2,3}/g,"$1")
      .replace(/\*(.*?)\*/g,"$1")
      .replace(/_{2,}(.*?)_{2,}/g,"$1")
      .replace(/_(.*?)_/g,"$1")
      .replace(/^[-*+]\s+/gm,"")
      .replace(/^\d+\.\s+/gm,"")
      .replace(/^>\s*/gm,"")
      .replace(/`{3}[\s\S]*?`{3}/g,"")
      .replace(/`([^`]+)`/g,"$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g,"$1")
      .replace(/^---+$/gm,"")
      .replace(/^\s*\|.*\|.*$/gm,"")
      .replace(/[一-鿿㐀-䶿]/g,"")
      .replace(/[\u3040-\u30FF]/g,"")
      .replace(/ {2,}/g," ")
      .replace(/\n{3,}/g,"\n\n")
      .trim();
  }

  function getCatGuide(kw:string,title:string):string{
    const k=(kw+" "+title).toLowerCase();
    if(/맛집|음식|카페|식당|요리|커피/.test(k))return"[맛집/음식] 직접 방문한 것처럼: 분위기, 맛, 가격. 단점도 솔직하게.";
    if(/여행|관광|호텔|숙소|제주|부산/.test(k))return"[여행] 교통편, 비용, 소요시간, 명소, 현지 맛집, 예산.";
    if(/건강|다이어트|운동|피부/.test(k))return"[건강] 전문 용어 쉽게, 집 vs 병원 구분.";
    if(/재테크|투자|주식|금융/.test(k))return"[재테크] 초보자용 설명, 실제 숫자 예시.";
    if(/it|앱|ai|테크|스마트폰/.test(k))return"[IT/테크] 쉬운 설명, 실제 사용 시나리오, 장단점.";
    return"[정보/일상] 독자가 몰랐던 새 정보, 실용 팁.";
  }

  async function callAI(prompt:string,signal?:AbortSignal):Promise<string>{
    const ai=localStorage.getItem("publy_write_ai")||"gemini";
    if(ai==="gemini"){
      const key=localStorage.getItem("publy_gemini_key")||"";
      if(!key)throw new Error("Gemini API 키 없음 — 설정 탭에서 입력해주세요");
      for(const model of GEMINI_MODELS){
        try{
          const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:8000}}),signal:signal||AbortSignal.timeout(90000)});
          if(!r.ok)continue;
          const d=await r.json();const t=d.candidates?.[0]?.content?.parts?.[0]?.text||"";if(t)return t;
        }catch(e:any){if(e.name==="AbortError")throw e;continue;}
      }
      throw new Error("Gemini 모든 모델 실패");
    }
    if(ai==="groq"){
      const key=localStorage.getItem("publy_groq_key")||"";if(!key)throw new Error("Groq API 키 없음");
      const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.1-70b-versatile",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:signal||AbortSignal.timeout(90000)});
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"Groq 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    if(ai==="openai"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI API 키 없음");
      const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:signal||AbortSignal.timeout(90000)});
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"OpenAI 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    throw new Error("AI 미선택");
  }

  async function generateOneImage(kw:string,signal:AbortSignal,idx:number=0):Promise<string>{
    const prompt=buildImgPrompt(kw, genTitle||selectedTitle||"", idx);
    const ai=localStorage.getItem("publy_image_ai")||"openai_img";
    if(ai==="openai_img"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI 키 없음");
      const r=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"dall-e-3",prompt,n:1,size:"1024x1024"}),signal});
      if(!r.ok){const e=await r.json();throw new Error("DALL-E: "+(e.error?.message||r.status));}
      const d=await r.json();return d.data?.[0]?.url||"";
    }
    if(ai==="replicate"){
      const key=localStorage.getItem("publy_replicate_key")||"";if(!key)throw new Error("Replicate 키 없음");
      const pr=await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({input:{prompt,num_outputs:1,aspect_ratio:"16:9"}}),signal});
      if(!pr.ok){const e=await pr.json();throw new Error("Replicate: "+(e.detail||pr.status));}
      const pred=await pr.json();const pollUrl=pred.urls?.get;if(!pollUrl)throw new Error("Replicate 응답 오류");
      for(let i=0;i<30;i++){
        await new Promise(r=>setTimeout(r,2000));
        if(signal.aborted)throw new DOMException("AbortError","AbortError");
        const res=await fetch(pollUrl,{headers:{"Authorization":`Bearer ${key}`}});
        const data=await res.json();
        if(data.status==="succeeded")return data.output?.[0]||"";
        if(data.status==="failed")throw new Error("Replicate 실패");
      }
      throw new Error("Replicate 타임아웃");
    }
    throw new Error("이미지 AI 미선택");
  }

  function parseArr(text:string):string[]{
    const clean=text.replace(/```json|```/gi,"").trim();
    try{const m=clean.match(/\[[\s\S]*\]/);if(m){const p=JSON.parse(m[0]);if(Array.isArray(p))return p.map(String).filter(t=>t.length>3);}}catch{}
    try{const p=JSON.parse(clean);if(Array.isArray(p))return p.map(String).filter(t=>t.length>3);}catch{}
    return clean.split("\n").map(l=>l.replace(/^[\d]+[).\s]+|^[-*•\s]+/,"").replace(/^[\s"']+|[\s"']+$/g,"").trim()).filter(l=>l.length>4&&l.length<100);
  }

  async function handleGenerateTitles(reset=false){
    if(!keyword.trim()){alert("키워드를 입력해주세요");return;}
    // 키워드 풀에 누적 (중복제거, 90개 제한)
    if(!keywords.includes(keyword.trim())){
      const newKws=[...keywords,keyword.trim()].slice(-MAX_KW);
      setKeywords(newKws);
      localStorage.setItem("publy_kws",JSON.stringify(newKws));
    }
    if(reset)setTitles([]);
    setLoadingTitles(true);abortRef.current=new AbortController();
    const prompt=adType==="adpost"
      ?`당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${keyword.trim()}"\n\n제목 30개를 JSON 배열로만 반환하세요.\n- 키워드 자연스럽게 포함\n- 25~40자, 숫자 필수 (BEST 7, TOP 5 등)\n- 클릭 유발 ("솔직히","이것만","나만 알던")\n- 경험 공유형 ("써봤어요","해봤더니")\n\nJSON 배열만 반환.`
      :`당신은 구글 애드센스 SEO 전문가입니다.\n키워드: "${keyword.trim()}"\n\n제목 30개를 JSON 배열로만 반환하세요.\n- 키워드 자연스럽게 포함\n- 30~50자, 정보성 톤\n- "완벽 가이드","총정리","이유 5가지"\n\nJSON 배열만 반환.`;
    try{
      const text=await callAI(prompt,abortRef.current.signal);
      const parsed=parseArr(text);
      if(!parsed.length)throw new Error("제목 생성 실패. 다시 시도해주세요.");
      setTitles(prev=>{
        const combined=[...parsed,...prev];
        if(combined.length>=MAX_TITLES){localStorage.setItem("publy_titles",JSON.stringify(parsed));return parsed;}
        localStorage.setItem("publy_titles",JSON.stringify(combined));return combined;
      });
    }catch(e:any){if(e.name!=="AbortError")alert("제목 생성 실패: "+e.message);}
    finally{setLoadingTitles(false);}
  }

  async function handleGenerate(){
    if(!selectedTitle&&!keyword){alert("키워드와 제목을 먼저 선택해주세요");return;}
    const title=selectedTitle||keyword;
    setGenerating(true);abortRef.current=new AbortController();

    // 글자수 자동 랜덤화
    const chars=calcTargetChars();
    if(charMode==="auto")setTargetChars(chars);

    // AI 패턴 뱅크 - 매번 랜덤 선택
    const INTRO_BANK=[
      `오늘은 ${keyword} 직접 경험한 거 솔직하게 써볼게요.`,
      `솔직히 처음엔 별 기대 안 했어요. 근데 ${keyword} 해보고 나서 생각이 완전히 바뀌었어요.`,
      `${keyword} 궁금한 분들 많죠? 저도 한참 찾아봤거든요.`,
      `주변에서 ${keyword} 어디 좋냐고 물어봐서 이참에 정리해봤어요.`,
      `사실 이거 쓸까 말까 고민했는데... ${keyword} 후기 한번 솔직하게 써볼게요.`,
      `${keyword} 직접 겪은 거라 자신있게 말할 수 있어요.`,
      `블로그에 ${keyword} 글 많은데 제 경험이랑 달라서 새로 써봐요.`,
      `${keyword} 처음 접하시는 분들을 위해 제 경험 기반으로 정리했어요.`,
      `저도 처음엔 막막했는데 ${keyword} 이렇게 하면 됩니다.`,
      `${keyword} 고민하다가 직접 해봤는데 결과를 공유해드릴게요.`,
    ];
    const SUBHEAD_BANK=[
      `왜 {주제}가 이렇게 인기 있는 걸까요?`,
      `직접 해보니까 이런 점이 달랐어요`,
      `기대했던 것 vs 실제로 느낀 것`,
      `꼭 알아야 할 핵심 포인트`,
      `이런 분들께 특히 추천해요`,
    ];
    const OUTRO_BANK=[
      `다음에 또 기회가 되면 다시 경험해보고 싶어요.`,
      `이 글이 도움이 됐으면 좋겠습니다.`,
      `궁금한 거 있으면 댓글로 물어봐요!`,
      `저처럼 고민하시는 분들한테 도움이 됐으면 해요.`,
      `더 좋은 정보 있으면 공유해주세요 :)`,
      `오늘도 긴 글 읽어주셔서 감사해요.`,
      `여러분도 꼭 한번 경험해보시길 추천드려요.`,
      `다음에 또 좋은 정보로 돌아올게요.`,
    ];
    const intro=INTRO_BANK[Math.floor(Math.random()*INTRO_BANK.length)];
    const subStyle=SUBHEAD_BANK[Math.floor(Math.random()*SUBHEAD_BANK.length)];
    const outro=OUTRO_BANK[Math.floor(Math.random()*OUTRO_BANK.length)];

    const catGuide=getCatGuide(keyword,title);
    const adGuide=adType==="adpost"?"[수익] 애드포스트: 체류시간 늘리는 감성 스토리.":"[수익] 애드센스: 클릭 유도, 키워드 밀도 높게.";
    const platGuide=platform==="naver"
      ?"[플랫폼] 네이버: ## 기호 절대 금지. 순수 텍스트. 감성적 경험담."
      :"[플랫폼] 티스토리: 정보성 중심. 내부링크 2개 자연스럽게 포함.";
    const prompt=`당신은 대한민국 최고의 블로그 작가입니다.

키워드: "${keyword}"  제목: "${title}"
목표 글자수: ${chars}자 내외 (±100자, 반드시 이 범위 안에서 작성)

${catGuide}

=== 절대 규칙 ===
⛔ ## 기호 완전 금지 (소제목은 그냥 텍스트로)
⛔ ** * - + 마크다운 기호 전부 금지
⛔ 한자,중국어,일본어 금지
⛔ AI 티 나는 표현 금지 (중요합니다, 다양한, 효과적인, 필수적으로 등)
✅ 독자에게 직접 말 걸기
✅ 구체적 수치, 가격, 기간 포함
✅ 문장 끝: ~해요, ~거든요, ~더라고요, ~잖아요 다양하게
✅ 키워드 3~4회 자연스럽게 (동의어 활용)
✅ 반드시 ${chars-100}~${chars+100}자 사이로 작성

=== 글 패턴 가이드 (매번 다르게) ===
인트로: "${intro}"
소제목 스타일: "${subStyle}"
마무리: "${outro}"

${adGuide}
${platGuide}

=== 출력 형식 ===
태그: 태그1, 태그2, 태그3, 태그4, 태그5

(본문 ${chars}자 내외 - 순수 텍스트)

[FAQ시작]
Q1: (질문)
A1: (답변)
Q2: (질문)
A2: (답변)
Q3: (질문)
A3: (답변)
[FAQ끝]

[관련글시작]
POST1: (제목)|(이유)
POST2: (제목)|(이유)
POST3: (제목)|(이유)
[관련글끝]`;
    try{
      const text=await callAI(prompt,abortRef.current.signal);
      const cleaned=stripMarkdown(text);
      const tgm=cleaned.match(/태그[:\s]*([^\n]+)/);
      const bm=cleaned.match(/태그[^\n]*\n([\s\S]+)/);
      setGenTitle(title);if(tgm)setGenTags(tgm[1].trim());
      const body=bm?bm[1].trim():cleaned;setGenContent(body);
      if(imgCountAuto)setImgCount(recommendImgCount(body));
    }catch(e:any){if(e.name!=="AbortError")alert("글 생성 실패: "+e.message);}
    finally{setGenerating(false);}
  }

  async function handleGenerateImages(){
    if(!keyword&&!genTitle){alert("먼저 글을 생성해주세요");return;}
    setGenImgLoading(true);setGenImgProgress(0);setGenImgCurrent(0);
    imgAbortRef.current=new AbortController();const imgs:string[]=[];
    const firstPrompt=buildImgPrompt(keyword||genTitle,genTitle,0);
    setCurrentImgPrompt(firstPrompt);
    try{
      for(let i=0;i<imgCount;i++){
        if(imgAbortRef.current.signal.aborted)break;
        setGenImgCurrent(i+1);
        const url=await generateOneImage(keyword||genTitle,imgAbortRef.current.signal,i);
        imgs.push(url);setGeneratedImages([...imgs]);setGenImgProgress(Math.round(((i+1)/imgCount)*100));
      }
      // 이미지 생성 완료 시 캡션 자동생성
      setCaptions(buildCaptions(keyword||genTitle,imgs.length));
    }catch(e:any){if(e.name!=="AbortError")alert("이미지 생성 실패: "+e.message);}
    finally{setGenImgLoading(false);imgAbortRef.current=null;}
  }

  function stopImageGen(){imgAbortRef.current?.abort();setGenImgLoading(false);}

  function handleImageUpload(e:React.ChangeEvent<HTMLInputElement>){
    const files=e.target.files;if(!files)return;
    Array.from(files).forEach(file=>{const reader=new FileReader();reader.onload=ev=>{if(ev.target?.result)setUploadedImages(prev=>[...prev,ev.target!.result as string]);};reader.readAsDataURL(file as Blob);});
  }

  function getActiveImages():string[]{return imgSource==="upload"?uploadedImages:generatedImages;}

  function buildPublishContent():string{
    if(!genContent)return "";
    if(pubConcept==="full")return genContent;
    if(pubConcept==="body_faq"){const i=genContent.indexOf("[관련글시작]");return i>0?genContent.slice(0,i).trim():genContent;}
    const i=genContent.indexOf("[FAQ시작]");return i>0?genContent.slice(0,i).trim():genContent;
  }

  async function handlePublish(){
    if(!pubAccId||!pubTitle){alert("계정과 제목을 확인해주세요");return;}
    const content=buildPublishContent();if(!content){alert("발행할 내용이 없어요");return;}
    setPublishing(true);setPubMsg("발행 중...");
    try{
      const ok=await useQuota(user.id);if(!ok){setPubMsg("❌ 발행 건수 초과");setPublishing(false);return;}
      if(!botOnline){
        await supabase.from("publy_jobs").insert({user_id:user.id,platform,title:pubTitle,content,tags:pubTags.split(",").map((t:string)=>t.trim()).filter(Boolean),image_url:getActiveImages()[0]||undefined,status:"pending"});
        setPubMsg("✅ PC 봇에 예약됐어요! Publy 앱 실행 시 자동 발행돼요.");
        await addHistory({user_id:user.id,platform,title:pubTitle,status:"pending"});
      }else{
        const r=await fetch(`${BOT}/api/publish-full`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:user.id,platform,title:pubTitle,content,tags:pubTags.split(",").map((t:string)=>t.trim()).filter(Boolean),imageUrl:getActiveImages()[0]||undefined})});
        const d=await r.json();if(!r.ok)throw new Error(d.error);
        await addHistory({user_id:user.id,platform,title:pubTitle,post_url:d.postUrl,status:"success"});
        setPubMsg("✅ 발행 완료!");
      }
      getHistory(user.id).then(setHistory);getQuota(user.id).then(q=>q&&setQuota(q));
    }catch(e:any){await addHistory({user_id:user.id,platform,title:pubTitle,status:"fail",error_message:e.message});setPubMsg("❌ "+e.message);}
    finally{setPublishing(false);}
  }

  async function handleAddAccount(){
    if(!newUser||!newPw)return;setAddingAcc(true);
    try{await upsertAccount({user_id:user.id,platform:newPlat,username:newUser,password_encrypted:btoa(newPw),blog_name:newBlog||undefined,is_connected:false});getAccounts(user.id).then(setAccounts);setNewUser("");setNewPw("");setNewBlog("");}
    catch(e:any){alert(e.message);}finally{setAddingAcc(false);}
  }
  async function handleConnect(acc:PublyAccount){
    if(!botOnline){alert("PC에서 Publy 앱을 먼저 실행해주세요");return;}setConnId(acc.id);
    try{
      const r=await fetch(`${BOT}/api/${acc.platform}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:acc.user_id,id:acc.username,pw:atob((acc as any).password_encrypted||""),blogName:acc.blog_name})});
      const d=await r.json();if(!d.success)throw new Error(d.error||"연결 실패");
      getAccounts(user.id).then(setAccounts);
    }catch(e:any){alert("연결 실패: "+e.message);}finally{setConnId(null);}
  }
  async function handleDeleteAccount(id:string){
    if(!confirm("이 계정을 삭제할까요?"))return;
    await supabase.from("publy_accounts").delete().eq("id",id);getAccounts(user.id).then(setAccounts);
  }

  const quotaPct=quota?Math.min(100,(quota.used_quota/quota.total_quota)*100):0;
  const connAccs=accounts.filter(a=>a.is_connected&&a.platform===platform);
  const todayPub=history.filter(h=>new Date(h.published_at).toDateString()===new Date().toDateString()).length;
  const activeImages=getActiveImages();
  useEffect(()=>{if(genTitle)setPubTitle(genTitle);},[genTitle]);
  useEffect(()=>{if(genTags)setPubTags(genTags);},[genTags]);
  const P="#FF6B9D",Y="#FFD93D",G="#00ff9d";
  const guideTabs=["🏠 시작","🔑 API 키","✍️ 글 생성","🖼️ 이미지","🚀 발행","❓ FAQ"];
  const guidePages=[
    /* ── 0: 시작 ── */
    <div key="0">
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:G}}>🎉 PUBLY에 오신 걸 환영해요!</div>
        <div className="g-step-title" style={{color:"#fff"}}>AI가 블로그 글을 대신 써줘요</div>
        <div className="g-step-desc">키워드 하나만 입력하면 <b>제목 → 글 → 이미지 → 자동 발행</b>까지 전부 자동이에요!</div>
      </div>
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:Y}}>📋 5단계 전체 흐름</div>
        <div className="g-step-title" style={{color:"#fff"}}>이 순서대로만 하면 끝!</div>
        <div className="g-step-desc">
          {[["✍️","글쓰기 탭","키워드 입력 → 제목 선택 → 글 자동 생성"],["🖼️","이미지 탭","AI 이미지 생성 + 캡션 입력 + 영상 설정"],["🚀","발행 탭","발행 방식 선택 → 계정 선택 → 자동 발행"],["📋","기록 탭","발행된 글 목록 전체 확인"],["⚙️","설정 탭","API 키 관리 + 블로그 계정 연결"]].map(([ico,t,d],idx)=>(
            <div key={idx} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:idx<4?"1px solid rgba(255,255,255,.06)":"none"}}>
              <span style={{fontSize:22,flexShrink:0}}>{ico}</span>
              <div><div style={{fontWeight:800,color:"#fff",fontSize:15}}>{t}</div><div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:2}}>{d}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="g-step" style={{borderColor:`${P}40`,background:`${P}08`}}>
        <div className="g-step-num" style={{color:P}}>💰 수익화 2가지</div>
        <div className="g-step-title" style={{color:"#fff"}}>무엇을 선택할까요?</div>
        <div className="g-step-desc">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:4}}>
            <div style={{padding:14,borderRadius:12,background:"rgba(3,199,90,.1)",border:"1.5px solid rgba(3,199,90,.3)"}}>
              <div style={{fontSize:15,fontWeight:900,color:"#03C75A",marginBottom:5}}>📰 애드포스트</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,.7)",lineHeight:1.7}}>네이버 블로그.<br/>친근하고 감성적.<br/>처음 시작에 추천!</div>
            </div>
            <div style={{padding:14,borderRadius:12,background:"rgba(77,166,255,.1)",border:"1.5px solid rgba(77,166,255,.3)"}}>
              <div style={{fontSize:15,fontWeight:900,color:"#4da6ff",marginBottom:5}}>🔍 애드센스</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,.7)",lineHeight:1.7}}>티스토리.<br/>구글 검색 노출.<br/>글자 수 더 많아요.</div>
            </div>
          </div>
        </div>
      </div>
    </div>,

    /* ── 1: API 키 ── */
    <div key="1">
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:Y}}>⚠️ 이것부터 해야 해요!</div>
        <div className="g-step-title" style={{color:"#fff"}}>API 키 없으면 글을 쓸 수 없어요</div>
        <div className="g-step-desc">API 키는 AI 서비스 이용권이에요. 아래 중 <b>하나만</b> 있으면 돼요!</div>
        <button className="g-btn" style={{background:`linear-gradient(135deg,${Y},#e0a500)`,color:"#000"}} onClick={()=>{setShowGuide(false);setTab("settings");}}>⚙️ 지금 API 키 설정하기</button>
      </div>
      {[{logo:"G",color:"#4285F4",name:"Gemini Flash",free:true,desc:"구글 AI. 완전 무료! 처음 시작하는 분께 강력 추천.",link:"https://aistudio.google.com/app/apikey"},{logo:"L",color:"#F55036",name:"Groq Llama 3",free:true,desc:"초고속 AI. 역시 무료!",link:"https://console.groq.com/keys"},{logo:"O",color:"#10A37F",name:"GPT-4o",free:false,desc:"가장 강력한 AI. 유료지만 최고 품질.",link:"https://platform.openai.com/api-keys"}].map((ai,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${ai.color}35`,background:`${ai.color}08`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <div style={{width:34,height:34,borderRadius:9,background:ai.color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:"#000",fontSize:14,flexShrink:0}}>{ai.logo}</div>
            <div><div style={{fontSize:15,fontWeight:800,color:"#fff"}}>{ai.name}</div><span style={{fontSize:11,fontWeight:800,padding:"2px 8px",borderRadius:99,background:ai.free?"rgba(0,200,117,.15)":"rgba(245,158,11,.15)",color:ai.free?"#00c875":"#f59e0b"}}>{ai.free?"✅ 무료":"💳 유료"}</span></div>
          </div>
          <div className="g-step-desc">{ai.desc}</div>
          <div className="g-tip" style={{marginTop:8,fontSize:13}}>🔑 <a href={ai.link} target="_blank" rel="noopener noreferrer" style={{color:Y,fontWeight:700,textDecoration:"underline"}}>여기서 키 발급</a> → 로그인 → API 키 생성 → 복사 → 설정 탭 붙여넣기</div>
        </div>
      ))}
    </div>,

    /* ── 2: 글 생성 ── */
    <div key="2">
      {[
        {n:"STEP 1",i:"🎯",t:"플랫폼 + 수익화 선택",c:G,d:<>헤더에서 <b>🟢 네이버</b> 또는 <b>🟠 티스토리</b> 선택 후, 글쓰기 탭에서 애드포스트/애드센스 선택!</>},
        {n:"STEP 2",i:"🔍",t:"키워드 입력",c:Y,d:<>예: <b>"강남 맛집"</b> 입력 후 Enter 또는 버튼 클릭! 제목 30개 자동 추천!</>},
        {n:"STEP 3",i:"⭐",t:"제목 클릭해서 선택",c:P,d:<>AI가 추천한 제목 중 마음에 드는 거 클릭! 마음에 안 들면 30개 추가도 가능!</>},
        {n:"STEP 4",i:"📏",t:"글자수 설정",c:"#8B5CF6",d:<><b>🎲 자동 랜덤</b> 추천! 네이버: 1800~2500자, 체험단: 2000~3000자, 티스토리: 2500~4000자. 매번 달라서 AI 감지 방지!</>},
        {n:"STEP 5",i:"🤖",t:"글 생성 시작",c:"#F55036",d:<><b>본문 생성 시작</b> 버튼! 인트로·소제목·마무리가 매번 달라져요. 이미지는 다음 탭에서 따로!</>},
      ].map((s,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${s.c}40`,background:`${s.c}08`}}>
          <div className="g-step-num" style={{color:s.c}}>{s.i} {s.n}</div>
          <div className="g-step-title" style={{color:"#fff"}}>{s.t}</div>
          <div className="g-step-desc">{s.d}</div>
        </div>
      ))}
    </div>,

    /* ── 3: 이미지 ── */
    <div key="3">
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:G}}>🖼️ 이미지 탭 사용법</div>
        <div className="g-step-title" style={{color:"#fff"}}>이미지마다 캡션을 꼭 입력해요!</div>
        <div className="g-step-desc">캡션(이미지 설명)은 네이버 상위 노출에 도움이 돼요. 자동 생성되지만 직접 수정도 가능해요.</div>
      </div>
      {[
        {t:"🤖 AI 자동 생성",d:"수량 자동추천 또는 직접 입력 (체험단 15장+ 가능). 생성 중 언제든 ⏹ 중단 가능!"},
        {t:"📁 내 이미지 업로드",d:"직접 찍은 사진이나 저장한 이미지. 여러 장 동시 업로드 가능!"},
        {t:"🚫 이미지 없이 발행",d:"텍스트만 발행할 때 선택."},
        {t:"📐 이미지 배치 패턴",d:"🎲 랜덤(권장): 매 발행마다 자동 변경 → AI 감지 방지!\nA: 중간 1장 / B: 앞뒤 각 1장 / C: 균등 분산"},
        {t:"🎬 영상 삽입",d:"네이버TV/유튜브 URL 입력 후 ON. 체험단 영상 필수 업체 대응! 위치(상단/중간/하단) 선택 가능."},
      ].map((item,i)=>(
        <div key={i} style={{padding:"13px 15px",borderRadius:12,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",marginBottom:8}}>
          <div style={{fontSize:15,fontWeight:800,color:"#fff",marginBottom:4}}>{item.t}</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,.65)",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.d}</div>
        </div>
      ))}
    </div>,

    /* ── 4: 발행 ── */
    <div key="4">
      <div className="g-step" style={{borderColor:`${P}40`,background:`${P}08`}}>
        <div className="g-step-num" style={{color:P}}>🚨 발행 전 필수 확인!</div>
        <div className="g-step-title" style={{color:"#fff"}}>PC에서 Publy 앱이 실행 중이어야 해요</div>
        <div className="g-step-desc">우측 패널에 <b style={{color:G}}>● 온라인</b>이 보여야 즉시 발행! 오프라인이면 예약 발행으로 처리돼요.</div>
      </div>
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:Y}}>📝 발행 방식 3가지</div>
        <div className="g-step-title" style={{color:"#fff"}}>어떤 내용을 발행할까요?</div>
        <div className="g-step-desc">
          {[["① 전체 발행","본문 + FAQ + 관련글 모두. 가장 풍부한 내용"],["② 본문+FAQ","FAQ까지만. 관련글 제외"],["③ 본문만","핵심만 깔끔하게. 가장 간결"]].map(([t,d],i)=>(
            <div key={i} style={{display:"flex",gap:8,padding:"8px 0",borderBottom:i<2?"1px solid rgba(255,255,255,.06)":"none"}}>
              <div><div style={{fontSize:14,fontWeight:800,color:"#fff"}}>{t}</div><div style={{fontSize:13,color:"rgba(255,255,255,.6)",marginTop:2}}>{d}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:G}}>✅ 발행 설정 요약 확인</div>
        <div className="g-step-title" style={{color:"#fff"}}>발행 전 이미지 패턴·캡션 확인하세요</div>
        <div className="g-step-desc">발행 탭 상단에 <b>이미지 장수, 배치 패턴, 영상 유무, 캡션 개수</b>가 표시돼요. 확인 후 발행!</div>
        <button className="g-btn" style={{background:`linear-gradient(135deg,${G},#00c870)`,color:"#000"}} onClick={()=>{setShowGuide(false);setTab("accounts");}}>🔗 계정 연결하러 가기</button>
      </div>
    </div>,

    /* ── 5: FAQ ── */
    <div key="5">
      {[
        {q:"API 키가 뭐예요?",a:"AI 서비스 비밀번호예요. 처음 한 번만 설정하면 돼요! Gemini는 구글 계정만 있으면 무료 발급!",c:G},
        {q:"글이 얼마나 걸려요?",a:"보통 30초~1분이요. AI가 글을 쓰는 중이라 잠깐 기다려주세요 ☕",c:Y},
        {q:"글자수는 어떻게 정해요?",a:"🎲 자동 랜덤 추천! 네이버: 1800~2500자, 체험단/맛집: 2000~3000자, 티스토리: 2500~4000자. 직접 설정도 가능해요.",c:P},
        {q:"체험단 이미지 15장 이상도 되나요?",a:"네! 이미지 탭에서 '✏️ 직접입력' 선택 후 숫자를 입력하면 돼요. 최대 30장까지 가능해요.",c:"#8B5CF6"},
        {q:"이미지 설명(캡션)이 뭔가요?",a:"이미지 아래 짧은 설명이에요. 네이버 상위 노출에 도움이 돼요. 자동 생성 후 수정 가능해요.",c:"#4ECDC4"},
        {q:"블로그에 ## 기호가 들어가요",a:"이미 수정됐어요! 마크다운 기호 완전 제거 기능이 적용돼 있어요.",c:P},
        {q:"이미지 생성이 안 돼요",a:"OpenAI 또는 Replicate 키가 필요해요. 없으면 '내 이미지 업로드' 또는 '이미지 없이 발행'을 선택하세요.",c:"#F55036"},
        {q:"발행 건수가 부족해요",a:"FREE 10건, BASIC 50건, PRO 무제한. 업그레이드는 관리자에게 문의하세요.",c:Y},
      ].map((item,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${item.c}35`,background:`${item.c}08`,marginBottom:8}}>
          <div className="g-step-title" style={{color:"#fff",fontSize:14}}>Q. {item.q}</div>
          <div className="g-step-desc" style={{marginTop:6}}>👉 {item.a}</div>
        </div>
      ))}
    </div>,
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className={`app ${theme}`}>

        {/* 가이드 모달 */}
        {showGuide&&(
          <div className="guide-overlay" onClick={()=>{localStorage.setItem("publy_guide_seen","1");setShowGuide(false);}}>
            <div className="guide-modal" onClick={e=>e.stopPropagation()}>
              <div className="guide-header" style={{position:"relative"}}>
                <div className="guide-logo-row"><div className="guide-logo-ico">📖</div><div><div className="guide-title">PUBLY 사용설명서</div><div className="guide-subtitle">처음이세요? 이것만 읽으면 바로 시작!</div></div></div>
                <button className="guide-close" onClick={()=>{localStorage.setItem("publy_guide_seen","1");setShowGuide(false);}}>✕</button>
                <div className="guide-tabs">{guideTabs.map((t,i)=><button key={i} className={`guide-tab ${guideTab===i?"active":""}`} onClick={()=>setGuideTab(i)}>{t}</button>)}</div>
              </div>
              <div className="guide-body">{guidePages[guideTab]}</div>
              <div className="guide-footer">
                <button className="guide-nav-btn" style={{borderColor:"rgba(255,255,255,.15)",background:"transparent",color:"rgba(255,255,255,.6)"}} onClick={()=>setGuideTab(Math.max(0,guideTab-1))} disabled={guideTab===0}>← 이전</button>
                <span className="guide-page">{guideTab+1} / {guideTabs.length}</span>
                {guideTab<guideTabs.length-1?<button className="guide-nav-btn" style={{borderColor:Y,background:`${Y}15`,color:Y}} onClick={()=>setGuideTab(guideTab+1)}>다음 →</button>:<button className="guide-nav-btn" style={{borderColor:G,background:`${G}15`,color:G}} onClick={()=>{localStorage.setItem("publy_guide_seen","1");setShowGuide(false);}}>✅ 시작하기!</button>}
              </div>
            </div>
          </div>
        )}

        {/* 미리보기 모달 */}
        {showPreview&&(
          <div className="preview-overlay" onClick={()=>setShowPreview(false)}>
            <div className="preview-inner" onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <span style={{fontSize:13,color:"#888",fontWeight:700}}>📱 구독자 미리보기</span>
                <button style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#aaa"}} onClick={()=>setShowPreview(false)}>✕</button>
              </div>
              <div style={{fontFamily:"'Apple SD Gothic Neo','Malgun Gothic',sans-serif"}}>
                <h1 style={{fontSize:24,fontWeight:700,color:"#191919",lineHeight:1.4,marginBottom:14}}>{genTitle||pubTitle}</h1>
                {genTags&&<div style={{marginBottom:16,display:"flex",flexWrap:"wrap",gap:5}}>{genTags.split(",").map((t:string,i:number)=><span key={i} style={{fontSize:12,padding:"3px 10px",borderRadius:99,background:"#f1f3f5",color:"#495057"}}>#{t.trim()}</span>)}</div>}
                {activeImages[0]&&<img src={activeImages[0]} alt="" style={{width:"100%",maxHeight:300,objectFit:"cover",borderRadius:12,marginBottom:18}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>}
                <div style={{fontSize:16,color:"#333",lineHeight:2,whiteSpace:"pre-wrap"}}>{buildPublishContent()}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── 헤더 ── */}
        <div className="header">
          <a className="logo" href="#" onClick={e=>e.preventDefault()}>
            <div className="logo-ico" style={{fontSize:17,fontWeight:900,color:"#000"}}>P</div>
            <span className="logo-text">PUBLY</span>
          </a>
          <div className="header-mid">
            <button style={{padding:"5px 12px",borderRadius:99,border:"1.5px solid",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",background:platform==="naver"?"rgba(3,199,90,.1)":"transparent",color:platform==="naver"?"var(--naver)":"var(--text2)",borderColor:platform==="naver"?"rgba(3,199,90,.4)":"var(--border)"}} onClick={()=>setPlatform("naver")}>🟢 네이버</button>
            <button style={{padding:"5px 12px",borderRadius:99,border:"1.5px solid",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",background:platform==="tistory"?"rgba(255,107,53,.1)":"transparent",color:platform==="tistory"?"var(--tistory)":"var(--text2)",borderColor:platform==="tistory"?"rgba(255,107,53,.4)":"var(--border)"}} onClick={()=>setPlatform("tistory")}>🟠 티스토리</button>
            <div className={`server-chip ${botOnline?"server-on":"server-off"}`}><div className={`dot ${botOnline?"dot-on":"dot-off"}`}/>{botOnline?"서버 온라인":"서버 오프라인"}</div>
            <div className="quota-chip"><div className="quota-bar-bg"><div className="quota-bar-fill" style={{width:`${quota?Math.min(100,(quota.used_quota/quota.total_quota)*100):0}%`}}/></div>{quota?.remaining_quota??"-"}건<span className={`plan-badge plan-${user.plan}`}>{PLAN_LABELS[user.plan]}</span></div>
            <a href={EXE_DOWNLOAD_URL} className="dl-btn" download><span>⬇️</span><span>PC앱 다운로드</span></a>
          </div>
          <div className="header-right">
            <button className="guide-open-btn" onClick={()=>{setShowGuide(true);setGuideTab(0);}}>📖 <span className="guide-btn-text">사용설명서</span></button>
            <button className="icon-btn" onClick={onThemeToggle}>{theme==="dark"?"☀️":"🌙"}</button>
            <button className="icon-btn" onClick={checkBot}>🔄</button>
            <div className="user-chip" onClick={onAdminLogin}><div className="user-avatar">{(user.name||user.email)[0].toUpperCase()}</div><span className="user-name">{user.name||user.email.split("@")[0]}</span></div>
            <button className="logout-btn" onClick={onLogout}>로그아웃</button>
          </div>
        </div>

        {/* 레이아웃 */}
        <div className="layout">
          <div className="sidebar">
            <div className="nav-lbl">메뉴</div>
            {MAIN_TABS.map(t=>(
              <button key={t.k} className={`nav-item ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as MainTab)}>
                <span className="nav-ico">{t.i}</span>{t.l}
                {t.k==="keyword"&&titles.length>0&&<span className="nav-badge">{titles.length}</span>}
                {t.k==="manage"&&history.length>0&&<span className="nav-badge">{history.length}</span>}
              </button>
            ))}
            <div className="sidebar-foot">
              <div className="stat-card"><div className="stat-num">{todayPub}</div><div className="stat-lbl">오늘 발행</div></div>
              <div className="stat-card" style={{background:"var(--accent-bg)",borderColor:"var(--accent-border)"}}><div className="stat-num" style={{fontSize:18,color:"var(--accent-text)"}}>{quota?.remaining_quota??"—"}</div><div className="stat-lbl">잔여 건수</div></div>
            </div>
          </div>

          <div className="main">

            {/* ===== 글 생성 ===== */}
            {/* ═══ 🔍 키워드/제목 탭 ═══ */}
            {tab==="keyword"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="steps">
                  {[{n:"1",t:"키워드 입력"},{n:"2",t:"제목 추천"},{n:"3",t:"제목 선택"}].map((s,i)=>{
                    const done=(i===0&&keywords.length>0)||(i===1&&titles.length>0)||(i===2&&!!selectedTitle);
                    const active=(i===0&&keywords.length===0)||(i===1&&keywords.length>0&&titles.length===0)||(i===2&&titles.length>0&&!selectedTitle);
                    return(<div key={i} className={`step-item ${done?"done":active?"active":""}`}><span className="step-n">STEP {s.n}</span>{done?"✓ ":""}{s.t}</div>);
                  })}
                </div>

                {/* 수익화 목적 + 플랫폼 */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">🎯 수익화 목적 선택</div>
                    <select className="inp" style={{width:110,padding:"7px 10px",fontSize:12}} value={platform} onChange={e=>setPlatform(e.target.value as any)}>
                      <option value="naver">네이버</option><option value="tistory">티스토리</option>
                    </select>
                  </div>
                  <div className="adtype-row">
                    {([{id:"adpost",label:"📰 네이버 애드포스트",sub:"감성적·경험 공유형\n1200~1500자 최적",cls:"sel-adpost"},{id:"adsense",label:"🔍 구글 애드센스",sub:"정보성·SEO 최적화\n1500자+ 최적",cls:"sel-adsense"}] as const).map(t=>(
                      <button key={t.id} className={`adtype-btn ${adType===t.id?t.cls:""}`} onClick={()=>setAdType(t.id)}>
                        <div className="adtype-lbl">{t.label}</div>
                        <div className="adtype-sub" style={{whiteSpace:"pre-line"}}>{t.sub}</div>
                        {adType===t.id&&<div style={{position:"absolute",top:10,right:12,fontSize:14,color:t.id==="adpost"?"var(--naver)":"var(--info)"}}>✓</div>}
                      </button>
                    ))}
                  </div>

                  {/* 누적 키워드 풀 */}
                  {keywords.length>0&&(
                    <div style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <label className="inp-label" style={{margin:0}}>🏷️ 누적 키워드 <span style={{color:"var(--text3)",fontWeight:400}}>({keywords.length}/{MAX_KW})</span></label>
                        <button className="btn btn-danger btn-sm" style={{padding:"4px 10px",fontSize:11}} onClick={()=>{setKeywords([]);localStorage.removeItem("publy_kws");}}>전체 삭제</button>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {keywords.map((kw,i)=>(
                          <button key={i} onClick={()=>setKeyword(kw)} style={{padding:"7px 14px",borderRadius:99,fontSize:13,fontWeight:600,cursor:"pointer",border:`1.5px solid ${keyword===kw?"var(--accent)":"var(--border)"}`,background:keyword===kw?"var(--accent-bg)":"var(--bg)",color:keyword===kw?"var(--accent-text)":"var(--text2)",fontFamily:"inherit",transition:"all .15s"}}>{kw}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 키워드 입력 */}
                  <label className="inp-label">🔍 키워드 입력</label>
                  <div style={{display:"flex",gap:8}}>
                    <input className="inp lg" style={{flex:1}} placeholder="예: 강남 맛집, 다이어트 방법, 제주도 여행..." value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGenerateTitles(true)}/>
                  </div>

                  <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                    <button className="btn btn-primary" onClick={()=>handleGenerateTitles(true)} disabled={loadingTitles||!keyword}>{loadingTitles?<><span className="spinner"/>추천 중...</>:<>⭐ 제목 {BATCH}개 추천받기</>}</button>
                    {titles.length>0&&<button className="btn btn-secondary" onClick={()=>handleGenerateTitles(false)} disabled={loadingTitles}>{titles.length>=MAX_TITLES?"🔄 초기화 후 재생성":"➕ 30개 추가"}</button>}
                    {titles.length>0&&<button className="btn btn-danger btn-sm" onClick={()=>{setTitles([]);setSelectedTitle("");localStorage.removeItem("publy_titles");}}>🗑 제목 초기화</button>}
                  </div>

                  {/* 제목 진행바 */}
                  {titles.length>0&&(
                    <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1,height:4,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${(titles.length/MAX_TITLES)*100}%`,background:titles.length>=MAX_TITLES?"var(--danger)":"var(--accent)",borderRadius:99,transition:"width .4s"}}/>
                      </div>
                      <span style={{fontSize:11,color:titles.length>=MAX_TITLES?"var(--danger)":"var(--text2)",fontFamily:"monospace",flexShrink:0}}>{titles.length}/{MAX_TITLES}</span>
                    </div>
                  )}
                </div>

                {/* 제목 목록 */}
                {titles.length>0&&(
                  <div className="card" style={{animation:"fadeUp .2s ease both"}}>
                    <div className="card-header">
                      <div className="card-title">✨ 제목 선택</div>
                      <span style={{fontSize:11,color:"var(--text3)"}}>클릭해서 선택</span>
                    </div>
                    {selectedTitle&&(<div className="sel-banner"><div className="sel-banner-lbl">✅ 선택된 제목</div><div className="sel-banner-txt">{selectedTitle}</div></div>)}
                    <div className="title-grid">
                      {titles.map((t,i)=>(
                        <button key={`${t}-${i}`} className={`title-card ${selectedTitle===t?"sel":""}`} onClick={()=>setSelectedTitle(t)}>
                          <div className="title-n">#{titles.length-i}</div>
                          <div className="title-t">{t}</div>
                          {selectedTitle===t&&<div className="title-chk">✓</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 다음 단계 버튼 */}
                {selectedTitle&&(
                  <div className="flow-nav">
                    <button className="flow-btn flow-btn-g" onClick={()=>setTab("write")}>✍️ 글 생성하러 가기 →</button>
                  </div>
                )}
              </div>
            )}

            {/* ═══ ✍️ 글 생성 탭 ═══ */}
            {tab==="write"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 선택된 제목 표시 - 없으면 경고 */}
                {selectedTitle?(
                  <div className="sel-banner" style={{marginBottom:16}}>
                    <div className="sel-banner-lbl">📌 선택된 제목 — <span style={{fontWeight:400,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("keyword")}>키워드/제목 탭에서 변경</span></div>
                    <div className="sel-banner-txt">{selectedTitle}</div>
                  </div>
                ):(
                  <div className="alert-box alert-warn" style={{display:"flex",alignItems:"center",gap:10}}>
                    ⚠️ 먼저 키워드/제목 탭에서 제목을 선택해주세요
                    <button className="btn btn-secondary btn-sm" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>setTab("keyword")}>키워드/제목 탭으로 →</button>
                  </div>
                )}

                <div className="card">
                  <div className="card-title" style={{marginBottom:16}}>⚙️ 글 생성 설정</div>
                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <label className="inp-label" style={{margin:0}}>📏 목표 글자수</label>
                      <span style={{fontSize:18,fontWeight:900,color:"var(--accent-text)",fontFamily:"'Space Grotesk',sans-serif"}}>{targetChars.toLocaleString()}자</span>
                    </div>
                    {/* 자동/수동 모드 */}
                    <div style={{display:"flex",gap:6,marginBottom:10}}>
                      <button onClick={()=>setCharMode("auto")} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${charMode==="auto"?"var(--accent)":"var(--border)"}`,background:charMode==="auto"?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:charMode==="auto"?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>🎲 자동 랜덤</button>
                      <button onClick={()=>setCharMode("manual")} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${charMode==="manual"?"var(--accent)":"var(--border)"}`,background:charMode==="manual"?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:charMode==="manual"?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>✏️ 직접 설정</button>
                    </div>
                    {charMode==="auto"?(
                      <div style={{padding:"10px 12px",borderRadius:9,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,color:"var(--accent-text)",fontWeight:600,lineHeight:1.6}}>
                        🎲 생성마다 자동 랜덤<br/>
                        <span style={{fontSize:11,opacity:.8}}>
                          {platform==="tistory"?"티스토리: 2500~4000자":adType==="adpost"&&/체험단|맛집|후기|리뷰/.test(keyword)?"체험단/맛집: 2000~3000자":"네이버: 1800~2500자"}
                        </span>
                      </div>
                    ):(
                      <>
                        <input type="range" min={1200} max={4000} step={50} value={targetChars} onChange={e=>setTargetChars(Number(e.target.value))} style={{width:"100%",accentColor:"var(--accent)",height:6,cursor:"pointer"}}/>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginTop:4}}><span>1,200자</span><span>2,500자</span><span>4,000자</span></div>
                      </>
                    )}
                  </div>
                  <button className="btn btn-primary btn-full btn-xl" onClick={handleGenerate} disabled={generating||!selectedTitle}>
                    {generating?<><span className="spinner"/>AI가 글을 쓰고 있어요...</>:<>✍️ 본문 생성 시작</>}
                  </button>
                  {generating&&<div style={{textAlign:"center",marginTop:8}}><button className="btn-stop" onClick={()=>abortRef.current?.abort()}>⏹ 생성 중단</button></div>}
                </div>

                {genContent&&(
                  <div className="card" style={{animation:"fadeUp .2s ease both"}}>
                    <div className="card-header">
                      <div className="card-title">🎉 글 생성 완료!</div>
                      <div style={{display:"flex",gap:7,alignItems:"center"}}>
                        <span style={{padding:"4px 12px",borderRadius:99,fontSize:12,fontWeight:800,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>{genContent.length.toLocaleString()}자</span>
                        <button style={{padding:"7px 14px",borderRadius:9,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}} onClick={()=>setShowPreview(true)}>👁️ 미리보기</button>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:14}}>
                      <div><label className="inp-label">제목</label><input className="inp" value={genTitle} onChange={e=>setGenTitle(e.target.value)}/></div>
                      <div><label className="inp-label">태그 (쉼표 구분)</label><input className="inp" value={genTags} onChange={e=>setGenTags(e.target.value)}/></div>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><label className="inp-label" style={{margin:0}}>본문</label><span style={{fontSize:12,color:"var(--text2)"}}>{genContent.length.toLocaleString()}자</span></div>
                        <textarea className="inp" rows={10} style={{fontSize:13,lineHeight:1.8}} value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                      </div>
                    </div>
                    <div className="flow-nav">
                      <button className="flow-btn flow-btn-g" onClick={()=>setTab("image")}>🖼️ 이미지 생성하기 →</button>
                      <button className="flow-btn flow-btn-skip" onClick={()=>setTab("publish")}>🚀 이미지 없이 발행</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===== 이미지 생성 ===== */}
            {tab==="image"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!genContent&&(<div className="alert-box alert-warn">⚠️ 먼저 글 생성 탭에서 글을 생성해주세요!<button className="btn btn-sm btn-secondary" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>setTab("write")}>글 생성하러 가기</button></div>)}

                <div className="img-split" style={{display:"grid",gap:14,alignItems:"start"}}>

                  {/* ── 왼쪽: 설정 패널 ── */}
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>

                    {/* 현재 키워드 + 영문 프롬프트 */}
                    {(keyword||genTitle)&&(
                      <div className="card" style={{padding:"14px 16px"}}>
                        <div className="card-title" style={{marginBottom:10}}>🔍 이미지 프롬프트</div>
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:10,fontWeight:700,color:"var(--text3)",marginBottom:4}}>키워드</div>
                          <div style={{fontSize:14,fontWeight:800,color:"var(--accent-text)"}}>{keyword||genTitle}</div>
                        </div>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,color:"var(--text3)",marginBottom:4}}>영문 프롬프트</div>
                          <div style={{fontSize:11,color:"var(--text2)",lineHeight:1.6,background:"var(--bg)",padding:"8px 10px",borderRadius:8,border:"1px solid var(--border)",wordBreak:"break-all"}}>
                            {currentImgPrompt||buildImgPrompt(keyword||genTitle,genTitle,0)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 이미지 소스 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div className="card-title" style={{marginBottom:12}}>⚙️ 이미지 설정</div>
                      <label className="inp-label">이미지 소스</label>
                      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                        {([{id:"ai",ico:"🤖",label:"AI 자동 생성"},{id:"upload",ico:"📁",label:"내 이미지 업로드"},{id:"none",ico:"🚫",label:"이미지 없이 발행"}] as const).map(s=>(
                          <button key={s.id} onClick={()=>setImgSource(s.id)} style={{padding:"10px 14px",borderRadius:10,border:`1.5px solid ${imgSource===s.id?"var(--accent)":"var(--border)"}`,background:imgSource===s.id?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",transition:"all .15s",display:"flex",alignItems:"center",gap:9,textAlign:"left"}}>
                            <span style={{fontSize:18}}>{s.ico}</span>
                            <span style={{fontSize:13,fontWeight:600,color:imgSource===s.id?"var(--accent-text)":"var(--text2)"}}>{s.label}</span>
                            {imgSource===s.id&&<span style={{marginLeft:"auto",color:"var(--accent-text)"}}>✓</span>}
                          </button>
                        ))}
                      </div>

                      {/* AI 수량 설정 */}
                      {imgSource==="ai"&&(
                        <>
                          <label className="inp-label">생성 수량</label>
                          {/* 자동/수동 모드 전환 */}
                          <div style={{display:"flex",gap:6,marginBottom:10}}>
                            <button onClick={()=>{setImgCountAuto(true);if(genContent)setImgCount(recommendImgCount(genContent));}} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${imgCountAuto?"var(--accent)":"var(--border)"}`,background:imgCountAuto?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:imgCountAuto?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>🤖 자동추천</button>
                            <button onClick={()=>setImgCountAuto(false)} style={{flex:1,padding:"7px",borderRadius:8,border:`1.5px solid ${!imgCountAuto?"var(--accent)":"var(--border)"}`,background:!imgCountAuto?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:!imgCountAuto?"var(--accent-text)":"var(--text2)",fontFamily:"inherit"}}>✏️ 직접입력</button>
                          </div>

                          {imgCountAuto?(
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",marginBottom:10}}>
                              <span style={{fontSize:12,color:"var(--accent-text)",fontWeight:600}}>💡 글자 수 기반 추천</span>
                              <span style={{fontSize:24,fontWeight:900,color:"var(--accent-text)",fontFamily:"'Space Grotesk',sans-serif"}}>{imgCount}장</span>
                            </div>
                          ):(
                            <div style={{marginBottom:10}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                                <button onClick={()=>setImgCount(Math.max(1,imgCount-1))} style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",cursor:"pointer",fontSize:18,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                                <input type="number" min={1} max={30} value={imgCount} onChange={e=>setImgCount(Math.max(1,Math.min(30,Number(e.target.value))))} style={{flex:1,textAlign:"center",padding:"7px",borderRadius:8,border:"1.5px solid var(--border)",background:"var(--bg2)",color:"var(--text)",fontSize:18,fontWeight:900,fontFamily:"'Space Grotesk',sans-serif"}}/>
                                <button onClick={()=>setImgCount(Math.min(30,imgCount+1))} style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",cursor:"pointer",fontSize:18,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                              </div>
                              <div style={{fontSize:11,color:"var(--text3)",textAlign:"center"}}>체험단 15장 이상도 가능 (최대 30장)</div>
                            </div>
                          )}

                          {/* 진행률 */}
                          {genImgLoading&&(
                            <div style={{marginBottom:12,padding:"12px 14px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--border)"}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                                <span style={{fontSize:12,fontWeight:700,color:"var(--accent-text)",animation:"pulse 1.2s infinite"}}>⏳ {genImgCurrent} / {imgCount}장</span>
                                <span style={{fontSize:14,fontWeight:900,color:"var(--accent-text)",fontFamily:"'Space Grotesk',sans-serif"}}>{genImgProgress}%</span>
                              </div>
                              <div style={{height:8,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${genImgProgress}%`,background:"linear-gradient(90deg,var(--accent),#00cc80)",borderRadius:99,transition:"width .4s"}}/>
                              </div>
                            </div>
                          )}

                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            <button className="btn btn-primary btn-full" onClick={handleGenerateImages} disabled={genImgLoading||!genContent}>
                              {genImgLoading?<><span className="spinner"/>생성 중...</>:<>🎨 이미지 생성 시작</>}
                            </button>
                            {genImgLoading&&<button className="btn-stop" style={{width:"100%",justifyContent:"center"}} onClick={stopImageGen}>⏹ 생성 중단</button>}
                            {generatedImages.length>0&&!genImgLoading&&<button className="btn btn-danger btn-full btn-sm" onClick={()=>{setGeneratedImages([]);setCaptions([]);}}>🗑 이미지 초기화</button>}
                          </div>
                        </>
                      )}

                      {imgSource==="upload"&&(
                        <div>
                          <label style={{display:"flex",alignItems:"center",gap:10,padding:"16px 14px",borderRadius:10,border:"2px dashed var(--accent-border)",background:"var(--accent-bg)",cursor:"pointer"}}>
                            <span style={{fontSize:24}}>📁</span>
                            <div><div style={{fontSize:13,fontWeight:700,color:"var(--accent-text)"}}>파일 선택</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>여러 장 동시 가능 (체험단 15장+)</div></div>
                            <input type="file" accept="image/*" multiple onChange={e=>{handleImageUpload(e);setTimeout(()=>setCaptions(buildCaptions(keyword||genTitle,uploadedImages.length+1)),100);}} style={{display:"none"}}/>
                          </label>
                          {uploadedImages.length>0&&<button className="btn btn-danger btn-full btn-sm" style={{marginTop:10}} onClick={()=>{setUploadedImages([]);setCaptions([]);}}>🗑 업로드 초기화</button>}
                        </div>
                      )}

                      {imgSource==="none"&&(
                        <div style={{padding:"14px",borderRadius:10,background:"rgba(255,83,99,.06)",border:"1px solid rgba(255,83,99,.2)",fontSize:13,color:"var(--text2)",lineHeight:1.7}}>
                          이미지 없이 텍스트만 발행해요.
                        </div>
                      )}
                    </div>

                    {/* 영상 삽입 설정 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                        <div>
                          <div className="card-title" style={{margin:0}}>🎬 영상 삽입</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>체험단 영상 필수 업체 대응</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,fontWeight:700,color:videoOn?"var(--accent-text)":"var(--text3)"}}>{videoOn?"ON":"OFF"}</span>
                          <button onClick={()=>setVideoOn(v=>!v)} style={{width:48,height:26,borderRadius:99,background:videoOn?"var(--accent)":"var(--border)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                            <div style={{position:"absolute",top:3,left:videoOn?25:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
                          </button>
                        </div>
                      </div>
                      {!videoOn&&<div style={{fontSize:12,color:"var(--text3)",padding:"8px 10px",borderRadius:8,background:"var(--bg2)"}}>OFF 상태입니다. 영상을 삽입하려면 위 버튼을 눌러 ON 하세요.</div>}
                      {videoOn&&(
                        <>
                          <div style={{marginBottom:10,padding:"8px 10px",borderRadius:8,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,color:"var(--accent-text)",fontWeight:600}}>✅ 영상 삽입 ON — URL을 입력해주세요</div>
                          <input className="inp" placeholder="네이버TV 또는 유튜브 영상 주소 붙여넣기" value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} style={{marginBottom:10,fontSize:13}}/>
                          <label className="inp-label">📍 영상을 글 어디에 넣을까요?</label>
                          <div style={{display:"flex",gap:6}}>
                            {([{v:"top",l:"🔝 글 상단",desc:"글 맨 위"},{v:"middle",l:"🔲 글 중간",desc:"본문 중간"},{v:"bottom",l:"🔽 글 하단",desc:"글 맨 아래"}] as const).map(p=>(
                              <button key={p.v} onClick={()=>setVideoPosition(p.v)} style={{flex:1,padding:"8px 4px",borderRadius:8,border:`1.5px solid ${videoPosition===p.v?"var(--accent)":"var(--border)"}`,background:videoPosition===p.v?"var(--accent-bg)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:videoPosition===p.v?"var(--accent-text)":"var(--text2)",fontFamily:"inherit",textAlign:"center"}}>
                                <div>{p.l}</div>
                                <div style={{fontSize:10,fontWeight:400,marginTop:2,color:"var(--text3)"}}>{p.desc}</div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* 이미지 배치 패턴 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div className="card-title" style={{marginBottom:4}}>📐 이미지 배치 패턴</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:12}}>글 안에 이미지를 어떻게 배치할지 선택해요</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {([
                          {v:"random",l:"🎲 랜덤",badge:"권장",sub:"매 발행마다 자동으로 패턴 변경",desc:"AI 감지 방지에 가장 효과적이에요",diagram:"🖼️ → 📝 → 🖼️ → 📝"},
                          {v:"A",l:"패턴 A",badge:"",sub:"썸네일 + 중간 이미지 1장",desc:"글 중간에 이미지 1장 배치",diagram:"🖼️썸네일 → 📝글 → 🖼️중간 → 📝글"},
                          {v:"B",l:"패턴 B",badge:"",sub:"썸네일 + 앞뒤 이미지 각 1장",desc:"글 앞과 뒤에 각각 1장씩",diagram:"🖼️썸네일 → 🖼️앞 → 📝글 → 🖼️뒤"},
                          {v:"C",l:"패턴 C",badge:"",sub:"썸네일 + 이미지 균등 분산",desc:"이미지를 글 전체에 고르게 배치",diagram:"🖼️썸네일 → 📝 → 🖼️ → 📝 → 🖼️"},
                        ] as const).map(p=>(
                          <button key={p.v} onClick={()=>setImgPattern(p.v)} style={{padding:"11px 13px",borderRadius:10,border:`1.5px solid ${imgPattern===p.v?"var(--accent)":"var(--border)"}`,background:imgPattern===p.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s"}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                              <span style={{fontSize:13,fontWeight:800,color:imgPattern===p.v?"var(--accent-text)":"var(--text)"}}>{p.l}</span>
                              {p.badge&&<span style={{fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:99,background:"var(--accent)",color:"#000"}}>{p.badge}</span>}
                            </div>
                            <div style={{fontSize:12,color:"var(--text2)",marginBottom:4}}>{p.sub}</div>
                            <div style={{fontSize:11,color:"var(--text3)",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.diagram}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── 오른쪽: 갤러리 + 캡션 ── */}
                  <div>
                    <div className="card" style={{minHeight:300}}>
                      <div className="card-header" style={{marginBottom:14}}>
                        <div className="card-title">
                          🖼️ 생성된 이미지
                          {getActiveImages().length>0&&<span style={{fontWeight:500,color:"var(--text3)",textTransform:"none",letterSpacing:0}}> — {getActiveImages().length}장 · 첫 번째가 썸네일</span>}
                        </div>
                        {getActiveImages().length>0&&captions.length===0&&(
                          <button className="btn btn-sm btn-secondary" onClick={()=>setCaptions(buildCaptions(keyword||genTitle,getActiveImages().length))}>💬 캡션 자동생성</button>
                        )}
                      </div>

                      {getActiveImages().length===0&&!genImgLoading?(
                        <div style={{textAlign:"center",padding:"48px 24px",color:"var(--text3)"}}>
                          <div style={{fontSize:48,marginBottom:12,animation:"float 3s ease-in-out infinite"}}>🖼️</div>
                          <div style={{fontSize:15,fontWeight:700,color:"var(--text2)",marginBottom:6}}>아직 이미지가 없어요</div>
                          <div style={{fontSize:13}}>왼쪽에서 설정 후 생성 버튼을 눌러주세요</div>
                        </div>
                      ):(
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:14}}>
                          {genImgLoading&&Array.from({length:imgCount-generatedImages.length}).map((_,i)=>(
                            <div key={`ph-${i}`} style={{display:"flex",flexDirection:"column",gap:6}}>
                              <div style={{aspectRatio:"1",borderRadius:12,background:"var(--bg)",border:"2px dashed var(--border)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                {i===0?<><span className="spinner" style={{width:24,height:24}}/></>:<span style={{fontSize:22,opacity:.3}}>🖼️</span>}
                              </div>
                            </div>
                          ))}
                          {getActiveImages().map((img,i)=>(
                            <div key={i} style={{display:"flex",flexDirection:"column",gap:6}}>
                              <div style={{position:"relative",aspectRatio:"1"}}>
                                <img src={img} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:12,border:i===0?"2px solid var(--accent)":"2px solid var(--border)",display:"block",animation:"imgIn .3s ease both",cursor:"pointer"}}
                                  onClick={()=>window.open(img,"_blank")}
                                  onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                {i===0&&<span style={{position:"absolute",top:-7,left:-4,fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,background:"var(--accent)",color:"#000",whiteSpace:"nowrap"}}>썸네일</span>}
                                <button style={{position:"absolute",top:-8,right:-8,width:28,height:28,borderRadius:"50%",background:"var(--danger)",border:"2px solid var(--bg)",color:"#fff",cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}
                                  onClick={()=>{
                                    if(imgSource==="ai")setGeneratedImages(p=>p.filter((_,j)=>j!==i));
                                    else setUploadedImages(p=>p.filter((_,j)=>j!==i));
                                    setCaptions(p=>p.filter((_,j)=>j!==i));
                                  }}>✕</button>
                              </div>
                              {/* 캡션 입력창 - 필수 */}
                              <input
                                className="img-caption-inp"
                                placeholder={`캡션 입력 (예: ${keyword||"사진"} ${i===0?"대표":"현장"} 사진)`}
                                value={captions[i]||""}
                                onChange={e=>{const next=[...captions];next[i]=e.target.value;setCaptions(next);}}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flow-nav">
                      <button className="flow-btn flow-btn-g" onClick={()=>setTab("publish")} disabled={!genContent}>🚀 발행하기로 이동 →</button>
                      <button className="flow-btn flow-btn-skip" onClick={()=>setTab("write")}>← 글 생성으로</button>
                    </div>
                  </div>
                </div>
              </div>
            )}



            {/* ===== 발행하기 ===== */}
            {tab==="publish"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!botOnline&&<div className="alert-box alert-warn">⚠️ 봇 서버 오프라인 — PC에서 Publy 앱을 실행하면 즉시 발행, 아니면 예약 발행으로 처리돼요.</div>}
                {quota&&quota.remaining_quota<=0&&<div className="alert-box alert-danger">⚠️ 발행 건수를 모두 사용했어요. 플랜을 업그레이드해주세요.</div>}

                {/* 이미지/영상 설정 요약 */}
                {(getActiveImages().length>0||videoOn)&&(
                  <div className="card" style={{padding:"14px 16px",marginBottom:14}}>
                    <div className="card-title" style={{marginBottom:10}}>📐 발행 설정 요약</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      <div style={{padding:"6px 12px",borderRadius:99,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,fontWeight:700,color:"var(--accent-text)"}}>
                        🖼️ 이미지 {getActiveImages().length}장
                      </div>
                      <div style={{padding:"6px 12px",borderRadius:99,background:"var(--card2)",border:"1px solid var(--border)",fontSize:12,fontWeight:700,color:"var(--text2)"}}>
                        📐 패턴 {(()=>{
                          if(imgPattern==="random"){const r=Math.random();return r<0.5?"A (자동)":r<0.85?"B (자동)":"C (자동)";}
                          return imgPattern;
                        })()}
                      </div>
                      {videoOn&&videoUrl&&(
                        <div style={{padding:"6px 12px",borderRadius:99,background:"rgba(255,107,53,.08)",border:"1px solid rgba(255,107,53,.25)",fontSize:12,fontWeight:700,color:"var(--tistory)"}}>
                          🎬 영상 {videoPosition==="top"?"상단":videoPosition==="middle"?"중간":"하단"} 삽입
                        </div>
                      )}
                      {captions.filter(Boolean).length>0&&(
                        <div style={{padding:"6px 12px",borderRadius:99,background:"rgba(78,205,196,.08)",border:"1px solid rgba(78,205,196,.25)",fontSize:12,fontWeight:700,color:"var(--info)"}}>
                          💬 캡션 {captions.filter(Boolean).length}개
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>📝 발행 방식 선택</div>
                  <div className="concept-grid">
                    {([{id:"full",ico:"📄",name:"① 전체 발행",sub:"본문 + FAQ + 관련글 모두\n가장 풍부한 내용",cls:"sel-full"},{id:"body_faq",ico:"💬",name:"② 본문 + FAQ",sub:"본문과 자주 묻는 질문까지\n관련글 섹션 제외",cls:"sel-faq"},{id:"body_only",ico:"✏️",name:"③ 본문만",sub:"핵심 내용만 깔끔하게\n가장 간결한 형태",cls:"sel-body"}] as const).map(c=>(
                      <button key={c.id} className={`concept-btn ${pubConcept===c.id?c.cls:""}`} onClick={()=>setPubConcept(c.id)}>
                        <div className="concept-ico">{c.ico}</div>
                        <div className="concept-name">{c.name}</div>
                        <div className="concept-sub">{c.sub}</div>
                        {pubConcept===c.id&&<div style={{marginTop:8,fontSize:12,fontWeight:700,color:c.id==="full"?"var(--accent-text)":c.id==="body_faq"?"var(--pink)":"var(--yellow)"}}>✓ 선택됨</div>}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title" style={{marginBottom:12}}>🌐 플랫폼 선택</div>
                  <div className="pub-plat-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {([{p:"naver",ico:"🟢",name:"네이버 블로그",c:"var(--naver)"},{p:"tistory",ico:"🟠",name:"티스토리",c:"var(--tistory)"}] as const).map(({p,ico,name,c})=>(
                      <button key={p} style={{padding:"15px 16px",borderRadius:13,border:`2px solid ${platform===p?c:"var(--border)"}`,background:platform===p?`${c}12`:"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .18s",display:"flex",alignItems:"center",gap:11}} onClick={()=>setPlatform(p)}>
                        <span style={{fontSize:26}}>{ico}</span>
                        <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{name}</div></div>
                        {platform===p&&<span style={{fontSize:16,color:c}}>✓</span>}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title" style={{marginBottom:12}}>🔗 발행 계정 선택</div>
                  {connAccs.length===0?(
                    <div style={{textAlign:"center",padding:"24px 16px"}}>
                      <div style={{fontSize:36,marginBottom:10}}>🔗</div>
                      <div style={{fontSize:15,fontWeight:700,color:"var(--text)",marginBottom:6}}>연결된 계정이 없어요</div>
                      <div style={{fontSize:13,color:"var(--text2)",marginBottom:14}}>계정 관리 탭에서 블로그 계정을 추가해주세요</div>
                      <button className="btn btn-primary btn-sm" onClick={()=>setTab("accounts")}>계정 관리로 이동 →</button>
                    </div>
                  ):connAccs.map(a=>(
                    <label key={a.id} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderRadius:12,cursor:"pointer",marginBottom:8,background:pubAccId===a.id?"var(--accent-bg)":"var(--bg)",border:`2px solid ${pubAccId===a.id?"var(--accent)":"var(--border)"}`,transition:"all .15s"}}>
                      <input type="radio" name="pacc" checked={pubAccId===a.id} onChange={()=>setPubAccId(a.id)} style={{accentColor:"var(--accent)",width:18,height:18,flexShrink:0}}/>
                      <div style={{flex:1}}><div style={{fontSize:15,fontWeight:700,color:"var(--text)"}}>{a.username}</div>{a.blog_name&&<div style={{fontSize:12,color:"var(--text2)"}}>{a.blog_name}</div>}</div>
                      <span style={{fontSize:11,fontWeight:700,padding:"4px 11px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>✅ 연결됨</span>
                    </label>
                  ))}
                </div>

                <div className="card">
                  <div className="card-header">
                    <div className="card-title">📝 발행 내용</div>
                    <button style={{padding:"7px 14px",borderRadius:9,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}} onClick={()=>setShowPreview(true)}>👁️ 미리보기</button>
                  </div>
                  {activeImages[0]&&(
                    <div style={{marginBottom:14}}>
                      <label className="inp-label">🖼️ 썸네일 이미지</label>
                      <div style={{position:"relative",display:"inline-block",width:"100%"}}>
                        <img src={activeImages[0]} alt="" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:12,border:"1px solid var(--border)"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                        <button onClick={()=>{if(imgSource==="ai")setGeneratedImages(p=>p.filter((_,j)=>j!==0));else setUploadedImages(p=>p.filter((_,j)=>j!==0));}} style={{position:"absolute",top:9,right:9,background:"rgba(0,0,0,.7)",border:"none",color:"#fff",borderRadius:99,width:28,height:28,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div><label className="inp-label">제목 *</label><input className="inp lg" placeholder="블로그 글 제목..." value={pubTitle} onChange={e=>setPubTitle(e.target.value)}/></div>
                    <div><label className="inp-label">태그 (쉼표 구분)</label><input className="inp" placeholder="태그1, 태그2, 태그3" value={pubTags} onChange={e=>setPubTags(e.target.value)}/></div>
                    <div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><label className="inp-label" style={{margin:0}}>본문 ({pubConcept==="full"?"전체":pubConcept==="body_faq"?"본문+FAQ":"본문만"})</label><span style={{fontSize:12,color:"var(--text2)"}}>{buildPublishContent().length.toLocaleString()}자</span></div>
                      <textarea className="inp" rows={6} style={{fontSize:13,lineHeight:1.8}} readOnly value={buildPublishContent()}/>
                    </div>
                  </div>
                </div>

                <button className="btn btn-primary btn-full btn-xl" style={{marginBottom:14}} onClick={handlePublish} disabled={publishing||!pubAccId||!pubTitle||!buildPublishContent()||(quota?.remaining_quota||0)<=0}>
                  {publishing?<><span className="spinner"/>발행 중...</>:<>🚀 블로그 자동 발행</>}
                </button>
                {pubMsg&&<div className={`alert-box ${pubMsg.includes("✅")?"alert-success":"alert-danger"}`}>{pubMsg}</div>}
              </div>
            )}

            {/* ===== 발행 기록 ===== */}
            {tab==="manage"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 발행 기록 */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">📋 발행 기록</div>
                    <div style={{display:"flex",gap:12,alignItems:"center"}}>
                      <span style={{fontSize:13,color:"var(--text2)"}}>총 {history.length}건 · 오늘 {todayPub}건</span>
                      <span style={{fontSize:13,fontWeight:800,color:"var(--accent-text)"}}>잔여 {quota?.remaining_quota??0}건</span>
                    </div>
                  </div>
                  {history.length===0?(
                    <div className="empty-state" style={{padding:"32px 24px"}}>
                      <span className="empty-ico">🚀</span>
                      <div className="empty-title">아직 발행 기록이 없어요</div>
                      <div className="empty-sub">글 생성 탭에서 첫 번째 글을 발행해보세요!</div>
                      <button className="btn btn-primary" onClick={()=>setTab("write")}>글 생성 시작하기 →</button>
                    </div>
                  ):history.map((h,i)=>(
                    <div key={h.id} className="hist-item" style={{animationDelay:`${i*.04}s`}}>
                      <span style={{fontSize:22,flexShrink:0}}>{h.platform==="naver"?"🟢":"🟠"}</span>
                      <div className="hist-info">
                        <div className="hist-title">{h.title}</div>
                        <div className="hist-meta">{new Date(h.published_at).toLocaleString("ko-KR")}</div>
                        {h.error_message&&<div style={{fontSize:11,color:"var(--danger)",marginTop:2}}>❌ {h.error_message}</div>}
                      </div>
                      <span className={`sbadge ${h.status==="success"?"sbadge-ok":h.status==="fail"?"sbadge-fail":"sbadge-pend"}`}>
                        {h.status==="success"?"✅ 성공":h.status==="fail"?"❌ 실패":"⏳ 대기"}
                      </span>
                      {h.post_url&&<a href={h.post_url} target="_blank" rel="noopener noreferrer" className="view-link">보기</a>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== 계정 관리 ===== */}
            {tab==="accounts"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!botOnline&&<div className="alert-box alert-warn">⚠️ PC에서 Publy 앱을 실행해야 계정 연결이 가능해요</div>}
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>➕ 계정 추가</div>
                  <div className="acc-form-grid" style={{display:"grid",gridTemplateColumns:"100px 1fr 1fr",gap:10,marginBottom:12}}>
                    <div><label className="inp-label">플랫폼</label><select className="inp" value={newPlat} onChange={e=>setNewPlat(e.target.value as any)}><option value="naver">네이버</option><option value="tistory">티스토리</option></select></div>
                    <div><label className="inp-label">아이디</label><input className="inp" placeholder="블로그 아이디" value={newUser} onChange={e=>setNewUser(e.target.value)}/></div>
                    <div><label className="inp-label">비밀번호</label><input className="inp" type="password" placeholder="비밀번호" value={newPw} onChange={e=>setNewPw(e.target.value)}/></div>
                  </div>
                  <div style={{marginBottom:14}}><label className="inp-label">블로그명 <span style={{color:"var(--text3)",fontWeight:400}}>(티스토리만)</span></label><input className="inp" placeholder="예: myblog" value={newBlog} onChange={e=>setNewBlog(e.target.value)}/></div>
                  <button className="btn btn-primary" onClick={handleAddAccount} disabled={addingAcc||!newUser||!newPw}>{addingAcc?<><span className="spinner"/>추가 중...</>:<>➕ 계정 추가</>}</button>
                </div>
                {accounts.filter(a=>a.platform!=="google").length===0?(
                  <div className="empty-state"><span className="empty-ico">🔗</span><div className="empty-title">등록된 계정이 없어요</div><div className="empty-sub">위에서 블로그 계정을 추가해주세요</div></div>
                ):accounts.filter(a=>a.platform!=="google").map((a,i)=>(
                  <div key={a.id} className={`acc-card ${a.is_connected?(a.platform==="naver"?"conn-naver":"conn-tistory"):""}`} style={{animationDelay:`${i*.06}s`}}>
                    <span style={{fontSize:26}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:15,fontWeight:700,color:"var(--text)"}}>{a.username}</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>{a.platform}{a.blog_name&&` · ${a.blog_name}`}</div></div>
                    <span style={{fontSize:11,fontWeight:700,padding:"4px 11px",borderRadius:99,background:a.is_connected?"var(--accent-bg)":"var(--card-hover)",color:a.is_connected?"var(--accent-text)":"var(--text2)",border:"1px solid",borderColor:a.is_connected?"var(--accent-border)":"var(--border)"}}>{a.is_connected?"✅ 연결됨":"미연결"}</span>
                    <button className="btn btn-secondary btn-sm" onClick={()=>handleConnect(a)} disabled={!!connId||!botOnline}>{connId===a.id?<><span className="sp-w spinner"/>연결 중...</>:a.is_connected?"재연결":"연결"}</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>handleDeleteAccount(a.id)}>🗑 삭제</button>
                  </div>
                ))}
              </div>
            )}

            {/* ===== 설정 ===== */}
            {tab==="settings"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>🤖 글쓰기 AI 선택</div>
                  <div className="ai-grid">
                    {WRITE_AI_LIST.map(item=>(
                      <button key={item.id} className={`ai-card ${writeAI===item.id?"sel-ai":""}`} style={{borderColor:writeAI===item.id?item.color:"var(--border)",background:writeAI===item.id?`${item.color}12`:"var(--bg)"}} onClick={()=>{setWriteAI(item.id);localStorage.setItem("publy_write_ai",item.id);}}>
                        <div className="ai-card-top"><div className="ai-logo" style={{background:writeAI===item.id?item.color:`${item.color}20`,color:writeAI===item.id?"#000":item.color}}>{item.logo}</div>{writeAI===item.id?<span className="ai-sel-badge" style={{background:item.color}}>✓ 선택됨</span>:item.free?<span className="ai-free">무료</span>:<span className="ai-paid">유료</span>}</div>
                        <div className="ai-name">{item.label}</div><div className="ai-sub">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                  <div className="card-title" style={{marginBottom:14,marginTop:8}}>🖼️ 이미지 AI 선택</div>
                  <div className="ai-grid">
                    {IMAGE_AI_LIST.map(item=>(
                      <button key={item.id} className={`ai-card ${imageAI===item.id?"sel-ai":""}`} style={{borderColor:imageAI===item.id?item.color:"var(--border)",background:imageAI===item.id?`${item.color}12`:"var(--bg)"}} onClick={()=>{setImageAI(item.id);localStorage.setItem("publy_image_ai",item.id);}}>
                        <div className="ai-card-top"><div className="ai-logo" style={{background:imageAI===item.id?item.color:`${item.color}20`,color:imageAI===item.id?"#000":item.color}}>{item.logo}</div>{imageAI===item.id?<span className="ai-sel-badge" style={{background:item.color}}>✓ 선택됨</span>:<span className="ai-paid">유료</span>}</div>
                        <div className="ai-name">{item.label}</div><div className="ai-sub">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                  <div className="alert-box alert-info" style={{margin:"4px 0 0"}}>💡 OpenAI 키 하나로 GPT-4o(글쓰기) + DALL-E 3(이미지) 모두 사용 가능해요</div>
                </div>
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>🔑 API 키 관리</div>
                  <div className="key-section" style={{background:"var(--accent-bg)",borderColor:"var(--accent-border)"}}><div className="key-section-title" style={{color:"var(--accent-text)"}}>📝 글쓰기 API 키</div>{WRITE_AI_LIST.map(k=><KeyInput key={k.id} k={k}/>)}</div>
                  <div className="key-section" style={{background:"rgba(155,125,255,.07)",borderColor:"rgba(155,125,255,.2)"}}><div className="key-section-title" style={{color:"var(--purple)"}}>🖼️ 이미지 API 키</div>{IMAGE_AI_LIST.map(k=><KeyInput key={k.id} k={k}/>)}</div>
                </div>
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>👤 내 계정 정보</div>
                  <div className="info-table">
                    {[{k:"이름",v:user.name||"-"},{k:"이메일",v:user.email},{k:"플랜",v:PLAN_LABELS[user.plan]},{k:"잔여 건수",v:`${quota?.remaining_quota??"-"}건`},{k:"만료일",v:quota?new Date(quota.reset_date).toLocaleDateString("ko-KR"):"-"}].map(row=>(
                      <div key={row.k} className="info-row"><span className="info-key">{row.k}</span><span className="info-val">{row.v}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="right-panel">
            <div className="rp-section">
              <div className="rp-title">📌 현재 작업</div>
              <div className="rp-row"><span className="rp-key">키워드</span><span className={`rp-val${keyword?" accent":" warn"}`}>{keyword||"미입력"}</span></div>
              <div className="rp-row"><span className="rp-key">제목</span><span className="rp-val" style={{fontSize:10,maxWidth:160}}>{selectedTitle||"—"}</span></div>
              <div className="rp-row"><span className="rp-key">글자수</span><span className={`rp-val${genContent?" accent":""}`}>{genContent?(()=>{const i=genContent.indexOf("[FAQ시작]");return(i>0?genContent.slice(0,i).trim():genContent).length.toLocaleString()+"자"})():"—"}</span></div>
              <div className="rp-row"><span className="rp-key">플랫폼</span><span className="rp-val" style={{color:platform==="naver"?"var(--naver)":"var(--tistory)"}}>{platform==="naver"?"🟢 네이버":"🟠 티스토리"}</span></div>
              <div className="rp-row"><span className="rp-key">이미지</span><span className={`rp-val${(generatedImages.length||uploadedImages.length)?" accent":""}`}>{generatedImages.length||uploadedImages.length||0}장</span></div>
            </div>
            {(generatedImages[0]||uploadedImages[0])&&(<div className="rp-section"><div className="rp-title">🖼️ 썸네일</div><img src={generatedImages[0]||uploadedImages[0]} alt="썸네일" className="rp-thumb" onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/></div>)}
            <div className="rp-section">
              <div className="rp-title">🔌 서버 상태</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:8,height:8,borderRadius:"50%",background:botOnline?"var(--accent)":"var(--danger)",flexShrink:0}}/><span style={{fontSize:12,color:botOnline?"var(--accent-text)":"var(--danger)",fontWeight:700}}>{botOnline?"온라인":"오프라인"}</span><button className="icon-btn" style={{width:26,height:26,marginLeft:"auto"}} onClick={checkBot}>🔄</button></div>
            </div>
            <button className="rp-btn rp-btn-primary" disabled={!genContent||!pubAccId} onClick={()=>setTab("publish")}>🚀 발행하러 가기</button>
            <button className="rp-btn rp-btn-secondary" onClick={()=>setShowPreview(true)} disabled={!genContent}>👁️ 미리보기</button>
          </div>

        </div>

        <div className="mob-bar">
          {MAIN_TABS.filter(t=>["keyword","write","image","publish","manage","settings"].includes(t.k)).map(t=>(<button key={t.k} className={`mob-btn ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as MainTab)}><span className="mob-btn-ico">{t.i}</span><span className="mob-btn-lbl">{t.k==="keyword"?"키워드":t.k==="write"?"글쓰기":t.k==="image"?"이미지":t.k==="publish"?"발행":t.k==="manage"?"발행관리":"설정"}</span></button>))}
        </div>
      </div>
    </>
  );
}
