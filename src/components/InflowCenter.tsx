import { useState, useRef, useEffect } from "react";
import { BotEventStream } from "../lib/botApi";
import { INFLOW_DAILY_LIMIT, PLAN_CONFIG, getInflowDailyUsage, getInflowUsageHistory, getAccounts, PublyAccount } from "../lib/supabase";

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

export default function InflowCenter({ showToast, theme: extTheme, userId, plan = "free" }: { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light"; userId?: string; plan?: string }) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  const theme: "dark" | "light" = extTheme === "dark" ? "dark" : "light";
  const C = THEMES[theme];
  const unlimited = plan === "admin" || plan === "unlimited";
  const limit = INFLOW_DAILY_LIMIT[plan] ?? INFLOW_DAILY_LIMIT.free;

  const [targetType, setTargetType] = useState<"place" | "blog">("place");
  const [placeUrl, setPlaceUrl] = useState("");
  const [blogUrl, setBlogUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [rounds, setRounds] = useState(10);
  const [termMin, setTermMin] = useState(30);
  const [termMax, setTermMax] = useState(90);
  const [device, setDevice] = useState<"mobile" | "pc" | "mix">("mobile");
  // 액션
  const [doSave, setDoSave] = useState(true);
  const [doShare, setDoShare] = useState(false);
  const [doDir, setDoDir] = useState(true);
  const [doCall, setDoCall] = useState(false);
  const [doBook, setDoBook] = useState(false);
  const [doTalk, setDoTalk] = useState(false);
  const [doLike, setDoLike] = useState(true);
  const [auto, setAuto] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [used, setUsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [sessOk, setSessOk] = useState(0); // 이번 실행 성공 수
  const [history, setHistory] = useState<{ label: string; count: number }[]>([]);
  const esRef = useRef<BotEventStream | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const pushLog = (m: string) => setLogs((l) => [...l, m]);
  const refreshStats = () => {
    if (!userId) return;
    getInflowDailyUsage(userId).then(setUsed).catch(() => {});
    getInflowUsageHistory(userId, 7).then(setHistory).catch(() => {});
  };
  useEffect(() => {
    refreshStats();
    if (userId) getAccounts(userId).then((a) => setAccounts(a.filter((x) => x.platform === "naver"))).catch(() => {});
  }, [userId]);
  useEffect(() => { logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight, behavior: "smooth" }); }, [logs]);

  const copyLogs = () => {
    if (!logs.length) return;
    navigator.clipboard.writeText(logs.join("\n")).then(() => toast("로그 전체를 복사했어요", "success")).catch(() => toast("복사 실패", "error"));
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
    });
    if (userId) params.set("userId", userId);
    if (accountId) params.set("accountId", accountId);
    if (targetType === "place") params.set("placeUrl", placeUrl.trim());
    else if (parsedBlog) { params.set("blogId", parsedBlog.blogId); if (parsedBlog.logNo) params.set("logNo", parsedBlog.logNo); }

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
        검색 → 클릭 → 글 전체 읽는 체류 → 저장·길찾기 등 실제 손님처럼. 방문마다 <b style={{ color: C.accent }}>프록시로 IP 자동 변경</b>, <b style={{ color: C.accent }}>안전 한도 안</b>에서만.
      </p>

      {/* ── KPI 카드 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 14 }}>
        {[
          { k: "오늘 유입", v: unlimited ? `${used}` : `${used}`, sub: unlimited ? "무제한" : `/ ${limit}회`, col: C.accent },
          { k: "최근 7일", v: `${weekTotal}`, sub: "누적 방문", col: C.cyan },
          { k: "이번 성공", v: `${sessOk}`, sub: "회", col: "#16a34a" },
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

      {/* ── 7일 유입 그래프 ── */}
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px 8px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>📈 최근 7일 유입 추이</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>총 {weekTotal}회</span>
        </div>
        {history.length > 0 ? <AreaChart data={history} C={C} /> : <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 12.5, fontWeight: 600 }}>데이터가 쌓이면 그래프가 그려져요</div>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.sub, fontWeight: 700, padding: "0 2px" }}>
          {history.map((d) => <span key={d.label}>{d.label}</span>)}
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
            <input value={placeUrl} onChange={(e) => setPlaceUrl(e.target.value)} placeholder="지도/플레이스 링크 붙여넣기 (m.place.naver.com/… 또는 map.naver.com/…)" style={inputStyle} />
          </div>
        ) : (
          <div>
            <label style={labelStyle}>내 블로그 글 주소</label>
            <input value={blogUrl} onChange={(e) => setBlogUrl(e.target.value)} placeholder="글 주소만 붙여넣으세요 (blog.naver.com/아이디/글번호) — 자동 인식" style={inputStyle} />
          </div>
        )}

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
          </div>
        </div>

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
