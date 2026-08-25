import { useState, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════
   🔍 블로거 발굴 컨트롤 센터 — 다크 프리미엄 글래스 + 네온 팝
   딥 배경 · 유리 카드 · 네온 그라데이션 액센트 · 3D 마스코트 글로우
   ⚖️ 공개된 정보만. 비공개는 건드리지 않음.
   ═══════════════════════════════════════════════════════════════ */

const CH = {
  bori: "/characters/bori-cheer.png",
  dodo: "/characters/dodo-checker.png",
  monggeul: "/characters/monggeul-explorer.png",
  pumi: "/characters/pumi-guide.png",
};

type Blogger = {
  id: string; nick: string; url: string; topic: string;
  neighbors: number; postsPerWeek: number; visitors: number; score: number;
  email?: string; kakao?: string; openchat?: string; proposed?: boolean;
};

const TOPICS = ["맛집", "여행", "뷰티", "육아", "패션", "카페", "리빙", "펫", "운동", "IT"];
const REGIONS = ["전국", "서울", "경기", "부산", "제주", "강원", "인천", "대구", "광주", "대전"];
const NEIGHBOR_STEPS = [300, 500, 1000, 3000, 5000];
const POST_STEPS = [1, 2, 3, 5];

function mockFind(topic: string, n: number): Blogger[] {
  const nicks = ["초록다이어리", "제주살이룸", "먹킷리스트", "육아하는곰", "감성필름", "여행가는펭귄", "코랄뷰티", "산책하는나무", "홈카페일기", "부부의세계", "달려라토끼", "빵순이로그"];
  const out: Blogger[] = [];
  for (let i = 0; i < n; i++) {
    const neighbors = 300 + Math.floor(Math.random() * 5000);
    const postsPerWeek = 1 + Math.floor(Math.random() * 6);
    const visitors = 50 + Math.floor(Math.random() * 2000);
    const score = Math.min(99, Math.round((neighbors / 60 + postsPerWeek * 6 + visitors / 40) / 3));
    out.push({
      id: "b" + i + Date.now(), nick: nicks[i % nicks.length] + (i > 11 ? i : ""),
      url: "blog.naver.com/" + topic + "_blogger" + i, topic, neighbors, postsPerWeek, visitors, score,
      email: Math.random() > 0.35 ? `${topic}blog${i}@naver.com` : undefined,
      kakao: Math.random() > 0.55 ? `${topic}_${i}` : undefined,
      openchat: Math.random() > 0.7 ? "open.kakao.com/o/xxxx" : undefined,
      proposed: Math.random() > 0.85,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export default function CrawlCenter({ showToast }: { showToast?: (m: string, t?: any) => void }) {
  const toast = (m: string, t?: string) => showToast?.(m, t);

  const [topic, setTopic] = useState("맛집");
  const [region, setRegion] = useState("전국");
  const [count, setCount] = useState(30);
  const [minNeighbors, setMinNeighbors] = useState(500);
  const [minPosts, setMinPosts] = useState(2);
  const [activeOnly, setActiveOnly] = useState(true);
  const [topicMatch, setTopicMatch] = useState(true);
  const [fields, setFields] = useState<Record<string, boolean>>({ email: true, kakao: true, openchat: true, url: true, nick: true });
  const toggleField = (k: string) => setFields((f) => ({ ...f, [k]: !f[k] }));
  const [advOpen, setAdvOpen] = useState(false);
  const [speed, setSpeed] = useState("보통");
  const [dailyLimit, setDailyLimit] = useState(200);
  const [excludeKw, setExcludeKw] = useState("");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<Blogger[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"score" | "neighbors" | "posts">("score");
  const [onlyContact, setOnlyContact] = useState(false);
  const timerRef = useRef<any>(null);

  const pushLog = (m: string) => setLogs((l) => [...l, `${new Date().toLocaleTimeString("ko-KR")}  ${m}`]);

  const startFind = () => {
    if (running) return;
    setRunning(true); setProgress(0); setLogs([]); setResults([]); setSelected(new Set());
    pushLog(`🚀 "${topic}" · ${region} 블로거 발굴 시작 (목표 ${count}명)`);
    pushLog(`⚙️ 필터: 이웃 ${minNeighbors.toLocaleString()}+ · 주 ${minPosts}글+ ${activeOnly ? "· 활동중만" : ""} ${topicMatch ? "· 주제일치" : ""}`);
    let p = 0;
    const steps = ["네이버 검색으로 글 수집 중…", "글쓴이(블로거) 추리는 중…", "공개 프로필·연락처 확인 중…", "활동성 점수 계산 중…", "비공개 제외하고 정리 중…"];
    timerRef.current = setInterval(() => {
      p += Math.random() * 22;
      if (p >= 100) {
        p = 100; setProgress(100); clearInterval(timerRef.current);
        const found = mockFind(topic, Math.min(count, 12)).filter((b) => b.neighbors >= minNeighbors && b.postsPerWeek >= minPosts);
        setResults(found);
        pushLog(`✅ 발굴 완료 — ${found.length}명 (연락처 있는 블로거 ${found.filter((b) => b.email || b.kakao).length}명)`);
        setRunning(false); toast(`🎉 ${found.length}명 발굴 완료!`, "success");
        return;
      }
      setProgress(Math.round(p));
      if (Math.random() > 0.55) pushLog("· " + steps[Math.min(steps.length - 1, Math.floor(p / 20))]);
    }, 420);
  };
  const stopFind = () => { if (timerRef.current) clearInterval(timerRef.current); setRunning(false); pushLog("⏹ 사용자가 중지했어요."); };

  const shown = results
    .filter((b) => !onlyContact || b.email || b.kakao || b.openchat)
    .sort((a, b) => sortBy === "score" ? b.score - a.score : sortBy === "neighbors" ? b.neighbors - a.neighbors : b.postsPerWeek - a.postsPerWeek);
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const downloadCsv = () => {
    const rows = shown.filter((b) => selected.size === 0 || selected.has(b.id));
    if (!rows.length) { toast("내보낼 블로거가 없어요", "info"); return; }
    const H = ["닉네임", "블로그", "주제", "이웃수", "주간글수", "방문자", "점수", "이메일", "카톡", "오픈채팅"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [H.map(esc).join(","), ...rows.map((b) => [b.nick, b.url, b.topic, b.neighbors, b.postsPerWeek, b.visitors, b.score, b.email || "", b.kakao || "", b.openchat || ""].map(esc).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `블로거명단_${topic}_${rows.length}명.csv`; a.click();
    toast(`💾 ${rows.length}명 CSV 저장!`, "success");
  };

  // ── 스타일 토큰 ──
  const glass = { background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 20, backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" } as const;
  const lbl = { fontSize: 11, fontWeight: 800, letterSpacing: ".04em", color: "#7c8bb0", marginBottom: 8, textTransform: "uppercase" as const };
  const chip = (on: boolean) => ({
    padding: "8px 15px", borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" as const,
    border: on ? "1px solid transparent" : "1px solid rgba(255,255,255,.12)",
    background: on ? "linear-gradient(135deg,#a3e635,#22d3ee)" : "rgba(255,255,255,.03)",
    color: on ? "#08131f" : "#aab6d6", transition: "all .16s",
    boxShadow: on ? "0 6px 20px -6px rgba(34,211,238,.55)" : "none",
  } as const);
  const smallChip = (on: boolean) => ({ ...chip(on), padding: "6px 12px", fontSize: 12 } as const);

  return (
    <div style={{ position: "relative", borderRadius: 26, padding: 24, overflow: "hidden", fontFamily: "'Noto Sans KR',sans-serif", color: "#e9eeff", background: "radial-gradient(120% 90% at 12% 0%,#141d38 0%,#0b1022 55%,#080b16 100%)", minHeight: 420 }}>
      <style>{`
        @keyframes ccFloat{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(3deg)}}
        @keyframes ccPop{0%{opacity:0;transform:translateY(14px) scale(.97)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes ccBar{0%{background-position:0 0}100%{background-position:36px 0}}
        @keyframes ccGlow{0%,100%{opacity:.5}50%{opacity:.85}}
        @keyframes ccSpin{to{transform:rotate(360deg)}}
        .cc-float{animation:ccFloat 3.6s ease-in-out infinite}
        .cc-sec{animation:ccPop .45s cubic-bezier(.34,1.56,.64,1) both}
        .cc-hover{transition:transform .2s,box-shadow .2s,border-color .2s}
        .cc-hover:hover{transform:translateY(-4px);border-color:rgba(163,230,53,.4)!important;box-shadow:0 20px 44px -20px rgba(34,211,238,.4)!important}
        .cc-blob{position:absolute;border-radius:50%;filter:blur(70px);pointer-events:none;animation:ccGlow 6s ease-in-out infinite}
        .cc-grad-text{background:linear-gradient(135deg,#c4ff5e,#37e0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
        .cc-scroll::-webkit-scrollbar{height:6px;width:6px}.cc-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:99px}
      `}</style>

      {/* 네온 글로우 배경 */}
      <div className="cc-blob" style={{ width: 320, height: 320, background: "#22d3ee", top: -120, right: -40, opacity: .35 }} />
      <div className="cc-blob" style={{ width: 260, height: 260, background: "#a3e635", bottom: -100, left: 80, opacity: .28, animationDelay: "2s" }} />
      <div className="cc-blob" style={{ width: 240, height: 240, background: "#f472b6", top: 200, left: -80, opacity: .22, animationDelay: "4s" }} />

      {/* 헤더 */}
      <div className="cc-sec" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, position: "relative", zIndex: 1 }}>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", inset: -6, borderRadius: "50%", background: "radial-gradient(circle,rgba(163,230,53,.5),transparent 70%)", filter: "blur(8px)" }} />
          <img src={CH.monggeul} className="cc-float" style={{ width: 80, height: 80, objectFit: "contain", position: "relative", filter: "drop-shadow(0 8px 20px rgba(34,211,238,.5))" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".18em", color: "#5ce1e6", marginBottom: 4 }}>BLOGGER DISCOVERY · CONTROL CENTER</div>
          <div style={{ fontSize: 25, fontWeight: 900, letterSpacing: "-.6px", lineHeight: 1.1 }}>블로거 발굴 <span className="cc-grad-text">컨트롤 센터</span></div>
          <div style={{ fontSize: 12.5, color: "#8b9ac0", fontWeight: 600, marginTop: 5 }}>체험단에 딱 맞는 블로거를 <b style={{ color: "#c4ff5e" }}>공개 정보로</b> 발굴 — 몽글이 앞장설게요 🌱</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#c4ff5e", background: "rgba(163,230,53,.1)", border: "1px solid rgba(163,230,53,.28)", padding: "7px 13px", borderRadius: 999, whiteSpace: "nowrap" }}>⚖️ 공개 정보만</span>
      </div>

      {/* 지표 대시보드 */}
      <div className="cc-sec" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18, position: "relative", zIndex: 1 }}>
        {[
          { ic: "🧭", lab: "오늘 발굴", val: results.length, unit: "명", g: "linear-gradient(135deg,#a3e635,#22d3ee)", ch: CH.monggeul },
          { ic: "💌", lab: "제안 발송", val: 0, unit: "명", g: "linear-gradient(135deg,#fb923c,#f472b6)", ch: CH.bori },
          { ic: "📥", lab: "연락처 확보", val: results.filter((b) => b.email || b.kakao).length, unit: "명", g: "linear-gradient(135deg,#38bdf8,#818cf8)", ch: CH.dodo },
          { ic: "⭐", lab: "평균 점수", val: results.length ? Math.round(results.reduce((s, b) => s + b.score, 0) / results.length) : 0, unit: "점", g: "linear-gradient(135deg,#fbbf24,#f472b6)", ch: CH.pumi },
        ].map((k, i) => (
          <div key={i} className="cc-hover" style={{ ...glass, padding: "14px 16px", display: "flex", alignItems: "center", gap: 11, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -20, right: -20, width: 60, height: 60, borderRadius: "50%", background: k.g, opacity: .18, filter: "blur(12px)" }} />
            <img src={k.ch} style={{ width: 42, height: 42, objectFit: "contain", filter: "drop-shadow(0 4px 8px rgba(0,0,0,.4))" }} />
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#8b9ac0" }}>{k.ic} {k.lab}</div>
              <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.05, background: k.g, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{k.val}<span style={{ fontSize: 12, marginLeft: 2, color: "#6b7aa0" }}>{k.unit}</span></div>
            </div>
          </div>
        ))}
      </div>

      {/* 검색 설정 */}
      <div className="cc-sec" style={{ ...glass, padding: 18, marginBottom: 14, position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>🎯 무엇을 찾을까요?</div>
        <div style={{ marginBottom: 14 }}>
          <div style={lbl}>주제</div>
          <div className="cc-scroll" style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 4, flexWrap: "wrap" }}>
            {TOPICS.map((t) => <span key={t} onClick={() => setTopic(t)} style={chip(topic === t)}>{t}</span>)}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 130px", gap: 12, alignItems: "end" }}>
          <div>
            <div style={lbl}>지역</div>
            <select value={region} onChange={(e) => setRegion(e.target.value)} style={{ ...glass, borderRadius: 12, padding: "11px 12px", fontSize: 13.5, fontWeight: 700, color: "#e9eeff", background: "rgba(255,255,255,.04)", width: "100%", outline: "none", fontFamily: "inherit" }}>{REGIONS.map((r) => <option key={r} style={{ color: "#111" }}>{r}</option>)}</select>
          </div>
          <div>
            <div style={lbl}>직접 키워드 (선택)</div>
            <input placeholder="예: 감성카페, 아이랑 갈만한곳" style={{ ...glass, borderRadius: 12, padding: "11px 14px", fontSize: 13.5, fontWeight: 600, color: "#e9eeff", background: "rgba(255,255,255,.04)", width: "100%", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <div style={lbl}>인원</div>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ ...glass, borderRadius: 12, padding: "11px 12px", fontSize: 13.5, fontWeight: 700, color: "#e9eeff", background: "rgba(255,255,255,.04)", width: "100%", outline: "none", fontFamily: "inherit" }}>{[10, 20, 30, 50, 100].map((n) => <option key={n} value={n} style={{ color: "#111" }}>{n}명</option>)}</select>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, flexWrap: "wrap" }}>
          {!running ? (
            <button onClick={startFind} className="cc-hover" style={{ border: "none", borderRadius: 15, padding: "14px 22px", fontSize: 15.5, fontWeight: 900, cursor: "pointer", color: "#08131f", fontFamily: "inherit", background: "linear-gradient(135deg,#c4ff5e,#37e0ff)", boxShadow: "0 14px 32px -10px rgba(55,224,255,.6)", display: "inline-flex", alignItems: "center", gap: 9 }}><img src={CH.monggeul} style={{ width: 26, height: 26 }} /> 발굴 시작하기</button>
          ) : (
            <button onClick={stopFind} style={{ border: "none", borderRadius: 15, padding: "14px 22px", fontSize: 15.5, fontWeight: 900, cursor: "pointer", color: "#fff", fontFamily: "inherit", background: "linear-gradient(135deg,#fb7185,#e11d48)", boxShadow: "0 14px 32px -10px rgba(225,29,72,.6)" }}>⏹ 중지하기</button>
          )}
          <div style={{ fontSize: 12, color: "#7c8bb0", fontWeight: 600 }}>비공개 블로그는 <b style={{ color: "#c4ff5e" }}>자동으로 건너뛰어요</b></div>
        </div>
      </div>

      {/* 필터 + 수집항목 */}
      <div className="cc-sec" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14, position: "relative", zIndex: 1 }}>
        <div style={{ ...glass, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 16, display: "flex", alignItems: "center", gap: 7 }}>🔥 활동성 필터</div>
          <div style={{ marginBottom: 16 }}>
            <div style={lbl}>최소 이웃 수</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{NEIGHBOR_STEPS.map((v) => <span key={v} onClick={() => setMinNeighbors(v)} style={smallChip(minNeighbors === v)}>{v.toLocaleString()}+</span>)}</div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={lbl}>주간 최소 글 수</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{POST_STEPS.map((v) => <span key={v} onClick={() => setMinPosts(v)} style={smallChip(minPosts === v)}>{v}글+</span>)}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span onClick={() => setActiveOnly((v) => !v)} style={smallChip(activeOnly)}>🟢 최근 활동중만</span>
            <span onClick={() => setTopicMatch((v) => !v)} style={smallChip(topicMatch)}>🎯 주제 일치</span>
          </div>
        </div>
        <div style={{ ...glass, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 16, display: "flex", alignItems: "center", gap: 7 }}>📥 무엇을 모을까요? <img src={CH.dodo} style={{ width: 28, height: 28, marginLeft: "auto" }} /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
            {[["email", "✉️ 이메일"], ["kakao", "💬 카톡ID"], ["openchat", "🔗 오픈채팅"], ["url", "🔵 블로그주소"], ["nick", "🙂 닉네임"]].map(([k, l]) => <span key={k} onClick={() => toggleField(k)} style={smallChip(!!fields[k])}>{l}</span>)}
          </div>
          <div style={{ fontSize: 12, color: "#9fb0d6", fontWeight: 600, background: "rgba(163,230,53,.06)", border: "1px solid rgba(163,230,53,.18)", borderRadius: 13, padding: "11px 13px", lineHeight: 1.55, display: "flex", gap: 9 }}>
            <span style={{ fontSize: 17 }}>🛡️</span>
            <span>블로그에 <b style={{ color: "#c4ff5e" }}>공개해 둔 연락처</b>만 모아요. "협찬·체험단 문의 환영"처럼 열어둔 곳에 제안하는 건 정당해요.</span>
          </div>
        </div>
      </div>

      {/* 진행 상황 */}
      {(running || logs.length > 0) && (
        <div className="cc-sec" style={{ ...glass, padding: 18, marginBottom: 14, position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>📡 진행 상황 {running && <span style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid #37e0ff", borderTopColor: "transparent", display: "inline-block", animation: "ccSpin .7s linear infinite" }} />}</div>
          <div style={{ height: 12, borderRadius: 999, background: "rgba(255,255,255,.06)", overflow: "hidden", marginBottom: 11 }}>
            <div style={{ height: "100%", width: `${progress}%`, borderRadius: 999, background: "repeating-linear-gradient(45deg,#c4ff5e,#c4ff5e 12px,#37e0ff 12px,#37e0ff 24px)", backgroundSize: "36px 36px", animation: running ? "ccBar .7s linear infinite" : "none", transition: "width .4s", boxShadow: "0 0 16px rgba(55,224,255,.5)" }} />
          </div>
          <div className="cc-scroll" style={{ maxHeight: 130, overflowY: "auto", background: "rgba(0,0,0,.35)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 12, padding: "10px 14px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, lineHeight: 1.85, color: "#7fe6c8" }}>
            {logs.length === 0 ? <span style={{ color: "#4a5a70" }}>대기 중…</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* 결과 그리드 */}
      {results.length > 0 && (
        <div className="cc-sec" style={{ ...glass, padding: 18, marginBottom: 14, position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 15 }}>
            <div style={{ fontSize: 14, fontWeight: 900 }}>🗂 발굴된 블로거 <span className="cc-grad-text">{shown.length}</span>명</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span onClick={() => setOnlyContact((v) => !v)} style={smallChip(onlyContact)}>📇 연락처 있는 것만</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} style={{ ...glass, borderRadius: 10, padding: "7px 10px", fontSize: 12.5, fontWeight: 700, color: "#e9eeff", background: "rgba(255,255,255,.04)", outline: "none", fontFamily: "inherit" }}>
                <option value="score" style={{ color: "#111" }}>점수순</option><option value="neighbors" style={{ color: "#111" }}>이웃순</option><option value="posts" style={{ color: "#111" }}>글 많은순</option>
              </select>
              <span onClick={() => setSelected(new Set(shown.map((b) => b.id)))} style={smallChip(false)}>전체선택</span>
              {selected.size > 0 && <span onClick={() => setSelected(new Set())} style={{ ...smallChip(false), color: "#fb7185", borderColor: "rgba(251,113,133,.4)" }}>해제 ({selected.size})</span>}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(232px,1fr))", gap: 12 }}>
            {shown.map((b) => {
              const on = selected.has(b.id);
              const grade = b.score >= 75 ? { l: "S", g: "linear-gradient(135deg,#fbbf24,#f472b6)" } : b.score >= 55 ? { l: "A", g: "linear-gradient(135deg,#a3e635,#22d3ee)" } : { l: "B", g: "linear-gradient(135deg,#38bdf8,#818cf8)" };
              return (
                <div key={b.id} onClick={() => toggleSel(b.id)} className="cc-hover" style={{ borderRadius: 16, padding: 14, cursor: "pointer", position: "relative", background: on ? "rgba(163,230,53,.08)" : "rgba(255,255,255,.03)", border: `1px solid ${on ? "rgba(163,230,53,.5)" : "rgba(255,255,255,.08)"}` }}>
                  <div style={{ position: "absolute", top: 12, right: 12, width: 22, height: 22, borderRadius: 7, border: `1.5px solid ${on ? "transparent" : "rgba(255,255,255,.2)"}`, background: on ? "linear-gradient(135deg,#a3e635,#22d3ee)" : "transparent", color: "#08131f", fontSize: 13, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 11, background: grade.g, color: "#08131f", fontWeight: 900, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 14px -6px rgba(34,211,238,.5)" }}>{grade.l}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.nick}</div>
                      <div style={{ fontSize: 10.5, color: "#7c8bb0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.url}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#aab6d6", background: "rgba(255,255,255,.05)", padding: "2px 8px", borderRadius: 99 }}>👥 {b.neighbors.toLocaleString()}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#aab6d6", background: "rgba(255,255,255,.05)", padding: "2px 8px", borderRadius: 99 }}>✏️ 주{b.postsPerWeek}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: "#08131f", background: "linear-gradient(135deg,#a3e635,#22d3ee)", padding: "2px 8px", borderRadius: 99 }}>⭐ {b.score}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {b.email && <span style={{ fontSize: 10, fontWeight: 700, color: "#c4ff5e", background: "rgba(163,230,53,.12)", padding: "3px 7px", borderRadius: 7 }}>✉️ 이메일</span>}
                    {b.kakao && <span style={{ fontSize: 10, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,.12)", padding: "3px 7px", borderRadius: 7 }}>💬 카톡</span>}
                    {b.openchat && <span style={{ fontSize: 10, fontWeight: 700, color: "#38bdf8", background: "rgba(56,189,248,.12)", padding: "3px 7px", borderRadius: 7 }}>🔗 오픈챗</span>}
                    {!b.email && !b.kakao && !b.openchat && <span style={{ fontSize: 10, color: "#5a6a86" }}>공개 연락처 없음</span>}
                    {b.proposed && <span style={{ fontSize: 10, fontWeight: 800, color: "#c4b5fd", background: "rgba(167,139,250,.15)", padding: "3px 7px", borderRadius: 7 }}>✔ 이미 제안함</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 16, padding: 15, borderRadius: 16, background: "linear-gradient(135deg,rgba(251,146,60,.1),rgba(244,114,182,.08))", border: "1px solid rgba(251,146,60,.22)", flexWrap: "wrap" }}>
            <img src={CH.bori} className="cc-float" style={{ width: 48, height: 48 }} />
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: "#ffd9a8" }}>{selected.size > 0 ? `${selected.size}명 선택됨` : "체험단 제안을 보내요"}</div>
              <div style={{ fontSize: 11.5, color: "#c79a78", fontWeight: 600 }}>보리가 제안 메일 초안을 예쁘게 써드릴게요! (공개 문의처로만)</div>
            </div>
            <button onClick={() => toast("✍️ 제안 메일 초안 생성은 곧 연결돼요!", "info")} style={{ border: "none", borderRadius: 13, padding: "11px 16px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", color: "#fff", fontFamily: "inherit", background: "linear-gradient(135deg,#a78bfa,#7c5cf0)", boxShadow: "0 10px 24px -10px rgba(124,92,240,.6)" }}>✍️ 제안 초안</button>
            <button onClick={downloadCsv} style={{ border: "none", borderRadius: 13, padding: "11px 16px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", color: "#08131f", fontFamily: "inherit", background: "linear-gradient(135deg,#c4ff5e,#37e0ff)", boxShadow: "0 10px 24px -10px rgba(55,224,255,.6)" }}>⬇ 명단 CSV</button>
          </div>
        </div>
      )}

      {/* 고급 설정 */}
      <div className="cc-sec" style={{ ...glass, padding: 18, position: "relative", zIndex: 1 }}>
        <div onClick={() => setAdvOpen((v) => !v)} style={{ fontSize: 14, fontWeight: 900, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: advOpen ? 16 : 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>⚙️ 고급 설정 <img src={CH.pumi} style={{ width: 26, height: 26 }} /></span>
          <span style={{ fontSize: 12.5, color: "#7c8bb0" }}>{advOpen ? "▲ 접기" : "▼ 펼치기"}</span>
        </div>
        {advOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.5fr", gap: 14 }}>
            <div>
              <div style={lbl}>수집 속도 (계정 안전)</div>
              <div style={{ display: "flex", gap: 6 }}>{["느림", "보통", "빠름"].map((s) => <span key={s} onClick={() => setSpeed(s)} style={{ ...smallChip(speed === s), flex: 1, textAlign: "center" }}>{s}</span>)}</div>
            </div>
            <div>
              <div style={lbl}>하루 최대 수집</div>
              <select value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} style={{ ...glass, borderRadius: 12, padding: "10px 12px", fontSize: 13, fontWeight: 700, color: "#e9eeff", background: "rgba(255,255,255,.04)", width: "100%", outline: "none", fontFamily: "inherit" }}>{[100, 200, 500, 1000].map((n) => <option key={n} value={n} style={{ color: "#111" }}>{n}명</option>)}</select>
            </div>
            <div>
              <div style={lbl}>제외 키워드 (쉼표)</div>
              <input value={excludeKw} onChange={(e) => setExcludeKw(e.target.value)} placeholder="예: 협찬거부, 홍보사절" style={{ ...glass, borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, color: "#e9eeff", background: "rgba(255,255,255,.04)", width: "100%", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
