import { useState, useEffect, useRef } from "react";
import { signIn, signUp, PublyUser } from "../lib/supabase";

interface Props {
  onLogin: (user: PublyUser) => void;
  onAdminLogin: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Bebas+Neue&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');

*{box-sizing:border-box;margin:0;padding:0;}

@keyframes cosmos-drift {
  0%{transform:translate(0,0) rotate(0deg)}
  33%{transform:translate(20px,-15px) rotate(120deg)}
  66%{transform:translate(-15px,20px) rotate(240deg)}
  100%{transform:translate(0,0) rotate(360deg)}
}
@keyframes star-twinkle { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:1;transform:scale(1.4)} }
@keyframes card-float { 0%,100%{transform:translateY(0) rotateX(0)} 50%{transform:translateY(-8px) rotateX(.5deg)} }
@keyframes glow-breathe { 0%,100%{box-shadow:0 0 40px rgba(0,255,136,.15),0 0 80px rgba(0,255,136,.05)} 50%{box-shadow:0 0 60px rgba(0,255,136,.3),0 0 120px rgba(0,255,136,.1)} }
@keyframes line-scan { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
@keyframes logo-emerge { 0%{opacity:0;transform:scale(.6) rotateY(-90deg)} 100%{opacity:1;transform:scale(1) rotateY(0deg)} }
@keyframes form-rise { 0%{opacity:0;transform:translateY(40px)} 100%{opacity:1;transform:translateY(0)} }
@keyframes spin-slow { to{transform:rotate(360deg)} }
@keyframes spin-rev  { to{transform:rotate(-360deg)} }
@keyframes pulse-ring { 0%{transform:scale(.8);opacity:.8} 100%{transform:scale(2);opacity:0} }
@keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
@keyframes typewriter { from{width:0} to{width:100%} }
@keyframes blink-cursor { 0%,100%{opacity:1} 50%{opacity:0} }

/* 루트 */
.login-root {
  width:100vw; height:100vh; overflow:hidden;
  display:flex; align-items:center; justify-content:center;
  position:relative; font-family:'Noto Sans KR',sans-serif;
  perspective:1000px;
}
.login-root.dark  { background:#02040a; }
.login-root.light { background:#f0f8ff; }

/* 우주 배경 */
.cosmos-bg {
  position:absolute; inset:0; overflow:hidden; pointer-events:none;
}
.cosmos-orb {
  position:absolute; border-radius:50%;
  filter:blur(80px);
}
.cosmos-orb-1 { width:600px; height:600px; top:-200px; left:-200px; animation:cosmos-drift 20s linear infinite; }
.cosmos-orb-2 { width:400px; height:400px; bottom:-100px; right:-100px; animation:cosmos-drift 25s linear infinite reverse; }
.cosmos-orb-3 { width:300px; height:300px; top:50%; left:50%; animation:cosmos-drift 15s linear infinite; }
.dark .cosmos-orb-1  { background:radial-gradient(circle,rgba(0,255,136,.12) 0%,transparent 70%); }
.dark .cosmos-orb-2  { background:radial-gradient(circle,rgba(0,100,255,.08) 0%,transparent 70%); }
.dark .cosmos-orb-3  { background:radial-gradient(circle,rgba(180,0,255,.06) 0%,transparent 70%); }
.light .cosmos-orb-1 { background:radial-gradient(circle,rgba(0,200,100,.08) 0%,transparent 70%); }
.light .cosmos-orb-2 { background:radial-gradient(circle,rgba(0,100,255,.06) 0%,transparent 70%); }
.light .cosmos-orb-3 { background:radial-gradient(circle,rgba(0,180,80,.04) 0%,transparent 70%); }

/* 별 */
.star { position:absolute; border-radius:50%; animation:star-twinkle var(--dur,3s) var(--del,0s) ease-in-out infinite; }
.dark .star  { background:white; }
.light .star { background:rgba(0,150,80,.4); }

/* 스캔라인 */
.scan-line {
  position:absolute; left:0; right:0; height:1px; pointer-events:none;
  animation:line-scan 8s linear infinite;
}
.dark .scan-line  { background:linear-gradient(90deg,transparent,rgba(0,255,136,.3),transparent); }
.light .scan-line { background:linear-gradient(90deg,transparent,rgba(0,180,80,.2),transparent); }

/* 상단 버튼 */
.top-bar { position:fixed; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:center; padding:16px 24px; z-index:100; }
.top-btn {
  width:44px; height:44px; border-radius:14px; cursor:pointer; font-size:18px;
  display:flex; align-items:center; justify-content:center; border:1px solid;
  transition:all .25s; backdrop-filter:blur(12px);
}
.dark .top-btn  { background:rgba(255,255,255,.05); border-color:rgba(0,255,136,.2); color:white; }
.light .top-btn { background:rgba(255,255,255,.8); border-color:rgba(0,180,80,.2); color:#09090b; box-shadow:0 2px 12px rgba(0,0,0,.08); }
.top-btn:hover { transform:scale(1.08) rotate(5deg); }
.admin-btn:hover { transform:scale(1.08) rotate(45deg) !important; }
.top-brand {
  font-family:'Bebas Neue',sans-serif; font-size:22px; letter-spacing:.2em;
  background:linear-gradient(135deg,#00ff88,#00cc66);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
}

/* 메인 카드 */
.login-card {
  position:relative; width:460px; z-index:10;
  border-radius:28px; padding:52px 44px;
  animation:card-float 7s ease-in-out infinite, form-rise .7s ease both, glow-breathe 4s ease-in-out infinite;
}
.dark .login-card {
  background:rgba(255,255,255,.03);
  border:1px solid rgba(0,255,136,.15);
  box-shadow:0 0 0 1px rgba(0,255,136,.05), inset 0 1px 0 rgba(0,255,136,.1);
  backdrop-filter:blur(40px);
}
.light .login-card {
  background:rgba(255,255,255,.92);
  border:1px solid rgba(0,180,80,.15);
  box-shadow:0 32px 80px rgba(0,0,0,.08), 0 0 0 1px rgba(0,180,80,.08);
  backdrop-filter:blur(40px);
}

/* 카드 상단 장식선 */
.card-glow-line {
  position:absolute; top:0; left:20%; right:20%; height:1px; border-radius:99px;
}
.dark .card-glow-line  { background:linear-gradient(90deg,transparent,rgba(0,255,136,.6),transparent); }
.light .card-glow-line { background:linear-gradient(90deg,transparent,rgba(0,180,80,.4),transparent); }

/* 로고 */
.logo-section { text-align:center; margin-bottom:40px; }
.logo-ring-wrap {
  position:relative; width:88px; height:88px; margin:0 auto 20px;
  animation:logo-emerge .8s cubic-bezier(.34,1.56,.64,1) both;
}
.logo-ring {
  position:absolute; inset:0; border-radius:50%; border:2px solid;
}
.logo-ring-outer {
  animation:spin-slow 8s linear infinite;
  border-style:dashed;
}
.logo-ring-inner {
  inset:8px; animation:spin-rev 5s linear infinite;
  border-style:dotted;
}
.dark .logo-ring  { border-color:rgba(0,255,136,.3); }
.light .logo-ring { border-color:rgba(0,180,80,.3); }
.logo-core {
  position:absolute; inset:16px; border-radius:50%;
  background:linear-gradient(135deg,#00ff88,#00cc66);
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 0 30px rgba(0,255,136,.5);
}
.logo-pulse {
  position:absolute; inset:16px; border-radius:50%;
  border:2px solid rgba(0,255,136,.4);
  animation:pulse-ring 2s ease-out infinite;
}
.logo-name {
  font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:.25em;
  background:linear-gradient(135deg,#00ff88,#00cc66,#ffffff);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
}
.logo-tagline { font-size:10px; letter-spacing:.3em; text-transform:uppercase; margin-top:4px; }
.dark .logo-tagline  { color:rgba(255,255,255,.35); }
.light .logo-tagline { color:rgba(0,0,0,.4); }

/* 탭 */
.tab-group {
  display:grid; grid-template-columns:1fr 1fr;
  gap:3px; border-radius:16px; padding:4px; margin-bottom:28px;
}
.dark .tab-group  { background:rgba(255,255,255,.06); }
.light .tab-group { background:rgba(0,0,0,.06); }
.tab-btn {
  padding:11px; border:none; border-radius:13px; cursor:pointer;
  font-size:13px; font-weight:600; letter-spacing:.02em;
  transition:all .22s; font-family:'Noto Sans KR',sans-serif;
}
.tab-btn.active {
  background:linear-gradient(135deg,#00ff88,#00cc66);
  color:#000; box-shadow:0 4px 16px rgba(0,255,136,.35);
  transform:translateY(-1px);
}
.dark .tab-btn.inactive  { background:transparent; color:rgba(255,255,255,.4); }
.light .tab-btn.inactive { background:transparent; color:rgba(0,0,0,.45); }

/* 인풋 그룹 */
.field { margin-bottom:14px; }
.field-label {
  display:flex; align-items:center; gap:6px;
  font-size:10px; font-weight:700; letter-spacing:.12em;
  text-transform:uppercase; margin-bottom:7px;
}
.dark .field-label  { color:rgba(255,255,255,.4); }
.light .field-label { color:rgba(0,0,0,.45); }
.field-input {
  width:100%; padding:13px 16px; border-radius:13px;
  font-size:14px; font-family:'Noto Sans KR',sans-serif;
  outline:none; transition:all .22s;
}
.dark .field-input {
  background:rgba(255,255,255,.06);
  border:1.5px solid rgba(255,255,255,.08);
  color:white;
}
.light .field-input {
  background:#f8fffe;
  border:1.5px solid rgba(0,180,80,.15);
  color:#09090b;
}
.field-input::placeholder { opacity:.4; }
.dark .field-input::placeholder  { color:white; }
.light .field-input::placeholder { color:#09090b; }
.field-input:focus {
  border-color:rgba(0,255,136,.5) !important;
  box-shadow:0 0 0 4px rgba(0,255,136,.08) !important;
  background:rgba(0,255,136,.03) !important;
}

/* 제출 버튼 */
.submit-btn {
  width:100%; padding:15px; margin-top:6px;
  border:none; border-radius:14px; cursor:pointer;
  font-family:'Noto Sans KR',sans-serif;
  font-size:15px; font-weight:800; letter-spacing:.03em;
  background:linear-gradient(135deg,#00ff88,#00cc66,#00aa55);
  background-size:200% 100%;
  color:#000; position:relative; overflow:hidden;
  transition:all .25s;
}
.submit-btn::before {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);
  transform:translateX(-100%); transition:transform .5s;
}
.submit-btn:hover::before { transform:translateX(100%); }
.submit-btn:hover { transform:translateY(-2px); box-shadow:0 12px 32px rgba(0,255,136,.45); }
.submit-btn:disabled { opacity:.45; cursor:not-allowed; transform:none; }

/* 에러 */
.error-box {
  margin-top:12px; padding:11px 14px; border-radius:11px;
  font-size:12px; display:flex; align-items:center; gap:8px;
}
.dark .error-box  { background:rgba(255,60,60,.08); border:1px solid rgba(255,60,60,.2); color:#ff8888; }
.light .error-box { background:rgba(220,38,38,.06); border:1px solid rgba(220,38,38,.15); color:#dc2626; }

/* 하단 장식 */
.card-footer { display:flex; justify-content:center; align-items:center; gap:8px; margin-top:28px; }
.footer-dot { width:5px; height:5px; border-radius:50%; }
.dark .footer-dot  { background:rgba(0,255,136,.25); }
.light .footer-dot { background:rgba(0,180,80,.2); }
.footer-dot.active { background:#00ff88 !important; box-shadow:0 0 8px rgba(0,255,136,.6); }

/* 로더 */
.btn-spin {
  width:16px; height:16px; border-radius:50%;
  border:2.5px solid rgba(0,0,0,.2); border-top-color:#000;
  animation:spin-slow 1s linear infinite;
  display:inline-block; vertical-align:middle; margin-right:8px;
}

@media(max-width:520px) {
  .login-card { width:95vw; padding:40px 24px; }
  .logo-name { font-size:30px; }
}
`;

// 별 생성
function Stars({ count = 60 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="star" style={{
          width: Math.random() * 3 + 1 + "px",
          height: Math.random() * 3 + 1 + "px",
          top: Math.random() * 100 + "%",
          left: Math.random() * 100 + "%",
          "--dur": (Math.random() * 4 + 2) + "s",
          "--del": (Math.random() * 4) + "s",
          opacity: Math.random() * 0.6 + 0.2,
        } as any} />
      ))}
    </>
  );
}

export default function LoginPage({ onLogin, onAdminLogin, theme, onThemeToggle }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
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
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className={`login-root ${theme}`}>
        {/* 배경 */}
        <div className="cosmos-bg">
          <div className="cosmos-orb cosmos-orb-1" />
          <div className="cosmos-orb cosmos-orb-2" />
          <div className="cosmos-orb cosmos-orb-3" />
          <Stars count={80} />
          <div className="scan-line" />
        </div>

        {/* 상단 */}
        <div className="top-bar">
          <div className="top-brand">PUBLY</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="top-btn" onClick={onThemeToggle}>{theme === "dark" ? "☀️" : "🌙"}</button>
            <button className="top-btn admin-btn" onClick={onAdminLogin} title="관리자">⚙️</button>
          </div>
        </div>

        {/* 카드 */}
        <div className="login-card">
          <div className="card-glow-line" />

          {/* 로고 */}
          <div className="logo-section">
            <div className="logo-ring-wrap">
              <div className="logo-ring logo-ring-outer" />
              <div className="logo-ring logo-ring-inner" />
              <div className="logo-pulse" />
              <div className="logo-core">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                  <path d="M16 3L29 26H3L16 3Z" fill="#000" opacity=".85" />
                  <path d="M16 9L25 24H7L16 9Z" fill="#00ff88" opacity=".6" />
                  <circle cx="16" cy="20" r="2.5" fill="#000" />
                </svg>
              </div>
            </div>
            <div className="logo-name">PUBLY</div>
            <div className="logo-tagline">Auto Publishing System v2</div>
          </div>

          {/* 탭 */}
          <div className="tab-group">
            <button className={`tab-btn ${mode === "login" ? "active" : "inactive"}`}
              onClick={() => { setMode("login"); setError(""); }}>로그인</button>
            <button className={`tab-btn ${mode === "register" ? "active" : "inactive"}`}
              onClick={() => { setMode("register"); setError(""); }}>회원가입</button>
          </div>

          {/* 폼 */}
          {mode === "register" && (
            <div className="field">
              <div className="field-label">👤 이름</div>
              <input className="field-input" placeholder="홍길동"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <div className="field-label">✉️ 이메일</div>
            <input className="field-input" type="email" placeholder="email@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>
          <div className="field">
            <div className="field-label">🔒 비밀번호</div>
            <input className="field-input" type="password" placeholder="••••••••"
              value={pw} onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>

          <button className="submit-btn" onClick={handleSubmit} disabled={loading}>
            {loading && <span className="btn-spin" />}
            {mode === "login" ? "🚀 입장하기" : "✨ 가입하기"}
          </button>

          {error && <div className="error-box">⚠️ {error}</div>}

          <div className="card-footer">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className={`footer-dot ${i === 2 ? "active" : ""}`} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
