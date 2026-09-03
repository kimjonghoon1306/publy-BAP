import { useState, useRef, useEffect } from "react";
import { BotEventStream, botFetch } from "../lib/botApi";
import UsageGuide from "./UsageGuide";
import SproutAssistant from "./SproutAssistant";
import { INFLOW_DAILY_LIMIT, PLAN_CONFIG, getInflowDailyUsage, getInflowUsageHistory, getAccounts, PublyAccount, getAutopilot, saveAutopilot, getRankHistory, AutopilotConfig, getInflowSchedule, saveInflowSchedule, inflowScheduleRanToday, markInflowScheduleRan, getPerfReport, PerfReport, recordRankPoint, getMemberSessionToken, getAdminSessionToken, getInflowTargets, saveInflowTargets, inflowScope, getInflowStatToday } from "../lib/supabase";

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

// 🛒 스마트스토어 상품 주소 → { storeId, productId } 인식
function parseStoreUrl(input: string): { storeId: string; productId: string } | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (!/smartstore\.naver\.com|shopping\.naver\.com|brand\.naver\.com/i.test(s)) return null;
  const storeId = s.match(/(?:smartstore|brand)\.naver\.com\/([A-Za-z0-9_-]+)/i)?.[1] || "";
  const productId = s.match(/products\/(\d+)/i)?.[1] || s.match(/\/(\d{6,})/)?.[1] || "";
  if (!storeId && !productId) return null;
  return { storeId, productId };
}

// 🔎 주소만 보고 플레이스/블로그/스토어 자동 감지(탭 안 바꿔도 되게)
function detectTargetType(input: string): "place" | "blog" | "store" | null {
  const s = (input || "").toLowerCase();
  if (/smartstore\.naver|shopping\.naver|brand\.naver/.test(s)) return "store";
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
  const [targetType, setTargetType] = useState<"place" | "blog" | "store">(saved0.targetType ?? "place");
  const privateKey = `publy_inflow_private_${userId || "guest"}`;
  const private0: any = (() => { try { return JSON.parse(localStorage.getItem(privateKey) || "{}"); } catch { return {}; } })();
  const [placeUrl, setPlaceUrl] = useState<string>(private0.placeUrl ?? saved0.placeUrl ?? "");
  const [blogUrl, setBlogUrl] = useState<string>(private0.blogUrl ?? saved0.blogUrl ?? "");
  const [storeUrl, setStoreUrl] = useState<string>(private0.storeUrl ?? saved0.storeUrl ?? "");
  // 📚 블로그 글 지정 유입 — 팝업(글주소 직접 / 로그인해서 내 글 불러오기)
  const [myPosts, setMyPosts] = useState<{ url: string; title: string; date: string }[]>([]);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [myPostsLoading, setMyPostsLoading] = useState(false);
  const [postPopup, setPostPopup] = useState<null | "manual" | "login">(null); // 어떤 팝업이 열렸나
  const [manualPostUrls, setManualPostUrls] = useState<string>("");             // 글주소 직접 입력(줄바꿈 여러 개)
  const [popupAccountId, setPopupAccountId] = useState<string>("");             // 로그인 팝업에서 고른 계정
  const [pickedPostCount, setPickedPostCount] = useState<number>(0);            // 지정된 글 개수(요약 표시)
  // 🔑 키워드는 플레이스/블로그가 완전히 별개(서로 섞이면 안 됨). 각각 저장하고, 현재 대상 것만 표시·수정.
  const [keywordsPlace, setKeywordsPlace] = useState<string>(saved0.keywordsPlace ?? (saved0.targetType !== "blog" ? saved0.keywords : "") ?? "");
  const [keywordsBlog, setKeywordsBlog] = useState<string>(saved0.keywordsBlog ?? (saved0.targetType === "blog" ? saved0.keywords : "") ?? "");
  const [keywordsStore, setKeywordsStore] = useState<string>(saved0.keywordsStore ?? ""); // 🛒 스토어 키워드 격리(블로그·플레이스와 안 섞임)
  const keywords = targetType === "place" ? keywordsPlace : targetType === "store" ? keywordsStore : keywordsBlog;
  const setKeywords = targetType === "place" ? setKeywordsPlace : targetType === "store" ? setKeywordsStore : setKeywordsBlog;
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
  // 🛒 스마트스토어 액션
  const [doWish, setDoWish] = useState(saved0.doWish ?? true);      // 💚 찜(로그인 필요)
  const [doCart, setDoCart] = useState(saved0.doCart ?? false);     // 🛒 장바구니(로그인 필요)
  const [doOption, setDoOption] = useState(saved0.doOption ?? true); // 🔍 옵션·상세 탐색(로그인 불필요)
  const [funnel, setFunnel] = useState(saved0.funnel ?? false);
  const [spread, setSpread] = useState(saved0.spread ?? false);   // ⏱️ 시간 분산
  const [spreadHours, setSpreadHours] = useState<number>(saved0.spreadHours ?? 3);
  const [doReview, setDoReview] = useState<boolean>(saved0.doReview ?? false); // ✍️ 리뷰(관리자 락)
  const [reviewText, setReviewText] = useState<string>(saved0.reviewText ?? "");
  const [auto, setAuto] = useState(saved0.auto ?? false);
  const [actionRate, setActionRate] = useState<number>(saved0.actionRate ?? 100); // 🎲 액션 발동 확률(%)
  const [intensity, setIntensity] = useState<"fast" | "normal" | "deep">(saved0.intensity ?? "normal"); // 📖 체류 강도
  const [maxDwellSec, setMaxDwellSec] = useState<number>(saved0.maxDwellSec ?? 0); // 0=강도 사용, >0=직접지정 확정값
  const [dwellDraft, setDwellDraft] = useState<string>(String(saved0.maxDwellSec ?? 30)); // 직접지정 입력 임시값(설정 버튼 눌러야 확정)
  // ➕ 추가 대상(주소 목록) — 대상(플레이스/블로그/스토어)별로 격리(서로 섞이지 않게)
  const [extraByType, setExtraByType] = useState<{ place: string[]; blog: string[]; store: string[] }>(() => {
    const legacy = private0.extraTargets ?? saved0.extraTargets ?? [];
    const seed = private0.extraByType ?? { place: [], blog: [], store: [] };
    // 기존 단일 목록은 그때 대상 타입에 귀속(이전 데이터 보존)
    if (legacy.length && !private0.extraByType) { const t = (saved0.targetType ?? "place") as "place" | "blog" | "store"; seed[t] = legacy; }
    return { place: seed.place || [], blog: seed.blog || [], store: seed.store || [] };
  });
  const extraTargets = extraByType[targetType];
  const setExtraTargets = (updater: string[] | ((arr: string[]) => string[])) => setExtraByType((prev) => ({ ...prev, [targetType]: typeof updater === "function" ? (updater as any)(prev[targetType]) : updater }));
  // 🏪 내 플레이스/블로그 저장 목록(이름+주소) — 여러 개 저장해두고 골라 쓰기
  type SavedTarget = { id: string; name: string; url: string; type: "place" | "blog" | "store" };
  const savedTargetsKey = `publy_inflow_saved_targets_${userId || "guest"}`;
  const [savedTargets, setSavedTargets] = useState<SavedTarget[]>(() => { try { return JSON.parse(localStorage.getItem(savedTargetsKey) || localStorage.getItem("publy_inflow_saved_targets") || "[]"); } catch { return []; } });
  const [savingName, setSavingName] = useState("");
  const persistSavedTargets = (list: SavedTarget[]) => {
    setSavedTargets(list);
    try { localStorage.setItem(savedTargetsKey, JSON.stringify(list)); } catch {}
    // 🏪 서버 영구저장 — 앱 재설치·다른 기기에서도 유지(회원 데이터 보존)
    if (userId) saveInflowTargets(userId, list).catch(() => {});
  };
  const [advOpen, setAdvOpen] = useState(false);       // ⚙️ 고급 설정 펼침
  const [kwWeights, setKwWeights] = useState<Record<string, number>>(saved0.kwWeights ?? {}); // 키워드별 비중
  const [visible, setVisible] = useState(false); // 🪟 창 보기(테스트) — 저장 안 함(안전상 매번 꺼짐)
  const [accountId, setAccountId] = useState("");
  const [selectedAccts, setSelectedAccts] = useState<Set<string>>(new Set()); // 🔄 다계정 로테이션(저장·찜·공감을 여러 계정으로)
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [running, setRunning] = useState(false);
  type InflowLogEntry = { type: "text"; text: string } | { type: "shot"; caption: string; dataUrl: string };
  const [logs, setLogs] = useState<InflowLogEntry[]>([]);
  const [used, setUsed] = useState(0);            // 전체 하루 한도 사용량(한도 계산용)
  const [todayScoped, setTodayScoped] = useState(0); // 현재 대상의 오늘 유입(KPI 표시용, 대상별 분리)
  const [progress, setProgress] = useState(0);
  const [sessOk, setSessOk] = useState(0); // 이번 실행 성공 수
  const [history, setHistory] = useState<{ label: string; count: number }[]>([]);
  // 🎯 오토파일럿
  const [apEnabled, setApEnabled] = useState(false);
  const [apGoal, setApGoal] = useState(5);
  const [apKeyword, setApKeyword] = useState("");
  const [apLastRank, setApLastRank] = useState<number | null>(null);
  const [apRankOut, setApRankOut] = useState(false); // 최근 측정에서 30위 밖이었나(현재순위 '30+' 표시용)
  const [rankHist, setRankHist] = useState<{ label: string; rank: number | null }[]>([]);
  // 📊 성과 리포트(주간/월간)
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [chartDays, setChartDays] = useState<number>(7); // 📅 그래프·누적 기간(7/30/90일·365=전체)
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
  // 🎯 현재 선택된 대상의 데이터 scope(대상별 통계 분리 키). 대상이 인식되면 그 대상 기준으로 조회.
  const currentScope = (() => {
    try {
      if (targetType === "place") { const id = extractPlaceId(placeUrl); return id ? inflowScope("place", id) : ""; }
      if (targetType === "blog") { const b = parseBlogUrl(blogUrl); return b ? inflowScope("blog", b.blogId) : ""; }
      if (targetType === "store") { const s = parseStoreUrl(storeUrl); return s ? inflowScope("store", s.productId || s.storeId) : ""; }
    } catch {}
    return "";
  })();
  const refreshStats = () => {
    if (!userId) return;
    getInflowDailyUsage(userId).then(setUsed).catch(() => {});                    // 전체 한도 사용량
    getInflowStatToday(userId, currentScope).then(setTodayScoped).catch(() => {}); // 이 대상 오늘 유입
    getInflowUsageHistory(userId, chartDays, currentScope).then(setHistory).catch(() => {});
    getRankHistory(userId, chartDays, currentScope).then(setRankHist).catch(() => {});
    getPerfReport(userId, reportPeriod, currentScope).then(setReport).catch(() => {});
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
      // 🏪 서버가 소스오브트루스: 서버에 저장된 매장이 있으면 그걸 사용(재설치·다른 기기에서도 복원),
      //    서버가 비었고 로컬에만 있으면 서버로 백필(기존 회원 데이터 자동 이전)
      getInflowTargets(userId).then((server) => {
        if (server && server.length) {
          setSavedTargets(server as SavedTarget[]);
          try { localStorage.setItem(savedTargetsKey, JSON.stringify(server)); } catch {}
        } else if (migratedTargets.length) {
          saveInflowTargets(userId, migratedTargets).catch(() => {});
        }
      }).catch(() => {});

      delete legacyForm.placeUrl; delete legacyForm.blogUrl; delete legacyForm.extraTargets;
      localStorage.setItem("publy_inflow_form", JSON.stringify(legacyForm));
      localStorage.removeItem("publy_inflow_saved_targets");
    } catch {}
  }, [privateKey, savedTargetsKey, userId]);
  // 주간/월간 토글·대상 바뀌면 리포트 다시 로드(대상별)
  useEffect(() => { if (userId) getPerfReport(userId, reportPeriod, currentScope).then(setReport).catch(() => {}); }, [userId, reportPeriod, currentScope]);
  // 📅 기간·대상 바뀌면 유입·순위·오늘유입 다시 로드(과거 데이터·대상별 조회) → 대상 변경 시 화면 전체 갱신
  useEffect(() => { if (!userId) return; getInflowStatToday(userId, currentScope).then(setTodayScoped).catch(() => {}); getInflowUsageHistory(userId, chartDays, currentScope).then(setHistory).catch(() => {}); getRankHistory(userId, chartDays, currentScope).then((h) => { setRankHist(h); const last = [...h].reverse().find((x) => x.rank != null); setApLastRank(last ? last.rank : null); setApRankOut(false); }).catch(() => {}); }, [userId, chartDays, currentScope]);

  // 🔐 로그인해서 내 글 불러오기 — 계정 관리에서 연결한 계정으로 내 글 목록을 정확히 수집(SSE)
  const collectMyPosts = (acctId: string) => {
    if (!acctId) { toast("먼저 불러올 네이버 계정을 선택하세요", "error"); return; }
    setMyPostsLoading(true); setMyPosts([]); setSelectedPosts(new Set());
    const es = new BotEventStream(`${BOT}/api/my-posts?accountId=${encodeURIComponent(acctId)}&selectMode=all`, { method: "GET" });
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "posts") { const arr = (d.posts || []) as { url: string; title: string; date: string }[]; setMyPosts(arr); setSelectedPosts(new Set(arr.map((p) => p.url))); toast(`📚 내 글 ${arr.length}개를 불러왔어요`, "success"); setMyPostsLoading(false); es.close(); }
      else if (d.type === "error") { toast(d.msg, "error"); setMyPostsLoading(false); es.close(); }
    };
    es.onerror = () => { toast("글 수집 실패 — 봇 서버(3334)·계정 로그인 확인", "error"); setMyPostsLoading(false); es.close(); };
  };
  const togglePost = (url: string) => setSelectedPosts((prev) => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });
  const selectAllPosts = () => setSelectedPosts(new Set(myPosts.map((p) => p.url)));
  const clearSelectedPosts = () => setSelectedPosts(new Set());
  // 여러 글을 유입 대상으로 확정(첫 글=기본 대상, 나머지=추가 대상 로테이션) — 팝업 공통
  const applyPostsAsTargets = (urls: string[]) => {
    const clean = urls.map((u) => u.trim()).filter(Boolean);
    if (!clean.length) { toast("먼저 유입할 글을 선택하세요", "error"); return; }
    setTargetType("blog"); setBlogUrl(clean[0]); setExtraTargets(clean.slice(1)); setPickedPostCount(clean.length);
    toast(`✅ ${clean.length}개 글이 유입 대상으로 설정됐어요 — '유입 시작'을 누르세요`, "success");
    setPostPopup(null);
  };
  const applySelectedPostsAsTargets = () => applyPostsAsTargets(myPosts.filter((p) => selectedPosts.has(p.url)).map((p) => p.url));

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
    pushLog(`📍 "${kw}" 현재 순위 측정 중…`);
    try {
      const r = await botFetch(`${BOT}/api/place-rank?keyword=${encodeURIComponent(kw)}&placeUrl=${encodeURIComponent(placeUrl.trim())}`);
      const j = await r.json();
      if (j.error) { pushLog(`❌ 순위 측정 실패 — ${j.error}`); toast(j.error, "error"); return; }
      if (j.rank == null) {
        setApRankOut(true); // 현재순위 카드에 '30+' 표시
        pushLog(`📍 "${kw}" 30위 밖 — 노출 순위가 낮아요. 유입·리뷰로 끌어올리세요.`);
        toast(`"${kw}"에서 30위 밖이에요(노출 순위 낮음). 유입·리뷰로 끌어올리세요.`, "info");
      } else {
        setApLastRank(j.rank); setApRankOut(false);
        if (userId) { await recordRankPoint(userId, j.rank, currentScope); getPerfReport(userId, reportPeriod, currentScope).then(setReport).catch(()=>{}); getRankHistory(userId, chartDays, currentScope).then(setRankHist).catch(()=>{}); }
        pushLog(`📍 현재 "${kw}" ${j.rank}위${apEnabled ? ` (목표 ${apGoal}위)` : ""} — 기록했어요`);
        toast(`현재 "${kw}" ${j.rank}위 — 기록했어요`, "success");
      }
    } catch { pushLog("❌ 순위 측정 실패 — 봇 서버(3334)를 확인해주세요"); toast("순위 측정 실패 — 봇 서버(3334) 확인", "error"); }
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
        await recordRankPoint(userId, j.rank, currentScope);
        getPerfReport(userId, reportPeriod, currentScope).then(setReport).catch(()=>{});
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
    const cfg: AutopilotConfig = { user_id: userId, target_type: targetType, target_ref: targetType === "place" ? placeUrl.trim() : targetType === "store" ? storeUrl.trim() : blogUrl.trim(), keyword: apKeyword.trim(), goal_rank: apGoal, enabled: nextEnabled, last_rank: apLastRank };
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
        targetType, keywordsPlace, keywordsBlog, keywordsStore, rounds, termMin, termMax, device,
        doSave, doShare, doDir, doCall, doBook, doTalk, doLike, doWish, doCart, doOption, funnel, spread, spreadHours, doReview, reviewText, auto, actionRate, intensity, maxDwellSec, kwWeights,
      }));
      localStorage.setItem(privateKey, JSON.stringify({ placeUrl, blogUrl, storeUrl, extraTargets }));
    } catch {}
  }, [formKey, privateKey, targetType, placeUrl, blogUrl, storeUrl, keywordsPlace, keywordsBlog, keywordsStore, rounds, termMin, termMax, device, doSave, doShare, doDir, doCall, doBook, doTalk, doLike, doWish, doCart, doOption, funnel, spread, spreadHours, doReview, reviewText, auto, actionRate, intensity, maxDwellSec, extraTargets, kwWeights]);

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
            await recordRankPoint(userId, result.rank, currentScope);
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
    const parsedStore = targetType === "store" ? parseStoreUrl(storeUrl) : null;
    if (targetType === "store" && !parsedStore) { toast("스마트스토어 상품 주소를 붙여넣어 주세요", "error"); return; }
    if (!unlimited && used >= limit) { toast(`오늘 유입 한도(${limit}회)를 다 썼어요. 자정에 초기화돼요.`, "error"); return; }
    const n = auto ? (unlimited ? 999 : Math.max(1, limit - used)) : Math.max(1, rounds);

    setRunning(true); setLogs([]); setProgress(0); setSessOk(0);
    const params = new URLSearchParams({
      targetType, keywords: kwList.join(","), rounds: String(n),
      termMin: String(termMin), termMax: String(termMax),
      doSave: String(doSave), doLike: String(doLike), doShare: String(doShare),
      doDir: String(doDir), doCall: String(doCall), doBook: String(doBook), doTalk: String(doTalk),
      doWish: String(doWish), doCart: String(doCart), doOption: String(doOption), device,
      fullFunnel: String(funnel),
      spreadHours: spread ? String(spreadHours) : "0",
      doReview: String(doReview), reviewText: doReview ? reviewText : "",
      visible: String(visible),
      actionRate: String(Math.max(0, Math.min(1, actionRate / 100))),
      dwellBaseSec: intensity === "fast" ? "20" : intensity === "deep" ? "180" : "60",
      dwellCustomSec: String(Math.max(0, maxDwellSec)),
    });
    if (userId) params.set("userId", userId);
    // 🔄 다계정 로테이션 — 선택된 계정들을 저장·찜·공감에 번갈아. 첫 계정을 기본 accountId로.
    const acctList = accounts.filter((a) => selectedAccts.has(a.id)).map((a) => a.id);
    if (acctList.length) { params.set("accountIds", JSON.stringify(acctList)); params.set("accountId", acctList[0]); }
    else if (accountId) params.set("accountId", accountId);
    if (targetType === "place") params.set("placeUrl", placeUrl.trim());
    else if (targetType === "store") params.set("storeUrl", storeUrl.trim());
    else if (parsedBlog) { params.set("blogId", parsedBlog.blogId); if (parsedBlog.logNo) params.set("logNo", parsedBlog.logNo); }
    // ➕ 추가 대상들(있으면 방문마다 로테이션) — 서버가 targets JSON을 받아 처리
    const extras = extraTargets.map((s) => s.trim()).filter(Boolean);
    if (extras.length) params.set("extraTargets", JSON.stringify(extras));
    // 🎯 키워드 비중(고급) — {키워드:가중치}
    const weights = kwList.map((k) => Number(kwWeights[k]) || 1);
    if (weights.some((w) => w !== 1)) params.set("keywordWeights", JSON.stringify(weights));

    // ── 시작 시 '적용된 설정'을 항목별로 로그에 남긴다(정말 이대로 시작되는지 눈으로 확인) ──
    const deviceLabel = device === "pc" ? "🖥️ PC" : device === "mix" ? "🔀 혼합(랜덤)" : "📱 모바일";
    const intensityLabel = intensity === "fast" ? "빠르게(~20초)" : intensity === "deep" ? "꼼꼼히(~3분)" : "보통(~60초)";
    const baseSecMap: Record<string, number> = { fast: 20, normal: 60, deep: 180 };
    const dwellSec = maxDwellSec > 0 ? maxDwellSec : (baseSecMap[intensity] ?? 60);
    const actionLabels = (targetType === "place"
      ? [doSave && "💾저장", doDir && "🧭길찾기", doCall && "📞전화", doBook && "📅예약", doTalk && "💬톡톡", doShare && "🔗공유"]
      : targetType === "store"
      ? [doOption && "🔍옵션탐색", doWish && "💚찜", doCart && "🛒장바구니", doShare && "🔗공유"]
      : [doLike && "💚공감", doShare && "🔗공유"]).filter(Boolean) as string[];
    const targetLabel = targetType === "place" ? "플레이스" : targetType === "store" ? "스마트스토어" : "블로그";
    pushLog(`━━━━━ 🚀 트래픽 유입 시작 · 적용된 설정 ━━━━━`);
    pushLog(`📍 대상: ${targetLabel} · 키워드 ${kwList.length}개 · ${n}회 방문`);
    pushLog(`📶 접속패턴(기기): ${deviceLabel}`);
    const actionSec = Math.round(actionLabels.length * 2.5);
    const totalSec = Math.round(dwellSec + actionSec);
    pushLog(`📖 체류시간: ${maxDwellSec > 0 ? `직접지정 약 ${maxDwellSec}초` : `${intensityLabel} 약 ${dwellSec}초`} (방문마다 ±오차)`);
    pushLog(`🎬 방문해서 할 행동: ${actionLabels.length ? `${actionLabels.join("  ")} — 약 ${actionSec}초 추가` : "없음(체류만)"}`);
    if (acctList.length > 1) pushLog(`🔄 다계정 로테이션: ${acctList.length}개 계정을 번갈아 로그인 — 저장·찜·공감이 계정마다 실행돼요`);
    else if (acctList.length === 1) pushLog(`👤 로그인 계정 1개 사용 (저장·찜·공감)`);
    pushLog(`⏳ 방문 텀: ${termMin}~${termMax}초 랜덤${spread ? ` · ${spreadHours}시간 분산` : ""}  ·  🎲 액션확률 ${actionRate}%`);
    pushLog(`⏱️ 예상 방문시간: 약 ${totalSec}초 (체류 ${dwellSec}초 + 행동 ${actionSec}초)`);
    if (funnel) pushLog(`🌀 풀퍼널 모드 ON — 여러 글·탭까지 둘러봐요`);
    if (auto) pushLog(`⚙️ 자동 모드 — 오늘 한도까지 실행`);
    if (apEnabled) pushLog(`🎯 오토파일럿 ON — "${apKeyword}" ${apGoal}위 목표`);
    // 🔒 프록시(IP) 사용 여부 — 서버 배정 상태를 조회해 로그로 확실히 알려준다
    (async () => {
      try {
        const acctList = accountId ? [accountId] : accounts.map((a) => a.id);
        const q = acctList.length ? `?accts=${encodeURIComponent(acctList.join(","))}` : "";
        const r = await botFetch(`${BOT}/api/my-proxy/${userId || "guest"}${q}`);
        const j = await r.json();
        pushLog(j.active
          ? `🔒 프록시 IP 사용 — 내 실제 IP를 가려서 안전하게 접속해요`
          : `🌐 프록시 미배정 — 내 IP 그대로 접속해요(관리자에게 프록시 배정 요청 가능)`);
      } catch { pushLog(`🌐 프록시 상태 확인 실패 — 봇 서버(3334)를 확인해주세요`); }
    })();
    pushLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    const es = new BotEventStream(`${BOT}/api/inflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publy-Session": getMemberSessionToken(), "X-Publy-Admin-Session": getAdminSessionToken() },
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
    const hasTarget = targetType === "place" ? !!placeUrl.trim() : targetType === "store" ? !!storeUrl.trim() : !!blogUrl.trim();
    if (!hasTarget) return { tone: "start", msg: `먼저 내 ${targetType === "place" ? "플레이스" : targetType === "store" ? "스마트스토어 상품" : "블로그 글"} 주소를 넣어주세요. 그럼 순위·유입까지 제가 챙겨드릴게요!` };
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
  // 🎨 실행패널 그룹 구분 헤더 — 묶이는 기능을 색으로 나눠 한눈에 구분(밋밋함 제거)
  const GroupHeader = ({ n, title, desc, color }: { n: string; title: string; desc: string; color: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", borderRadius: 12, background: `${color}14`, borderLeft: `5px solid ${color}`, marginTop: 4 }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: color, color: "#fff", fontSize: 14, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color }}>{title}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.sub, marginTop: 1 }}>{desc}</div>
      </div>
    </div>
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

      {/* ═══ 📝 팝업 A — 글 주소 직접 넣기(로그인 불필요) ═══ */}
      {postPopup === "manual" && (
        <div onClick={() => setPostPopup(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: C.panel, borderRadius: 18, border: `2px solid ${C.accent}`, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,.45)" }}>
            <div style={{ padding: "16px 18px", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff" }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>📝 글 주소 직접 넣기</div>
              <div style={{ fontSize: 12, fontWeight: 600, opacity: .92, marginTop: 2 }}>로그인 없이 · 원하는 글 링크를 넣어 그 글에 트래픽을 걸어요</div>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.6, marginBottom: 9, background: "rgba(16,133,107,.08)", border: "1.5px solid #16a34a", borderRadius: 10, padding: "9px 12px" }}>
                <b style={{ color: "#16a34a" }}>✅ 로그인 필요 없어요.</b> 글 주소만 있으면 방문·체류·읽기·공유가 돼요. <b>한 줄에 하나씩</b> 여러 개 넣으면 방문마다 번갈아 방문해요(로테이션).
              </div>
              <textarea value={manualPostUrls} onChange={(e) => setManualPostUrls(e.target.value)} rows={5}
                placeholder={"blog.naver.com/아이디/글번호\nblog.naver.com/아이디/글번호2\n... (한 줄에 하나씩)"}
                style={{ ...inputStyle, resize: "vertical", fontSize: 13, lineHeight: 1.6 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={() => setPostPopup(null)} style={{ flex: 1, padding: "12px", borderRadius: 11, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
                <button onClick={() => { const urls = manualPostUrls.split(/[\n,]/).map((s) => s.trim()).filter((s) => parseBlogUrl(s)); if (!urls.length) { toast("올바른 블로그 글 주소를 넣어주세요", "error"); return; } applyPostsAsTargets(urls); }} style={{ flex: 2, padding: "12px", borderRadius: 11, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>🎯 이 글들을 유입 대상으로</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 🔐 팝업 B — 로그인해서 내 글 불러오기 ═══ */}
      {postPopup === "login" && (
        <div onClick={() => setPostPopup(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: C.panel, borderRadius: 18, border: "2px solid #d97706", boxShadow: "0 24px 60px rgba(0,0,0,.45)" }}>
            <div style={{ padding: "16px 18px", background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#fff" }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>🔐 로그인해서 내 글 불러오기</div>
              <div style={{ fontSize: 12, fontWeight: 600, opacity: .92, marginTop: 2 }}>연결한 계정으로 내 글 목록을 불러와 골라서 트래픽을 걸어요</div>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.7, marginBottom: 11, background: "rgba(245,158,11,.10)", border: "1.5px solid #d97706", borderRadius: 10, padding: "10px 13px" }}>
                <b style={{ color: "#d97706" }}>🔑 로그인이 필요해요.</b> 내 글 목록은 로그인해야 볼 수 있어요.<br />
                <b>① 왼쪽 메뉴 맨 아래 ‘계정 관리’ 탭</b>으로 가서<br />
                <b>② 네이버 아이디·비밀번호로 계정을 연결(로그인)</b>한 뒤<br />
                <b>③ 다시 여기 와서 그 계정을 선택</b>하면 목록이 나와요. <span style={{ color: C.sub }}>(한 번 연결하면 다음부턴 비번 없이 바로)</span>
              </div>
              {/* 계정 선택 */}
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 6 }}>불러올 계정 (계정 관리에서 연결한 계정)</div>
              {accounts.length === 0 ? (
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", padding: "11px 13px", borderRadius: 10, background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.3)", lineHeight: 1.6 }}>⚠️ 아직 연결된 네이버 계정이 없어요.<br /><b>왼쪽 메뉴 ‘계정 관리’ 탭 → 네이버 아이디·비밀번호로 연결</b>한 뒤 다시 오세요.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {accounts.map((a) => { const on = popupAccountId === a.id; return (
                    <button key={a.id} onClick={() => setPopupAccountId(a.id)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 10, background: on ? C.glow : C.panel2, border: `1.5px solid ${on ? C.accent : C.line}`, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: on ? C.accent : C.line2, flexShrink: 0 }} />
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? C.accent : C.ink }}>{on ? "✓ " : ""}{a.username}</span>
                      {a.blog_name && <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>· {a.blog_name}</span>}
                    </button>
                  ); })}
                </div>
              )}
              <button onClick={() => collectMyPosts(popupAccountId)} disabled={!popupAccountId || myPostsLoading} style={{ width: "100%", marginTop: 11, padding: "12px", borderRadius: 11, border: "none", background: (popupAccountId && !myPostsLoading) ? "linear-gradient(135deg,#f59e0b,#d97706)" : C.line2, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: (popupAccountId && !myPostsLoading) ? "pointer" : "default", fontFamily: "inherit" }}>{myPostsLoading ? "불러오는 중…" : "📚 내 글 불러오기"}</button>

              {myPosts.length > 0 && (<div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <button onClick={selectAllPosts} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.glow, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>✅ 전체 선택</button>
                  <button onClick={clearSelectedPosts} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◻️ 전체 해제</button>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>선택 {selectedPosts.size}/{myPosts.length}개</span>
                </div>
                <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                  {myPosts.map((p) => { const on = selectedPosts.has(p.url); return (
                    <label key={p.url} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, background: on ? C.glow : C.panel2, border: `1px solid ${on ? C.accent : C.line}`, cursor: "pointer" }}>
                      <input type="checkbox" checked={on} onChange={() => togglePost(p.url)} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title || "(제목 없음)"}</div>
                        {p.date && <div style={{ fontSize: 10.5, color: C.sub, fontWeight: 600 }}>{p.date}</div>}
                      </div>
                    </label>
                  ); })}
                </div>
                <button onClick={applySelectedPostsAsTargets} disabled={!selectedPosts.size} style={{ width: "100%", marginTop: 10, padding: "12px", borderRadius: 11, border: "none", background: selectedPosts.size ? `linear-gradient(135deg,${C.accent},${C.cyan})` : C.line2, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: selectedPosts.size ? "pointer" : "default", fontFamily: "inherit" }}>🎯 선택한 {selectedPosts.size}개 글을 유입 대상으로</button>
              </div>)}
              <button onClick={() => setPostPopup(null)} style={{ width: "100%", marginTop: 8, padding: "10px", borderRadius: 11, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.sub, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>닫기</button>
            </div>
          </div>
        </div>
      )}

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
          { ico: "📍", title: "대상·키워드 넣기", desc: "내 플레이스(지도/naver.me)·블로그 글·스마트스토어 상품 주소를 붙여넣고, 검색 키워드를 여러 개 적어요(자동으로 인식돼요)." },
          { ico: "🎛️", title: "옵션 고르기", desc: "방문 횟수·텀·기기(모바일/PC)·할 행동(저장·길찾기·전화 등)을 정해요. 시간분산·액션확률로 더 자연스럽게." },
          { ico: "🚀", title: "유입 시작", desc: "‘유입 시작’을 누르면 방문마다 IP를 바꿔 안전 한도 안에서 돌아요. 진짜 손님처럼 검색결과를 먼저 비교하고, 완급을 두어 읽고(관심 구간 정독·위로 재확인) 자연스럽게 행동해요. 라이브 로그로 전 과정을 볼 수 있어요." },
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
        <GroupHeader n="1" color="#2563eb" title="어디에 · 무엇으로 검색" desc="유입할 대상(플레이스·블로그·스토어)과 검색 키워드를 정해요" />
        {/* 대상 */}
        <div>
          <label style={labelStyle}>어디로 유입시킬까요?</label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["place", "🗺️ 플레이스"], ["blog", "📝 블로그"], ["store", "🛒 스마트스토어"]] as const).map(([k, lb]) => (
              <button key={k} onClick={() => setTargetType(k)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `2px solid ${targetType === k ? C.accent : C.line2}`, background: targetType === k ? C.glow : C.panel2, color: targetType === k ? C.accent : C.sub, fontSize: 14.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
            ))}
          </div>
        </div>

        {/* 대상 입력 + 이름 붙여 저장 */}
        <div>
          <label style={labelStyle}>{targetType === "place" ? "내 플레이스 주소" : targetType === "store" ? "내 스마트스토어 상품 주소" : "내 블로그 글 주소"}</label>
          <input
            value={targetType === "place" ? placeUrl : targetType === "store" ? storeUrl : blogUrl}
            onChange={(e) => { const v = e.target.value; const det = detectTargetType(v);
              if (targetType === "place") { setPlaceUrl(v); if (det === "blog") { setBlogUrl(v); setTargetType("blog"); toast("블로그 주소로 인식했어요", "info"); } else if (det === "store") { setStoreUrl(v); setTargetType("store"); toast("스마트스토어 주소로 인식했어요", "info"); } }
              else if (targetType === "store") { setStoreUrl(v); if (det === "place") { setPlaceUrl(v); setTargetType("place"); toast("플레이스 주소로 인식했어요", "info"); } else if (det === "blog") { setBlogUrl(v); setTargetType("blog"); toast("블로그 주소로 인식했어요", "info"); } }
              else { setBlogUrl(v); if (det === "place") { setPlaceUrl(v); setTargetType("place"); toast("플레이스 주소로 인식했어요", "info"); } else if (det === "store") { setStoreUrl(v); setTargetType("store"); toast("스마트스토어 주소로 인식했어요", "info"); } } }}
            placeholder={targetType === "place" ? "지도/플레이스/naver.me 링크 붙여넣기" : targetType === "store" ? "smartstore.naver.com/스토어/products/상품번호" : "글 주소/아이디 (blog.naver.com/아이디/글번호)"}
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
          {targetType === "store" && storeUrl.trim() && (parseStoreUrl(storeUrl)
            ? <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>✅ 인식됨 — 스토어 {parseStoreUrl(storeUrl)!.storeId || "?"}{parseStoreUrl(storeUrl)!.productId ? " / 상품 " + parseStoreUrl(storeUrl)!.productId : ""}</div>
            : <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>⚠️ 주소를 못 읽었어요 — smartstore.naver.com/스토어/products/상품번호 형태로 붙여넣어 주세요</div>)}

          {/* 📚 블로그 글 지정 유입 — 3가지 방법(주소만=랜덤 / 글주소 직접 / 로그인해서 내 글) 컬러 그룹 */}
          {targetType === "blog" && (
            <div style={{ marginTop: 12, padding: 14, borderRadius: 16, background: "linear-gradient(135deg,rgba(16,133,107,.06),transparent)", border: "2px solid #16a34a" }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: "#16a34a", marginBottom: 4 }}>📚 어느 글에 트래픽을 넣을까요?</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, lineHeight: 1.6, marginBottom: 11 }}>
                • <b style={{ color: C.ink }}>위 주소만</b> 넣으면 → 그 블로그의 <b>여러 글에 랜덤</b>으로 방문해요 <span style={{ color: "#16a34a", fontWeight: 800 }}>(로그인 X)</span><br />
                • <b style={{ color: C.ink }}>특정 글</b>만 노리려면 아래 두 방법으로 골라요 👇
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setPostPopup("manual")} style={{ flex: 1, minWidth: 180, padding: "13px", borderRadius: 12, border: `2px solid ${C.accent}`, background: C.panel, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: C.accent }}>📝 글 주소 직접 넣기</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.sub, marginTop: 2 }}>로그인 없이 · 글 링크를 붙여넣기</div>
                </button>
                <button onClick={() => setPostPopup("login")} style={{ flex: 1, minWidth: 180, padding: "13px", borderRadius: 12, border: `2px solid #d97706`, background: C.panel, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: "#d97706" }}>🔐 로그인해서 내 글 불러오기</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.sub, marginTop: 2 }}>연결한 계정으로 · 내 글 목록에서 선택</div>
                </button>
              </div>
              {pickedPostCount > 0 && (
                <div style={{ marginTop: 10, padding: "9px 13px", borderRadius: 10, background: C.glow, border: `1.5px solid ${C.accent}`, fontSize: 12.5, fontWeight: 800, color: C.accent, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  ✅ 지정된 글 <b>{pickedPostCount}개</b>에 유입 예정 — 아래 '유입 시작'을 누르세요
                  <button onClick={() => { setExtraTargets([]); setPickedPostCount(0); toast("지정 글 해제 — 주소의 랜덤 글로 돌아갔어요", "info"); }} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 7, border: `1px solid ${C.line2}`, background: C.panel, color: C.sub, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>해제</button>
                </div>
              )}
            </div>
          )}

          {/* 이름 + 저장 버튼 */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input value={savingName} onChange={(e) => setSavingName(e.target.value)} placeholder={targetType === "place" ? "이 플레이스 이름 (예: 강남점)" : targetType === "store" ? "이 상품 이름 (예: 홍삼 세트)" : "이 블로그 이름"} style={{ ...inputStyle, flex: 1 }} />
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
          <label style={labelStyle}>➕ 추가 대상 <span style={{ color: C.sub, fontWeight: 600 }}>(선택 — 위 대상 말고 더 유입할 곳)</span></label>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6, marginBottom: 8, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 11px" }}>
            💡 여러 곳을 <b>한 번에</b> 유입하고 싶을 때 써요. 여기에 넣은 주소들을 <b>위 대상과 번갈아(로테이션)</b> 방문해요. {targetType === "store" ? "예: 상품 여러 개를 동시에" : targetType === "blog" ? "예: 글 여러 개를 동시에" : "예: 매장 여러 곳을 동시에"} 올리고 싶을 때. <b>안 넣어도 돼요.</b>
          </div>
          {extraTargets.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={t} onChange={(e) => setExtraTargets((arr) => arr.map((x, j) => j === i ? e.target.value : x))} placeholder={targetType === "store" ? "스마트스토어 상품 주소" : targetType === "blog" ? "블로그 글 주소" : "플레이스 주소"} style={{ ...inputStyle, flex: 1 }} />
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
          <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={targetType === "store" ? "예) 홍삼 스틱, 산양삼 선물세트, 6년근 홍삼" : targetType === "blog" ? "예) 강남 맛집 후기, 부업 추천, 블로그 체험단" : "예) 강남 맛집, 강남역 삼겹살, 역삼동 고깃집"} rows={2} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
          <div style={{ fontSize: 11, fontWeight: 600, color: C.sub, marginTop: 4 }}>🔒 키워드는 {targetType === "store" ? "스마트스토어" : targetType === "blog" ? "블로그" : "플레이스"} 전용으로 따로 저장돼요 — 대상을 바꿔도 서로 섞이지 않아요.</div>
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

        <GroupHeader n="2" color="#7c3aed" title="어떻게 방문할까 (자연스럽게)" desc="접속 기기·방문 텀·횟수·체류시간·액션 확률 — 진짜 손님처럼" />
        {/* 기기 */}
        <div>
          <label style={labelStyle}>접속 기기 <span style={{ color: C.sub, fontWeight: 600 }}>(기본 모바일 — 안 바꿔도 돼요)</span></label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["mobile", "📱 모바일"], ["pc", "🖥️ PC"], ["mix", "🔀 혼합(랜덤)"]] as const).map(([k, lb]) => (
              <button key={k} onClick={() => { setDevice(k); toast(`📶 접속패턴 '${lb}' 선택됨`, "success"); }} style={{ flex: 1, padding: "11px", borderRadius: 12, border: `2px solid ${device === k ? C.accent : C.line2}`, background: device === k ? C.glow : C.panel2, color: device === k ? C.accent : C.sub, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{device === k ? "✓ " : ""}{lb}</button>
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
              {([["fast", "빠르게 ~20초"], ["normal", "보통 ~60초"], ["deep", "꼼꼼히 ~3분"]] as const).map(([k, lb]) => {
                const on = intensity === k && maxDwellSec === 0; // 직접지정 중이면 강도 버튼은 꺼진 표시
                return (
                <button key={k} onClick={() => { setIntensity(k); setMaxDwellSec(0); setDwellDraft("30"); toast(`📖 체류강도 '${lb}' 선택됨`, "success"); }} style={{ flex: 1, padding: "11px", borderRadius: 10, border: `2px solid ${on ? C.accent : C.line2}`, background: on ? C.glow : C.panel2, color: on ? C.accent : C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{on ? "✓ " : ""}{lb}</button>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>⏱️ 체류시간 직접지정(초) {maxDwellSec > 0 ? <span style={{ color: C.accent, fontWeight: 800 }}>✓ {maxDwellSec}초 사용 중</span> : <span style={{ color: C.sub, fontWeight: 600 }}>(강도 대신 직접)</span>}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" min={0} value={dwellDraft}
                onChange={(e) => setDwellDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { const v = Math.max(0, Number(dwellDraft) || 0); setMaxDwellSec(v); toast(v > 0 ? `⏱️ 체류시간 ${v}초로 설정됨 (강도 해제)` : "체류강도 선택으로 돌아왔어요", v > 0 ? "success" : "info"); } }}
                placeholder="예: 300 = 5분" style={{ ...inputStyle, flex: 1, textAlign: "center", border: `2px solid ${maxDwellSec > 0 ? C.accent : C.line2}`, background: maxDwellSec > 0 ? C.glow : C.panel2 }} />
              <button onClick={() => { const v = Math.max(0, Number(dwellDraft) || 0); setMaxDwellSec(v); toast(v > 0 ? `⏱️ 체류시간 ${v}초로 설정됨 (강도 해제)` : "체류강도 선택으로 돌아왔어요", v > 0 ? "success" : "info"); }}
                style={{ padding: "0 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>설정</button>
            </div>
            <div style={{ fontSize: 11, color: maxDwellSec > 0 ? C.accent : C.sub, fontWeight: 700, marginTop: 3 }}>{maxDwellSec > 0 ? `이 시간(약 ${maxDwellSec}초)으로 체류 · 강도 버튼은 꺼짐` : "값을 넣으면 강도 무시하고 그 시간으로(3분↑ 가능)"}</div>
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

        {/* 💡 체류·행동 시간 계산법 — 사용자가 머리 안 굴려도 알게 눈에 잘 보이게 */}
        <div style={{ background: `linear-gradient(135deg,${C.glow},transparent)`, border: `1.5px solid ${C.accent}`, borderRadius: 14, padding: "13px 16px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: C.accent, marginBottom: 7 }}>💡 방문시간은 이렇게 정해져요</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.75 }}>
            • <b>체류시간</b> = 빠르게 <b>20초</b> · 보통 <b>60초</b> · 꼼꼼히 <b>180초</b> <span style={{ color: C.sub }}>(방문마다 ±오차로 자연스럽게)</span><br />
            • 더 오래 보게 하려면 <b>체류시간 직접지정</b>에 초 입력 <span style={{ color: C.sub }}>(예: 300 = 5분, 강도 무시)</span><br />
            • <b>방문행동</b>(저장·길찾기 등)은 <b>행동당 약 2~3초</b>씩 체류시간 위에 더해져요
          </div>
          <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: C.panel2, border: `1px solid ${C.line}`, fontSize: 13, fontWeight: 800, color: C.ink }}>
            👉 총 방문시간 = 체류시간 + 행동시간(행동 수 × 2~3초)
          </div>
        </div>

        <GroupHeader n="3" color="#16a34a" title="방문해서 할 행동" desc="저장·길찾기·전화·찜 등 — 🔑 표시는 로그인 필요, 나머지는 계정 없이 OK" />
        {/* 액션 */}
        <div>
          <label style={labelStyle}>방문해서 할 행동 <span style={{ color: C.sub, fontWeight: 600 }}>{targetType === "place" ? "(길찾기·전화·예약이 순위에 가장 강해요)" : ""}</span></label>
          {/* 🔑 로그인 필요 액션 안내 — 버튼 바로 위에 잘 보이게 */}
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "rgba(245,158,11,.10)", border: "1.5px solid #f59e0b", borderRadius: 12, padding: "10px 13px", marginBottom: 10 }}>
            <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>🔑</span>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.6 }}>
              {targetType === "place" ? (
                <>
                  <b style={{ color: "#16a34a" }}>✅ 로그인 없이 가능(주소만):</b> 검색→클릭→체류·스크롤(방문 트래픽) · 🧭 길찾기 · 📞 전화 · 📅 예약 · 💬 톡톡 · 🔗 공유. <b>여기까지가 순위에 강한 방문·관심 신호</b>라 계정 없이도 순위를 올릴 수 있어요.<br />
                  <b style={{ color: "#d97706" }}>🔑 로그인 필요(저장 💾만):</b> 저장은 <b>내 네이버 계정의 저장목록(MY플레이스)</b>에 넣는 거라 로그인이 꼭 필요해요. 저장까지 원하면 <b>계정 관리</b>에서 계정 연결 후 유입 시작 때 <b>그 계정을 선택</b>하세요. (저장 안 켜면 계정 없이 진행)
                </>
              ) : targetType === "store" ? (
                <>
                  <b style={{ color: "#16a34a" }}>✅ 로그인 없이 가능(상품 주소만):</b> 쇼핑 검색→클릭→상품 상세 체류·스크롤 · 🔍 옵션·상세 탐색 · 🔗 공유. <b>여기까지가 쇼핑 순위에 도움되는 방문·관심 신호</b>라 계정 없이도 순위 작업이 돼요.<br />
                  <b style={{ color: "#d97706" }}>🔑 로그인 필요(찜 💚·장바구니 🛒):</b> 찜·장바구니는 <b>내 네이버 계정</b>에 담는 거라 로그인이 필요해요. 원하면 <b>계정 관리</b>에서 계정 연결 후 <b>그 계정을 선택</b>하세요. (안 켜면 계정 없이 진행)
                </>
              ) : (
                <>
                  <b style={{ color: "#16a34a" }}>✅ 로그인 없이 가능(글 주소·아이디만):</b> 검색→클릭→글 전체 읽기 체류·다른 글 둘러보기(풀퍼널) · 🔗 공유 · <b>📚 내 글 수집</b>도 로그인 없이 아이디만으로 돼요. <b>여기까지가 블로그 지수·순위에 도움되는 신호</b>예요.<br />
                  <b style={{ color: "#d97706" }}>🔑 로그인 필요(공감 💚만):</b> 공감(좋아요)은 <b>내 네이버 계정으로 누르는 것</b>이라 로그인이 필요해요. 원하면 <b>계정 관리</b>에서 계정 연결 후 <b>그 계정을 선택</b>하세요. (공감 안 켜면 계정 없이 진행)
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {targetType === "place" ? (<>
              <ActionChk v={doSave} set={setDoSave} label="💾 저장 🔑" />
              <ActionChk v={doDir} set={setDoDir} label="🧭 길찾기" />
              <ActionChk v={doCall} set={setDoCall} label="📞 전화" />
              <ActionChk v={doBook} set={setDoBook} label="📅 예약" />
              <ActionChk v={doTalk} set={setDoTalk} label="💬 톡톡" />
              <ActionChk v={doShare} set={setDoShare} label="🔗 공유" />
            </>) : targetType === "store" ? (<>
              <ActionChk v={doOption} set={setDoOption} label="🔍 옵션·상세 탐색" />
              <ActionChk v={doWish} set={setDoWish} label="💚 찜 🔑" />
              <ActionChk v={doCart} set={setDoCart} label="🛒 장바구니 🔑" />
              <ActionChk v={doShare} set={setDoShare} label="🔗 공유" />
            </>) : (<>
              <ActionChk v={doLike} set={setDoLike} label="💚 공감 🔑" />
              <ActionChk v={doShare} set={setDoShare} label="🔗 공유" />
            </>)}
            <ActionChk v={auto} set={setAuto} label="⚙️ 자동(오늘 한도까지)" />
            <ActionChk v={visible} set={setVisible} label="🪟 창 보기(테스트)" />
          </div>
        </div>

        <GroupHeader n="⚙️" color="#64748b" title="고급 · 더 자연스럽게 (선택)" desc="키워드 비중·시간 분산·풀퍼널 — 몰라도 되지만 켜면 봇 티가 줄어요" />
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
            <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>{targetType === "place" ? "메뉴·사진·리뷰까지 둘러봐 체류·조회를 극대화 (진짜 손님처럼)" : targetType === "store" ? "상세정보·리뷰·연관상품까지 둘러봐 체류·조회를 극대화 (진짜 구매 고민 손님처럼)" : "이 블로그 다른 글도 2~3개 읽고 이웃까지 — 체류·페이지뷰·이웃 폭발"}</div>
          </div>
        </label>

        {/* 🔄 다계정 로테이션 — 저장·찜·공감을 여러 계정으로 번갈아(계정 수만큼 증가). 로그인 액션 켤 때만 의미 */}
        {accounts.length > 0 && (
          <div style={{ padding: 13, borderRadius: 14, background: "linear-gradient(135deg,rgba(245,158,11,.07),transparent)", border: "2px solid #f59e0b" }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: "#d97706", marginBottom: 3 }}>🔄 저장·찜·공감에 쓸 계정 (다계정 로테이션)</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6, marginBottom: 10 }}>
              선택한 계정을 <b>방문마다 번갈아 로그인</b>해서 저장·찜·공감을 눌러요. <b style={{ color: "#d97706" }}>계정 수만큼 저장·찜 수가 올라가요</b>(같은 계정은 1번만 유효). 각 계정은 자기 IP(프록시)로 접속해 안전해요. <span style={{ color: C.sub }}>※ 저장·찜·공감을 안 켜면 계정 없이도 방문 트래픽은 돼요.</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <button onClick={() => setSelectedAccts(new Set(accounts.map((a) => a.id)))} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.glow, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>✅ 전체 설정</button>
              <button onClick={() => setSelectedAccts(new Set())} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${C.line2}`, background: C.panel, color: C.sub, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◻️ 전체 해제</button>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>선택 {selectedAccts.size}/{accounts.length}개</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 180, overflowY: "auto" }}>
              {accounts.map((a) => { const on = selectedAccts.has(a.id); return (
                <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", borderRadius: 9, background: on ? C.glow : C.panel2, border: `1px solid ${on ? C.accent : C.line}`, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => setSelectedAccts((prev) => { const n = new Set(prev); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? C.accent : C.ink }}>{on ? "✓ " : ""}{a.blog_name || a.username}</span>
                </label>
              ); })}
            </div>
          </div>
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
          { k: "현재 순위", v: apLastRank != null ? `${apLastRank}` : apRankOut ? "30+" : "—", sub: apEnabled ? `목표 ${apGoal}위` : "위", col: "#16a34a" },
          { k: chartDays >= 365 ? "전체 누적" : `최근 ${chartDays}일`, v: `${weekTotal}`, sub: "누적 방문", col: C.cyan },
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
                      방문자리뷰 <b style={{color:C.ink}}>{c.review.toLocaleString()}</b> · 블로그리뷰 <b style={{color:C.ink}}>{c.blog.toLocaleString()}</b>
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

      {/* 📅 기간 선택 — 유입·순위·누적을 원하는 기간으로(과거 기록까지). 플레이스·블로그 공통 */}
      <div style={{ order: 10, display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.sub }}>📅 기간</span>
        {([[7, "7일"], [30, "30일"], [90, "90일"], [365, "전체"]] as const).map(([d, lb]) => (
          <button key={d} onClick={() => { setChartDays(d); toast(`📅 ${lb} 데이터로 봐요`, "success"); }} style={{ padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${chartDays === d ? C.accent : C.line2}`, background: chartDays === d ? C.glow : C.panel2, color: chartDays === d ? C.accent : C.sub, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{chartDays === d ? "✓ " : ""}{lb}</button>
        ))}
        <span style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginLeft: 4 }}>과거 기록까지 조회 · 앱을 껐다 켜도 유지돼요</span>
      </div>

      {/* ── 그래프 2단: 유입 추이 + 순위 변동 ── */}
      <div style={{ order: 11, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginBottom: 14 }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📈 {chartDays >= 365 ? "전체" : `최근 ${chartDays}일`} 유입 추이</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>총 {weekTotal}회</span>
        </div>
        {history.length > 0 ? <AreaChart data={history} C={C} /> : <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 12.5, fontWeight: 600 }}>데이터가 쌓이면 그래프가 그려져요</div>}
        {chartDays <= 31 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.sub, fontWeight: 700, padding: "0 2px" }}>
          {history.map((d) => <span key={d.label}>{d.label}</span>)}
        </div>}
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
          <div style={{ flex: "1 1 190px", minWidth: 190 }}>
            <label style={labelStyle}>매일 실행 시각</label>
            <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} style={{ ...inputStyle, textAlign: "center", minWidth: 0, width: "100%" }} />
          </div>
          <div style={{ flex: "0 1 120px", minWidth: 100 }}>
            <label style={labelStyle}>방문 횟수</label>
            <input type="number" min={1} value={schedRounds} onChange={(e) => setSchedRounds(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, textAlign: "center", minWidth: 0, width: "100%" }} />
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
