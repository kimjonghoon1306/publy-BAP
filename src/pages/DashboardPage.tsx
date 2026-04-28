import { useState, useEffect, useCallback } from "react";
import { PublyUser, getQuota, getHistory, getAccounts, PublyQuota, PublyHistory, PublyAccount, upsertAccount } from "../lib/supabase";

interface Props {
  user: PublyUser;
  onLogout: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

type Tab = "publish" | "write" | "accounts" | "history" | "settings";

const BOT_URL = "http://localhost:3333";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
* { box-sizing:border-box; }

@keyframes dash-fade  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes dash-spin  { to{transform:rotate(360deg)} }
@keyframes dash-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
@keyframes dash-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
@keyframes dash-glow  { 0%,100%{box-shadow:0 0 0 0 rgba(0,255,136,.4)} 50%{box-shadow:0 0 0 8px transparent} }
@keyframes dash-shine { 0%{transform:translateX(-100%) skewX(-15deg)} 100%{transform:translateX(300%) skewX(-15deg)} }
@keyframes quota-fill { from{width:0} to{width:var(--w)} }
@keyframes grid-move  { from{transform:translateY(0)} to{transform:translateY(40px)} }

/* 다크/라이트 변수 */
.dash-root.dark {
  --bg:#050a12; --card:rgba(255,255,255,.03); --border:rgba(255,255,255,.07);
  --text:#ffffff; --muted:rgba(255,255,255,.45); --input-bg:rgba(255,255,255,.05);
  --input-border:rgba(255,255,255,.1); --sidebar:rgba(0,0,0,.3);
  --sidebar-border:rgba(0,255,136,.08); --header:rgba(5,10,18,.85);
  --header-border:rgba(0,255,136,.12); --grid:rgba(0,255,136,.03);
  --btn-g-bg:rgba(255,255,255,.06); --btn-g-color:rgba(255,255,255,.6);
  --log-bg:rgba(0,0,0,.55); --select-scheme:dark; --select-bg:#0a1020;
}
.dash-root.light {
  --bg:#f8fffe; --card:#ffffff; --border:#e4e4e7;
  --text:#09090b; --muted:rgba(0,0,0,.5); --input-bg:#f4f4f5;
  --input-border:#d4d4d8; --sidebar:#ffffff;
  --sidebar-border:rgba(0,180,80,.1); --header:rgba(248,255,254,.9);
  --header-border:rgba(0,180,80,.15); --grid:rgba(0,180,80,.04);
  --btn-g-bg:rgba(0,0,0,.06); --btn-g-color:rgba(0,0,0,.6);
  --log-bg:#f4f4f5; --select-scheme:light; --select-bg:#f4f4f5;
}

.dash-root {
  width:100vw; height:100vh;
  display:flex; flex-direction:column; overflow:hidden;
  font-family:'Noto Sans KR',sans-serif; color:var(--text);
  transition:background .3s;
  background:var(--bg);
}

.dash-bg {
  position:fixed; inset:0;
  background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);
  background-size:40px 40px; animation:grid-move 6s linear infinite; pointer-events:none;
}

/* 헤더 */
.dash-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:14px 22px; background:var(--header); border-bottom:1px solid var(--header-border);
  backdrop-filter:blur(20px); position:relative; z-index:10; flex-shrink:0;
}
.dash-logo {
  font-family:'Orbitron',monospace; font-size:16px; font-weight:900;
  letter-spacing:.15em;
  background:linear-gradient(135deg,#00ff88,#00cc66);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  display:flex; align-items:center; gap:9px;
}
.dash-logo-icon {
  width:30px; height:30px; border-radius:8px;
  background:linear-gradient(135deg,#00ff88,#00cc66);
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 0 14px rgba(0,255,136,.4); flex-shrink:0;
}

/* 바디 */
.dash-body { display:flex; flex:1; overflow:hidden; }

/* 사이드바 */
.dash-sidebar {
  width:68px; background:var(--sidebar); border-right:1px solid var(--sidebar-border);
  display:flex; flex-direction:column; align-items:center; padding:14px 0; gap:6px; flex-shrink:0;
}
.sb-btn {
  width:46px; height:46px; border-radius:13px; border:none; cursor:pointer;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:3px; transition:all .18s; background:transparent;
}
.dark .sb-btn.active   { background:rgba(0,255,136,.12); border:1px solid rgba(0,255,136,.3); }
.light .sb-btn.active  { background:rgba(0,180,80,.1); border:1px solid rgba(0,180,80,.3); }
.dark .sb-btn:hover:not(.active)  { background:rgba(255,255,255,.05); }
.light .sb-btn:hover:not(.active) { background:rgba(0,0,0,.05); }
.sb-icon { font-size:18px; }
.sb-label { font-size:8px; color:var(--muted); }
.sb-btn.active .sb-label { color:#00cc66; }

/* 콘텐츠 */
.dash-content { flex:1; overflow-y:auto; padding:22px; }
.dash-content::-webkit-scrollbar { width:4px; }
.dash-content::-webkit-scrollbar-thumb { background:rgba(0,255,136,.2); border-radius:99px; }

/* 카드 */
.d-card {
  background:var(--card); border:1px solid var(--border);
  border-radius:16px; transition:all .2s; position:relative; overflow:hidden;
}
.dark .d-card::before {
  content:''; position:absolute; top:0; left:0; right:0; height:1px;
  background:linear-gradient(90deg,transparent,rgba(0,255,136,.2),transparent);
}
.d-card:hover { border-color:rgba(0,255,136,.2); }
.dark .d-card:hover  { }
.light .d-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.06); }

/* 인풋 */
.d-input {
  width:100%; padding:11px 13px; background:var(--input-bg);
  border:1px solid var(--input-border); border-radius:11px; color:var(--text);
  font-size:13px; font-family:'Noto Sans KR',sans-serif; outline:none; transition:all .2s;
}
.d-input:focus { border-color:rgba(0,255,136,.4)!important; box-shadow:0 0 0 3px rgba(0,255,136,.08)!important; }
.d-input::placeholder { color:var(--muted); }
select.d-input { appearance:auto; color-scheme:var(--select-scheme); }

/* 버튼 */
.d-btn-primary {
  padding:11px 20px; background:linear-gradient(135deg,#00ff88,#00cc66);
  color:#000; font-weight:800; font-size:13px; border:none; border-radius:11px;
  cursor:pointer; font-family:'Noto Sans KR',sans-serif;
  display:flex; align-items:center; gap:7px; transition:all .2s;
  position:relative; overflow:hidden;
}
.d-btn-primary::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);
  animation:dash-shine 2.5s ease-in-out infinite;
}
.d-btn-primary:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,255,136,.4); }
.d-btn-primary:disabled { opacity:.4; cursor:not-allowed; transform:none; }

.d-btn-ghost {
  padding:9px 14px; background:var(--btn-g-bg); color:var(--btn-g-color);
  border:1px solid var(--border); border-radius:11px; cursor:pointer;
  font-size:12px; font-weight:600; font-family:'Noto Sans KR',sans-serif;
  display:flex; align-items:center; gap:6px; transition:all .2s;
}
.d-btn-ghost:hover { background:var(--input-bg); color:var(--text); }

/* 상태 */
.d-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.d-dot-on  { background:#00ff88; animation:dash-blink 2s infinite; }
.d-dot-off { background:#444; }
.light .d-dot-off { background:#bbb; }

/* 섹션 타이틀 */
.s-title { font-size:10px; font-weight:700; color:var(--muted); letter-spacing:.15em; text-transform:uppercase; margin-bottom:11px; }

/* 플랫폼 버튼 */
.platform-btn { flex:1; padding:13px 12px; border-radius:13px; border:2px solid var(--border); cursor:pointer; transition:all .2s; background:var(--card); display:flex; align-items:center; gap:10px; font-family:'Noto Sans KR',sans-serif; }
.platform-btn.naver-active   { border-color:#03C75A; background:rgba(3,199,90,.1); animation:dash-glow 2s infinite; }
.platform-btn.tistory-active { border-color:#FF6B35; background:rgba(255,107,53,.1); }

/* 히스토리 */
.h-item { display:flex; align-items:center; gap:11px; padding:11px 14px; border-radius:11px; background:var(--card); border:1px solid var(--border); margin-bottom:7px; transition:all .15s; }
.h-item:hover { border-color:rgba(0,255,136,.15); }

/* 쿼터 바 */
.quota-bg { height:5px; border-radius:99px; background:var(--border); overflow:hidden; }
.quota-fill { height:100%; border-radius:99px; background:linear-gradient(90deg,#00ff88,#00cc66); animation:quota-fill .8s ease both; box-shadow:0 0 6px rgba(0,255,136,.3); }

/* 경고 */
.warn-box { padding:10px 14px; border-radius:10px; background:rgba(255,68,68,.08); border:1px solid rgba(255,68,68,.2); font-size:12px; color:#ff8888; display:flex; align-items:center; gap:8px; }

/* 모바일 탭 */
@media(max-width:768px) {
  .dash-sidebar { display:none; }
  .dash-mobile-tabs { display:flex!important; }
  .dash-content { padding:14px 14px 80px; }
}
.dash-mobile-tabs {
  display:none; position:fixed; bottom:0; left:0; right:0;
  background:var(--header); border-top:1px solid var(--header-border);
  backdrop-filter:blur(20px); padding:8px 12px 16px; gap:6px; z-index:100;
}
.mob-tab { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:7px 4px; border-radius:11px; border:none; cursor:pointer; background:transparent; transition:all .18s; font-family:'Noto Sans KR',sans-serif; }
.dark .mob-tab.active  { background:rgba(0,255,136,.1); }
.light .mob-tab.active { background:rgba(0,180,80,.08); }
.mob-icon  { font-size:19px; }
.mob-label { font-size:9px; color:var(--muted); }
.mob-tab.active .mob-label { color:#00cc66; }
`;

const TABS = [
  { key:"publish",  icon:"🚀", label:"발행" },
  { key:"write",    icon:"✍️", label:"글생성" },
  { key:"accounts", icon:"🔗", label:"계정" },
  { key:"history",  icon:"📋", label:"기록" },
  { key:"settings", icon:"⚙️", label:"설정" },
] as const;

const PLAN_LABELS: Record<string,string> = { free:"FREE", basic:"BASIC", pro:"PRO" };
const PLAN_COLORS: Record<string,string> = { free:"#888", basic:"#4285F4", pro:"#00ff88" };

export default function DashboardPage({ user, onLogout, theme, onThemeToggle }: Props) {
  const [tab, setTab]                     = useState<Tab>("publish");
  const [botOnline, setBotOnline]         = useState(false);
  const [quota, setQuota]                 = useState<PublyQuota|null>(null);
  const [history, setHistory]             = useState<PublyHistory[]>([]);
  const [accounts, setAccounts]           = useState<PublyAccount[]>([]);
  const [activePlatform, setActivePlatform] = useState<"naver"|"tistory">("naver");

  // 발행 폼
  const [pubTitle,   setPubTitle]   = useState("");
  const [pubContent, setPubContent] = useState("");
  const [pubTags,    setPubTags]    = useState("");
  const [pubImg,     setPubImg]     = useState("");
  const [pubAccId,   setPubAccId]   = useState("");
  const [publishing, setPublishing] = useState(false);
  const [pubMsg,     setPubMsg]     = useState("");

  // 글 생성
  const [keyword,    setKeyword]   = useState("");
  const [generating, setGenerating]= useState(false);
  const [genTitle,   setGenTitle]  = useState("");
  const [genContent, setGenContent]= useState("");
  const [genTags,    setGenTags]   = useState("");

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

  async function handlePublish() {
    if (!pubTitle||!pubContent||!pubAccId) return;
    setPublishing(true); setPubMsg("발행 중...");
    try {
      const r = await fetch(`${BOT_URL}/api/publish-full`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ userId:user.id, platform:activePlatform, title:pubTitle, content:pubContent, tags:pubTags.split(",").map(t=>t.trim()).filter(Boolean), imagePrompt:pubImg||undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setPubMsg("✅ 발행 완료!");
      setPubTitle(""); setPubContent(""); setPubTags(""); setPubImg("");
      getHistory(user.id).then(setHistory);
      getQuota(user.id).then(q=>q&&setQuota(q));
    } catch(e:any) { setPubMsg("❌ "+e.message); }
    finally { setPublishing(false); }
  }

  async function handleGenerate() {
    if (!keyword) return;
    setGenerating(true);
    try {
      const claudeKey = localStorage.getItem("publy_claude_key")||"";
      const prompt = `"${keyword}" 키워드로 ${activePlatform==="naver"?"네이버 블로그":"티스토리"} 스타일 한국어 블로그 글 1500자 이상.\n형식:\n제목: (제목)\n태그: (태그1, 태그2)\n본문: (본문)`;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":claudeKey,"anthropic-version":"2023-06-01"},
        body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:2000, messages:[{role:"user",content:prompt}] }),
      });
      const d = await r.json();
      const text = d.content?.[0]?.text||"";
      const tm = text.match(/제목[:\s]*([^\n]+)/);
      const tgm = text.match(/태그[:\s]*([^\n]+)/);
      const bm = text.match(/본문[:\s]*([\s\S]+)/);
      if (tm) setGenTitle(tm[1].trim());
      if (tgm) setGenTags(tgm[1].trim());
      setGenContent(bm?bm[1].trim():text);
    } catch(e:any) { alert("생성 실패: "+e.message); }
    finally { setGenerating(false); }
  }

  function sendToPublish() {
    setPubTitle(genTitle); setPubContent(genContent); setPubTags(genTags); setTab("publish");
  }

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
      const r = await fetch(`${BOT_URL}/api/${acc.platform}/save-session`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ userId:acc.user_id, id:acc.username, pw:atob((acc as any).password_encrypted||""), blogName:acc.blog_name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      getAccounts(user.id).then(setAccounts);
    } catch(e:any) { alert("연결 실패: "+e.message); }
    finally { setConnectingId(null); }
  }

  const quotaPct = quota ? Math.min(100,(quota.used_quota/quota.total_quota)*100) : 0;
  const connAccounts = accounts.filter(a=>a.is_connected&&a.platform===activePlatform);

  return (
    <>
      <style>{CSS}</style>
      <div className={`dash-root ${theme}`}>
        <div className="dash-bg"/>

        {/* 헤더 */}
        <div className="dash-header">
          <div className="dash-logo">
            <div className="dash-logo-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L22 20H2L12 2Z" fill="#000" opacity=".9"/>
                <path d="M12 7L19 19H5L12 7Z" fill="#00ff88" opacity=".5"/>
              </svg>
            </div>
            PUBLY
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            {quota && (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:11,color:"var(--muted)"}}>{quota.remaining_quota}/{quota.total_quota}건</span>
                <div className="quota-bg" style={{width:80}}>
                  <div className="quota-fill" style={{"--w":`${100-quotaPct}%`,width:`${100-quotaPct}%`} as any}/>
                </div>
              </div>
            )}
            <span style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:`${PLAN_COLORS[user.plan]}20`,color:PLAN_COLORS[user.plan],border:`1px solid ${PLAN_COLORS[user.plan]}40`,letterSpacing:".1em"}}>
              {PLAN_LABELS[user.plan]}
            </span>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <span className={`d-dot ${botOnline?"d-dot-on":"d-dot-off"}`}/>
              <span style={{fontSize:11,color:botOnline?"#00ff88":"var(--muted)"}}>{botOnline?"온라인":"오프라인"}</span>
            </div>
            <span style={{fontSize:12,color:"var(--muted)"}}>{user.name||user.email}</span>
            {/* 테마 버튼 */}
            <button className="d-btn-ghost" style={{padding:"7px 10px",fontSize:14}} onClick={onThemeToggle}>
              {theme==="dark"?"☀️":"🌙"}
            </button>
            <button className="d-btn-ghost" style={{padding:"7px 11px",fontSize:11}} onClick={onLogout}>로그아웃</button>
          </div>
        </div>

        <div className="dash-body">
          {/* 사이드바 */}
          <div className="dash-sidebar">
            {TABS.map(t=>(
              <button key={t.key} className={`sb-btn ${tab===t.key?"active":""}`} onClick={()=>setTab(t.key as Tab)}>
                <span className="sb-icon">{t.icon}</span>
                <span className="sb-label">{t.label}</span>
              </button>
            ))}
            <div style={{flex:1}}/>
            <button className="sb-btn" onClick={checkBot} title="서버 확인">
              <span className="sb-icon">🔄</span>
              <span className="sb-label">새로고침</span>
            </button>
          </div>

          {/* 콘텐츠 */}
          <div className="dash-content">

            {/* ── 발행 ── */}
            {tab==="publish" && (
              <div style={{animation:"dash-fade .3s ease both",maxWidth:800}}>
                <p className="s-title">자동 발행</p>
                {!botOnline && <div className="warn-box" style={{marginBottom:14}}>⚠️ 봇 서버 오프라인. PC에서 Publy 앱을 실행해 주세요.</div>}
                {quota&&quota.remaining_quota<=0 && <div className="warn-box" style={{marginBottom:14}}>⚠️ 발행 건수를 모두 사용했습니다. 관리자에게 문의하세요.</div>}

                <div className="d-card" style={{padding:"18px 20px",marginBottom:12}}>
                  <p className="s-title">플랫폼</p>
                  <div style={{display:"flex",gap:10}}>
                    {(["naver","tistory"] as const).map(p=>(
                      <button key={p} className={`platform-btn ${activePlatform===p?(p==="naver"?"naver-active":"tistory-active"):""}`}
                        onClick={()=>setActivePlatform(p)}>
                        <span style={{fontSize:20}}>{p==="naver"?"🟢":"🟠"}</span>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:activePlatform===p?(p==="naver"?"#03C75A":"#FF6B35"):"var(--muted)"}}>
                            {p==="naver"?"네이버 블로그":"티스토리"}
                          </div>
                          <div style={{fontSize:10,color:"var(--muted)"}}>매크로 자동발행</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="d-card" style={{padding:"18px 20px",marginBottom:12}}>
                  <p className="s-title">계정 선택</p>
                  {connAccounts.length===0 ? (
                    <div style={{textAlign:"center",padding:"16px",color:"var(--muted)",fontSize:12}}>
                      연결된 계정 없음 →{" "}
                      <button style={{background:"none",border:"none",color:"#00ff88",cursor:"pointer",fontSize:12,fontWeight:700}} onClick={()=>setTab("accounts")}>계정 관리 이동</button>
                    </div>
                  ) : connAccounts.map(a=>(
                    <label key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:10,cursor:"pointer",marginBottom:6,background:pubAccId===a.id?"rgba(0,255,136,.08)":"var(--input-bg)",border:`1px solid ${pubAccId===a.id?"rgba(0,255,136,.4)":"var(--border)"}`}}>
                      <input type="radio" name="pacc" checked={pubAccId===a.id} onChange={()=>setPubAccId(a.id)} style={{accentColor:"#00ff88"}}/>
                      <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{a.username}</span>
                      {a.blog_name&&<span style={{fontSize:11,color:"var(--muted)"}}>({a.blog_name})</span>}
                    </label>
                  ))}
                </div>

                <div className="d-card" style={{padding:"18px 20px",marginBottom:12}}>
                  <p className="s-title">발행 내용</p>
                  <div style={{display:"flex",flexDirection:"column",gap:9}}>
                    {[
                      {l:"📝 제목",val:pubTitle,set:setPubTitle,ph:"블로그 제목...",area:false},
                      {l:"🖼️ Flow 이미지 프롬프트 (선택)",val:pubImg,set:setPubImg,ph:"예: 맛있는 한식",area:false},
                      {l:"🏷️ 태그 (쉼표 구분)",val:pubTags,set:setPubTags,ph:"태그1, 태그2",area:false},
                    ].map(f=>(
                      <div key={f.l}>
                        <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5,letterSpacing:".08em",textTransform:"uppercase"}}>{f.l}</label>
                        <input className="d-input" placeholder={f.ph} value={f.val} onChange={e=>f.set(e.target.value)}/>
                      </div>
                    ))}
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5,letterSpacing:".08em",textTransform:"uppercase"}}>📄 본문</label>
                      <textarea className="d-input" rows={7} placeholder="발행할 내용..." style={{resize:"vertical"}} value={pubContent} onChange={e=>setPubContent(e.target.value)}/>
                    </div>
                  </div>
                </div>

                <button className="d-btn-primary" style={{width:"100%",justifyContent:"center",padding:"14px",fontSize:14}}
                  onClick={handlePublish} disabled={publishing||!botOnline||!pubAccId||!pubTitle||!pubContent||(quota?.remaining_quota||0)<=0}>
                  {publishing
                    ? <><span style={{width:15,height:15,border:"2px solid rgba(0,0,0,.3)",borderTopColor:"#000",borderRadius:"50%",animation:"dash-spin 1s linear infinite",display:"inline-block"}}/> 발행 중...</>
                    : <><span>🚀</span> 자동 발행</>
                  }
                </button>
                {pubMsg && (
                  <div style={{marginTop:9,padding:"10px 13px",borderRadius:10,background:pubMsg.includes("✅")?"rgba(0,255,136,.08)":"rgba(255,68,68,.08)",border:`1px solid ${pubMsg.includes("✅")?"rgba(0,255,136,.2)":"rgba(255,68,68,.2)"}`,fontSize:13,color:pubMsg.includes("✅")?"#00cc66":"#ff8888"}}>
                    {pubMsg}
                  </div>
                )}
              </div>
            )}

            {/* ── 글 생성 ── */}
            {tab==="write" && (
              <div style={{animation:"dash-fade .3s ease both",maxWidth:800}}>
                <p className="s-title">AI 글 생성</p>
                <div className="d-card" style={{padding:"18px 20px",marginBottom:12}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 110px",gap:10,marginBottom:11}}>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>키워드</label>
                      <input className="d-input" placeholder="예: 강남 맛집" value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGenerate()}/>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>플랫폼</label>
                      <select className="d-input" value={activePlatform} onChange={e=>setActivePlatform(e.target.value as any)}>
                        <option value="naver">네이버</option>
                        <option value="tistory">티스토리</option>
                      </select>
                    </div>
                  </div>
                  <button className="d-btn-primary" onClick={handleGenerate} disabled={generating||!keyword}>
                    {generating?<><span style={{width:13,height:13,border:"2px solid rgba(0,0,0,.3)",borderTopColor:"#000",borderRadius:"50%",animation:"dash-spin 1s linear infinite",display:"inline-block"}}/> 생성 중...</>:<><span>✨</span> 글 생성</>}
                  </button>
                </div>
                {genContent && (
                  <>
                    <div className="d-card" style={{padding:"18px 20px",marginBottom:12}}>
                      <p className="s-title">생성 결과</p>
                      <div style={{display:"flex",flexDirection:"column",gap:9}}>
                        <div>
                          <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>제목</label>
                          <input className="d-input" value={genTitle} onChange={e=>setGenTitle(e.target.value)}/>
                        </div>
                        <div>
                          <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>태그</label>
                          <input className="d-input" value={genTags} onChange={e=>setGenTags(e.target.value)}/>
                        </div>
                        <div>
                          <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>본문</label>
                          <textarea className="d-input" rows={11} style={{resize:"vertical"}} value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                        </div>
                      </div>
                    </div>
                    <button className="d-btn-primary" style={{width:"100%",justifyContent:"center",padding:"13px"}} onClick={sendToPublish}>
                      <span>🚀</span> 발행하기로 넘기기
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── 계정 ── */}
            {tab==="accounts" && (
              <div style={{animation:"dash-fade .3s ease both",maxWidth:700}}>
                <p className="s-title">계정 관리</p>

                {/* Flow */}
                <div className="d-card" style={{padding:"18px 20px",marginBottom:14,borderColor:"rgba(66,133,244,.2)"}}>
                  <p style={{fontSize:13,fontWeight:700,color:"var(--text)",margin:"0 0 13px",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{width:24,height:24,borderRadius:6,background:"linear-gradient(135deg,#4285F4,#34A853)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:"white"}}>G</span>
                    Google Flow (이미지 생성)
                  </p>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>구글 이메일</label>
                      <input className="d-input" type="email" placeholder="my@gmail.com" value={flowEmail} onChange={e=>setFlowEmail(e.target.value)}/>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>구글 비밀번호</label>
                      <input className="d-input" type="password" placeholder="••••••••" value={flowPw} onChange={e=>setFlowPw(e.target.value)}/>
                    </div>
                  </div>
                  <button className="d-btn-primary" style={{padding:"9px 16px",fontSize:12}} onClick={()=>{localStorage.setItem(`publy_flow_${user.id}`,flowEmail);localStorage.setItem(`publy_flowpw_${user.id}`,flowPw);alert("저장됨");}}>
                    💾 저장
                  </button>
                </div>

                {/* 계정 추가 */}
                <div className="d-card" style={{padding:"18px 20px",marginBottom:14}}>
                  <p style={{fontSize:13,fontWeight:700,color:"var(--text)",margin:"0 0 13px"}}>+ 계정 추가</p>
                  <div style={{display:"grid",gridTemplateColumns:"90px 1fr 1fr",gap:10,marginBottom:10}}>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>플랫폼</label>
                      <select className="d-input" value={newPlatform} onChange={e=>setNewPlatform(e.target.value as any)}>
                        <option value="naver">네이버</option>
                        <option value="tistory">티스토리</option>
                      </select>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>아이디</label>
                      <input className="d-input" placeholder="아이디" value={newUser} onChange={e=>setNewUser(e.target.value)}/>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>비밀번호</label>
                      <input className="d-input" type="password" placeholder="비밀번호" value={newPw} onChange={e=>setNewPw(e.target.value)}/>
                    </div>
                  </div>
                  <button className="d-btn-primary" style={{padding:"9px 16px",fontSize:12}} onClick={handleAddAccount} disabled={addingAcc}>➕ 추가</button>
                </div>

                {/* 계정 목록 */}
                {accounts.filter(a=>a.platform!=="google").map((a,i)=>(
                  <div key={a.id} className="d-card" style={{padding:"14px 16px",marginBottom:9,animation:`dash-fade .3s ease ${i*.06}s both`,borderColor:a.is_connected?(a.platform==="naver"?"rgba(3,199,90,.3)":"rgba(255,107,53,.3)"):"var(--border)"}}>
                    <div style={{display:"flex",alignItems:"center",gap:11,flexWrap:"wrap"}}>
                      <span style={{fontSize:22}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{a.username}</div>
                        <div style={{fontSize:11,color:"var(--muted)"}}>{a.platform}{a.blog_name&&` · ${a.blog_name}`}</div>
                      </div>
                      <span style={{fontSize:10,padding:"3px 9px",borderRadius:99,fontWeight:700,background:a.is_connected?"rgba(0,255,136,.15)":"var(--input-bg)",color:a.is_connected?"#00cc66":"var(--muted)"}}>
                        {a.is_connected?"✅ 연결됨":"미연결"}
                      </span>
                      <button className="d-btn-primary" style={{padding:"7px 13px",fontSize:11}} onClick={()=>handleConnect(a)} disabled={!!connectingId||!botOnline}>
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
                <p className="s-title">발행 기록 ({history.length}건)</p>
                {history.length===0 ? (
                  <div className="d-card" style={{padding:"56px",textAlign:"center",color:"var(--muted)"}}>발행 기록 없음</div>
                ) : history.map((h,i)=>(
                  <div key={h.id} className="h-item" style={{animation:`dash-fade .3s ease ${i*.04}s both`,borderColor:h.status==="success"?"rgba(0,255,136,.15)":h.status==="fail"?"rgba(255,68,68,.15)":"var(--border)"}}>
                    <span style={{fontSize:18}}>{h.platform==="naver"?"🟢":"🟠"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{fontSize:13,fontWeight:600,color:"var(--text)",margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title}</p>
                      <p style={{fontSize:11,color:"var(--muted)",margin:"3px 0 0"}}>{new Date(h.published_at).toLocaleString("ko-KR")}</p>
                      {h.error_message&&<p style={{fontSize:11,color:"#ff8888",margin:"3px 0 0"}}>❌ {h.error_message}</p>}
                    </div>
                    <span style={{fontSize:10,padding:"3px 9px",borderRadius:99,fontWeight:700,flexShrink:0,background:h.status==="success"?"rgba(0,255,136,.15)":h.status==="fail"?"rgba(255,68,68,.15)":"rgba(245,158,11,.15)",color:h.status==="success"?"#00cc66":h.status==="fail"?"#ff8888":"#f59e0b"}}>
                      {h.status==="success"?"✅":h.status==="fail"?"❌":"⏳"}
                    </span>
                    {h.post_url&&<a href={h.post_url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#00cc66",textDecoration:"none",padding:"4px 9px",borderRadius:8,background:"rgba(0,255,136,.08)",border:"1px solid rgba(0,255,136,.2)",flexShrink:0}}>보기</a>}
                  </div>
                ))}
              </div>
            )}

            {/* ── 설정 ── */}
            {tab==="settings" && (
              <div style={{animation:"dash-fade .3s ease both",maxWidth:560}}>
                <p className="s-title">설정</p>
                <div className="d-card" style={{padding:"18px 20px",marginBottom:14}}>
                  <p style={{fontSize:13,fontWeight:700,color:"var(--text)",margin:"0 0 13px"}}>AI API 키</p>
                  <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>Claude API Key (글 생성용)</label>
                  <input className="d-input" type="password" placeholder="sk-ant-..."
                    defaultValue={localStorage.getItem("publy_claude_key")||""}
                    onChange={e=>localStorage.setItem("publy_claude_key",e.target.value)}/>
                </div>
                <div className="d-card" style={{padding:"18px 20px"}}>
                  <p style={{fontSize:13,fontWeight:700,color:"var(--text)",margin:"0 0 13px"}}>내 계정</p>
                  {[{l:"이름",v:user.name},{l:"이메일",v:user.email},{l:"플랜",v:PLAN_LABELS[user.plan]},{l:"가입일",v:new Date(user.created_at).toLocaleDateString("ko-KR")}].map(item=>(
                    <div key={item.l} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid var(--border)`}}>
                      <span style={{fontSize:12,color:"var(--muted)"}}>{item.l}</span>
                      <span style={{fontSize:12,color:"var(--text)",fontWeight:600}}>{item.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 모바일 탭 */}
        <div className="dash-mobile-tabs">
          {TABS.map(t=>(
            <button key={t.key} className={`mob-tab ${tab===t.key?"active":""}`} onClick={()=>setTab(t.key as Tab)}>
              <span className="mob-icon">{t.icon}</span>
              <span className="mob-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
