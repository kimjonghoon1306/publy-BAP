import { useState, useEffect } from "react";

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
  const [sessionExists, setSessionExists] = useState(false);
  const [checking, setChecking] = useState(true);

  // 마운트 시 세션 존재 여부 확인
  useEffect(() => {
    if (!botOnline) { setChecking(false); return; }
    fetch(`${botUrl}/api/session-status/${userId}`)
      .then(r => r.json())
      .then(d => setSessionExists(!!d.google))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [botOnline, botUrl, userId]);

  async function handleSave() {
    if (!botOnline) { alert("Publy 앱을 먼저 실행해주세요"); return; }
    if (!email || !pw) { alert("이메일과 비밀번호를 입력해주세요"); return; }
    setLoading(true);
    try {
      const r = await fetch(`${botUrl}/api/google/save-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email, pw }),
        signal: AbortSignal.timeout(150000),
      });
      const d = await r.json();
      if (d.success) {
        setSessionExists(true);
        setEmail("");
        setPw("");
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

  async function handleReconnect() {
    if (!botOnline) { alert("Publy 앱을 먼저 실행해주세요"); return; }
    setLoading(true);
    try {
      // 저장된 이메일/비번으로 재연결 (서버에서 세션파일에서 읽음)
      const r = await fetch(`${botUrl}/api/google/save-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(150000),
      });
      const d = await r.json();
      if (d.success) {
        alert("✅ Google Flow 재연결 완료!");
      } else {
        alert("❌ 재연결 실패: " + (d.error || "다시 시도해주세요"));
      }
    } catch (e: any) {
      alert("❌ 오류: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <div className="card" style={{
      padding: "16px 18px", marginTop: 4,
      background: "linear-gradient(135deg,rgba(124,58,237,.08),rgba(168,85,247,.08))",
      border: `1.5px solid ${sessionExists ? "rgba(0,214,143,.4)" : "rgba(168,85,247,.3)"}`
    }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 26 }}>🎨</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#c084fc" }}>Google Flow 이미지</div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>무료 AI 이미지 자동 생성</div>
        </div>
        {sessionExists && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "rgba(0,214,143,.15)", color: "var(--success)", border: "1px solid rgba(0,214,143,.3)" }}>
            ✅ 연결됨
          </span>
        )}
      </div>

      {/* 사용 방법 */}
      <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.9, marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(168,85,247,.06)", border: "1px solid rgba(168,85,247,.15)" }}>
        <div style={{ fontWeight: 800, color: "#c084fc", marginBottom: 4 }}>📖 플로우 사용 방법</div>
        <div>① 구글 계정 없으면 아래 발급받기 클릭</div>
        <div>② 이메일·비밀번호 입력 후 저장하기</div>
        <div>③ Chrome 자동 오픈 → 자동 로그인</div>
        <div>④ 발행하기 → 이미지탭 → Flow 선택 후 발행</div>
      </div>

      {/* 세션 없을 때: 입력 폼 */}
      {!sessionExists && (
        <>
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
              <button type="button" onClick={() => setShowPw(v => !v)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text3)" }}>
                {showPw ? "🙈" : "👁️"}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="https://accounts.google.com/signup" target="_blank" rel="noreferrer"
              style={{ flex: 1, padding: "9px", borderRadius: 9, border: "1.5px solid rgba(168,85,247,.4)", background: "transparent", color: "#c084fc", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              🔑 구글 계정 발급받기
            </a>
            <button onClick={handleSave} disabled={loading || !email || !pw}
              style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit", opacity: loading || !email || !pw ? 0.6 : 1 }}>
              {loading ? "🔄 연결 중..." : "💾 저장하기"}
            </button>
          </div>
        </>
      )}

      {/* 세션 있을 때: 재연결 버튼만 */}
      {sessionExists && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setSessionExists(false); setEmail(""); setPw(""); }}
            style={{ flex: 1, padding: "9px", borderRadius: 9, border: "1.5px solid rgba(168,85,247,.4)", background: "transparent", color: "#c084fc", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
            ✏️ 계정 변경
          </button>
          <button onClick={handleReconnect} disabled={loading}
            style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
            {loading ? "🔄 연결 중..." : "🔗 재연결"}
          </button>
        </div>
      )}
    </div>
  );
}
