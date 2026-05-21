import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, getAccounts, upsertAccount, PublyAccount } from "../lib/supabase";

interface Props {
  onBack: () => void;
  onDashboard: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

interface UserFull {
  id:string; email:string; name:string; plan:string; is_active:boolean; created_at:string; phone?:string; memo?:string;
  quota?: { total_quota:number; used_quota:number; remaining_quota:number; reset_date:string; };
  payments?: any[]; notes?: any[]; history_count?: number;
}

const BOT = "http://localhost:3333";
const ADM_UID = "admin-publy";
const GEMINI_MODELS_ADM = ["gemini-2.0-flash","gemini-2.0-flash-lite","gemini-2.5-flash","gemini-2.5-flash-lite"];
const BATCH = 30;
const MAX_TITLES = 90;
const MAX_KW = 90;

const ADM_WRITE_AI = [
  {id:"gemini",label:"Gemini Flash",sub:"무료",placeholder:"AIza...",storageKey:"publy_adm_gemini_key",link:"https://aistudio.google.com/app/apikey",color:"#4285F4",logo:"G",free:true},
  {id:"groq",label:"Groq Llama 3",sub:"무료",placeholder:"gsk_...",storageKey:"publy_adm_groq_key",link:"https://console.groq.com/keys",color:"#F55036",logo:"L",free:true},
  {id:"openai",label:"GPT-4o",sub:"유료",placeholder:"sk-...",storageKey:"publy_adm_openai_key",link:"https://platform.openai.com/api-keys",color:"#10A37F",logo:"O",free:false},
];
const ADM_IMAGE_AI = [
  {id:"openai_img",label:"DALL-E 3",sub:"유료",placeholder:"sk-...",storageKey:"publy_adm_openai_key",link:"https://platform.openai.com/api-keys",color:"#10A37F",logo:"O"},
  {id:"replicate",label:"Flux (Replicate)",sub:"유료",placeholder:"r8_...",storageKey:"publy_adm_replicate_key",link:"https://replicate.com/account/api-tokens",color:"#8B5CF6",logo:"R"},
];
const PLAN_QUOTA: Record<string,number> = {free:10, basic:50, pro:999999};
const PLAN_LABELS: Record<string,string> = {free:"FREE", basic:"BASIC", pro:"PRO"};

// ── AdmKeyInput (건드리지 않음) ─────────────────────────
function AdmKeyInput({k}:{k:any; [x:string]:any}) {
  const [val,setVal] = useState(()=>localStorage.getItem(k.storageKey)||"");
  const [show,setShow] = useState(false);
  const [saved,setSaved] = useState(false);
  const [testing,setTesting] = useState(false);
  const [testMsg,setTestMsg] = useState("");

  function save() {
    if (!val.trim()) return;
    localStorage.setItem(k.storageKey, val.trim());
    setSaved(true); setTestMsg("✅ 저장됨");
    setTimeout(()=>{setSaved(false);setTestMsg("");}, 3000);
  }

  async function testKey() {
    if (!val.trim()) { setTestMsg("❌ 키 입력 필요"); return; }
    setTesting(true); setTestMsg("");
    try {
      if (k.id === "gemini") {
        for (const model of GEMINI_MODELS_ADM) {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${val.trim()}`,
            {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"hi"}]}],generationConfig:{maxOutputTokens:10}}),signal:AbortSignal.timeout(8000)});
          if (r.ok) { setTestMsg(`✅ 성공 (${model})`); break; }
          if (r.status===401||r.status===403) { setTestMsg("❌ API 키 오류"); break; }
        }
      } else if (k.id === "groq") {
        const r = await fetch("https://api.groq.com/openai/v1/models",{headers:{"Authorization":`Bearer ${val.trim()}`},signal:AbortSignal.timeout(8000)});
        setTestMsg(r.ok ? "✅ Groq 연결 성공" : "❌ 연결 실패");
      } else if (k.id === "openai" || k.id === "openai_img") {
        const r = await fetch("https://api.openai.com/v1/models",{headers:{"Authorization":`Bearer ${val.trim()}`},signal:AbortSignal.timeout(8000)});
        setTestMsg(r.ok ? "✅ OpenAI 연결 성공" : "❌ 연결 실패");
      } else {
        setTestMsg("저장 후 생성으로 테스트");
      }
    } catch(e:any) { setTestMsg("❌ " + e.message); }
    finally { setTesting(false); }
  }

  return (
    <div className="key-row">
      <div className="key-row-header">
        <div className="key-logo" style={{background:`${k.color}20`,color:k.color}}>{k.logo}</div>
        <span className="key-label">{k.label}</span>
        <span className="key-tag">{k.sub}</span>
        <a href={k.link} target="_blank" rel="noopener noreferrer" className="key-link">키 발급 →</a>
      </div>
      <div className="key-row-input">
        <input className="inp" type={show?"text":"password"} placeholder={k.placeholder}
          value={val} onChange={e=>setVal(e.target.value)}/>
        <button className="btn-ghost" onClick={()=>setShow(s=>!s)}>{show?"숨김":"표시"}</button>
        <button className="btn-ghost" onClick={testKey} disabled={testing}>
          {testing ? "테스트 중..." : "테스트"}
        </button>
        <button className="btn-save" onClick={save} style={{background:saved?"#00c875":undefined}}>
          {saved?"✓":"저장"}
        </button>
      </div>
      {testMsg && <div style={{fontSize:12,marginTop:5,fontWeight:600,color:testMsg.includes("✅")?"var(--success)":"var(--danger)"}}>{testMsg}</div>}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}

.app.dark{
  --bg:#0d1117;--bg2:#161b22;--card:#1c2128;--card-hover:#21262d;
  --border:#30363d;--border-focus:#58a6ff;
  --text:#e6edf3;--text2:#8b949e;--text3:#6e7681;
  --accent:#00ff88;--accent-bg:rgba(0,255,136,.1);--accent-border:rgba(0,255,136,.3);--accent-text:#00ff88;
  --naver:#03C75A;--tistory:#FF6B35;
  --danger:#f85149;--warn:#f0883e;--info:#58a6ff;--success:#3fb950;
  --header-bg:rgba(13,17,23,.95);--shadow:0 8px 32px rgba(0,0,0,.4);
}
.app.light{
  --bg:#f6f8fa;--bg2:#ffffff;--card:#ffffff;--card-hover:#f6f8fa;
  --border:#d0d7de;--border-focus:#0969da;
  --text:#24292f;--text2:#57606a;--text3:#8c959f;
  --accent:#1a7f37;--accent-bg:rgba(26,127,55,.08);--accent-border:rgba(26,127,55,.3);--accent-text:#1a7f37;
  --naver:#03C75A;--tistory:#FF6B35;
  --danger:#cf222e;--warn:#9a6700;--info:#0969da;--success:#1a7f37;
  --header-bg:rgba(246,248,250,.95);--shadow:0 4px 16px rgba(0,0,0,.1);
}

.app{width:100vw;height:100vh;font-family:'Noto Sans KR',sans-serif;color:var(--text);background:var(--bg);display:flex;flex-direction:column;transition:background .2s,color .2s;overflow:hidden;}
*::-webkit-scrollbar{width:5px;}*::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px;}

.header{height:60px;flex-shrink:0;display:flex;align-items:center;padding:0 16px;gap:12px;background:var(--header-bg);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);position:sticky;top:0;z-index:100;}
.logo{display:flex;align-items:center;gap:8px;text-decoration:none;}
.logo-ico{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#ff6b6b,#ff3333);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.logo-text{font-size:17px;font-weight:900;letter-spacing:.15em;color:var(--danger);}
.header-mid{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;}
.header-right{display:flex;align-items:center;gap:6px;margin-left:auto;}
.server-badge{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:99px;font-size:12px;font-weight:700;border:1px solid;white-space:nowrap;}
.server-on{background:rgba(63,185,80,.1);color:var(--success);border-color:rgba(63,185,80,.3);}
.server-off{background:rgba(120,120,120,.08);color:var(--text2);border-color:var(--border);}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.dot-on{background:var(--success);box-shadow:0 0 6px var(--success);}
.dot-off{background:var(--text3);}
.icon-btn{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:15px;transition:all .15s;}
.icon-btn:hover{background:var(--card-hover);color:var(--text);border-color:var(--border-focus);}
.back-btn{display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:13px;font-weight:600;font-family:'Noto Sans KR',sans-serif;transition:all .15s;white-space:nowrap;}
.back-btn:hover{background:var(--card-hover);color:var(--text);border-color:var(--border-focus);}
.adm-badge{padding:5px 12px;border-radius:99px;font-size:11px;font-weight:800;background:rgba(248,81,73,.1);color:var(--danger);border:1px solid rgba(248,81,73,.3);letter-spacing:.05em;}

.layout{flex:1;display:flex;overflow:hidden;min-height:0;}
.sidebar{width:200px;flex-shrink:0;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 8px;gap:2px;overflow-y:auto;}
.nav-section{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);padding:4px 10px 6px;margin-top:4px;}
.nav-item{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:8px;border:none;cursor:pointer;width:100%;font-size:13px;font-weight:500;font-family:'Noto Sans KR',sans-serif;color:var(--text2);background:transparent;transition:all .15s;text-align:left;position:relative;}
.nav-item:hover{background:var(--card-hover);color:var(--text);}
.nav-item.active{background:rgba(248,81,73,.08);color:var(--danger);font-weight:700;}
.nav-item.active::before{content:'';position:absolute;left:0;top:25%;bottom:25%;width:3px;border-radius:99px;background:var(--danger);}
.nav-ico{font-size:16px;flex-shrink:0;}
.nav-badge{margin-left:auto;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(248,81,73,.1);color:var(--danger);border:1px solid rgba(248,81,73,.25);}
.sidebar-stats{margin-top:auto;padding:12px 8px 4px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.stat-box{padding:10px 12px;border-radius:10px;background:var(--card);border:1px solid var(--border);}
.stat-num{font-size:22px;font-weight:900;color:var(--text);line-height:1;}
.stat-lbl{font-size:9px;color:var(--text2);margin-top:3px;font-weight:600;}

.main{flex:1;overflow-y:auto;padding:20px;min-width:0;}

.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px 22px;margin-bottom:14px;transition:border-color .15s;}
.card:hover{border-color:var(--border-focus);}
.card-title{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin-bottom:14px;display:flex;align-items:center;gap:7px;}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 20px;border-radius:8px;border:none;font-size:14px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;white-space:nowrap;}
.btn:disabled{opacity:.45;cursor:not-allowed;}
.btn-primary{background:var(--accent);color:#000;}
.btn-primary:hover:not(:disabled){filter:brightness(1.1);}
.btn-danger-fill{background:var(--danger);color:#fff;}
.btn-danger-fill:hover:not(:disabled){filter:brightness(1.1);}
.btn-secondary{background:var(--card);color:var(--text);border:1px solid var(--border);}
.btn-secondary:hover:not(:disabled){background:var(--card-hover);border-color:var(--border-focus);}
.btn-full{width:100%;}
.btn-xl{padding:16px 28px;font-size:16px;border-radius:12px;}
.btn-sm{padding:7px 14px;font-size:12px;}
.btn-ghost{padding:8px 12px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.btn-ghost:hover{background:var(--card-hover);color:var(--text);}
.btn-ghost:disabled{opacity:.5;}
.btn-save{padding:8px 16px;border-radius:7px;border:none;background:var(--accent);color:#000;cursor:pointer;font-size:12px;font-weight:700;font-family:'Noto Sans KR',sans-serif;transition:all .2s;white-space:nowrap;}

.inp{width:100%;padding:12px 14px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:all .15s;}
.inp:focus{border-color:var(--border-focus);box-shadow:0 0 0 3px rgba(88,166,255,.15);}
.inp::placeholder{color:var(--text3);}
.inp.lg{font-size:16px;padding:14px 16px;}
select.inp{cursor:pointer;appearance:auto;}
.dark select.inp{color-scheme:dark;}.light select.inp{color-scheme:light;}
textarea.inp{resize:vertical;min-height:80px;line-height:1.7;}
.inp-label{font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:6px;}

.spinner{width:16px;height:16px;border-radius:50%;border:2.5px solid rgba(0,0,0,.15);border-top-color:#000;animation:spin .8s linear infinite;display:inline-block;flex-shrink:0;}
.spinner-white{border-color:rgba(255,255,255,.2);border-top-color:#fff;}

.alert{padding:13px 16px;border-radius:10px;font-size:13px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px;line-height:1.6;font-weight:500;}
.alert-warn{background:rgba(240,136,62,.08);border:1px solid rgba(240,136,62,.25);color:var(--warn);}
.alert-danger{background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.25);color:var(--danger);}
.alert-info{background:rgba(88,166,255,.08);border:1px solid rgba(88,166,255,.25);color:var(--info);}
.alert-success{background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.25);color:var(--success);}

.plat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.plat-btn{padding:16px;border-radius:12px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;display:flex;align-items:center;gap:12px;}
.plat-btn.naver-sel{border-color:var(--naver);background:rgba(3,199,90,.07);}
.plat-btn.tistory-sel{border-color:var(--tistory);background:rgba(255,107,53,.07);}
.plat-ico{font-size:28px;flex-shrink:0;}
.plat-name{font-size:14px;font-weight:700;color:var(--text);}
.plat-sub{font-size:11px;color:var(--text2);margin-top:2px;}
.plat-check{margin-left:auto;font-size:18px;}

.adtype-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
.adtype-btn{padding:14px 16px;border-radius:12px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;}
.adtype-btn.adpost-sel{border-color:var(--naver);background:rgba(3,199,90,.07);}
.adtype-btn.adsense-sel{border-color:var(--info);background:rgba(88,166,255,.07);}
.adtype-label{font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px;}
.adtype-sub{font-size:11px;color:var(--text2);}

.steps{display:flex;align-items:center;gap:0;margin-bottom:20px;overflow:hidden;border-radius:12px;border:1px solid var(--border);}
.step{flex:1;padding:11px 8px;text-align:center;font-size:12px;font-weight:600;color:var(--text2);background:var(--card);border-right:1px solid var(--border);transition:all .2s;}
.step:last-child{border-right:none;}
.step.active{background:rgba(248,81,73,.08);color:var(--danger);font-weight:800;}
.step.done{background:rgba(63,185,80,.06);color:var(--success);}
.step-num{font-size:10px;display:block;margin-bottom:1px;opacity:.7;}

.toggle-group{display:flex;gap:6px;flex-wrap:wrap;}
.toggle-btn{padding:8px 16px;border-radius:99px;border:1.5px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;font-weight:600;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.toggle-btn.active{border-color:var(--accent);background:var(--accent-bg);color:var(--accent-text);}

.title-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));max-height:400px;overflow-y:auto;padding-right:4px;}
.title-card{padding:14px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .15s;position:relative;}
.title-card:hover{border-color:var(--border-focus);background:var(--card-hover);}
.title-card.selected{border-color:var(--accent);background:var(--accent-bg);}
.title-num{font-size:10px;color:var(--text3);margin-bottom:5px;font-family:'JetBrains Mono',monospace;}
.title-card.selected .title-num{color:var(--accent-text);}
.title-text{font-size:13px;font-weight:600;color:var(--text);line-height:1.55;}
.title-card.selected .title-text{color:var(--accent-text);}
.title-check{position:absolute;top:10px;right:10px;width:20px;height:20px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:10px;color:#000;font-weight:900;}

.selected-banner{padding:13px 16px;border-radius:10px;background:var(--accent-bg);border:1.5px solid var(--accent-border);margin-bottom:14px;}
.selected-banner-label{font-size:11px;color:var(--accent-text);font-weight:700;margin-bottom:3px;}
.selected-banner-text{font-size:14px;font-weight:800;color:var(--text);}

.img-grid{display:flex;gap:8px;flex-wrap:wrap;}
.img-thumb-wrap{position:relative;}
.img-thumb{width:90px;height:90px;object-fit:cover;border-radius:10px;border:2px solid var(--border);display:block;}
.img-thumb.thumb-first{border-color:var(--accent);}
.img-thumb-badge{position:absolute;top:-7px;left:-4px;font-size:9px;font-weight:800;padding:2px 6px;border-radius:99px;background:var(--accent);color:#000;}
.img-thumb-del{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--danger);border:none;color:#fff;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;}

.char-badge{padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700;background:var(--accent-bg);color:var(--accent-text);border:1px solid var(--accent-border);}
.preview-btn{padding:7px 14px;border-radius:8px;border:1px solid var(--accent-border);background:var(--accent-bg);color:var(--accent-text);cursor:pointer;font-size:12px;font-weight:700;font-family:'Noto Sans KR',sans-serif;transition:all .15s;}
.preview-modal{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:16px;}
.preview-inner{width:100%;max-width:700px;max-height:90vh;overflow-y:auto;background:#fff;border-radius:16px;padding:32px 28px;}

/* 회원 목록 */
.user-table{border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.user-row{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);transition:background .15s;cursor:pointer;}
.user-row:last-child{border-bottom:none;}
.user-row:hover{background:var(--card-hover);}
.user-row.selected-row{background:rgba(88,166,255,.06);border-left:3px solid var(--info);}
.user-avatar{width:36px;height:36px;border-radius:10px;background:var(--accent-bg);border:1px solid var(--accent-border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--accent-text);flex-shrink:0;}
.user-info{flex:1;min-width:0;}
.user-name-row{font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px;}
.user-email-row{font-size:11px;color:var(--text2);margin-top:2px;font-family:'JetBrains Mono',monospace;}
.plan-chip{font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;}
.plan-free{background:rgba(120,120,120,.12);color:var(--text2);border:1px solid var(--border);}
.plan-basic{background:rgba(88,166,255,.12);color:var(--info);border:1px solid rgba(88,166,255,.25);}
.plan-pro{background:rgba(63,185,80,.12);color:var(--success);border:1px solid rgba(63,185,80,.25);}
.inactive-chip{font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(248,81,73,.1);color:var(--danger);border:1px solid rgba(248,81,73,.25);}
.quota-mini{font-size:11px;color:var(--text2);font-family:'JetBrains Mono',monospace;}

/* 유저 상세 패널 */
.detail-panel{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-top:14px;animation:fadeUp .2s ease both;}
.detail-header{display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
.adm-img-split{display:grid;grid-template-columns:280px 1fr;gap:14px;align-items:start;}
.adm-video-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}
.detail-field{display:flex;flex-direction:column;gap:5px;}
.field-label{font-size:11px;font-weight:700;color:var(--text2);}
.field-inp{padding:9px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:border-color .15s;}
.field-inp:focus{border-color:var(--border-focus);}
select.field-inp{cursor:pointer;appearance:auto;}
.dark select.field-inp{color-scheme:dark;}.light select.field-inp{color-scheme:light;}

/* 통계 */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px;}
.stats-card{padding:18px 16px;border-radius:12px;background:var(--card);border:1px solid var(--border);}
.stats-num{font-size:28px;font-weight:900;color:var(--text);line-height:1;}
.stats-label{font-size:11px;color:var(--text2);margin-top:4px;font-weight:600;}
.stats-sub{font-size:10px;color:var(--text3);margin-top:2px;}

/* 계정 카드 */
.acc-card{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;border:1.5px solid var(--border);background:var(--card);margin-bottom:10px;animation:fadeUp .25s ease both;transition:border-color .2s;}
.acc-card.connected-naver{border-color:rgba(3,199,90,.3);}
.acc-card.connected-tistory{border-color:rgba(255,107,53,.3);}

/* AI 카드 */
.ai-grid{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
.ai-card{flex:1;min-width:120px;padding:14px 12px;border-radius:12px;border:2px solid var(--border);background:var(--bg);cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;position:relative;}
.ai-card.selected{transform:translateY(-2px);}
.ai-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.ai-logo{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;}
.ai-name{font-size:12px;font-weight:700;color:var(--text);}
.ai-sub{font-size:10px;color:var(--text2);margin-top:2px;}
.ai-sel-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;color:#000;}
.ai-free-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(63,185,80,.12);color:var(--success);}
.ai-paid-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(240,136,62,.12);color:var(--warn);}

/* 키 섹션 */
.key-section{padding:16px 18px;border-radius:12px;border:1px solid var(--border);margin-bottom:12px;}
.key-section-title{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin-bottom:12px;display:flex;align-items:center;gap:7px;}
.key-row{margin-bottom:10px;}
.key-row:last-child{margin-bottom:0;}
.key-row-header{display:flex;align-items:center;gap:7px;margin-bottom:7px;}
.key-logo{width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;flex-shrink:0;}
.key-label{font-size:12px;font-weight:700;color:var(--text);}
.key-tag{font-size:10px;color:var(--text2);}
.key-link{margin-left:auto;font-size:11px;color:var(--accent-text);text-decoration:none;font-weight:600;}
.key-row-input{display:flex;gap:6px;}
.key-row-input .inp{flex:1;font-size:13px;padding:9px 12px;}

.info-table{border:1px solid var(--border);border-radius:10px;overflow:hidden;}
.info-row{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border);}
.info-row:last-child{border-bottom:none;}
.info-row:hover{background:var(--card-hover);}
.info-key{font-size:13px;color:var(--text2);}
.info-val{font-size:14px;font-weight:700;color:var(--text);}

.empty{text-align:center;padding:60px 24px;animation:fadeUp .3s ease both;}
.empty-ico{font-size:56px;margin-bottom:16px;animation:float 3s ease-in-out infinite;}
.empty-title{font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px;}
.empty-sub{font-size:14px;color:var(--text2);margin-bottom:24px;line-height:1.6;}

.mob-tabs{display:none;position:fixed;bottom:0;left:0;right:0;z-index:200;background:var(--header-bg);border-top:1px solid var(--border);backdrop-filter:blur(20px);padding:8px 4px max(14px,env(safe-area-inset-bottom));}
.mob-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 4px;border:none;background:transparent;cursor:pointer;font-family:'Noto Sans KR',sans-serif;transition:all .15s;min-height:52px;}
.mob-tab-ico{font-size:22px;}
.mob-tab-lbl{font-size:11px;font-weight:600;color:var(--text2);}
.mob-tab.active{background:rgba(248,81,73,.08);border-radius:10px;}
.mob-tab.active .mob-tab-lbl{color:var(--danger);}

@media(max-width:900px){
  .sidebar{display:none;}
  .mob-tabs{display:flex;}
}
@media(max-width:768px){
  .header-mid{display:none;}
  .main{padding:14px 12px 90px;}
  .plat-grid{grid-template-columns:1fr 1fr;}
  .title-grid{grid-template-columns:1fr;}
  .adtype-grid{grid-template-columns:1fr;}
  .detail-grid{grid-template-columns:1fr;}
  .stats-grid{grid-template-columns:1fr 1fr;}
  .adm-img-split{grid-template-columns:1fr !important;}
  .adm-video-grid{grid-template-columns:1fr !important;}
  .card{padding:16px 14px;}
  .btn{font-size:15px;padding:13px 20px;}
  .btn-xl{padding:17px 24px;font-size:17px;}
  .btn-sm{font-size:13px;padding:10px 16px;}
  .inp{font-size:16px;padding:14px 14px;}
  .inp-label{font-size:14px;}
  .card-title{font-size:13px;}
  .title-card{padding:16px;}
  .title-text{font-size:15px;}
  .title-num{font-size:12px;}
  .adtype-label{font-size:15px;}
  .adtype-sub{font-size:13px;}
  .toggle-btn{font-size:14px;padding:11px 18px;}
  .step{font-size:13px;padding:13px 8px;}
  .stat-num{font-size:26px;}
  .mob-tab-lbl{font-size:12px;}
  .mob-tab-ico{font-size:24px;}
  .user-row{padding:14px 12px;}
  .acc-card{flex-wrap:wrap;}
}
@media(max-width:480px){
  .header{padding:0 10px;gap:6px;}
  .plat-grid{grid-template-columns:1fr;}
  .adtype-grid{grid-template-columns:1fr;}
  .key-row-input{flex-wrap:wrap;}
  .key-row-input .inp{width:100%;}
}

/* ── 관리자 사용설명서 ───────────────────────── */
@keyframes guideIn{from{opacity:0;transform:scale(.93) translateY(18px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes admGuideFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.guide-overlay{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:12px;}
.guide-modal{width:100%;max-width:580px;max-height:92vh;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;animation:guideIn .32s cubic-bezier(.34,1.56,.64,1) both;box-shadow:0 32px 80px rgba(0,0,0,.6);position:relative;}
.guide-header{padding:22px 22px 0;background:linear-gradient(135deg,#2a0a0a 0%,#1a0505 100%);flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06);}
.guide-logo-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.guide-logo-ico{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#ff6b6b,#ff3333);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.guide-title{font-size:21px;font-weight:900;color:#fff;line-height:1.2;}
.guide-subtitle{font-size:12px;color:rgba(255,255,255,.5);margin-top:3px;}
.guide-tabs{display:flex;gap:0;overflow-x:auto;scrollbar-width:none;}
.guide-tabs::-webkit-scrollbar{display:none;}
.guide-tab{padding:11px 16px;border:none;background:transparent;font-size:12px;font-weight:700;color:rgba(255,255,255,.4);cursor:pointer;font-family:'Noto Sans KR',sans-serif;white-space:nowrap;border-bottom:3px solid transparent;transition:all .15s;flex-shrink:0;}
.guide-tab.active{color:#FFD93D;border-bottom-color:#FFD93D;}
.guide-tab:hover:not(.active){color:rgba(255,255,255,.7);}
.guide-body{flex:1;overflow-y:auto;background:#150505;padding:18px 18px 22px;min-height:0;}
.guide-body::-webkit-scrollbar{width:4px;}
.guide-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:99px;}
.guide-close{position:absolute;top:14px;right:16px;width:32px;height:32px;border-radius:99px;background:rgba(255,255,255,.12);border:none;color:#fff;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .15s;z-index:10;}
.guide-close:hover{background:rgba(255,255,255,.22);}
.g-step{border-radius:16px;padding:16px 16px;margin-bottom:10px;border:1.5px solid;position:relative;}
.g-step-num{font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;display:flex;align-items:center;gap:6px;}
.g-step-title{font-size:16px;font-weight:900;margin-bottom:6px;line-height:1.3;}
.g-step-desc{font-size:14px;line-height:1.85;color:rgba(255,255,255,.82);}
.g-step-desc b{font-weight:900;color:#fff;}
.g-tip{margin-top:10px;padding:10px 13px;border-radius:10px;background:rgba(255,255,255,.06);font-size:13px;line-height:1.75;color:rgba(255,255,255,.75);}
.g-tip b{font-weight:800;color:#FFD93D;}
.g-btn{display:inline-flex;align-items:center;gap:7px;padding:11px 20px;border-radius:99px;border:none;font-size:13px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;margin-top:12px;transition:all .15s;}
.g-btn:hover{filter:brightness(1.1);transform:translateY(-1px);}
.guide-footer{padding:12px 18px;background:#100303;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;flex-wrap:wrap;}
.guide-nav-btn{padding:9px 20px;border-radius:99px;border:1.5px solid;font-size:13px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;}
.guide-page{font-size:12px;color:rgba(255,255,255,.35);font-weight:600;}
.adm-guide-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border-radius:99px;border:none;background:linear-gradient(135deg,#FFD93D,#FFA500);color:#000;font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;animation:admGuideFloat 2.8s ease-in-out infinite;white-space:nowrap;flex-shrink:0;box-shadow:0 4px 16px rgba(255,165,0,.4);transition:filter .15s;}
.adm-guide-btn:hover{filter:brightness(1.1);}

@media(max-width:768px){
  .guide-modal{max-width:100%;max-height:90vh;border-radius:20px;}
  .guide-header{padding:16px 16px 0;}
  .guide-title{font-size:17px;}
  .guide-body{padding:14px 14px 18px;}
  .g-step{padding:13px 13px;}
  .g-step-title{font-size:15px;}
  .g-step-desc{font-size:13px;}
  .guide-footer{padding:10px 14px;}
}
@media(max-width:480px){
  .guide-overlay{padding:6px;}
  .guide-modal{max-height:94vh;border-radius:16px;}
  .guide-tab{font-size:11px;padding:9px 11px;}
}
`;

const TABS = [
  {k:"keyword",  i:"🔍", l:"키워드/제목"},
  {k:"write",    i:"✍️", l:"글 생성"},
  {k:"image",    i:"🖼️", l:"이미지 생성"},
  {k:"publish",  i:"🚀", l:"발행하기"},
  {k:"manage",   i:"📋", l:"발행 관리"},
  {k:"accounts", i:"🔗", l:"계정관리"},
  {k:"users",    i:"👥", l:"회원관리"},
  {k:"stats",    i:"📊", l:"통계"},
  {k:"settings", i:"🔐", l:"설정"},
] as const;

export default function AdminPage({onBack, onDashboard, theme, onThemeToggle}: Props) {
  const [tab, setTab] = useState<"keyword"|"write"|"image"|"publish"|"manage"|"accounts"|"users"|"stats"|"settings">("keyword");
  const [showGuide, setShowGuide] = useState(false);
  const [guideTab, setGuideTab] = useState(0);
  const [botOnline, setBotOnline] = useState(false);
  const [platform, setPlatform] = useState<"naver"|"tistory">("naver");
  const [admAccs, setAdmAccs] = useState<PublyAccount[]>([]);

  // 발행
  const [pubTitle, setPubTitle] = useState(""); const [pubContent, setPubContent] = useState(""); const [pubTags, setPubTags] = useState(""); const [pubImg, setPubImg] = useState(""); const [pubAccId, setPubAccId] = useState(""); const [publishing, setPublishing] = useState(false); const [pubMsg, setPubMsg] = useState("");

  // 글 생성
  const [adType, setAdType] = useState<"adpost"|"adsense">("adpost");
  const [targetChars, setTargetChars] = useState(1350);
  const [charMode, setCharMode] = useState<"auto"|"manual">("auto");
  const [imgSource, setImgSource] = useState<"ai"|"upload"|"none">("ai");
  const [imgCountManual, setImgCountManual] = useState<number|null>(null);
  const [imgCount, setImgCount] = useState(3);
  const [imgCountAuto, setImgCountAuto] = useState(true);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [genImgLoading, setGenImgLoading] = useState(false);
  const [captions, setCaptions] = useState<string[]>([]);
  const [videoOn, setVideoOn] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPosition, setVideoPosition] = useState<"top"|"middle"|"bottom">("middle");
  const [imgPattern, setImgPattern] = useState<"A"|"B"|"C"|"random">("random");
  const [currentImgPrompt, setCurrentImgPrompt] = useState("");
  const [genImgProgress, setGenImgProgress] = useState(0);
  const [genImgCurrent, setGenImgCurrent] = useState(0);
  const imgAbortRef = useRef<AbortController|null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [keywords, setKeywords] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_kws")||"[]");}catch{return [];}});
  const [generating, setGenerating] = useState(false);
  const [genTitle, setGenTitle] = useState(""); const [genContent, setGenContent] = useState(""); const [genTags, setGenTags] = useState(""); const [genImage, setGenImage] = useState("");
  const [titles, setTitles] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_titles")||"[]");}catch{return[];}});
  const [selectedTitle, setSelectedTitle] = useState(""); const [loadingTitles, setLoadingTitles] = useState(false);

  // 계정
  const [newPlat, setNewPlat] = useState<"naver"|"tistory">("naver"); const [newUser, setNewUser] = useState(""); const [newPw, setNewPw] = useState(""); const [newBlog, setNewBlog] = useState(""); const [addingAcc, setAddingAcc] = useState(false); const [connId, setConnId] = useState<string|null>(null);

  // 회원
  const [users, setUsers] = useState<UserFull[]>([]); const [loading, setLoading] = useState(true); const [search, setSearch] = useState(""); const [selUser, setSelUser] = useState<UserFull|null>(null);
  const [editMap, setEditMap] = useState<Record<string,any>>({}); const [saving, setSaving] = useState<string|null>(null);
  const [newNote, setNewNote] = useState(""); const [newPayAmt, setNewPayAmt] = useState(""); const [newPayNote, setNewPayNote] = useState(""); const [addingPay, setAddingPay] = useState(false);
  const [pubSub, setPubSub] = useState<"full"|"body_faq"|"body_only">("full");

  // 설정
  const [writeAI, setWriteAI] = useState(()=>localStorage.getItem("publy_adm_write_ai")||"gemini");
  const [imageAI, setImageAI] = useState(()=>localStorage.getItem("publy_adm_image_ai")||"openai_img");
  const [newPw1, setNewPw1] = useState(""); const [newPw2, setNewPw2] = useState(""); const [pwMsg, setPwMsg] = useState("");

  const checkBot = useCallback(async () => {
    try { const r = await fetch(`${BOT}/health`,{signal:AbortSignal.timeout(3000)}); setBotOnline(r.ok); }
    catch { setBotOnline(false); }
  }, []);

  useEffect(() => {
    checkBot(); getAccounts(ADM_UID).then(setAdmAccs); loadUsers();
    const iv = setInterval(checkBot, 30000); return () => clearInterval(iv);
  }, [checkBot]);

  async function loadUsers() {
    setLoading(true);
    const {data} = await supabase.from("publy_users").select("*").order("created_at",{ascending:false});
    if (!data) { setLoading(false); return; }
    const full = await Promise.all(data.map(async u => {
      const [{data:q},{data:p},{data:n},{count}] = await Promise.all([
        supabase.from("publy_quotas").select("*").eq("user_id",u.id).single(),
        supabase.from("publy_payments").select("*").eq("user_id",u.id).order("created_at",{ascending:false}).limit(20),
        supabase.from("publy_notes").select("*").eq("user_id",u.id).order("created_at",{ascending:false}).limit(20),
        supabase.from("publy_history").select("*",{count:"exact",head:true}).eq("user_id",u.id),
      ]);
      return {...u, quota:q||undefined, payments:p||[], notes:n||[], history_count:count||0};
    }));
    setUsers(full as UserFull[]); setLoading(false);
  }

  // 이미지 프롬프트 (KO_EN_MAP 축약 버전)
  // ─── 300+ 키워드 이미지 프롬프트 시스템 ────────────────────
  const NP_TAG = "no people, no person, no face, no human, no text, no watermark";
  const PROMPT_DB: {keywords:string[];prompt:string}[] = [
    {keywords:["한식","한정식","백반","집밥","가정식"],prompt:"Korean home-style meal spread, banchan side dishes, stone pot bibimbap, wooden table, steam rising, cozy restaurant, warm natural lighting"},
    {keywords:["맛집","식당","레스토랑","음식점","맛"],prompt:"cozy Korean restaurant interior, beautifully plated dishes on wooden table, ambient warm lighting, inviting atmosphere, bokeh"},
    {keywords:["삼겹살","고기","구이","바베큐","BBQ","갈비"],prompt:"Korean BBQ pork belly sizzling on grill, smoke rising, lettuce wraps, sesame oil, glowing charcoal, dark dramatic lighting"},
    {keywords:["회","횟집","사시미","해산물","해물"],prompt:"fresh Korean sashimi platter, colorful fish slices on ice, glistening presentation, premium seafood restaurant, cinematic"},
    {keywords:["초밥","스시","오마카세","일식"],prompt:"premium omakase sushi assortment, chef-crafted nigiri on wooden platter, minimalist Japanese restaurant, soft dramatic lighting"},
    {keywords:["스테이크","소고기","등심","ribeye","안심"],prompt:"perfectly seared ribeye steak, medium-rare interior, herb butter melting, fine dining plating, dramatic dark background"},
    {keywords:["파스타","이탈리안","피자","양식","스파게티"],prompt:"rustic Italian pasta dish, spaghetti with rich tomato sauce, fresh basil, parmesan, warm restaurant ambiance"},
    {keywords:["라면","라멘","국수","우동","소바"],prompt:"steaming bowl of Korean ramen, rich broth, soft egg, noodles, steam wisps, dark moody background, cinematic"},
    {keywords:["치킨","통닭","후라이드","양념치킨"],prompt:"crispy golden Korean fried chicken on wooden board, sauce cups, casual dining atmosphere, warm lighting"},
    {keywords:["피자","도우","화덕피자"],prompt:"artisan wood-fired pizza bubbling cheese, fresh toppings, rustic wooden table, Italian atmosphere"},
    {keywords:["버거","햄버거","샌드위치"],prompt:"gourmet burger juicy patty, fresh vegetables, sauce dripping, brioche bun, craft paper, casual dining"},
    {keywords:["카페","커피","아메리카노","라떼","에스프레소","카페인"],prompt:"cozy Korean cafe interior, latte art in ceramic cup, morning light through window, wooden table, minimalist"},
    {keywords:["빵","베이커리","크루아상","소금빵"],prompt:"artisan bakery display, golden croissants, fresh-baked bread, pastries, warm bakery interior, flour dusted"},
    {keywords:["케이크","디저트","마카롱","초콜릿","아이스크림"],prompt:"elegant dessert plating, layered chocolate cake, fresh berry garnish, marble surface, soft studio lighting"},
    {keywords:["빙수","팥빙수","설빙"],prompt:"Korean shaved ice bingsu, fluffy snow texture, red bean paste, condensed milk drizzle, pastel tones"},
    {keywords:["떡볶이","분식","순대","어묵","포장마차"],prompt:"Korean street food tteokbokki in red sauce, fish cakes, steam, night market atmosphere"},
    {keywords:["편의점","컵라면","야식","간식"],prompt:"Korean convenience store interior, colorful snack displays, late night warm glow, modern retail"},
    {keywords:["채식","비건","샐러드","건강식"],prompt:"vibrant vegan grain bowl, colorful vegetables, quinoa, avocado, hummus, white ceramic bowl, editorial"},
    {keywords:["브런치","아보카도","팬케이크","와플"],prompt:"weekend brunch spread, avocado toast, stacked pancakes with maple syrup, fresh fruit, white marble, morning light"},
    {keywords:["맥주","와인","술","주류","칵테일"],prompt:"artisan craft beer glass, golden bubbles, bar setting, warm amber lighting, premium beverage"},
    {keywords:["국","찌개","탕","설렁탕","감자탕"],prompt:"steaming Korean soup pot, rich broth, ingredients visible, ceramic bowl, restaurant wooden table, comfort food"},
    {keywords:["도시락","간편식","밀키트"],prompt:"beautifully arranged Korean lunch box bento, colorful vegetables, rice, clean minimal presentation"},
    {keywords:["제주도","제주","한라산","성산일출봉","우도"],prompt:"Jeju island volcanic coastline, dramatic black lava rocks, turquoise ocean waves, Hallasan mountain backdrop, golden hour"},
    {keywords:["부산","해운대","광안리","남포동","감천"],prompt:"Busan Gwangalli beach at sunset, Gwangan Bridge illuminated, warm golden reflection on water, cinematic"},
    {keywords:["서울","경복궁","남산","한강","명동"],prompt:"Seoul cityscape at dusk, Namsan tower glowing, Han River reflection, modern skyscrapers meets traditional palace"},
    {keywords:["경주","불국사","첨성대","신라"],prompt:"ancient Gyeongju Bulguksa temple, cherry blossoms, stone lanterns, misty morning atmosphere, UNESCO heritage"},
    {keywords:["전주","한옥마을"],prompt:"Jeonju Hanok village, traditional Korean architecture, tile roofs, stone paths, warm golden afternoon light"},
    {keywords:["강원","강릉","속초","설악산","동해"],prompt:"Seoraksan mountain peaks with autumn foliage, dramatic rocky cliffs, crisp mountain air, editorial"},
    {keywords:["일본","도쿄","오사카","교토","후쿠오카"],prompt:"Kyoto traditional street at twilight, lantern-lit cobblestone alley, cherry blossom petals, cinematic"},
    {keywords:["유럽","파리","로마","스페인","런던","프랑스"],prompt:"Paris street at golden hour, Eiffel Tower in distance, café tables, warm European ambiance, cobblestone"},
    {keywords:["동남아","베트남","태국","발리","싱가포르"],prompt:"Bali tropical infinity pool overlooking lush jungle, lotus flowers, temple offerings, golden sunset"},
    {keywords:["미국","뉴욕","LA","하와이"],prompt:"Manhattan skyline at blue hour, skyscrapers reflected in Hudson River, city lights, dramatic urban"},
    {keywords:["캠핑","글램핑","텐트","야외","아웃도어"],prompt:"luxury glamping tent in forest clearing, warm lantern glow, campfire embers, starry night sky, misty morning"},
    {keywords:["호텔","리조트","숙소","펜션","풀빌라"],prompt:"luxury hotel suite interior, king bed with crisp white linens, floor-to-ceiling window with city view, elegant"},
    {keywords:["여행준비","패킹","캐리어","배낭여행"],prompt:"open suitcase with neatly packed clothes, travel accessories, passport, camera, clean flat lay on white bed"},
    {keywords:["국내여행","드라이브","도로여행","차박"],prompt:"scenic Korean coastal highway, road trip, mountain pass, autumn foliage, blue sky, freedom"},
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
    {keywords:["치아","치과","구강","칫솔"],prompt:"dental care flat lay, toothbrush, floss, mouthwash, white background, clean clinical aesthetic"},
    {keywords:["병원","진료","의료","건강검진"],prompt:"modern hospital corridor, clean professional healthcare, trust and expertise, bright clinical lighting"},
    {keywords:["주식","주식투자","증권","코스피","코스닥"],prompt:"stock market candlestick chart on monitor, trading platform, financial data visualization, dark professional"},
    {keywords:["코인","비트코인","가상화폐","NFT","블록체인"],prompt:"golden bitcoin coins, blockchain network visualization, digital currency concept, blue neon tech aesthetic"},
    {keywords:["부동산","아파트","투자","분양","청약"],prompt:"modern Korean apartment complex aerial view, urban cityscape, real estate development, sunset reflection"},
    {keywords:["재테크","돈","저축","절약","금융"],prompt:"Korean won bills and coins arranged neatly, piggy bank, growth chart, financial planning, clean white background"},
    {keywords:["ETF","펀드","적금","예금","금리"],prompt:"financial investment growth concept, ascending bar chart, coins stacking, plant growing from money, prosperity"},
    {keywords:["사업","창업","스타트업","사업자","CEO"],prompt:"modern startup office, whiteboard with business plan, team collaboration energy, contemporary workspace"},
    {keywords:["프리랜서","부업","N잡러","재택근무"],prompt:"home office setup, laptop on clean desk, plants, natural window light, productive remote work"},
    {keywords:["AI","인공지능","ChatGPT","GPT","클로드"],prompt:"artificial intelligence neural network visualization, futuristic blue light, data streams, tech concept"},
    {keywords:["스마트폰","아이폰","갤럭시","핸드폰"],prompt:"premium smartphone on minimal surface, app interface glow, clean tech product photography"},
    {keywords:["노트북","맥북","컴퓨터","PC"],prompt:"MacBook Pro on clean minimal desk, code on screen, soft ambient lighting, developer workspace"},
    {keywords:["코딩","프로그래밍","개발","개발자"],prompt:"dark mode code editor screen, colorful syntax highlighting, developer keyboard, multiple monitors"},
    {keywords:["유튜브","유튜버","영상","콘텐츠","크리에이터"],prompt:"YouTube creator studio setup, ring light, camera, microphone, content creation workspace, professional"},
    {keywords:["인스타","SNS","소셜미디어","틱톡"],prompt:"social media content creation, smartphone photography setup, aesthetic flat lay, influencer lifestyle"},
    {keywords:["게임","게이밍","PC방","플스","닌텐도"],prompt:"gaming setup with RGB lighting, multiple monitors, mechanical keyboard, competitive esports atmosphere"},
    {keywords:["임신","출산","태교","임산부"],prompt:"soft nursery room preparation, baby items, gentle morning light, pastel colors, tender atmosphere"},
    {keywords:["육아","아기","신생아","돌잔치"],prompt:"adorable baby toys on soft pastel blanket, tiny shoes, teddy bear, warm nursery, gentle light"},
    {keywords:["유아","어린이","아이","유치원"],prompt:"colorful children learning environment, educational toys, ABC blocks, watercolor paintings, bright playful space"},
    {keywords:["공부","수능","입시","학원","과외"],prompt:"student study desk with books, stationery, planner, focused learning, warm desk lamp"},
    {keywords:["영어","영어공부","어학","토익","토플"],prompt:"language learning setup, English textbooks, headphones, notebook with vocabulary, coffee, productive study"},
    {keywords:["인테리어","인테리어디자인","집꾸미기","홈데코"],prompt:"beautifully designed Korean apartment interior, minimalist Scandinavian style, plants, warm natural tones"},
    {keywords:["청소","정리","수납","정돈","미니멀"],prompt:"perfectly organized closet with coordinated items, minimalist Korean home, clean aesthetic"},
    {keywords:["강아지","댕댕이","dog","puppy"],prompt:"fluffy golden retriever puppy in Korean home garden, playful expression, soft natural light, adorable"},
    {keywords:["고양이","냥이","cat","kitty"],prompt:"elegant cat lounging on window sill, soft afternoon sunbeam, bokeh background, peaceful domestic"},
    {keywords:["반려동물","펫","애완"],prompt:"loving pet care scene, cozy home with happy pet, warm domestic life, lifestyle photography"},
    {keywords:["독서","책","서재","도서관"],prompt:"cozy reading nook with books, warm lamp light, coffee cup, wooden shelves, peaceful literary atmosphere"},
    {keywords:["가드닝","정원","식물","화분","홈가드닝"],prompt:"lush indoor plant collection, botanical home aesthetic, morning light through leaves, terra cotta pots"},
    {keywords:["요리","쿠킹","홈쿠킹","레시피"],prompt:"home cooking preparation, fresh ingredients on wooden cutting board, kitchen lifestyle, warm"},
    {keywords:["패션","옷","코디","스타일링","OOTD"],prompt:"Korean fashion street style flat lay, seasonal outfit coordination, accessories, clean white background"},
    {keywords:["명품","가방","지갑","액세서리","주얼리"],prompt:"luxury handbag editorial, leather texture, branded accessories, marble surface, premium lifestyle"},
    {keywords:["화장","메이크업","립스틱","뷰티"],prompt:"K-beauty makeup flat lay, cosmetic products arranged artfully, rose gold accents, mirror, beauty editorial"},
    {keywords:["향수","perfume","프래그런스"],prompt:"luxury perfume bottle on marble surface, light refraction, soft bokeh, elegant fragrance photography"},
    {keywords:["네일","네일아트","네일샵"],prompt:"artistic nail art close-up, intricate designs, gel polish, hands on marble, beauty editorial"},
    {keywords:["헤어","헤어스타일","미용실","염색","펌"],prompt:"Korean hair salon interior, glossy healthy hair, professional care, bright modern salon"},
    {keywords:["자동차","신차","차","차량"],prompt:"sleek modern sedan on mountain road, dramatic landscape, automotive photography, golden hour"},
    {keywords:["전기차","EV","테슬라","아이오닉"],prompt:"electric vehicle charging station, clean energy concept, modern EV design, sustainable future"},
    {keywords:["SUV","4WD","오프로드"],prompt:"powerful SUV on mountain trail, rugged terrain, adventure lifestyle, dramatic sky"},
    {keywords:["골프","골프장","골프채","필드"],prompt:"golf course at sunrise, morning mist over fairway, lush green grass, dramatic landscape, premium sport"},
    {keywords:["등산","트레킹","산행","백패킹"],prompt:"hiker on Korean mountain summit, vast panoramic view, autumn foliage, achievement, dramatic sky"},
    {keywords:["자전거","사이클","MTB"],prompt:"cyclist on scenic riverside path at sunrise, motion and speed, Korean landscape, freedom"},
    {keywords:["취업","구직","이력서","면접"],prompt:"professional Korean job interview setting, confident candidate, modern office, career opportunity"},
    {keywords:["직장","회사","사무실","직장인"],prompt:"modern Korean office interior, collaborative workspace, professionals working, clean contemporary"},
    {keywords:["이직","커리어","경력"],prompt:"career growth concept, ascending staircase, professional development, business success, ambition"},
    {keywords:["봄","벚꽃","봄꽃","개나리","튤립"],prompt:"Korean spring cherry blossom path, soft pink petals falling, warm sunlight through branches, dreamy"},
    {keywords:["여름","바다","해수욕장","여름휴가"],prompt:"Korean summer beach, crystal clear water, white sand, golden hour sunlight, vacation mood"},
    {keywords:["가을","단풍","추석","단풍여행"],prompt:"Korean autumn forest, vibrant red and orange foliage, misty mountain morning, fallen leaves path"},
    {keywords:["겨울","눈","스키장","크리스마스"],prompt:"winter wonderland snowscape, frost on pine trees, soft blue twilight, peaceful Korean winter"},
    {keywords:["자기계발","성장","동기부여","목표","습관"],prompt:"morning routine motivation, sunrise through window, journal and coffee, goal setting, fresh productive start"},
    {keywords:["명상","마음챙김","힐링","치유"],prompt:"peaceful meditation space, serene pose, soft morning light, minimalist zen atmosphere, calm"},
    {keywords:["영화","OTT","넷플릭스","드라마"],prompt:"cozy home cinema setup, dark room with large screen glow, popcorn, blanket, movie night"},
    {keywords:["음악","콘서트","공연","아이돌","K-pop"],prompt:"concert stage with dramatic lighting, spotlights, smoke effects, electric atmosphere, performance energy"},
    {keywords:["환경","친환경","제로웨이스트","지속가능"],prompt:"eco-friendly lifestyle flat lay, reusable items, green plants, sustainable products, earth-tone"},
    {keywords:["애드포스트","블로그수익","네이버블로그","수익화"],prompt:"blogger workspace with laptop showing analytics, coffee, notebook, Korean lifestyle content creator setup, warm"},
    {keywords:["애드센스","구글","SEO","검색노출"],prompt:"SEO analytics dashboard on monitor, digital marketing workspace, growth charts, professional setup"},
  ];

  function buildImagePrompt(kw: string, title: string = "", idx: number = 0): string {
    const k = (kw + " " + title).toLowerCase();
    const st = adType === "adpost"
      ? "Korean lifestyle photography, warm emotional, soft natural light"
      : "ultra realistic DSLR 8K magazine editorial photography";
    const sorted = [...PROMPT_DB].sort((a,b) => b.keywords.join("").length - a.keywords.join("").length);
    for (const entry of sorted) {
      if (entry.keywords.some(kw2 => k.includes(kw2))) {
        let p = entry.prompt;
        if (idx === 1) p = p.replace(/warm natural lighting|morning light|warm lighting|warm/g, "golden hour afternoon light");
        if (idx === 2) p = p.replace(/warm natural lighting|morning light|warm lighting|warm/g, "dramatic blue hour lighting");
        if (idx === 3) p = p.replace(/warm natural lighting|morning light|warm lighting|warm/g, "soft overcast diffused light");
        return `${p}, ${NP_TAG}, ${st}`;
      }
    }
    if (/먹|맛|식|음|요리|카페|커피/.test(k)) return `beautiful Korean food dining experience, warm restaurant, delicious presentation, ${NP_TAG}, ${st}`;
    if (/여행|travel|관광|투어|trip/.test(k)) return `breathtaking Korean travel destination, scenic landscape, golden hour, ${NP_TAG}, ${st}`;
    if (/돈|금|재|투자|경제|수익|부자/.test(k)) return `financial success growth concept, modern professional aesthetic, ${NP_TAG}, ${st}`;
    if (/건강|운동|몸|fitness|diet|다이어트/.test(k)) return `healthy lifestyle motivation, nutritious food, wellness atmosphere, ${NP_TAG}, ${st}`;
    if (/집|방|인테리어|home|house|아파트/.test(k)) return `beautiful modern Korean home interior, warm cozy atmosphere, ${NP_TAG}, ${st}`;
    if (/기술|tech|AI|컴퓨터|폰|앱/.test(k)) return `modern technology concept, clean digital aesthetic, innovation, ${NP_TAG}, ${st}`;
    if (/봄|여름|가을|겨울|자연|꽃/.test(k)) return `beautiful Korean seasonal landscape, nature photography, golden light, ${NP_TAG}, ${st}`;
    return `beautiful Korean lifestyle blog editorial photography, professional, perfect composition, ${NP_TAG}, ${st}`;
  }

  function parseArr(text: string): string[] {
    const clean = text.replace(/```json|```/gi,"").trim();
    try { const m = clean.match(/\[[\s\S]*\]/); if (m) { const p = JSON.parse(m[0]); if (Array.isArray(p)) return p.map(String).filter(t=>t.length>3); } } catch {}
    try { const p = JSON.parse(clean); if (Array.isArray(p)) return p.map(String).filter(t=>t.length>3); } catch {}
    return clean.split("\n").map(l=>l.replace(/^[\d]+[).\s]+|^[-*•\s]+/,"").replace(/^[\s"']+|[\s"']+$/g,"").trim()).filter(l=>l.length>4&&l.length<100);
  }

  function stripMarkdown(text: string): string {
    const markers = ["[FAQ시작]","[FAQ끝]","[관련글시작]","[관련글끝]"];
    const ph: [string,string][] = markers.map((m,i) => [`XMARK${i}X`,m]);
    ph.forEach(([k,v]) => { text = text.split(v).join(k); });
    const h2s: string[] = [];
    text = text.replace(/^## .+$/gm, m => { const i = h2s.length; h2s.push(m); return `XH2${i}X`; });
    text = text.replace(/[一-鿿㐀-䶿]/g,"").replace(/[\u3040-\u30FF]/g,"")
      .replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s.,!?;:()\-\'".\[\]%@#&+=/\\~`|<>{}^_$\n]/g,"")
      .replace(/\*{2,}/g,"").replace(/^#{3,}\s+/gm,"").replace(/^[-*]\s+/gm,"")
      .replace(/^\d+\.\s+/gm,"").replace(/_{2,}/g,"").replace(/ {2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();
    h2s.forEach((line,i) => { text = text.split(`XH2${i}X`).join(line); });
    ph.forEach(([k,v]) => { text = text.split(k).join(v); });
    return text;
  }

  function getCategoryGuide(kw: string, title: string): string {
    const k = (kw + " " + title).toLowerCase();
    if (/맛집|음식|카페|식당|요리|커피/.test(k)) return "[맛집/음식]\n- 직접 방문한 것처럼: 분위기, 맛, 가격\n- 단점도 솔직하게";
    if (/여행|관광|호텔|숙소/.test(k)) return "[여행]\n- 교통편, 비용, 소요시간\n- 꼭 가야 할 명소, 현지 맛집";
    if (/건강|다이어트|운동|피부/.test(k)) return "[건강]\n- 전문 용어 쉽게 풀이\n- 집에서 가능 vs 병원 필요 구분";
    if (/재테크|투자|주식|금융/.test(k)) return "[재테크]\n- 초보자도 이해하는 설명\n- 실제 숫자 예시 포함";
    return "[정보/일상]\n- 독자가 몰랐던 새로운 정보\n- 일상에서 바로 써먹는 팁";
  }

  async function callAI(prompt: string): Promise<string> {
    const ai = localStorage.getItem("publy_adm_write_ai") || "gemini";
    if (ai === "gemini") {
      const key = localStorage.getItem("publy_adm_gemini_key") || ""; if (!key) throw new Error("Gemini API 키 없음 (관리자 설정에서 입력하세요)");
      for (const model of GEMINI_MODELS_ADM) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:8000}}),signal:AbortSignal.timeout(60000)});
          if (!r.ok) continue;
          const d = await r.json(); const t = d.candidates?.[0]?.content?.parts?.[0]?.text||""; if (t) return t;
        } catch { continue; }
      }
      throw new Error("Gemini 실패");
    }
    if (ai === "groq") {
      const key = localStorage.getItem("publy_adm_groq_key") || ""; if (!key) throw new Error("Groq API 키 없음 (관리자 설정에서 입력하세요)");
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.1-70b-versatile",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(60000)});
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message||"Groq 오류"); }
      const d = await r.json(); return d.choices?.[0]?.message?.content||"";
    }
    if (ai === "openai") {
      const key = localStorage.getItem("publy_adm_openai_key") || ""; if (!key) throw new Error("OpenAI API 키 없음 (관리자 설정에서 입력하세요)");
      const r = await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(60000)});
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message||"OpenAI 오류"); }
      const d = await r.json(); return d.choices?.[0]?.message?.content||"";
    }
    throw new Error("AI 미선택");
  }

  async function generateImage(kw: string, title: string = "", idx: number = 0): Promise<string> {
    const imgPrompt = buildImagePrompt(kw, title, idx);
    const ai = localStorage.getItem("publy_adm_image_ai") || "openai_img";
    if (ai === "openai_img") {
      const key = localStorage.getItem("publy_adm_openai_key") || ""; if (!key) throw new Error("OpenAI 키 없음");
      const r = await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"dall-e-3",prompt:imgPrompt,n:1,size:"1024x1024"}),signal:AbortSignal.timeout(60000)});
      if (!r.ok) { const e = await r.json(); throw new Error("DALL-E: "+(e.error?.message||r.status)); }
      const d = await r.json(); return d.data?.[0]?.url||"";
    }
    if (ai === "replicate") {
      const key = localStorage.getItem("publy_adm_replicate_key") || ""; if (!key) throw new Error("Replicate 키 없음");
      const pr = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({input:{prompt:imgPrompt,num_outputs:1,aspect_ratio:"16:9"}}),signal:AbortSignal.timeout(30000)});
      if (!pr.ok) { const e = await pr.json(); throw new Error("Replicate: "+(e.detail||pr.status)); }
      const pred = await pr.json(); const pollUrl = pred.urls?.get; if (!pollUrl) throw new Error("Replicate 응답 오류");
      for (let i = 0; i < 30; i++) { await new Promise(r=>setTimeout(r,2000)); const res = await fetch(pollUrl,{headers:{"Authorization":`Bearer ${key}`}}); const data = await res.json(); if (data.status==="succeeded") return data.output?.[0]||""; if (data.status==="failed") throw new Error("Replicate 실패"); }
      throw new Error("Replicate 타임아웃");
    }
    throw new Error("이미지 AI 미선택");
  }

  function recommendImageCount(content: string): number { return Math.max(1, Math.floor(content.length/200)); }

  function buildCaptions(kw: string, count: number): string[] {
    const k = kw || "사진";
    const pool = [`${k} 현장 모습`,`직접 경험한 ${k}`,`${k} 상세 사진`,`${k} 실제 모습`,`${k} 후기 사진`,`${k} 현장 사진`,`${k} 생생 후기`,`${k} 디테일 컷`];
    return Array.from({length: count}, (_, i) => pool[i % pool.length]);
  }

  function calcTargetChars(): number {
    if (charMode === "manual") return targetChars;
    if (platform === "tistory") return Math.floor(Math.random()*1500)+2500;
    if (adType === "adpost" && /체험단|맛집|후기|리뷰|방문|다녀/.test(keywords[0]||""))
      return Math.floor(Math.random()*1000)+2000;
    return Math.floor(Math.random()*700)+1800;
  }
  function getActiveImages(): string[] { return imgSource === "upload" ? uploadedImages : generatedImages; }

  function splitContentWithImages(content: string, images: string[]): {text:string;img?:string}[] {
    if (!images.length||imgSource==="none") return [{text:content}];
    const cps = Math.floor(content.length/(images.length+1));
    const sections: {text:string;img?:string}[] = [];
    let pos = 0;
    for (let i = 0; i < images.length; i++) {
      const end = Math.min(pos+cps, content.length);
      const brk = content.lastIndexOf("\n",end)||end;
      sections.push({text:content.slice(pos,brk>pos?brk:end).trim()});
      sections.push({text:"",img:images[i]});
      pos = brk>pos?brk:end;
    }
    if (pos < content.length) sections.push({text:content.slice(pos).trim()});
    return sections;
  }

  async function handleGenerateImages() {
    if (!keyword&&!genTitle) { alert("먼저 글을 생성해주세요"); return; }
    setGenImgLoading(true); setGenImgProgress(0); setGenImgCurrent(0);
    imgAbortRef.current = new AbortController();
    const imgs: string[] = [];
    try {
      for (let i=0;i<imgCount;i++) {
        if (imgAbortRef.current.signal.aborted) break;
        setGenImgCurrent(i+1);
        const url = await generateImage(keyword||selectedTitle, genTitle||selectedTitle||"", i);
        imgs.push(url); setGeneratedImages([...imgs]);
        setGenImgProgress(Math.round(((i+1)/imgCount)*100));
      }
      // 이미지 완료 시 캡션 자동생성
      setCaptions(buildCaptions(keyword||selectedTitle, imgs.length));
      setCurrentImgPrompt(buildImagePrompt(keyword||selectedTitle, genTitle||selectedTitle||"", 0));
    } catch(e:any) { if (e.name!=="AbortError") alert("이미지 생성 실패: "+e.message); }
    finally { setGenImgLoading(false); imgAbortRef.current=null; }
  }

  function stopImageGen() { imgAbortRef.current?.abort(); setGenImgLoading(false); }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files; if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => { if (ev.target?.result) setUploadedImages(prev=>[...prev,ev.target!.result as string]); };
      reader.readAsDataURL(file as Blob);
    });
  }

  async function handleGenerateTitles(reset=false) {
    if (!keyword.trim()) { alert("키워드를 입력하세요"); return; }
    // 키워드 풀 누적 (중복제거, 90개 제한)
    if(!keywords.includes(keyword.trim())){
      const newKws=[...keywords,keyword.trim()].slice(-MAX_KW);
      setKeywords(newKws);
      localStorage.setItem("publy_adm_kws",JSON.stringify(newKws));
    }
    if (reset) setTitles([]);
    setLoadingTitles(true);
    const isAdpost = adType === "adpost";
    const prompt = isAdpost
      ? `당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${keyword.trim()}"\n목적: 네이버 애드포스트 클릭률 극대화\n\n반드시 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드를 자연스럽게 포함\n- 25~40자, 친근하고 감성적\n- 숫자 필수 (BEST 7, TOP 5 등)\n- "솔직히", "이것만", "나만 알던" 등 클릭 유발\n\nJSON 배열만 반환.`
      : `당신은 구글 애드센스 최적화 SEO 전문가입니다.\n키워드: "${keyword.trim()}"\n목적: 구글 검색 상위노출 + 애드센스 클릭률 극대화\n\n반드시 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드를 자연스럽게 포함\n- 30~50자, 정보성·전문적 톤\n- "완벽 가이드", "총정리", "이유 5가지" 등\n\nJSON 배열만 반환.`;
    try {
      const text = await callAI(prompt);
      const parsed = parseArr(text);
      if (!parsed.length) throw new Error("제목 파싱 실패");
      setTitles(prev => {
        const combined = [...parsed,...prev];
        if (combined.length >= 90) { localStorage.setItem("publy_adm_titles",JSON.stringify(parsed)); return parsed; }
        localStorage.setItem("publy_adm_titles",JSON.stringify(combined));
        return combined;
      });
    } catch(e:any) { alert("제목 생성 실패: "+e.message); }
    finally { setLoadingTitles(false); }
  }

  async function handleGenerate() {
    if (!selectedTitle && !keyword) return;
    const title = selectedTitle || keyword;
    setGenerating(true); setGenImage("");

    // 글자수 자동 랜덤
    const chars = calcTargetChars();
    if (charMode === "auto") setTargetChars(chars);

    // AI 패턴 뱅크 - 매번 랜덤
    const INTRO_BANK = [
      `오늘은 ${keyword} 직접 경험한 거 솔직하게 써볼게요.`,
      `솔직히 처음엔 별 기대 안 했어요. 근데 ${keyword} 해보고 나서 생각이 완전히 바뀌었어요.`,
      `${keyword} 궁금한 분들 많죠? 저도 한참 찾아봤거든요.`,
      `주변에서 ${keyword} 어디 좋냐고 물어봐서 이참에 정리해봤어요.`,
      `사실 이거 쓸까 말까 고민했는데... ${keyword} 후기 솔직하게 써볼게요.`,
      `${keyword} 직접 겪은 거라 자신있게 말할 수 있어요.`,
      `블로그에 ${keyword} 글 많은데 제 경험이랑 달라서 새로 써봐요.`,
      `저도 처음엔 막막했는데 ${keyword} 이렇게 하면 됩니다.`,
    ];
    const SUBHEAD_BANK = [
      `왜 {주제}가 이렇게 인기 있는 걸까요?`,
      `직접 해보니까 이런 점이 달랐어요`,
      `기대했던 것 vs 실제로 느낀 것`,
      `꼭 알아야 할 핵심 포인트`,
      `이런 분들께 특히 추천해요`,
    ];
    const OUTRO_BANK = [
      `다음에 또 기회가 되면 다시 경험해보고 싶어요.`,
      `이 글이 도움이 됐으면 좋겠습니다.`,
      `궁금한 거 있으면 댓글로 물어봐요!`,
      `저처럼 고민하시는 분들한테 도움이 됐으면 해요.`,
      `오늘도 긴 글 읽어주셔서 감사해요.`,
      `여러분도 꼭 한번 경험해보시길 추천드려요.`,
    ];
    const intro = INTRO_BANK[Math.floor(Math.random()*INTRO_BANK.length)];
    const subStyle = SUBHEAD_BANK[Math.floor(Math.random()*SUBHEAD_BANK.length)];
    const outro = OUTRO_BANK[Math.floor(Math.random()*OUTRO_BANK.length)];

    const catGuide = getCategoryGuide(keyword, title);
    const adGuide = adType==="adpost"
      ? "[수익] 애드포스트: 체류시간 늘리는 감성 스토리."
      : "[수익] 애드센스: 클릭 유도, 키워드 밀도 높게.";
    const platGuide = platform==="naver"
      ? "[플랫폼] 네이버: ## 기호 절대 금지. 순수 텍스트. 감성적 경험담."
      : "[플랫폼] 티스토리: 정보성 중심. 내부링크 2개 자연스럽게 포함.";

    const prompt = `당신은 대한민국 최고의 블로그 작가입니다.

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
    try {
      const text = await callAI(prompt);
      const cleaned = stripMarkdown(text);
      const tgm = cleaned.match(/태그[:\s]*([^\n]+)/);
      const bm = cleaned.match(/태그[^\n]*\n([\s\S]+)/);
      setGenTitle(title);
      if (tgm) setGenTags(tgm[1].trim());
      const body = bm ? bm[1].trim() : cleaned;
      setGenContent(body);
      const recCount = imgCountManual ?? recommendImageCount(body);
      if (imgCountAuto) setImgCount(recCount);
    } catch(e:any) { alert("본문 생성 실패: "+e.message); }
    finally { setGenerating(false); }
  }

  async function handlePublish() {
    if (!pubTitle||!pubContent||!pubAccId) return;
    setPublishing(true); setPubMsg("발행 중...");
    try {
      const r = await fetch(`${BOT}/api/publish-full`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ADM_UID,platform,title:pubTitle,content:pubContent,tags:pubTags.split(",").map((t:string)=>t.trim()).filter(Boolean),imageUrl:pubImg||undefined})});
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      setPubMsg("✅ 발행 완료!"); setPubTitle(""); setPubContent(""); setPubTags(""); setPubImg("");
    } catch(e:any) { setPubMsg("❌ "+e.message); }
    finally { setPublishing(false); }
  }

  async function handleAddAcc() {
    if (!newUser||!newPw) return;
    setAddingAcc(true);
    try { await upsertAccount({user_id:ADM_UID,platform:newPlat,username:newUser,password_encrypted:btoa(newPw),blog_name:newBlog||undefined,is_connected:false}); getAccounts(ADM_UID).then(setAdmAccs); setNewUser(""); setNewPw(""); setNewBlog(""); }
    catch(e:any) { alert(e.message); }
    finally { setAddingAcc(false); }
  }

  async function handleConnect(acc: PublyAccount) {
    if (!botOnline) { alert("봇 서버 실행 필요"); return; }
    setConnId(acc.id);
    try {
      const r = await fetch(`${BOT}/api/${acc.platform}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ADM_UID,id:acc.username,pw:atob((acc as any).password_encrypted||""),blogName:acc.blog_name})});
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      await supabase.from("publy_accounts").update({is_connected:true,connected_at:new Date().toISOString()}).eq("id",acc.id);
      getAccounts(ADM_UID).then(setAdmAccs);
    } catch(e:any) { alert("연결 실패: "+e.message); }
    finally { setConnId(null); }
  }

  async function saveUser(u: UserFull) {
    const e = editMap[u.id]||{}; setSaving(u.id);
    try {
      const upd: any = {};
      if (e.plan&&e.plan!==u.plan) upd.plan=e.plan;
      if (e.memo!==undefined) upd.memo=e.memo;
      if (e.phone!==undefined) upd.phone=e.phone;
      if (Object.keys(upd).length>0) await supabase.from("publy_users").update(upd).eq("id",u.id);
      if (e.plan&&e.plan!==u.plan) await supabase.from("publy_quotas").update({total_quota:PLAN_QUOTA[e.plan]||10}).eq("user_id",u.id);
      if (e.quota!==undefined&&u.quota) await supabase.from("publy_quotas").update({total_quota:Number(e.quota),used_quota:Math.min(u.quota.used_quota,Number(e.quota))}).eq("user_id",u.id);
      if (e.days!==undefined&&u.quota) { const d=new Date(u.quota.reset_date); d.setDate(d.getDate()+Number(e.days)); await supabase.from("publy_quotas").update({reset_date:d.toISOString()}).eq("user_id",u.id); }
      await loadUsers(); setEditMap(p=>{const n={...p};delete n[u.id];return n;}); alert("저장됨");
    } catch(e:any) { alert("오류: "+e.message); }
    finally { setSaving(null); }
  }

  async function resetQuota(uid: string) { if (!confirm("건수 초기화?")) return; await supabase.from("publy_quotas").update({used_quota:0}).eq("user_id",uid); await loadUsers(); }
  async function toggleActive(u: UserFull) { if (!confirm(`${u.name||u.email} ${u.is_active?"비활성화":"활성화"}?`)) return; await supabase.from("publy_users").update({is_active:!u.is_active}).eq("id",u.id); await loadUsers(); }
  async function addNote(uid: string) { if (!newNote.trim()) return; await supabase.from("publy_notes").insert({user_id:uid,content:newNote.trim()}); setNewNote(""); await loadUsers(); }
  async function addPayment(uid: string, plan: string) {
    if (!newPayAmt) return; setAddingPay(true);
    try { await supabase.from("publy_payments").insert({user_id:uid,amount:Number(newPayAmt),plan,method:"manual",status:"completed",note:newPayNote||undefined}); await supabase.from("publy_users").update({plan}).eq("id",uid); await supabase.from("publy_quotas").update({total_quota:PLAN_QUOTA[plan]||10}).eq("user_id",uid); setNewPayAmt(""); setNewPayNote(""); await loadUsers(); }
    finally { setAddingPay(false); }
  }
  function changeAdminPw() { if (!newPw1||newPw1!==newPw2) { setPwMsg("비밀번호를 확인하세요"); return; } if (newPw1.length<4) { setPwMsg("4자 이상"); return; } localStorage.setItem("publy_admin_pw",newPw1); setNewPw1(""); setNewPw2(""); setPwMsg("✅ 변경 완료"); setTimeout(()=>setPwMsg(""),3000); }

  const filteredUsers = users.filter(u => !search || u.email.includes(search) || (u.name||"").includes(search) || (u.phone||"").includes(search));
  const writeStep = genContent ? 3 : selectedTitle ? 2 : titles.length > 0 ? 1 : 0;
  const connAccs = admAccs.filter(a => a.is_connected && a.platform === platform);

  return (
    <>
      <style>{CSS}</style>
      <div className={`app ${theme}`}>

        {/* ── 관리자 사용설명서 모달 ── */}
        {showGuide && (() => {
          const PINK = "#FF6B9D"; const YELLOW = "#FFD93D"; const GREEN = "#00C875"; const RED = "#f85149";
          const tabs = ["📋 개요","✍️ 글 생성","🖼️ 이미지","👥 회원관리","📊 통계/설정"];
          const pages = [
            // 0 - 개요
            <div key="0">
              <div className="g-step" style={{borderColor:`${RED}40`,background:`${RED}08`}}>
                <div className="g-step-num" style={{color:RED}}>🔐 관리자 전용 페이지</div>
                <div className="g-step-title" style={{color:"#fff"}}>Publy 관리자 대시보드</div>
                <div className="g-step-desc">이 페이지는 <b>관리자만 접근</b>할 수 있어요. 회원들의 일반 페이지와 완전히 분리돼 있어요.</div>
              </div>
              <div className="g-step" style={{borderColor:`${YELLOW}40`,background:`${YELLOW}08`}}>
                <div className="g-step-num" style={{color:YELLOW}}>🔑 API 키 완전 분리</div>
                <div className="g-step-title" style={{color:"#fff"}}>관리자 키 ≠ 회원 키</div>
                <div className="g-step-desc">
                  관리자 API 키(<b style={{color:YELLOW}}>publy_adm_*</b>)와 회원 API 키(<b style={{color:GREEN}}>publy_*</b>)는 <b>절대 섞이지 않아요.</b><br/>
                  각 회원도 본인 키만 사용해요. 타인 키를 쓰는 건 구조적으로 불가능해요.
                </div>
              </div>
              {[
                {ico:"✍️ 🖼️",title:"블로그 기능 (사이드바 상단)",desc:"글쓰기 → 이미지 → 발행 → 기록 → 계정. 관리자가 직접 블로그 글을 쓰고 발행할 때 사용",color:GREEN},
                {ico:"🔐",title:"관리자 전용 (사이드바 하단)",desc:"회원관리 / 통계 / 설정. 일반 회원은 절대 접근 불가",color:RED},
              ].map((item,i) => (
                <div key={i} className="g-step" style={{borderColor:`${item.color}35`,background:`${item.color}07`,padding:"12px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:22,flexShrink:0}}>{item.ico}</span>
                    <div><div style={{fontSize:14,fontWeight:800,color:item.color}}>{item.title}</div><div style={{fontSize:13,color:"rgba(255,255,255,.7)",marginTop:2}}>{item.desc}</div></div>
                  </div>
                </div>
              ))}
            </div>,

            // 1 - 글 생성
            <div key="1">
              {[
                {num:"STEP 1",ico:"🎯",title:"플랫폼 + 수익화 선택",color:GREEN,desc:<>헤더에서 <b>🟢 네이버</b> 또는 <b>🟠 티스토리</b> 선택. 글쓰기 탭에서 애드포스트/애드센스 선택!</>},
                {num:"STEP 2",ico:"🔍",title:"키워드 입력 + 제목 선택",color:YELLOW,desc:<>키워드 입력 후 Enter. 제목 30개 자동 추천. 최대 90개까지 추가 가능!</>},
                {num:"STEP 3",ico:"📏",title:"글자수 설정 (자동 랜덤 권장)",color:PINK,desc:<><b>🎲 자동 랜덤</b>: 네이버 1800~2500자, 체험단/맛집 2000~3000자, 티스토리 2500~4000자. 매번 달라서 AI 감지 방지!</>},
                {num:"STEP 4",ico:"🤖",title:"글 생성",color:"#8B5CF6",desc:<>인트로·소제목·마무리가 매번 달라져요. 네이버/티스토리 프롬프트도 자동 분리!</>},
                {num:"STEP 5",ico:"🚀",title:"이미지 탭으로 이동",color:RED,desc:<>글 완료 후 이미지 탭에서 캡션·영상·패턴 설정 후 발행!</>},
              ].map((s,i) => (
                <div key={i} className="g-step" style={{borderColor:`${s.color}40`,background:`${s.color}08`}}>
                  <div className="g-step-num" style={{color:s.color}}>{s.ico} {s.num}</div>
                  <div className="g-step-title" style={{color:"#fff"}}>{s.title}</div>
                  <div className="g-step-desc">{s.desc}</div>
                </div>
              ))}
              <div className="g-tip">💡 설정 탭에서 관리자 API 키를 먼저 입력해야 글 생성이 가능해요!</div>
            </div>,

            // 2 - 이미지
            <div key="2">
              <div className="g-step" style={{borderColor:`${GREEN}40`,background:`${GREEN}08`}}>
                <div className="g-step-num" style={{color:GREEN}}>🖼️ 이미지마다 캡션 필수!</div>
                <div className="g-step-title" style={{color:"#fff"}}>네이버 상위 노출에 도움이 돼요</div>
                <div className="g-step-desc">이미지 생성 완료 후 캡션이 자동 생성돼요. 직접 수정도 가능해요.</div>
              </div>
              {[
                {ico:"🎲",title:"이미지 배치 패턴",desc:"랜덤(권장): 매 발행마다 자동 변경 → AI 감지 방지!\nA: 중간 1장 / B: 앞뒤 각 1장 / C: 균등 분산"},
                {ico:"🎬",title:"영상 삽입",desc:"네이버TV/유튜브 URL 입력 + 위치 선택(상단/중간/하단). 체험단 영상 필수 업체 대응!"},
                {ico:"✏️",title:"수동 수량 설정",desc:"'직접입력' 선택 후 숫자 입력. 체험단 15장 이상도 가능 (최대 20장)"},
              ].map((item,i) => (
                <div key={i} style={{padding:"12px 14px",borderRadius:12,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",marginBottom:8}}>
                  <div style={{fontSize:15,fontWeight:800,color:"#fff",marginBottom:4}}>{item.ico} {item.title}</div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,.65)",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.desc}</div>
                </div>
              ))}
            </div>,

            // 3 - 회원관리
            <div key="3">
              <div className="g-step" style={{borderColor:`${GREEN}40`,background:`${GREEN}08`}}>
                <div className="g-step-num" style={{color:GREEN}}>👥 회원 목록</div>
                <div className="g-step-title" style={{color:"#fff"}}>회원을 클릭하면 상세 정보가 펼쳐져요</div>
                <div className="g-step-desc">이름, 이메일로 검색 가능. 클릭 한 번으로 상세 확인!</div>
              </div>
              {[
                {ico:"💳",title:"플랜 변경",desc:"FREE → BASIC → PRO로 변경하면 발행 건수 자동 업데이트.",color:YELLOW},
                {ico:"🔢",title:"건수 조정",desc:"총 발행 건수 직접 입력. 특별 혜택 제공 시 사용.",color:PINK},
                {ico:"📅",title:"만료일 연장",desc:"일수 입력 → 현재 만료일에서 자동 연장.",color:"#8B5CF6"},
                {ico:"💰",title:"결제 등록",desc:"금액 + 플랜 선택 → 결제 내역 기록 + 플랜 자동 업그레이드.",color:GREEN},
                {ico:"📝",title:"메모",desc:"회원별 관리 메모. 상담 내역, 요청 사항 기록.",color:RED},
              ].map((item,i) => (
                <div key={i} className="g-step" style={{borderColor:`${item.color}35`,background:`${item.color}07`,padding:"12px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:20,flexShrink:0}}>{item.ico}</span>
                    <div><div style={{fontSize:14,fontWeight:800,color:item.color}}>{item.title}</div><div style={{fontSize:13,color:"rgba(255,255,255,.7)",marginTop:2}}>{item.desc}</div></div>
                  </div>
                </div>
              ))}
              <div className="g-tip">⚠️ <b>저장 버튼</b>을 꼭 눌러야 변경사항이 반영돼요!</div>
            </div>,

            // 4 - 통계/설정
            <div key="4">
              <div className="g-step" style={{borderColor:`${YELLOW}40`,background:`${YELLOW}08`}}>
                <div className="g-step-num" style={{color:YELLOW}}>📊 통계 탭</div>
                <div className="g-step-title" style={{color:"#fff"}}>한눈에 보는 서비스 현황</div>
                <div className="g-step-desc">
                  {[["전체 회원","가입 회원 수 총합"],["활성 회원","현재 이용 중"],["PRO/BASIC 회원","플랜별 수"],["총 발행 건수","전체 합산"],["플랜 분포 바","FREE/BASIC/PRO 비율"],["발행 TOP 10","가장 많이 발행한 회원 순위"]].map(([t,d],i) => (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:i<5?"1px solid rgba(255,255,255,.06)":"none",fontSize:13}}>
                      <b style={{color:"#fff"}}>{t}</b><span style={{color:"rgba(255,255,255,.55)"}}>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="g-step" style={{borderColor:`${RED}40`,background:`${RED}08`}}>
                <div className="g-step-num" style={{color:RED}}>🔐 설정 탭 - 관리자 API 키</div>
                <div className="g-step-title" style={{color:"#fff"}}>회원 키와 완전 분리!</div>
                <div className="g-step-desc">
                  관리자 키는 <b>publy_adm_*</b>로 저장. 회원 키(publy_*)와 절대 섞이지 않아요.<br/>
                  글쓰기 AI(Gemini/Groq/GPT), 이미지 AI(DALL-E/Flux) 각각 설정!
                </div>
                <button className="g-btn" style={{background:`linear-gradient(135deg,${YELLOW},#FFA500)`,color:"#000"}}
                  onClick={() => { setShowGuide(false); setTab("settings"); }}>🔐 API 키 설정하러 가기</button>
              </div>
            </div>,
          ];

          return (
            <div className="guide-overlay" onClick={() => setShowGuide(false)}>
              <div className="guide-modal" onClick={e => e.stopPropagation()}>
                <div className="guide-header" style={{position:"relative"}}>
                  <div className="guide-logo-row">
                    <div className="guide-logo-ico">📋</div>
                    <div>
                      <div className="guide-title">관리자 사용설명서</div>
                      <div className="guide-subtitle">Publy 관리자 페이지 완전 가이드</div>
                    </div>
                  </div>
                  <button className="guide-close" onClick={() => setShowGuide(false)}>✕</button>
                  <div className="guide-tabs">
                    {tabs.map((t,i) => (
                      <button key={i} className={`guide-tab ${guideTab===i?"active":""}`} onClick={() => setGuideTab(i)}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="guide-body">{pages[guideTab]}</div>
                <div className="guide-footer">
                  <button className="guide-nav-btn" style={{borderColor:"rgba(255,255,255,.15)",background:"transparent",color:"rgba(255,255,255,.6)"}} onClick={() => setGuideTab(Math.max(0,guideTab-1))} disabled={guideTab===0}>← 이전</button>
                  <span className="guide-page">{guideTab+1} / {tabs.length}</span>
                  {guideTab < tabs.length-1
                    ? <button className="guide-nav-btn" style={{borderColor:YELLOW,background:`${YELLOW}15`,color:YELLOW}} onClick={() => setGuideTab(guideTab+1)}>다음 →</button>
                    : <button className="guide-nav-btn" style={{borderColor:GREEN,background:`${GREEN}15`,color:GREEN}} onClick={() => setShowGuide(false)}>✅ 확인!</button>
                  }
                </div>
              </div>
            </div>
          );
        })()}

        {/* 헤더 */}
        <div className="header">
          <div className="logo">
            <div className="logo-ico">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L22 20H2L12 2Z" fill="#fff" opacity=".8"/>
                <path d="M12 7L19 19H5L12 7Z" fill="#ff6b6b" opacity=".8"/>
              </svg>
            </div>
            <span className="logo-text">PUBLY ADM</span>
          </div>
          <div className="header-mid">
            <div className={`server-badge ${botOnline?"server-on":"server-off"}`}>
              <span className={`dot ${botOnline?"dot-on":"dot-off"}`}/>
              {botOnline?"봇 온라인":"봇 오프라인"}
            </div>
            <span className="adm-badge">🔐 관리자</span>
          </div>
          <div className="header-right">
            <button className="icon-btn" onClick={onThemeToggle}>{theme==="dark"?"☀️":"🌙"}</button>
            <button className="icon-btn" onClick={checkBot}>🔄</button>
            <button className="adm-guide-btn" onClick={() => { setShowGuide(true); setGuideTab(0); }}>
              📋 관리자 가이드
            </button>
            <button className="back-btn" onClick={onDashboard}>← 회원 화면</button>
            <button className="back-btn" style={{borderColor:"rgba(248,81,73,.3)",color:"var(--danger)"}} onClick={onBack}>로그아웃</button>
          </div>
        </div>

        <div className="layout">
          {/* 사이드바 */}
          <div className="sidebar">
            <div className="nav-section" style={{fontSize:10,fontWeight:800,color:"var(--text3)",padding:"8px 12px 4px",letterSpacing:".08em"}}>✍️ 블로그 기능</div>
            {TABS.filter(t=>["keyword","write","image","publish","manage","accounts"].includes(t.k)).map(t => (
              <button key={t.k} className={`nav-item ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as any)}>
                <span className="nav-ico">{t.i}</span>{t.l}
              </button>
            ))}
            <div className="nav-section" style={{fontSize:10,fontWeight:800,color:"var(--text3)",padding:"10px 12px 4px",letterSpacing:".08em",borderTop:"1px solid var(--border)",marginTop:6}}>🔐 관리자 전용</div>
            {TABS.filter(t=>["users","stats","settings"].includes(t.k)).map(t => (
              <button key={t.k} className={`nav-item ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as any)}>
                <span className="nav-ico">{t.i}</span>{t.l}
                {t.k==="users" && users.length>0 && <span className="nav-badge">{users.length}</span>}
              </button>
            ))}
            <div className="sidebar-stats">
              <div className="stat-box">
                <div className="stat-num">{users.length}</div>
                <div className="stat-lbl">전체 회원</div>
              </div>
              <div className="stat-box" style={{background:"rgba(248,81,73,.06)",borderColor:"rgba(248,81,73,.2)"}}>
                <div className="stat-num" style={{fontSize:18,color:"var(--danger)"}}>{users.filter(u=>u.is_active).length}</div>
                <div className="stat-lbl">활성 회원</div>
              </div>
            </div>
          </div>

          {/* 메인 */}
          <div className="main">

            {/* ───── ✍️ 글 생성 ───── */}
            {/* ───── 🔍 키워드/제목 ───── */}
            {tab === "keyword" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="card">
                  <div className="card-title">🎯 수익화 목적</div>
                  <div className="adtype-grid">
                    {([{id:"adpost",label:"📰 네이버 애드포스트",sub:"감성적·경험 공유형, 1200~1500자",cls:"adpost-sel"},{id:"adsense",label:"🔍 구글 애드센스",sub:"정보성·SEO 최적화, 1500자+",cls:"adsense-sel"}] as const).map(t=>(
                      <button key={t.id} className={`adtype-btn ${adType===t.id?t.cls:""}`} onClick={()=>setAdType(t.id)}>
                        <div className="adtype-label">{t.label}</div><div className="adtype-sub">{t.sub}</div>
                      </button>
                    ))}
                  </div>
                  {keywords.length>0&&(
                    <div style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <label className="inp-label" style={{margin:0}}>🏷️ 누적 키워드 ({keywords.length}/{MAX_KW})</label>
                        <button style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(248,81,73,.3)",background:"rgba(248,81,73,.1)",color:"var(--danger)",cursor:"pointer",fontSize:11,fontFamily:"inherit"}} onClick={()=>{setKeywords([]);localStorage.removeItem("publy_adm_kws");}}>전체 삭제</button>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {keywords.map((kw,i)=>(
                          <button key={i} onClick={()=>setKeyword(kw)} style={{padding:"8px 15px",borderRadius:99,fontSize:13,fontWeight:600,cursor:"pointer",border:`1.5px solid ${keyword===kw?"var(--accent)":"var(--border)"}`,background:keyword===kw?"var(--accent-bg)":"var(--bg)",color:keyword===kw?"var(--accent-text)":"var(--text2)",fontFamily:"inherit",transition:"all .15s"}}>{kw}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <label className="inp-label">🔍 키워드 입력</label>
                  <div style={{display:"flex",gap:8}}>
                    <input className="inp lg" style={{flex:1}} placeholder="예: 강남 맛집, 다이어트 방법..."
                      value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGenerateTitles(true)}/>
                    <select className="inp" style={{width:100}} value={platform} onChange={e=>setPlatform(e.target.value as any)}>
                      <option value="naver">네이버</option><option value="tistory">티스토리</option>
                    </select>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                    <button className="btn btn-primary" onClick={()=>handleGenerateTitles(true)} disabled={loadingTitles||!keyword}>
                      {loadingTitles?<><span className="spinner"/>생성 중...</>:<>⭐ 제목 {BATCH}개 추천</>}
                    </button>
                    {titles.length>0&&<button className="btn btn-secondary" onClick={()=>handleGenerateTitles(false)} disabled={loadingTitles}>{titles.length>=MAX_TITLES?"🔄 초기화 후 재생성":"➕ 30개 추가"}</button>}
                    {titles.length>0&&<button className="btn btn-sm" style={{background:"rgba(248,81,73,.1)",color:"var(--danger)",border:"1px solid rgba(248,81,73,.3)"}} onClick={()=>{setTitles([]);setSelectedTitle("");localStorage.removeItem("publy_adm_titles");}}>🗑 초기화</button>}
                  </div>
                  {titles.length>0&&(
                    <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1,height:4,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${(titles.length/MAX_TITLES)*100}%`,background:titles.length>=MAX_TITLES?"var(--danger)":"var(--accent)",borderRadius:99,transition:"width .4s"}}/>
                      </div>
                      <span style={{fontSize:11,color:titles.length>=MAX_TITLES?"var(--danger)":"var(--text2)",fontFamily:"monospace"}}>{titles.length}/{MAX_TITLES}</span>
                    </div>
                  )}
                </div>
                {titles.length>0&&(
                  <div className="card">
                    <div className="card-title">✨ 제목 선택<span style={{marginLeft:"auto",fontSize:11,fontWeight:500,color:"var(--text2)",textTransform:"none",letterSpacing:0}}>클릭해서 선택</span></div>
                    {selectedTitle&&<div className="selected-banner" style={{marginBottom:14}}><div className="selected-banner-label">✅ 선택된 제목</div><div className="selected-banner-text">{selectedTitle}</div></div>}
                    <div className="title-grid">
                      {titles.map((t,i)=>(
                        <button key={`${t}-${i}`} className={`title-card ${selectedTitle===t?"selected":""}`} onClick={()=>setSelectedTitle(t)}>
                          <div className="title-num">#{titles.length-i}</div>
                          <div className="title-text">{t}</div>
                          {selectedTitle===t&&<div className="title-check">✓</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {selectedTitle&&(
                  <button className="btn btn-primary btn-full btn-xl" style={{marginTop:4}} onClick={()=>setTab("write")}>
                    ✍️ 글 생성하러 가기 →
                  </button>
                )}
              </div>
            )}

            {/* ───── ✍️ 글 생성 ───── */}
            {tab === "write" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                {selectedTitle?(
                  <div className="selected-banner" style={{marginBottom:14}}>
                    <div className="selected-banner-label">📌 선택된 제목 — <span style={{fontWeight:400,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("keyword")}>키워드/제목 탭에서 변경</span></div>
                    <div className="selected-banner-text">{selectedTitle}</div>
                  </div>
                ):(
                  <div className="alert alert-warn" style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    ⚠️ 먼저 키워드/제목 탭에서 제목을 선택해주세요
                    <button className="btn btn-sm" style={{marginLeft:"auto",flexShrink:0,background:"var(--card)",border:"1px solid var(--border)",color:"var(--text)",fontFamily:"inherit",cursor:"pointer",borderRadius:8,padding:"8px 14px",fontSize:13}} onClick={()=>setTab("keyword")}>키워드/제목 탭으로 →</button>
                  </div>
                )}
                <div className="card">
                  <div className="card-title">⚙️ 생성 설정</div>
                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <label className="inp-label" style={{margin:0}}>📏 목표 글자수</label>
                      <span style={{fontSize:15,fontWeight:800,color:"var(--accent-text)"}}>{targetChars.toLocaleString()}자</span>
                    </div>
                    <input type="range" min={1200} max={2000} step={100} value={targetChars} onChange={e=>setTargetChars(Number(e.target.value))} style={{width:"100%",accentColor:"var(--accent)",height:6,cursor:"pointer"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginTop:4}}><span>1,200자</span><span>1,600자</span><span>2,000자</span></div>
                  </div>
                  <div style={{marginBottom:16}}>
                    <label className="inp-label">🖼️ 이미지</label>
                    <div className="toggle-group">
                      {([{id:"ai",label:"🤖 AI 생성"},{id:"upload",label:"📁 내 이미지"},{id:"none",label:"🚫 없음"}] as const).map(s=>(
                        <button key={s.id} className={`toggle-btn ${imgSource===s.id?"active":""}`} onClick={()=>setImgSource(s.id)}>{s.label}</button>
                      ))}
                    </div>
                  </div>
                  {imgSource==="upload"&&(
                    <div style={{marginBottom:16}}>
                      <label style={{display:"flex",alignItems:"center",gap:10,padding:"14px 18px",borderRadius:10,border:"2px dashed var(--accent-border)",background:"var(--accent-bg)",cursor:"pointer"}}>
                        <span style={{fontSize:22}}>📁</span>
                        <div><div style={{fontSize:13,fontWeight:700,color:"var(--accent-text)"}}>이미지 파일 선택</div><div style={{fontSize:11,color:"var(--text2)"}}>여러 장 동시 선택 가능</div></div>
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{display:"none"}}/>
                      </label>
                      {uploadedImages.length>0&&<div className="img-grid" style={{marginTop:10}}>{uploadedImages.map((img,i)=>(<div key={i} className="img-thumb-wrap"><img src={img} alt="" className={`img-thumb ${i===0?"thumb-first":""}`}/><button className="img-thumb-del" onClick={()=>setUploadedImages(prev=>prev.filter((_,j)=>j!==i))}>✕</button></div>))}</div>}
                    </div>
                  )}
                  <button className="btn btn-primary btn-full btn-xl" onClick={handleGenerate} disabled={generating||!selectedTitle}>
                    {generating?<><span className="spinner"/>AI 작성 중...</>:<>✍️ 본문 생성 시작</>}
                  </button>
                </div>
                {genContent&&(
                  <>
                    <div className="card">
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                        <div className="card-title" style={{marginBottom:0}}>🎉 글 생성 완료!</div>
                        <div style={{display:"flex",gap:7,alignItems:"center"}}>
                          <span className="char-badge">{genContent.length.toLocaleString()}자</span>
                          <button className="preview-btn" onClick={()=>setShowPreview(true)}>👁️ 미리보기</button>
                        </div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:12}}>
                        {([{l:"제목",v:genTitle,s:setGenTitle},{l:"태그",v:genTags,s:setGenTags}] as const).map(f=>(
                          <div key={f.l}><label className="inp-label">{f.l}</label><input className="inp" value={f.v} onChange={e=>f.s(e.target.value)}/></div>
                        ))}
                        <div>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                            <label className="inp-label" style={{margin:0}}>본문</label>
                            <span style={{fontSize:12,color:"var(--text2)"}}>{genContent.length.toLocaleString()}자</span>
                          </div>
                          <textarea className="inp" rows={12} style={{fontSize:13,lineHeight:1.8}} value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                      <button className="btn btn-primary" style={{flex:1}} onClick={()=>setTab("image")}>🖼️ 이미지 생성하기 →</button>
                      <button className="btn btn-secondary" style={{flex:1}} onClick={()=>{setPubTitle(genTitle);setPubContent(genContent);setPubTags(genTags);setPubImg(getActiveImages()[0]||"");setTab("publish");}}>🚀 발행하기로 이동</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ───── 🖼️ 이미지 생성 ───── */}
            {tab === "image" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!genContent&&<div className="alert alert-warn">⚠️ 먼저 글 생성 탭에서 글을 생성해주세요!<button className="abp" style={{marginLeft:"auto",padding:"7px 14px",fontSize:12}} onClick={()=>setTab("write")}>글 생성하러 가기</button></div>}
                <div className="adm-img-split">
                  {/* 왼쪽 설정 */}
                  <div className="card" style={{position:"sticky",top:8}}>
                    <div className="card-title" style={{marginBottom:14}}>⚙️ 이미지 설정</div>
                    <div style={{marginBottom:14}}>
                      <label className="inp-label">이미지 소스</label>
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        {([{id:"ai",ico:"🤖",label:"AI 자동 생성"},{id:"upload",ico:"📁",label:"내 이미지 업로드"},{id:"none",ico:"🚫",label:"이미지 없이 발행"}] as const).map(s=>(
                          <button key={s.id} onClick={()=>setImgSource(s.id)} style={{padding:"10px 12px",borderRadius:9,border:`1.5px solid ${imgSource===s.id?"var(--a)":"var(--b)"}`,background:imgSource===s.id?"var(--ad)":"var(--ib)",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,textAlign:"left"}}>
                            <span style={{fontSize:17}}>{s.ico}</span>
                            <span style={{fontSize:13,fontWeight:600,color:imgSource===s.id?"var(--a)":"var(--m)"}}>{s.label}</span>
                            {imgSource===s.id&&<span style={{marginLeft:"auto",color:"var(--a)",fontSize:13}}>✓</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                    {imgSource==="ai"&&(
                      <>
                        <div style={{marginBottom:14}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <label className="inp-label" style={{margin:0}}>생성 수량</label>
                            <div style={{display:"flex",alignItems:"center",gap:7}}>
                              <span style={{fontSize:26,fontWeight:900,color:"var(--a)"}}>{imgCount}</span>
                              <span style={{fontSize:12,color:"var(--m)"}}>장</span>
                              {!imgCountAuto&&<button style={{padding:"3px 8px",borderRadius:6,border:"1px solid var(--b)",background:"transparent",color:"var(--a)",cursor:"pointer",fontSize:10,fontFamily:"inherit",fontWeight:700}} onClick={()=>{setImgCountAuto(true);if(genContent)setImgCount(Math.max(1,Math.min(10,Math.floor(genContent.length/200))));}}>자동</button>}
                            </div>
                          </div>
                          <input type="range" min={1} max={20} step={1} value={imgCount} onChange={e=>{setImgCountAuto(false);setImgCount(Number(e.target.value));}} style={{width:"100%",accentColor:"var(--a)",height:6,cursor:"pointer"}}/>
                          {imgCountAuto&&genContent&&<div style={{marginTop:6,padding:"6px 10px",borderRadius:7,background:"var(--ad)",border:"1px solid",borderColor:"var(--a)30",fontSize:11,color:"var(--a)",fontWeight:600}}>💡 자동 추천: {imgCount}장</div>}
                        </div>
                        {genImgLoading&&(
                          <div style={{marginBottom:14,padding:"12px",borderRadius:9,background:"var(--ib)",border:"1px solid var(--b)"}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                              <span style={{fontSize:12,fontWeight:700,color:"var(--a)"}}>⏳ {genImgCurrent}/{imgCount}장</span>
                              <span style={{fontSize:13,fontWeight:900,color:"var(--a)"}}>{genImgProgress}%</span>
                            </div>
                            <div style={{height:7,background:"var(--b)",borderRadius:99,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${genImgProgress}%`,background:"linear-gradient(90deg,var(--a),#00cc80)",borderRadius:99,transition:"width .4s"}}/>
                            </div>
                            <div style={{display:"flex",gap:3,marginTop:7}}>
                              {Array.from({length:imgCount}).map((_,i)=>(
                                <div key={i} style={{flex:1,height:4,borderRadius:99,background:i<genImgCurrent?"var(--a)":"var(--b)",transition:"background .3s"}}/>
                              ))}
                            </div>
                          </div>
                        )}
                        <div style={{display:"flex",flexDirection:"column",gap:7}}>
                          <button className="abp" onClick={handleGenerateImages} disabled={genImgLoading||!genContent}>{genImgLoading?<><span className="asp2"/>생성 중...</>:<>🎨 이미지 {imgCount}장 생성</>}</button>
                          {genImgLoading&&<button onClick={stopImageGen} style={{padding:"9px",borderRadius:99,border:"1.5px solid rgba(248,81,73,.35)",background:"rgba(248,81,73,.1)",color:"var(--err)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>⏹ 생성 중단</button>}
                          {generatedImages.length>0&&!genImgLoading&&<button onClick={()=>{setGeneratedImages([]);setGenImgProgress(0);setGenImgCurrent(0);}} style={{padding:"8px",borderRadius:8,border:"1px solid rgba(248,81,73,.3)",background:"rgba(248,81,73,.08)",color:"var(--err)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>🗑 이미지 초기화</button>}
                        </div>
                      </>
                    )}
                    {imgSource==="upload"&&(
                      <div>
                        <label style={{display:"flex",alignItems:"center",gap:10,padding:"14px",borderRadius:10,border:"2px dashed var(--a)40",background:"var(--ad)",cursor:"pointer"}}>
                          <span style={{fontSize:22}}>📁</span>
                          <div><div style={{fontSize:13,fontWeight:700,color:"var(--a)"}}>파일 선택</div><div style={{fontSize:11,color:"var(--m)",marginTop:2}}>여러 장 동시 가능</div></div>
                          <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{display:"none"}}/>
                        </label>
                        {uploadedImages.length>0&&<button onClick={()=>setUploadedImages([])} style={{marginTop:8,width:"100%",padding:"7px",borderRadius:7,border:"1px solid rgba(248,81,73,.3)",background:"rgba(248,81,73,.08)",color:"var(--err)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>🗑 업로드 초기화</button>}
                      </div>
                    )}
                  </div>
                  {/* 오른쪽 갤러리 */}
                  <div>
                    <div className="card" style={{minHeight:280}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                        <div className="card-title" style={{margin:0}}>🖼️ 생성된 이미지{getActiveImages().length>0&&<span style={{fontWeight:400,color:"var(--m)",textTransform:"none",letterSpacing:0}}> — {getActiveImages().length}장 · 첫 번째 썸네일</span>}</div>
                        {getActiveImages().length>0&&captions.length===0&&(
                          <button style={{padding:"5px 12px",borderRadius:8,border:"1px solid var(--b)",background:"var(--ad)",color:"var(--a)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}} onClick={()=>setCaptions(buildCaptions(keyword||selectedTitle,getActiveImages().length))}>💬 캡션 자동생성</button>
                        )}
                      </div>
                      {getActiveImages().length===0&&!genImgLoading?(
                        <div style={{textAlign:"center",padding:"36px 20px",color:"var(--m)"}}>
                          <div style={{fontSize:44,marginBottom:10}}>🖼️</div>
                          <div style={{fontSize:14,fontWeight:700,marginBottom:5}}>아직 이미지가 없어요</div>
                          <div style={{fontSize:12,color:"var(--m)"}}>왼쪽에서 수량 설정 후 생성 버튼!</div>
                        </div>
                      ):(
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                          {genImgLoading&&Array.from({length:imgCount-generatedImages.length}).map((_,i)=>(
                            <div key={`ph-${i}`} style={{display:"flex",flexDirection:"column",gap:6}}>
                              <div style={{aspectRatio:"1",borderRadius:11,background:"var(--ib)",border:"2px dashed var(--b)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                {i===0?<><span className="asp2"/></>:<span style={{fontSize:20,opacity:.3}}>🖼️</span>}
                              </div>
                            </div>
                          ))}
                          {getActiveImages().map((img,i)=>(
                            <div key={i} style={{display:"flex",flexDirection:"column",gap:5}}>
                              <div style={{position:"relative",aspectRatio:"1"}}>
                                <img src={img} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:11,border:i===0?"2px solid var(--a)":"2px solid var(--b)",display:"block",cursor:"pointer"}} onClick={()=>window.open(img,"_blank")} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                {i===0&&<span style={{position:"absolute",top:-7,left:-4,fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,background:"var(--a)",color:"#000"}}>썸네일</span>}
                                <button style={{position:"absolute",top:-7,right:-7,width:24,height:24,borderRadius:"50%",background:"var(--err)",border:"2px solid var(--ib)",color:"#fff",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}
                                  onClick={()=>{
                                    if(imgSource==="ai")setGeneratedImages(p=>p.filter((_,j)=>j!==i));
                                    else setUploadedImages(p=>p.filter((_,j)=>j!==i));
                                    setCaptions(p=>p.filter((_,j)=>j!==i));
                                  }}>✕</button>
                              </div>
                              {/* 캡션 입력 - 필수 */}
                              <input
                                style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1px solid var(--b)",background:"var(--ib)",color:"var(--c)",fontSize:11,fontFamily:"inherit",outline:"none"}}
                                placeholder={`캡션 (예: ${keyword||"사진"} ${i===0?"대표":"현장"} 사진)`}
                                value={captions[i]||""}
                                onChange={e=>{const next=[...captions];next[i]=e.target.value;setCaptions(next);}}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 영상 + 이미지 패턴 */}
                    <div className="adm-video-grid">
                      <div className="card" style={{padding:"13px 14px"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:videoOn?12:0}}>
                          <div className="card-title" style={{margin:0,fontSize:11}}>🎬 영상 삽입</div>
                          <button onClick={()=>setVideoOn(v=>!v)} style={{width:40,height:22,borderRadius:99,background:videoOn?"var(--a)":"var(--b)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                            <div style={{position:"absolute",top:3,left:videoOn?21:3,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
                          </button>
                        </div>
                        {videoOn&&(
                          <>
                            <input style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid var(--b)",background:"var(--ib)",color:"var(--c)",fontSize:12,fontFamily:"inherit",outline:"none",marginBottom:8}} placeholder="영상 URL (네이버TV/유튜브)" value={videoUrl} onChange={e=>setVideoUrl(e.target.value)}/>
                            <div style={{display:"flex",gap:5}}>
                              {(["top","middle","bottom"] as const).map(p=>(
                                <button key={p} onClick={()=>setVideoPosition(p)} style={{flex:1,padding:"5px",borderRadius:7,border:`1.5px solid ${videoPosition===p?"var(--a)":"var(--b)"}`,background:videoPosition===p?"var(--ad)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:videoPosition===p?"var(--a)":"var(--m)",fontFamily:"inherit"}}>{p==="top"?"상단":p==="middle"?"중간":"하단"}</button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="card" style={{padding:"13px 14px"}}>
                        <div className="card-title" style={{marginBottom:8,fontSize:11}}>📐 이미지 패턴</div>
                        <div style={{display:"flex",flexDirection:"column",gap:5}}>
                          {(["random","A","B","C"] as const).map(p=>(
                            <button key={p} onClick={()=>setImgPattern(p)} style={{padding:"6px 10px",borderRadius:8,border:`1.5px solid ${imgPattern===p?"var(--a)":"var(--b)"}`,background:imgPattern===p?"var(--ad)":"transparent",cursor:"pointer",fontFamily:"inherit",textAlign:"left",fontSize:11,fontWeight:700,color:imgPattern===p?"var(--a)":"var(--m)"}}>
                              {p==="random"?"🎲 랜덤(권장)":p==="A"?"A: 중간 1장":p==="B"?"B: 앞뒤 각 1장":"C: 균등 분산"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{display:"flex",gap:10,marginTop:10,flexWrap:"wrap"}}>
                      <button className="abp" style={{flex:1}} onClick={()=>setTab("publish")} disabled={!genContent}>🚀 발행하기로 이동 →</button>
                      <button style={{flex:1,padding:"13px",borderRadius:99,border:"1px solid var(--b)",background:"var(--ib)",color:"var(--m)",cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:700}} onClick={()=>setTab("write")}>← 글 생성으로</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ───── 📋 발행 관리 ───── */}
            {tab === "manage" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>📝 발행 방식 선택</div>
                  <div style={{display:"grid",gap:10}}>
                    {([
                      {id:"full",     ico:"📄", name:"① 전체 발행",  sub:"본문 + FAQ + 관련글 모두"},
                      {id:"body_faq", ico:"💬", name:"② 본문 + FAQ", sub:"본문과 자주 묻는 질문까지"},
                      {id:"body_only",ico:"✏️", name:"③ 본문만",     sub:"핵심 내용만 깔끔하게"},
                    ] as const).map(c=>(
                      <button key={c.id} onClick={()=>setPubSub(c.id as any)} style={{padding:"15px 17px",borderRadius:12,border:`2px solid ${(pubSub||"full")===c.id?(c.id==="full"?"var(--a)":c.id==="body_faq"?"var(--pink,#FF6B9D)":"var(--yellow,#FFD93D)"):"var(--b)"}`,background:(pubSub||"full")===c.id?(c.id==="full"?"var(--ad)":c.id==="body_faq"?"rgba(255,107,157,.08)":"rgba(255,217,61,.08)"):"var(--ib)",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                        <div style={{fontSize:22,marginBottom:6}}>{c.ico}</div>
                        <div style={{fontSize:15,fontWeight:800,color:"var(--text,#e8f4ff)",marginBottom:3}}>{c.name}</div>
                        <div style={{fontSize:12,color:"var(--m)"}}>{c.sub}</div>
                      </button>
                    ))}
                  </div>
                  {genContent&&<button className="abp" style={{width:"100%",marginTop:10}} onClick={()=>setTab("publish")}>🚀 이 방식으로 발행하기 →</button>}
                </div>
                {/* 발행 기록 생략 - 관리자는 회원관리 탭에서 확인 */}
                <div className="card">
                  <div className="card-title">📋 발행 현황</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                    {[{l:"전체 회원",v:String(users.length)},{l:"오늘 발행",v:"—"},{l:"잔여 건수",v:"—"}].map((s,i)=>(
                      <div key={i} style={{padding:"14px 12px",borderRadius:11,background:"var(--ib)",border:"1px solid var(--b)",textAlign:"center"}}>
                        <div style={{fontSize:22,fontWeight:900,color:i===0?"var(--a)":"var(--text,#e8f4ff)"}}>{s.v}</div>
                        <div style={{fontSize:10,color:"var(--m)",marginTop:3}}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ───── 🚀 자동발행 ───── */}
            {tab === "publish" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!botOnline&&<div className="alert alert-danger">⚠️ 봇 서버 오프라인 — PC에서 Publy 앱을 실행하세요</div>}
                <div className="card">
                  <div className="card-title">🌐 플랫폼</div>
                  <div className="plat-grid">
                    {([{p:"naver",ico:"🟢",name:"네이버 블로그",sub:"Playwright 자동화",cls:"naver-sel"},{p:"tistory",ico:"🟠",name:"티스토리",sub:"Playwright 자동화",cls:"tistory-sel"}] as const).map(({p,ico,name,sub,cls})=>(
                      <button key={p} className={`plat-btn ${platform===p?cls:""}`} onClick={()=>setPlatform(p)}>
                        <span className="plat-ico">{ico}</span>
                        <div><div className="plat-name">{name}</div><div className="plat-sub">{sub}</div></div>
                        {platform===p&&<span className="plat-check" style={{color:p==="naver"?"var(--naver)":"var(--tistory)"}}>✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <div className="card-title">🔗 발행 계정</div>
                  {connAccs.length===0?(
                    <div className="empty" style={{padding:"24px"}}>
                      <div style={{fontSize:32,marginBottom:8}}>🔗</div>
                      <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>연결된 계정 없음</div>
                      <button className="btn btn-primary btn-sm" onClick={()=>setTab("accounts")}>계정 관리로 이동</button>
                    </div>
                  ):connAccs.map(a=>(
                    <label key={a.id} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderRadius:12,cursor:"pointer",marginBottom:8,background:pubAccId===a.id?"var(--accent-bg)":"var(--bg)",border:`2px solid ${pubAccId===a.id?"var(--accent)":"var(--border)"}`,transition:"all .15s"}}>
                      <input type="radio" name="pacc" checked={pubAccId===a.id} onChange={()=>setPubAccId(a.id)} style={{accentColor:"var(--accent)",width:18,height:18,flexShrink:0}}/>
                      <div style={{flex:1}}><div style={{fontSize:15,fontWeight:700}}>{a.username}</div>{a.blog_name&&<div style={{fontSize:12,color:"var(--text2)"}}>{a.blog_name}</div>}</div>
                      <span style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>✅ 연결됨</span>
                    </label>
                  ))}
                </div>
                <div className="card">
                  <div className="card-title">📝 발행 내용</div>
                  {pubImg&&(
                    <div style={{marginBottom:14}}>
                      <label className="inp-label">🖼️ 썸네일</label>
                      <div style={{position:"relative",display:"inline-block",width:"100%"}}>
                        <img src={pubImg} alt="" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:12,border:"1px solid var(--border)"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                        <button onClick={()=>setPubImg("")} style={{position:"absolute",top:10,right:10,background:"rgba(0,0,0,.7)",border:"none",color:"#fff",borderRadius:99,width:30,height:30,cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div><label className="inp-label">제목 *</label><input className="inp lg" value={pubTitle} onChange={e=>setPubTitle(e.target.value)} placeholder="블로그 글 제목..."/></div>
                    <div><label className="inp-label">태그 (쉼표 구분)</label><input className="inp" value={pubTags} onChange={e=>setPubTags(e.target.value)} placeholder="태그1, 태그2, 태그3"/></div>
                    <div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><label className="inp-label" style={{margin:0}}>본문 *</label><span style={{fontSize:12,color:"var(--text2)"}}>{pubContent.length.toLocaleString()}자</span></div>
                      <textarea className="inp" rows={10} value={pubContent} onChange={e=>setPubContent(e.target.value)} placeholder="발행할 내용을 입력하세요..."/>
                    </div>
                  </div>
                </div>
                <button className="btn btn-primary btn-full btn-xl" style={{marginBottom:14}} onClick={handlePublish} disabled={publishing||!botOnline||!pubAccId||!pubTitle||!pubContent}>
                  {publishing?<><span className="spinner"/>발행 중...</>:<>🚀 블로그 자동 발행</>}
                </button>
                {pubMsg&&<div className={`alert ${pubMsg.includes("✅")?"alert-success":"alert-danger"}`}>{pubMsg}</div>}
              </div>
            )}

            {/* ───── 🔗 계정 관리 ───── */}
            {tab === "accounts" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!botOnline&&<div className="alert alert-warn">⚠️ PC에서 Publy 앱을 실행해야 계정 연결이 가능합니다</div>}
                <div className="card">
                  <div className="card-title">➕ 계정 추가</div>
                  <div style={{display:"grid",gridTemplateColumns:"100px 1fr 1fr",gap:10,marginBottom:12}}>
                    <div><label className="inp-label">플랫폼</label><select className="inp" value={newPlat} onChange={e=>setNewPlat(e.target.value as any)}><option value="naver">네이버</option><option value="tistory">티스토리</option></select></div>
                    <div><label className="inp-label">아이디</label><input className="inp" placeholder="블로그 아이디" value={newUser} onChange={e=>setNewUser(e.target.value)}/></div>
                    <div><label className="inp-label">비밀번호</label><input className="inp" type="password" placeholder="비밀번호" value={newPw} onChange={e=>setNewPw(e.target.value)}/></div>
                  </div>
                  <div style={{marginBottom:14}}><label className="inp-label">블로그명 <span style={{color:"var(--text3)",fontWeight:400}}>(티스토리만)</span></label><input className="inp" placeholder="예: myblog" value={newBlog} onChange={e=>setNewBlog(e.target.value)}/></div>
                  <button className="btn btn-primary" onClick={handleAddAcc} disabled={addingAcc||!newUser||!newPw}>{addingAcc?<><span className="spinner"/>추가 중...</>:<>➕ 계정 추가</>}</button>
                </div>
                {admAccs.filter(a=>a.platform!=="google").map((a,i)=>(
                  <div key={a.id} className={`acc-card ${a.is_connected?(a.platform==="naver"?"connected-naver":"connected-tistory"):""}`} style={{animationDelay:`${i*.06}s`}}>
                    <span style={{fontSize:28}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:15,fontWeight:700,color:"var(--text)"}}>{a.username}</div>
                      <div style={{fontSize:11,color:"var(--text2)"}}>{a.platform}{a.blog_name&&` · ${a.blog_name}`}</div>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:99,background:a.is_connected?"var(--accent-bg)":"var(--card-hover)",color:a.is_connected?"var(--accent-text)":"var(--text2)",border:"1px solid"}}>
                      {a.is_connected?"✅ 연결됨":"미연결"}
                    </span>
                    <button className="btn btn-secondary btn-sm" onClick={()=>handleConnect(a)} disabled={!!connId||!botOnline}>
                      {connId===a.id?<><span className="spinner spinner-white"/>연결 중...</>:a.is_connected?"재연결":"연결"}
                    </button>
                    <button className="btn btn-sm" style={{background:"rgba(248,81,73,.1)",color:"var(--danger)",border:"1px solid rgba(248,81,73,.3)"}}
                      onClick={async()=>{if(!confirm("삭제할까요?"))return;await supabase.from("publy_accounts").delete().eq("id",a.id);getAccounts(ADM_UID).then(setAdmAccs);}}>
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ───── 👥 회원 관리 ───── */}
            {tab === "users" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="card" style={{padding:"14px 16px",marginBottom:14}}>
                  <input className="inp" placeholder="🔍 이름, 이메일, 연락처 검색..." value={search} onChange={e=>setSearch(e.target.value)}/>
                </div>
                {loading ? (
                  <div style={{textAlign:"center",padding:40,color:"var(--text2)"}}>
                    <span className="spinner spinner-white" style={{width:24,height:24,borderTopColor:"var(--text2)"}}/>
                    <div style={{marginTop:12}}>회원 정보 불러오는 중...</div>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="empty"><div className="empty-ico">👥</div><div className="empty-title">회원이 없어요</div></div>
                ) : (
                  <div className="user-table">
                    {filteredUsers.map((u,i) => (
                      <div key={u.id}>
                        <div className={`user-row ${selUser?.id===u.id?"selected-row":""}`} onClick={()=>setSelUser(selUser?.id===u.id?null:u)} style={{animationDelay:`${i*.03}s`}}>
                          <div className="user-avatar">{(u.name||u.email)[0].toUpperCase()}</div>
                          <div className="user-info">
                            <div className="user-name-row">
                              {u.name||"이름없음"}
                              <span className={`plan-chip plan-${u.plan}`}>{PLAN_LABELS[u.plan]||u.plan}</span>
                              {!u.is_active&&<span className="inactive-chip">비활성</span>}
                            </div>
                            <div className="user-email-row">{u.email}</div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div className="quota-mini">{u.quota?.remaining_quota??0}/{u.quota?.total_quota??0}</div>
                            <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>발행 {u.history_count??0}건</div>
                          </div>
                          <span style={{fontSize:16,color:"var(--text3)"}}>{selUser?.id===u.id?"▲":"▼"}</span>
                        </div>

                        {selUser?.id === u.id && (
                          <div className="detail-panel" style={{borderRadius:0,borderTop:"none",margin:0}}>
                            <div className="detail-header">
                              <div className="user-avatar" style={{width:44,height:44,fontSize:18}}>{(u.name||u.email)[0].toUpperCase()}</div>
                              <div>
                                <div style={{fontSize:16,fontWeight:800}}>{u.name||"이름없음"}</div>
                                <div style={{fontSize:12,color:"var(--text2)",fontFamily:"monospace"}}>{u.email}</div>
                              </div>
                              <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>
                                <button className="btn btn-secondary btn-sm" onClick={()=>toggleActive(u)}>{u.is_active?"비활성화":"활성화"}</button>
                                <button className="btn btn-secondary btn-sm" onClick={()=>resetQuota(u.id)}>건수 초기화</button>
                                <button className="btn btn-primary btn-sm" onClick={()=>saveUser(u)} disabled={saving===u.id}>{saving===u.id?<><span className="spinner"/>저장 중...</>:"💾 저장"}</button>
                              </div>
                            </div>

                            <div className="detail-grid">
                              <div className="detail-field"><span className="field-label">플랜</span>
                                <select className="field-inp" value={editMap[u.id]?.plan??u.plan} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],plan:e.target.value}}))}>
                                  <option value="free">FREE (10건)</option><option value="basic">BASIC (50건)</option><option value="pro">PRO (무제한)</option>
                                </select>
                              </div>
                              <div className="detail-field"><span className="field-label">총 발행 건수</span>
                                <input className="field-inp" type="number" value={editMap[u.id]?.quota??u.quota?.total_quota??10} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],quota:e.target.value}}))}/>
                              </div>
                              <div className="detail-field"><span className="field-label">만료일 연장 (일)</span>
                                <input className="field-inp" type="number" placeholder="예: 30" value={editMap[u.id]?.days??""} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],days:e.target.value}}))}/>
                              </div>
                              <div className="detail-field"><span className="field-label">연락처</span>
                                <input className="field-inp" value={editMap[u.id]?.phone??u.phone??""} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],phone:e.target.value}}))} placeholder="010-0000-0000"/>
                              </div>
                            </div>
                            <div className="detail-field" style={{marginBottom:14}}>
                              <span className="field-label">메모</span>
                              <textarea className="field-inp" rows={2} style={{resize:"none"}} value={editMap[u.id]?.memo??u.memo??""} onChange={e=>setEditMap(p=>({...p,[u.id]:{...p[u.id],memo:e.target.value}}))} placeholder="관리자 메모..."/>
                            </div>

                            {/* 결제 내역 */}
                            <div style={{marginBottom:14}}>
                              <div className="card-title" style={{marginBottom:10}}>💳 결제 등록</div>
                              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                                <input className="field-inp" style={{flex:1,minWidth:100}} type="number" placeholder="금액" value={newPayAmt} onChange={e=>setNewPayAmt(e.target.value)}/>
                                <input className="field-inp" style={{flex:2,minWidth:140}} placeholder="메모 (선택)" value={newPayNote} onChange={e=>setNewPayNote(e.target.value)}/>
                              </div>
                              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                {(["basic","pro"] as const).map(plan=>(
                                  <button key={plan} className="btn btn-secondary btn-sm" onClick={()=>addPayment(u.id,plan)} disabled={addingPay}>
                                    {addingPay?<><span className="spinner spinner-white"/>처리 중...</>:<>{PLAN_LABELS[plan]} 등록</>}
                                  </button>
                                ))}
                              </div>
                              {(u.payments||[]).length>0&&(
                                <div style={{marginTop:10,border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
                                  {(u.payments||[]).slice(0,5).map((p:any,i:number)=>(
                                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderBottom:i<Math.min((u.payments||[]).length,5)-1?"1px solid var(--border)":"none",fontSize:12}}>
                                      <span style={{color:"var(--success)",fontWeight:700}}>{p.amount?.toLocaleString()}원</span>
                                      <span className={`plan-chip plan-${p.plan}`}>{PLAN_LABELS[p.plan]||p.plan}</span>
                                      <span style={{color:"var(--text2)",marginLeft:"auto",fontFamily:"monospace"}}>{new Date(p.created_at).toLocaleDateString("ko-KR")}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* 메모 */}
                            <div>
                              <div className="card-title" style={{marginBottom:10}}>📝 메모</div>
                              <div style={{display:"flex",gap:8,marginBottom:10}}>
                                <input className="field-inp" style={{flex:1}} placeholder="메모 추가..." value={newNote} onChange={e=>setNewNote(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote(u.id)}/>
                                <button className="btn btn-primary btn-sm" onClick={()=>addNote(u.id)}>추가</button>
                              </div>
                              {(u.notes||[]).slice(0,5).map((n:any,i:number)=>(
                                <div key={i} style={{padding:"9px 12px",borderRadius:8,background:"var(--bg)",border:"1px solid var(--border)",marginBottom:6,fontSize:13,color:"var(--text)"}}>
                                  <div style={{marginBottom:3}}>{n.content}</div>
                                  <div style={{fontSize:10,color:"var(--text3)",fontFamily:"monospace"}}>{new Date(n.created_at).toLocaleString("ko-KR")}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ───── 📊 통계 ───── */}
            {tab === "stats" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="stats-grid">
                  {[
                    {label:"전체 회원",value:users.length,sub:"가입 회원 수",color:"var(--accent-text)"},
                    {label:"활성 회원",value:users.filter(u=>u.is_active).length,sub:"현재 이용 중",color:"var(--success)"},
                    {label:"PRO 회원",value:users.filter(u=>u.plan==="pro").length,sub:"최상위 플랜",color:"var(--info)"},
                    {label:"BASIC 회원",value:users.filter(u=>u.plan==="basic").length,sub:"기본 플랜",color:"var(--warn)"},
                    {label:"FREE 회원",value:users.filter(u=>u.plan==="free").length,sub:"무료 플랜",color:"var(--text2)"},
                    {label:"총 발행 건수",value:users.reduce((s,u)=>s+(u.history_count||0),0),sub:"전체 합산",color:"var(--danger)"},
                  ].map((s,i)=>(
                    <div key={i} className="stats-card">
                      <div className="stats-num" style={{color:s.color}}>{s.value.toLocaleString()}</div>
                      <div className="stats-label">{s.label}</div>
                      <div className="stats-sub">{s.sub}</div>
                    </div>
                  ))}
                </div>

                <div className="card">
                  <div className="card-title">📋 플랜 분포</div>
                  {(["pro","basic","free"] as const).map(plan=>{
                    const cnt = users.filter(u=>u.plan===plan).length;
                    const pct = users.length>0?Math.round((cnt/users.length)*100):0;
                    return (
                      <div key={plan} style={{marginBottom:14}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                          <span style={{fontSize:13,fontWeight:600}}><span className={`plan-chip plan-${plan}`}>{PLAN_LABELS[plan]}</span></span>
                          <span style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>{cnt}명 ({pct}%)</span>
                        </div>
                        <div style={{height:8,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${pct}%`,background:plan==="pro"?"var(--info)":plan==="basic"?"var(--warn)":"var(--text3)",borderRadius:99,transition:"width .6s"}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="card">
                  <div className="card-title">🏆 발행 TOP 10</div>
                  {[...users].sort((a,b)=>(b.history_count||0)-(a.history_count||0)).slice(0,10).map((u,i)=>(
                    <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
                      <span style={{fontSize:16,fontWeight:900,color:i<3?"var(--warn)":"var(--text3)",width:24,textAlign:"center"}}>{i+1}</span>
                      <div className="user-avatar" style={{width:30,height:30,fontSize:12}}>{(u.name||u.email)[0].toUpperCase()}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{u.name||"이름없음"}</div>
                        <div style={{fontSize:11,color:"var(--text2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                      </div>
                      <span style={{fontSize:14,fontWeight:800,color:"var(--accent-text)"}}>{u.history_count||0}건</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ───── 🔐 설정 ───── */}
            {tab === "settings" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="card">
                  <div className="card-title">🤖 글쓰기 AI</div>
                  <div className="ai-grid">
                    {ADM_WRITE_AI.map(item=>(
                      <button key={item.id} className={`ai-card ${writeAI===item.id?"selected":""}`}
                        style={{borderColor:writeAI===item.id?item.color:"var(--border)",background:writeAI===item.id?`${item.color}12`:"var(--bg)"}}
                        onClick={()=>{setWriteAI(item.id);localStorage.setItem("publy_adm_write_ai",item.id);}}>
                        <div className="ai-card-top">
                          <div className="ai-logo" style={{background:writeAI===item.id?item.color:`${item.color}20`,color:writeAI===item.id?"#000":item.color}}>{item.logo}</div>
                          {writeAI===item.id?<span className="ai-sel-badge" style={{background:item.color}}>✓ 선택됨</span>:item.free?<span className="ai-free-badge">무료</span>:<span className="ai-paid-badge">유료</span>}
                        </div>
                        <div className="ai-name">{item.label}</div><div className="ai-sub">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                  <div className="card-title">🖼️ 이미지 AI</div>
                  <div className="ai-grid">
                    {ADM_IMAGE_AI.map(item=>(
                      <button key={item.id} className={`ai-card ${imageAI===item.id?"selected":""}`}
                        style={{borderColor:imageAI===item.id?item.color:"var(--border)",background:imageAI===item.id?`${item.color}12`:"var(--bg)"}}
                        onClick={()=>{setImageAI(item.id);localStorage.setItem("publy_adm_image_ai",item.id);}}>
                        <div className="ai-card-top">
                          <div className="ai-logo" style={{background:imageAI===item.id?item.color:`${item.color}20`,color:imageAI===item.id?"#000":item.color}}>{item.logo}</div>
                          {imageAI===item.id?<span className="ai-sel-badge" style={{background:item.color}}>✓ 선택됨</span>:<span className="ai-paid-badge">유료</span>}
                        </div>
                        <div className="ai-name">{item.label}</div><div className="ai-sub">{item.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">🔑 API 키 관리</div>
                  <div className="key-section" style={{background:"var(--accent-bg)",borderColor:"var(--accent-border)"}}>
                    <div className="key-section-title" style={{color:"var(--accent-text)"}}>📝 글쓰기 키</div>
                    {ADM_WRITE_AI.map(k=><AdmKeyInput key={k.id} k={k}/>)}
                  </div>
                  <div className="key-section" style={{background:"rgba(139,92,246,.07)",borderColor:"rgba(139,92,246,.2)"}}>
                    <div className="key-section-title" style={{color:"#8b5cf6"}}>🖼️ 이미지 키</div>
                    {ADM_IMAGE_AI.map(k=><AdmKeyInput key={k.id} k={k}/>)}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">🔐 관리자 비밀번호 변경</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div><label className="inp-label">새 비밀번호</label><input className="inp" type="password" value={newPw1} onChange={e=>setNewPw1(e.target.value)} placeholder="새 비밀번호 입력"/></div>
                    <div><label className="inp-label">비밀번호 확인</label><input className="inp" type="password" value={newPw2} onChange={e=>setNewPw2(e.target.value)} placeholder="비밀번호 재입력"/></div>
                    <button className="btn btn-primary" style={{alignSelf:"flex-start"}} onClick={changeAdminPw}>🔐 비밀번호 변경</button>
                    {pwMsg&&<div className={`alert ${pwMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:0}}>{pwMsg}</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 모바일 탭바 */}
        <div className="mob-tabs">
          {TABS.map(t=>(
            <button key={t.k} className={`mob-tab ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as any)}>
              <span className="mob-tab-ico">{t.i}</span>
              <span className="mob-tab-lbl">{t.l}</span>
            </button>
          ))}
        </div>

      </div>
    </>
  );
}
