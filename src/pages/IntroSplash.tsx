import { useRef, useState } from "react";

// 첫 실행 시 1회 재생되는 시네마틱 인트로(음악 포함 mp4).
//   끝나면 자동 종료. 건너뛰기/다시 안 보기 제공. 모바일 터치 시 소리 재생 보장.
export default function IntroSplash({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    localStorage.setItem("publy_intro_seen", "1");
    setFading(true);
    setTimeout(onDone, 500);
  };

  // 브라우저 자동재생 정책상 음소거로 시작될 수 있어, 사용자가 클릭하면 소리 켜기
  const enableSound = () => {
    const v = videoRef.current;
    if (v && v.muted) { v.muted = false; setMuted(false); v.play().catch(() => {}); }
  };

  // 스피커 토글 (켜기/음소거)
  const toggleSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) v.play().catch(() => {});
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 99999, background: "#000",
        opacity: fading ? 0 : 1, transition: "opacity .5s ease",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={enableSound}
    >
      <video
        ref={videoRef}
        src="intro-assets/publy-intro.mp4"
        autoPlay
        playsInline
        onEnded={finish}
        onCanPlay={(e) => {
          // 소리 켠 채로 재생 시도, 막히면 음소거로 재생(자동재생 정책 대비)
          const v = e.currentTarget;
          v.play().catch(() => { v.muted = true; setMuted(true); v.play().catch(() => {}); });
        }}
        style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
      />

      {/* 음소거 안내(음소거 상태일 때만) */}
      {muted && (
        <button
          onClick={enableSound}
          style={{
            position: "absolute", bottom: "calc(8vh + 16px)", left: "50%", transform: "translateX(-50%)",
            zIndex: 5, padding: "10px 20px", borderRadius: 999,
            border: "1px solid rgba(255,255,255,.3)", background: "rgba(20,12,20,.6)",
            backdropFilter: "blur(8px)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          🔇 탭하면 소리가 나와요
        </button>
      )}

      {/* 스피커 토글 */}
      <button
        onClick={toggleSound}
        aria-label={muted ? "소리 켜기" : "음소거"}
        style={{
          position: "absolute", top: "calc(6vh + 14px)", left: 20, zIndex: 5,
          width: 44, height: 44, borderRadius: "50%",
          border: "1px solid rgba(255,255,255,.28)", background: "rgba(20,12,20,.5)",
          backdropFilter: "blur(8px)", color: "#fff", fontSize: 18, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* 건너뛰기 */}
      <button
        onClick={finish}
        style={{
          position: "absolute", top: "calc(6vh + 14px)", right: 20, zIndex: 5,
          padding: "9px 18px", borderRadius: 999,
          border: "1px solid rgba(255,255,255,.28)", background: "rgba(20,12,20,.5)",
          backdropFilter: "blur(8px)", color: "#fff", fontSize: 13, fontWeight: 700,
          letterSpacing: ".04em", cursor: "pointer",
        }}
      >
        건너뛰기 ✕
      </button>
    </div>
  );
}
