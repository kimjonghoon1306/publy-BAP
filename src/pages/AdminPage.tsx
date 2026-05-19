import { useState, useEffect, useCallback } from "react";
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
function AdmKeyInput({k}:{k:any}) {
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
`;

const TABS = [
  {k:"write",    i:"✍️", l:"글 생성"},
  {k:"publish",  i:"🚀", l:"자동발행"},
  {k:"accounts", i:"🔗", l:"계정관리"},
  {k:"users",    i:"👥", l:"회원관리"},
  {k:"stats",    i:"📊", l:"통계"},
  {k:"settings", i:"🔐", l:"설정"},
] as const;

export default function AdminPage({onBack, onDashboard, theme, onThemeToggle}: Props) {
  const [tab, setTab] = useState<"write"|"publish"|"accounts"|"users"|"stats"|"settings">("write");
  const [botOnline, setBotOnline] = useState(false);
  const [platform, setPlatform] = useState<"naver"|"tistory">("naver");
  const [admAccs, setAdmAccs] = useState<PublyAccount[]>([]);

  // 발행
  const [pubTitle, setPubTitle] = useState(""); const [pubContent, setPubContent] = useState(""); const [pubTags, setPubTags] = useState(""); const [pubImg, setPubImg] = useState(""); const [pubAccId, setPubAccId] = useState(""); const [publishing, setPublishing] = useState(false); const [pubMsg, setPubMsg] = useState("");

  // 글 생성
  const [adType, setAdType] = useState<"adpost"|"adsense">("adpost");
  const [targetChars, setTargetChars] = useState(1350);
  const [imgSource, setImgSource] = useState<"ai"|"upload"|"none">("ai");
  const [imgCountManual, setImgCountManual] = useState<number|null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [keyword, setKeyword] = useState(""); const [generating, setGenerating] = useState(false);
  const [genTitle, setGenTitle] = useState(""); const [genContent, setGenContent] = useState(""); const [genTags, setGenTags] = useState(""); const [genImage, setGenImage] = useState(""); const [genImgLoading, setGenImgLoading] = useState(false);
  const [titles, setTitles] = useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_titles")||"[]");}catch{return[];}});
  const [selectedTitle, setSelectedTitle] = useState(""); const [loadingTitles, setLoadingTitles] = useState(false);

  // 계정
  const [newPlat, setNewPlat] = useState<"naver"|"tistory">("naver"); const [newUser, setNewUser] = useState(""); const [newPw, setNewPw] = useState(""); const [newBlog, setNewBlog] = useState(""); const [addingAcc, setAddingAcc] = useState(false); const [connId, setConnId] = useState<string|null>(null);

  // 회원
  const [users, setUsers] = useState<UserFull[]>([]); const [loading, setLoading] = useState(true); const [search, setSearch] = useState(""); const [selUser, setSelUser] = useState<UserFull|null>(null);
  const [editMap, setEditMap] = useState<Record<string,any>>({}); const [saving, setSaving] = useState<string|null>(null);
  const [newNote, setNewNote] = useState(""); const [newPayAmt, setNewPayAmt] = useState(""); const [newPayNote, setNewPayNote] = useState(""); const [addingPay, setAddingPay] = useState(false);

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
  const KO_EN_MAP: Record<string,string> = {
    맛집:"delicious gourmet food beautiful plating restaurant warm lighting",음식:"delicious food dish beautiful presentation",카페:"cozy cafe coffee interior warm ambient pastry",커피:"coffee latte art ceramic cup morning steam",치킨:"crispy golden fried chicken korean food plate",피자:"pizza melted cheese fresh toppings",라면:"ramen noodle bowl hot steam broth",빵:"fresh artisan bread bakery golden",디저트:"dessert sweet pastry cream fruit",
    여행:"scenic travel destination beautiful landscape golden hour",제주도:"jeju island volcanic landscape ocean cliffs",서울:"seoul city skyline namsan night view",부산:"busan haeundae beach ocean cliff",호텔:"luxury hotel room interior elegant bed",캠핑:"camping tent campfire stars nature",
    건강:"health wellness vitamins natural herbs",다이어트:"diet healthy food vegetables scale",운동:"exercise gym equipment weights fitness",피부:"skincare serum cream bottle routine",뷰티:"beauty cosmetics makeup products palette",
    재테크:"investment finance coins growth chart",주식:"stock market chart trading graph trend",코인:"cryptocurrency bitcoin gold coin digital",부동산:"real estate property house document keys",아파트:"apartment building modern exterior",
    IT:"technology digital computer code screen",AI:"artificial intelligence circuit board network",코딩:"coding programming dark screen code",
    강아지:"cute puppy dog playing toy home",고양이:"cute cat kitten indoor cozy",육아:"baby toys nursery soft colors stroller",
    패션:"fashion clothing outfit display stylish",쇼핑:"shopping retail store display bags",
  };

  function buildImagePrompt(kw: string): string {
    const k = kw.trim();
    const NP = "no people, no person, no face, no human";
    const adB = adType === "adpost" ? "Korean lifestyle blog warm emotional photography" : "ultra realistic DSLR editorial 8K magazine quality";
    const sorted = Object.keys(KO_EN_MAP).sort((a,b) => b.length - a.length);
    for (const ko of sorted) { if (k.includes(ko)) return `${KO_EN_MAP[ko]}, ${NP}, ${adB}`; }
    if (/맛집|음식|카페|요리/.test(k)) return `delicious korean food beautiful, ${NP}, ${adB}`;
    if (/여행|관광|호텔/.test(k)) return `scenic travel destination golden hour, ${NP}, ${adB}`;
    if (/건강|운동|다이어트/.test(k)) return `health fitness wellness natural, ${NP}, ${adB}`;
    return `lifestyle blog concept natural editorial photo, ${NP}, ${adB}`;
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

  async function generateImage(kw: string): Promise<string> {
    const imgPrompt = buildImagePrompt(kw);
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

  async function handleGenerateImages(count: number) {
    if (imgSource==="none"||imgSource==="upload") return;
    setGenImgLoading(true);
    const imgs: string[] = [];
    try { for (let i=0;i<count;i++) { const url=await generateImage(keyword||selectedTitle); imgs.push(url); setGeneratedImages([...imgs]); } }
    catch(e:any) { alert("이미지 생성 실패: "+e.message); }
    finally { setGenImgLoading(false); }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files; if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => { if (ev.target?.result) setUploadedImages(prev=>[...prev,ev.target!.result as string]); };
      reader.readAsDataURL(file);
    });
  }

  async function handleGenerateTitles(reset=false) {
    if (!keyword.trim()) { alert("키워드를 입력하세요"); return; }
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
    const catGuide = getCategoryGuide(keyword, title);
    const adGuide = adType==="adpost"
      ? "[수익 최적화] 네이버 애드포스트 CPM: 체류 시간 늘리는 스토리 구성"
      : "[수익 최적화] 구글 애드센스 CPC: 클릭 유도 문구, 정보성 키워드 밀도 높게";
    const prompt = `당신은 대한민국 최고의 블로그 작가입니다.

키워드: "${keyword}"
글 제목: "${title}"
목표 글자수: ${targetChars}자 이상

${catGuide}

[공통 원칙]
- AI 티 절대 금지
- 독자에게 말 걸기: "혹시 이런 거 고민해보셨나요?"
- 막연한 표현 금지 → 구체적 수치, 가격, 기간으로
- 반드시 ${targetChars}자 이상
- ⚠️ 별표(*) 절대 금지
- 소제목은 반드시 ## 소제목 형식으로 (4~6개)
- ⚠️ 대시(-) 목록 절대 금지
- SEO: 키워드 자연스럽게 7회 이상

${adGuide}

[형식]
태그: 태그1, 태그2, 태그3, 태그4, 태그5

(본문)

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
      if (imgSource === "ai" && recCount > 0) {
        setGenImgLoading(true); setGeneratedImages([]);
        const imgs: string[] = [];
        try { for (let i=0;i<recCount;i++) { const url=await generateImage(keyword||selectedTitle); imgs.push(url); setGeneratedImages([...imgs]); } }
        catch(e:any) { alert("이미지 생성 실패: "+e.message); }
        finally { setGenImgLoading(false); }
      }
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
            <button className="back-btn" onClick={onDashboard}>← 회원 화면</button>
            <button className="back-btn" style={{borderColor:"rgba(248,81,73,.3)",color:"var(--danger)"}} onClick={onBack}>로그아웃</button>
          </div>
        </div>

        <div className="layout">
          {/* 사이드바 */}
          <div className="sidebar">
            <div className="nav-section">관리자 메뉴</div>
            {TABS.map(t => (
              <button key={t.k} className={`nav-item ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as any)}>
                <span className="nav-ico">{t.i}</span>
                {t.l}
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
            {tab === "write" && (
              <div style={{animation:"fadeUp .25s ease both"}}>
                <div className="steps">
                  {[{n:"1",t:"키워드"},{n:"2",t:"제목 선택"},{n:"3",t:"글 생성"},{n:"4",t:"발행"}].map((s,i)=>(
                    <div key={i} className={`step ${writeStep>i?"done":writeStep===i?"active":""}`}>
                      <span className="step-num">STEP {s.n}</span>{writeStep>i?"✓ ":""}{s.t}
                    </div>
                  ))}
                </div>

                <div className="card">
                  <div className="card-title">🎯 수익화 목적</div>
                  <div className="adtype-grid">
                    {([{id:"adpost",label:"📰 네이버 애드포스트",sub:"감성적·경험 공유형, 1200~1500자",cls:"adpost-sel"},{id:"adsense",label:"🔍 구글 애드센스",sub:"정보성·SEO 최적화, 1500자+",cls:"adsense-sel"}] as const).map(t=>(
                      <button key={t.id} className={`adtype-btn ${adType===t.id?t.cls:""}`} onClick={()=>setAdType(t.id)}>
                        <div className="adtype-label">{t.label}</div><div className="adtype-sub">{t.sub}</div>
                      </button>
                    ))}
                  </div>
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
                    {titles.length>0&&<button className="btn btn-secondary" onClick={()=>handleGenerateTitles(false)} disabled={loadingTitles}>{titles.length>=90?"🔄 초기화 후 재생성":"➕ 30개 추가"}</button>}
                    {titles.length>0&&<button className="btn btn-sm" style={{background:"rgba(248,81,73,.1)",color:"var(--danger)",border:"1px solid rgba(248,81,73,.3)"}} onClick={()=>{setTitles([]);setSelectedTitle("");localStorage.removeItem("publy_adm_titles");}}>🗑 초기화</button>}
                  </div>
                  {titles.length>0&&(
                    <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1,height:4,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${(titles.length/90)*100}%`,background:titles.length>=90?"var(--danger)":"var(--accent)",borderRadius:99,transition:"width .4s"}}/>
                      </div>
                      <span style={{fontSize:11,color:titles.length>=90?"var(--danger)":"var(--text2)",fontFamily:"monospace"}}>{titles.length}/90</span>
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

                {(selectedTitle||keyword)&&(
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
                    {selectedTitle&&<div style={{padding:"12px 15px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--border)",marginBottom:14,fontSize:14}}>📌 선택 제목: <strong style={{color:"var(--accent-text)"}}>{selectedTitle}</strong></div>}
                    <button className="btn btn-primary btn-full btn-xl" onClick={handleGenerate} disabled={generating}>
                      {generating?<><span className="spinner"/>AI 작성 중...</>:<>✍️ 본문 + 이미지 생성</>}
                    </button>
                  </div>
                )}

                {genContent&&(
                  <>
                    {showPreview&&(
                      <div className="preview-modal" onClick={()=>setShowPreview(false)}>
                        <div className="preview-inner" onClick={e=>e.stopPropagation()}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                            <span style={{fontSize:13,color:"#888",fontWeight:700}}>📱 미리보기</span>
                            <button style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#888"}} onClick={()=>setShowPreview(false)}>✕</button>
                          </div>
                          <div style={{fontFamily:"'Apple SD Gothic Neo','Malgun Gothic',sans-serif"}}>
                            <h1 style={{fontSize:22,fontWeight:700,color:"#191919",lineHeight:1.4,marginBottom:14}}>{genTitle}</h1>
                            {genTags&&<div style={{marginBottom:16,display:"flex",flexWrap:"wrap",gap:5}}>{genTags.split(",").map((t,i)=><span key={i} style={{fontSize:12,padding:"3px 10px",borderRadius:99,background:"#f1f3f5",color:"#495057"}}>#{t.trim()}</span>)}</div>}
                            {getActiveImages()[0]&&<img src={getActiveImages()[0]} alt="" style={{width:"100%",maxHeight:280,objectFit:"cover",borderRadius:10,marginBottom:18}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>}
                            {splitContentWithImages(genContent,getActiveImages().slice(1)).map((s,i)=>(
                              <div key={i}>{s.img?<img src={s.img} alt="" style={{width:"100%",maxHeight:240,objectFit:"cover",borderRadius:8,margin:"14px 0"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>:<div style={{fontSize:15,color:"#333",lineHeight:1.9,whiteSpace:"pre-wrap",marginBottom:8}}>{s.text}</div>}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="card">
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                        <div className="card-title" style={{marginBottom:0}}>🎨 생성 결과</div>
                        <div style={{display:"flex",gap:7,alignItems:"center"}}>
                          <span className="char-badge">{genContent.length.toLocaleString()}자</span>
                          <button className="preview-btn" onClick={()=>setShowPreview(true)}>👁️ 미리보기</button>
                        </div>
                      </div>
                      {imgSource!=="none"&&(
                        <div style={{marginBottom:14,padding:"12px 16px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--border)"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <label style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>🖼️ 이미지 수량</label>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:14,fontWeight:800,color:"var(--accent-text)"}}>{imgCountManual??recommendImageCount(genContent)}장</span>
                              {imgCountManual!==null&&<button className="btn-ghost btn-sm" style={{padding:"3px 9px",fontSize:11}} onClick={()=>setImgCountManual(null)}>자동</button>}
                            </div>
                          </div>
                          <input type="range" min={0} max={20} step={1} value={imgCountManual??recommendImageCount(genContent)} onChange={e=>setImgCountManual(Number(e.target.value))} style={{width:"100%",accentColor:"var(--accent)",height:6,cursor:"pointer"}}/>
                          {imgSource==="ai"&&<button className="btn btn-secondary btn-sm" style={{marginTop:8}} onClick={()=>handleGenerateImages(imgCountManual??recommendImageCount(genContent))} disabled={genImgLoading}>{genImgLoading?<><span className="spinner spinner-white"/>생성 중...</>:"🔄 이미지 재생성"}</button>}
                        </div>
                      )}
                      {getActiveImages().length>0&&(
                        <div style={{marginBottom:14}}>
                          <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:8}}>🖼️ 이미지 {getActiveImages().length}장 <span style={{fontWeight:400,color:"var(--text3)"}}>— 첫 번째가 썸네일</span></div>
                          {genImgLoading&&<div style={{fontSize:12,color:"var(--accent-text)",marginBottom:8,animation:"pulse 1s infinite"}}>⏳ 이미지 생성 중...</div>}
                          <div className="img-grid">{getActiveImages().map((img,i)=>(<div key={i} className="img-thumb-wrap"><img src={img} alt="" className={`img-thumb ${i===0?"thumb-first":""}`} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>{i===0&&<span className="img-thumb-badge">썸네일</span>}<button className="img-thumb-del" onClick={()=>{if(imgSource==="ai")setGeneratedImages(prev=>prev.filter((_,j)=>j!==i));else setUploadedImages(prev=>prev.filter((_,j)=>j!==i));}}>✕</button></div>))}</div>
                        </div>
                      )}
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
                    <button className="btn btn-primary btn-full btn-xl" style={{marginBottom:20}}
                      onClick={()=>{setPubTitle(genTitle);setPubContent(genContent);setPubTags(genTags);setPubImg(getActiveImages()[0]||"");setTab("publish");}}>
                      🚀 발행하기로 이동
                    </button>
                  </>
                )}
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
