import { useState, useEffect, useCallback, useRef } from "react";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount, upsertAccount, useQuota, addHistory } from "../lib/supabase";

interface Props {
  user: PublyUser;
  onLogout: () => void;
  onAdminLogin: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

type Tab = "publish" | "write" | "accounts" | "history" | "settings";
const BOT = "http://localhost:3333";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Grotesk:wght@300;400;500;600;700&family=Noto+Sans+KR:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

*{box-sizing:border-box;}

@keyframes v2-fade   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
@keyframes v2-spin   { to{transform:rotate(360deg)} }
@keyframes v2-blink  { 0%,100%{opacity:1} 50%{opacity:.25} }
@keyframes v2-float  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
@keyframes v2-glow   { 0%,100%{box-shadow:0 0 0 0 rgba(0,255,136,.35)} 50%{box-shadow:0 0 0 8px rgba(0,255,136,0)} }
@keyframes v2-shine  { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
@keyframes v2-pulse  { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.5);opacity:0} }
@keyframes v2-scroll { 0%{transform:translateY(0)} 100%{transform:translateY(-50%)} }
@keyframes v2-scan   { 0%{top:0%} 100%{top:100%} }
@keyframes v2-bar    { from{width:0} to{width:var(--w,100%)} }
@keyframes v2-count  { from{opacity:0;transform:scale(.5)} to{opacity:1;transform:scale(1)} }

/* ── 테마 변수 ── */
.v2-root.dark {
  --bg:#02040a; --bg2:#050810; --bg3:#070b14;
  --card:rgba(255,255,255,.032); --card2:rgba(255,255,255,.05);
  --border:rgba(255,255,255,.07); --border2:rgba(0,255,136,.15);
  --text:#f0f8ff; --muted:rgba(255,255,255,.42);
  --accent:#00ff88; --accent2:#00cc66; --accent-dim:rgba(0,255,136,.12);
  --nav-bg:rgba(2,4,10,.95); --header-bg:rgba(5,8,16,.92);
  --input-bg:rgba(255,255,255,.055); --input-border:rgba(255,255,255,.1);
  --scrollbar:rgba(0,255,136,.2);
  --sidebar-w:220px;
}
.v2-root.light {
  --bg:#f0f9ff; --bg2:#e8f5ff; --bg3:#f8fffe;
  --card:rgba(255,255,255,.9); --card2:rgba(255,255,255,.95);
  --border:rgba(0,0,0,.07); --border2:rgba(0,180,80,.2);
  --text:#09090b; --muted:rgba(0,0,0,.48);
  --accent:#00b060; --accent2:#009050; --accent-dim:rgba(0,176,96,.1);
  --nav-bg:rgba(240,249,255,.97); --header-bg:rgba(255,255,255,.95);
  --input-bg:rgba(0,0,0,.04); --input-border:rgba(0,0,0,.1);
  --scrollbar:rgba(0,176,96,.25);
  --sidebar-w:220px;
}

/* ── 레이아웃 ── */
.v2-root {
  width:100vw; height:100vh; overflow:hidden;
  display:flex; flex-direction:column;
  font-family:'Noto Sans KR',sans-serif;
  color:var(--text); background:var(--bg);
  transition:background .3s, color .3s;
}

/* 스크롤바 */
*::-webkit-scrollbar { width:4px; height:4px; }
*::-webkit-scrollbar-track { background:transparent; }
*::-webkit-scrollbar-thumb { background:var(--scrollbar); border-radius:99px; }

/* ── 헤더 ── */
.v2-header {
  height:56px; flex-shrink:0; display:flex; align-items:center;
  padding:0 20px; gap:16px;
  background:var(--header-bg); border-bottom:1px solid var(--border);
  backdrop-filter:blur(24px); position:relative; z-index:30;
}
.v2-logo {
  font-family:'Bebas Neue',sans-serif; font-size:22px; letter-spacing:.25em;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  flex-shrink:0;
}
.v2-logo-icon {
  width:32px; height:32px; border-radius:9px; flex-shrink:0;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 0 16px var(--accent-dim);
}
.v2-header-center { flex:1; display:flex; align-items:center; gap:10px; padding:0 16px; }
.v2-status-chip {
  display:flex; align-items:center; gap:6px; padding:5px 12px;
  border-radius:99px; border:1px solid; font-size:11px; font-weight:600;
  transition:all .2s;
}
.v2-status-online  { border-color:rgba(0,255,136,.3); background:rgba(0,255,136,.08); color:var(--accent); }
.v2-status-offline { border-color:var(--border); background:var(--card); color:var(--muted); }
.v2-quota-wrap { display:flex; align-items:center; gap:8px; }
.v2-quota-bar-bg { width:100px; height:5px; border-radius:99px; background:var(--border); overflow:hidden; }
.v2-quota-bar-fill { height:100%; border-radius:99px; background:linear-gradient(90deg,var(--accent),var(--accent2)); animation:v2-bar .8s ease both; }
.v2-plan-chip {
  font-size:9px; font-weight:800; padding:3px 9px; border-radius:99px;
  letter-spacing:.1em; font-family:'Space Grotesk',sans-serif;
}
.plan-free    { background:rgba(120,120,120,.15); color:#999; border:1px solid rgba(120,120,120,.2); }
.plan-basic   { background:rgba(66,133,244,.15); color:#4285F4; border:1px solid rgba(66,133,244,.25); }
.plan-pro     { background:var(--accent-dim); color:var(--accent); border:1px solid rgba(0,255,136,.3); animation:v2-glow 2.5s infinite; }
.v2-header-right { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.v2-icon-btn {
  width:36px; height:36px; border-radius:11px; cursor:pointer !important; font-size:16px;
  display:flex; align-items:center; justify-content:center; border:1px solid var(--border);
  background:var(--card); transition:all .2s; color:var(--text); outline:none;
  -webkit-appearance:none; user-select:none;
}
.v2-icon-btn:hover { border-color:var(--border2); transform:scale(1.08); }
.v2-user-chip {
  display:flex; align-items:center; gap:7px; padding:5px 12px 5px 6px;
  border-radius:99px; border:1px solid var(--border); background:var(--card);
  font-size:12px; font-weight:600; cursor:default;
}
.v2-user-avatar {
  width:24px; height:24px; border-radius:50%;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  display:flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:800; color:#000;
}
.v2-logout-btn {
  padding:6px 13px; border-radius:10px; border:1px solid var(--border);
  background:var(--card); color:var(--muted); font-size:12px; font-weight:600;
  cursor:pointer; font-family:'Noto Sans KR',sans-serif; transition:all .2s;
}
.v2-logout-btn:hover { color:var(--text); border-color:var(--border2); }

/* ── 바디 ── */
.v2-body { flex:1; display:flex; overflow:hidden; }

/* ── 사이드바 ── */
.v2-sidebar {
  width:var(--sidebar-w); flex-shrink:0; overflow-y:auto;
  background:var(--nav-bg); border-right:1px solid var(--border);
  display:flex; flex-direction:column; padding:16px 12px;
  gap:4px;
}
.v2-nav-section-label {
  font-size:9px; font-weight:700; letter-spacing:.15em; text-transform:uppercase;
  color:var(--muted); padding:8px 10px 4px; margin-top:8px;
}
.v2-nav-btn {
  display:flex; align-items:center; gap:11px; padding:10px 12px;
  border-radius:12px; border:none; cursor:pointer; width:100%;
  font-size:13px; font-weight:500; font-family:'Noto Sans KR',sans-serif;
  color:var(--muted); background:transparent; transition:all .18s; text-align:left;
  position:relative;
}
.v2-nav-btn:hover { background:var(--card2); color:var(--text); }
.v2-nav-btn.active {
  background:var(--accent-dim); color:var(--accent);
  font-weight:700; border:1px solid rgba(0,255,136,.2);
}
.v2-nav-btn.active::before {
  content:''; position:absolute; left:0; top:20%; bottom:20%;
  width:3px; border-radius:99px; background:var(--accent);
  box-shadow:0 0 8px var(--accent);
}
.v2-nav-icon { font-size:17px; flex-shrink:0; }
.v2-nav-badge {
  margin-left:auto; font-size:9px; font-weight:800;
  padding:2px 7px; border-radius:99px;
  background:var(--accent-dim); color:var(--accent);
}

/* 사이드바 하단 */
.v2-sidebar-footer { margin-top:auto; padding-top:12px; border-top:1px solid var(--border); }
.v2-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.v2-dot-on  { background:var(--accent); animation:v2-blink 2s infinite; }
.v2-dot-off { background:#555; }
.light .v2-dot-off { background:#bbb; }

/* ── 메인 콘텐츠 ── */
.v2-main { flex:1; display:flex; overflow:hidden; }

/* 중앙 패널 */
.v2-center {
  flex:1; overflow-y:auto; padding:24px;
  display:flex; flex-direction:column; gap:16px;
}

/* 우측 패널 */
.v2-right {
  width:300px; flex-shrink:0; overflow-y:auto;
  border-left:1px solid var(--border);
  background:var(--nav-bg); display:flex; flex-direction:column; gap:0;
}
.v2-right-section { padding:18px; border-bottom:1px solid var(--border); }
.v2-right-title {
  font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
  color:var(--muted); margin-bottom:12px; display:flex; align-items:center; gap:6px;
}

/* ── 카드 ── */
.v2-card {
  background:var(--card); border:1px solid var(--border);
  border-radius:16px; position:relative; overflow:hidden;
  transition:border-color .2s;
}
.v2-card::before {
  content:''; position:absolute; top:0; left:20%; right:20%; height:1px;
  background:linear-gradient(90deg,transparent,var(--border2),transparent);
}
.dark .v2-card:hover { border-color:rgba(0,255,136,.18); }
.light .v2-card:hover { box-shadow:0 4px 20px rgba(0,0,0,.07); }

/* ── 입력 ── */
.v2-input {
  width:100%; padding:12px 14px;
  background:var(--input-bg); border:1.5px solid var(--input-border);
  border-radius:12px; color:var(--text);
  font-size:13px; font-family:'Noto Sans KR',sans-serif;
  outline:none; transition:all .2s;
}
.v2-input:focus {
  border-color:rgba(0,255,136,.45) !important;
  box-shadow:0 0 0 3px rgba(0,255,136,.08) !important;
}
.v2-input::placeholder { color:var(--muted); }
select.v2-input { appearance:auto; }
.dark  select.v2-input { color-scheme:dark; }
.light select.v2-input { color-scheme:light; }

/* ── 버튼 ── */
.v2-btn-primary {
  padding:12px 20px; border:none; border-radius:12px; cursor:pointer;
  font-family:'Noto Sans KR',sans-serif; font-weight:800; font-size:13px;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  color:#000; display:flex; align-items:center; gap:7px;
  transition:all .22s; position:relative; overflow:hidden;
}
.v2-btn-primary::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);
  background-size:200% 100%; animation:v2-shine 3s ease-in-out infinite;
}
.v2-btn-primary:hover { transform:translateY(-2px); box-shadow:0 10px 28px rgba(0,255,136,.38); }
.v2-btn-primary:disabled { opacity:.38; cursor:not-allowed; transform:none; }

.v2-btn-secondary {
  padding:10px 16px; border:1px solid var(--border); border-radius:11px;
  cursor:pointer; font-family:'Noto Sans KR',sans-serif; font-weight:600; font-size:12px;
  background:var(--card); color:var(--muted); display:flex; align-items:center; gap:6px;
  transition:all .18s;
}
.v2-btn-secondary:hover { border-color:var(--border2); color:var(--text); }

/* ── 섹션 타이틀 ── */
.v2-section-label {
  font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
  color:var(--muted); margin-bottom:10px; display:flex; align-items:center; gap:6px;
}

/* ── 플랫폼 버튼 ── */
.v2-platform-btn {
  flex:1; padding:14px 12px; border-radius:14px; border:1.5px solid var(--border);
  cursor:pointer; background:var(--card);
  display:flex; align-items:center; gap:11px; transition:all .22s;
  font-family:'Noto Sans KR',sans-serif;
}
.v2-platform-btn.p-naver   { border-color:#03C75A; background:rgba(3,199,90,.08); animation:v2-glow 2.5s infinite; }
.v2-platform-btn.p-tistory { border-color:#FF6B35; background:rgba(255,107,53,.08); }
.v2-platform-btn:hover:not(.p-naver):not(.p-tistory) { border-color:var(--border2); }

/* ── 히스토리 아이템 ── */
.v2-hist-item {
  display:flex; align-items:center; gap:10px; padding:10px 12px;
  border-radius:11px; border:1px solid var(--border); background:var(--card);
  margin-bottom:7px; transition:all .15s; animation:v2-fade .3s ease both;
}
.v2-hist-item:hover { border-color:var(--border2); }

/* ── 상태 배지 ── */
.v2-status-badge { font-size:9px; font-weight:800; padding:3px 8px; border-radius:99px; flex-shrink:0; }
.badge-success { background:rgba(0,255,136,.12); color:var(--accent); }
.badge-fail    { background:rgba(255,68,68,.12); color:#ff6666; }
.badge-pending { background:rgba(245,158,11,.12); color:#f59e0b; }

/* ── 안내 박스 ── */
.v2-warn { padding:11px 14px; border-radius:12px; font-size:12px; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
.v2-warn-yellow { background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.2); color:#f59e0b; }
.v2-warn-red    { background:rgba(255,68,68,.08); border:1px solid rgba(255,68,68,.2); color:#ff8888; }

/* ── 사용 설명서 ── */
.v2-guide-trigger {
  display:flex; align-items:center; gap:8px; padding:10px 14px;
  border-radius:12px; cursor:pointer; border:1.5px dashed;
  font-size:12px; font-weight:700; font-family:'Noto Sans KR',sans-serif;
  transition:all .22s; animation:v2-float 3s ease-in-out infinite;
  background:linear-gradient(135deg,rgba(245,158,11,.08),rgba(245,158,11,.04));
  border-color:rgba(245,158,11,.3); color:#d97706; position:relative; overflow:hidden;
}
.v2-guide-trigger::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);
  background-size:200%; animation:v2-shine 2.5s infinite;
}
.v2-guide-trigger:hover { border-color:rgba(245,158,11,.5); transform:translateY(-2px); }

/* ── 가이드 슬라이드 패널 ── */
.v2-guide-panel {
  position:fixed; top:56px; right:0; bottom:0; width:min(420px,100vw);
  background:var(--bg2); border-left:1px solid var(--border);
  z-index:1000; overflow-y:auto; padding:24px;
  box-shadow:-20px 0 60px rgba(0,0,0,.2);
  animation:v2-slide-in .3s ease both;
}
@keyframes v2-slide-in { from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1} }
.v2-guide-step {
  padding:14px 16px; border-radius:14px; border:1px solid;
  margin-bottom:10px; animation:v2-fade .3s ease both;
}

/* ── 빠른 실행 ── */
.v2-quick-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.v2-quick-btn {
  padding:14px 10px; border-radius:13px; border:1px solid var(--border);
  background:var(--card); cursor:pointer; text-align:center; transition:all .2s;
  font-family:'Noto Sans KR',sans-serif;
}
.v2-quick-btn:hover { border-color:var(--border2); transform:translateY(-2px); background:var(--card2); }

/* ── 통계 ── */
.v2-stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.v2-stat-card { padding:12px 14px; border-radius:12px; border:1px solid var(--border); background:var(--card); }

/* ── 모바일 ── */
@media(max-width:900px)  { .v2-right  { display:none; } }
@media(max-width:768px)  { .v2-sidebar { display:none; } .v2-mobile-bar { display:flex !important; } .v2-center { padding:16px 14px 90px; } }
@media(max-width:480px)  { .v2-header { padding:0 12px; } }

/* 모바일 탭바 */
.v2-mobile-bar {
  display:none; position:fixed; bottom:0; left:0; right:0; z-index:100;
  padding:8px 12px 20px; gap:4px;
  background:var(--header-bg); border-top:1px solid var(--border);
  backdrop-filter:blur(24px);
}
.v2-mob-btn {
  flex:1; display:flex; flex-direction:column; align-items:center; gap:3px;
  padding:8px 4px; border-radius:13px; border:none; cursor:pointer;
  background:transparent; transition:all .18s; font-family:'Noto Sans KR',sans-serif;
}
.v2-mob-btn.active { background:var(--accent-dim); }
.v2-mob-icon  { font-size:22px; }
.v2-mob-label { font-size:9px; font-weight:600; color:var(--muted); letter-spacing:.02em; }
.v2-mob-btn.active .v2-mob-label { color:var(--accent); }

/* 스피너 */
.v2-spinner {
  width:15px; height:15px; border-radius:50%;
  border:2.5px solid rgba(0,0,0,.2); border-top-color:#000;
  animation:v2-spin 1s linear infinite; display:inline-block; vertical-align:middle; margin-right:6px;
}
`;

const TABS = [
  { key:"publish",  icon:"🚀", label:"발행하기" },
  { key:"write",    icon:"✍️", label:"글 생성" },
  { key:"accounts", icon:"🔗", label:"계정 관리" },
  { key:"history",  icon:"📋", label:"히스토리" },
  { key:"settings", icon:"⚙️", label:"설정" },
] as const;

const PLAN_COLORS: Record<string,string> = { free:"#999", basic:"#4285F4", pro:"#00ff88" };
const PLAN_LABELS: Record<string,string> = { free:"FREE", basic:"BASIC", pro:"PRO" };

const GUIDE_STEPS = [
  {
    title:"봇 서버 실행", color:"#00ff88",
    items:["PC에서 naver-bot 폴더 열기","npm run dev 실행","우측 상단 '온라인' 확인"],
  },
  {
    title:"계정 연결", color:"#4285F4",
    items:["계정 관리 탭으로 이동","네이버/티스토리 아이디·비번 입력","연결 버튼 클릭 → 자동 로그인"],
  },
  {
    title:"글 생성", color:"#f59e0b",
    items:["글 생성 탭으로 이동","키워드 입력 후 생성","내용 확인 후 발행으로 넘기기"],
  },
  {
    title:"자동 발행", color:"#a78bfa",
    items:["발행하기 탭에서 계정 선택","이미지 프롬프트 입력(선택)","자동 발행 클릭 → 완료"],
  },
];

export default function DashboardPage({ user, onLogout, onAdminLogin, theme, onThemeToggle }: Props) {
  const [tab, setTab]             = useState<Tab>("publish");
  const [botOnline, setBotOnline] = useState(false);
  const [quota, setQuota]         = useState<PublyQuota|null>(null);
  const [history, setHistory]     = useState<PublyHistory[]>([]);
  const [accounts, setAccounts]   = useState<PublyAccount[]>([]);
  const [platform, setPlatform]   = useState<"naver"|"tistory">("naver");
  const [showGuide, setShowGuide] = useState(false);

  // 발행 폼
  const [pubTitle,   setPubTitle]   = useState("");
  const [pubContent, setPubContent] = useState("");
  const [pubTags,    setPubTags]    = useState("");
  const [pubImg,     setPubImg]     = useState("");
  const [pubAccId,   setPubAccId]   = useState("");
  const [publishing, setPublishing] = useState(false);
  const [pubMsg,     setPubMsg]     = useState("");

  // 글 생성
  const [keyword,    setKeyword]    = useState("");
  const [generating, setGenerating] = useState(false);
  const [genTitle,   setGenTitle]   = useState("");
  const [genContent, setGenContent] = useState("");
  const [genTags,    setGenTags]    = useState("");

  // 계정
  const [newPlatform, setNewPlatform] = useState<"naver"|"tistory">("naver");
  const [newUser,     setNewUser]     = useState("");
  const [newPw,       setNewPw]       = useState("");
  const [newBlog,     setNewBlog]     = useState("");
  const [addingAcc,   setAddingAcc]   = useState(false);
  const [connectingId,setConnectingId]= useState<string|null>(null);

  // Flow
  const [flowEmail, setFlowEmail] = useState(()=>localStorage.getItem(`publy_flow_${user.id}`)||"");
  const [flowPw,    setFlowPw]    = useState(()=>localStorage.getItem(`publy_flowpw_${user.id}`)||"");

  const checkBot = useCallback(async () => {
    try { const r = await fetch(`${BOT}/health`,{signal:AbortSignal.timeout(3000)}); setBotOnline(r.ok); }
    catch { setBotOnline(false); }
  }, []);

  useEffect(() => {
    checkBot();
    getQuota(user.id).then(q=>q&&setQuota(q));
    getHistory(user.id).then(setHistory);
    getAccounts(user.id).then(setAccounts);
  }, [user.id, checkBot]);

  async function handlePublish() {
    if (!pubTitle||!pubContent||!pubAccId) return;
    setPublishing(true); setPubMsg("발행 중...");
    try {
      const ok = await useQuota(user.id);
      if (!ok) { setPubMsg("❌ 발행 건수 초과"); setPublishing(false); return; }
      const r = await fetch(`${BOT}/api/publish-full`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ userId:user.id, platform, title:pubTitle, content:pubContent, tags:pubTags.split(",").map(t=>t.trim()).filter(Boolean), imagePrompt:pubImg||undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await addHistory({ user_id:user.id, platform, title:pubTitle, post_url:d.postUrl, status:"success" });
      setPubMsg("✅ 발행 완료!");
      setPubTitle(""); setPubContent(""); setPubTags(""); setPubImg("");
      getHistory(user.id).then(setHistory);
      getQuota(user.id).then(q=>q&&setQuota(q));
    } catch(e:any) {
      await addHistory({ user_id:user.id, platform, title:pubTitle, status:"fail", error_message:e.message });
      setPubMsg("❌ "+e.message);
    } finally { setPublishing(false); }
  }

  async function handleGenerate() {
    if (!keyword) return;
    setGenerating(true);
    try {
      const key = localStorage.getItem("publy_claude_key")||"";
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},
        body:JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:2000,
          messages:[{role:"user",content:`"${keyword}" 키워드로 ${platform==="naver"?"네이버 블로그":"티스토리"} 스타일 한국어 블로그 글 1500자 이상.\n형식:\n제목: (제목)\n태그: (태그1, 태그2)\n본문: (본문)`}] }),
      });
      const d = await r.json();
      const text = d.content?.[0]?.text||"";
      const tm = text.match(/제목[:\s]*([^\n]+)/);
      const tgm= text.match(/태그[:\s]*([^\n]+)/);
      const bm = text.match(/본문[:\s]*([\s\S]+)/);
      if (tm)  setGenTitle(tm[1].trim());
      if (tgm) setGenTags(tgm[1].trim());
      setGenContent(bm?bm[1].trim():text);
    } catch(e:any) { alert("생성 실패: "+e.message); }
    finally { setGenerating(false); }
  }

  function sendToPublish() { setPubTitle(genTitle); setPubContent(genContent); setPubTags(genTags); setTab("publish"); }

  async function handleAddAccount() {
    if (!newUser||!newPw) return;
    setAddingAcc(true);
    try {
      await upsertAccount({ user_id:user.id, platform:newPlatform, username:newUser, password_encrypted:btoa(newPw), blog_name:newBlog||undefined, is_connected:false });
      getAccounts(user.id).then(setAccounts);
      setNewUser(""); setNewPw(""); setNewBlog("");
    } catch(e:any) { alert(e.message); }
    finally { setAddingAcc(false); }
  }

  async function handleConnect(acc: PublyAccount) {
    if (!botOnline) { alert("봇 서버를 먼저 실행하세요"); return; }
    setConnectingId(acc.id);
    try {
      const r = await fetch(`${BOT}/api/${acc.platform}/save-session`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ userId:acc.user_id, id:acc.username, pw:atob((acc as any).password_encrypted||""), blogName:acc.blog_name }),
      });
      if (!(await r.json()).success) throw new Error("연결 실패");
      getAccounts(user.id).then(setAccounts);
    } catch(e:any) { alert("연결 실패: "+e.message); }
    finally { setConnectingId(null); }
  }

  const quotaPct = quota ? Math.min(100,(quota.used_quota/quota.total_quota)*100) : 0;
  const connAccs  = accounts.filter(a=>a.is_connected&&a.platform===platform);
  const todayPub  = history.filter(h=>new Date(h.published_at).toDateString()===new Date().toDateString()).length;

  return (
    <>
      <style>{CSS}</style>

      {/* 가이드 패널 */}
      {showGuide && (
        <div className="v2-guide-panel">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".15em",color:"#d97706"}}>사용 설명서</div>
              <div style={{fontSize:11,color:"var(--muted)"}}>Publy 자동발행 가이드</div>
            </div>
            <button onClick={()=>setShowGuide(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"var(--muted)"}}>✕</button>
          </div>
          {GUIDE_STEPS.map((s,i)=>(
            <div key={i} className="v2-guide-step" style={{borderColor:`${s.color}30`,animationDelay:`${i*.07}s`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{width:22,height:22,borderRadius:7,background:`${s.color}20`,border:`1px solid ${s.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:s.color}}>{i+1}</div>
                <span style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{s.title}</span>
              </div>
              {s.items.map((item,j)=>(
                <div key={j} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:6}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:s.color,flexShrink:0,marginTop:6}}/>
                  <span style={{fontSize:12,color:"var(--muted)",lineHeight:1.5}}>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={`v2-root ${theme}`}>

        {/* ── 헤더 ── */}
        <div className="v2-header">
          <div className="v2-logo-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L22 20H2L12 2Z" fill="#000" opacity=".85"/>
              <path d="M12 7L19 19H5L12 7Z" fill="#00ff88" opacity=".55"/>
            </svg>
          </div>
          <div className="v2-logo">PUBLY</div>

          <div className="v2-header-center">
            <div className={`v2-status-chip ${botOnline?"v2-status-online":"v2-status-offline"}`}>
              <span className={`v2-dot ${botOnline?"v2-dot-on":"v2-dot-off"}`}/>
              {botOnline?"서버 온라인":"서버 오프라인"}
            </div>
            {quota && (
              <div className="v2-quota-wrap">
                <span style={{fontSize:11,color:"var(--muted)",fontFamily:"'JetBrains Mono',monospace"}}>{quota.remaining_quota}/{quota.total_quota}</span>
                <div className="v2-quota-bar-bg">
                  <div className="v2-quota-bar-fill" style={{"--w":`${100-quotaPct}%`,width:`${100-quotaPct}%`} as any}/>
                </div>
              </div>
            )}
            <span className={`v2-plan-chip plan-${user.plan}`}>{PLAN_LABELS[user.plan]}</span>
          </div>

          <div className="v2-header-right">
            <button className="v2-icon-btn" onClick={onThemeToggle} style={{border:"1px solid var(--border)",cursor:"pointer"}}>{theme==="dark"?"☀️":"🌙"}</button>
            <button className="v2-icon-btn" onClick={checkBot} title="새로고침">🔄</button>
            <div className="v2-user-chip">
              <div className="v2-user-avatar">{(user.name||user.email)[0].toUpperCase()}</div>
              <span style={{fontSize:12}}>{user.name||user.email.split("@")[0]}</span>
            </div>
            <button className="v2-icon-btn" onClick={onAdminLogin} title="관리자"
              style={{fontSize:"18px",transition:"transform .3s"}}
              onMouseEnter={e=>(e.currentTarget.style.transform="rotate(45deg) scale(1.1)")}
              onMouseLeave={e=>(e.currentTarget.style.transform="")}>
              ⚙️
            </button>
            <button className="v2-logout-btn" onClick={onLogout}>로그아웃</button>
          </div>
        </div>

        {/* ── 바디 ── */}
        <div className="v2-body">

          {/* ── 사이드바 ── */}
          <div className="v2-sidebar">
            <div className="v2-nav-section-label">메뉴</div>
            {TABS.map(t=>(
              <button key={t.key} className={`v2-nav-btn ${tab===t.key?"active":""}`} onClick={()=>setTab(t.key as Tab)}>
                <span className="v2-nav-icon">{t.icon}</span>
                {t.label}
                {t.key==="history"&&history.length>0&&<span className="v2-nav-badge">{history.length}</span>}
              </button>
            ))}

            <div className="v2-sidebar-footer">
              <button className="v2-guide-trigger" style={{width:"100%",justifyContent:"center"}} onClick={()=>setShowGuide(v=>!v)}>
                📖 사용 설명서
              </button>
              <div style={{marginTop:12,padding:"10px 12px",borderRadius:11,background:"var(--card)",border:"1px solid var(--border)"}}>
                <div style={{fontSize:10,color:"var(--muted)",marginBottom:6,letterSpacing:".1em",textTransform:"uppercase"}}>오늘 발행</div>
                <div style={{fontSize:24,fontWeight:800,color:"var(--accent)",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".1em"}}>{todayPub}건</div>
              </div>
            </div>
          </div>

          {/* ── 메인 ── */}
          <div className="v2-main">

            {/* ── 중앙 ── */}
            <div className="v2-center">

              {/* ─ 발행하기 ─ */}
              {tab==="publish" && (
                <div style={{animation:"v2-fade .3s ease both"}}>
                  {!botOnline && <div className="v2-warn v2-warn-yellow">⚠️ 봇 서버 오프라인. PC에서 naver-bot을 실행해 주세요.</div>}
                  {quota&&quota.remaining_quota<=0 && <div className="v2-warn v2-warn-red">⚠️ 발행 건수를 모두 사용했습니다.</div>}

                  {/* 플랫폼 */}
                  <div className="v2-card" style={{padding:"20px 22px",marginBottom:14}}>
                    <div className="v2-section-label">🌐 발행 플랫폼</div>
                    <div style={{display:"flex",gap:12}}>
                      {(["naver","tistory"] as const).map(p=>(
                        <button key={p} className={`v2-platform-btn ${platform===p?(p==="naver"?"p-naver":"p-tistory"):""}`} onClick={()=>setPlatform(p)}>
                          <span style={{fontSize:26}}>{p==="naver"?"🟢":"🟠"}</span>
                          <div>
                            <div style={{fontSize:13,fontWeight:700,color:platform===p?(p==="naver"?"#03C75A":"#FF6B35"):"var(--muted)"}}>{p==="naver"?"네이버 블로그":"티스토리"}</div>
                            <div style={{fontSize:10,color:"var(--muted)"}}>Playwright 매크로</div>
                          </div>
                          {platform===p&&<span style={{marginLeft:"auto",fontSize:14}}>✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 계정 선택 */}
                  <div className="v2-card" style={{padding:"20px 22px",marginBottom:14}}>
                    <div className="v2-section-label">🔗 발행 계정</div>
                    {connAccs.length===0 ? (
                      <div style={{textAlign:"center",padding:"18px",color:"var(--muted)",fontSize:12}}>
                        연결된 계정 없음 →{" "}
                        <button style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontSize:12,fontWeight:700}} onClick={()=>setTab("accounts")}>계정 관리 이동</button>
                      </div>
                    ) : connAccs.map(a=>(
                      <label key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 13px",borderRadius:11,cursor:"pointer",marginBottom:7,background:pubAccId===a.id?"var(--accent-dim)":"var(--input-bg)",border:`1.5px solid ${pubAccId===a.id?"rgba(0,255,136,.4)":"var(--border)"}`}}>
                        <input type="radio" name="pacc" checked={pubAccId===a.id} onChange={()=>setPubAccId(a.id)} style={{accentColor:"var(--accent)"}}/>
                        <span style={{fontSize:13,fontWeight:600}}>{a.username}</span>
                        {a.blog_name&&<span style={{fontSize:11,color:"var(--muted)"}}>({a.blog_name})</span>}
                        <span style={{marginLeft:"auto",fontSize:9,padding:"2px 8px",borderRadius:99,background:"rgba(0,255,136,.12)",color:"var(--accent)",fontWeight:800}}>연결됨</span>
                      </label>
                    ))}
                  </div>

                  {/* 발행 내용 */}
                  <div className="v2-card" style={{padding:"20px 22px",marginBottom:14}}>
                    <div className="v2-section-label">📝 발행 내용</div>
                    <div style={{display:"flex",flexDirection:"column",gap:11}}>
                      {[
                        {l:"제목",ph:"블로그 제목...",v:pubTitle,s:setPubTitle,type:"text"},
                        {l:"Flow 이미지 프롬프트 (선택)",ph:"예: 맛있는 한식",v:pubImg,s:setPubImg,type:"text"},
                        {l:"태그 (쉼표 구분)",ph:"태그1, 태그2",v:pubTags,s:setPubTags,type:"text"},
                      ].map(f=>(
                        <div key={f.l}>
                          <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5,letterSpacing:".1em",textTransform:"uppercase"}}>{f.l}</label>
                          <input className="v2-input" placeholder={f.ph} value={f.v} onChange={e=>f.s(e.target.value)}/>
                        </div>
                      ))}
                      <div>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5,letterSpacing:".1em",textTransform:"uppercase"}}>본문</label>
                        <textarea className="v2-input" rows={8} placeholder="발행할 내용..." style={{resize:"vertical"}} value={pubContent} onChange={e=>setPubContent(e.target.value)}/>
                      </div>
                    </div>
                  </div>

                  <button className="v2-btn-primary" style={{width:"100%",justifyContent:"center",padding:"15px",fontSize:15}}
                    onClick={handlePublish} disabled={publishing||!botOnline||!pubAccId||!pubTitle||!pubContent||(quota?.remaining_quota||0)<=0}>
                    {publishing?<><span className="v2-spinner"/>발행 중...</>:<>🚀 자동 발행</>}
                  </button>
                  {pubMsg&&<div style={{marginTop:10,padding:"11px 14px",borderRadius:11,background:pubMsg.includes("✅")?"var(--accent-dim)":"rgba(255,68,68,.08)",border:`1px solid ${pubMsg.includes("✅")?"rgba(0,255,136,.2)":"rgba(255,68,68,.2)"}`,fontSize:13,color:pubMsg.includes("✅")?"var(--accent)":"#ff8888"}}>{pubMsg}</div>}
                </div>
              )}

              {/* ─ 글 생성 ─ */}
              {tab==="write" && (
                <div style={{animation:"v2-fade .3s ease both"}}>
                  <div className="v2-card" style={{padding:"20px 22px",marginBottom:14}}>
                    <div className="v2-section-label">✨ AI 글 생성</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 110px",gap:10,marginBottom:12}}>
                      <div>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>키워드</label>
                        <input className="v2-input" placeholder="예: 강남 맛집 추천" value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGenerate()}/>
                      </div>
                      <div>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>플랫폼</label>
                        <select className="v2-input" value={platform} onChange={e=>setPlatform(e.target.value as any)}>
                          <option value="naver">네이버</option>
                          <option value="tistory">티스토리</option>
                        </select>
                      </div>
                    </div>
                    <button className="v2-btn-primary" onClick={handleGenerate} disabled={generating||!keyword}>
                      {generating?<><span className="v2-spinner"/>생성 중...</>:<>✨ 글 생성</>}
                    </button>
                  </div>

                  {genContent&&(
                    <>
                      <div className="v2-card" style={{padding:"20px 22px",marginBottom:14}}>
                        <div className="v2-section-label">📄 생성 결과</div>
                        <div style={{display:"flex",flexDirection:"column",gap:11}}>
                          {[{l:"제목",v:genTitle,s:setGenTitle},{l:"태그",v:genTags,s:setGenTags}].map(f=>(
                            <div key={f.l}>
                              <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>{f.l}</label>
                              <input className="v2-input" value={f.v} onChange={e=>f.s(e.target.value)}/>
                            </div>
                          ))}
                          <div>
                            <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>본문</label>
                            <textarea className="v2-input" rows={12} style={{resize:"vertical"}} value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                          </div>
                        </div>
                      </div>
                      <button className="v2-btn-primary" style={{width:"100%",justifyContent:"center",padding:"14px"}} onClick={sendToPublish}>
                        🚀 발행하기로 넘기기
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* ─ 계정 관리 ─ */}
              {tab==="accounts" && (
                <div style={{animation:"v2-fade .3s ease both"}}>
                  {/* Flow */}
                  <div className="v2-card" style={{padding:"20px 22px",marginBottom:14,borderColor:"rgba(66,133,244,.2)"}}>
                    <div className="v2-section-label">
                      <span style={{width:20,height:20,borderRadius:6,background:"linear-gradient(135deg,#4285F4,#34A853)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:"white"}}>G</span>
                      Google Flow (이미지 생성)
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:11}}>
                      <div>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>구글 이메일</label>
                        <input className="v2-input" type="email" placeholder="my@gmail.com" value={flowEmail} onChange={e=>setFlowEmail(e.target.value)}/>
                      </div>
                      <div>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>구글 비밀번호</label>
                        <input className="v2-input" type="password" placeholder="••••••••" value={flowPw} onChange={e=>setFlowPw(e.target.value)}/>
                      </div>
                    </div>
                    <button className="v2-btn-primary" style={{padding:"9px 16px",fontSize:12}} onClick={()=>{localStorage.setItem(`publy_flow_${user.id}`,flowEmail);localStorage.setItem(`publy_flowpw_${user.id}`,flowPw);alert("저장됨!");}}>
                      💾 저장
                    </button>
                  </div>

                  {/* 계정 추가 */}
                  <div className="v2-card" style={{padding:"20px 22px",marginBottom:14}}>
                    <div className="v2-section-label">➕ 계정 추가</div>
                    <div style={{display:"grid",gridTemplateColumns:"90px 1fr 1fr",gap:10,marginBottom:11}}>
                      <div>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>플랫폼</label>
                        <select className="v2-input" value={newPlatform} onChange={e=>setNewPlatform(e.target.value as any)}>
                          <option value="naver">네이버</option>
                          <option value="tistory">티스토리</option>
                        </select>
                      </div>
                      <div>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>아이디</label>
                        <input className="v2-input" placeholder="아이디" value={newUser} onChange={e=>setNewUser(e.target.value)}/>
                      </div>
                      <div>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>비밀번호</label>
                        <input className="v2-input" type="password" placeholder="비밀번호" value={newPw} onChange={e=>setNewPw(e.target.value)}/>
                      </div>
                    </div>
                    <button className="v2-btn-primary" style={{padding:"9px 16px",fontSize:12}} onClick={handleAddAccount} disabled={addingAcc}>
                      {addingAcc?<><span className="v2-spinner"/>추가 중...</>:<>➕ 계정 추가</>}
                    </button>
                  </div>

                  {/* 계정 목록 */}
                  {accounts.filter(a=>a.platform!=="google").map((a,i)=>(
                    <div key={a.id} className="v2-card" style={{padding:"16px 20px",marginBottom:10,animation:`v2-fade .3s ease ${i*.06}s both`,borderColor:a.is_connected?(a.platform==="naver"?"rgba(3,199,90,.3)":"rgba(255,107,53,.3)"):"var(--border)"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                        <span style={{fontSize:26}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                        <div style={{flex:1}}>
                          <div style={{fontSize:14,fontWeight:700}}>{a.username}</div>
                          <div style={{fontSize:11,color:"var(--muted)"}}>{a.platform}{a.blog_name&&` · ${a.blog_name}`}</div>
                        </div>
                        <span style={{fontSize:9,padding:"3px 9px",borderRadius:99,fontWeight:800,background:a.is_connected?"rgba(0,255,136,.12)":"var(--input-bg)",color:a.is_connected?"var(--accent)":"var(--muted)"}}>
                          {a.is_connected?"✅ 연결됨":"미연결"}
                        </span>
                        <button className="v2-btn-primary" style={{padding:"7px 14px",fontSize:11}} onClick={()=>handleConnect(a)} disabled={!!connectingId||!botOnline}>
                          {connectingId===a.id?<><span className="v2-spinner"/>연결 중...</>:a.is_connected?"재연결":"연결"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ─ 히스토리 ─ */}
              {tab==="history" && (
                <div style={{animation:"v2-fade .3s ease both"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <div style={{fontSize:13,color:"var(--muted)"}}>총 {history.length}건</div>
                    <div style={{display:"flex",gap:10}}>
                      <span style={{fontSize:12,color:"var(--muted)"}}>오늘 {todayPub}건</span>
                      <span style={{fontSize:12,color:"var(--accent)",fontWeight:700}}>잔여 {quota?.remaining_quota||0}건</span>
                    </div>
                  </div>
                  {history.length===0 ? (
                    <div className="v2-card" style={{padding:"64px",textAlign:"center",color:"var(--muted)"}}>
                      <div style={{fontSize:40,marginBottom:12}}>📭</div>
                      발행 기록이 없습니다
                    </div>
                  ) : history.map((h,i)=>(
                    <div key={h.id} className="v2-hist-item" style={{animationDelay:`${i*.04}s`,borderColor:h.status==="success"?"rgba(0,255,136,.15)":h.status==="fail"?"rgba(255,68,68,.15)":"var(--border)"}}>
                      <span style={{fontSize:20}}>{h.platform==="naver"?"🟢":"🟠"}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title}</div>
                        <div style={{fontSize:10,color:"var(--muted)",marginTop:2,fontFamily:"'JetBrains Mono',monospace"}}>{new Date(h.published_at).toLocaleString("ko-KR")}</div>
                        {h.error_message&&<div style={{fontSize:10,color:"#ff8888",marginTop:2}}>❌ {h.error_message}</div>}
                      </div>
                      <span className={`v2-status-badge ${h.status==="success"?"badge-success":h.status==="fail"?"badge-fail":"badge-pending"}`}>
                        {h.status==="success"?"✅":h.status==="fail"?"❌":"⏳"}
                      </span>
                      {h.post_url&&<a href={h.post_url} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:"var(--accent)",textDecoration:"none",padding:"4px 10px",borderRadius:8,background:"var(--accent-dim)",border:"1px solid rgba(0,255,136,.2)",flexShrink:0}}>보기</a>}
                    </div>
                  ))}
                </div>
              )}

              {/* ─ 설정 ─ */}
              {tab==="settings" && (
                <div style={{animation:"v2-fade .3s ease both",maxWidth:560}}>
                  <div className="v2-card" style={{padding:"20px 22px",marginBottom:14}}>
                    <div className="v2-section-label">🤖 AI API 키</div>
                    <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>Claude API Key (글 생성용)</label>
                    <input className="v2-input" type="password" placeholder="sk-ant-..."
                      defaultValue={localStorage.getItem("publy_claude_key")||""}
                      onChange={e=>localStorage.setItem("publy_claude_key",e.target.value)}/>
                  </div>
                  <div className="v2-card" style={{padding:"20px 22px"}}>
                    <div className="v2-section-label">👤 내 계정</div>
                    {[{l:"이름",v:user.name||"-"},{l:"이메일",v:user.email},{l:"플랜",v:PLAN_LABELS[user.plan]},{l:"가입일",v:new Date(user.created_at).toLocaleDateString("ko-KR")}].map(item=>(
                      <div key={item.l} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
                        <span style={{fontSize:12,color:"var(--muted)"}}>{item.l}</span>
                        <span style={{fontSize:12,fontWeight:700}}>{item.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── 우측 패널 ── */}
            <div className="v2-right">
              {/* 빠른 실행 */}
              <div className="v2-right-section">
                <div className="v2-right-title">⚡ 빠른 실행</div>
                <div className="v2-quick-grid">
                  {[
                    {icon:"🚀",label:"발행하기",tab:"publish"},
                    {icon:"✍️",label:"글 생성",tab:"write"},
                    {icon:"🔗",label:"계정 관리",tab:"accounts"},
                    {icon:"📋",label:"히스토리",tab:"history"},
                  ].map(q=>(
                    <button key={q.tab} className="v2-quick-btn" onClick={()=>setTab(q.tab as Tab)}>
                      <div style={{fontSize:22,marginBottom:5}}>{q.icon}</div>
                      <div style={{fontSize:11,fontWeight:600,color:"var(--muted)"}}>{q.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 오늘 통계 */}
              <div className="v2-right-section">
                <div className="v2-right-title">📊 통계</div>
                <div className="v2-stat-grid">
                  {[
                    {label:"오늘 발행",value:todayPub,color:"var(--accent)"},
                    {label:"잔여 건수",value:quota?.remaining_quota??"-",color:"#4285F4"},
                    {label:"총 발행",value:history.length,color:"#f59e0b"},
                    {label:"만료일",value:quota?new Date(quota.reset_date).getDate()+"일":"-",color:"#a78bfa"},
                  ].map((s,i)=>(
                    <div key={i} className="v2-stat-card">
                      <div style={{fontSize:10,color:"var(--muted)",marginBottom:4}}>{s.label}</div>
                      <div style={{fontSize:22,fontWeight:800,color:s.color,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".05em"}}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 최근 발행 */}
              <div className="v2-right-section" style={{flex:1}}>
                <div className="v2-right-title">🕐 최근 발행</div>
                {history.slice(0,8).map((h,i)=>(
                  <div key={h.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid var(--border)",animation:`v2-fade .3s ease ${i*.05}s both`}}>
                    <span style={{fontSize:14}}>{h.platform==="naver"?"🟢":"🟠"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title}</div>
                      <div style={{fontSize:9,color:"var(--muted)",fontFamily:"'JetBrains Mono',monospace"}}>{new Date(h.published_at).toLocaleDateString("ko-KR")}</div>
                    </div>
                    <span style={{fontSize:10}}>{h.status==="success"?"✅":"❌"}</span>
                  </div>
                ))}
              </div>


            </div>
          </div>
        </div>

        {/* ── 모바일 탭바 ── */}
        <div className="v2-mobile-bar">
          {TABS.map(t=>(
            <button key={t.key} className={`v2-mob-btn ${tab===t.key?"active":""}`} onClick={()=>setTab(t.key as Tab)}>
              <span className="v2-mob-icon">{t.icon}</span>
              <span className="v2-mob-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
