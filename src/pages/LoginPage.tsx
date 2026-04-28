import { useState } from "react";
import { signIn, signUp, PublyUser } from "../lib/supabase";

interface Props { onLogin: (user: PublyUser) => void; }

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }

@keyframes grid-move { from{transform:translateY(0)} to{transform:translateY(60px)} }
@keyframes float-card { 0%,100%{transform:translateY(0) rotateX(0)} 50%{transform:translateY(-8px) rotateX(1deg)} }
@keyframes glow-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
@keyframes scan-line { 0%{top:-10%} 100%{top:110%} }
@keyframes logo-in { from{opacity:0;transform:scale(.8) translateY(-20px)} to{opacity:1;transform:scale(1) translateY(0)} }
@keyframes form-in { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
@keyframes orb-rotate { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes particle { 0%{transform:translateY(0) translateX(0);opacity:1} 100%{transform:translateY(-100px) translateX(var(--dx));opacity:0} }
@keyframes border-flow {
  0%{background-position:0% 50%}
  50%{background-position:100% 50%}
  100%{background-position:0% 50%}
}

.login-root {
  width: 100vw;
  height: 100vh;
  background: #050a12;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  font-family: 'Noto Sans KR', sans-serif;
}

/* 배경 그리드 */
.bg-grid {
  position: absolute;
  inset: -60px;
  background-image:
    linear-gradient(rgba(0,255,136,.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,255,136,.07) 1px, transparent 1px);
  background-size: 60px 60px;
  animation: grid-move 4s linear infinite;
}

/* 배경 오브 */
.bg-orb-1 {
  position: absolute;
  width: 600px; height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0,255,136,.08) 0%, transparent 70%);
  top: -200px; left: -200px;
  animation: orb-rotate 20s linear infinite;
}
.bg-orb-2 {
  position: absolute;
  width: 400px; height: 400px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0,120,255,.06) 0%, transparent 70%);
  bottom: -100px; right: -100px;
}

/* 스캔라인 */
.scan-line {
  position: absolute;
  left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(0,255,136,.4), transparent);
  animation: scan-line 4s linear infinite;
  pointer-events: none;
}

/* 카드 */
.login-card {
  position: relative;
  width: 420px;
  background: rgba(255,255,255,.03);
  border-radius: 24px;
  padding: 48px 40px;
  backdrop-filter: blur(20px);
  animation: float-card 6s ease-in-out infinite, form-in .6s ease both;
  z-index: 10;
}

/* 카드 테두리 */
.login-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 25px;
  background: linear-gradient(135deg, rgba(0,255,136,.4), rgba(0,120,255,.2), rgba(0,255,136,.1), rgba(0,120,255,.3));
  background-size: 400% 400%;
  animation: border-flow 4s ease infinite;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  padding: 1px;
  z-index: -1;
}

/* 카드 내부 글로우 */
.login-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 24px;
  background: radial-gradient(circle at 50% 0%, rgba(0,255,136,.05) 0%, transparent 60%);
  pointer-events: none;
}

/* 로고 */
.logo-wrap {
  text-align: center;
  margin-bottom: 36px;
  animation: logo-in .5s ease both;
}
.logo-icon {
  width: 72px; height: 72px;
  border-radius: 20px;
  background: linear-gradient(135deg, #00ff88, #00cc66);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  box-shadow: 0 0 40px rgba(0,255,136,.4), 0 0 80px rgba(0,255,136,.1);
  animation: glow-pulse 2s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}
.logo-icon::after {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: linear-gradient(45deg, transparent 30%, rgba(255,255,255,.15) 50%, transparent 70%);
  animation: orb-rotate 3s linear infinite;
}
.logo-text {
  font-family: 'Orbitron', monospace;
  font-size: 28px;
  font-weight: 900;
  letter-spacing: .15em;
  background: linear-gradient(135deg, #00ff88, #00cc66, #fff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: block;
}
.logo-sub {
  font-size: 11px;
  color: rgba(255,255,255,.35);
  letter-spacing: .2em;
  text-transform: uppercase;
  margin-top: 4px;
  display: block;
}

/* 탭 */
.tabs {
  display: flex;
  gap: 4px;
  background: rgba(255,255,255,.05);
  border-radius: 12px;
  padding: 4px;
  margin-bottom: 28px;
}
.tab-btn {
  flex: 1;
  padding: 9px;
  border: none;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all .2s;
  font-family: 'Noto Sans KR', sans-serif;
}
.tab-btn.active {
  background: linear-gradient(135deg, #00ff88, #00cc66);
  color: #000;
  box-shadow: 0 4px 12px rgba(0,255,136,.3);
}
.tab-btn.inactive {
  background: transparent;
  color: rgba(255,255,255,.45);
}
.tab-btn.inactive:hover { color: rgba(255,255,255,.8); }

/* 인풋 */
.input-group { margin-bottom: 14px; }
.input-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255,255,255,.45);
  letter-spacing: .08em;
  text-transform: uppercase;
  margin-bottom: 7px;
}
.login-input {
  width: 100%;
  padding: 13px 16px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  color: white;
  font-size: 14px;
  font-family: 'Noto Sans KR', sans-serif;
  outline: none;
  transition: all .2s;
}
.login-input:focus {
  border-color: rgba(0,255,136,.5);
  background: rgba(0,255,136,.04);
  box-shadow: 0 0 0 3px rgba(0,255,136,.1);
}
.login-input::placeholder { color: rgba(255,255,255,.25); }

/* 버튼 */
.login-btn {
  width: 100%;
  padding: 15px;
  background: linear-gradient(135deg, #00ff88, #00cc66);
  color: #000;
  font-size: 15px;
  font-weight: 800;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  font-family: 'Noto Sans KR', sans-serif;
  letter-spacing: .02em;
  transition: all .2s;
  position: relative;
  overflow: hidden;
  margin-top: 8px;
}
.login-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.2), transparent);
  transform: translateX(-100%);
  transition: transform .4s;
}
.login-btn:hover::after { transform: translateX(100%); }
.login-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,255,136,.4); }
.login-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }

/* 에러 */
.error-msg {
  color: #ff4444;
  font-size: 12px;
  text-align: center;
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(255,68,68,.08);
  border-radius: 8px;
  border: 1px solid rgba(255,68,68,.2);
}

/* 로더 */
.btn-loader {
  width: 18px; height: 18px;
  border: 2px solid rgba(0,0,0,.3);
  border-top-color: #000;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  display: inline-block;
  vertical-align: middle;
  margin-right: 8px;
}

/* 하단 장식 */
.bottom-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 28px;
}
.dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: rgba(0,255,136,.3);
}
.dot.active { background: #00ff88; animation: glow-pulse 1.5s ease-in-out infinite; }

@media(max-width:480px) {
  .login-card { width: 95vw; padding: 36px 24px; }
}
`;

export default function LoginPage({ onLogin }: Props) {
  const [mode, setMode] = useState<"login"|"register">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!email || !pw) { setError("이메일과 비밀번호를 입력하세요"); return; }
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        const user = await signIn(email, pw);
        onLogin(user);
      } else {
        if (!name) { setError("이름을 입력하세요"); setLoading(false); return; }
        const user = await signUp(email, pw, name);
        onLogin(user);
      }
    } catch(e:any) {
      setError(e.message);
    } finally { setLoading(false); }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="login-root">
        <div className="bg-grid"/>
        <div className="bg-orb-1"/>
        <div className="bg-orb-2"/>
        <div className="scan-line"/>

        <div className="login-card">
          {/* 로고 */}
          <div className="logo-wrap">
            <div className="logo-icon">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{position:"relative",zIndex:1}}>
                <path d="M18 4L32 28H4L18 4Z" fill="#000" opacity=".9"/>
                <path d="M18 10L28 26H8L18 10Z" fill="#00ff88" opacity=".6"/>
                <circle cx="18" cy="20" r="3" fill="#000"/>
              </svg>
            </div>
            <span className="logo-text">PUBLY</span>
            <span className="logo-sub">Auto Publishing System</span>
          </div>

          {/* 탭 */}
          <div className="tabs">
            <button className={`tab-btn ${mode==="login"?"active":"inactive"}`}
              onClick={()=>{setMode("login");setError("")}}>로그인</button>
            <button className={`tab-btn ${mode==="register"?"active":"inactive"}`}
              onClick={()=>{setMode("register");setError("")}}>회원가입</button>
          </div>

          {/* 폼 */}
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
            {loading && <span className="btn-loader"/>}
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
