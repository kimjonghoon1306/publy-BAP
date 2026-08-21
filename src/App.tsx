import React, { useState, useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminPageRaw from "./pages/AdminPage";
const AdminPage = AdminPageRaw as React.ComponentType<any>;
import DashboardPage from "./pages/DashboardPage";
import { PublyUser, refreshUserById, touchLastSeen } from "./lib/supabase";

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
      openLogFolder: () => Promise<boolean>;
      readBotLog: () => Promise<string>;
      getAppVersion: () => Promise<string>;
      keepAwake: (on: boolean) => Promise<{ ok: boolean; active?: boolean; error?: string }>;
    };
  }
}

// 앱 내 업데이트 배너 제거 — 다운로드는 웹사이트(publy.blogautopro.com)에서만.

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

  // ★회원 등급/활성 실시간 반영(테리 요청): 관리자가 등급을 바꾸면(무제한 등) 회원 앱이
  //   로그아웃 없이도 최신 등급을 반영한다. ①로그인 상태면 즉시 1회 최신화 ②20초마다 갱신.
  //   등급이 실제로 바뀐 경우에만 setUser(리렌더 최소화). localStorage도 함께 갱신해 새로고침에도 유지.
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const sync = async () => {
      try {
        void touchLastSeen(user.id);   // 마지막 접속 시각 갱신(관리자 확인용)
        const fresh = await refreshUserById(user.id);
        if (!alive || !fresh) return;
        // 비활성 처리되면 로그아웃
        if ((fresh as any).is_active === false) { handleLogout(); return; }
        if (fresh.plan !== user.plan || (fresh as any).is_active !== (user as any).is_active) {
          localStorage.setItem("publy_user", JSON.stringify(fresh));
          setUser(fresh);
        }
      } catch {}
    };
    void sync();
    const iv = window.setInterval(sync, 20000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [user?.id, user?.plan]);

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

  if (view==="login") return (
    <LoginPage
      onLogin={handleLogin}
      onAdminLogin={() => setView("admin-login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  if (view==="admin-login") return (
    <AdminLoginPage
      onAdminAuth={handleAdminAuth}
      onBack={() => setView("login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  if (view==="admin") return (
    <AdminPage
      onBack={handleAdminLogout}
      onDashboard={() => { if(user) setView("dashboard"); else setView("login"); }}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  if (view==="dashboard" && user) return (
    <DashboardPage
      user={user}
      onLogout={handleLogout}
      onAdminLogin={() => setView("admin-login")}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  return null;
}
