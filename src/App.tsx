import { useState, useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminPage from "./pages/AdminPage";
import DashboardPage from "./pages/DashboardPage";
import { PublyUser } from "./lib/supabase";

type View = "login" | "admin-login" | "admin" | "dashboard";

export default function App() {
  const [view, setView]   = useState<View>("login");
  const [user, setUser]   = useState<PublyUser | null>(null);
  const [theme, setTheme] = useState<"dark"|"light">(() =>
    (localStorage.getItem("publy_theme") as any) || "dark"
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("publy_user");
    if (saved) {
      try {
        setUser(JSON.parse(saved));
        setView("dashboard");
      } catch { localStorage.removeItem("publy_user"); }
    }
    // 관리자 세션 확인
    if (sessionStorage.getItem("publy_admin_auth")) {
      setView("admin");
    }
    setLoading(false);
  }, []);

  useEffect(() => { localStorage.setItem("publy_theme", theme); }, [theme]);

  function toggleTheme() { setTheme(t => t === "dark" ? "light" : "dark"); }

  function handleLogin(u: PublyUser) {
    localStorage.setItem("publy_user", JSON.stringify(u));
    setUser(u);
    setView("dashboard");
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
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  if (view==="dashboard" && user) return (
    <DashboardPage
      user={user}
      onLogout={handleLogout}
      theme={theme}
      onThemeToggle={toggleTheme}
    />
  );

  return null;
}
