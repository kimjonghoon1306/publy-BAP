import { useState, useEffect, useRef } from "react";
import { signIn, signUp, PublyUser, findEmailByNamePhone, resetPasswordTemp, supabase } from "../lib/supabase";

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

/* 찾기 링크 */
.find-links { display:flex; justify-content:center; gap:16px; margin-top:16px; }
.find-link { background:none; border:none; cursor:pointer; font-size:12px; font-family:'Noto Sans KR',sans-serif; font-weight:600; letter-spacing:.03em; opacity:.55; transition:opacity .2s; text-decoration:underline; }
.find-link:hover { opacity:1; }
.dark .find-link  { color:rgba(255,255,255,.7); }
.light .find-link { color:rgba(0,0,0,.6); }

/* 찾기 모달 오버레이 */
.find-overlay { position:fixed; inset:0; z-index:999; display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(8px); }
.dark .find-overlay  { background:rgba(0,0,0,.75); }
.light .find-overlay { background:rgba(0,0,0,.45); }
.find-modal { width:100%; max-width:400px; border-radius:24px; padding:32px 28px; animation:form-rise .3s ease both; }
.dark .find-modal  { background:#0d1117; border:1px solid rgba(0,255,136,.15); }
.light .find-modal { background:#fff; border:1px solid rgba(0,180,80,.2); box-shadow:0 24px 60px rgba(0,0,0,.15); }
.find-title { font-size:18px; font-weight:900; margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; }
.dark .find-title  { color:#fff; }
.light .find-title { color:#09090b; }
.find-tabs { display:grid; grid-template-columns:1fr 1fr; gap:4px; border-radius:12px; padding:4px; margin-bottom:20px; }
.dark .find-tabs  { background:rgba(255,255,255,.06); }
.light .find-tabs { background:rgba(0,0,0,.06); }
.find-tab { padding:9px; border:none; border-radius:9px; cursor:pointer; font-size:12px; font-weight:700; font-family:'Noto Sans KR',sans-serif; transition:all .2s; }
.find-tab.active { background:linear-gradient(135deg,#00ff88,#00cc66); color:#000; }
.dark .find-tab.inactive  { background:transparent; color:rgba(255,255,255,.4); }
.light .find-tab.inactive { background:transparent; color:rgba(0,0,0,.4); }
.find-result { margin-top:16px; padding:16px; border-radius:12px; font-size:14px; font-weight:700; text-align:center; line-height:1.6; }
.dark .find-result  { background:rgba(0,255,136,.08); border:1px solid rgba(0,255,136,.2); color:#00ff88; }
.light .find-result { background:rgba(0,180,80,.06); border:1px solid rgba(0,180,80,.2); color:#00a050; }
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

// ── PWA 설치 버튼 ─────────────────────────────────────────────
function PWAInstallBtn({ theme }: { theme: "dark" | "light" }) {
  const [prompt, setPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (installed || !prompt) return null;

  return (
    <button
      onClick={async () => { prompt.prompt(); const r = await prompt.userChoice; if (r.outcome === "accepted") setInstalled(true); }}
      style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 24px", borderRadius: 99,
        background: "linear-gradient(135deg,#00ff88,#00cc66)",
        color: "#000", fontWeight: 800, fontSize: 13,
        border: "none", cursor: "pointer", zIndex: 999,
        fontFamily: "'Noto Sans KR', sans-serif",
        boxShadow: "0 8px 24px rgba(0,255,136,.45)",
        animation: "pwa-bounce 2s ease-in-out infinite",
        whiteSpace: "nowrap",
      }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 2v13M7 11l5 5 5-5M3 19h18" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Publy 앱 설치하기
    </button>
  );
}


export default function LoginPage({ onLogin, onAdminLogin, theme, onThemeToggle }: Props) {
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const handleLogoTap = () => {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 5) { logoTapCount.current = 0; onAdminLogin(); return; }
    logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 1400);
  };
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refCode, setRefCode] = useState("");

  useEffect(()=>{
    // URL 파라미터 방식은 Electron에서 동작 안 함 — 코드 직접 입력으로 전환
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) { setRefCode(ref); setMode("register"); }
  }, []);

  // 찾기 모달
  const [findOpen, setFindOpen] = useState(false);
  const [findTab, setFindTab] = useState<"email"|"pw">("email");
  const [findName, setFindName] = useState("");
  const [findPhone, setFindPhone] = useState("");
  const [findEmail, setFindEmail] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findResult, setFindResult] = useState("");
  const [findError, setFindError] = useState("");

  function openFind(tab: "email"|"pw") {
    setFindTab(tab); setFindOpen(true);
    setFindName(""); setFindPhone(""); setFindEmail("");
    setFindResult(""); setFindError("");
  }

  async function handleFindEmail() {
    if(!findName.trim()||!findPhone.trim()){setFindError("이름과 연락처를 모두 입력하세요");return;}
    setFindLoading(true); setFindResult(""); setFindError("");
    try {
      const found = await findEmailByNamePhone(findName, findPhone);
      if(!found) { setFindError("일치하는 회원 정보가 없습니다"); return; }
      // 이메일 마스킹: hong***@gmail.com
      const [local, domain] = found.split("@");
      const masked = local.slice(0,3) + "***@" + domain;
      setFindResult(`가입된 이메일: ${masked}`);
    } catch(e:any) { setFindError(e.message); }
    finally { setFindLoading(false); }
  }

  async function handleResetPw() {
    if(!findEmail.trim()){setFindError("이메일을 입력하세요");return;}
    setFindLoading(true); setFindResult(""); setFindError("");
    try {
      const tempPw = await resetPasswordTemp(findEmail);
      setFindResult(`임시 비밀번호: ${tempPw}\n\n로그인 후 설정탭에서 꼭 변경해주세요!`);
    } catch(e:any) { setFindError(e.message); }
    finally { setFindLoading(false); }
  }

  async function handleSubmit() {
    if (!email || !pw) { setError("이메일과 비밀번호를 입력하세요"); return; }
    if (mode === "register") {
      if (!name) { setError("이름을 입력하세요"); return; }
      if (!phone.trim()) { setError("연락처는 필수 입력 항목이에요\n이메일/비밀번호 찾기에 사용됩니다 📱"); return; }
      if (!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phone.replace(/\s/g,""))) {
        setError("올바른 연락처 형식으로 입력해주세요\n예: 010-1234-5678"); return;
      }
    }
    setLoading(true); setError("");
    try {
      if (mode === "login") {
        const user = await signIn(email, pw);
        onLogin(user);
      } else {
        // 초대 코드 8자리 → userId 조회
        let referredBy: string | undefined = undefined;
        if (refCode.length === 8) {
          const { data: refUser } = await supabase
            .from("publy_users")
            .select("id")
            .ilike("id", `${refCode}%`)
            .maybeSingle();
          if (refUser?.id) referredBy = refUser.id;
        }
        const user = await signUp(email, pw, name, phone.trim(), referredBy);
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
          </div>
        </div>

        {/* 카드 */}
        <div className="login-card">
          <div className="card-glow-line" />

          {/* 로고 */}
          <div className="logo-section" role="button" tabIndex={0} aria-label="퍼블리 로고" onClick={handleLogoTap} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") handleLogoTap(); }}>
            <div className="logo-ring-wrap">
              <div className="logo-ring logo-ring-outer" />
              <div className="logo-ring logo-ring-inner" />
              <div className="logo-pulse" />
              <div className="logo-core">
                <svg width="36" height="36" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" style={{borderRadius:8}}>
                  <defs>
                    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#0a1628"/>
                      <stop offset="100%" stopColor="#050a12"/>
                    </linearGradient>
                    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#00ff88"/>
                      <stop offset="100%" stopColor="#00cc66"/>
                    </linearGradient>
                    <filter id="glow">
                      <feGaussianBlur stdDeviation="3" result="blur"/>
                      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                  </defs>
                  <rect width="192" height="192" rx="36" fill="url(#bg)"/>
                  <circle cx="96" cy="96" r="72" fill="none" stroke="#00ff88" strokeWidth="1" opacity="0.12"/>
                  <circle cx="96" cy="96" r="55" fill="none" stroke="#00ff88" strokeWidth="1" opacity="0.08"/>
                  <text x="96" y="126" fontFamily="Arial Black, sans-serif" fontSize="108" fontWeight="900" fill="url(#g1)" textAnchor="middle" filter="url(#glow)" letterSpacing="-4">P</text>
                  <rect x="44" y="148" width="104" height="20" rx="10" fill="#00ff88" opacity="0.12"/>
                  <text x="96" y="163" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="700" fill="#00ff88" textAnchor="middle" letterSpacing="4">PUBLY</text>
                </svg>
              </div>
            </div>
            <div className="logo-name">PUBLY</div>
            <div className="logo-tagline">Auto Publishing System v2</div>
          </div>

          {/* 초대 링크 배지 */}
          {refCode&&(
            <div style={{marginBottom:16,padding:"8px 14px",borderRadius:10,background:"rgba(0,255,136,.08)",border:"1px solid rgba(0,255,136,.2)",fontSize:12,color:"#00ff88",fontWeight:700,textAlign:"center"}}>
              🎉 초대 링크로 접속했어요! 가입하면 쿼터 보너스가 지급돼요
            </div>
          )}

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
          {mode === "register" && (
            <div className="field">
              <div className="field-label">
                📱 연락처 <span style={{color:"#ff6b6b",fontSize:10,marginLeft:4}}>필수</span>
              </div>
              <input className="field-input" type="tel" placeholder="010-1234-5678"
                value={phone} onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()} />
              <div style={{marginTop:6,padding:"8px 12px",borderRadius:9,fontSize:11,lineHeight:1.6,
                background:"rgba(0,255,136,.06)",border:"1px solid rgba(0,255,136,.15)",
                color:theme==="dark"?"rgba(0,255,136,.8)":"rgba(0,150,80,.9)"}}>
                💡 연락처는 이메일 찾기 · 비밀번호 찾기에 꼭 필요해요
              </div>
            </div>
          )}

          {mode === "register" && (
            <div className="field">
              <div className="field-label">🎁 초대 코드 <span style={{fontSize:10,opacity:.6,marginLeft:4}}>선택</span></div>
              <input className="field-input" placeholder="초대 코드 입력 (8자리)"
                value={refCode} onChange={e => setRefCode(e.target.value.toUpperCase().trim())}
                maxLength={8}
                style={{letterSpacing:".1em",fontWeight:700}} />
            </div>
          )}

          <button className="submit-btn" onClick={handleSubmit} disabled={loading}>
            {loading && <span className="btn-spin" />}
            {mode === "login" ? "🚀 입장하기" : "✨ 가입하기"}
          </button>

          {error && <div className="error-box" style={{whiteSpace:"pre-line"}}>⚠️ {error}</div>}

          {/* 이메일/비밀번호 찾기 링크 */}
          {mode==="login"&&(
            <div className="find-links">
              <button className="find-link" onClick={()=>openFind("email")}>이메일 찾기</button>
              <span style={{opacity:.3,fontSize:12}}>|</span>
              <button className="find-link" onClick={()=>openFind("pw")}>비밀번호 찾기</button>
            </div>
          )}

          <div className="card-footer">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className={`footer-dot ${i === 2 ? "active" : ""}`} />
            ))}
          </div>
        </div>

      {/* 이메일/비밀번호 찾기 모달 */}
      {findOpen&&(
        <div className="find-overlay" onClick={()=>setFindOpen(false)}>
          <div className="find-modal" onClick={e=>e.stopPropagation()}>
            <div className="find-title">
              <span>{findTab==="email"?"📧 이메일 찾기":"🔑 비밀번호 찾기"}</span>
              <button onClick={()=>setFindOpen(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,opacity:.5,color:"inherit"}}>✕</button>
            </div>

            <div className="find-tabs">
              <button className={`find-tab ${findTab==="email"?"active":"inactive"}`} onClick={()=>{setFindTab("email");setFindResult("");setFindError("");}}>이메일 찾기</button>
              <button className={`find-tab ${findTab==="pw"?"active":"inactive"}`} onClick={()=>{setFindTab("pw");setFindResult("");setFindError("");}}>비밀번호 찾기</button>
            </div>

            {findTab==="email"?(
              <>
                <div style={{padding:"10px 14px",borderRadius:10,fontSize:12,lineHeight:1.7,marginBottom:16,
                  background:theme==="dark"?"rgba(255,255,255,.04)":"rgba(0,0,0,.04)",
                  color:theme==="dark"?"rgba(255,255,255,.5)":"rgba(0,0,0,.5)"}}>
                  📌 가입 시 입력한 <b>이름</b>과 <b>연락처</b>로 이메일을 찾아드려요
                </div>
                <div className="field">
                  <div className="field-label">👤 이름</div>
                  <input className="field-input" placeholder="가입 시 입력한 이름" value={findName} onChange={e=>setFindName(e.target.value)}/>
                </div>
                <div className="field">
                  <div className="field-label">📱 연락처</div>
                  <input className="field-input" placeholder="010-1234-5678" value={findPhone} onChange={e=>setFindPhone(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleFindEmail()}/>
                </div>
                <button className="submit-btn" onClick={handleFindEmail} disabled={findLoading}>
                  {findLoading&&<span className="btn-spin"/>}🔍 이메일 찾기
                </button>
              </>
            ):(
              <>
                <div style={{padding:"10px 14px",borderRadius:10,fontSize:12,lineHeight:1.7,marginBottom:16,
                  background:theme==="dark"?"rgba(255,255,255,.04)":"rgba(0,0,0,.04)",
                  color:theme==="dark"?"rgba(255,255,255,.5)":"rgba(0,0,0,.5)"}}>
                  📌 가입한 이메일 주소를 입력하면<br/>
                  <b>임시 비밀번호</b>를 발급해 드려요<br/>
                  로그인 후 설정탭에서 꼭 변경해주세요!
                </div>
                <div className="field">
                  <div className="field-label">✉️ 가입한 이메일</div>
                  <input className="field-input" type="email" placeholder="email@example.com" value={findEmail} onChange={e=>setFindEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleResetPw()}/>
                </div>
                <button className="submit-btn" onClick={handleResetPw} disabled={findLoading}>
                  {findLoading&&<span className="btn-spin"/>}🔑 임시 비밀번호 발급
                </button>
              </>
            )}

            {findResult&&(
              <div className="find-result" style={{whiteSpace:"pre-line"}}>✅ {findResult}</div>
            )}
            {findError&&(
              <div className="error-box" style={{marginTop:12}}>⚠️ {findError}</div>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}
