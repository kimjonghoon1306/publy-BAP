import React, { useState, useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminPageRaw from "./pages/AdminPage";
const AdminPage = AdminPageRaw as React.ComponentType<any>;
import DashboardPage from "./pages/DashboardPage";
import { PublyUser } from "./lib/supabase";

type View = "login" | "admin-login" | "admin" | "dashboard";

declare global {
  interface Window {
    electron?: {
      getBotStatus: () => Promise<string>;
      getBotSecret: () => Promise<string>;
      registerUser: (userId: string) => Promise<boolean>;
      unregisterUser: (userId: string) => Promise<boolean>;
      openPreview: (html: string) => Promise<void>;
      flowLaunchChrome: () => Promise<{ ok: boolean; already?: boolean; launched?: boolean; error?: string }>;
      flowStatus: () => Promise<{ ready: boolean }>;
      checkAppUpdate: () => Promise<{ available: boolean; currentVersion?: string; latestVersion?: string; url?: string }>;
      openAppUpdate: (url: string) => Promise<boolean>;
    };
  }
}

function UpdateBanner() {
  const [update, setUpdate] = useState<{ latestVersion?: string; url?: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.electron?.checkAppUpdate) return;
    const check = () => window.electron?.checkAppUpdate().then(result => {
      if (result?.available) { setUpdate(result); setDismissed(false); }
    }).catch(() => {});
    const timer = setTimeout(check, 4000);
    const interval = setInterval(check, 6 * 60 * 60 * 1000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, []);

  if (!update || dismissed) return null;
  return (
    <aside className="app-update-banner" aria-live="polite">
      <span className="app-update-icon">✨</span>
      <span className="app-update-copy"><b>새로운 업데이트</b><small>Publy {update.latestVersion} 버전을 사용할 수 있어요.</small></span>
      <button className="app-update-action" onClick={() => update.url && window.electron?.openAppUpdate(update.url)}>업데이트</button>
      <button className="app-update-close" aria-label="업데이트 알림 닫기" onClick={() => setDismissed(true)}>×</button>
      <style>{`
        .app-update-banner{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10000;width:min(520px,calc(100vw - 28px));box-sizing:border-box;display:flex;align-items:center;gap:11px;padding:12px 13px;border:1px solid rgba(0,214,143,.55);border-radius:16px;background:rgba(8,20,27,.96);color:#eefcf7;box-shadow:0 12px 40px rgba(0,0,0,.35),0 0 24px rgba(0,214,143,.18);backdrop-filter:blur(16px);font-family:'Noto Sans KR',sans-serif}
        .app-update-icon{font-size:22px}.app-update-copy{min-width:0;flex:1}.app-update-copy b,.app-update-copy small{display:block}.app-update-copy b{font-size:14px}.app-update-copy small{margin-top:2px;color:#a9c8bc;font-size:11px}.app-update-action{flex-shrink:0;border:0;border-radius:10px;padding:9px 13px;background:#00d68f;color:#032018;font-weight:900;cursor:pointer}.app-update-close{flex-shrink:0;border:0;background:transparent;color:#9fb5ad;font-size:21px;cursor:pointer;padding:2px 4px}@media(max-width:900px){.app-update-banner{bottom:86px}.app-update-copy small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
      `}</style>
    </aside>
  );
}

export default function App() {
  const [view, setView]   = useState<View>("login");
  const [user, setUser]   = useState<PublyUser | null>(null);
  const [theme, setTheme] = useState<"dark"|"light">(() =>
    (localStorage.getItem("publy_theme") as any) || "dark"
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 초기화: localStorage에서 세션 복원 후 한 번에 state 업데이트
    let nextView: View = "login";
    let nextUser: PublyUser | null = null;

    const saved = localStorage.getItem("publy_user");
    if (saved) {
      try {
        const u = JSON.parse(saved);
        nextUser = u;
        nextView = "dashboard";
        window.electron?.registerUser(u.id);
      } catch { localStorage.removeItem("publy_user"); }
    }
    if (sessionStorage.getItem("publy_admin_auth")) {
      nextView = "admin";
    }

    // 한 번에 업데이트 → view 전환 플리커 방지
    setUser(nextUser);
    setView(nextView);
    setLoading(false);
  }, []);

  useEffect(() => { localStorage.setItem("publy_theme", theme); }, [theme]);

  function toggleTheme() { setTheme(t => t === "dark" ? "light" : "dark"); }

  function handleLogin(u: PublyUser) {
    localStorage.setItem("publy_user", JSON.stringify(u));
    setUser(u);
    setView("dashboard");
    // 로그인 시 봇 서버에 유저 등록 → Supabase 폴링 시작
    window.electron?.registerUser(u.id);
  }

  function handleLogout() {
    localStorage.removeItem("publy_user");
    setUser(null);
    setView("login");
  }

  function handleAdminAuth() {
    sessionStorage.setItem("publy_admin_auth", "true");
    setView("admin");
  }

  function handleAdminLogout() {
    sessionStorage.removeItem("publy_admin_auth");
    setView("login");
  }

  if (loading) return (
    <div style={{
      width:"100vw", height:"100vh",
      background: theme==="dark" ? "#050a12" : "#f0faf4",
      display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{
        width:44, height:44, borderRadius:"50%",
        border:"3px solid rgba(0,255,136,.2)",
        borderTopColor:"#00ff88",
        animation:"spin 1s linear infinite",
      }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (view==="login") return (<>
    <LoginPage
      onLogin={handleLogin}
      onAdminLogin={() => setView("admin-login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    /><UpdateBanner />
  </>);

  if (view==="admin-login") return (<>
    <AdminLoginPage
      onAdminAuth={handleAdminAuth}
      onBack={() => setView("login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    /><UpdateBanner />
  </>);

  if (view==="admin") return (<>
    <AdminPage
      onBack={handleAdminLogout}
      onDashboard={() => { if(user) setView("dashboard"); else setView("login"); }}
      theme={theme}
      onThemeToggle={toggleTheme}
    /><UpdateBanner />
  </>);

  if (view==="dashboard" && user) return (<>
    <DashboardPage
      user={user}
      onLogout={handleLogout}
      onAdminLogin={() => setView("admin-login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    /><UpdateBanner />
  </>);

  return null;
}
