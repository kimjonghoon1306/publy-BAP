import { useState, useRef, useEffect } from "react";
import { BotEventStream } from "../lib/botApi";
import { INFLOW_DAILY_LIMIT, PLAN_CONFIG, getInflowDailyUsage, getAccounts, PublyAccount } from "../lib/supabase";

const BOT = "http://127.0.0.1:3334"; // neighbor-bot

/* ═══════════════════════════════════════════════════════════════
   🆕 NEW 트래픽 유입 — 키워드 검색 → 클릭 진입 → 글 전체 읽는 체류 → 저장/공감 → 이탈
   방문마다 프록시 IP 로테이션. 방문 텀 임의 지정. 등급별 안전 한도(락 해제=관리자만).
   회원=관리자 동일 화면. ⚖️ 한도 안에서 안전하게.
   ═══════════════════════════════════════════════════════════════ */

const THEMES = {
  light: { bg: "#eef2f7", surf: "#ffffff", surf2: "#f4f7fb", ink: "#182230", sub: "#6b7686", line: "#e2e8f1", line2: "#d3dce8", accent: "#2563eb", accentSoft: "#e5edfb", logBg: "#0f1722", logInk: "#c7d2e0" },
  dark: { bg: "#0f141b", surf: "#1a212b", surf2: "#222b37", ink: "#eef3fa", sub: "#9fb0c4", line: "#2c3846", line2: "#3a4756", accent: "#5b9bff", accentSoft: "#22304a", logBg: "#080c12", logInk: "#a9bccf" },
};

// ⚖️ 등급 사용표엔 무제한 안 넣음 — 무제한은 관리자 고유 기능(회원용 표엔 free/basic/pro만)
const PLAN_ORDER = ["free", "basic", "pro"] as const;

// 블로그 글 주소 → { blogId, logNo }. 직접 안 넣고 주소만 붙여넣으면 자동 인식.
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

export default function InflowCenter({ showToast, theme: extTheme, userId, plan = "free" }: { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light"; userId?: string; plan?: string }) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  const theme: "dark" | "light" = extTheme === "dark" ? "dark" : "light";
  const C = THEMES[theme];
  const unlimited = plan === "admin" || plan === "unlimited";
  const limit = INFLOW_DAILY_LIMIT[plan] ?? INFLOW_DAILY_LIMIT.free;

  const [targetType, setTargetType] = useState<"place" | "blog">("place");
  const [placeUrl, setPlaceUrl] = useState("");
  const [blogUrl, setBlogUrl] = useState("");
  const [device, setDevice] = useState<"mobile" | "pc" | "mix">("mobile");
  const [keywords, setKeywords] = useState("");
  const [rounds, setRounds] = useState(10);
  const [termMin, setTermMin] = useState(30);
  const [termMax, setTermMax] = useState(90);
  const [doSave, setDoSave] = useState(true);
  const [doLike, setDoLike] = useState(true);
  const [doShare, setDoShare] = useState(false);
  const [auto, setAuto] = useState(false); // 자동=오늘 남은 한도까지 알아서 / 수동=지정 횟수만
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<PublyAccount[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [used, setUsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const esRef = useRef<BotEventStream | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const pushLog = (m: string) => setLogs((l) => [...l, m]);

  useEffect(() => {
    if (!userId) return;
    getInflowDailyUsage(userId).then(setUsed).catch(() => {});
    getAccounts(userId).then((a) => setAccounts(a.filter((x) => x.platform === "naver"))).catch(() => {});
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

    setRunning(true); setLogs([]); setProgress(0);
    const params = new URLSearchParams({
      targetType, keywords: kwList.join(","), rounds: String(n),
      termMin: String(termMin), termMax: String(termMax),
      doSave: String(doSave), doLike: String(doLike), doShare: String(doShare), device,
    });
    if (userId) params.set("userId", userId);
    if (accountId) params.set("accountId", accountId);
    if (targetType === "place") params.set("placeUrl", placeUrl.trim());
    else if (parsedBlog) { params.set("blogId", parsedBlog.blogId); if (parsedBlog.logNo) params.set("logNo", parsedBlog.logNo); }

    pushLog(`🚀 NEW 트래픽 유입 시작 — ${targetType === "place" ? "플레이스" : "블로그"}, 키워드 ${kwList.length}개, ${n}회 방문, 텀 ${termMin}~${termMax}초`);
    const es = new BotEventStream(`${BOT}/api/inflow?${params.toString()}`);
    esRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let d: any; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "progress") setProgress(Math.round((d.done / Math.max(1, d.total)) * 100));
      else if (d.type === "quota_info") setUsed(d.used);
      else if (d.type === "quota_exceeded") { pushLog("🛑 오늘 유입 한도를 다 썼어요"); toast("오늘 유입 한도 초과", "error"); setRunning(false); es.close(); esRef.current = null; }
      else if (d.type === "inflow_done") { pushLog(`🏁 완료 — 총 ${d.done}회 방문, 성공 ${d.success}회`); toast(`유입 완료 · 성공 ${d.success}회`, "success"); setRunning(false); es.close(); esRef.current = null; if (userId) getInflowDailyUsage(userId).then(setUsed).catch(() => {}); }
      else if (d.type === "error") { pushLog(`❌ ${d.msg}`); toast(d.msg, "error"); setRunning(false); es.close(); esRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류 — 봇 서버(포트 3334)가 켜져 있는지 확인해주세요"); toast("봇 연결 오류", "error"); setRunning(false); es.close(); esRef.current = null; };
    es.onclose = () => setRunning(false);
  };

  const stop = () => { esRef.current?.close(); esRef.current = null; setRunning(false); pushLog("⏹️ 사용자가 정지했어요"); };

  const pct = unlimited ? 0 : Math.min(100, (used / Math.max(1, limit)) * 100);

  const inputStyle: React.CSSProperties = { width: "100%", padding: "13px 14px", borderRadius: 12, border: `1.5px solid ${C.line2}`, background: C.surf2, color: C.ink, fontSize: 15, fontWeight: 600, fontFamily: "inherit", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 8, display: "block" };

  return (
    <div style={{ fontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif", color: C.ink }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 12, fontWeight: 900, padding: "4px 9px", borderRadius: 8, letterSpacing: 0.5 }}>NEW</span>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>트래픽 유입</h2>
      </div>
      <p style={{ margin: "0 0 18px", fontSize: 14, color: C.sub, fontWeight: 600, lineHeight: 1.6 }}>
        키워드로 <b style={{ color: C.ink }}>검색 → 내 플레이스·블로그 클릭 → 글 전체 읽는 체류 → 저장·공감</b> 까지, 실제 사람처럼 유입시켜요.<br />
        방문마다 <b style={{ color: C.accent }}>프록시로 IP를 자동으로 바꾸고</b>, <b style={{ color: C.accent }}>안전 한도 안에서만</b> 돌아가요.
      </p>

      {/* 등급 사용표 */}
      <div style={{ background: C.surf, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>📊 등급별 하루 유입 한도</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {PLAN_ORDER.map((pk) => {
            const cfg = PLAN_CONFIG[pk];
            const cur = pk === plan;
            const val = cfg.dailyInflow >= 999999 ? "무제한" : `${cfg.dailyInflow.toLocaleString()}회`;
            return (
              <div key={pk} style={{ textAlign: "center", padding: "12px 6px", borderRadius: 12, border: `2px solid ${cur ? C.accent : C.line}`, background: cur ? C.accentSoft : C.surf2 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: cur ? C.accent : C.sub }}>{cfg.label}</div>
                <div style={{ fontSize: 17, fontWeight: 900, marginTop: 4 }}>{val}</div>
                {cur && <div style={{ fontSize: 10, fontWeight: 800, color: C.accent, marginTop: 3 }}>내 등급</div>}
              </div>
            );
          })}
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.sub, fontWeight: 600, lineHeight: 1.5 }}>※ 한도는 계정 안전을 위한 장치예요. 락 해제(무제한)는 관리자만 가능합니다.</p>
      </div>

      {/* 한도 게이지 */}
      {!unlimited && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: C.sub, marginBottom: 6 }}>
            <span>오늘 사용</span><span><b style={{ color: C.accent }}>{used}</b> / {limit}회</span>
          </div>
          <div style={{ height: 10, borderRadius: 6, background: C.surf2, overflow: "hidden", border: `1px solid ${C.line}` }}>
            <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${C.accent},#22d3ee)`, transition: "width .3s" }} />
          </div>
        </div>
      )}

      {/* 입력 폼 */}
      <div style={{ background: C.surf, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, marginBottom: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 대상 타입 */}
        <div>
          <label style={labelStyle}>어디로 유입시킬까요?</label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["place", "🗺️ 플레이스(지도)"], ["blog", "📝 블로그 글"]] as const).map(([k, lb]) => (
              <button key={k} onClick={() => setTargetType(k)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `2px solid ${targetType === k ? C.accent : C.line2}`, background: targetType === k ? C.accentSoft : C.surf2, color: targetType === k ? C.accent : C.sub, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>{lb}</button>
            ))}
          </div>
        </div>

        {/* 대상 입력 */}
        {targetType === "place" ? (
          <div>
            <label style={labelStyle}>내 플레이스 주소</label>
            <input value={placeUrl} onChange={(e) => setPlaceUrl(e.target.value)} placeholder="지도/플레이스 링크 붙여넣기 (m.place.naver.com/… 또는 map.naver.com/…)" style={inputStyle} />
          </div>
        ) : (
          <div>
            <label style={labelStyle}>내 블로그 글 주소</label>
            <input value={blogUrl} onChange={(e) => setBlogUrl(e.target.value)} placeholder="글 주소만 붙여넣으세요 (blog.naver.com/아이디/글번호) — 아이디·글번호 자동 인식" style={inputStyle} />
          </div>
        )}

        {/* 키워드 */}
        <div>
          <label style={labelStyle}>검색 키워드 <span style={{ color: C.sub, fontWeight: 600 }}>(여러 개 — 쉼표나 줄바꿈으로 구분, 돌아가며 검색)</span></label>
          <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={"예) 강남 맛집, 강남역 삼겹살, 역삼동 고깃집"} rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        </div>

        {/* 방문 텀 + 횟수 */}
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

        {/* 접속 기기 — 안 골라도 기본 모바일 */}
        <div>
          <label style={labelStyle}>접속 기기 <span style={{ color: C.sub, fontWeight: 600 }}>(기본 모바일 — 안 바꿔도 돼요)</span></label>
          <div style={{ display: "flex", gap: 8 }}>
            {([["mobile", "📱 모바일"], ["pc", "🖥️ PC"], ["mix", "🔀 혼합(랜덤)"]] as const).map(([k, lb]) => (
              <button key={k} onClick={() => setDevice(k)} style={{ flex: 1, padding: "11px", borderRadius: 12, border: `2px solid ${device === k ? C.accent : C.line2}`, background: device === k ? C.accentSoft : C.surf2, color: device === k ? C.accent : C.sub, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{lb}</button>
            ))}
          </div>
        </div>

        {/* 액션 + 자동/수동 + 계정 */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {targetType === "place" && (
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
              <input type="checkbox" checked={doSave} onChange={(e) => setDoSave(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent }} />저장하기
            </label>
          )}
          {targetType === "blog" && (
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
              <input type="checkbox" checked={doLike} onChange={(e) => setDoLike(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent }} />공감하기
            </label>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
            <input type="checkbox" checked={doShare} onChange={(e) => setDoShare(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent }} />공유하기
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent }} />자동(오늘 한도까지)
          </label>
          {accounts.length > 0 && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ ...inputStyle, width: "auto", flex: 1, minWidth: 160 }}>
              <option value="">계정 선택(저장·공감용, 선택)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.blog_name || a.username}</option>)}
            </select>
          )}
        </div>

        {/* 실행 / 정지 */}
        <div style={{ display: "flex", gap: 10 }}>
          {!running ? (
            <button onClick={start} style={{ flex: 1, padding: "16px", borderRadius: 14, border: "none", background: `linear-gradient(135deg,${C.accent},#22d3ee)`, color: "#fff", fontSize: 17, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 6px 18px ${C.accent}55` }}>🚀 유입 시작</button>
          ) : (
            <button onClick={stop} style={{ flex: 1, padding: "16px", borderRadius: 14, border: `2px solid ${C.accent}`, background: C.surf2, color: C.accent, fontSize: 17, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>⏹️ 정지</button>
          )}
        </div>
      </div>

      {/* 진행바 */}
      {running && (
        <div style={{ height: 8, borderRadius: 5, background: C.surf2, overflow: "hidden", marginBottom: 12, border: `1px solid ${C.line}` }}>
          <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg,${C.accent},#22d3ee)`, transition: "width .3s" }} />
        </div>
      )}

      {/* 넓은 라이브 로그 + 전체복사 */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>📜 전체 진행 로그</span>
          <button onClick={copyLogs} disabled={!logs.length} style={{ padding: "7px 14px", borderRadius: 9, border: `1.5px solid ${C.line2}`, background: C.surf, color: logs.length ? C.accent : C.sub, fontSize: 13, fontWeight: 800, cursor: logs.length ? "pointer" : "default", fontFamily: "inherit" }}>📋 로그 전체복사</button>
        </div>
        <div ref={logBoxRef} style={{ background: C.logBg, color: C.logInk, borderRadius: 14, padding: "14px 16px", height: 340, overflowY: "auto", fontSize: 13, lineHeight: 1.7, fontFamily: "'SF Mono','D2Coding',ui-monospace,monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {logs.length ? logs.map((l, i) => <div key={i}>{l}</div>) : <div style={{ opacity: 0.5 }}>여기에 검색 → 진입 → 체류 → 액션 전 과정이 실시간으로 표시돼요.</div>}
        </div>
      </div>
    </div>
  );
}
