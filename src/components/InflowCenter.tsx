import { useState, useRef, useEffect } from "react";
import { BotEventStream } from "../lib/botApi";
import UsageGuide from "./UsageGuide";
import { INFLOW_DAILY_LIMIT, PLAN_CONFIG, getInflowDailyUsage, getInflowUsageHistory, getAccounts, PublyAccount, getAutopilot, saveAutopilot, getRankHistory, AutopilotConfig, getInflowSchedule, saveInflowSchedule, inflowScheduleRanToday, markInflowScheduleRan, getPerfReport, PerfReport } from "../lib/supabase";

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

  // 🔁 탭을 옮겨도 입력값이 사라지지 않게 — 폼 상태를 localStorage에 저장/복원
  const formKey = `publy_inflow_form_${userId || "guest"}`;
  const saved0: any = (() => { try { return JSON.parse(localStorage.getItem(`publy_inflow_form_${userId || "guest"}`) || "{}"); } catch { return {}; } })();
  const [targetType, setTargetType] = useState<"place" | "blog">(saved0.targetType ?? "place");
  const [placeUrl, setPlaceUrl] = useState<string>(saved0.placeUrl ?? "");
  const [blogUrl, setBlogUrl] = useState<string>(saved0.blogUrl ?? "");
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
  const [extraTargets, setExtraTargets] = useState<string[]>(saved0.extraTargets ?? []); // ➕ 추가 대상(주소 목록)
  const [advOpen, setAdvOpen] = useState(false);       // ⚙️ 고급 설정 펼침
  const [kwWeights, setKwWeights] = useState<Record<string, number>>(saved0.kwWeights ?? {}); // 키워드별 비중
  const [visible, setVisible] = useState(false); // 🪟 창 보기(테스트) — 저장 안 함(안전상 매번 꺼짐)
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
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
  // ⏰ 예약 실행
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedTime, setSchedTime] = useState("10:00");
  const [schedRounds, setSchedRounds] = useState(10);
  type ConversionSnapshot={date:string;source:string;keyword:string;rank:number|null;calls:number;bookings:number;talks:number;coupons:number;memo:string};
  const conversionKey=`publy_inflow_conversions_${userId||"guest"}`;
  const [campaignSource,setCampaignSource]=useState("네이버 블로그");
  const [calls,setCalls]=useState(0);
  const [bookings,setBookings]=useState(0);
  const [talks,setTalks]=useState(0);
  const [coupons,setCoupons]=useState(0);
  const [conversionMemo,setConversionMemo]=useState("");
  const [snapshots,setSnapshots]=useState<ConversionSnapshot[]>(()=>{try{return JSON.parse(localStorage.getItem(`publy_inflow_conversions_${userId||"guest"}`)||"[]");}catch{return[];}});
  const [weeklyPlan,setWeeklyPlan]=useState<string[]>([]);
  const esRef = useRef<BotEventStream | null>(null);
  const startRef = useRef<() => void>(() => {});
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const pushLog = (m: string) => setLogs((l) => [...l, m]);
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
  // 주간/월간 토글 바뀌면 리포트 다시 로드
  useEffect(() => { if (userId) getPerfReport(userId, reportPeriod).then(setReport).catch(() => {}); }, [userId, reportPeriod]);

  // 🩺 플레이스 최적화 진단 실행(현재 입력된 플레이스 주소 기준)
  const runDiagnose = async () => {
    if (targetType !== "place" || !placeUrl.trim()) { toast("먼저 플레이스 주소를 입력하세요", "error"); return; }
    setDiagLoading(true); setDiag(null);
    try {
      const r = await fetch(`${BOT}/api/place-diagnose?placeUrl=${encodeURIComponent(placeUrl.trim())}`);
      const j = await r.json();
      if (j.error) { toast(j.error, "error"); }
      else { setDiag(j); toast(`최적화 점수 ${j.score}점`, "success"); }
    } catch { toast("진단 실패 — 봇 서버(3334)를 확인하세요", "error"); }
    finally { setDiagLoading(false); }
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
      await markInflowScheduleRan(userId);
      pushLog(`⏰ 예약 시각(${schedTime}) 도달 — 자동 실행 시작`);
      if (!auto) setRounds(schedRounds);
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

  // 🔁 폼 입력값 저장(탭 이동해도 유지). 무거운 것(로그·계정목록)은 제외.
  useEffect(() => {
    try {
      localStorage.setItem(formKey, JSON.stringify({
        targetType, placeUrl, blogUrl, keywords, rounds, termMin, termMax, device,
        doSave, doShare, doDir, doCall, doBook, doTalk, doLike, funnel, spread, spreadHours, doReview, reviewText, auto, actionRate, intensity, extraTargets, kwWeights,
      }));
    } catch {}
  }, [formKey, targetType, placeUrl, blogUrl, keywords, rounds, termMin, termMax, device, doSave, doShare, doDir, doCall, doBook, doTalk, doLike, funnel, spread, spreadHours, doReview, reviewText, auto, actionRate, intensity, extraTargets, kwWeights]);

  const copyLogs = () => {
    if (!logs.length) return;
    navigator.clipboard.writeText(logs.join("\n")).then(() => toast("로그 전체를 복사했어요", "success")).catch(() => toast("복사 실패", "error"));
  };

  const totalConversions=calls+bookings+talks+coupons;
  const previousSnapshot=snapshots.length>1?snapshots[snapshots.length-2]:null;
  const latestSnapshot=snapshots.length?snapshots[snapshots.length-1]:null;
  const primaryKeyword=()=>String(apKeyword||keywords.split(",")[0]||"").trim();
  const makeWeeklyPlan=()=>{
    const mainKeyword=primaryKeyword();
    const target=targetType==="place"?placeUrl.trim():blogUrl.trim();
    if(!mainKeyword||!target){toast("대상 주소와 대표 키워드를 먼저 입력하세요","error");return;}
    const next:string[]=[];
    if(apLastRank==null)next.push(`오늘 '${mainKeyword}' 실제 순위를 먼저 측정해 기준점을 저장하세요.`);
    else if(apLastRank>apGoal)next.push(`현재 ${apLastRank}위 → 목표 ${apGoal}위: 검색 의도에 맞는 제목·대표 이미지를 우선 개선하세요.`);
    else next.push("목표 순위 달성 중: 제목을 자주 바꾸지 말고 전화·예약 전환 안내를 보강하세요.");
    next.push(totalConversions===0?"전화·예약·톡톡 중 가장 중요한 행동 하나를 본문과 첫 화면에 또렷하게 안내하세요.":`확인된 실제 전환 ${totalConversions}건: 가장 많이 발생한 행동을 다음 콘텐츠의 핵심 안내로 재사용하세요.`);
    next.push(`7일 뒤 ${new Date(Date.now()+7*86400000).toLocaleDateString("ko-KR")}에 같은 키워드 순위와 실제 전환을 다시 기록하세요.`);
    setWeeklyPlan(next);toast("이번 주 원클릭 처방을 만들었어요","success");
  };
  const saveConversionSnapshot=()=>{
    const item:ConversionSnapshot={date:new Date().toISOString(),source:campaignSource,keyword:primaryKeyword(),rank:apLastRank,calls,bookings,talks,coupons,memo:conversionMemo.trim()};
    const next=[...snapshots,item].slice(-52);setSnapshots(next);localStorage.setItem(conversionKey,JSON.stringify(next));
    toast(`실제 전환 ${totalConversions}건을 기준점으로 저장했어요`,"success");
  };
  const copyTrackingLink=()=>{
    const raw=(targetType==="place"?placeUrl:blogUrl).trim();if(!raw){toast("대상 주소를 먼저 입력하세요","error");return;}
    try{const u=new URL(raw);u.searchParams.set("utm_source",campaignSource.replace(/\s+/g,"_").toLowerCase());u.searchParams.set("utm_medium","publy");u.searchParams.set("utm_campaign",(primaryKeyword()||"traffic").replace(/\s+/g,"_"));navigator.clipboard.writeText(u.toString());toast("채널 구분용 추적 링크를 복사했어요","success");}catch{toast("올바른 주소를 입력하세요","error");}
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
      intensity: intensity === "fast" ? "0.5" : intensity === "deep" ? "1.8" : "1",
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
    const es = new BotEventStream(`${BOT}/api/inflow?${params.toString()}`);
    esRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "progress") { setProgress(Math.round((d.done / Math.max(1, d.total)) * 100)); }
      else if (d.type === "quota_info") setUsed(d.used);
      else if (d.type === "quota_exceeded") { pushLog("🛑 오늘 유입 한도를 다 썼어요"); toast("오늘 유입 한도 초과", "error"); setRunning(false); es.close(); esRef.current = null; }
      else if (d.type === "inflow_done") { setSessOk(d.success || 0); pushLog(`🏁 완료 — 총 ${d.done}회 방문, 성공 ${d.success}회`); toast(`유입 완료 · 성공 ${d.success}회`, "success"); setRunning(false); es.close(); esRef.current = null; refreshStats(); }
      else if (d.type === "error") { pushLog(`❌ ${d.msg}`); toast(d.msg, "error"); setRunning(false); es.close(); esRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류 — 봇 서버(포트 3334)가 켜져 있는지 확인해주세요"); toast("봇 연결 오류", "error"); setRunning(false); es.close(); esRef.current = null; };
    es.onclose = () => setRunning(false);
  };
  startRef.current = start;
  const stop = () => { esRef.current?.close(); esRef.current = null; setRunning(false); pushLog("⏹️ 사용자가 정지했어요"); };

  const pct = unlimited ? 0 : Math.min(100, (used / Math.max(1, limit)) * 100);
  const weekTotal = history.reduce((s, d) => s + d.count, 0);
  const inputStyle: React.CSSProperties = { width: "100%", padding: "13px 14px", borderRadius: 12, border: `1.5px solid ${C.line2}`, background: C.panel2, color: C.ink, fontSize: 15, fontWeight: 600, fontFamily: "inherit", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 8, display: "block" };
  const chk: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 700, color: C.ink, padding: "8px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel2 };

  const ActionChk = ({ v, set, label }: { v: boolean; set: (b: boolean) => void; label: string }) => (
    <label style={{ ...chk, borderColor: v ? C.accent : C.line, background: v ? C.glow : C.panel2 }}>
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} style={{ width: 17, height: 17, accentColor: C.accent }} />{label}
    </label>
  );

  return (
    <div style={{ fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif", color: C.ink }}>
      {/* ── 헤더 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 12, fontWeight: 900, padding: "5px 10px", borderRadius: 8, letterSpacing: 0.5 }}>NEW</span>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>트래픽 유입</h2>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: C.sub, border: `1px solid ${C.line2}`, padding: "3px 9px", borderRadius: 6 }}>CONTROL TOWER</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: running ? "#16a34a" : C.sub }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: running ? "#22c55e" : C.sub, boxShadow: running ? "0 0 8px #22c55e" : "none" }} />{running ? "가동 중" : "대기"}
        </span>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 13.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>
        실행 횟수와 실제 고객 성과를 분리해 확인해요. 최종 성과는 <b style={{color:C.accent}}>순위·전화·예약·톡톡·쿠폰</b>으로 판정합니다.
      </p>

      {/* 👣 사용방법 안내 */}
      <UsageGuide theme={theme} accent={C.accent}
        subtitle="펄리예요! 키워드로 검색해 내 플레이스·블로그로 진짜 손님처럼 유입시키고, 순위가 오르려면 뭘 채워야 하는지 진단까지 해드려요."
        steps={[
          { ico: "📍", title: "대상·키워드 넣기", desc: "내 플레이스(지도/naver.me) 또는 블로그 글 주소를 붙여넣고, 검색 키워드를 여러 개 적어요(자동으로 인식돼요)." },
          { ico: "🎛️", title: "옵션 고르기", desc: "방문 횟수·텀·기기(모바일/PC)·할 행동(저장·길찾기·전화 등)을 정해요. 시간분산·액션확률로 더 자연스럽게." },
          { ico: "🚀", title: "유입 시작", desc: "‘유입 시작’을 누르면 방문마다 IP를 바꿔 안전 한도 안에서 돌아요. 라이브 로그로 전 과정을 볼 수 있어요." },
          { ico: "🩺", title: "성과·진단 확인", desc: "성과 리포트(주간/월간)로 순위·유입 변화를 보고, ‘플레이스 진단’으로 부족한 곳을 찾아 채우면 순위가 더 잘 올라요." },
        ]} />

      {/* ── KPI 카드 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 14 }}>
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

      {/* ── 실제 성과·전환 센터 ── */}
      <div style={{background:`linear-gradient(135deg,${C.panel},${C.glow})`,border:`2px solid ${C.accent}`,borderRadius:18,padding:18,marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap",marginBottom:12}}><span style={{fontSize:16,fontWeight:900}}>🎯 실제 성과 센터</span><span style={{fontSize:10,fontWeight:900,padding:"3px 8px",borderRadius:8,background:"#16a34a",color:"#fff"}}>방문수와 분리 측정</span><span style={{fontSize:12,color:C.sub}}>7일 전후 순위와 고객 행동으로 효과를 확인해요.</span></div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(135px,1fr))",gap:8,marginBottom:12}}>
          <div><label style={labelStyle}>유입 출처</label><select value={campaignSource} onChange={e=>setCampaignSource(e.target.value)} style={inputStyle}>{["네이버 블로그","네이버 플레이스","인스타그램","카카오톡","문자·QR","기타"].map(v=><option key={v}>{v}</option>)}</select></div>
          {[["전화",calls,setCalls],["예약",bookings,setBookings],["톡톡·문의",talks,setTalks],["쿠폰·구매",coupons,setCoupons]].map(([label,value,setter]:any)=><div key={label}><label style={labelStyle}>{label}</label><input type="number" min={0} value={value} onChange={e=>setter(Math.max(0,Number(e.target.value)))} style={{...inputStyle,textAlign:"center"}}/></div>)}
        </div>
        <input value={conversionMemo} onChange={e=>setConversionMemo(e.target.value)} placeholder="매출, 문의 내용, 특이사항을 선택적으로 기록" style={{...inputStyle,marginBottom:10}}/>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button onClick={saveConversionSnapshot} style={{padding:"11px 15px",border:0,borderRadius:11,background:C.accent,color:"#fff",fontWeight:900,cursor:"pointer",fontFamily:"inherit"}}>💾 오늘 실제 성과 저장</button><button onClick={copyTrackingLink} style={{padding:"11px 15px",border:`1.5px solid ${C.line2}`,borderRadius:11,background:C.panel,color:C.accent,fontWeight:900,cursor:"pointer",fontFamily:"inherit"}}>🔗 출처 추적 링크 복사</button><button onClick={makeWeeklyPlan} style={{padding:"11px 15px",border:0,borderRadius:11,background:"linear-gradient(135deg,#7c3aed,#2563eb)",color:"#fff",fontWeight:900,cursor:"pointer",fontFamily:"inherit"}}>✨ 이번 주 원클릭 처방</button></div>
        {(latestSnapshot||weeklyPlan.length>0)&&<div style={{marginTop:12,padding:"12px 14px",borderRadius:12,background:C.panel2,border:`1px solid ${C.line}`}}>
          {latestSnapshot&&<div style={{fontSize:12.5,fontWeight:800,marginBottom:8}}>최근 기록: {new Date(latestSnapshot.date).toLocaleDateString("ko-KR")} · {latestSnapshot.keyword||"키워드 미입력"} · 실제 전환 {latestSnapshot.calls+latestSnapshot.bookings+latestSnapshot.talks+latestSnapshot.coupons}건 {previousSnapshot?`(이전 대비 ${latestSnapshot.calls+latestSnapshot.bookings+latestSnapshot.talks+latestSnapshot.coupons-(previousSnapshot.calls+previousSnapshot.bookings+previousSnapshot.talks+previousSnapshot.coupons)>=0?"+":""}${latestSnapshot.calls+latestSnapshot.bookings+latestSnapshot.talks+latestSnapshot.coupons-(previousSnapshot.calls+previousSnapshot.bookings+previousSnapshot.talks+previousSnapshot.coupons)}건)`:"(기준점)"}</div>}
          {weeklyPlan.map((p,i)=><div key={p} style={{fontSize:12,color:C.sub,lineHeight:1.65}}><b style={{color:C.accent}}>{i+1}.</b> {p}</div>)}
        </div>}
      </div>

      {/* ── 📊 성과 리포트 (주간/월간, 이번 vs 지난 비교) ── */}
      {report && (()=>{
        const rankDelta = (report.rankPrev != null && report.rankNow != null) ? (report.rankPrev - report.rankNow) : null;
        const infDelta = report.inflowPrev > 0 ? Math.round(((report.inflowNow - report.inflowPrev) / report.inflowPrev) * 100) : null;
        const per = reportPeriod === "week" ? "주간" : "월간";
        const mx = Math.max(1, ...report.daily.map(d=>d.count));
        return (
        <div style={{ background: `linear-gradient(135deg,${C.glow},transparent)`, border: `2px solid ${C.accent}`, borderRadius: 18, padding: 18, marginBottom: 14 }}>
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
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>🩺 플레이스 최적화 진단</span>
            <button onClick={runDiagnose} disabled={diagLoading} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,${C.accent},${C.cyan})`, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: diagLoading?"default":"pointer", fontFamily: "inherit", opacity: diagLoading?0.6:1 }}>{diagLoading ? "진단 중…" : "🩺 내 플레이스 진단하기"}</button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>순위는 트래픽만으로 오르지 않아요. 리뷰·정보·사진·소식·예약이 <b style={{color:C.ink}}>종합 점수</b>예요. 지금 내 플레이스의 부족한 곳을 찾아 처방해 드려요.</p>
          {diag ? (
            <div>
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

      {/* ── 그래프 2단: 유입 추이 + 순위 변동 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginBottom: 14 }}>
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
      <div style={{ background: apEnabled ? `linear-gradient(135deg,${C.glow},transparent)` : C.panel, border: `2px solid ${apEnabled ? C.accent : C.line}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
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
          <button onClick={() => saveAp(!apEnabled)} style={{ padding: "13px 20px", borderRadius: 12, border: apEnabled ? `2px solid ${C.accent}` : "none", background: apEnabled ? C.panel2 : `linear-gradient(135deg,${C.accent},${C.cyan})`, color: apEnabled ? C.accent : "#fff", fontSize: 15, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{apEnabled ? "끄기" : "🎯 켜기"}</button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 11, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>※ 위 실행 패널의 대상(플레이스/블로그 주소)을 기준으로 추적해요. 달성하면 유입을 줄여 한도를 아끼고, 떨어지면 다시 밀어 올려요.</p>
      </div>

      {/* ── ⏰ 예약 실행 ── */}
      <div style={{ background: schedEnabled ? `linear-gradient(135deg,${C.glow},transparent)` : C.panel, border: `2px solid ${schedEnabled ? C.accent : C.line}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
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

      {/* ── 실행 패널 ── */}
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, marginBottom: 14, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 대상 */}
        <div>
          <label style={labelStyle}>어디로 유입시킬까요?</label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["place", "🗺️ 플레이스(지도)"], ["blog", "📝 블로그 글"]] as const).map(([k, lb]) => (
              <button key={k} onClick={() => setTargetType(k)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `2px solid ${targetType === k ? C.accent : C.line2}`, background: targetType === k ? C.glow : C.panel2, color: targetType === k ? C.accent : C.sub, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
            ))}
          </div>
        </div>

        {targetType === "place" ? (
          <div>
            <label style={labelStyle}>내 플레이스 주소</label>
            <input value={placeUrl} onChange={(e) => { const v = e.target.value; setPlaceUrl(v); const t = detectTargetType(v); if (t === "blog") { setBlogUrl(v); setTargetType("blog"); toast("블로그 주소로 인식했어요", "info"); } }} placeholder="지도/플레이스/naver.me 링크 붙여넣기 — 붙여넣으면 자동 인식" style={inputStyle} />
          </div>
        ) : (
          <div>
            <label style={labelStyle}>내 블로그 글 주소</label>
            <input value={blogUrl} onChange={(e) => { const v = e.target.value; setBlogUrl(v); const t = detectTargetType(v); if (t === "place") { setPlaceUrl(v); setTargetType("place"); toast("플레이스 주소로 인식했어요", "info"); } }} placeholder="글 주소/아이디 붙여넣으세요 (blog.naver.com/아이디/글번호) — 자동 인식" style={inputStyle} />
          </div>
        )}

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
          <label style={labelStyle}>검색 키워드 <span style={{ color: C.sub, fontWeight: 600 }}>(여러 개 — 쉼표·줄바꿈으로 구분, 돌아가며 검색)</span></label>
          <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={"예) 강남 맛집, 강남역 삼겹살, 역삼동 고깃집"} rows={2} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
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
              {([["fast", "빠르게"], ["normal", "보통"], ["deep", "꼼꼼히"]] as const).map(([k, lb]) => (
                <button key={k} onClick={() => setIntensity(k)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: `2px solid ${intensity === k ? C.accent : C.line2}`, background: intensity === k ? C.glow : C.panel2, color: intensity === k ? C.accent : C.sub, fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
              ))}
            </div>
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
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
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

      {/* ── 라이브 로그 ── */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📜 전체 진행 로그</span>
          <button onClick={copyLogs} disabled={!logs.length} style={{ padding: "7px 14px", borderRadius: 9, border: `1.5px solid ${C.line2}`, background: C.panel, color: logs.length ? C.accent : C.sub, fontSize: 13, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>📋 로그 전체복사</button>
        </div>
        <div ref={logBoxRef} style={{ background: C.logBg, color: C.logInk, borderRadius: 14, padding: "14px 16px", height: 340, overflowY: "auto", fontSize: 13, lineHeight: 1.7, fontFamily: "'SF Mono','D2Coding',ui-monospace,monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {logs.length ? logs.map((l, i) => <div key={i}>{l}</div>) : <div style={{ opacity: 0.5 }}>여기에 검색 → 진입 → 체류 → 액션 전 과정이 실시간으로 표시돼요.</div>}
        </div>
      </div>
    </div>
  );
}
