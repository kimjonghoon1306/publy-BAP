import { useState, useEffect, useCallback } from "react";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount, upsertAccount, useQuota, addHistory } from "../lib/supabase";
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

const GEMINI_MODELS_ADM = ["gemini-2.0-flash","gemini-2.0-flash-lite","gemini-2.5-flash","gemini-2.5-flash-lite"];

const TABS = [
  { key:"publish", icon:"🚀", label:"발행하기" },
  { key:"write",   icon:"✍️", label:"글 생성"  },
  { key:"accounts",icon:"🔗", label:"계정 관리"},
  { key:"history", icon:"📋", label:"발행 기록"},
  { key:"settings",icon:"⚙️", label:"설정"    },
] as const;

const PLAN_LABELS: Record<string,string> = { free:"FREE", basic:"BASIC", pro:"PRO" };

const Icons = {
  sun:     "☀️",
  moon:    "🌙",
  refresh: "🔄",
  settings:"⚙️",
  send:    "🚀",
  eye:     "👁️",
  plus:    "➕",
  mobile:  "📱",
};

function AICard({ item, selected, onClick }: { item:any; selected:boolean; onClick:()=>void }) {
  return (
    <button onClick={onClick} style={{
      flex:1, padding:"12px 10px", borderRadius:14, cursor:"pointer",
      fontFamily:"'Noto Sans KR',sans-serif", textAlign:"left",
      border:`2px solid ${selected ? item.color : "var(--border)"}`,
      background: selected ? `${item.color}15` : "var(--input-bg)",
      transform: selected ? "translateY(-3px) scale(1.03)" : "none",
      boxShadow: selected ? `0 8px 20px ${item.color}30` : "none",
      transition:"all .22s cubic-bezier(.34,1.56,.64,1)",
      position:"relative", overflow:"hidden",
    }}>
      {selected && <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${item.color},transparent)`}}/>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
        <div style={{width:26,height:26,borderRadius:7,background:selected?item.color:`${item.color}25`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:selected?"#000":item.color}}>{item.logo}</div>
        {selected
          ? <span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,background:item.color,color:"#000"}}>✓ 선택됨</span>
          : <span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,background:item.free?"rgba(0,200,117,.12)":"rgba(245,158,11,.12)",color:item.free?"#00c875":"#f59e0b"}}>{item.free?"무료":"유료"}</span>
        }
      </div>
      <div style={{fontSize:11,fontWeight:700,color:selected?item.color:"var(--text)"}}>{item.label}</div>
      <div style={{fontSize:9,color:"var(--sub)",marginTop:2}}>{item.sub}</div>
    </button>
  );
}

function KeyInput({ k }: { k:any }) {
  const [val, setVal] = useState(() => localStorage.getItem(k.storageKey) || "");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  function save() {
    if (!val.trim()) return;
    localStorage.setItem(k.storageKey, val.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div style={{marginBottom:10,padding:"11px 13px",borderRadius:11,border:"1px solid var(--border)",background:"var(--input-bg)"}}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
        <div style={{width:22,height:22,borderRadius:6,background:`${k.color}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:k.color}}>{k.logo}</div>
        <span style={{fontSize:11,fontWeight:700,color:"var(--text)"}}>{k.label}</span>
        <a href={k.link} target="_blank" rel="noopener noreferrer" style={{marginLeft:"auto",fontSize:10,color:"var(--accent)",textDecoration:"none"}}>키 발급 →</a>
      </div>
      <div style={{display:"flex",gap:6}}>
        <input
          className="inp" type={show?"text":"password"} placeholder={k.placeholder}
          value={val} onChange={e=>setVal(e.target.value)}
          style={{flex:1,padding:"8px 11px",fontSize:12}}
        />
        <button onClick={()=>setShow(s=>!s)} style={{padding:"8px 10px",borderRadius:9,border:"1px solid var(--border)",background:"var(--card)",cursor:"pointer",fontSize:11,color:"var(--sub)"}}>
          {show?"숨김":"표시"}
        </button>
        <button onClick={save} style={{padding:"8px 14px",borderRadius:9,border:"none",background:saved?"#00c875":"var(--accent)",color:"#000",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",transition:"background .2s"}}>
          {saved?"✓":"저장"}
        </button>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes popIn{from{opacity:0;transform:translateX(-50%) scale(.92)}to{opacity:1;transform:translateX(-50%) scale(1)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes as{to{transform:rotate(360deg)}}
@keyframes spin{to{transform:rotate(360deg)}}

.dash.dark{
  --bg:#0a0e0a;--card:#111511;--card2:#181e18;--text:#e8f5e8;--sub:rgba(232,245,232,.45);
  --border:rgba(0,255,136,.1);--border2:rgba(0,255,136,.28);--b2:rgba(0,255,136,.28);
  --accent:#00ff88;--accent-dim:rgba(0,255,136,.08);--input-bg:rgba(0,255,136,.04);
  --err:#ef4444;--sidebar-bg:#080c08;--header-bg:rgba(8,12,8,.94);
}
.dash.light{
  --bg:#f0faf0;--card:#ffffff;--card2:#f5fbf5;--text:#0d1f0d;--sub:rgba(13,31,13,.5);
  --border:rgba(0,150,70,.12);--border2:rgba(0,150,70,.3);--b2:rgba(0,150,70,.3);
  --accent:#00a854;--accent-dim:rgba(0,168,84,.1);--input-bg:rgba(0,150,70,.04);
  --err:#dc2626;--sidebar-bg:#e8f5e8;--header-bg:rgba(240,250,240,.95);
}
.dash{width:100vw;height:100vh;overflow:hidden;display:flex;flex-direction:column;font-family:'Noto Sans KR',sans-serif;color:var(--text);background:var(--bg);transition:background .3s,color .3s;}
*::-webkit-scrollbar{width:4px;}*::-webkit-scrollbar-thumb{background:rgba(0,255,136,.15);border-radius:99px;}

.hd{height:56px;flex-shrink:0;display:flex;align-items:center;padding:0 20px;gap:14px;background:var(--header-bg);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);position:relative;z-index:30;}
.hd-logo{display:flex;align-items:center;gap:8px;text-decoration:none;}
.hd-logo-ico{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#00ff88,#00cc66);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.hd-logo-text{font-size:16px;font-weight:900;letter-spacing:.2em;color:var(--accent);}
.hd-center{display:flex;align-items:center;gap:10px;flex:1;justify-content:center;}
.hd-right{margin-left:auto;display:flex;align-items:center;gap:8px;}

.status-chip{display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;font-size:11px;font-weight:600;border:1px solid;}
.status-on{background:rgba(0,200,117,.1);color:#00c875;border-color:rgba(0,200,117,.3);}
.status-off{background:rgba(120,120,120,.08);color:#888;border-color:rgba(120,120,120,.2);}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.dot-on{background:#00c875;box-shadow:0 0 6px #00c875;}
.dot-off{background:#555;}
.quota-bar-bg{width:80px;height:5px;background:var(--border);border-radius:99px;overflow:hidden;}
.quota-bar{height:100%;background:var(--accent);border-radius:99px;transition:width .4s;}
.plan-chip{font-size:9px;font-weight:800;padding:3px 9px;border-radius:99px;letter-spacing:.1em;}
.plan-free{background:rgba(120,120,120,.1);color:#888;border:1px solid rgba(120,120,120,.2);}
.plan-basic{background:rgba(66,133,244,.1);color:#4285F4;border:1px solid rgba(66,133,244,.2);}
.plan-pro{background:rgba(0,200,117,.1);color:#00c875;border:1px solid rgba(0,200,117,.25);}
.ico-btn{width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:transparent;transition:all .2s;color:var(--sub);}
.ico-btn:hover{border-color:var(--border2);color:var(--text);background:var(--card);}
.logout-btn{padding:7px 14px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--sub);cursor:pointer;font-size:12px;font-weight:600;font-family:'Noto Sans KR',sans-serif;transition:all .2s;}
.logout-btn:hover{border-color:rgba(239,68,68,.4);color:#ef4444;background:rgba(239,68,68,.06);}
.user-chip{display:flex;align-items:center;gap:7px;padding:5px 11px;border-radius:99px;background:var(--card);border:1px solid var(--border);}
.avatar{width:22px;height:22px;border-radius:6px;background:var(--accent-dim);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:var(--accent);}
.user-chip>span{font-size:12px;font-weight:600;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

.body{flex:1;display:flex;overflow:hidden;}
.sidebar{width:190px;flex-shrink:0;background:var(--sidebar-bg);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 9px;gap:3px;overflow-y:auto;}
.nav-label{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);padding:4px 8px 8px;margin-bottom:2px;}
.nav-btn{display:flex;align-items:center;gap:9px;padding:10px 11px;border-radius:10px;border:none;cursor:pointer;width:100%;font-size:12px;font-weight:500;font-family:'Noto Sans KR',sans-serif;color:var(--sub);background:transparent;transition:all .18s;text-align:left;position:relative;}
.nav-btn:hover{background:var(--card);color:var(--text);}
.nav-btn.active{background:var(--accent-dim);color:var(--accent);font-weight:700;border:1px solid var(--border2);}
.nav-btn.active::before{content:'';position:absolute;left:0;top:20%;bottom:20%;width:3px;border-radius:99px;background:var(--accent);box-shadow:0 0 8px var(--accent);}
.nav-ico{font-size:15px;flex-shrink:0;}
.nav-badge{margin-left:auto;font-size:9px;font-weight:800;padding:2px 6px;border-radius:99px;background:var(--accent-dim);color:var(--accent);border:1px solid var(--border2);}
.sidebar-footer{margin-top:auto;padding-top:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;}
.today-card{padding:10px 13px;border-radius:11px;background:var(--card);border:1px solid var(--border);}
.today-num{font-size:28px;font-weight:900;color:var(--text);line-height:1;}
.today-label{font-size:9px;color:var(--sub);margin-top:3px;font-weight:600;}

.main{flex:1;display:flex;overflow:hidden;}
.center{flex:1;overflow-y:auto;padding:20px;min-width:0;}
.right-panel{width:260px;flex-shrink:0;overflow-y:auto;padding:16px;border-left:1px solid var(--border);display:flex;flex-direction:column;gap:14px;}
.rp-section{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 15px;}
.rp-title{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--sub);margin-bottom:10px;}

.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin-bottom:14px;transition:border-color .2s;}
.card:hover{border-color:var(--border2);}
.section-label{font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--sub);margin-bottom:12px;display:flex;align-items:center;gap:6px;}
.btn-main{display:inline-flex;align-items:center;gap:7px;padding:10px 18px;border-radius:10px;border:none;background:var(--accent);color:#000;cursor:pointer;font-size:12px;font-weight:800;font-family:'Noto Sans KR',sans-serif;transition:all .2s;}
.btn-main:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,255,136,.25);}
.btn-main:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none;}
.inp{width:100%;padding:10px 13px;border-radius:10px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:13px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:all .2s;}
.inp:focus{border-color:var(--border2);box-shadow:0 0 0 3px var(--accent-dim);}
.inp::placeholder{color:var(--sub);}
select.inp{appearance:auto;cursor:pointer;}.dark select.inp{color-scheme:dark;}.light select.inp{color-scheme:light;}
textarea.inp{resize:vertical;}
.spinner{width:13px;height:13px;border-radius:50%;border:2px solid rgba(0,0,0,.15);border-top-color:#000;animation:as 1s linear infinite;display:inline-block;vertical-align:middle;}

.badge{font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;}
.badge-ok{background:rgba(0,200,117,.1);color:#00c875;border:1px solid rgba(0,200,117,.25);}
.badge-pend{background:rgba(245,158,11,.1);color:#f59e0b;border:1px solid rgba(245,158,11,.25);}
.badge-fail{background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.2);}
.plat-btn{flex:1;padding:"16px 14px";border-radius:13px;border:2px solid;cursor:pointer;text-align:left;font-family:'Noto Sans KR',sans-serif;transition:all .2s;}
.plat-naver{border-color:#03C75A;background:rgba(3,199,90,.08);}
.plat-tistory{border-color:#FF6B35;background:rgba(255,107,53,.08);}
.acc-card{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:13px;border:1.5px solid var(--border);background:var(--card);animation:fadeUp .3s ease both;transition:border-color .2s;}
.hist-item{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border);animation:fadeUp .3s ease both;}
.warn-box{padding:11px 14px;border-radius:11px;font-size:12px;margin-bottom:12px;display:flex;align-items:center;gap:8px;line-height:1.5;}
.warn-yellow{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);color:#f59e0b;}
.warn-blue{background:rgba(66,133,244,.08);border:1px solid rgba(66,133,244,.2);color:#4285F4;}

.mob-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:100;padding:8px 8px 18px;gap:3px;background:var(--header-bg);border-top:1px solid var(--border);backdrop-filter:blur(20px);}
.mob-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 3px;border-radius:9px;border:none;cursor:pointer;background:transparent;font-family:'Noto Sans KR',sans-serif;transition:all .18s;}
.mob-btn.active{background:var(--accent-dim);}
.mob-icon{font-size:19px;}
.mob-label{font-size:9px;font-weight:600;color:var(--sub);}
.mob-btn.active .mob-label{color:var(--accent);}

@media(max-width:768px){
  .sidebar{display:none;}
  .right-panel{display:none;}
  .mob-bar{display:flex;}
  .center{padding:14px 12px 80px;}
  .hd-center .quota-bar-bg{display:none;}
}
`;

interface Props {
  user: PublyUser;
  onLogout: () => void;
  onAdminLogin: () => void;
  onThemeToggle: () => void;
  theme: string;
}

export default function DashboardPage({ user, onLogout, onAdminLogin, onThemeToggle, theme }: Props) {
  const [tab, setTab] = useState<Tab>("publish");
  const [botOnline, setBotOnline] = useState(false);
  const [platform, setPlatform] = useState<"naver"|"tistory">("naver");
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [history, setHistory] = useState<PublyHistory[]>([]);
  const [quota, setQuota] = useState<PublyQuota | null>(null);
  const [error, setError] = useState("");

  // 발행
  const [pubTitle, setPubTitle] = useState("");
  const [pubContent, setPubContent] = useState("");
  const [pubTags, setPubTags] = useState("");
  const [pubImageUrl, setPubImageUrl] = useState("");
  const [pubAccId, setPubAccId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [pubMsg, setPubMsg] = useState("");
  const [pubSub, setPubSub] = useState<"publish"|"write"|"accounts">("publish");

  // 글 생성
  const [adType, setAdType] = useState<"adpost"|"adsense">("adpost");
  const [targetChars, setTargetChars] = useState(1350);
  const [imgSource, setImgSource] = useState<"ai"|"upload"|"none">("ai");
  const [imgCountManual, setImgCountManual] = useState<number|null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genTitle, setGenTitle] = useState("");
  const [genContent, setGenContent] = useState("");
  const [genTags, setGenTags] = useState("");
  const [genImage, setGenImage] = useState("");
  const [genImgLoading, setGenImgLoading] = useState(false);
  // 글쓰기 스타일 + 페르소나
  const [selectedStyle, setSelectedStyle] = useState(()=>localStorage.getItem("publy_write_style")||"blog");
  const [selectedPersona, setSelectedPersona] = useState(()=>localStorage.getItem("publy_write_persona")||"none");
  const [customStylePrompt, setCustomStylePrompt] = useState(()=>localStorage.getItem("publy_custom_style")||"");
  const [titles, setTitles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("publy_adm_titles") || "[]"); } catch { return []; }
  });
  const [selectedTitle, setSelectedTitle] = useState("");
  const [loadingTitles, setLoadingTitles] = useState(false);

  // 계정 추가
  const [newPlatform, setNewPlatform] = useState<"naver"|"tistory">("naver");
  const [newUser, setNewUser] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newBlog, setNewBlog] = useState("");
  const [addingAcc, setAddingAcc] = useState(false);
  const [connectingId, setConnectingId] = useState<string|null>(null);

  // 설정
  const [writeAI, setWriteAI] = useState(() => localStorage.getItem("publy_write_ai") || "gemini");
  const [imageAI, setImageAI] = useState(() => localStorage.getItem("publy_image_ai") || "openai_img");

  const checkBot = useCallback(async () => {
    try {
      const r = await fetch(`${BOT}/health`, { signal: AbortSignal.timeout(3000) });
      setBotOnline(r.ok);
    } catch { setBotOnline(false); }
  }, []);

  useEffect(() => {
    checkBot();
    getAccounts(user.id).then(setAccounts);
    getHistory(user.id).then(setHistory);
    getQuota(user.id).then(q => q && setQuota(q));
    const interval = setInterval(checkBot, 30000);
    return () => clearInterval(interval);
  }, [checkBot, user.id]);

  // ── 200+ 카테고리 한국어→영어 이미지 프롬프트 ──────────
  const KO_EN_MAP:Record<string,string>={
    맛집:"delicious gourmet food beautiful plating restaurant warm lighting",음식:"delicious food dish beautiful presentation",요리:"cooking fresh ingredients cutting board kitchen herbs",카페:"cozy cafe coffee interior warm ambient pastry",커피:"coffee latte art ceramic cup morning steam",치킨:"crispy golden fried chicken korean food plate",피자:"pizza melted cheese fresh toppings italian",라면:"ramen noodle bowl hot steam broth toppings",삼겹살:"korean bbq pork belly grill sizzling smoke",회:"fresh sashimi seafood colorful plate ice",초밥:"sushi japanese fresh fish rice plate",파스타:"pasta italian tomato sauce herbs",브런치:"brunch cafe food table morning avocado eggs",스테이크:"steak beef grill plate fine dining",햄버거:"burger gourmet bun vegetables sauce",샐러드:"healthy salad fresh colorful vegetables bowl",케이크:"celebration cake dessert beautiful cream",빵:"fresh artisan bread bakery golden",디저트:"dessert sweet pastry cream fruit plate",마카롱:"macarons colorful french pastry",타르트:"tart pastry fruit cream elegant",아이스크림:"ice cream scoop colorful cone summer",도넛:"donuts glazed colorful sweet bakery",떡볶이:"tteokbokki korean street food red spicy rice cake",김밥:"kimbap seaweed rice roll colorful cross section",비빔밥:"bibimbap korean mixed rice bowl vegetables egg",냉면:"naengmyeon korean cold noodle bowl ice",갈비:"kalbi korean grilled ribs bbq",불고기:"bulgogi korean marinated beef grill sesame",된장찌개:"doenjang jjigae soybean paste stew clay pot",김치찌개:"kimchi jjigae stew pork red broth",해물:"seafood fresh shellfish shrimp crab",와인:"wine glass elegant bottle vineyard",맥주:"beer mug cold refreshing foam glass",막걸리:"korean rice wine makgeolli bottle cup",소주:"korean soju drink glass bottle",칵테일:"cocktail bar colorful garnish glass",초콜릿:"chocolate dark sweet confectionery",
    여행:"scenic travel destination beautiful landscape golden hour",관광:"tourism famous landmark architecture",해외여행:"international travel airplane passport suitcase",국내여행:"domestic korea scenic nature mountains",제주도:"jeju island volcanic landscape ocean cliffs",서울:"seoul city skyline namsan night view",부산:"busan haeundae beach ocean cliff bridge",강원도:"gangwon mountains forest nature snow",경주:"gyeongju historic temple bulguksa pagoda",전주:"jeonju hanok village traditional architecture",여수:"yeosu ocean night view bridge seafood",속초:"sokcho beach seoraksan mountains",춘천:"chuncheon lake mountain nature",강릉:"gangneung east sea beach coffee",통영:"tongyeong ocean cable car island",거제:"geoje island ocean cliff",남해:"namhae ocean blue village",담양:"damyang bamboo forest green",순천:"suncheon bay wetland sunset",일본:"tokyo japan shibuya neon cherry blossom",태국:"thailand bangkok temple tropical",베트남:"vietnam hoi an lanterns traditional street",발리:"bali indonesia temple rice terrace sunset",유럽:"europe historic architecture cobblestone",파리:"paris eiffel tower seine river sunset",호텔:"luxury hotel room interior elegant bed",숙소:"cozy accommodation room interior",펜션:"pension guesthouse countryside cozy",캠핑:"camping tent campfire stars nature",글램핑:"glamping luxury tent outdoor fairy lights",리조트:"resort pool tropical luxury",
    건강:"health wellness vitamins natural herbs",다이어트:"diet healthy food vegetables scale",운동:"exercise gym equipment weights fitness",헬스:"gym fitness dumbbells machines",요가:"yoga mat meditation calm nature",필라테스:"pilates reformer equipment studio",수영:"swimming pool water lane",달리기:"running shoes road park sunrise",등산:"hiking trail mountain forest backpack",뷰티:"beauty cosmetics makeup products palette",피부:"skincare serum cream bottle routine",헤어:"hair care shampoo salon tools",메이크업:"makeup brush palette foundation lipstick",스킨케어:"skincare products bottles cream serum",탈모:"hair treatment scalp care natural",영양제:"supplements vitamins capsules bottles",프로틴:"protein powder shaker gym",콜라겐:"collagen supplement beauty skin",비타민:"vitamin supplements colorful capsule",의료:"medical healthcare equipment sterile",병원:"hospital building professional clean",치과:"dental clinic teeth care",피부과:"dermatology clinic skincare treatment",
    재테크:"investment finance coins growth chart piggy bank",주식:"stock market chart trading graph trend",코인:"cryptocurrency bitcoin gold coin digital",비트코인:"bitcoin gold digital network circuit",ETF:"etf investment fund chart portfolio",부업:"side job laptop home office freelance",N잡:"multiple income laptop freelance gig",절약:"saving money coins jar budget planner",대출:"loan bank document contract pen",보험:"insurance document umbrella protection",청약:"apartment application document form",세금:"tax document calculator accounting",연말정산:"tax return document form calculator",
    부동산:"real estate property house document keys",아파트:"apartment building modern exterior",빌라:"villa house residential exterior garden",오피스텔:"officetel modern apartment interior",원룸:"studio apartment interior minimal",전세:"lease contract document keys",월세:"rental apartment document keys",분양:"new apartment construction modern",인테리어:"interior design modern minimalist furniture",리모델링:"home renovation interior before after",이사:"moving boxes cardboard tape packing",청소:"cleaning supplies spray bottle mop",정리:"organizing storage shelf neat minimal",
    IT:"technology digital computer code screen",AI:"artificial intelligence circuit board network",인공지능:"ai robot technology digital future",챗GPT:"chatgpt ai interface laptop",앱:"mobile app smartphone screen",스마트폰:"smartphone modern screen technology",노트북:"laptop computer desk workspace",코딩:"coding programming dark screen code",개발:"software development laptop code monitor",유튜브:"youtube studio camera ring light equipment",인스타그램:"instagram phone screen social media",블로그:"blog writing laptop cafe keyboard",게임:"gaming setup controller rgb monitor",드론:"drone aerial photography sky",스마트홈:"smart home device speaker automation",
    교육:"education books desk study knowledge",공부:"study books notebook pencil desk lamp",수능:"exam books pencil study desk",영어:"english learning books dictionary study",자격증:"certificate diploma achievement document",취업:"job resume briefcase professional laptop",이직:"career change resume laptop",면접:"interview professional suit document",독서:"reading book cozy armchair lamp",자기계발:"self development books journal planner",
    육아:"baby toys nursery soft colors stroller",아이:"children toys colorful playground",임신:"maternity baby items nursery soft",결혼:"wedding flowers venue decoration setup",웨딩:"wedding dress flowers bouquet ceremony",가족:"family gathering home table food",
    자동차:"car automobile road modern exterior",중고차:"used car dealership lot",전기차:"electric vehicle charging station modern",오토바이:"motorcycle bike road exterior",
    강아지:"cute puppy dog playing toy home",고양이:"cute cat kitten indoor cozy",반려동물:"pet companion home toys food bowl",토끼:"rabbit bunny cute fluffy indoor",
    패션:"fashion clothing outfit display stylish",쇼핑:"shopping retail store display bags",명품:"luxury brand handbag elegant display",신발:"shoes sneakers display clean",가방:"bag handbag leather elegant display",
    창업:"startup business office desk strategy",사업:"business meeting office professional",마케팅:"marketing strategy digital chart",프리랜서:"freelancer laptop home office coffee",유튜버:"youtube creator studio camera equipment",
    정부지원:"government document official stamp desk",지원금:"financial support money document",복지:"welfare care service document",
    자연:"nature landscape mountains forest scenic",꽃:"flowers colorful bloom garden spring",바다:"ocean sea waves sunset landscape",숲:"forest trees green peaceful path",산:"mountain peak scenic trail",봄:"spring cherry blossom bloom",여름:"summer beach ocean sunshine",가을:"autumn fall leaves colorful",겨울:"winter snow cold white landscape",
    골프:"golf course green club equipment",낚시:"fishing rod lake nature water",음악:"music instrument guitar piano",그림:"painting canvas brush art studio",사진:"photography camera lens equipment dslr",영화:"cinema popcorn screen ticket",
    명상:"meditation candle calm peaceful nature",힐링:"healing spa nature calm peaceful",스트레스:"stress relief tea candle calm",크리스마스:"christmas tree lights snow decoration",
    주방용품:"kitchen utensils cookware modern",가전제품:"home appliances refrigerator",생활용품:"household daily products containers",침구:"bedding pillow blanket cozy bedroom",가구:"furniture modern sofa desk chair",
    한우:"korean wagyu beef premium",굴비:"dried fish korean traditional",농산물:"farm produce vegetables harvest",수산물:"seafood fresh fish market",유기농:"organic farm natural produce",
    쿠팡:"ecommerce online shopping laptop",스마트스토어:"smart store ecommerce product",도매:"wholesale warehouse products boxes",
    법률:"law books gavel document professional",세무:"tax accounting calculator document",노무:"labor law document office",
    환경:"environment green nature eco",친환경:"eco friendly green natural organic",태양광:"solar panels rooftop renewable energy",
  };

  function buildImagePrompt(kw:string):string{
    const k=kw.trim();
    const NP="no people, no person, no face, no portrait, no human";
    const adB=adType==="adpost"
      ?"Korean lifestyle blog warm emotional photography, natural lighting, authentic"
      :"ultra realistic DSLR, editorial blog photo, 8K, magazine quality, natural lighting";
    const sorted=Object.keys(KO_EN_MAP).sort((a,b)=>b.length-a.length);
    for(const ko of sorted){if(k.includes(ko))return `${KO_EN_MAP[ko]}, ${NP}, ${adB}`;}
    if(/맛집|음식|카페|식당|요리|먹/.test(k))return `delicious korean food restaurant beautiful, ${NP}, ${adB}`;
    if(/여행|관광|호텔|숙소|비행기/.test(k))return `scenic travel destination golden hour, ${NP}, ${adB}`;
    if(/건강|운동|다이어트|헬스|요가/.test(k))return `health fitness wellness natural, ${NP}, ${adB}`;
    if(/주식|코인|재테크|투자|금융/.test(k))return `investment finance growth chart, ${NP}, ${adB}`;
    if(/부동산|아파트|전세|인테리어/.test(k))return `modern apartment real estate interior, ${NP}, ${adB}`;
    if(/뷰티|피부|메이크업|스킨케어/.test(k))return `skincare beauty cosmetics elegant, ${NP}, ${adB}`;
    if(/강아지|고양이|반려/.test(k))return `cute pet dog cat home cozy`;
    if(/육아|아기|임신|아이/.test(k))return `baby nursery toys soft pastel, ${NP}, ${adB}`;
    if(/취업|이직|직장|커리어/.test(k))return `career professional office laptop, ${NP}, ${adB}`;
    if(/창업|사업|마케팅/.test(k))return `startup business office strategy, ${NP}, ${adB}`;
    if(/IT|AI|코딩|기술/.test(k))return `technology digital AI circuit modern, ${NP}, ${adB}`;
    if(/정부|지원금|복지|혜택/.test(k))return `government document official professional, ${NP}, ${adB}`;
    if(/꽃|자연|바다|산|봄|여름|가을|겨울/.test(k))return `beautiful nature landscape seasonal, ${NP}, ${adB}`;
    if(/공부|교육|자격증/.test(k))return `study books desk lamp learning, ${NP}, ${adB}`;
    if(/패션|쇼핑|옷/.test(k))return `fashion clothing display stylish, ${NP}, ${adB}`;
    if(/명상|힐링|마음|스트레스/.test(k))return `meditation calm peaceful nature candle, ${NP}, ${adB}`;
    return `lifestyle blog concept natural editorial photo, ${NP}, ${adB}`;
  }

  function parseArr(text:string):string[]{
    const clean=text.replace(/```json|```/gi,"").trim();
    try{const m=clean.match(/\[[\s\S]*\]/);if(m){const p=JSON.parse(m[0]);if(Array.isArray(p))return p.map(String).filter((t:string)=>t.length>3);}}catch{}
    try{const p=JSON.parse(clean);if(Array.isArray(p))return p.map(String).filter((t:string)=>t.length>3);}catch{}
    return clean.split("\n").map((l:string)=>l.replace(/^[\d]+[).\s]+|^[-*•\s]+/,"").replace(/^[\s"']+|[\s"']+$/g,"").trim()).filter((l:string)=>l.length>4&&l.length<100);
  }

  // ── 마크다운 → 일반 텍스트 변환 ─────────────────────
  function stripMarkdown(text:string):string{
    const markers=["[FAQ시작]","[FAQ끝]","[참고자료시작]","[참고자료끝]","[관련글시작]","[관련글끝]"];
    const ph:[string,string][]=markers.map((m,i)=>[`XSECMARK${i}X`,m]);
    ph.forEach(([k,v])=>{text=text.split(v).join(k);});
    const h2Lines:string[]=[];
    text=text.replace(/^## .+$/gm,match=>{const idx=h2Lines.length;h2Lines.push(match);return'XH2LINE'+idx+'X';});
    text=text
      .replace(/[一-鿿㐀-䶿]/g,"").replace(/[\u3040-\u30FF]/g,"")
      .replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s.,!?;:()\-\'".\[\]%@#&+=/\\~`|<>{}^_$\n]/g,"")
      .replace(/\*{2,}/g,"").replace(/^#{3,}\s+/gm,"").replace(/^[-*]\s+/gm,"")
      .replace(/^\d+\.\s+/gm,"").replace(/_{2,}/g,"").replace(/ {2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();
    h2Lines.forEach((line,idx)=>{text=text.split('XH2LINE'+idx+'X').join(line);});
    ph.forEach(([k,v])=>{text=text.split(k).join(v);});
    return text;
  }

  // ── 카테고리별 가이드 ────────────────────────────────
  function getCategoryGuide(kw:string,title:string):string{
    const k=(kw+" "+(title||"")).toLowerCase();
    if(/맛집|음식|카페|식당|요리|레스토랑|빵|디저트|커피|치킨|피자|라면/.test(k))
      return `[맛집/음식]\n- 직접 방문한 것처럼: 분위기, 서비스, 웨이팅\n- 메뉴 맛 생생하게: 식감, 향, 간의 세기, 첫 한 입 느낌\n- 가격, 주차, 영업시간, 재방문 의향\n- 단점도 솔직하게`;
    if(/it|앱|ai|테크|스마트폰|노트북|컴퓨터|챗gpt/.test(k))
      return `[IT/테크]\n- 전문 용어 쉬운 말로 풀이\n- 실제 사용 시나리오와 단계별 설명\n- 장단점 비교, 비슷한 제품과 비교\n- 초보자도 따라할 수 있게`;
    if(/리뷰|후기|사용기|체험|써봤|먹어봤|구매/.test(k))
      return `[리뷰/후기]\n- 사용 전 기대 → 실제 경험 구조\n- 장점 3개 이상, 단점 2개 이상 균형있게\n- 구체적 수치로 효과 표현\n- "이런 분 사세요/사지 마세요" 명확하게`;
    if(/여행|관광|호텔|숙소|제주|부산|해외/.test(k))
      return `[여행]\n- 교통편, 비용, 소요시간\n- 꼭 가야 할 명소 TOP5\n- 현지 맛집, 숨은 명소\n- 예산 총정리, 시즌별 추천`;
    if(/건강|다이어트|운동|헬스|피부|탈모/.test(k))
      return `[건강/의료]\n- 전문 용어 쉽게 풀이\n- 집에서 가능 vs 병원 가야 하는 경우 구분\n- 잘못된 상식 바로잡기\n- 연령/성별 다른 접근법`;
    if(/재테크|투자|주식|부동산|절약|금융/.test(k))
      return `[재테크/금융]\n- 초보자도 이해하는 쉬운 설명\n- 실제 숫자 예시 포함\n- 리스크와 수익률 균형있게\n- 연령대별 다른 전략`;
    if(/육아|아이|아기|엄마|임신|유아/.test(k))
      return `[육아/맘]\n- 같은 부모 입장에서 공감\n- 월령/나이별 구체적 정보\n- 안전성 최우선\n- 지치는 부모 위한 공감과 위로`;
    return `[정보/일상]\n- 독자가 몰랐던 새로운 정보\n- 일상에서 바로 써먹는 실용 팁\n- 연령/상황별 활용법`;
  }

  async function callAI(prompt:string):Promise<string>{
    const ai=localStorage.getItem("publy_write_ai")||"gemini";
    if(ai==="gemini"){
      const key=localStorage.getItem("publy_gemini_key")||"";if(!key)throw new Error("Gemini API 키 없음");
      for(const model of GEMINI_MODELS_ADM){try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:8000}}),signal:AbortSignal.timeout(60000)});if(!r.ok)continue;const d=await r.json();const t=d.candidates?.[0]?.content?.parts?.[0]?.text||"";if(t)return t;}catch{continue;}}
      throw new Error("Gemini 실패");
    }
    if(ai==="groq"){
      const key=localStorage.getItem("publy_groq_key")||"";if(!key)throw new Error("Groq API 키 없음");
      const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.1-70b-versatile",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(60000)});
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"Groq 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    if(ai==="openai"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI API 키 없음");
      const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o",max_tokens:8000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(60000)});
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"OpenAI 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    throw new Error("AI 미선택");
  }

  async function generateImage(kw:string):Promise<string>{
    const imgPrompt=buildImagePrompt(kw);
    const ai=localStorage.getItem("publy_image_ai")||"openai_img";
    if(ai==="openai_img"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI 키 없음");
      const r=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"dall-e-3",prompt:imgPrompt,n:1,size:"1024x1024"}),signal:AbortSignal.timeout(60000)});
      if(!r.ok){const e=await r.json();throw new Error("DALL-E: "+(e.error?.message||r.status));}
      const d=await r.json();return d.data?.[0]?.url||"";
    }
    if(ai==="replicate"){
      const key=localStorage.getItem("publy_replicate_key")||"";if(!key)throw new Error("Replicate 키 없음");
      const pr=await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({input:{prompt:imgPrompt,num_outputs:1,aspect_ratio:"16:9"}}),signal:AbortSignal.timeout(30000)});
      if(!pr.ok){const e=await pr.json();throw new Error("Replicate: "+(e.detail||pr.status));}
      const pred=await pr.json();const pollUrl=pred.urls?.get;if(!pollUrl)throw new Error("Replicate 응답 오류");
      for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,2000));const res=await fetch(pollUrl,{headers:{"Authorization":`Bearer ${key}`}});const data=await res.json();if(data.status==="succeeded")return data.output?.[0]||"";if(data.status==="failed")throw new Error("Replicate 실패");}
      throw new Error("Replicate 타임아웃");
    }
    throw new Error("이미지 AI 미선택");
  }

  // 글자수 기반 이미지 추천 수량
  function recommendImageCount(content:string):number{
    return Math.max(1, Math.floor(content.length/200));
  }

  function getActiveImages():string[]{
    if(imgSource==="upload")return uploadedImages;
    return generatedImages;
  }

  // 본문을 이미지 수에 맞게 섹션으로 분할
  function splitContentWithImages(content:string, images:string[]):{text:string,img?:string}[]{
    if(!images.length||imgSource==="none")return [{text:content}];
    const charsPerSection=Math.floor(content.length/(images.length+1));
    const sections:{text:string,img?:string}[]=[];
    let pos=0;
    for(let i=0;i<images.length;i++){
      const end=Math.min(pos+charsPerSection, content.length);
      // 문단 경계 찾기
      const breakAt=content.lastIndexOf("\n",end)||end;
      sections.push({text:content.slice(pos,breakAt>pos?breakAt:end).trim()});
      sections.push({text:"", img:images[i]});
      pos=breakAt>pos?breakAt:end;
    }
    if(pos<content.length)sections.push({text:content.slice(pos).trim()});
    return sections;
  }

  async function handleGenerateImages(count:number){
    if(imgSource==="none"||imgSource==="upload")return;
    setGenImgLoading(true);
    const imgs:string[]=[];
    try{
      for(let i=0;i<count;i++){
        const url=await generateImage(keyword||selectedTitle);
        imgs.push(url);
        setGeneratedImages([...imgs]);
      }
    }catch(e:any){alert("이미지 생성 실패: "+e.message);}
    finally{setGenImgLoading(false);}
  }

  function handleImageUpload(e:React.ChangeEvent<HTMLInputElement>){
    const files=e.target.files;
    if(!files)return;
    Array.from(files).forEach(file=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        if(ev.target?.result)setUploadedImages(prev=>[...prev,ev.target!.result as string]);
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleGenerateTitles(reset=false){
    if(!keyword.trim()){alert("키워드를 입력하세요");return;}
    if(reset)setTitles([]);
    setLoadingTitles(true);
    const isAdpost=adType==="adpost";
    const prompt=isAdpost
      ?`당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${keyword.trim()}"\n목적: 네이버 애드포스트 클릭률 극대화\n\n반드시 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드를 자연스럽게 포함\n- 25~40자, 친근하고 감성적\n- 숫자 필수 (BEST 7, TOP 5 등)\n- "솔직히", "이것만", "나만 알던" 등 클릭 유발\n- 경험 공유형, 2026 트렌드\n\nJSON 배열만 반환.`
      :`당신은 구글 애드센스 최적화 SEO 전문가입니다.\n키워드: "${keyword.trim()}"\n목적: 구글 검색 상위노출 + 애드센스 클릭률 극대화\n\n반드시 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드를 자연스럽게 포함\n- 30~50자, 정보성·전문적 톤\n- 검색의도 반영 (방법, 가이드, 총정리)\n- "완벽 가이드", "총정리", "이유 5가지" 등\n- 영어 혼용 자연스럽게 가능\n\nJSON 배열만 반환.`;
    try{
      const text=await callAI(prompt);
      const parsed=parseArr(text);
      if(!parsed.length)throw new Error("제목 파싱 실패");
      setTitles(prev=>{
        const combined=[...parsed,...prev];
        if(combined.length>=90){localStorage.setItem("publy_adm_titles",JSON.stringify(parsed));return parsed;}
        localStorage.setItem("publy_adm_titles",JSON.stringify(combined));
        return combined;
      });
    }catch(e:any){alert("제목 생성 실패: "+e.message);}
    finally{setLoadingTitles(false);}
  }

  async function handleGenerate(){
    if(!selectedTitle&&!keyword)return;
    const title=selectedTitle||keyword;
    setGenerating(true);setGenImage("");
    const isAdpost=adType==="adpost";
    const categoryGuide=getCategoryGuide(keyword,title);
    const styleMap:Record<string,string>={
      blog:"친근하고 자연스러운 블로그 말투로 작성해줘. 독자에게 말을 거는 듯한 느낌으로, 공감대를 형성해줘.",
      formal:"신뢰감 있고 전문적인 정보 전달 문체로 작성해줘. 객관적인 사실을 바탕으로 유용한 정보를 제공해줘.",
      sns:"짧고 감각적인 SNS 스타일로 작성해줘. 이모지를 적절히 활용하고 공감과 감성을 자극하는 문체로.",
      news:"뉴스 기사처럼 객관적이고 사실적으로 작성해줘. 핵심 정보를 앞에 배치(역피라미드), 인용과 수치를 적극 활용해줘.",
      story:"흥미진진한 스토리텔링 형식으로 작성해줘. 독자가 몰입할 수 있도록 서사 구조를 활용하고, 구체적인 사례를 들어줘.",
      custom:customStylePrompt,
    };
    const personaMap:Record<string,string>={
      none:"",
      young_woman:"20대 여성이 친한 친구에게 카톡 보내듯 친근하고 감성적으로. '~했어요', '~더라고요' 말투로.",
      young_man:"20대 남성이 친구에게 솔직하게 말하듯. 직접적이고 핵심만 짚는 문체로.",
      middle_woman:"40대 주부가 또래 친구에게 진심으로 알려주듯 따뜻하고 실용적으로.",
      middle_man:"40대 직장인 남성이 후배에게 조언해주듯 신뢰감 있고 경험 기반으로.",
      reporter:"신문 기자가 심층 취재 기사 쓰듯 객관적이고 사실 기반으로. 역피라미드 구조.",
      teacher:"친절한 선생님이 학생에게 설명해주듯 차근차근, 이해하기 쉽게.",
      expert:"해당 분야 전문가가 신뢰감 있게. 전문 지식을 쉬운 말로 풀어서.",
    };
    const styleInstruction=[styleMap[selectedStyle]||styleMap.blog, personaMap[selectedPersona]||""].filter(Boolean).join("\n");
    const adGuide=isAdpost
      ?"[수익 최적화] 네이버 애드포스트 CPM 최적화: 체류 시간 늘리는 스토리 구성, 감성적 공감 유도"
      :"[수익 최적화] 구글 애드센스 CPC 최적화: 클릭 유도 문구, 정보성 키워드 밀도 높게";
    const contentPrompt=`당신은 대한민국 최고의 블로그 작가입니다. 친구한테 카톡 보내듯, 기자가 르포 기사 쓰듯 — 가장 자연스럽고 생생한 글을 씁니다.

키워드: "${keyword}"
글 제목: "${title}"
목표 글자수: ${targetChars}자 이상

${categoryGuide}

[공통 원칙]
- AI 티 절대 금지: "저도 처음엔 몰랐는데요", "솔직히 말하면", "이거 써보니까"
- 독자에게 말 걸기: "혹시 이런 거 고민해보셨나요?", "아마 많이들 궁금하셨을 텐데"
- 막연한 표현 금지 → 구체적 수치, 가격, 기간으로
- 문장 끝 다양하게: "~해요", "~거든요", "~더라고요", "~잖아요"
- 반드시 ${targetChars}자 이상 작성
- ⚠️ 별표(*) 절대 금지 — **강조** 전부 금지
- 소제목은 반드시 ## 소제목 형식으로 작성 (4~6개)
- ⚠️ 대시(-) 목록 절대 금지
- ⚠️ 언더바(_) 절대 금지
- SEO: 키워드 자연스럽게 7회 이상
- 한자/중국어/일본어 절대 금지

[글쓰기 스타일]
${styleInstruction}

${adGuide}

[태그 형식]
본문 작성 후 맨 앞에 반드시 아래 형식으로 태그를 먼저 써줘:
태그: 태그1, 태그2, 태그3, 태그4, 태그5

[필수 섹션 - 본문 끝에 반드시 추가]
[FAQ시작]
Q1: (독자가 가장 많이 궁금해하는 질문)
A1: (구체적이고 실용적인 답변)
Q2: (질문 2)
A2: (답변)
Q3: (질문 3)
A3: (답변)
[FAQ끝]

[관련글시작]
POST1: (연관 주제 블로그 제목 1)|(이 글을 읽으면 좋은 이유)
POST2: (연관 주제 블로그 제목 2)|(이유)
POST3: (연관 주제 블로그 제목 3)|(이유)
[관련글끝]`;
    try{
      const text=await callAI(contentPrompt);
      const cleaned=stripMarkdown(text);
      const tgm=cleaned.match(/태그[:\s]*([^\n]+)/);
      const bm=cleaned.match(/태그[^\n]*\n([\s\S]+)/);
      setGenTitle(title);
      if(tgm)setGenTags(tgm[1].trim());
      const body=bm?bm[1].trim():cleaned;
      setGenContent(body);
      localStorage.setItem("publy_write_style",selectedStyle);
      localStorage.setItem("publy_write_persona",selectedPersona);
      if(customStylePrompt)localStorage.setItem("publy_custom_style",customStylePrompt);
      // 이미지 수량 계산
      const recCount=imgCountManual??recommendImageCount(body);
      if(imgSource==="ai"&&recCount>0){
        setGenImgLoading(true);setGeneratedImages([]);
        const imgs:string[]=[];
        try{
          for(let i=0;i<recCount;i++){
            const url=await generateImage(keyword||selectedTitle);
            imgs.push(url);setGeneratedImages([...imgs]);
          }
        }catch(e:any){alert("이미지 생성 실패: "+e.message);}
        finally{setGenImgLoading(false);}
      }
    }catch(e:any){alert("본문 생성 실패: "+e.message);}
    finally{setGenerating(false);}
  }

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
              <div className="today-card" style={{ background: "var(--accent-dim)", borderColor: "var(--border2)" }}>
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
                      <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 15px", borderRadius: 13, cursor: "pointer", marginBottom: 8, background: pubAccId === a.id ? "var(--accent-dim)" : "var(--bg)", border: `1.5px solid ${pubAccId === a.id ? "var(--accent)" : "var(--border)"}`, transition: "all .2s" }}>
                        <input type="radio" name="pacc" checked={pubAccId === a.id} onChange={() => setPubAccId(a.id)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{a.username}</span>
                        {a.blog_name && <span style={{ fontSize: 11, color: "var(--sub)" }}>({a.blog_name})</span>}
                        <span style={{ marginLeft: "auto", fontSize: 10, padding: "2px 9px", borderRadius: 99, background: "var(--accent-dim)", color: "var(--accent)", fontWeight: 800 }}>✅ 연결됨</span>
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
                    <div style={{ marginTop: 10, padding: "13px 16px", borderRadius: 13, background: pubMsg.includes("✅") ? "var(--accent-dim)" : "rgba(255,107,107,.08)", border: `1px solid ${pubMsg.includes("✅") ? "var(--border2)" : "rgba(255,107,107,.2)"}`, fontSize: 13, fontWeight: 600, color: pubMsg.includes("✅") ? "var(--accent)" : "var(--err)" }}>
                      {pubMsg}
                    </div>
                  )}
                </div>
              )}

              {/* ───── 글 생성 ───── */}
              {tab === "write" && (
                <div style={{ animation: "fadeUp .3s ease both" }}>
                  <div>
                    {/* 애드타입 선택 */}
                    <div className="card" style={{padding:"18px 22px",marginBottom:14}}>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sub)",marginBottom:10}}>🎯 수익화 목적 선택</div>
                      <div style={{display:"flex",gap:10}}>
                        {([
                          {id:"adpost",label:"📰 네이버 애드포스트",sub:"감성적·경험 공유형, 1200~1500자",color:"#03C75A"},
                          {id:"adsense",label:"🔍 구글 애드센스",sub:"정보성·SEO 최적화, 1500자+",color:"#4285F4"},
                        ] as const).map(t=>(
                          <button key={t.id} onClick={()=>setAdType(t.id)} style={{flex:1,padding:"12px 14px",borderRadius:13,border:`2px solid ${adType===t.id?t.color:"var(--border)"}`,background:adType===t.id?`${t.color}15`:"var(--input-bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .18s"}}>
                            <div style={{fontSize:13,fontWeight:700,color:adType===t.id?t.color:"var(--text)",marginBottom:3}}>{t.label}</div>
                            <div style={{fontSize:10,color:"var(--sub)"}}>{t.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 키워드 입력 */}
                    <div className="card" style={{padding:"20px 22px",marginBottom:14}}>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sub)",marginBottom:10}}>🔍 키워드 입력</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 100px",gap:9,marginBottom:10}}>
                        <div>
                          <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,display:"block",marginBottom:3}}>키워드</label>
                          <input className="inp" style={{width:"100%",padding:"11px 13px",fontSize:14}} placeholder="예: 강남 맛집, 다이어트 방법, 제주도 여행..." value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGenerateTitles(true)}/>
                        </div>
                        <div>
                          <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,display:"block",marginBottom:3}}>플랫폼</label>
                          <select className="inp" style={{width:"100%",padding:"11px 12px"}} value={platform} onChange={e=>setPlatform(e.target.value as any)}>
                            <option value="naver">네이버</option><option value="tistory">티스토리</option>
                          </select>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button className="btn-main" onClick={()=>handleGenerateTitles(true)} disabled={loadingTitles||!keyword}>
                          {loadingTitles?<><span className="spinner"/>생성 중...</>:<>⭐ 제목 30개 추천</>}
                        </button>
                        {titles.length>0&&<button className="btn-main" style={{background:"rgba(99,102,241,.15)",color:"#818cf8",border:"1px solid rgba(99,102,241,.3)"}} onClick={()=>handleGenerateTitles(false)} disabled={loadingTitles}>
                          {titles.length>=90?"🔄 초기화 후 재생성":"➕ 30개 추가"}
                        </button>}
                        {titles.length>0&&<button onClick={()=>{setTitles([]);setSelectedTitle("");localStorage.removeItem("publy_adm_titles");}} style={{padding:"8px 12px",borderRadius:9,border:"1px solid rgba(239,68,68,.3)",background:"rgba(239,68,68,.08)",color:"#ef4444",cursor:"pointer",fontSize:11,fontWeight:700}}>🗑 초기화</button>}
                      </div>
                      {titles.length>0&&(
                        <div style={{marginTop:9,display:"flex",alignItems:"center",gap:8}}>
                          <div style={{flex:1,height:5,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${(titles.length/90)*100}%`,background:titles.length>=90?"#ef4444":"var(--accent)",borderRadius:99,transition:"width .4s"}}/>
                          </div>
                          <span style={{fontSize:10,color:titles.length>=90?"#ef4444":"var(--sub)",fontFamily:"monospace",flexShrink:0}}>{titles.length}/90{titles.length>=90?" — 초기화 후 재생성":""}</span>
                        </div>
                      )}
                    </div>

                    {/* 제목 목록 */}
                    {titles.length>0&&(
                      <div className="card" style={{padding:"20px 22px",marginBottom:14}}>
                        <div style={{fontSize:10,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sub)",marginBottom:10}}>✨ 제목 선택 (클릭하세요)</div>
                        {selectedTitle&&(
                          <div style={{padding:"9px 13px",borderRadius:10,background:"var(--accent-dim)",border:"1px solid var(--b2)",marginBottom:11,fontSize:13,fontWeight:700,color:"var(--accent)"}}>
                            ✅ 선택됨: {selectedTitle}
                          </div>
                        )}
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:8,maxHeight:380,overflowY:"auto"}}>
                          {titles.map((t,i)=>(
                            <button key={`${t}-${i}`} onClick={()=>setSelectedTitle(t)} style={{padding:"11px 13px",borderRadius:11,border:`1.5px solid ${selectedTitle===t?"var(--accent)":"var(--border)"}`,background:selectedTitle===t?"var(--accent-dim)":"var(--input-bg)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s",position:"relative"}}>
                              <div style={{fontSize:9,color:selectedTitle===t?"var(--accent)":"var(--sub)",marginBottom:4,fontFamily:"monospace"}}>#{titles.length-i}</div>
                              <div style={{fontSize:12,fontWeight:600,color:selectedTitle===t?"var(--accent)":"#e2e8f0",lineHeight:1.5}}>{t}</div>
                              {selectedTitle===t&&<div style={{position:"absolute",top:8,right:8,width:18,height:18,borderRadius:"50%",background:"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#000",fontWeight:900}}>✓</div>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 본문+이미지 생성 */}
                    {(selectedTitle||keyword)&&(
                      <div className="card" style={{padding:"20px 22px",marginBottom:14}}>
                        <div style={{fontSize:10,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sub)",marginBottom:10}}>⚙️ 생성 설정</div>

                        {/* 목표 글자수 */}
                        <div style={{marginBottom:12}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                            <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,textTransform:"uppercase"}}>목표 글자수</label>
                            <span style={{fontSize:11,fontWeight:700,color:"var(--accent)"}}>{targetChars.toLocaleString()}자</span>
                          </div>
                          <input type="range" min={1200} max={1500} step={50} value={targetChars} onChange={e=>setTargetChars(Number(e.target.value))} style={{width:"100%",accentColor:"var(--accent)"}}/>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"var(--sub)",marginTop:3}}>
                            <span>1200자</span><span>1350자</span><span>1500자</span>
                          </div>
                        </div>

                        {/* 이미지 소스 */}
                        <div style={{marginBottom:12}}>
                          <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,display:"block",marginBottom:6,textTransform:"uppercase"}}>이미지 소스</label>
                          <div style={{display:"flex",gap:8}}>
                            {([{id:"ai",label:"🤖 AI 생성"},{id:"upload",label:"📁 내 이미지"},{id:"none",label:"🚫 없음"}] as const).map(s=>(
                              <button key={s.id} onClick={()=>setImgSource(s.id)} style={{flex:1,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${imgSource===s.id?"var(--accent)":"var(--border)"}`,background:imgSource===s.id?"var(--accent-dim)":"var(--input-bg)",cursor:"pointer",fontSize:11,fontWeight:600,color:imgSource===s.id?"var(--accent)":"var(--sub)",fontFamily:"inherit",transition:"all .15s"}}>
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 업로드 */}
                        {imgSource==="upload"&&(
                          <div style={{marginBottom:12}}>
                            <label style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:10,border:"1.5px dashed var(--b2)",background:"var(--accent-dim)",cursor:"pointer"}}>
                              <span style={{fontSize:18}}>📁</span>
                              <span style={{fontSize:12,color:"var(--accent)",fontWeight:600}}>클릭해서 이미지 선택 (여러장 가능)</span>
                              <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{display:"none"}}/>
                            </label>
                            {uploadedImages.length>0&&(
                              <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                                {uploadedImages.map((img,i)=>(
                                  <div key={i} style={{position:"relative"}}>
                                    <img src={img} alt="" style={{width:60,height:60,objectFit:"cover",borderRadius:8,border:"1px solid var(--b)"}}/>
                                    <button onClick={()=>setUploadedImages(prev=>prev.filter((_,j)=>j!==i))} style={{position:"absolute",top:-4,right:-4,width:16,height:16,borderRadius:"50%",background:"#ef4444",border:"none",color:"#fff",cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {selectedTitle&&<div style={{padding:"9px 12px",borderRadius:9,background:"var(--input-bg)",marginBottom:10,fontSize:12}}>선택 제목: <strong style={{color:"var(--accent)"}}>{selectedTitle}</strong></div>}

                        {/* 글쓰기 스타일 */}
                        <div style={{marginBottom:12}}>
                          <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,display:"block",marginBottom:7,textTransform:"uppercase"}}>✍️ 글쓰기 스타일</label>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                            {([
                              {id:"blog",label:"📝 블로그 친근체"},{id:"formal",label:"📰 정보성 격식체"},
                              {id:"sns",label:"📱 SNS 감성체"},{id:"news",label:"🗞️ 뉴스 기사체"},
                              {id:"story",label:"✨ 스토리텔링체"},{id:"custom",label:"✏️ 직접 입력"},
                            ] as const).map(s=>(
                              <button key={s.id} onClick={()=>setSelectedStyle(s.id)}
                                style={{padding:"7px 8px",borderRadius:9,border:`1.5px solid ${selectedStyle===s.id?"var(--accent)":"var(--border)"}`,background:selectedStyle===s.id?"var(--accent-dim)":"var(--input-bg)",cursor:"pointer",fontSize:10,fontWeight:600,color:selectedStyle===s.id?"var(--accent)":"var(--sub)",fontFamily:"inherit",transition:"all .15s",textAlign:"left"}}>
                                {s.label}
                              </button>
                            ))}
                          </div>
                          {selectedStyle==="custom"&&(
                            <textarea value={customStylePrompt} onChange={e=>setCustomStylePrompt(e.target.value)}
                              placeholder="예: 20대 직장인에게 친근하게, 유머를 섞어서 작성해줘..."
                              className="inp" rows={2} style={{marginTop:7,fontSize:11,resize:"none"}}/>
                          )}
                        </div>

                        {/* 페르소나 */}
                        <div style={{marginBottom:12}}>
                          <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,display:"block",marginBottom:7,textTransform:"uppercase"}}>🎭 화자 페르소나</label>
                          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                            {([
                              {id:"none",label:"🙂 기본"},{id:"young_woman",label:"👩 20대 여성"},
                              {id:"young_man",label:"👨 20대 남성"},{id:"middle_woman",label:"👩‍🦳 40대 여성"},
                              {id:"middle_man",label:"👨‍🦳 40대 남성"},{id:"reporter",label:"📰 기자"},
                              {id:"teacher",label:"👨‍🏫 선생님"},{id:"expert",label:"🎓 전문가"},
                            ] as const).map(p=>(
                              <button key={p.id} onClick={()=>setSelectedPersona(p.id)}
                                style={{padding:"5px 10px",borderRadius:99,border:`1.5px solid ${selectedPersona===p.id?"var(--accent)":"var(--border)"}`,background:selectedPersona===p.id?"var(--accent-dim)":"transparent",cursor:"pointer",fontSize:10,fontWeight:600,color:selectedPersona===p.id?"var(--accent)":"var(--sub)",fontFamily:"inherit",transition:"all .15s"}}>
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button className="btn-main" onClick={handleGenerate} disabled={generating}>
                          {generating?<><span className="spinner"/>AI 작성 중...</>:<>✍️ 본문 + 이미지 생성</>}
                        </button>
                      </div>
                    )}

                    {/* 생성 결과 */}
                    {genContent&&(
                      <>
                        {/* 미리보기 모달 */}
                        {showPreview&&(
                          <div style={{position:"fixed",inset:0,zIndex:999,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowPreview(false)}>
                            <div style={{width:"100%",maxWidth:680,maxHeight:"90vh",overflowY:"auto",background:"#fff",borderRadius:16,padding:"32px 24px"}} onClick={e=>e.stopPropagation()}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                                <div style={{fontSize:12,color:"#888",fontWeight:600}}>📱 구독자 미리보기</div>
                                <button onClick={()=>setShowPreview(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#888"}}>✕</button>
                              </div>
                              <div style={{fontFamily:"'Apple SD Gothic Neo','Malgun Gothic',sans-serif"}}>
                                <h1 style={{fontSize:22,fontWeight:700,color:"#191919",lineHeight:1.4,marginBottom:16}}>{genTitle}</h1>
                                {genTags&&<div style={{marginBottom:16,display:"flex",flexWrap:"wrap",gap:6}}>
                                  {genTags.split(",").map((t,i)=><span key={i} style={{fontSize:12,padding:"3px 10px",borderRadius:99,background:"#f1f3f5",color:"#495057"}}>#{t.trim()}</span>)}
                                </div>}
                                {getActiveImages()[0]&&<img src={getActiveImages()[0]} alt="" style={{width:"100%",maxHeight:300,objectFit:"cover",borderRadius:8,marginBottom:20}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>}
                                {splitContentWithImages(genContent,getActiveImages().slice(1)).map((section,i)=>(
                                  <div key={i}>
                                    {section.img
                                      ?<img src={section.img} alt="" style={{width:"100%",maxHeight:260,objectFit:"cover",borderRadius:8,margin:"16px 0"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                      :<div style={{fontSize:15,color:"#333",lineHeight:1.9,whiteSpace:"pre-wrap",marginBottom:8}}>{section.text}</div>
                                    }
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="card" style={{padding:"20px 22px",marginBottom:14}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11,flexWrap:"wrap",gap:7}}>
                            <div style={{fontSize:10,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sub)",marginBottom:0}}>🎨 생성 결과</div>
                            <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                              <span style={{fontSize:10,padding:"3px 9px",borderRadius:99,background:"var(--accent-dim)",color:"var(--accent)",fontWeight:700}}>
                                {genContent.length.toLocaleString()}자 · 추천 {recommendImageCount(genContent)}장
                              </span>
                              <button onClick={()=>setShowPreview(true)} style={{padding:"5px 12px",borderRadius:9,border:"1px solid var(--b2)",background:"var(--accent-dim)",color:"var(--accent)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                                👁️ 미리보기
                              </button>
                            </div>
                          </div>

                          {/* 이미지 수량 조절 */}
                          {imgSource!=="none"&&(
                            <div style={{marginBottom:12,padding:"10px 14px",borderRadius:10,background:"var(--input-bg)",border:"1px solid var(--b)"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                                <label style={{fontSize:10,color:"var(--sub)",fontWeight:700}}>🖼️ 이미지 수량 (200자당 1장 기준)</label>
                                <div style={{display:"flex",alignItems:"center",gap:7}}>
                                  <span style={{fontSize:11,fontWeight:700,color:"var(--accent)"}}>{imgCountManual??recommendImageCount(genContent)}장</span>
                                  {imgCountManual!==null&&<button onClick={()=>setImgCountManual(null)} style={{fontSize:9,padding:"2px 7px",borderRadius:6,border:"1px solid var(--b)",background:"transparent",color:"var(--sub)",cursor:"pointer",fontFamily:"inherit"}}>자동</button>}
                                </div>
                              </div>
                              <input type="range" min={0} max={20} step={1} value={imgCountManual??recommendImageCount(genContent)} onChange={e=>setImgCountManual(Number(e.target.value))} style={{width:"100%",accentColor:"var(--accent)"}}/>
                              {imgSource==="ai"&&(
                                <button onClick={()=>handleGenerateImages(imgCountManual??recommendImageCount(genContent))} disabled={genImgLoading}
                                  style={{marginTop:8,padding:"6px 14px",borderRadius:9,border:"none",background:"var(--accent)",color:"#000",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
                                  {genImgLoading?<><span className="spinner" style={{borderTopColor:"#000",borderColor:"rgba(0,0,0,.2)"}}/>생성 중...</>:"🔄 이미지 재생성"}
                                </button>
                              )}
                            </div>
                          )}

                          {/* 이미지 갤러리 */}
                          {getActiveImages().length>0&&(
                            <div style={{marginBottom:12}}>
                              <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,display:"block",marginBottom:6,textTransform:"uppercase"}}>
                                🖼️ 이미지 {getActiveImages().length}장 — 첫번째=썸네일
                              </label>
                              {genImgLoading&&<div style={{fontSize:11,color:"var(--accent)",marginBottom:6,animation:"as 1s infinite"}}>⏳ 이미지 생성 중...</div>}
                              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                {getActiveImages().map((img,i)=>(
                                  <div key={i} style={{position:"relative"}}>
                                    <img src={img} alt="" style={{width:80,height:80,objectFit:"cover",borderRadius:8,border:`2px solid ${i===0?"var(--accent)":"var(--border)"}`}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                    {i===0&&<span style={{position:"absolute",top:-7,left:-5,fontSize:8,fontWeight:800,padding:"2px 5px",borderRadius:99,background:"var(--accent)",color:"#000"}}>썸네일</span>}
                                    <button onClick={()=>{if(imgSource==="ai")setGeneratedImages(prev=>prev.filter((_,j)=>j!==i));else setUploadedImages(prev=>prev.filter((_,j)=>j!==i));}}
                                      style={{position:"absolute",top:-5,right:-5,width:17,height:17,borderRadius:"50%",background:"#ef4444",border:"none",color:"#fff",cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div style={{display:"flex",flexDirection:"column",gap:9}}>
                            {[{l:"제목",v:genTitle,s:setGenTitle},{l:"태그",v:genTags,s:setGenTags}].map(f=>(
                              <div key={f.l}>
                                <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,display:"block",marginBottom:3}}>{f.l}</label>
                                <input className="inp" style={{width:"100%",padding:"10px 12px",fontSize:13}} value={f.v} onChange={e=>f.s(e.target.value)}/>
                              </div>
                            ))}
                            <div>
                              <label style={{fontSize:9,color:"var(--sub)",fontWeight:700,display:"block",marginBottom:3}}>본문 ({genContent.length.toLocaleString()}자)</label>
                              <textarea className="inp" rows={10} style={{width:"100%",padding:"10px 12px",fontSize:13,resize:"vertical"}} value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                            </div>
                          </div>
                        </div>
                        <button className="btn-main" style={{width:"100%",justifyContent:"center",padding:"12px"}} onClick={()=>{setPubTitle(genTitle);setPubContent(genContent);setPubTags(genTags);setPubImageUrl(getActiveImages()[0]||"");setPubSub("publish");}}>
                          🚀 발행하기로 넘기기
                        </button>
                      </>
                    )}
                  </div>

                </div>
              )}

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
                      <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 99, fontWeight: 800, background: a.is_connected ? "var(--accent-dim)" : "var(--card2)", color: a.is_connected ? "var(--accent)" : "var(--sub)" }}>
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
                      {h.post_url && <a href={h.post_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none", padding: "5px 11px", borderRadius: 9, background: "var(--accent-dim)", border: "1px solid var(--border2)", flexShrink: 0 }}>{Icons.eye} 보기</a>}
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

                    <div style={{ padding: "14px 16px", borderRadius: 14, background: "var(--accent-dim)", border: "1px solid var(--border2)", marginBottom: 14 }}>
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
                    <button key={t.key} onClick={() => setTab(t.key as Tab)} style={{ padding: "14px 10px", borderRadius: 13, border: `1px solid ${tab === t.key ? "var(--border2)" : "var(--border)"}`, background: tab === t.key ? "var(--accent-dim)" : "var(--card)", cursor: "pointer", textAlign: "center", transition: "all .2s", fontFamily: "inherit" }}>
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
