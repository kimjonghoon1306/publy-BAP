import { useState, useEffect } from "react";
import { supabase, PublyUser } from "../lib/supabase";

interface Props {
  onBack: () => void;
  onDashboard: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

interface UserWithQuota extends PublyUser {
  quota?: { total_quota:number; used_quota:number; remaining_quota:number; reset_date:string; };
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Grotesk:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;}

@keyframes adm-fade   { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes adm-spin   { to{transform:rotate(360deg)} }
@keyframes adm-glow   { 0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.35)} 50%{box-shadow:0 0 0 8px rgba(245,158,11,0)} }
@keyframes adm-shine  { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
@keyframes adm-pulse  { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.2);opacity:0} }
@keyframes adm-bar    { from{width:0} to{width:var(--w,100%)} }
@keyframes adm-count  { from{opacity:0;transform:scale(.6) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
@keyframes adm-scan   { 0%{top:-5%} 100%{top:105%} }

/* 테마 변수 */
.adm-root.dark {
  --bg:#060804; --bg2:#080b05; --bg3:#0a0e06;
  --card:rgba(245,158,11,.04); --card2:rgba(245,158,11,.07);
  --border:rgba(245,158,11,.12); --border2:rgba(245,158,11,.3);
  --text:#fffbf0; --muted:rgba(255,251,240,.45);
  --accent:#f59e0b; --accent2:#d97706; --accent-dim:rgba(245,158,11,.12);
  --header-bg:rgba(6,8,4,.92); --nav-bg:rgba(8,11,5,.95);
  --input-bg:rgba(245,158,11,.06); --input-border:rgba(245,158,11,.15);
  --scrollbar:rgba(245,158,11,.2);
  --danger:#ef4444; --success:#00c875; --info:#4285F4;
}
.adm-root.light {
  --bg:#fffbf0; --bg2:#fef9e7; --bg3:#fffef8;
  --card:rgba(255,255,255,.92); --card2:rgba(255,255,255,.98);
  --border:rgba(180,120,0,.1); --border2:rgba(180,120,0,.25);
  --text:#1a1200; --muted:rgba(26,18,0,.5);
  --accent:#b45309; --accent2:#92400e; --accent-dim:rgba(180,83,9,.1);
  --header-bg:rgba(255,251,240,.95); --nav-bg:rgba(254,249,231,.97);
  --input-bg:rgba(180,83,9,.05); --input-border:rgba(180,83,9,.15);
  --scrollbar:rgba(180,83,9,.2);
  --danger:#dc2626; --success:#059669; --info:#2563eb;
}

/* 루트 */
.adm-root {
  width:100vw; height:100vh; overflow:hidden;
  display:flex; flex-direction:column;
  font-family:'Noto Sans KR',sans-serif;
  color:var(--text); background:var(--bg);
  transition:background .3s;
}
*::-webkit-scrollbar { width:4px; }
*::-webkit-scrollbar-thumb { background:var(--scrollbar); border-radius:99px; }

/* 배경 스캔 */
.adm-scan {
  position:fixed; left:0; right:0; height:1px; pointer-events:none; z-index:0;
  background:linear-gradient(90deg,transparent,rgba(245,158,11,.2),transparent);
  animation:adm-scan 10s linear infinite;
}

/* 헤더 */
.adm-header {
  height:58px; flex-shrink:0; display:flex; align-items:center;
  padding:0 22px; gap:14px; position:relative; z-index:30;
  background:var(--header-bg); border-bottom:1px solid var(--border);
  backdrop-filter:blur(24px);
}
.adm-logo {
  font-family:'Bebas Neue',sans-serif; font-size:20px; letter-spacing:.25em;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
}
.adm-logo-icon {
  width:34px; height:34px; border-radius:10px;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 0 16px var(--accent-dim); flex-shrink:0;
}
.adm-header-mid { flex:1; display:flex; align-items:center; gap:10px; }
.adm-role-chip {
  font-size:9px; font-weight:800; padding:3px 10px; border-radius:99px;
  letter-spacing:.12em; font-family:'Space Grotesk',sans-serif;
  background:var(--accent-dim); color:var(--accent); border:1px solid var(--border2);
  animation:adm-glow 2.5s infinite;
}
.adm-header-right { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.adm-icon-btn {
  width:36px; height:36px; border-radius:11px; cursor:pointer; font-size:15px;
  display:flex; align-items:center; justify-content:center;
  border:1px solid var(--border); background:var(--card); transition:all .2s;
}
.adm-icon-btn:hover { border-color:var(--border2); transform:scale(1.08); }
.adm-back-btn {
  display:flex; align-items:center; gap:6px; padding:7px 14px;
  border-radius:11px; border:1px solid var(--border); background:var(--card);
  color:var(--muted); font-size:12px; font-weight:600; cursor:pointer;
  font-family:'Noto Sans KR',sans-serif; transition:all .2s;
}
.adm-back-btn:hover { border-color:var(--border2); color:var(--text); transform:translateX(-2px); }

/* 바디 */
.adm-body { flex:1; display:flex; overflow:hidden; }

/* 사이드바 */
.adm-sidebar {
  width:210px; flex-shrink:0; overflow-y:auto;
  background:var(--nav-bg); border-right:1px solid var(--border);
  display:flex; flex-direction:column; padding:14px 10px; gap:3px;
}
.adm-nav-btn {
  display:flex; align-items:center; gap:10px; padding:10px 12px;
  border-radius:11px; border:none; cursor:pointer; width:100%;
  font-size:13px; font-weight:500; font-family:'Noto Sans KR',sans-serif;
  color:var(--muted); background:transparent; transition:all .18s; text-align:left;
  position:relative;
}
.adm-nav-btn:hover { background:var(--card2); color:var(--text); }
.adm-nav-btn.active {
  background:var(--accent-dim); color:var(--accent); font-weight:700;
  border:1px solid var(--border2);
}
.adm-nav-btn.active::before {
  content:''; position:absolute; left:0; top:20%; bottom:20%;
  width:3px; border-radius:99px; background:var(--accent);
  box-shadow:0 0 8px var(--accent);
}

/* 콘텐츠 */
.adm-content { flex:1; overflow-y:auto; padding:22px; }

/* 카드 */
.adm-card {
  background:var(--card); border:1px solid var(--border);
  border-radius:16px; position:relative; overflow:hidden; transition:all .2s;
}
.adm-card::before {
  content:''; position:absolute; top:0; left:20%; right:20%; height:1px;
  background:linear-gradient(90deg,transparent,var(--border2),transparent);
}
.adm-card:hover { border-color:var(--border2); }

/* 입력 */
.adm-input {
  padding:8px 11px; border-radius:9px; font-size:12px;
  font-family:'Noto Sans KR',sans-serif; outline:none; transition:all .2s;
  background:var(--input-bg); border:1px solid var(--input-border); color:var(--text);
}
.adm-input:focus { border-color:var(--border2) !important; box-shadow:0 0 0 3px var(--accent-dim) !important; }
.adm-input::placeholder { color:var(--muted); }
select.adm-input { appearance:auto; }
.dark  select.adm-input { color-scheme:dark; }
.light select.adm-input { color-scheme:light; }

/* 버튼 */
.adm-btn-primary {
  padding:8px 16px; border:none; border-radius:10px; cursor:pointer;
  font-family:'Noto Sans KR',sans-serif; font-weight:800; font-size:12px;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  color:#000; display:flex; align-items:center; gap:6px;
  transition:all .2s; position:relative; overflow:hidden;
}
.adm-btn-primary::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent); background-size:200%; animation:adm-shine 3s infinite; }
.adm-btn-primary:hover { transform:translateY(-1px); box-shadow:0 6px 18px var(--accent-dim); }

.adm-btn-danger  { padding:6px 12px; border-radius:9px; border:none; cursor:pointer; font-size:11px; font-weight:700; font-family:'Noto Sans KR',sans-serif; background:rgba(239,68,68,.12); color:var(--danger); border:1px solid rgba(239,68,68,.2); transition:all .15s; }
.adm-btn-danger:hover { background:rgba(239,68,68,.2); }
.adm-btn-success { padding:6px 12px; border-radius:9px; border:none; cursor:pointer; font-size:11px; font-weight:700; font-family:'Noto Sans KR',sans-serif; background:rgba(0,200,117,.12); color:var(--success); border:1px solid rgba(0,200,117,.2); transition:all .15s; }
.adm-btn-success:hover { background:rgba(0,200,117,.2); }

/* 통계 */
.adm-stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
.adm-stat-card { padding:18px 18px 16px; border-radius:14px; border:1px solid var(--border); background:var(--card); animation:adm-fade .3s ease both; transition:all .2s; cursor:default; }
.adm-stat-card:hover { border-color:var(--border2); transform:translateY(-2px); }
.adm-stat-val { font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:.05em; animation:adm-count .5s ease both; }
.adm-stat-label { font-size:10px; color:var(--muted); margin-top:2px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }

/* 섹션 타이틀 */
.adm-section-label { font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin-bottom:12px; display:flex; align-items:center; gap:7px; }

/* 회원 행 */
.adm-user-row {
  padding:16px 20px; border-bottom:1px solid var(--border);
  animation:adm-fade .3s ease both; transition:background .15s;
}
.adm-user-row:hover { background:var(--card2); }

/* 플랜 배지 */
.adm-plan { font-size:9px; font-weight:800; padding:3px 9px; border-radius:99px; font-family:'Space Grotesk',sans-serif; letter-spacing:.08em; }
.p-free    { background:rgba(120,120,120,.12); color:#999; border:1px solid rgba(120,120,120,.2); }
.p-basic   { background:rgba(66,133,244,.12); color:#4285F4; border:1px solid rgba(66,133,244,.2); }
.p-pro     { background:rgba(0,255,136,.12); color:#00c875; border:1px solid rgba(0,255,136,.25); animation:adm-glow 2.5s infinite; }

/* 쿼터 바 */
.adm-q-bg   { height:5px; border-radius:99px; background:var(--border); overflow:hidden; margin:6px 0; }
.adm-q-fill { height:100%; border-radius:99px; animation:adm-bar .7s ease both; }

/* PW 변경 */
.adm-pw-section { padding:18px 20px; }

/* 가이드 */
.adm-guide-panel {
  position:fixed; top:0; right:0; bottom:0; width:min(380px,100vw);
  background:var(--bg2); border-left:1px solid var(--border);
  z-index:1000; overflow-y:auto; padding:22px;
  box-shadow:-16px 0 48px rgba(0,0,0,.2);
  animation:adm-slide-in .3s ease both;
}
@keyframes adm-slide-in { from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1} }

/* 모바일 */
@media(max-width:768px) {
  .adm-sidebar { display:none; }
  .adm-mob-bar { display:flex !important; }
  .adm-content { padding:14px 12px 80px; }
  .adm-stat-grid { grid-template-columns:1fr 1fr; }
}
.adm-mob-bar {
  display:none; position:fixed; bottom:0; left:0; right:0; z-index:100;
  padding:8px 10px 18px; gap:3px;
  background:var(--header-bg); border-top:1px solid var(--border);
  backdrop-filter:blur(24px);
}
.adm-mob-btn { flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; padding:7px 3px; border-radius:11px; border:none; cursor:pointer; background:transparent; font-family:'Noto Sans KR',sans-serif; transition:all .18s; }
.adm-mob-btn.active { background:var(--accent-dim); }
.adm-mob-icon  { font-size:20px; }
.adm-mob-label { font-size:9px; font-weight:600; color:var(--muted); }
.adm-mob-btn.active .adm-mob-label { color:var(--accent); }

.adm-spinner { width:14px; height:14px; border-radius:50%; border:2px solid rgba(0,0,0,.2); border-top-color:#000; animation:adm-spin 1s linear infinite; display:inline-block; vertical-align:middle; margin-right:5px; }
`;

const ADM_TABS = [
  { key:"users",    icon:"👥", label:"회원 관리" },
  { key:"stats",    icon:"📊", label:"통계" },
  { key:"settings", icon:"🔐", label:"설정" },
] as const;

const GUIDE_STEPS = [
  { title:"서버 실행", color:"#00c875", items:["터미널 → cd naver-bot","npm run dev 실행","서버 상태 확인"] },
  { title:"회원 관리", color:"#f59e0b", items:["등급 변경 (FREE/BASIC/PRO)","발행 건수 조정","만료일 연장"] },
  { title:"통계 확인", color:"#4285F4", items:["전체 발행 현황 확인","활성 회원 파악","실패 건 모니터링"] },
];

export default function AdminPage({ onBack, onDashboard, theme, onThemeToggle }: Props) {
  const [tab,       setTab]       = useState<"users"|"stats"|"settings">("users");
  const [users,     setUsers]     = useState<UserWithQuota[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editMap,   setEditMap]   = useState<Record<string,any>>({});
  const [saving,    setSaving]    = useState<string|null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [newAdminPw,  setNewAdminPw]  = useState("");
  const [newAdminPw2, setNewAdminPw2] = useState("");
  const [pwMsg,     setPwMsg]     = useState("");
  const [search,    setSearch]    = useState("");

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase.from("publy_users").select("*").order("created_at",{ascending:false});
    if (!data) { setLoading(false); return; }
    const withQ: UserWithQuota[] = await Promise.all(data.map(async u => {
      const { data:q } = await supabase.from("publy_quotas").select("*").eq("user_id",u.id).single();
      return { ...u, quota:q||undefined };
    }));
    setUsers(withQ); setLoading(false);
  }

  function edit(uid: string, key: string, val: any) {
    setEditMap(p=>({...p,[uid]:{...p[uid],[key]:val}}));
  }

  async function saveUser(u: UserWithQuota) {
    const e = editMap[u.id]||{};
    setSaving(u.id);
    try {
      if (e.plan&&e.plan!==u.plan) {
        await supabase.from("publy_users").update({plan:e.plan}).eq("id",u.id);
        const pq:Record<string,number>={free:10,basic:50,pro:999999};
        await supabase.from("publy_quotas").update({total_quota:pq[e.plan]||10}).eq("user_id",u.id);
      }
      if (e.quota!==undefined&&u.quota) {
        await supabase.from("publy_quotas").update({total_quota:Number(e.quota),used_quota:Math.min(u.quota.used_quota,Number(e.quota))}).eq("user_id",u.id);
      }
      if (e.days!==undefined&&u.quota) {
        const d = new Date(u.quota.reset_date);
        d.setDate(d.getDate()+Number(e.days));
        await supabase.from("publy_quotas").update({reset_date:d.toISOString()}).eq("user_id",u.id);
      }
      await loadUsers();
      setEditMap(p=>{const n={...p};delete n[u.id];return n;});
    } catch(e:any){alert("오류: "+e.message);}
    finally{setSaving(null);}
  }

  async function resetQuota(uid: string) {
    if (!confirm("건수를 초기화할까요?")) return;
    await supabase.from("publy_quotas").update({used_quota:0}).eq("user_id",uid);
    await loadUsers();
  }

  async function toggleActive(u: UserWithQuota) {
    if (!confirm(`${u.name||u.email} 계정을 ${u.is_active?"비활성화":"활성화"}할까요?`)) return;
    await supabase.from("publy_users").update({is_active:!u.is_active}).eq("id",u.id);
    await loadUsers();
  }

  function changeAdminPw() {
    if (!newAdminPw||!newAdminPw2) { setPwMsg("비밀번호를 입력하세요"); return; }
    if (newAdminPw!==newAdminPw2) { setPwMsg("비밀번호가 일치하지 않습니다"); return; }
    if (newAdminPw.length<4) { setPwMsg("4자 이상 입력하세요"); return; }
    localStorage.setItem("publy_admin_pw",newAdminPw);
    setNewAdminPw(""); setNewAdminPw2("");
    setPwMsg("✅ 비밀번호 변경 완료"); setTimeout(()=>setPwMsg(""),3000);
  }

  const filtered = users.filter(u=>!search||(u.name||"").includes(search)||u.email.includes(search));
  const totalUsers  = users.length;
  const activeUsers = users.filter(u=>u.is_active).length;
  const proUsers    = users.filter(u=>u.plan==="pro").length;
  const totalPub    = users.reduce((s,u)=>s+(u.quota?.used_quota||0),0);

  return (
    <>
      <style>{CSS}</style>
      <div className="adm-scan"/>

      {/* 가이드 */}
      {showGuide && (
        <div className="adm-guide-panel">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:".15em",color:"var(--accent)"}}>관리자 가이드</div>
              <div style={{fontSize:10,color:"var(--muted)"}}>Publy Admin 사용법</div>
            </div>
            <button onClick={()=>setShowGuide(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--muted)"}}>✕</button>
          </div>
          {GUIDE_STEPS.map((s,i)=>(
            <div key={i} style={{padding:"13px 15px",borderRadius:13,border:`1px solid ${s.color}30`,marginBottom:10,animationDelay:`${i*.07}s`}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}>
                <div style={{width:20,height:20,borderRadius:6,background:`${s.color}20`,border:`1px solid ${s.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:s.color}}>{i+1}</div>
                <span style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{s.title}</span>
              </div>
              {s.items.map((item,j)=>(
                <div key={j} style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                  <div style={{width:4,height:4,borderRadius:"50%",background:s.color,flexShrink:0}}/>
                  <span style={{fontSize:12,color:"var(--muted)"}}>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={`adm-root ${theme}`}>

        {/* 헤더 */}
        <div className="adm-header">
          <div className="adm-logo-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="4" fill="#000" opacity=".85"/>
              <path d="M12 7L16 15H8L12 7Z" fill="#f59e0b"/>
            </svg>
          </div>
          <div className="adm-logo">PUBLY ADMIN</div>
          <div className="adm-header-mid">
            <span className="adm-role-chip">ADMINISTRATOR</span>
            <span style={{fontSize:11,color:"var(--muted)",fontFamily:"'JetBrains Mono',monospace"}}>{totalUsers}명 관리 중</span>
          </div>
          <div className="adm-header-right">
            <button className="adm-icon-btn" onClick={()=>setShowGuide(v=>!v)} title="가이드">📖</button>
            <button className="adm-icon-btn" onClick={onThemeToggle}>{theme==="dark"?"☀️":"🌙"}</button>
            <button
              onClick={onDashboard}
              style={{
                display:"flex", alignItems:"center", gap:8,
                padding:"8px 16px", borderRadius:12, cursor:"pointer",
                background:"linear-gradient(135deg,rgba(0,255,136,.12),rgba(0,200,100,.08))",
                border:"1px solid rgba(0,255,136,.3)",
                color:"#00c875", fontSize:12, fontWeight:700,
                fontFamily:"'Noto Sans KR',sans-serif", transition:"all .2s",
              }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateX(-2px)"; e.currentTarget.style.boxShadow="0 4px 16px rgba(0,255,136,.2)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow="";}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M15 18L9 12L15 6" stroke="#00c875" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              대시보드로
            </button>
            <button className="adm-back-btn" onClick={onBack}>로그아웃</button>
          </div>
        </div>

        <div className="adm-body">

          {/* 사이드바 */}
          <div className="adm-sidebar">
            {ADM_TABS.map(t=>(
              <button key={t.key} className={`adm-nav-btn ${tab===t.key?"active":""}`} onClick={()=>setTab(t.key as any)}>
                <span style={{fontSize:17}}>{t.icon}</span>
                {t.label}
              </button>
            ))}
            <div style={{marginTop:"auto",paddingTop:14,borderTop:"1px solid var(--border)"}}>
              <button onClick={loadUsers} style={{width:"100%",padding:"9px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--card)",color:"var(--muted)",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif",transition:"all .2s"}}
                onMouseEnter={e=>(e.currentTarget.style.borderColor="var(--border2)")}
                onMouseLeave={e=>(e.currentTarget.style.borderColor="var(--border)")}>
                🔄 새로고침
              </button>
            </div>
          </div>

          {/* 콘텐츠 */}
          <div className="adm-content">

            {/* ─ 회원 관리 ─ */}
            {tab==="users" && (
              <div style={{animation:"adm-fade .3s ease both"}}>

                {/* 통계 */}
                <div className="adm-stat-grid">
                  {[
                    {label:"전체 회원",value:totalUsers,color:"var(--accent)",icon:"👥"},
                    {label:"활성 회원",value:activeUsers,color:"var(--success)",icon:"✅"},
                    {label:"PRO 회원",value:proUsers,color:"#4285F4",icon:"⭐"},
                    {label:"총 발행",value:totalPub,color:"var(--accent)",icon:"🚀"},
                  ].map((s,i)=>(
                    <div key={i} className="adm-stat-card" style={{animationDelay:`${i*.07}s`}}>
                      <div style={{fontSize:22,marginBottom:6}}>{s.icon}</div>
                      <div className="adm-stat-val" style={{color:s.color}}>{s.value}</div>
                      <div className="adm-stat-label">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 검색 */}
                <div style={{marginBottom:14}}>
                  <input className="adm-input" placeholder="이름 또는 이메일 검색..."
                    style={{width:"100%",padding:"11px 14px",fontSize:13}}
                    value={search} onChange={e=>setSearch(e.target.value)}/>
                </div>

                {/* 회원 목록 */}
                <div className="adm-card">
                  <div style={{padding:"14px 20px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:13,fontWeight:700}}>회원 목록 ({filtered.length}명)</span>
                    <button className="adm-btn-primary" onClick={loadUsers}>🔄 새로고침</button>
                  </div>

                  {loading ? (
                    <div style={{padding:"48px",textAlign:"center",color:"var(--muted)"}}>
                      <div style={{width:32,height:32,borderRadius:"50%",border:"3px solid var(--border)",borderTopColor:"var(--accent)",animation:"adm-spin 1s linear infinite",margin:"0 auto 12px"}}/>
                      불러오는 중...
                    </div>
                  ) : filtered.map((u,i) => {
                    const e = editMap[u.id]||{};
                    const pct = u.quota ? Math.min(100,(u.quota.used_quota/u.quota.total_quota)*100) : 0;
                    const qColor = pct>80?"var(--danger)":pct>60?"var(--accent)":"var(--success)";
                    return (
                      <div key={u.id} className="adm-user-row" style={{animationDelay:`${i*.04}s`}}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>

                          {/* 회원 정보 */}
                          <div style={{flex:1,minWidth:160}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                              <div style={{width:32,height:32,borderRadius:9,background:"var(--accent-dim)",border:"1px solid var(--border2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"var(--accent)",flexShrink:0}}>
                                {(u.name||u.email)[0].toUpperCase()}
                              </div>
                              <div>
                                <div style={{fontSize:14,fontWeight:700,display:"flex",alignItems:"center",gap:7}}>
                                  {u.name||"이름없음"}
                                  <span className={`adm-plan p-${e.plan||u.plan}`}>{(e.plan||u.plan).toUpperCase()}</span>
                                  {!u.is_active&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:99,background:"rgba(239,68,68,.12)",color:"var(--danger)",border:"1px solid rgba(239,68,68,.2)",fontWeight:800}}>비활성</span>}
                                </div>
                                <div style={{fontSize:11,color:"var(--muted)",fontFamily:"'JetBrains Mono',monospace"}}>{u.email}</div>
                              </div>
                            </div>
                          </div>

                          {/* 쿼터 */}
                          {u.quota && (
                            <div style={{minWidth:150}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                                <span style={{fontSize:10,color:"var(--muted)"}}>발행 건수</span>
                                <span style={{fontSize:11,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:qColor}}>{u.quota.used_quota}/{u.quota.total_quota}</span>
                              </div>
                              <div className="adm-q-bg">
                                <div className="adm-q-fill" style={{"--w":`${pct}%`,width:`${pct}%`,background:qColor} as any}/>
                              </div>
                              <div style={{fontSize:9,color:"var(--muted)",fontFamily:"'JetBrains Mono',monospace"}}>만료: {new Date(u.quota.reset_date).toLocaleDateString("ko-KR")}</div>
                            </div>
                          )}

                          {/* 수정 */}
                          <div style={{display:"flex",flexDirection:"column",gap:7,minWidth:260}}>
                            <div style={{display:"flex",alignItems:"center",gap:7}}>
                              <span style={{fontSize:10,color:"var(--muted)",width:56,flexShrink:0}}>등급</span>
                              <select className="adm-input" value={e.plan||u.plan} onChange={ev=>edit(u.id,"plan",ev.target.value)}>
                                <option value="free">FREE</option>
                                <option value="basic">BASIC</option>
                                <option value="pro">PRO</option>
                              </select>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:7}}>
                              <span style={{fontSize:10,color:"var(--muted)",width:56,flexShrink:0}}>총 건수</span>
                              <input className="adm-input" type="number" min="0" placeholder={String(u.quota?.total_quota||10)} style={{width:70}} value={e.quota??""} onChange={ev=>edit(u.id,"quota",ev.target.value)}/>
                              <button className="adm-btn-danger" onClick={()=>resetQuota(u.id)}>초기화</button>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:7}}>
                              <span style={{fontSize:10,color:"var(--muted)",width:56,flexShrink:0}}>날짜 +</span>
                              <input className="adm-input" type="number" min="0" placeholder="일수" style={{width:70}} value={e.days??""} onChange={ev=>edit(u.id,"days",ev.target.value)}/>
                              <span style={{fontSize:10,color:"var(--muted)"}}>일 연장</span>
                            </div>
                            <div style={{display:"flex",gap:6}}>
                              <button className="adm-btn-primary" onClick={()=>saveUser(u)} disabled={saving===u.id}>
                                {saving===u.id?<><span className="adm-spinner"/>저장 중...</>:<>💾 저장</>}
                              </button>
                              <button className={u.is_active?"adm-btn-danger":"adm-btn-success"} onClick={()=>toggleActive(u)}>
                                {u.is_active?"🚫 비활성화":"✅ 활성화"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ─ 통계 ─ */}
            {tab==="stats" && (
              <div style={{animation:"adm-fade .3s ease both"}}>
                <div className="adm-stat-grid" style={{marginBottom:20}}>
                  {[
                    {label:"전체 회원",value:totalUsers,color:"var(--accent)",icon:"👥"},
                    {label:"활성 회원",value:activeUsers,color:"var(--success)",icon:"✅"},
                    {label:"비활성",value:totalUsers-activeUsers,color:"var(--danger)",icon:"🚫"},
                    {label:"PRO",value:proUsers,color:"#4285F4",icon:"⭐"},
                    {label:"BASIC",value:users.filter(u=>u.plan==="basic").length,color:"#4285F4",icon:"🔵"},
                    {label:"FREE",value:users.filter(u=>u.plan==="free").length,color:"var(--muted)",icon:"⚪"},
                    {label:"총 발행",value:totalPub,color:"var(--accent)",icon:"🚀"},
                    {label:"평균 발행",value:totalUsers?Math.round(totalPub/totalUsers):0,color:"var(--accent2)",icon:"📊"},
                  ].map((s,i)=>(
                    <div key={i} className="adm-stat-card" style={{animationDelay:`${i*.06}s`}}>
                      <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
                      <div className="adm-stat-val" style={{color:s.color,fontSize:28}}>{s.value}</div>
                      <div className="adm-stat-label">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 플랜별 분포 */}
                <div className="adm-card" style={{padding:"20px 22px"}}>
                  <div className="adm-section-label">📊 플랜 분포</div>
                  {[
                    {label:"FREE",count:users.filter(u=>u.plan==="free").length,color:"#999"},
                    {label:"BASIC",count:users.filter(u=>u.plan==="basic").length,color:"#4285F4"},
                    {label:"PRO",count:users.filter(u=>u.plan==="pro").length,color:"#00c875"},
                  ].map(p=>(
                    <div key={p.label} style={{marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                        <span style={{fontSize:12,fontWeight:700,color:p.color}}>{p.label}</span>
                        <span style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"var(--muted)"}}>{p.count}명 ({totalUsers?Math.round(p.count/totalUsers*100):0}%)</span>
                      </div>
                      <div className="adm-q-bg">
                        <div className="adm-q-fill" style={{"--w":`${totalUsers?p.count/totalUsers*100:0}%`,width:`${totalUsers?p.count/totalUsers*100:0}%`,background:p.color} as any}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ─ 설정 ─ */}
            {tab==="settings" && (
              <div style={{animation:"adm-fade .3s ease both",maxWidth:520}}>
                <div className="adm-card" style={{padding:"22px"}}>
                  <div className="adm-section-label">🔐 관리자 비밀번호 변경</div>
                  <div style={{display:"flex",flexDirection:"column",gap:11,marginBottom:14}}>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>새 비밀번호</label>
                      <input className="adm-input" type="password" placeholder="새 비밀번호 (4자 이상)"
                        style={{width:"100%",padding:"11px 13px",fontSize:13}}
                        value={newAdminPw} onChange={e=>setNewAdminPw(e.target.value)}/>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:"var(--muted)",fontWeight:700,display:"block",marginBottom:5}}>비밀번호 확인</label>
                      <input className="adm-input" type="password" placeholder="비밀번호 확인"
                        style={{width:"100%",padding:"11px 13px",fontSize:13}}
                        value={newAdminPw2} onChange={e=>setNewAdminPw2(e.target.value)}
                        onKeyDown={e=>e.key==="Enter"&&changeAdminPw()}/>
                    </div>
                  </div>
                  <button className="adm-btn-primary" style={{padding:"11px 22px",fontSize:13}} onClick={changeAdminPw}>
                    🔐 비밀번호 변경
                  </button>
                  {pwMsg && (
                    <div style={{marginTop:12,padding:"10px 13px",borderRadius:10,
                      background:pwMsg.includes("✅")?"rgba(0,200,117,.08)":"rgba(239,68,68,.08)",
                      border:`1px solid ${pwMsg.includes("✅")?"rgba(0,200,117,.2)":"rgba(239,68,68,.2)"}`,
                      fontSize:12,color:pwMsg.includes("✅")?"var(--success)":"var(--danger)"}}>
                      {pwMsg}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 모바일 탭바 */}
        <div className="adm-mob-bar">
          {ADM_TABS.map(t=>(
            <button key={t.key} className={`adm-mob-btn ${tab===t.key?"active":""}`} onClick={()=>setTab(t.key as any)}>
              <span className="adm-mob-icon">{t.icon}</span>
              <span className="adm-mob-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
