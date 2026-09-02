import { useState, useRef, useEffect } from "react";
import { BotEventStream, botFetch } from "../lib/botApi";
import UsageGuide from "./UsageGuide";
import SproutAssistant from "./SproutAssistant";
import { INFLOW_DAILY_LIMIT, PLAN_CONFIG, getInflowDailyUsage, getInflowUsageHistory, getAccounts, PublyAccount, getAutopilot, saveAutopilot, getRankHistory, AutopilotConfig, getInflowSchedule, saveInflowSchedule, inflowScheduleRanToday, markInflowScheduleRan, getPerfReport, PerfReport, recordRankPoint, getMemberSessionToken } from "../lib/supabase";

const BOT = "http://127.0.0.1:3334"; // neighbor-bot

/* ═══════════════════════════════════════════════════════════════
   🆕 NEW 트래픽 유입 — CONTROL TOWER
   키워드 검색 → 클릭 → 글 전체 읽는 체류 → 저장/공감/공유/길찾기/전화/예약/톡톡 → 이탈
   방문마다 프록시 IP 자동 로테이션 · 안전 한도 안에서만. 회원=관리자 동일.
   관제탑형 대시보드: KPI 지표 + 7일 유입 그래프 + 실행패널 + 라이브 로그.
   ═══════════════════════════════════════════════════════════════ */

const THEMES = {
  light: { bg: "#eef2f8", panel: "#ffffff", panel2: "#f5f8fc", ink: "#111a28", sub: "#647084", line: "#e3e9f2", line2: "#d2dbe8", accent: "#2563eb", cyan: "#0891b2", glow: "rgba(37,99,235,.14)", kpiBg: "linear-gradient(135deg,#ffffff,#f2f6fc)", logBg: "#0d1420", logInk: "#c7d6ea" },
  dark: { bg: "#080c14", panel: "#111927", panel2: "#18212f", ink: "#eaf1fb", sub: "#8fa3bd", line: "#26313f", line2: "#33404f", accent: "#4f9bff", cyan: "#22d3ee", glow: "rgba(79,155,255,.20)", kpiBg: "linear-gradient(135deg,#141d2c,#0f1826)", logBg: "#05090f", logInk: "#a9bfd8" },
};

const PLAN_ORDER = ["free", "basic", "pro"] as const; // ⚖️ 무제한은 관리자 고유 — 표엔 안 넣음

// 블로그 글 주소 → { blogId, logNo } 자동 인식.
function parseBlogUrl(input: string): { blogId: string; logNo: string } | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (/blogId=/i.test(s)) { const b = s.match(/blogId=([A-Za-z0-9_-]+)/i)?.[1]; const l = s.match(/logNo=(\d+)/i)?.[1]; if (b) return { blogId: b, logNo: l || "" }; }
  const m = s.match(/blog\.naver\.com\/([A-Za-z0-9_-]+)(?:\/(\d+))?/i);
  if (m) return { blogId: m[1], logNo: m[2] || "" };
  const plain = s.match(/^([A-Za-z0-9_-]+)(?:\/(\d+))?$/);
  if (plain) return { blogId: plain[1], logNo: plain[2] || "" };
  return null;
}

// 플레이스 주소에서 가게 번호(placeId) 추출 — 인식 확인 배지용. 단축주소(naver.me)는 서버가 펼치므로 여기선 "확인예정".
function extractPlaceId(input: string): string | null {
  const s = String(input || "");
  const m = s.match(/(?:pcmap\.place|m\.place|place)\.naver\.com\/[a-z]+\/(\d{5,})/i)
    || s.match(/entry\/place\/(\d{5,})/i)
    || s.match(/\/place\/(\d{5,})/i)
    || s.match(/[?&]placeId=(\d{5,})/i)
    || s.match(/^\s*(\d{6,})\s*$/);
  return m ? m[1] : null;
}
const isShortUrl = (s: string) => /naver\.me\/|me2\.do\//i.test(String(s || ""));

// 🔎 주소만 보고 플레이스/블로그 자동 감지(탭 안 바꿔도 되게)
function detectTargetType(input: string): "place" | "blog" | null {
  const s = (input || "").toLowerCase();
  if (/place\.naver|map\.naver|naver\.me|pcmap|entry\/place/.test(s)) return "place";
  if (/blog\.naver|blogid=|\/postview/.test(s)) return "blog";
  return null;
}

// 📈 7일 유입 추이 — 부드러운 area 라인 SVG(라이브러리 없이)
function AreaChart({ data, C }: { data: { label: string; count: number }[]; C: any }) {
  const W = 100, H = 44, pad = 3;
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const step = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const pts = data.map((d, i) => [pad + i * step, H - pad - (d.count / max) * (H - pad * 2)]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${(pad + (n - 1) * step).toFixed(1)},${H - pad}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 120, display: "block" }}>
      <defs>
        <linearGradient id="inflowArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#inflowArea)" />
      <polyline points={line} fill="none" stroke={C.accent} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="1.1" fill={C.cyan} />)}
    </svg>
  );
}

// 📉 순위 변동 그래프 — 위로 갈수록 상위(순위는 작을수록 좋음, y축 반전). 결측(null)은 이어붙임.
function RankChart({ data, goal, C }: { data: { label: string; rank: number | null }[]; goal: number; C: any }) {
  const W = 100, H = 44, pad = 4;
  const vals = data.map((d) => d.rank).filter((r): r is number => r != null);
  if (vals.length === 0) return <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 12.5, fontWeight: 600 }}>순위가 측정되면 그래프가 그려져요</div>;
  const maxR = Math.max(goal + 2, ...vals), minR = Math.min(1, ...vals);
  const n = data.length, step = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const y = (r: number) => pad + ((r - minR) / Math.max(1, maxR - minR)) * (H - pad * 2); // 순위 클수록 아래
  const pts = data.map((d, i) => d.rank == null ? null : [pad + i * step, y(d.rank)] as [number, number]).filter(Boolean) as [number, number][];
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const goalY = y(goal);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 120, display: "block" }}>
      <line x1="0" y1={goalY} x2={W} y2={goalY} stroke={C.cyan} strokeWidth="0.6" strokeDasharray="2 2" opacity="0.7" />
      <polyline points={line} fill="none" stroke="#16a34a" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="1.3" fill="#16a34a" />)}
    </svg>
  );
}

export default function InflowCenter({ showToast, theme: extTheme, userId, plan = "free" }: { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light"; userId?: string; plan?: string }) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  const theme: "dark" | "light" = extTheme === "dark" ? "dark" : "light";
  const C = THEMES[theme];
  const unlimited = plan === "admin" || plan === "unlimited";
  const limit = INFLOW_DAILY_LIMIT[plan] ?? INFLOW_DAILY_LIMIT.free;

  // 🔁 탭을 옮겨도·앱을 껐다 켜도 입력값이 유지되게 — 고정 키(userId 무관, 로그인 로딩중 초기화 방지)
  const formKey = "publy_inflow_form";
  const saved0: any = (() => { try { return JSON.parse(localStorage.getItem("publy_inflow_form") || "{}"); } catch { return {}; } })();
  const [targetType, setTargetType] = useState<"place" | "blog">(saved0.targetType ?? "place");
  const privateKey = `publy_inflow_private_${userId || "guest"}`;
  const private0: any = (() => { try { return JSON.parse(localStorage.getItem(privateKey) || "{}"); } catch { return {}; } })();
  const [placeUrl, setPlaceUrl] = useState<string>(private0.placeUrl ?? saved0.placeUrl ?? "");
  const [blogUrl, setBlogUrl] = useState<string>(private0.blogUrl ?? saved0.blogUrl ?? "");
  const [keywords, setKeywords] = useState<string>(saved0.keywords ?? "");
  const [rounds, setRounds] = useState<number>(saved0.rounds ?? 10);
  const [termMin, setTermMin] = useState<number>(saved0.termMin ?? 30);
  const [termMax, setTermMax] = useState<number>(saved0.termMax ?? 90);
  const [device, setDevice] = useState<"mobile" | "pc" | "mix">(saved0.device ?? "mobile");
  // 액션
  const [doSave, setDoSave] = useState(saved0.doSave ?? true);
  const [doShare, setDoShare] = useState(saved0.doShare ?? false);
  const [doDir, setDoDir] = useState(saved0.doDir ?? true);
  const [doCall, setDoCall] = useState(saved0.doCall ?? false);
  const [doBook, setDoBook] = useState(saved0.doBook ?? false);
  const [doTalk, setDoTalk] = useState(saved0.doTalk ?? false);
  const [doLike, setDoLike] = useState(saved0.doLike ?? true);
  const [funnel, setFunnel] = useState(saved0.funnel ?? false);
  const [spread, setSpread] = useState(saved0.spread ?? false);   // ⏱️ 시간 분산
  const [spreadHours, setSpreadHours] = useState<number>(saved0.spreadHours ?? 3);
  const [doReview, setDoReview] = useState<boolean>(saved0.doReview ?? false); // ✍️ 리뷰(관리자 락)
  const [reviewText, setReviewText] = useState<string>(saved0.reviewText ?? "");
  const [auto, setAuto] = useState(saved0.auto ?? false);
  const [actionRate, setActionRate] = useState<number>(saved0.actionRate ?? 100); // 🎲 액션 발동 확률(%)
  const [intensity, setIntensity] = useState<"fast" | "normal" | "deep">(saved0.intensity ?? "normal"); // 📖 체류 강도
  const [maxDwellSec, setMaxDwellSec] = useState<number>(saved0.maxDwellSec ?? 90); // 0=본문 분량에 따라 자동
  const [extraTargets, setExtraTargets] = useState<string[]>(private0.extraTargets ?? saved0.extraTargets ?? []); // ➕ 추가 대상(주소 목록)
  // 🏪 내 플레이스/블로그 저장 목록(이름+주소) — 여러 개 저장해두고 골라 쓰기
  type SavedTarget = { id: string; name: string; url: string; type: "place" | "blog" };
  const savedTargetsKey = `publy_inflow_saved_targets_${userId || "guest"}`;
  const [savedTargets, setSavedTargets] = useState<SavedTarget[]>(() => { try { return JSON.parse(localStorage.getItem(savedTargetsKey) || localStorage.getItem("publy_inflow_saved_targets") || "[]"); } catch { return []; } });
  const [savingName, setSavingName] = useState("");
  const persistSavedTargets = (list: SavedTarget[]) => { setSavedTargets(list); try { localStorage.setItem(savedTargetsKey, JSON.stringify(list)); } catch {} };
  const [advOpen, setAdvOpen] = useState(false);       // ⚙️ 고급 설정 펼침
  const [kwWeights, setKwWeights] = useState<Record<string, number>>(saved0.kwWeights ?? {}); // 키워드별 비중
  const [visible, setVisible] = useState(false); // 🪟 창 보기(테스트) — 저장 안 함(안전상 매번 꺼짐)
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [running, setRunning] = useState(false);
  type InflowLogEntry = { type: "text"; text: string } | { type: "shot"; caption: string; dataUrl: string };
  const [logs, setLogs] = useState<InflowLogEntry[]>([]);
  const [used, setUsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [sessOk, setSessOk] = useState(0); // 이번 실행 성공 수
  const [history, setHistory] = useState<{ label: string; count: number }[]>([]);
  // 🎯 오토파일럿
  const [apEnabled, setApEnabled] = useState(false);
  const [apGoal, setApGoal] = useState(5);
  const [apKeyword, setApKeyword] = useState("");
  const [apLastRank, setApLastRank] = useState<number | null>(null);
  const [rankHist, setRankHist] = useState<{ label: string; rank: number | null }[]>([]);
  // 📊 성과 리포트(주간/월간)
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [report, setReport] = useState<PerfReport | null>(null);
  // 🩺 플레이스 최적화 진단
  const [diagLoading, setDiagLoading] = useState(false);
  const [diag, setDiag] = useState<{ score: number; items: { key: string; label: string; ok: boolean; value: string; tip: string }[] } | null>(null);
  // 🥊 경쟁사 추적
  const [compLoading, setCompLoading] = useState(false);
  const [comp, setComp] = useState<{ top: { rank: number; name: string; category: string; review: number; blog: number; isMine: boolean }[]; myRank: number | null } | null>(null);
  // 🔎 키워드 발굴
  const [kwLoading, setKwLoading] = useState(false);
  const [kwSuggest, setKwSuggest] = useState<string[]>([]);
  // 💬 리뷰 감정분석
  const [revLoading, setRevLoading] = useState(false);
  const [revResult, setRevResult] = useState<{ total: number; likes: { word: string; n: number }[]; dislikes: { word: string; n: number }[] } | null>(null);
  // ⏰ 예약 실행
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedTime, setSchedTime] = useState("10:00");
  const [schedRounds, setSchedRounds] = useState(10);
  type InflowNotification = { id: string; message: string; createdAt: string };
  const notificationKey = `publy_inflow_notifications_${userId || "guest"}`;
  const [notifications, setNotifications] = useState<InflowNotification[]>(() => {
    try { return JSON.parse(localStorage.getItem(`publy_inflow_notifications_${userId || "guest"}`) || "[]"); }
    catch { return []; }
  });
  const automationRunningRef = useRef(false);
  const scheduledRunPendingRef = useRef(false);
  const skipPrivateSaveRef = useRef(false);
  const esRef = useRef<BotEventStream | null>(null);
  const startRef = useRef<() => void>(() => {});
  // 🎯 오토파일럿 자동 순위 체크(목표 달성 여부) — 최신 값 참조용 ref
  const autopilotCheckRef = useRef<() => Promise<boolean>>(async () => false);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const appendLog = (entry: InflowLogEntry) => setLogs((current) => {
    let next = [...current, entry].slice(-300);
    const shots = next.reduce((count, item) => count + (item.type === "shot" ? 1 : 0), 0);
    if (shots > 8) { const firstShot = next.findIndex((item) => item.type === "shot"); if (firstShot >= 0) next = next.filter((_, index) => index !== firstShot); }
    return next;
  });
  const pushLog = (m: string) => appendLog({ type: "text", text: m });
  const pushShot = (caption: string, dataUrl: string) => appendLog({ type: "shot", caption, dataUrl });
  const refreshStats = () => {
    if (!userId) return;
    getInflowDailyUsage(userId).then(setUsed).catch(() => {});
    getInflowUsageHistory(userId, 7).then(setHistory).catch(() => {});
    getRankHistory(userId, 7).then(setRankHist).catch(() => {});
    getPerfReport(userId, reportPeriod).then(setReport).catch(() => {});
  };
  useEffect(() => {
    refreshStats();
    if (!userId) return;
    getAccounts(userId).then((a) => setAccounts(a.filter((x) => x.platform === "naver"))).catch(() => {});
    getAutopilot(userId).then((ap) => { if (ap) { setApEnabled(ap.enabled); setApGoal(ap.goal_rank); setApKeyword(ap.keyword || ""); setApLastRank(ap.last_rank ?? null); } }).catch(() => {});
    getInflowSchedule(userId).then((s) => { if (s) { setSchedEnabled(s.enabled); setSchedTime(s.time); setSchedRounds(s.rounds); } }).catch(() => {});
  }, [userId]);
  // 로그인 사용자별 민감한 주소를 격리하고, 기존 고정 키 데이터는 최초 1회 안전하게 이전한다.
  useEffect(() => {
    if (!userId) return;
    try {
      skipPrivateSaveRef.current = true;
      const scopedPrivate = JSON.parse(localStorage.getItem(privateKey) || "null");
      const legacyForm = JSON.parse(localStorage.getItem("publy_inflow_form") || "{}");
      const nextPrivate = scopedPrivate || { placeUrl: legacyForm.placeUrl || "", blogUrl: legacyForm.blogUrl || "", extraTargets: legacyForm.extraTargets || [] };
      localStorage.setItem(privateKey, JSON.stringify(nextPrivate));
      setPlaceUrl(nextPrivate.placeUrl || ""); setBlogUrl(nextPrivate.blogUrl || ""); setExtraTargets(nextPrivate.extraTargets || []);

      const scopedTargets = localStorage.getItem(savedTargetsKey);
      const legacyTargets = localStorage.getItem("publy_inflow_saved_targets");
      const migratedTargets = JSON.parse(scopedTargets || legacyTargets || "[]");
      localStorage.setItem(savedTargetsKey, JSON.stringify(migratedTargets)); setSavedTargets(migratedTargets);

      delete legacyForm.placeUrl; delete legacyForm.blogUrl; delete legacyForm.extraTargets;
      localStorage.setItem("publy_inflow_form", JSON.stringify(legacyForm));
      localStorage.removeItem("publy_inflow_saved_targets");
    } catch {}
  }, [privateKey, savedTargetsKey, userId]);
  // 주간/월간 토글 바뀌면 리포트 다시 로드
  useEffect(() => { if (userId) getPerfReport(userId, reportPeriod).then(setReport).catch(() => {}); }, [userId, reportPeriod]);

  // 🩺 플레이스 최적화 진단 실행(현재 입력된 플레이스 주소 기준)
  const runDiagnose = async () => {
    if (targetType !== "place" || !placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
    setDiagLoading(true); setDiag(null);
    try {
      const r = await botFetch(`${BOT}/api/place-diagnose?placeUrl=${encodeURIComponent(placeUrl.trim())}`);
      const j = await r.json();
      if (j.error) { toast(j.error, "error"); }
      else { setDiag(j); toast(`최적화 점수 ${j.score}점`, "success"); }
    } catch { toast("진단 실패 — 봇 서버(3334)를 확인하세요", "error"); }
    finally { setDiagLoading(false); }
  };

  // 📍 순위 측정 — 대표 키워드로 내 플레이스 순위 측정 후 저장(리포트·그래프에 자동 반영)
  const [rankLoading, setRankLoading] = useState(false);
  const runMeasureRank = async () => {
    if (targetType !== "place" || !placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
    const kw = (apKeyword || keywords.split(/[,\n]/)[0] || "").trim();
    if (!kw) { toast("순위를 측정할 키워드를 입력하세요(오토파일럿 키워드 또는 첫 키워드)", "error"); return; }
    setRankLoading(true);
    try {
      const r = await botFetch(`${BOT}/api/place-rank?keyword=${encodeURIComponent(kw)}&placeUrl=${encodeURIComponent(placeUrl.trim())}`);
      const j = await r.json();
      if (j.error) { toast(j.error, "error"); return; }
      if (j.rank == null) { toast(`"${kw}"에서 30위 밖이에요(노출 순위 낮음). 유입·리뷰로 끌어올리세요.`, "info"); }
      else {
        setApLastRank(j.rank);
        if (userId) { await recordRankPoint(userId, j.rank); getPerfReport(userId, reportPeriod).then(setReport).catch(()=>{}); getRankHistory(userId, 7).then(setRankHist).catch(()=>{}); }
        toast(`현재 "${kw}" ${j.rank}위 — 기록했어요`, "success");
      }
    } catch { toast("순위 측정 실패 — 봇 서버(3334) 확인", "error"); }
    finally { setRankLoading(false); }
  };

  // 🎯 오토파일럿 판단 — 순위 측정 후 "목표 달성했나?" 반환(달성=true면 유입 스킵)
  autopilotCheckRef.current = async () => {
    if (!userId || !placeUrl.trim()) return false;
    const kw = (apKeyword || keywords.split(/[,\n]/)[0] || "").trim();
    if (!kw) return false;
    try {
      const r = await botFetch(`${BOT}/api/place-rank?keyword=${encodeURIComponent(kw)}&placeUrl=${encodeURIComponent(placeUrl.trim())}`);
      const j = await r.json();
      if (j.rank != null) {
        setApLastRank(j.rank);
        await recordRankPoint(userId, j.rank);
        getPerfReport(userId, reportPeriod).then(setReport).catch(()=>{});
        pushLog(`📍 현재 순위 ${j.rank}위 (목표 ${apGoal}위)`);
        return j.rank <= apGoal;   // 목표 이내면 달성
      }
      pushLog("📍 순위 30위 밖 — 유입으로 끌어올려요.");
      return false;
    } catch { return false; }
  };

  // 🔎 키워드 발굴 — 입력한 키워드 seed로 숨은 키워드 추천
  const runKeywordSuggest = async () => {
    const seeds = keywords.split(/[,\n]/).map(k=>k.trim()).filter(Boolean).slice(0, 3);
    if (!seeds.length) { toast("먼저 키워드를 1개 이상 입력하세요(예: 횡성한우)", "error"); return; }
    setKwLoading(true); setKwSuggest([]);
    try {
      const r = await botFetch(`${BOT}/api/place/keywords?seeds=${encodeURIComponent(JSON.stringify(seeds))}`);
      const j = await r.json();
      if (!j.ok) { toast(j.error || "추천 실패", "error"); return; }
      const already = new Set(keywords.split(/[,\n]/).map(k=>k.trim()));
      const list = (j.keywords || []).map((k: any)=>k.keyword).filter((k: string)=>k && !already.has(k)).slice(0, 24);
      if (!list.length) { toast("새로운 추천 키워드가 없어요", "info"); }
      setKwSuggest(list);
    } catch { toast("키워드 추천 실패 — 봇 서버(3334) 확인", "error"); }
    finally { setKwLoading(false); }
  };
  const addSuggestedKeyword = (k: string) => {
    setKeywords(prev => { const list = prev.split(/[,\n]/).map(x=>x.trim()).filter(Boolean); if (list.includes(k)) return prev; return [...list, k].join(", "); });
    setKwSuggest(prev => prev.filter(x => x !== k));
  };

  // 🏪 현재 입력한 대상을 이름 붙여 저장
  const saveCurrentTarget = () => {
    const url = (targetType === "place" ? placeUrl : blogUrl).trim();
    if (!url) { toast("먼저 주소를 입력하세요", "error"); return; }
    const ok = targetType === "place" ? (!!extractPlaceId(url) || isShortUrl(url)) : !!parseBlogUrl(url);
    if (!ok) { toast("주소를 인식하지 못했어요 — 올바른 링크를 넣어주세요", "error"); return; }
    const name = savingName.trim() || (targetType === "place" ? (extractPlaceId(url) ? "플레이스 " + extractPlaceId(url) : "내 플레이스") : "내 블로그");
    const exists = savedTargets.find(t => t.url === url);
    if (exists) { toast("이미 저장된 주소예요", "info"); return; }
    const item: SavedTarget = { id: Date.now().toString(36), name, url, type: targetType };
    persistSavedTargets([item, ...savedTargets]);
    setSavingName("");
    toast(`"${name}" 저장되었습니다 ✅`, "success");
  };
  const pickSavedTarget = (t: SavedTarget) => {
    setTargetType(t.type);
    if (t.type === "place") setPlaceUrl(t.url); else setBlogUrl(t.url);
    toast(`"${t.name}" 불러왔어요`, "success");
  };
  const removeSavedTarget = (id: string) => persistSavedTargets(savedTargets.filter(t => t.id !== id));

  // 💬 리뷰 감정분석 — 리뷰 수집 후 칭찬·불만 키워드 빈도(AI 키 불필요)
  const runReviewAnalysis = async () => {
    if (targetType !== "place" || !placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
    setRevLoading(true); setRevResult(null);
    try {
      const r = await botFetch(`${BOT}/api/place-reviews?placeUrl=${encodeURIComponent(placeUrl.trim())}`);
      const j = await r.json();
      if (j.error) { toast(j.error, "error"); return; }
      const reviews: string[] = j.reviews || [];
      if (!reviews.length) { toast("리뷰를 읽지 못했어요", "info"); return; }
      // 칭찬/불만 사전(자주 쓰는 표현) — 빈도 카운트
      const LIKE = ["맛있", "친절", "신선", "분위기", "깨끗", "양이 많", "가성비", "재방문", "추천", "정갈", "든든", "빠르", "편안", "만족"];
      const BAD = ["불친절", "비싸", "느리", "오래 기다", "대기", "주차", "좁", "위생", "별로", "실망", "짜", "불만", "아쉬"];
      const count = (words: string[]) => words.map(w => ({ word: w, n: reviews.filter(rv => rv.includes(w)).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
      setRevResult({ total: reviews.length, likes: count(LIKE).slice(0, 6), dislikes: count(BAD).slice(0, 6) });
    } catch { toast("리뷰 분석 실패 — 봇 서버(3334) 확인", "error"); }
    finally { setRevLoading(false); }
  };

  // 🥊 경쟁사 추적 — 내 키워드 상위 경쟁사 vs 나
  const runCompetitors = async () => {
    const kw = (keywords.split(/[,\n]/).map(k=>k.trim()).filter(Boolean)[0] || "").trim();
    if (!kw) { toast("먼저 검색 키워드를 입력하세요", "error"); return; }
    setCompLoading(true); setComp(null);
    try {
      const r = await botFetch(`${BOT}/api/competitors?query=${encodeURIComponent(kw)}${placeUrl.trim()?`&myPlaceUrl=${encodeURIComponent(placeUrl.trim())}`:""}`);
      const j = await r.json();
      if (j.error) toast(j.error, "error");
      else setComp(j);
    } catch { toast("경쟁사 조회 실패 — 봇 서버(3334) 확인", "error"); }
    finally { setCompLoading(false); }
  };

  // 📄 성과 리포트를 PDF로 저장(플레이스365와 동일한 electron.saveReportPdf 재사용)
  const downloadReportPdf = async () => {
    if (!report) return;
    const el = (window as any).electron;
    const per = reportPeriod === "week" ? "주간" : "월간";
    const rankTxt = report.rankNow != null ? `${report.rankNow}위` : "-";
    const rankDelta = (report.rankPrev != null && report.rankNow != null) ? (report.rankPrev - report.rankNow) : null;
    const infDelta = report.inflowPrev > 0 ? Math.round(((report.inflowNow - report.inflowPrev) / report.inflowPrev) * 100) : null;
    const bars = report.daily.map(d => `<td style="text-align:center;padding:2px 4px;font-size:11px;color:#555">${d.count}<br><span style="color:#999">${d.label}</span></td>`).join("");
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:'Apple SD Gothic Neo',sans-serif;padding:40px;color:#1a2332}h1{font-size:24px}.kpi{display:inline-block;border:1px solid #e2e8f1;border-radius:14px;padding:18px 26px;margin:8px 12px 8px 0}.big{font-size:32px;font-weight:900;color:#2563eb}.sub{color:#647084;font-size:13px}</style></head><body>
      <h1>📊 ${per} 성과 리포트</h1><p class="sub">발행일 ${new Date().toLocaleDateString("ko-KR")} · 퍼블리 트래픽 유입</p>
      <div><div class="kpi"><div class="sub">현재 순위</div><div class="big">${rankTxt}</div><div class="sub">${rankDelta!=null?(rankDelta>0?`▲ ${rankDelta}계단 상승`:rankDelta<0?`▼ ${-rankDelta}계단 하락`:"변동 없음"):""}</div></div>
      <div class="kpi"><div class="sub">${per} 유입</div><div class="big">${report.inflowNow.toLocaleString()}명</div><div class="sub">${infDelta!=null?(infDelta>=0?`▲ ${infDelta}% 증가`:`▼ ${-infDelta}% 감소`):"지난 기간 대비"}</div></div>
      <div class="kpi"><div class="sub">지난 ${per}</div><div class="big" style="color:#94a3b8">${report.inflowPrev.toLocaleString()}명</div></div></div>
      <h3 style="margin-top:26px">${per} 유입 추이</h3><table style="border-collapse:collapse;margin-top:8px"><tr>${bars}</tr></table>
      <p class="sub" style="margin-top:30px">본 리포트는 퍼블리가 측정한 유입·순위 데이터입니다. 검색 위치·시간·개인화에 따라 순위는 달라질 수 있습니다.</p>
      </body></html>`;
    if (el?.saveReportPdf) {
      const r = await el.saveReportPdf(html, `퍼블리-성과리포트-${per}-${new Date().toISOString().slice(0,10)}.pdf`);
      if (r?.ok) toast("성과 리포트 PDF를 저장했어요", "success");
      else if (!r?.canceled) toast(r?.error || "PDF 저장 실패", "error");
    } else {
      const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); w.print(); }
    }
  };

  // ⏰ 예약 실행 감시 — 앱이 켜져 있을 때 지정 시각 도달 시 자동 1회 실행(하루 1번)
  useEffect(() => {
    if (!schedEnabled || !userId) return;
    const tick = async () => {
      if (running) return;
      const now = new Date();
      const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
      if (hhmm !== schedTime) return;
      if (await inflowScheduleRanToday(userId)) return;
      pushLog(`⏰ 예약 시각(${schedTime}) 도달`);
      // 🎯 오토파일럿 켜져 있으면: 순위 먼저 재고 목표 달성이면 유입 스킵(한도 절약)
      if (apEnabled && targetType === "place") {
        const reached = await autopilotCheckRef.current();
        if (reached) { pushLog("🎯 목표 순위 유지 중 — 오늘 유입은 건너뜁니다(한도 절약)."); await markInflowScheduleRan(userId); return; }
        pushLog("🎯 목표보다 낮아요 — 순위를 끌어올리기 위해 유입 실행.");
      }
      pushLog("⏰ 자동 유입 시작");
      if (!auto) setRounds(schedRounds);
      scheduledRunPendingRef.current = true;
      startRef.current();
    };
    const id = setInterval(tick, 30000); // 30초마다 시각 확인
    tick();
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedEnabled, schedTime, schedRounds, userId, running]);

  const saveSched = async (nextEnabled: boolean) => {
    if (!userId) return;
    try { await saveInflowSchedule(userId, { enabled: nextEnabled, time: schedTime, rounds: schedRounds }); setSchedEnabled(nextEnabled); toast(nextEnabled ? `⏰ 매일 ${schedTime}에 자동 유입 ${schedRounds}회 예약됨` : "예약 해제", "success"); }
    catch (e: any) { toast(e.message, "error"); }
  };

  const saveAp = async (nextEnabled: boolean) => {
    if (!userId) return;
    if (nextEnabled && !apKeyword.trim()) { toast("순위를 추적할 키워드를 입력하세요", "error"); return; }
    if (nextEnabled && targetType === "place" && !placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
    if (nextEnabled && targetType === "blog" && !blogUrl.trim()) { toast("먼저 블로그 글 주소를 입력하세요", "error"); return; }
    const cfg: AutopilotConfig = { user_id: userId, target_type: targetType, target_ref: targetType === "place" ? placeUrl.trim() : blogUrl.trim(), keyword: apKeyword.trim(), goal_rank: apGoal, enabled: nextEnabled, last_rank: apLastRank };
    try { await saveAutopilot(cfg); setApEnabled(nextEnabled); toast(nextEnabled ? `🎯 오토파일럿 ON — ${apKeyword} ${apGoal}위 목표로 자동 관리` : "오토파일럿 OFF", "success"); }
    catch (e: any) { toast(e.message, "error"); }
  };
  useEffect(() => { logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight, behavior: "smooth" }); }, [logs]);
  useEffect(() => () => {
    esRef.current?.close();
    esRef.current = null;
  }, []);
  useEffect(() => {
    if (!running) return;
    let lock: any = null;
    let cancelled = false;
    const keepScreenOn = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request("screen");
        if (cancelled) await lock?.release();
      } catch {}
    };
    void keepScreenOn();
    return () => { cancelled = true; void lock?.release().catch(() => {}); };
  }, [running]);

  // 🔁 폼 입력값 저장(탭 이동해도 유지). 무거운 것(로그·계정목록)은 제외.
  useEffect(() => {
    if (skipPrivateSaveRef.current) { skipPrivateSaveRef.current = false; return; }
    try {
      localStorage.setItem(formKey, JSON.stringify({
        targetType, keywords, rounds, termMin, termMax, device,
        doSave, doShare, doDir, doCall, doBook, doTalk, doLike, funnel, spread, spreadHours, doReview, reviewText, auto, actionRate, intensity, maxDwellSec, kwWeights,
      }));
      localStorage.setItem(privateKey, JSON.stringify({ placeUrl, blogUrl, extraTargets }));
    } catch {}
  }, [formKey, privateKey, targetType, placeUrl, blogUrl, keywords, rounds, termMin, termMax, device, doSave, doShare, doDir, doCall, doBook, doTalk, doLike, funnel, spread, spreadHours, doReview, reviewText, auto, actionRate, intensity, maxDwellSec, extraTargets, kwWeights]);

  // 🔔 앱 내 자동 알림 — 날짜/주차 마커로 중복을 막고, 다음 실행 때 놓친 알림도 알림함에 쌓는다.
  useEffect(() => {
    try { setNotifications(JSON.parse(localStorage.getItem(notificationKey) || "[]")); }
    catch { setNotifications([]); }
  }, [notificationKey]);

  useEffect(() => {
    if (!userId) return;
    const markerPrefix = `publy_inflow_auto_${userId}`;
    const addNotification = (message: string) => {
      const item: InflowNotification = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, message, createdAt: new Date().toISOString() };
      setNotifications((current) => {
        const next = [item, ...current].slice(0, 50);
        try { localStorage.setItem(notificationKey, JSON.stringify(next)); } catch {}
        return next;
      });
      showToast?.(message, "info");
    };
    const hasRun = (kind: string, period: string) => localStorage.getItem(`${markerPrefix}_${kind}`) === period;
    const markRun = (kind: string, period: string) => localStorage.setItem(`${markerPrefix}_${kind}`, period);
    const tick = async () => {
      if (automationRunningRef.current) return;
      automationRunningRef.current = true;
      try {
        const now = new Date();
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
        const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
        const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        const week = monday.toISOString().slice(0, 10);
        const keyword = (apKeyword || keywords.split(/[,\n]/)[0] || "").trim();
        const place = placeUrl.trim();

        if (hhmm >= "09:00" && !hasRun("report", day)) {
          const dailyReport = await getPerfReport(userId, "week");
          const yesterdayInflow = dailyReport.daily.at(-2)?.count ?? 0;
          addNotification(`매일 리포트 · 어제 순위 ${dailyReport.rankNow != null ? `${dailyReport.rankNow}위` : "미측정"} · 유입 ${yesterdayInflow}명`);
          markRun("report", day);
        }
        if (targetType === "place" && place && keyword && !hasRun("rank", day)) {
          const response = await botFetch(`${BOT}/api/place-rank?keyword=${encodeURIComponent(keyword)}&placeUrl=${encodeURIComponent(place)}`);
          const result = await response.json();
          if (!result.error && result.rank != null) {
            const previous = Number(localStorage.getItem(`${markerPrefix}_last_rank`));
            if (previous > 0 && result.rank > previous) addNotification(`${keyword} 순위 ${previous}위→${result.rank}위 하락, 유입 보강 권장`);
            localStorage.setItem(`${markerPrefix}_last_rank`, String(result.rank));
            setApLastRank(result.rank);
            await recordRankPoint(userId, result.rank);
          }
          markRun("rank", day);
        }
        if (targetType === "place" && place && keyword && !hasRun("competitor", day)) {
          const response = await botFetch(`${BOT}/api/competitors?query=${encodeURIComponent(keyword)}&myPlaceUrl=${encodeURIComponent(place)}`);
          const result = await response.json();
          const mine = result.mine as { rank: number; review: number } | null | undefined;
          const leader = mine && result.top?.find((entry: any) => !entry.isMine && entry.rank < mine.rank);
          if (mine && leader) addNotification(`${leader.name}이 앞질렀어요, 리뷰 ${Math.abs((leader.review || 0) - (mine.review || 0)).toLocaleString()}개 차이`);
          markRun("competitor", day);
        }
        if (targetType === "place" && place && !hasRun("diagnose", week)) {
          const response = await botFetch(`${BOT}/api/place-diagnose?placeUrl=${encodeURIComponent(place)}`);
          const result = await response.json();
          if (!result.error) {
            setDiag(result);
            const weak = result.items?.find((item: any) => !item.ok);
            if (weak) addNotification(`${weak.label} 아직 미설정 · 플레이스 진단에서 확인해 주세요`);
          }
          markRun("diagnose", week);
        }
      } catch {
        // 자동 점검 실패는 기존 기능을 방해하지 않고 다음 폴링/앱 실행 때 다시 시도한다.
      } finally { automationRunningRef.current = false; }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [apKeyword, keywords, notificationKey, placeUrl, showToast, targetType, userId]);

  const copyLogs = () => {
    if (!logs.length) return;
    navigator.clipboard.writeText(logs.map((entry) => entry.type === "text" ? entry.text : `📸 ${entry.caption}`).join("\n")).then(() => toast("로그 전체를 복사했어요", "success")).catch(() => toast("복사 실패", "error"));
  };

  const start = () => {
    if (running) return;
    const kwList = keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
    if (!kwList.length) { toast("검색 키워드를 1개 이상 입력하세요", "error"); return; }
    if (targetType === "place" && !placeUrl.trim()) { toast("플레이스 주소(지도/플레이스 링크)를 입력하세요", "error"); return; }
    const parsedBlog = targetType === "blog" ? parseBlogUrl(blogUrl) : null;
    if (targetType === "blog" && !parsedBlog) { toast("블로그 글 주소를 붙여넣어 주세요", "error"); return; }
    if (!unlimited && used >= limit) { toast(`오늘 유입 한도(${limit}회)를 다 썼어요. 자정에 초기화돼요.`, "error"); return; }
    const n = auto ? (unlimited ? 999 : Math.max(1, limit - used)) : Math.max(1, rounds);

    setRunning(true); setLogs([]); setProgress(0); setSessOk(0);
    const params = new URLSearchParams({
      targetType, keywords: kwList.join(","), rounds: String(n),
      termMin: String(termMin), termMax: String(termMax),
      doSave: String(doSave), doLike: String(doLike), doShare: String(doShare),
      doDir: String(doDir), doCall: String(doCall), doBook: String(doBook), doTalk: String(doTalk), device,
      fullFunnel: String(funnel),
      spreadHours: spread ? String(spreadHours) : "0",
      doReview: String(doReview), reviewText: doReview ? reviewText : "",
      visible: String(visible),
      actionRate: String(Math.max(0, Math.min(1, actionRate / 100))),
      intensity: intensity === "fast" ? "0.35" : intensity === "deep" ? "2.5" : "1",
      maxDwellSec: String(Math.max(0, maxDwellSec)),
    });
    if (userId) params.set("userId", userId);
    if (accountId) params.set("accountId", accountId);
    if (targetType === "place") params.set("placeUrl", placeUrl.trim());
    else if (parsedBlog) { params.set("blogId", parsedBlog.blogId); if (parsedBlog.logNo) params.set("logNo", parsedBlog.logNo); }
    // ➕ 추가 대상들(있으면 방문마다 로테이션) — 서버가 targets JSON을 받아 처리
    const extras = extraTargets.map((s) => s.trim()).filter(Boolean);
    if (extras.length) params.set("extraTargets", JSON.stringify(extras));
    // 🎯 키워드 비중(고급) — {키워드:가중치}
    const weights = kwList.map((k) => Number(kwWeights[k]) || 1);
    if (weights.some((w) => w !== 1)) params.set("keywordWeights", JSON.stringify(weights));

    pushLog(`🚀 트래픽 유입 시작 — ${targetType === "place" ? "플레이스" : "블로그"}, 키워드 ${kwList.length}개, ${n}회 방문, 텀 ${termMin}~${termMax}초, ${device === "pc" ? "PC" : device === "mix" ? "혼합" : "모바일"}`);
    const es = new BotEventStream(`${BOT}/api/inflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publy-Session": getMemberSessionToken() },
      body: JSON.stringify(Object.fromEntries(params.entries())),
    });
    esRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "shot" && d.dataUrl) pushShot(d.caption || "단계별 화면", d.dataUrl);
      else if (d.type === "progress") { setProgress(Math.round((d.done / Math.max(1, d.total)) * 100)); }
      else if (d.type === "quota_info") setUsed(d.used);
      else if (d.type === "quota_exceeded") { pushLog("🛑 오늘 유입 한도를 다 썼어요"); toast("오늘 유입 한도 초과", "error"); setRunning(false); es.close(); esRef.current = null; }
      else if (d.type === "inflow_done") { setSessOk(d.success || 0); pushLog(`🏁 완료 — 총 ${d.done}회 방문, 성공 ${d.success}회`); toast(`유입 완료 · 성공 ${d.success}회`, "success"); setRunning(false); es.close(); esRef.current = null; if (scheduledRunPendingRef.current) { scheduledRunPendingRef.current = false; if (userId && Number(d.success) > 0) void markInflowScheduleRan(userId); } refreshStats(); if (apEnabled && targetType === "place") { pushLog("📍 순위 자동 측정 중…"); runMeasureRank(); } }
      else if (d.type === "error") { scheduledRunPendingRef.current = false; pushLog(`❌ ${d.msg}`); toast(d.msg, "error"); setRunning(false); es.close(); esRef.current = null; }
    };
    es.onerror = () => { scheduledRunPendingRef.current = false; pushLog("❌ 봇 연결 오류 — 봇 서버(포트 3334)가 켜져 있는지 확인해주세요"); toast("봇 연결 오류", "error"); setRunning(false); es.close(); esRef.current = null; };
    es.onclose = () => setRunning(false);
  };
  startRef.current = start;
  const stop = () => { esRef.current?.close(); esRef.current = null; setRunning(false); pushLog("⏹️ 사용자가 정지했어요"); };

  const pct = unlimited ? 0 : Math.min(100, (used / Math.max(1, limit)) * 100);
  const weekTotal = history.reduce((s, d) => s + d.count, 0);

  // 🌱 새싹 비서 — 지금 데이터 상태를 보고 "오늘 뭐 하세요" 한마디(우선순위 규칙, AI 키 불필요)
  const sproutAdvice = (() => {
    const hasTarget = targetType === "place" ? !!placeUrl.trim() : !!blogUrl.trim();
    if (!hasTarget) return { tone: "start", msg: "먼저 내 플레이스나 블로그 주소를 넣어주세요. 그럼 순위·경쟁사·리뷰까지 제가 챙겨드릴게요!" };
    if (!keywords.trim()) return { tone: "start", msg: "검색 키워드를 넣어주세요. ‘🔎 키워드 추천’을 누르면 숨은 키워드도 찾아드려요." };
    // 진단 결과 있으면 부족 항목 우선
    if (diag) { const weak = diag.items.find(it => !it.ok); if (weak && diag.score < 90) return { tone: "fix", msg: `진단 점수 ${diag.score}점! ‘${weak.label}’만 채우면 순위가 더 잘 올라요 — ${weak.tip}` }; }
    // 순위 목표 대비
    if (apLastRank != null) {
      if (apLastRank <= apGoal) return { tone: "good", msg: `현재 ${apLastRank}위로 목표(${apGoal}위)를 지키고 있어요. 이 강점을 소식·홍보에 계속 노출하세요!` };
      return { tone: "push", msg: `현재 ${apLastRank}위 — 목표 ${apGoal}위까지 유입을 조금 더 채우면 좋아요. ‘유입 시작’을 눌러보세요.` };
    }
    // 리뷰 분석 있으면 강점 홍보 제안
    if (revResult && revResult.likes[0]) return { tone: "tip", msg: `손님들이 ‘${revResult.likes[0].word}’을(를) 가장 좋아해요. 이 강점을 대표 사진·소식에 내세우면 클릭률이 올라가요.` };
    if (weekTotal > 0) return { tone: "good", msg: `이번 주 유입 ${weekTotal}명이 쌓였어요. ‘📍 순위 측정’으로 지금 순위를 확인해볼까요?` };
    return { tone: "start", msg: "준비 완료! ‘유입 시작’을 누르면 진짜 손님처럼 방문이 쌓이기 시작해요. 무리하지 않게 안전 한도 안에서요." };
  })();
  const inputStyle: React.CSSProperties = { width: "100%", padding: "13px 14px", borderRadius: 12, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.ink, fontSize: 15, fontWeight: 600, fontFamily: "inherit", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 8, display: "block" };
  const chk: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 700, color: C.ink, padding: "8px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel2 };

  const ActionChk = ({ v, set, label }: { v: boolean; set: (b: boolean) => void; label: string }) => (
    <label style={{ ...chk, borderColor: v ? C.accent : C.line, background: v ? C.glow : C.panel2 }}>
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} style={{ width: 17, height: 17, accentColor: C.accent }} />{label}
    </label>
  );

  return (
    <div className="inflow-center" style={{ fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif", color: C.ink, display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes inflowResultIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .inflow-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
        .inflow-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15,23,42,.10); }
        .inflow-result { animation: inflowResultIn .32s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .inflow-card, .inflow-result { transition: none; animation: none; } }
      `}</style>
      {/* ── 헤더 ── */}
      <div style={{ order: -2, display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 12, fontWeight: 900, padding: "5px 10px", borderRadius: 8, letterSpacing: 0.5 }}>NEW</span>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>트래픽 유입</h2>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: C.sub, border: `1px solid ${C.line2}`, padding: "3px 9px", borderRadius: 6 }}>CONTROL TOWER</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: running ? "#16a34a" : C.sub }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: running ? "#22c55e" : C.sub, boxShadow: running ? "0 0 8px #22c55e" : "none" }} />{running ? "가동 중" : "대기"}
        </span>
      </div>
      <p style={{ order: -1, margin: "0 0 16px", fontSize: 13.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>
        설정한 유입을 실행하고 자동 측정된 <b style={{color:C.accent}}>순위·방문 추이</b>로 변화를 확인해요.
      </p>

      {/* 🌱 새싹 비서 — 오늘의 브리핑 */}
      <div style={{ order: 1, display: "flex", alignItems: "center", gap: 14, background: `linear-gradient(135deg,${C.glow},transparent)`, border: `1.5px solid ${C.accent}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#16a34a" }}>
          <SproutAssistant size={30} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#16a34a", marginBottom: 2 }}>새싹 비서 · 오늘의 브리핑</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.5 }}>{sproutAdvice.msg}</div>
        </div>
      </div>

      {/* 👣 사용방법 안내 */}
      <div style={{ order: 2 }}><UsageGuide theme={theme} accent={C.accent}
        subtitle="펄리예요! 키워드로 검색해 내 플레이스·블로그로 진짜 손님처럼 유입시키고, 순위가 오르려면 뭘 채워야 하는지 진단까지 해드려요."
        steps={[
          { ico: "📍", title: "대상·키워드 넣기", desc: "내 플레이스(지도/naver.me) 또는 블로그 글 주소를 붙여넣고, 검색 키워드를 여러 개 적어요(자동으로 인식돼요)." },
          { ico: "🎛️", title: "옵션 고르기", desc: "방문 횟수·텀·기기(모바일/PC)·할 행동(저장·길찾기·전화 등)을 정해요. 시간분산·액션확률로 더 자연스럽게." },
          { ico: "🚀", title: "유입 시작", desc: "‘유입 시작’을 누르면 방문마다 IP를 바꿔 안전 한도 안에서 돌아요. 라이브 로그로 전 과정을 볼 수 있어요." },
          { ico: "🩺", title: "성과·진단 확인", desc: "성과 리포트(주간/월간)로 순위·유입 변화를 보고, ‘플레이스 진단’으로 부족한 곳을 찾아 채우면 순위가 더 잘 올라요." },
        ]} /></div>

      {notifications.length > 0 && (
        <div className="inflow-card inflow-result" style={{ order: 3, background: C.panel, border: "1.5px solid #0ea5e9", borderRadius: 16, padding: "13px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 900 }}>🔔 자동 알림함</span>
            <span style={{ fontSize: 11, color: C.sub }}>{notifications.length}개</span>
            <button onClick={() => { setNotifications([]); try { localStorage.setItem(notificationKey, "[]"); } catch {} }} style={{ marginLeft: "auto", border: 0, background: "transparent", color: C.sub, cursor: "pointer", fontWeight: 700 }}>모두 확인</button>
          </div>
          {notifications.slice(0, 3).map((item) => <div key={item.id} style={{ fontSize: 12.5, lineHeight: 1.55, color: C.ink, padding: "5px 0", borderTop: `1px solid ${C.line}` }}>{item.message}</div>)}
        </div>
      )}

      {/* ── 실행 패널 ── */}
      <div className="inflow-card" style={{ order: 4, background: C.panel, border: "1.5px solid #2563eb", borderRadius: 16, padding: 18, marginBottom: 14, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 대상 */}
        <div>
          <label style={labelStyle}>어디로 유입시킬까요?</label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["place", "🗺️ 플레이스(지도)"], ["blog", "📝 블로그 글"]] as const).map(([k, lb]) => (
              <button key={k} onClick={() => setTargetType(k)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `2px solid ${targetType === k ? C.accent : C.line2}`, background: targetType === k ? C.glow : C.panel2, color: targetType === k ? C.accent : C.sub, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
            ))}
          </div>
        </div>

        {/* 대상 입력 + 이름 붙여 저장 */}
        <div>
          <label style={labelStyle}>{targetType === "place" ? "내 플레이스 주소" : "내 블로그 글 주소"}</label>
          <input
            value={targetType === "place" ? placeUrl : blogUrl}
            onChange={(e) => { const v = e.target.value; if (targetType === "place") { setPlaceUrl(v); if (detectTargetType(v) === "blog") { setBlogUrl(v); setTargetType("blog"); toast("블로그 주소로 인식했어요", "info"); } } else { setBlogUrl(v); if (detectTargetType(v) === "place") { setPlaceUrl(v); setTargetType("place"); toast("플레이스 주소로 인식했어요", "info"); } } }}
            placeholder={targetType === "place" ? "지도/플레이스/naver.me 링크 붙여넣기" : "글 주소/아이디 (blog.naver.com/아이디/글번호)"}
            style={inputStyle} />
          {/* 인식 배지 */}
          {targetType === "place" && placeUrl.trim() && (extractPlaceId(placeUrl)
            ? <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>✅ 인식됨 — 가게번호 {extractPlaceId(placeUrl)}</div>
            : isShortUrl(placeUrl)
              ? <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: C.accent }}>🔗 단축주소 — 실행할 때 자동으로 풀려요</div>
              : <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠️ 주소를 못 읽었어요 — 지도 링크(map.naver.com/…/place/숫자)를 붙여넣어 주세요</div>)}
          {targetType === "blog" && blogUrl.trim() && (parseBlogUrl(blogUrl)
            ? <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>✅ 인식됨 — {parseBlogUrl(blogUrl)!.blogId}{parseBlogUrl(blogUrl)!.logNo ? " / 글 " + parseBlogUrl(blogUrl)!.logNo : ""}</div>
            : <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠️ 주소를 못 읽었어요 — blog.naver.com/아이디/글번호 형태로 붙여넣어 주세요</div>)}
          {/* 이름 + 저장 버튼 */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input value={savingName} onChange={(e) => setSavingName(e.target.value)} placeholder={targetType === "place" ? "이 플레이스 이름 (예: 강남점)" : "이 블로그 이름"} style={{ ...inputStyle, flex: 1 }} />
            <button onClick={saveCurrentTarget} style={{ padding: "0 22px", borderRadius: 12, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 14.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>💾 저장</button>
          </div>
          {/* 저장된 목록 — 골라 쓰기 */}
          {savedTargets.filter((t) => t.type === targetType).length > 0 && (
            <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: C.panel2, border: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 8 }}>🏪 저장한 대상 (눌러서 불러오기)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {savedTargets.filter((t) => t.type === targetType).map((t) => {
                  const active = (t.type === "place" ? placeUrl : blogUrl).trim() === t.url && targetType === t.type;
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, background: active ? C.glow : C.panel, border: `1px solid ${active ? C.accent : C.line}` }}>
                      <button onClick={() => pickSavedTarget(t)} style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: active ? C.accent : C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.type === "place" ? "🗺️" : "📝"} {t.name} {active && "· 사용 중"}</div>
                        <div style={{ fontSize: 11, color: C.sub, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.url}</div>
                      </button>
                      <button onClick={() => removeSavedTarget(t.id)} style={{ padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.line2}`, background: C.panel2, color: "#dc2626", fontSize: 16, fontWeight: 900, cursor: "pointer", flexShrink: 0 }}>×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ➕ 추가 대상(여러 곳 번갈아 유입) */}
        <div>
          <label style={labelStyle}>➕ 추가 대상 <span style={{ color: C.sub, fontWeight: 600 }}>(여러 플레이스·글을 번갈아 — 선택)</span></label>
          {extraTargets.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={t} onChange={(e) => setExtraTargets((arr) => arr.map((x, j) => j === i ? e.target.value : x))} placeholder="플레이스/블로그 주소 붙여넣기" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => setExtraTargets((arr) => arr.filter((_, j) => j !== i))} style={{ padding: "0 14px", borderRadius: 10, border: `1.5px solid ${C.line2}`, background: C.panel2, color: "#dc2626", fontSize: 18, fontWeight: 900, cursor: "pointer" }}>×</button>
            </div>
          ))}
          <button onClick={() => setExtraTargets((arr) => [...arr, ""])} style={{ padding: "9px 14px", borderRadius: 10, border: `1.5px dashed ${C.line2}`, background: "transparent", color: C.accent, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>＋ 대상 추가</button>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <label style={{ ...labelStyle, margin: 0 }}>검색 키워드 <span style={{ color: C.sub, fontWeight: 600 }}>(여러 개 — 돌아가며 검색)</span></label>
            <button onClick={runKeywordSuggest} disabled={kwLoading} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.panel2, color: C.accent, fontSize: 12.5, fontWeight: 800, cursor: kwLoading?"default":"pointer", fontFamily: "inherit", opacity: kwLoading?0.6:1 }}>{kwLoading ? "찾는 중…" : "🔎 키워드 추천"}</button>
          </div>
          <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={"예) 강남 맛집, 강남역 삼겹살, 역삼동 고깃집"} rows={2} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
          {kwSuggest.length > 0 && (
            <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: C.panel2, border: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 8 }}>💡 이런 키워드도 있어요 (눌러서 추가)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {kwSuggest.map((k) => (
                  <button key={k} onClick={() => addSuggestedKeyword(k)} style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.line2}`, background: C.panel, color: C.ink, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ {k}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 기기 */}
        <div>
          <label style={labelStyle}>접속 기기 <span style={{ color: C.sub, fontWeight: 600 }}>(기본 모바일 — 안 바꿔도 돼요)</span></label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["mobile", "📱 모바일"], ["pc", "🖥️ PC"], ["mix", "🔀 혼합(랜덤)"]] as const).map(([k, lb]) => (
              <button key={k} onClick={() => setDevice(k)} style={{ flex: 1, padding: "11px", borderRadius: 12, border: `2px solid ${device === k ? C.accent : C.line2}`, background: device === k ? C.glow : C.panel2, color: device === k ? C.accent : C.sub, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
            ))}
          </div>
        </div>

        {/* 텀 + 횟수 */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={labelStyle}>방문 텀(초) — 임의 범위로 랜덤</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={5} value={termMin} onChange={(e) => setTermMin(Math.max(5, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center" }} />
              <span style={{ fontWeight: 800, color: C.sub }}>~</span>
              <input type="number" min={termMin} value={termMax} onChange={(e) => setTermMax(Math.max(termMin, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center" }} />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={labelStyle}>방문 횟수</label>
            <input type="number" min={1} value={rounds} disabled={auto} onChange={(e) => setRounds(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center", opacity: auto ? 0.5 : 1 }} />
          </div>
        </div>

        {/* 체류 강도 + 액션 확률 */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>📖 체류 강도 <span style={{ color: C.sub, fontWeight: 600 }}>(글 읽는 시간)</span></label>
            <div style={{ display: "flex", gap: 6 }}>
              {([["fast", "빠르게 ~20초"], ["normal", "보통 ~60초"], ["deep", "꼼꼼히 ~3분"]] as const).map(([k, lb]) => (
                <button key={k} onClick={() => setIntensity(k)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: `2px solid ${intensity === k ? C.accent : C.line2}`, background: intensity === k ? C.glow : C.panel2, color: intensity === k ? C.accent : C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>⏱️ 최대 체류시간(초) <span style={{ color: C.sub, fontWeight: 600 }}>(0=자동)</span></label>
            <input type="number" min={0} value={maxDwellSec} onChange={(e) => setMaxDwellSec(Math.max(0, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center" }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>🎲 액션 확률 <span style={{ color: C.sub, fontWeight: 600 }}>(방문 중 저장·공감 등 실행 비율)</span></label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="range" min={0} max={100} step={10} value={actionRate} onChange={(e) => setActionRate(Number(e.target.value))} style={{ flex: 1, accentColor: C.accent }} />
              <span style={{ minWidth: 44, textAlign: "right", fontSize: 15, fontWeight: 900, color: C.accent }}>{actionRate}%</span>
            </div>
            <div style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginTop: 3 }}>낮출수록 자연스러워요(진짜 손님처럼 일부만 저장)</div>
          </div>
        </div>

        {/* 액션 */}
        <div>
          <label style={labelStyle}>방문해서 할 행동 <span style={{ color: C.sub, fontWeight: 600 }}>{targetType === "place" ? "(길찾기·전화·예약이 순위에 가장 강해요)" : ""}</span></label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {targetType === "place" ? (<>
              <ActionChk v={doSave} set={setDoSave} label="💾 저장" />
              <ActionChk v={doDir} set={setDoDir} label="🧭 길찾기" />
              <ActionChk v={doCall} set={setDoCall} label="📞 전화" />
              <ActionChk v={doBook} set={setDoBook} label="📅 예약" />
              <ActionChk v={doTalk} set={setDoTalk} label="💬 톡톡" />
              <ActionChk v={doShare} set={setDoShare} label="🔗 공유" />
            </>) : (<>
              <ActionChk v={doLike} set={setDoLike} label="💚 공감" />
              <ActionChk v={doShare} set={setDoShare} label="🔗 공유" />
            </>)}
            <ActionChk v={auto} set={setAuto} label="⚙️ 자동(오늘 한도까지)" />
            <ActionChk v={visible} set={setVisible} label="🪟 창 보기(테스트)" />
          </div>
        </div>

        {/* ⚙️ 고급 설정 — 키워드별 비중(자주 안 쓰는 건 접어둠) */}
        <div>
          <button onClick={() => setAdvOpen((v) => !v)} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.ink, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", width: "100%", textAlign: "left" }}>
            {advOpen ? "▾" : "▸"} ⚙️ 고급 설정 — 키워드별 비중
          </button>
          {advOpen && (
            <div style={{ marginTop: 10, padding: 14, borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel2 }}>
              <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 8 }}>키워드마다 방문 비중을 정해요(숫자가 클수록 자주). 비워두면 균등.</div>
              {keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).map((k) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{k}</span>
                  <input type="range" min={1} max={10} value={kwWeights[k] ?? 1} onChange={(e) => setKwWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} style={{ width: 120, accentColor: C.accent }} />
                  <span style={{ minWidth: 24, textAlign: "right", fontSize: 14, fontWeight: 900, color: C.accent }}>{kwWeights[k] ?? 1}</span>
                </div>
              ))}
              {!keywords.trim() && <div style={{ fontSize: 12.5, color: C.sub, fontWeight: 600 }}>먼저 위에 키워드를 입력하세요.</div>}
            </div>
          )}
        </div>

        {/* ⏱️ 시간 분산 */}
        <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "12px 16px", borderRadius: 14, border: `2px solid ${spread ? C.accent : C.line2}`, background: spread ? C.glow : C.panel2, flexWrap: "wrap" }}>
          <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} style={{ width: 19, height: 19, accentColor: C.accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 14.5, fontWeight: 900, color: spread ? C.accent : C.ink }}>⏱️ 시간 분산 <span style={{ fontSize: 10, background: "#16a34a", color: "#fff", padding: "2px 6px", borderRadius: 6, marginLeft: 4 }}>봇 티 제거</span></div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 3 }}>한 번에 몰지 않고 여러 시간에 걸쳐 자연스럽게 흘려보내요(진짜 손님 곡선)</div>
          </div>
          {spread && <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.preventDefault()}>
            <input type="number" min={1} max={24} value={spreadHours} onChange={(e) => setSpreadHours(Math.min(24, Math.max(1, Number(e.target.value))))} style={{ width: 64, padding: "9px", borderRadius: 10, border: `1.5px solid ${C.line2}`, background: C.panel, color: C.ink, fontSize: 15, fontWeight: 800, textAlign: "center", fontFamily: "inherit" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>시간에 걸쳐</span>
          </div>}
        </label>

        {/* ✍️ 리뷰 자동작성 — 관리자 락(플레이스 전용) */}
        {targetType === "place" && (
          <div style={{ padding: "12px 16px", borderRadius: 14, border: `2px solid ${doReview ? "#dc2626" : C.line2}`, background: doReview ? "rgba(220,38,38,.06)" : C.panel2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={doReview} onChange={(e) => setDoReview(e.target.checked)} style={{ width: 19, height: 19, accentColor: "#dc2626", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 900, color: doReview ? "#dc2626" : C.ink }}>✍️ 리뷰 자동작성 <span style={{ fontSize: 10, background: "#dc2626", color: "#fff", padding: "2px 6px", borderRadius: 6, marginLeft: 4 }}>🔒 관리자 승인</span></div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>계정 밴 위험이 있어 관리자 승인을 받은 계정만 작동해요. 신중히 사용하세요.</div>
              </div>
            </label>
            {doReview && <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} placeholder="등록할 리뷰 내용을 입력하세요" rows={2} style={{ ...inputStyle, marginTop: 10, resize: "vertical" }} />}
          </div>
        )}

        {/* 🌀 풀퍼널 모드 — 킬러 */}
        <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "14px 16px", borderRadius: 14, border: `2px solid ${funnel ? C.accent : C.line2}`, background: funnel ? C.glow : C.panel2 }}>
          <input type="checkbox" checked={funnel} onChange={(e) => setFunnel(e.target.checked)} style={{ width: 20, height: 20, accentColor: C.accent, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: funnel ? C.accent : C.ink }}>🌀 풀퍼널 모드 <span style={{ fontSize: 10, verticalAlign: "middle", background: C.accent, color: "#fff", padding: "2px 6px", borderRadius: 6, marginLeft: 4 }}>강력</span></div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>{targetType === "place" ? "메뉴·사진·리뷰까지 둘러봐 체류·조회를 극대화 (진짜 손님처럼)" : "이 블로그 다른 글도 2~3개 읽고 이웃까지 — 체류·페이지뷰·이웃 폭발"}</div>
          </div>
        </label>

        {accounts.length > 0 && (
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ ...inputStyle }}>
            <option value="">계정 선택 (저장·공감 등 로그인 액션용, 선택)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.blog_name || a.username}</option>)}
          </select>
        )}

        {/* 실행 */}
        {!running ? (
          <button onClick={start} style={{ padding: "16px", borderRadius: 14, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 17, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 8px 20px ${C.glow}` }}>🚀 유입 시작</button>
        ) : (
          <button onClick={stop} style={{ padding: "16px", borderRadius: 14, border: `2px solid ${C.accent}`, background: C.panel2, color: C.accent, fontSize: 17, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>⏹️ 정지</button>
        )}
        {running && (
          <div style={{ height: 8, borderRadius: 5, background: C.panel2, overflow: "hidden", border: `1px solid ${C.line}` }}>
            <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg,${C.accent},${C.cyan})`, transition: "width .3s" }} />
          </div>
        )}
      </div>

      {/* ── 등급 사용표 + 한도 게이지 ── */}
      <div style={{ order: 5, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>📊 등급별 하루 유입 한도</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {PLAN_ORDER.map((pk) => {
            const cfg = PLAN_CONFIG[pk]; const cur = pk === plan;
            return (
              <div key={pk} style={{ textAlign: "center", padding: "12px 6px", borderRadius: 12, border: `2px solid ${cur ? C.accent : C.line}`, background: cur ? C.glow : C.panel2 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: cur ? C.accent : C.sub }}>{cfg.label}</div>
                <div style={{ fontSize: 17, fontWeight: 900, marginTop: 4 }}>{cfg.dailyInflow.toLocaleString()}회</div>
                {cur && <div style={{ fontSize: 10, fontWeight: 800, color: C.accent, marginTop: 3 }}>내 등급</div>}
              </div>
            );
          })}
        </div>
        {!unlimited && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 5 }}>
              <span>오늘 사용</span><span><b style={{ color: C.accent }}>{used}</b> / {limit}회</span>
            </div>
            <div style={{ height: 9, borderRadius: 6, background: C.panel2, overflow: "hidden", border: `1px solid ${C.line}` }}>
              <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${C.accent},${C.cyan})`, transition: "width .3s" }} />
            </div>
          </div>
        )}
        <p style={{ margin: "10px 0 0", fontSize: 11, color: C.sub, fontWeight: 600 }}>※ 한도는 계정 안전 장치. 락 해제(무제한)는 관리자만.</p>
      </div>


      {/* ── KPI 카드 ── */}
      <div style={{ order: 6, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 14 }}>
        {[
          { k: "오늘 유입", v: `${used}`, sub: unlimited ? "무제한" : `/ ${limit}회`, col: C.accent },
          { k: "현재 순위", v: apLastRank != null ? `${apLastRank}` : "—", sub: apEnabled ? `목표 ${apGoal}위` : "위", col: "#16a34a" },
          { k: "최근 7일", v: `${weekTotal}`, sub: "누적 방문", col: C.cyan },
          { k: "남은 한도", v: unlimited ? "∞" : `${Math.max(0, limit - used)}`, sub: unlimited ? "무제한" : "회", col: "#f59e0b" },
        ].map((kp) => (
          <div key={kp.k} style={{ background: C.kpiBg, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", boxShadow: `0 4px 14px ${C.glow}` }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 6 }}>{kp.k}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 28, fontWeight: 900, color: kp.col, lineHeight: 1 }}>{kp.v}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>{kp.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 📊 성과 리포트 (주간/월간, 이번 vs 지난 비교) ── */}
      {report && (()=>{
        const rankDelta = (report.rankPrev != null && report.rankNow != null) ? (report.rankPrev - report.rankNow) : null;
        const infDelta = report.inflowPrev > 0 ? Math.round(((report.inflowNow - report.inflowPrev) / report.inflowPrev) * 100) : null;
        const per = reportPeriod === "week" ? "주간" : "월간";
        const mx = Math.max(1, ...report.daily.map(d=>d.count));
        return (
        <div className="inflow-card inflow-result" style={{ order: 7, background: `linear-gradient(135deg,${C.glow},transparent)`, border: `2px solid ${C.accent}`, borderRadius: 18, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 17, fontWeight: 900 }}>📊 성과 리포트</span>
            <div style={{ display: "flex", gap: 4, background: C.panel2, borderRadius: 10, padding: 3 }}>
              {([["week","주간"],["month","월간"]] as const).map(([k,lb])=>(
                <button key={k} onClick={()=>setReportPeriod(k)} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: reportPeriod===k?C.accent:"transparent", color: reportPeriod===k?"#fff":C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
              ))}
            </div>
            <button onClick={downloadReportPdf} style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${C.accent}`, background: C.panel, color: C.accent, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📄 PDF로 저장 · 고객 제출용</button>
          </div>
          {/* 비교 KPI 3 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 14 }}>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 5 }}>현재 순위</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#16a34a" }}>{report.rankNow!=null?`${report.rankNow}위`:"—"}</div>
              {rankDelta!=null && <div style={{ fontSize: 12.5, fontWeight: 800, color: rankDelta>0?"#16a34a":rankDelta<0?"#dc2626":C.sub, marginTop: 3 }}>{rankDelta>0?`▲ ${rankDelta}계단 상승 🎉`:rankDelta<0?`▼ ${-rankDelta}계단`:"변동 없음"}</div>}
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 5 }}>{per} 유입</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: C.accent }}>{report.inflowNow.toLocaleString()}<span style={{fontSize:14,color:C.sub}}> 명</span></div>
              {infDelta!=null && <div style={{ fontSize: 12.5, fontWeight: 800, color: infDelta>=0?"#16a34a":"#dc2626", marginTop: 3 }}>{infDelta>=0?`▲ ${infDelta}% 증가`:`▼ ${-infDelta}% 감소`}</div>}
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 5 }}>지난 {per}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: C.sub }}>{report.inflowPrev.toLocaleString()}<span style={{fontSize:14}}> 명</span></div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.sub, marginTop: 3 }}>비교 기준</div>
            </div>
          </div>
          {/* 미니 막대 그래프 */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56 }}>
            {report.daily.map((d,i)=>(
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div title={`${d.label}: ${d.count}명`} style={{ width: "100%", height: `${Math.max(3,(d.count/mx)*42)}px`, background: `linear-gradient(180deg,${C.accent},${C.cyan})`, borderRadius: 3 }} />
                {reportPeriod==="week" && <span style={{ fontSize: 9, color: C.sub }}>{d.label}</span>}
              </div>
            ))}
          </div>
          {/* ✅ 체크포인트 */}
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: C.panel, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.sub, marginBottom: 6 }}>✅ 이번 {per} 체크포인트</div>
            {rankDelta!=null && rankDelta>0 && <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3 }}>🎉 순위가 <b style={{color:"#16a34a"}}>{rankDelta}계단</b> 올랐어요!</div>}
            {infDelta!=null && infDelta>0 && <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3 }}>📈 유입이 지난 {per}보다 <b style={{color:C.accent}}>{infDelta}%</b> 늘었어요.</div>}
            {(rankDelta==null && report.rankNow==null) && <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginTop: 3 }}>순위는 오토파일럿·순위 측정을 켜면 자동으로 기록돼요.</div>}
            {(infDelta==null || infDelta<=0) && rankDelta==null && report.inflowNow>0 && <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginTop: 3 }}>이번 {per} 유입 {report.inflowNow}명 — 꾸준히 쌓이고 있어요.</div>}
          </div>
        </div>
        );
      })()}

      {/* ── 🩺 플레이스 최적화 진단 (순위 오르려면 뭘 채워야 하나) ── */}
      {targetType === "place" && (
        <div className="inflow-card" style={{ order: 8, background: C.panel, border: "1.5px solid #14b8a6", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>🩺 플레이스 최적화 진단</span>
            <button onClick={runDiagnose} disabled={diagLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: diagLoading?"default":"pointer", fontFamily: "inherit", opacity: diagLoading?0.6:1 }}>{diagLoading ? "진단 중…" : "🩺 내 플레이스 진단하기"}</button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>순위는 트래픽만으로 오르지 않아요. 리뷰·정보·사진·소식·예약이 <b style={{color:C.ink}}>종합 점수</b>예요. 지금 내 플레이스의 부족한 곳을 찾아 처방해 드려요.</p>
          {diag ? (
            <div className="inflow-result">
              {/* 점수 게이지 */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 40, fontWeight: 900, color: diag.score>=80?"#16a34a":diag.score>=60?"#f59e0b":"#dc2626" }}>{diag.score}<span style={{fontSize:18,color:C.sub}}>/100</span></div>
                <div style={{ flex: 1 }}>
                  <div style={{ height: 12, borderRadius: 7, background: C.panel2, overflow: "hidden", border: `1px solid ${C.line}` }}>
                    <div style={{ height: "100%", width: `${diag.score}%`, background: `linear-gradient(90deg,${diag.score>=80?"#16a34a":diag.score>=60?"#f59e0b":"#dc2626"},${C.cyan})`, transition: "width .5s" }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginTop: 5 }}>{diag.score>=80?"최적화가 잘 돼 있어요 👍":diag.score>=60?"조금만 더 채우면 순위가 올라요":"부족한 항목이 많아요 — 아래부터 채우세요"}</div>
                </div>
              </div>
              {/* 항목별 체크리스트 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {diag.items.map((it) => (
                  <div key={it.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, background: it.ok?C.panel2:"rgba(220,38,38,.06)", border: `1px solid ${it.ok?C.line:"#dc262633"}` }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{it.ok?"✅":"⚠️"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800 }}>{it.label} <span style={{ color: C.sub, fontWeight: 600 }}>· {it.value}</span></div>
                      {!it.ok && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#dc2626", marginTop: 2, lineHeight: 1.5 }}>{it.tip}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !diagLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: C.sub, fontSize: 13, fontWeight: 600 }}>위 버튼을 눌러 내 플레이스가 순위 오르기에 뭐가 부족한지 확인하세요.</div>
          )}
        </div>
      )}

      {/* ── 💬 리뷰 감정분석 (손님이 뭘 좋아하고 뭘 불만하나) ── */}
      {targetType === "place" && (
        <div className="inflow-card" style={{ order: 9, background: C.panel, border: "1.5px solid #a855f7", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>💬 리뷰 감정분석</span>
            <button onClick={runReviewAnalysis} disabled={revLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,#8b5cf6,#ec4899)`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: revLoading?"default":"pointer", fontFamily: "inherit", opacity: revLoading?0.6:1 }}>{revLoading ? "분석 중…" : "💬 손님 마음 읽기"}</button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>손님 리뷰를 읽어 <b style={{color:C.ink}}>뭘 좋아하고 뭘 불만하는지</b> 알려드려요. 칭찬은 소식·홍보에 쓰고, 불만은 바로 개선하세요.</p>
          {revResult ? (
            <div className="inflow-result">
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 10 }}>리뷰 {revResult.total}개 분석</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
                <div style={{ background: "rgba(22,163,74,.07)", border: "1px solid #16a34a33", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: "#16a34a", marginBottom: 8 }}>👍 손님이 좋아하는 것</div>
                  {revResult.likes.length ? revResult.likes.map(l => (
                    <div key={l.word} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, padding: "3px 0" }}><span>{l.word}</span><span style={{ color: "#16a34a" }}>{l.n}회</span></div>
                  )) : <div style={{ fontSize: 12.5, color: C.sub }}>뚜렷한 칭찬 키워드가 적어요.</div>}
                </div>
                <div style={{ background: "rgba(220,38,38,.06)", border: "1px solid #dc262633", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: "#dc2626", marginBottom: 8 }}>⚠️ 개선하면 좋을 것</div>
                  {revResult.dislikes.length ? revResult.dislikes.map(l => (
                    <div key={l.word} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, padding: "3px 0" }}><span>{l.word}</span><span style={{ color: "#dc2626" }}>{l.n}회</span></div>
                  )) : <div style={{ fontSize: 12.5, color: C.sub }}>불만 표현이 거의 없어요 — 아주 좋아요! 🎉</div>}
                </div>
              </div>
              {revResult.likes[0] && <p style={{ margin: "12px 0 0", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>💡 <b style={{color:C.ink}}>"{revResult.likes[0].word}"</b>을(를) 가장 많이 칭찬해요 — 이 강점을 소식·대표 사진·홍보 문구에 내세우세요.</p>}
            </div>
          ) : !revLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: C.sub, fontSize: 13, fontWeight: 600 }}>버튼을 눌러 손님들이 뭘 좋아하고 뭘 아쉬워하는지 확인하세요.</div>
          )}
        </div>
      )}

      {/* ── 🥊 경쟁사 추적 (내 키워드 상위 경쟁사 vs 나) ── */}
      {targetType === "place" && (
        <div className="inflow-card" style={{ order: 10, background: C.panel, border: "1.5px solid #f59e0b", borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>🥊 경쟁사 추적</span>
            <button onClick={runCompetitors} disabled={compLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,#f59e0b,#f97316)`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: compLoading?"default":"pointer", fontFamily: "inherit", opacity: compLoading?0.6:1 }}>{compLoading ? "조회 중…" : "🥊 옆집 확인하기"}</button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>내 대표 키워드로 검색했을 때 <b style={{color:C.ink}}>위에 뜨는 경쟁사</b>들의 리뷰 수를 비교해요. 옆집이 뭘로 앞서는지 보고 따라잡으세요.</p>
          {comp ? (
            <div className="inflow-result">
              {comp.myRank && <div style={{ marginBottom: 10, padding: "10px 14px", borderRadius: 10, background: C.glow, border: `1px solid ${C.accent}`, fontSize: 13.5, fontWeight: 800, color: C.accent }}>내 매장은 현재 이 키워드에서 <b>{comp.myRank}위</b> 근처예요.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {comp.top.map((c) => (
                  <div key={c.rank} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: c.isMine?C.glow:C.panel2, border: `1px solid ${c.isMine?C.accent:C.line}` }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: c.rank<=3?"#f59e0b":C.sub, minWidth: 28 }}>{c.rank}위</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name} {c.isMine && <span style={{color:C.accent}}>· 내 매장</span>}</div>
                      <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600 }}>{c.category}</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: C.sub, whiteSpace: "nowrap" }}>
                      방문 <b style={{color:C.ink}}>{c.review.toLocaleString()}</b> · 블로그 <b style={{color:C.ink}}>{c.blog.toLocaleString()}</b>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>※ 상위 경쟁사보다 리뷰가 적으면, 방문 손님 리뷰·블로그 리뷰를 늘리는 게 순위에 가장 효과적이에요.</p>
            </div>
          ) : !compLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: C.sub, fontSize: 13, fontWeight: 600 }}>키워드를 넣고 버튼을 누르면 상위 경쟁사와 내 위치를 비교해요.</div>
          )}
        </div>
      )}

      {/* ── 그래프 2단: 유입 추이 + 순위 변동 ── */}
      <div style={{ order: 11, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginBottom: 14 }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📈 최근 7일 유입 추이</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>총 {weekTotal}회</span>
        </div>
        {history.length > 0 ? <AreaChart data={history} C={C} /> : <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 12.5, fontWeight: 600 }}>데이터가 쌓이면 그래프가 그려져요</div>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.sub, fontWeight: 700, padding: "0 2px" }}>
          {history.map((d) => <span key={d.label}>{d.label}</span>)}
        </div>
      </div>
      {/* 순위 변동 */}
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📉 순위 변동 <span style={{ color: C.sub, fontWeight: 600, fontSize: 11 }}>(위=상위)</span></span>
          {apEnabled && <span style={{ fontSize: 11.5, fontWeight: 800, color: C.cyan }}>목표 {apGoal}위 ---</span>}
        </div>
        <RankChart data={rankHist} goal={apGoal} C={C} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.sub, fontWeight: 700, padding: "0 2px" }}>
          {rankHist.map((d) => <span key={d.label}>{d.label}</span>)}
        </div>
      </div>
      </div>

      {/* ── 🎯 오토파일럿 ── */}
      {targetType === "place" && (<div className="inflow-card" style={{ order: 12, background: apEnabled ? `linear-gradient(135deg,${C.glow},transparent)` : C.panel, border: `2px solid ${apEnabled ? C.accent : "#3b82f6"}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: apEnabled || true ? 12 : 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 900 }}>🎯 순위 오토파일럿</span>
          <span style={{ fontSize: 10, fontWeight: 800, background: apEnabled ? "#16a34a" : C.sub, color: "#fff", padding: "2px 8px", borderRadius: 6 }}>{apEnabled ? "가동 중" : "꺼짐"}</span>
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 600, flex: 1, minWidth: 180 }}>목표 순위만 정해두면, 순위가 떨어질 때 자동으로 유입을 채워 지켜줘요.</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label style={labelStyle}>추적 키워드</label>
            <input value={apKeyword} onChange={(e) => setApKeyword(e.target.value)} placeholder="순위를 지킬 대표 키워드" style={inputStyle} />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label style={labelStyle}>목표 순위</label>
            <input type="number" min={1} value={apGoal} onChange={(e) => setApGoal(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center" }} />
          </div>
          <button onClick={runMeasureRank} disabled={rankLoading} style={{ padding: "13px 18px", borderRadius: 12, border: `1.5px solid ${C.accent}`, background: C.panel2, color: C.accent, fontSize: 14, fontWeight: 800, cursor: rankLoading?"default":"pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: rankLoading?0.6:1 }}>{rankLoading ? "측정 중…" : "📍 지금 순위 측정"}</button>
          <button onClick={() => saveAp(!apEnabled)} style={{ padding: "13px 20px", borderRadius: 12, border: apEnabled ? `2px solid ${C.accent}` : "none", background: apEnabled ? C.panel2 : `linear-gradient(135deg,${C.accent},${C.cyan})`, color: apEnabled ? C.accent : "#fff", fontSize: 15, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{apEnabled ? "끄기" : "🎯 켜기"}</button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 11, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>※ 위 실행 패널의 대상(플레이스/블로그 주소)을 기준으로 추적해요. <b style={{color:C.ink}}>📍 지금 순위 측정</b>을 누르면 현재 순위를 기록해 리포트·그래프에 반영돼요. 달성하면 유입을 줄여 한도를 아끼고, 떨어지면 다시 밀어 올려요.</p>
      </div>)}

      {/* ── ⏰ 예약 실행 ── */}
      <div className="inflow-card" style={{ order: 13, background: schedEnabled ? `linear-gradient(135deg,${C.glow},transparent)` : C.panel, border: `2px solid ${schedEnabled ? C.accent : "#06b6d4"}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 900 }}>⏰ 예약 실행</span>
          <span style={{ fontSize: 10, fontWeight: 800, background: schedEnabled ? "#16a34a" : C.sub, color: "#fff", padding: "2px 8px", borderRadius: 6 }}>{schedEnabled ? "예약됨" : "꺼짐"}</span>
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 600, flex: 1, minWidth: 180 }}>매일 지정 시각에 위 설정으로 자동 유입해요(앱이 켜져 있을 때).</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 120 }}>
            <label style={labelStyle}>매일 실행 시각</label>
            <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} style={{ ...inputStyle, textAlign: "center" }} />
          </div>
          <div style={{ minWidth: 100 }}>
            <label style={labelStyle}>방문 횟수</label>
            <input type="number" min={1} value={schedRounds} onChange={(e) => setSchedRounds(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center" }} />
          </div>
          <button onClick={() => saveSched(!schedEnabled)} style={{ padding: "13px 20px", borderRadius: 12, border: schedEnabled ? `2px solid ${C.accent}` : "none", background: schedEnabled ? C.panel2 : `linear-gradient(135deg,${C.accent},${C.cyan})`, color: schedEnabled ? C.accent : "#fff", fontSize: 15, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{schedEnabled ? "예약 해제" : "⏰ 예약"}</button>
        </div>
      </div>

      {/* ── 라이브 로그 ── */}
      <div style={{ order: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📜 전체 진행 로그</span>
          <button onClick={copyLogs} disabled={!logs.length} style={{ padding: "7px 14px", borderRadius: 9, border: `1.5px solid ${C.line2}`, background: C.panel, color: logs.length ? C.accent : C.sub, fontSize: 13, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>📋 로그 전체복사</button>
        </div>
        <div ref={logBoxRef} style={{ background: C.logBg, color: C.logInk, borderRadius: 14, padding: "16px 18px", height: 520, overflowY: "auto", fontSize: 15, lineHeight: 1.8, fontFamily: "'SF Mono','D2Coding',ui-monospace,monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {logs.length ? logs.map((entry, i) => entry.type === "text"
            ? <div key={i}>{entry.text}</div>
            : <div key={i} style={{ margin: "8px 0 12px" }}>
                <div style={{ marginBottom: 5, fontWeight: 800 }}>📸 {entry.caption}</div>
                <img src={entry.dataUrl} alt={entry.caption} style={{ display: "block", width: "min(280px,100%)", maxHeight: 190, objectFit: "contain", borderRadius: 9, border: "1px solid rgba(255,255,255,.18)" }} />
              </div>
          ) : <div style={{ opacity: 0.5 }}>여기에 검색 → 진입 → 체류 → 액션 전 과정이 실시간으로 표시돼요.</div>}
        </div>
      </div>
    </div>
  );
}
