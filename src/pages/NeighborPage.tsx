import React, { useState, useEffect, useRef, useCallback } from "react";
import { botFetch, BotEventStream } from "../lib/botApi";

const BOT = "http://127.0.0.1:3334";

/* ── 타입 ── */
interface Account { accountId: string; id: string; pw: string; blogId: string; sessionOk: boolean; loginLoading: boolean; showPw: boolean; }
interface Target { keyword: string; blogId: string; nickName?: string; blogName?: string; addDate?: number; postUrl?: string; thumbnail?: string; }
interface WorkResult { keyword: string; blogId: string; nickName?: string; blogName?: string; addDate?: number; postUrl?: string; thumbnail?: string; status: "success"|"fail"|"skip"|"limit"|"pending"|"running"; message: string; }

// 최근 글 작성일 → 상대시간 (활동성 한눈에)
function relTime(ms?: number): string {
  if (!ms) return "";
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "오늘";
  if (d === 1) return "어제";
  if (d < 30) return `${d}일 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// 체험단 모집용 서이추 멘트 프리셋 — 순환 사용으로 도배·스팸 탐지 회피. pick.온종일.com = 온종일체험단
const CAMPAIGN_LINK = "pick.온종일.com";
const CAMPAIGN_PRESETS = [
  `안녕하세요 😊 블로그 글 잘 보고 있어요! 서로이웃 신청드려요~ 혹시 무료 체험단·협찬에 관심 있으시면 '온종일체험단'(${CAMPAIGN_LINK}) 한번 놀러오세요 🎁`,
  `포스팅에 정성이 가득하네요 👍 서이추 해요! 맛집·뷰티·생활용품 무료 체험 원하시면 ${CAMPAIGN_LINK} 에서 신청할 수 있어요 :)`,
  `좋은 글 잘 읽었습니다 ✨ 이웃 신청드려요! 체험단 활동 좋아하시면 온종일체험단(${CAMPAIGN_LINK})도 추천드려요~`,
];
interface EngageResult { keyword: string; blogId: string; postUrl: string; liked: boolean; commented: boolean; status: "success"|"fail"|"skip"|"pending"|"running"; message: string; }
interface Props { theme: "dark"|"light"; userId?: string; plan?: string; initialTab?: "neighbor"|"engage"; singleTab?: boolean; }

/* ── 계정 카드 (외부 컴포넌트 — 렌더마다 재생성 방지) ── */
const AccountCard = React.memo(({ accounts, onLogin, onAdd, onRemove, onChange }: {
  accounts: Account[];
  onLogin: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (accountId: string, field: keyof Account, value: any) => void;
}) => (
  <div className="card" style={{ padding: "18px 20px" }}>
    <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>👤 작업 계정</div>
    {accounts.map((acc, i) => (
      <div key={acc.accountId} style={{ marginBottom: 12, padding: "14px 16px", borderRadius: 14, border: `2px solid ${acc.sessionOk ? "rgba(0,214,143,.5)" : "var(--border)"}`, background: acc.sessionOk ? "rgba(0,214,143,.06)" : "var(--bg)", transition: "border .2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: acc.sessionOk ? "var(--success)" : "var(--border)", flexShrink: 0, boxShadow: acc.sessionOk ? "0 0 8px var(--success)" : "none", transition: "all .3s" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>계정 {i + 1}</span>
          {acc.blogId && <span style={{ fontSize: 12, color: "var(--success)", fontWeight: 600 }}>• {acc.blogId}</span>}
          {acc.sessionOk && <span style={{ fontSize: 11, color: "var(--success)", marginLeft: 2 }}>연결됨 ✓</span>}
          {accounts.length > 1 && (
            <button onClick={() => onRemove(acc.accountId)} style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input className="inp" placeholder="네이버 아이디" value={acc.id}
            onChange={e => onChange(acc.accountId, "id", e.target.value)}
            style={{ fontSize: 13, padding: "10px 12px" }} />
          <div style={{ position: "relative" }}>
            <input className="inp" type={acc.showPw ? "text" : "password"} placeholder="비밀번호" value={acc.pw}
              onChange={e => onChange(acc.accountId, "pw", e.target.value)}
              style={{ fontSize: 13, padding: "10px 36px 10px 12px", width: "100%" }} />
            <button onClick={() => onChange(acc.accountId, "showPw", !acc.showPw)}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", fontSize: 15, color: "var(--text3)", padding: 2 }}>
              {acc.showPw ? "🙈" : "👁️"}
            </button>
          </div>
        </div>
        <button onClick={() => onLogin(acc.accountId)} disabled={acc.loginLoading || !acc.id || !acc.pw}
          style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: acc.sessionOk ? "rgba(0,214,143,.18)" : "var(--accent)", color: acc.sessionOk ? "var(--success)" : "#000", cursor: acc.loginLoading || !acc.id || !acc.pw ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 800, fontFamily: "inherit", transition: "all .2s", opacity: acc.loginLoading || !acc.id || !acc.pw ? 0.6 : 1 }}>
          {acc.loginLoading ? "🔄 로그인 중..." : acc.sessionOk ? "✅ 연결됨 (재연결)" : "🔗 계정 연결하기"}
        </button>
      </div>
    ))}
    <button onClick={onAdd} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "2px dashed var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", transition: "border-color .2s" }}>
      + 계정 추가
    </button>
  </div>
));

/* ── 사용설명서 내용 ── */
const GUIDE = {
  neighbor: [
    { step: "1", title: "계정 연결", desc: "네이버 아이디/비밀번호 입력 후 '계정 연결' 클릭 → 브라우저 창이 열리며 자동 로그인됩니다." },
    { step: "2", title: "키워드 입력", desc: "서이추할 블로그를 찾을 키워드를 쉼표로 구분해 입력하세요.\n예) 원주맛집, 강원도여행, 육아일기" },
    { step: "3", title: "추출 시작", desc: "'🔍 추출 시작' 클릭 → 키워드로 블로그를 검색해 대상 목록을 자동으로 만듭니다." },
    { step: "4", title: "서이추 멘트 설정", desc: "신청할 때 보낼 메시지를 작성하세요. 다중 멘트는 순서대로 돌아가며 사용됩니다." },
    { step: "5", title: "작업 시작", desc: "'🚀 작업 시작' 클릭 → 수집된 블로그에 자동으로 서이추 신청합니다.\n딜레이를 5~10초로 설정하면 봇 탐지를 피할 수 있어요." },
    { step: "팁", title: "재사용", desc: "📂 리스트 불러오기로 저장해둔 CSV 파일을 불러올 수 있어요.\n'완료된 블로그 스킵' 켜두면 중복 신청이 방지됩니다." },
  ],
  engage: [
    { step: "1", title: "계정 연결", desc: "서이추 탭과 동일한 계정을 공유합니다. 이미 연결됐으면 바로 사용 가능해요." },
    { step: "2", title: "키워드 입력", desc: "공감·댓글을 남길 블로그를 찾을 키워드를 입력하세요.\n서이추 탭과 별도로 관리됩니다." },
    { step: "3", title: "기간 설정", desc: "최근 7일 / 14일 / 30일 / 직접 입력 중 선택하세요.\n선택한 기간 내에 작성된 글에만 공감·댓글을 달아줍니다." },
    { step: "4", title: "작업 종류 선택", desc: "❤️ 공감 / 💬 댓글 각각 켜고 끌 수 있어요.\n댓글을 켜면 아래에 내용 입력란이 나타납니다." },
    { step: "5", title: "댓글 내용 작성", desc: "단일 댓글이나 여러 댓글을 줄바꿈으로 구분해 입력하면 순서대로 사용됩니다.\n예) 좋은 글 감사해요 😊\n자주 놀러올게요! ✨" },
    { step: "6", title: "추출 후 작업", desc: "'🔍 추출 시작' → '🚀 작업 시작' 순서로 진행하거나\n'추출 완료 후 바로 작업 시작' 옵션을 켜면 자동으로 이어집니다." },
  ],
};

/* ── 사용설명서 모달 ── */
const GuideModal = ({ tab, onClose }: { tab: "neighbor"|"engage"; onClose: () => void }) => {
  const steps = GUIDE[tab];
  const title = tab === "neighbor" ? "🤝 서이추 사용방법" : "❤️ 공감·댓글 사용방법";
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 20px 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 20, padding: "28px 32px", maxWidth: 560, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {steps.map(({ step, title, desc }) => (
            <div key={step} style={{ display: "flex", gap: 14, padding: "16px", borderRadius: 14, background: "var(--bg2)", border: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: step === "팁" ? "rgba(255,183,0,.15)" : "var(--accent-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: step === "팁" ? "#ffb700" : "var(--accent-text)", flexShrink: 0, border: `1px solid ${step === "팁" ? "rgba(255,183,0,.3)" : "var(--accent)"}` }}>
                {step === "팁" ? "💡" : `0${step}`}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, whiteSpace: "pre-line" }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{ width: "100%", marginTop: 20, padding: "13px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 14, fontWeight: 800, fontFamily: "inherit" }}>
          확인했어요!
        </button>
      </div>
    </div>
  );
};

/* ── 메인 컴포넌트 ── */
export default function NeighborPage({ theme, userId, plan = "free", initialTab, singleTab }: Props) {
  const [tab, setTab] = useState<"neighbor"|"engage">(initialTab || "neighbor");
  const [showGuide, setShowGuide] = useState(false);

  /* 공통: 계정 */
  const [accounts, setAccounts] = useState<Account[]>([
    { accountId: "acc_1", id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false },
  ]);
  const [botOnline, setBotOnline] = useState(false);

  /* 서이추 state */
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [quotaLimit, setQuotaLimit] = useState(0);
  const [keywords, setKeywords] = useState("");
  const [countPerKw, setCountPerKw] = useState(34);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [skipDone, setSkipDone] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  // 체험단 모집 최적화 옵션
  const [orderBy, setOrderBy] = useState<"recentdate"|"sim">("recentdate");
  const [activeDays, setActiveDays] = useState<number>(30);
  const [excludeMarket, setExcludeMarket] = useState(true);
  const [msgMode, setMsgMode] = useState<"single"|"multi">("single");
  const [singleMsg, setSingleMsg] = useState("안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊");
  const [multiMsgs, setMultiMsgs] = useState("안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊\n공감가는 글이 많네요. 서이추 해요!\n좋은 정보 잘 보고 갑니다. 이웃 신청드려요^^");
  const [msgIndex, setMsgIndex] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [results, setResults] = useState<WorkResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [working, setWorking] = useState(false);
  const [doneCnt, setDoneCnt] = useState(0);
  const [failCnt, setFailCnt] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const jobIdRef = useRef<string>(Date.now().toString());
  const esRef = useRef<BotEventStream|null>(null);

  /* 공감·댓글 state */
  const [eKeywords, setEKeywords] = useState("");
  const [eCountPerKw, setECountPerKw] = useState(20);
  const [ePeriod, setEPeriod] = useState<7|14|30|"custom">(7);
  const [eCustomDays, setECustomDays] = useState(3);
  const [ePostsPerBlog, setEPostsPerBlog] = useState(1);
  const [eDoLike, setEDoLike] = useState(true);
  const [eDoComment, setEDoComment] = useState(true);
  const [eComment, setEComment] = useState("좋은 글 잘 읽고 갑니다 😊 자주 놀러올게요!");
  const [eCommentMode, setECommentMode] = useState<"single"|"multi">("single");
  const [eMultiComments, setEMultiComments] = useState("좋은 글 잘 읽고 갑니다 😊 자주 놀러올게요!\n유익한 정보 감사해요! 구독하고 갑니다 🙌\n정말 도움이 됐어요! 앞으로도 좋은 글 부탁드려요 ✨");
  const [eCommentIndex, setECommentIndex] = useState(0);
  const [eDelayMin, setEDelayMin] = useState(5);
  const [eDelayMax, setEDelayMax] = useState(12);
  const [eDailyLimit, setEDailyLimit] = useState(50);
  const [eSkipDone, setESkipDone] = useState(true);
  const [eAutoStart, setEAutoStart] = useState(false);
  const [eTargets, setETargets] = useState<Target[]>([]);
  const [eResults, setEResults] = useState<EngageResult[]>([]);
  const [eLogs, setELogs] = useState<string[]>([]);
  const [eCrawling, setECrawling] = useState(false);
  const [eWorking, setEWorking] = useState(false);
  const [eDoneCnt, setEDoneCnt] = useState(0);
  const [eFailCnt, setEFailCnt] = useState(0);
  const eLogRef = useRef<HTMLDivElement>(null);
  const eJobIdRef = useRef<string>(Date.now().toString());
  const eEsRef = useRef<BotEventStream|null>(null);

  /* 봇 상태 체크 */
  useEffect(() => {
    const check = async () => {
      try { const r = await botFetch(`${BOT}/health`, { signal: AbortSignal.timeout(2000) }); setBotOnline(r.ok); }
      catch { setBotOnline(false); }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  /* 쿼타 로드 */
  useEffect(() => {
    if (!userId) return;
    botFetch(`${BOT}/api/quota/${userId}`).then(r => r.json())
      .then(d => { if (d.ok) { setQuotaUsed(d.used); setQuotaLimit(d.limit); } }).catch(() => {});
  }, [userId, botOnline]);

  /* 로그 스크롤 */
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  useEffect(() => { if (eLogRef.current) eLogRef.current.scrollTop = eLogRef.current.scrollHeight; }, [eLogs]);

  const addLog = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(p => [...p.slice(-200), `${t} :: ${msg}`]);
  }, []);

  const addELog = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setELogs(p => [...p.slice(-200), `${t} :: ${msg}`]);
  }, []);

  /* 세션 상태 확인 */
  useEffect(() => {
    accounts.forEach(acc => {
      if (!acc.id) return;
      botFetch(`${BOT}/api/session/${acc.accountId}`).then(r => r.json())
        .then(d => { if (d.exists) setAccounts(p => p.map(a => a.accountId === acc.accountId ? { ...a, sessionOk: true } : a)); })
        .catch(() => {});
    });
  }, []);

  /* 계정 핸들러 */
  const handleLogin = async (accountId: string) => {
    const acc = accounts.find(a => a.accountId === accountId);
    if (!acc || !acc.id || !acc.pw) return alert("아이디와 비밀번호를 입력하세요");
    setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, loginLoading: true } : a));
    try {
      const r = await botFetch(`${BOT}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, id: acc.id, pw: acc.pw }) });
      const d = await r.json();
      if (d.success) {
        setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, sessionOk: true, blogId: d.blogId, loginLoading: false } : a));
        addLog(`✅ [${acc.id}] 로그인 성공 (blogId: ${d.blogId})`);
        addELog(`✅ [${acc.id}] 로그인 성공`);
      } else throw new Error(d.error || "로그인 실패");
    } catch (e: any) {
      setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, loginLoading: false } : a));
      addLog(`❌ 로그인 오류: ${e.message}`);
      alert(`로그인 오류: ${e.message}`);
    }
  };

  const handleAddAccount = useCallback(() =>
    setAccounts(p => [...p, { accountId: `acc_${Date.now()}`, id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false }])
  , []);

  const handleRemoveAccount = useCallback((id: string) =>
    setAccounts(p => p.filter(a => a.accountId !== id))
  , []);

  const handleAccountChange = useCallback((accountId: string, field: keyof Account, value: any) =>
    setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, [field]: value, ...(field === "id" || field === "pw" ? { sessionOk: false } : {}) } : a))
  , []);

  /* 서이추 수집 */
  const applyCampaignPreset = () => {
    setMsgMode("multi");
    setMultiMsgs(CAMPAIGN_PRESETS.join("\n"));
  };

  const handleCrawl = async () => {
    const kwList = keywords.split(",").map(k => k.trim()).filter(Boolean);
    if (!kwList.length) return alert("키워드를 입력하세요");
    setCrawling(true); setTargets([]); setResults([]); setDoneCnt(0); setFailCnt(0);
    addLog(`🔍 수집 시작 — 키워드: ${kwList.join(", ")} / 키워드당 ${countPerKw}개`);
    const es = new BotEventStream(`${BOT}/api/crawl?keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${countPerKw}&orderBy=${orderBy}&activeDays=${activeDays}&excludeMarket=${excludeMarket}${userId ? `&userId=${userId}` : ""}`);
    esRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addLog(d.msg);
      if (d.type === "quota_info") { setQuotaUsed(d.used); setQuotaLimit(d.limit); addLog(`📊 오늘 서이추 현황: ${d.used}/${d.limit} (남은 ${d.remaining}명)`); }
      if (d.type === "quota_exceeded") { addLog(`🚫 오늘 한도(${d.limit}명) 모두 사용!`); setCrawling(false); es.close(); return; }
      if (d.type === "crawl_done") {
        const t: Target[] = d.results; setTargets(t); setResults(t.map(x => ({ ...x, status: "pending" as const, message: "대기중" })));
        addLog(`✅ 수집 완료: 총 ${t.length}개`); setCrawling(false); es.close();
        if (autoStart && t.length > 0) setTimeout(() => startWork(t), 500);
      }
      if (d.type === "error") { addLog(`❌ 오류: ${d.msg}`); setCrawling(false); es.close(); }
    };
    es.onerror = () => { addLog("❌ 수집 연결 오류"); setCrawling(false); es.close(); };
  };

  /* 서이추 작업 */
  const startWork = async (targetList?: Target[]) => {
    const list = targetList || targets;
    if (!list.length) return alert("수집된 블로그가 없습니다");
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 계정을 연결하세요");
    setWorking(true); setDoneCnt(0); setFailCnt(0);
    jobIdRef.current = Date.now().toString();
    addLog(`🚀 작업 시작 — ${list.length}개 대상 / 한도 ${dailyLimit}개 / 딜레이 ${delayMin}~${delayMax}초`);
    const msg = msgMode === "single" ? singleMsg : multiMsgs.split("\n").filter(l => l.trim()).join("|||");
    const params = new URLSearchParams({ accountId: acc.accountId, targets: encodeURIComponent(JSON.stringify(list)), message: msg, delayMin: delayMin.toString(), delayMax: delayMax.toString(), skipDone: skipDone.toString(), jobId: jobIdRef.current, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/add-neighbor?${params}`); esRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addLog(d.msg);
      if (d.type === "quota_info") { setQuotaUsed(d.used); setQuotaLimit(d.limit); }
      if (d.type === "quota_exceeded") { addLog("🚫 오늘 한도 초과!"); setWorking(false); es.close(); return; }
      if (d.type === "result") { setResults(p => p.map(r => r.blogId === d.blogId ? { ...r, status: d.status, message: d.message } : r)); if (d.status === "success") setQuotaUsed(q => q + 1); }
      if (d.type === "progress") { setDoneCnt(d.done); setFailCnt(d.fail); }
      if (d.type === "done") { addLog("🎉 작업 완료!"); setWorking(false); es.close(); }
      if (d.type === "error") { addLog(`❌ 오류: ${d.msg}`); setWorking(false); es.close(); }
    };
    es.onerror = () => { addLog("❌ 작업 연결 오류"); setWorking(false); es.close(); };
  };

  const handleStop = async () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${jobIdRef.current}`, { method: "POST" }); } catch {}
    addLog("⛔ 중단"); setCrawling(false); setWorking(false);
  };

  /* 공감·댓글 수집 */
  const handleEngageCrawl = async () => {
    const kwList = eKeywords.split(",").map(k => k.trim()).filter(Boolean);
    if (!kwList.length) return alert("키워드를 입력하세요");
    setECrawling(true); setETargets([]); setEResults([]); setEDoneCnt(0); setEFailCnt(0);
    addELog(`🔍 수집 시작 — 키워드: ${kwList.join(", ")} / 키워드당 ${eCountPerKw}개`);
    const es = new BotEventStream(`${BOT}/api/engage-crawl?keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${eCountPerKw}${userId ? `&userId=${userId}` : ""}`);
    eEsRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addELog(d.msg);
      if (d.type === "crawl_done") {
        const t: Target[] = d.results; setETargets(t);
        setEResults(t.map(x => ({ ...x, postUrl: "", liked: false, commented: false, status: "pending" as const, message: "대기중" })));
        addELog(`✅ 수집 완료: 총 ${t.length}개`); setECrawling(false); es.close();
        if (eAutoStart && t.length > 0) setTimeout(() => startEngageWork(t), 500);
      }
      if (d.type === "error") { addELog(`❌ 오류: ${d.msg}`); setECrawling(false); es.close(); }
    };
    es.onerror = () => { addELog("❌ 수집 연결 오류"); setECrawling(false); es.close(); };
  };

  /* 공감·댓글 작업 */
  const startEngageWork = async (targetList?: Target[]) => {
    const list = targetList || eTargets;
    if (!list.length) return alert("수집된 블로그가 없습니다");
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 계정을 연결하세요");
    setEWorking(true); setEDoneCnt(0); setEFailCnt(0);
    eJobIdRef.current = Date.now().toString();
    const days = ePeriod === "custom" ? eCustomDays : ePeriod;
    addELog(`🚀 작업 시작 — ${list.length}개 / 최근 ${days}일 / ${eDoLike ? "공감" : ""}${eDoLike && eDoComment ? "+" : ""}${eDoComment ? "댓글" : ""}`);
    const commentText = eCommentMode === "single" ? eComment : eMultiComments.split("\n").filter(l => l.trim()).join("|||");
    const params = new URLSearchParams({ accountId: acc.accountId, targets: encodeURIComponent(JSON.stringify(list)), comment: commentText, doLike: eDoLike.toString(), doComment: eDoComment.toString(), periodDays: days.toString(), postsPerBlog: ePostsPerBlog.toString(), delayMin: eDelayMin.toString(), delayMax: eDelayMax.toString(), dailyLimit: eDailyLimit.toString(), skipDone: eSkipDone.toString(), jobId: eJobIdRef.current, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/engage?${params}`); eEsRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addELog(d.msg);
      if (d.type === "result") setEResults(p => p.map(r => r.blogId === d.blogId ? { ...r, status: d.status, postUrl: d.postUrl || "", liked: d.liked, commented: d.commented, message: d.message } : r));
      if (d.type === "progress") { setEDoneCnt(d.done); setEFailCnt(d.fail); }
      if (d.type === "done") { addELog("🎉 작업 완료!"); setEWorking(false); es.close(); }
      if (d.type === "error") { addELog(`❌ 오류: ${d.msg}`); setEWorking(false); es.close(); }
    };
    es.onerror = () => { addELog("❌ 작업 연결 오류"); setEWorking(false); es.close(); };
  };

  const handleEngageStop = async () => {
    if (eEsRef.current) { eEsRef.current.close(); eEsRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${eJobIdRef.current}`, { method: "POST" }); } catch {}
    addELog("⛔ 중단"); setECrawling(false); setEWorking(false);
  };

  /* CSV 저장 */
  const handleSaveHistory = () => {
    const csv = ["키워드,블로그ID,결과,메시지", ...results.map(r => `${r.keyword},${r.blogId},${r.status},${r.message}`)].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    a.download = `서이추_${new Date().toLocaleDateString("ko-KR").replace(/\. /g, "-").replace(".", "")}.csv`; a.click();
  };

  const handleEngageSaveHistory = () => {
    const csv = ["키워드,블로그ID,포스트URL,공감,댓글,결과,메시지", ...eResults.map(r => `${r.keyword},${r.blogId},${r.postUrl},${r.liked},${r.commented},${r.status},${r.message}`)].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    a.download = `공감댓글_${new Date().toLocaleDateString("ko-KR").replace(/\. /g, "-").replace(".", "")}.csv`; a.click();
  };

  const handleLoadList = (isEngage = false) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,.txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const newTargets: Target[] = lines.map(line => {
        const parts = line.split(",");
        return parts.length >= 2 ? { keyword: parts[0].trim(), blogId: parts[1].trim() } : { keyword: "직접입력", blogId: parts[0].trim() };
      }).filter(t => t.blogId);
      if (isEngage) {
        setETargets(newTargets);
        setEResults(newTargets.map(t => ({ ...t, postUrl: "", liked: false, commented: false, status: "pending" as const, message: "대기중" })));
        addELog(`📂 ${newTargets.length}개 불러오기 완료`);
      } else {
        setTargets(newTargets);
        setResults(newTargets.map(t => ({ ...t, status: "pending" as const, message: "대기중" })));
        addLog(`📂 ${newTargets.length}개 불러오기 완료`);
      }
    };
    input.click();
  };

  /* 헬퍼 */
  const statusColor = (s: WorkResult["status"]) => s === "success" ? "var(--success)" : s === "fail" ? "var(--danger)" : s === "skip" ? "var(--text3)" : s === "running" ? "var(--info)" : "var(--text3)";
  const statusLabel = (s: WorkResult["status"]) => s === "success" ? "신청 완료" : s === "fail" ? "실패" : s === "skip" ? "스킵" : s === "running" ? "진행중..." : "대기중";
  const eStatusColor = (s: EngageResult["status"]) => s === "success" ? "var(--success)" : s === "fail" ? "var(--danger)" : s === "skip" ? "var(--text3)" : s === "running" ? "var(--info)" : "var(--text3)";
  const eStatusLabel = (s: EngageResult["status"]) => s === "success" ? "완료" : s === "fail" ? "실패" : s === "skip" ? "스킵" : s === "running" ? "진행중..." : "대기중";

  const Toggle = ({ val, set, label }: { val: boolean; set: (v: boolean) => void; label: string }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)", padding: "6px 0" }}>
      <div onClick={() => set(!val)} style={{ width: 42, height: 24, borderRadius: 99, background: val ? "var(--accent)" : "var(--border)", position: "relative", transition: "background .2s", cursor: "pointer", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: val ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,.2)" }} />
      </div>
      {label}
    </label>
  );

  /* ── 공통 레이아웃 헬퍼 ── */
  const LogBox = ({ logs, logRef, onClear }: { logs: string[]; logRef: React.RefObject<HTMLDivElement>; onClear: () => void }) => (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="card-title" style={{ margin: 0 }}>📟 작업 로그</div>
        <button onClick={onClear} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>지우기</button>
      </div>
      <div ref={logRef} style={{ height: 200, overflowY: "auto", padding: "12px 16px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.8, background: "#050a0f" }}>
        {logs.length === 0 ? <span style={{ color: "#3a5a7a" }}>대기 중...</span> : logs.map((l, i) => (
          <div key={i} style={{ color: l.includes("✅")||l.includes("🎉")||l.includes("❤️")||l.includes("💬") ? "#00d68f" : l.includes("❌")||l.includes("🚫") ? "#ff5363" : l.includes("⏭️") ? "#7a9ab5" : "#00c8ff" }}>{l}</div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ animation: "fadeUp .25s ease both" }}>

      {/* 봇 오프라인 배너 */}
      {!botOnline && (
        <div style={{ marginBottom: 16, padding: "14px 18px", borderRadius: 14, background: "rgba(255,83,99,.08)", border: "1.5px solid rgba(255,83,99,.3)", color: "var(--danger)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>봇 서버가 오프라인입니다. <code style={{ background: "var(--card2)", padding: "2px 7px", borderRadius: 5, fontSize: 12 }}>neighbor-bot</code> 폴더에서 <code style={{ background: "var(--card2)", padding: "2px 7px", borderRadius: 5, fontSize: 12 }}>npm start</code> 를 실행해주세요.</span>
        </div>
      )}

      {/* 탭 + 사용방법 버튼 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        {!singleTab && ([{ key: "neighbor", label: "🤝 서이추" }, { key: "engage", label: "❤️ 공감·댓글" }] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding: "11px 26px", borderRadius: 12, border: `2px solid ${tab === key ? "var(--accent)" : "var(--border)"}`, background: tab === key ? "var(--accent-bg)" : "transparent", color: tab === key ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 14, fontWeight: 800, fontFamily: "inherit", transition: "all .2s" }}>
            {label}
          </button>
        ))}
        <button onClick={() => setShowGuide(true)} style={{ marginLeft: singleTab ? 0 : "auto", padding: "11px 20px", borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, transition: "all .2s" }}>
          📖 사용방법
        </button>
      </div>

      {/* 사용설명서 모달 */}
      {showGuide && <GuideModal tab={tab} onClose={() => setShowGuide(false)} />}

      {/* ═══════════ 서이추 탭 ═══════════ */}
      {tab === "neighbor" && (
        <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, alignItems: "start" }}>
          {/* 왼쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} />

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>🔍 추출 설정</div>
              <div style={{ marginBottom: 14 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드 (쉼표로 구분)</label>
                <input className="inp" placeholder="예: 원주맛집, 강원도여행, 육아일기" value={keywords} onChange={e => setKeywords(e.target.value)} style={{ fontSize: 13, padding: "11px 14px" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드당 추출 수</label>
                  <input className="inp" type="number" min={1} max={300} value={countPerKw} onChange={e => setCountPerKw(Number(e.target.value))} style={{ fontSize: 13, padding: "11px 14px" }} />
                </div>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>하루 신청 한도</label>
                  <input className="inp" type="number" min={1} max={100} value={dailyLimit} onChange={e => setDailyLimit(Number(e.target.value))} style={{ fontSize: 13, padding: "11px 14px" }} />
                </div>
              </div>

              {/* ── 체험단 모집 최적화 ── */}
              <div style={{ marginBottom: 12, padding: "14px", borderRadius: 12, background: "var(--accent-bg)", border: "1px solid var(--accent)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--accent-text)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  🎯 체험단 모집 최적화
                </div>
                <label className="inp-label" style={{ fontSize: 11.5, marginBottom: 6, display: "block", color: "var(--text3)", fontWeight: 600 }}>수집 정렬</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {([["recentdate", "최신 활동순"], ["sim", "정확도순"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setOrderBy(v)} style={{ flex: 1, padding: "10px", borderRadius: 9, border: `2px solid ${orderBy === v ? "var(--accent)" : "var(--border)"}`, background: orderBy === v ? "var(--card)" : "transparent", color: orderBy === v ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", transition: "all .15s" }}
                      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>{l}</button>
                  ))}
                </div>
                <label className="inp-label" style={{ fontSize: 11.5, marginBottom: 6, display: "block", color: "var(--text3)", fontWeight: 600 }}>최근 글 쓴 블로거만 <span style={{ color: "var(--text3)", fontWeight: 400 }}>(죽은 블로그 제외)</span></label>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {([[0, "전체"], [7, "7일"], [30, "30일"], [90, "90일"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setActiveDays(v)} style={{ flex: 1, padding: "10px", borderRadius: 9, border: `2px solid ${activeDays === v ? "var(--accent)" : "var(--border)"}`, background: activeDays === v ? "var(--card)" : "transparent", color: activeDays === v ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", transition: "all .15s" }}
                      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>{l}</button>
                  ))}
                </div>
                <Toggle val={excludeMarket} set={setExcludeMarket} label="판매·마켓 블로거 제외" />
              </div>

              <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--bg2)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text3)" }}>
                총 수집 예정: <strong style={{ color: "var(--accent-text)" }}>{keywords.split(",").filter(k => k.trim()).length * countPerKw}개</strong>
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>⚙️ 작업 옵션</div>
              <div style={{ marginBottom: 12 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초) — 너무 짧으면 봇 탐지될 수 있어요</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input className="inp" type="number" min={1} max={60} value={delayMin} onChange={e => setDelayMin(Number(e.target.value))} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 14, fontWeight: 700 }}>~</span>
                  <input className="inp" type="number" min={1} max={120} value={delayMax} onChange={e => setDelayMax(Number(e.target.value))} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 13 }}>초</span>
                </div>
              </div>
              <Toggle val={skipDone} set={setSkipDone} label="이미 처리된 블로그 건너뛰기" />
              <Toggle val={autoStart} set={setAutoStart} label="추출 완료 후 바로 신청 시작" />
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>💬 서이추 멘트</span>
                <button onClick={applyCampaignPreset} title="체험단 모집 문구 3종을 자동으로 채웁니다 (순환 사용)"
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent-bg)", color: "var(--accent-text)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, transition: "all .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 3px 10px var(--accent-bg)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(.96)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "translateY(-1px)")}>🎁 체험단 멘트</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {(["single", "multi"] as const).map(m => (
                  <button key={m} onClick={() => setMsgMode(m)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `2px solid ${msgMode === m ? "var(--accent)" : "var(--border)"}`, background: msgMode === m ? "var(--accent-bg)" : "transparent", color: msgMode === m ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                    {m === "single" ? "단일 멘트" : "여러 멘트 순환"}
                  </button>
                ))}
              </div>
              {msgMode === "single" ? (
                <textarea className="inp" rows={3} value={singleMsg} onChange={e => setSingleMsg(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} />
              ) : (
                <>
                  <textarea className="inp" rows={5} value={multiMsgs} onChange={e => setMultiMsgs(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} placeholder="줄바꿈으로 구분 → 순서대로 사용됩니다" />
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>총 {multiMsgs.split("\n").filter(l => l.trim()).length}개 멘트 등록됨</div>
                </>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handleCrawl} disabled={crawling || working || !botOnline} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {crawling ? <><span className="spinner" />블로그 추출 중...</> : "🔍 블로그 추출 시작"}
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => startWork()} disabled={crawling || working || !targets.length || !botOnline} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  {working ? <><span className="spinner" />작업 중...</> : "🚀 서이추 시작"}
                </button>
                <button className="btn btn-secondary" onClick={() => handleLoadList(false)} disabled={crawling || working} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  📂 리스트 불러오기
                </button>
              </div>
              {(crawling || working) && (
                <button className="btn-stop" onClick={handleStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 작업 중단</button>
              )}
            </div>
          </div>

          {/* 오른쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {userId && quotaLimit > 0 && (
              <div style={{ padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: `1.5px solid ${quotaUsed >= quotaLimit ? "rgba(255,83,99,.4)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>오늘 서이추 사용량</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: quotaUsed >= quotaLimit ? "var(--danger)" : "var(--accent-text)", fontFamily: "'Space Grotesk',sans-serif" }}>
                    {quotaUsed} <span style={{ fontSize: 14, color: "var(--text3)", fontWeight: 500 }}>/ {quotaLimit}명</span>
                  </div>
                </div>
                <div style={{ width: 70 }}>
                  <div style={{ height: 8, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${Math.min(100, (quotaUsed / quotaLimit) * 100)}%`, background: quotaUsed >= quotaLimit ? "var(--danger)" : "var(--accent)", transition: "width .4s" }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 4 }}>{quotaUsed >= quotaLimit ? "오늘 마감" : `${quotaLimit - quotaUsed}명 남음`}</div>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[{ label: "수집된 블로그", val: targets.length, color: "var(--info)" }, { label: "신청 완료", val: doneCnt, color: "var(--success)" }, { label: "실패", val: failCnt, color: "var(--danger)" }].map(({ label, val, color }) => (
                <div key={label} style={{ padding: "18px", borderRadius: 16, background: "var(--card)", border: "1px solid var(--border)", textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6, fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="card-title" style={{ margin: 0 }}>📋 작업 현황 {results.length > 0 && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>({results.length}개)</span>}</div>
                {results.length > 0 && <button onClick={handleSaveHistory} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>💾 저장</button>}
              </div>
              {results.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text3)", fontSize: 14 }}>추출 후 결과가 여기에 표시됩니다</div>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: "var(--bg2)", position: "sticky", top: 0 }}>
                      {["키워드", "블로거", "결과"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--text3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{results.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--card-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 14px", color: "var(--accent-text)", fontWeight: 700 }}>{r.keyword}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            {r.thumbnail && <img src={r.thumbnail} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} onError={e => (e.currentTarget.style.display = "none")} />}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{r.nickName || r.blogName || r.blogId}</div>
                              <a href={r.postUrl || `https://blog.naver.com/${r.blogId}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none", fontSize: 11 }}>
                                {r.blogId}{r.addDate ? <span style={{ color: "var(--text3)" }}> · {relTime(r.addDate)}</span> : null}
                              </a>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: `${statusColor(r.status)}18`, color: statusColor(r.status), border: `1px solid ${statusColor(r.status)}40`, fontWeight: 700 }}>{statusLabel(r.status)}</span>
                          {r.status === "fail" && <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 8 }}>{r.message}</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
            <LogBox logs={logs} logRef={logRef} onClear={() => setLogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 공감·댓글 탭 ═══════════ */}
      {tab === "engage" && (
        <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, alignItems: "start" }}>
          {/* 왼쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} />

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>🔍 추출 설정</div>
              <div style={{ marginBottom: 14 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드 (쉼표로 구분)</label>
                <input className="inp" placeholder="예: 맛집, 육아, 인테리어" value={eKeywords} onChange={e => setEKeywords(e.target.value)} style={{ fontSize: 13, padding: "11px 14px" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드당 추출 수</label>
                  <input className="inp" type="number" min={1} max={200} value={eCountPerKw} onChange={e => setECountPerKw(Number(e.target.value))} style={{ fontSize: 13, padding: "11px 14px" }} />
                </div>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>하루 작업 한도</label>
                  <input className="inp" type="number" min={1} max={200} value={eDailyLimit} onChange={e => setEDailyLimit(Number(e.target.value))} style={{ fontSize: 13, padding: "11px 14px" }} />
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>📅 대상 글 기간</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {([7, 14, 30, "custom"] as const).map(p => (
                  <button key={p} onClick={() => setEPeriod(p)} style={{ padding: "11px", borderRadius: 10, border: `2px solid ${ePeriod === p ? "var(--accent)" : "var(--border)"}`, background: ePeriod === p ? "var(--accent-bg)" : "transparent", color: ePeriod === p ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>
                    {p === "custom" ? "직접 입력" : `최근 ${p}일`}
                  </button>
                ))}
              </div>
              {ePeriod === "custom" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <input className="inp" type="number" min={1} max={365} value={eCustomDays} onChange={e => setECustomDays(Number(e.target.value))} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ fontSize: 13, color: "var(--text3)" }}>일 이내 글</span>
                </div>
              )}
              <div>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>블로그당 작업할 글 수 (최대 5개)</label>
                <input className="inp" type="number" min={1} max={5} value={ePostsPerBlog} onChange={e => setEPostsPerBlog(Number(e.target.value))} style={{ fontSize: 13, padding: "11px 14px" }} />
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>⚙️ 작업 설정</div>
              <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--bg2)", border: "1px solid var(--border)", marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8, fontWeight: 600 }}>작업 종류 선택</div>
                <Toggle val={eDoLike} set={setEDoLike} label="❤️ 공감 클릭하기" />
                <Toggle val={eDoComment} set={setEDoComment} label="💬 댓글 작성하기" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input className="inp" type="number" min={1} max={60} value={eDelayMin} onChange={e => setEDelayMin(Number(e.target.value))} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 14, fontWeight: 700 }}>~</span>
                  <input className="inp" type="number" min={1} max={120} value={eDelayMax} onChange={e => setEDelayMax(Number(e.target.value))} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 13 }}>초</span>
                </div>
              </div>
              <Toggle val={eSkipDone} set={setESkipDone} label="완료된 블로그 건너뛰기" />
              <Toggle val={eAutoStart} set={setEAutoStart} label="추출 완료 후 바로 작업 시작" />
            </div>

            {eDoComment && (
              <div className="card" style={{ padding: "18px 20px" }}>
                <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>💬 댓글 내용</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {(["single", "multi"] as const).map(m => (
                    <button key={m} onClick={() => setECommentMode(m)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `2px solid ${eCommentMode === m ? "var(--accent)" : "var(--border)"}`, background: eCommentMode === m ? "var(--accent-bg)" : "transparent", color: eCommentMode === m ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                      {m === "single" ? "단일 댓글" : "여러 댓글 순환"}
                    </button>
                  ))}
                </div>
                {eCommentMode === "single" ? (
                  <textarea className="inp" rows={3} value={eComment} onChange={e => setEComment(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} />
                ) : (
                  <>
                    <textarea className="inp" rows={5} value={eMultiComments} onChange={e => setEMultiComments(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} placeholder="줄바꿈으로 구분 → 순서대로 사용됩니다" />
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>총 {eMultiComments.split("\n").filter(l => l.trim()).length}개 댓글 등록됨</div>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handleEngageCrawl} disabled={eCrawling || eWorking || !botOnline} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {eCrawling ? <><span className="spinner" />블로그 추출 중...</> : "🔍 블로그 추출 시작"}
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => startEngageWork()} disabled={eCrawling || eWorking || !eTargets.length || !botOnline} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  {eWorking ? <><span className="spinner" />작업 중...</> : "🚀 작업 시작"}
                </button>
                <button className="btn btn-secondary" onClick={() => handleLoadList(true)} disabled={eCrawling || eWorking} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  📂 리스트 불러오기
                </button>
              </div>
              {(eCrawling || eWorking) && (
                <button className="btn-stop" onClick={handleEngageStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 작업 중단</button>
              )}
            </div>
          </div>

          {/* 오른쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[{ label: "수집된 블로그", val: eTargets.length, color: "var(--info)" }, { label: "작업 완료", val: eDoneCnt, color: "var(--success)" }, { label: "실패", val: eFailCnt, color: "var(--danger)" }].map(({ label, val, color }) => (
                <div key={label} style={{ padding: "18px", borderRadius: 16, background: "var(--card)", border: "1px solid var(--border)", textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6, fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="card-title" style={{ margin: 0 }}>📋 작업 현황 {eResults.length > 0 && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>({eResults.length}개)</span>}</div>
                {eResults.length > 0 && <button onClick={handleEngageSaveHistory} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>💾 저장</button>}
              </div>
              {eResults.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text3)", fontSize: 14 }}>추출 후 결과가 여기에 표시됩니다</div>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: "var(--bg2)", position: "sticky", top: 0 }}>
                      {["키워드", "블로그 ID", "공감", "댓글", "결과"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--text3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{eResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--card-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 14px", color: "var(--accent-text)", fontWeight: 700 }}>{r.keyword}</td>
                        <td style={{ padding: "10px 14px" }}><a href={r.postUrl || `https://blog.naver.com/${r.blogId}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none" }}>{r.blogId}</a></td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 16 }}>{r.status === "pending" || r.status === "running" ? <span style={{ color: "var(--text3)" }}>—</span> : r.liked ? "❤️" : <span style={{ color: "var(--text3)" }}>✗</span>}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 16 }}>{r.status === "pending" || r.status === "running" ? <span style={{ color: "var(--text3)" }}>—</span> : r.commented ? "💬" : <span style={{ color: "var(--text3)" }}>✗</span>}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: `${eStatusColor(r.status)}18`, color: eStatusColor(r.status), border: `1px solid ${eStatusColor(r.status)}40`, fontWeight: 700 }}>{eStatusLabel(r.status)}</span>
                          {r.status === "fail" && <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 8 }}>{r.message}</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
            <LogBox logs={eLogs} logRef={eLogRef} onClear={() => setELogs([])} />
          </div>
        </div>
      )}
    </div>
  );
}
