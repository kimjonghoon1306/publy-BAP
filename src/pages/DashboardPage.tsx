import React, { useState, useEffect, useCallback, useRef } from "react";
import GoogleFlowCard from "../GoogleFlowCard";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount, upsertAccount, useQuota, addHistory, deleteHistory, deleteAllHistory, changeUserPassword, getNaverApiKeys, saveNaverApiKeys, NaverApiKeys, checkNaverQuota, incrementNaverQuota, getNaverDailyUsage, NAVER_DAILY_LIMIT, getUserNaverApiKeys, logError, PLAN_CONFIG, checkDailyPublishQuota, incrementDailyPublish, getDailyPublishUsage, getNeighborDailyUsage, NEIGHBOR_DAILY_LIMIT, getEngageDailyUsage, ENGAGE_DAILY_LIMIT, InstaDmTarget, InstaDmHistory, InstaDmQuota, getInstaDmTargets, addInstaDmTarget, deleteInstaDmTarget, getInstaDmHistory, addInstaDmHistory, getInstaDmQuota, upsertInstaDmQuota, incrementInstaDmUsage, INSTA_DM_DAILY_LIMIT } from "../lib/supabase";
import { supabase, submitBugReportRow, getMyResolvedBugAlerts, markBugNotified, PublyBugReport } from "../lib/supabase";
import NeighborPage from "./NeighborPage";
import { botFetch, BotEventStream } from "../lib/botApi";
import WebInstallNotice from "../WebInstallNotice";

type MainTab = "keyword" | "write" | "image" | "photo" | "publish" | "manage" | "accounts" | "rank" | "calendar" | "settings" | "neighbor" | "engage" | "insta_dm";
type OnPartnerProduct = {id:string|null;name:string;image:string;price:number|null;available:boolean;partnerUrl:string;shopUrl:string};
type OnPartnerPlacement = "auto"|"adpost"|"after_first"|"middle"|"before_last"|"bottom";
type PublishConcept = "full" | "body_faq" | "body_only";
const ONPARTNER_PLACEMENT_INFO:Record<OnPartnerPlacement,{label:string;desc:string}>={
  auto:{label:"✨ 자동 추천",desc:"글 흐름을 분석해 구매 관심이 높아지는 본문 약 60% 지점에 배치해요. 애드포스트 선택 중에는 광고 예상 구간 뒤로 자동 조정해요."},
  adpost:{label:"📰 애드포스트형",desc:"예상 광고 영역과 바로 붙지 않도록 충분한 본문이 지난 약 70% 지점에 상품 카드를 배치해요."},
  after_first:{label:"첫 번째 소제목 뒤",desc:"도입과 첫 설명을 읽은 직후 상품을 빠르게 보여줘요."},
  middle:{label:"본문 정중앙",desc:"정보와 경험이 쌓인 본문 중간에 상품 카드를 배치해요."},
  before_last:{label:"마지막 소제목 앞",desc:"후기 결론으로 넘어가기 직전에 자연스럽게 구매를 안내해요."},
  bottom:{label:"본문 하단 (FAQ·관련글 전)",desc:"글 전체의 맨끝이 아니라 본문이 끝나고 질문답변·관련글·해시태그가 시작되기 직전에 배치해요."}
};

const BOT = "http://127.0.0.1:3333";
const INSTA_BOT = "http://127.0.0.1:3335";
const BATCH = 30;
const MAX_TITLES = 90;
const MAX_KW = 90;
const GEMINI_MODELS = ["gemini-2.0-flash","gemini-2.0-flash-lite","gemini-2.5-flash","gemini-2.5-flash-lite"];
const PLAN_LABELS: Record<string,string> = {free:"FREE",basic:"BASIC",pro:"PRO",unlimited:"무제한",admin:"ADMIN"};
// 만료일까지 남은 일수 — 자정 기준으로 계산해 시각과 무관하게 항상 동일한 값(상단/하단 D-day 일치)
function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const end = new Date(dateStr); end.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}
function formatDaysLeft(dateStr?: string): string {
  const days = daysUntil(dateStr);
  if (days === null) return "—";
  if (days <= 0) return "오늘 만료";
  return `D-${days}`;
}
function formatKstDateTime(date = new Date(), withSeconds = false): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, withSeconds ? 19 : 16);
}

// datetime-local은 타임존 정보가 없으므로 전송/큐 저장 전에 KST offset을 명시한다.
function kstScheduleIso(localValue: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(localValue)) return undefined;
  const normalized = localValue.length === 16 ? `${localValue}:00` : localValue;
  const iso = `${normalized}+09:00`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

const WRITE_AI_LIST = [
  {id:"gemini",label:"Gemini Flash",sub:"무료",placeholder:"AIza...",storageKey:"publy_gemini_key",link:"https://aistudio.google.com/app/apikey",color:"#4285F4",logo:"G",free:true},
  {id:"groq",  label:"Groq Llama 3",sub:"무료",placeholder:"gsk_...",storageKey:"publy_groq_key",  link:"https://console.groq.com/keys",          color:"#F55036",logo:"L",free:true},
  {id:"openai",label:"GPT-4o",       sub:"유료",placeholder:"sk-...", storageKey:"publy_openai_key",link:"https://platform.openai.com/api-keys",   color:"#10A37F",logo:"O",free:false},
];
const IMAGE_AI_LIST = [
  {id:"openai_img",label:"DALL-E 3",         sub:"유료",placeholder:"sk-...", storageKey:"publy_openai_key",   link:"https://platform.openai.com/api-keys",     color:"#10A37F",logo:"O"},
  {id:"replicate", label:"Flux (Replicate)", sub:"유료",placeholder:"r8_...", storageKey:"publy_replicate_key",link:"https://replicate.com/account", color:"#8B5CF6",logo:"R"},
];
const WRITE_STYLES = [
  {id:"감성일기", i:"📔", desc:"감성·경험 중심 에세이체"},
  {id:"정보글",  i:"📋", desc:"SEO 최적화 정보 전달"},
  {id:"맛집후기",i:"🍽️", desc:"음식·분위기·가격 묘사"},
  {id:"여행기",  i:"✈️", desc:"일정·팁·감성 여행 스토리"},
] as const;
type WriteStyle = typeof WRITE_STYLES[number]["id"];
// ★ 스타일마다 글의 "방향"이 확실히 달라지게 — 구조·어조·시작·초점·문장끝을 서로 다르게 지정.
//   (endTone은 아래 프롬프트의 공통 문장끝 규칙을 스타일별로 덮어씀 → 정보글이 감성글로 끌려가지 않게)
const WRITE_STYLE_GUIDE: Record<WriteStyle,string> = {
  "감성일기":`[글의 방향: 감성일기]
• 목적: 정보 전달이 아니라 '그날의 감정과 경험'을 나누는 개인 에세이.
• 시작: 그날의 장면·기분으로 훅 (예: "요즘 마음이 복잡했는데, 그날따라…").
• 구조: 시간 흐름(그날 아침→그 순간→돌아보며). 흐름을 끊지 않는 자연스러운 질문형 소제목 4~5개로 구간을 나누기.
• 초점: 오감·감정·내면의 변화. 수치/스펙 나열 금지. 독자에게 말 걸며 공감 유도.
• 금지: 번호 목록, 표, 딱딱한 정보 나열.`,
  "정보글":`[글의 방향: 정보글]
• 목적: 독자가 '검색해서 답을 얻으러 온' 실용 정보 제공. 감성 최소.
• 시작: 문제 정의/핵심 결론 먼저 (예: "결론부터 말하면 …").
• 구조: 소제목으로 논리 구획 + 번호 목록(1. 2. 3.) 적극 사용. 비교·기준·수치·표현 위주.
• 초점: 정확한 정보·근거·주의사항·자주 묻는 질문. SEO 키워드 자연 반복.
• 어조: 담백하고 신뢰감 있게. 과한 감탄사·이모지 자제. (감성 회고 금지)`,
  "맛집후기":`[글의 방향: 맛집후기]
• 목적: 실제 다녀온 사람의 생생한 방문기. 먹고 싶게 만드는 게 핵심.
• 시작: 방문 계기/첫인상 (예: "웨이팅 30분 감수하고 다녀왔어요").
• 구조: 위치·분위기 → 주문한 메뉴 → 맛/식감/향 묘사 → 가격 → 총평·재방문 의향.
• 초점: 맛·비주얼·식감을 오감으로 묘사 + 가격/주차/웨이팅/영업시간 실정보 반드시.
• 금지: 안 먹어본 듯한 두루뭉술. 구체 메뉴명·가격 필수.`,
  "여행기":`[글의 방향: 여행기]
• 목적: 따라 떠나고 싶게 만드는 여정 스토리 + 실전 팁.
• 시작: 떠난 이유/설렘 (예: "훌쩍 떠난 1박2일, 여기 진짜였어요").
• 구조: 여행지 소개 → 이동/교통·비용 → 코스 순서대로(일정) → 포토스팟·맛집 → 숙소 → 꿀팁/총평.
• 초점: 현장 분위기 감성 묘사 + 교통비·입장료·숙박비 등 실비용, 포토스팟 위치.
• 금지: 정보만 나열(감성 없이)하거나, 감성만 있고 팁 없는 글.`,
};
// 스타일별 문장끝/어조 — 공통 규칙(~해요,~거든요…)이 정보글까지 감성체로 만들지 않도록 덮어씀
const WRITE_STYLE_ENDTONE: Record<WriteStyle,string> = {
  "감성일기":"문장 끝: ~했어요, ~더라고요, ~거든요, ~잖아요 를 섞어 잔잔하고 다정하게.",
  "정보글":  "문장 끝: ~합니다, ~입니다 중심의 담백한 정보체. 감성 회고·과한 감탄 금지.",
  "맛집후기":"문장 끝: ~했어요, ~더라고요, ~네요 로 생생하게. 맛 표현은 구체적으로.",
  "여행기":  "문장 끝: ~했어요, ~더라고요, ~거든요 로 여정을 들려주듯.",
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
const NAV_GROUPS = [
  {label:"콘텐츠 만들기",tabs:[
    {k:"keyword",i:"🔍",l:"키워드/제목"},{k:"write",i:"✍️",l:"글 생성"},{k:"image",i:"🖼️",l:"이미지 생성"},{k:"photo",i:"📷",l:"사진 글쓰기"},{k:"publish",i:"🚀",l:"발행하기"},
  ]},
  {label:"블로그 운영",tabs:[
    {k:"manage",i:"📋",l:"발행 관리"},{k:"rank",i:"📊",l:"블로그 순위"},{k:"calendar",i:"📅",l:"콘텐츠 캘린더"},
  ]},
  {label:"관계·소통 자동화",tabs:[
    {k:"neighbor",i:"🤝",l:"서이추"},{k:"engage",i:"❤️",l:"공감·댓글"},{k:"insta_dm",i:"📱",l:"인스타 DM"},
  ]},
  {label:"계정·설정",tabs:[
    {k:"accounts",i:"🔗",l:"계정 관리"},{k:"settings",i:"⚙️",l:"설정"},
  ]},
] as const satisfies ReadonlyArray<{label:string;tabs:ReadonlyArray<{k:MainTab;i:string;l:string}>}>;
const MAIN_TABS: ReadonlyArray<{k:MainTab;i:string;l:string}> = NAV_GROUPS.flatMap(group=>
  group.tabs as unknown as ReadonlyArray<{k:MainTab;i:string;l:string}>
);

const DM_TEMPLATES = [
  {label:"🎁 체험단 제안",message:"안녕하세요, [이름]님 😊 콘텐츠를 인상 깊게 보고 연락드렸어요. [브랜드명]의 [상품명]을 직접 체험해 보실 수 있도록 제안드리고 싶어요. 관심 있으시면 편하게 답장 부탁드려요!"},
  {label:"🤝 협찬 제안",message:"안녕하세요, [이름]님. [브랜드명] 담당자입니다. [이름]님의 콘텐츠 분위기와 저희 [상품명]이 잘 어울릴 것 같아 협업을 제안드려요. 자세한 내용이 궁금하시면 답장 부탁드립니다 😊"},
  {label:"💬 부드러운 첫인사",message:"안녕하세요, [이름]님 😊 평소 콘텐츠를 잘 보고 있어요. 함께 재미있는 콘텐츠를 만들어볼 수 있을 것 같아 조심스럽게 연락드렸습니다. 괜찮으시면 간단한 제안 내용을 보내드려도 될까요?"},
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
  --g-fg:#eef7ff;--g-fg2:rgba(232,244,255,.72);--g-green:#00ff9d;--g-yellow:#FFD93D;--g-pink:#FF6B9D;--g-surface:#0d1a0d;--g-surface2:#132414;--g-line:rgba(255,255,255,.08);
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
  --g-fg:#0d1f2d;--g-fg2:#42607a;--g-green:#0a8f57;--g-yellow:#956e00;--g-pink:#d6336c;--g-surface:#ffffff;--g-surface2:#eef3f8;--g-line:#dbe4ec;
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
.layout{flex:1;display:flex;overflow:hidden;min-height:0;}
.sidebar{position:relative;flex-shrink:0;z-index:50;width:210px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 8px;gap:2px;overflow-y:auto;}
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
.guide-header{padding:22px 22px 0;background:var(--g-surface2);flex-shrink:0;border-bottom:1px solid var(--g-line);}
.guide-logo-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.guide-logo-ico{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#00ff9d,#00c870);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.guide-title{font-size:20px;font-weight:900;color:var(--g-fg);}
.guide-subtitle{font-size:12px;color:var(--g-fg2);margin-top:3px;}
.guide-tabs{display:flex;overflow-x:auto;scrollbar-width:none;}
.guide-tabs::-webkit-scrollbar{display:none;}
.guide-tab{padding:11px 16px;border:none;background:transparent;font-size:12px;font-weight:700;color:var(--g-fg2);cursor:pointer;font-family:'Noto Sans KR',sans-serif;white-space:nowrap;border-bottom:3px solid transparent;transition:all .15s;flex-shrink:0;}
.guide-tab.active{color:var(--g-yellow);border-bottom-color:var(--g-yellow);}
.guide-body{flex:1;overflow-y:auto;background:var(--g-surface);padding:18px 18px 22px;min-height:0;}
.guide-body::-webkit-scrollbar{width:4px;}
.guide-body::-webkit-scrollbar-thumb{background:var(--g-line);border-radius:99px;}
.guide-close{position:absolute;top:14px;right:16px;width:32px;height:32px;border-radius:99px;background:var(--g-surface2);border:1px solid var(--g-line);color:var(--g-fg);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;z-index:10;}
.guide-close:hover{filter:brightness(.94);}
.g-step{border-radius:15px;padding:15px 15px;margin-bottom:10px;border:1.5px solid;}
.g-step-num{font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;display:flex;align-items:center;gap:6px;}
.g-step-title{font-size:15px;font-weight:900;margin-bottom:5px;line-height:1.3;}
.g-step-desc{font-size:13px;line-height:1.85;color:var(--g-fg2);}
.g-step-desc b{font-weight:900;color:var(--g-fg);}
.g-tip{margin-top:9px;padding:9px 12px;border-radius:9px;background:var(--g-surface2);font-size:12px;line-height:1.75;color:var(--g-fg2);}
.g-tip b{font-weight:800;color:var(--g-yellow);}
.g-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 18px;border-radius:99px;border:none;font-size:13px;font-weight:800;font-family:'Noto Sans KR',sans-serif;cursor:pointer;margin-top:11px;transition:all .15s;}
.g-btn:hover{filter:brightness(1.1);transform:translateY(-1px);}
.guide-footer{padding:12px 18px;background:var(--g-surface2);border-top:1px solid var(--g-line);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;flex-wrap:wrap;}
.guide-nav-btn{padding:9px 20px;border-radius:99px;border:1.5px solid;font-size:13px;font-weight:700;font-family:'Noto Sans KR',sans-serif;cursor:pointer;transition:all .15s;}
.guide-page{font-size:12px;color:var(--g-fg2);font-weight:600;}
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
  .header-mid{display:none;}.server-chip{display:none;}.quota-chip{display:none;}.dl-btn{display:none;}.main{padding:14px 12px calc(80px + env(safe-area-inset-bottom));}.card{padding:16px 14px;}
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
  /* 캘린더 모바일 */
  .cal-grid{grid-template-columns:1fr !important;}
  /* 서이추 모바일 */
  .neighbor-grid{grid-template-columns:1fr !important;}
  /* 카운터 3분할 유지 */
  .counter-grid{grid-template-columns:repeat(3,1fr) !important;}
  .pub-sticky-bar{padding:10px 12px;overflow:hidden;}
  .pub-actions{width:100%;margin-left:0 !important;display:grid !important;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px !important;}
  .pub-actions>button,.pub-actions>div>button{width:100%;justify-content:center;padding:10px 7px !important;}
  .pub-actions>div{min-width:0;}
}
@media(max-width:480px){
  .header{padding:0 8px;gap:5px;}.user-name{display:none;}.logout-btn{display:none;}.quota-chip{display:none;}
  .dl-btn span:last-child{display:none;}.dl-btn{padding:9px 12px;}
  .guide-open-btn{font-size:11px;padding:6px 10px;}
  .adtype-row{grid-template-columns:1fr;}.guide-overlay{padding:6px;}
  .guide-modal{max-height:calc(100dvh - 12px - env(safe-area-inset-top) - env(safe-area-inset-bottom));border-radius:16px;}.guide-tab{font-size:11px;padding:9px 11px;}
  .acc-form-grid{grid-template-columns:1fr !important;}
  .pub-plat-grid{grid-template-columns:1fr !important;}
  /* 카카오 버튼 모바일 - 아이콘만 */
  .kakao-float-text{display:none;}
  .kakao-float{padding:12px !important;border-radius:50% !important;width:48px;height:48px;justify-content:center;}
}
.on-service-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.on-service-card{min-width:0;padding:14px;border-radius:14px;border:1px solid var(--border);background:var(--bg);color:var(--text);text-align:left;font-family:inherit;cursor:pointer;transition:transform .18s,border-color .18s;}
.on-service-card:hover{transform:translateY(-2px);border-color:var(--accent);}.on-service-card b{display:block;font-size:13px;margin:8px 0 4px}.on-service-card small{display:block;color:var(--text3);font-size:10px;line-height:1.55}.on-service-card em{display:block;color:var(--accent-text);font-size:10px;font-style:normal;font-weight:800;margin-top:9px}
.service-info-overlay{position:fixed;inset:0;z-index:9998;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72);backdrop-filter:blur(7px)}.service-info-dialog{position:relative;width:min(590px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;padding:27px;border:1px solid rgba(0,214,143,.38);border-radius:23px;background:var(--card);box-shadow:0 24px 80px rgba(0,0,0,.48)}.service-info-close{position:absolute;right:14px;top:10px;border:0;background:transparent;color:var(--text3);font-size:27px;cursor:pointer}.service-info-kicker{color:var(--accent-text);font-size:10px;font-weight:900;letter-spacing:.08em}.service-info-dialog h2{margin:7px 35px 8px 0;font-size:24px}.service-info-hook{color:var(--text2);font-size:14px;line-height:1.65}.service-info-benefits{display:grid;gap:8px;margin:18px 0}.service-info-benefit{padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg)}.service-info-benefit b,.service-info-benefit span{display:block}.service-info-benefit b{font-size:13px}.service-info-benefit span{margin-top:3px;color:var(--text3);font-size:11px;line-height:1.5}.service-info-flow{padding:12px;border-radius:12px;background:rgba(0,214,143,.09);color:var(--accent-text);font-size:11px;font-weight:800;line-height:1.6}.service-info-footer{display:flex;align-items:center;gap:9px;margin-top:18px}.service-info-cta{flex:1;display:flex;justify-content:center;padding:13px;border:0;border-radius:12px;background:var(--accent);color:#02170f;font-size:13px;font-weight:900;text-decoration:none}.service-info-cta:disabled{opacity:.48}.service-info-coming{padding:8px 10px;border:1px solid rgba(255,80,150,.4);border-radius:999px;color:#ff5a9f;font-size:10px;font-weight:900;white-space:nowrap}
.service-info-overlay.service-info-dark{--card:#111820;--text:#e8f4ff;--text2:#a6bdd0;--text3:#7895aa;--bg:#0d1117;--border:#2a3a49;--accent:#00d68f;--accent-text:#21e6a4}.service-info-overlay.service-info-light{--card:#fff;--text:#0d1f2d;--text2:#3f596d;--text3:#607c91;--bg:#f2f6f9;--border:#cbd8e2;--accent:#00c781;--accent-text:#08794f}.service-info-dialog{color:var(--text)!important;background:var(--card)!important}.service-info-dialog h2,.service-info-benefit{color:var(--text)!important}.service-info-close{width:36px;height:36px;border:1px solid var(--border)!important;border-radius:10px;background:var(--bg)!important;color:var(--text)!important}
@media(max-width:640px){.on-service-grid{display:flex;gap:8px;overflow-x:auto;margin:0 -2px;padding:2px 2px 7px;scrollbar-width:none;scroll-snap-type:x proximity}.on-service-grid::-webkit-scrollbar{display:none}.on-service-card{flex:0 0 150px;min-height:80px;padding:10px;display:grid;grid-template-columns:30px 1fr;column-gap:8px;scroll-snap-align:start}.on-service-card>span{grid-row:1/4;font-size:19px !important}.on-service-card b{font-size:12px;margin:0 0 2px}.on-service-card small{font-size:10px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.on-service-card em{font-size:10px;margin-top:4px}.service-info-dialog{padding:22px 16px;border-radius:19px}.service-info-dialog h2{font-size:21px}.service-info-footer{align-items:stretch;flex-direction:column}.service-info-cta{width:100%;box-sizing:border-box}.service-info-coming{text-align:center}}
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
type ServiceInfoKey = "farm"|"trial"|"partner"|"publy"|"onai"|"oncatch"|"valhalla"|"gostop"|"sky"|"stickman"|"messenger"|"studio"|"honsa"|"news";
const PUBLY_SERVICE_INFO: Record<ServiceInfoKey,{icon:string;name:string;aliases?:string[];hook:string;summary:string;benefits:[string,string][];flow:string;cta:string;url?:string;coming?:boolean}> = {
  farm:{icon:"🌱",name:"온종일팜",hook:"홍보할 상품을 찾는 시간부터 줄이세요. 신선한 산지 상품이 콘텐츠의 소재와 구매 전환으로 이어집니다.",summary:"홍보할 산지 상품을 빠르게 찾아보세요.",benefits:[["신선한 상품 발견","제철 먹거리와 산지 상품을 한곳에서 고릅니다."],["콘텐츠가 구매로 연결","상품 상세 정보와 구매 흐름이 자연스럽게 이어집니다."],["온파트너와 수익화","고른 상품으로 추천 링크를 만들어 판매 성과를 쌓습니다."]],flow:"온종일팜 상품 선택 → 온파트너 링크 발급 → 퍼블리 홍보글 작성 → 구매 전환",cta:"온종일팜 이용하기",url:"https://app.yuanfnb.com"},
  trial:{icon:"🎁",name:"온종일 체험단",aliases:["온종일체험단","온종일 체험단"],hook:"좋아하는 상품과 매장을 먼저 경험하고, 진짜 경험이 담긴 리뷰로 콘텐츠의 신뢰도를 키우세요.",summary:"상품을 체험하고 리뷰 경쟁력을 키워보세요.",benefits:[["상품·매장 직접 체험","관심 있는 캠페인을 골라 직접 경험합니다."],["리뷰 소재 확보","사진과 경험이 쌓여 블로그·SNS 글이 더 풍성해집니다."],["크리에이터 성장","포트폴리오와 브랜드 협업 기회를 넓힙니다."]],flow:"캠페인 발견 → 체험 신청 → 상품·매장 경험 → 리뷰 발행",cta:"신청하기",url:"https://pick.온종일.com"},
  partner:{icon:"🔗",name:"온파트너",hook:"내가 소개한 상품이 팔릴 때마다 링크가 수익이 됩니다. 플랫폼 제약 없이 내 콘텐츠가 있는 곳이면 시작할 수 있어요.",summary:"추천 링크를 퍼블리 글에 넣고 판매 수익을 만드세요.",benefits:[["링크 하나로 수익 추적","클릭·구매·수익을 회원 대시보드에서 확인합니다."],["사이트 제약 없음","네이버 블로그, 틱톡, 유튜브, 인스타그램, 개인 홈페이지 등 어디서든 활용합니다."],["퍼블리와 바로 연결","상품 링크를 넣으면 제품 소개와 제휴 안내가 글에 자동 반영됩니다."]],flow:"온종일팜 상품 선택 → 내 추천 링크 생성 → 퍼블리·SNS 홍보 → 판매 수익",cta:"온파트너 신청하기",url:"https://partner.yuanfnb.com/pages/signup.html"},
  publy:{icon:"🚀",name:"퍼블리",hook:"글쓰기부터 이미지, 발행, 예약까지 블로그 운영을 자동으로. 클릭 몇 번이면 네이버·티스토리에 완성된 글이 올라갑니다.",summary:"블로그 글 작성과 발행을 자동으로 해주는 프로그램이에요.",benefits:[["AI 글·이미지 자동 생성","키워드만 넣으면 SEO에 맞는 본문과 이미지를 만들어요."],["네이버·티스토리 자동 발행","예약 발행까지 지원해 컴퓨터를 꺼도 원하는 시간에 올라가요."],["이웃·공감 자동화","블로그 운영에 드는 반복 작업을 대신 처리해요."]],flow:"키워드 입력 → AI 글·이미지 생성 → 검토 → 자동 발행/예약",cta:"퍼블리 시작하기",url:"https://publy.blogautopro.com"},
  onai:{icon:"🤖",name:"온종일AI",aliases:["온종일 AI"],hook:"챗GPT 같은 AI 검색에 내 브랜드가 노출되도록. AI가 추천하는 시대, 검색의 판이 바뀌고 있습니다.",summary:"AI 검색(챗GPT 등)에 노출되게 도와주는 컨설팅이에요.",benefits:[["AI 검색 최적화","AI가 답변에 내 브랜드를 인용하도록 콘텐츠를 설계해요."],["새로운 유입 채널","검색엔진을 넘어 AI 답변에서 오는 방문자를 잡아요."],["브랜드 신뢰 상승","AI가 추천하는 브랜드라는 인식을 만들어요."]],flow:"현황 진단 → AI 노출 콘텐츠 설계 → 적용 → 노출 성과 확인",cta:"온종일AI 상담하기",url:"https://ai.온종일.com"},
  oncatch:{icon:"🎮",name:"온캐치",hook:"게임하며 쌓은 재미가 혜택이 되는 애드버게임 플랫폼. 방치형 RPG부터 카드게임까지 한곳에 모았습니다.",summary:"여러 게임을 즐기며 혜택도 받는 무료 게임 플랫폼이에요.",benefits:[["다양한 무료 게임","방치형 RPG·슈팅·카드·퍼즐 등 여러 게임을 한곳에서 즐겨요."],["출석·랭킹·보상","매일 접속하고 순위에 도전하며 재화를 모아요."],["설치 없이 바로","웹에서 바로 실행되고 앱 설치도 가능해요."]],flow:"접속 → 게임 선택 → 플레이 → 랭킹·보상 획득",cta:"온캐치 즐기기",url:"https://game.온종일.com"},
  valhalla:{icon:"⚔️",name:"온 발할라 레전드",aliases:["발할라","발할라 레전드"],hook:"3D 실시간 액션으로 즐기는 방치형 RPG. 12개 직업과 화려한 필살기로 성장의 재미를 느껴보세요.",summary:"온캐치의 3D 방치형 액션 RPG 게임이에요.",benefits:[["실시간 3D 전투","12개 직업의 개성 있는 필살기와 진화·각성 성장."],["방치형 편의","자동 전투로 접속만 해도 캐릭터가 성장해요."],["랭킹·업적·지갑 연동","다른 유저와 경쟁하고 보상을 모아요."]],flow:"직업 선택 → 자동 성장 → 강화·각성 → 레이드·랭킹",cta:"발할라 플레이",url:"https://game.온종일.com/valhalla"},
  gostop:{icon:"🃏",name:"온캐치 고스톱",aliases:["고스톱"],hook:"언제 어디서든 즐기는 정통 화투 고스톱. 3D 카드 애니메이션과 똑똑한 AI 상대가 기다립니다.",summary:"온캐치의 정통 고스톱 카드게임이에요.",benefits:[["정통 화투 규칙","익숙한 고스톱을 그대로, 3D 카드 연출로."],["AI 상대와 대전","혼자서도 언제든 한 판 즐길 수 있어요."],["지갑·랭킹 연동","이기며 재화를 모으고 순위에 도전해요."]],flow:"입장 → AI와 대전 → 승리 보상 → 랭킹",cta:"고스톱 플레이",url:"https://game.온종일.com/gostop"},
  sky:{icon:"✈️",name:"하늘 수호대",aliases:["하늘수호대"],hook:"손끝으로 조종하는 세로 스크롤 비행 슈팅. 7종의 기체와 필살기로 하늘을 지켜내세요.",summary:"온캐치의 육성형 비행 슈팅 게임이에요.",benefits:[["7종 기체·필살기","기체마다 다른 필살기로 색다른 플레이."],["육성·강화","무한 강화와 기체 해금으로 점점 강해져요."],["손가락 가림 없는 조작","화면을 가리지 않는 드래그 조작과 타격감."]],flow:"기체 선택 → 스테이지 돌파 → 강화·해금 → 보스전",cta:"하늘 수호대 플레이",url:"https://game.온종일.com/sky"},
  stickman:{icon:"🥋",name:"스틱맨 액션",aliases:["스틱맨"],hook:"관절이 살아 움직이는 스틱맨 격투 액션. 주먹·발차기·베기로 통쾌한 타격감을 느껴보세요.",summary:"온캐치의 관절 스틱맨 격투 방치형 RPG예요.",benefits:[["살아있는 관절 액션","스켈레톤 애니메이션으로 부드러운 격투 동작."],["다양한 공격","주먹·발차기·베기·회전 등 통쾌한 액션."],["자동·수동 전투","방치와 조작을 오가며 즐겨요."]],flow:"전투 시작 → 웨이브 돌파 → 강화 → 도전",cta:"스틱맨 플레이",url:"https://game.온종일.com/stickman"},
  messenger:{icon:"💬",name:"온메신저",hook:"관리자가 안전하게 운영하는 커뮤니티 메신저. 친구·단체방·공지·알림까지 깔끔하게 한곳에서.",summary:"안전하게 운영되는 커뮤니티 채팅 메신저예요.",benefits:[["친구·단체방 채팅","1:1과 단체방을 자유롭게, 초대 링크로 간편하게."],["공지·알림","중요한 소식을 공지로 고정하고 푸시 알림을 받아요."],["안전한 운영","관리자 모니터링과 제재로 건강한 커뮤니티 유지."]],flow:"가입 → 친구·방 참여 → 대화·공지 → 알림",cta:"온메신저 시작하기",url:"https://talk.온종일.com"},
  studio:{icon:"🎬",name:"온종일 스튜디오",hook:"영상·디자인 작업을 한눈에 보여주는 포트폴리오. 우리가 만든 결과물로 신뢰를 전합니다.",summary:"온종일의 작품·영상 포트폴리오 사이트예요.",benefits:[["작품 쇼케이스","영상·디자인 결과물을 감각적으로 모아 보여줘요."],["신뢰 전달","실제 만든 결과물로 실력을 증명해요."],["의뢰 연결","마음에 든 작업을 바로 문의로 이어가요."]],flow:"작품 감상 → 관심 작업 확인 → 문의",cta:"스튜디오 둘러보기",url:"https://studio.온종일.com"},
  honsa:{icon:"🏢",name:"온종일 본사",aliases:["온종일닷컴","온종일 홈페이지"],hook:"콘텐츠·커머스·게임·AI까지, 여러 사업을 한 흐름으로 잇는 온종일. 브랜드의 시작점입니다.",summary:"온종일의 사업 전체를 소개하는 본사 사이트예요.",benefits:[["다양한 사업 소개","커머스·체험단·게임·AI 등 온종일의 사업을 한눈에."],["브랜드 신뢰","여러 서비스를 하나의 흐름으로 연결해요."],["파트너 연결","협업·제휴 문의를 바로 이어가요."]],flow:"사업 소개 확인 → 관심 서비스 이동 → 문의",cta:"온종일 살펴보기",url:"https://www.온종일.com"},
  news:{icon:"📰",name:"온종일뉴스",aliases:["온종일 뉴스"],hook:"정치 빼고 실생활에 진짜 도움 되는 소식만. AI·프랜차이즈·정부지원금·마케팅·무료 툴까지 쉽게 풀어드립니다.",summary:"실용 정보 중심의 온라인 뉴스예요.",benefits:[["실용 정보 특화","AI·창업·정부지원금·마케팅 등 바로 써먹는 정보."],["쉽고 신뢰 있게","어려운 소식도 친근하고 이해하기 쉽게 정리."],["트렌드를 빠르게","놓치기 쉬운 지원 사업·무료 툴 소식을 챙겨줘요."]],flow:"관심 주제 확인 → 기사 읽기 → 실생활 적용",cta:"온종일뉴스 보기",url:"https://news.온종일.com",coming:true}
};

export default function DashboardPage({user, onLogout, onAdminLogin, onThemeToggle, theme}: Props) {
  const [appVersion, setAppVersion] = useState("");
  const [serviceInfo, setServiceInfo] = useState<ServiceInfoKey|null>(null);
  useEffect(()=>{
    if(!serviceInfo)return;
    const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setServiceInfo(null)};
    window.addEventListener("keydown",close);document.body.style.overflow="hidden";
    return()=>{window.removeEventListener("keydown",close);document.body.style.overflow=""};
  },[serviceInfo]);
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const handleLogoTap = () => {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 5) { logoTapCount.current = 0; onAdminLogin(); return; }
    logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 1400);
  };
  const [tab, setTab] = useState<MainTab>("keyword");
  const [pageReady, setPageReady] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showInstaWarn, setShowInstaWarn] = useState(false);
  const [guideTab, setGuideTab] = useState(0);
  const [botOnline, setBotOnline] = useState(false);
  // 봇에 실제로 저장된 세션 상태(플랫폼별) — 계정관리 "연결됨"이 거짓말하지 않게.
  const [realSession, setRealSession] = useState<{naver?:boolean;tistory?:boolean;google?:boolean}>({});
  const refreshSessionStatus = useCallback(async()=>{
    try{ const r=await botFetch(`${BOT}/api/session-status/${user.id}`,{signal:AbortSignal.timeout(3000)}); if(r.ok) setRealSession(await r.json()); }catch{}
  },[user.id]);
  useEffect(()=>{ if(botOnline) refreshSessionStatus(); },[botOnline,refreshSessionStatus]);
  // 인스타 DM
  const [dmTargets, setDmTargets] = useState<InstaDmTarget[]>([]);
  const [dmHistory, setDmHistory] = useState<InstaDmHistory[]>([]);
  const [dmQuota, setDmQuota] = useState<InstaDmQuota|null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmSubTab, setDmSubTab] = useState<"send"|"history"|"guide">("guide");
  const [dmTargetInput, setDmTargetInput] = useState("");
  const [dmMessage, setDmMessage] = useState("");
  const [dmAccount, setDmAccount] = useState("");
  const [dmKeyword, setDmKeyword] = useState("");
  const [dmFilter, setDmFilter] = useState<"all"|"pending"|"sent"|"fail"|"skip">("all");
  // 인스타 봇 연동
  const [dmIgPw, setDmIgPw] = useState("");
  const [dmSessionOk, setDmSessionOk] = useState(false);
  const [dmConnecting, setDmConnecting] = useState(false);
  const [dmCrawlKw, setDmCrawlKw] = useState("");
  const [dmMinFollow, setDmMinFollow] = useState("1000");
  const [dmMaxFollow, setDmMaxFollow] = useState("50000");
  const [dmCrawlLimit, setDmCrawlLimit] = useState("30");
  const [dmLogs, setDmLogs] = useState<string[]>([]);
  const [dmRunning, setDmRunning] = useState(false);
  const esDmRef = useRef<BotEventStream|null>(null);
  const dmLog = (m:string)=>setDmLogs(p=>[...p.slice(-200), m]);

  const checkDmSession = async(acct:string)=>{
    if(!acct){setDmSessionOk(false);return;}
    try{ const r=await botFetch(`${INSTA_BOT}/api/session/${encodeURIComponent(acct)}`); const j=await r.json(); setDmSessionOk(!!j.exists); }catch{ setDmSessionOk(false); }
  };

  const connectIg = async()=>{
    const acct=dmAccount.trim().replace(/^@/,"");
    if(!acct||!dmIgPw){showToast("인스타 아이디와 비밀번호를 입력해주세요","error");return;}
    setDmConnecting(true);
    try{
      const r=await botFetch(`${INSTA_BOT}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId:acct,id:acct,pw:dmIgPw})});
      const j=await r.json();
      if(j.success){setDmSessionOk(true);setDmIgPw("");showToast("✅ 인스타 계정 연결 완료!");}
      else showToast("연결 실패: "+(j.error||""),"error");
    }catch(e:any){showToast("로컬 봇 서버에 연결 실패 (봇 실행 확인): "+e.message,"error");}
    setDmConnecting(false);
  };

  const crawlIg = ()=>{
    const acct=dmAccount.trim().replace(/^@/,"");
    if(!acct){showToast("발송 인스타 계정을 먼저 입력/연결해주세요","error");return;}
    if(!dmCrawlKw.trim()){showToast("검색 키워드를 입력해주세요","error");return;}
    setDmRunning(true);setDmLogs([]);
    const url=`${INSTA_BOT}/api/crawl?accountId=${encodeURIComponent(acct)}&keyword=${encodeURIComponent(dmCrawlKw.trim())}&limit=${encodeURIComponent(dmCrawlLimit||"30")}&minFollowers=${encodeURIComponent(dmMinFollow||"0")}&maxFollowers=${encodeURIComponent(dmMaxFollow||"0")}`;
    const es=new BotEventStream(url);esDmRef.current=es;
    es.onmessage=async e=>{
      const d=JSON.parse(e.data);
      if(d.type==="log")dmLog(d.msg);
      else if(d.type==="result"){await addInstaDmTarget({user_id:user.id,username:d.username,followers:d.followers||0,bio:"",keywords:dmCrawlKw,status:"pending",instagram_account:acct});}
      else if(d.type==="crawl_done"){dmLog(`🎉 ${d.results?.length||0}개 수집 완료`);getInstaDmTargets(user.id).then(setDmTargets);es.close();setDmRunning(false);}
      else if(d.type==="error"){dmLog("❌ "+d.msg);es.close();setDmRunning(false);}
    };
    es.onerror=()=>{es.close();setDmRunning(false);dmLog("⚠️ 연결 종료 (로컬 봇 실행 확인)");};
  };

  const sendIg = ()=>{
    const acct=dmAccount.trim().replace(/^@/,"");
    if(!acct){showToast("발송 인스타 계정을 입력/연결해주세요","error");return;}
    if(!dmMessage.trim()){showToast("DM 문구를 입력해주세요","error");return;}
    const igLimit=INSTA_DM_DAILY_LIMIT[user.plan]??5;
    if(instaUsed>=igLimit){setAlertPopup({type:"insta",used:instaUsed,limit:igLimit});return;}
    const remaining=Math.max(0,igLimit-instaUsed);
    const pend=dmTargets.filter(t=>t.status==="pending").slice(0,remaining).map(t=>({id:t.id,username:t.username}));
    if(!pend.length){showToast("발송할 '대기중' 타겟이 없어요","error");return;}
    setDmRunning(true);setDmLogs([]);
    const url=`${INSTA_BOT}/api/send?userId=${encodeURIComponent(user.id)}&accountId=${encodeURIComponent(acct)}&message=${encodeURIComponent(dmMessage)}&targets=${encodeURIComponent(JSON.stringify(pend))}`;
    const es=new BotEventStream(url);esDmRef.current=es;
    es.onmessage=e=>{
      const d=JSON.parse(e.data);
      if(d.type==="log")dmLog(d.msg);
      else if(d.type==="quota_info")dmLog(`💎 오늘 남은 한도 ${d.remaining}개`);
      else if(d.type==="quota_exceeded"){dmLog("🛑 오늘 한도 초과");setAlertPopup({type:"insta",used:d.used,limit:d.limit});es.close();setDmRunning(false);}
      else if(d.type==="progress")dmLog(`📊 진행 ${d.done} · 실패 ${d.fail}`);
      else if(d.type==="done"){dmLog("✅ 발송 작업 완료");getInstaDmTargets(user.id).then(setDmTargets);getInstaDmQuota(user.id).then(q=>{setDmQuota(q);const today=new Date().toISOString().slice(0,10);setInstaUsed(q&&q.reset_date===today?(q.used_today||0):0);});es.close();setDmRunning(false);}
      else if(d.type==="error"){dmLog("❌ "+d.msg);es.close();setDmRunning(false);}
    };
    es.onerror=()=>{es.close();setDmRunning(false);dmLog("⚠️ 연결 종료 (로컬 봇 실행 확인)");};
  };

  const stopDm = ()=>{ try{esDmRef.current?.close();}catch{} setDmRunning(false); dmLog("⏹️ 중단됨"); };
  const [quota, setQuota] = useState<PublyQuota|null>(null);
  const [dailyPublishUsed, setDailyPublishUsed] = useState(0);
  const [neighborUsed, setNeighborUsed] = useState(0);
  const [engageUsed, setEngageUsed] = useState(0);
  const [instaUsed, setInstaUsed] = useState(0);
  const [alertPopup, setAlertPopup] = useState<{type:"expire"|"publish"|"insta"; daysLeft?:number; used?:number; limit?:number} | null>(null);
  // 재연결 비밀번호 입력 모달 (window.prompt는 Electron에서 안 뜸 → 커스텀 모달)
  const [pwPrompt, setPwPrompt] = useState<{acc:PublyAccount; value:string} | null>(null);
  const pwPromptResolve = useRef<((pw:string|null)=>void)|null>(null);
  function askPassword(acc:PublyAccount):Promise<string|null>{
    return new Promise((resolve)=>{ pwPromptResolve.current=resolve; setPwPrompt({acc,value:""}); });
  }
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
    if(platform==="tistory") return Math.floor(Math.random()*1000)+2000; // 2000~3000
    if(adType==="adpost"){
      if(/체험단|맛집|후기|리뷰|방문|다녀/.test(keyword))
        return Math.floor(Math.random()*700)+1800; // 1800~2500
      return Math.floor(Math.random()*500)+1500; // 1500~2000
    }
    return Math.floor(Math.random()*500)+1500; // 1500~2000
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

    // 2. 질문형 소제목 비율 — ★네이버는 ## 금지라 "짧은 독립 줄"도 소제목으로 인정
    const qWords=/하는법|방법|이유|이란|할까|될까|인가|인지|는지|어떻게|왜|무엇|뭐|어디|언제|누구|얼마|추천|고르는|좋을까|괜찮을까/;
    const headings=content.split("\n").map(l=>l.trim()).filter(l=>{
      const t=l.replace(/^#+\s*/,"");                       // ## 접두 제거
      if(t.length<3||t.length>45)return false;              // 소제목 길이대(3~45자)
      if(t.startsWith("[")||/^(Q\d|A\d|POST\d|태그|제목)/.test(t))return false; // 메타/FAQ/태그 제외
      if(l.startsWith("##"))return true;                    // 마크다운 소제목
      if(/[?？]$/.test(t))return true;                       // 물음표로 끝 = 질문 소제목
      // 순수텍스트 소제목: 서술형 종결어미로 끝나지 않는 짧은 줄(제목성)
      return !/[.]$/.test(t)&&!/(요|다|죠|네|까요|습니다|았어|였어|더라고요|거든요|잖아요)$/.test(t);
    });
    const qHeadings=headings.filter(h=>/[?？]/.test(h)||qWords.test(h));
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
  const [onPartnerLink, setOnPartnerLink] = useState("");
  const [onPartnerLoading, setOnPartnerLoading] = useState(false);
  const [onPartnerError, setOnPartnerError] = useState("");
  const [onPartnerPlacement, setOnPartnerPlacement] = useState<OnPartnerPlacement>(()=>(localStorage.getItem("publy_onpartner_placement") as OnPartnerPlacement)||"auto");
  // 온파트너 상품 최대 3개 (banner=서버 /api/banner 가로 배너 URL)
  type OnPartnerItem = { product:OnPartnerProduct; banner:string };
  const [onPartnerItems, setOnPartnerItems] = useState<OnPartnerItem[]>([]);
  const [onPartnerPreview, setOnPartnerPreview] = useState<OnPartnerItem|null>(null); // 조회한 상품(아직 추가 전)
  const MAX_ONPARTNER = 3;
  // ── 내 링크(일반 사이트): URL만 넣으면 네이버가 OG 썸네일 카드로 렌더. 온파트너와 별도 관리(안 엉키게) ──
  const [myLinkInput, setMyLinkInput] = useState("");
  const [myLinks, setMyLinks] = useState<string[]>([]);
  const [myLinkError, setMyLinkError] = useState("");
  const MAX_MYLINK = 3;
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
  const [liveLog, setLiveLog] = useState("");
  const [liveLogCollapsed, setLiveLogCollapsed] = useState(false);
  const [fullLog, setFullLog] = useState<string|null>(null);
  const [fullLogLoading, setFullLogLoading] = useState(false);
  const liveLogSnapshotRef = useRef("");
  const liveLogEndRef = useRef<HTMLDivElement|null>(null);
  const [pubMsg, setPubMsg] = useState("");
  const [pubScope, setPubScope] = useState<"body"|"faq"|"full">("full");
  const [imgGenFailed, setImgGenFailed] = useState(false);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [draftData, setDraftData] = useState<{title:string;content:string;savedAt:string}|null>(null);
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
  const [kstNow, setKstNow] = useState(()=>formatKstDateTime(new Date(), true));
  useEffect(()=>{
    const timer=setInterval(()=>setKstNow(formatKstDateTime(new Date(), true)),1000);
    return ()=>clearInterval(timer);
  },[]);

  useEffect(()=>{
    let alive = true;
    window.electron?.getAppVersion?.().then(version=>{ if(alive) setAppVersion(version); }).catch(()=>{});
    return ()=>{ alive = false; };
  },[]);

  // ★절전 방지(테리 요청): 글쓰기(발행)·이미지 생성 중엔 화면/맥이 안 꺼지게(맥·윈도우 공통).
  //   작업 끝나면 자동으로 해제 → 평소엔 정상 절전. (영화 틀면 안 꺼지는 것과 같은 원리)
  useEffect(()=>{
    const busy = publishing || genImgLoading;
    window.electron?.keepAwake?.(busy).catch(()=>{});
    return ()=>{ if(busy) window.electron?.keepAwake?.(false).catch(()=>{}); };
  },[publishing, genImgLoading]);

  const liveLogActive = (tab==="publish"&&publishing)||(tab==="image"&&genImgLoading);
  useEffect(()=>{
    if(!liveLogActive||!window.electron?.readBotLog)return;
    let alive = true;
    let polling = false;
    setLiveLog("");
    liveLogSnapshotRef.current = "";
    const poll = async()=>{
      if(polling)return;
      polling = true;
      try{
        const next = (await window.electron?.readBotLog?.())||"";
        if(!alive||next===liveLogSnapshotRef.current)return;
        const previous = liveLogSnapshotRef.current;
        let added = next;
        if(previous&&next.startsWith(previous)) added = next.slice(previous.length);
        else if(previous){
          let overlap = Math.min(previous.length,next.length);
          while(overlap>0&&!previous.endsWith(next.slice(0,overlap))) overlap--;
          added = next.slice(overlap);
        }
        liveLogSnapshotRef.current = next;
        if(added) setLiveLog(current=>current+added);
      }catch{}
      finally{ polling = false; }
    };
    void poll();
    const interval = window.setInterval(poll,1250);
    return ()=>{ alive=false; window.clearInterval(interval); };
  },[liveLogActive]);

  useEffect(()=>{
    if(!liveLogCollapsed) liveLogEndRef.current?.scrollIntoView({block:"end"});
  },[liveLog,liveLogCollapsed]);

  async function openFullLog(){
    setFullLogLoading(true);
    try{ setFullLog((await window.electron?.readBotLog?.())||"로그가 없습니다."); }
    catch{ setFullLog("로그를 불러오지 못했습니다."); }
    finally{ setFullLogLoading(false); }
  }

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
  const [imgGenType, setImgGenType] = useState<"ai"|"flow">(()=>(localStorage.getItem("publy_img_gen_type") as "ai"|"flow")||"flow");
  // ★Flow 이미지 생성 진행 표시를 봇 로그와 동기화(테리: "로그가 계속 1/6, 진행이 안 보인다").
  //   Flow는 한 번의 요청이라 앱이 개수를 못 받는다 → 봇 로그의 "N장 완성" 문구를 읽어 진행률을 움직인다.
  useEffect(()=>{
    if(!(tab==="image"&&genImgLoading&&imgGenType==="flow"))return;
    const m=[...liveLog.matchAll(/(\d+)장\s*다\s*만들었어요/g)];
    const done = m.length>0 ? Number(m[m.length-1][1]) : 0;
    const total = Math.max(1, flowImgCountRef.current);
    setGenImgCurrent(done);
    setGenImgProgress(/불러오는 중/.test(liveLog)?100:Math.min(99,Math.round((done/total)*100)));
  },[liveLog,genImgLoading,imgGenType,tab]);
  const [showFlowGuide, setShowFlowGuide] = useState(false);
  const [flowReady, setFlowReady] = useState(false);
  const [flowLaunching, setFlowLaunching] = useState(false);
  const [flowImgCount, setFlowImgCount] = useState(2);
  const [flowImgCountAuto, setFlowImgCountAuto] = useState(true);
  const flowImgCountAutoRef = useRef(true);
  useEffect(()=>{ flowImgCountAutoRef.current=flowImgCountAuto; },[flowImgCountAuto]);
  // ★ 이미지 생성/발행 시 항상 "최신" 개수를 쓰도록 ref 미러링(클로저로 옛 값이 잡혀 직접입력이
  //   무시되고 추천 개수로 만들어지던 것 방지). 직접입력 N → 실제로 N장 생성.
  const flowImgCountRef = useRef(flowImgCount);
  useEffect(()=>{ flowImgCountRef.current=flowImgCount; },[flowImgCount]);
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
  // 버그 신고
  const [bugMemo, setBugMemo] = useState("");
  const [bugSending, setBugSending] = useState(false);
  const [bugMsg, setBugMsg] = useState("");
  // 내 신고가 처리완료되면 화면 어디서든 뜨는 팝업
  const [bugAlert, setBugAlert] = useState<PublyBugReport|null>(null);
  const [naverKeys, setNaverKeys] = useState<NaverApiKeys>({});
  const [naverKeysSaving, setNaverKeysSaving] = useState(false);
  const [naverKeysMsg, setNaverKeysMsg] = useState("");
  const [naverQuotaInfo, setNaverQuotaInfo] = useState<{used:number;limit:number}|null>(null);
  const [showKwInfo, setShowKwInfo] = useState(false);
  const [showRankInfo, setShowRankInfo] = useState(false);
  const thumbnailRef = useRef<HTMLInputElement>(null);
  const manualFileRef = useRef<HTMLInputElement>(null);

  // 카테고리 로드
  // saveToAccId: 불러온 카테고리를 저장할 계정(계정관리에서 특정 계정 버튼 클릭 시). 없으면 발행 탭 계정.
  async function loadCategories(plat: string, saveToAccId?: string) {
    const targetAcc = saveToAccId || pubAccId;
    if (!botOnline) {
      // 봇 오프라인 → accCats에서 로드
      const saved=accCats[targetAcc]||[];
      setCategories(saved.map((c,i)=>({id:String(i),name:c})));
      return;
    }
    setLoadingCats(true); setCategories([]); if(!saveToAccId)setCategory("");
    try {
      const r = await botFetch(`${BOT}/api/${plat}/categories/${user.id}`, {method:"GET", signal: AbortSignal.timeout(30000)} as any);
      const d = await r.json();
      if (d.categories && d.categories.length>0) {
        setCategories(d.categories);
        // 봇에서 불러온 카테고리를 accCats에도 저장(대상 계정)
        const names=d.categories.map((c:{id:string;name:string})=>c.name);
        saveAccCat(targetAcc, names);
        showToast(`✅ 카테고리 ${d.categories.length}개를 불러왔어요.`,"success");
      } else {
        // 봇 응답이 비었으면 저장된 accCats 사용
        const saved=accCats[targetAcc]||[];
        setCategories(saved.map((c,i)=>({id:String(i),name:c})));
        showToast("불러온 카테고리가 없어요. 네이버 로그인/글쓰기 권한을 확인해주세요.","error");
      }
    } catch {
      const saved=accCats[targetAcc]||[];
      setCategories(saved.map((c,i)=>({id:String(i),name:c})));
      showToast("카테고리 불러오기 실패 — 봇/네이버 로그인 상태를 확인해주세요.","error");
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

  // 텍스트 블록들 사이사이에 이미지 블록을 균등하게 끼워넣기 (발행 직전 보정용)
  function interleave(textBlocks:ContentBlock[], imgBlocks:ContentBlock[]):ContentBlock[]{
    if(imgBlocks.length===0)return textBlocks;
    const out:ContentBlock[]=[];
    const step=Math.max(1,Math.floor(textBlocks.length/(imgBlocks.length+1)));
    let imgIdx=0;
    for(let i=0;i<textBlocks.length;i++){
      out.push(textBlocks[i]);
      if(imgIdx<imgBlocks.length && (i+1)%step===0){ out.push(imgBlocks[imgIdx]); imgIdx++; }
    }
    while(imgIdx<imgBlocks.length){ out.push(imgBlocks[imgIdx]); imgIdx++; }
    return out;
  }

  // ── triggerAutoInsert ──
  function triggerAutoInsert(images:{id:number;src:string;alt?:string}[]){
    const textOnly=blocks.filter(b=>b.type==="text"||(b.type==="image"&&(b as SingleImageBlock).source==="manual"));
    const textBlocks=textOnly.filter(b=>b.type==="text");
    if(textBlocks.length===0)return;
    function hasSectionMarker(b:ContentBlock):boolean{
      if(b.type!=="text")return false;
      const c=(b as TextBlock).content;
      // 마커([FAQ시작] 등)뿐 아니라 마커 없는 "질문답변/Q&A/해시태그/자주묻는" 텍스트도 경계로 → 이미지가 절대 그 아래로 안 감
      return /\[FAQ시작\]|\[참고자료시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test(c);
    }
    const markerIdx=textOnly.findIndex(hasSectionMarker);
    const safeBlocks=markerIdx===-1?textOnly:textOnly.slice(0,markerIdx);
    const sectionBlocks=markerIdx===-1?[]:textOnly.slice(markerIdx);
    const safeTextCount=safeBlocks.filter(b=>b.type==="text").length;
    const imgs=images.filter(img=>img?.src&&img.src.trim()!=="");
    if(imgs.length===0)return;

    // 실제 패턴 결정 (랜덤이면 A/C 중 하나 — B(2장 나란히)는 캡션 문제로 제거)
    const patterns:("A"|"C")[] = ["A","C"];
    const activePattern:("A"|"B"|"C") = imgPattern==="random"
      ? patterns[Math.floor(Math.random()*patterns.length)]
      : (imgPattern==="B"?"C":imgPattern); // 혹시 B가 저장돼 있어도 C로

    // ★ 모든 패턴 공통: 이미지가 글 문단 사이에 "균등 분산"되도록 배치 계산
    //   (예전 패턴 A가 나머지를 한 곳에 몰아넣어 이미지가 다 붙던 버그를 근본 차단)
    //   B는 2장 나란히(pair) 섞고, A/C는 단독 배치 — 다양성은 유지하되 항상 균등.
    const mkImg=(img:{src:string;alt?:string},n:number):ContentBlock=>
      ({type:"image",id:uid(),src:img.src,alt:img.alt||`이미지 ${n}`,position:"center",source:"auto"} as ContentBlock);

    const result:ContentBlock[]=[];
    // 1) 첫 이미지 = 썸네일 (맨 위 단독)
    result.push(mkImg(imgs[0],1));
    const rest=imgs.slice(1);

    // 2) 나머지 이미지 = 전부 "한 줄 1장(단독)"으로 배치.
    //    ★네이버는 2장 한 줄(콜라주)에 개별 캡션을 자동으로 못 넣음 → 캡션 보장 위해 항상 단독.
    type Unit = {kind:"single";img:{src:string;alt?:string}} | {kind:"pair";imgs:{src:string;alt?:string}[]};
    const units:Unit[]=[];
    rest.forEach(img=>units.push({kind:"single",img}));

    // 3) 텍스트 블록 사이 "간격(gap)"에 units를 균등 분배
    //    gap 개수 = safeTextCount (각 텍스트 문단 뒤). units를 gap에 라운드로빈으로 고르게.
    const gaps=Math.max(1,safeTextCount);
    const perGap:Unit[][]=Array.from({length:gaps},()=>[]);
    units.forEach((u,i)=>{
      // 앞쪽 문단부터 고르게: i번째 unit은 (i * gaps / units.length) 위치 gap에
      const g=units.length<=gaps ? Math.min(gaps-1, Math.round((i+1)*gaps/(units.length+1))) : (i%gaps);
      perGap[Math.max(0,Math.min(gaps-1,g))].push(u);
    });

    // 4) 텍스트 블록 순회하며 각 문단 뒤에 배정된 units 삽입
    let textCount=0, imgN=1;
    for(const b of safeBlocks){
      result.push(b);
      if(b.type==="text"){
        const bucket=perGap[textCount]||[];
        for(const u of bucket){
          if(u.kind==="pair"){
            result.push({type:"image-pair",id:uid(),images:[{src:u.imgs[0].src,alt:u.imgs[0].alt||"이미지"},{src:u.imgs[1].src,alt:u.imgs[1].alt||"이미지"}]} as ContentBlock);
            imgN+=2;
          }else{
            result.push(mkImg(u.img,++imgN));
          }
        }
        textCount++;
      }
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
    const sectionMarkerIdx=blocks.findIndex(b=>b.type==="text"&&/\[FAQ시작\]|\[참고자료시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test((b as TextBlock).content));
    blocks.forEach((b,blockIdx)=>{
      const afterSection=sectionMarkerIdx!==-1&&blockIdx>=sectionMarkerIdx;
      if(b.type==="text"){
        const cleaned=(b as TextBlock).content
          .replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
        if(cleaned){
          // 모바일 가독성: 긴 문단은 2문장씩 끊어 별도 <p>로 나누고, 문단 간격을 넉넉히 준다
          const splitForReadability=(t:string):string[]=>{
            if(t.length<=130)return[t];
            const sents=t.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*\s*|[^.!?。！？]+$/g)||[t];
            const groups:string[]=[];
            for(let i=0;i<sents.length;i+=2)groups.push(sents.slice(i,i+2).join("").trim());
            return groups.filter(Boolean);
          };
          const htmlLines:string[]=[];
          cleaned.split("\n").forEach(line=>{
            const t=line.trim();if(!t)return;
            if(/^##\s+/.test(t)){htmlLines.push(`<h2 style="font-size:20px;font-weight:800;margin:36px 0 14px;color:#111;border-bottom:2px solid #eee;padding-bottom:8px">${inlineFmt(t.replace(/^##\s+/,""))}</h2>`);return;}
            if(/^###\s+/.test(t)){htmlLines.push(`<h3 style="font-size:17px;font-weight:700;margin:24px 0 10px;color:#1a1a1a;border-left:4px solid #2563eb;padding-left:10px">${inlineFmt(t.replace(/^###\s+/,""))}</h3>`);return;}
            if(/^---+$/.test(t)){htmlLines.push(`<hr style="border:none;border-top:2px solid #eee;margin:24px 0">`);return;}
            splitForReadability(t).forEach(p=>htmlLines.push(`<p style="line-height:1.95;margin:0 0 24px;color:#333;font-size:16px">${inlineFmt(p)}</p>`));
          });
          const html=htmlLines.join("\n");
          if(html)parts.push(html);
        }
      }else if(b.type==="image"&&!afterSection){
        const src=(b as SingleImageBlock).src;const alt=(b as SingleImageBlock).alt;
        if(src)parts.push(`<div style="padding:24px 0"><figure style="margin:0;text-align:center"><img src="${escHtml(src)}" alt="${escHtml(alt||"")}" style="width:100%;border-radius:12px;display:block">${alt?`<figcaption style="font-size:12px;color:#888;text-align:center;margin-top:6px">${inlineFmt(alt)}</figcaption>`:""}</figure></div>`);
      }else if(b.type==="image-pair"&&!afterSection){
        const pair=(b as ImagePairBlock).images;
        if(pair&&pair.length>=2){
          parts.push(`<div style="padding:24px 0;display:grid;grid-template-columns:1fr 1fr;gap:8px"><figure style="margin:0"><img src="${escHtml(pair[0].src)}" alt="${escHtml(pair[0].alt||"")}" style="width:100%;border-radius:12px;display:block">${pair[0].alt?`<figcaption style="font-size:12px;color:#888;text-align:center;margin-top:6px">${inlineFmt(pair[0].alt)}</figcaption>`:""}</figure><figure style="margin:0"><img src="${escHtml(pair[1].src)}" alt="${escHtml(pair[1].alt||"")}" style="width:100%;border-radius:12px;display:block">${pair[1].alt?`<figcaption style="font-size:12px;color:#888;text-align:center;margin-top:6px">${inlineFmt(pair[1].alt)}</figcaption>`:""}</figure></div>`);
        }
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

  // ── 버그 신고: 로컬 봇 로그 + 메모 + 아이디를 관리자 페이지로 전송 ──
  async function submitBugReport() {
    setBugSending(true); setBugMsg("");
    try {
      let log = "";
      try { log = (await (window as any).electron?.readBotLog?.()) || ""; } catch {}
      const version = (await (window as any).electron?.checkAppUpdate?.().then((r:any)=>r?.currentVersion).catch(()=>"")) || "";
      const res = await submitBugReportRow({
        user_id: user.id, user_name: user.name, user_email: user.email,
        app_version: version, memo: bugMemo.trim(), log_text: log,
      });
      if (!res.ok) throw new Error(res.error || "전송 실패");
      setBugMemo("");
      setBugMsg("✅ 신고 완료! 로그가 관리자에게 전송됐어요. 빠르게 확인할게요.");
      setTimeout(()=>setBugMsg(""), 6000);
    } catch (e:any) {
      setBugMsg("❌ 전송 실패: " + (e.message||"") + " — '로그 폴더 열기'로 파일을 보내주셔도 돼요.");
    } finally { setBugSending(false); }
  }

  // ── 내 신고가 관리자에 의해 처리완료되면, 화면 어디에 있든 팝업으로 알림 ──
  // "한 번 닫으면 절대 다시 안 뜬다"를 보장: ①로컬(localStorage)에 확인한 id 영구 저장(이 기기)
  //  ②서버에 user_notified=true 기록(다른 기기·재설치까지). 둘 중 하나만 살아있어도 재등장 안 함.
  const BUG_SEEN_KEY = `publy_bug_seen_${user.id}`;
  const bugSeenRef = useRef<Set<string>>(new Set(
    (()=>{ try{ return JSON.parse(localStorage.getItem(`publy_bug_seen_${user.id}`)||"[]"); }catch{ return []; } })()
  ));
  const persistBugSeen = ()=>{ try{ localStorage.setItem(BUG_SEEN_KEY, JSON.stringify([...bugSeenRef.current])); }catch{} };
  useEffect(()=>{
    let alive=true;
    const check=async()=>{
      if(bugAlert) return; // 이미 하나 떠 있으면 대기
      try{
        const rows=await getMyResolvedBugAlerts(user.id);
        const next=rows.find(r=>!bugSeenRef.current.has(r.id)); // 아직 안 본 것만(로컬 기록 포함)
        if(alive && next){ bugSeenRef.current.add(next.id); persistBugSeen(); setBugAlert(next); }
      }catch{}
    };
    const t=setTimeout(check, 3000);          // 진입 직후 한 번
    const iv=setInterval(check, 60000);        // 이후 1분마다
    return ()=>{ alive=false; clearTimeout(t); clearInterval(iv); };
  },[user.id,bugAlert]);

  async function dismissBugAlert(){
    if(!bugAlert) return;
    const id=bugAlert.id;
    bugSeenRef.current.add(id); // 즉시 재등장 차단(DB 반영 전이라도)
    persistBugSeen();           // 이 기기에 영구 저장 → 재설치 전까지 절대 안 뜸(DB 실패해도)
    setBugAlert(null);          // 팝업 닫기
    try{ await markBugNotified(id); }catch{} // 서버에도 기록(다른 기기·재설치 대응)
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

  const checkBot = useCallback(async()=>{
    try{const r=await botFetch(`${BOT}/health`,{signal:AbortSignal.timeout(3000)});setBotOnline(r.ok);}
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
    if(tab==="insta_dm" && dmTargets.length===0){
      setDmLoading(true);
      Promise.all([getInstaDmTargets(user.id),getInstaDmQuota(user.id)]).then(([t,q])=>{
        setDmTargets(t); setDmQuota(q); setDmLoading(false);
      });
    }
    if(tab==="insta_dm" && !localStorage.getItem("insta_dm_warn_hide")){
      setShowInstaWarn(true);
    }
    if(tab==="engage") getEngageDailyUsage(user.id).then(setEngageUsed);
  },[tab,user.id]);

  // ★사용량/발행건수 실시간 갱신(테리 요청): 관리자가 '건수 초기화'나 쿼터를 바꾸면 회원 앱이
  //   로그아웃 없이도 20초 안에 반영한다. (등급 실시간은 App.tsx refreshUserById가 담당)
  useEffect(()=>{
    let alive=true;
    const sync=()=>{
      getQuota(user.id).then((q:PublyQuota|null)=>{ if(alive&&q) setQuota(q); });
      getDailyPublishUsage(user.id).then(u=>{ if(alive) setDailyPublishUsed(u); });
    };
    const iv=window.setInterval(sync,20000);
    return ()=>{ alive=false; window.clearInterval(iv); };
  },[user.id]);

  useEffect(()=>{
    checkBot();
    getAccounts(user.id).then(setAccounts);
    getHistory(user.id).then(setHistory);
    getNeighborDailyUsage(user.id).then(setNeighborUsed);
    getEngageDailyUsage(user.id).then(setEngageUsed);
    getInstaDmQuota(user.id).then(q=>{ const today=new Date().toISOString().slice(0,10); setInstaUsed(q && q.reset_date===today ? (q.used_today||0) : 0); });
    getQuota(user.id).then(async (q:PublyQuota|null)=>{
      if(!q) { setPageReady(true); return; }
      setQuota(q);

      // ── 알림 체크 ──
      const now = new Date();
      const daysLeft = daysUntil(q.reset_date) ?? 0;

      // 만료 알림 (3일 이하 또는 만료됨)
      if (daysLeft <= 3) {
        setAlertPopup({ type: "expire", daysLeft: Math.max(0, daysLeft) });
        setPageReady(true);   // ⬅️ 페이지는 정상 표시 (예전엔 여기서 return해 무한로딩 유발)
        return;
      }

      // 발행 잔여 알림
      const config = PLAN_CONFIG[user.plan] ?? PLAN_CONFIG.free;
      const used = await getDailyPublishUsage(user.id);
      setDailyPublishUsed(used);
      const remaining = config.dailyPublish - used;
      const pct = remaining / config.dailyPublish;
      if (pct <= 0.1) {
        setAlertPopup({ type: "publish", used, limit: config.dailyPublish });
      } else if (pct <= 0.2 && !localStorage.getItem(`publy_alert_20_${now.toISOString().slice(0,10)}`)) {
        localStorage.setItem(`publy_alert_20_${now.toISOString().slice(0,10)}`, "1");
        setAlertPopup({ type: "publish", used, limit: config.dailyPublish });
      }
      setPageReady(true);
    }).catch(()=>setPageReady(true));
    // 임시저장 확인
    try{
      const d=localStorage.getItem("publy_draft");
      if(d){const p=JSON.parse(d);if(p.content&&p.title){setDraftAvailable(true);setDraftData(p);}}
    }catch{}
    const iv=setInterval(checkBot,30000);
    // 앱 시작 직후 봇 서버가 뜨는 데 몇 초 걸림 → 초반엔 자주 재확인해 "오프라인"이 오래 남지 않게.
    const warm=[2000,4000,7000,11000,16000,22000].map(t=>setTimeout(checkBot,t));
    if(!localStorage.getItem("publy_guide_seen")){setTimeout(()=>setShowGuide(true),900);}
    return()=>{clearInterval(iv);warm.forEach(clearTimeout);};
  },[checkBot,user.id]);

  function recommendImgCount(content:string):number{
    // 글 길이에 맞춰 이미지 수 추천 — 약 700자당 1장, 최소 2장 최대 8장.
    // (1500자→2장, 2800자→4장, 4200자→6장, 5600자+→8장) 배치는 균등분산이라 많아도 안 붙음.
    return Math.max(2, Math.min(8, Math.round(content.length / 700)));
  }

  /* ── 글 구간별 캡션 생성 ── */
  function buildCaptions(kw:string, count:number, content?:string):string[]{
    const k = kw || "사진";
    // 플레이스홀더처럼 보이는 "~이미지" 문구 제거. 자연스러운 짧은 캡션(SEO 키워드 유지).
    const pool = [
      `${k}`,
      `${k} 현장`,
      `${k} 추천`,
      `${k} 자세히 보기`,
      `${k} 실물`,
      `${k} 정보`,
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

  function buildImgPrompt(kw: string, title: string = "", idx: number = 0, segmentContent?: string): string {
    // 구간 내용이 있으면 그걸로 키워드 보강
    const k = segmentContent
      ? (kw + " " + title + " " + segmentContent.slice(0, 100)).toLowerCase()
      : (kw + " " + title).toLowerCase();
    const st = adType === "adpost"
      ? "Korean lifestyle photography, warm emotional, soft natural light"
      : "ultra realistic DSLR 8K magazine editorial photography";

    const sorted = [...PROMPT_DB].sort((a,b) => b.keywords.join("").length - a.keywords.join("").length);
    for (const entry of sorted) {
      if (entry.keywords.some(kw2 => k.includes(kw2))) {
        let p = entry.prompt;
        if (idx === 1) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "golden hour afternoon light");
        if (idx === 2) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "dramatic blue hour lighting");
        if (idx === 3) p = p.replace(/warm natural lighting|morning light|warm lighting/g, "soft overcast diffused light");
        return `${p}, ${NP_TAG}, ${st}`;
      }
    }
    const CATS: [RegExp, string][] = [
      [/먹|맛|식당|음식|요리|카페|커피|레스토랑|맛집|디저트|베이커리|밥|국|찌개|반찬|술|맥주|와인|칵테일|소주|막걸리/, `stunning Korean food photography, beautifully plated gourmet dish, vibrant fresh ingredients, professional food styling, warm restaurant ambiance, ${NP_TAG}`],
      [/여행|관광|투어|trip|호텔|숙소|제주|부산|경주|해외|유럽|일본|미국|동남아|캠핑|글램핑|아웃도어|백패킹|트레킹/, `breathtaking travel destination, majestic scenic landscape, dramatic sky, iconic local architecture, golden hour atmosphere, ${NP_TAG}`],
      [/주식|펀드|선물|옵션|채권|ETF|코인|암호화폐|트레이딩|차트|증권|배당|퀀트/, `professional financial trading concept, stock market charts on screen, data visualization, clean workspace, ${NP_TAG}`],
      [/보험|연금|퇴직|적금|예금|저축|재테크|투자|경제|수익|부자|부업|프리랜서|애드센스|블로그수익|수익화/, `sophisticated financial planning concept, premium calculator and documents, aspirational wealth aesthetic, modern office, ${NP_TAG}`],
      [/건강|운동|fitness|헬스|요가|필라테스|러닝|마라톤|수영|자전거|등산|스트레칭|근육|체중|다이어트|diet/, `motivating healthy lifestyle, wellness equipment on clean background, energizing fresh ingredients, bright minimal aesthetic, ${NP_TAG}`],
      [/의료|병원|의사|약|의약품|치료|수술|간호|한의원|한약|임상|제약|바이오|헬스케어/, `clean medical healthcare concept, professional stethoscope and equipment, sterile clinical aesthetic, pharmaceutical products, ${NP_TAG}`],
      [/피부|뷰티|스킨케어|화장|메이크업|헤어|네일|미용|세럼|크림|에센스|선크림|향수|화장품/, `luxurious beauty skincare flat lay, premium cosmetic products on marble, dewy glowing texture, feminine elegance, ${NP_TAG}`],
      [/패션|옷|스타일|코디|ootd|아우터|자켓|청바지|원피스|니트|가방|신발|명품|쇼핑|브랜드|하울/, `stylish fashion editorial flat lay, trendy clothing and accessories artfully arranged, urban aesthetic, ${NP_TAG}`],
      [/집|방|인테리어|아파트|가구|리모델링|청소|정리|수납|원룸|빌라|오피스텔|셀프인테리어|홈데코|홈스타일링/, `stunning modern Korean home interior, thoughtfully curated furniture, warm cozy atmosphere, architectural detail, ${NP_TAG}`],
      [/건축|건설|토목|설계|시공|부동산|땅|분양|임대|전세|월세|재건축|재개발|도시개발/, `professional architecture and real estate concept, modern building blueprint or model, urban development, ${NP_TAG}`],
      [/농업|농장|농촌|농산물|채소|과일|쌀|밀|콩|감자|고구마|텃밭|스마트팜|유기농|친환경/, `beautiful farm and agriculture photography, fresh organic produce arranged artfully, countryside pastoral aesthetic, ${NP_TAG}`],
      [/수산업|어업|어촌|수산물|생선|해산물|굴|새우|랍스터|참치|연어|수족관|양식/, `fresh seafood and fisheries concept, glistening ocean products on ice, coastal market aesthetic, ${NP_TAG}`],
      [/육류|육가공|정육|소고기|돼지고기|닭고기|양고기|햄|소시지|베이컨|정육점/, `premium meat and butchery concept, quality cuts on wooden board, professional food styling, rustic aesthetic, ${NP_TAG}`],
      [/유통|물류|배송|창고|공급망|SCM|택배|운송|화물|트럭|항만|수출|수입|무역/, `modern logistics and supply chain concept, warehouse shelves, delivery and shipping aesthetic, efficient operations, ${NP_TAG}`],
      [/제조|공장|생산|가공|조립|금속|철강|기계|설비|장비|산업|공업|자동화/, `industrial manufacturing concept, precision machinery and equipment, clean factory aesthetic, engineering precision, ${NP_TAG}`],
      [/화학|석유|에너지|전력|태양광|풍력|수소|배터리|반도체|소재|원자력|신재생/, `energy and materials science concept, clean technology visualization, solar panels or molecular structure aesthetic, ${NP_TAG}`],
      [/과학|연구|실험|물리|화학|생물|quantum|퀀텀|파동|나노|우주|천문/, `professional scientific research concept, laboratory equipment or quantum visualization, precise academic aesthetic, ${NP_TAG}`],
      [/법률|법무|변호사|판사|소송|계약|규정|법원|세무|회계|감사|컴플라이언스/, `professional legal and compliance concept, clean document arrangement, scales of justice aesthetic, authoritative, ${NP_TAG}`],
      [/교육|학원|공부|강의|수업|강사|학습|입시|자격증|직업훈련|온라인교육|e러닝/, `inspiring education concept, organized study materials and books, clean learning environment, knowledge aesthetic, ${NP_TAG}`],
      [/마케팅|광고|홍보|브랜딩|sns|소셜미디어|콘텐츠|유튜브|인스타그램|블로그|미디어|방송/, `creative marketing and media concept, brand elements on clean workspace, digital content creation aesthetic, ${NP_TAG}`],
      [/스타트업|창업|사업|경영|비즈니스|기업|CEO|리더십|팀워크|혁신|벤처/, `dynamic startup and business concept, innovative workspace, entrepreneurial vision, modern corporate aesthetic, ${NP_TAG}`],
      [/자동차|차량|드라이브|전기차|수입차|SUV|세단|오토바이|바이크|튜닝|연비/, `dramatic automotive photography, sleek vehicle design detail, dynamic angles, premium metallic surfaces, ${NP_TAG}`],
      [/스포츠|축구|야구|농구|골프|테니스|스키|스노보드|서핑|클라이밍|배드민턴|볼링/, `energetic sports equipment flat lay, athletic gear artfully arranged, performance aesthetic, dynamic composition, ${NP_TAG}`],
      [/기술|tech|AI|인공지능|컴퓨터|스마트폰|앱|IT|아이폰|갤럭시|아이패드|노트북|게임|드론|로봇/, `cutting-edge technology concept, sleek modern device on minimal surface, digital innovation, futuristic clean design, ${NP_TAG}`],
      [/봄|여름|가을|겨울|자연|꽃|풍경|숲|바다|산|나무|식물|원예|정원|화초/, `breathtaking Korean seasonal nature, pristine landscape, vivid natural colors, peaceful serene atmosphere, ${NP_TAG}`],
      [/환경|친환경|제로웨이스트|탄소중립|지속가능|ESG|재활용|업사이클|생태계/, `eco-friendly sustainability concept, green products and plants, earth-tone natural aesthetic, ${NP_TAG}`],
      [/음악|악기|노래|가수|밴드|피아노|기타|드럼|클래식|재즈|힙합|K팝/, `artistic music concept, beautiful instrument or vinyl records flat lay, creative studio aesthetic, ${NP_TAG}`],
      [/미술|그림|디자인|사진|영화|드라마|공연|전시|갤러리|예술|창작/, `creative arts concept, artist tools and canvas elegantly arranged, gallery aesthetic, inspirational creative, ${NP_TAG}`],
      [/종교|불교|기독교|성당|사찰|명상|영성|철학|심리|마음|힐링|치유/, `peaceful meditation and spiritual concept, serene nature or candles, calm mindful aesthetic, ${NP_TAG}`],
      [/아이|육아|아기|어린이|임신|출산|신생아|유아|초등|교육|학습|공부|입시/, `warm family educational concept, child-friendly environment, soft pastel tones, learning materials, ${NP_TAG}`],
      [/강아지|고양이|반려동물|pet|puppy|kitten|햄스터|앵무새|어항|수족관/, `adorable pet care flat lay, pet accessories and products, soft heartwarming background, ${NP_TAG}`],
      [/결혼|웨딩|신혼|허니문|프로포즈|스드메|부케|예식장|청첩장|혼수/, `romantic wedding concept, elegant floral arrangement, soft dreamy lighting, bridal aesthetic, ${NP_TAG}`],
    ];
    for (const [re, prompt] of CATS) {
      if (re.test(k)) return `${prompt}, ${st}`;
    }
    return `beautiful Korean lifestyle blog editorial photography, professional composition, warm aesthetic, ${NP_TAG}, ${st}`;
  }

  /* ── Flow 전용 디테일 프롬프트 ── */
  function buildFlowPrompt(kw: string, title: string = "", content: string = "", idx: number = 0): string {
    const k = (kw + " " + title).toLowerCase();
    const c = content.slice(0, 500).toLowerCase();

    // 카테고리 감지 (확장)
    const isFoodCafe = /먹|맛|식|음식|요리|카페|커피|레스토랑|맛집|디저트|베이커리|밥|국|찌개|반찬|술|맥주|와인|칵테일/.test(k+c);
    const isTravel = /여행|관광|투어|trip|tour|호텔|숙소|제주|부산|서울|경주|해외|해외여행|유럽|일본|미국|동남아|캠핑|글램핑|아웃도어/.test(k+c);
    const isHealth = /건강|운동|fitness|diet|헬스|요가|필라테스|수영|러닝|마라톤|자전거|등산|스트레칭|근육|체중/.test(k+c);
    // 조명 변주
    const lightings = [
      "soft golden hour natural lighting, warm sunlight filtering through",
      "bright airy daylight, clean studio-style lighting, crisp shadows",
      "dramatic cinematic side lighting, deep contrast, moody atmosphere",
      "soft diffused overcast light, even tones, pastel color palette",
    ];
    const lighting = lightings[idx % lightings.length];
    // ★ 구도(shot) 변주 — 같은 주제라도 이미지마다 다른 앵글/거리로 (탁자 굴비만 반복되는 문제 방지)
    const shots = [
      "extreme close-up macro shot, shallow depth of field, focus on texture and detail",
      "wide establishing shot showing the full scene and surroundings, environmental context",
      "45-degree angle overhead flat-lay composition, top-down perspective",
      "eye-level medium shot with soft bokeh background, natural framing",
      "dramatic low-angle shot, dynamic perspective, cinematic depth",
      "side-profile shot with negative space, minimalist editorial framing",
      "over-the-shoulder lifestyle shot, candid moment, human context (no visible faces)",
      "detail vignette shot highlighting a single key element, artistic focus",
    ];
    const shot = shots[idx % shots.length];
    const storyBeats = [
      "an immersive establishing moment that introduces the place and overall atmosphere",
      "a tactile close detail of the subject's most distinctive material, ingredient, or feature",
      "the preparation or work process in progress, with tools and ingredients in context",
      "a lively environmental moment showing how the subject belongs in the real location",
      "a candid human hand interaction that communicates scale and experience, no visible face",
      "the polished finished result presented as the visual conclusion of the story",
      "a behind-the-scenes detail from an unexpected side angle",
      "a colorful final atmosphere shot connecting the subject with its surroundings",
    ];
    const storyBeat = storyBeats[idx % storyBeats.length];
    // 품질 + 텍스트 오염 방지(글자/워터마크/로고 없이 순수 이미지만) — 모든 주제 공통
    const quality = `${storyBeat}, ${shot}, rich varied colors, visually beautiful editorial storytelling, ultra-high resolution 8K, hyperrealistic, award-winning photography, razor-sharp focus, absolutely no text, no letters, no words, no captions, no watermark, no logo, no typography`;

    const FLOW_CATS: [RegExp, string][] = [
      [/먹|맛|식당|음식|요리|카페|커피|레스토랑|맛집|디저트|베이커리|밥|술|맥주|와인|소주|막걸리/, `A stunning food photography scene featuring "${title}", beautifully plated gourmet Korean cuisine, vibrant fresh ingredients, professional food styling, bokeh restaurant interior, appetizing shallow depth of field`],
      [/여행|관광|투어|trip|호텔|숙소|제주|부산|해외|유럽|일본|동남아|캠핑|아웃도어|트레킹/, `A breathtaking travel photography of "${title}", majestic scenic landscape with dramatic sky, iconic local culture and architecture, wanderlust inspiring wide angle cinematic view`],
      [/주식|펀드|선물|옵션|채권|ETF|코인|암호화폐|트레이딩|차트|증권|배당|퀀트/, `A sophisticated stock market and investment concept for "${title}", dynamic financial data visualization, trading screens with charts, modern professional workspace, aspirational wealth`],
      [/보험|연금|저축|적금|재테크|투자|경제|수익|부자|부업|프리랜서|애드센스|블로그수익/, `A sophisticated financial success concept for "${title}", modern professional workspace with charts, premium business aesthetic, aspirational and trustworthy mood`],
      [/건강|운동|fitness|헬스|요가|필라테스|러닝|수영|자전거|다이어트|diet/, `A motivating healthy lifestyle photography representing "${title}", wellness activity, fresh organic ingredients, clean minimal bright atmosphere, inspiring positive mood`],
      [/의료|병원|의약품|치료|제약|바이오|헬스케어|한의원/, `A clean medical healthcare concept for "${title}", professional equipment, sterile clinical precision, trustworthy medical aesthetic`],
      [/피부|뷰티|스킨케어|화장|메이크업|헤어|네일|화장품|세럼|크림/, `A luxurious beauty editorial for "${title}", premium cosmetic products on marble surface, dewy glowing skin texture, feminine elegance, aspirational beauty`],
      [/패션|옷|스타일|코디|ootd|아우터|가방|명품|쇼핑|브랜드/, `A stylish fashion editorial representing "${title}", trendy outfit with accessories, urban street style, Vogue-worthy confident composition`],
      [/인테리어|아파트|가구|리모델링|셀프인테리어|수납정리|홈데코|원룸|집꾸미기|방꾸미기|홈스타일링|가구배치/, `A stunning interior design photography of "${title}", beautifully decorated Korean modern home, warm inviting atmosphere, cozy aspirational living space`],
      [/건축|건설|부동산|분양|임대|전세|재건축|도시개발/, `A professional architecture and real estate concept for "${title}", modern building with clean lines, urban development premium aesthetic`],
      [/농업|농장|농촌|농산물|채소|과일|쌀|유기농|스마트팜/, `A beautiful farm and agriculture photography for "${title}", fresh organic produce artfully arranged, countryside pastoral golden hour aesthetic`],
      [/수산업|어업|수산물|생선|해산물|굴|새우|참치|연어|양식/, `A fresh seafood photography for "${title}", glistening ocean products on ice, vibrant coastal market aesthetic`],
      [/육류|육가공|정육|소고기|돼지고기|닭고기|햄|소시지/, `A premium meat and butchery concept for "${title}", quality cuts on rustic wooden board, professional food styling`],
      [/유통|물류|배송|창고|SCM|택배|운송|화물|무역|수출|수입/, `A modern logistics and supply chain concept for "${title}", organized warehouse, efficient delivery and operations aesthetic`],
      [/제조|공장|생산|가공|철강|기계|설비|산업|자동화/, `An industrial manufacturing concept for "${title}", precision machinery, clean factory aesthetic, engineering excellence`],
      [/화학|에너지|태양광|풍력|수소|배터리|반도체|신재생/, `A clean energy and technology concept for "${title}", innovative visualization, sustainable futuristic aesthetic`],
      [/과학|연구|실험|물리|생물|quantum|퀀텀|파동|나노|우주|천문/, `A professional scientific research concept for "${title}", laboratory precision, quantum visualization, academic excellence aesthetic`],
      [/법률|법무|변호사|소송|계약|세무|회계|컴플라이언스/, `A professional legal and compliance concept for "${title}", clean document arrangement, authoritative and trustworthy aesthetic`],
      [/교육|학원|강의|학습|입시|자격증|온라인교육|공부|시험|토익|토플|영어|수능|자격|어학|독서|스터디/, `An inspiring education concept for "${title}", organized study materials and books, clean learning environment, knowledge aesthetic`],
      [/마케팅|광고|홍보|브랜딩|소셜미디어|콘텐츠|유튜브|미디어|방송/, `A creative marketing and media concept for "${title}", brand elements on workspace, digital content creation aesthetic`],
      [/스타트업|창업|사업|경영|비즈니스|기업|리더십|벤처|혁신/, `A dynamic startup and business concept for "${title}", innovative workspace, entrepreneurial vision, modern corporate aesthetic`],
      [/자동차|차량|드라이브|전기차|수입차|SUV|오토바이/, `A dramatic automotive photography featuring "${title}", sleek vehicle design, dynamic angles, premium metallic surfaces, car magazine quality`],
      [/스포츠|축구|야구|농구|골프|테니스|스키|서핑|클라이밍/, `An energetic sports photography representing "${title}", peak athletic performance, dynamic action, ESPN magazine quality`],
      [/기술|tech|AI|인공지능|컴퓨터|스마트폰|앱|IT|아이폰|아이패드|노트북|게임|드론/, `A cutting-edge technology concept for "${title}", sleek devices and interfaces, digital innovation, futuristic clean design`],
      [/봄|여름|가을|겨울|자연|꽃|풍경|숲|바다|산|식물|원예/, `A breathtaking nature photography capturing "${title}", pristine Korean landscape, vivid seasonal colors, immersive serene composition`],
      [/환경|친환경|제로웨이스트|탄소중립|ESG|재활용/, `An eco-friendly sustainability concept for "${title}", green products and plants, earth-tone natural aesthetic`],
      [/음악|악기|노래|피아노|기타|드럼|K팝|클래식/, `An artistic music concept for "${title}", beautiful instrument or vinyl records, creative studio aesthetic`],
      [/미술|그림|디자인|영화|드라마|공연|전시|예술|창작/, `A creative arts concept for "${title}", artist tools elegantly arranged, gallery inspirational aesthetic`],
      [/명상|영성|철학|심리|힐링|치유|종교/, `A peaceful meditation concept for "${title}", serene candles and nature elements, calm mindful aesthetic`],
      [/육아|아기|어린이|임신|출산|유아|신생아|이유식|기저귀|어린이집|아이키우기/, `A heartwarming family concept for "${title}", soft pastel tones, child-friendly environment, tender joyful atmosphere`],
      [/강아지|고양이|반려동물|pet|puppy|햄스터/, `A charming pet photography for "${title}", expressive animal companion, playful moments, soft bokeh, heartwarming mood`],
      [/결혼|웨딩|신혼|프로포즈|부케|예식|혼수/, `A romantic wedding photography for "${title}", beautifully decorated venue, elegant bridal details, dreamy timeless style`],
    ];
    // "인테리어/꾸미기"가 명시되면 음식(카페)보다 인테리어 우선 (홈카페 인테리어 등 오매칭 방지)
    if (/인테리어|꾸미기|홈스타일링|공간연출/.test(k+c)) {
      return `A stunning interior design photography of "${title}", beautifully decorated Korean modern space, warm inviting atmosphere, cozy aspirational aesthetic, ${lighting}, ${quality}`;
    }
    for (const [re, prompt] of FLOW_CATS) {
      if (re.test(k+c)) return `${prompt}, ${lighting}, ${quality}`;
    }
    return `A high-quality professional blog photography representing "${title}" about ${kw}, visually compelling, Korean lifestyle aesthetic, ${lighting}, ${quality}, editorial magazine style`;
  }

  const BRAND_KEEP_RE = /\b(iPhone|iPad|MacBook|iMac|AirPods|Apple|Android|Galaxy|Samsung|LG|SK|KT|Naver|Kakao|YouTube|Netflix|Instagram|TikTok|Facebook|ChatGPT|Gemini|OpenAI|Google|DALL-E|Replicate|Flux|Grok|Groq|AI|SEO|URL|API|PDF|PC|TV|USB|WiFi|Wi-Fi|MBTI|OOTD|DIY|OTT|IT|CT|MRI|VPN|GPS|NFT|ETF|CPR|RGB|LED|LCD|OLED|SNS|DNA|BMW|Benz|Tesla|Dyson|Nike|Adidas|Zara|IKEA|Costco|GS25|Starbucks|MCM|HP|Dell|Asus|Sony|Panasonic|Canon|Nikon|Fuji|DJI|GPT|Claude|MSI|AMD|Intel|NVIDIA)\b/g;

  function stripMarkdown(text:string):string{
    const brands: string[] = [];
    const preserved = text.replace(BRAND_KEEP_RE, (m) => {
      brands.push(m); return `__BR${brands.length - 1}__`;
    });
    const cleaned = preserved
      // AI 메타 주석 제거 (Self-correction, Character count 등)
      .replace(/<!--[\s\S]*?-->/g,"")
      .replace(/\(Self-correction:[\s\S]*?\)/gi,"")
      .replace(/\(self correction:[\s\S]*?\)/gi,"")
      .replace(/\(.*?character count.*?\)/gi,"")
      .replace(/\(.*?I\'ve used.*?\)/gi,"")
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
      .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]/g,"")
      .replace(/[\u3040-\u30FF]/g,"")
      // 플레이스홀더가 아닌 순수 영어 단어 제거 (4자 이상)
      .replace(/(^|[\s,.])(?!__BR\d+__)[A-Za-z]{4,}(?=[\s,.]|$)/g,"$1")
      // 줄 전체가 영어인 경우 제거 (플레이스홀더 없는 줄만)
      .replace(/^(?!.*__BR\d+__)[A-Za-z\s\d.,!?\'""-]{10,}$/gm,"")
      // ── AI 티 나는 상투어 → 자연스러운 구어체로 자동 치환 (SEO 'AI 패턴 차단' 점수 확보) ──
      .replace(/소개해\s*드리겠습니다/g,"소개할게요").replace(/소개하겠습니다/g,"소개할게요")
      .replace(/알아보겠습니다/g,"알아볼게요").replace(/살펴보겠습니다/g,"살펴볼게요")
      .replace(/정리해\s*보겠습니다/g,"정리해볼게요").replace(/정리하겠습니다/g,"정리해볼게요")
      .replace(/해\s*보겠습니다/g,"해볼게요").replace(/해보도록\s*하겠습니다/g,"해볼게요")
      .replace(/말씀드리겠습니다/g,"말할게요").replace(/설명드리겠습니다/g,"설명할게요")
      .replace(/결론적으로/g,"그래서").replace(/무엇보다도/g,"무엇보다").replace(/뿐만\s*아니라/g,"게다가")
      .replace(/중요합니다/g,"중요해요").replace(/필수적으로/g,"꼭").replace(/필수적인/g,"꼭 필요한")
      .replace(/효과적인/g,"괜찮은").replace(/효과적으로/g,"제대로").replace(/다양한/g,"여러")
      .replace(/것을\s*추천드립니다/g,"걸 추천해요").replace(/추천드립니다/g,"추천해요")
      .replace(/하는 것이 좋습니다/g,"하면 좋아요").replace(/하시기 바랍니다/g,"하세요")
      .replace(/ {2,}/g," ")
      .replace(/\n{3,}/g,"\n\n")
      .trim();
    return cleaned.replace(/__BR(\d+)__/g, (_:string,i:string) => brands[parseInt(i)] ?? "");
  }

  function ensureQuestionHeadings(text:string, topic:string):string {
    const markerIndex=text.search(/\n?\[FAQ시작\]/);
    const main=markerIndex>=0?text.slice(0,markerIndex).trim():text.trim();
    const tail=markerIndex>=0?text.slice(markerIndex).trim():"";
    const questionLines=main.split("\n").filter(line=>/[?？]\s*$/.test(line.trim()));
    if(questionLines.length>=3)return text;
    const paragraphs=main.split(/\n{2,}/).map(part=>part.trim()).filter(Boolean);
    if(paragraphs.length<3)return text;
    const safeTopic=(topic.trim()||"이 주제").slice(0,18);
    const candidates=[`${safeTopic}, 왜 주목받을까요?`,`어떻게 고르면 후회가 적을까요?`,`직접 경험하면 무엇이 다를까요?`];
    const missing=candidates.slice(0,3-questionLines.length);
    const positions=[1,Math.max(2,Math.floor(paragraphs.length/2)),Math.max(2,paragraphs.length-1)];
    missing.forEach((heading,index)=>{
      const position=Math.min(paragraphs.length,positions[index]+index);
      paragraphs.splice(position,0,heading);
    });
    return `${paragraphs.join("\n\n")}${tail?`\n\n${tail}`:""}`;
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

  // CORS 차단되는 외부 AI(OpenAI/Groq 등)는 봇 프록시 경유. 봇 오프라인이면 직접 시도(폴백).
  async function aiProxyFetch(url:string, init:RequestInit, signal?:AbortSignal):Promise<Response>{
    if(botOnline){
      return botFetch(`${BOT}/api/ai-proxy`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({url,method:init.method||"POST",headers:init.headers,body:init.body}),
        signal:signal||(init as any).signal,
      });
    }
    return fetch(url, init);
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
      const r=await aiProxyFetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:8000,messages:[{role:"user",content:prompt}]})},signal||AbortSignal.timeout(90000));
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"Groq 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    if(ai==="openai"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI API 키 없음");
      const r=await aiProxyFetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o",max_tokens:8000,messages:[{role:"user",content:prompt}]})},signal||AbortSignal.timeout(90000));
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"OpenAI 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    throw new Error("AI 미선택");
  }

  async function urlToBase64(url:string, signal:AbortSignal):Promise<string>{
    try{
      const r=await fetch(url,{signal});
      if(!r.ok)return url;
      const blob=await r.blob();
      return new Promise((resolve)=>{
        const reader=new FileReader();
        reader.onloadend=()=>resolve(reader.result as string);
        reader.onerror=()=>resolve(url);
        reader.readAsDataURL(blob);
      });
    }catch{return url;}
  }

  async function generateOneImage(kw:string,signal:AbortSignal,idx:number=0,segmentContent?:string):Promise<string>{
    const prompt=buildImgPrompt(kw, genTitle||selectedTitle||"", idx, segmentContent);
    const ai=localStorage.getItem("publy_image_ai")||"openai_img";
    if(ai==="openai_img"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI 키 없음");
      const r=await aiProxyFetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"dall-e-3",prompt,n:1,size:"1024x1024"})},signal);
      if(!r.ok){const e=await r.json();throw new Error("DALL-E: "+(e.error?.message||r.status));}
      const d=await r.json();
      const imgUrl=d.data?.[0]?.url||"";
      // DALL-E URL은 1시간 후 만료 → 즉시 base64로 변환
      if(imgUrl)return urlToBase64(imgUrl,signal);
      return imgUrl;
    }
    if(ai==="replicate"){
      const key=localStorage.getItem("publy_replicate_key")||"";if(!key)throw new Error("Replicate 키 없음");
      // 브라우저 직접 호출은 CORS로 막힘 → 봇 서버 프록시 경유 (생성+폴링+base64 변환까지 서버가 처리)
      const r=await botFetch(`${BOT}/api/replicate-image`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key,prompt,aspectRatio:"16:9"}),signal});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||("Replicate "+r.status));}
      const d=await r.json();
      return d.image||d.sourceUrl||"";
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
      ?`당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${keyword.trim()}"\n\n제목 30개를 JSON 배열로만 반환하세요.\n- 키워드 반드시 포함\n- 15~20자 이내 (짧고 강렬하게, 검색어 포함)\n- 숫자 필수 (BEST 5, TOP 3, 7가지 등)\n- 클릭 유발어 ("솔직히","이것만","나만 알던","진짜","꿀팁")\n- 경험 공유형 ("써봤어요","해봤더니","알고보니")\n- 불필요한 수식어 금지\n\nJSON 배열만 반환.`
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

  // ① 조회 — 링크로 상품 정보 불러와 미리보기(onPartnerPreview)만 채운다. 목록엔 아직 안 담김.
  async function loadOnPartnerProduct(){
    const link=onPartnerLink.trim();
    if(!link){setOnPartnerError("온파트너 상품 링크를 입력해주세요.");return;}
    if(onPartnerItems.length>=MAX_ONPARTNER){setOnPartnerError(`상품은 최대 ${MAX_ONPARTNER}개까지 넣을 수 있어요.`);return;}
    setOnPartnerLoading(true);setOnPartnerError("");setOnPartnerPreview(null);
    try{
      const response=await fetch(`https://partner.yuanfnb.com/api/product-card?url=${encodeURIComponent(link)}`,{signal:AbortSignal.timeout(10000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok||!data.product)throw new Error(data.error==="link_not_found"?"사용할 수 없는 링크예요.":"상품 정보를 불러오지 못했어요.");
      const prod=data.product as OnPartnerProduct;
      if(onPartnerItems.some(it=>it.product.partnerUrl===prod.partnerUrl)){setOnPartnerError("이미 추가된 상품이에요.");return;}
      // 서버가 만든 예쁜 가로 배너(온파트너 /api/banner) — 디자인 통일 + CORS 위험 없음.
      const codeM=prod.partnerUrl.match(/\/r\/([a-z0-9-]+)/i);
      const banner=codeM?`https://partner.yuanfnb.com/api/banner?code=${codeM[1]}`:"";
      setOnPartnerPreview({product:prod,banner});
      showToast("✅ 상품을 조회했어요. '추가'를 누르면 담겨요.","success");
    }catch(e:any){
      setOnPartnerError(e.name==="TimeoutError"?"상품 확인 시간이 초과됐어요. 다시 시도해주세요.":e.message||"상품 정보를 불러오지 못했어요.");
    }finally{setOnPartnerLoading(false);}
  }
  // ② 추가 — 조회한 상품을 목록에 담고 입력/미리보기 초기화.
  function addOnPartnerProduct(){
    if(!onPartnerPreview)return;
    if(onPartnerItems.length>=MAX_ONPARTNER){setOnPartnerError(`상품은 최대 ${MAX_ONPARTNER}개까지 넣을 수 있어요.`);return;}
    if(onPartnerItems.some(it=>it.product.partnerUrl===onPartnerPreview.product.partnerUrl)){setOnPartnerError("이미 추가된 상품이에요.");return;}
    setOnPartnerItems(prev=>[...prev,onPartnerPreview]);
    setOnPartnerPreview(null);setOnPartnerLink("");setOnPartnerError("");
    showToast("✅ 상품을 추가했어요.","success");
  }

  // 내 링크 추가: 일반 사이트 URL을 목록에 담는다. 발행 시 네이버가 OG 썸네일 카드로 렌더.
  function addMyLink(){
    let url=myLinkInput.trim();
    if(!url){setMyLinkError("링크를 입력해주세요.");return;}
    if(!/^https?:\/\//i.test(url)) url="https://"+url;   // http 빠졌으면 붙여줌
    try{ new URL(url); }catch{ setMyLinkError("올바른 링크 주소가 아니에요."); return; }
    if(myLinks.length>=MAX_MYLINK){setMyLinkError(`링크는 최대 ${MAX_MYLINK}개까지 넣을 수 있어요.`);return;}
    if(myLinks.includes(url)){setMyLinkError("이미 추가된 링크예요.");return;}
    setMyLinks(prev=>[...prev,url]); setMyLinkInput(""); setMyLinkError("");
    showToast("✅ 내 링크를 추가했어요.","success");
  }

  // 배너는 온파트너 서버(/api/banner)가 생성 — 클라 canvas 불필요.

  // 본문 최상단에 제휴 안내만 넣는다. 배너(링크 연결된 이미지)는 발행 시 블록에 직접 분산 삽입.
  function placeOnPartnerProduct(generatedBody:string, products:OnPartnerProduct[]):string{
    const items=products.filter(p=>p&&p.available);
    if(items.length===0)return generatedBody.trim();
    const disclosure="※ 이 글에는 제휴 링크가 포함되어 있으며, 구매 시 작성자에게 일정 수수료가 발생할 수 있습니다.";
    return [disclosure,generatedBody.trim()].join("\n\n");
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
      ?"[플랫폼] 네이버: ## 기호 절대 금지. 순수 텍스트로 작성. (글의 방향은 아래 스타일 지침을 최우선으로 따를 것)"
      :"[플랫폼] 티스토리: 내부링크 2개 자연스럽게 포함. (글의 방향은 아래 스타일 지침을 최우선으로 따를 것)";
    const styleGuide=WRITE_STYLE_GUIDE[writeStyle]||"";
    const endTone=WRITE_STYLE_ENDTONE[writeStyle]||"문장 끝: ~해요, ~거든요, ~더라고요, ~잖아요 다양하게.";
    const personaGuide=PERSONA_STYLES.find(p=>p.id===persona)?.prompt||"";
    const templateGuide=BLOG_TEMPLATES.find(t=>t.id===blogTemplate)?.guide||"";
    // ★온종일팜/온파트너/온종일체험단 자동 소개(테리 요청 2026-08-21): 아직 유명하지 않은 서비스라
    //   제목/키워드에 이름이 나오면 AI가 모르고 대충 쓰거나 엉뚱하게 쓴다. → 우리가 가진 소개 데이터
    //   (PUBLY_SERVICE_INFO)를 프롬프트에 넣어, 그 서비스가 뭔지 핵심을 "멋있게 풀어서" 쓰게 한다.
    const serviceHay=`${title} ${keyword}`;
    const serviceMatches=(Object.keys(PUBLY_SERVICE_INFO) as ServiceInfoKey[])
      .filter(k=>{const s=PUBLY_SERVICE_INFO[k];return serviceHay.includes(s.name)||(s.aliases||[]).some(a=>serviceHay.includes(a));});
    const serviceGuide=serviceMatches.length>0
      ? "\n\n=== 🏷️ 우리 서비스 소개 (제목/키워드에 등장 — 아직 널리 알려지지 않았으니, 아래 정보를 바탕으로 그 서비스가 무엇인지 자연스럽고 매력적으로 풀어서 설명할 것. 지어내지 말고 이 내용만 사용) ===\n"
        + serviceMatches.map(k=>{const s=PUBLY_SERVICE_INFO[k];
            return `● ${s.name}: ${s.hook}\n  - 한줄요약: ${s.summary}\n  - 핵심 장점: ${s.benefits.map(b=>`${b[0]}(${b[1]})`).join(" / ")}\n  - 이용 흐름: ${s.flow}${s.url?`\n  - 링크: ${s.url}`:""}`;
          }).join("\n")
        + `\n\n★★ 서비스 글 작성 필수 규칙(짧게 쓰지 말 것 — 이게 이 글의 주제다):
- 이 서비스가 제목/주제이므로, 위 정보를 뼈대로 삼아 **글 전체를 충분히 길게** 써서 목표 글자수(${chars}자)를 반드시 채운다. 자료가 적다고 짧게 끝내지 말 것.
- 각 "핵심 장점"을 하나씩 소제목 구간으로 만들어, 각 장점마다 **구체적인 상황·예시·이렇게 쓰면 뭐가 좋은지**를 3~4문장 이상으로 풀어 쓴다.
- "이용 흐름"은 1단계→2단계→3단계처럼 각 단계가 실제로 어떤 모습인지 초보자도 알게 자세히 설명한다.
- "어떤 사람에게 좋은지", "직접 써보니(써본다면) 어떤 점이 편한지", "시작하는 법" 같은 실용 문단도 추가해 살을 붙인다.
- 광고처럼 딱딱하지 말고, 실제 경험담·추천 말투로 자연스럽게. 과장·거짓 정보는 금지(위 내용 범위에서만).`
      : "";
    const prompt=`당신은 대한민국 최고의 블로그 작가입니다.

키워드: "${keyword}"  제목: "${title}"
목표 글자수: ${chars}자 내외 (±100자, 반드시 이 범위 안에서 작성)

${catGuide}

=== 절대 규칙 ===
⛔ ## 기호 완전 금지 (소제목은 그냥 텍스트로)
⛔ ** * - + 마크다운 기호 전부 금지
⛔ 한자,중국어,일본어 금지
⛔ 영어 단어 절대 금지 — 브랜드명·제품명 제외 100% 순수 한국어로만 작성
⛔ AI 티 나는 상투어 절대 금지: "~해보겠습니다/알아보겠습니다/살펴보겠습니다/소개해드리겠습니다/정리해보겠습니다", "결론적으로", "중요합니다", "다양한", "효과적인", "필수적으로", "무엇보다도", "뿐만 아니라", "~하는 것이 좋습니다", "추천드립니다" → 전부 실제 사람 말투(~해볼게요, 여러, 꼭, 그래서, 추천해요)로
✅ 구체적 수치, 가격, 기간 포함
✅ ${endTone}
✅ 키워드 3~4회 자연스럽게 (동의어 활용)
✅ 반드시 ${chars-100}~${chars+100}자 사이로 작성

=== 🔍 검색 최적화(SEO) 규칙 — 반드시 지킬 것 ===
✅ 본문을 4~6개 구간으로 나누고, 각 구간 맨 앞에 "소제목"을 한 줄 단독으로 넣기 (## 없이 순수 텍스트)
✅ 그 소제목 중 최소 절반 이상을 "검색되는 질문형"으로 — 물음표(?)로 끝나거나 왜/어떻게/무엇/어디/언제/추천/고르는법 같은 검색어를 담기
   예) "${keyword||title} 어떻게 고를까요?"  "왜 ${keyword||title}가 인기일까요?"  "${keyword||title} 추천 이유는?"
✅ 소제목은 짧게(10~30자), 서술형 종결어미(~요/~다)로 끝내지 말 것 (제목처럼)
✅ 키워드 "${keyword||title}"를 본문에 2~6회 자연스럽게 반복 (검색 노출)

=== 📱 단락 분리 규칙 — 모바일 가독성 최우선(반드시 지킬 것) ===
✅ 모든 단락과 단락 사이는 반드시 "빈 줄 하나"(엔터 두 번)로 분리 — 문단이 절대 딱 붙지 않게
✅ 한 단락은 2~4문장까지만. 길어지면 끊어서 새 단락(빈 줄)으로 나누기
✅ 소제목은 그 자체로 한 줄 단독 + 앞뒤로 빈 줄 (위 단락과, 아래 내용과 딱 붙이지 말 것)
✅ "첫째/둘째/셋째", "1. 2. 3.", "① ② ③" 처럼 순서·항목을 나열할 때는 각 항목을 반드시 별도 단락(빈 줄)으로 분리 — 한 덩어리로 붙여 쓰지 말 것
✅ 이유: 블로그는 얼마나 읽기 쉽고 편하냐가 전부다. 모바일에서 빽빽하면 안 읽힌다.
★ 아래 [글의 방향] 지침이 이 글의 성격을 결정한다 — 구조·어조·시작·초점을 그대로 따를 것 (다른 규칙과 충돌하면 [글의 방향] 우선)

=== 글 패턴 가이드 (매번 다르게) ===
인트로: "${intro}"
소제목 스타일: "${subStyle}"
마무리: "${outro}"

${adGuide}
${platGuide}
${styleGuide}${personaGuide?"\n\n[말투/페르소나]\n"+personaGuide:""}${templateGuide?"\n\n"+templateGuide:""}${serviceGuide}

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
      const generatedBody=ensureQuestionHeadings(bm?bm[1].trim():cleaned,keyword||title);
      const body=onPartnerItems.length>0?placeOnPartnerProduct(generatedBody,onPartnerItems.map(it=>it.product)):generatedBody.trim();setGenContent(body);setQualityScore(calcQualityScore(body,keyword));
      if(imgCountAuto)setImgCount(recommendImgCount(body));
      // 비동기 글 생성 도중 사용자가 직접입력으로 바꿔도 완료 시점의 최신 선택을 존중한다.
      if(flowImgCountAutoRef.current)setFlowImgCount(recommendImgCount(body));
      // ── tarry 방식: 블록 자동 분리 + 제목/태그 자동 연동 ──
      // ★모바일 가독성(테리 강조 2026-08-21): "단락이 끝나거나 첫째/둘째/셋째로 나뉠 때 꼭 분리".
      //   AI가 여러 문장을 한 줄에 몰아 쓰거나 열거를 붙여 쓰면 발행 시 빽빽해져 모바일에서 안 읽힘.
      //   → 블록으로 쪼갤 때 (a)열거항목(첫째/1./①/- 등)은 앞에서 끊고 (b)긴 문단은 2문장씩 끊는다.
      //   FAQ/관련글 마커 블록은 구조가 있으니 그대로 둔다(건드리지 않음).
      const isStructured=(t:string)=>/\[FAQ시작\]|\[FAQ끝\]|\[관련글시작\]|\[관련글끝\]|\[참고자료시작\]|\[참고자료끝\]/.test(t);
      const splitSentences2=(t:string):string[]=>{ // 긴 줄을 2문장씩(약 130자 초과 시)
        if(t.length<=130)return[t];
        const sents=t.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*\s*|[^.!?。！？]+$/g)||[t];
        const groups:string[]=[]; for(let i=0;i<sents.length;i+=2)groups.push(sents.slice(i,i+2).join("").trim());
        return groups.filter(Boolean);
      };
      const enumRe=/^(\s*(?:첫째|둘째|셋째|넷째|다섯째|여섯째|[0-9]+[.)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•·]))\s/;
      const normalizeToBlocks=(raw:string):string[]=>{
        const out:string[]=[];
        raw.split(/\n\n+/).forEach(chunk=>{
          const c=chunk.trim(); if(!c)return;
          if(isStructured(c)){ out.push(c); return; }            // 구조 블록은 그대로
          c.split(/\n/).forEach(lineRaw=>{                        // 줄바꿈도 문단 경계로
            const line=lineRaw.trim(); if(!line)return;
            if(enumRe.test(line)){ out.push(line); return; }      // 열거 항목은 독립 문단
            splitSentences2(line).forEach(p=>{const s=p.trim(); if(s)out.push(s);});
          });
        });
        return out;
      };
      const rawBlocks = normalizeToBlocks(body).map(p=>({type:"text" as const,id:uid(),content:p}));
      setBlocks(rawBlocks.length>0?rawBlocks:[{type:"text",id:uid(),content:body}]);
      setPubTitle(title);
      if(tgm)setHashtags(tgm[1].trim().split(",").map((t:string)=>{const clean=t.trim().replace(/\s+/g,"");return clean.startsWith("#")?clean:"#"+clean;}).filter(Boolean).slice(0,Math.floor(Math.random()*4)+5));
      setAutoInserted(false);setThumbnail("");
      // 임시저장
      try {
        localStorage.setItem("publy_draft", JSON.stringify({
          title, content:body, savedAt:new Date().toLocaleString("ko-KR")
        }));
      } catch {}
    }catch(e:any){if(e.name!=="AbortError"){showToast("❌ 글 생성 실패: "+e.message+" (오류가 관리자에게 자동 전달됩니다)","error");logError({user_id:user.id,user_name:(user as any).name||"",user_email:user.email||"",feature:"글 생성",error_message:e.message}).catch(()=>{});}}
    finally{setGenerating(false);}
  }

  // ── Flow 준비: 디버깅 크롬 자동 실행 (Electron) ──
  async function handleFlowLaunchChrome(){
    if(!(window as any).electron?.flowLaunchChrome){
      showToast("PC 앱에서만 Flow 준비가 가능해요. Publy 앱을 실행해주세요.","error");
      return;
    }
    setFlowLaunching(true);
    try{
      const r=await (window as any).electron.flowLaunchChrome();
      if(r.ok){
        setFlowReady(true);
        showToast(r.already?"✅ Flow 크롬이 이미 준비돼 있어요!":"✅ Flow 크롬을 열었어요! 크롬 창에서 Google 로그인만 해주세요 (최초 1회)","success");
      }else{
        showToast("❌ "+(r.error||"Flow 준비 실패"),"error");
      }
    }catch(e:any){ showToast("❌ Flow 준비 실패: "+e.message,"error"); }
    finally{ setFlowLaunching(false); }
  }
  // Flow 선택 시 준비 상태 폴링
  useEffect(()=>{
    if(imgGenType!=="flow"||!(window as any).electron?.flowStatus)return;
    let alive=true;
    const check=async()=>{ try{ const s=await (window as any).electron.flowStatus(); if(alive)setFlowReady(!!s.ready); }catch{} };
    check(); const iv=setInterval(check,5000);
    return ()=>{ alive=false; clearInterval(iv); };
  },[imgGenType]);

  // ── 글을 읽고 "장면이 서로 다른" 이미지 프롬프트 N개 생성 (Gemini) ──
  //   6하원칙(언제/어디서/무엇을/어떻게/왜)에 맞춰 이미지만 봐도 스토리가 읽히게.
  async function buildStoryPrompts(title:string, content:string, n:number):Promise<{prompts:string[];captions:string[]}>{
    // ★글을 실제 순서대로 N개 구간으로 나눠, "각 구간 본문이 말하는 바로 그 장면"의 이미지를 만든다.
    //   (예전엔 정해진 스토리 아크로 만들어 글과 이미지가 어긋났음 — 생선구이 얘기에 간장게장 이미지 등)
    const clean=(content||"").replace(/\[(FAQ|참고자료|관련글)시작\][\s\S]*?\[\1끝\]/g,"").trim();
    const paras=clean.split(/\n{2,}/).map(p=>p.replace(/^#+\s*/,"").trim()).filter(p=>p.length>15);
    // N개 구간으로 균등 분할(각 구간=연속된 문단 묶음). 문단이 부족할 때만 실제 문장 경계로 세분화한다.
    let units=paras.length?paras:[clean||title];
    if(units.length<n){
      const sentences=units.flatMap(p=>p.match(/[^.!?。！？]+[.!?。！？]?/g)?.map(s=>s.trim()).filter(Boolean)||[]);
      if(sentences.length>units.length) units=sentences;
    }
    const count=Math.min(n,units.length);
    const segments=Array.from({length:count},(_,i)=>{
      const start=Math.floor(units.length*i/count);
      const end=Math.floor(units.length*(i+1)/count);
      return units.slice(start,end).join(" ").slice(0,320);
    }).filter(Boolean);
    const segList=segments.map((s,i)=>`[${i+1}번 구간] ${s}`).join("\n");
    const ask=`너는 블로그 사진 디렉터야. 아래는 한 글을 순서대로 ${segments.length}구간으로 나눈 거야.
각 구간의 "그 문단이 실제로 말하는 장면"을 사진 1장으로 기획해줘. 반드시 해당 구간 내용과 딱 맞아야 해(다른 구간 내용/엉뚱한 소재 금지).
예: 구간이 '생선구이'면 생선구이 사진, '조개구이'면 조개구이 사진. 구간에 특정 음식/장소가 나오면 그걸 그려.

구간별로 아래 형식 정확히 ${segments.length}줄(순서대로, 다른 말 금지):
장면설명(한국어 10~20자) | 영문 이미지 프롬프트(사진 스타일, 그 구간의 구체적 장면·소재, 조명, 사실적, 글자/워터마크 없이)

글 제목: ${title}
${segList}`;
    const text=await callAI(ask);
    const prompts:string[]=[]; const captions:string[]=[];
    for(const line of text.split("\n")){
      const t=line.trim(); if(!t||!t.includes("|"))continue;
      const [cap,...rest]=t.replace(/^\d+[).\s]*/,"").split("|");
      const eng=rest.join("|").trim();
      if(eng.length<10)continue;
      let capClean=cap.trim().replace(/[*#\-]/g,"").replace(/^\[|\]$/g,"").replace(/^\d+번?\s*구간\]?\s*/,"").trim();
      // ★형식 안내문이 캡션에 새는 것 차단: "영문 이미지 프롬프트/장면설명/사진 스타일" 등 메타 문구,
      //   한글이 하나도 없는(=영문 프롬프트가 통째로 들어온) 경우는 캡션으로 안 씀 → 아래서 깨끗한 폴백 사용.
      if(/프롬프트|영문|prompt|워터마크|사진\s*스타일|장면\s*설명|한국어|구간/i.test(capClean)) capClean="";
      if(!/[가-힣]/.test(capClean)||capClean.length<2) capClean="";
      captions.push(capClean.slice(0,30));
      prompts.push(`${eng}, rich vibrant color palette, ultra realistic 8K photography, absolutely no text, no letters, no watermark, no logo`);
    }
    return { prompts, captions };
  }

  // ── Google Flow 이미지 생성 (봇 CDP 경유, 미리보기까지) ──
  //   append=true 면 기존 이미지에 "이어붙임"(1장 지운 자리 채우기 등), false 면 전체 새로 생성(교체)
  async function handleGenerateFlowImages(append:boolean=false, addCount?:number){
    // 1) Flow 준비 상태 확인 (디버깅 크롬 열려있나) — Electron 우선, 없으면 봇 API
    const checkReady=async():Promise<boolean>=>{
      try{
        if((window as any).electron?.flowStatus){ const s=await (window as any).electron.flowStatus(); return !!s.ready; }
        const r=await botFetch(`${BOT}/api/flow/status`,{signal:AbortSignal.timeout(3000)}); const j=await r.json(); return !!j.ready;
      }catch{ return false; }
    };
    let ready=await checkReady();
    // ★ 크롬이 안 떠 있으면 여기서 "자동으로" 띄운다(예전엔 안내만 하고 아무 창도 안 떠 혼란).
    if(!ready && (window as any).electron?.flowLaunchChrome){
      showToast("🚀 Flow 크롬을 여는 중... (처음이면 로그인 창이 떠요)","info");
      try{
        const lr=await (window as any).electron.flowLaunchChrome();
        if(lr?.ok){ setFlowReady(true); ready=true; }
        else showToast("❌ 크롬 열기 실패: "+(lr?.error||"Chrome이 설치돼 있는지 확인해주세요"),"error");
      }catch(e:any){ showToast("❌ 크롬 열기 오류: "+(e?.message||""),"error"); }
    }
    if(!ready){
      showToast("🎨 Flow 준비가 안 됐어요. 위의 '🚀 Flow 준비' 버튼을 먼저 눌러주세요.","error");
      return;
    }
    setGenImgLoading(true);setGenImgProgress(0);setGenImgCurrent(0);setImgGenFailed(false);
    // 2) 글 내용 기반 프롬프트 + 캡션 구성
    // ★버튼 숫자 = 만들 장수(n). 기존 이미지가 몇 장이든 상관없이 그 개수만큼만 만든다(더하기 계산 없음).
    //   이어붙이기면 addCount(1/2/3장), 처음 생성이면 설정 개수(ref=최신).
    const n=append&&addCount ? Math.max(1,Math.min(3,addCount)) : Math.max(1,flowImgCountRef.current);
    const content=genContent||"";
    let prompts:string[]=[];
    let caps:string[]=[];
    console.log(`[publy] Flow ${append?"이어서":"새로"} ${n}장 생성 (버튼 숫자=만들 장수, 기존 개수 무관)`);
    // 글 전체를 n등분해 서로 다른 구간의 프롬프트 n개 생성(장면이 안 섞여 괴물 방지). 실패 시 고정 템플릿 폴백.
    try{
      const sceneResult=await buildStoryPrompts(pubTitle||genTitle, content, n);
      if(sceneResult.prompts.length>=n){ prompts=sceneResult.prompts.slice(0,n); caps=sceneResult.captions.slice(0,n); }
    }catch{}
    if(prompts.length<n){
      // 폴백: 구간별 고정 템플릿 — 글을 n등분
      const lines=content.split("\n").filter(l=>l.trim().length>5);
      const step=Math.max(1,Math.floor(lines.length/n));
      prompts=Array.from({length:n},(_,k)=>{
        const seg=lines.slice(k*step,(k+1)*step).join(" ").slice(0,150);
        return buildFlowPrompt(keyword||genTitle,pubTitle||genTitle,seg,k);
      });
      caps=buildCaptions(keyword||genTitle,n,content).slice(0,n);
    }
    try{
      showToast(append?`🎨 이미지 ${n}장 이어서 생성 중... (글 뒷부분 이어받음)`:`🎨 새로 이미지 ${n}장 생성 중...`,"info");
      const postOnce=()=>botFetch(`${BOT}/api/flow-generate`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompts,captions:caps}),
        // Flow의 후보 렌더·다운로드·재시도 시간을 장수에 비례해 보장한다(8장 약 34분).
        signal:AbortSignal.timeout(n*240000+120000),
      });
      let r=await postOnce();
      let d=await r.json();
      // ★자동치유: 크롬이 좀비라 못 붙은 경우(CDP_CONNECT_FAIL) 크롬을 자동으로 다시 준비(좀비 정리+재실행)하고 1회 재시도
      if(!r.ok && d.code==="CDP_CONNECT_FAIL" && (window as any).electron?.flowLaunchChrome){
        showToast("🔧 Flow 크롬을 다시 준비하는 중...","info");
        try{ const lr=await (window as any).electron.flowLaunchChrome(); if(lr?.ok)setFlowReady(true); }catch{}
        r=await postOnce(); d=await r.json();
      }
      if(!r.ok){
        if(d.code==="FLOW_NOT_LOGGED_IN") showToast("크롬 창에서 Google Flow 로그인을 먼저 해주세요.","error");
        else if(d.code==="CDP_CONNECT_FAIL") showToast("Flow 크롬 준비에 실패했어요. 'Flow 준비'를 다시 눌러주세요.","error");
        else showToast("❌ Flow 생성 실패: "+(d.error||r.status),"error");
        setImgGenFailed(true);setGenImgLoading(false);return;
      }
      const imgs:string[]=(d.images||[]).map((x:any)=>x.src).filter(Boolean);
      if(imgs.length===0){ showToast("❌ 이미지가 생성되지 않았어요","error");setImgGenFailed(true);setGenImgLoading(false);return; }
      const newCaps=(d.images||[]).map((x:any,i:number)=>x.alt||caps[i]||`${keyword||genTitle} 사진 ${i+1}`);
      // ★ append면 기존 이미지 뒤에 이어붙이기(1장 지운 자리 채우기), 아니면 교체(전체 새로)
      const finalImgs = append ? [...generatedImages, ...imgs] : imgs;
      const finalCaps = append ? [...captions, ...newCaps] : newCaps;
      setGeneratedImages(finalImgs);
      setCaptions(finalCaps);
      if(!thumbnail)setThumbnail(finalImgs[0]);
      triggerAutoInsert(finalImgs.map((src,i)=>({id:i,src,alt:finalCaps[i]||`${keyword||genTitle} 사진`})));
      setShowMeta(true);
      showToast(append?`✅ 이미지 ${imgs.length}장 이어서 생성 완료!`:`✅ Flow 이미지 ${imgs.length}장 생성 완료! (바탕화면에도 백업됨)`,"success");
    }catch(e:any){
      if(e.name!=="AbortError"){ showToast("❌ Flow 생성 실패: "+e.message,"error");setImgGenFailed(true); }
    }finally{ setGenImgLoading(false); }
  }

  async function handleGenerateImages(){
    if(!keyword&&!genTitle){alert("먼저 글을 생성해주세요");return;}
    // ── Flow 이미지 생성 (Google Flow, CDP 방식) ──
    if(imgGenType==="flow"){ await handleGenerateFlowImages(); return; }
    // 이미지 AI 키 사전 체크 — 없으면 조용히 실패하지 않고 명확히 안내
    const imageAi=localStorage.getItem("publy_image_ai")||"openai_img";
    if(imageAi==="replicate"&&!localStorage.getItem("publy_replicate_key")){
      showToast("⚠️ Replicate 키가 없어요. 설정 탭에서 Replicate API 키를 입력하거나, 'Flow 이미지(무료)' 또는 '내 이미지 업로드'를 선택하세요.","error");
      return;
    }
    if(imageAi==="openai_img"&&!localStorage.getItem("publy_openai_key")){
      showToast("⚠️ OpenAI 키가 없어요. 설정 탭에서 키를 입력하거나, 'Flow 이미지(무료)' 또는 '내 이미지 업로드'를 선택하세요.","error");
      return;
    }
    setGenImgLoading(true);setGenImgProgress(0);setGenImgCurrent(0);
    imgAbortRef.current=new AbortController();const imgs:string[]=[];

    // 글 내용을 이미지 수만큼 등분
    const content = genContent || "";
    const segments: string[] = [];
    if (content.length > 0 && imgCount > 1) {
      const lines = content.split("\n").filter(l => l.trim().length > 5);
      const step = Math.max(1, Math.floor(lines.length / imgCount));
      for (let i = 0; i < imgCount; i++) {
        const start = i * step;
        const seg = lines.slice(start, start + step).join(" ").slice(0, 150);
        segments.push(seg);
      }
    }

    const firstPrompt=buildImgPrompt(keyword||genTitle,genTitle,0,segments[0]);
    setCurrentImgPrompt(firstPrompt);
    try{
      for(let i=0;i<imgCount;i++){
        if(imgAbortRef.current.signal.aborted)break;
        setGenImgCurrent(i+1);
        const url=await generateOneImage(keyword||genTitle,imgAbortRef.current.signal,i,segments[i]);
        imgs.push(url);setGeneratedImages([...imgs]);setGenImgProgress(Math.round(((i+1)/imgCount)*100));
      }
      // 이미지 생성 완료 시 캡션 자동생성 + 블록 자동배치 + 썸네일 자동지정
      setCaptions(buildCaptions(keyword||genTitle, imgs.length, genContent));
      if(imgs.length>0){
        const captionList = buildCaptions(keyword||genTitle, imgs.length, genContent);
        if(!thumbnail)setThumbnail(imgs[0]);
        triggerAutoInsert(imgs.map((src,i)=>({id:i,src,alt:captionList[i]||`${keyword||genTitle} ${i===0?"대표":"현장"} 사진`})));
        setShowMeta(true);
      }
    }catch(e:any){if(e.name!=="AbortError"){showToast("❌ 이미지 생성 실패: "+e.message,"error");setImgGenFailed(true);}}
    finally{setGenImgLoading(false);imgAbortRef.current=null;}
  }

  function stopImageGen(){imgAbortRef.current?.abort();setGenImgLoading(false);}

  function handleImageUpload(e:React.ChangeEvent<HTMLInputElement>){
    const files=e.target.files;if(!files)return;
    Array.from(files).forEach(async file=>{
      if(!file.type.startsWith("image/"))return;
      const src=await resizeImage(file); // 업로드 이미지도 리사이즈(발행 속도)
      setUploadedImages(prev=>[...prev,src]);
    });
  }

  function getActiveImages():string[]{return imgSource==="upload"?uploadedImages:generatedImages;}

  // 발행 가능 여부 — state가 비어도 draft에 글/제목 있으면 발행 가능(탭 이동 대응)
  function hasPublishableContent():boolean{
    if(pubTitle && (genContent || blocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim()))) return true;
    try{ const d=JSON.parse(localStorage.getItem("publy_draft")||"{}"); return !!(d.title && d.content); }catch{ return false; }
  }
  function buildPublishContent():string{ return buildPublishContentWith(genContent); }
  function buildPublishContentWith(gc:string):string{
    if(!gc)return "";
    // pubScope 필터 먼저 적용 (블록보다 우선)
    if(pubScope==="body"){
      let t=gc;
      t=t.replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g,"").replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
      return t;
    }
    if(pubScope==="faq"){
      let t=gc;
      t=t.replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g,"").replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g,"").trim();
      return t;
    }
    // full: 블록에 텍스트 있으면 블록 HTML, 없으면 gc 그대로
    if(blocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim()))return buildHtmlContent();
    return gc;
  }

  async function handlePublish(){
    // ★ 탭 이동/계정 변경으로 state가 비어도 발행되게 — draft(localStorage)에서 자동 복원.
    //   준비만 됐으면(제목·본문 어딘가에 존재) 몇 번을 오가든 무조건 발행 가능하게.
    let effTitle = pubTitle || genTitle;
    let effGenContent = genContent;
    if(!effTitle || !effGenContent){
      try{
        const d = JSON.parse(localStorage.getItem("publy_draft")||"{}");
        if(!effTitle && d.title) effTitle = d.title;
        if(!effGenContent && d.content) effGenContent = d.content;
      }catch{}
    }
    // 복원된 값을 state에도 반영(다음 렌더/블록 계산 일관성)
    if(effTitle && effTitle!==pubTitle) setPubTitle(effTitle);
    if(effGenContent && effGenContent!==genContent) setGenContent(effGenContent);

    if(!pubAccId){alert("발행할 계정을 선택해주세요 (계정 관리에서 연결)");return;}
    if(!effTitle){alert("제목이 없어요. 글 생성 또는 키워드/제목에서 제목을 만들어주세요");return;}
    // content 계산 (state 대신 복원값 기준)
    const content = buildPublishContentWith(effGenContent);
    if(!content){alert("발행할 본문이 없어요. 글 생성 탭에서 글을 만들어주세요");return;}
    if(scheduleOn&&!scheduleTime){alert("예약 날짜와 시간을 선택해주세요");return;}
    const normalizedScheduleTime=scheduleOn?kstScheduleIso(scheduleTime):undefined;
    if(scheduleOn&&(!normalizedScheduleTime||Date.parse(normalizedScheduleTime)<=Date.now())){alert("예약 시간은 현재 한국시간보다 이후로 선택해주세요");return;}
    setPublishing(true);showToast(scheduleOn?"예약 설정 중...":"발행 중...","info");
    const tags=hashtags.map(t=>t.replace("#","")).filter(Boolean);
    // ── blocks 이미지 보정: 선택된 이미지(업로드/AI)가 blocks에 안 들어가 있으면 자동 배치 ──
    //    (직접 업로드는 triggerAutoInsert를 안 거쳐 blocks에 이미지가 없던 문제 방지)
    const activeImgs=getActiveImages();
    const blocksHaveImg=blocks.some(b=>b.type==="image"||b.type==="image-pair");
    let effectiveBlocks=blocks;
    if(imgSource!=="none" && activeImgs.length>0 && !blocksHaveImg){
      triggerAutoInsert(activeImgs.map((src,i)=>({id:i,src,alt:captions[i]||`${keyword||genTitle||pubTitle} ${i===0?"대표":"사진"} ${i+1}`})));
      // triggerAutoInsert는 setBlocks(비동기)라 이번 발행엔 로컬로 즉시 구성
      const imgBlocks=activeImgs.map((src,i)=>({type:"image" as const,id:uid(),src,alt:captions[i]||`${keyword||genTitle||pubTitle} 사진 ${i+1}`,position:"center" as const,source:(imgSource==="upload"?"manual":"auto") as any}));
      const textBlocks=blocks.filter(b=>b.type==="text");
      effectiveBlocks=textBlocks.length>0?[imgBlocks[0],...interleave(textBlocks,imgBlocks.slice(1))]:[...imgBlocks];
      if(!thumbnail && activeImgs[0]) setThumbnail(activeImgs[0]);
    }
    // ── 온파트너 링크: URL만 본문에 분산 삽입 → 네이버가 정사각 링크 카드로 렌더(상품당 1개, Q&A·해시태그 위) ──
    // ★안전장치: 조회만 하고 저장(💾) 안 한 상품(onPartnerPreview)도 발행에 포함.
    const partnerForPublish:OnPartnerItem[] = onPartnerItems.length>0 ? onPartnerItems : (onPartnerPreview?[onPartnerPreview]:[]);
    console.log("[publy] 온파트너 링크 대상:", partnerForPublish.length, "개", partnerForPublish.map(it=>it.product.name));
    if(partnerForPublish.length>0){
      const items=partnerForPublish.filter(it=>it.product.available&&it.product.partnerUrl);
      // ★온파트너(제휴) 있으면 썸네일(첫 이미지) 캡션을 비운다 — 원래 잘 되던 모습:
      //   썸네일엔 캡션 없이, 바로 밑에 제휴 광고고지 문구가 오게. (캡션이 있으면 그 밑에 문구가
      //   붙어 지저분하고, 캡션칸 자체가 없어야 문구가 본문에 깔끔히 들어감.)
      if(items.length>0){
        const firstImgIdx=effectiveBlocks.findIndex(b=>b.type==="image");
        if(firstImgIdx>=0) effectiveBlocks[firstImgIdx]={...(effectiveBlocks[firstImgIdx] as SingleImageBlock),alt:""} as ContentBlock;
      }
      // ★고지 문단을 "썸네일 바로 다음"(본문 맨 앞)에 무조건 1회. 이미 있으면 중복 안 넣음.
      const DISCLOSURE="※ 이 글에는 제휴 링크가 포함되어 있으며, 구매 시 작성자에게 일정 수수료가 발생할 수 있습니다.";
      const hasDisclosure=effectiveBlocks.some(b=>b.type==="text"&&(b as TextBlock).content.includes("제휴 링크가 포함"));
      if(!hasDisclosure){
        effectiveBlocks=[{type:"text",id:uid(),content:DISCLOSURE} as ContentBlock,...effectiveBlocks];
      }
      // 광고 금지 경계: FAQ/Q&A/관련글/해시태그 섹션 시작 텍스트 블록 — 광고는 이 위에만.
      const isBoundary=(b:ContentBlock)=>b.type==="text"&&/\[FAQ시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test((b as TextBlock).content);
      let boundaryIdx=effectiveBlocks.findIndex(isBoundary);
      if(boundaryIdx<0)boundaryIdx=effectiveBlocks.length;
      // ★링크는 "이미지 블록 바로 뒤"에 붙인다(테리 요청 2026-08-21): 이미지 → 링크 카드가 딱 붙어,
      //   이미지와 링크 사이에 본문 글이 끼지 않게. 썸네일(첫 이미지, index 0)은 제외(제휴문구 자리라 충돌 방지).
      //   이미지가 없으면 기존처럼 본문 텍스트 블록 뒤로 폴백.
      const imgIdxs:number[]=[];
      for(let i=1;i<boundaryIdx;i++){const t=effectiveBlocks[i].type;if(t==="image"||t==="image-pair")imgIdxs.push(i);}
      const textIdxs:number[]=[];
      for(let i=0;i<boundaryIdx;i++){const b=effectiveBlocks[i];if(b.type==="text"&&(b as TextBlock).content.trim().length>=40)textIdxs.push(i);}
      if(textIdxs.length===0)for(let i=0;i<boundaryIdx;i++)if(effectiveBlocks[i].type==="text")textIdxs.push(i);
      const anchorIdxs = imgIdxs.length>0 ? imgIdxs : textIdxs;   // 우선 이미지 뒤, 없으면 텍스트 뒤
      if(anchorIdxs.length>0){
        const ratios = items.length===1?[0.6]:items.length===2?[0.45,0.72]:[0.35,0.58,0.8];
        const used=new Set<number>();
        const insertAfter=items.map((_,i)=>{
          let ai=Math.round(anchorIdxs.length*ratios[i])-1;
          ai=Math.max(0, Math.min(anchorIdxs.length-1, ai));
          while(used.has(anchorIdxs[ai])&&ai<anchorIdxs.length-1)ai++;   // 여러 링크가 같은 이미지에 몰리지 않게
          used.add(anchorIdxs[ai]);
          return anchorIdxs[ai];
        });
        const withLink:ContentBlock[]=[];
        effectiveBlocks.forEach((b,i)=>{
          withLink.push(b);
          items.forEach((it,k)=>{
            if(insertAfter[k]===i){
              // URL만 자체 문단으로 → 네이버가 정사각 링크 카드 자동 생성. 앞에 짧은 안내 한 줄.
              withLink.push({type:"text",id:uid(),content:`👇 '${it.product.name}' 지금 바로 확인하기\n${it.product.partnerUrl}`} as ContentBlock);
            }
          });
        });
        effectiveBlocks=withLink;
      }
    }
    // ── 내 링크(일반 사이트): 온파트너와 별도로, "이미지 바로 뒤(사이 글 없이)"에 URL만 삽입 → 네이버 OG 카드 ──
    //    ★온파트너와 안 엉키게: 이미 링크가 바로 뒤에 붙은 이미지는 앵커에서 제외한다.
    if(myLinks.length>0){
      const isBoundary2=(b:ContentBlock)=>b.type==="text"&&/\[FAQ시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test((b as TextBlock).content);
      let bIdx=effectiveBlocks.findIndex(isBoundary2); if(bIdx<0)bIdx=effectiveBlocks.length;
      const isLinkBlock=(b?:ContentBlock)=>!!b&&b.type==="text"&&/https?:\/\//.test((b as TextBlock).content);
      // 앵커=경계 전 이미지 블록 중, 바로 뒤가 이미 링크가 아닌 것(온파트너 링크 붙은 이미지 제외). 썸네일(0) 제외.
      const anchors:number[]=[];
      for(let i=1;i<bIdx;i++){const t=effectiveBlocks[i].type;if((t==="image"||t==="image-pair")&&!isLinkBlock(effectiveBlocks[i+1]))anchors.push(i);}
      // 이미지 앵커가 없으면 본문 텍스트 블록 뒤로 폴백
      if(anchors.length===0)for(let i=0;i<bIdx;i++){const b=effectiveBlocks[i];if(b.type==="text"&&(b as TextBlock).content.trim().length>=40&&!/https?:\/\//.test((b as TextBlock).content))anchors.push(i);}
      if(anchors.length>0){
        const ratios = myLinks.length===1?[0.7]:myLinks.length===2?[0.5,0.8]:[0.4,0.62,0.85];
        const used=new Set<number>();
        const insAfter=myLinks.map((_,i)=>{
          let ai=Math.round(anchors.length*ratios[i])-1; ai=Math.max(0,Math.min(anchors.length-1,ai));
          while(used.has(anchors[ai])&&ai<anchors.length-1)ai++;
          used.add(anchors[ai]); return anchors[ai];
        });
        const withMy:ContentBlock[]=[];
        effectiveBlocks.forEach((b,i)=>{
          withMy.push(b);
          myLinks.forEach((url,k)=>{ if(insAfter[k]===i) withMy.push({type:"text",id:uid(),content:url} as ContentBlock); });  // URL만 → OG 카드
        });
        effectiveBlocks=withMy;
      }
    }
    // ── 글쓴이 인사말: "제휴문구 바로 다음 / 제휴문구 없으면 썸네일(첫 이미지) 다음"에 1회 삽입 (테리 요청 2026-08-21) ──
    //    순서 = 썸네일 → (있으면)제휴문구 → 인사말 → 본문. 인사말이 비어있으면 안 넣는다.
    //    blocks 기반 발행이라 여기서 명시적으로 넣어야 유실 안 됨(기존엔 buildNaverText에만 있어 발행에서 누락됐음).
    if(greeting.trim()){
      const g=greeting.trim();
      const already=effectiveBlocks.some(b=>b.type==="text"&&(b as TextBlock).content.trim()===g);
      if(!already){
        const gBlock={type:"text",id:uid(),content:g} as ContentBlock;
        const discIdx=effectiveBlocks.findIndex(b=>b.type==="text"&&(b as TextBlock).content.includes("제휴 링크가 포함"));
        const firstImgIdx=effectiveBlocks.findIndex(b=>b.type==="image"||b.type==="image-pair");
        const at = discIdx>=0 ? discIdx+1 : (firstImgIdx>=0 ? firstImgIdx+1 : 0);   // 제휴문구 뒤 > 썸네일 뒤 > 맨 앞
        effectiveBlocks=[...effectiveBlocks.slice(0,at),gBlock,...effectiveBlocks.slice(at)];
      }
    }
    const publishBody={
      userId:user.id,platform,title:effTitle,content,
      pubScope,
      tags,
      imageUrl:thumbnail||activeImgs[0]||undefined,
      categoryId:category||undefined,
      visibility,
      scheduleTime:normalizedScheduleTime,
      videoUrl:(videoOn&&videoUrl.trim())?videoUrl.trim():undefined,
      videoPosition,
      blocks:effectiveBlocks.map(b=>{
        if(b.type==="text")return{type:"text",content:(b as TextBlock).content};
        if(b.type==="image")return{type:"image",src:(b as SingleImageBlock).src,alt:(b as SingleImageBlock).alt||"",link:(b as any).link||undefined};
        if(b.type==="image-pair")return{type:"image-pair",images:(b as ImagePairBlock).images};
        return null;
      }).filter(Boolean),
      // Flow 이미지 설정
      useFlow: imgGenType === "flow" && generatedImages.length === 0,
      flowImgCount: imgGenType === "flow" && generatedImages.length === 0 ? flowImgCountRef.current : undefined,
      flowPrompts: imgGenType === "flow" && generatedImages.length === 0 ? (() => {
        const c = genContent || "";
        const lines = c.split("\n").filter((l:string) => l.trim().length > 5);
        const step = Math.max(1, Math.floor(lines.length / flowImgCount));
        return Array.from({length: flowImgCount}, (_, i) => {
          const seg = lines.slice(i * step, (i + 1) * step).join(" ").slice(0, 150);
          return buildFlowPrompt(keyword||genTitle, pubTitle, seg, i);
        });
      })() : undefined,
      flowCaptions: imgGenType === "flow" && generatedImages.length === 0
        ? buildCaptions(keyword||genTitle, flowImgCount, genContent)
        : undefined,
    };
    try{
      // 하루 발행 한도 체크
      const dailyCheck = await checkDailyPublishQuota(user.id, user.plan);
      if (!dailyCheck.ok) {
        showToast(`❌ 오늘 발행 한도(${dailyCheck.limit}개) 초과! 내일 다시 가능해요`, "error");
        setPublishing(false); return;
      }
      // 봇 오프라인일 때만 큐(publy_jobs)에 저장 → 앱 켜지면 처리. (예약이든 아니든)
      //   ★ 예약발행(scheduleOn)은 봇 온라인이면 아래 else로 가서 "지금 즉시 네이버에 글·이미지 작성 후
      //     네이버 예약발행 UI에 시간을 넣어" 확정한다(PC 꺼도 네이버가 그 시간에 발행). scheduleTime을 payload로 넘김.
      if(!botOnline){
        const jobRow:any={user_id:user.id,platform,title:effTitle,content,
          tags,image_url:publishBody.imageUrl,
          category_id:category||undefined,visibility,
          schedule_time:normalizedScheduleTime,status:"pending",
          payload:publishBody};
        let {error:jobErr}=await supabase.from("publy_jobs").insert(jobRow);
        if(jobErr && /payload|column|schema|does not exist/i.test(jobErr.message)){
          const {payload,...noPayload}=jobRow;
          const retry=await supabase.from("publy_jobs").insert(noPayload); jobErr=retry.error;
        }
        if(jobErr) throw new Error("예약 저장 실패: "+jobErr.message);
        setPubMsg("✅ PC 봇에 예약됐어요! Publy 앱 실행 시 자동 발행돼요.");
        showToast("✅ PC 봇에 예약됐어요! Publy 앱 실행 시 자동 발행돼요.");
        await addHistory({user_id:user.id,platform,title:effTitle,status:"pending" as "success"|"fail"});
      }else{
        // PC 봇이 오프라인인 작업은 봇이 실제 처리할 때 한 번만 차감한다.
        const ok=await useQuota(user.id);if(!ok){showToast("❌ 발행 건수 초과","error");setPublishing(false);return;}
        const r=await botFetch(`${BOT}/api/publish-full`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(publishBody)});
        const d=await r.json();
        if(r.status===401){showToast("❌ 세션 만료 — 계정 관리 탭에서 재연결해주세요","error");setPublishing(false);return;}
        if(!r.ok)throw new Error(d.error);
        await addHistory({user_id:user.id,platform,title:effTitle,post_url:d.postUrl,status:"success",
          content:{title:effTitle,content,pubScope,tags,imageUrl:thumbnail||getActiveImages()[0]||undefined,categoryId:category||undefined,visibility,blocks:publishBody.blocks,platform}})
          .catch(async()=>{ await addHistory({user_id:user.id,platform,title:effTitle,post_url:d.postUrl,status:"success"}).catch(()=>{}); });
        await incrementDailyPublish(user.id);
        setDailyPublishUsed(p => p + 1);
        setPubMsg(scheduleOn?"✅ 예약 완료! 설정한 시간에 자동 발행돼요.":"✅ 발행 완료!");
        showToast(scheduleOn?"⏰ 예약 완료!":"✅ 발행 완료! 🎉");
        if(d.warning) setTimeout(()=>showToast("⚠️ "+d.warning,"error"),1500);
      }
      getHistory(user.id).then(setHistory);getQuota(user.id).then((q:PublyQuota|null)=>q&&setQuota(q));
    }catch(e:any){await addHistory({user_id:user.id,platform,title:effTitle,status:"fail",error_message:e.message});setPubMsg("❌ "+e.message+" (오류가 관리자에게 자동 전달됩니다)");showToast("❌ "+e.message,"error");logError({user_id:user.id,user_name:(user as any).name||"",user_email:user.email||"",feature:"블로그 발행 ("+platform+")",error_message:e.message}).catch(()=>{});}
    finally{setPublishing(false);}
  }

  // ── 발행 패널 렌더 함수 ──
  // 발행 탭: 작성한 글 + 생성한 이미지 전부 초기화(설정·계정은 유지)
  function resetDraft(){
    if(!confirm("작성한 글과 생성한 이미지를 모두 지우고 처음부터 시작할까요?"))return;
    setGenContent(""); setGenTitle(""); setPubTitle(""); setGenTags("");
    setBlocks([{type:"text",id:uid(),content:""}]);
    setGeneratedImages([]); setCaptions([]); setThumbnail("");
    try{ localStorage.removeItem("publy_draft"); }catch{}
    setDraftAvailable(false); setDraftData(null);
    showToast("🧹 글과 이미지를 초기화했어요");
  }

  function renderPublishPanel(){
    return(<div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* 초기화 */}
      <div style={{display:"flex",justifyContent:"flex-end"}}>
        <button onClick={resetDraft} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit",transition:"all .15s"}}>🧹 글·이미지 초기화</button>
      </div>
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
          <button onClick={()=>{setScheduleOn(v=>!v);if(!scheduleTime){const d=new Date(Date.now()+60*60*1000);d.setUTCMinutes(0,0,0);setScheduleTime(formatKstDateTime(d));}}} style={{width:48,height:26,borderRadius:99,background:scheduleOn?"var(--accent)":"var(--border)",border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:scheduleOn?24:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.3)"}}/>
          </button>
        </div>
        {scheduleOn&&(
          <div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:8}}>🇰🇷 현재 한국시간 {kstNow.replace("T"," ")}</div>
            <input type="datetime-local" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)} min={formatKstDateTime()} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"2px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
            {scheduleTime&&<div style={{marginTop:8,padding:"10px 12px",borderRadius:10,background:"var(--accent-bg)",border:"1px solid var(--accent-border)",fontSize:12,color:"var(--accent-text)",fontWeight:600}}>
              ✅ {new Date(scheduleTime).toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"short"})} {new Date(scheduleTime).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} 발행
            </div>}
          </div>
        )}
      </div>

      {/* 발행 버튼 */}
      <button onClick={handlePublish} disabled={publishing||!pubAccId||!hasPublishableContent()||(quota!==null&&(quota.remaining_quota||0)<=0)||(scheduleOn&&!scheduleTime)} className="btn btn-primary btn-full btn-xl pub-submit-btn">
        {publishing
          ?<><span className="spinner"/>{scheduleOn?"예약 중...":"발행 중..."}</>
          :scheduleOn?<>⏰ 예약 발행 설정하기</>:<>🚀 블로그 자동 발행</>
        }
      </button>
    </div>);
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
    if(!newUser||!newPw)return;
    // 계정 수 제한 체크
    const config = PLAN_CONFIG[user.plan] ?? PLAN_CONFIG.free;
    const currentCount = accounts.filter(a => a.platform !== "google").length;
    if (currentCount >= config.maxAccounts) {
      alert(`${config.label} 플랜은 최대 ${config.maxAccounts}개 계정까지 등록 가능합니다`);
      return;
    }
    setAddingAcc(true);
    try{
      if(!botOnline)throw new Error("PC에서 Publy 앱을 먼저 실행해주세요");
      const r=await botFetch(`${BOT}/api/${newPlat}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:user.id,id:newUser,pw:newPw,blogName:newBlog||undefined}),signal:AbortSignal.timeout(120000)});
      const d=await r.json();if(!d.success)throw new Error(d.error||"연결 실패");
      await upsertAccount({user_id:user.id,platform:newPlat,username:newUser,blog_name:newBlog||undefined,is_connected:true,connected_at:new Date().toISOString()});
      await getAccounts(user.id).then(setAccounts);setNewUser("");setNewPw("");setNewBlog("");
    }
    catch(e:any){alert(e.message);}finally{setAddingAcc(false);}
  }
  async function handleConnect(acc:PublyAccount){
    if(!botOnline){alert("PC에서 Publy 앱을 먼저 실행해주세요");return;}setConnId(acc.id);
    try{
      const legacy=(acc as any).password_encrypted||"";
      let pw="";try{pw=legacy?atob(legacy):"";}catch{}
      if(!pw){ const entered=await askPassword(acc); if(entered===null){setConnId(null);return;} pw=entered; }
      if(!pw)throw new Error("비밀번호 입력이 필요합니다");
      const r=await botFetch(`${BOT}/api/${acc.platform}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:acc.user_id,id:acc.username,pw,blogName:acc.blog_name}),signal:AbortSignal.timeout(120000)});
      const d=await r.json();if(!d.success)throw new Error(d.error||"연결 실패");
      await upsertAccount({...acc,password_encrypted:"",is_connected:true,connected_at:new Date().toISOString()});
      getAccounts(user.id).then(setAccounts);
      refreshSessionStatus();
    }catch(e:any){alert("연결 실패: "+e.message);}finally{setConnId(null);}
  }
  async function generateFromPhotos() {
    if(photoFiles.length===0){showToast("사진을 먼저 업로드해주세요","error");return;}
    const geminiKey=localStorage.getItem("publy_gemini_key")||"";
    if(!geminiKey){showToast("설정에서 Gemini API 키를 입력해주세요","error");return;}
    setPhotoGenerating(true);setPhotoGenDone(false);

    try {
      // 이미지 parts 구성 (최대 20장 Vision 전송 - 체험단 실무 기준. 리사이즈로 용량 적음)
      const imgParts = photoFiles.slice(0,20).map(f=>{
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
      const endTone = WRITE_STYLE_ENDTONE[writeStyle]||"문장 끝: ~해요, ~거든요, ~더라고요 다양하게.";
      const personaGuide = PERSONA_STYLES.find(p=>p.id===persona)?.prompt||"";

      const photoCount = Math.min(photoFiles.length, 20);
      const prompt = `당신은 대한민국 최고의 블로그 작가입니다. 첨부된 ${photoCount}장의 사진을 순서대로 자세히 분석하여 네이버 블로그 글을 작성해주세요.

사진 속 모든 디테일(색상, 분위기, 장소, 음식, 사람, 배경 등)을 실제로 경험한 것처럼 생생하게 묘사해주세요.${keypointText}

=== 절대 규칙 ===
⛔ ## 기호 완전 금지 (소제목은 그냥 텍스트로)
⛔ ** * 마크다운 기호 전부 금지
⛔ AI 티 나는 상투어 절대 금지 (다양한, 효과적인, 중요합니다, 필수적으로, 결론적으로, ~해보겠습니다, 추천드립니다 등) → 실제 사람 말투로
⛔ 영어 단어 금지 (브랜드명 제외)
✅ 사진에서 직접 보이는 것을 구체적으로 묘사
✅ 구체적 수치, 가격, 시간 포함
✅ ${endTone}
★ 아래 [글의 방향] 지침이 이 글의 성격을 결정한다 — 구조·어조·초점을 그대로 따를 것 (충돌 시 [글의 방향] 우선)

=== ⭐ 사진 배치 규칙 (가장 중요) ===
✅ 각 사진은 그 사진을 설명하는 문단 "바로 앞"에 [사진N] 마커로 넣어주세요 (N은 1부터, 첨부 순서 그대로).
✅ 예: [사진1] 뒤에는 1번 사진에 대한 이야기, [사진2] 뒤에는 2번 사진 이야기.
✅ ${photoCount}개의 마커 [사진1]~[사진${photoCount}]를 본문에 빠짐없이, 순서대로, 각각 한 번씩만 넣으세요.
✅ 마커는 반드시 문단 맨 앞에 단독 줄로. 마커 바로 다음 문단은 그 사진에 실제로 보이는 것을 구체적으로 묘사.
✅ 각 사진 문단은 최소 3~4문장 이상, 사진끼리 내용이 겹치지 않게.

${styleGuide}
${personaGuide?`
[말투]
${personaGuide}`:""}

=== 출력 형식 (반드시 준수) ===
제목: (SEO 최적화 제목, 15~25자)
태그: 태그1, 태그2, 태그3, 태그4, 태그5

[사진1]
(1번 사진을 보고 쓴 문단)

[사진2]
(2번 사진을 보고 쓴 문단)

... (첨부한 ${photoCount}장 전부, 사진마다 마커+문단)

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

      // 서버 프록시 경유 시도 → 실패 시 직접 호출 폴백
      let text = "";
      try {
        const proxyR = await botFetch(`${BOT}/api/gemini-vision`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({apiKey:geminiKey, parts:imgParts, prompt}),
          signal:AbortSignal.timeout(30000)
        });
        if(proxyR.ok){
          const proxyData = await proxyR.json();
          if(proxyData.text) text = proxyData.text;
        }
      } catch {}

      // 봇 없거나 실패 시 직접 호출
      if(!text){
        const MODELS = ["gemini-2.0-flash","gemini-2.5-flash","gemini-1.5-flash"];
        const bodyDirect = {contents:[{parts:[...imgParts,{text:prompt}]}],generationConfig:{maxOutputTokens:4000,temperature:0.9}};
        for(const model of MODELS){
          try{
            const r = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
              {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bodyDirect),signal:AbortSignal.timeout(120000)}
            );
            if(!r.ok) continue;
            const d = await r.json();
            const t = d.candidates?.[0]?.content?.parts?.[0]?.text;
            if(t){text=t;break;}
          }catch{}
        }
      }
      if(!text) throw new Error("생성 실패. Gemini 키를 확인하거나 잠시 후 다시 시도해주세요.");

      const titleM = text.match(/제목[:\s]*([^\n]+)/);
      const tagM = text.match(/태그[:\s]*([^\n]+)/);
      const bodyM = text.match(/태그[^\n]*\n([\s\S]+)/);

      const title = titleM?.[1]?.trim()||"사진으로 작성된 글";
      if(tagM?.[1]){
        setHashtags(tagM[1].trim().split(",").map((t:string)=>{
          const clean=t.trim().replace(/\s+/g,"");
          return clean.startsWith("#")?clean:"#"+clean;
        }).filter(Boolean).slice(0,Math.floor(Math.random()*4)+5));
      }

      const body2 = bodyM?.[1]?.trim()||text;
      setGenContent(body2.replace(/\[사진\d+\]/g,"").replace(/\n{3,}/g,"\n\n").trim());
      setGenTitle(title);
      setPubTitle(title);

      // ── ⭐ [사진N] 마커 기반 정밀 배치 ──
      //   AI가 각 사진을 설명하는 문단 앞에 [사진N]을 넣음 → 그 위치에 실제 사진 블록을 꽂아
      //   글 흐름과 사진이 정확히 매칭되게 한다. (기존 균등배치는 글-사진 불일치)
      const usedPhoto = new Set<number>();
      const finalBlocks: ContentBlock[] = [];
      // 문단 단위로 쪼개되 [사진N] 마커를 경계로 처리
      const paragraphs = body2.split(/\n\n+/).map(s=>s.trim()).filter(Boolean);
      for(const para of paragraphs){
        // 문단 안의 모든 [사진N] 마커를 찾아 사진 블록으로, 나머지 텍스트는 텍스트 블록으로
        const parts = para.split(/(\[사진\d+\])/g).filter(s=>s.trim());
        for(const part of parts){
          const m = part.match(/^\[사진(\d+)\]$/);
          if(m){
            const idx = parseInt(m[1],10)-1;
            if(idx>=0 && idx<photoFiles.length && !usedPhoto.has(idx)){
              usedPhoto.add(idx);
              finalBlocks.push({type:"image",id:uid(),src:photoFiles[idx].src,alt:photoFiles[idx].name.replace(/\.[^.]+$/,"")||`사진 ${idx+1}`,position:"center",source:"manual"} as ContentBlock);
            }
          } else {
            finalBlocks.push({type:"text",id:uid(),content:part.trim()} as ContentBlock);
          }
        }
      }
      // AI가 마커를 빠뜨린 사진은 글 뒤에 순서대로 보충 (누락 방지)
      photoFiles.forEach((f,i)=>{
        if(!usedPhoto.has(i)) finalBlocks.push({type:"image",id:uid(),src:f.src,alt:f.name.replace(/\.[^.]+$/,"")||`사진 ${i+1}`,position:"center",source:"manual"} as ContentBlock);
      });

      setBlocks(finalBlocks.length>0?finalBlocks:[{type:"text",id:uid(),content:body2}]);
      if(photoFiles.length>0) setThumbnail(photoFiles[0].src);

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

  // 업로드 이미지 리사이즈: 긴 변 최대 1600px, JPEG 82% → 발행 속도↑(폰 원본 5MB→~300KB), 화질 충분
  function resizeImage(file: File, maxSide=1600, quality=0.82): Promise<string> {
    return new Promise((resolve)=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        const dataUrl=ev.target?.result as string;
        const img=new Image();
        img.onload=()=>{
          let {width,height}=img;
          if(width<=maxSide && height<=maxSide){ resolve(dataUrl); return; } // 이미 작으면 그대로
          if(width>height){ height=Math.round(height*maxSide/width); width=maxSide; }
          else { width=Math.round(width*maxSide/height); height=maxSide; }
          const canvas=document.createElement("canvas");
          canvas.width=width; canvas.height=height;
          const ctx=canvas.getContext("2d");
          if(!ctx){ resolve(dataUrl); return; }
          ctx.drawImage(img,0,0,width,height);
          try{ resolve(canvas.toDataURL("image/jpeg",quality)); }catch{ resolve(dataUrl); }
        };
        img.onerror=()=>resolve(dataUrl);
        img.src=dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function handlePhotoUpload(files: FileList|null) {
    if(!files)return;
    const arr = Array.from(files).slice(0, 20 - photoFiles.length);
    arr.forEach(async file=>{
      if(!file.type.startsWith("image/"))return;
      const src = await resizeImage(file);
      setPhotoFiles(prev=>{
        if(prev.length>=20)return prev;
        return [...prev,{id:uid(),src,name:file.name}];
      });
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
    const acc=accounts.find(a=>a.id===id);
    if(acc)await botFetch(`${BOT}/api/session/${acc.platform}/${acc.user_id}`,{method:"DELETE"}).catch(()=>{});
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
        <div className="g-step-num" style={{color:"var(--g-green)"}}>🎉 PUBLY에 오신 걸 환영해요!</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>AI가 블로그 글을 대신 써줘요</div>
        <div className="g-step-desc">키워드 하나만 입력하면 <b>제목 → 글 → 이미지 → 자동 발행</b>까지 전부 자동이에요!</div>
      </div>
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:"var(--g-yellow)"}}>📋 5단계 전체 흐름</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>이 순서대로만 하면 끝!</div>
        <div className="g-step-desc">
          {[["✍️","글쓰기 탭","키워드 입력 → 제목 선택 → 글 자동 생성"],["🖼️","이미지 탭","AI 이미지 생성 + 캡션 입력 + 영상 설정"],["🚀","발행 탭","발행 방식 선택 → 계정 선택 → 자동 발행"],["📋","기록 탭","발행된 글 목록 전체 확인"],["⚙️","설정 탭","API 키 관리 + 블로그 계정 연결"]].map(([ico,t,d],idx)=>(
            <div key={idx} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:idx<4?"1px solid var(--g-line)":"none"}}>
              <span style={{fontSize:22,flexShrink:0}}>{ico}</span>
              <div><div style={{fontWeight:800,color:"var(--g-fg)",fontSize:15}}>{t}</div><div style={{fontSize:13,color:"var(--g-fg2)",marginTop:2}}>{d}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="g-step" style={{borderColor:`${P}40`,background:`${P}08`}}>
        <div className="g-step-num" style={{color:"var(--g-pink)"}}>💰 수익화 2가지</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>무엇을 선택할까요?</div>
        <div className="g-step-desc">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:4}}>
            <div style={{padding:14,borderRadius:12,background:"rgba(3,199,90,.1)",border:"1.5px solid rgba(3,199,90,.3)"}}>
              <div style={{fontSize:15,fontWeight:900,color:"#03C75A",marginBottom:5}}>📰 애드포스트</div>
              <div style={{fontSize:13,color:"var(--g-fg2)",lineHeight:1.7}}>네이버 블로그.<br/>친근하고 감성적.<br/>처음 시작에 추천!</div>
            </div>
            <div style={{padding:14,borderRadius:12,background:"rgba(77,166,255,.1)",border:"1.5px solid rgba(77,166,255,.3)"}}>
              <div style={{fontSize:15,fontWeight:900,color:"#4da6ff",marginBottom:5}}>🔍 애드센스</div>
              <div style={{fontSize:13,color:"var(--g-fg2)",lineHeight:1.7}}>티스토리.<br/>구글 검색 노출.<br/>글자 수 더 많아요.</div>
            </div>
          </div>
        </div>
      </div>
    </div>,

    /* ── 1: API 키 ── */
    <div key="1">
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:"var(--g-yellow)"}}>⚠️ 이것부터 해야 해요!</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>API 키 없으면 글을 쓸 수 없어요</div>
        <div className="g-step-desc">API 키는 AI 서비스 이용권이에요. 아래 중 <b>하나만</b> 있으면 돼요!</div>
        <button className="g-btn" style={{background:`linear-gradient(135deg,${Y},#e0a500)`,color:"#000"}} onClick={()=>{setShowGuide(false);setTab("settings");}}>⚙️ 지금 API 키 설정하기</button>
      </div>
      {[{logo:"G",color:"#4285F4",name:"Gemini Flash",free:true,desc:"구글 AI. 완전 무료! 처음 시작하는 분께 강력 추천.",link:"https://aistudio.google.com/app/apikey"},{logo:"L",color:"#F55036",name:"Groq Llama 3",free:true,desc:"초고속 AI. 역시 무료!",link:"https://console.groq.com/keys"},{logo:"O",color:"#10A37F",name:"GPT-4o",free:false,desc:"가장 강력한 AI. 유료지만 최고 품질.",link:"https://platform.openai.com/api-keys"}].map((ai,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${ai.color}35`,background:`${ai.color}08`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <div style={{width:34,height:34,borderRadius:9,background:ai.color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:"#000",fontSize:14,flexShrink:0}}>{ai.logo}</div>
            <div><div style={{fontSize:15,fontWeight:800,color:"var(--g-fg)"}}>{ai.name}</div><span style={{fontSize:11,fontWeight:800,padding:"2px 8px",borderRadius:99,background:ai.free?"rgba(0,200,117,.15)":"rgba(245,158,11,.15)",color:ai.free?"#00c875":"#f59e0b"}}>{ai.free?"✅ 무료":"💳 유료"}</span></div>
          </div>
          <div className="g-step-desc">{ai.desc}</div>
          <div className="g-tip" style={{marginTop:8,fontSize:13}}>🔑 <a href={ai.link} target="_blank" rel="noopener noreferrer" style={{color:"var(--g-yellow)",fontWeight:700,textDecoration:"underline"}}>여기서 키 발급</a> → 로그인 → API 키 생성 → 복사 → 설정 탭 붙여넣기</div>
        </div>
      ))}
    </div>,

    /* ── 2: 글 생성 ── */
    <div key="2">
      {[
        {n:"STEP 1",i:"🎯",t:"플랫폼 + 수익화 선택",c:G,d:<>헤더에서 <b>🟢 네이버</b> 또는 <b>🟠 티스토리</b> 선택 후, 글쓰기 탭에서 애드포스트/애드센스 선택!</>},
        {n:"STEP 2",i:"🔍",t:"키워드 입력",c:Y,d:<>예: <b>"강남 맛집"</b> 입력 후 Enter 또는 버튼 클릭! 제목 30개 자동 추천!</>},
        {n:"STEP 3",i:"⭐",t:"제목 클릭해서 선택",c:P,d:<>AI가 추천한 제목 중 마음에 드는 거 클릭! 마음에 안 들면 30개 추가도 가능!</>},
        {n:"STEP 4",i:"📏",t:"글자수 설정",c:"#8B5CF6",d:<><b>🎲 자동 랜덤</b> 추천! 네이버: 1500~2000자, 체험단: 1800~2500자, 티스토리: 2000~3000자. 매번 달라서 AI 감지 방지!</>},
        {n:"STEP 5",i:"🤖",t:"글 생성 시작",c:"#F55036",d:<><b>본문 생성 시작</b> 버튼! 인트로·소제목·마무리가 매번 달라져요. 이미지는 다음 탭에서 따로!</>},
      ].map((s,i)=>(
        <div key={i} className="g-step" style={{borderColor:`${s.c}40`,background:`${s.c}08`}}>
          <div className="g-step-num" style={{color:s.c}}>{s.i} {s.n}</div>
          <div className="g-step-title" style={{color:"var(--g-fg)"}}>{s.t}</div>
          <div className="g-step-desc">{s.d}</div>
        </div>
      ))}
    </div>,

    /* ── 3: 이미지 ── */
    <div key="3">
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:"var(--g-green)"}}>🖼️ 이미지 탭 사용법</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>이미지마다 캡션을 꼭 입력해요!</div>
        <div className="g-step-desc">캡션(이미지 설명)은 네이버 상위 노출에 도움이 돼요. 자동 생성되지만 직접 수정도 가능해요.</div>
      </div>
      {[
        {t:"🤖 AI 자동 생성",d:"수량 자동추천 또는 직접 입력 (체험단 15장+ 가능). 생성 중 언제든 ⏹ 중단 가능!"},
        {t:"📁 내 이미지 업로드",d:"직접 찍은 사진이나 저장한 이미지. 여러 장 동시 업로드 가능!"},
        {t:"🚫 이미지 없이 발행",d:"텍스트만 발행할 때 선택."},
        {t:"📐 이미지 배치 패턴",d:"🎲 랜덤(권장): 매 발행마다 자동 변경 → AI 감지 방지!\nA: 썸네일 + 글 중간 배치 / B: 균등 분산 (모든 이미지 캡션 포함)"},
        {t:"🎬 영상 삽입",d:"네이버TV/유튜브 URL 입력 후 ON. 체험단 영상 필수 업체 대응! 위치(상단/중간/하단) 선택 가능."},
      ].map((item,i)=>(
        <div key={i} style={{padding:"13px 15px",borderRadius:12,background:"var(--g-surface2)",border:"1px solid var(--g-line)",marginBottom:8}}>
          <div style={{fontSize:15,fontWeight:800,color:"var(--g-fg)",marginBottom:4}}>{item.t}</div>
          <div style={{fontSize:13,color:"var(--g-fg2)",lineHeight:1.7,whiteSpace:"pre-line"}}>{item.d}</div>
        </div>
      ))}
    </div>,

    /* ── 4: 발행 ── */
    <div key="4">
      <div className="g-step" style={{borderColor:`${P}40`,background:`${P}08`}}>
        <div className="g-step-num" style={{color:"var(--g-pink)"}}>🚨 발행 전 필수 확인!</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>PC에서 Publy 앱이 실행 중이어야 해요</div>
        <div className="g-step-desc">오른쪽 패널에 <b style={{color:"var(--g-green)"}}>● 온라인</b>이 보여야 즉시 발행! 오프라인이면 자동으로 대기열에 저장돼요 😊</div>
      </div>
      <div className="g-step" style={{borderColor:`${G}40`,background:`${G}08`}}>
        <div className="g-step-num" style={{color:"var(--g-green)"}}>✅ 발행 순서 (이거 하나면 끝!)</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>순서대로만 하면 돼요</div>
        <div className="g-step-desc">
          {[["① 이미지 생성 후 발행탭 이동","이미지가 자동으로 글 사이에 배치돼요. 썸네일도 자동 설정!"],["② 오른쪽 패널에서 계정·플랫폼 선택","네이버 또는 티스토리, 연결된 계정 선택"],["③ 발행 방식 선택","전체/본문+FAQ/본문만 — 오른쪽 패널에서 선택"],["④ 🚀 발행 버튼 클릭","오른쪽 아래 큰 초록 버튼!"]].map(([t,d],i)=>(
            <div key={i} style={{display:"flex",gap:8,padding:"8px 0",borderBottom:i<3?"1px solid var(--g-line)":"none"}}>
              <div><div style={{fontSize:14,fontWeight:800,color:"var(--g-fg)"}}>{t}</div><div style={{fontSize:13,color:"var(--g-fg2)",marginTop:2}}>{d}</div></div>
            </div>
          ))}
        </div>
        <button className="g-btn" style={{background:`linear-gradient(135deg,${G},#00c870)`,color:"#000"}} onClick={()=>{setShowGuide(false);setTab("accounts");}}>🔗 계정 연결하러 가기</button>
      </div>
      <div className="g-step" style={{borderColor:`${Y}40`,background:`${Y}08`}}>
        <div className="g-step-num" style={{color:"var(--g-yellow)"}}>🖼️ 이미지+글 패턴 확인</div>
        <div className="g-step-title" style={{color:"var(--g-fg)"}}>본문 편집기에서 눈으로 확인하세요</div>
        <div className="g-step-desc">이미지와 글이 섞인 순서가 보여요. 위치가 마음에 안 들면 블록 옆 <b>🖼️ 버튼</b>으로 직접 조정!</div>
      </div>
    </div>,

    /* ── 5: FAQ ── */
    <div key="5">
      {[
        {q:"API 키가 뭐예요?",a:"AI 서비스 비밀번호예요. 처음 한 번만 설정하면 돼요! Gemini는 구글 계정만 있으면 무료 발급!",c:G},
        {q:"글이 얼마나 걸려요?",a:"보통 30초~1분이요. AI가 글을 쓰는 중이라 잠깐 기다려주세요 ☕",c:Y},
        {q:"글자수는 어떻게 정해요?",a:"🎲 자동 랜덤 추천! 네이버: 1500~2000자, 체험단/맛집: 1800~2500자, 티스토리: 2000~3000자. 직접 설정도 가능해요.",c:P},
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
          <div style={{fontSize:13,color:"var(--g-fg2)",lineHeight:1.8,whiteSpace:"pre-line"}}>👉 {item.a}</div>
        </div>
      ))}
    </div>,
  ];

  const dmDailyLimit = INSTA_DM_DAILY_LIMIT[user.plan] ?? 5;
  const dmRemaining = Math.max(0, dmDailyLimit - instaUsed);
  const dmPendingCount = dmTargets.filter(target=>target.status==="pending").length;
  const dmSendableCount = Math.min(dmPendingCount, dmRemaining);
  const dmEstimatedMinutes = dmSendableCount ? Math.ceil((dmSendableCount * 65) / 60) : 0;
  const dmCurrentStep = !dmSessionOk ? 1 : dmPendingCount===0 ? 2 : !dmMessage.trim() ? 3 : 4;

  return (
    <>
      <style>{CSS}</style>
      <div className={`app ${theme} ${fontMode==="large"?"large":""}`}>

        {/* ── 웹 접속자용 앱 설치 안내 배너 (Electron 앱에서는 안 뜸) ── */}
        <WebInstallNotice />

        {/* ── 초기 로딩 오버레이 (플리커 방지) ── */}
        {!pageReady && (
          <div style={{position:"fixed",inset:0,background:theme==="dark"?"#050a12":"#f0faf4",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
              <div style={{width:44,height:44,borderRadius:"50%",border:"3px solid rgba(0,255,136,.2)",borderTopColor:"#00ff88",animation:"spin 1s linear infinite"}}/>
              <div style={{fontSize:13,color:"var(--text3)",fontWeight:600}}>불러오는 중...</div>
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* ── 만료/발행 알림 팝업 ── */}
        {/* ── 재연결 비밀번호 입력 모달 (window.prompt 대체) ── */}
        {pwPrompt&&(
          <div style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
            onClick={()=>{ pwPromptResolve.current?.(null); pwPromptResolve.current=null; setPwPrompt(null); }}>
            <div style={{width:"100%",maxWidth:400,borderRadius:20,background:"var(--card)",border:"1px solid var(--accent-border)",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
              <div style={{padding:"18px 22px 14px",background:"linear-gradient(135deg,var(--accent),#00cc80)",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:24}}>🔒</span>
                <div><div style={{fontSize:16,fontWeight:900,color:"#000"}}>세션이 만료되었어요</div>
                <div style={{fontSize:12,color:"rgba(0,0,0,.7)",marginTop:2}}>{pwPrompt.acc.platform==="naver"?"네이버":"티스토리"} 비밀번호를 다시 입력해주세요</div></div>
              </div>
              <div style={{padding:"20px 22px"}}>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:6}}>계정: <b style={{color:"var(--text)"}}>{pwPrompt.acc.username}</b></div>
                <input type="password" autoFocus className="inp" placeholder="비밀번호" value={pwPrompt.value}
                  onChange={e=>setPwPrompt(p=>p?{...p,value:e.target.value}:p)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&pwPrompt.value){ pwPromptResolve.current?.(pwPrompt.value); pwPromptResolve.current=null; setPwPrompt(null); } }}
                  style={{fontSize:14,padding:"12px 14px",marginBottom:14}}/>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{ pwPromptResolve.current?.(null); pwPromptResolve.current=null; setPwPrompt(null); }}
                    style={{flex:1,padding:"11px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>취소</button>
                  <button disabled={!pwPrompt.value} onClick={()=>{ pwPromptResolve.current?.(pwPrompt.value); pwPromptResolve.current=null; setPwPrompt(null); }}
                    style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:pwPrompt.value?"var(--accent)":"var(--border)",color:pwPrompt.value?"#000":"var(--text3)",cursor:pwPrompt.value?"pointer":"not-allowed",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>🔗 재연결</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {alertPopup&&(
          <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setAlertPopup(null)}>
            <div style={{width:"100%",maxWidth:400,borderRadius:20,background:"var(--card)",border:`1px solid ${alertPopup.type==="expire"?"rgba(255,83,99,.4)":"rgba(255,159,63,.4)"}`,overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
              {/* 헤더 */}
              <div style={{padding:"18px 22px 16px",background:alertPopup.type==="expire"?"linear-gradient(135deg,#ff5363,#ff3366)":"linear-gradient(135deg,#ff9f3f,#ff6600)",display:"flex",alignItems:"center",gap:12}}>
                <div style={{fontSize:28}}>{alertPopup.type==="expire"?"⏰":"📊"}</div>
                <div>
                  <div style={{fontSize:16,fontWeight:900,color:"var(--g-fg)"}}>
                    {alertPopup.type==="expire"
                      ? alertPopup.daysLeft===0 ? "오늘 만료됩니다!" : alertPopup.daysLeft! < 0 ? "서비스가 만료됐습니다!" : `만료 ${alertPopup.daysLeft}일 전`
                      : "오늘 발행 한도가 얼마 안 남았어요"}
                  </div>
                  <div style={{fontSize:12,color:"var(--g-fg2)",marginTop:2}}>
                    {alertPopup.type==="expire" ? "서비스 이용을 위해 갱신해주세요" : "추가 발행이 필요하면 플랜을 업그레이드하세요"}
                  </div>
                </div>
              </div>
              {/* 내용 */}
              <div style={{padding:"18px 22px"}}>
                {alertPopup.type==="expire" ? (
                  <div style={{fontSize:14,color:"var(--text)",lineHeight:1.8}}>
                    {alertPopup.daysLeft! < 0
                      ? "서비스가 만료됐습니다. 갱신 후 이용 가능합니다."
                      : alertPopup.daysLeft===0
                      ? "오늘 자정에 서비스가 만료됩니다."
                      : `${alertPopup.daysLeft}일 후 서비스가 만료됩니다.`}
                    <br/>만료 후에는 <strong>모든 기능이 정지</strong>됩니다.
                  </div>
                ) : (
                  <div style={{fontSize:14,color:"var(--text)",lineHeight:1.8}}>
                    오늘 <strong>{alertPopup.used}개</strong> {alertPopup.type==="insta"?"발송":"발행"} 완료 / 한도 <strong>{alertPopup.limit}개</strong>
                    <br/>남은 {alertPopup.type==="insta"?"발송":"발행"} 수: <strong style={{color:"var(--warn)"}}>{(alertPopup.limit||0)-(alertPopup.used||0)}개</strong>
                    <div style={{marginTop:10,height:6,borderRadius:99,background:"var(--border)",overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:99,width:`${Math.min(100,((alertPopup.used||0)/(alertPopup.limit||1))*100)}%`,background:"linear-gradient(90deg,#ff9f3f,#ff6600)",transition:"width .4s"}}/>
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:8,marginTop:16}}>
                  <button onClick={()=>setAlertPopup(null)}
                    style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text2)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                    닫기
                  </button>
                  <a href="https://open.kakao.com/o/s0lQ66wi" target="_blank" rel="noopener noreferrer"
                    onClick={()=>setAlertPopup(null)}
                    style={{flex:2,padding:"10px",borderRadius:10,border:"none",background:alertPopup.type==="expire"?"linear-gradient(135deg,#ff5363,#ff3366)":"linear-gradient(135deg,#ff9f3f,#ff6600)",color:"var(--g-fg)",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",textDecoration:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                    💬 {alertPopup.type==="expire" ? "카카오로 갱신 문의" : "카카오로 업그레이드 문의"}
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

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
                <button className="guide-nav-btn" style={{borderColor:"var(--g-line)",background:"transparent",color:"var(--g-fg2)"}} onClick={()=>setGuideTab(Math.max(0,guideTab-1))} disabled={guideTab===0}>← 이전</button>
                <span className="guide-page">{guideTab+1} / {guideTabs.length}</span>
                {guideTab<guideTabs.length-1?<button className="guide-nav-btn" style={{borderColor:Y,background:`${Y}15`,color:"var(--g-yellow)"}} onClick={()=>setGuideTab(guideTab+1)}>다음 →</button>:<button className="guide-nav-btn" style={{borderColor:G,background:`${G}15`,color:"var(--g-green)"}} onClick={()=>{localStorage.setItem("publy_guide_seen","1");setShowGuide(false);}}>✅ 시작하기!</button>}
              </div>
            </div>
          </div>
        )}



        {/* ── 헤더 ── */}
        <div className="header">
          <button className="logo" type="button" onClick={handleLogoTap} aria-label="퍼블리 로고" style={{background:"transparent",border:0,cursor:"pointer",fontFamily:"inherit"}}>
            <div className="logo-ico" style={{fontSize:17,fontWeight:900,color:"#000"}}>P</div>
            <span className="logo-text">PUBLY</span>
          </button>
          {appVersion&&<span style={{fontSize:10.5,color:"var(--text3)",fontWeight:600,whiteSpace:"nowrap"}}>{appVersion.startsWith("v")?appVersion:`v${appVersion}`}</span>}
          <div className="header-mid">
            <button className={`plat-btn ${platform==="naver"?"plat-btn-naver":"plat-btn-naver-off"}`} onClick={()=>setPlatform("naver")}>🟢 네이버</button>
            <button className={`plat-btn ${platform==="tistory"?"plat-btn-tistory":"plat-btn-tistory-off"}`} onClick={()=>setPlatform("tistory")}>🟠 티스토리</button>
            <div style={{width:1,height:16,background:"var(--border)",flexShrink:0}}/>
            <div className={`server-chip ${botOnline?"server-on":"server-off"}`}><div className={`dot ${botOnline?"dot-on":"dot-off"}`}/>{botOnline?"서버 온라인":"서버 오프라인"}</div>
            {(["unlimited","admin"] as string[]).includes(user.plan)
              ? <div className="quota-chip"><div className="quota-bar-bg"><div className="quota-bar-fill" style={{width:"100%"}}/></div>무제한<span className={`plan-badge plan-${user.plan}`}>{PLAN_LABELS[user.plan]}</span></div>
              : <div className="quota-chip"><div className="quota-bar-bg"><div className="quota-bar-fill" style={{width:`${Math.min(100,(dailyPublishUsed/(PLAN_CONFIG[user.plan]?.dailyPublish??2))*100)}%`}}/></div>{Math.max(0,(PLAN_CONFIG[user.plan]?.dailyPublish??2)-dailyPublishUsed)}건<span className={`plan-badge plan-${user.plan}`}>{PLAN_LABELS[user.plan]}</span></div>}
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
            {NAV_GROUPS.map(group=>(
              <div key={group.label}>
                <div className="nav-lbl">{group.label}</div>
                {group.tabs.map(t=>(
                  <button key={t.k} className={`nav-item ${tab===t.k?"active":""}`} onClick={()=>{if(t.k==="rank"){window.open("https://rank.xn--zk5biyyw.com/","_blank");return;}setTab(t.k);}}>
                    <span className="nav-ico">{t.i}</span>{t.l}
                    {t.k==="keyword"&&titles.length>0&&<span className="nav-badge">{titles.length}</span>}
                    {t.k==="manage"&&history.length>0&&<span className="nav-badge">{history.length}</span>}
                    {t.k==="neighbor"&&<span className="nav-badge">{neighborUsed}</span>}
                    {t.k==="engage"&&<span className="nav-badge">{engageUsed}</span>}
                    {t.k==="insta_dm"&&<span className="nav-badge">{instaUsed}</span>}
                  </button>
                ))}
              </div>
            ))}
            <div className="sidebar-foot">
              <div className="stat-card">
                {(["unlimited","admin"] as string[]).includes(user.plan)
                  ? <div className="stat-num" style={{color:"var(--text)"}}>{dailyPublishUsed}<span style={{fontSize:12,color:"var(--text3)",fontWeight:500}}> · 무제한</span></div>
                  : <div className="stat-num" style={{color: dailyPublishUsed >= (PLAN_CONFIG[user.plan]?.dailyPublish ?? 2) ? "var(--danger)" : "var(--text)"}}>
                      {dailyPublishUsed}<span style={{fontSize:12,color:"var(--text3)",fontWeight:500}}>/{PLAN_CONFIG[user.plan]?.dailyPublish ?? 2}</span>
                    </div>}
                <div className="stat-lbl">오늘 발행</div>
              </div>
              <div className="stat-card" style={{background:"var(--accent-bg)",borderColor:"var(--accent-border)"}}>
                <div className="stat-num" style={{fontSize:18,color:"var(--accent-text)"}}>{formatDaysLeft(quota?.reset_date)}</div>
                <div className="stat-lbl">만료일 {quota ? new Date(quota.reset_date).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}) : "—"}</div>
              </div>
            </div>
          </div>

          <div className="main">

            {/* ── 사용한도 + 만료일 상태바 (항상 표시) ── */}
            {(()=>{
              const plan = user.plan;
              const config = PLAN_CONFIG[plan] ?? PLAN_CONFIG.free;
              const publishLimit = config.dailyPublish;
              const neighborLimit = NEIGHBOR_DAILY_LIMIT[plan] ?? 10;
              const engageLimit = ENGAGE_DAILY_LIMIT[plan] ?? 10;
              const instaLimit = INSTA_DM_DAILY_LIMIT[plan] ?? 5;
              const expiry = quota ? new Date(quota.reset_date) : null;
              const daysLeft = quota ? daysUntil(quota.reset_date) : null;
              const dColor = daysLeft === null ? "var(--text3)" : daysLeft <= 3 ? "var(--danger)" : daysLeft <= 7 ? "#ff9f3f" : "var(--success)";
              const items = [
                { label:"✍️ 글쓰기", used: dailyPublishUsed, limit: publishLimit, color:"var(--accent)" },
                { label:"🤝 서이추", used: neighborUsed, limit: neighborLimit, color:"#00c8ff" },
                { label:"❤️ 공감·댓글", used: engageUsed, limit: engageLimit, color:"#ff6b9d" },
                { label:"📱 인스타DM", used: instaUsed, limit: instaLimit, color:"#FF6B9D" },
              ];
              return (
                <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                  {items.map(({label,used,limit,color})=>{
                    const unlimited = limit>=99999 || (["unlimited","admin"] as string[]).includes(plan);
                    const pct = unlimited ? 100 : Math.min(100, (used/limit)*100);
                    const over = !unlimited && used >= limit;
                    return (
                      <div key={label} style={{flex:1,minWidth:120,padding:"10px 14px",borderRadius:14,background:"var(--card)",border:`1px solid ${over?"rgba(255,83,99,.4)":"var(--border)"}`,transition:"border .2s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <span style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>{label}</span>
                          <span style={{fontSize:12,fontWeight:800,color:over?"var(--danger)":color}}>{used}<span style={{fontSize:11,color:"var(--text3)",fontWeight:500}}>{unlimited?" · 무제한":`/${limit}`}</span></span>
                        </div>
                        <div style={{height:5,borderRadius:99,background:"var(--border)",overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:99,width:`${pct}%`,background:over?"var(--danger)":color,transition:"width .4s"}}/>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{padding:"10px 16px",borderRadius:14,background:"var(--card)",border:`1px solid ${daysLeft!==null&&daysLeft<=3?"rgba(255,83,99,.4)":daysLeft!==null&&daysLeft<=7?"rgba(255,159,63,.3)":"var(--border)"}`,whiteSpace:"nowrap"}}>
                    <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,marginBottom:3}}>📅 만료일</div>
                    <div style={{fontSize:13,fontWeight:800,color:dColor}}>{expiry?expiry.toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}):"—"}</div>
                    <div style={{fontSize:11,color:dColor,fontWeight:600,marginTop:1}}>{formatDaysLeft(quota?.reset_date)}</div>
                  </div>
                </div>
              );
            })()}
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
                <div className="card" style={{borderColor:onPartnerItems.length>0?"rgba(190,255,0,.38)":undefined}}>
                  <div className="card-title" style={{marginBottom:6}}>🌱 온파트너 상품 링크 <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>({onPartnerItems.length}/{MAX_ONPARTNER})</span></div>
                  <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6,marginBottom:10}}>링크 넣고 <b>조회</b> → <b>저장</b>을 <b>최대 {MAX_ONPARTNER}개까지</b> 반복하면, 각 상품 링크가 본문에 자동 삽입돼요(네이버 상품 카드로 표시, Q&A·해시태그 위).</div>
                  {onPartnerItems.length<MAX_ONPARTNER&&(
                    <div style={{display:"flex",gap:7,alignItems:"stretch"}}>
                      <input className="inp" value={onPartnerLink} onChange={e=>{setOnPartnerLink(e.target.value);setOnPartnerError("");setOnPartnerPreview(null);}} onKeyDown={e=>e.key==="Enter"&&loadOnPartnerProduct()} placeholder="https://partner.yuanfnb.com/r/추천코드" style={{flex:1,minWidth:0}}/>
                      <button className="btn btn-secondary" onClick={loadOnPartnerProduct} disabled={onPartnerLoading} style={{flexShrink:0}}>{onPartnerLoading?<><span className="spinner"/>조회 중</>:"🔍 조회"}</button>
                    </div>
                  )}
                  {onPartnerError&&<div style={{fontSize:11,color:"var(--danger)",marginTop:7}}>⚠️ {onPartnerError}</div>}

                  {/* 조회된 상품 미리보기 (아직 추가 전) — 여기서 '추가' 눌러야 목록에 담김 */}
                  {onPartnerPreview&&(
                    <div style={{marginTop:12,padding:10,borderRadius:11,background:"var(--accent-bg)",border:"1.5px solid var(--accent-border)"}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        {onPartnerPreview.product.image?<img src={onPartnerPreview.product.image} alt={onPartnerPreview.product.name} style={{width:56,height:56,borderRadius:9,objectFit:"cover",flexShrink:0}}/>:<div style={{width:56,height:56,borderRadius:9,background:"var(--bg2)",display:"grid",placeItems:"center",fontSize:22,flexShrink:0}}>🌱</div>}
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{onPartnerPreview.product.name}</div>
                          <div style={{fontSize:12,fontWeight:800,color:"var(--accent-text)",marginTop:3}}>{onPartnerPreview.product.price?`${onPartnerPreview.product.price.toLocaleString("ko-KR")}원`:"가격은 상품 페이지에서 확인"}</div>
                          <div style={{fontSize:10,color:onPartnerPreview.product.available?"var(--success)":"var(--danger)",marginTop:3}}>{onPartnerPreview.product.available?"● 판매 중":"● 현재 판매 중지"}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:7,marginTop:10}}>
                        <button className="btn btn-primary" onClick={addOnPartnerProduct} style={{flex:1,justifyContent:"center"}}>💾 저장 (목록에 추가)</button>
                        <button className="btn btn-secondary" onClick={()=>{setOnPartnerPreview(null);setOnPartnerLink("");}} style={{flexShrink:0}}>취소</button>
                      </div>
                    </div>
                  )}

                  {/* 추가된 상품 목록 (최대 3) — 컴팩트 한 줄 (배너는 작은 썸네일) */}
                  {onPartnerItems.map((it,idx)=>(
                    <div key={it.product.partnerUrl||idx} style={{marginTop:8,padding:"8px 10px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:11,fontWeight:800,color:"var(--accent-text)",flexShrink:0}}>{idx+1}</span>
                      {it.product.image?<img src={it.product.image} alt={it.product.name} style={{width:50,height:50,borderRadius:7,objectFit:"cover",flexShrink:0}}/>:<div style={{width:50,height:50,borderRadius:7,background:"var(--bg2)",display:"grid",placeItems:"center",fontSize:20,flexShrink:0}}>🌱</div>}
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:12.5,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{it.product.name}</div>
                        <div style={{fontSize:11,fontWeight:800,color:"var(--accent-text)",marginTop:2}}>{it.product.price?`${it.product.price.toLocaleString("ko-KR")}원`:"가격 상품페이지 확인"}<span style={{fontSize:9,color:"var(--text3)",fontWeight:600,marginLeft:6}}>· 링크 자동삽입</span></div>
                      </div>
                      <button type="button" onClick={()=>setOnPartnerItems(prev=>prev.filter((_,i)=>i!==idx))} title="빼기" style={{border:0,background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:15,flexShrink:0}}>✕</button>
                    </div>
                  ))}

                  {onPartnerItems.length>0&&onPartnerItems.length===1&&(
                    <div style={{marginTop:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                      <b style={{fontSize:11,color:"var(--text2)"}}>📍 배너 위치</b>
                      <select className="inp" value={onPartnerPlacement} onChange={e=>{const v=e.target.value as OnPartnerPlacement;setOnPartnerPlacement(v);localStorage.setItem("publy_onpartner_placement",v)}} style={{width:"min(200px,100%)",padding:"6px 9px",fontSize:11}}>
                        {Object.entries(ONPARTNER_PLACEMENT_INFO).map(([value,info])=><option key={value} value={value}>{info.label}</option>)}
                      </select>
                    </div>
                  )}
                  {onPartnerItems.length>1&&<div style={{marginTop:8,color:"var(--accent-text)",fontSize:10,fontWeight:800}}>본문에 골고루 분산 배치돼요 (Q&A·해시태그 위).</div>}
                </div>

                {/* ── 내 링크 (일반 사이트) — 온파트너와 별도, OG 썸네일 카드로 자동 배치 ── */}
                <div className="card" style={{borderColor:myLinks.length>0?"rgba(0,150,255,.35)":undefined}}>
                  <div className="card-title" style={{marginBottom:6}}>🔗 내 링크 넣기 <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>({myLinks.length}/{MAX_MYLINK})</span></div>
                  <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6,marginBottom:10}}>내 사이트·블로그 등 <b>아무 링크</b>나 넣고 <b>추가</b>하면, 발행 시 이미지 바로 밑에 <b>썸네일 카드(OG)</b>로 자동 배치돼요. 온파트너와 안 섞여요. (최대 {MAX_MYLINK}개)</div>
                  {myLinks.length<MAX_MYLINK&&(
                    <div style={{display:"flex",gap:7,alignItems:"stretch"}}>
                      <input className="inp" value={myLinkInput} onChange={e=>{setMyLinkInput(e.target.value);setMyLinkError("");}} onKeyDown={e=>e.key==="Enter"&&addMyLink()} placeholder="https://내사이트.com  (또는 pick.온종일.com)" style={{flex:1,minWidth:0}}/>
                      <button className="btn btn-secondary" onClick={addMyLink} style={{flexShrink:0}}>＋ 추가</button>
                    </div>
                  )}
                  {myLinkError&&<div style={{fontSize:11,color:"var(--danger)",marginTop:7}}>⚠️ {myLinkError}</div>}
                  {myLinks.map((url,idx)=>(
                    <div key={url} style={{marginTop:8,padding:"9px 11px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:14,flexShrink:0}}>🔗</span>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:12.5,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{url.replace(/^https?:\/\//,"")}</div>
                        <div style={{fontSize:10,color:"var(--text3)",fontWeight:600,marginTop:2}}>발행 시 썸네일 카드로 자동 삽입</div>
                      </div>
                      <button type="button" onClick={()=>setMyLinks(prev=>prev.filter((_,i)=>i!==idx))} title="빼기" style={{border:0,background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:15,flexShrink:0}}>✕</button>
                    </div>
                  ))}
                  {myLinks.length>1&&<div style={{marginTop:8,color:"#0096ff",fontSize:10,fontWeight:800}}>본문 이미지 밑에 골고루 배치돼요 (Q&A·해시태그 위).</div>}
                </div>

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

                {/* 임시저장 불러오기 배너 */}
                {draftAvailable&&draftData&&!genContent&&(
                  <div style={{padding:"12px 16px",borderRadius:12,background:"rgba(0,200,120,.1)",border:"1px solid rgba(0,200,120,.3)",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:"var(--success)"}}>📝 임시저장된 글이 있어요</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{draftData.savedAt} · {draftData.title}</div>
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      <button onClick={()=>{
                        setGenContent(draftData.content);
                        setPubTitle(draftData.title);
                        setGenTitle(draftData.title);
                        const rawBlocks=draftData.content.split("\n\n").filter(Boolean).map(p=>({type:"text" as const,id:uid(),content:p}));
                        setBlocks(rawBlocks.length>0?rawBlocks:[{type:"text",id:uid(),content:draftData.content}]);
                        setDraftAvailable(false);
                        showToast("✅ 임시저장 불러오기 완료","success");
                      }} style={{padding:"5px 12px",borderRadius:8,background:"var(--success)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>불러오기</button>
                      <button onClick={()=>{localStorage.removeItem("publy_draft");setDraftAvailable(false);setDraftData(null);}} style={{padding:"5px 10px",borderRadius:8,background:"var(--bg2)",color:"var(--text3)",border:"1px solid var(--border)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>삭제</button>
                    </div>
                  </div>
                )}

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
                    {/* 템플릿 기능설명 */}
                    <div style={{marginTop:8,padding:"10px 12px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",fontSize:12,color:"var(--text2)",lineHeight:1.6}}>
                      💡 <b>템플릿이란?</b> 글의 <b>구성 순서(뼈대)</b>를 미리 잡아주는 도우미예요.
                      {blogTemplate!=="none"?(
                        <><br/><span style={{color:"var(--text3)"}}>지금은 <b style={{color:"var(--accent-text)"}}>{BLOG_TEMPLATES.find(t=>t.id===blogTemplate)?.label}</b> 순서로 짜임새 있게 써줘요. (스타일·말투도 자동으로 맞춰졌어요)</span></>
                      ):(
                        <><br/><span style={{color:"var(--text3)"}}><b>필수는 아니에요.</b> 안 골라도(=템플릿 없음) 아래 스타일·말투대로 글은 정상 생성돼요.</span></>
                      )}
                    </div>
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
                          {platform==="tistory"?"티스토리: 2000~3000자":adType==="adpost"&&/체험단|맛집|후기|리뷰/.test(keyword)?"체험단/맛집: 1800~2500자":"네이버: 1500~2000자"}
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

                    {/* ── Flow 준비 안내 (Flow 선택 시) ── */}
                    {imgGenType==="flow"&&(
                      <div style={{marginBottom:14,padding:"14px 16px",borderRadius:14,background:flowReady?"rgba(0,200,120,.08)":"rgba(168,85,247,.08)",border:`1.5px solid ${flowReady?"rgba(0,200,120,.4)":"rgba(168,85,247,.35)"}`}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:22}}>{flowReady?"✅":"🎨"}</span>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13.5,fontWeight:800,color:flowReady?"var(--success)":"#c084fc"}}>
                              {flowReady?"Flow 준비 완료! 바로 생성하세요":"Flow 이미지는 먼저 '준비'가 필요해요"}
                            </div>
                            <div style={{fontSize:11.5,color:"var(--text3)",marginTop:3,lineHeight:1.5}}>
                              {flowReady?"이제 아래 '이미지 생성 시작'을 누르면 무료로 이미지가 생성돼요":"버튼을 누르면 크롬이 열려요 → Google 로그인 1회만 하면 계속 자동으로 써요"}
                            </div>
                          </div>
                          {!flowReady&&(
                            <button onClick={handleFlowLaunchChrome} disabled={flowLaunching}
                              style={{padding:"10px 18px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",cursor:flowLaunching?"wait":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0,opacity:flowLaunching?.7:1}}>
                              {flowLaunching?"준비 중...":"🚀 Flow 준비"}
                            </button>
                          )}
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

                {/* ── 이미지 생성 방식 스위치 ── */}
                <div style={{marginBottom:16,padding:"20px 24px",borderRadius:20,background:"linear-gradient(135deg,rgba(99,102,241,.12),rgba(168,85,247,.12))",border:"1.5px solid rgba(168,85,247,.25)",boxShadow:"0 8px 32px rgba(99,102,241,.15)",animation:"float 3s ease-in-out infinite"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                    <div>
                      <div style={{fontSize:15,fontWeight:900,color:"var(--text)"}}>🖼️ 이미지 생성 방식</div>
                      <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>원하는 방식을 선택하세요</div>
                    </div>
                    <button onClick={()=>setShowFlowGuide(true)}
                      style={{padding:"6px 14px",borderRadius:99,border:"1px solid rgba(168,85,247,.4)",background:"rgba(168,85,247,.1)",color:"#a855f7",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                      ❓ Flow란?
                    </button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {/* AI 이미지 */}
                    <button onClick={()=>{setImgGenType("ai");localStorage.setItem("publy_img_gen_type","ai");}}
                      style={{padding:"16px 14px",borderRadius:16,border:`2px solid ${imgGenType==="ai"?"#6366f1":"var(--border)"}`,background:imgGenType==="ai"?"linear-gradient(135deg,rgba(99,102,241,.18),rgba(99,102,241,.06))":"var(--card)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .2s",boxShadow:imgGenType==="ai"?"0 4px 20px rgba(99,102,241,.25)":"none"}}>
                      <div style={{fontSize:28,marginBottom:6}}>🤖</div>
                      <div style={{fontSize:14,fontWeight:900,color:imgGenType==="ai"?"#818cf8":"var(--text)",marginBottom:4}}>AI 이미지</div>
                      <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5}}>DALL-E · Flux<br/>API 키 필요</div>
                      {imgGenType==="ai"&&<div style={{marginTop:8,fontSize:10,fontWeight:800,color:"#818cf8",background:"rgba(99,102,241,.15)",padding:"3px 8px",borderRadius:99,display:"inline-block"}}>✓ 선택됨</div>}
                    </button>
                    {/* Flow 이미지 */}
                    <button onClick={()=>{setImgGenType("flow");localStorage.setItem("publy_img_gen_type","flow");}}
                      style={{padding:"16px 14px",borderRadius:16,border:`2px solid ${imgGenType==="flow"?"#a855f7":"var(--border)"}`,background:imgGenType==="flow"?"linear-gradient(135deg,rgba(168,85,247,.18),rgba(168,85,247,.06))":"var(--card)",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .2s",boxShadow:imgGenType==="flow"?"0 4px 20px rgba(168,85,247,.25)":"none",position:"relative",overflow:"hidden"}}>
                      <div style={{position:"absolute",top:8,right:10,fontSize:10,fontWeight:800,color:"#fff",background:"linear-gradient(135deg,#a855f7,#7c3aed)",padding:"2px 8px",borderRadius:99}}>FREE</div>
                      <div style={{fontSize:28,marginBottom:6}}>🎨</div>
                      <div style={{fontSize:14,fontWeight:900,color:imgGenType==="flow"?"#c084fc":"var(--text)",marginBottom:4}}>Flow 이미지</div>
                      <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5}}>Google Flow<br/>무료 · 고퀄리티</div>
                      {imgGenType==="flow"&&<div style={{marginTop:8,fontSize:10,fontWeight:800,color:"#c084fc",background:"rgba(168,85,247,.15)",padding:"3px 8px",borderRadius:99,display:"inline-block"}}>✓ 선택됨</div>}
                    </button>
                  </div>
                </div>

                {/* ── Flow 가이드 팝업 ── */}
                {showFlowGuide&&(
                  <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"60px 20px 20px",overflowY:"auto"}} onClick={()=>setShowFlowGuide(false)}>
                    <div style={{width:"100%",maxWidth:520,borderRadius:24,background:"var(--card)",border:"1px solid rgba(168,85,247,.3)",overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.6)"}} onClick={e=>e.stopPropagation()}>
                      {/* 헤더 */}
                      <div style={{padding:"20px 24px 16px",background:"linear-gradient(135deg,#7c3aed,#a855f7)",display:"flex",alignItems:"center",gap:12}}>
                        <div style={{fontSize:32}}>🎨</div>
                        <div>
                          <div style={{fontSize:17,fontWeight:900,color:"#fff"}}>Google Flow 이미지란?</div>
                          <div style={{fontSize:12,color:"rgba(255,255,255,.8)",marginTop:2}}>무료 고퀄리티 AI 이미지 생성</div>
                        </div>
                        <button onClick={()=>setShowFlowGuide(false)}
                          style={{marginLeft:"auto",width:28,height:28,borderRadius:8,border:"none",background:"rgba(255,255,255,.2)",color:"#fff",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
                      </div>

                      <div style={{padding:"18px 24px"}}>
                        {/* 회원가입 + 설정 버튼 */}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                          <a href="https://accounts.google.com/signup" target="_blank" rel="noreferrer"
                            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"14px 12px",borderRadius:14,border:"1.5px solid rgba(168,85,247,.3)",background:"linear-gradient(135deg,rgba(168,85,247,.12),rgba(99,102,241,.08))",textDecoration:"none",transition:"all .2s",cursor:"pointer"}}>
                            <span style={{fontSize:24}}>👤</span>
                            <span style={{fontSize:13,fontWeight:800,color:"#c084fc"}}>구글 회원가입</span>
                            <span style={{fontSize:10,color:"var(--text3)",textAlign:"center"}}>구글 계정이 없다면<br/>먼저 가입하세요</span>
                          </a>
                          <a href="https://labs.google/fx/ko/tools/image-fx" target="_blank" rel="noreferrer"
                            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"14px 12px",borderRadius:14,border:"1.5px solid rgba(0,214,143,.3)",background:"linear-gradient(135deg,rgba(0,214,143,.12),rgba(0,214,143,.04))",textDecoration:"none",transition:"all .2s",cursor:"pointer"}}>
                            <span style={{fontSize:24}}>🔗</span>
                            <span style={{fontSize:13,fontWeight:800,color:"var(--success)"}}>Flow 설정하기</span>
                            <span style={{fontSize:10,color:"var(--text3)",textAlign:"center"}}>클릭 후 구글 로그인<br/>한 번만 하면 완료!</span>
                          </a>
                        </div>

                      {/* 동작 방식 */}
                        <div style={{marginBottom:12,padding:"12px 14px",borderRadius:12,background:"rgba(99,102,241,.08)",border:"1px solid rgba(99,102,241,.2)"}}>
                          <div style={{fontSize:13,fontWeight:800,color:"#818cf8",marginBottom:8}}>🚀 동작 방식</div>
                          <div style={{fontSize:12,color:"var(--text)",lineHeight:2}}>
                            ① 이미지 탭에서 <strong style={{color:"#c084fc"}}>Flow 이미지</strong> 선택<br/>
                            ② 글 생성 후 이미지 수 자동 추천 (500자당 1장)<br/>
                            ③ 발행하기 탭에서 🚀 발행 버튼 클릭<br/>
                            ④ 크롬이 자동으로 열려 Google Flow 접속<br/>
                            ⑤ 글 제목 기반 영문 프롬프트 자동 입력<br/>
                            ⑥ 이미지 생성 완료 → 자동 다운로드<br/>
                            ⑦ 글 패턴에 맞게 자동 삽입 후 발행
                          </div>
                        </div>

                        {/* 이미지 수 안내 */}
                        <div style={{marginBottom:12,padding:"12px 14px",borderRadius:12,background:"rgba(168,85,247,.08)",border:"1px solid rgba(168,85,247,.2)"}}>
                          <div style={{fontSize:13,fontWeight:800,color:"#c084fc",marginBottom:8}}>📸 이미지 수 설정</div>
                          <div style={{fontSize:12,color:"var(--text)",lineHeight:2}}>
                            <strong style={{color:"#c084fc"}}>🤖 자동추천</strong> — 글자 수 기준 500자당 1장<br/>
                            예) 1,500자 → 3장 / 2,000자 → 4장<br/>
                            <strong style={{color:"#c084fc"}}>✏️ 직접입력</strong> — 원하는 수량 직접 설정 가능
                          </div>
                        </div>

                        {/* 주의사항 */}
                        <div style={{marginBottom:16,padding:"12px 14px",borderRadius:12,background:"rgba(255,159,63,.08)",border:"1px solid rgba(255,159,63,.2)"}}>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--warn)",marginBottom:8}}>⚠️ 주의사항</div>
                          <div style={{fontSize:12,color:"var(--text)",lineHeight:2}}>
                            장시간 미사용 시 구글 재로그인 필요<br/>
                            발행 시 크롬 창이 자동으로 열립니다<br/>
                            크롬 창을 닫거나 조작하지 마세요
                          </div>
                        </div>

                        <button onClick={()=>setShowFlowGuide(false)}
                          style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#7c3aed,#a855f7)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>
                          확인했어요!
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Flow 선택 시 UI ── */}
                {imgGenType==="flow"&&(
                  <div style={{marginBottom:14,animation:"fadeUp .2s ease both"}}>
                    <div className="card" style={{padding:"20px 22px",border:"1.5px solid rgba(168,85,247,.25)",background:"linear-gradient(135deg,rgba(168,85,247,.06),rgba(99,102,241,.04))"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                        <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,#7c3aed,#a855f7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🎨</div>
                        <div>
                          <div style={{fontSize:15,fontWeight:900,color:"var(--text)"}}>Google Flow 자동 생성</div>
                          <div style={{fontSize:12,color:"var(--text3)"}}>발행 시 크롬이 자동으로 열려 이미지를 생성합니다</div>
                        </div>
                      </div>

                      {/* 생성할 이미지 수 */}
                      <div style={{marginBottom:16}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:8}}>📸 생성할 이미지 수</div>
                        <div style={{display:"flex",gap:6,marginBottom:8}}>
                          <button onClick={()=>{flowImgCountAutoRef.current=true;setFlowImgCountAuto(true);if(genContent)setFlowImgCount(recommendImgCount(genContent));}}
                            style={{flex:1,padding:"8px",borderRadius:9,border:`1.5px solid ${flowImgCountAuto?"#a855f7":"var(--border)"}`,background:flowImgCountAuto?"rgba(168,85,247,.15)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:flowImgCountAuto?"#c084fc":"var(--text2)",fontFamily:"inherit"}}>
                            🤖 자동추천
                          </button>
                          <button onClick={()=>{flowImgCountAutoRef.current=false;setFlowImgCountAuto(false);}}
                            style={{flex:1,padding:"8px",borderRadius:9,border:`1.5px solid ${!flowImgCountAuto?"#a855f7":"var(--border)"}`,background:!flowImgCountAuto?"rgba(168,85,247,.15)":"transparent",cursor:"pointer",fontSize:12,fontWeight:700,color:!flowImgCountAuto?"#c084fc":"var(--text2)",fontFamily:"inherit"}}>
                            ✏️ 직접입력
                          </button>
                        </div>

                        {flowImgCountAuto ? (
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,background:"rgba(168,85,247,.1)",border:"1px solid rgba(168,85,247,.25)"}}>
                            <span style={{fontSize:12,color:"#c084fc",fontWeight:600}}>💡 글자 수 기반 자동 추천 (500자당 1장)</span>
                            <span style={{fontSize:24,fontWeight:900,color:"#c084fc",fontFamily:"'Space Grotesk',sans-serif"}}>{flowImgCount}장</span>
                          </div>
                        ) : (
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <button onClick={()=>{flowImgCountAutoRef.current=false;setFlowImgCountAuto(false);setFlowImgCount(v=>{const nv=Math.max(1,v-1);showToast(`✅ 이미지 ${nv}장으로 설정됐어요`,"success");return nv;});}}
                              style={{width:40,height:40,borderRadius:9,border:"2px solid #a855f7",background:"rgba(168,85,247,.18)",cursor:"pointer",fontSize:22,fontWeight:900,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#c084fc",transition:"transform .08s"}} onMouseDown={e=>e.currentTarget.style.transform="scale(.9)"} onMouseUp={e=>e.currentTarget.style.transform="scale(1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>−</button>
                            <input type="number" min={1} max={10} value={flowImgCount}
                              onChange={e=>{flowImgCountAutoRef.current=false;setFlowImgCountAuto(false);setFlowImgCount(Math.max(1,Math.min(10,Number(e.target.value)||1)));}}
                              onBlur={e=>{const nv=Math.max(1,Math.min(10,Number(e.target.value)||1));showToast(`✅ 이미지 ${nv}장으로 설정됐어요`,"success");}}
                              style={{flex:1,textAlign:"center",padding:"8px",borderRadius:9,border:"1.5px solid rgba(168,85,247,.4)",background:"var(--bg2)",color:"#c084fc",fontSize:20,fontWeight:900,fontFamily:"'Space Grotesk',sans-serif"}}/>
                            <button onClick={()=>{flowImgCountAutoRef.current=false;setFlowImgCountAuto(false);setFlowImgCount(v=>{const nv=Math.min(10,v+1);showToast(`✅ 이미지 ${nv}장으로 설정됐어요`,"success");return nv;});}}
                              style={{width:40,height:40,borderRadius:9,border:"2px solid #a855f7",background:"rgba(168,85,247,.18)",cursor:"pointer",fontSize:22,fontWeight:900,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#c084fc",transition:"transform .08s"}} onMouseDown={e=>e.currentTarget.style.transform="scale(.9)"} onMouseUp={e=>e.currentTarget.style.transform="scale(1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>+</button>
                          </div>
                        )}
                      </div>

                      {/* 프롬프트 미리보기 */}
                      {genTitle&&(
                        <div style={{marginBottom:16,padding:"14px",borderRadius:12,background:"var(--bg)",border:"1px solid var(--border)"}}>
                          <div style={{fontSize:11,fontWeight:700,color:"var(--text3)",marginBottom:6}}>🔤 자동 생성될 영문 프롬프트</div>
                          <div style={{fontSize:11,color:"#c084fc",lineHeight:1.8,fontStyle:"italic",wordBreak:"break-word"}}>
                            {buildFlowPrompt(keyword||genTitle, genTitle, genContent, 0)}
                          </div>
                        </div>
                      )}

                      {/* 상태 안내 */}
                      <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 14px",borderRadius:12,background:"rgba(168,85,247,.08)",border:"1px solid rgba(168,85,247,.2)"}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:"#a855f7",boxShadow:"0 0 8px #a855f7",animation:"float 1.5s ease-in-out infinite",flexShrink:0}}/>
                        <div style={{fontSize:12,color:"#c084fc",fontWeight:600}}>발행하기 탭에서 🚀 발행 버튼을 누르면 자동으로 시작됩니다</div>
                      </div>
                    </div>
                  </div>
                )}

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
                                <span style={{fontSize:12,fontWeight:700,color:"var(--accent-text)",animation:"pulse 1.2s infinite"}}>⏳ {genImgCurrent} / {imgGenType==="flow"?flowImgCount:imgCount}장 완성</span>
                                <span style={{fontSize:14,fontWeight:900,color:"var(--accent-text)",fontFamily:"'Space Grotesk',sans-serif"}}>{genImgProgress}%</span>
                              </div>
                              <div style={{height:8,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${genImgProgress}%`,background:"linear-gradient(90deg,var(--accent),#00cc80)",borderRadius:99,transition:"width .4s"}}/>
                              </div>
                            </div>
                          )}

                          {/* ── Flow 준비 안내/버튼 (Flow 방식 선택 시, 생성 버튼 바로 위) ── */}
                          {imgGenType==="flow"&&(
                            <div style={{marginBottom:12,padding:"14px 16px",borderRadius:14,background:flowReady?"rgba(0,200,120,.08)":"rgba(168,85,247,.1)",border:`2px solid ${flowReady?"rgba(0,200,120,.45)":"rgba(168,85,247,.45)"}`}}>
                              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:flowReady?0:12}}>
                                <span style={{fontSize:22}}>{flowReady?"✅":"🎨"}</span>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:13.5,fontWeight:800,color:flowReady?"var(--success)":"#c084fc"}}>
                                    {flowReady?"Flow 준비 완료! 이제 아래 '이미지 생성 시작'을 누르세요":"이미지를 만들려면 먼저 'Flow 준비'가 필요해요"}
                                  </div>
                                  {!flowReady&&(
                                    <div style={{fontSize:11.5,color:"var(--text2)",marginTop:4,lineHeight:1.6}}>
                                      아래 파란 버튼을 누르면 <b>크롬 창이 열려요</b> → 그 창에서 <b>구글 로그인 1회만</b> 하면 → 다시 여기서 '이미지 생성 시작'을 누르면 됩니다. (로그인은 처음 한 번만)
                                    </div>
                                  )}
                                </div>
                              </div>
                              {!flowReady&&(
                                <button onClick={handleFlowLaunchChrome} disabled={flowLaunching}
                                  style={{width:"100%",padding:"14px",borderRadius:12,border:"2px solid #7c3aed",background:flowLaunching?"#a855f7":"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff",cursor:flowLaunching?"wait":"pointer",fontSize:15,fontWeight:900,fontFamily:"inherit",boxShadow:"0 4px 16px rgba(124,58,237,.4)",opacity:flowLaunching?.8:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                                  {flowLaunching?<><span className="spinner"/>크롬 여는 중...</>:<>👉 여기 눌러 Flow 준비하기 (크롬 열림)</>}
                                </button>
                              )}
                            </div>
                          )}

                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            <button className="btn btn-primary btn-full" onClick={handleGenerateImages} disabled={genImgLoading||!genContent}>
                              {genImgLoading?<><span className="spinner"/>생성 중...</>:<>🎨 이미지 생성 시작</>}
                            </button>
                            {genImgLoading&&<button className="btn-stop" style={{width:"100%",justifyContent:"center"}} onClick={stopImageGen}>⏹ 생성 중단</button>}
                            {imgGenFailed&&!genImgLoading&&<button className="btn btn-sm" onClick={()=>{setImgGenFailed(false);handleGenerateImages();}} style={{background:"var(--warn)",color:"#fff",border:"none",cursor:"pointer",width:"100%",justifyContent:"center",marginTop:4}}>🔄 재시도</button>}
                            {imgGenType==="flow"&&generatedImages.length>0&&!genImgLoading&&(
                              <div style={{padding:"12px 14px",borderRadius:12,background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.3)",display:"flex",flexDirection:"column",gap:8}}>
                                <div style={{fontSize:12,color:"#10b981",fontWeight:700,lineHeight:1.6}}>
                                  ➕ 이미지 더 만들기
                                  <div style={{fontSize:11,color:"var(--text2)",fontWeight:500,marginTop:2,lineHeight:1.7}}>버튼 숫자만큼 이미지를 만들어요 — <b>1장</b>이면 1장, <b>2장</b>이면 2장, <b>3장</b>이면 3장. (더하기 아님)<br/>· 맘에 안 드는 이미지를 🗑로 지운 뒤 <b>그 자리 채우기</b><br/>· 기존 이미지는 그대로 두고 <b>더 추가하기</b><br/>새로 만든 이미지는 <b>글 흐름을 이어받아</b> 뒤에 붙어요(섞여서 이상한 이미지 안 나와요).</div>
                                </div>
                                <div style={{display:"flex",gap:6}}>
                                  {[1,2,3].map(c=>(
                                    <button key={c} className="btn btn-sm" onClick={()=>handleGenerateFlowImages(true,c)} disabled={genImgLoading||!genContent}
                                      style={{flex:1,background:"rgba(16,185,129,.15)",color:"#10b981",border:"1.5px solid #10b981",cursor:"pointer",justifyContent:"center",fontWeight:800,fontFamily:"inherit"}}>
                                      {c}장
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
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
                          {v:"C",l:"패턴 B",badge:"",sub:"썸네일 + 이미지 균등 분산",desc:"이미지를 글 전체에 고르게 배치",diagram:"🖼️썸네일 → 📝 → 🖼️ → 📝 → 🖼️"},
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
                          <button className="btn btn-sm btn-secondary" onClick={()=>setCaptions(buildCaptions(keyword||genTitle,getActiveImages().length,genContent))}>💬 캡션 자동생성</button>
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
                                    const delSrc=getActiveImages()[i];
                                    const newImgs=getActiveImages().filter((_,j)=>j!==i);
                                    const newCaps=captions.filter((_,j)=>j!==i);
                                    if(imgSource==="ai")setGeneratedImages(p=>p.filter((_,j)=>j!==i));
                                    else setUploadedImages(p=>p.filter((_,j)=>j!==i));
                                    setCaptions(newCaps);
                                    // ★ 발행에 쓰이는 blocks도 다시 배치 — 지운 이미지가 발행에 남지 않게
                                    if(newImgs.length>0){
                                      triggerAutoInsert(newImgs.map((src,k)=>({id:k,src,alt:newCaps[k]||`${keyword||genTitle||pubTitle} 사진`})));
                                    }else{
                                      setBlocks(prev=>prev.filter(b=>b.type==="text"));
                                    }
                                    // 지운 게 썸네일이었으면 썸네일도 갱신
                                    if(thumbnail===delSrc)setThumbnail(newImgs[0]||"");
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
                {photoGenerating&&(
                  <button onClick={()=>{setPhotoGenerating(false);}} style={{width:"100%",marginTop:8,padding:"10px",borderRadius:12,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>⏹️ 생성 취소</button>
                )}
                {/* 결제문의 플로팅에 생성 버튼이 가리지 않게 하단 여백 */}
                {!photoGenDone&&<div style={{height:90}} aria-hidden="true" />}

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
                {quota&&quota.remaining_quota<=0&&!(["unlimited","admin"] as string[]).includes(user.plan)&&<div className="alert-box alert-danger" style={{margin:"12px 16px 0"}}>⚠️ 발행 건수 초과. 플랜을 업그레이드해주세요.</div>}

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
                      {label:`이미지 ${blocks.filter(b=>b.type==="image"||(b.type==="image-pair"&&(b as ImagePairBlock).images?.length>=2)).length}장`,ok:blocks.some(b=>b.type==="image"||(b.type==="image-pair"))},
                      {label:pubAccId?connAccs.find(a=>a.id===pubAccId)?.username||"계정":"계정 미선택",ok:!!pubAccId},
                    ].map(c=>(
                      <span key={c.label} className={`pub-ready-chip ${c.ok?"pub-ready-ok":"pub-ready-no"}`}>
                        {c.ok?"✅":"❌"} {c.label}
                      </span>
                    ))}
                  </div>
                  <div className="pub-actions" style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
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
                    <button onClick={handlePublish} disabled={publishing||!pubAccId||!hasPublishableContent()||(quota!==null&&(quota.remaining_quota||0)<=0)||(scheduleOn&&!scheduleTime)}
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
                                  onChange={e=>{
                                    updateBlock(block.id,{content:e.target.value});
                                    // 높이 자동 조절 — height:"auto" 리셋 없이 scrollHeight만 적용 (한글 조합 중 커서 튀는 버그 방지)
                                    const el=e.target as HTMLTextAreaElement;
                                    const prev=el.style.height;
                                    el.style.height="0px";
                                    const next=el.scrollHeight+"px";
                                    if(prev!==next) el.style.height=next;
                                    else el.style.height=prev;
                                  }}
                                  placeholder="내용 입력..."
                                  style={{width:"100%",minHeight:80,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,lineHeight:1.8,fontFamily:"inherit",resize:"none",outline:"none",boxSizing:"border-box"}}
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
                      {history.length>0&&<button className="btn btn-danger btn-sm" onClick={async()=>{if(!window.confirm(`발행 기록 ${history.length}건을 정말 모두 삭제할까요?\n(되돌릴 수 없습니다)`))return;if(!window.confirm("한 번 더 확인할게요. 전체 삭제를 진행할까요?"))return;await deleteAllHistory(user.id);setHistory([]);showToast("🗑 발행 기록 전체 삭제 완료","success");}}>🗑 전체삭제</button>}
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
                          {h.status!=="fail"&&(
                            <button onClick={()=>{
                              const c=(h as any).content;
                              if(c){
                                setPubTitle(c.title||h.title||"");
                                if(c.content)setGenContent(c.content);
                                if(Array.isArray(c.blocks))setBlocks(c.blocks.map((b:any)=>b.type==="text"?{type:"text",id:uid(),content:b.content}:b.type==="image"?{type:"image",id:uid(),src:b.src,alt:b.alt||"",position:"center",source:"auto"}:b.type==="image-pair"?{type:"image-pair",id:uid(),images:b.images}:null).filter(Boolean) as any);
                                if(c.imageUrl)setThumbnail(c.imageUrl);
                                if(Array.isArray(c.tags))setHashtags(c.tags.map((t:string)=>t.startsWith("#")?t:"#"+t));
                                if(c.visibility)setVisibility(c.visibility);
                                if(c.pubScope)setPubScope(c.pubScope);
                                setTab("publish");
                                showToast("✅ 글·이미지 통째로 복원 완료! 발행 버튼만 누르면 돼요","success");
                              }else{
                                setPubTitle(h.title||"");setTab("publish");
                                showToast("제목만 복원됐어요 (이전 발행은 내용 미저장)","info");
                              }
                            }} style={{padding:"4px 10px",borderRadius:7,border:"1px solid rgba(0,200,120,.3)",background:"transparent",color:"var(--success)",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}}>🔄 재발행</button>
                          )}
                    </div>
                  ))}
                </div>
                {/* 하단 여백: 마지막 기록의 삭제/재발행 버튼이 '결제 문의' 플로팅·모바일바에 가리지 않게 */}
                <div style={{height:120}} aria-hidden="true" />
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
                      {(()=>{
                        const rs = a.platform==="naver"?realSession.naver:a.platform==="tistory"?realSession.tistory:undefined;
                        // 봇 온라인이면 실제 세션 기준, 오프라인이면 확인 불가라 DB값 기준.
                        const needReconnect = botOnline && a.is_connected && rs===false; // 저장은 됐다는데 실제 세션이 없음
                        const ok = botOnline ? !!rs : a.is_connected;
                        const label = ok?"✅ 연결됨":needReconnect?"⚠️ 재연결 필요":"미연결";
                        return <span style={{fontSize:11,fontWeight:700,padding:"4px 11px",borderRadius:99,background:ok?"var(--accent-bg)":needReconnect?"rgba(255,140,0,.14)":"var(--card-hover)",color:ok?"var(--accent-text)":needReconnect?"#ff8c00":"var(--text2)",border:"1px solid",borderColor:ok?"var(--accent-border)":needReconnect?"rgba(255,140,0,.5)":"var(--border)"}}>{label}</span>;
                      })()}
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
                          <button onClick={async()=>{setEditingCatAccId(a.id);await loadCategories(a.platform,a.id);}} disabled={loadingCats} style={{marginTop:8,width:"100%",padding:"8px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:loadingCats?"wait":"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                            {loadingCats?"⏳ 불러오는 중...":"🔄 봇에서 카테고리 자동 불러오기"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* ===== 🎨 Google Flow 계정 연결 ===== */}
                <GoogleFlowCard botOnline={botOnline} botUrl={BOT} userId={user?.id||""} />
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
                  <div className="cal-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
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

            {/* ⚠️ 인스타 DM 안전 수칙 팝업 */}
            {showInstaWarn&&(
              <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.78)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowInstaWarn(false)}>
                <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:440,background:"var(--card)",border:"1px solid var(--border)",borderRadius:18,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
                  <div style={{padding:"20px 22px",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff"}}>
                    <div style={{fontSize:18,fontWeight:900,display:"flex",alignItems:"center",gap:8}}>⚠️ 인스타 DM 안전 수칙</div>
                    <div style={{fontSize:12,opacity:.92,marginTop:4}}>계정을 지키려면 꼭 읽어주세요</div>
                  </div>
                  <div style={{padding:"18px 22px",display:"flex",flexDirection:"column",gap:11}}>
                    {[
                      ["🐢","천천히, 소량부터","인스타는 자동 DM을 약관으로 제한하고 봇 탐지가 엄격해요. 처음엔 하루 10~20개로 시작하세요."],
                      ["🌱","계정 워밍업 필수","만든 지 얼마 안 됐거나 활동이 적은 계정은 차단 위험이 큽니다. 평소처럼 게시·소통을 병행하세요."],
                      ["⏱️","발송 간격 충분히","봇이 자동으로 수십 초~분 단위 랜덤 딜레이를 줍니다. 간격을 너무 짧게 바꾸지 마세요."],
                      ["✍️","문구는 조금씩 다르게","똑같은 문구 대량 발송은 스팸으로 분류돼 차단·신고 위험이 커져요."],
                      ["🛑","제한 오면 즉시 중단","'액션 차단'·로그인 경고가 뜨면 바로 멈추고 며칠 쉬세요."],
                    ].map(([ic,t,d],i)=>(
                      <div key={i} style={{display:"flex",gap:11,alignItems:"flex-start"}}>
                        <span style={{fontSize:18,flexShrink:0}}>{ic}</span>
                        <div>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{t}</div>
                          <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.5,marginTop:1}}>{d}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{fontSize:11,color:"var(--text3)",background:"rgba(255,107,157,.07)",border:"1px solid rgba(255,107,157,.2)",borderRadius:8,padding:"9px 11px",lineHeight:1.5}}>
                      ⓘ 본 기능 사용으로 발생하는 계정 제재의 책임은 사용자에게 있습니다.
                    </div>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text2)",cursor:"pointer",marginTop:2}}>
                      <input type="checkbox" onChange={e=>{if(e.target.checked)localStorage.setItem("insta_dm_warn_hide","1");else localStorage.removeItem("insta_dm_warn_hide");}}/>
                      다시 보지 않기
                    </label>
                    <button onClick={()=>setShowInstaWarn(false)} style={{marginTop:4,padding:"13px",borderRadius:11,border:"none",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",fontSize:14,fontWeight:800,fontFamily:"inherit",cursor:"pointer"}}>
                      확인했어요 👍
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab==="insta_dm"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 헤더 */}
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                  <div style={{width:48,height:48,borderRadius:16,background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,boxShadow:"0 6px 20px rgba(255,107,157,.3)",flexShrink:0}}>📱</div>
                  <div>
                    <div style={{fontSize:20,fontWeight:900,color:"var(--text)"}}>인스타그램 DM</div>
                    <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>체험단·협찬 모집을 위한 인스타 DM 발송 서비스</div>
                  </div>
                </div>

                <div aria-label="인스타그램 DM 진행 단계" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
                  {["계정 연결","대상 준비","문구 확인","안전 발송"].map((label,index)=>{
                    const step=index+1;
                    const done=step<dmCurrentStep;
                    const active=step===dmCurrentStep;
                    return <div key={label} style={{padding:"10px 8px",borderRadius:12,textAlign:"center",border:`1px solid ${done||active?"rgba(255,107,157,.55)":"var(--border)"}`,background:active?"linear-gradient(135deg,rgba(255,107,157,.16),rgba(199,125,255,.14))":done?"rgba(255,107,157,.07)":"var(--card)",color:done||active?"#FF6B9D":"var(--text3)",fontSize:11,fontWeight:800}}>
                      <span aria-hidden="true">{done?"✓":step}</span> {label}
                    </div>;
                  })}
                </div>

                {/* 사용량 카드 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:18}}>
                  {[
                    {label:"오늘 발송",value:instaUsed,total:INSTA_DM_DAILY_LIMIT[user.plan]??5,color:"#FF6B9D"},
                    {label:"전체 타겟",value:dmTargets.length,color:"var(--text)"},
                    {label:"✅ 발송완료",value:dmTargets.filter(t=>t.status==="sent").length,color:"var(--success)"},
                    {label:"⏳ 대기중",value:dmTargets.filter(t=>t.status==="pending").length,color:"var(--info)"},
                  ].map((s,i)=>(
                    <div key={i} style={{padding:"16px",borderRadius:14,background:"var(--card)",border:"1px solid var(--border)",textAlign:"center",position:"relative",overflow:"hidden"}}>
                      {i===0&&(s.total??0)>0&&(
                        <div style={{position:"absolute",bottom:0,left:0,height:3,width:`${Math.min(100,(s.value/(s.total||1))*100)}%`,background:"linear-gradient(90deg,#FF6B9D,#C77DFF)",borderRadius:99,transition:"width .5s"}}/>
                      )}
                      <div style={{fontSize:24,fontWeight:900,color:s.color,lineHeight:1,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}{i===0&&(s.total??0)>0?<span style={{fontSize:14,color:"var(--text3)",fontWeight:500}}>/{s.total}</span>:""}</div>
                      <div style={{fontSize:10,color:"var(--text3)",marginTop:5,fontWeight:600}}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 서브탭 */}
                <div style={{display:"flex",gap:4,marginBottom:16,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:4}}>
                  {([{k:"guide",l:"📖 사용 방법"},{k:"send",l:"🚀 DM 발송"},{k:"history",l:"📨 발송 이력"}] as const).map(t=>(
                    <button key={t.k} onClick={()=>{setDmSubTab(t.k);if(t.k==="history")getInstaDmHistory(user.id).then(setDmHistory);}}
                      style={{flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",
                        background:dmSubTab===t.k?"linear-gradient(135deg,rgba(255,107,157,.15),rgba(199,125,255,.15))":"transparent",
                        color:dmSubTab===t.k?"#FF6B9D":"var(--text2)",
                        borderBottom:dmSubTab===t.k?"2px solid #FF6B9D":"2px solid transparent",transition:"all .15s"}}>
                      {t.l}
                    </button>
                  ))}
                </div>

                {/* 사용 방법 */}
                {dmSubTab==="guide"&&(
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{padding:"20px",borderRadius:16,background:"linear-gradient(135deg,rgba(255,107,157,.08),rgba(199,125,255,.08))",border:"1px solid rgba(255,107,157,.2)"}}>
                      <div style={{fontSize:14,fontWeight:900,color:"#FF6B9D",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                        📱 인스타 DM 서비스란?
                      </div>
                      <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.8,marginBottom:16}}>
                        키워드와 팔로워 수를 기반으로 인스타그램 계정을 자동 수집하고, 체험단·협찬 모집 DM을 발송하는 서비스예요. 실제 발송은 로컬 PC의 봇 프로그램이 처리해요.
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
                        {[
                          {step:"01",ico:"🎯",title:"타겟 설정",desc:"발송할 인스타 계정 목록을 직접 입력하거나 키워드로 크롤링해요"},
                          {step:"02",ico:"✍️",title:"문구 작성",desc:"AI로 체험단 DM 문구를 자동 생성하거나 직접 입력해요"},
                          {step:"03",ico:"🤖",title:"봇 실행",desc:"로컬 PC에서 봇 프로그램을 실행하면 자동으로 발송돼요"},
                          {step:"04",ico:"📊",title:"결과 확인",desc:"발송 이력 탭에서 성공/실패 현황을 확인해요"},
                        ].map((s,i)=>(
                          <div key={i} style={{padding:"14px",borderRadius:12,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)"}}>
                            <div style={{fontSize:10,fontWeight:800,color:"rgba(255,107,157,.6)",marginBottom:6,letterSpacing:".1em"}}>STEP {s.step}</div>
                            <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:5}}>{s.ico} {s.title}</div>
                            <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.6}}>{s.desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      <div style={{padding:"16px",borderRadius:14,background:"var(--card)",border:"1px solid var(--border)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--success)",marginBottom:10}}>✅ 안전한 사용법</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {["하루 {limit}개 이하 발송 유지","자연스러운 개인화 문구 사용","첫 메시지에 링크 미포함","2~5분 랜덤 간격 발송 (자동)","응답받은 계정 위주 관리"].map((t,i)=>(
                            <div key={i} style={{fontSize:12,color:"var(--text2)",display:"flex",gap:6,alignItems:"flex-start"}}>
                              <span style={{color:"var(--success)",flexShrink:0}}>✓</span>
                              {t.replace("{limit}",String(INSTA_DM_DAILY_LIMIT[user.plan]??5))}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{padding:"16px",borderRadius:14,background:"rgba(248,81,73,.04)",border:"1px solid rgba(248,81,73,.2)"}}>
                        <div style={{fontSize:12,fontWeight:800,color:"var(--danger)",marginBottom:10}}>⚠️ 주의사항</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {["동일 문구 반복 대량 발송 금지","신고 누적 시 계정 제한 가능","로컬 PC에서만 실행 권장","VPN 사용 비권장","신규 계정은 20~30개 이하 권장"].map((t,i)=>(
                            <div key={i} style={{fontSize:12,color:"var(--text2)",display:"flex",gap:6,alignItems:"flex-start"}}>
                              <span style={{color:"var(--danger)",flexShrink:0}}>!</span>{t}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{padding:"14px 18px",borderRadius:12,background:"rgba(88,166,255,.06)",border:"1px solid rgba(88,166,255,.2)",display:"flex",alignItems:"center",gap:12}}>
                      <span style={{fontSize:24}}>💎</span>
                      <div>
                        <div style={{fontSize:13,fontWeight:800,color:"var(--info)",marginBottom:3}}>내 플랜 한도: {INSTA_DM_DAILY_LIMIT[user.plan]??0}개/일</div>
                        <div style={{fontSize:11,color:"var(--text3)"}}>한도 증가는 관리자에게 문의하세요. PRO 플랜은 하루 60개까지 발송 가능해요.</div>
                      </div>
                    </div>

                    <button onClick={()=>setDmSubTab("send")}
                      style={{padding:"14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:"0 6px 20px rgba(255,107,157,.3)"}}>
                      🚀 DM 발송 시작하기 →
                    </button>
                  </div>
                )}

                {/* DM 발송 */}
                {dmSubTab==="send"&&(
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>

                    {/* 1) 계정 연결 */}
                    <div className="card">
                      <div className="card-title" style={{color:"#FF6B9D"}}>🔗 인스타 계정 연결 {dmSessionOk&&<span style={{fontSize:11,color:"var(--success)",fontWeight:700,marginLeft:6}}>● 연결됨</span>}</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>발송·크롤링은 로컬 봇(:3335)에서 실행돼요. 연결 시 창이 뜨면 2단계 인증/캡차는 직접 통과시켜 주세요.</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end"}}>
                        <div><label className="inp-label">인스타 아이디</label><input className="inp" placeholder="@내계정" value={dmAccount} onChange={e=>setDmAccount(e.target.value)} onBlur={()=>checkDmSession(dmAccount.trim().replace(/^@/,""))}/></div>
                        <div><label className="inp-label">비밀번호</label><input className="inp" type="password" placeholder="비밀번호" value={dmIgPw} onChange={e=>setDmIgPw(e.target.value)}/></div>
                        <button onClick={connectIg} disabled={dmConnecting} style={{padding:"11px 18px",borderRadius:10,border:"none",background:dmConnecting?"var(--border)":"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:dmConnecting?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"}}>{dmConnecting?"연결 중...":dmSessionOk?"재연결":"계정 연결"}</button>
                      </div>
                    </div>

                    {/* 2) 키워드로 타겟 크롤링 */}
                    <div className="card">
                      <div className="card-title" style={{color:"#FF6B9D"}}>🔍 키워드로 타겟 수집 <span style={{fontSize:11,color:"var(--text3)",fontWeight:500}}>(팔로워 수 필터)</span></div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8,marginBottom:8}}>
                        <div><label className="inp-label">검색 키워드</label><input className="inp" placeholder="예: 뷰티, 다이어트, 캠핑" value={dmCrawlKw} onChange={e=>setDmCrawlKw(e.target.value)}/></div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                        <div><label className="inp-label">최소 팔로워</label><input className="inp" type="number" inputMode="numeric" placeholder="1000" value={dmMinFollow} onChange={e=>setDmMinFollow(e.target.value)}/></div>
                        <div><label className="inp-label">최대 팔로워</label><input className="inp" type="number" inputMode="numeric" placeholder="50000" value={dmMaxFollow} onChange={e=>setDmMaxFollow(e.target.value)}/></div>
                        <div><label className="inp-label">수집 개수</label><input className="inp" type="number" inputMode="numeric" placeholder="30" value={dmCrawlLimit} onChange={e=>setDmCrawlLimit(e.target.value)}/></div>
                      </div>
                      <button onClick={crawlIg} disabled={dmRunning} style={{padding:"11px 20px",borderRadius:10,border:"none",background:dmRunning?"var(--border)":"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:dmRunning?"default":"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit"}}>{dmRunning?"수집 중...":"🔍 키워드 수집 시작"}</button>
                    </div>

                    {/* 타겟 추가 */}
                    <div className="card">
                      <div className="card-title" style={{color:"#FF6B9D"}}>🎯 발송 대상 추가</div>
                      <div style={{marginBottom:12}}>
                        <label className="inp-label">인스타 계정 <span style={{color:"var(--text3)",fontSize:11}}>(쉼표 또는 줄바꿈으로 여러 개)</span></label>
                        <textarea className="inp" rows={3} placeholder={"@계정명1\n@계정명2\n계정명3"} value={dmTargetInput} onChange={e=>setDmTargetInput(e.target.value)} style={{resize:"vertical",fontFamily:"inherit"}}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                        <div>
                          <label className="inp-label">키워드 메모</label>
                          <input className="inp" placeholder="예: 뷰티 체험단" value={dmKeyword} onChange={e=>setDmKeyword(e.target.value)}/>
                        </div>
                        <div>
                          <label className="inp-label">발송 인스타 계정</label>
                          <input className="inp" placeholder="@내계정명" value={dmAccount} onChange={e=>setDmAccount(e.target.value)}/>
                        </div>
                      </div>
                      <button onClick={async()=>{
                        const existing=new Set(dmTargets.map(target=>target.username.toLowerCase()));
                        const parsed=dmTargetInput.split(/[,\n]/).map(s=>s.trim().replace(/^@/,"")).filter(Boolean);
                        const list=[...new Map(parsed.map(username=>[username.toLowerCase(),username])).values()].filter(username=>!existing.has(username.toLowerCase()));
                        const skipped=parsed.length-list.length;
                        if(!list.length){showToast("이미 등록된 대상이거나 올바른 계정명이 없어요","error");return;}
                        for(const u of list){
                          await addInstaDmTarget({user_id:user.id,username:u,followers:0,bio:"",keywords:dmKeyword,status:"pending",instagram_account:dmAccount});
                        }
                        setDmTargetInput("");
                        getInstaDmTargets(user.id).then(setDmTargets);
                        showToast(skipped?`대상 ${list.length}명 추가 · 중복 ${skipped}명 제외`:`대상 ${list.length}명을 추가했어요`);
                      }} style={{padding:"11px 20px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:8,boxShadow:"0 4px 16px rgba(255,107,157,.25)"}}>
                        ➕ 타겟 추가
                      </button>
                    </div>

                    {/* DM 문구 */}
                    <div className="card">
                      <div className="card-title">✍️ DM 문구</div>
                      <div style={{display:"flex",gap:7,flexWrap:"wrap",margin:"10px 0 12px"}}>
                        {DM_TEMPLATES.map(template=><button key={template.label} type="button" onClick={()=>setDmMessage(template.message)} style={{padding:"7px 10px",borderRadius:99,border:"1px solid rgba(255,107,157,.35)",background:"rgba(255,107,157,.07)",color:"#FF6B9D",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>{template.label}</button>)}
                      </div>
                      <div style={{marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <label className="inp-label" style={{margin:0}}>메시지 내용</label>
                          <span style={{fontSize:11,color:dmMessage.length>900?"var(--danger)":"var(--text3)",fontWeight:600}}>{dmMessage.length}/1000</span>
                        </div>
                        <textarea className="inp" rows={6} placeholder={"안녕하세요! 저는 [브랜드명] 담당자예요 😊\n\n○○님의 콘텐츠가 너무 좋아서 연락드렸어요.\n\n저희 제품 체험 기회를 드리고 싶어요!\n무료로 제품 보내드리고 솔직한 리뷰만 부탁드려요 🙏\n\n관심 있으시면 짧게 답장 주세요!"}
                          value={dmMessage} onChange={e=>{if(e.target.value.length<=1000)setDmMessage(e.target.value);}}
                          style={{resize:"vertical",fontFamily:"inherit"}}/>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button onClick={async()=>{
                          const key=localStorage.getItem("publy_gemini_key")||localStorage.getItem("publy_adm_gemini_key")||"";
                          if(!key){alert("설정 탭에서 Gemini API 키를 먼저 입력해주세요");return;}
                          const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
                            {method:"POST",headers:{"Content-Type":"application/json"},
                             body:JSON.stringify({contents:[{parts:[{text:`인스타그램 체험단 모집 DM을 자연스럽게 작성해줘. 키워드: "${dmKeyword||"뷰티/식품 체험단"}". 조건: 1000자 이내, 링크 미포함, 친근한 말투, 브랜드명은 [브랜드명]으로 표시, 담당자명은 [담당자명]. DM 내용만 출력.`}]}],generationConfig:{maxOutputTokens:500}})});
                          const d=await r.json();
                          const text=d.candidates?.[0]?.content?.parts?.[0]?.text||"";
                          if(text)setDmMessage(text.slice(0,1000));
                        }} style={{padding:"10px 16px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#4285F4,#0F9D58)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:6}}>
                          ✨ AI 문구 생성
                        </button>
                        <button onClick={()=>setDmMessage("")}
                          style={{padding:"10px 14px",borderRadius:9,border:"1px solid var(--border)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                          초기화
                        </button>
                      </div>
                    </div>

                    {/* 타겟 목록 */}
                    {dmTargets.length>0&&(
                      <div className="card" style={{padding:0,overflow:"hidden"}}>
                        <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                          <div style={{fontWeight:800,fontSize:13}}>🎯 타겟 목록</div>
                          <div style={{display:"flex",gap:6}}>
                            {(["all","pending","sent","fail"] as const).map(f=>(
                              <button key={f} onClick={()=>setDmFilter(f)}
                                style={{padding:"5px 10px",borderRadius:7,border:`1.5px solid ${dmFilter===f?"#FF6B9D":"var(--border)"}`,background:dmFilter===f?"rgba(255,107,157,.1)":"transparent",color:dmFilter===f?"#FF6B9D":"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                                {f==="all"?"전체":f==="pending"?"⏳대기":f==="sent"?"✅발송":"❌실패"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div style={{maxHeight:320,overflowY:"auto"}}>
                          {dmTargets.filter(t=>dmFilter==="all"||t.status===dmFilter).map(t=>(
                            <div key={t.id} style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10}}
                              onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                              onMouseLeave={e=>(e.currentTarget.style.background="")}>
                              <div style={{width:36,height:36,borderRadius:99,background:"linear-gradient(135deg,#FF6B9D22,#C77DFF22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>👤</div>
                              <div style={{flex:1,minWidth:0}}>
                                <a href={`https://instagram.com/${t.username}`} target="_blank" rel="noreferrer"
                                  style={{color:"#FF6B9D",fontWeight:700,textDecoration:"none",fontSize:13}}>@{t.username}</a>
                                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{t.keywords||"키워드 없음"}</div>
                              </div>
                              <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,flexShrink:0,
                                background:t.status==="sent"?"rgba(0,214,143,.12)":t.status==="fail"?"rgba(255,83,99,.12)":t.status==="pending"?"rgba(88,166,255,.12)":"rgba(120,120,120,.12)",
                                color:t.status==="sent"?"var(--success)":t.status==="fail"?"var(--danger)":t.status==="pending"?"var(--info)":"var(--text3)"}}>
                                {t.status==="sent"?"✅":t.status==="fail"?"❌":t.status==="pending"?"⏳":"⏭️"} {t.status==="sent"?"발송완료":t.status==="fail"?"실패":"대기"}
                              </span>
                              <button onClick={async()=>{await deleteInstaDmTarget(t.id);setDmTargets(p=>p.filter(x=>x.id!==t.id));}}
                                style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(248,81,73,.3)",background:"rgba(248,81,73,.06)",color:"var(--danger)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>삭제</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 발송 실행 + 실시간 로그 (send 탭) */}
                {dmSubTab==="send"&&(
                  <div className="card" style={{marginTop:14}}>
                    <div className="card-title" style={{color:"#FF6B9D"}}>🚀 DM 발송 실행</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,margin:"12px 0"}}>
                      {[
                        ["발송 대기",`${dmPendingCount}명`],["이번 발송",`${dmSendableCount}명`],["오늘 남은 한도",`${dmRemaining}명`],["예상 시간",dmEstimatedMinutes?`약 ${dmEstimatedMinutes}분`:"—"],
                      ].map(([label,value])=><div key={label} style={{padding:"11px",borderRadius:11,background:"linear-gradient(135deg,rgba(255,107,157,.08),rgba(199,125,255,.06))",border:"1px solid rgba(255,107,157,.2)"}}><div style={{fontSize:10,color:"var(--text3)",fontWeight:700}}>{label}</div><div style={{fontSize:16,color:"var(--text)",fontWeight:900,marginTop:3}}>{value}</div></div>)}
                    </div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>중복 대상은 추가할 때 자동 제외하며, 오늘 남은 안전 한도까지만 발송해요. 발송 간격은 봇이 랜덤(40~90초) 적용합니다.</div>
                    <div style={{display:"flex",gap:8,marginBottom:dmLogs.length?12:0}}>
                      {!dmRunning ? (
                        <button onClick={sendIg} disabled={!dmSendableCount||!dmMessage.trim()||!dmSessionOk} title={!dmSessionOk?"인스타 계정을 먼저 연결해주세요":!dmMessage.trim()?"DM 문구를 먼저 작성해주세요":!dmSendableCount?"발송 가능한 대상이 없어요":undefined} style={{flex:1,padding:"13px",borderRadius:11,border:"none",background:"linear-gradient(135deg,#FF6B9D,#C77DFF)",color:"#fff",cursor:dmSendableCount&&dmMessage.trim()&&dmSessionOk?"pointer":"not-allowed",opacity:dmSendableCount&&dmMessage.trim()&&dmSessionOk?1:.45,fontSize:14,fontWeight:800,fontFamily:"inherit"}}>🚀 안전 발송 시작</button>
                      ) : (
                        <button onClick={stopDm} style={{flex:1,padding:"13px",borderRadius:11,border:"1px solid var(--danger)",background:"rgba(248,81,73,.08)",color:"var(--danger)",cursor:"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>⏹️ 중단</button>
                      )}
                    </div>
                    {dmLogs.length>0&&(
                      <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px",maxHeight:220,overflowY:"auto",fontSize:11.5,fontFamily:"monospace",lineHeight:1.7,color:"var(--text2)"}}>
                        {dmLogs.map((l,i)=>(<div key={i}>{l}</div>))}
                      </div>
                    )}
                  </div>
                )}

                {/* 발송 이력 */}
                {dmSubTab==="history"&&(
                  <div className="card" style={{padding:0,overflow:"hidden"}}>
                    <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{fontWeight:800,fontSize:13}}>📨 내 발송 이력</div>
                      <span style={{fontSize:12,color:"var(--text3)"}}>{dmHistory.length}건</span>
                    </div>
                    {dmHistory.length===0 ? (
                      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>
                        <div style={{fontSize:32,marginBottom:8}}>📭</div>
                        아직 발송 이력이 없어요
                      </div>
                    ) : (
                      <div style={{maxHeight:520,overflowY:"auto"}}>
                        {dmHistory.map(h=>(
                          <div key={h.id} style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",gap:12,alignItems:"center"}}
                            onMouseEnter={e=>(e.currentTarget.style.background="var(--card-hover)")}
                            onMouseLeave={e=>(e.currentTarget.style.background="")}>
                            <div style={{width:36,height:36,borderRadius:99,background:"linear-gradient(135deg,#FF6B9D22,#C77DFF22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>📨</div>
                            <div style={{flex:1,minWidth:0}}>
                              <a href={`https://instagram.com/${h.target_username}`} target="_blank" rel="noreferrer"
                                style={{color:"#FF6B9D",fontWeight:700,textDecoration:"none",fontSize:13}}>@{h.target_username}</a>
                              <div style={{fontSize:11,color:"var(--text3)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.message}</div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <span style={{fontSize:11,padding:"3px 9px",borderRadius:99,fontWeight:700,display:"block",marginBottom:4,
                                background:h.status==="sent"?"rgba(0,214,143,.12)":"rgba(255,83,99,.12)",
                                color:h.status==="sent"?"var(--success)":"var(--danger)"}}>
                                {h.status==="sent"?"✅ 발송":"❌ 실패"}
                              </span>
                              <div style={{fontSize:10,color:"var(--text3)"}}>{new Date(h.created_at).toLocaleDateString("ko-KR")}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab==="neighbor"&&(
              <NeighborPage theme={theme as "dark"|"light"} userId={user.id} plan={user.plan} singleTab initialNeighborUsed={neighborUsed} />
            )}

            {tab==="engage"&&(
              <NeighborPage theme={theme as "dark"|"light"} userId={user.id} plan={user.plan} initialTab="engage" singleTab onEngageUsageChange={setEngageUsed} initialEngageUsed={engageUsed} />
            )}

            {tab==="settings"&&(
              <div style={{animation:"fadeUp .25s ease both"}}>

                {/* 버그 신고 — 문제 발생 시 로그를 관리자에게 보내면 아이디로 확인·수정 */}
                <div className="card">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                    <div>
                      <div className="card-title" style={{marginBottom:4}}>🐞 버그 신고</div>
                      <div style={{fontSize:12,color:"var(--text3)"}}>문제가 생기면 아래 버튼으로 신고해주세요. 로그가 함께 전송돼 원인을 빠르게 찾아드려요.</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button onClick={openFullLog} disabled={fullLogLoading||!window.electron?.readBotLog}
                        style={{padding:"9px 15px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>{fullLogLoading?"불러오는 중...":"📋 전체 로그 보기"}</button>
                      <button onClick={()=>(window as any).electron?.openLogFolder?.()}
                        style={{padding:"9px 15px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>📂 로그 폴더 열기</button>
                      <button onClick={submitBugReport} disabled={bugSending}
                        style={{padding:"9px 18px",borderRadius:10,border:"none",background:bugSending?"var(--card2)":"var(--accent)",color:bugSending?"var(--text2)":"#000",cursor:bugSending?"default":"pointer",fontSize:12,fontWeight:800,fontFamily:"inherit"}}>{bugSending?"전송 중...":"🐞 버그 신고하기"}</button>
                    </div>
                  </div>
                  <textarea value={bugMemo} onChange={e=>setBugMemo(e.target.value)} placeholder="어떤 문제가 있었는지 적어주세요 (선택) — 예: 카테고리 누르면 화면이 멈춰요"
                    style={{width:"100%",marginTop:12,minHeight:64,padding:"10px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
                  {bugMsg&&<div style={{marginTop:8,fontSize:12,fontWeight:700,color:bugMsg.startsWith("✅")?"var(--success)":"var(--danger)"}}>{bugMsg}</div>}
                </div>

                <div className="card">
                  <div className="card-title" style={{marginBottom:5}}>🌐 퍼블리와 함께 쓰는 온종일 서비스</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginBottom:13}}>상품 선택부터 체험 리뷰와 판매 수익까지 자연스럽게 이어보세요.</div>
                  <div className="on-service-grid">
                    {(Object.keys(PUBLY_SERVICE_INFO) as ServiceInfoKey[]).map(key=>{const s=PUBLY_SERVICE_INFO[key];return <button key={key} className="on-service-card" type="button" onClick={()=>setServiceInfo(key)}><span style={{fontSize:24}}>{s.icon}</span><b>{s.name}</b><small>{s.summary}</small><em>{s.coming?"곳 출시 · 자세히":"기능·혜택 자세히"} →</em></button>})}
                  </div>
                </div>

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

        {/* ── 카카오 결제문의 플로팅 버튼 ── */}
        <a href="https://open.kakao.com/o/s0lQ66wi" target="_blank" rel="noopener noreferrer"
          className="kakao-float"
          style={{position:"fixed",bottom:90,right:24,zIndex:500,display:"flex",alignItems:"center",gap:8,padding:"12px 18px",borderRadius:99,background:"#FEE500",color:"#3A1D1D",fontWeight:900,fontSize:13,fontFamily:"'Noto Sans KR',sans-serif",textDecoration:"none",boxShadow:"0 4px 20px rgba(254,229,0,.5)",animation:"float 2.5s ease-in-out infinite",whiteSpace:"nowrap",border:"none",cursor:"pointer"}}>
          <span style={{fontSize:18}}>💬</span><span className="kakao-float-text"> 결제 문의</span>
        </a>

        <div className="mob-bar">
          {MAIN_TABS.filter(t=>["keyword","write","image","photo","publish","manage","insta_dm","settings"].includes(t.k)).map(t=>(<button key={t.k} className={`mob-btn ${tab===t.k?"active":""}`} onClick={()=>{if(t.k==="rank"){window.open("https://rank.xn--zk5biyyw.com/","_blank");return;}setTab(t.k as MainTab);}}><span className="mob-btn-ico">{t.i}</span><span className="mob-btn-lbl">{t.k==="keyword"?"키워드":t.k==="write"?"글쓰기":t.k==="image"?"이미지":t.k==="photo"?"사진글":t.k==="publish"?"발행":t.k==="manage"?"발행관리":t.k==="insta_dm"?"인스타DM":"설정"}</span></button>))}
        </div>
      </div>

      {serviceInfo&&(()=>{const s=PUBLY_SERVICE_INFO[serviceInfo];return <div className={`service-info-overlay ${theme==="dark"?"service-info-dark":"service-info-light"}`} onMouseDown={e=>{if(e.target===e.currentTarget)setServiceInfo(null)}}><section className="service-info-dialog" role="dialog" aria-modal="true" aria-label={`${s.name} 알아보기`}><button className="service-info-close" type="button" onClick={()=>setServiceInfo(null)} aria-label="닫기">×</button><div className="service-info-kicker">MORE WITH ONJONGIL</div><h2>{s.name} 알아보기</h2><p className="service-info-hook">{s.hook}</p><div className="service-info-benefits">{s.benefits.map(([title,desc])=><div className="service-info-benefit" key={title}><b>✓ {title}</b><span>{desc}</span></div>)}</div><div className="service-info-flow">{s.flow}</div><div className="service-info-footer">{s.coming?<><button className="service-info-cta" disabled>신청하기</button><span className="service-info-coming">곧 출시됩니다</span></>:<a className="service-info-cta" href={s.url} target="_blank" rel="noopener noreferrer">{s.cta} →</a>}</div></section></div>})()}

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

      {/* 버그 신고 처리완료 알림 — 화면 어디에 있든 뜸 */}
      {liveLogActive&&(
        <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:500,height:liveLogCollapsed?42:180,background:theme==="dark"?"#0d1117":"#f6f8fa",borderTop:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,boxShadow:"0 -6px 20px rgba(0,0,0,.16)",display:"flex",flexDirection:"column",transition:"height .18s ease"}}>
          <div style={{height:42,flexShrink:0,padding:"0 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,color:theme==="dark"?"#e6edf3":"#24292f",borderBottom:liveLogCollapsed?"none":`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`}}>
            <span style={{fontSize:12,fontWeight:800,display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <span style={{whiteSpace:"nowrap"}}>📋 실시간 로그 · {tab==="publish"?"발행 중":"이미지 생성 중"}</span>
              {(()=>{const errN=liveLog?liveLog.split(/\r?\n/).filter(l=>/❌|실패|오류|error/i.test(l)).length:0;return errN>0?<span style={{fontSize:11,fontWeight:800,color:"#fff",background:theme==="dark"?"#cf222e":"#e5484d",padding:"2px 8px",borderRadius:20,whiteSpace:"nowrap"}}>⚠️ 오류 {errN}</span>:null;})()}
            </span>
            <span style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              <button onClick={async()=>{try{await navigator.clipboard.writeText(liveLog||"");showToast("📋 로그를 복사했어요. 문제가 있으면 여기에 붙여넣어 보내주세요.","success");}catch{showToast("복사 실패 — '전체 로그 보기'에서 길게 눌러 복사해주세요.","error");}}} style={{border:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,background:"transparent",color:"inherit",cursor:"pointer",fontSize:11.5,fontWeight:700,fontFamily:"inherit",padding:"5px 10px",borderRadius:8}}>📋 복사</button>
              <button onClick={()=>setLiveLogCollapsed(value=>!value)} style={{border:0,background:"transparent",color:"inherit",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>{liveLogCollapsed?"펼치기 ▲":"접기 ▼"}</button>
            </span>
          </div>
          {!liveLogCollapsed&&<div tabIndex={0} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="a"){event.preventDefault();const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(event.currentTarget);selection?.removeAllRanges();selection?.addRange(range);}}} style={{flex:1,overflowY:"auto",padding:"9px 14px",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",fontSize:11.5,lineHeight:1.55,whiteSpace:"pre-wrap",wordBreak:"break-word",userSelect:"text",outline:"none",color:theme==="dark"?"#b1bac4":"#57606a"}}>
            {liveLog?liveLog.split(/\r?\n/).map((line,index)=>{
              const success=/✅|완료|성공/i.test(line), failure=/❌|실패|오류|error/i.test(line);
              return <div key={index} style={{color:success?(theme==="dark"?"#3fb950":"#1a7f37"):failure?(theme==="dark"?"#f85149":"#cf222e"):undefined,minHeight:"1.55em"}}>{line}</div>;
            }):<div style={{color:theme==="dark"?"#8b949e":"#6e7781"}}>로그를 기다리는 중...</div>}
            <div ref={liveLogEndRef}/>
          </div>}
        </div>
      )}

      {fullLog!==null&&(
        <div style={{position:"fixed",inset:0,zIndex:10060,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setFullLog(null)}>
          <div style={{width:"min(900px,100%)",height:"min(680px,85vh)",background:theme==="dark"?"#0d1117":"#f6f8fa",border:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,borderRadius:16,overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 24px 70px rgba(0,0,0,.5)"}} onClick={event=>event.stopPropagation()}>
            <div style={{padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,color:theme==="dark"?"#e6edf3":"#24292f"}}><strong style={{fontSize:14}}>📋 전체 로그</strong><span style={{display:"flex",gap:8,alignItems:"center"}}><button onClick={async()=>{try{await navigator.clipboard.writeText(fullLog||"");showToast("📋 전체 로그를 복사했어요. 문제 신고 시 붙여넣어 주세요.","success");}catch{showToast("복사 실패 — 로그를 길게 눌러 직접 복사해주세요.","error");}}} style={{border:`1px solid ${theme==="dark"?"#30363d":"#d0d7de"}`,background:"transparent",color:"inherit",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",padding:"6px 12px",borderRadius:8}}>📋 복사</button><button onClick={()=>setFullLog(null)} style={{border:0,background:"transparent",color:"inherit",cursor:"pointer",fontSize:18}}>✕</button></span></div>
            <pre tabIndex={0} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="a"){event.preventDefault();const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(event.currentTarget);selection?.removeAllRanges();selection?.addRange(range);}}} style={{margin:0,padding:16,flex:1,overflow:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word",userSelect:"text",outline:"none",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",fontSize:11.5,lineHeight:1.55,color:theme==="dark"?"#b1bac4":"#57606a"}}>{fullLog}</pre>
          </div>
        </div>
      )}

      {bugAlert&&(
        <div style={{position:"fixed",inset:0,zIndex:10050,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={dismissBugAlert}>
          <div style={{width:"100%",maxWidth:420,borderRadius:20,background:theme==="dark"?"#161d27":"#ffffff",border:`1px solid ${theme==="dark"?"#2a3542":"#e2e8f0"}`,overflow:"hidden",animation:"fadeUp .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.6)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{background:"linear-gradient(135deg,#3fb950,#2ea043)",padding:"20px 22px",textAlign:"center"}}>
              <div style={{fontSize:34,marginBottom:4}}>✅</div>
              <div style={{fontSize:17,fontWeight:900,color:"#fff"}}>신고하신 문제가 해결됐어요!</div>
            </div>
            <div style={{padding:"18px 22px",background:theme==="dark"?"#161d27":"#ffffff"}}>
              {bugAlert.memo&&<div style={{fontSize:12,color:theme==="dark"?"#8a97a6":"#64748b",marginBottom:10}}>신고 내용: {bugAlert.memo}</div>}
              <div style={{fontSize:14,color:theme==="dark"?"#e8edf2":"#1e293b",lineHeight:1.75}}>
                {bugAlert.admin_reply?.trim()
                  ? bugAlert.admin_reply
                  : "말씀해주신 문제를 처리했어요. 불편을 드려 죄송하고, 신고해주셔서 감사합니다 🙏"}
              </div>
              <button onClick={dismissBugAlert}
                style={{width:"100%",marginTop:18,padding:"13px",borderRadius:12,border:"none",background:"#3fb950",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                확인
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
