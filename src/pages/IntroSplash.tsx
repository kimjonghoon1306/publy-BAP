import { useEffect, useRef, useState } from "react";

// 첫 실행 시 1회 재생되는 시네마틱 인트로 스플래시.
//   public/intro-cinema.html 을 iframe으로 재생. 약 21초 후 자동 종료, 건너뛰기/다시 안 보기 제공.
export default function IntroSplash({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const doneRef = useRef(false);

  const finish = (rememberSkip?: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (rememberSkip) localStorage.setItem("publy_intro_seen", "1");
    setFading(true);
    setTimeout(onDone, 500);
  };

  useEffect(() => {
    // 영상 총 길이(약 21초) 후 자동 종료 + 다시 안 보기 저장
    const t = setTimeout(() => finish(true), 21500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 99999, background: "#000",
        opacity: fading ? 0 : 1, transition: "opacity .5s ease",
      }}
    >
      <iframe
        src="intro-cinema.html"
        title="PUBLY 인트로"
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
      />

      {/* 건너뛰기 */}
      <button
        onClick={() => finish(true)}
        style={{
          position: "absolute", top: "calc(8vh + 18px)", right: 20, zIndex: 5,
          padding: "9px 18px", borderRadius: 999,
          border: "1px solid rgba(255,255,255,.28)",
          background: "rgba(20,12,20,.5)", backdropFilter: "blur(8px)",
          color: "#fff", fontSize: 13, fontWeight: 700, letterSpacing: ".04em",
          cursor: "pointer",
        }}
      >
        건너뛰기 ✕
      </button>

      {/* 다시 안 보기 */}
      <button
        onClick={() => finish(true)}
        style={{
          position: "absolute", bottom: "calc(8vh + 16px)", left: 20, zIndex: 5,
          padding: "8px 16px", borderRadius: 999,
          border: "1px solid rgba(255,255,255,.2)",
          background: "rgba(20,12,20,.42)", backdropFilter: "blur(6px)",
          color: "rgba(255,255,255,.85)", fontSize: 12, fontWeight: 600,
          cursor: "pointer",
        }}
      >
        다시 보지 않기
      </button>
    </div>
  );
}
