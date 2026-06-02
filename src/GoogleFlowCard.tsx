import { useState } from "react";

interface Props {
  botOnline: boolean;
  botUrl: string;
  userId: string;
}

export default function GoogleFlowCard({ botOnline, botUrl, userId }: Props) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  async function handleConnect() {
    if (!botOnline) { alert("Publy 앱을 먼저 실행해주세요"); return; }
    if (!email || !pw) { alert("이메일과 비밀번호를 입력해주세요"); return; }
    setLoading(true);
    try {
      const r = await fetch(`${botUrl}/api/google/save-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email, pw }),
        signal: AbortSignal.timeout(200000),
      });
      const d = await r.json();
      if (d.success) {
        setConnected(true);
        alert("✅ Google Flow 연결 완료! 이제 발행 시 플로우 이미지를 사용할 수 있어요.");
      } else {
        alert("❌ 연결 실패: " + (d.error || "다시 시도해주세요"));
      }
    } catch (e: any) {
      alert("❌ 오류: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{
      padding: "16px 18px", marginTop: 4,
      background: "linear-gradient(135deg,rgba(124,58,237,.08),rgba(168,85,247,.08))",
      border: "1.5px solid rgba(168,85,247,.3)"
    }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 26 }}>🎨</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#c084fc" }}>Google Flow 이미지</div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>무료 AI 이미지 자동 생성</div>
        </div>
        {connected && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "rgba(0,214,143,.15)", color: "var(--success)", border: "1px solid rgba(0,214,143,.3)" }}>
            ✅ 연결됨
          </span>
        )}
      </div>

      {/* 사용 방법 */}
      <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.9, marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(168,85,247,.06)", border: "1px solid rgba(168,85,247,.15)" }}>
        <div style={{ fontWeight: 800, color: "#c084fc", marginBottom: 4 }}>📖 플로우 사용 방법</div>
        <div>① 구글 계정 없으면 아래 발급받기 클릭</div>
        <div>② 이메일·비밀번호 입력 후 연결하기</div>
        <div>③ Chrome 자동 오픈 → 자동 로그인 (2FA 있으면 직접 처리)</div>
        <div>④ 발행하기 → 이미지탭 → Flow 선택 후 발행</div>
      </div>

      {/* 입력 폼 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        <input
          className="inp"
          type="email"
          placeholder="구글 이메일 (예: example@gmail.com)"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ fontSize: 13 }}
        />
        <div style={{ position: "relative" }}>
          <input
            className="inp"
            type={showPw ? "text" : "password"}
            placeholder="구글 비밀번호"
            value={pw}
            onChange={e => setPw(e.target.value)}
            style={{ fontSize: 13, paddingRight: 40, width: "100%" }}
          />
          <button
            type="button"
            onClick={() => setShowPw(v => !v)}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text3)" }}
          >
            {showPw ? "🙈" : "👁️"}
          </button>
        </div>
      </div>

      {/* 버튼 */}
      <div style={{ display: "flex", gap: 8 }}>
        <a
          href="https://accounts.google.com/signup"
          target="_blank"
          rel="noreferrer"
          style={{ flex: 1, padding: "9px", borderRadius: 9, border: "1.5px solid rgba(168,85,247,.4)", background: "transparent", color: "#c084fc", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
        >
          🔑 구글 계정 발급받기
        </a>
        <button
          onClick={handleConnect}
          disabled={loading || !email || !pw}
          style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", background: connected ? "rgba(0,214,143,.2)" : "linear-gradient(135deg,#7c3aed,#a855f7)", color: connected ? "var(--success)" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit", opacity: loading || !email || !pw ? 0.6 : 1 }}
        >
          {loading ? "🔄 연결 중..." : connected ? "✅ 재연결" : "🔗 연결하기"}
        </button>
      </div>
    </div>
  );
}
