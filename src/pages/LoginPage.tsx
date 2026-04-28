import { useState, useEffect } from "react";
import { signIn, signUp, PublyUser } from "../lib/supabase";

interface Props {
  onLogin: (user: PublyUser) => void;
  onAdminLogin: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }

@keyframes grid-move  { from{transform:translateY(0)} to{transform:translateY(60px)} }
@keyframes float-card { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
@keyframes glow-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
@keyframes scan-line  { 0%{top:-10%} 100%{top:110%} }
@keyframes form-in    { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
@keyframes border-flow { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
@keyframes spin       { to{transform:rotate(360deg)} }

.publy-login-root {
  width:100vw; height:100vh;
  display:flex; align-items:center; justify-content:center;
  overflow:hidden; position:relative;
  font-family:'Noto Sans KR',sans-serif; transition:background .3s;
}
.publy-login-root.dark  { background:#050a12; }
.publy-login-root.light { background:#f0faf4; }

.bg-grid {
  position:absolute; inset:-60px;
  background-size:60px 60px;
  animation:grid-move 5s linear infinite;
}
.dark .bg-grid  { background-image:linear-gradient(rgba(0,255,136,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,.06) 1px,transparent 1px); }
.light .bg-grid { background-image:linear-gradient(rgba(0,160,80,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,160,80,.06) 1px,transparent 1px); }

.bg-orb {
  position:absolute; width:500px; height:500px; border-radius:50%;
  top:-150px; left:-150px; pointer-events:none;
}
.dark .bg-orb  { background:radial-gradient(circle,rgba(0,255,136,.07) 0%,transparent 70%); }
.light .bg-orb { background:radial-gradient(circle,rgba(0,200,100,.07) 0%,transparent 70%); }

/* 상단 버튼 */
.top-btns { position:fixed; top:16px; right:16px; display:flex; gap:10px; z-index:100; }
.icon-btn {
  width:42px; height:42px; border-radius:13px; cursor:pointer;
  font-size:18px; display:flex; align-items:center; justify-content:center;
  transition:all .2s; backdrop-filter:blur(10px);
  border:1px solid; position:relative; overflow:hidden;
}
.dark .icon-btn  { background:rgba(255,255,255,.06); border-color:rgba(0,255,136,.2); }
.light .icon-btn { background:rgba(255,255,255,.8); border-color:rgba(0,160,80,.2); box-shadow:0 2px 8px rgba(0,0,0,.08); }
.icon-btn:hover  { transform:scale(1.1); }
.icon-btn.gear:hover { transform:rotate(45deg) scale(1.1); }

/* 카드 */
.login-card {
  position:relative; width:420px;
  border-radius:24px; padding:48px 40px;
  backdrop-filter:blur(24px);
  animation:float-card 6s ease-in-out infinite, form-in .5s ease both;
  z-index:10; transition:all .3s;
}
.dark .login-card  { background:rgba(255,255,255,.03); border:1px solid rgba(0,255,136,.2); box-shadow:0 24px 60px rgba(0,0,0,.3); }
.light .login-card { background:rgba(255,255,255,.95); border:1px solid rgba(0,160,80,.2); box-shadow:0 24px 60px rgba(0,0,0,.1); }
.dark .login-card::before {
  content:''; position:absolute; inset:-1px; border-radius:25px;
  background:linear-gradient(135deg,rgba(0,255,136,.4),rgba(0,120,255,.2),rgba(0,255,136,.1));
  background-size:400% 400%; animation:border-flow 4s ease infinite;
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor; mask-composite:exclude; padding:1px; z-index:-1;
}

/* 로고 */
.logo-wrap { text-align:center; margin-bottom:32px; }
.logo-icon {
  width:68px; height:68px; border-radius:18px;
  background:linear-gradient(135deg,#00ff88,#00cc66);
  display:inline-flex; align-items:center; justify-content:center;
  margin-bottom:14px; box-shadow:0 0 32px rgba(0,255,136,.4);
  animation:glow-pulse 2.5s ease-in-out infinite;
}
.logo-text {
  font-family:'Orbitron',monospace; font-size:26px; font-weight:900;
  letter-spacing:.15em;
  background:linear-gradient(135deg,#00ff88,#00cc66);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  display:block;
}
.logo-sub { font-size:10px; letter-spacing:.2em; text-transform:uppercase; margin-top:3px; display:block; }
.dark .logo-sub  { color:rgba(255,255,255,.4); }
.light .logo-sub { color:rgba(0,0,0,.45); }

/* 탭 */
.tabs { display:flex; gap:4px; border-radius:12px; padding:4px; margin-bottom:22px; }
.dark .tabs  { background:rgba(255,255,255,.05); }
.light .tabs { background:rgba(0,0,0,.06); }
.tab-btn { flex:1; padding:9px; border:none; border-radius:9px; font-size:13px; font-weight:600; cursor:pointer; transition:all .2s; font-family:'Noto Sans KR',sans-serif; }
.tab-btn.active { background:linear-gradient(135deg,#00ff88,#00cc66); color:#000; box-shadow:0 4px 12px rgba(0,255,136,.3); }
.tab-btn.inactive { background:transparent; }
.dark .tab-btn.inactive  { color:rgba(255,255,255,.45); }
.light .tab-btn.inactive { color:rgba(0,0,0,.5); }

/* 인풋 */
.input-group { margin-bottom:12px; }
.input-label { display:block; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; margin-bottom:6px; }
.dark .input-label  { color:rgba(255,255,255,.45); }
.light .input-label { color:rgba(0,0,0,.5); }
.login-input { width:100%; padding:12px 14px; border-radius:12px; font-size:14px; font-family:'Noto Sans KR',sans-serif; outline:none; transition:all .2s; }
.dark .login-input  { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); color:white; }
.light .login-input { background:#f4f4f5; border:1px solid #d4d4d8; color:#09090b; }
.login-input:focus { border-color:rgba(0,255,136,.5)!important; box-shadow:0 0 0 3px rgba(0,255,136,.1)!important; }
.dark .login-input::placeholder  { color:rgba(255,255,255,.3); }
.light .login-input::placeholder { color:rgba(0,0,0,.4); }

/* 버튼 */
.login-btn {
  width:100%; padding:14px;
  background:linear-gradient(135deg,#00ff88,#00cc66);
  color:#000; font-size:15px; font-weight:800;
  border:none; border-radius:12px; cursor:pointer;
  font-family:'Noto Sans KR',sans-serif; transition:all .2s; margin-top:6px;
}
.login-btn:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,255,136,.4); }
.login-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }

.error-msg { font-size:12px; text-align:center; margin-top:10px; padding:8px 12px; border-radius:8px; }
.dark .error-msg  { color:#ff8888; background:rgba(255,68,68,.08); border:1px solid rgba(255,68,68,.2); }
.light .error-msg { color:#dc2626; background:rgba(255,68,68,.06); border:1px solid rgba(255,68,68,.2); }

.spin-icon { width:16px; height:16px; border:2px solid rgba(0,0,0,.3); border-top-color:#000; border-radius:50%; animation:spin 1s linear infinite; display:inline-block; vertical-align:middle; margin-right:6px; }

.bottom-dots { display:flex; justify-content:center; gap:6px; margin-top:22px; }
.dot { width:6px; height:6px; border-radius:50%; }
.dark .dot  { background:rgba(0,255,136,.25); }
.light .dot { background:rgba(0,160,80,.2); }
.dot.active { background:#00ff88!important; animation:glow-pulse 1.5s ease-in-out infinite; }

@media(max-width:480px) { .login-card { width:95vw; padding:36px 20px; } }
`;

export default function LoginPage({ onLogin, onAdminLogin, theme, onThemeToggle }: Props) {
  const [mode, setMode] = useState<"login"|"register">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!email || !pw) { setError("이메일과 비밀번호를 입력하세요"); return; }
    setLoading(true); setError("");
    try {
      if (mode === "login") {
        const user = await signIn(email, pw);
        onLogin(user);
      } else {
        if (!name) { setError("이름을 입력하세요"); setLoading(false); return; }
        const user = await signUp(email, pw, name);
        onLogin(user);
      }
    } catch(e:any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className={`publy-login-root ${theme}`}>
        <div className="bg-grid"/>
        <div className="bg-orb"/>

        {/* 상단 버튼 */}
        <div className="top-btns">
          <button className="icon-btn" onClick={onThemeToggle} title="테마 변경">
            {theme==="dark" ? "☀️" : "🌙"}
          </button>
          <button className="icon-btn gear" onClick={onAdminLogin} title="관리자">
            ⚙️
          </button>
        </div>

        <div className="login-card">
          <div className="logo-wrap">
            <div className="logo-icon">
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                <path d="M17 3L31 28H3L17 3Z" fill="#000" opacity=".85"/>
                <path d="M17 9L27 26H7L17 9Z" fill="#00ff88" opacity=".55"/>
                <circle cx="17" cy="21" r="2.5" fill="#000"/>
              </svg>
            </div>
            <span className="logo-text">PUBLY</span>
            <span className="logo-sub">Auto Publishing System</span>
          </div>

          <div className="tabs">
            <button className={`tab-btn ${mode==="login"?"active":"inactive"}`}
              onClick={()=>{setMode("login");setError("")}}>로그인</button>
            <button className={`tab-btn ${mode==="register"?"active":"inactive"}`}
              onClick={()=>{setMode("register");setError("")}}>회원가입</button>
          </div>

          {mode==="register" && (
            <div className="input-group">
              <label className="input-label">이름</label>
              <input className="login-input" placeholder="홍길동"
                value={name} onChange={e=>setName(e.target.value)}/>
            </div>
          )}
          <div className="input-group">
            <label className="input-label">이메일</label>
            <input className="login-input" type="email" placeholder="email@example.com"
              value={email} onChange={e=>setEmail(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
          </div>
          <div className="input-group">
            <label className="input-label">비밀번호</label>
            <input className="login-input" type="password" placeholder="••••••••"
              value={pw} onChange={e=>setPw(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
          </div>

          <button className="login-btn" onClick={handleSubmit} disabled={loading}>
            {loading && <span className="spin-icon"/>}
            {mode==="login" ? "입장하기" : "가입하기"}
          </button>

          {error && <div className="error-msg">⚠️ {error}</div>}

          <div className="bottom-dots">
            {[0,1,2,3,4].map(i=>(
              <div key={i} className={`dot ${i===2?"active":""}`}/>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
