import { useState } from "react";

interface Props {
  onAdminAuth: () => void;
  onBack: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

const ADMIN_PW = "publy_admin_2024!"; // 관리자 비밀번호

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Noto+Sans+KR:wght@400;600;700&display=swap');
* { box-sizing:border-box; margin:0; padding:0; }

@keyframes admin-grid { from{transform:translateY(0)} to{transform:translateY(40px)} }
@keyframes admin-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
@keyframes admin-in { from{opacity:0;transform:scale(.95)} to{opacity:1;transform:scale(1)} }
@keyframes admin-glow { 0%,100%{box-shadow:0 0 20px rgba(245,158,11,.3)} 50%{box-shadow:0 0 40px rgba(245,158,11,.6)} }
@keyframes spin { to{transform:rotate(360deg)} }

.admin-root {
  width:100vw; height:100vh;
  display:flex; align-items:center; justify-content:center;
  overflow:hidden; position:relative;
  font-family:'Noto Sans KR',sans-serif; transition:background .3s;
}
.admin-root.dark  { background:#080a06; }
.admin-root.light { background:#fffbeb; }

.admin-grid {
  position:absolute; inset:-40px;
  background-size:50px 50px;
  animation:admin-grid 5s linear infinite;
}
.dark .admin-grid  { background-image:linear-gradient(rgba(245,158,11,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(245,158,11,.05) 1px,transparent 1px); }
.light .admin-grid { background-image:linear-gradient(rgba(180,100,0,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(180,100,0,.06) 1px,transparent 1px); }

.top-btns { position:fixed; top:16px; right:16px; display:flex; gap:10px; z-index:100; }
.icon-btn {
  width:42px; height:42px; border-radius:13px; cursor:pointer;
  font-size:18px; display:flex; align-items:center; justify-content:center;
  transition:all .2s; backdrop-filter:blur(10px); border:1px solid;
}
.dark .icon-btn  { background:rgba(245,158,11,.1); border-color:rgba(245,158,11,.25); }
.light .icon-btn { background:rgba(255,255,255,.8); border-color:rgba(180,100,0,.2); }
.icon-btn:hover  { transform:scale(1.1); }

.back-btn {
  position:fixed; top:16px; left:16px; z-index:100;
  display:flex; align-items:center; gap:7px;
  padding:10px 16px; border-radius:13px; cursor:pointer;
  font-size:13px; font-weight:600; border:1px solid;
  font-family:'Noto Sans KR',sans-serif; transition:all .2s; backdrop-filter:blur(10px);
}
.dark .back-btn  { background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.1); color:rgba(255,255,255,.6); }
.light .back-btn { background:rgba(255,255,255,.8); border-color:rgba(0,0,0,.1); color:rgba(0,0,0,.6); }
.back-btn:hover  { transform:translateX(-2px); }

.admin-card {
  position:relative; width:400px;
  border-radius:24px; padding:44px 38px;
  animation:admin-float 5s ease-in-out infinite, admin-in .4s ease both;
  z-index:10; transition:all .3s;
}
.dark .admin-card  { background:rgba(245,158,11,.04); border:1px solid rgba(245,158,11,.25); box-shadow:0 0 60px rgba(245,158,11,.08); }
.light .admin-card { background:rgba(255,255,255,.95); border:1px solid rgba(180,100,0,.2); box-shadow:0 16px 48px rgba(0,0,0,.1); }

.admin-logo-icon {
  width:68px; height:68px; border-radius:18px;
  background:linear-gradient(135deg,#f59e0b,#d97706);
  display:inline-flex; align-items:center; justify-content:center;
  margin-bottom:14px; animation:admin-glow 2.5s ease-in-out infinite;
}
.admin-logo-text {
  font-family:'Orbitron',monospace; font-size:20px; font-weight:900;
  letter-spacing:.12em;
  background:linear-gradient(135deg,#f59e0b,#d97706);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
}
.admin-sub { font-size:10px; letter-spacing:.18em; text-transform:uppercase; margin-top:3px; }
.dark .admin-sub  { color:rgba(255,255,255,.4); }
.light .admin-sub { color:rgba(0,0,0,.45); }

.admin-input { width:100%; padding:13px 15px; border-radius:12px; font-size:14px; font-family:'Noto Sans KR',sans-serif; outline:none; transition:all .2s; margin-bottom:14px; }
.dark .admin-input  { background:rgba(245,158,11,.06); border:1px solid rgba(245,158,11,.2); color:white; }
.light .admin-input { background:#fef9ee; border:1px solid #f59e0b40; color:#09090b; }
.admin-input:focus { border-color:rgba(245,158,11,.6)!important; box-shadow:0 0 0 3px rgba(245,158,11,.12)!important; }
.dark .admin-input::placeholder  { color:rgba(255,255,255,.3); }
.light .admin-input::placeholder { color:rgba(0,0,0,.35); }

.admin-btn {
  width:100%; padding:14px;
  background:linear-gradient(135deg,#f59e0b,#d97706);
  color:#000; font-size:15px; font-weight:800;
  border:none; border-radius:12px; cursor:pointer;
  font-family:'Noto Sans KR',sans-serif; transition:all .2s;
}
.admin-btn:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(245,158,11,.5); }
.admin-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }

.admin-error { font-size:12px; text-align:center; margin-top:10px; padding:8px 12px; border-radius:8px; }
.dark .admin-error  { color:#ffaa55; background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.2); }
.light .admin-error { color:#b45309; background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.2); }

.admin-label { display:block; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; margin-bottom:6px; }
.dark .admin-label  { color:rgba(255,255,255,.45); }
.light .admin-label { color:rgba(0,0,0,.5); }

@media(max-width:480px) { .admin-card { width:95vw; padding:36px 20px; } }
`;

export default function AdminLoginPage({ onAdminAuth, onBack, theme, onThemeToggle }: Props) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!pw) { setError("비밀번호를 입력하세요"); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    if (pw === ADMIN_PW) {
      sessionStorage.setItem("publy_admin_auth", "true");
      onAdminAuth();
    } else {
      setError("비밀번호가 올바르지 않습니다");
    }
    setLoading(false);
  }

  return (
    <>
      <style>{CSS}</style>
      <div className={`admin-root ${theme}`}>
        <div className="admin-grid"/>

        {/* 뒤로가기 */}
        <button className="back-btn" onClick={onBack}>
          ← 일반 로그인
        </button>

        {/* 테마 */}
        <div className="top-btns">
          <button className="icon-btn" onClick={onThemeToggle}>
            {theme==="dark" ? "☀️" : "🌙"}
          </button>
        </div>

        <div className="admin-card">
          <div style={{textAlign:"center",marginBottom:32}}>
            <div className="admin-logo-icon">
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                <rect x="4" y="4" width="26" height="26" rx="6" fill="#000" opacity=".85"/>
                <path d="M17 10L22 20H12L17 10Z" fill="#f59e0b" opacity=".9"/>
                <circle cx="17" cy="23" r="2" fill="#f59e0b"/>
              </svg>
            </div>
            <div className="admin-logo-text">ADMIN</div>
            <div className="admin-sub">관리자 전용 페이지</div>
          </div>

          <label className="admin-label">관리자 비밀번호</label>
          <input className="admin-input" type="password" placeholder="관리자 비밀번호 입력"
            value={pw} onChange={e=>setPw(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>

          <button className="admin-btn" onClick={handleLogin} disabled={loading}>
            {loading
              ? <span style={{display:"inline-block",width:16,height:16,border:"2px solid rgba(0,0,0,.3)",borderTopColor:"#000",borderRadius:"50%",animation:"spin 1s linear infinite",verticalAlign:"middle",marginRight:6}}/>
              : null
            }
            관리자 입장
          </button>

          {error && <div className="admin-error">⚠️ {error}</div>}
        </div>
      </div>
    </>
  );
}
