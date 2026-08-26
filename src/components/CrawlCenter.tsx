import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { BotEventStream } from "../lib/botApi";

const BOT = "http://127.0.0.1:3334";   // neighbor-bot (발굴·발송)

/* ═══════════════════════════════════════════════════════════════
   블로거 발굴 · 아웃리치 컨트롤 센터 — PUBLY DISCOVERY
   오브제 에디토리얼 감성 · 다크/라이트 토글(부드러운 다크)
   ⚖️ 공개된 정보만. 비공개는 건드리지 않음.
   ═══════════════════════════════════════════════════════════════ */

// ★ Electron 설치앱(file://)에서는 절대경로 "/characters/..."가 파일시스템 루트를 가리켜 404 → 이미지 깨짐.
//   vite base:"./" + SPA(경로 안 바뀜)라 상대경로 "characters/..."가 dist/characters/ 로 정상 로드됨.
const CH = {
  bori: "characters/bori-cheer.png",
  dodo: "characters/dodo-checker.png",
  monggeul: "characters/monggeul-explorer.png",
  pumi: "characters/pumi-guide.png",
};
// 혹시라도 로드 실패 시 마스코트별 이모지로 대체(깨진 아이콘 노출 방지)
const chErr = (emoji: string) => (e: any) => {
  const s = document.createElement("span");
  s.textContent = emoji;
  s.style.cssText = "font-size:1.4em;line-height:1;display:inline-block";
  e.currentTarget.replaceWith(s);
};

// 테마: light = 웜 페이퍼 / dark = 부드러운 웜 차콜(너무 어둡지 않게)
const THEMES = {
  light: { bg: "#eee9df", surf: "#faf7f1", surf2: "#f3eee4", ink: "#2b2620", sub: "#8c8377", line: "#e0d7c9", line2: "#d5c9b7", accent: "#a8593a", accentSoft: "#efe2d6", logBg: "#fbf9f4", logInk: "#5c554a" },
  dark: { bg: "#2a2622", surf: "#33302b", surf2: "#3b3732", ink: "#f0ebe2", sub: "#a89f92", line: "#413c35", line2: "#4d473f", accent: "#e0916b", accentSoft: "#453a33", logBg: "#211e1a", logInk: "#c9bfae" },
};

type Blogger = {
  id: string; nick: string; url: string; topic: string;
  thumbnail?: string;      // 프로필/썸네일 이미지(네이버 검색 API 제공)
  neighbors: number; postsPerWeek: number; visitors: number; score: number;
  email?: string; kakao?: string; openchat?: string; proposed?: boolean;
  keywords: string[];      // 자주 쓰는 키워드
  categories: string[];    // 주력 품목/카테고리
  lastActive: string;      // 마지막 활동
  engageRate: number;      // 참여율(%)
  authenticity?: number;   // 🩺 AI 진정성 점수(0~100) — 봇 로직 역이용, 가짜/품앗이 감별
  ship?: ShipState;        // 배송 단계(체험단 제품 발송)
};
// 체험단 배송 단계: 제안함(내가 연락) → 수락(블로거가 OK 회신 → 운영자가 확인 눌러 확정) → 발송대기 → 배송중 → 배송완료
type ShipStatus = "none" | "proposed" | "accepted" | "ready" | "shipped" | "delivered";
type ShipState = { status: ShipStatus; address?: string; product?: string; courier?: string; tracking?: string };
const SHIP_LABEL: Record<ShipStatus, string> = { none: "미제안", proposed: "제안함·회신대기", accepted: "수락", ready: "발송대기", shipped: "배송중", delivered: "배송완료" };
// 각 단계가 무슨 뜻인지(운영자용 쉬운 설명)
const SHIP_DESC: Record<ShipStatus, string> = { none: "아직 제안 안 함", proposed: "내가 이메일·댓글로 연락했고, 블로거의 OK 회신을 기다리는 중이에요", accepted: "블로거가 하겠다고 회신해서 운영자가 수락 처리한 상태예요", ready: "수락돼서 이제 제품을 보낼 준비를 하는 단계예요", shipped: "제품을 택배로 보냈어요(송장 등록됨)", delivered: "블로거가 제품을 받았어요" };

const TOPICS = ["DELIVERY", "FOOD", "TRAVEL", "BEAUTY", "PARENTING", "FASHION", "CAFE", "LIVING", "PET", "FITNESS", "TECH", "HEALTH", "DIGITAL", "INTERIOR", "CULTURE", "EDU", "AUTO", "WEDDING", "FLOWER", "HOBBY"];
const TOPIC_KR: Record<string, string> = { DELIVERY: "배송·택배", FOOD: "맛집", TRAVEL: "여행", BEAUTY: "뷰티", PARENTING: "육아", FASHION: "패션", CAFE: "카페", LIVING: "리빙", PET: "펫", FITNESS: "운동", TECH: "IT", HEALTH: "건강", DIGITAL: "디지털", INTERIOR: "인테리어", CULTURE: "문화·공연", EDU: "교육", AUTO: "자동차", WEDDING: "웨딩", FLOWER: "플라워", HOBBY: "취미" };
const REGIONS = ["전국", "서울", "경기", "부산", "제주", "강원", "인천", "대구", "광주", "대전"];

// (목업 mockFind 제거 — 실제 네이버 발굴 API(/api/crawl)로 교체됨)

export default function CrawlCenter({ showToast, theme: extTheme, userId }: { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light"; userId?: string }) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  // 테마는 메인 헤더 토글(부모 prop)을 그대로 따른다 — 크롤링 자체 토글 제거(테리: 토글 공용화).
  // 다크 색상(THEMES.dark 웜 차콜)은 그대로. 다크면 로그 배경·글씨(logBg/logInk)도 함께 바뀜.
  const theme: "dark" | "light" = extTheme === "dark" ? "dark" : "light";
  const C = THEMES[theme];

  const [topic, setTopic] = useState("FOOD");
  const [region, setRegion] = useState("전국");
  const [keyword, setKeyword] = useState("");   // 사용자 추가 검색어(선택)
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
  const [emailSubject, setEmailSubject] = useState("[온종일 체험단] 함께하실 블로거님을 찾았어요");
  const [emailBody, setEmailBody] = useState("{닉네임}님 안녕하세요! 블로그 잘 보고 있어요 😊\n{관심품목} 관련 글을 즐겨 쓰시는 것 같아, 온종일 체험단에 함께하시면 좋을 것 같아 연락드려요.\n관심 있으시면 회신 주세요. 감사합니다!");
  const [commentBody, setCommentBody] = useState("{닉네임}님 글 잘 봤어요! {관심키워드} 관련해 온종일 체험단 함께하실래요? 문의는 프로필 링크로 :)");
  const [sending, setSending] = useState(false);
  // 발신 이메일 계정(등록 여부)
  const [sender, setSender] = useState<any>(null);
  const [senderOpen, setSenderOpen] = useState(false);
  const [sForm, setSForm] = useState({ from_name: "", from_email: "", smtp_host: "smtp.naver.com", smtp_port: "465", smtp_user: "", smtp_pass: "", daily_limit: "50" });
  const [sSaving, setSSaving] = useState(false);
  const loadSender = async () => {
    if (!userId) return;
    try { const r = await fetch(`${BOT}/api/outreach/sender/${userId}`); const d = await r.json(); if (d.ok) setSender(d.sender); } catch {}
  };
  // 보낸글 이력
  const [historyOpen, setHistoryOpen] = useState(false);
  const [outHistory, setOutHistory] = useState<any[]>([]);
  const loadOutHistory = async () => {
    if (!userId) return;
    try { const r = await fetch(`${BOT}/api/outreach/history/${userId}`); const d = await r.json(); if (d.ok) setOutHistory(d.history || []); } catch {}
  };
  const esOutRef = useRef<BotEventStream | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [ships, setShips] = useState<Record<string, ShipState>>({}); // 블로거별 배송 상태
  const setShip = (id: string, patch: Partial<ShipState>) => setShips((s) => ({ ...s, [id]: { ...{ status: "proposed" as ShipStatus }, ...s[id], ...patch } }));
  const timerRef = useRef<any>(null);
  const esRef = useRef<BotEventStream | null>(null);
  const [scanned, setScanned] = useState(0);   // 지금까지 스캔(수집)한 블로거 수 — 실시간 표시

  const pushLog = (m: string) => setLogs((l) => [...l, `${new Date().toLocaleTimeString("ko-KR")}  ${m}`]);

  // 🩺 AI 진정성 점수(0~100): 봇 로직 역이용 — 참여율 대비 이웃수로 "진짜 영향력 vs 품앗이·봇 부풀림" 감별.
  // 이웃만 많고 참여율 낮으면(도배·품앗이 의심) 낮게, 참여율이 이웃 규모 대비 건강하면 높게.
  const calcAuthenticity = (neighbors: number, engageRate: number, postsPerWeek: number): number => {
    if (!neighbors) return 50;
    const expected = Math.max(2, Math.min(14, 900 / Math.sqrt(neighbors)));  // 이웃 많을수록 기대 참여율 자연 감소
    const ratio = engageRate / expected;              // 1 이상이면 건강
    let s = 50 + Math.round(Math.min(45, (ratio - 1) * 45));
    if (postsPerWeek >= 3) s += 6;                    // 꾸준한 활동 가점
    if (postsPerWeek === 0) s -= 15;                  // 휴면 감점
    return Math.max(5, Math.min(99, s));
  };

  const startFind = () => {
    if (running) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setRunning(true); setProgress(0); setLogs([]); setResults([]); setSelected(new Set()); setScanned(0);
    const kwList = [TOPIC_KR[topic] || topic, ...(keyword.trim() ? keyword.split(/[,\s]+/).filter(Boolean) : [])];
    if (region && region !== "전국") kwList[0] = `${region} ${kwList[0]}`;
    pushLog(`🔎 발굴 시작 — "${kwList.join(", ")}" · 목표 ${count}명`);
    pushLog(`필터 — 이웃 ${minNeighbors.toLocaleString()}+ · 주 ${minPosts}글+ ${activeOnly ? "· 최근 활동중만" : ""}`);
    // 실제 네이버 검색 발굴 API(neighbor-bot /api/crawl, SSE) — 목업 아님. thumbnail=프로필 이미지 제공.
    const url = `${BOT}/api/crawl?keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${count}&orderBy=${topicMatch ? "sim" : "recentdate"}&activeDays=${activeOnly ? 30 : 0}&excludeMarket=true${userId ? `&userId=${userId}` : ""}`;
    const es = new BotEventStream(url);
    esRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") { pushLog(d.msg); const m = String(d.msg).match(/(\d+)\s*명/); if (m) { setScanned(Number(m[1])); setProgress(Math.min(95, Number(m[1]))); } }
      else if (d.type === "quota_exceeded") { pushLog("🛑 오늘 발굴 한도를 다 썼어요"); toast("오늘 발굴 한도 초과", "error"); setRunning(false); es.close(); }
      else if (d.type === "crawl_done") {
        const raw: any[] = d.results || [];
        // 실제 발굴 결과 → 카드 매핑. 이웃수/참여율은 네이버 검색 API가 안 주므로 추정치(추후 blog-stats로 정밀화 가능)
        const seen = new Set<string>();
        const mapped: Blogger[] = raw.filter(r => r.blogId && !seen.has(r.blogId) && seen.add(r.blogId)).map((r, i) => {
          const daysAgo = r.addDate ? Math.floor((Date.now() - r.addDate) / 86400000) : null;
          const lastActive = daysAgo == null ? "-" : daysAgo <= 0 ? "오늘" : daysAgo === 1 ? "어제" : `${daysAgo}일 전`;
          const postsPerWeek = daysAgo == null ? 2 : daysAgo <= 2 ? 5 : daysAgo <= 7 ? 3 : daysAgo <= 30 ? 1 : 0;
          const neighbors = 0;   // 정확값은 상세(blog-stats)에서 — 목록에선 미상(0=미확인)
          const engageRate = 0;
          return {
            id: r.blogId, nick: r.nickName || r.blogName || r.blogId, url: `blog.naver.com/${r.blogId}`,
            topic, thumbnail: r.thumbnail || undefined,
            neighbors, postsPerWeek, visitors: 0, score: 0,
            keywords: r.keyword ? [String(r.keyword)] : [], categories: [],
            lastActive, engageRate, authenticity: undefined,
          } as Blogger;
        });
        setResults(mapped);
        setProgress(100); setScanned(mapped.length);
        pushLog(`✅ 발굴 완료 — 실제 블로거 ${mapped.length}명 (프로필 이미지 포함)`);
        toast(`${mapped.length}명 발굴 완료`, "success");
        setRunning(false); es.close(); esRef.current = null;
        if (mapped.length) analyzeAuthenticity(mapped);   // 🩺 발굴 직후 진정성 자동 분석(실제 이웃·방문자)
      }
      else if (d.type === "error") { pushLog(`❌ 발굴 실패: ${d.msg}`); toast(`발굴 실패: ${d.msg}`, "error"); setRunning(false); es.close(); esRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류 — 서버가 켜져 있는지 확인해주세요"); toast("봇 연결 오류", "error"); setRunning(false); es.close(); esRef.current = null; };
  };
  const stopFind = () => { if (esRef.current) { esRef.current.close(); esRef.current = null; } if (timerRef.current) clearInterval(timerRef.current); setRunning(false); pushLog("⏹ 사용자가 중단했어요"); };

  useEffect(() => { loadSender(); /* eslint-disable-next-line */ }, [userId]);

  // 🩺 진정성 정밀 분석 — 발굴된 블로거들의 실제 이웃수·방문자를 공개 API로 읽어 진정성 점수 채움(세션 불필요)
  const [analyzing, setAnalyzing] = useState(false);
  const esAuthRef = useRef<BotEventStream | null>(null);
  const analyzeAuthenticity = (list?: Blogger[]) => {
    const src = list || results;
    const ids = src.map(b => b.id).filter(Boolean);
    if (!ids.length) return;
    setAnalyzing(true); pushLog(`🩺 진정성 분석 시작 — ${ids.length}명 (공개 이웃·방문자)`);
    const es = new BotEventStream(`${BOT}/api/outreach/authenticity?blogIds=${encodeURIComponent(JSON.stringify(ids))}`);
    esAuthRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "auth") {
        setResults(prev => prev.map(b => b.id === d.blogId ? { ...b, neighbors: d.neighbors || b.neighbors, visitors: d.visitors || b.visitors, authenticity: d.authenticity ?? b.authenticity, score: d.authenticity ?? b.score } : b));
      } else if (d.type === "done") { pushLog(`✅ 진정성 분석 완료`); setAnalyzing(false); es.close(); esAuthRef.current = null; }
      else if (d.type === "error") { pushLog(`❌ 진정성 분석 실패: ${d.msg}`); setAnalyzing(false); es.close(); esAuthRef.current = null; }
    };
    es.onerror = () => { setAnalyzing(false); es.close(); esAuthRef.current = null; };
  };

  // 📧 이메일 실발송(SSE) — 발신계정 필요. 블로그 창 안 열고 SMTP로 바로. 개인화 토큰은 봇에서 치환.
  const sendEmails = () => {
    if (!userId) { toast("로그인 정보가 없어요", "error"); return; }
    if (!sender) { toast("먼저 발신 이메일 계정을 등록하세요", "info"); setSenderOpen(true); return; }
    const picks = shown.filter(b => selected.has(b.id) && b.email);
    if (!picks.length) { toast("선택한 블로거 중 공개 이메일이 있는 사람이 없어요", "info"); return; }
    setSending(true); pushLog(`📧 이메일 발송 시작 — ${picks.length}명`);
    const targets = picks.map(b => ({ id: b.id, nick: b.nick, email: b.email, keywords: b.keywords, categories: b.categories }));
    const url = `${BOT}/api/outreach/send-email?userId=${encodeURIComponent(userId)}&subject=${encodeURIComponent(emailSubject)}&message=${encodeURIComponent(emailBody)}&targets=${encodeURIComponent(JSON.stringify(targets))}`;
    const es = new BotEventStream(url); esOutRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "sent") { setShips(s => ({ ...s, [d.id]: s[d.id] || { status: "proposed" as ShipStatus } })); }   // 보낸 사람=제안함
      else if (d.type === "done") { pushLog(`✅ 발송 완료 — 성공 ${d.ok} · 실패 ${d.fail}`); toast(`이메일 ${d.ok}명 발송 완료`, "success"); setSending(false); setOutreach(null); es.close(); esOutRef.current = null; loadOutHistory(); }
      else if (d.type === "error") { pushLog(`❌ ${d.msg}`); toast(d.msg, "error"); setSending(false); es.close(); esOutRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류"); toast("봇 연결 오류", "error"); setSending(false); es.close(); esOutRef.current = null; };
  };

  // 발신 계정 저장(SMTP 검증 후)
  const saveSender = async () => {
    if (!userId) return;
    if (!sForm.from_email || !sForm.smtp_user || !sForm.smtp_pass) { toast("발신 이메일·아이디·비밀번호를 채워주세요", "info"); return; }
    setSSaving(true);
    try {
      const r = await fetch(`${BOT}/api/outreach/sender`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, ...sForm }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "저장 실패");
      toast("✅ 발신 계정을 등록했어요 (연결 확인됨)", "success");
      setSenderOpen(false); await loadSender();
    } catch (e: any) { toast(e.message, "error"); }
    setSSaving(false);
  };

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
          {/* 테마 토글 제거 — 메인 헤더 토글이 공용(테리 지시). 크롤링은 메인 테마를 따라감 */}
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", color: C.sub, border: `1px solid ${C.line2}`, padding: "6px 11px", borderRadius: 2, whiteSpace: "nowrap" }}>⚖ 공개 정보만</span>
          <img src={CH.monggeul} onError={chErr("🧭")} className="ob-bob" style={{ width: 62, height: 62, objectFit: "contain", filter: "saturate(.9) drop-shadow(0 8px 14px rgba(0,0,0,.2))" }} />
        </div>
      </div>

      {/* ── 지표 ── */}
      <div className="ob-sec" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", marginBottom: 22, border: `1px solid ${C.line}`, background: C.surf, borderRadius: 4 }}>
        {[
          { lab: "Found", val: results.length, unit: "명" },
          { lab: "Proposed", val: Object.keys(ships).length, unit: "명" },
          { lab: "With Contact", val: results.filter((b) => b.email || b.kakao).length, unit: "명" },
          { lab: "Scanned", val: scanned, unit: "명" },
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
          <div><div style={label}>Keyword</div><input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="예: 감성카페, 아이랑 갈만한곳" style={inp} /></div>
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
          <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}><div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600 }}>Collect — 무엇을 모을까요</div><img src={CH.dodo} onError={chErr("✅")} style={{ width: 30, height: 30, marginLeft: "auto", filter: "saturate(.9)" }} /></div>
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
              <span onClick={() => { loadOutHistory(); setHistoryOpen(true); }} style={sChip(false)}>📮 보낸 글 이력</span>
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
                    {/* 프로필 이미지(네이버 검색 API 제공) — 실패 시 등급 문자로 폴백 */}
                    {b.thumbnail
                      ? <img src={b.thumbnail} alt={b.nick} referrerPolicy="no-referrer" onError={e => { const d = document.createElement("div"); d.textContent = gr; d.style.cssText = `font-family:${serif};font-size:20px;font-weight:600;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${C.surf2};color:${C.sub};flex-shrink:0`; e.currentTarget.replaceWith(d); }} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: `1px solid ${C.line2}` }} />
                      : <div style={{ width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: C.surf2, fontFamily: serif, fontSize: 20, fontWeight: 600, color: on ? C.accent : C.sub, flexShrink: 0 }}>{gr}</div>}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.nick}</div>
                      <div style={{ fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.url}</div>
                    </div>
                    <div style={{ width: 18, height: 18, borderRadius: 2, border: `1px solid ${on ? C.accent : C.line2}`, background: on ? C.accent : "transparent", color: C.surf, fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on ? "✓" : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 11, color: C.sub, fontWeight: 700, flexWrap: "wrap", alignItems: "center" }}>
                    <span>🕒 {b.lastActive}</span>
                    {b.neighbors > 0 && <span>이웃 {b.neighbors.toLocaleString()}</span>}
                    {/* 🩺 진정성 점수: 상세에서 이웃·참여율 정밀 분석 후 채워짐. 색상=신뢰도(초록=진짜/주황=주의/빨강=의심) */}
                    {b.authenticity != null
                      ? <span title="AI 진정성 점수 — 참여율 대비 이웃수로 가짜·품앗이 감별(높을수록 진짜 영향력)" style={{ fontWeight: 800, color: b.authenticity >= 70 ? "#2f9e5e" : b.authenticity >= 45 ? "#d98a1f" : "#d64545", background: b.authenticity >= 70 ? "rgba(47,158,94,.12)" : b.authenticity >= 45 ? "rgba(217,138,31,.12)" : "rgba(214,69,69,.12)", padding: "2px 8px", borderRadius: 20 }}>🩺 진정성 {b.authenticity}</span>
                      : <span style={{ color: C.sub, fontWeight: 600, fontStyle: "italic" }}>상세로 진정성 분석</span>}
                  </div>
                  {/* 관심 키워드 미리보기 */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                    {b.keywords.slice(0, 3).map((k) => <span key={k} style={{ fontSize: 10, fontWeight: 700, color: C.sub, background: C.surf2, padding: "2px 6px", borderRadius: 2 }}>#{k}</span>)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {b.email && <span style={{ fontSize: 10, fontWeight: 700, color: C.ink, border: `1px solid ${C.line2}`, padding: "2px 7px", borderRadius: 2 }}>이메일</span>}
                    {b.kakao && <span style={{ fontSize: 10, fontWeight: 700, color: C.ink, border: `1px solid ${C.line2}`, padding: "2px 7px", borderRadius: 2 }}>카톡</span>}
                    {!b.email && !b.kakao && !b.openchat && <span style={{ fontSize: 10, color: C.sub }}>공개 연락처 없음</span>}
                    {/* 배송 진행 배지: 제안함(회신대기)=중립 회색, 수락 이상=강조, 배송완료=초록 */}
                    {ships[b.id] && <span title={SHIP_DESC[ships[b.id].status]} style={{ fontSize: 10, fontWeight: 800, color: ships[b.id].status === "proposed" ? C.sub : C.surf, background: ships[b.id].status === "proposed" ? C.surf2 : ships[b.id].status === "delivered" ? "#2f9e5e" : C.accent, border: ships[b.id].status === "proposed" ? `1px solid ${C.line2}` : "none", padding: "2px 7px", borderRadius: 2 }}>📦 {SHIP_LABEL[ships[b.id].status]}</span>}
                    {/* ★ 운영자 수동 수락: 블로거가 "하겠다"고 회신했을 때만 누름. 발송했다고 자동 수락 아님 */}
                    {ships[b.id]?.status === "proposed" && <button onClick={() => { setShip(b.id, { status: "accepted" }); toast(`${b.nick}님을 '수락'으로 확정했어요 — 이제 배송 준비 단계예요`, "success"); }} title="블로거가 이메일·댓글로 '하겠다'고 회신하면 이 버튼을 눌러 수락 처리하세요. 그래야 배송 단계로 넘어가요." style={{ ...btnGhost, padding: "3px 9px", fontSize: 10.5, fontWeight: 800, color: "#2f9e5e", borderColor: "#2f9e5e" }}>✅ 수락 처리</button>}
                    <button onClick={() => setDetail(b)} style={{ marginLeft: "auto", ...btnGhost, padding: "4px 9px", fontSize: 10.5 }}>상세 →</button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* 아웃리치 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
            <img src={CH.bori} onError={chErr("🌱")} className="ob-bob" style={{ width: 44, height: 44, filter: "saturate(.9)" }} />
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
          <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>Advanced <img src={CH.pumi} onError={chErr("💬")} style={{ width: 26, height: 26, filter: "saturate(.9)" }} /></span>
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
      {detail && createPortal((
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 480, width: "100%", maxHeight: "86vh", overflowY: "auto", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "22px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "flex-start", gap: 12 }}>
              {detail.thumbnail
                ? <img src={detail.thumbnail} alt={detail.nick} referrerPolicy="no-referrer" onError={e => { const d = document.createElement("div"); d.textContent = "B"; d.style.cssText = `font-family:${serif};font-size:24px;font-weight:600;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${C.surf2};color:${C.sub}`; e.currentTarget.replaceWith(d); }} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", border: `1px solid ${C.line2}` }} />
                : <div style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: C.surf2, fontFamily: serif, fontSize: 24, fontWeight: 600, color: C.accent }}>B</div>}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{detail.nick}</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>{detail.url}</div>
              </div>
              <button onClick={() => setDetail(null)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px" }}>
              {/* 지표 그리드 — 이웃/방문자/참여율은 남의 블로그라 로그인 세션 없이 못 읽음 → 미확인 정직 표시 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, border: `1px solid ${C.line}`, marginBottom: 14 }}>
                {[["이웃 수", detail.neighbors > 0 ? detail.neighbors.toLocaleString() : "—"], ["최근 활동", detail.lastActive], ["관심 키워드", (detail.keywords[0] || "—")]].map(([l, v], i) => (
                  <div key={i} style={{ padding: "12px 14px", borderLeft: i % 3 ? `1px solid ${C.line}` : "none" }}>
                    <div style={{ ...label, marginBottom: 5 }}>{l}</div>
                    <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
                  </div>
                ))}
              </div>
              {/* 실제 블로그 방문(공개 정보 직접 확인) */}
              <a href={`https://${detail.url}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", padding: "10px", marginBottom: 20, borderRadius: 4, border: `1px solid ${C.accent}`, color: C.accent, fontSize: 13, fontWeight: 800, textDecoration: "none" }}>🔗 블로그 열어서 직접 확인하기 →</a>
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
      ), document.body)}

      {/* ═══ 아웃리치 모달 (이메일 / 댓글) ═══ */}
      {outreach && createPortal((
        <div onClick={() => setOutreach(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 520, width: "100%", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
              <img src={CH.bori} onError={chErr("🌱")} style={{ width: 40, height: 40 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>{outreach === "email" ? "이메일 제안 보내기" : "블로그 댓글 제안"}</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>{selected.size}명 대상 · {outreach === "email" ? "공개 이메일로 발송" : "각 블로그에 정중한 댓글"}</div>
              </div>
              <button onClick={() => setOutreach(null)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px" }}>
              {/* 이메일: 발신계정 상태 배너 */}
              {outreach === "email" && (
                <div style={{ marginBottom: 14, padding: "10px 13px", borderRadius: 4, background: sender ? "rgba(47,158,94,.08)" : "rgba(217,138,31,.1)", border: `1px solid ${sender ? "rgba(47,158,94,.3)" : "rgba(217,138,31,.35)"}`, display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 600 }}>
                  {sender ? <><span style={{ color: "#2f9e5e" }}>✅ 발신 계정: <b>{sender.from_email}</b></span><button onClick={() => { setSForm(f => ({ ...f, from_email: sender.from_email, from_name: sender.from_name || "", smtp_user: sender.smtp_user, smtp_host: sender.smtp_host, smtp_port: String(sender.smtp_port), daily_limit: String(sender.daily_limit) })); setSenderOpen(true); }} style={{ ...btnGhost, marginLeft: "auto", padding: "3px 8px", fontSize: 10.5 }}>변경</button></>
                    : <><span style={{ color: "#d98a1f" }}>⚠️ 발신 이메일 계정이 없어요 — 등록해야 발송돼요</span><button onClick={() => setSenderOpen(true)} style={{ ...btnSolid, marginLeft: "auto", padding: "4px 10px", fontSize: 10.5 }}>+ 발신계정 등록</button></>}
                </div>
              )}
              {outreach === "email" && <div style={{ marginBottom: 14 }}><div style={label}>제목</div><input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} style={inp} /></div>}
              <div style={{ marginBottom: 14 }}>
                <div style={label}>메시지 (개인화 변수 사용 가능)</div>
                <textarea rows={outreach === "email" ? 7 : 4}
                  value={outreach === "email" ? emailBody : commentBody}
                  onChange={e => outreach === "email" ? setEmailBody(e.target.value) : setCommentBody(e.target.value)}
                  style={{ ...inp, resize: "vertical", lineHeight: 1.7 }} />
              </div>
              <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, background: C.surf2, border: `1px solid ${C.line}`, borderRadius: 3, padding: "10px 13px", lineHeight: 1.6, marginBottom: 18 }}>
                💡 <b>{"{닉네임}"}·{"{관심키워드}"}·{"{관심품목}"}</b>는 블로거마다 자동으로 채워져요. {outreach === "comment" ? "댓글은 계정 연결이 필요해요(서이추·공감댓글처럼)." : `발송은 공개된 이메일 주소로만 나가요. 계정 안전을 위해 하루 ${sender?.daily_limit || 50}통까지, 3~6초 간격으로 보내요.`}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setOutreach(null)} disabled={sending} style={{ ...btnGhost, flex: 1 }}>취소</button>
                {outreach === "email"
                  ? <button onClick={sendEmails} disabled={sending} style={{ ...btnSolid, flex: 2, opacity: sending ? .6 : 1 }}>{sending ? "발송 중..." : `${shown.filter(b => selected.has(b.id) && b.email).length}명에게 실제 발송 →`}</button>
                  : <button onClick={() => { const now: Record<string, ShipState> = {}; selected.forEach((id) => { now[id] = ships[id] || { status: "proposed" as ShipStatus }; }); setShips((s) => ({ ...s, ...now })); toast("댓글 제안 대상으로 담았어요 — 댓글 실발송은 계정 연결 후 지원돼요", "info"); setOutreach(null); }} style={{ ...btnSolid, flex: 2 }}>{selected.size}명 담기 →</button>}
              </div>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ═══ 발신 이메일 계정 등록 모달 ═══ */}
      {senderOpen && createPortal((
        <div onClick={() => setSenderOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 480, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>발신 이메일 계정 등록</div>
              <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3, lineHeight: 1.55 }}>이 계정으로 블로거에게 제안 메일이 나가요. <b>네이버 메일은 '앱 비밀번호'</b>가 필요해요(네이버 메일 설정 → POP3/SMTP → 앱 비밀번호 생성).</div>
            </div>
            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { k: "from_name", l: "보내는 사람 이름 (선택)", ph: "온종일 체험단" },
                { k: "from_email", l: "발신 이메일 주소 *", ph: "myid@naver.com" },
                { k: "smtp_user", l: "SMTP 아이디 * (보통 이메일 앞부분 or 전체)", ph: "myid" },
                { k: "smtp_pass", l: "앱 비밀번호 *", ph: "네이버 메일 앱 비밀번호", pw: true },
              ].map(f => (
                <div key={f.k}>
                  <div style={label}>{f.l}</div>
                  <input type={(f as any).pw ? "password" : "text"} value={(sForm as any)[f.k]} onChange={e => setSForm(s => ({ ...s, [f.k]: e.target.value }))} placeholder={f.ph} style={inp} />
                </div>
              ))}
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 2 }}><div style={label}>SMTP 서버</div><input value={sForm.smtp_host} onChange={e => setSForm(s => ({ ...s, smtp_host: e.target.value }))} style={inp} /></div>
                <div style={{ flex: 1 }}><div style={label}>포트</div><input value={sForm.smtp_port} onChange={e => setSForm(s => ({ ...s, smtp_port: e.target.value }))} style={inp} /></div>
                <div style={{ flex: 1 }}><div style={label}>하루 한도</div><input value={sForm.daily_limit} onChange={e => setSForm(s => ({ ...s, daily_limit: e.target.value }))} style={inp} /></div>
              </div>
              <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.55, background: C.surf2, borderRadius: 3, padding: "9px 12px" }}>네이버=smtp.naver.com:465 · 구글=smtp.gmail.com:465. 저장 시 실제 로그인 연결을 확인해요(틀리면 저장 안 됨).</div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button onClick={() => setSenderOpen(false)} disabled={sSaving} style={{ ...btnGhost, flex: 1 }}>취소</button>
                <button onClick={saveSender} disabled={sSaving} style={{ ...btnSolid, flex: 2, opacity: sSaving ? .6 : 1 }}>{sSaving ? "연결 확인 중..." : "연결 확인 후 저장"}</button>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ═══ 보낸 글 이력 모달 (CRM) ═══ */}
      {historyOpen && createPortal((
        <div onClick={() => setHistoryOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 620, width: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>보낸 글 이력</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>누구에게 언제 무엇을 보냈는지 · 총 {outHistory.length}건</div>
              </div>
              <button onClick={() => setHistoryOpen(false)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div className="ob-scroll" style={{ padding: "12px 20px", overflowY: "auto", flex: 1 }}>
              {outHistory.length === 0 ? <div style={{ textAlign: "center", padding: "40px 20px", color: C.sub, fontSize: 13 }}>아직 보낸 글이 없어요.<br />블로거를 선택해 이메일을 보내면 여기에 기록돼요.</div>
                : outHistory.map((h, i) => (
                  <div key={i} style={{ padding: "11px 0", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14 }}>{h.channel === "email" ? "✉️" : "💬"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.nickname || h.blog_id} {h.to_email && <span style={{ color: C.sub, fontWeight: 400 }}>· {h.to_email}</span>}</div>
                      <div style={{ fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.subject || h.message?.slice(0, 40)}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: h.status === "failed" ? "#d64545" : h.status === "sent" ? "#2f9e5e" : C.accent }}>{h.status === "sent" ? "발송됨" : h.status === "failed" ? "실패" : h.status}</div>
                      <div style={{ fontSize: 9.5, color: C.sub }}>{new Date(h.sent_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ═══ 배송 관리 모달 (체험단 제품 발송) ═══ */}
      {shipOpen && createPortal((
        <div onClick={() => setShipOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line2}`, borderRadius: 6, maxWidth: 680, width: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10 }}>
              <img src={CH.dodo} onError={chErr("✅")} style={{ width: 40, height: 40 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600 }}>배송 관리</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>제안 수락한 블로거에게 체험단 제품을 보내고 송장을 관리해요</div>
              </div>
              <button onClick={() => setShipOpen(false)} style={{ ...btnGhost, padding: "5px 10px" }}>✕</button>
            </div>
            <div className="ob-scroll" style={{ padding: "16px 24px", overflowY: "auto", flex: 1 }}>
              {/* 배송 단계 요약 (제안함 → 수락 → 발송대기 → 배송중 → 배송완료) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", border: `1px solid ${C.line}`, marginBottom: 8 }}>
                {(["proposed", "accepted", "ready", "shipped", "delivered"] as ShipStatus[]).map((st, i) => (
                  <div key={st} title={SHIP_DESC[st]} style={{ padding: "10px 8px", textAlign: "center", borderLeft: i ? `1px solid ${C.line}` : "none" }}>
                    <div style={{ fontFamily: serif, fontSize: 20, fontWeight: 600 }}>{Object.values(ships).filter((s) => s.status === st).length}</div>
                    <div style={{ ...label, marginBottom: 0, fontSize: 9.5 }}>{SHIP_LABEL[st]}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.sub, marginBottom: 18, lineHeight: 1.5 }}>💡 <b>제안함</b>=연락은 했고 블로거의 OK 회신을 기다리는 중이에요. 블로거가 하겠다고 하면 아래에서 <b style={{ color: "#2f9e5e" }}>수락</b>으로 바꿔주세요. 그 다음 제품을 보내며 <b>발송대기 → 배송중 → 배송완료</b> 순으로 넘기면 돼요.</div>
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
                          <select value={sh.status} onChange={(e) => setShip(id, { status: e.target.value as ShipStatus })} title={SHIP_DESC[sh.status]} style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: 12 }}>
                            {(["proposed", "accepted", "ready", "shipped", "delivered"] as ShipStatus[]).map((st) => <option key={st} value={st}>{SHIP_LABEL[st]}</option>)}
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
      ), document.body)}

      {/* ═══ 로그 크게 보기 모달 (전체화면 확대) ═══ */}
      {logExpand && createPortal((
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
      ), document.body)}
    </div>
  );
}
