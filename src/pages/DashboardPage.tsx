import { useState, useEffect, useCallback, useRef } from "react";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount, upsertAccount, useQuota, addHistory, signIn } from "../lib/supabase";
import { supabase } from "../lib/supabase";

type Tab = "publish" | "write" | "accounts" | "history" | "settings";
const BOT = "http://localhost:3333";
const MAX_TITLES = 90;
const BATCH = 30;

// ── AI 설정 ──────────────────────────────────────────────
const WRITE_AI_LIST = [
  { id:"gemini",  label:"Gemini Flash", sub:"Google AI · 무료", placeholder:"AIza...", storageKey:"publy_gemini_key",   link:"https://aistudio.google.com/app/apikey", color:"#4285F4", logo:"G", free:true  },
  { id:"groq",    label:"Groq Llama 3", sub:"초고속 · 완전 무료", placeholder:"gsk_...", storageKey:"publy_groq_key",    link:"https://console.groq.com/keys",           color:"#F55036", logo:"L", free:true  },
  { id:"openai",  label:"GPT-4o mini",  sub:"OpenAI · 강력",    placeholder:"sk-...",  storageKey:"publy_openai_key",  link:"https://platform.openai.com/api-keys",    color:"#10A37F", logo:"O", free:false },
];
const IMAGE_AI_LIST = [
  { id:"openai_img", label:"DALL-E 3",       sub:"OpenAI · 고품질",  placeholder:"sk-...", storageKey:"publy_openai_key",   link:"https://platform.openai.com/api-keys",         color:"#10A37F", logo:"O" },
  { id:"replicate",  label:"Flux (Replicate)",sub:"고품질 이미지",    placeholder:"r8_...", storageKey:"publy_replicate_key", link:"https://replicate.com/account/api-tokens",     color:"#8B5CF6", logo:"R" },
];

// ── AI 호출 ──────────────────────────────────────────────
async function callWriteAI(prompt: string): Promise<string> {
  const ai = localStorage.getItem("publy_write_ai") || "gemini";
  if (ai === "gemini") {
    const key = localStorage.getItem("publy_gemini_key") || "";
    if (!key) throw new Error("Gemini API 키가 없습니다. 설정에서 등록하세요.");
    for (const model of ["gemini-2.0-flash","gemini-2.0-flash-lite","gemini-2.5-flash"]) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:4000}}),signal:AbortSignal.timeout(30000)});
      if (!r.ok) continue;
      const d = await r.json();
      const t = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (t) return t;
    }
    throw new Error("Gemini 생성 실패");
  }
  if (ai === "groq") {
    const key = localStorage.getItem("publy_groq_key") || "";
    if (!key) throw new Error("Groq API 키가 없습니다. 설정에서 등록하세요.");
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.1-70b-versatile",max_tokens:4000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(30000)});
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message||"Groq 오류"); }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || "";
  }
  if (ai === "openai") {
    const key = localStorage.getItem("publy_openai_key") || "";
    if (!key) throw new Error("OpenAI API 키가 없습니다. 설정에서 등록하세요.");
    const r = await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o-mini",max_tokens:4000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(30000)});
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message||"OpenAI 오류"); }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || "";
  }
  throw new Error("AI가 선택되지 않았습니다");
}

async function callImageAI(prompt: string): Promise<string> {
  const ai = localStorage.getItem("publy_image_ai") || "openai_img";
  if (ai === "openai_img") {
    const key = localStorage.getItem("publy_openai_key") || "";
    if (!key) throw new Error("OpenAI API 키가 없습니다. 설정에서 등록하세요.");
    const r = await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"dall-e-3",prompt,n:1,size:"1024x1024"}),signal:AbortSignal.timeout(60000)});
    if (!r.ok) { const e = await r.json(); throw new Error("DALL-E 오류: "+(e.error?.message||r.status)); }
    const d = await r.json();
    return d.data?.[0]?.url || "";
  }
  if (ai === "replicate") {
    const key = localStorage.getItem("publy_replicate_key") || "";
    if (!key) throw new Error("Replicate API 키가 없습니다. 설정에서 등록하세요.");
    const pr = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({input:{prompt,num_outputs:1,aspect_ratio:"16:9"}}),signal:AbortSignal.timeout(30000)});
    if (!pr.ok) { const e = await pr.json(); throw new Error("Replicate 오류: "+(e.detail||pr.status)); }
    const pred = await pr.json();
    const pollUrl = pred.urls?.get;
    if (!pollUrl) throw new Error("Replicate 응답 오류");
    for (let i=0;i<30;i++) {
      await new Promise(r=>setTimeout(r,2000));
      const res = await fetch(pollUrl,{headers:{"Authorization":`Bearer ${key}`}});
      const data = await res.json();
      if (data.status==="succeeded") return data.output?.[0]||"";
      if (data.status==="failed") throw new Error("Replicate 이미지 생성 실패");
    }
    throw new Error("Replicate 타임아웃");
  }
  throw new Error("이미지 AI가 선택되지 않았습니다");
}

function parseTitles(text: string): string[] {
  const clean = text.replace(/```json|```/gi,"").trim();
  try { const m = clean.match(/\[[\s\S]*\]/); if(m){const p=JSON.parse(m[0]);if(Array.isArray(p))return p.map(String).filter(t=>t.length>3);} } catch {}
  try { const p=JSON.parse(clean); if(Array.isArray(p))return p.map(String).filter(t=>t.length>3); } catch {}
  return clean.split("\n").map(l=>l.replace(/^[\d]+[).\s]+|^[-*•\s]+/,"").replace(/^[\s"']+|[\s"']+$/g,"").trim()).filter(l=>l.length>4&&l.length<100);
}

// ── SVG 아이콘들 ─────────────────────────────────────────
const Icons = {
  rocket: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>,
  write: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  link: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  history: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  star: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  refresh: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  image: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  eye: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  key: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="17" r="4"/><path d="m18 2-9.68 9.68"/><path d="m15 5 4 4"/></svg>,
  sun: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  moon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  mobile: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
};

// ── CSS ──────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Pretendard:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(0,255,136,.4)}50%{box-shadow:0 0 0 10px rgba(0,255,136,0)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes popIn{0%{transform:scale(.85);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes slideRight{from{transform:translateX(-12px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes barFill{from{width:0}to{width:var(--w)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes titlePop{0%{transform:scale(.9) translateY(8px);opacity:0}60%{transform:scale(1.03)}100%{transform:scale(1) translateY(0);opacity:1}}

.dash.dark{--bg:#01030a;--bg2:#050810;--card:rgba(255,255,255,.04);--card2:rgba(255,255,255,.07);--border:rgba(255,255,255,.08);--border2:rgba(0,255,136,.2);--text:#eef4ff;--sub:#94a3b8;--accent:#00ff88;--accent2:#00cc66;--adim:rgba(0,255,136,.1);--err:#ff6b6b;--warn:#f59e0b;--info:#4285F4;}
.dash.light{--bg:#f0f9f4;--bg2:#e8f5ee;--card:rgba(255,255,255,.9);--card2:#fff;--border:rgba(0,0,0,.08);--border2:rgba(0,160,70,.25);--text:#09180f;--sub:#64748b;--accent:#00a855;--accent2:#008040;--adim:rgba(0,168,85,.1);--err:#dc2626;--warn:#d97706;--info:#2563eb;}

.dash{width:100vw;height:100vh;overflow:hidden;display:flex;flex-direction:column;font-family:'Pretendard',-apple-system,sans-serif;color:var(--text);background:var(--bg);}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px}

/* 헤더 */
.hd{height:60px;flex-shrink:0;display:flex;align-items:center;padding:0 20px;gap:14px;background:var(--bg);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);position:sticky;top:0;z-index:50;}
.hd-logo{display:flex;align-items:center;gap:9px;flex-shrink:0;}
.hd-logo-ico{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px var(--adim);animation:float 4s ease-in-out infinite;}
.hd-logo-text{font-size:20px;font-weight:900;letter-spacing:.2em;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.hd-center{flex:1;display:flex;align-items:center;gap:10px;}
.status-chip{display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid;}
.status-on{border-color:rgba(0,255,136,.3);background:rgba(0,255,136,.08);color:var(--accent);}
.status-off{border-color:var(--border);background:var(--card);color:var(--sub);}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.dot-on{background:var(--accent);animation:pulse 2s infinite;}
.dot-off{background:#555;}
.quota-bar-bg{width:90px;height:6px;border-radius:99px;background:var(--border);overflow:hidden;}
.quota-bar{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent2));animation:barFill .8s ease both;}
.plan-chip{font-size:10px;font-weight:800;padding:3px 10px;border-radius:99px;letter-spacing:.1em;}
.plan-free{background:rgba(120,120,120,.15);color:#999;border:1px solid rgba(120,120,120,.2);}
.plan-basic{background:rgba(66,133,244,.15);color:#4285F4;border:1px solid rgba(66,133,244,.25);}
.plan-pro{background:var(--adim);color:var(--accent);border:1px solid rgba(0,255,136,.3);animation:glow 2.5s infinite;}
.hd-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.ico-btn{width:38px;height:38px;border-radius:12px;border:1px solid var(--border);background:var(--card);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--sub);transition:all .18s;}
.ico-btn:hover{border-color:var(--border2);color:var(--text);transform:scale(1.07);}
.user-chip{display:flex;align-items:center;gap:8px;padding:5px 13px 5px 6px;border-radius:99px;border:1px solid var(--border);background:var(--card);font-size:12px;font-weight:600;color:var(--text);}
.avatar{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#000;}
.logout-btn{padding:7px 14px;border-radius:11px;border:1px solid var(--border);background:transparent;color:var(--sub);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .18s;}
.logout-btn:hover{color:var(--err);border-color:var(--err);}

/* 바디 */
.body{flex:1;display:flex;overflow:hidden;}

/* 사이드바 */
.sidebar{width:220px;flex-shrink:0;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:14px 10px;gap:3px;overflow-y:auto;}
.nav-label{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--sub);padding:10px 10px 5px;}
.nav-btn{display:flex;align-items:center;gap:11px;padding:12px 13px;border-radius:13px;border:none;cursor:pointer;width:100%;font-size:13px;font-weight:500;font-family:inherit;color:var(--sub);background:transparent;transition:all .18s;text-align:left;position:relative;line-height:1;}
.nav-btn:hover{background:var(--card2);color:var(--text);}
.nav-btn.active{background:var(--adim);color:var(--accent);font-weight:700;border:1px solid var(--border2);}
.nav-btn.active::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:3px;border-radius:99px;background:var(--accent);}
.nav-ico{flex-shrink:0;opacity:.7;}
.nav-btn.active .nav-ico{opacity:1;}
.nav-badge{margin-left:auto;font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;background:var(--adim);color:var(--accent);}
.sidebar-footer{margin-top:auto;padding-top:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;}
.today-card{padding:12px 14px;border-radius:13px;background:var(--card);border:1px solid var(--border);text-align:center;}
.today-num{font-size:32px;font-weight:900;color:var(--accent);line-height:1;}
.today-label{font-size:10px;color:var(--sub);margin-top:2px;}

/* 메인 */
.main{flex:1;display:flex;overflow:hidden;}
.center{flex:1;overflow-y:auto;padding:22px;display:flex;flex-direction:column;gap:16px;}
.right-panel{width:280px;flex-shrink:0;border-left:1px solid var(--border);background:var(--bg2);overflow-y:auto;display:flex;flex-direction:column;}
.rp-section{padding:18px;border-bottom:1px solid var(--border);}
.rp-title{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);margin-bottom:12px;}

/* 카드 */
.card{background:var(--card);border:1px solid var(--border);border-radius:18px;position:relative;overflow:hidden;transition:border-color .2s;}
.card::before{content:'';position:absolute;top:0;left:15%;right:15%;height:1px;background:linear-gradient(90deg,transparent,var(--border2),transparent);}
.card:hover{border-color:rgba(0,255,136,.15);}
.section-label{font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--sub);margin-bottom:12px;display:flex;align-items:center;gap:7px;}

/* 입력 */
.inp{width:100%;padding:13px 15px;background:var(--bg);border:1.5px solid var(--border);border-radius:13px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:all .2s;}
.inp:focus{border-color:rgba(0,255,136,.5);box-shadow:0 0 0 3px rgba(0,255,136,.07);}
.inp::placeholder{color:var(--sub);}
textarea.inp{resize:vertical;line-height:1.7;}
select.inp{appearance:auto;}
.dark select.inp{color-scheme:dark;}
.light select.inp{color-scheme:light;}

/* 버튼 */
.btn-main{padding:13px 22px;border:none;border-radius:13px;cursor:pointer;font-family:inherit;font-weight:700;font-size:14px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#000;display:inline-flex;align-items:center;gap:8px;transition:all .22s;position:relative;overflow:hidden;}
.btn-main:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(0,255,136,.3);}
.btn-main:disabled{opacity:.35;cursor:not-allowed;transform:none;}
.btn-main::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);background-size:200% 100%;animation:shimmer 3s ease-in-out infinite;}
.btn-sec{padding:11px 18px;border:1.5px solid var(--border);border-radius:13px;cursor:pointer;font-family:inherit;font-weight:600;font-size:13px;background:var(--card);color:var(--sub);display:inline-flex;align-items:center;gap:7px;transition:all .18s;}
.btn-sec:hover{border-color:var(--border2);color:var(--text);}
.btn-sec:disabled{opacity:.35;cursor:not-allowed;}
.btn-danger{padding:8px 14px;border:1.5px solid rgba(255,107,107,.25);border-radius:10px;cursor:pointer;font-family:inherit;font-weight:600;font-size:12px;background:rgba(255,107,107,.07);color:var(--err);display:inline-flex;align-items:center;gap:6px;transition:all .18s;}
.btn-danger:hover{background:rgba(255,107,107,.15);}

/* 스피너 */
.spinner{width:16px;height:16px;border-radius:50%;border:2.5px solid rgba(0,0,0,.2);border-top-color:#000;animation:spin 1s linear infinite;display:inline-block;flex-shrink:0;}
.spinner-wh{width:16px;height:16px;border-radius:50%;border:2.5px solid rgba(255,255,255,.2);border-top-color:#fff;animation:spin 1s linear infinite;display:inline-block;flex-shrink:0;}
.spinner-g{width:18px;height:18px;border-radius:50%;border:2.5px solid var(--adim);border-top-color:var(--accent);animation:spin 1s linear infinite;display:inline-block;flex-shrink:0;}

/* 플랫폼 버튼 */
.plat-btn{flex:1;padding:16px 14px;border-radius:15px;border:1.5px solid var(--border);cursor:pointer;background:var(--card);display:flex;align-items:center;gap:12px;transition:all .22s;font-family:inherit;}
.plat-btn:hover{transform:translateY(-2px);}
.plat-naver{border-color:#03C75A;background:rgba(3,199,90,.07);animation:glow 3s infinite;}
.plat-tistory{border-color:#FF6B35;background:rgba(255,107,53,.07);}

/* 제목 카드 그리드 */
.title-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;}
.title-card{padding:14px 16px;border-radius:14px;border:1.5px solid var(--border);background:var(--card);cursor:pointer;transition:all .2s;text-align:left;font-family:inherit;animation:titlePop .3s ease both;position:relative;overflow:hidden;}
.title-card:hover{border-color:var(--border2);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.12);}
.title-card.selected{border-color:var(--accent);background:var(--adim);box-shadow:0 0 0 1px var(--accent),0 8px 24px rgba(0,255,136,.15);}
.title-card .num{font-size:10px;font-weight:700;color:var(--sub);margin-bottom:5px;font-family:'JetBrains Mono',monospace;}
.title-card.selected .num{color:var(--accent);}
.title-card .txt{font-size:13px;font-weight:600;color:var(--text);line-height:1.5;}
.title-card .check-ico{position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;animation:popIn .25s ease both;}

/* 스텝 인디케이터 */
.steps{display:flex;align-items:center;gap:0;margin-bottom:20px;}
.step{display:flex;align-items:center;gap:0;flex:1;}
.step-circle{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;border:2px solid var(--border);background:var(--bg);color:var(--sub);transition:all .3s;}
.step-circle.done{background:var(--accent);border-color:var(--accent);color:#000;}
.step-circle.active{border-color:var(--accent);color:var(--accent);box-shadow:0 0 0 4px rgba(0,255,136,.15);}
.step-line{flex:1;height:2px;background:var(--border);transition:background .3s;}
.step-line.done{background:var(--accent);}
.step-label{font-size:10px;font-weight:600;color:var(--sub);margin-top:5px;text-align:center;white-space:nowrap;}
.step-label.active{color:var(--accent);}
.step-label.done{color:var(--accent2);}

/* 히스토리 */
.hist-item{display:flex;align-items:center;gap:10px;padding:13px 15px;border-radius:14px;border:1px solid var(--border);background:var(--card);margin-bottom:8px;transition:all .15s;animation:fadeUp .3s ease both;}
.hist-item:hover{border-color:var(--border2);}
.badge{font-size:9px;font-weight:800;padding:3px 9px;border-radius:99px;flex-shrink:0;}
.badge-ok{background:rgba(0,255,136,.12);color:var(--accent);}
.badge-fail{background:rgba(255,107,107,.12);color:var(--err);}
.badge-pend{background:rgba(245,158,11,.12);color:var(--warn);}

/* 경고 박스 */
.warn-box{padding:12px 15px;border-radius:13px;font-size:13px;display:flex;align-items:center;gap:9px;margin-bottom:12px;}
.warn-yellow{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);color:var(--warn);}
.warn-red{background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.2);color:var(--err);}
.warn-blue{background:rgba(66,133,244,.08);border:1px solid rgba(66,133,244,.2);color:var(--info);}

/* 이미지 스켈레톤 */
.img-skeleton{width:100%;height:200px;border-radius:13px;background:linear-gradient(90deg,var(--card) 25%,var(--card2) 50%,var(--card) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;}

/* 계정 카드 */
.acc-card{padding:16px 20px;border-radius:16px;border:1.5px solid var(--border);background:var(--card);display:flex;align-items:center;gap:13px;flex-wrap:wrap;transition:all .2s;animation:fadeUp .3s ease both;}
.acc-card:hover{border-color:var(--border2);}

/* API 키 */
.key-card{padding:16px;border-radius:14px;border:1px solid var(--border);background:var(--bg);margin-bottom:9px;transition:border-color .2s;}
.key-card.has-key{border-color:rgba(0,255,136,.2);}

/* 모바일 탭바 */
.mob-bar{display:none;position:fixed;bottom:0;left:0;right:0;background:var(--bg2);border-top:1px solid var(--border);backdrop-filter:blur(24px);padding:8px 8px 20px;gap:2px;z-index:100;}
.mob-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;border-radius:12px;border:none;cursor:pointer;background:transparent;transition:all .18s;font-family:inherit;color:var(--sub);}
.mob-btn.active{background:var(--adim);color:var(--accent);}
.mob-icon{font-size:20px;}
.mob-label{font-size:9px;font-weight:600;}

/* 반응형 */
@media(max-width:900px){.right-panel{display:none;}}
@media(max-width:700px){
  .sidebar{display:none;}
  .mob-bar{display:flex;}
  .center{padding:16px 14px 90px;}
  .title-grid{grid-template-columns:1fr;}
  .hd{padding:0 14px;}
  .hd-logo-text{font-size:17px;}
  .status-chip span:last-child{display:none;}
}
@media(min-width:701px){.mob-bar{display:none!important;}}
`;

// ── API 키 입력 컴포넌트 ─────────────────────────────────
function KeyInput({ k }: { k: any }) {
  const [val, setVal] = useState(() => localStorage.getItem(k.storageKey) || "");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");

  function save() {
    if (!val.trim()) { setMsg("키를 입력하세요"); return; }
    localStorage.setItem(k.storageKey, val.trim());
    setSaved(true); setMsg("✅ 저장됨");
    setTimeout(() => { setSaved(false); setMsg(""); }, 3000);
  }

  async function test() {
    if (!val.trim()) { setMsg("키 입력 필요"); return; }
    setTesting(true); setMsg("");
    try {
      if (k.id === "gemini") {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${val.trim()}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 5 } }), signal: AbortSignal.timeout(8000) });
        setMsg(r.ok ? "✅ 연결 성공" : "❌ 키 오류");
      } else if (k.id === "groq") {
        const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${val.trim()}` }, signal: AbortSignal.timeout(8000) });
        setMsg(r.ok ? "✅ 연결 성공" : "❌ 연결 실패");
      } else if (k.id === "openai" || k.id === "openai_img") {
        const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${val.trim()}` }, signal: AbortSignal.timeout(8000) });
        setMsg(r.ok ? "✅ 연결 성공" : "❌ 연결 실패");
      } else { setMsg("저장 후 실제 생성으로 테스트"); }
    } catch (e: any) { setMsg("❌ " + e.message); }
    finally { setTesting(false); }
  }

  return (
    <div className={`key-card ${val ? "has-key" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: k.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: "#000" }}>{k.logo}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{k.label}</div>
            <div style={{ fontSize: 10, color: "var(--sub)" }}>{k.sub}</div>
          </div>
          {val && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: "var(--adim)", color: "var(--accent)" }}>✓ 입력됨</span>}
        </div>
        <a href={k.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: k.color, textDecoration: "none", padding: "4px 10px", borderRadius: 8, border: `1px solid ${k.color}30`, background: `${k.color}10` }}>🔗 발급</a>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 7 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input type={show ? "text" : "password"} placeholder={k.placeholder} value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && save()}
            style={{ width: "100%", padding: "10px 36px 10px 12px", borderRadius: 10, border: `1.5px solid ${val ? "rgba(0,255,136,.3)" : "var(--border)"}`, background: "var(--bg)", color: "var(--text)", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", outline: "none" }} />
          <button onClick={() => setShow(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--sub)", fontSize: 14 }}>{show ? "🙈" : "👁️"}</button>
        </div>
        <button onClick={save} style={{ padding: "10px 16px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 11, fontFamily: "inherit", background: saved ? "var(--accent)" : "var(--adim)", color: saved ? "#000" : "var(--accent)", flexShrink: 0 }}>
          {saved ? "✅" : "저장"}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={test} disabled={testing} className="btn-sec" style={{ padding: "5px 12px", fontSize: 11 }}>
          {testing && <span className="spinner-g" />} 🔌 테스트
        </button>
        {msg && <span style={{ fontSize: 11, color: msg.includes("✅") ? "var(--accent)" : "var(--err)" }}>{msg}</span>}
      </div>
    </div>
  );
}

// ── AI 선택 카드 ─────────────────────────────────────────
function AICard({ item, selected, onClick }: { item: any; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ flex: 1, padding: "14px 12px", borderRadius: 15, cursor: "pointer", fontFamily: "inherit", textAlign: "left", border: `2px solid ${selected ? item.color : "var(--border)"}`, background: selected ? `${item.color}12` : "var(--card)", transform: selected ? "translateY(-3px) scale(1.02)" : "none", boxShadow: selected ? `0 10px 28px ${item.color}25` : "none", transition: "all .18s", position: "relative", overflow: "hidden" }}>
      {selected && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${item.color},transparent)` }} />}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: selected ? item.color : `${item.color}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: selected ? "#000" : item.color }}>{item.logo}</div>
        {selected ? <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: item.color, color: "#000" }}>✓ 선택됨</span>
          : <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: item.free ? "rgba(0,200,117,.15)" : "rgba(245,158,11,.15)", color: item.free ? "#00c875" : "#f59e0b" }}>{item.free ? "무료" : "유료"}</span>}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: selected ? item.color : "var(--text)" }}>{item.label}</div>
      <div style={{ fontSize: 10, color: "var(--sub)", marginTop: 2 }}>{item.sub}</div>
    </button>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────
interface Props { user: PublyUser; onLogout: () => void; onAdminLogin: () => void; theme: "dark" | "light"; onThemeToggle: () => void; }
const TABS = [
  { key: "publish", label: "발행하기", icon: Icons.rocket },
  { key: "write",   label: "글 생성",  icon: Icons.write  },
  { key: "accounts",label: "계정 관리",icon: Icons.link   },
  { key: "history", label: "발행 기록",icon: Icons.history },
  { key: "settings",label: "설정",     icon: Icons.settings},
] as const;
const PLAN_LABELS: Record<string, string> = { free: "FREE", basic: "BASIC", pro: "PRO" };

export default function DashboardPage({ user, onLogout, onAdminLogin, theme, onThemeToggle }: Props) {
  const [tab, setTab] = useState<Tab>("publish");
  const [botOnline, setBotOnline] = useState(false);
  const [quota, setQuota] = useState<PublyQuota | null>(null);
  const [history, setHistory] = useState<PublyHistory[]>([]);
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [platform, setPlatform] = useState<"naver" | "tistory">("naver");
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 700;

  // 발행 폼
  const [pubTitle, setPubTitle] = useState("");
  const [pubContent, setPubContent] = useState("");
  const [pubTags, setPubTags] = useState("");
  const [pubImageUrl, setPubImageUrl] = useState("");
  const [pubAccId, setPubAccId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [pubMsg, setPubMsg] = useState("");

  // 글 생성 - 단계별
  const [writeStep, setWriteStep] = useState<1|2|3|4>(1);
  const [keyword, setKeyword] = useState("");
  const [titles, setTitles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("publy_titles") || "[]"); } catch { return []; }
  });
  const [selectedTitle, setSelectedTitle] = useState("");
  const [genTitle, setGenTitle] = useState("");
  const [genContent, setGenContent] = useState("");
  const [genTags, setGenTags] = useState("");
  const [genImage, setGenImage] = useState("");
  const [genImgLoading, setGenImgLoading] = useState(false);
  const [loadingTitles, setLoadingTitles] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState("");

  // 계정
  const [newPlatform, setNewPlatform] = useState<"naver" | "tistory">("naver");
  const [newUser, setNewUser] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newBlog, setNewBlog] = useState("");
  const [addingAcc, setAddingAcc] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  // 설정
  const [writeAI, setWriteAI] = useState(() => localStorage.getItem("publy_write_ai") || "gemini");
  const [imageAI, setImageAI] = useState(() => localStorage.getItem("publy_image_ai") || "openai_img");

  // 제목 localStorage 저장
  useEffect(() => {
    try { localStorage.setItem("publy_titles", JSON.stringify(titles)); } catch {}
  }, [titles]);

  const checkBot = useCallback(async () => {
    try { const r = await fetch(`${BOT}/health`, { signal: AbortSignal.timeout(3000) }); setBotOnline(r.ok); }
    catch { setBotOnline(false); }
  }, []);

  useEffect(() => {
    checkBot();
    const t = setInterval(checkBot, 10000);
    getQuota(user.id).then(q => q && setQuota(q));
    getHistory(user.id).then(setHistory);
    getAccounts(user.id).then(setAccounts);
    return () => clearInterval(t);
  }, [user.id, checkBot]);

  // ── 제목 30개 생성 ──────────────────────────────────────
  async function handleGenerateTitles(reset = false) {
    if (!keyword.trim()) { setError("키워드를 입력하세요!"); return; }
    setError("");
    if (reset) setTitles([]);
    setLoadingTitles(true);

    const prompt = `당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.
키워드: "${keyword.trim()}"
목적: 네이버 애드포스트 클릭률 극대화

조건:
- 반드시 30개 제목을 JSON 배열로만 반환 (다른 텍스트 없이)
- 키워드 "${keyword.trim()}"을 자연스럽게 포함
- 각 제목 25~45자 내외
- 호기심·궁금증 유발 (BEST N, TOP N, 실제 후기, 솔직 후기, 꿀팁 등)
- 2026년 최신 트렌드 반영
- 숫자 포함 필수 (BEST 7, TOP 5, 3가지 등)
- 클릭하고 싶게 만들기
- 광고 수익 극대화

예시: ["2026년 ${keyword.trim()} BEST 7 완벽 정리", "솔직히 ${keyword.trim()} 이것만 알면 됩니다", ...]

반드시 JSON 배열만 반환하세요.`;

    try {
      const text = await callWriteAI(prompt);
      const newTitles = parseTitles(text);
      if (!newTitles.length) throw new Error("제목을 파싱할 수 없습니다. 다시 시도해보세요.");

      setTitles(prev => {
        const combined = [...newTitles, ...prev];
        if (combined.length >= MAX_TITLES) return newTitles; // 90개 초과시 초기화
        return combined;
      });
      setWriteStep(2);
    } catch (e: any) {
      setError("제목 생성 실패: " + e.message);
    } finally {
      setLoadingTitles(false);
    }
  }

  // ── 본문 + 이미지 생성 ──────────────────────────────────
  async function handleGenerateContent() {
    if (!selectedTitle) { setError("제목을 선택하세요!"); return; }
    setError(""); setLoadingContent(true); setWriteStep(3);

    const contentPrompt = `당신은 대한민국 최고의 네이버 블로그 작가입니다.
키워드: "${keyword.trim()}"
제목: "${selectedTitle}"
목적: 네이버 애드포스트 클릭률 극대화, 체류시간 증가

다음 형식으로 작성하세요:
태그: (태그1, 태그2, 태그3, 태그4, 태그5)
본문: (2000자 이상의 완성된 본문. 소제목 포함, 읽기 쉽게 문단 나누기, 실생활 도움이 되는 정보 중심)

본문 구성:
- 도입부: 독자의 공감 유도
- 핵심 내용 3~5개 (소제목 포함)
- 실용적인 팁
- 마무리 및 정리`;

    try {
      const text = await callWriteAI(contentPrompt);
      const tm = text.match(/태그[:\s]*([^\n]+)/);
      const bm = text.match(/본문[:\s]*([\s\S]+)/);
      setGenTitle(selectedTitle);
      setGenTags(tm ? tm[1].trim() : keyword.trim());
      setGenContent(bm ? bm[1].trim() : text);
    } catch (e: any) {
      setError("본문 생성 실패: " + e.message);
      setWriteStep(2); setLoadingContent(false); return;
    } finally { setLoadingContent(false); }

    // 이미지 생성
    setGenImgLoading(true);
    try {
      const imgPrompt = `${selectedTitle} 블로그 대표 이미지, 고품질, 깔끔한 디자인, 한국 스타일`;
      const url = await callImageAI(imgPrompt);
      setGenImage(url);
    } catch (e: any) {
      setError("이미지 생성 실패: " + e.message);
    } finally { setGenImgLoading(false); }

    setWriteStep(4);
  }

  // ── 발행하기로 넘기기 ────────────────────────────────────
  function sendToPublish() {
    setPubTitle(genTitle);
    setPubContent(genContent);
    setPubTags(genTags);
    setPubImageUrl(genImage);
    setTab("publish");
  }

  // ── 발행 ────────────────────────────────────────────────
  async function handlePublish() {
    if (!pubTitle || !pubContent || !pubAccId) return;
    setPublishing(true); setPubMsg("발행 중...");
    try {
      const ok = await useQuota(user.id);
      if (!ok) { setPubMsg("❌ 발행 건수 초과"); return; }

      // 모바일이거나 봇 오프라인이면 Supabase job으로 저장
      if (!botOnline) {
        await supabase.from("publy_jobs").insert({
          user_id: user.id, platform, title: pubTitle, content: pubContent,
          tags: pubTags.split(",").map(t => t.trim()).filter(Boolean),
          image_url: pubImageUrl || undefined, status: "pending",
        });
        setPubMsg("✅ PC 봇 서버에 발행 예약됨! PC에서 자동으로 발행됩니다.");
        await addHistory({ user_id: user.id, platform, title: pubTitle, status: "pending" });
      } else {
        const r = await fetch(`${BOT}/api/publish-full`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id, platform, title: pubTitle, content: pubContent, tags: pubTags.split(",").map(t => t.trim()).filter(Boolean), imageUrl: pubImageUrl || undefined }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        await addHistory({ user_id: user.id, platform, title: pubTitle, post_url: d.postUrl, status: "success" });
        setPubMsg("✅ 발행 완료!");
        setPubTitle(""); setPubContent(""); setPubTags(""); setPubImageUrl("");
      }
      getHistory(user.id).then(setHistory);
      getQuota(user.id).then(q => q && setQuota(q));
    } catch (e: any) {
      await addHistory({ user_id: user.id, platform, title: pubTitle, status: "fail", error_message: e.message });
      setPubMsg("❌ " + e.message);
    } finally { setPublishing(false); }
  }

  async function handleAddAccount() {
    if (!newUser || !newPw) return;
    setAddingAcc(true);
    try {
      await upsertAccount({ user_id: user.id, platform: newPlatform, username: newUser, password_encrypted: btoa(newPw), blog_name: newBlog || undefined, is_connected: false });
      getAccounts(user.id).then(setAccounts);
      setNewUser(""); setNewPw(""); setNewBlog("");
    } catch (e: any) { alert(e.message); }
    finally { setAddingAcc(false); }
  }

  async function handleConnect(acc: PublyAccount) {
    if (!botOnline) { alert("봇 서버를 먼저 실행하세요 (PC에서 Publy 앱 실행)"); return; }
    setConnectingId(acc.id);
    try {
      const r = await fetch(`${BOT}/api/${acc.platform}/save-session`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: acc.user_id, id: acc.username, pw: atob((acc as any).password_encrypted || ""), blogName: acc.blog_name }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || "연결 실패");
      getAccounts(user.id).then(setAccounts);
    } catch (e: any) { alert("연결 실패: " + e.message); }
    finally { setConnectingId(null); }
  }

  const quotaPct = quota ? Math.min(100, (quota.used_quota / quota.total_quota) * 100) : 0;
  const connAccs = accounts.filter(a => a.is_connected && a.platform === platform);
  const todayPub = history.filter(h => new Date(h.published_at).toDateString() === new Date().toDateString()).length;

  return (
    <>
      <style>{CSS}</style>
      <div className={`dash ${theme}`}>

        {/* 에러 팝업 */}
        {error && (
          <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 999, background: "#1a0a0a", border: "1px solid var(--err)", borderRadius: 14, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 20px 60px rgba(0,0,0,.5)", animation: "popIn .25s ease both", maxWidth: "90vw" }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <span style={{ fontSize: 13, color: "#fca5a5", fontWeight: 600 }}>{error}</span>
            <button onClick={() => setError("")} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: 18, marginLeft: 8 }}>✕</button>
          </div>
        )}

        {/* ── 헤더 ── */}
        <div className="hd">
          <div className="hd-logo">
            <div className="hd-logo-ico">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L22 20H2L12 2Z" fill="#000" opacity=".8"/>
                <path d="M12 7L19 19H5L12 7Z" fill="#00ff88" opacity=".6"/>
              </svg>
            </div>
            <span className="hd-logo-text">PUBLY</span>
          </div>

          <div className="hd-center">
            <div className={`status-chip ${botOnline ? "status-on" : "status-off"}`}>
              <span className={`dot ${botOnline ? "dot-on" : "dot-off"}`} />
              <span>{botOnline ? "서버 온라인" : "서버 오프라인"}</span>
            </div>
            {quota && (
              <>
                <span style={{ fontSize: 11, color: "var(--sub)", fontFamily: "'JetBrains Mono',monospace" }}>{quota.remaining_quota}/{quota.total_quota}</span>
                <div className="quota-bar-bg"><div className="quota-bar" style={{ "--w": `${100 - quotaPct}%`, width: `${100 - quotaPct}%` } as any} /></div>
              </>
            )}
            <span className={`plan-chip plan-${user.plan}`}>{PLAN_LABELS[user.plan]}</span>
          </div>

          <div className="hd-right">
            <button className="ico-btn" onClick={onThemeToggle}>{theme === "dark" ? Icons.sun : Icons.moon}</button>
            <button className="ico-btn" onClick={checkBot} title="새로고침">{Icons.refresh}</button>
            <div className="user-chip">
              <div className="avatar">{(user.name || user.email)[0].toUpperCase()}</div>
              <span>{user.name || user.email.split("@")[0]}</span>
            </div>
            <button className="ico-btn" onClick={onAdminLogin} title="관리자">{Icons.settings}</button>
            <button className="logout-btn" onClick={onLogout}>로그아웃</button>
          </div>
        </div>

        {/* ── 바디 ── */}
        <div className="body">

          {/* ── 사이드바 ── */}
          <div className="sidebar">
            <div className="nav-label">메뉴</div>
            {TABS.map(t => (
              <button key={t.key} className={`nav-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key as Tab)}>
                <span className="nav-ico">{t.icon}</span>
                {t.label}
                {t.key === "history" && history.length > 0 && <span className="nav-badge">{history.length}</span>}
                {t.key === "write" && titles.length > 0 && <span className="nav-badge">{titles.length}</span>}
              </button>
            ))}
            <div className="sidebar-footer">
              <div className="today-card">
                <div className="today-num">{todayPub}</div>
                <div className="today-label">오늘 발행</div>
              </div>
              <div className="today-card" style={{ background: "var(--adim)", borderColor: "var(--border2)" }}>
                <div className="today-num" style={{ fontSize: 22 }}>{quota?.remaining_quota ?? "-"}</div>
                <div className="today-label">잔여 건수</div>
              </div>
            </div>
          </div>

          {/* ── 메인 ── */}
          <div className="main">
            <div className="center">

              {/* ───── 발행하기 ───── */}
              {tab === "publish" && (
                <div style={{ animation: "fadeUp .3s ease both" }}>
                  {!botOnline && (
                    <div className="warn-box warn-yellow">
                      ⚠️ 봇 서버 오프라인 — 모바일에서 발행하면 PC 봇 서버가 자동으로 처리합니다
                    </div>
                  )}
                  {quota && quota.remaining_quota <= 0 && <div className="warn-box warn-red">⚠️ 발행 건수를 모두 사용했습니다</div>}

                  {/* 플랫폼 */}
                  <div className="card" style={{ padding: "22px 24px", marginBottom: 14 }}>
                    <div className="section-label">🌐 플랫폼 선택</div>
                    <div style={{ display: "flex", gap: 12 }}>
                      {(["naver", "tistory"] as const).map(p => (
                        <button key={p} className={`plat-btn ${platform === p ? (p === "naver" ? "plat-naver" : "plat-tistory") : ""}`} onClick={() => setPlatform(p)}>
                          <span style={{ fontSize: 28 }}>{p === "naver" ? "🟢" : "🟠"}</span>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: platform === p ? (p === "naver" ? "#03C75A" : "#FF6B35") : "var(--sub)" }}>{p === "naver" ? "네이버 블로그" : "티스토리"}</div>
                            <div style={{ fontSize: 11, color: "var(--sub)" }}>Playwright 자동화</div>
                          </div>
                          {platform === p && <span style={{ marginLeft: "auto", fontSize: 18, color: p === "naver" ? "#03C75A" : "#FF6B35" }}>✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 계정 선택 */}
                  <div className="card" style={{ padding: "22px 24px", marginBottom: 14 }}>
                    <div className="section-label">🔗 발행 계정</div>
                    {connAccs.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "24px" }}>
                        <div style={{ fontSize: 40, marginBottom: 10, animation: "float 3s ease-in-out infinite" }}>🔗</div>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>연결된 계정이 없어요</div>
                        <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 14 }}>계정 관리에서 블로그 계정을 추가하세요</div>
                        <button className="btn-main" style={{ margin: "0 auto", fontSize: 13 }} onClick={() => setTab("accounts")}>계정 관리로 이동 →</button>
                      </div>
                    ) : connAccs.map(a => (
                      <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 15px", borderRadius: 13, cursor: "pointer", marginBottom: 8, background: pubAccId === a.id ? "var(--adim)" : "var(--bg)", border: `1.5px solid ${pubAccId === a.id ? "var(--accent)" : "var(--border)"}`, transition: "all .2s" }}>
                        <input type="radio" name="pacc" checked={pubAccId === a.id} onChange={() => setPubAccId(a.id)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{a.username}</span>
                        {a.blog_name && <span style={{ fontSize: 11, color: "var(--sub)" }}>({a.blog_name})</span>}
                        <span style={{ marginLeft: "auto", fontSize: 10, padding: "2px 9px", borderRadius: 99, background: "var(--adim)", color: "var(--accent)", fontWeight: 800 }}>✅ 연결됨</span>
                      </label>
                    ))}
                  </div>

                  {/* 발행 내용 */}
                  <div className="card" style={{ padding: "22px 24px", marginBottom: 14 }}>
                    <div className="section-label">📝 발행 내용</div>

                    {pubImageUrl && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 7 }}>🖼️ 발행 이미지</div>
                        <div style={{ position: "relative" }}>
                          <img src={pubImageUrl} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          <button onClick={() => setPubImageUrl("")} style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,.65)", border: "none", color: "#fff", borderRadius: 99, width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>제목</div>
                        <input className="inp" placeholder="블로그 제목..." value={pubTitle} onChange={e => setPubTitle(e.target.value)} style={{ fontSize: 15 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>태그 (쉼표 구분)</div>
                        <input className="inp" placeholder="태그1, 태그2, 태그3" value={pubTags} onChange={e => setPubTags(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>본문</div>
                        <textarea className="inp" rows={10} placeholder="발행할 내용을 입력하세요..." value={pubContent} onChange={e => setPubContent(e.target.value)} />
                      </div>
                    </div>
                  </div>

                  <button className="btn-main" style={{ width: "100%", justifyContent: "center", padding: "16px", fontSize: 16 }}
                    onClick={handlePublish} disabled={publishing || !pubAccId || !pubTitle || !pubContent || (quota?.remaining_quota || 0) <= 0}>
                    {publishing ? <><span className="spinner" /> 발행 중...</> : <>{Icons.send} 자동 발행</>}
                  </button>
                  {pubMsg && (
                    <div style={{ marginTop: 10, padding: "13px 16px", borderRadius: 13, background: pubMsg.includes("✅") ? "var(--adim)" : "rgba(255,107,107,.08)", border: `1px solid ${pubMsg.includes("✅") ? "var(--border2)" : "rgba(255,107,107,.2)"}`, fontSize: 13, fontWeight: 600, color: pubMsg.includes("✅") ? "var(--accent)" : "var(--err)" }}>
                      {pubMsg}
                    </div>
                  )}
                </div>
              )}

              {/* ───── 글 생성 ───── */}
              {tab === "write" && (
                <div style={{ animation: "fadeUp .3s ease both" }}>

                  {/* 스텝 인디케이터 */}
                  <div style={{ marginBottom: 24 }}>
                    <div className="steps">
                      {[
                        { n: 1, label: "키워드" },
                        { n: 2, label: "제목 선택" },
                        { n: 3, label: "본문 생성" },
                        { n: 4, label: "발행하기" },
                      ].map((s, i) => (
                        <div key={s.n} className="step">
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <div className={`step-circle ${writeStep > s.n ? "done" : writeStep === s.n ? "active" : ""}`}>
                              {writeStep > s.n ? Icons.check : s.n}
                            </div>
                            <div className={`step-label ${writeStep === s.n ? "active" : writeStep > s.n ? "done" : ""}`}>{s.label}</div>
                          </div>
                          {i < 3 && <div className={`step-line ${writeStep > s.n ? "done" : ""}`} style={{ margin: "0 4px", marginBottom: 20 }} />}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* STEP 1: 키워드 입력 */}
                  <div className="card" style={{ padding: "22px 24px", marginBottom: 14 }}>
                    <div className="section-label">🔍 STEP 1 — 키워드 입력</div>
                    <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                      <input className="inp" placeholder="예: 강남 맛집 추천, 다이어트 방법, 제주도 여행..." value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleGenerateTitles(true)} style={{ flex: 1, fontSize: 15 }} />
                      <select className="inp" value={platform} onChange={e => setPlatform(e.target.value as any)} style={{ width: 100 }}>
                        <option value="naver">네이버</option>
                        <option value="tistory">티스토리</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn-main" style={{ flex: 1, justifyContent: "center", padding: "13px" }} onClick={() => handleGenerateTitles(true)} disabled={loadingTitles || !keyword.trim()}>
                        {loadingTitles ? <><span className="spinner" /> 생성 중...</> : <>{Icons.star} 애드포스트 제목 30개 생성</>}
                      </button>
                      {titles.length > 0 && (
                        <button className="btn-sec" onClick={() => handleGenerateTitles(false)} disabled={loadingTitles}>
                          {Icons.plus} {titles.length >= MAX_TITLES ? "초기화 후 재생성" : "30개 추가"}
                        </button>
                      )}
                    </div>
                    {titles.length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(titles.length / MAX_TITLES) * 100}%`, background: titles.length >= MAX_TITLES ? "var(--err)" : "var(--accent)", borderRadius: 99, transition: "width .4s ease" }} />
                        </div>
                        <span style={{ fontSize: 11, color: titles.length >= MAX_TITLES ? "var(--err)" : "var(--sub)", fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
                          {titles.length}/{MAX_TITLES}
                          {titles.length >= MAX_TITLES && " — 다음 생성 시 초기화"}
                        </span>
                        <button className="btn-danger" onClick={() => { setTitles([]); setSelectedTitle(""); setWriteStep(1); }} style={{ padding: "4px 10px", fontSize: 11 }}>
                          {Icons.trash} 초기화
                        </button>
                      </div>
                    )}
                  </div>

                  {/* STEP 2: 제목 선택 */}
                  {titles.length > 0 && (
                    <div className="card" style={{ padding: "22px 24px", marginBottom: 14 }}>
                      <div className="section-label">✨ STEP 2 — 제목 클릭해서 선택하세요</div>
                      {selectedTitle && (
                        <div style={{ padding: "11px 15px", borderRadius: 12, background: "var(--adim)", border: "1px solid var(--border2)", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 16 }}>✅</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{selectedTitle}</span>
                        </div>
                      )}
                      <div className="title-grid">
                        {titles.map((title, i) => (
                          <button key={`${title}-${i}`} className={`title-card ${selectedTitle === title ? "selected" : ""}`}
                            style={{ animationDelay: `${Math.min(i, 15) * 0.03}s` }}
                            onClick={() => { setSelectedTitle(title); setWriteStep(Math.max(writeStep, 2) as 1|2|3|4); }}>
                            <div className="num">#{titles.length - i}</div>
                            <div className="txt">{title}</div>
                            {selectedTitle === title && <div className="check-ico">{Icons.check}</div>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* STEP 3: 본문 생성 */}
                  {selectedTitle && (
                    <div className="card" style={{ padding: "22px 24px", marginBottom: 14 }}>
                      <div className="section-label">📝 STEP 3 — 본문 + 이미지 생성</div>
                      <div style={{ padding: "13px 16px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 14 }}>
                        <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 4 }}>선택된 제목</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{selectedTitle}</div>
                      </div>
                      <button className="btn-main" style={{ width: "100%", justifyContent: "center", padding: "14px", fontSize: 14 }}
                        onClick={handleGenerateContent} disabled={loadingContent}>
                        {loadingContent ? <><span className="spinner" /> AI가 본문 작성 중...</> : <>{Icons.write} 본문 + 이미지 자동 생성</>}
                      </button>
                    </div>
                  )}

                  {/* STEP 4: 결과 확인 */}
                  {genContent && (
                    <div className="card" style={{ padding: "22px 24px", marginBottom: 14, animation: "fadeUp .4s ease both" }}>
                      <div className="section-label">🎨 STEP 4 — 결과 확인 & 수정</div>

                      {/* 이미지 */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 8 }}>🖼️ 생성된 이미지</div>
                        {genImgLoading ? (
                          <div className="img-skeleton" />
                        ) : genImage ? (
                          <img src={genImage} alt="" style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 13, border: "1px solid var(--border)", animation: "fadeIn .5s ease both" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div style={{ padding: "20px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 13, color: "var(--sub)", fontSize: 12 }}>이미지 설정에서 API 키를 등록하면 자동 생성됩니다</div>
                        )}
                      </div>

                      {/* 제목 */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>제목</div>
                        <input className="inp" value={genTitle} onChange={e => setGenTitle(e.target.value)} style={{ fontSize: 15, fontWeight: 600 }} />
                      </div>
                      {/* 태그 */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>태그</div>
                        <input className="inp" value={genTags} onChange={e => setGenTags(e.target.value)} />
                      </div>
                      {/* 본문 */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>본문 ({genContent.length.toLocaleString()}자)</div>
                        <textarea className="inp" rows={14} value={genContent} onChange={e => setGenContent(e.target.value)} />
                      </div>

                      <button className="btn-main" style={{ width: "100%", justifyContent: "center", padding: "15px", fontSize: 15 }} onClick={sendToPublish}>
                        {Icons.rocket} 발행하기로 넘기기
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ───── 계정 관리 ───── */}
              {tab === "accounts" && (
                <div style={{ animation: "fadeUp .3s ease both" }}>

                  {/* 계정 추가 */}
                  <div className="card" style={{ padding: "22px 24px", marginBottom: 14 }}>
                    <div className="section-label">{Icons.plus} 계정 추가</div>
                    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 5 }}>플랫폼</div>
                        <select className="inp" value={newPlatform} onChange={e => setNewPlatform(e.target.value as any)}>
                          <option value="naver">네이버</option>
                          <option value="tistory">티스토리</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 5 }}>아이디</div>
                        <input className="inp" placeholder="아이디" value={newUser} onChange={e => setNewUser(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 5 }}>비밀번호</div>
                        <input className="inp" type="password" placeholder="비밀번호" value={newPw} onChange={e => setNewPw(e.target.value)} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 5 }}>블로그명 (티스토리용)</div>
                      <input className="inp" placeholder="예: myblog (티스토리만 입력)" value={newBlog} onChange={e => setNewBlog(e.target.value)} />
                    </div>
                    <button className="btn-main" onClick={handleAddAccount} disabled={addingAcc || !newUser || !newPw} style={{ fontSize: 13, padding: "11px 20px" }}>
                      {addingAcc ? <><span className="spinner" /> 추가 중...</> : <>{Icons.plus} 계정 추가</>}
                    </button>
                  </div>

                  {/* 계정 목록 */}
                  {!botOnline && <div className="warn-box warn-yellow">⚠️ PC에서 Publy 앱을 실행해야 계정 연결이 가능합니다</div>}
                  {accounts.filter(a => a.platform !== "google").map((a, i) => (
                    <div key={a.id} className="acc-card" style={{ marginBottom: 10, animationDelay: `${i * .06}s`, borderColor: a.is_connected ? (a.platform === "naver" ? "rgba(3,199,90,.35)" : "rgba(255,107,53,.35)") : "var(--border)" }}>
                      <span style={{ fontSize: 28 }}>{a.platform === "naver" ? "🟢" : "🟠"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{a.username}</div>
                        <div style={{ fontSize: 11, color: "var(--sub)" }}>{a.platform}{a.blog_name && ` · ${a.blog_name}`}</div>
                      </div>
                      <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 99, fontWeight: 800, background: a.is_connected ? "var(--adim)" : "var(--card2)", color: a.is_connected ? "var(--accent)" : "var(--sub)" }}>
                        {a.is_connected ? "✅ 연결됨" : "미연결"}
                      </span>
                      <button className="btn-main" style={{ padding: "8px 16px", fontSize: 12 }} onClick={() => handleConnect(a)} disabled={!!connectingId || !botOnline}>
                        {connectingId === a.id ? <><span className="spinner" /> 연결 중...</> : a.is_connected ? "재연결" : "연결"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ───── 발행 기록 ───── */}
              {tab === "history" && (
                <div style={{ animation: "fadeUp .3s ease both" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <span style={{ fontSize: 13, color: "var(--sub)" }}>총 {history.length}건 · 오늘 {todayPub}건</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>잔여 {quota?.remaining_quota ?? 0}건</span>
                  </div>
                  {history.length === 0 ? (
                    <div className="card" style={{ padding: "60px 24px", textAlign: "center" }}>
                      <div style={{ fontSize: 60, marginBottom: 16, animation: "float 3s ease-in-out infinite" }}>🚀</div>
                      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>아직 발행 기록이 없어요</div>
                      <div style={{ fontSize: 13, color: "var(--sub)", marginBottom: 20 }}>글 생성 탭에서 키워드를 입력하고 첫 글을 발행해보세요!</div>
                      <button className="btn-main" style={{ margin: "0 auto", padding: "13px 24px" }} onClick={() => setTab("write")}>글 생성 시작하기 →</button>
                    </div>
                  ) : history.map((h, i) => (
                    <div key={h.id} className="hist-item" style={{ animationDelay: `${i * .04}s`, borderColor: h.status === "success" ? "rgba(0,255,136,.15)" : h.status === "fail" ? "rgba(255,107,107,.15)" : "var(--border)" }}>
                      <span style={{ fontSize: 22 }}>{h.platform === "naver" ? "🟢" : "🟠"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</div>
                        <div style={{ fontSize: 10, color: "var(--sub)", marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>{new Date(h.published_at).toLocaleString("ko-KR")}</div>
                        {h.error_message && <div style={{ fontSize: 10, color: "var(--err)", marginTop: 2 }}>❌ {h.error_message}</div>}
                      </div>
                      <span className={`badge ${h.status === "success" ? "badge-ok" : h.status === "fail" ? "badge-fail" : "badge-pend"}`}>{h.status === "success" ? "✅ 성공" : h.status === "fail" ? "❌ 실패" : "⏳ 대기"}</span>
                      {h.post_url && <a href={h.post_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none", padding: "5px 11px", borderRadius: 9, background: "var(--adim)", border: "1px solid var(--border2)", flexShrink: 0 }}>{Icons.eye} 보기</a>}
                    </div>
                  ))}
                </div>
              )}

              {/* ───── 설정 ───── */}
              {tab === "settings" && (
                <div style={{ animation: "fadeUp .3s ease both" }}>
                  <div className="card" style={{ padding: "22px 24px", marginBottom: 14 }}>
                    <div className="section-label">🤖 글쓰기 AI</div>
                    <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                      {WRITE_AI_LIST.map(item => (
                        <AICard key={item.id} item={item} selected={writeAI === item.id} onClick={() => { setWriteAI(item.id); localStorage.setItem("publy_write_ai", item.id); }} />
                      ))}
                    </div>
                    <div className="section-label">🖼️ 이미지 AI</div>
                    <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                      {IMAGE_AI_LIST.map(item => (
                        <AICard key={item.id} item={item} selected={imageAI === item.id} onClick={() => { setImageAI(item.id); localStorage.setItem("publy_image_ai", item.id); }} />
                      ))}
                    </div>
                    <div style={{ padding: "12px 15px", borderRadius: 12, background: "rgba(16,163,127,.08)", border: "1px solid rgba(16,163,127,.2)", marginBottom: 18, fontSize: 12, color: "#10a37f", lineHeight: 1.6 }}>
                      💡 OpenAI 키는 글쓰기(GPT-4o mini) + 이미지(DALL-E 3) 모두 하나의 키로 사용 가능합니다
                    </div>

                    <div style={{ padding: "14px 16px", borderRadius: 14, background: "var(--adim)", border: "1px solid var(--border2)", marginBottom: 14 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 10 }}>📝 글쓰기 API 키</div>
                      {WRITE_AI_LIST.map(k => <KeyInput key={k.id} k={k} />)}
                    </div>
                    <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(139,92,246,.07)", border: "1px solid rgba(139,92,246,.2)" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#8b5cf6", marginBottom: 10 }}>🖼️ 이미지 API 키</div>
                      {IMAGE_AI_LIST.map(k => <KeyInput key={k.id} k={k} />)}
                    </div>
                  </div>

                  <div className="card" style={{ padding: "22px 24px" }}>
                    <div className="section-label">👤 내 계정</div>
                    {[
                      { l: "이름", v: user.name || "-" },
                      { l: "이메일", v: user.email },
                      { l: "플랜", v: PLAN_LABELS[user.plan] },
                      { l: "잔여 건수", v: `${quota?.remaining_quota ?? "-"}건` },
                      { l: "만료일", v: quota ? new Date(quota.reset_date).toLocaleDateString("ko-KR") : "-" },
                    ].map(item => (
                      <div key={item.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ fontSize: 13, color: "var(--sub)" }}>{item.l}</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{item.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            {/* ── 우측 패널 ── */}
            <div className="right-panel">
              <div className="rp-section">
                <div className="rp-title">⚡ 빠른 이동</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key as Tab)} style={{ padding: "14px 10px", borderRadius: 13, border: `1px solid ${tab === t.key ? "var(--border2)" : "var(--border)"}`, background: tab === t.key ? "var(--adim)" : "var(--card)", cursor: "pointer", textAlign: "center", transition: "all .2s", fontFamily: "inherit" }}>
                      <div style={{ marginBottom: 5, color: tab === t.key ? "var(--accent)" : "var(--sub)" }}>{t.icon}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: tab === t.key ? "var(--accent)" : "var(--sub)" }}>{t.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rp-section">
                <div className="rp-title">📊 현황</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { label: "오늘 발행", value: todayPub, color: "var(--accent)" },
                    { label: "잔여 건수", value: quota?.remaining_quota ?? "-", color: "#4285F4" },
                    { label: "총 발행", value: history.length, color: "#f59e0b" },
                    { label: "제목 목록", value: `${titles.length}개`, color: "#a78bfa" },
                  ].map((s, i) => (
                    <div key={i} style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)" }}>
                      <div style={{ fontSize: 10, color: "var(--sub)", marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rp-section">
                <div className="rp-title">🖥️ 서버 상태</div>
                {[
                  { label: "봇 서버", ok: botOnline, desc: "localhost:3333" },
                  { label: "네이버 계정", ok: accounts.some(a => a.is_connected && a.platform === "naver"), desc: `${accounts.filter(a => a.platform === "naver").length}개 등록` },
                  { label: "티스토리", ok: accounts.some(a => a.is_connected && a.platform === "tistory"), desc: `${accounts.filter(a => a.platform === "tistory").length}개 등록` },
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 11px", borderRadius: 10, background: "var(--card)", border: "1px solid var(--border)", marginBottom: 7 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</div>
                      <div style={{ fontSize: 9, color: "var(--sub)" }}>{s.desc}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span className={`dot ${s.ok ? "dot-on" : "dot-off"}`} />
                      <span style={{ fontSize: 10, color: s.ok ? "var(--accent)" : "var(--sub)", fontWeight: 700 }}>{s.ok ? "정상" : "미연결"}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rp-section" style={{ flex: 1 }}>
                <div className="rp-title">🕐 최근 발행</div>
                {history.slice(0, 6).map((h, i) => (
                  <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)", animation: `fadeUp .3s ease ${i * .05}s both` }}>
                    <span>{h.platform === "naver" ? "🟢" : "🟠"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</div>
                      <div style={{ fontSize: 9, color: "var(--sub)" }}>{new Date(h.published_at).toLocaleDateString("ko-KR")}</div>
                    </div>
                    <span style={{ fontSize: 12 }}>{h.status === "success" ? "✅" : "❌"}</span>
                  </div>
                ))}
              </div>

              <div className="rp-section">
                <div className="warn-box warn-blue" style={{ margin: 0, fontSize: 11 }}>
                  {Icons.mobile} 모바일에서 발행하면 PC 봇 서버가 자동으로 처리합니다
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── 모바일 탭바 ── */}
        <div className="mob-bar">
          {TABS.map(t => (
            <button key={t.key} className={`mob-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key as Tab)}>
              <span className="mob-icon">{t.icon}</span>
              <span className="mob-label">{t.label}</span>
            </button>
          ))}
        </div>

      </div>
    </>
  );
}
