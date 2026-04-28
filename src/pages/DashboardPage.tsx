import { useState, useEffect, useCallback } from "react";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount } from "../lib/supabase";

interface Props { user: PublyUser; onLogout: () => void; }

type Tab = "publish" | "write" | "accounts" | "history" | "settings";

const BOT_URL = "http://localhost:3333";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');

* { box-sizing: border-box; }

@keyframes dash-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes dash-spin { to{transform:rotate(360deg)} }
@keyframes dash-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
@keyframes dash-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
@keyframes dash-glow { 0%,100%{box-shadow:0 0 0 0 rgba(0,255,136,.4)} 50%{box-shadow:0 0 0 8px transparent} }
@keyframes dash-shine { 0%{transform:translateX(-100%) skewX(-15deg)} 100%{transform:translateX(300%) skewX(-15deg)} }
@keyframes quota-fill { from{width:0} to{width:var(--w)} }
@keyframes grid-move { from{transform:translateY(0)} to{transform:translateY(40px)} }

.dash-root {
  width: 100vw;
  height: 100vh;
  background: #050a12;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Noto Sans KR', sans-serif;
  color: white;
  position: relative;
}

/* 배경 */
.dash-bg {
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(0,255,136,.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,255,136,.03) 1px, transparent 1px);
  background-size: 40px 40px;
  animation: grid-move 6s linear infinite;
  pointer-events: none;
}
.dash-bg-orb {
  position: fixed;
  width: 500px; height: 500px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0,255,136,.05) 0%, transparent 70%);
  top: -200px; right: -100px;
  pointer-events: none;
}

/* 상단 헤더 */
.dash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: rgba(255,255,255,.03);
  border-bottom: 1px solid rgba(0,255,136,.12);
  backdrop-filter: blur(20px);
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}
.dash-logo {
  font-family: 'Orbitron', monospace;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: .15em;
  background: linear-gradient(135deg, #00ff88, #00cc66);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: flex;
  align-items: center;
  gap: 10px;
}
.dash-logo-icon {
  width: 32px; height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, #00ff88, #00cc66);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 16px rgba(0,255,136,.4);
  flex-shrink: 0;
}

/* 쿼터 바 */
.quota-bar-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.quota-bar-bg {
  width: 120px;
  height: 6px;
  background: rgba(255,255,255,.1);
  border-radius: 99px;
  overflow: hidden;
}
.quota-bar-fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #00ff88, #00cc66);
  animation: quota-fill .8s ease both;
  box-shadow: 0 0 8px rgba(0,255,136,.4);
}

/* 메인 레이아웃 */
.dash-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 사이드바 */
.dash-sidebar {
  width: 72px;
  background: rgba(0,0,0,.3);
  border-right: 1px solid rgba(0,255,136,.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  gap: 8px;
  flex-shrink: 0;
}
.sidebar-btn {
  width: 48px; height: 48px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  transition: all .2s;
  background: transparent;
}
.sidebar-btn.active {
  background: rgba(0,255,136,.12);
  border: 1px solid rgba(0,255,136,.3);
  box-shadow: 0 0 12px rgba(0,255,136,.15);
}
.sidebar-btn:hover:not(.active) { background: rgba(255,255,255,.05); }
.sidebar-icon { font-size: 18px; }
.sidebar-label { font-size: 8px; color: rgba(255,255,255,.4); letter-spacing: .05em; }
.sidebar-btn.active .sidebar-label { color: #00ff88; }

/* 콘텐츠 */
.dash-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
.dash-content::-webkit-scrollbar { width: 4px; }
.dash-content::-webkit-scrollbar-track { background: transparent; }
.dash-content::-webkit-scrollbar-thumb { background: rgba(0,255,136,.2); border-radius: 99px; }

/* 카드 */
.d-card {
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 18px;
  transition: all .2s;
  position: relative;
  overflow: hidden;
}
.d-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0,255,136,.3), transparent);
}
.d-card:hover { border-color: rgba(0,255,136,.2); }

/* 입력창 */
.d-input {
  width: 100%;
  padding: 12px 14px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  color: white;
  font-size: 13px;
  font-family: 'Noto Sans KR', sans-serif;
  outline: none;
  transition: all .2s;
}
.d-input:focus { border-color: rgba(0,255,136,.4); box-shadow: 0 0 0 3px rgba(0,255,136,.08); }
.d-input::placeholder { color: rgba(255,255,255,.25); }

/* 버튼 */
.d-btn-primary {
  padding: 12px 22px;
  background: linear-gradient(135deg, #00ff88, #00cc66);
  color: #000;
  font-weight: 800;
  font-size: 13px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  font-family: 'Noto Sans KR', sans-serif;
  display: flex;
  align-items: center;
  gap: 7px;
  transition: all .2s;
  position: relative;
  overflow: hidden;
}
.d-btn-primary::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.2), transparent);
  animation: dash-shine 2.5s ease-in-out infinite;
}
.d-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,255,136,.4); }
.d-btn-primary:disabled { opacity: .4; cursor: not-allowed; transform: none; }

.d-btn-ghost {
  padding: 10px 16px;
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.6);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Noto Sans KR', sans-serif;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all .2s;
}
.d-btn-ghost:hover { background: rgba(255,255,255,.1); color: white; }

/* 상태 도트 */
.d-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.d-dot-on { background: #00ff88; animation: dash-blink 2s infinite; }
.d-dot-off { background: #444; }

/* 플랫폼 선택 버튼 */
.platform-btn {
  flex: 1;
  padding: 14px 12px;
  border-radius: 14px;
  border: 2px solid rgba(255,255,255,.08);
  cursor: pointer;
  transition: all .2s;
  background: rgba(255,255,255,.03);
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Noto Sans KR', sans-serif;
}
.platform-btn.naver-active {
  border-color: #03C75A;
  background: rgba(3,199,90,.1);
  animation: dash-glow 2s infinite;
}
.platform-btn.tistory-active {
  border-color: #FF6B35;
  background: rgba(255,107,53,.1);
}

/* 섹션 타이틀 */
.section-title {
  font-size: 11px;
  font-weight: 700;
  color: rgba(255,255,255,.35);
  letter-spacing: .15em;
  text-transform: uppercase;
  margin-bottom: 12px;
}

/* 히스토리 아이템 */
.history-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255,255,255,.02);
  border: 1px solid rgba(255,255,255,.05);
  margin-bottom: 8px;
  transition: all .2s;
}
.history-item:hover { border-color: rgba(0,255,136,.15); }

/* 쿼터 경고 */
.quota-warning {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255,68,68,.08);
  border: 1px solid rgba(255,68,68,.2);
  font-size: 12px;
  color: #ff8888;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 모바일 하단 탭 */
@media(max-width:768px) {
  .dash-sidebar { display: none; }
  .dash-mobile-tabs { display: flex !important; }
  .dash-body { flex-direction: column; }
  .dash-content { padding: 16px; }
}
.dash-mobile-tabs {
  display: none;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: rgba(5,10,18,.95);
  border-top: 1px solid rgba(0,255,136,.12);
  backdrop-filter: blur(20px);
  padding: 8px 16px 16px;
  gap: 8px;
  z-index: 100;
}
.mobile-tab-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  background: transparent;
  transition: all .2s;
  font-family: 'Noto Sans KR', sans-serif;
}
.mobile-tab-btn.active { background: rgba(0,255,136,.1); }
.mobile-tab-icon { font-size: 20px; }
.mobile-tab-label { font-size: 9px; color: rgba(255,255,255,.45); }
.mobile-tab-btn.active .mobile-tab-label { color: #00ff88; }

/* 스핀 */
.spin { animation: dash-spin 1s linear infinite; }
`;

const TABS = [
  { key:"publish",  icon:"🚀", label:"발행" },
  { key:"write",    icon:"✍️", label:"글생성" },
  { key:"accounts", icon:"🔗", label:"계정" },
  { key:"history",  icon:"📋", label:"히스토리" },
  { key:"settings", icon:"⚙️", label:"설정" },
] as const;

const PLAN_LABELS: Record<string,string> = { free:"FREE", basic:"BASIC", pro:"PRO" };
const PLAN_COLORS: Record<string,string> = { free:"#888", basic:"#4285F4", pro:"#00ff88" };

export default function DashboardPage({ user, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("publish");
  const [botOnline, setBotOnline] = useState(false);
  const [quota, setQuota] = useState<PublyQuota|null>(null);
  const [history, setHistory] = useState<PublyHistory[]>([]);
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [activePlatform, setActivePlatform] = useState<"naver"|"tistory">("naver");

  // 발행 폼
  const [pubTitle, setPubTitle] = useState("");
  const [pubContent, setPubContent] = useState("");
  const [pubTags, setPubTags] = useState("");
  const [pubImgPrompt, setPubImgPrompt] = useState("");
  const [pubAccountId, setPubAccountId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [pubMsg, setPubMsg] = useState("");

  // 글 생성
  const [keyword, setKeyword] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genTitle, setGenTitle] = useState("");
  const [genContent, setGenContent] = useState("");
  const [genTags, setGenTags] = useState("");

  // 계정
  const [newPlatform, setNewPlatform] = useState<"naver"|"tistory"|"google">("naver");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newBlogName, setNewBlogName] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [connectingId, setConnectingId] = useState<string|null>(null);

  // Flow 계정
  const [flowEmail, setFlowEmail] = useState(() => localStorage.getItem(`publy_flow_${user.id}`) || "");
  const [flowPw, setFlowPw] = useState(() => localStorage.getItem(`publy_flowpw_${user.id}`) || "");

  const checkBot = useCallback(async () => {
    try {
      const r = await fetch(`${BOT_URL}/health`, { signal: AbortSignal.timeout(3000) });
      setBotOnline(r.ok);
    } catch { setBotOnline(false); }
  }, []);

  useEffect(() => {
    checkBot();
    getQuota(user.id).then(q => q && setQuota(q));
    getHistory(user.id).then(setHistory);
    getAccounts(user.id).then(setAccounts);
  }, [user.id, checkBot]);

  // 발행
  async function handlePublish() {
    if (!pubTitle || !pubContent || !pubAccountId) return;
    setPublishing(true);
    setPubMsg("발행 중...");
    try {
      const r = await fetch(`${BOT_URL}/api/publish-full`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          userId: user.id,
          platform: activePlatform,
          title: pubTitle,
          content: pubContent,
          tags: pubTags.split(",").map(t=>t.trim()).filter(Boolean),
          imagePrompt: pubImgPrompt || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setPubMsg("✅ 발행 완료!");
      setPubTitle(""); setPubContent(""); setPubTags(""); setPubImgPrompt("");
      getHistory(user.id).then(setHistory);
      getQuota(user.id).then(q => q && setQuota(q));
    } catch(e:any) {
      setPubMsg("❌ " + e.message);
    } finally { setPublishing(false); }
  }

  // 글 생성
  async function handleGenerate() {
    if (!keyword) return;
    setGenerating(true);
    try {
      const prompt = `"${keyword}" 키워드로 ${activePlatform==="naver"?"네이버 블로그":"티스토리"} 스타일로 한국어 블로그 글 1500자 이상 작성.\n형식:\n제목: (제목)\n태그: (태그1, 태그2, 태그3)\n본문: (본문)`;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key": localStorage.getItem("publy_claude_key")||"","anthropic-version":"2023-06-01"},
        body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:2000, messages:[{role:"user",content:prompt}] }),
      });
      const d = await r.json();
      const text = d.content?.[0]?.text || "";
      const titleMatch = text.match(/제목[:\s]*([^\n]+)/);
      const tagsMatch  = text.match(/태그[:\s]*([^\n]+)/);
      const bodyMatch  = text.match(/본문[:\s]*([\s\S]+)/);
      if (titleMatch) setGenTitle(titleMatch[1].trim());
      if (tagsMatch)  setGenTags(tagsMatch[1].trim());
      setGenContent(bodyMatch ? bodyMatch[1].trim() : text);
    } catch(e:any) {
      alert("글 생성 실패: " + e.message);
    } finally { setGenerating(false); }
  }

  function sendToPublish() {
    setPubTitle(genTitle);
    setPubContent(genContent);
    setPubTags(genTags);
    setTab("publish");
  }

  // 계정 추가
  async function handleAddAccount() {
    if (!newUsername || !newPassword) return;
    setAddingAccount(true);
    try {
      const { upsertAccount } = await import("../lib/supabase");
      await upsertAccount({
        user_id: user.id,
        platform: newPlatform,
        username: newUsername,
        password_encrypted: btoa(newPassword),
        blog_name: newBlogName || undefined,
        is_connected: false,
      });
      getAccounts(user.id).then(setAccounts);
      setNewUsername(""); setNewPassword(""); setNewBlogName("");
    } catch(e:any) { alert(e.message); }
    finally { setAddingAccount(false); }
  }

  // 계정 연결
  async function handleConnect(acc: PublyAccount) {
    if (!botOnline) { alert("봇 서버를 먼저 실행하세요"); return; }
    setConnectingId(acc.id);
    try {
      const r = await fetch(`${BOT_URL}/api/${acc.platform}/save-session`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ userId: acc.user_id, id: acc.username, pw: atob((acc as any).password_encrypted || ""), blogName: acc.blog_name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      getAccounts(user.id).then(setAccounts);
    } catch(e:any) { alert("연결 실패: " + e.message); }
    finally { setConnectingId(null); }
  }

  const quotaPct = quota ? Math.min(100, (quota.used_quota / quota.total_quota) * 100) : 0;
  const connectedAccounts = accounts.filter(a => a.is_connected && a.platform === activePlatform);

  return (
    <>
      <style>{CSS}</style>
      <div className="dash-root">
        <div className="dash-bg"/>
        <div className="dash-bg-orb"/>

        {/* 헤더 */}
        <div className="dash-header">
          <div className="dash-logo">
            <div className="dash-logo-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L22 20H2L12 2Z" fill="#000" opacity=".9"/>
                <path d="M12 7L19 19H5L12 7Z" fill="#00ff88" opacity=".5"/>
              </svg>
            </div>
            PUBLY
          </div>

          <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            {/* 쿼터 */}
            {quota && (
              <div className="quota-bar-wrap">
                <span style={{fontSize:11,color:"rgba(255,255,255,.45)"}}>
                  {quota.remaining_quota}/{quota.total_quota}건
                </span>
                <div className="quota-bar-bg">
                  <div className="quota-bar-fill" style={{"--w":`${100-quotaPct}%`,width:`${100-quotaPct}%`} as any}/>
                </div>
              </div>
            )}

            {/* 플랜 배지 */}
            <span style={{
              fontSize:10,fontWeight:800,padding:"3px 10px",borderRadius:99,
              background:`${PLAN_COLORS[user.plan]}20`,color:PLAN_COLORS[user.plan],
              border:`1px solid ${PLAN_COLORS[user.plan]}40`,letterSpacing:".1em",
            }}>{PLAN_LABELS[user.plan]}</span>

            {/* 봇 상태 */}
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span className={`d-dot ${botOnline?"d-dot-on":"d-dot-off"}`}/>
              <span style={{fontSize:11,color:botOnline?"#00ff88":"rgba(255,255,255,.35)"}}>
                {botOnline?"서버 온라인":"서버 오프라인"}
              </span>
            </div>

            {/* 유저 */}
            <span style={{fontSize:12,color:"rgba(255,255,255,.5)"}}>{user.name || user.email}</span>
            <button className="d-btn-ghost" style={{padding:"7px 12px",fontSize:11}} onClick={onLogout}>로그아웃</button>
          </div>
        </div>

        {/* 바디 */}
        <div className="dash-body">
          {/* 사이드바 */}
          <div className="dash-sidebar">
            {TABS.map(t=>(
              <button key={t.key}
                className={`sidebar-btn ${tab===t.key?"active":""}`}
                onClick={()=>setTab(t.key as Tab)}>
                <span className="sidebar-icon">{t.icon}</span>
                <span className="sidebar-label">{t.label}</span>
              </button>
            ))}
            <div style={{flex:1}}/>
            <button className="sidebar-btn" onClick={checkBot} title="서버 확인">
              <span className="sidebar-icon">🔄</span>
              <span className="sidebar-label">새로고침</span>
            </button>
          </div>

          {/* 콘텐츠 */}
          <div className="dash-content">

            {/* ── 발행하기 ── */}
            {tab==="publish" && (
              <div style={{animation:"dash-fade .3s ease both",maxWidth:800}}>
                <p className="section-title">자동 발행</p>

                {!botOnline && (
                  <div className="quota-warning" style={{marginBottom:16}}>
                    ⚠️ 봇 서버가 오프라인입니다. PC에서 Publy 앱을 실행해 주세요.
                  </div>
                )}
                {quota && quota.remaining_quota <= 0 && (
                  <div className="quota-warning" style={{marginBottom:16}}>
                    ⚠️ 발행 건수를 모두 사용했습니다. 관리자에게 문의하세요.
                  </div>
                )}

                {/* 플랫폼 */}
                <div className="d-card" style={{padding:"18px 20px",marginBottom:14}}>
                  <p className="section-title">플랫폼 선택</p>
                  <div style={{display:"flex",gap:10}}>
                    {(["naver","tistory"] as const).map(p=>(
                      <button key={p} className={`platform-btn ${activePlatform===p?(p==="naver"?"naver-active":"tistory-active"):""}`}
                        onClick={()=>setActivePlatform(p)}>
                        <span style={{fontSize:22}}>{p==="naver"?"🟢":"🟠"}</span>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:activePlatform===p?(p==="naver"?"#03C75A":"#FF6B35"):"rgba(255,255,255,.55)"}}>
                            {p==="naver"?"네이버 블로그":"티스토리"}
                          </div>
                          <div style={{fontSize:10,color:"rgba(255,255,255,.35)"}}>매크로 자동발행</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 계정 선택 */}
                <div className="d-card" style={{padding:"18px 20px",marginBottom:14}}>
                  <p className="section-title">발행 계정</p>
                  {connectedAccounts.length===0 ? (
                    <div style={{textAlign:"center",padding:"20px",color:"rgba(255,255,255,.3)",fontSize:12}}>
                      연결된 계정이 없습니다 →{" "}
                      <button style={{background:"none",border:"none",color:"#00ff88",cursor:"pointer",fontSize:12}}
                        onClick={()=>setTab("accounts")}>계정 관리로 이동</button>
                    </div>
                  ) : connectedAccounts.map(a=>(
                    <label key={a.id} style={{
                      display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                      borderRadius:10,cursor:"pointer",marginBottom:6,
                      background:pubAccountId===a.id?"rgba(0,255,136,.08)":"rgba(255,255,255,.03)",
                      border:`1px solid ${pubAccountId===a.id?"rgba(0,255,136,.4)":"rgba(255,255,255,.07)"}`,
                    }}>
                      <input type="radio" name="pacc" value={a.id}
                        checked={pubAccountId===a.id} onChange={()=>setPubAccountId(a.id)}
                        style={{accentColor:"#00ff88"}}/>
                      <span>{a.username}</span>
                      {a.blog_name && <span style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>({a.blog_name})</span>}
                    </label>
                  ))}
                </div>

                {/* 발행 내용 */}
                <div className="d-card" style={{padding:"18px 20px",marginBottom:14}}>
                  <p className="section-title">발행 내용</p>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {[
                      {label:"📝 제목",    val:pubTitle,      set:setPubTitle,      ph:"블로그 제목...",type:"text"},
                      {label:"🖼️ Flow 이미지 프롬프트 (선택)", val:pubImgPrompt, set:setPubImgPrompt, ph:"예: 맛있는 한식 사진",type:"text"},
                      {label:"🏷️ 태그 (쉼표 구분)", val:pubTags, set:setPubTags, ph:"태그1, 태그2",type:"text"},
                    ].map(f=>(
                      <div key={f.label}>
                        <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>{f.label}</label>
                        <input className="d-input" placeholder={f.ph} value={f.val} onChange={e=>f.set(e.target.value)}/>
                      </div>
                    ))}
                    <div>
                      <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>📄 본문</label>
                      <textarea className="d-input" rows={8} placeholder="발행할 내용..."
                        style={{resize:"vertical"}}
                        value={pubContent} onChange={e=>setPubContent(e.target.value)}/>
                    </div>
                  </div>
                </div>

                <button className="d-btn-primary" style={{width:"100%",justifyContent:"center",padding:"15px",fontSize:15}}
                  onClick={handlePublish}
                  disabled={publishing||!botOnline||!pubAccountId||!pubTitle||!pubContent||(quota?.remaining_quota||0)<=0}>
                  {publishing
                    ? <><span className="spin" style={{width:16,height:16,border:"2px solid rgba(0,0,0,.3)",borderTopColor:"#000",borderRadius:"50%",display:"inline-block"}}/> 발행 중...</>
                    : <><span>🚀</span> 자동 발행</>
                  }
                </button>
                {pubMsg && (
                  <div style={{marginTop:10,padding:"10px 14px",borderRadius:10,
                    background:pubMsg.includes("✅")?"rgba(0,255,136,.08)":"rgba(255,68,68,.08)",
                    border:`1px solid ${pubMsg.includes("✅")?"rgba(0,255,136,.2)":"rgba(255,68,68,.2)"}`,
                    fontSize:13,color:pubMsg.includes("✅")?"#00ff88":"#ff8888"}}>
                    {pubMsg}
                  </div>
                )}
              </div>
            )}

            {/* ── 글 생성 ── */}
            {tab==="write" && (
              <div style={{animation:"dash-fade .3s ease both",maxWidth:800}}>
                <p className="section-title">AI 글 생성</p>
                <div className="d-card" style={{padding:"20px",marginBottom:14}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 120px",gap:10,marginBottom:12}}>
                    <div>
                      <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>키워드</label>
                      <input className="d-input" placeholder="예: 강남 맛집 추천"
                        value={keyword} onChange={e=>setKeyword(e.target.value)}
                        onKeyDown={e=>e.key==="Enter"&&handleGenerate()}/>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>플랫폼</label>
                      <select className="d-input" value={activePlatform} onChange={e=>setActivePlatform(e.target.value as any)}
                        style={{appearance:"auto",colorScheme:"dark"}}>
                        <option value="naver">네이버</option>
                        <option value="tistory">티스토리</option>
                      </select>
                    </div>
                  </div>
                  <button className="d-btn-primary" onClick={handleGenerate} disabled={generating||!keyword}>
                    {generating
                      ? <><span className="spin" style={{width:14,height:14,border:"2px solid rgba(0,0,0,.3)",borderTopColor:"#000",borderRadius:"50%",display:"inline-block"}}/> 생성 중...</>
                      : <><span>✨</span> 글 생성</>
                    }
                  </button>
                </div>

                {genContent && (
                  <>
                    <div className="d-card" style={{padding:"20px",marginBottom:14}}>
                      <p className="section-title">생성 결과</p>
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>
                        <div>
                          <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>제목</label>
                          <input className="d-input" value={genTitle} onChange={e=>setGenTitle(e.target.value)}/>
                        </div>
                        <div>
                          <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>태그</label>
                          <input className="d-input" value={genTags} onChange={e=>setGenTags(e.target.value)}/>
                        </div>
                        <div>
                          <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>본문</label>
                          <textarea className="d-input" rows={12} style={{resize:"vertical"}}
                            value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                        </div>
                      </div>
                    </div>
                    <button className="d-btn-primary" style={{width:"100%",justifyContent:"center",padding:"14px"}}
                      onClick={sendToPublish}>
                      <span>🚀</span> 발행하기로 넘기기
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── 계정 관리 ── */}
            {tab==="accounts" && (
              <div style={{animation:"dash-fade .3s ease both",maxWidth:700}}>
                <p className="section-title">계정 관리</p>

                {/* Google Flow */}
                <div className="d-card" style={{padding:"20px",marginBottom:16,borderColor:"rgba(66,133,244,.2)"}}>
                  <p style={{fontSize:13,fontWeight:700,color:"white",margin:"0 0 14px",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{width:26,height:26,borderRadius:6,background:"linear-gradient(135deg,#4285F4,#34A853)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,color:"white"}}>G</span>
                    Google Flow (이미지 생성)
                  </p>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                    <div>
                      <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>구글 이메일</label>
                      <input className="d-input" type="email" placeholder="my@gmail.com"
                        value={flowEmail} onChange={e=>setFlowEmail(e.target.value)}/>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>구글 비밀번호</label>
                      <input className="d-input" type="password" placeholder="••••••••"
                        value={flowPw} onChange={e=>setFlowPw(e.target.value)}/>
                    </div>
                  </div>
                  <button className="d-btn-primary" style={{padding:"9px 18px",fontSize:12}}
                    onClick={()=>{
                      localStorage.setItem(`publy_flow_${user.id}`, flowEmail);
                      localStorage.setItem(`publy_flowpw_${user.id}`, flowPw);
                      alert("저장됨");
                    }}>
                    💾 저장
                  </button>
                </div>

                {/* 계정 추가 */}
                <div className="d-card" style={{padding:"20px",marginBottom:16}}>
                  <p style={{fontSize:13,fontWeight:700,color:"white",margin:"0 0 14px"}}>+ 계정 추가</p>
                  <div style={{display:"grid",gridTemplateColumns:"100px 1fr 1fr",gap:10,marginBottom:10}}>
                    <div>
                      <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>플랫폼</label>
                      <select className="d-input" value={newPlatform} onChange={e=>setNewPlatform(e.target.value as any)}
                        style={{appearance:"auto",colorScheme:"dark"}}>
                        <option value="naver">네이버</option>
                        <option value="tistory">티스토리</option>
                      </select>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>아이디</label>
                      <input className="d-input" placeholder="아이디" value={newUsername} onChange={e=>setNewUsername(e.target.value)}/>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>비밀번호</label>
                      <input className="d-input" type="password" placeholder="비밀번호" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
                    </div>
                  </div>
                  <button className="d-btn-primary" style={{padding:"9px 18px",fontSize:12}} onClick={handleAddAccount} disabled={addingAccount}>
                    ➕ 추가
                  </button>
                </div>

                {/* 계정 목록 */}
                {accounts.filter(a=>a.platform!=="google").map((a,i)=>(
                  <div key={a.id} className="d-card" style={{
                    padding:"16px 18px",marginBottom:10,
                    animation:`dash-fade .3s ease ${i*.06}s both`,
                    borderColor:a.is_connected?(a.platform==="naver"?"rgba(3,199,90,.3)":"rgba(255,107,53,.3)"):"rgba(255,255,255,.07)",
                  }}>
                    <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                      <span style={{fontSize:24}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:700,color:"white"}}>{a.username}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>{a.platform} {a.blog_name&&`· ${a.blog_name}`}</div>
                      </div>
                      <span style={{
                        fontSize:10,padding:"3px 9px",borderRadius:99,fontWeight:700,
                        background:a.is_connected?"rgba(0,255,136,.15)":"rgba(255,255,255,.08)",
                        color:a.is_connected?"#00ff88":"rgba(255,255,255,.4)",
                      }}>{a.is_connected?"✅ 연결됨":"미연결"}</span>
                      <button className="d-btn-primary" style={{padding:"8px 14px",fontSize:12}}
                        onClick={()=>handleConnect(a)} disabled={!!connectingId||!botOnline}>
                        {connectingId===a.id?"연결 중...":a.is_connected?"재연결":"연결"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── 히스토리 ── */}
            {tab==="history" && (
              <div style={{animation:"dash-fade .3s ease both"}}>
                <p className="section-title">발행 히스토리 ({history.length}건)</p>
                {history.length===0 ? (
                  <div className="d-card" style={{padding:"60px",textAlign:"center",color:"rgba(255,255,255,.3)"}}>
                    발행 기록이 없습니다
                  </div>
                ) : history.map((h,i)=>(
                  <div key={h.id} className="history-item"
                    style={{animation:`dash-fade .3s ease ${i*.04}s both`,borderColor:h.status==="success"?"rgba(0,255,136,.15)":h.status==="fail"?"rgba(255,68,68,.15)":"rgba(255,255,255,.05)"}}>
                    <span style={{fontSize:20}}>{h.platform==="naver"?"🟢":"🟠"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{fontSize:13,fontWeight:600,color:"white",margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title}</p>
                      <p style={{fontSize:11,color:"rgba(255,255,255,.4)",margin:"3px 0 0"}}>{new Date(h.published_at).toLocaleString("ko-KR")}</p>
                      {h.error_message && <p style={{fontSize:11,color:"#ff8888",margin:"3px 0 0"}}>❌ {h.error_message}</p>}
                    </div>
                    <span style={{
                      fontSize:10,padding:"3px 9px",borderRadius:99,fontWeight:700,flexShrink:0,
                      background:h.status==="success"?"rgba(0,255,136,.15)":h.status==="fail"?"rgba(255,68,68,.15)":"rgba(245,158,11,.15)",
                      color:h.status==="success"?"#00ff88":h.status==="fail"?"#ff8888":"#f59e0b",
                    }}>
                      {h.status==="success"?"✅ 완료":h.status==="fail"?"❌ 실패":"⏳"}
                    </span>
                    {h.post_url && (
                      <a href={h.post_url} target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,color:"#00ff88",textDecoration:"none",padding:"4px 10px",borderRadius:8,background:"rgba(0,255,136,.08)",border:"1px solid rgba(0,255,136,.2)",flexShrink:0}}>
                        보기
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── 설정 ── */}
            {tab==="settings" && (
              <div style={{animation:"dash-fade .3s ease both",maxWidth:600}}>
                <p className="section-title">설정</p>
                <div className="d-card" style={{padding:"20px",marginBottom:16}}>
                  <p style={{fontSize:13,fontWeight:700,color:"white",margin:"0 0 14px"}}>AI API 키 (글 생성용)</p>
                  <div>
                    <label style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:600,display:"block",marginBottom:5}}>Claude API Key</label>
                    <input className="d-input" type="password" placeholder="sk-ant-..."
                      defaultValue={localStorage.getItem("publy_claude_key")||""}
                      onChange={e=>localStorage.setItem("publy_claude_key", e.target.value)}/>
                  </div>
                </div>

                <div className="d-card" style={{padding:"20px"}}>
                  <p style={{fontSize:13,fontWeight:700,color:"white",margin:"0 0 14px"}}>내 계정 정보</p>
                  {[
                    {label:"이름", val:user.name},
                    {label:"이메일", val:user.email},
                    {label:"플랜", val:PLAN_LABELS[user.plan]},
                    {label:"가입일", val:new Date(user.created_at).toLocaleDateString("ko-KR")},
                  ].map(item=>(
                    <div key={item.label} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
                      <span style={{fontSize:12,color:"rgba(255,255,255,.45)"}}>{item.label}</span>
                      <span style={{fontSize:12,color:"white",fontWeight:600}}>{item.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* 모바일 하단 탭 */}
        <div className="dash-mobile-tabs">
          {TABS.map(t=>(
            <button key={t.key}
              className={`mobile-tab-btn ${tab===t.key?"active":""}`}
              onClick={()=>setTab(t.key as Tab)}>
              <span className="mobile-tab-icon">{t.icon}</span>
              <span className="mobile-tab-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
