import React, { useState, useEffect, useCallback, useRef } from "react";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount, upsertAccount, useQuota, addHistory, deleteHistory, deleteAllHistory, changeUserPassword, getNaverApiKeys, saveNaverApiKeys, NaverApiKeys, checkNaverQuota, incrementNaverQuota, getNaverDailyUsage, NAVER_DAILY_LIMIT, getUserNaverApiKeys, logError } from "../lib/supabase";
import { supabase } from "../lib/supabase";

type MainTab = "keyword" | "write" | "image" | "photo" | "publish" | "manage" | "accounts" | "rank" | "calendar" | "settings";
type PublishConcept = "full" | "body_faq" | "body_only";

const BOT = "http://127.0.0.1:3333";
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
const WRITE_STYLES = [
  {id:"감성일기", i:"📔", desc:"감성·경험 중심 에세이체"},
  {id:"정보글",  i:"📋", desc:"SEO 최적화 정보 전달"},
  {id:"맛집후기",i:"🍽️", desc:"음식·분위기·가격 묘사"},
  {id:"여행기",  i:"✈️", desc:"일정·팁·감성 여행 스토리"},
] as const;
type WriteStyle = typeof WRITE_STYLES[number]["id"];
const WRITE_STYLE_GUIDE: Record<WriteStyle,string> = {
  "감성일기":"[스타일] 개인 감정·경험 중심의 따뜻한 에세이체. 독자에게 말 걸듯 친근하게. 감성적 표현 풍부하게.",
  "정보글":  "[스타일] 명확한 정보 전달. 번호 목록·수치·비교 표현 적극 활용. SEO 키워드 자연스럽게 반복.",
  "맛집후기":"[스타일] 맛·향·식감 생생하게 묘사. 가격·위치·웨이팅·주차 정보 포함. 재방문 의향 솔직하게.",
  "여행기":  "[스타일] 여행지 분위기·감성 묘사. 일정·비용·교통 팁 포함. 포토스팟·현지 맛집 자연스럽게 언급.",
};

const BLOG_TEMPLATES = [
  {id:"none",      label:"📝 템플릿 없음", style:"감성일기" as const, persona:"none" as const, guide:""},
  {id:"restaurant",label:"🍽️ 맛집 후기",  style:"맛집후기" as const, persona:"young_w" as const, guide:"[템플릿: 맛집 후기]\n구성: 방문 계기 → 분위기/인테리어 → 메뉴/가격 → 맛 평가(식감·향·비주얼) → 서비스 → 재방문 의향\n필수: 가격대 언급, 주차/웨이팅 정보, 추천 메뉴"},
  {id:"travel",    label:"✈️ 여행 후기",  style:"여행기" as const,  persona:"young_w" as const, guide:"[템플릿: 여행 후기]\n구성: 여행지 소개 → 이동 방법/비용 → 주요 볼거리 → 맛집/카페 → 숙소 → 총평/팁\n필수: 교통비·숙박비 언급, 포토스팟, 여행 꿀팁"},
  {id:"product",   label:"📦 제품 리뷰",  style:"정보글" as const,  persona:"expert" as const, guide:"[템플릿: 제품 리뷰]\n구성: 구매 계기 → 언박싱/외관 → 실제 사용 후기 → 장점 3가지 → 단점 솔직하게 → 추천 대상\n필수: 가격 대비 만족도, 비교 제품 언급"},
  {id:"info",      label:"📋 정보/꿀팁",  style:"정보글" as const,  persona:"teacher" as const, guide:"[템플릿: 정보/꿀팁]\n구성: 주제 소개 → 핵심 정보 5~7가지(번호 목록) → 주의사항 → 자주 묻는 질문 → 정리\n필수: 수치/데이터 포함, 실용적 팁 위주"},
  {id:"experience",label:"💬 체험단 후기", style:"감성일기" as const, persona:"mid_w" as const, guide:"[템플릿: 체험단/협찬 후기]\n구성: 협찬 명시 → 첫인상 → 직접 체험 내용 → 솔직한 장단점 → 추천 이유\n필수: 협찬 투명하게 표시, 실제 사용 사진 캡션 포함"},
] as const;
type BlogTemplate = typeof BLOG_TEMPLATES[number]["id"];

const PERSONA_STYLES = [
  {id:"none",     label:"🙂 기본",      color:"#888", prompt:""},
  {id:"young_w",  label:"👩 20대 여성",  color:"#f472b6", prompt:"20대 여성이 친한 친구에게 카톡 보내듯 친근하고 감성적으로 작성해줘. 이모지 적절히 사용하고 공감과 감성을 자극하는 표현을 써줘. '~했어요', '~더라고요', '~거든요' 말투로."},
  {id:"young_m",  label:"👨 20대 남성",  color:"#60a5fa", prompt:"20대 남성이 친구에게 솔직하게 말하듯 써줘. 직접적이고 핵심만 짚는 문체로 유머와 현실적인 조언을 섞어서. '~했어요', '~임', '~거든요' 자연스럽게."},
  {id:"mid_w",    label:"👩‍🦳 40대 여성", color:"#fb923c", prompt:"40대 주부나 직장맘이 또래 친구에게 진심으로 알려주듯 따뜻하고 실용적으로 써줘. 경험에서 우러나온 조언과 공감을 담아줘. '~해요', '~하더라고요', '~이에요' 말투로."},
  {id:"mid_m",    label:"👨‍🦳 40대 남성", color:"#34d399", prompt:"40대 직장인 남성이 후배에게 조언해주듯 신뢰감 있고 경험 기반으로 써줘. 핵심 정보를 명확하게 전달하되 딱딱하지 않게. '~합니다', '~했어요', '~거든요' 섞어서."},
  {id:"mom",      label:"👩‍👧 엄마",      color:"#f9a8d4", prompt:"자상한 엄마가 아이에게 설명해주듯 따뜻하고 걱정 어린 마음으로 써줘. 안전과 건강을 먼저 생각하고 실용적인 조언과 따뜻한 격려를 담아줘."},
  {id:"expert",   label:"🎓 전문가",     color:"#a78bfa", prompt:"해당 분야 전문가가 신뢰감 있게 써줘. 전문 지식을 쉬운 말로 풀어서 근거와 데이터를 적극 활용하고 독자가 실제로 적용할 수 있는 실용적 조언을 담아줘."},
  {id:"teacher",  label:"👨‍🏫 선생님",    color:"#4ade80", prompt:"친절한 선생님이 학생에게 설명해주듯 차근차근 이해하기 쉽게 써줘. 단계별로 설명하고 어려운 개념은 쉬운 예시로 풀어서."},
  {id:"reporter", label:"📰 기자",       color:"#94a3b8", prompt:"신문 기자가 심층 취재 기사 쓰듯 객관적이고 사실 기반으로 써줘. 핵심 정보를 앞에 배치하고 신뢰감 있는 문체로."},
] as const;
type PersonaStyle = typeof PERSONA_STYLES[number]["id"];
const MAIN_TABS = [
  {k:"keyword", i:"🔍", l:"키워드/제목"},
  {k:"write",   i:"✍️", l:"글 생성"},
  {k:"image",   i:"🖼️", l:"이미지 생성"},
  {k:"photo",   i:"📷", l:"사진 글쓰기"},
  {k:"publish", i:"🚀", l:"발행하기"},
  {k:"manage",  i:"📋", l:"발행 관리"},
  {k:"accounts",i:"🔗", l:"계정 관리"},
  {k:"rank",    i:"📊", l:"블로그 순위"},
  {k:"calendar",i:"📅", l:"콘텐츠 캘린더"},
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
.app{width:100vw;height:100dvh;font-family:'Noto Sans KR',sans-serif;color:var(--text);background:var(--bg);display:flex;flex-direction:column;overflow:hidden;transition:background .2s,color .2s;}
*::-webkit-scrollbar{width:5px;}*::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px;}
.header{height:58px;flex-shrink:0;display:flex;align-items:center;padding:0 16px;gap:10px;background:var(--header-bg);border-bottom:1px solid var(--border);backdrop-filter:blur(24px);position:sticky;top:0;z-index:100;}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;flex-shrink:0;}
.logo-ico{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#00ff9d,#00c870);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 12px rgba(0,255,157,.35);}
.logo-text{font-size:17px;font-weight:900;letter-spacing:.18em;color:var(--accent-text);font-family:'Space Grotesk',sans-serif;}
.header-mid{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;flex-wrap:wrap;}
.plat-btn{padding:5px 12px;border-radius:99px;border:1.5px solid;font-size:11px;font-weight:700;cursor:pointer;font-family:'Noto Sans KR',sans-serif;transition:all .15s;white-space:nowrap;flex-shrink:0;}
.plat-btn-naver{background:rgba(3,199,90,.1);color:var(--naver);border-color:rgba(3,199,90,.4);}
.plat-btn-naver-off{background:transparent;color:var(--text2);border-color:var(--border);}
.plat-btn-tistory{background:rgba(255,107,53,.1);color:var(--tistory);border-color:rgba(255,107,53,.4);}
.plat-btn-tistory-off{background:transparent;color:var(--text2);border-color:var(--border);}
.header-right{display:flex;align-items:center;gap:6px;margin-left:auto;}
.server-chip{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:99px;font-size:11px;font-weight:700;border:1px solid;white-space:nowrap;}
.server-on{background:rgba(0,214,143,.1);color:var(--success);border-color:rgba(0,214,143,.3);}
.server-off{background:rgba(120,120,120,.06);color:var(--text2);border-color:var(--border);}
.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.dot-on{background:var(--success);box-shadow:0 0 6px var(--success);animation:pulse 1.5s ease-in-out infinite;}
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
.layout{flex:1;display:flex;overflow:hidden;min-height:0;padding-left:210px;}
.sidebar{position:fixed;left:0;top:58px;bottom:0;z-index:50;width:210px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 8px;gap:2px;overflow-y:auto;}
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
.guide-overlay{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));}
.guide-modal{width:100%;max-width:560px;max-height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:24px;overflow:hidden;display:flex;flex-direction:column;animation:guideIn .32s cubic-bezier(.34,1.56,.64,1) both;box-shadow:0 32px 80px rgba(0,0,0,.6);position:relative;}
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
.pub-grid{display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start;}
.pub-panel-desktop{display:flex;flex-direction:column;gap:12px;}
.pub-mobile-bar{display:none;}
.lg-hidden{display:none;}
.pub-submit-btn{display:block;}
@media(max-width:900px){
  .pub-grid{grid-template-columns:1fr !important;}
  .pub-panel-desktop{display:none !important;}
  .pub-mobile-bar{display:flex !important;}
  .lg-hidden{display:block !important;}
  .pub-submit-btn{display:none !important;}
  .pub-sticky-bar{flex-wrap:wrap;gap:6px;}
  .pub-ready{display:none;}
}
@media(max-width:900px){.sidebar{display:none;}.mob-bar{display:flex;}.main{padding-bottom:130px;}.layout{padding-left:0;}}
@media(max-width:768px){
  .server-chip{display:none;}.quota-chip{display:none;}.dl-btn{display:none;}.main{padding:14px 12px calc(80px + env(safe-area-inset-bottom));}.card{padding:16px 14px;}
  .adtype-row{grid-template-columns:1fr 1fr;}.title-grid{grid-template-columns:1fr;}.ai-grid{flex-direction:column;}
  .btn-xl{padding:18px 22px;font-size:17px;}.btn{font-size:15px;padding:13px 18px;}.inp{font-size:16px;}.inp.lg{font-size:18px;}
  .concept-grid{grid-template-columns:1fr;}.steps .step-n{display:none;}.step-item{font-size:13px;padding:13px 6px;}
  .g-step-desc{font-size:14px !important;line-height:1.9 !important;}
  .g-step-title{font-size:16px !important;}
  .nav-item{padding:13px 12px;font-size:14px;}
  .guide-modal{max-width:100%;max-height:calc(100dvh - 20px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:20px;}.guide-header{padding:16px 16px 0;}
  .guide-body{padding:14px 14px 18px;}.guide-footer{padding:10px 14px;}.preview-inner{padding:20px 14px;}
  .flow-nav{flex-direction:column;align-items:stretch;}.flow-btn{justify-content:center;}
  .pub-grid{grid-template-columns:1fr !important;}
  .pub-panel-desktop{display:none !important;}
  .pub-mobile-bar{display:flex !important;}
  .lg-hidden{display:block;}
  .img-split{grid-template-columns:1fr !important;}
}
@media(max-width:480px){
  .header{padding:0 8px;gap:5px;}.user-name{display:none;}.logout-btn{display:none;}.quota-chip{display:none;}
  .dl-btn span:last-child{display:none;}.dl-btn{padding:9px 12px;}
  .guide-open-btn{font-size:11px;padding:6px 10px;}
  .adtype-row{grid-template-columns:1fr;}.guide-overlay{padding:6px;}
  .guide-modal{max-height:calc(100dvh - 12px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:16px;}.guide-tab{font-size:11px;padding:9px 11px;}
  .acc-form-grid{grid-template-columns:1fr !important;}
  .pub-plat-grid{grid-template-columns:1fr !important;}
}
.pub-sticky-bar{position:sticky;top:0;z-index:30;background:var(--card);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;backdrop-filter:blur(12px);}
.toast-wrap{position:fixed;bottom:28px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
.toast{padding:12px 18px;border-radius:12px;font-size:13px;font-weight:700;font-family:'Noto Sans KR',sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.35);animation:toastIn .25s ease;pointer-events:all;display:flex;align-items:center;gap:8px;max-width:320px;}
.toast-success{background:#1a2e1a;color:#4ade80;border:1px solid rgba(74,222,128,.25);}
.toast-error{background:#2e1a1a;color:#f87171;border:1px solid rgba(248,113,113,.25);}
.toast-info{background:#1a1f2e;color:#93c5fd;border:1px solid rgba(147,197,253,.25);}
@keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.pub-ready{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.pub-ready-chip{display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;border:1px solid;}
.pub-ready-ok{background:rgba(0,214,143,.1);color:var(--success);border-color:rgba(0,214,143,.25);}
.pub-ready-no{background:rgba(255,83,99,.08);color:var(--danger);border-color:rgba(255,83,99,.2);}
.pub-settings-panel{border-top:1px solid var(--border);padding:16px;background:var(--card2);display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media(max-width:768px){.pub-settings-panel{grid-template-columns:1fr;}}
@media(max-width:900px){.right-panel{display:none;}}
.app.large{font-size:16px;}
.app.large .nav-item{font-size:15px;padding:13px 12px;}
.app.large .card-title{font-size:14px;}
.app.large .inp{font-size:16px;padding:13px 14px;}
.app.large .inp-label{font-size:14px;}
.app.large .btn{font-size:15px;padding:13px 22px;}
.app.large .btn-sm{font-size:13px;padding:10px 16px;}
.app.large .flow-btn{font-size:16px;}
/* ── 사진 글쓰기 꽃밭 테마 ── */
.photo-root{padding:20px;max-width:860px;margin:0 auto;}
.photo-story{display:flex;gap:0;margin-bottom:28px;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(255,107,157,.15);}
.photo-story-step{flex:1;padding:20px 16px;text-align:center;position:relative;}
.photo-story-step.s1{background:linear-gradient(135deg,#FF6B9D18,#FF9E6C18);}
.photo-story-step.s2{background:linear-gradient(135deg,#C77DFF18,#FF6B9D18);}
.photo-story-step.s3{background:linear-gradient(135deg,#80FFDB18,#C77DFF18);}
.photo-story-ico{font-size:32px;margin-bottom:8px;display:block;}
.photo-story-num{font-size:10px;font-weight:900;letter-spacing:.1em;color:#FF6B9D;margin-bottom:4px;}
.photo-story-title{font-size:13px;font-weight:800;color:var(--text);margin-bottom:4px;}
.photo-story-desc{font-size:11px;color:var(--text3);line-height:1.5;}
.photo-story-arrow{position:absolute;right:-10px;top:50%;transform:translateY(-50%);font-size:18px;color:#FF6B9D;z-index:2;}
.photo-drop{border:2.5px dashed #FF6B9D55;border-radius:20px;padding:32px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--bg);margin-bottom:16px;}
.photo-drop.drag-over,.photo-drop:hover{border-color:#FF6B9D;background:linear-gradient(135deg,#FF6B9D11,#C77DFF11);}
.photo-drop-ico{font-size:48px;margin-bottom:12px;}
.photo-drop-title{font-size:16px;font-weight:800;color:#FF6B9D;margin-bottom:6px;}
.photo-drop-desc{font-size:12px;color:var(--text3);}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-bottom:16px;}
.photo-thumb{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12);}
.photo-thumb img{width:100%;height:100%;object-fit:cover;}
.photo-thumb-del{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700;}
.photo-keypoints{width:100%;min-height:80px;padding:14px;border-radius:14px;border:1.5px solid #C77DFF44;background:var(--bg);color:var(--text);font-size:14px;font-family:inherit;resize:vertical;outline:none;transition:all .2s;line-height:1.7;}
.photo-keypoints:focus{border-color:#C77DFF;background:var(--card);box-shadow:0 0 0 3px #C77DFF22;}
.photo-keypoints::placeholder{color:var(--text3);}
.photo-gen-btn{width:100%;padding:18px;border-radius:16px;border:none;cursor:pointer;font-size:16px;font-weight:900;font-family:inherit;transition:all .2s;background:linear-gradient(135deg,#FF6B9D,#C77DFF);color:#fff;box-shadow:0 4px 20px rgba(255,107,157,.4);margin-top:8px;}
.photo-gen-btn:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(255,107,157,.5);}
.photo-gen-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;}
.photo-guide-btn{position:fixed;bottom:80px;right:16px;padding:10px 16px;border-radius:99px;background:linear-gradient(135deg,#FF6B9D,#C77DFF);border:none;cursor:pointer;box-shadow:0 4px 16px rgba(255,107,157,.5);font-size:13px;font-weight:800;color:#fff;display:flex;align-items:center;gap:6px;z-index:100;transition:all .2s;white-space:nowrap;font-family:inherit;}
.photo-guide-btn:hover{transform:scale(1.1);}
.photo-guide-modal{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;}
.photo-guide-card{background:var(--card);border-radius:20px;padding:28px;max-width:420px;width:100%;max-height:80vh;overflow-y:auto;}
@keyframes flowerFloat{0%,100%{transform:translateY(0) rotate(0deg);}50%{transform:translateY(-6px) rotate(3deg);}}
.flower-deco{animation:flowerFloat 3s ease-in-out infinite;display:inline-block;}
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
  const [botSecret, setBotSecret] = useState<string>("");  // 봇 API 인증 시크릿
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
  const [kwData, setKwData] = useState<{keyword:string;volume:number;competition:string;cpc:number;clicks:number}[]>([]);
  const [loadingKw, setLoadingKw] = useState(false);

  function calcGoldScore(kw:{volume:number;competition:string;cpc:number;clicks:number;keyword?:string}):number{
    const compScore=kw.competition==="낮음"?100:kw.competition==="중"?50:10;
    const volScore=kw.volume>=1000&&kw.volume<=30000?100:kw.volume>30000&&kw.volume<=80000?60:kw.volume<1000?20:40;
    const ctrScore=kw.volume>0?Math.min(100,(kw.clicks/kw.volume)*1000):0;
    const cpcScore=Math.min(100,kw.cpc/8);
    const kwText=(kw.keyword||"").toLowerCase();
    const commercialBonus=/추천|비교|후기|리뷰|방법|가격|구매|어디|어떻게|얼마|순위|최고|좋은|싼/.test(kwText)?20:0;
    const wordCount=kwText.replace(/\s+/g," ").trim().split(" ").length;
    const longtailBonus=wordCount>=3?15:wordCount===2?8:0;
    const base=Math.round(compScore*0.35+volScore*0.25+ctrScore*0.15+cpcScore*0.25);
    return Math.min(100,base+commercialBonus+longtailBonus);
  }

  function calcQualityScore(content:string, kw:string):{score:number;items:{label:string;pass:boolean;detail:string;weight:number}[]} | null {
    if(!content||content.length<100)return null;
    const items:{label:string;pass:boolean;detail:string;weight:number}[]=[];

    // 1. 글자수
    const charOk=content.length>=1200;
    items.push({label:"글자수",pass:charOk,detail:`${content.length.toLocaleString()}자 (권장 1,200자+)`,weight:20});

    // 2. 질문형 소제목 비율
    const headings=(content.match(/^## .+/gm)||[]);
    const qHeadings=headings.filter(h=>/[?？]/.test(h)||/하는법|방법|이유|이란|할까|될까|인가|인지|는지/.test(h));
    const headingOk=headings.length>=3&&qHeadings.length>=Math.ceil(headings.length*0.5);
    items.push({label:"질문형 소제목",pass:headingOk,detail:`${headings.length}개 중 ${qHeadings.length}개 질문형`,weight:25});

    // 3. 키워드 밀도
    const keyword=kw.trim();
    const kwCount=keyword?(content.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"))||[]).length:0;
    const kwOk=keyword?kwCount>=2&&kwCount<=6:true;
    items.push({label:"키워드 밀도",pass:kwOk,detail:keyword?`"${keyword}" ${kwCount}회 (권장 2~6회)`:"키워드 없음",weight:20});

    // 4. AI 패턴 감지
    const aiPatterns=["해보겠습니다","알아보겠습니다","살펴보겠습니다","소개해드리겠습니다","정리해보겠습니다","결론적으로","중요합니다","다양한","효과적인","필수적으로"];
    const aiHits=aiPatterns.filter(p=>content.includes(p));
    const aiOk=aiHits.length===0;
    items.push({label:"AI 패턴 차단",pass:aiOk,detail:aiOk?"AI 냄새 없음 ✓":`감지됨: ${aiHits.slice(0,2).join(", ")}`,weight:20});

    // 5. 단락 균형
    const paragraphs=content.split(/\n\n+/).filter(p=>p.trim().length>20&&!p.startsWith("##")&&!p.startsWith("["));
    const avgLen=paragraphs.length>0?paragraphs.reduce((a,p)=>a+p.length,0)/paragraphs.length:0;
    const paraOk=paragraphs.length>=4&&avgLen>=80&&avgLen<=400;
    items.push({label:"단락 균형",pass:paraOk,detail:`단락 ${paragraphs.length}개, 평균 ${Math.round(avgLen)}자`,weight:15});

    const score=Math.round(items.reduce((acc,it)=>acc+(it.pass?it.weight:0),0));
    return{score,items};
  }

  async function generateCalendar(){
    const kws = calKeywords.split(/[,\n]+/).map(s=>s.trim()).filter(Boolean);
    if(kws.length===0){showToast("키워드를 입력해주세요","error");return;}
    setCalLoading(true);setCalDone(false);setCalSchedule([]);
    try{
      const today=new Date();
      const prompt=`You are a JSON generator. Return ONLY a valid JSON array, no explanation, no markdown, no code blocks.
Generate a ${calDays}-day blog publishing schedule.
Keywords: ${kws.join(", ")}
Platform: ${calPlatform==="naver"?"Naver Blog":"Tistory"}
Rules:
- If keywords are insufficient, generate related keywords to fill ${calDays} days
- Weekends (Sat/Sun): lifestyle/travel/food topics. Weekdays: informational topics
- No consecutive same keywords
- adType: use "adpost" for emotional/lifestyle posts, "adsense" for informational posts
- style: one of 감성일기/정보글/맛집후기/여행기
Today: ${today.toISOString().slice(0,10)}
Output format (JSON array only, no other text):
[{"date":"YYYY-MM-DD","keyword":"키워드","title":"SEO제목","style":"글스타일","adType":"adpost or adsense"}]`;

      const raw=await callAI(prompt);
      if(!raw){throw new Error("AI 응답이 비어있어요. API 키를 확인해주세요.");}
      const clean=raw.replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);
      setCalSchedule(parsed.slice(0,calDays));
      setCalDone(true);
      showToast(`📅 ${parsed.slice(0,calDays).length}일치 스케줄 생성 완료!`);
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setCalLoading(false);}
  }

  async function fetchKeywordData(){
    if(!keyword.trim()){showToast("키워드를 먼저 입력해주세요","error");return;}
    setLoadingKw(true);
    try{
      const keys=await getNaverApiKeys(user.id);
      if(!keys.naver_access_license||!keys.naver_secret_key||!keys.naver_customer_id){
        showToast("설정탭에서 네이버 검색광고 API 키를 입력해주세요","error");
        setLoadingKw(false);return;
      }
      // 개인키 여부: naverKeys state에 값이 있으면 개인키
      const isPersonal=!!(naverKeys.naver_access_license&&naverKeys.naver_secret_key&&naverKeys.naver_customer_id);
      const qc=await checkNaverQuota(user.id,user.plan,isPersonal);
      setNaverQuotaInfo({used:qc.used,limit:qc.limit});
      if(!qc.ok){
        showToast(`❌ 일일 한도 초과 (${qc.used}/${qc.limit}회) — 개인 API 키 입력 시 무제한!`,"error");
        setLoadingKw(false);return;
      }
      const isWeb = !window.electron;
      const apiUrl = isWeb ? `/api/naver-keywords` : `${BOT}/api/naver-keywords`;
      const r = isWeb
        ? await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessLicense: keys.naver_access_license, secretKey: keys.naver_secret_key, customerId: keys.naver_customer_id, keywords: [keyword.trim()] }),
          })
        : await botFetch(apiUrl, {
            method: "POST",
            body: JSON.stringify({ accessLicense: keys.naver_access_license, secretKey: keys.naver_secret_key, customerId: keys.naver_customer_id, keywords: [keyword.trim()] }),
          });
      if(!r.ok)throw new Error((await r.json()).error);
      const data=await r.json();
      const list=(data.keywordList||[]).slice(0,20).map((item:any,i:number)=>{
        const pc=parseInt((item.monthlyPcQcCnt||"0").toString().replace(/,/g,""))||0;
        const mob=parseInt((item.monthlyMobileQcCnt||"0").toString().replace(/,/g,""))||0;
        const total=pc+mob;
        return{keyword:item.relKeyword||"",volume:total,clicks:Math.round(total*0.03),
          cpc:Math.round((parseFloat(item.avgMonthlyPC||"0")||0)*1000),
          competition:item.compIdx==="높음"?"높음":item.compIdx==="낮음"?"낮음":"중"};
      }).filter((k:any)=>k.keyword);
      setKwData(list);
      if(!isPersonal) await incrementNaverQuota(user.id);
      const newUsed=qc.used+1;
      setNaverQuotaInfo({used:newUsed,limit:qc.limit});
      showToast(`📊 키워드 ${list.length}개 수집 완료! (${newUsed}/${qc.limit}회 사용)`);
    }catch(e:any){showToast("❌ "+e.message,"error");}
    finally{setLoadingKw(false);}
  }
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
  const [pubScope, setPubScope] = useState<"body"|"faq"|"full">("full");
  const [photoFiles, setPhotoFiles] = useState<{id:string;src:string;name:string}[]>([]);
  const [photoKeypoints, setPhotoKeypoints] = useState("");
  const [photoGenerating, setPhotoGenerating] = useState(false);
  const [photoGenDone, setPhotoGenDone] = useState(false);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [newPlat, setNewPlat] = useState<"naver"|"tistory">("naver");
  const [newUser, setNewUser] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [newBlog, setNewBlog] = useState("");
  const [addingAcc, setAddingAcc] = useState(false);
  const [connId, setConnId] = useState<string|null>(null);
  // 계정별 카테고리 (accId → 카테고리 배열)
  const [accCats, setAccCats] = useState<Record<string,string[]>>(()=>{try{return JSON.parse(localStorage.getItem("publy_acc_cats")||"{}");}catch{return {};}});
  const [editingCatAccId, setEditingCatAccId] = useState<string|null>(null);
  const [catInput, setCatInput] = useState("");
  const [writeAI, setWriteAI] = useState(()=>localStorage.getItem("publy_write_ai")||"gemini");
  const [imageAI, setImageAI] = useState(()=>localStorage.getItem("publy_image_ai")||"openai_img");
  const [writeStyle, setWriteStyle] = useState<WriteStyle>(()=>(localStorage.getItem("publy_write_style") as WriteStyle)||"감성일기");
  const [persona, setPersona] = useState<PersonaStyle>(()=>(localStorage.getItem("publy_persona") as PersonaStyle)||"none");
  const [blogTemplate, setBlogTemplate] = useState<BlogTemplate>("none");
  const [fontMode, setFontMode] = useState<"normal"|"large">(()=>(localStorage.getItem("publy_font_mode")||"normal") as "normal"|"large");
  const [noticePopup, setNoticePopup] = useState<{title:string;body:string;key:string}|null>(null);
  const [myReferrals, setMyReferrals] = useState<{id:string;name:string;email:string;plan:string;created_at:string}[]>([]);
  const [referralLoaded, setReferralLoaded] = useState(false);
  const [showUserDrop, setShowUserDrop] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [qualityScore, setQualityScore] = useState<{score:number;items:{label:string;pass:boolean;detail:string;weight:number}[]}|null>(null);
  const [calKeywords, setCalKeywords] = useState("");
  const [calPlatform, setCalPlatform] = useState<"naver"|"tistory">("naver");
  const [calDays, setCalDays] = useState(30);
  const [calSchedule, setCalSchedule] = useState<{date:string;keyword:string;title:string;style:string;adType:string}[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calDone, setCalDone] = useState(false);
  // ── 카테고리 / 공개 설정 / 예약 발행 ──
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{id:string;name:string}[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [visibility, setVisibility] = useState<"public"|"neighbor"|"private">("public");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");

  // ── 블록 에디터 (tarry 방식) ──
  type TextBlock = {type:"text";id:string;content:string};
  type SingleImageBlock = {type:"image";id:string;src:string;alt:string;position:"left"|"center"|"right";source:"auto"|"manual"};
  type ImagePairBlock = {type:"image-pair";id:string;images:{src:string;alt:string}[]};
  type ContentBlock = TextBlock | SingleImageBlock | ImagePairBlock;
  function uid(){return Math.random().toString(36).slice(2);}
  const [blocks, setBlocks] = useState<ContentBlock[]>([{type:"text",id:uid(),content:""}]);
  const [thumbnail, setThumbnail] = useState("");
  const [greeting, setGreeting] = useState(()=>localStorage.getItem("publy_greeting")||"");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [imageMode, setImageMode] = useState<"auto"|"manual">("auto");
  const [autoInserted, setAutoInserted] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showNaverMenu, setShowNaverMenu] = useState(false);
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [toasts, setToasts] = useState<{id:number;msg:string;type:"success"|"error"|"info"}[]>([]);
  function showToast(msg:string, type:"success"|"error"|"info"="success"){
    const id=Date.now();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),3200);
  } // 썸네일+인사말 접기 (이미지 있으면 자동펼침)
  const [currentPw, setCurrentPw] = useState("");
  const [newPw1, setNewPw1] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwChanging, setPwChanging] = useState(false);
  const [naverKeys, setNaverKeys] = useState<NaverApiKeys>({});
  const [naverKeysSaving, setNaverKeysSaving] = useState(false);
  const [naverKeysMsg, setNaverKeysMsg] = useState("");
  const [naverQuotaInfo, setNaverQuotaInfo] = useState<{used:number;limit:number}|null>(null);
  const [showKwInfo, setShowKwInfo] = useState(false);
  const [showRankInfo, setShowRankInfo] = useState(false);
  const thumbnailRef = useRef<HTMLInputElement>(null);
  const manualFileRef = useRef<HTMLInputElement>(null);

  // 카테고리 로드
  async function loadCategories(plat: string) {
    if (!botOnline) {
      // 봇 오프라인 → accCats에서 로드
      const saved=accCats[pubAccId]||[];
      setCategories(saved.map((c,i)=>({id:String(i),name:c})));
      return;
    }
    setLoadingCats(true); setCategories([]); setCategory("");
    try {
      const r = await botFetch(`${BOT}/api/${plat}/categories/${user.id}`, {method:"GET", signal: AbortSignal.timeout(30000)} as any);
      const d = await r.json();
      if (d.categories && d.categories.length>0) {
        setCategories(d.categories);
        // 봇에서 불러온 카테고리를 accCats에도 저장
        const names=d.categories.map((c:{id:string;name:string})=>c.name);
        saveAccCat(pubAccId, names);
      } else {
        // 봇 응답이 비었으면 저장된 accCats 사용
        const saved=accCats[pubAccId]||[];
        setCategories(saved.map((c,i)=>({id:String(i),name:c})));
      }
    } catch {
      const saved=accCats[pubAccId]||[];
      setCategories(saved.map((c,i)=>({id:String(i),name:c})));
    }
    finally { setLoadingCats(false); }
  }

  // ── 블록 조작 ──
  function updateBlock(id:string, updates:Partial<ContentBlock>){
    setBlocks(prev=>prev.map(b=>b.id===id?({...b,...updates} as ContentBlock):b));
  }
  function removeBlock(id:string){setBlocks(prev=>prev.filter(b=>b.id!==id));}
  function addTextBlock(afterId?:string){
    const nb:TextBlock={type:"text",id:uid(),content:""};
    if(!afterId){setBlocks(prev=>[...prev,nb]);return;}
    setBlocks(prev=>{const i=prev.findIndex(b=>b.id===afterId);const n=[...prev];n.splice(i+1,0,nb);return n;});
  }
  function addManualImageBlock(afterId?:string){
    const nb:SingleImageBlock={type:"image",id:uid(),src:"",alt:"",position:"center",source:"manual"};
    if(!afterId){setBlocks(prev=>[...prev,nb]);return;}
    setBlocks(prev=>{const i=prev.findIndex(b=>b.id===afterId);const n=[...prev];n.splice(i+1,0,nb);return n;});
  }

  // ── triggerAutoInsert (tarry 방식 그대로) ──
  function triggerAutoInsert(images:{id:number;src:string;alt?:string}[]){
    const textOnly=blocks.filter(b=>b.type==="text"||(b.type==="image"&&(b as SingleImageBlock).source==="manual"));
    const textBlocks=textOnly.filter(b=>b.type==="text");
    if(textBlocks.length===0)return;
    function hasSectionMarker(b:ContentBlock):boolean{
      if(b.type!=="text")return false;
      const c=(b as TextBlock).content;
      return c.includes("[FAQ시작]")||c.includes("[참고자료시작]")||c.includes("[관련글시작]");
    }
    const markerIdx=textOnly.findIndex(hasSectionMarker);
    const safeBlocks=markerIdx===-1?textOnly:textOnly.slice(0,markerIdx);
    const sectionBlocks=markerIdx===-1?[]:textOnly.slice(markerIdx);
    const safeTextCount=safeBlocks.filter(b=>b.type==="text").length;
    const imgs=images.filter(img=>img?.src&&img.src.trim()!=="");
    if(imgs.length===0)return;
    const result:ContentBlock[]=[];
    let insertedCount=0;
    // 첫 이미지 맨 앞 삽입 (썸네일)
    result.push({type:"image",id:uid(),src:imgs[0].src,alt:imgs[0].alt||"이미지 1",position:"center",source:"auto"} as ContentBlock);
    insertedCount++;
    const remainingImages=imgs.slice(1);
    const insertMap=new Map<number,typeof remainingImages>();
    if(safeTextCount>0&&remainingImages.length>0){
      remainingImages.forEach((img,index)=>{
        const targetTextIndex=Math.min(safeTextCount,Math.max(1,Math.ceil(((index+1)*safeTextCount)/remainingImages.length)));
        const bucket=insertMap.get(targetTextIndex)||[];bucket.push(img);insertMap.set(targetTextIndex,bucket);
      });
    }
    let textCount=0;
    for(let i=0;i<safeBlocks.length;i++){
      result.push(safeBlocks[i]);
      if(safeBlocks[i].type==="text"){
        textCount++;
        const toInsert=insertMap.get(textCount)||[];
        toInsert.forEach((img,idx)=>{result.push({type:"image",id:uid(),src:img.src,alt:img.alt||`이미지 ${insertedCount+idx+1}`,position:"center",source:"auto"} as ContentBlock);});
        insertedCount+=toInsert.length;
      }
    }
    if(insertedCount<imgs.length){
      const remaining=imgs.slice(insertedCount);
      let lastTextIdx=-1;
      for(let i=result.length-1;i>=0;i--){if(result[i].type==="text"){lastTextIdx=i;break;}}
      const insertAt=lastTextIdx>=0?lastTextIdx+1:result.length;
      remaining.reverse().forEach(img=>{result.splice(insertAt,0,{type:"image",id:uid(),src:img.src,alt:img.alt||"이미지",position:"center",source:"auto"} as ContentBlock);});
    }
    for(const b of sectionBlocks)result.push(b);
    setBlocks(result);setAutoInserted(true);
  }

  function handleAutoInsert(){
    const imgs=getActiveImages();
    if(imgs.length===0){alert("이미지를 먼저 생성해주세요");return;}
    triggerAutoInsert(imgs.map((src,i)=>({id:i,src,alt:`${keyword||genTitle} ${i===0?"대표":"현장"} 사진`})));
  }
  function handleRemoveAutoImages(){
    setBlocks(prev=>prev.filter(b=>b.type==="text"||(b.type==="image"&&(b as SingleImageBlock).source==="manual")));
    setAutoInserted(false);
  }

  // ── 네이버 복사 함수들 (tarry 방식) ──
  function addNaverImageMarkers(text:string):string{
    const hasRealImages=blocks.some(b=>(b.type==="image"&&(b as SingleImageBlock).src&&(b as SingleImageBlock).src.trim()!==""));
    if(hasRealImages)return text;
    const lines=text.split("\n").map(l=>l.trim()).filter(l=>l.length>0);
    if(lines.length<=1)return text;
    const CHUNK=300;const chunks:string[]=[];let buf="";
    for(const line of lines.slice(1)){
      if(buf.length>0&&buf.length+line.length+1>CHUNK){chunks.push(buf.trim());buf=line;}
      else{buf=buf?buf+"\n"+line:line;}
    }
    if(buf.trim())chunks.push(buf.trim());
    const result:string[]=[lines[0]];
    for(const chunk of chunks){result.push("📸 [여기에 사진 삽입]");result.push(chunk);}
    return result.join("\n\n");
  }

  function buildNaverText(mode:"full"|"faq"|"body"):string{
    const lines:string[]=[];
    if(pubTitle.trim())lines.push(pubTitle.trim()+"\n");
    if(greeting.trim())lines.push(greeting.trim()+"\n");
    blocks.forEach(b=>{
      if(b.type==="text"){
        let c=(b as TextBlock).content;
        if(mode==="body"){
          c=c.replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        }else if(mode==="faq"){
          c=c.replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        }
        c=c.replace(/^#{1,3}\s+/gm,"").replace(/\*\*(.*?)\*\*/g,"$1").replace(/\*(.*?)\*/g,"$1");
        if(c)lines.push(c);
      }else if(b.type==="image"&&(b as SingleImageBlock).src){lines.push("[이미지]");}
    });
    if(hashtags.length>0)lines.push("\n"+hashtags.join(" "));
    return addNaverImageMarkers(lines.filter(Boolean).join("\n"));
  }

  function copyForNaver(){navigator.clipboard.writeText(buildNaverText("full"));showToast("📋 전체 복사 완료!");}
  function copyForNaverWithFaq(){navigator.clipboard.writeText(buildNaverText("faq"));showToast("📋 본문+FAQ 복사 완료!");}
  function copyForNaverBodyOnly(){navigator.clipboard.writeText(buildNaverText("body"));showToast("📋 본문만 복사 완료!");}

  // ── HTML 빌더 (tarry 방식) ──
  function buildHtmlContent():string{
    function escHtml(t:string){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
    function inlineFmt(t:string){return escHtml(t).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>");}
    const parts:string[]=[];
    const sectionMarkerIdx=blocks.findIndex(b=>b.type==="text"&&((b as TextBlock).content.includes("[FAQ시작]")||(b as TextBlock).content.includes("[참고자료시작]")||(b as TextBlock).content.includes("[관련글시작]")));
    blocks.forEach((b,blockIdx)=>{
      const afterSection=sectionMarkerIdx!==-1&&blockIdx>=sectionMarkerIdx;
      if(b.type==="text"){
        const cleaned=(b as TextBlock).content
          .replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        if(cleaned){
          const html=cleaned.split("\n").map(line=>{
            const t=line.trim();if(!t)return"";
            if(/^##\s+/.test(t))return`<h2 style="font-size:20px;font-weight:800;margin:28px 0 12px;color:#111;border-bottom:2px solid #eee;padding-bottom:8px">${inlineFmt(t.replace(/^##\s+/,""))}</h2>`;
            if(/^###\s+/.test(t))return`<h3 style="font-size:17px;font-weight:700;margin:20px 0 8px;color:#1a1a1a;border-left:4px solid #2563eb;padding-left:10px">${inlineFmt(t.replace(/^###\s+/,""))}</h3>`;
            if(/^---+$/.test(t))return`<hr style="border:none;border-top:2px solid #eee;margin:20px 0">`;
            return`<p style="line-height:1.9;margin:0 0 14px;color:#333;font-size:16px">${inlineFmt(t)}</p>`;
          }).filter(Boolean).join("\n");
          if(html)parts.push(html);
        }
      }else if(b.type==="image"&&!afterSection){
        const src=(b as SingleImageBlock).src;const alt=(b as SingleImageBlock).alt;
        if(src)parts.push(`<div style="padding:24px 0"><figure style="margin:0;text-align:center"><img src="${escHtml(src)}" alt="${escHtml(alt||"")}" style="width:100%;border-radius:12px;display:block">${alt?`<figcaption style="font-size:12px;color:#888;text-align:center;margin-top:6px">${inlineFmt(alt)}</figcaption>`:""}</figure></div>`);
      }
    });
    if(hashtags.length>0)parts.push(`<p style="margin-top:20px;color:#888;font-size:14px">${hashtags.join(" ")}</p>`);
    return parts.join("\n");
  }

  // ── 미리보기 렌더 ──
  function renderPreview(text:string):React.ReactElement[]{
    const sectionTags=["[FAQ시작]","[관련글시작]","[참고자료시작]"];
    const sectionStart=sectionTags.reduce((min,tag)=>{const i=text.indexOf(tag);return(i>-1&&i<min)?i:min;},Infinity);
    const body=sectionStart<Infinity?text.slice(0,sectionStart).trim():text;
    const section=sectionStart<Infinity?text.slice(sectionStart).trim():"";
    const renderLines=(t:string,offset:number)=>t.split("\n").map((line,i)=>{
      if(line.startsWith("## "))return<h2 key={offset+i} style={{fontSize:18,fontWeight:800,margin:"20px 0 8px",color:"#111"}}>{line.slice(3)}</h2>;
      if(line.startsWith("### "))return<h3 key={offset+i} style={{fontSize:16,fontWeight:700,margin:"16px 0 6px",color:"#222"}}>{line.slice(4)}</h3>;
      if(line==="---")return<hr key={offset+i} style={{border:"none",borderTop:"1px solid #ddd",margin:"16px 0"}}/>;
      if(line==="")return<br key={offset+i}/>;
      if(sectionTags.some(t=>line.includes(t)))return<div key={offset+i} style={{display:"none"}}/>;
      return<p key={offset+i} style={{marginBottom:8,fontSize:14,lineHeight:1.8,color:"#333"}}>{line}</p>;
    });
    return[...renderLines(body,0),section?<hr key="sep" style={{border:"none",borderTop:"1px solid #eee",margin:"20px 0"}}/>:<span key="no-sep"/>, ...renderLines(section,10000)];
  }

    async function handleChangePw() {
    if (!currentPw || !newPw1 || !newPw2) { setPwMsg("모든 항목을 입력하세요"); return; }
    if (newPw1 !== newPw2) { setPwMsg("새 비밀번호가 일치하지 않습니다"); return; }
    if (newPw1.length < 6) { setPwMsg("비밀번호는 6자 이상이어야 합니다"); return; }
    setPwChanging(true); setPwMsg("");
    try {
      await changeUserPassword(user.id, currentPw, newPw1);
      setCurrentPw(""); setNewPw1(""); setNewPw2("");
      setPwMsg("✅ 비밀번호가 변경됐어요!");
      setTimeout(() => setPwMsg(""), 4000);
    } catch (e: any) {
      setPwMsg("❌ " + e.message);
    } finally { setPwChanging(false); }
  }

  // ── Ctrl+V 클립보드 이미지 붙여넣기 ──
  useEffect(()=>{
    const handlePaste=(e:ClipboardEvent)=>{
      if(tab!=="publish")return;
      const items=Array.from(e.clipboardData?.items||[]);
      const imgItem=items.find(i=>i.type.startsWith("image/"));
      if(!imgItem)return;
      const file=imgItem.getAsFile();
      if(!file)return;
      const reader=new FileReader();
      reader.onload=ev=>{
        const src=ev.target?.result as string;
        const newBlock:SingleImageBlock={id:Date.now().toString(),type:"image",src,alt:keyword||"붙여넣기 이미지",position:"center",source:"manual"};
        setBlocks(p=>[...p,newBlock]);
        showToast("📋 이미지가 본문에 추가됐어요!");
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener("paste",handlePaste);
    return ()=>window.removeEventListener("paste",handlePaste);
  },[tab,keyword]);

  // 공지 팝업 로드
  useEffect(()=>{
    (async()=>{
      try{
        const {data}=await supabase.from("publy_settings").select("value").eq("key","global_notice").maybeSingle();
        if(data?.value){
          const n=JSON.parse(data.value);
          if(n.active){
            const dismissed=localStorage.getItem("publy_dismissed_"+n.created_at);
            if(!dismissed) setNoticePopup({title:n.title,body:n.body,key:n.created_at});
          }
        }
      }catch{}
    })();
  },[]);

  // 봇 시크릿 로드 (Electron 환경에서만)
  useEffect(()=>{
    window.electron?.getBotSecret().then(s=>{if(s) setBotSecret(s);}).catch(()=>{});
  },[]);

  // 봇 API 인증 헤더 포함 fetch 헬퍼
  const botFetch = useCallback((url: string, opts: RequestInit = {}) => {
    const headers: Record<string,string> = {
      "Content-Type": "application/json",
      ...(opts.headers as Record<string,string> || {}),
    };
    if (botSecret) headers["X-Bot-Secret"] = botSecret;
    return fetch(url, { ...opts, headers });
  }, [botSecret]);

  const checkBot = useCallback(async()=>{
    try{const r=await fetch(`${BOT}/health`,{signal:AbortSignal.timeout(3000)});setBotOnline(r.ok);}
    catch{setBotOnline(false);}
  },[]);

  function loadReferrals() {
    if (referralLoaded) return;
    supabase.from("publy_users").select("id,name,email,plan,created_at").eq("referred_by", user.id)
      .then(({data}) => { setMyReferrals(data||[]); setReferralLoaded(true); });
  }

  // 설정탭 열 때 네이버 키 로드
  useEffect(()=>{
    if(tab==="settings"){
      loadReferrals();
      getUserNaverApiKeys(user.id).then(setNaverKeys).catch(()=>{});
    }
  },[tab,user.id]);

  useEffect(()=>{
    checkBot();
    getAccounts(user.id).then(setAccounts);
    getHistory(user.id).then(setHistory);
    getQuota(user.id).then((q:PublyQuota|null)=>q&&setQuota(q));
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
  const NP_TAG = "zero people, absolutely no humans, no person, no face, no hands, no body parts, no text, no watermark, object only";
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
    {keywords:["퍼스널컬러","봄웜","여름쿨","가을웜","겨울쿨","웜톤","쿨톤","계절진단","색조진단","퍼컬"],prompt:"color analysis swatches, seasonal color palette spread on white surface, fabric swatches in warm cool tones, beauty color wheel editorial flat lay, soft diffused natural light, no text"},
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
      // AI 메타 주석 제거 (Self-correction, Character count 등)
      .replace(/<!--[\s\S]*?-->/g,"")
      .replace(/\(Self-correction:[\s\S]*?\)/gi,"")
      .replace(/\(self correction:[\s\S]*?\)/gi,"")
      .replace(/\(.*?character count.*?\)/gi,"")
      .replace(/\(.*?I've used.*?\)/gi,"")
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
      // 문장 안 영어 단어 제거: 한글 사이에 끼어든 영어 단어 (브랜드명 예외 최소화)
      .replace(/(^|[\s,.])[A-Za-z]{4,}(?=[\s,.]|$)/g,"$1")
      // 줄 전체가 영어인 경우 제거
      .replace(/^[A-Za-z\s\d.,!?'"-]{10,}$/gm,"")
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
      const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:signal||AbortSignal.timeout(90000)});
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

  function calcTitleScore(title:string):number{
    let score=0;
    const len=title.length;
    // 적정 길이 (25~42자)
    if(len>=25&&len<=42)score+=30;else if(len>=20&&len<=50)score+=15;
    // 숫자 포함 (BEST 7, TOP 5 등)
    if(/[0-9]/.test(title))score+=20;
    // 상업적/클릭유발 단어
    if(/추천|리뷰|후기|방법|비결|솔직|이것만|꿀팁|실패|성공|필수|완벽|최고|진짜|효과|비교/.test(title))score+=25;
    // 경험공유형
    if(/써봤|해봤|다녀온|먹어본|가봤|사봤|써보니|해보니/.test(title))score+=15;
    // 질문형/호기심
    if(/\?|왜|어떻게|언제|어디|뭐가|무엇이/.test(title))score+=10;
    return Math.min(100,score);
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
      ?`당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${keyword.trim()}"\n\n제목 30개를 JSON 배열로만 반환하세요.\n- 키워드 반드시 포함\n- 15~25자 이내 (짧고 강렬하게)\n- 숫자 필수 (BEST 5, TOP 3, 7가지 등)\n- 클릭 유발어 ("솔직히","이것만","나만 알던","진짜","꿀팁")\n- 경험 공유형 ("써봤어요","해봤더니","알고보니")\n- 불필요한 수식어 금지\n\nJSON 배열만 반환.`
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
    setGenerating(true);abortRef.current=new AbortController();setQualityScore(null);

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
    const styleGuide=WRITE_STYLE_GUIDE[writeStyle]||"";
    const personaGuide=PERSONA_STYLES.find(p=>p.id===persona)?.prompt||"";
    const templateGuide=BLOG_TEMPLATES.find(t=>t.id===blogTemplate)?.guide||"";
    const prompt=`당신은 대한민국 최고의 블로그 작가입니다.

키워드: "${keyword}"  제목: "${title}"
목표 글자수: ${chars}자 내외 (±100자, 반드시 이 범위 안에서 작성)

${catGuide}

=== 절대 규칙 ===
⛔ ## 기호 완전 금지 (소제목은 그냥 텍스트로)
⛔ ** * - + 마크다운 기호 전부 금지
⛔ 한자,중국어,일본어 금지
⛔ 영어 단어 절대 금지 — 브랜드명·제품명 제외 100% 순수 한국어로만 작성
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
${styleGuide}${personaGuide?"\n\n[말투/페르소나]\n"+personaGuide:""}${templateGuide?"\n\n"+templateGuide:""}

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
      const body=bm?bm[1].trim():cleaned;setGenContent(body);setQualityScore(calcQualityScore(body,keyword));
      if(imgCountAuto)setImgCount(recommendImgCount(body));
      // ── tarry 방식: 블록 자동 분리 + 제목/태그 자동 연동 ──
      const rawBlocks = body.split("\n\n").filter(Boolean).map(p=>({type:"text" as const,id:uid(),content:p}));
      setBlocks(rawBlocks.length>0?rawBlocks:[{type:"text",id:uid(),content:body}]);
      setPubTitle(title);
      if(tgm)setHashtags(tgm[1].trim().split(",").map((t:string)=>{const clean=t.trim().replace(/\s+/g,"");return clean.startsWith("#")?clean:"#"+clean;}).filter(Boolean).slice(0,Math.floor(Math.random()*4)+5));
      setAutoInserted(false);setThumbnail("");
    }catch(e:any){if(e.name!=="AbortError"){showToast("❌ 글 생성 실패: "+e.message+" (오류가 관리자에게 자동 전달됩니다)","error");logError({user_id:user.id,user_name:(user as any).name||"",user_email:user.email||"",feature:"글 생성",error_message:e.message}).catch(()=>{});}}
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
      // 이미지 생성 완료 시 캡션 자동생성 + 블록 자동배치 + 썸네일 자동지정
      setCaptions(buildCaptions(keyword||genTitle,imgs.length));
      if(imgs.length>0){
        if(!thumbnail)setThumbnail(imgs[0]);
        triggerAutoInsert(imgs.map((src,i)=>({id:i,src,alt:`${keyword||genTitle} ${i===0?"대표":"현장"} 사진`})));
        setShowMeta(true); // 이미지 생성 완료 → 썸네일+인사말 자동 펼침
      }
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
    // tarry 방식: 블록 기반 HTML 빌드
    if(blocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim()))return buildHtmlContent();
    if(!genContent)return "";
    // pubScope 기준으로 발행 범위 결정
    if(pubScope==="body"){
      let t=genContent;
      t=t.replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
      return t;
    }
    if(pubScope==="faq"){
      let t=genContent;
      t=t.replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
      return t;
    }
    return genContent;
  }

  async function handlePublish(){
    if(!pubAccId||!pubTitle){alert("계정과 제목을 확인해주세요");return;}
    const content=buildPublishContent();if(!content){alert("발행할 내용이 없어요");return;}
    if(scheduleOn&&!scheduleTime){alert("예약 날짜와 시간을 선택해주세요");return;}
    setPublishing(true);showToast(scheduleOn?"예약 설정 중...":"발행 중...","info");
    const tags=hashtags.map(t=>t.replace("#","")).filter(Boolean);
    const publishBody={
      userId:user.id,platform,title:pubTitle,content,
      tags,
      imageUrl:thumbnail||getActiveImages()[0]||undefined,
      categoryId:category||undefined,
      visibility,
      scheduleTime:scheduleOn?scheduleTime:undefined,
      blocks:blocks.map(b=>{
        if(b.type==="text")return{type:"text",content:(b as TextBlock).content};
        if(b.type==="image")return{type:"image",src:(b as SingleImageBlock).src,alt:(b as SingleImageBlock).alt||""};
        return null;
      }).filter(Boolean),
    };
    try{
      const ok=await useQuota(user.id);if(!ok){showToast("❌ 발행 건수 초과","error");setPublishing(false);return;}
      if(!botOnline){
        await supabase.from("publy_jobs").insert({user_id:user.id,platform,title:pubTitle,content,
          tags,image_url:thumbnail||getActiveImages()[0]||undefined,
          category_id:category||undefined,visibility,
          schedule_time:scheduleOn?scheduleTime:undefined,status:"pending"});
        showToast("✅ PC 봇에 예약됐어요! Publy 앱 실행 시 자동 발행돼요.");
        await addHistory({user_id:user.id,platform,title:pubTitle,status:"pending" as "success"|"fail"});
      }else{
        const r=await botFetch(`${BOT}/api/publish-full`,{method:"POST",body:JSON.stringify(publishBody)});
        const d=await r.json();
        if(r.status===401){showToast("❌ 세션 만료 — 계정 관리 탭에서 재연결해주세요","error");setPublishing(false);return;}
        if(!r.ok)throw new Error(d.error);
        await addHistory({user_id:user.id,platform,title:pubTitle,post_url:d.postUrl,status:"success"});
        setPubMsg(scheduleOn?"✅ 예약 완료! 설정한 시간에 자동 발행돼요.":"✅ 발행 완료!");
        showToast(scheduleOn?"⏰ 예약 완료!":"✅ 발행 완료! 🎉");
      }
      getHistory(user.id).then(setHistory);getQuota(user.id).then((q:PublyQuota|null)=>q&&setQuota(q));
    }catch(e:any){await addHistory({user_id:user.id,platform,title:pubTitle,status:"fail",error_message:e.message});setPubMsg("❌ "+e.message+" (오류가 관리자에게 자동 전달됩니다)");showToast("❌ "+e.message,"error");logError({user_id:user.id,user_name:(user as any).name||"",user_email:user.email||"",feature:"블로그 발행 ("+platform+")",error_message:e.message}).catch(()=>{});}
    finally{setPublishing(false);}
  }

  // ── 발행 패널 렌더 함수 ──
  function renderPublishPanel(){
    return(<>
      {/* 플랫폼 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>🌐 플랫폼</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {([{p:"naver",ico:"🟢",name:"네이버",c:"var(--naver)"},{p:"tistory",ico:"🟠",name:"티스토리",c:"var(--tistory)"}] as const).map(({p,ico,name,c})=>(
            <button key={p} onClick={()=>{setPlatform(p);if(pubAccId)loadCategories(p);}} style={{padding:"12px 10px",borderRadius:10,border:`2px solid ${platform===p?c:"var(--border)"}`,background:platform===p?`${c}18`:"var(--bg)",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all .15s",whiteSpace:"nowrap",overflow:"hidden"}}>
              <span style={{fontSize:18,flexShrink:0}}>{ico}</span>
              <span style={{fontSize:13,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span>
              {platform===p&&<span style={{color:c,fontSize:12,flexShrink:0}}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 계정 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>🔗 발행 계정</div>
        {connAccs.length===0?(
          <div style={{textAlign:"center",padding:"16px"}}>
            <div style={{fontSize:13,color:"var(--text3)",marginBottom:10}}>연결된 계정이 없어요</div>
            <button className="btn btn-primary btn-sm" onClick={()=>setTab("accounts")}>계정 관리 →</button>
          </div>
        ):connAccs.map(a=>(
          <label key={a.id} onClick={()=>{setPubAccId(a.id);loadCategories(platform);}} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,cursor:"pointer",marginBottom:6,background:pubAccId===a.id?"var(--accent-bg)":"var(--bg)",border:`2px solid ${pubAccId===a.id?"var(--accent)":"var(--border)"}`,transition:"all .15s"}}>
            <input type="radio" name="pacc" checked={pubAccId===a.id} onChange={()=>{}} style={{accentColor:"var(--accent)",width:16,height:16,flexShrink:0}}/>
            <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{a.username}</div>{a.blog_name&&<div style={{fontSize:11,color:"var(--text3)"}}>{a.blog_name}</div>}</div>
            {pubAccId===a.id&&<span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>✅</span>}
          </label>
        ))}
      </div>

      {/* 카테고리 */}
      {pubAccId&&(
        <div className="card" style={{padding:"14px 16px"}}>
          <div className="card-title" style={{marginBottom:10}}>📂 카테고리</div>
          {loadingCats?(
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px",color:"var(--text3)",fontSize:13}}><span className="spinner" style={{width:16,height:16}}/>불러오는 중...</div>
          ):(()=>{
            const cats = categories.length>0 ? categories : (accCats[pubAccId]||[]).map((c,i)=>({id:String(i),name:c}));
            return cats.length===0?(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:12,color:"var(--text3)",textAlign:"center"}}>카테고리 없음 (기본 발행)</div>
                <button className="btn btn-secondary btn-sm" onClick={()=>loadCategories(platform)}>🔄 불러오기</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setTab("accounts")} style={{fontSize:11}}>📂 계정 관리에서 직접 입력</button>
              </div>
            ):(
              <select value={category} onChange={e=>setCategory(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:14,fontFamily:"inherit",outline:"none"}}>
                <option value="">선택 안 함 (기본)</option>
                {cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            );
          })()}
        </div>
      )}

      {/* 발행 범위 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>📝 발행 범위</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {([
            {v:"body",ico:"✍️",label:"본문 + 해시태그",desc:"관련글/링크/질문 제외"},
            {v:"faq",ico:"❓",label:"본문 + FAQ + 해시태그",desc:"관련글/링크만 제외"},
            {v:"full",ico:"📄",label:"전체 발행",desc:"모든 섹션 포함"},
          ] as {v:string,ico:string,label:string,desc:string}[]).map(opt=>(
            <button key={opt.v} onClick={()=>setPubScope(opt.v as "body"|"faq"|"full")} style={{padding:"11px 14px",borderRadius:10,border:`2px solid ${pubScope===opt.v?"var(--accent)":"var(--border)"}`,background:pubScope===opt.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18,flexShrink:0}}>{opt.ico}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:pubScope===opt.v?"var(--accent-text)":"var(--text)"}}>{opt.label}</div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{opt.desc}</div>
              </div>
              {pubScope===opt.v&&<span style={{color:"var(--accent-text)",flexShrink:0}}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 공개 설정 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div className="card-title" style={{marginBottom:10}}>👁️ 공개 설정</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {(platform==="naver"?[{v:"public",ico:"🌍",label:"전체 공개"},{v:"neighbor",ico:"👥",label:"이웃 공개"},{v:"private",ico:"🔒",label:"비공개"}]:[{v:"public",ico:"🌍",label:"전체 공개"},{v:"private",ico:"🔒",label:"비공개"}] as {v:string,ico:string,label:string}[]).map(opt=>(
            <button key={opt.v} onClick={()=>setVisibility(opt.v as "public"|"neighbor"|"private")} style={{padding:"11px 14px",borderRadius:10,border:`2px solid ${visibility===opt.v?"var(--accent)":"var(--border)"}`,background:visibility===opt.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .15s",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>{opt.ico}</span>
              <span style={{fontSize:13,fontWeight:600,color:visibility===opt.v?"var(--accent-text)":"var(--text)"}}>{opt.label}</span>
              {visibility===opt.v&&<span style={{marginLeft:"auto",color:"var(--accent-text)"}}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 예약 발행 */}
      <div className="card" style={{padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:scheduleOn?12:0}}>
          <div>
            <div className="card-title" style={{margin:0}}>⏰ 예약 발행</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>설정 시간에 자동 발행</div>
          </div>
          <button onClick={()=>{setScheduleOn(v=>!v);if(!scheduleTime){const d=new Date();d.setHours(d.getHours()+1,0,0,0);setScheduleTime(d.toISOString().slice(0,16));}}} style={{width:48,height:26,borderRadius:99,background:scheduleOn?"var(--accent)":"var(--border)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:scheduleOn?24:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.3)"}}/>
          </button>
        </div>
        {scheduleOn&&(
          <div>
            <input type="datetime-local" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)} min={new Date().toISOString().slice(0,16)} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"2px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            {scheduleTime&&<div style={{marginTop:8,padding:"10px 12px",borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,color:"var(--accent-text)",fontWeight:600}}>
              ✅ {new Date(scheduleTime).toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"})} {new Date(scheduleTime).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} 발행
            </div>}
          </div>
        )}
      </div>

      {/* 발행 버튼 */}
      <button onClick={handlePublish} disabled={publishing||!pubAccId||!pubTitle||!buildPublishContent()||(quota!==null&&(quota.remaining_quota||0)<=0)||(scheduleOn&&!scheduleTime)} className="btn btn-primary btn-full btn-xl pub-submit-btn">
        {publishing
          ?<><span className="spinner"/>{scheduleOn?"예약 중...":"발행 중..."}</>
          :scheduleOn?<>⏰ 예약 발행 설정하기</>:<>🚀 블로그 자동 발행</>
        }
      </button>
    </>);
  }

  function saveAccCat(accId:string, cats:string[]){
    const next={...accCats,[accId]:cats};
    setAccCats(next);
    localStorage.setItem("publy_acc_cats",JSON.stringify(next));
  }
  function addCatToAcc(accId:string){
    const val=catInput.trim();if(!val)return;
    const cur=accCats[accId]||[];
    if(cur.includes(val))return;
    saveAccCat(accId,[...cur,val]);
    setCatInput("");
  }
  function removeCatFromAcc(accId:string, cat:string){
    saveAccCat(accId,(accCats[accId]||[]).filter(c=>c!==cat));
  }

  async function handleAddAccount(){
    if(!newUser||!newPw)return;setAddingAcc(true);
    try{await upsertAccount({user_id:user.id,platform:newPlat,username:newUser,password_encrypted:btoa(newPw),blog_name:newBlog||undefined,is_connected:false});getAccounts(user.id).then(setAccounts);setNewUser("");setNewPw("");setNewBlog("");}
    catch(e:any){alert(e.message);}finally{setAddingAcc(false);}
  }
  async function handleConnect(acc:PublyAccount){
    if(!botOnline){alert("PC에서 Publy 앱을 먼저 실행해주세요");return;}setConnId(acc.id);
    try{
      const r=await fetch(`${BOT}/api/${acc.platform}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:acc.user_id,id:acc.username,pw:atob((acc as any).password_encrypted||""),blogName:acc.blog_name}),signal:AbortSignal.timeout(120000)});
      const d=await r.json();if(!d.success)throw new Error(d.error||"연결 실패");
      getAccounts(user.id).then(setAccounts);
    }catch(e:any){alert("연결 실패: "+e.message);}finally{setConnId(null);}
  }
  async function generateFromPhotos() {
    if(photoFiles.length===0){showToast("사진을 먼저 업로드해주세요","error");return;}
    const geminiKey=localStorage.getItem("publy_gemini_key")||"";
    if(!geminiKey){showToast("설정에서 Gemini API 키를 입력해주세요","error");return;}
    setPhotoGenerating(true);setPhotoGenDone(false);

    try {
      // 이미지 parts 구성 (최대 10장만 Vision에 전송 - API 제한)
      const imgParts = photoFiles.slice(0,10).map(f=>{
        const b64 = f.src.split(",")[1]||f.src;
        const mime = f.src.startsWith("data:image/png")?"image/png":"image/jpeg";
        return {inlineData:{mimeType:mime,data:b64}};
      });

      const keypointText = photoKeypoints.trim()
        ? `

[작성자 키포인트]
${photoKeypoints.trim()}`
        : "";

      const styleGuide = WRITE_STYLE_GUIDE[writeStyle]||"";
      const personaGuide = PERSONA_STYLES.find(p=>p.id===persona)?.prompt||"";

      const prompt = `당신은 대한민국 최고의 블로그 작가입니다. 첨부된 사진들을 자세히 분석하여 네이버 블로그 글을 작성해주세요.

사진 속 모든 디테일(색상, 분위기, 장소, 음식, 사람, 배경 등)을 실제로 경험한 것처럼 생생하게 묘사해주세요.${keypointText}

=== 절대 규칙 ===
⛔ ## 기호 완전 금지 (소제목은 그냥 텍스트로)
⛔ ** * 마크다운 기호 전부 금지
⛔ AI 티 나는 표현 금지 (다양한, 효과적인, 중요합니다 등)
⛔ 영어 단어 금지 (브랜드명 제외)
✅ 사진에서 직접 보이는 것을 구체적으로 묘사
✅ 독자에게 말 걸듯 친근하게
✅ 구체적 수치, 가격, 시간 포함
✅ 문장 끝: ~해요, ~거든요, ~더라고요 다양하게

${styleGuide}
${personaGuide?`
[말투]
${personaGuide}`:""}

=== 출력 형식 (반드시 준수) ===
제목: (SEO 최적화 제목, 15~25자)
태그: 태그1, 태그2, 태그3, 태그4, 태그5

(본문 1500자 이상 - 사진 묘사 기반 자연스러운 글)

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

      const body = {
        contents:[{parts:[...imgParts,{text:prompt}]}],
        generationConfig:{maxOutputTokens:4000,temperature:0.9}
      };

      // tarry 방식 - 여러 모델 순서대로 시도
      // tarry 방식 모델 폴백
      const MODELS = ["gemini-2.0-flash","gemini-2.5-flash","gemini-1.5-flash"];
      let data:any = null;
      for(const model of MODELS){
        try{
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}
          );
          if(!r.ok) continue;
          const d = await r.json();
          if(d.candidates?.[0]?.content?.parts?.[0]?.text){data=d;break;}
        }catch{}
      }
      if(!data?.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error("생성 실패. Gemini 키를 확인하거나 잠시 후 다시 시도해주세요.");
      const text = data.candidates[0].content.parts[0].text;

      const titleM = text.match(/제목[^\n]+/);
      const tagM = text.match(/태그[^\n]+/);
      const bodyM = text.match(/태그[^\n]*\n([\s\S]+)/);



      const title = titleM?.[1]?.trim()||"사진으로 작성된 글";
      if(tagM){
        setHashtags(tagM[1].trim().split(",").map((t:string)=>{
          const clean=t.trim().replace(/\s+/g,"");
          return clean.startsWith("#")?clean:"#"+clean;
        }).filter(Boolean).slice(0,Math.floor(Math.random()*4)+5));
      }

      const body2 = bodyM?.[1]?.trim()||text;
      setGenContent(body2);
      setGenTitle(title);
      setPubTitle(title);

      // 블록 구성
      const rawBlocks = body2.split("\n\n").filter(Boolean).map((p:string)=>({type:"text" as const,id:uid(),content:p}));


      setBlocks(rawBlocks.length>0?rawBlocks:[{type:"text",id:uid(),content:body2}]);

      // 사진을 블록에 삽입 (패턴에 따라)
      if(photoFiles.length>0){
        const imgs = photoFiles.map((f,i)=>({id:i,src:f.src,alt:f.name.replace(/\.[^.]+$/,"")}));
        triggerAutoInsert(imgs);
        // 첫 번째 사진을 썸네일로
        setThumbnail(photoFiles[0].src);
      }

      setQualityScore(calcQualityScore(body2, photoKeypoints.split(/[\s,]/)[0]||""));
      setPhotoGenDone(true);
      setAutoInserted(true);
      showToast("✅ 사진 기반 글 생성 완료!", "success");
    } catch(e:any) {
      showToast("❌ 생성 실패: "+e.message+" (오류가 관리자에게 자동 전달됩니다)", "error");logError({user_id:user.id,user_name:(user as any).name||"",user_email:user.email||"",feature:"사진 글쓰기",error_message:e.message}).catch(()=>{});
    } finally {
      setPhotoGenerating(false);
    }
  }

  function handlePhotoUpload(files: FileList|null) {
    if(!files)return;
    const arr = Array.from(files).slice(0, 20 - photoFiles.length);
    arr.forEach(file=>{
      if(!file.type.startsWith("image/"))return;
      const reader = new FileReader();
      reader.onload = ev=>{
        const src = ev.target?.result as string;
        setPhotoFiles(prev=>{
          if(prev.length>=20)return prev;
          return [...prev,{id:uid(),src,name:file.name}];
        });
      };
      reader.readAsDataURL(file);
    });
  }

    function openPreview(){
    const sectionTags=["[FAQ시작]","[관련글시작]","[참고자료시작]"];
    // blocks가 비어있으면 genContent로 임시 블록 구성
    const previewBlocks = blocks.length > 0 ? blocks :
      genContent ? [{type:"text" as const, id:"tmp", content:genContent}] : [];
    const blocksHtml=previewBlocks.map((b:any)=>{
      if(b.type==="text"){
        const txt=(b as TextBlock).content;
        const secStart=sectionTags.reduce((min,tag)=>{const i=txt.indexOf(tag);return i>-1&&i<min?i:min;},Infinity);
        const body=secStart<Infinity?txt.slice(0,secStart).trim():txt;
        const sec=secStart<Infinity?txt.slice(secStart).trim():"";
        const toHtml=(t:string)=>t.split("\n").filter(l=>l.trim()&&!sectionTags.some(tag=>l.includes(tag))).map(line=>{
          if(line.startsWith("## "))return`<h2>${line.slice(3)}</h2>`;
          if(line.startsWith("### "))return`<h3>${line.slice(4)}</h3>`;
          if(line==="---")return`<hr/>`;
          return`<p>${line}</p>`;
        }).join("");
        return toHtml(body)+(sec?`<div class="section-box">${toHtml(sec)}</div>`:"");
      }
      const ib=b as SingleImageBlock;
      return ib.src?`<figure><img src="${ib.src}" alt="${ib.alt||""}"/>${ib.alt?`<figcaption>${ib.alt}</figcaption>`:""}</figure>`:"";
    }).join("");
    const tagsHtml=hashtags.length>0?`<div class="tags">${hashtags.map(t=>`<span class="tag">${t.startsWith("#")?t:"#"+t}</span>`).join("")}</div>`:"";
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>미리보기</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#f5f5f5;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:20px}h1{font-size:24px;font-weight:900;color:#111;margin-bottom:16px;line-height:1.35;word-break:keep-all}.card{max-width:680px;margin:0 auto;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h2{font-size:18px;font-weight:800;margin:24px 0 10px;color:#111;border-bottom:2px solid #eee;padding-bottom:8px}h3{font-size:15px;font-weight:700;margin:18px 0 8px;color:#222;border-left:4px solid #2563eb;padding-left:10px}p{margin:0 0 12px;font-size:15px;line-height:1.9;color:#333;word-break:keep-all}img{width:100%;border-radius:10px;display:block;margin:16px 0}figure{margin:16px 0}figcaption{font-size:11px;color:#999;text-align:center;margin-top:4px}.tags{margin-top:20px;display:flex;flex-wrap:wrap;gap:6px}.tag{font-size:12px;padding:3px 10px;border-radius:99px;background:#f0f4ff;color:#2563eb;font-weight:600}.section-box{margin-top:20px;padding:16px;background:#f8f8f8;border-radius:12px;border-left:4px solid #ddd}hr{border:none;border-top:1px solid #eee;margin:16px 0}</style></head><body><div class="card">${pubTitle?`<h1>${pubTitle}</h1>`:""}${thumbnail?`<img src="${thumbnail}" alt="썸네일"/>`:""}${blocksHtml}${tagsHtml}</div></body></html>`;
    // Electron IPC로 새 창 열기
    if((window as any).electron?.openPreview){
      (window as any).electron.openPreview(html);
    } else {
      const w=window.open("","_blank","width=900,height=960,scrollbars=yes");
      if(w){w.document.write(html);w.document.close();}
    }
  }

  async function handleDeleteAccount(id:string){
    if(!confirm("이 계정을 삭제할까요?"))return;
    await supabase.from("publy_accounts").delete().eq("id",id);getAccounts(user.id).then(setAccounts);
  }

  const quotaPct=quota?Math.min(100,(quota.used_quota/quota.total_quota)*100):0;
  const connAccs=accounts.filter(a=>a.platform===platform&&(botOnline?a.is_connected:true));
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
        <div className="g-step-desc">오른쪽 패널에 <b style={{color:G}}>● 온라인</b>이 보여야 즉시 발행! 오프라인이면 자동으로 대기열에 저장돼요 😊</div>
      </div>
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:G}}>✅ 발행 순서 (이거 하나면 끝!)</div>
        <div className="g-step-title" style={{color:"#fff"}}>순서대로만 하면 돼요</div>
        <div className="g-step-desc">
          {[["① 이미지 생성 후 발행탭 이동","이미지가 자동으로 글 사이에 배치돼요. 썸네일도 자동 설정!"],["② 오른쪽 패널에서 계정·플랫폼 선택","네이버 또는 티스토리, 연결된 계정 선택"],["③ 발행 방식 선택","전체/본문+FAQ/본문만 — 오른쪽 패널에서 선택"],["④ 🚀 발행 버튼 클릭","오른쪽 아래 큰 초록 버튼!"]].map(([t,d],i)=>(
            <div key={i} style={{display:"flex",gap:8,padding:"8px 0",borderBottom:i<3?"1px solid rgba(255,255,255,.06)":"none"}}>
              <div><div style={{fontSize:14,fontWeight:800,color:"#fff"}}>{t}</div><div style={{fontSize:13,color:"rgba(255,255,255,.6)",marginTop:2}}>{d}</div></div>
            </div>
          ))}
        </div>
        <button className="g-btn" style={{background:`linear-gradient(135deg,${G},#00c870)`,color:"#000"}} onClick={()=>{setShowGuide(false);setTab("accounts");}}>🔗 계정 연결하러 가기</button>
      </div>
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:Y}}>🖼️ 이미지+글 패턴 확인</div>
        <div className="g-step-title" style={{color:"#fff"}}>본문 편집기에서 눈으로 확인하세요</div>
        <div className="g-step-desc">이미지와 글이 섞인 순서가 보여요. 위치가 마음에 안 들면 블록 옆 <b>🖼️ 버튼</b>으로 직접 조정!</div>
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
        {q:"설치할 때 'Publy cannot be closed' 문구가 떠요",a:"이전에 실행 중인 Publy가 완전히 종료되지 않은 거예요.\n방법: 키보드 Ctrl+Shift+Esc 누르기 → 프로세스 탭에서 Publy 찾기 → 마우스 우클릭 → 작업 끝내기 → 다시 시도 클릭",c:"#f85149"},
        {q:"봇이 오프라인으로 계속 뜨면요?",a:"PC에서 Publy 앱이 실행 중인지 확인하세요. 앱을 껐다 켜면 봇이 자동으로 켜져요.",c:"#ff8c00"},
        {q:"오류가 났는데 어떻게 해요?",a:"걱정 마세요! 오류가 생기면 관리자에게 자동으로 전달돼요. 잠깐 기다렸다가 다시 시도해 보세요.",c:"#4ECDC4"},
      ].map((item,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${item.c}55`,background:`${item.c}15`,marginBottom:10,padding:"14px 16px"}}>
          <div style={{fontSize:13,fontWeight:900,color:item.c,marginBottom:6}}>Q. {item.q}</div>
          <div style={{fontSize:13,color:"#ddd",lineHeight:1.8,whiteSpace:"pre-line"}}>👉 {item.a}</div>
        </div>
      ))}
    </div>,
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className={`app ${theme} ${fontMode==="large"?"large":""}`}>

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



        {/* ── 헤더 ── */}
        <div className="header">
          <a className="logo" href="#" onClick={e=>e.preventDefault()}>
            <div className="logo-ico" style={{fontSize:17,fontWeight:900,color:"#000"}}>P</div>
            <span className="logo-text">PUBLY</span>
          </a>
          <div className="header-mid">
            <button className={`plat-btn ${platform==="naver"?"plat-btn-naver":"plat-btn-naver-off"}`} onClick={()=>setPlatform("naver")}>🟢 네이버</button>
            <button className={`plat-btn ${platform==="tistory"?"plat-btn-tistory":"plat-btn-tistory-off"}`} onClick={()=>setPlatform("tistory")}>🟠 티스토리</button>
            <div style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
            <div className={`server-chip ${botOnline?"server-on":"server-off"}`}><div className={`dot ${botOnline?"dot-on":"dot-off"}`}/>{botOnline?"서버 온라인":"서버 오프라인"}</div>
            <div className="quota-chip"><div className="quota-bar-bg"><div className="quota-bar-fill" style={{width:`${quota?Math.min(100,(quota.used_quota/quota.total_quota)*100):0}%`}}/></div>{quota?.remaining_quota??"-"}건<span className={`plan-badge plan-${user.plan}`}>{PLAN_LABELS[user.plan]}</span></div>
            <a href={EXE_DOWNLOAD_URL} className="dl-btn" download><span>⬇️</span><span>PC앱 다운로드</span></a>
          </div>
          <div className="header-right">
            <button className="guide-open-btn" onClick={()=>{setShowGuide(true);setGuideTab(0);}}>📖 <span className="guide-btn-text">사용설명서</span></button>
            <button className="icon-btn" onClick={onThemeToggle}>{theme==="dark"?"☀️":"🌙"}</button>
            <button className="icon-btn" onClick={checkBot}>🔄</button>

            {/* 유저 칩 + 드롭다운 */}
            <div style={{position:"relative"}}>
              <div className="user-chip" onClick={()=>{setShowUserDrop(v=>!v);loadReferrals();}}>
                <div className="user-avatar">{(user.name||user.email)[0].toUpperCase()}</div>
                <span className="user-name">{user.name||user.email.split("@")[0]}</span>
              </div>
              {showUserDrop&&(
                <>
                  {/* 배경 클릭 닫기 */}
                  <div style={{position:"fixed",inset:0,zIndex:199}} onClick={()=>setShowUserDrop(false)}/>
                  <div style={{
                    position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:200,
                    width:220,borderRadius:14,overflow:"hidden",
                    background:"var(--card)",border:"1px solid var(--border)",
                    boxShadow:"0 8px 32px rgba(0,0,0,.18)",
                  }}>
                    {/* 유저 정보 */}
                    <div style={{padding:"14px 16px 12px",borderBottom:"1px solid var(--border)"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:36,height:36,borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:"var(--accent-text)",flexShrink:0}}>
                          {(user.name||user.email)[0].toUpperCase()}
                        </div>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.name||user.email.split("@")[0]}</div>
                          <span style={{fontSize:10,fontWeight:800,padding:"1px 7px",borderRadius:99,background:"var(--accent-bg)",color:"var(--accent-text)",border:"1px solid var(--accent-border)"}}>{PLAN_LABELS[user.plan]||user.plan}</span>
                        </div>
                      </div>
                    </div>
                    {/* 초대 코드 */}
                    <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                      <div style={{fontSize:10,fontWeight:700,color:"var(--text3)",marginBottom:6,letterSpacing:".05em"}}>🎁 내 초대 코드</div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <code style={{flex:1,fontSize:12,fontWeight:700,color:"var(--accent-text)",background:"var(--accent-bg)",border:"1px solid var(--accent-border)",borderRadius:7,padding:"5px 9px",letterSpacing:".08em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {user.id.slice(0,8).toUpperCase()}
                        </code>
                        <button onClick={()=>{navigator.clipboard.writeText(user.id.slice(0,8).toUpperCase());showToast("📋 초대 코드 복사됐어요!");setShowUserDrop(false);}}
                          style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0,fontFamily:"inherit"}}>
                          복사
                        </button>
                      </div>
                    </div>
                    {/* 초대한 친구 */}
                    <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                      <button onClick={()=>{setShowUserDrop(false);setShowReferralModal(true);}}
                        style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit"}}>
                        <span style={{fontSize:12,fontWeight:600,color:"var(--text2)"}}>👥 초대한 친구</span>
                        <span style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:12,fontWeight:800,color:"var(--accent-text)",background:"var(--accent-bg)",border:"1px solid var(--accent-border)",borderRadius:99,padding:"2px 9px"}}>{myReferrals.length}명</span>
                          <span style={{fontSize:11,color:"var(--text3)"}}>→</span>
                        </span>
                      </button>
                    </div>
                    {/* 어드민 */}
                    <div style={{padding:"10px 16px"}}>
                      <button onClick={()=>{setShowUserDrop(false);onAdminLogin();}}
                        style={{width:"100%",textAlign:"left",background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--text3)",fontFamily:"inherit",padding:0}}>
                        ⚙️ 관리자 로그인
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button className="logout-btn" onClick={()=>{window.electron?.unregisterUser(user.id);onLogout();}}>로그아웃</button>
          </div>
        </div>

        {/* 래퍼럴 전체화면 모달 */}
        {showReferralModal&&(
          <div style={{position:"fixed",inset:0,zIndex:500,background:"var(--bg)",display:"flex",flexDirection:"column"}}>
            {/* 헤더 */}
            <div style={{padding:"20px 24px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:14,flexShrink:0}}>
              <button onClick={()=>setShowReferralModal(false)}
                style={{width:36,height:36,borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                ←
              </button>
              <div>
                <div style={{fontSize:17,fontWeight:800,color:"var(--text)"}}>👥 내가 초대한 친구</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>총 {myReferrals.length}명</div>
              </div>
            </div>
            {/* 목록 */}
            <div style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
              {myReferrals.length===0?(
                <div style={{textAlign:"center",padding:"60px 0",color:"var(--text3)"}}>
                  <div style={{fontSize:40,marginBottom:12}}>🎁</div>
                  <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>아직 초대한 친구가 없어요</div>
                  <div style={{fontSize:13}}>초대 코드를 공유해보세요!</div>
                  <div style={{marginTop:20,display:"inline-flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 18px"}}>
                    <code style={{fontSize:14,fontWeight:800,color:"var(--accent-text)",letterSpacing:".1em"}}>{user.id.slice(0,8).toUpperCase()}</code>
                    <button onClick={()=>{navigator.clipboard.writeText(user.id.slice(0,8).toUpperCase());showToast("📋 복사됐어요!");}}
                      style={{padding:"5px 12px",borderRadius:7,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                      복사
                    </button>
                  </div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:560,margin:"0 auto"}}>
                  {myReferrals.map((u,i)=>(
                    <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderRadius:12,background:"var(--card)",border:"1px solid var(--border)"}}>
                      <div style={{width:40,height:40,borderRadius:11,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:"var(--accent-text)",flexShrink:0}}>
                        {(u.name||u.email||"?")[0].toUpperCase()}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name||"이름없음"}</div>
                        <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{u.email} · {new Date(u.created_at).toLocaleDateString("ko-KR")} 가입</div>
                      </div>
                      <span style={{fontSize:11,fontWeight:800,padding:"4px 10px",borderRadius:99,flexShrink:0,
                        background:u.plan==="pro"?"rgba(99,102,241,.12)":u.plan==="basic"?"rgba(251,191,36,.1)":"var(--bg2)",
                        color:u.plan==="pro"?"#818cf8":u.plan==="basic"?"#f59e0b":"var(--text3)",
                        border:`1px solid ${u.plan==="pro"?"rgba(99,102,241,.3)":u.plan==="basic"?"rgba(251,191,36,.3)":"var(--border)"}`}}>
                        {u.plan==="pro"?"PRO":u.plan==="basic"?"BASIC":"FREE"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 레이아웃 */}
        <div className="layout">
          <div className="sidebar">
            <div className="nav-lbl">메뉴</div>
            {MAIN_TABS.map(t=>(
              <button key={t.k} className={`nav-item ${tab===t.k?"active":""}`} onClick={()=>{if(t.k==="rank"){window.open("https://rank.xn--zk5biyyw.com/","_blank");return;}setTab(t.k as MainTab);}}>
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
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <button className="btn btn-secondary" onClick={fetchKeywordData} disabled={loadingKw||!keyword} style={{borderColor:"var(--naver)",color:"var(--naver)"}}>
                        {loadingKw?<><span className="spinner"/>수집 중...</>:"📊 황금 키워드 분석"}
                      </button>
                      <button onClick={()=>setShowKwInfo(true)} style={{padding:"7px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 3px 10px rgba(255,64,129,.35)"}}>
                        💡 이게 뭐야?
                      </button>
                    </div>
                    {naverQuotaInfo&&!naverKeys.naver_access_license&&(
                      <span style={{fontSize:11,color:naverQuotaInfo.used>=naverQuotaInfo.limit?"var(--danger)":"var(--text3)",alignSelf:"center"}}>
                        {naverQuotaInfo.used}/{naverQuotaInfo.limit}회 사용
                      </span>
                    )}
                    {naverKeys.naver_access_license&&(
                      <span style={{fontSize:11,color:"var(--accent-text)",alignSelf:"center"}}>🔑 개인키 (무제한)</span>
                    )}
                  </div>

                  {/* 황금 키워드 결과 테이블 */}
                  {kwData.length>0&&(
                    <div className="card" style={{marginTop:12,padding:0,overflow:"hidden",animation:"fadeUp .2s ease both"}}>
                      <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>📊 키워드 분석 결과</span>
                        <button onClick={()=>setKwData([])} style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:18}}>✕</button>
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead>
                            <tr style={{background:"var(--bg2)"}}>
                              {["키워드","검색량","경쟁도","CPC","황금점수",""].map(h=>(
                                <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {kwData.sort((a,b)=>calcGoldScore(b)-calcGoldScore(a)).map((kw,i)=>{
                              const score=calcGoldScore(kw);
                              const sc=score>=70?"#4ade80":score>=45?"#fbbf24":"#94a3b8";
                              const compC=kw.competition==="낮음"?"#4ade80":kw.competition==="중"?"#fbbf24":"#f87171";
                              return(
                                <tr key={i} style={{borderBottom:"1px solid var(--border)",cursor:"pointer",transition:"background .1s"}}
                                  onClick={()=>{setKeyword(kw.keyword);showToast(`"${kw.keyword}" 선택됐어요!`);}}
                                  onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                  onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                  <td style={{padding:"9px 12px",fontWeight:700,color:"var(--text)"}}>{kw.keyword}</td>
                                  <td style={{padding:"9px 12px",color:"var(--text2)"}}>{kw.volume.toLocaleString()}</td>
                                  <td style={{padding:"9px 12px"}}><span style={{fontSize:11,fontWeight:700,color:compC}}>{kw.competition}</span></td>
                                  <td style={{padding:"9px 12px",color:"var(--text2)"}}>{kw.cpc>0?kw.cpc.toLocaleString()+"원":"—"}</td>
                                  <td style={{padding:"9px 12px"}}>
                                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                                      <div style={{width:48,height:4,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                        <div style={{height:"100%",width:`${score}%`,background:sc,borderRadius:99}}/>
                                      </div>
                                      <span style={{fontSize:11,fontWeight:800,color:sc,minWidth:28}}>{score}</span>
                                    </div>
                                  </td>
                                  <td style={{padding:"9px 12px"}}><button onClick={e=>{e.stopPropagation();setKeyword(kw.keyword);handleGenerateTitles(true);}} style={{padding:"3px 8px",borderRadius:6,border:"1px solid var(--accent)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>제목 추천 →</button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{padding:"8px 16px",fontSize:11,color:"var(--text3)",borderTop:"1px solid var(--border)"}}>💡 클릭하면 해당 키워드로 바로 적용 · 점수 기준: 경쟁도(35%) + 검색량(25%) + CTR(15%) + CPC(25%) + 보너스</div>
                    </div>
                  )}

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
                      {titles.map((t,i)=>{
                        const score=calcTitleScore(t);
                        const sc=score>=80?"#4ade80":score>=55?"#fbbf24":"#94a3b8";
                        return(
                          <button key={`${t}-${i}`} className={`title-card ${selectedTitle===t?"sel":""}`} onClick={()=>setSelectedTitle(t)}>
                            <div className="title-n">#{titles.length-i}</div>
                            <div className="title-t">{t}</div>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                              <div style={{flex:1,height:3,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${score}%`,background:sc,borderRadius:99,transition:"width .4s"}}/>
                              </div>
                              <span style={{fontSize:10,fontWeight:800,color:sc,minWidth:28}}>{score}점</span>
                            </div>
                            {selectedTitle===t&&<div className="title-chk">✓</div>}
                          </button>
                        );
                      })}
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

                  {/* 글 템플릿 */}
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">📋 글 템플릿 <span style={{fontSize:10,color:"var(--text3)",fontWeight:400}}>(선택 시 스타일·말투 자동 세팅)</span></label>
                    <select value={blogTemplate} onChange={e=>{
                      const t=BLOG_TEMPLATES.find(t=>t.id===e.target.value);
                      if(t){
                        setBlogTemplate(t.id);
                        if(t.id!=="none"){
                          setWriteStyle(t.style);localStorage.setItem("publy_write_style",t.style);
                          setPersona(t.persona);localStorage.setItem("publy_persona",t.persona);
                        }
                      }
                    }} style={{width:"100%",padding:"9px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                      {BLOG_TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>

                  {/* 글 스타일 프리셋 */}
                  <div style={{marginBottom:16}}>
                    <label className="inp-label">✍️ 글 스타일</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                      {WRITE_STYLES.map(s=>(
                        <button key={s.id} onClick={()=>{setWriteStyle(s.id);localStorage.setItem("publy_write_style",s.id);}}
                          style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${writeStyle===s.id?"var(--accent)":"var(--border)"}`,background:writeStyle===s.id?"var(--accent-bg)":"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}>
                          <div style={{fontSize:13,fontWeight:700,color:writeStyle===s.id?"var(--accent-text)":"var(--text)"}}>{s.i} {s.id}</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 말투/페르소나 */}
                  <div style={{marginBottom:16}}>
                    <label className="inp-label">🎭 말투 설정 <span style={{fontSize:10,color:"var(--text3)",fontWeight:400}}>(선택)</span></label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {PERSONA_STYLES.map(p=>(
                        <button key={p.id} onClick={()=>{setPersona(p.id);localStorage.setItem("publy_persona",p.id);}}
                          style={{padding:"6px 11px",borderRadius:20,border:`1.5px solid ${persona===p.id?p.color:"var(--border)"}`,background:persona===p.id?p.color+"22":"var(--bg)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:persona===p.id?700:500,color:persona===p.id?p.color:"var(--text2)",transition:"all .15s",whiteSpace:"nowrap"}}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

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
                        <button style={{padding:"7px 14px",borderRadius:9,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}} onClick={()=>openPreview()}>👁️ 미리보기</button>
                      </div>
                    </div>

                    {/* 품질 점수 */}
                    {qualityScore&&(
                      <div style={{padding:"14px 16px",borderRadius:12,background:"var(--card2)",border:"1px solid var(--border)",marginBottom:14}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <span style={{fontSize:12,fontWeight:800,color:"var(--text2)"}}>📊 SEO 품질 분석</span>
                          <span style={{fontSize:20,fontWeight:900,color:qualityScore.score>=80?"var(--success)":qualityScore.score>=55?"var(--warn)":"var(--danger)",fontFamily:"'Space Grotesk',sans-serif"}}>{qualityScore.score}점</span>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {qualityScore.items.map((item,i)=>(
                            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,background:item.pass?"rgba(0,255,150,.06)":"rgba(255,80,80,.06)"}}>
                              <span style={{fontSize:14,flexShrink:0}}>{item.pass?"✅":"❌"}</span>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:11,fontWeight:700,color:item.pass?"var(--success)":"var(--danger)"}}>{item.label}</div>
                                <div style={{fontSize:10,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.detail}</div>
                              </div>
                              <span style={{fontSize:10,color:"var(--text3)",flexShrink:0}}>{item.weight}점</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

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
            {tab==="photo"&&(
              <div className="photo-root">

                {/* 스토리 섹션 */}
                <div className="photo-story">
                  <div className="photo-story-step s1">
                    <span className="photo-story-ico">📸</span>
                    <div className="photo-story-num">STEP 1</div>
                    <div className="photo-story-title">사진 업로드</div>
                    <div className="photo-story-desc">내 사진을<br/>최대 20장 업로드</div>
                    <span className="photo-story-arrow">›</span>
                  </div>
                  <div className="photo-story-step s2">
                    <span className="photo-story-ico">✏️</span>
                    <div className="photo-story-num">STEP 2</div>
                    <div className="photo-story-title">키포인트 입력</div>
                    <div className="photo-story-desc">장소, 가격, 느낌 등<br/>핵심 정보 입력</div>
                    <span className="photo-story-arrow">›</span>
                  </div>
                  <div className="photo-story-step s3">
                    <span className="photo-story-ico">🌸</span>
                    <div className="photo-story-num">STEP 3</div>
                    <div className="photo-story-title">AI 글 생성</div>
                    <div className="photo-story-desc">사진 분석으로<br/>자연스러운 글 완성</div>
                  </div>
                </div>

                {/* 사진 업로드 */}
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <label className="inp-label" style={{margin:0}}>📷 사진 업로드 <span style={{fontSize:11,color:"var(--text3)"}}>(최대 20장)</span></label>
                    {photoFiles.length>0&&<button onClick={()=>setPhotoFiles([])} style={{fontSize:11,color:"#FF6B9D",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>전체 삭제</button>}
                  </div>

                  {/* 드래그 드롭 영역 */}
                  <div
                    className={`photo-drop${photoDragOver?" drag-over":""}`}
                    onClick={()=>{const inp=document.createElement("input");inp.type="file";inp.multiple=true;inp.accept="image/*";inp.onchange=e=>handlePhotoUpload((e.target as HTMLInputElement).files);inp.click();}}
                    onDragOver={e=>{e.preventDefault();setPhotoDragOver(true);}}
                    onDragLeave={()=>setPhotoDragOver(false)}
                    onDrop={e=>{e.preventDefault();setPhotoDragOver(false);handlePhotoUpload(e.dataTransfer.files);}}
                  >
                    <div className="photo-drop-ico"><span className="flower-deco">🌸</span></div>
                    <div className="photo-drop-title">사진을 여기에 끌어다 놓거나 클릭하세요</div>
                    <div className="photo-drop-desc">JPG, PNG 지원 · 최대 20장 · {photoFiles.length}/20장 업로드됨</div>
                  </div>

                  {/* 사진 미리보기 그리드 */}
                  {photoFiles.length>0&&(
                    <div className="photo-grid">
                      {photoFiles.map((f,i)=>(
                        <div key={f.id} className="photo-thumb">
                          <img src={f.src} alt={f.name}/>
                          {i===0&&<div style={{position:"absolute",bottom:4,left:4,fontSize:9,fontWeight:800,background:"#FF6B9D",color:"#fff",padding:"2px 6px",borderRadius:99}}>대표</div>}
                          <button className="photo-thumb-del" onClick={()=>setPhotoFiles(p=>p.filter(x=>x.id!==f.id))}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 키포인트 입력 */}
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                    <label className="inp-label" style={{margin:0}}>✏️ 키포인트 <span style={{fontSize:11,color:"var(--text3)"}}>(선택사항)</span></label>
                    <button onClick={()=>{const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>키포인트 예시</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Malgun Gothic',sans-serif;background:#fdf0ff;color:#111}h1{background:linear-gradient(135deg,#FF6B9D,#C77DFF);color:#fff;padding:20px 24px;font-size:18px;line-height:1.4}.content{padding:20px}.intro{font-size:14px;color:#555;line-height:1.8;margin-bottom:18px;padding:12px 16px;background:#fff;border-radius:12px;border-left:4px solid #C77DFF}.cat-title{font-size:13px;font-weight:800;color:#FF6B9D;margin:16px 0 8px;padding:4px 10px;background:#FF6B9D11;border-radius:6px;display:inline-block}.bad{background:#fff0f0;border:1px solid #ffcccc;border-radius:10px;padding:10px 14px;margin-bottom:6px;font-size:13px;color:#c00;line-height:1.7}.good{background:#f0fff4;border:1px solid #99ddaa;border-radius:10px;padding:10px 14px;font-size:13px;color:#005c1a;line-height:1.8;margin-bottom:16px}.lbl{font-size:10px;font-weight:800;margin-bottom:3px}.tip{background:linear-gradient(135deg,#FF6B9D11,#C77DFF11);border:1px solid #C77DFF33;border-radius:12px;padding:14px;margin-top:4px;font-size:13px;line-height:1.9}</style></head><body><h1>✏️ 키포인트 이렇게 쓰면 글이 잘 나와요</h1><div class="content"><div class="intro">구체적으로 쓸수록 실제 경험처럼 자연스러운 글이 나옵니다.<br>장소 + 가격 + 시간 + 특징 + 개인 의견을 담아주세요.</div><div class="cat-title">🍽️ 맛집 방문</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>강원도 맛집, 고기집, 맛있었음</div><div class="good"><div class="lbl">✅ 좋은 예</div>강원도 홍천 태장동 / 한우 소갈비찜 전문점 / 2인 45,000원 / 웨이팅 40분 / 주차 무료 / 반찬 10가지 / 아이 동반 가능 / 재방문 의향 있음</div><div class="cat-title">✈️ 여행 후기</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>제주도 여행, 경치 좋았다</div><div class="good"><div class="lbl">✅ 좋은 예</div>제주 성산읍 성산일출봉 / 오전 6시 방문 / 입장료 5,000원 / 일출 40분 전 도착 권장 / 주차장에서 도보 10분 / 공항에서 1시간 소요</div><div class="cat-title">☕ 카페 방문</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>서울 카페, 인테리어 예쁨</div><div class="good"><div class="lbl">✅ 좋은 예</div>서울 성수동 공장 리모델링 카페 / 아메리카노 6,500원 / 대기 없이 입장 / 오전 11시 방문 / 좌석 80개 / 지하철 권장 주차 불가</div><div class="cat-title">📦 제품 리뷰</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>에어프라이어 구매, 좋음</div><div class="good"><div class="lbl">✅ 좋은 예</div>필립스 에어프라이어 5.6L / 129,000원 / 3인 가족 6개월 사용 / 치킨 20분 바삭 / 세척 쉬움 / 단점: 크기 커서 수납 불편 / 만족도 9점</div><div class="cat-title">💬 체험단 후기</div><div class="bad"><div class="lbl">❌ 아쉬운 예</div>협찬 받은 피부과, 좋았음</div><div class="good"><div class="lbl">✅ 좋은 예</div>[협찬] 강남 청담 피부과 / 리프팅 시술 1회 / 40분 소요 / 붓기 거의 없음 / 직원 친절 / 주차 2시간 무료 / 다음 달 추가 예약</div><div class="tip">💡 핵심: 장소 + 가격 + 소요시간 + 특징 2~3개 + 내 솔직한 의견<br>이렇게만 써도 AI가 훨씬 풍부하고 자연스러운 글을 써드려요!</div></div></body></html>`;if((window as any).electron?.openPreview){(window as any).electron.openPreview(html);}else{const w=window.open("","_blank","width=560,height=820");if(w){w.document.write(html);w.document.close();}}}} style={{padding:"5px 12px",borderRadius:20,background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",border:"none",cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>📝 예시 보기</button>
                  </div>
                  <textarea
                    className="photo-keypoints"
                    placeholder={"예시: 강원도 홍천 맛집, 갈비탕 12,000원, 웨이팅 30분, 주차 가능 / 제주 성산일출봉 근처, 해돋이 사진, 오전 6시 방문, 입장료 5,000원"}

                    value={photoKeypoints}
                    onChange={e=>setPhotoKeypoints(e.target.value)}
                  />
                </div>

                {/* 글 스타일 + 말투 */}
                <div className="card" style={{padding:"18px",marginBottom:14}}>
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">✍️ 글 스타일</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                      {WRITE_STYLES.map(s=>(
                        <button key={s.id} onClick={()=>{setWriteStyle(s.id);localStorage.setItem("publy_write_style",s.id);}}
                          style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${writeStyle===s.id?"#FF6B9D":"var(--border)"}`,background:writeStyle===s.id?"#FF6B9D22":"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}>
                          <div style={{fontSize:13,fontWeight:700,color:writeStyle===s.id?"#FF6B9D":"var(--text)"}}>{s.i} {s.id}</div>
                          <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="inp-label">🎭 말투 설정 <span style={{fontSize:10,color:"var(--text3)",fontWeight:400}}>(선택)</span></label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {PERSONA_STYLES.map(p=>(
                        <button key={p.id} onClick={()=>{setPersona(p.id);localStorage.setItem("publy_persona",p.id);}}
                          style={{padding:"6px 11px",borderRadius:20,border:`1.5px solid ${persona===p.id?"#C77DFF":"var(--border)"}`,background:persona===p.id?"#C77DFF22":"var(--bg)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:persona===p.id?700:500,color:persona===p.id?"#C77DFF":"var(--text2)",transition:"all .15s",whiteSpace:"nowrap"}}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 생성 버튼 */}
                <button className="photo-gen-btn" onClick={generateFromPhotos} disabled={photoGenerating||photoFiles.length===0}>
                  {photoGenerating?<><span className="spinner" style={{width:18,height:18,marginRight:8,borderColor:"rgba(255,255,255,.3)",borderTopColor:"#fff"}}/>AI가 사진을 분석하고 있어요...</>:<><span className="flower-deco">🌸</span> 사진으로 글 생성하기</>}
                </button>

                {/* 생성 완료 후 발행 패널 */}
                {photoGenDone&&genContent&&(
                  <div style={{marginTop:20}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,padding:"12px 16px",borderRadius:14,background:"linear-gradient(135deg,#FF6B9D11,#C77DFF11)",border:"1px solid #FF6B9D33"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:20}}>🎉</span>
                        <div>
                          <div style={{fontSize:13,fontWeight:800,color:"#FF6B9D"}}>글 생성 완료!</div>
                          <div style={{fontSize:11,color:"var(--text3)"}}>{genContent.length.toLocaleString()}자 · 사진 {photoFiles.length}장 기반</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>openPreview()} style={{padding:"7px 14px",borderRadius:9,border:"1px solid #C77DFF",background:"#C77DFF11",color:"#C77DFF",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>👁️ 미리보기</button>
                        <button onClick={()=>setTab("publish")} style={{padding:"7px 14px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>🚀 발행하기 →</button>
                      </div>
                    </div>

                    {/* SEO 품질 점수 */}
                    {qualityScore&&(
                      <div style={{padding:"14px 16px",borderRadius:12,background:"var(--card2)",border:"1px solid var(--border)",marginBottom:14}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <span style={{fontSize:12,fontWeight:800,color:"var(--text2)"}}>📊 SEO 품질 분석</span>
                          <span style={{fontSize:20,fontWeight:900,color:qualityScore.score>=80?"var(--success)":qualityScore.score>=55?"var(--warn)":"var(--danger)",fontFamily:"'Space Grotesk',sans-serif"}}>{qualityScore.score}점</span>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {qualityScore.items.map((item,idx2)=>(
                            <div key={idx2} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,background:item.pass?"rgba(0,255,150,.06)":"rgba(255,80,80,.06)"}}>
                              <span style={{fontSize:14,flexShrink:0}}>{item.pass?"✅":"❌"}</span>
                              <div style={{flex:1}}>
                                <div style={{fontSize:11,fontWeight:700,color:item.pass?"var(--success)":"var(--danger)"}}>{item.label}</div>
                                <div style={{fontSize:10,color:"var(--text3)"}}>{item.detail}</div>
                              </div>
                              <span style={{fontSize:10,color:"var(--text3)",flexShrink:0}}>{item.weight}점</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 발행 설정 패널 */}
                    <div style={{background:"var(--bg2)",borderRadius:16,border:"1px solid var(--border)",padding:"16px"}}>
                      <div style={{fontSize:13,fontWeight:800,color:"#FF6B9D",marginBottom:14}}>🚀 발행 설정</div>
                      {renderPublishPanel()}
                    </div>

                    {/* 발행 버튼 */}
                    <div style={{marginTop:14,display:"flex",gap:10}}>
                      <button onClick={()=>copyForNaver()} style={{flex:1,padding:"14px",borderRadius:12,border:"1px solid #03C75A",background:"#03C75A11",color:"#03C75A",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>📋 N복사</button>
                      <button onClick={()=>handlePublish()} disabled={publishing||!pubAccId||!pubTitle} style={{flex:2,padding:"14px",borderRadius:12,border:"none",background:publishing?"#888":"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:publishing?"not-allowed":"pointer",fontSize:14,fontWeight:900,fontFamily:"inherit",opacity:(publishing||!pubAccId||!pubTitle)?.6:1}}>
                        {publishing?<><span className="spinner" style={{width:16,height:16,marginRight:8}}/>발행 중...</>:<>🌸 블로그 발행하기</>}
                      </button>
                    </div>
                    {pubMsg&&<div className={`alert-box ${pubMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{marginTop:10}}>{pubMsg}</div>}
                  </div>
                )}

                {/* Gemini 사용법 고정 버튼 */}
                <div style={{position:"fixed",bottom:80,right:16,display:"flex",flexDirection:"column",gap:8,zIndex:100}}>
                  <button className="photo-guide-btn" onClick={()=>{const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>사진 글쓰기 사용방법</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Malgun Gothic',sans-serif;background:#fdf0ff;color:#111}h1{background:linear-gradient(135deg,#FF6B9D,#C77DFF);color:#fff;padding:24px;font-size:20px;line-height:1.4}.content{padding:20px}.step{background:#fff;border-radius:14px;padding:18px;margin-bottom:14px;border:1px solid #FF6B9D22}.num{display:inline-block;background:linear-gradient(135deg,#FF6B9D,#C77DFF);color:#fff;width:26px;height:26px;border-radius:50%;text-align:center;line-height:26px;font-weight:900;font-size:13px;margin-bottom:8px}.title{font-size:15px;font-weight:800;color:#FF6B9D;margin-bottom:6px}.desc{font-size:14px;line-height:1.9;color:#333}.tip{background:#FF6B9D11;border:1px solid #FF6B9D33;border-radius:12px;padding:14px;margin-top:14px;font-size:13px;line-height:1.8}</style></head><body><h1>📷 사진으로 블로그 글 쓰는 방법</h1><div class="content"><div class="step"><div class="num">1</div><div class="title">사진을 올려주세요</div><div class="desc">사진 업로드 버튼을 누르거나 사진을 끌어다 놓으세요.<br>스마트폰으로 찍은 사진도 괜찮아요.<br>최대 20장까지 올릴 수 있어요.<br>첫 번째 사진이 대표 사진이 됩니다.</div></div><div class="step"><div class="num">2</div><div class="title">키포인트를 적어주세요 (안 적어도 돼요)</div><div class="desc">글에 꼭 넣고 싶은 내용을 간단히 적으세요.<br>예시: 강원도 홍천 맛집, 갈비탕 12,000원, 웨이팅 30분<br>예시: 제주 카페, 아메리카노 6,000원, 바다가 보여요<br>안 적어도 AI가 사진만 보고 글을 써드려요.</div></div><div class="step"><div class="num">3</div><div class="title">글 스타일을 선택하세요</div><div class="desc">맛집 후기, 여행기, 감성일기, 정보글 중 선택하세요.<br>말투도 선택하면 더 자연스러운 글이 만들어져요.</div></div><div class="step"><div class="num">4</div><div class="title">🌸 사진으로 글 생성하기 버튼을 눌러요</div><div class="desc">AI가 사진을 꼼꼼히 분석해서 글을 써드립니다.<br>30초에서 1분 정도 기다려 주세요.</div></div><div class="step"><div class="num">5</div><div class="title">블로그에 발행하세요</div><div class="desc">발행하기 탭으로 이동해서 계정을 선택하고<br>발행 버튼을 누르면 자동으로 블로그에 올라갑니다.</div></div><div class="tip">💡 꿀팁: 밝고 선명한 사진일수록 더 좋은 글이 나와요!</div></div></body></html>`;if((window as any).electron?.openPreview){(window as any).electron.openPreview(html);}else{const w=window.open("","_blank","width=520,height=760");if(w){w.document.write(html);w.document.close();}}}}>📖 사용방법</button>
                  <button className="photo-guide-btn" style={{background:"linear-gradient(135deg,#FF8C00,#FF6B9D)"}} onClick={()=>{const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>유의할점</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Malgun Gothic',sans-serif;background:#fff8e1;color:#111}h1{background:linear-gradient(135deg,#FF8C00,#FF6B9D);color:#fff;padding:20px 24px;font-size:18px;line-height:1.4}.content{padding:20px}.step{background:#fff;border-radius:14px;padding:16px 18px;margin-bottom:14px;border:1px solid #FF8C0022}.title{font-size:14px;font-weight:800;color:#FF8C00;margin-bottom:8px}.desc{font-size:14px;line-height:1.9;color:#333}.tip{background:#FF8C0011;border:1px solid #FF8C0033;border-radius:12px;padding:14px 16px;margin-top:4px;font-size:13px;line-height:1.9}</style></head><body><h1>⚠️ 사진 글쓰기 유의할점</h1><div class="content"><div class="step"><div class="title">🔑 Gemini 키가 없다면?</div><div class="desc">왼쪽 메뉴 맨 아래 <b>설정</b>을 클릭하세요.<br>AI 설정 항목에서 <b>Gemini 발급받기</b> 버튼을 누르고<br>발급받은 키를 입력하고 저장하면 됩니다.</div></div><div class="step"><div class="title">⏱️ 분당 한도 초과 오류가 뜬다면?</div><div class="desc">무료 Gemini는 분당 사용 횟수에 제한이 있어요.<br>오류가 나면 <b>1분 정도 기다렸다가</b> 다시 눌러주세요.<br>자꾸 오류나면 키를 새로 발급받아서 바꿔주세요.</div></div><div class="step"><div class="title">🖼️ 사진 주의사항</div><div class="desc">사진은 20장 올릴 수 있지만 AI 분석은 처음 10장만 해요.<br>첫 번째 사진이 블로그 대표 사진이 됩니다.<br>밝고 선명한 사진일수록 글이 잘 나와요.</div></div><div class="step"><div class="title">⏳ 생성 시간</div><div class="desc">사진이 많을수록 시간이 걸려요.<br>보통 30초~1분 정도 기다리시면 됩니다.<br>생성 중에 다른 버튼을 누르지 마세요.</div></div><div class="tip">💡 잘 안 된다면 사진을 3~5장으로 줄이고<br>키포인트에 내용을 자세히 적어보세요!</div></div></body></html>`;if((window as any).electron?.openPreview){(window as any).electron.openPreview(html);}else{const w=window.open("","_blank","width=500,height=680");if(w){w.document.write(html);w.document.close();}}}}>⚠️ 유의할점</button>
                </div>

              </div>
            )}

            


            {tab==="publish"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>
                {!botOnline&&<div className="alert-box alert-warn" style={{margin:"12px 16px 0"}}>⚠️ 봇 오프라인 — PC에서 Publy 앱 실행 시 즉시 발행, 아니면 대기열 저장돼요.</div>}
                {quota&&quota.remaining_quota<=0&&<div className="alert-box alert-danger" style={{margin:"12px 16px 0"}}>⚠️ 발행 건수 초과. 플랜을 업그레이드해주세요.</div>}

                {/* ── 발행 준비도 + 설정 스티키 바 ── */}
                <div className="pub-sticky-bar">
                  {/* 플랫폼 토글 */}
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    {([{p:"naver",ico:"🟢",name:"네이버",c:"var(--naver)"},{p:"tistory",ico:"🟠",name:"티스토리",c:"var(--tistory)"}] as const).map(({p,ico,name,c})=>(
                      <button key={p} onClick={()=>{setPlatform(p);if(pubAccId)loadCategories(p);}}
                        style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,border:`2px solid ${platform===p?c:"var(--border)"}`,background:platform===p?`${c}18`:"var(--bg)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",transition:"all .15s"}}>
                        <span>{ico}</span>{name}{platform===p&&<span style={{color:c}}>✓</span>}
                      </button>
                    ))}
                  </div>
                  <div style={{width:1,height:20,background:"var(--border)",flexShrink:0}}/>
                  {/* 준비도 체크 */}
                  <div className="pub-ready">
                    {[
                      {label:"제목",ok:!!pubTitle},
                      {label:"본문",ok:blocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim().length>0)},
                      {label:`이미지 ${blocks.filter(b=>b.type==="image").length}장`,ok:blocks.some(b=>b.type==="image")},
                      {label:pubAccId?connAccs.find(a=>a.id===pubAccId)?.username||"계정":"계정 미선택",ok:!!pubAccId},
                    ].map(c=>(
                      <span key={c.label} className={`pub-ready-chip ${c.ok?"pub-ready-ok":"pub-ready-no"}`}>
                        {c.ok?"✅":"❌"} {c.label}
                      </span>
                    ))}
                  </div>
                  <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
                    {/* 네이버 복사 */}
                    <div style={{position:"relative"}}>
                      <button onClick={()=>setShowNaverMenu(v=>!v)} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,background:"#03C75A",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                        📋 N복사 ▲
                      </button>
                      {showNaverMenu&&(
                        <>
                          <div style={{position:"fixed",inset:0,zIndex:40}} onClick={()=>setShowNaverMenu(false)}/>
                          <div style={{position:"absolute",top:38,right:0,zIndex:50,width:260,borderRadius:14,overflow:"hidden",background:"#1a1a2e",border:"1px solid rgba(255,255,255,.12)",boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
                            {[
                              {label:"전체 복사",tag:"전체",color:"#03C75A",tagColor:"#fff",tip:"정보성 글·리뷰",fn:()=>{copyForNaver();setShowNaverMenu(false);}},
                              {label:"본문+FAQ",tag:"FAQ",color:"#fbbf24",tagColor:"#000",tip:"일반 블로그",fn:()=>{copyForNaverWithFaq();setShowNaverMenu(false);}},
                              {label:"본문만",tag:"본문",color:"#f472b6",tagColor:"#fff",tip:"체험단·맛집",fn:()=>{copyForNaverBodyOnly();setShowNaverMenu(false);}},
                            ].map((opt,i)=>(
                              <button key={i} onClick={opt.fn} style={{width:"100%",textAlign:"left",padding:"10px 14px",borderBottom:i<2?"1px solid rgba(255,255,255,.08)":"none",background:"transparent",cursor:"pointer",border:"none",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:99,background:opt.color,color:opt.tagColor,flexShrink:0}}>{opt.tag}</span>
                                <div><div style={{fontSize:12,fontWeight:700,color:"#fff"}}>{opt.label}</div><div style={{fontSize:10,color:"rgba(255,255,255,.45)"}}>{opt.tip}</div></div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    {/* 미리보기 */}
                    <button onClick={()=>openPreview()} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,background:"oklch(.62 .22 300)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      👁️ 미리보기
                    </button>
                    {/* 발행 설정 토글 */}
                    <button onClick={()=>setShowPublishPanel(v=>!v)} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,border:"1px solid var(--border)",background:showPublishPanel?"var(--accent-bg)":"var(--card)",color:showPublishPanel?"var(--accent-text)":"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      ⚙️ 발행 설정 {showPublishPanel?"▲":"▼"}
                    </button>
                    {/* 발행 버튼 */}
                    <button onClick={handlePublish} disabled={publishing||!pubAccId||!pubTitle||!buildPublishContent()||(quota!==null&&(quota.remaining_quota||0)<=0)||(scheduleOn&&!scheduleTime)}
                      style={{display:"flex",alignItems:"center",gap:5,padding:"7px 16px",borderRadius:8,border:"none",background:scheduleOn?"var(--warn)":"var(--accent)",color:"#000",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",opacity:(publishing||!pubAccId||!pubTitle)?.5:1}}>
                      {publishing?(scheduleOn?"예약 중...":"발행 중..."):scheduleOn?"⏰ 예약":"🚀 발행"}
                    </button>
                  </div>
                </div>

                {/* ── 발행 설정 패널 (접이식) ── */}
                {showPublishPanel&&(
                  <div style={{background:"var(--bg2)",borderBottom:"2px solid var(--accent-border)",padding:"16px"}}>
                    {renderPublishPanel()}
                  </div>
                )}

                {pubMsg&&<div className={`alert-box ${pubMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:"12px 16px 0"}}>{pubMsg}</div>}

                {/* ── 에디터 (전폭) ── */}
                <div style={{padding:"16px",display:"flex",flexDirection:"column",gap:16}}>

                    {/* 제목 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <label className="inp-label">글 제목</label>
                      <input className="inp lg" placeholder="블로그 글 제목..." value={pubTitle} onChange={e=>setPubTitle(e.target.value)}/>
                    </div>

                    {/* 썸네일 + 인사말 접기 (이미지 있으면 자동 펼침) */}
                    <div className="card" style={{padding:0,overflow:"hidden"}}>
                      <button onClick={()=>setShowMeta(v=>!v)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>🖼️ 썸네일 · 인사말</span>
                          {thumbnail&&<span style={{fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:99,background:"var(--accent)",color:"#000"}}>썸네일 ✓</span>}
                          {!thumbnail&&getActiveImages().length===0&&<span style={{fontSize:11,color:"var(--text3)"}}>선택사항</span>}
                        </div>
                        <span style={{fontSize:16,color:"var(--text3)",transition:"transform .2s",display:"inline-block",transform:showMeta?"rotate(180deg)":"rotate(0deg)"}}>▼</span>
                      </button>
                      {showMeta&&(
                        <div style={{padding:"0 16px 16px",borderTop:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:14,marginTop:4,paddingTop:16}}>
                          {/* 썸네일 */}
                          <div>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                              <label className="inp-label" style={{margin:0}}>🖼️ 썸네일</label>
                              {thumbnail&&<button onClick={()=>setThumbnail("")} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:18}}>✕</button>}
                            </div>
                            {thumbnail?(
                              <div style={{position:"relative",borderRadius:12,overflow:"hidden",aspectRatio:"16/9"}}>
                                <img src={thumbnail} alt="썸네일" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} onError={()=>setThumbnail("")}/>
                              </div>
                            ):(
                              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                                {getActiveImages().length>0&&(
                                  <div>
                                    <div style={{fontSize:12,color:"var(--text3)",marginBottom:6}}>생성된 이미지에서 선택:</div>
                                    <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
                                      {getActiveImages().slice(0,6).map((src,i)=>(
                                        <button key={i} onClick={()=>setThumbnail(src)} style={{flexShrink:0,width:64,height:64,borderRadius:10,overflow:"hidden",border:"2px solid var(--border)",padding:0,cursor:"pointer",transition:"border-color .15s"}}>
                                          <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <button onClick={()=>thumbnailRef.current?.click()} style={{width:"100%",padding:"18px",borderRadius:12,border:"2px dashed var(--border)",background:"var(--bg)",cursor:"pointer",color:"var(--text3)",fontSize:13,fontFamily:"inherit"}}>
                                  📁 직접 업로드
                                </button>
                              </div>
                            )}
                            <input ref={thumbnailRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>setThumbnail(ev.target?.result as string);r.readAsDataURL(f);}}/>
                          </div>
                          {/* 인사말 */}
                          <div>
                            <label className="inp-label">💬 글쓴이 인사말 <span style={{fontWeight:400,color:"var(--text3)"}}>(선택)</span></label>
                            <textarea className="inp" rows={2} placeholder="안녕하세요! 오늘도 유용한 정보를 가지고 왔어요 😊" value={greeting} onChange={e=>setGreeting(e.target.value)} style={{resize:"none",fontSize:13}}/>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 이미지 삽입 모드 */}
                    <div className="card" style={{padding:0,overflow:"hidden"}}>
                      <div style={{padding:"13px 16px",borderBottom:"1px solid var(--border)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                          <span style={{fontSize:15}}>🖼️</span>
                          <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>이미지 삽입 모드</span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                          {[{v:"auto",ico:"🤖",label:"자동",desc:"AI 이미지 자동 배치"},{v:"manual",ico:"📁",label:"수동",desc:"원하는 위치에 삽입"}].map(m=>(
                            <button key={m.v} onClick={()=>setImageMode(m.v as "auto"|"manual")} style={{padding:"10px 12px",borderRadius:10,border:`2px solid ${imageMode===m.v?"var(--accent)":"var(--border)"}`,background:imageMode===m.v?"var(--accent-bg)":"var(--bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                                <span>{m.ico}</span>
                                <span style={{fontSize:13,fontWeight:700,color:imageMode===m.v?"var(--accent-text)":"var(--text)"}}>{m.label}</span>
                                {imageMode===m.v&&blocks.filter(b=>b.type==="image").length>0&&<span style={{fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:99,background:"var(--accent-text)",color:"#000"}}>{blocks.filter(b=>b.type==="image").length}개</span>}
                              </div>
                              <div style={{fontSize:11,color:"var(--text3)"}}>{m.desc}</div>
                            </button>
                          ))}
                        </div>
                        {imageMode==="auto"&&(
                          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                            <div style={{flex:1,padding:"8px 12px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border)",fontSize:12,color:"var(--text3)"}}>
                              {getActiveImages().length>0?`${getActiveImages().length}개 준비됨`:"이미지 생성 먼저"}
                            </div>
                            {autoInserted?(
                              <button onClick={handleRemoveAutoImages} style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(255,71,87,.4)",background:"rgba(255,71,87,.08)",color:"var(--danger)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>✕ 제거</button>
                            ):(
                              <button onClick={handleAutoInsert} disabled={getActiveImages().length===0} style={{padding:"8px 14px",borderRadius:8,border:"none",background:"var(--accent)",color:"#000",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",opacity:getActiveImages().length===0?.4:1}}>🤖 자동 삽입</button>
                            )}
                          </div>
                        )}
                        {imageMode==="manual"&&(
                          <div style={{display:"flex",gap:8}}>
                            <button onClick={()=>manualFileRef.current?.click()} style={{padding:"8px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>📁 파일 첨부</button>
                            <div style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",fontSize:12,fontWeight:600}}>⌨️ Ctrl+V</div>
                          </div>
                        )}
                        <input ref={manualFileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                          const f=e.target.files?.[0];if(!f)return;
                          const r=new FileReader();
                          r.onload=ev=>{
                            if(ev.target?.result){
                              const src=ev.target.result as string;
                              addManualImageBlock();
                              setBlocks(prev=>{
                                const last=prev[prev.length-1];
                                return prev.map(b=>b.id===last.id?({...b,src,alt:f.name} as ContentBlock):b);
                              });
                            }
                          };
                          r.readAsDataURL(f);e.target.value="";
                        }}/>                      </div>

                      {/* 본문 편집 헤더 */}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>📝 본문 편집</span>
                          <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:"var(--bg2)",color:"var(--text3)"}}>{blocks.length}블록</span>
                        </div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <button onClick={()=>addTextBlock()} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>+ 텍스트</button>
                          {imageMode==="manual"&&<button onClick={()=>addManualImageBlock()} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>+ 이미지</button>}
                          {imageMode==="manual"&&getActiveImages().length>=2&&<button onClick={()=>{
                            const imgs=getActiveImages().slice(0,2);
                            const pair:ImagePairBlock={id:Date.now().toString(),type:"image-pair",images:imgs.map((src,i)=>({src,alt:`${keyword||"이미지"} ${i+1}`}))};
                            setBlocks(p=>[...p,pair]);
                            showToast("🖼️🖼️ 2열 이미지 추가됐어요!");
                          }} style={{padding:"5px 10px",borderRadius:7,border:"1px solid oklch(.75 .12 300 / 40%)",background:"oklch(.75 .12 300 / 8%)",color:"oklch(.75 .12 300)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>🖼️🖼️ 2열</button>}
                          <span style={{fontSize:10,color:"var(--text3)",alignSelf:"center",marginLeft:4}}>Ctrl+V로 이미지 붙여넣기 가능</span>
                        </div>
                      </div>

                      {/* 블록 목록 */}
                      <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
                        {blocks.map((block,idx)=>(
                          <div key={block.id}>
                            {block.type==="text"?(
                              <div style={{position:"relative"}}>
                                <textarea
                                  value={(block as TextBlock).content}
                                  onChange={e=>updateBlock(block.id,{content:e.target.value})}
                                  placeholder="내용 입력..."
                                  style={{width:"100%",minHeight:80,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,lineHeight:1.8,fontFamily:"inherit",resize:"none",outline:"none",boxSizing:"border-box"}}
                                  onInput={e=>{const el=e.target as HTMLTextAreaElement;el.style.height="auto";el.style.height=el.scrollHeight+"px";}}
                                />
                                <div style={{display:"flex",gap:5,marginTop:4,justifyContent:"flex-end"}}>
                                  {imageMode==="manual"&&<button onClick={()=>addManualImageBlock(block.id)} style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text3)",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>🖼️</button>}
                                  <button onClick={()=>addTextBlock(block.id)} style={{padding:"3px 9px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text3)",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>+</button>
                                  {blocks.length>1&&<button onClick={()=>removeBlock(block.id)} style={{padding:"3px 9px",borderRadius:6,border:"1px solid rgba(255,71,87,.3)",background:"rgba(255,71,87,.06)",color:"var(--danger)",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>✕</button>}
                                </div>
                              </div>
                            ):block.type==="image-pair"?(
                              <div style={{borderRadius:12,overflow:"hidden",border:"2px solid oklch(.75 .12 300 / 50%)"}}>
                                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",background:"oklch(.75 .12 300 / 8%)"}}>
                                  <span style={{fontSize:11,fontWeight:700,color:"oklch(.75 .12 300)"}}>🖼️🖼️ 2열 나란히</span>
                                  <button onClick={()=>removeBlock(block.id)} style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:14}}>✕</button>
                                </div>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,padding:"8px 12px"}}>
                                  {(block as ImagePairBlock).images.map((img,i)=>(
                                    <div key={i} style={{borderRadius:8,overflow:"hidden",aspectRatio:"1/1",background:"var(--bg2)"}}>
                                      {img.src?<img src={img.src} alt={img.alt} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                      :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text3)",fontSize:11}}>📁 {i+1}번</div>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ):(
                              <div style={{borderRadius:12,overflow:"hidden",border:`2px solid ${(block as SingleImageBlock).source==="auto"?"var(--accent-border)":"oklch(.75 .12 300 / 50%)"}`}}>
                                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",background:(block as SingleImageBlock).source==="auto"?"var(--accent-bg)":"oklch(.75 .12 300 / 8%)"}}>
                                  <span style={{fontSize:11,fontWeight:700,color:(block as SingleImageBlock).source==="auto"?"var(--accent-text)":"oklch(.75 .12 300)"}}>{(block as SingleImageBlock).source==="auto"?"🤖 AI 생성":"📁 내 이미지"}</span>
                                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                    <select value={(block as SingleImageBlock).position} onChange={e=>updateBlock(block.id,{position:e.target.value as "left"|"center"|"right"})} style={{fontSize:11,padding:"2px 6px",borderRadius:5,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)"}}>
                                      <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
                                    </select>
                                    <button onClick={()=>removeBlock(block.id)} style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:14,lineHeight:1}}>✕</button>
                                  </div>
                                </div>
                                {(block as SingleImageBlock).src?(
                                  <div style={{padding:"8px 12px"}}>
                                    <img src={(block as SingleImageBlock).src} alt="" style={{width:"100%",borderRadius:8,display:"block",maxHeight:200,objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                  </div>
                                ):(
                                  <button onClick={()=>manualFileRef.current?.click()} style={{width:"100%",padding:"24px",background:"transparent",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:13,fontFamily:"inherit"}}>📁 이미지 업로드</button>
                                )}
                                <div style={{padding:"0 12px 8px"}}>
                                  <input placeholder="이미지 설명 (alt)" value={(block as SingleImageBlock).alt} onChange={e=>updateBlock(block.id,{alt:e.target.value})} style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text)",fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                                </div>
                              </div>
                            )}
                            {idx<blocks.length-1&&<div style={{display:"flex",alignItems:"center",margin:"4px 0"}}><div style={{flex:1,height:1,background:"var(--border)"}}/><span style={{margin:"0 8px",fontSize:10,color:"var(--text3)",opacity:.5}}>{idx+2}</span><div style={{flex:1,height:1,background:"var(--border)"}}/></div>}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 해시태그 */}
                    <div className="card" style={{padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                        <span style={{fontSize:15}}>#</span>
                        <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>해시태그</span>
                        <span style={{fontSize:11,color:"var(--text3)"}}>5~8개 권장</span>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
                        {hashtags.map((tag,i)=>(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 11px",borderRadius:99,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,fontWeight:600,color:"var(--accent-text)"}}>
                            {tag}<button onClick={()=>setHashtags(prev=>prev.filter((_,j)=>j!==i))} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--accent-text)",fontSize:13,lineHeight:1,padding:0}}>✕</button>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <input className="inp" placeholder="#해시태그 입력" value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newTag.trim()){if(hashtags.length>=8)return;setHashtags(prev=>[...prev,`#${newTag.replace("#","").trim()}`]);setNewTag("");}}} style={{flex:1}}/>
                        <button onClick={()=>{if(!newTag.trim()||hashtags.length>=8)return;setHashtags(prev=>[...prev,`#${newTag.replace("#","").trim()}`]);setNewTag("");}} className="btn btn-secondary" style={{padding:"0 16px",flexShrink:0}}>추가</button>
                      </div>
                    </div>
                </div>

              </div>
            )}


            {/* ===== 발행 기록 ===== */}
            {tab==="manage"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* ── 발행 통계 + 수익 예측 ── */}
                {(()=>{
                  const now=new Date();
                  const thisMonth=history.filter(h=>new Date(h.published_at).getMonth()===now.getMonth()&&new Date(h.published_at).getFullYear()===now.getFullYear());
                  const thisWeek=history.filter(h=>{const d=new Date(h.published_at);const diff=(now.getTime()-d.getTime())/(1000*60*60*24);return diff<=7;});
                  const success=history.filter(h=>h.status==="success");
                  const successRate=history.length>0?Math.round((success.length/history.length)*100):0;
                  const naverCnt=success.filter(h=>h.platform==="naver").length;
                  const tistoryCnt=success.filter(h=>h.platform==="tistory").length;
                  const estViews=success.length*120;
                  const estRevenue=Math.round(estViews*0.35);
                  return(
                    <div className="card" style={{marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                        <div className="card-title" style={{margin:0}}>📊 발행 통계 & 수익 예측</div>
                        <span style={{fontSize:11,color:"var(--text3)"}}>* 예측값은 평균 조회수 기준 추산</span>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:14}}>
                        {[
                          {label:"이번 달 발행",value:`${thisMonth.length}건`,color:"var(--accent-text)"},
                          {label:"이번 주 발행",value:`${thisWeek.length}건`,color:"var(--info)"},
                          {label:"성공률",value:`${successRate}%`,color:successRate>=80?"var(--success)":successRate>=50?"var(--warn)":"var(--danger)"},
                          {label:"예상 누적 조회",value:`${estViews.toLocaleString()}회`,color:"var(--purple)"},
                          {label:"예상 수익",value:`₩${estRevenue.toLocaleString()}`,color:"var(--warn)"},
                        ].map((s,i)=>(
                          <div key={i} style={{padding:"12px 14px",borderRadius:12,background:"var(--card2)",border:"1px solid var(--border)",textAlign:"center"}}>
                            <div style={{fontSize:18,fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}</div>
                            <div style={{fontSize:11,color:"var(--text3)",marginTop:4,fontWeight:600}}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:120,padding:"10px 14px",borderRadius:10,background:"rgba(3,199,90,.08)",border:"1px solid rgba(3,199,90,.2)"}}>
                          <div style={{fontSize:11,color:"var(--naver)",fontWeight:700,marginBottom:2}}>🟢 네이버</div>
                          <div style={{fontSize:16,fontWeight:900,color:"var(--naver)"}}>{naverCnt}건</div>
                        </div>
                        <div style={{flex:1,minWidth:120,padding:"10px 14px",borderRadius:10,background:"rgba(255,107,53,.08)",border:"1px solid rgba(255,107,53,.2)"}}>
                          <div style={{fontSize:11,color:"var(--tistory)",fontWeight:700,marginBottom:2}}>🟠 티스토리</div>
                          <div style={{fontSize:16,fontWeight:900,color:"var(--tistory)"}}>{tistoryCnt}건</div>
                        </div>
                        <div style={{flex:1,minWidth:120,padding:"10px 14px",borderRadius:10,background:"var(--accent-dim)",border:"1px solid var(--accent-border)"}}>
                          <div style={{fontSize:11,color:"var(--accent-text)",fontWeight:700,marginBottom:2}}>📈 누적 총계</div>
                          <div style={{fontSize:16,fontWeight:900,color:"var(--accent-text)"}}>{success.length}건 성공</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 발행 기록 */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">📋 발행 기록</div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:13,color:"var(--text2)"}}>총 {history.length}건</span>
                      {history.length>0&&<button className="btn btn-danger btn-sm" onClick={async()=>{if(!confirm("전체 삭제할까요?"))return;await deleteAllHistory(user.id);setHistory([]);}}>🗑 전체삭제</button>}
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
                      <button style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(255,71,87,.3)",background:"transparent",color:"var(--danger)",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}} onClick={async()=>{await deleteHistory(h.id);setHistory(prev=>prev.filter(x=>x.id!==h.id));}}>삭제</button>
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
                    <div><label className="inp-label">비밀번호</label><div style={{position:"relative"}}><input className="inp" type={showPw?"text":"password"} placeholder="비밀번호" value={newPw} onChange={e=>setNewPw(e.target.value)} style={{paddingRight:40}}/><button type="button" onClick={()=>setShowPw(v=>!v)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--text3)"}}>{showPw?"🙈":"👁️"}</button></div></div>
                  </div>
                  <div style={{marginBottom:14}}><label className="inp-label">블로그명 <span style={{color:"var(--text3)",fontWeight:400}}>(티스토리만)</span></label><input className="inp" placeholder="예: myblog" value={newBlog} onChange={e=>setNewBlog(e.target.value)}/></div>
                  <button className="btn btn-primary" onClick={handleAddAccount} disabled={addingAcc||!newUser||!newPw}>{addingAcc?<><span className="spinner"/>추가 중...</>:<>➕ 계정 추가</>}</button>
                </div>
                {accounts.filter(a=>a.platform!=="google").length===0?(
                  <div className="empty-state"><span className="empty-ico">🔗</span><div className="empty-title">등록된 계정이 없어요</div><div className="empty-sub">위에서 블로그 계정을 추가해주세요</div></div>
                ):accounts.filter(a=>a.platform!=="google").map((a,i)=>(
                  <div key={a.id} style={{animationDelay:`${i*.06}s`}}>
                    <div className={`acc-card ${a.is_connected?(a.platform==="naver"?"conn-naver":"conn-tistory"):""}`}>
                      <span style={{fontSize:26}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                      <div style={{flex:1,minWidth:0}}><div style={{fontSize:15,fontWeight:700,color:"var(--text)"}}>{a.username}</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>{a.platform}{a.blog_name&&` · ${a.blog_name}`}</div></div>
                      <span style={{fontSize:11,fontWeight:700,padding:"4px 11px",borderRadius:99,background:a.is_connected?"var(--accent-bg)":"var(--card-hover)",color:a.is_connected?"var(--accent-text)":"var(--text2)",border:"1px solid",borderColor:a.is_connected?"var(--accent-border)":"var(--border)"}}>{a.is_connected?"✅ 연결됨":"미연결"}</span>
                      <button className="btn btn-secondary btn-sm" onClick={()=>handleConnect(a)} disabled={!!connId||!botOnline}>{connId===a.id?<><span className="sp-w spinner"/>연결 중...</>:a.is_connected?"재연결":"연결"}</button>
                      <button className="btn btn-danger btn-sm" onClick={()=>handleDeleteAccount(a.id)}>🗑 삭제</button>
                      <button onClick={()=>setEditingCatAccId(editingCatAccId===a.id?null:a.id)} style={{padding:"5px 11px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                        📂 카테고리 {(accCats[a.id]||[]).length>0?`(${(accCats[a.id]||[]).length})`:""}
                      </button>
                    </div>

                    {/* 카테고리 관리 패널 */}
                    {editingCatAccId===a.id&&(
                      <div style={{margin:"-8px 0 8px",padding:"14px 16px",borderRadius:"0 0 14px 14px",background:"var(--bg2)",border:"1px solid var(--border)",borderTop:"none"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:10}}>
                          📂 {a.username} 카테고리 목록
                          <span style={{fontWeight:400,marginLeft:6}}>발행 시 선택 가능해요</span>
                        </div>
                        {/* 등록된 카테고리 */}
                        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
                          {(accCats[a.id]||[]).length===0?(
                            <span style={{fontSize:12,color:"var(--text3)"}}>등록된 카테고리 없음</span>
                          ):(accCats[a.id]||[]).map((cat,ci)=>(
                            <div key={ci} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:99,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:13,fontWeight:600,color:"var(--accent-text)"}}>
                              {cat}
                              <button onClick={()=>removeCatFromAcc(a.id,cat)} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--accent-text)",fontSize:14,lineHeight:1,padding:0}}>✕</button>
                            </div>
                          ))}
                        </div>
                        {/* 카테고리 추가 */}
                        <div style={{display:"flex",gap:8}}>
                          <input
                            className="inp"
                            placeholder="카테고리명 입력 (예: 맛집, 여행, 리뷰)"
                            value={catInput}
                            onChange={e=>setCatInput(e.target.value)}
                            onKeyDown={e=>{if(e.key==="Enter")addCatToAcc(a.id);}}
                            style={{flex:1,fontSize:13}}
                          />
                          <button onClick={()=>addCatToAcc(a.id)} className="btn btn-primary" style={{padding:"0 16px",flexShrink:0}}>추가</button>
                        </div>
                        {botOnline&&(
                          <button onClick={async()=>{await loadCategories(a.platform);setEditingCatAccId(a.id);}} style={{marginTop:8,width:"100%",padding:"8px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                            🔄 봇에서 자동 불러오기
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ===== 📊 블로그 순위 ===== */}
            {tab==="rank"&&(
              <div style={{animation:"fadeUp .25s ease both",height:"calc(100vh - 58px - 40px)",display:"flex",flexDirection:"column"}}>
                {/* 헤더 */}
                <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                  <div>
                    <div style={{fontSize:16,fontWeight:900,color:"var(--text)"}}>📊 블로그 순위 확인</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>내 네이버 블로그 키워드 순위를 확인해요</div>
                  </div>
                  <button onClick={()=>setShowRankInfo(true)}
                    style={{padding:"7px 14px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 3px 10px rgba(255,64,129,.35)",flexShrink:0}}>
                    💡 키 입력 안내
                  </button>
                </div>
                {/* iframe */}
                <div style={{flex:1,borderRadius:"0 0 0 0",overflow:"hidden",border:"1px solid var(--border)",borderLeft:"none",borderRight:"none",borderBottom:"none"}}>
                  <iframe
                    src="https://rank.xn--zk5biyyw.com/"
                    style={{width:"100%",height:"100%",border:"none",display:"block"}}
                    title="블로그 순위 확인"
                    allow="clipboard-read; clipboard-write"
                  />
                </div>
              </div>
            )}

            {/* ===== 설정 ===== */}
            {/* ===== 📅 콘텐츠 캘린더 ===== */}
            {tab==="calendar"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 설정 카드 */}
                <div className="card">
                  <div className="card-title" style={{marginBottom:16}}>📅 콘텐츠 캘린더 생성</div>
                  <div style={{marginBottom:14}}>
                    <label className="inp-label">🔑 키워드 입력 (쉼표 또는 줄바꿈으로 구분)</label>
                    <textarea className="inp" rows={4} placeholder={"예: 다이어트 방법, 제주도 여행, 강남 맛집\n오징어 젓갈, 홈카페 레시피"}
                      value={calKeywords} onChange={e=>setCalKeywords(e.target.value)} style={{resize:"vertical"}}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    <div>
                      <label className="inp-label">📱 플랫폼</label>
                      <div style={{display:"flex",gap:8}}>
                        {(["naver","tistory"] as const).map(p=>(
                          <button key={p} onClick={()=>setCalPlatform(p)}
                            style={{flex:1,padding:"10px",borderRadius:10,border:`1.5px solid ${calPlatform===p?"var(--accent)":"var(--border)"}`,background:calPlatform===p?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",color:calPlatform===p?"var(--accent-text)":"var(--text2)",transition:"all .15s"}}>
                            {p==="naver"?"🟢 네이버":"🟠 티스토리"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="inp-label">📆 기간</label>
                      <div style={{display:"flex",gap:8}}>
                        {[7,14,30].map(d=>(
                          <button key={d} onClick={()=>setCalDays(d)}
                            style={{flex:1,padding:"10px",borderRadius:10,border:`1.5px solid ${calDays===d?"var(--accent)":"var(--border)"}`,background:calDays===d?"var(--accent-bg)":"var(--bg)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",color:calDays===d?"var(--accent-text)":"var(--text2)",transition:"all .15s"}}>
                            {d}일
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-full" onClick={generateCalendar} disabled={calLoading||!calKeywords.trim()}>
                    {calLoading?<><span className="spinner"/>AI 스케줄 생성 중...</>:"✨ AI 스케줄 자동 생성"}
                  </button>
                </div>

                {/* 스케줄 결과 */}
                {calDone&&calSchedule.length>0&&(
                  <div className="card" style={{marginTop:0,padding:0,overflow:"hidden",animation:"fadeUp .2s ease both"}}>
                    <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div className="card-title" style={{margin:0}}>📋 {calSchedule.length}일치 발행 스케줄</div>
                      <button onClick={()=>{
                        const csv=["날짜,키워드,제목,스타일,수익유형",...calSchedule.map(s=>`${s.date},${s.keyword},"${s.title}",${s.style},${s.adType}`)].join("\n");
                        const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv"}));a.download="콘텐츠캘린더.csv";a.click();
                      }} style={{padding:"6px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                        📥 CSV 다운로드
                      </button>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead>
                          <tr style={{background:"var(--bg2)"}}>
                            {["날짜","키워드","제목","스타일","수익"].map(h=>(
                              <th key={h} style={{padding:"9px 12px",textAlign:"left",fontWeight:700,color:"var(--text3)",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                            ))}
                            <th style={{padding:"9px 12px",borderBottom:"1px solid var(--border)"}}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {calSchedule.map((s,i)=>{
                            const d=new Date(s.date);
                            const dow=["일","월","화","수","목","금","토"][d.getDay()];
                            const isWeekend=d.getDay()===0||d.getDay()===6;
                            return(
                              <tr key={i} style={{borderBottom:"1px solid var(--border)",transition:"background .1s"}}
                                onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                                onMouseLeave={e=>(e.currentTarget.style.background="")}>
                                <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                  <span style={{fontWeight:700,color:isWeekend?"var(--warn)":"var(--text)"}}>{s.date}</span>
                                  <span style={{fontSize:10,marginLeft:4,color:"var(--text3)"}}>({dow})</span>
                                </td>
                                <td style={{padding:"10px 12px",color:"var(--accent-text)",fontWeight:700,whiteSpace:"nowrap"}}>{s.keyword}</td>
                                <td style={{padding:"10px 12px",color:"var(--text)",maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.title}</td>
                                <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                  <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:"var(--card2)",color:"var(--text2)",border:"1px solid var(--border)"}}>{s.style}</span>
                                </td>
                                <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                                  <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,
                                    background:s.adType==="adpost"?"rgba(3,199,90,.1)":"rgba(66,133,244,.1)",
                                    color:s.adType==="adpost"?"var(--naver)":"#4285F4",
                                    border:`1px solid ${s.adType==="adpost"?"rgba(3,199,90,.3)":"rgba(66,133,244,.3)"}`}}>
                                    {s.adType==="adpost"?"애드포스트":"애드센스"}
                                  </span>
                                </td>
                                <td style={{padding:"10px 12px"}}>
                                  <button onClick={()=>{setKeyword(s.keyword);setSelectedTitle(s.title);setTab("write");showToast("키워드와 제목이 적용됐어요!");}}
                                    style={{padding:"4px 10px",borderRadius:7,border:"1px solid var(--accent-border)",background:"var(--accent-bg)",color:"var(--accent-text)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                                    글 생성 →
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab==="settings"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 큰 글씨 모드 */}
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div>
                      <div className="card-title" style={{marginBottom:4}}>🔠 큰 글씨 모드</div>
                      <div style={{fontSize:12,color:"var(--text3)"}}>어르신·시력 불편한 분께 추천 — 전체 글씨 크기 확대</div>
                    </div>
                    <button onClick={()=>{const next=fontMode==="normal"?"large":"normal";setFontMode(next);localStorage.setItem("publy_font_mode",next);}}
                      style={{padding:"8px 20px",borderRadius:99,border:"none",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",transition:"all .2s",
                        background:fontMode==="large"?"var(--accent)":"var(--card2)",
                        color:fontMode==="large"?"#000":"var(--text2)",
                        boxShadow:fontMode==="large"?"0 3px 12px var(--accent-30)":"none"}}>
                      {fontMode==="large"?"✅ 켜짐":"OFF"}
                    </button>
                  </div>
                </div>

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
                <div className="card">
                  <div className="card-title" style={{marginBottom:14}}>🔐 비밀번호 변경</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div>
                      <label className="inp-label">현재 비밀번호</label>
                      <input className="inp" type="password" placeholder="현재 비밀번호" value={currentPw} onChange={e=>setCurrentPw(e.target.value)}/>
                    </div>
                    <div>
                      <label className="inp-label">새 비밀번호 (6자 이상)</label>
                      <input className="inp" type="password" placeholder="새 비밀번호" value={newPw1} onChange={e=>setNewPw1(e.target.value)}/>
                    </div>
                    <div>
                      <label className="inp-label">새 비밀번호 확인</label>
                      <input className="inp" type="password" placeholder="새 비밀번호 재입력" value={newPw2} onChange={e=>setNewPw2(e.target.value)}/>
                    </div>
                    <button className="btn btn-primary" onClick={handleChangePw} disabled={pwChanging} style={{alignSelf:"flex-start"}}>
                      {pwChanging?<><span className="spinner"/>변경 중...</>:"🔐 비밀번호 변경"}
                    </button>
                    {pwMsg&&<div className={`alert-box ${pwMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:0}}>{pwMsg}</div>}
                  </div>
                </div>

                {/* 네이버 API 키 */}
                <div className="card">
                  <div className="card-title" style={{marginBottom:4}}>🟢 네이버 검색광고 API <span style={{fontSize:10,fontWeight:400,color:"var(--text3)"}}>(선택 — 없으면 관리자 공용키 사용)</span></div>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>개인 키 입력 시 일일 한도 없이 무제한 사용 가능해요</div>
                  <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                    <a href="https://searchad.naver.com" target="_blank" rel="noreferrer"
                      style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,border:"1px solid rgba(3,199,90,.4)",background:"rgba(3,199,90,.08)",color:"var(--naver)",fontSize:12,fontWeight:700,textDecoration:"none",whiteSpace:"nowrap"}}>
                      🔗 검색광고 API 발급 →
                    </a>
                    <a href="https://developers.naver.com/apps/#/list" target="_blank" rel="noreferrer"
                      style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,border:"1px solid rgba(3,199,90,.3)",background:"transparent",color:"var(--naver)",fontSize:12,fontWeight:700,textDecoration:"none",whiteSpace:"nowrap"}}>
                      🔗 DataLab API 발급 →
                    </a>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {[
                      {label:"Customer ID",key:"naver_customer_id",ph:"123456789"},
                      {label:"Access License",key:"naver_access_license",ph:"xxxx-xxxx-xxxx"},
                      {label:"Secret Key",key:"naver_secret_key",ph:"secret"},
                    ].map(f=>(
                      <div key={f.key}>
                        <label className="inp-label">{f.label}</label>
                        <input className="inp" placeholder={f.ph} value={(naverKeys as any)[f.key]||""} onChange={e=>setNaverKeys(p=>({...p,[f.key]:e.target.value}))}/>
                      </div>
                    ))}
                    <div className="card-title" style={{marginBottom:4,marginTop:8}}>📊 네이버 DataLab API</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:4}}>검색 트렌드 분석에 사용</div>
                    {[
                      {label:"Client ID",key:"naver_datalab_client_id",ph:"Client ID"},
                      {label:"Client Secret",key:"naver_datalab_client_secret",ph:"Client Secret"},
                    ].map(f=>(
                      <div key={f.key}>
                        <label className="inp-label">{f.label}</label>
                        <input className="inp" placeholder={f.ph} value={(naverKeys as any)[f.key]||""} onChange={e=>setNaverKeys(p=>({...p,[f.key]:e.target.value}))}/>
                      </div>
                    ))}
                    <button className="btn btn-primary" style={{alignSelf:"flex-start"}} disabled={naverKeysSaving} onClick={async()=>{
                      setNaverKeysSaving(true); setNaverKeysMsg("");
                      try{ await saveNaverApiKeys(user.id, naverKeys); setNaverKeysMsg("✅ 저장 완료!"); showToast("🟢 네이버 API 키 저장됐어요!"); }
                      catch(e:any){ setNaverKeysMsg("❌ "+e.message); }
                      finally{ setNaverKeysSaving(false); setTimeout(()=>setNaverKeysMsg(""),3000); }
                    }}>
                      {naverKeysSaving?<><span className="spinner"/>저장 중...</>:"💾 키 저장"}
                    </button>
                    {naverKeysMsg&&<div className={`alert-box ${naverKeysMsg.includes("✅")?"alert-success":"alert-danger"}`} style={{margin:0}}>{naverKeysMsg}</div>}
                  </div>
                </div>
              </div>
            )}
          </div>{/* main */}
        </div>{/* layout */}

        <div className="mob-bar">
          {MAIN_TABS.filter(t=>["keyword","write","image","photo","publish","manage","settings"].includes(t.k)).map(t=>(<button key={t.k} className={`mob-btn ${tab===t.k?"active":""}`} onClick={()=>{if(t.k==="rank"){window.open("https://rank.xn--zk5biyyw.com/","_blank");return;}setTab(t.k as MainTab);}}><span className="mob-btn-ico">{t.i}</span><span className="mob-btn-lbl">{t.k==="keyword"?"키워드":t.k==="write"?"글쓰기":t.k==="image"?"이미지":t.k==="photo"?"사진글":t.k==="publish"?"발행":t.k==="manage"?"발행관리":"설정"}</span></button>))}
        </div>
      </div>

      

      {/* 블로그 순위 키 안내 팝업 */}
      {showRankInfo&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowRankInfo(false)}>
          <div style={{width:"100%",maxWidth:440,borderRadius:20,background:"#1a1f2e",border:"1px solid #2d3548",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.7)"}} onClick={e=>e.stopPropagation()}>
            <div style={{background:"linear-gradient(135deg,#ff6b9d,#ff4081)",padding:"20px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>🔑 API 키 안내</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,.85)",marginTop:3}}>블로그 순위 확인 서비스 사용 전 꼭 읽어주세요</div>
              </div>
              <button onClick={()=>setShowRankInfo(false)} style={{background:"rgba(255,255,255,.25)",border:"none",color:"#fff",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:16,fontFamily:"inherit"}}>✕</button>
            </div>
            <div style={{padding:20,display:"flex",flexDirection:"column",gap:10}}>
              {[
                {ico:"⚠️",title:"키가 매번 초기화돼요",desc:"이 서비스는 API 키를 브라우저 localStorage에 저장해요.\n창을 닫거나 새로고침하면 키가 사라지기 때문에\n들어갈 때마다 다시 입력해야 해요."},
                {ico:"🔑",title:"어떤 키가 필요해요?",desc:"네이버 검색 API의\n• Client ID\n• Client Secret\n두 가지가 필요해요."},
                {ico:"🔗",title:"키 발급 방법",desc:"네이버 개발자센터 (developers.naver.com) 에서\n애플리케이션 등록 후\n'검색' 권한을 추가하면 발급받을 수 있어요."},
                {ico:"💡",title:"팁",desc:"DataLab API 키랑 달라요!\n검색광고 API 키가 아닌\n'네이버 오픈API' 키를 사용해야 해요."},
              ].map((item,i)=>(
                <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",borderRadius:12,background:"#242938"}}>
                  <span style={{fontSize:22,flexShrink:0,lineHeight:1}}>{item.ico}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"#ffffff",marginBottom:4}}>{item.title}</div>
                    <div style={{fontSize:12,color:"#a0aec0",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.desc}</div>
                  </div>
                </div>
              ))}
              <a href="https://developers.naver.com/apps/#/list" target="_blank" rel="noreferrer"
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"12px",borderRadius:12,background:"rgba(3,199,90,.1)",border:"1px solid rgba(3,199,90,.3)",color:"#03C75A",fontSize:13,fontWeight:800,textDecoration:"none"}}>
                🔗 네이버 개발자센터에서 키 발급하기 →
              </a>
            </div>
            <div style={{padding:"0 20px 20px"}}>
              <button onClick={()=>setShowRankInfo(false)} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                알겠어요! 👍
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 황금 키워드 분석 설명 팝업 */}
      {showKwInfo&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowKwInfo(false)}>
          <div style={{width:"100%",maxWidth:460,borderRadius:20,background:"#1a1f2e",border:"1px solid #2d3548",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.7)"}} onClick={e=>e.stopPropagation()}>
            <div style={{background:"linear-gradient(135deg,#ff6b9d,#ff4081)",padding:"20px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>📊 황금 키워드 분석</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,.85)",marginTop:3}}>네이버 실데이터 기반 키워드 점수 분석</div>
              </div>
              <button onClick={()=>setShowKwInfo(false)} style={{background:"rgba(255,255,255,.25)",border:"none",color:"#fff",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>✕</button>
            </div>
            <div style={{padding:20,display:"flex",flexDirection:"column",gap:10}}>
              {[
                {ico:"🎯",title:"어떤 기능이야?",desc:"네이버 검색광고 API로 실제 검색량·경쟁도·CPC를 가져와서 내 키워드가 얼마나 좋은지 점수로 보여줘요"},
                {ico:"⭐",title:"황금점수 계산 방법",desc:"경쟁 낮음(35%) + 검색량 1천~3만(25%) + 클릭률(15%) + CPC 단가(25%)\n+ 구매의도 단어·롱테일 키워드 보너스"},
                {ico:"👆",title:"어떻게 써?",desc:"점수 높은 키워드 클릭 → 키워드 자동 입력\n\"제목 추천 →\" 버튼으로 바로 SEO 제목 생성!"},
                {ico:"📅",title:"무료 사용 한도",desc:`FREE ${NAVER_DAILY_LIMIT.free}회/일 · PRO ${NAVER_DAILY_LIMIT.pro}회/일\n설정탭에서 내 API 키 입력하면 한도 없이 무제한!`},
                {ico:"💻",title:"봇이 필요해요",desc:"PC에서 Publy 봇이 실행 중이어야 사용 가능해요"},
              ].map((item,i)=>(
                <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",borderRadius:12,background:"#242938"}}>
                  <span style={{fontSize:22,flexShrink:0,lineHeight:1}}>{item.ico}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"#ffffff",marginBottom:4}}>{item.title}</div>
                    <div style={{fontSize:12,color:"#a0aec0",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{padding:"0 20px 20px"}}>
              <button onClick={()=>setShowKwInfo(false)} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#ff6b9d,#ff4081)",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(255,64,129,.4)"}}>
                알겠어요! 👍
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 공지 팝업 */}
      {noticePopup&&(
        <div style={{position:"fixed",inset:0,zIndex:9100,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>{localStorage.setItem("publy_dismissed_"+noticePopup.key,"1");setNoticePopup(null);}}>
          <div style={{width:"100%",maxWidth:440,borderRadius:20,background:"var(--card)",border:"1px solid var(--border)",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.6)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{background:"linear-gradient(135deg,var(--accent),#00cc80)",padding:"18px 22px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:16,fontWeight:900,color:"#000"}}>📢 {noticePopup.title}</div>
              <button onClick={()=>{localStorage.setItem("publy_dismissed_"+noticePopup.key,"1");setNoticePopup(null);}}
                style={{background:"rgba(0,0,0,.2)",border:"none",color:"#000",width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:15,fontFamily:"inherit"}}>✕</button>
            </div>
            <div style={{padding:"18px 22px",fontSize:14,color:"var(--text)",lineHeight:1.8,whiteSpace:"pre-line"}}>{noticePopup.body}</div>
            <div style={{padding:"0 22px 20px"}}>
              <button onClick={()=>{localStorage.setItem("publy_dismissed_"+noticePopup.key,"1");setNoticePopup(null);}}
                style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:"var(--accent)",color:"#000",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                확인했어요 👍
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      <div className="toast-wrap">
        {toasts.map(t=>(
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
