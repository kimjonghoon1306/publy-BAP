import { useState, useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import { PublyUser } from "./lib/supabase";

export default function App() {
  const [user, setUser] = useState<PublyUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("publy_user");
    if (saved) {
      try { setUser(JSON.parse(saved)); } catch { localStorage.removeItem("publy_user"); }
    }
    setLoading(false);
  }, []);

  function handleLogin(u: PublyUser) {
    localStorage.setItem("publy_user", JSON.stringify(u));
    setUser(u);
  }

  function handleLogout() {
    localStorage.removeItem("publy_user");
    setUser(null);
  }

  if (loading) return (
    <div style={{
      width:"100vw", height:"100vh",
      background:"#050a12",
      display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{
        width:48, height:48, borderRadius:"50%",
        border:"3px solid rgba(0,255,136,.2)",
        borderTopColor:"#00ff88",
        animation:"spin 1s linear infinite",
      }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!user) return <LoginPage onLogin={handleLogin} />;
  return <DashboardPage user={user} onLogout={handleLogout} />;
}
