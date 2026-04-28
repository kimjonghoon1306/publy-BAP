import { useState, useEffect } from "react";
import { supabase, PublyUser } from "../lib/supabase";

interface Props {
  onBack: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

interface UserWithQuota extends PublyUser {
  quota?: {
    total_quota: number;
    used_quota: number;
    remaining_quota: number;
    reset_date: string;
  };
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Noto+Sans+KR:wght@400;500;600;700&display=swap');
* { box-sizing:border-box; }

@keyframes ap-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes ap-spin { to{transform:rotate(360deg)} }
@keyframes ap-glow { 0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)} 50%{box-shadow:0 0 0 6px transparent} }

.ap-root {
  width:100vw; min-height:100vh;
  font-family:'Noto Sans KR',sans-serif;
  transition:background .3s;
}
.ap-root.dark  { background:#080a06; color:white; }
.ap-root.light { background:#fffbeb; color:#09090b; }

/* 헤더 */
.ap-header {
  position:sticky; top:0; z-index:20;
  display:flex; align-items:center; justify-content:space-between;
  padding:14px 24px; backdrop-filter:blur(20px);
  border-bottom:1px solid;
}
.dark .ap-header  { background:rgba(8,10,6,.85); border-color:rgba(245,158,11,.15); }
.light .ap-header { background:rgba(255,251,235,.9); border-color:rgba(180,100,0,.12); }

.ap-logo {
  font-family:'Orbitron',monospace; font-size:16px; font-weight:900;
  letter-spacing:.12em;
  background:linear-gradient(135deg,#f59e0b,#d97706);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  display:flex; align-items:center; gap:10px;
}
.ap-logo-icon {
  width:30px; height:30px; border-radius:8px;
  background:linear-gradient(135deg,#f59e0b,#d97706);
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 0 12px rgba(245,158,11,.4);
}

.ap-header-btns { display:flex; align-items:center; gap:8px; }
.ap-icon-btn {
  width:38px; height:38px; border-radius:11px; cursor:pointer;
  font-size:16px; display:flex; align-items:center; justify-content:center;
  transition:all .2s; border:1px solid;
}
.dark .ap-icon-btn  { background:rgba(245,158,11,.08); border-color:rgba(245,158,11,.2); }
.light .ap-icon-btn { background:rgba(255,255,255,.7); border-color:rgba(180,100,0,.15); }
.ap-icon-btn:hover { transform:scale(1.08); }

.back-link {
  display:flex; align-items:center; gap:6px;
  padding:8px 14px; border-radius:11px; cursor:pointer;
  font-size:12px; font-weight:600; border:1px solid; transition:all .2s;
  font-family:'Noto Sans KR',sans-serif;
}
.dark .back-link  { background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.1); color:rgba(255,255,255,.6); }
.light .back-link { background:rgba(255,255,255,.7); border-color:rgba(0,0,0,.1); color:rgba(0,0,0,.6); }
.back-link:hover  { transform:translateX(-2px); }

/* 바디 */
.ap-body { padding:24px; max-width:1200px; margin:0 auto; }

/* 통계 카드 */
.stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
.stat-card {
  padding:18px 20px; border-radius:16px; border:1px solid;
  animation:ap-fade .3s ease both; transition:all .2s;
}
.dark .stat-card  { background:rgba(255,255,255,.03); border-color:rgba(255,255,255,.06); }
.light .stat-card { background:white; border-color:#e4e4e7; box-shadow:0 2px 8px rgba(0,0,0,.05); }
.stat-card:hover  { border-color:rgba(245,158,11,.3); }

/* 회원 테이블 */
.user-section { border-radius:18px; border:1px solid; overflow:hidden; }
.dark .user-section  { background:rgba(255,255,255,.02); border-color:rgba(255,255,255,.07); }
.light .user-section { background:white; border-color:#e4e4e7; box-shadow:0 2px 12px rgba(0,0,0,.05); }

.section-header { padding:16px 20px; border-bottom:1px solid; display:flex; align-items:center; justify-content:space-between; }
.dark .section-header  { border-color:rgba(255,255,255,.07); }
.light .section-header { border-color:#e4e4e7; }

.user-row { padding:14px 20px; border-bottom:1px solid; transition:all .15s; animation:ap-fade .3s ease both; }
.dark .user-row  { border-color:rgba(255,255,255,.04); }
.light .user-row { border-color:#f4f4f5; }
.dark .user-row:hover  { background:rgba(245,158,11,.04); }
.light .user-row:hover { background:#fffbeb; }

/* 배지 */
.plan-badge { font-size:10px; font-weight:800; padding:3px 9px; border-radius:99px; }
.plan-free    { background:rgba(100,100,100,.15); color:#888; }
.plan-basic   { background:rgba(66,133,244,.15); color:#4285F4; }
.plan-pro     { background:rgba(0,255,136,.15); color:#00cc66; }

/* 인풋/셀렉트 */
.ap-input {
  padding:6px 10px; border-radius:8px; font-size:12px;
  font-family:'Noto Sans KR',sans-serif; outline:none; transition:all .2s;
  width:80px;
}
.dark .ap-input  { background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); color:white; }
.light .ap-input { background:#f4f4f5; border:1px solid #d4d4d8; color:#09090b; }
.ap-input:focus  { border-color:rgba(245,158,11,.5)!important; }

.ap-select {
  padding:6px 10px; border-radius:8px; font-size:12px;
  font-family:'Noto Sans KR',sans-serif; outline:none; transition:all .2s;
  appearance:auto; color-scheme:dark;
}
.dark .ap-select  { background:#1a1a0a; border:1px solid rgba(255,255,255,.12); color:white; }
.light .ap-select { background:#f4f4f5; border:1px solid #d4d4d8; color:#09090b; color-scheme:light; }

/* 버튼들 */
.ap-btn {
  padding:6px 12px; border-radius:8px; font-size:11px; font-weight:700;
  border:none; cursor:pointer; transition:all .15s;
  font-family:'Noto Sans KR',sans-serif; display:inline-flex; align-items:center; gap:4px;
}
.ap-btn-amber { background:linear-gradient(135deg,#f59e0b,#d97706); color:#000; }
.ap-btn-amber:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(245,158,11,.4); }
.ap-btn-red { background:rgba(239,68,68,.15); color:#ef4444; border:1px solid rgba(239,68,68,.2); }
.ap-btn-red:hover { background:rgba(239,68,68,.25); }
.ap-btn-green { background:rgba(0,255,136,.15); color:#00cc66; border:1px solid rgba(0,255,136,.2); }
.ap-btn-green:hover { background:rgba(0,255,136,.25); }

/* 날짜 연장 */
.extend-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }

.ap-text    { }
.dark .ap-text  { color:white; }
.light .ap-text { color:#09090b; }
.ap-muted   { }
.dark .ap-muted  { color:rgba(255,255,255,.45); }
.light .ap-muted { color:rgba(0,0,0,.5); }

@media(max-width:768px) {
  .stat-grid { grid-template-columns:repeat(2,1fr); }
  .ap-body { padding:16px; }
}
@media(max-width:480px) {
  .stat-grid { grid-template-columns:1fr 1fr; }
}
`;

const PLAN_LABELS: Record<string,string> = { free:"FREE", basic:"BASIC", pro:"PRO" };

export default function AdminPage({ onBack, theme, onThemeToggle }: Props) {
  const [users, setUsers] = useState<UserWithQuota[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMap, setEditMap] = useState<Record<string,{quota?:number;days?:number;plan?:string}>>({});
  const [saving, setSaving] = useState<string|null>(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data: usersData } = await supabase.from("publy_users").select("*").order("created_at", { ascending: false });
    if (!usersData) { setLoading(false); return; }

    const withQuota: UserWithQuota[] = await Promise.all(
      usersData.map(async (u) => {
        const { data: q } = await supabase.from("publy_quotas").select("*").eq("user_id", u.id).single();
        return { ...u, quota: q || undefined };
      })
    );
    setUsers(withQuota);
    setLoading(false);
  }

  function edit(userId: string, key: string, value: any) {
    setEditMap(prev => ({ ...prev, [userId]: { ...prev[userId], [key]: value } }));
  }

  async function saveUser(user: UserWithQuota) {
    const e = editMap[user.id] || {};
    setSaving(user.id);

    try {
      // 플랜 변경
      if (e.plan && e.plan !== user.plan) {
        await supabase.from("publy_users").update({ plan: e.plan }).eq("id", user.id);
        // 플랜별 기본 쿼터 설정
        const planQuota: Record<string,number> = { free:10, basic:50, pro:999999 };
        await supabase.from("publy_quotas").update({ total_quota: planQuota[e.plan] || 10 }).eq("user_id", user.id);
      }

      // 발행 건수 수동 조정
      if (e.quota !== undefined && user.quota) {
        await supabase.from("publy_quotas").update({
          total_quota: Number(e.quota),
          used_quota: Math.min(user.quota.used_quota, Number(e.quota)),
        }).eq("user_id", user.id);
      }

      // 만료일 연장
      if (e.days !== undefined && user.quota) {
        const current = new Date(user.quota.reset_date);
        current.setDate(current.getDate() + Number(e.days));
        await supabase.from("publy_quotas").update({ reset_date: current.toISOString() }).eq("user_id", user.id);
      }

      await loadUsers();
      setEditMap(prev => { const n = {...prev}; delete n[user.id]; return n; });
      alert("저장됨");
    } catch(e:any) { alert("오류: " + e.message); }
    finally { setSaving(null); }
  }

  async function resetQuota(userId: string) {
    if (!confirm("발행 건수를 초기화할까요?")) return;
    await supabase.from("publy_quotas").update({ used_quota: 0 }).eq("user_id", userId);
    await loadUsers();
  }

  async function toggleActive(user: UserWithQuota) {
    if (!confirm(`${user.name || user.email} 계정을 ${user.is_active?"비활성화":"활성화"}할까요?`)) return;
    await supabase.from("publy_users").update({ is_active: !user.is_active }).eq("id", user.id);
    await loadUsers();
  }

  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.is_active).length;
  const proUsers = users.filter(u => u.plan==="pro").length;
  const totalPub = users.reduce((s, u) => s + (u.quota?.used_quota||0), 0);

  return (
    <>
      <style>{CSS}</style>
      <div className={`ap-root ${theme}`}>

        {/* 헤더 */}
        <div className="ap-header">
          <div className="ap-logo">
            <div className="ap-logo-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="4" fill="#000" opacity=".85"/>
                <path d="M12 7L16 15H8L12 7Z" fill="#f59e0b"/>
              </svg>
            </div>
            PUBLY ADMIN
          </div>
          <div className="ap-header-btns">
            <button className="ap-icon-btn" onClick={onThemeToggle}>{theme==="dark"?"☀️":"🌙"}</button>
            <button className="back-link" onClick={onBack}>← 일반 로그인</button>
          </div>
        </div>

        <div className="ap-body">

          {/* 통계 */}
          <div className="stat-grid">
            {[
              { label:"전체 회원", value:totalUsers, color:"#f59e0b", icon:"👥" },
              { label:"활성 회원", value:activeUsers, color:"#00cc66", icon:"✅" },
              { label:"PRO 회원", value:proUsers, color:"#4285F4", icon:"⭐" },
              { label:"총 발행 수", value:totalPub, color:"#f59e0b", icon:"🚀" },
            ].map((s,i)=>(
              <div key={i} className="stat-card" style={{animationDelay:`${i*.07}s`}}>
                <div style={{fontSize:22,marginBottom:8}}>{s.icon}</div>
                <div style={{fontSize:26,fontWeight:800,color:s.color}}>{s.value}</div>
                <div style={{fontSize:11,marginTop:3}} className="ap-muted">{s.label}</div>
              </div>
            ))}
          </div>

          {/* 회원 목록 */}
          <div className="user-section">
            <div className="section-header">
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:14,fontWeight:700}} className="ap-text">회원 관리</span>
                <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:"rgba(245,158,11,.15)",color:"#f59e0b",fontWeight:700}}>
                  {totalUsers}명
                </span>
              </div>
              <button className="ap-btn ap-btn-amber" onClick={loadUsers}>🔄 새로고침</button>
            </div>

            {loading ? (
              <div style={{padding:"48px",textAlign:"center",color:"rgba(255,255,255,.3)"}}>
                <div style={{width:32,height:32,border:"3px solid rgba(245,158,11,.2)",borderTopColor:"#f59e0b",borderRadius:"50%",animation:"ap-spin 1s linear infinite",margin:"0 auto 12px"}}/>
                불러오는 중...
              </div>
            ) : users.length===0 ? (
              <div style={{padding:"48px",textAlign:"center"}} className="ap-muted">회원이 없습니다</div>
            ) : users.map((u, i) => {
              const e = editMap[u.id] || {};
              const pct = u.quota ? Math.min(100,(u.quota.used_quota/u.quota.total_quota)*100) : 0;
              const resetDate = u.quota ? new Date(u.quota.reset_date) : null;

              return (
                <div key={u.id} className="user-row" style={{animationDelay:`${i*.04}s`}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>

                    {/* 회원 정보 */}
                    <div style={{flex:1,minWidth:160}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                        <span style={{fontSize:14,fontWeight:700}} className="ap-text">{u.name || "이름없음"}</span>
                        <span className={`plan-badge plan-${e.plan||u.plan}`}>{PLAN_LABELS[e.plan||u.plan]}</span>
                        {!u.is_active && <span style={{fontSize:10,padding:"2px 7px",borderRadius:99,background:"rgba(239,68,68,.15)",color:"#ef4444",fontWeight:700}}>비활성</span>}
                      </div>
                      <div style={{fontSize:11}} className="ap-muted">{u.email}</div>
                      <div style={{fontSize:10,marginTop:2}} className="ap-muted">
                        가입: {new Date(u.created_at).toLocaleDateString("ko-KR")}
                      </div>
                    </div>

                    {/* 쿼터 */}
                    {u.quota && (
                      <div style={{minWidth:160}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                          <span style={{fontSize:11}} className="ap-muted">발행 건수</span>
                          <span style={{fontSize:11,fontWeight:700}} className="ap-text">
                            {u.quota.used_quota}/{u.quota.total_quota}
                          </span>
                        </div>
                        <div style={{height:5,borderRadius:99,background:"rgba(255,255,255,.1)",overflow:"hidden",marginBottom:6}}>
                          <div style={{height:"100%",borderRadius:99,width:`${pct}%`,background:pct>80?"#ef4444":"linear-gradient(90deg,#f59e0b,#d97706)"}}/>
                        </div>
                        <div style={{fontSize:10}} className="ap-muted">
                          만료: {resetDate?.toLocaleDateString("ko-KR")}
                        </div>
                      </div>
                    )}

                    {/* 수정 컨트롤 */}
                    <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:280}}>
                      {/* 플랜 변경 */}
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:11,width:60,flexShrink:0}} className="ap-muted">등급</span>
                        <select className="ap-select"
                          value={e.plan||u.plan}
                          onChange={ev=>edit(u.id,"plan",ev.target.value)}>
                          <option value="free">FREE</option>
                          <option value="basic">BASIC</option>
                          <option value="pro">PRO</option>
                        </select>
                      </div>

                      {/* 발행 건수 */}
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:11,width:60,flexShrink:0}} className="ap-muted">총 건수</span>
                        <input className="ap-input" type="number" min="0"
                          placeholder={String(u.quota?.total_quota||10)}
                          value={e.quota??""} onChange={ev=>edit(u.id,"quota",ev.target.value)}/>
                        <button className="ap-btn ap-btn-red" onClick={()=>resetQuota(u.id)}>초기화</button>
                      </div>

                      {/* 만료일 연장 */}
                      <div className="extend-row">
                        <span style={{fontSize:11,width:60,flexShrink:0}} className="ap-muted">날짜 +</span>
                        <input className="ap-input" type="number" min="0" placeholder="일수"
                          value={e.days??""} onChange={ev=>edit(u.id,"days",ev.target.value)}/>
                        <span style={{fontSize:11}} className="ap-muted">일 연장</span>
                      </div>

                      {/* 저장/활성화 */}
                      <div style={{display:"flex",gap:6}}>
                        <button className="ap-btn ap-btn-amber"
                          onClick={()=>saveUser(u)} disabled={saving===u.id}>
                          {saving===u.id?"저장 중...":"💾 저장"}
                        </button>
                        <button className={`ap-btn ${u.is_active?"ap-btn-red":"ap-btn-green"}`}
                          onClick={()=>toggleActive(u)}>
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
      </div>
    </>
  );
}
