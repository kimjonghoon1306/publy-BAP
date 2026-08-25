import { useState, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════
   블로거 발굴 · 아웃리치 컨트롤 센터 — PUBLY DISCOVERY
   오브제 에디토리얼 감성 · 다크/라이트 토글(부드러운 다크)
   ⚖️ 공개된 정보만. 비공개는 건드리지 않음.
   ═══════════════════════════════════════════════════════════════ */

const CH = {
  bori: "/characters/bori-cheer.png",
  dodo: "/characters/dodo-checker.png",
  monggeul: "/characters/monggeul-explorer.png",
  pumi: "/characters/pumi-guide.png",
};

// 테마: light = 웜 페이퍼 / dark = 부드러운 웜 차콜(너무 어둡지 않게)
const THEMES = {
  light: { bg: "#eee9df", surf: "#faf7f1", surf2: "#f3eee4", ink: "#2b2620", sub: "#8c8377", line: "#e0d7c9", line2: "#d5c9b7", accent: "#a8593a", accentSoft: "#efe2d6", logBg: "#fbf9f4", logInk: "#5c554a" },
  dark: { bg: "#2a2622", surf: "#33302b", surf2: "#3b3732", ink: "#f0ebe2", sub: "#a89f92", line: "#413c35", line2: "#4d473f", accent: "#e0916b", accentSoft: "#453a33", logBg: "#211e1a", logInk: "#c9bfae" },
};

type Blogger = {
  id: string; nick: string; url: string; topic: string;
  neighbors: number; postsPerWeek: number; visitors: number; score: number;
  email?: string; kakao?: string; openchat?: string; proposed?: boolean;
  keywords: string[];      // 자주 쓰는 키워드
  categories: string[];    // 주력 품목/카테고리
  lastActive: string;      // 마지막 활동
  engageRate: number;      // 참여율(%)
  ship?: ShipState;        // 배송 단계(체험단 제품 발송)
};
type ShipStatus = "none" | "accepted" | "ready" | "shipped" | "delivered";
type ShipState = { status: ShipStatus; address?: string; product?: string; courier?: string; tracking?: string };
const SHIP_LABEL: Record<ShipStatus, string> = { none: "미제안", accepted: "수락", ready: "발송대기", shipped: "배송중", delivered: "배송완료" };

const TOPICS = ["DELIVERY", "FOOD", "TRAVEL", "BEAUTY", "PARENTING", "FASHION", "CAFE", "LIVING", "PET", "FITNESS", "TECH", "HEALTH", "DIGITAL", "INTERIOR", "CULTURE", "EDU", "AUTO", "WEDDING", "FLOWER", "HOBBY"];
const TOPIC_KR: Record<string, string> = { DELIVERY: "배송·택배", FOOD: "맛집", TRAVEL: "여행", BEAUTY: "뷰티", PARENTING: "육아", FASHION: "패션", CAFE: "카페", LIVING: "리빙", PET: "펫", FITNESS: "운동", TECH: "IT", HEALTH: "건강", DIGITAL: "디지털", INTERIOR: "인테리어", CULTURE: "문화·공연", EDU: "교육", AUTO: "자동차", WEDDING: "웨딩", FLOWER: "플라워", HOBBY: "취미" };
const REGIONS = ["전국", "서울", "경기", "부산", "제주", "강원", "인천", "대구", "광주", "대전"];
const KW_POOL: Record<string, string[]> = {
  DELIVERY: ["새벽배송", "당일배송", "내돈내산", "정기구독", "언박싱", "배송후기", "가성비"],
  FOOD: ["맛집추천", "내돈내산", "존맛탱", "웨이팅", "혼밥", "가성비", "회식장소"],
  TRAVEL: ["국내여행", "당일치기", "숙소추천", "뷰맛집", "여행코스", "드라이브"],
  BEAUTY: ["신상템", "발색", "지속력", "데일리메이크업", "성분", "추천템"],
  CAFE: ["감성카페", "디저트", "분위기", "인생샷", "브런치", "노키즈존"],
  PARENTING: ["육아템", "아기용품", "이유식", "장난감추천", "육아꿀팁", "출산준비"],
  FASHION: ["데일리룩", "코디", "가성비룩", "신상", "OOTD", "하객룩"],
  HEALTH: ["다이어트", "영양제", "홈트", "건강식", "체지방", "건강관리"],
  PET: ["강아지간식", "고양이용품", "펫호텔", "반려동물", "사료추천", "펫케어"],
  LIVING: ["살림템", "주방템", "정리수납", "인테리어소품", "생활꿀팁", "청소템"],
};
const CAT_POOL: Record<string, string[]> = {
  DELIVERY: ["식품·신선", "생필품", "정기구독박스", "밀키트", "산지직송"],
  FOOD: ["한식", "일식", "카페·디저트", "고기·구이", "배달·밀키트"],
  TRAVEL: ["숙박·펜션", "관광·액티비티", "캠핑", "항공·교통"],
  BEAUTY: ["스킨케어", "메이크업", "헤어", "향수·바디"],
  CAFE: ["원두·홈카페", "베이커리", "디저트", "티·음료"],
  PARENTING: ["아기용품", "이유식·간식", "장난감", "출산·유아"],
  FASHION: ["여성의류", "남성의류", "잡화·가방", "슈즈"],
  HEALTH: ["건강기능식품", "운동용품", "다이어트식", "홈트기구"],
  PET: ["사료·간식", "펫용품", "펫패션", "위생·미용"],
  LIVING: ["주방·조리", "수납·정리", "청소·세탁", "인테리어소품"],
};

function mockFind(topic: string, n: number): Blogger[] {
  const nicks = ["초록다이어리", "제주살이룸", "먹킷리스트", "육아하는곰", "감성필름", "여행가는펭귄", "코랄뷰티", "산책하는나무", "홈카페일기", "부부의세계", "달려라토끼", "빵순이로그"];
  const kws = KW_POOL[topic] || KW_POOL.FOOD, cats = CAT_POOL[topic] || CAT_POOL.FOOD;
  const pick = (arr: string[], k: number) => [...arr].sort(() => Math.random() - .5).slice(0, k);
  const out: Blogger[] = [];
  for (let i = 0; i < n; i++) {
    const neighbors = 300 + Math.floor(Math.random() * 5000);
    const postsPerWeek = 1 + Math.floor(Math.random() * 6);
    const visitors = 50 + Math.floor(Math.random() * 2000);
    const engageRate = Math.round((2 + Math.random() * 12) * 10) / 10;
    const score = Math.min(99, Math.round((neighbors / 60 + postsPerWeek * 6 + visitors / 40 + engageRate * 2) / 3.5));
    out.push({
      id: "b" + i + Date.now(), nick: nicks[i % nicks.length] + (i > 11 ? i : ""),
      url: "blog.naver.com/" + TOPIC_KR[topic] + "_blogger" + i, topic, neighbors, postsPerWeek, visitors, score,
      email: Math.random() > 0.35 ? `${TOPIC_KR[topic]}blog${i}@naver.com` : undefined,
      kakao: Math.random() > 0.55 ? `${TOPIC_KR[topic]}_${i}` : undefined,
      openchat: Math.random() > 0.7 ? "open.kakao.com/o/xxxx" : undefined,
      proposed: Math.random() > 0.85,
      keywords: pick(kws, 3 + Math.floor(Math.random() * 2)),
      categories: pick(cats, 2),
      lastActive: ["오늘", "어제", "2일 전", "3일 전"][Math.floor(Math.random() * 4)],
      engageRate,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export default function CrawlCenter({ showToast, theme: extTheme }: { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light" }) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  const [theme, setTheme] = useState<"dark" | "light">(extTheme === "dark" ? "dark" : "light");
  const C = THEMES[theme];

  const [topic, setTopic] = useState("FOOD");
  const [region, setRegion] = useState("전국");
  const [count, setCount] = useState(30);
  const [minNeighbors, setMinNeighbors] = useState(500);
  const [minPosts, setMinPosts] = useState(2);
  const [activeOnly, setActiveOnly] = useState(true);
  const [topicMatch, setTopicMatch] = useState(true);
  const [fields, setFields] = useState<Record<string, boolean>>({ email: true, kakao: true, openchat: true, url: true, nick: true, keywords: true, categories: true });
  const toggleField = (k: string) => setFields((f) => ({ ...f, [k]: !f[k] }));
  const [advOpen, setAdvOpen] = useState(false);
  const [speed, setSpeed] = useState("보통");
  const [dailyLimit, setDailyLimit] = useState(200);
  const [excludeKw, setExcludeKw] = useState("");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [logExpand, setLogExpand] = useState(false);
  const [results, setResults] = useState<Blogger[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"score" | "neighbors" | "posts">("score");
  const [onlyContact, setOnlyContact] = useState(false);
  const [detail, setDetail] = useState<Blogger | null>(null);
  const [outreach, setOutreach] = useState<null | "email" | "comment">(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [ships, setShips] = useState<Record<string, ShipState>>({}); // 블로거별 배송 상태
  const setShip = (id: string, patch: Partial<ShipState>) => setShips((s) => ({ ...s, [id]: { ...{ status: "accepted" as ShipStatus }, ...s[id], ...patch } }));
  const timerRef = useRef<any>(null);

  const pushLog = (m: string) => setLogs((l) => [...l, `${new Date().toLocaleTimeString("ko-KR")}  ${m}`]);

  const startFind = () => {
    if (running) return;
    setRunning(true); setProgress(0); setLogs([]); setResults([]); setSelected(new Set());
    pushLog(`SCAN START — "${topic}" · ${region} (target ${count})`);
    pushLog(`FILTER — neighbors ${minNeighbors.toLocaleString()}+ · ${minPosts} posts/wk+ ${activeOnly ? "· active only" : ""} ${topicMatch ? "· topic match" : ""}`);
    let p = 0;
    const steps = ["네이버 검색으로 글 수집 중", "글쓴이(블로거) 추리는 중", "공개 프로필·연락처 확인 중", "관심 키워드·품목 분석 중", "활동성 점수 계산 · 비공개 제외"];
    timerRef.current = setInterval(() => {
      p += Math.random() * 20;
      if (p >= 100) {
        p = 100; setProgress(100); clearInterval(timerRef.current);
        const found = mockFind(topic, Math.min(count, 12)).filter((b) => b.neighbors >= minNeighbors && b.postsPerWeek >= minPosts);
        setResults(found);
        pushLog(`DONE — ${found.length} bloggers (${found.filter((b) => b.email || b.kakao).length} with contact)`);
        setRunning(false); toast(`${found.length}명 발굴 완료`, "success");
        return;
      }
      setProgress(Math.round(p));
      if (Math.random() > 0.5) pushLog("· " + steps[Math.min(steps.length - 1, Math.floor(p / 20))]);
    }, 420);
  };
  const stopFind = () => { if (timerRef.current) clearInterval(timerRef.current); setRunning(false); pushLog("STOPPED by user."); };

  const shown = results
    .filter((b) => !onlyContact || b.email || b.kakao || b.openchat)
    .sort((a, b) => sortBy === "score" ? b.score - a.score : sortBy === "neighbors" ? b.neighbors - a.neighbors : b.postsPerWeek - a.postsPerWeek);
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const downloadCsv = () => {
    const rows = shown.filter((b) => selected.size === 0 || selected.has(b.id));
    if (!rows.length) { toast("내보낼 블로거가 없어요", "info"); return; }
    const H = ["닉네임", "블로그", "주제", "이웃수", "주간글수", "방문자", "참여율", "점수", "관심키워드", "주력품목", "이메일", "카톡", "오픈채팅"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [H.map(esc).join(","), ...rows.map((b) => [b.nick, b.url, TOPIC_KR[b.topic], b.neighbors, b.postsPerWeek, b.visitors, b.engageRate + "%", b.score, b.keywords.join(" "), b.categories.join(" "), b.email || "", b.kakao || "", b.openchat || ""].map(esc).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `blogger_${topic}_${rows.length}.csv`; a.click();
    toast(`${rows.length}명 CSV 저장`, "success");
  };

  // ── 스타일 토큰 ──
  const serif = "'Fraunces','Playfair Display',Georgia,'Noto Serif KR',serif";
  const card = { background: C.surf, border: `1px solid ${C.line}`, borderRadius: 4 } as const;
  const eyebrow = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".22em", color: C.sub, textTransform: "uppercase" as const };
  const label = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em", color: C.sub, textTransform: "uppercase" as const, marginBottom: 9 };
  const chip = (on: boolean) => ({ padding: "8px 15px", borderRadius: 2, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" as const, border: `1px solid ${on ? C.ink : C.line2}`, background: on ? C.ink : "transparent", color: on ? C.surf : C.sub, transition: "all .16s", letterSpacing: on ? ".08em" : "0" } as const);
  const sChip = (on: boolean) => ({ ...chip(on), padding: "6px 12px", fontSize: 12 } as const);
  const inp = { background: theme === "dark" ? C.surf2 : "#fff", border: `1px solid ${C.line2}`, borderRadius: 3, padding: "10px 12px", fontSize: 13, fontWeight: 600, color: C.ink, width: "100%", outline: "none", fontFamily: "'Noto Sans KR',sans-serif", boxSizing: "border-box" as const };
  const btnSolid = { border: `1px solid ${C.ink}`, borderRadius: 3, padding: "11px 18px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", color: C.surf, fontFamily: "inherit" as const, background: C.ink, letterSpacing: ".06em" };
  const btnGhost = { border: `1px solid ${C.line2}`, borderRadius: 3, padding: "11px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", color: C.ink, fontFamily: "inherit" as const, background: "transparent", letterSpacing: ".04em" };

  return (
    <div style={{ position: "relative", borderRadius: 6, padding: "26px 26px", overflow: "hidden", fontFamily: "'Noto Sans KR',sans-serif", color: C.ink, background: C.bg, minHeight: 420, transition: "background .3s,color .3s" }}>
      <style>{`
        @keyframes obBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes obUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes obBar{0%{background-position:0 0}100%{background-position:26px 0}}
        .ob-sec{animation:obUp .5s cubic-bezier(.22,1,.36,1) both}
        .ob-bob{animation:obBob 4s ease-in-out infinite}
        .ob-card:hover{box-shadow:0 14px 30px -20px rgba(0,0,0,.4)!important;transition:all .25s}
        .ob-scroll::-webkit-scrollbar{height:6px;width:6px}.ob-scroll::-webkit-scrollbar-thumb{background:${C.line2};border-radius:0}
      `}</style>

      {/* ── 헤더 ── */}
      <div className="ob-sec" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, paddingBottom: 18, borderBottom: `1px solid ${C.line2}`, marginBottom: 22 }}>
        <div>
          <div style={eyebrow}>Blogger Discovery · Outreach</div>
          <div style={{ fontFamily: serif, fontSize: 38, fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1, marginTop: 8, color: C.ink }}>PUBLY<span style={{ color: C.accent }}> Discovery</span></div>
          <div style={{ fontSize: 12.5, color: C.sub, fontWeight: 600, marginTop: 8, maxWidth: 480, lineHeight: 1.6 }}>체험단에 어울리는 블로거를 <b style={{ color: C.ink }}>공개 정보로</b> 발굴하고, 관심사·주력 품목까지 분석해 정중히 제안합니다.</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          {/* 테마 토글 */}
          <button onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")} style={{ border: `1px solid ${C.line2}`, background: "transparent", color: C.sub, borderRadius: 2, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{theme === "dark" ? "☀ LIGHT" : "☾ DARK"}</button>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", color: C.sub, border: `1px solid ${C.line2}`, padding: "6px 11px", borderRadius: 2, whiteSpace: "nowrap" }}>⚖ 공개 정보만</span>
          <img src={CH.monggeul} className="ob-bob" style={{ width: 62, height: 62, objectFit: "contain", filter: "saturate(.9) drop-shadow(0 8px 14px rgba(0,0,0,.2))" }} />
        </div>
      </div>

      {/* ── 지표 ── */}
      <div className="ob-sec" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", marginBottom: 22, border: `1px solid ${C.line}`, background: C.surf, borderRadius: 4 }}>
        {[
          { lab: "Found", val: results.length, unit: "명" },
          { lab: "Proposed", val: 0, unit: "명" },
          { lab: "With Contact", val: results.filter((b) => b.email || b.kakao).length, unit: "명" },
          { lab: "Avg Score", val: results.length ? Math.round(results.reduce((s, b) => s + b.score, 0) / results.length) : 0, unit: "" },
        ].map((k, i) => (
          <div key={i} style={{ padding: "15px 18px", borderLeft: i ? `1px solid ${C.line}` : "none" }}>
            <div style={label}>{k.lab}</div>
            <div style={{ fontFamily: serif, fontSize: 29, fontWeight: 600, color: C.ink, lineHeight: 1 }}>{k.val}<span style={{ fontSize: 12, marginLeft: 3, color: C.sub, fontFamily: "'Noto Sans KR'" }}>{k.unit}</span></div>
          </div>
        ))}
      </div>

      {/* ── 검색 설정 ── */}
      <div className="ob-sec ob-card" style={{ ...card, padding: 22, marginBottom: 16 }}>
        <div style={{ fontFamily: serif, fontSize: 19, fontWeight: 600, marginBottom: 18 }}>Search — 무엇을 찾을까요</div>
        <div style={{ marginBottom: 18 }}>
          <div style={label}>Topic</div>
          <div className="ob-scroll" style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{TOPICS.map((t) => <span key={t} onClick={() => setTopic(t)} style={chip(topic === t)}>{t} <span style={{ opacity: .6, fontSize: 11 }}>{TOPIC_KR[t]}</span></span>)}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 110px", gap: 14, alignItems: "end" }}>
          <div><div style={label}>Region</div><select value={region} onChange={(e) => setRegion(e.target.value)} style={inp}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div><div style={label}>Keyword</div><input placeholder="예: 감성카페, 아이랑 갈만한곳" style={inp} /></div>
          <div><div style={label}>Count</div><select value={count} onChange={(e) => setCount(Number(e.target.value))} style={inp}>{[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}명</option>)}</select></div>
        </div>
        <hr style={{ border: 0, borderTop: `1px solid ${C.line2}`, margin: "20px 0 18px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {!running
            ? <button onClick={startFind} style={{ ...btnSolid, padding: "13px 26px", fontSize: 14, textTransform: "uppercase" }}>Start Scan →</button>
            : <button onClick={stopFind} style={{ border: `1px solid ${C.accent}`, borderRadius: 3, padding: "13px 26px", fontSize: 14, fontWeight: 800, letterSpacing: ".08em", cursor: "pointer", color: C.accent, fontFamily: "inherit", background: "transparent", textTransform: "uppercase" }}>■ Stop</button>}
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>비공개 블로그는 <b style={{ color: C.ink }}>자동으로 건너뜁니다</b></div>
        </div>
      </div>

      {/* ── 필터 · 수집항목 ── */}
      <div className="ob-sec" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="ob-card" style={{ ...card, padding: 22 }}>
          <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, marginBottom: 18 }}>Activity Filter</div>
          {/* 이웃수 = 직접 입력 */}
          <div style={{ marginBottom: 16 }}>
            <div style={label}>최소 이웃 수 (직접 입력)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={0} step={100} value={minNeighbors} onChange={(e) => setMinNeighbors(Math.max(0, Number(e.target.value) || 0))} style={{ ...inp, width: 130 }} />
              <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>명 이상</span>
              <div style={{ display: "flex", gap: 5, marginLeft: "auto" }}>{[500, 1000, 3000].map((v) => <span key={v} onClick={() => setMinNeighbors(v)} style={{ ...sChip(false), padding: "5px 9px", fontSize: 11 }}>{v >= 1000 ? v / 1000 + "k" : v}</span>)}</div>
            </div>
          </div>
          {/* 주간 글수 = 직접 입력 */}
          <div style={{ marginBottom: 18 }}>
            <div style={label}>주간 최소 글 수 (직접 입력)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={0} max={50} value={minPosts} onChange={(e) => setMinPosts(Math.max(0, Number(e.target.value) || 0))} style={{ ...inp, width: 90 }} />
              <span style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>글 이상 / 주</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}><span onClick={() => setActiveOnly((v) => !v)} style={sChip(activeOnly)}>최근 활동중만</span><span onClick={() => setTopicMatch((v) => !v)} style={sChip(topicMatch)}>주제 일치</span></div>
        </div>
        <div className="ob-card" style={{ ...card, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}><div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600 }}>Collect — 무엇을 모을까요</div><img src={CH.dodo} style={{ width: 30, height: 30, marginLeft: "auto", filter: "saturate(.9)" }} /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>{[["email", "이메일"], ["kakao", "카톡 ID"], ["openchat", "오픈채팅"], ["url", "블로그 주소"], ["nick", "닉네임"], ["keywords", "관심 키워드"], ["categories", "주력 품목"]].map(([k, l]) => <span key={k} onClick={() => toggleField(k)} style={sChip(!!fields[k])}>{l}</span>)}</div>
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, background: C.surf2, border: `1px solid ${C.line}`, borderRadius: 3, padding: "12px 14px", lineHeight: 1.6 }}>블로그에 <b style={{ color: C.accent }}>공개해 둔 정보</b>만 모읍니다. "협찬·체험단 문의 환영"처럼 열어둔 곳에 정중히 제안하는 건 정당합니다.</div>
        </div>
      </div>

      {/* ── 진행 로그 (넓은 창) ── */}
      {(running || logs.length > 0) && (
        <div className="ob-sec ob-card" style={{ ...card, padding: 22, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600 }}>Live Log <span style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginLeft: 4 }}>{logs.length}줄</span></div>
            <button onClick={() => setLogExpand(true)} style={{ ...btnGhost, marginLeft: "auto", padding: "6px 12px", fontSize: 11.5 }}>⤢ 크게 보기</button>
          </div>
          <div style={{ height: 8, background: C.surf2, border: `1px solid ${C.line}`, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ height: "100%", width: `${progress}%`, background: running ? `repeating-linear-gradient(45deg,${C.ink},${C.ink} 8px,${C.accent} 8px,${C.accent} 16px)` : C.ink, backgroundSize: "26px 26px", animation: running ? "obBar .7s linear infinite" : "none", transition: "width .4s" }} />
          </div>
          {/* 적당히 보이는 기본 로그 (260px) */}
          <div className="ob-scroll" style={{ height: 260, overflowY: "auto", background: C.logBg, border: `1px solid ${C.line}`, borderRadius: 3, padding: "12px 16px", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.95, color: C.logInk, whiteSpace: "pre-wrap" }}>
            {logs.length === 0 ? <span style={{ color: C.sub }}>대기 중…</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* ── 결과 ── */}
      {results.length > 0 && (
        <div className="ob-sec ob-card" style={{ ...card, padding: 22, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 0, paddingBottom: 16, borderBottom: `1px solid ${C.line}` }}>
            <div><div style={eyebrow}>Curated</div><div style={{ fontFamily: serif, fontSize: 20, fontWeight: 600, marginTop: 5 }}>발굴된 블로거 {shown.length}명</div></div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
              <span onClick={() => setOnlyContact((v) => !v)} style={sChip(onlyContact)}>연락처 있는 것만</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} style={{ ...inp, width: "auto", padding: "7px 10px", fontSize: 12 }}><option value="score">점수순</option><option value="neighbors">이웃순</option><option value="posts">글 많은순</option></select>
              <span onClick={() => setSelected(new Set(shown.map((b) => b.id)))} style={sChip(false)}>전체선택</span>
              {selected.size > 0 && <span onClick={() => setSelected(new Set())} style={{ ...sChip(false), color: C.accent, borderColor: C.accent }}>해제 {selected.size}</span>}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", borderLeft: `1px solid ${C.line}`, borderTop: `1px solid ${C.line}` }}>
            {shown.map((b) => {
              const on = selected.has(b.id);
              const gr = b.score >= 75 ? "S" : b.score >= 55 ? "A" : "B";
              return (
                <div key={b.id} style={{ padding: 16, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: on ? C.accentSoft : "transparent", position: "relative", transition: "background .15s" }}>
                  <div onClick={() => toggleSel(b.id)} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9, cursor: "pointer" }}>
                    <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 600, color: on ? C.accent : C.ink, width: 24 }}>{gr}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.nick}</div>
                      <div style={{ fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.url}</div>
                    </div>
                    <div style={{ width: 18, height: 18, borderRadius: 2, border: `1px solid ${on ? C.accent : C.line2}`, background: on ? C.accent : "transparent", color: C.surf, fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on ? "✓" : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 11, color: C.sub, fontWeight: 700, flexWrap: "wrap" }}>
                    <span>이웃 {b.neighbors.toLocaleString()}</span><span>주 {b.postsPerWeek}글</span><span>참여 {b.engageRate}%</span><span style={{ color: C.ink }}>{b.score}점</span>
                  </div>
                  {/* 관심 키워드 미리보기 */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                    {b.keywords.slice(0, 3).map((k) => <span key={k} style={{ fontSize: 10, fontWeight: 700, color: C.sub, background: C.surf2, padding: "2px 6px", borderRadius: 2 }}>#{k}</span>)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {b.email && <span style={{ fontSize: 10, fontWeight: 700, color: C.ink, border: `1px solid ${C.line2}`, padding: "2px 7px", borderRadius: 2 }}>이메일</span>}
                    {b.kakao && <span style={{ fontSize: 10, fontWeight: 700, color: C.ink, border: `1px solid ${C.line2}`, padding: "2px 7px", borderRadius: 2 }}>카톡</span>}
                    {!b.email && !b.kakao && !b.openchat && <span style={{ fontSize: 10, color: C.sub }}>공개 연락처 없음</span>}
                    {b.proposed && <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, border: `1px solid ${C.accent}`, padding: "2px 7px", borderRadius: 2 }}>제안함</span>}
                    {ships[b.id] && <span style={{ fontSize: 10, fontWeight: 800, color: C.surf, background: ships[b.id].status === "delivered" ? "#2f9e5e" : C.accent, padding: "2px 7px", borderRadius: 2 }}>📦 {SHIP_LABEL[ships[b.id].status]}</span>}
                    <button onClick={() => setDetail(b)} style={{ marginLeft: "auto", ...btnGhost, padding: "4px 9px", fontSize: 10.5 }}>상세 →</button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* 아웃리치 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
            <img src={CH.bori} className="ob-bob" style={{ width: 44, height: 44, filter: "saturate(.9)" }} />
            <div style={{ flex: 1, minWidth: 150 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{selected.size > 0 ? `${selected.size}명 선택됨` : "체험단 제안 보내기"}</div>
              <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600 }}>이메일 발송 · 블로그 댓글 제안 · 공개 문의처로만</div>
            </div>
            <button onClick={() => { if (!selected.size) { toast("먼저 블로거를 선택하세요", "info"); return; } setOutreach("email"); }} style={btnGhost}>✉ 이메일 보내기</button>
            <button onClick={() => { if (!selected.size) { toast("먼저 블로거를 선택하세요", "info"); return; } setOutreach("comment"); }} style={btnGhost}>💬 댓글 제안</button>
            <button onClick={() => setShipOpen(true)} style={btnGhost}>📦 배송 관리{Object.keys(ships).length ? ` (${Object.keys(ships).length})` : ""}</button>
            <button onClick={downloadCsv} style={btnSolid}>명단 CSV ↓</button>
          </div>
        </div>
      )}

      {/* ── 고급 설정 ── */}
      <div className="ob-sec ob-card" style={{ ...card, padding: 22 }}>
        <div onClick={() => setAdvOpen((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: advOpen ? 18 : 0 }}>
          <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>Advanced <img src={CH.pumi} style={{ width: 26, height: 26, filter: "saturate(.9)" }} /></span>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".1em", color: C.sub, textTransform: "uppercase" }}>{advOpen ? "− 닫기" : "+ 열기"}</span>
        </div>
        {advOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.5fr", gap: 16 }}>
            <div><div style={label}>수집 속도 (계정 안전)</div><div style={{ display: "flex", gap: 7 }}>{["느림", "보통", "빠름"].map((s) => <span key={s} onClick={() => setSpeed(s)} style={{ ...sChip(speed === s), flex: 1, textAlign: "center" }}>{s}</span>)}</div></div>
            <div><div style={label}>하루 최대</div><select value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} style={inp}>{[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}명</option>)}</select></div>
            <div><div style={label}>제외 키워드</div><input value={excludeKw} onChange={(e) => setExcludeKw(e.target.value)} placeholder="예: 협찬거부, 홍보사절" style={inp} /></div>
          </div>
        )}
      </div>

      {/* ═══ 블로거 상세 분석 모달 ═══ */}
      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 480, width: "100%", maxHeight: "86vh", overflowY: "auto", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "22px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ fontFamily: serif, fontSize: 30, fontWeight: 600, color: C.accent }}>{detail.score >= 75 ? "S" : detail.score >= 55 ? "A" : "B"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{detail.nick}</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>{detail.url}</div>
              </div>
              <button onClick={() => setDetail(null)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px" }}>
              {/* 지표 그리드 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, border: `1px solid ${C.line}`, marginBottom: 20 }}>
                {[["이웃 수", detail.neighbors.toLocaleString()], ["주간 글 수", detail.postsPerWeek + "글"], ["일 방문자", detail.visitors.toLocaleString()], ["참여율", detail.engageRate + "%"], ["활동성 점수", detail.score + "점"], ["최근 활동", detail.lastActive]].map(([l, v], i) => (
                  <div key={i} style={{ padding: "12px 14px", borderLeft: i % 3 ? `1px solid ${C.line}` : "none", borderTop: i >= 3 ? `1px solid ${C.line}` : "none" }}>
                    <div style={{ ...label, marginBottom: 5 }}>{l}</div>
                    <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>
              {/* 관심 키워드 */}
              <div style={{ marginBottom: 18 }}>
                <div style={label}>자주 쓰는 키워드</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{detail.keywords.map((k) => <span key={k} style={{ fontSize: 12, fontWeight: 700, color: C.ink, border: `1px solid ${C.line2}`, padding: "5px 10px", borderRadius: 2 }}>#{k}</span>)}</div>
              </div>
              {/* 주력 품목 */}
              <div style={{ marginBottom: 18 }}>
                <div style={label}>주력 품목 · 카테고리</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{detail.categories.map((c) => <span key={c} style={{ fontSize: 12, fontWeight: 700, color: C.surf, background: C.ink, padding: "5px 10px", borderRadius: 2 }}>{c}</span>)}</div>
              </div>
              {/* 연락처 */}
              <div style={{ marginBottom: 20 }}>
                <div style={label}>공개 연락처</div>
                <div style={{ fontSize: 13, color: C.ink, fontWeight: 600, lineHeight: 1.8 }}>
                  {detail.email ? <div>✉ {detail.email}</div> : null}
                  {detail.kakao ? <div>💬 카톡 {detail.kakao}</div> : null}
                  {detail.openchat ? <div>🔗 {detail.openchat}</div> : null}
                  {!detail.email && !detail.kakao && !detail.openchat ? <span style={{ color: C.sub }}>공개된 연락처가 없어요 (블로그 댓글로만 제안 가능)</span> : null}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setSelected(new Set([detail.id])); setDetail(null); setOutreach("email"); }} style={{ ...btnGhost, flex: 1 }}>✉ 이메일 제안</button>
                <button onClick={() => { setSelected(new Set([detail.id])); setDetail(null); setOutreach("comment"); }} style={{ ...btnSolid, flex: 1 }}>💬 댓글 제안</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 아웃리치 모달 (이메일 / 댓글) ═══ */}
      {outreach && (
        <div onClick={() => setOutreach(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 520, width: "100%", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
              <img src={CH.bori} style={{ width: 40, height: 40 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>{outreach === "email" ? "이메일 제안 보내기" : "블로그 댓글 제안"}</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>{selected.size}명 대상 · {outreach === "email" ? "공개 이메일로 발송" : "각 블로그에 정중한 댓글"}</div>
              </div>
              <button onClick={() => setOutreach(null)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px" }}>
              {outreach === "email" && <div style={{ marginBottom: 14 }}><div style={label}>제목</div><input defaultValue="[온종일 체험단] 함께하실 블로거님을 찾았어요" style={inp} /></div>}
              <div style={{ marginBottom: 14 }}>
                <div style={label}>메시지 (개인화 변수 사용 가능)</div>
                <textarea rows={outreach === "email" ? 7 : 4} defaultValue={outreach === "email"
                  ? "{닉네임}님 안녕하세요! 블로그 잘 보고 있어요 😊\n{관심품목} 관련 글을 즐겨 쓰시는 것 같아, 온종일 체험단에 함께하시면 좋을 것 같아 연락드려요.\n관심 있으시면 회신 주세요. 감사합니다!"
                  : "{닉네임}님 글 잘 봤어요! {관심키워드} 관련해 온종일 체험단 함께하실래요? 문의는 프로필 링크로 :)"} style={{ ...inp, resize: "vertical", lineHeight: 1.7 }} />
              </div>
              <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, background: C.surf2, border: `1px solid ${C.line}`, borderRadius: 3, padding: "10px 13px", lineHeight: 1.6, marginBottom: 18 }}>
                💡 <b>{"{닉네임}"}·{"{관심키워드}"}·{"{관심품목}"}</b>는 블로거마다 자동으로 채워져요. {outreach === "comment" ? "댓글은 계정 연결이 필요해요(서이추·공감댓글처럼)." : "발송은 공개된 이메일 주소로만 나가요."}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setOutreach(null)} style={{ ...btnGhost, flex: 1 }}>취소</button>
                <button onClick={() => { const now: Record<string, ShipState> = {}; selected.forEach((id) => { now[id] = { ...{ status: "accepted" as ShipStatus }, ...ships[id] }; }); setShips((s) => ({ ...s, ...now })); toast(`${outreach === "email" ? "이메일" : "댓글"} 발송 엔진 연결 예정 — 배송 대상으로 담았어요`, "info"); setOutreach(null); }} style={{ ...btnSolid, flex: 2 }}>{selected.size}명에게 {outreach === "email" ? "발송" : "댓글 남기기"} →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 배송 관리 모달 (체험단 제품 발송) ═══ */}
      {shipOpen && (
        <div onClick={() => setShipOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 680, width: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
              <img src={CH.dodo} style={{ width: 40, height: 40 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>배송 관리</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>제안 수락한 블로거에게 체험단 제품을 보내고 송장을 관리해요</div>
              </div>
              <button onClick={() => setShipOpen(false)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div className="ob-scroll" style={{ padding: "16px 24px", overflowY: "auto", flex: 1 }}>
              {/* 배송 단계 요약 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", border: `1px solid ${C.line}`, marginBottom: 18 }}>
                {(["accepted", "ready", "shipped", "delivered", "none"] as ShipStatus[]).filter((s) => s !== "none").map((st, i) => (
                  <div key={st} style={{ padding: "10px 8px", textAlign: "center", borderLeft: i ? `1px solid ${C.line}` : "none" }}>
                    <div style={{ fontFamily: serif, fontSize: 20, fontWeight: 600 }}>{Object.values(ships).filter((s) => s.status === st).length}</div>
                    <div style={{ ...label, marginBottom: 0, fontSize: 9.5 }}>{SHIP_LABEL[st]}</div>
                  </div>
                ))}
              </div>
              {Object.keys(ships).length === 0 ? (
                <div style={{ textAlign: "center", padding: "36px 20px", color: C.sub, fontSize: 13, fontWeight: 600 }}>아직 배송 대상이 없어요.<br />결과에서 블로거를 선택해 <b style={{ color: C.ink }}>이메일/댓글 제안</b>을 보내면 여기로 담겨요.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {Object.entries(ships).map(([id, sh]) => {
                    const b = results.find((r) => r.id === id);
                    return (
                      <div key={id} style={{ border: `1px solid ${C.line}`, borderRadius: 4, padding: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{b?.nick || id}</div>
                          <select value={sh.status} onChange={(e) => setShip(id, { status: e.target.value as ShipStatus })} style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: 12 }}>
                            {(["accepted", "ready", "shipped", "delivered"] as ShipStatus[]).map((st) => <option key={st} value={st}>{SHIP_LABEL[st]}</option>)}
                          </select>
                          <button onClick={() => setShips((s) => { const n = { ...s }; delete n[id]; return n; })} style={{ ...btnGhost, padding: "5px 9px", fontSize: 11, color: C.accent, borderColor: C.accent }}>제거</button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8, marginBottom: 8 }}>
                          <input value={sh.address || ""} onChange={(e) => setShip(id, { address: e.target.value })} placeholder="배송지 주소 (수락 후 받은 주소)" style={{ ...inp, fontSize: 12 }} />
                          <input value={sh.product || ""} onChange={(e) => setShip(id, { product: e.target.value })} placeholder="보낼 제품" style={{ ...inp, fontSize: 12 }} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}>
                          <select value={sh.courier || ""} onChange={(e) => setShip(id, { courier: e.target.value })} style={{ ...inp, fontSize: 12 }}>
                            <option value="">택배사</option>{["CJ대한통운", "우체국", "한진", "롯데", "로젠", "쿠팡"].map((c) => <option key={c}>{c}</option>)}
                          </select>
                          <input value={sh.tracking || ""} onChange={(e) => setShip(id, { tracking: e.target.value })} placeholder="송장번호" style={{ ...inp, fontSize: 12 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: "14px 24px", borderTop: `1px solid ${C.line}`, display: "flex", gap: 8 }}>
              <button onClick={() => setShipOpen(false)} style={{ ...btnGhost, flex: 1 }}>닫기</button>
              <button onClick={() => { toast("배송 정보를 저장했어요 (실 저장은 엔진 연결 시)", "success"); }} style={{ ...btnSolid, flex: 2 }}>배송 정보 저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 로그 크게 보기 모달 (전체화면 확대) ═══ */}
      {logExpand && (
        <div onClick={() => setLogExpand(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.6)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, width: "min(1000px,96vw)", height: "min(88vh,900px)", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,.55)" }}>
            <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>Live Log</div>
              <span style={{ fontSize: 11.5, color: C.sub, fontWeight: 600 }}>{logs.length}줄 {running ? "· 진행 중" : ""}</span>
              <button onClick={() => { navigator.clipboard?.writeText(logs.join("\n")); toast("로그를 복사했어요", "success"); }} style={{ ...btnGhost, marginLeft: "auto", padding: "6px 12px", fontSize: 11.5 }}>복사</button>
              <button onClick={() => setLogExpand(false)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 11.5 }}>✕ 닫기</button>
            </div>
            <div className="ob-scroll" style={{ flex: 1, overflowY: "auto", background: C.logBg, padding: "16px 22px", fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 2, color: C.logInk, whiteSpace: "pre-wrap" }}>
              {logs.length === 0 ? <span style={{ color: C.sub }}>대기 중…</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
