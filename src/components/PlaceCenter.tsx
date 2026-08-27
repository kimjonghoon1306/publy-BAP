import { useEffect, useRef, useState } from "react";
import { BotEventStream, botFetch } from "../lib/botApi";
import { PLAN_CONFIG, CRAWL_DAILY_LIMIT } from "../lib/supabase";

const BOT = "http://127.0.0.1:3334";

const THEMES = {
  light: { bg: "#eee9df", surf: "#faf7f1", surf2: "#f3eee4", ink: "#2b2620", sub: "#8c8377", line: "#e0d7c9", line2: "#d5c9b7", accent: "#16856b", accentSoft: "#dcece5", logBg: "#fbf9f4", logInk: "#5c554a" },
  dark: { bg: "#221f1b", surf: "#2e2b26", surf2: "#39352f", ink: "#f7f3ec", sub: "#cabeae", line: "#4a443c", line2: "#5a5349", accent: "#67d5b5", accentSoft: "#29443b", logBg: "#1c1a16", logInk: "#d6ccbc" },
};

type Place = { placeId: string; name: string; category?: string; address?: string; visitorReviewCount?: number; blogReviewCount?: number; placeUrl: string };
type Blogger = { blogId: string; nick?: string; title?: string; fromPlace?: string };
type PlaceAcct = { accountId: string; id: string; pw: string; blogId: string; sessionOk: boolean; loginLoading?: boolean };
type Props = { showToast?: (m: string, t?: any) => void; theme?: "dark" | "light"; userId?: string; plan?: string };

const PLACE_LS_KEY = "publy_accounts_place";
const CATEGORIES = [
  { label: "전체", value: "place" }, { label: "맛집", value: "restaurant" },
  { label: "카페", value: "cafe" }, { label: "미용실", value: "hairshop" }, { label: "병원", value: "hospital" },
];

export default function PlaceCenter({ showToast, theme: extTheme, userId, plan = "free" }: Props) {
  const toast = (m: string, t?: string) => showToast?.(m, t);
  const theme: "dark" | "light" = extTheme === "dark" ? "dark" : "light";
  const C = THEMES[theme];
  const [mode, setMode] = useState<"places" | "bloggers">("places");
  const [region, setRegion] = useState("");
  const [domain, setDomain] = useState("restaurant");
  const [count, setCount] = useState(20);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlaces, setSelectedPlaces] = useState<Set<string>>(new Set());
  const [bloggers, setBloggers] = useState<Blogger[]>([]);
  const [selectedBloggers, setSelectedBloggers] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [bloggerRunning, setBloggerRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [quota, setQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const searchRef = useRef<BotEventStream | null>(null);
  const bloggersRef = useRef<BotEventStream | null>(null);

  const [mailAccounts, setMailAccounts] = useState<PlaceAcct[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PLACE_LS_KEY) || "[]");
      if (Array.isArray(saved) && saved.length) return saved.map((a: any) => ({ accountId: a.accountId, id: a.id || "", pw: a.pw || "", blogId: a.blogId || "", sessionOk: !!a.sessionOk }));
    } catch {}
    return [{ accountId: "place_acc_1", id: "", pw: "", blogId: "", sessionOk: false }];
  });
  const [mailAcctId, setMailAcctId] = useState("");
  const [showMailPw, setShowMailPw] = useState<Record<string, boolean>>({});
  const connectedMail = mailAccounts.filter(a => a.sessionOk && a.blogId);
  const savePlaceAccts = (list: PlaceAcct[]) => {
    try { localStorage.setItem(PLACE_LS_KEY, JSON.stringify(list.map(a => ({ accountId: a.accountId, id: a.id, pw: a.pw, blogId: a.blogId, sessionOk: a.sessionOk })))); } catch {}
  };
  const changeCrawlAccount = (accountId: string, patch: Partial<PlaceAcct>) => setMailAccounts(list => {
    const next = list.map(a => a.accountId === accountId ? { ...a, ...patch, ...(patch.id || patch.pw ? { sessionOk: false, blogId: "" } : {}) } : a);
    savePlaceAccts(next); return next;
  });
  const connectCrawlAccount = async (accountId: string) => {
    const acc = mailAccounts.find(a => a.accountId === accountId);
    if (!acc?.id || !acc.pw) { toast("아이디와 비밀번호를 입력하세요", "info"); return; }
    setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, loginLoading: true } : a));
    try {
      const response = await botFetch(`${BOT}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, id: acc.id, pw: acc.pw }) });
      const data = await response.json();
      if (data.ok || data.success) {
        const blogId = data.blogId || acc.blogId || acc.id;
        setMailAccounts(list => { const next = list.map(a => a.accountId === accountId ? { ...a, sessionOk: true, blogId, loginLoading: false } : a); savePlaceAccts(next); return next; });
        setMailAcctId(accountId); toast(`✅ ${blogId} 연결됨`, "success");
      } else {
        setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, sessionOk: false, loginLoading: false } : a));
        toast(data.error || "로그인 실패 — 아이디/비밀번호를 확인하세요", "error");
      }
    } catch (e: any) {
      setMailAccounts(list => list.map(a => a.accountId === accountId ? { ...a, loginLoading: false } : a));
      toast(/Failed to fetch|봇/i.test(e?.message || "") ? "봇 서버에 연결할 수 없어요(앱을 껐다 켜보세요)" : (e?.message || "연결 실패"), "error");
    } finally { try { (window as any).electron?.focusApp?.(); } catch {} }
  };
  const addCrawlAccount = () => setMailAccounts(list => [...list, { accountId: `place_acc_${Date.now()}`, id: "", pw: "", blogId: "", sessionOk: false }]);
  const removeCrawlAccount = (accountId: string) => setMailAccounts(list => {
    const next = list.filter(a => a.accountId !== accountId);
    const safe = next.length ? next : [{ accountId: "place_acc_1", id: "", pw: "", blogId: "", sessionOk: false }];
    savePlaceAccts(safe); if (mailAcctId === accountId) setMailAcctId(""); return safe;
  });

  useEffect(() => () => { searchRef.current?.close(); bloggersRef.current?.close(); }, []);
  const pushLog = (msg: string) => setLogs(l => [...l, `${new Date().toLocaleTimeString("ko-KR")}  ${msg}`]);
  const requireAccount = () => {
    if (!mailAcctId || !connectedMail.some(a => a.accountId === mailAcctId)) { toast("먼저 네이버 계정을 연결하고 ◉ 라디오로 작업 계정을 선택하세요", "info"); return false; }
    return true;
  };
  const handleQuota = (d: any) => {
    if (d.type === "quota_info" || d.type === "quota_exceeded") setQuota({ used: Number(d.used) || 0, limit: Number(d.limit) || 0, remaining: Number(d.remaining) || 0 });
    if (d.type === "quota_exceeded") toast("오늘 플레이스 발굴 한도를 다 썼어요", "error");
  };
  const startSearch = () => {
    if (!region.trim()) { toast("찾을 지역을 입력하세요. 예: 강남", "info"); return; }
    if (!requireAccount()) return;
    searchRef.current?.close(); setRunning(true); setLogs([]); setPlaces([]); setSelectedPlaces(new Set());
    const category = CATEGORIES.find(c => c.value === domain)?.label || "";
    const query = `${region.trim()}${domain === "place" ? "" : ` ${category}`}`.trim();
    pushLog(`📍 “${query}” 업체 ${count}곳을 찾기 시작해요`);
    const url = `${BOT}/api/place/search?userId=${encodeURIComponent(userId || "")}&accountId=${encodeURIComponent(mailAcctId)}&query=${encodeURIComponent(query)}&domain=${encodeURIComponent(domain)}&count=${count}`;
    const es = new BotEventStream(url); searchRef.current = es;
    es.onmessage = (event: MessageEvent) => {
      let d: any; try { d = JSON.parse(event.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "quota_info" || d.type === "quota_exceeded") { handleQuota(d); if (d.type === "quota_exceeded") { setRunning(false); es.close(); searchRef.current = null; } }
      else if (d.type === "place_done") { const result = (d.results || []) as Place[]; setPlaces(result); setRunning(false); pushLog(`✅ 업체 ${result.length}곳을 찾았어요`); toast(`업체 ${result.length}곳 발굴 완료`, "success"); es.close(); searchRef.current = null; }
      else if (d.type === "error") { pushLog(`❌ ${d.msg || "검색 실패"}`); toast(d.msg || "검색 실패", "error"); setRunning(false); es.close(); searchRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류 — 앱을 껐다 켜보세요"); toast("봇 연결 오류", "error"); setRunning(false); es.close(); searchRef.current = null; };
  };
  const startBloggers = () => {
    if (!requireAccount()) return;
    const picked = places.filter(p => selectedPlaces.has(p.placeId)).map(p => ({ placeId: p.placeId, name: p.name }));
    if (!picked.length) { toast("먼저 업체 카드에서 한 곳 이상 체크하세요", "info"); return; }
    bloggersRef.current?.close(); setMode("bloggers"); setBloggerRunning(true); setBloggers([]); setSelectedBloggers(new Set());
    pushLog(`🧭 선택한 업체 ${picked.length}곳의 리뷰 블로거를 찾기 시작해요`);
    const url = `${BOT}/api/place/bloggers?userId=${encodeURIComponent(userId || "")}&accountId=${encodeURIComponent(mailAcctId)}&places=${encodeURIComponent(JSON.stringify(picked))}&domain=${encodeURIComponent(domain)}`;
    const es = new BotEventStream(url); bloggersRef.current = es;
    es.onmessage = (event: MessageEvent) => {
      let d: any; try { d = JSON.parse(event.data); } catch { return; }
      if (d.type === "log") pushLog(d.msg);
      else if (d.type === "blogger" && d.blogId) setBloggers(list => list.some(b => b.blogId === d.blogId) ? list : [...list, { blogId: d.blogId, nick: d.nick, title: d.title, fromPlace: d.fromPlace }]);
      else if (d.type === "bloggers_done") { setBloggerRunning(false); pushLog(`✅ 블로거 ${d.count ?? ""}명을 찾았어요`); toast(`블로거 ${d.count ?? ""}명 역추적 완료`, "success"); es.close(); bloggersRef.current = null; }
      else if (d.type === "error") { pushLog(`❌ ${d.msg || "역추적 실패"}`); toast(d.msg || "역추적 실패", "error"); setBloggerRunning(false); es.close(); bloggersRef.current = null; }
    };
    es.onerror = () => { pushLog("❌ 봇 연결 오류 — 앱을 껐다 켜보세요"); toast("봇 연결 오류", "error"); setBloggerRunning(false); es.close(); bloggersRef.current = null; };
  };
  const stop = (kind: "places" | "bloggers") => { const ref = kind === "places" ? searchRef : bloggersRef; ref.current?.close(); ref.current = null; kind === "places" ? setRunning(false) : setBloggerRunning(false); pushLog("⏹ 사용자가 중단했어요"); };
  const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const exportCsv = (kind: "places" | "bloggers") => {
    const placeRows = places.filter(p => !selectedPlaces.size || selectedPlaces.has(p.placeId));
    const bloggerRows = bloggers.filter(b => !selectedBloggers.size || selectedBloggers.has(b.blogId));
    const rows = kind === "places"
      ? [["업체ID", "업체명", "카테고리", "주소", "방문자리뷰", "블로그리뷰", "지도URL"], ...placeRows.map(p => [p.placeId, p.name, p.category, p.address, p.visitorReviewCount, p.blogReviewCount, p.placeUrl])]
      : [["블로그ID", "닉네임", "리뷰제목", "발견업체", "블로그URL"], ...bloggerRows.map(b => [b.blogId, b.nick, b.title, b.fromPlace, `https://blog.naver.com/${b.blogId}`])];
    if (rows.length === 1) { toast("내보낼 결과가 없어요", "info"); return; }
    const blob = new Blob(["\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `publy-${kind}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
    toast("CSV 파일을 저장했어요", "success");
  };

  const inp = { background: theme === "dark" ? C.surf2 : "#fff", border: `1px solid ${C.line2}`, borderRadius: 11, padding: "11px 12px", fontSize: 13, fontWeight: 600, color: C.ink, width: "100%", outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const };
  const card = { background: C.surf, border: `1px solid ${C.line}`, borderRadius: 18 } as const;
  const label = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", color: C.sub, textTransform: "uppercase" as const, marginBottom: 7 };
  const btn = { border: "none", borderRadius: 12, padding: "11px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", color: theme === "dark" ? "#16342c" : "#fff", fontFamily: "inherit", background: C.accent, transition: "transform .14s,filter .14s" } as const;
  const ghost = { ...btn, color: C.ink, background: "transparent", border: `1px solid ${C.line2}` } as const;
  const Help = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.6, marginBottom: 14, display: "flex", gap: 6, alignItems: "flex-start" }}><span>💬</span><span>{children}</span></div>;
  const ActionButton = ({ children, onClick, disabled, style }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; style?: React.CSSProperties }) => <button className="pc-action" onClick={onClick} disabled={disabled} style={{ ...btn, opacity: disabled ? .55 : 1, ...style }}>{children}</button>;

  const renderMailAccounts = () => <div style={{ padding: 14, borderRadius: 15, background: `${C.accent}0d`, border: `1px solid ${C.line2}` }}>
    <div style={{ fontSize: 12.5, fontWeight: 900, color: C.ink, marginBottom: 5 }}>👤 플레이스 작업 네이버 계정</div>
    <Help>계정을 연결한 뒤 <b style={{ color: C.accent }}>◉ 동그라미</b>를 눌러 작업 계정을 고르세요. 플레이스 전용으로 저장되어 다른 탭 계정과 섞이지 않아요.</Help>
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{mailAccounts.map(a => <div key={a.accountId} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 9px", borderRadius: 12, background: a.sessionOk ? `${C.accent}16` : C.surf, border: `1px solid ${a.sessionOk ? C.accent : C.line2}` }}>
      {a.sessionOk ? <>
        <input type="radio" name="placeAcct" checked={mailAcctId === a.accountId} onChange={() => setMailAcctId(a.accountId)} style={{ accentColor: C.accent }} />
        <span style={{ color: C.accent, fontWeight: 900, fontSize: 12 }}>✅ {a.blogId}</span><span style={{ fontSize: 10, color: C.sub }}>연결됨</span>
        <button className="pc-action" onClick={() => connectCrawlAccount(a.accountId)} disabled={a.loginLoading} title="로그인이 풀렸을 때 다시 연결해요" style={{ ...ghost, marginLeft: "auto", padding: "4px 9px", fontSize: 10.5 }}>{a.loginLoading ? "재연결 중…" : "🔄 재연결"}</button>
        <button className="pc-action" onClick={() => removeCrawlAccount(a.accountId)} title="이 계정을 목록에서 지워요" style={{ ...ghost, padding: "4px 9px", fontSize: 10.5 }}>삭제</button>
      </> : <>
        <input value={a.id} onChange={e => changeCrawlAccount(a.accountId, { id: e.target.value })} placeholder="네이버 아이디" style={{ ...inp, flex: 1, minWidth: 100, padding: "7px 9px" }} />
        <div style={{ position: "relative", flex: 1, minWidth: 100 }}><input type={showMailPw[a.accountId] ? "text" : "password"} value={a.pw} onChange={e => changeCrawlAccount(a.accountId, { pw: e.target.value })} onKeyDown={e => { if (e.key === "Enter") connectCrawlAccount(a.accountId); }} placeholder="비밀번호" style={{ ...inp, padding: "7px 34px 7px 9px" }} /><button type="button" onClick={() => setShowMailPw(s => ({ ...s, [a.accountId]: !s[a.accountId] }))} style={{ position: "absolute", right: 5, top: 6, border: 0, background: "transparent", cursor: "pointer" }}>{showMailPw[a.accountId] ? "🙈" : "👁️"}</button></div>
        <ActionButton onClick={() => connectCrawlAccount(a.accountId)} disabled={a.loginLoading || !a.id || !a.pw} style={{ padding: "8px 12px", fontSize: 11 }}>{a.loginLoading ? "연결 중…" : "🔗 연결"}</ActionButton>
        {mailAccounts.length > 1 && <button className="pc-action" onClick={() => removeCrawlAccount(a.accountId)} style={{ ...ghost, padding: "7px 9px" }}>✕</button>}
      </>}
    </div>)}<button className="pc-action" onClick={addCrawlAccount} title="플레이스 작업에 쓸 네이버 계정을 하나 더 등록해요" style={{ ...ghost, padding: "7px 11px", fontSize: 11, alignSelf: "flex-start" }}>+ 계정 추가</button></div>
  </div>;

  return <div style={{ background: C.bg, color: C.ink, minHeight: 500, borderRadius: 8, padding: "clamp(14px,3vw,28px)", fontFamily: "'Noto Sans KR',sans-serif", overflow: "hidden" }}>
    <style>{`@keyframes pcUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.pc-action:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px)}.pc-action:active:not(:disabled){transform:translateY(1px) scale(.985)}.pc-card{animation:pcUp .35s ease both}.pc-card:hover{transform:translateY(-2px);box-shadow:0 14px 28px -22px rgba(0,0,0,.65)}@media(max-width:620px){.pc-wide{grid-column:1/-1}}`}</style>
    <div style={{ ...card, position: "relative", overflow: "hidden", padding: "22px clamp(16px,3vw,28px)", marginBottom: 15 }}>
      <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", right: -60, top: -80, border: `28px solid ${C.accent}12` }} />
      <div style={{ fontSize: 11, color: C.accent, fontWeight: 900, letterSpacing: ".18em", marginBottom: 7 }}>PUBLY PLACE MAP</div>
      <div style={{ fontSize: "clamp(21px,4vw,31px)", fontWeight: 900, letterSpacing: "-.04em" }}>🗺️ 동네 업체에서 블로거까지</div>
      <div style={{ color: C.sub, fontSize: 12.5, marginTop: 7, lineHeight: 1.6 }}>지역 업체를 지도처럼 모으고, 실제 리뷰를 쓴 블로거를 이어서 찾아요.</div>
    </div>

    <section style={{ ...card, padding: "18px", marginBottom: 15 }}>{renderMailAccounts()}</section>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 7, background: C.surf2, borderRadius: 15, padding: 5, marginBottom: 15 }}>
      {(["places", "bloggers"] as const).map((m, i) => <button key={m} className="pc-action" onClick={() => setMode(m)} title={i ? "선택한 업체의 리뷰를 쓴 블로거 목록을 봐요" : "지역과 업종으로 업체를 찾아요"} style={{ border: 0, borderRadius: 11, padding: "11px 8px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, color: mode === m ? (theme === "dark" ? "#17382f" : "#fff") : C.sub, background: mode === m ? C.accent : "transparent" }}>{i ? `② 블로거 역추적 ${bloggers.length ? `(${bloggers.length})` : ""}` : `① 업체 발굴 ${places.length ? `(${places.length})` : ""}`}</button>)}
    </div>

    {mode === "places" ? <>
      <section style={{ ...card, padding: 19, marginBottom: 15 }}>
        <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 5 }}>📍 업체 발굴</div>
        <Help>찾을 <b style={{ color: C.ink }}>지역</b>과 <b style={{ color: C.ink }}>업종</b>을 고른 뒤 START를 누르세요. 예: 지역에 “강남”, 업종에 “맛집”을 고르면 “강남 맛집”을 찾아요.</Help>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(110px,.8fr) minmax(90px,.45fr)", gap: 10, alignItems: "end" }}>
          <div className="pc-wide"><div style={label}>지역</div><input value={region} onChange={e => setRegion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") startSearch(); }} placeholder="예: 강남, 성수, 부산 해운대" style={inp} /></div>
          <div><div style={label}>업종</div><select value={domain} onChange={e => setDomain(e.target.value)} style={inp}>{CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
          <div><div style={label}>개수</div><select value={count} onChange={e => setCount(Number(e.target.value))} style={inp}>{[10, 20, 30, 50, 100].map(n => <option key={n} value={n}>{n}곳</option>)}</select></div>
        </div>
        <Help><b style={{ color: C.accent }}>START</b>는 위 조건으로 업체 찾기를 시작해요. 작업 계정이 선택되어 있어야 해요.</Help>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{running ? <ActionButton onClick={() => stop("places")} style={{ background: "#d45b50" }}>■ 찾기 중단</ActionButton> : <ActionButton onClick={startSearch}>📌 START · 업체 찾기</ActionButton>}<button className="pc-action" onClick={() => exportCsv("places")} title="체크한 업체만, 체크가 없으면 전체 업체를 엑셀용 파일로 저장해요" style={ghost}>CSV 내보내기</button></div>
      </section>
      <section style={{ ...card, padding: 19, marginBottom: 15 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><b style={{ fontSize: 16 }}>업체 목록 · {places.length}곳</b><span style={{ color: C.accent, fontSize: 12, fontWeight: 800 }}>선택 {selectedPlaces.size}곳</span><button className="pc-action" onClick={() => setSelectedPlaces(selectedPlaces.size === places.length ? new Set() : new Set(places.map(p => p.placeId)))} title="목록의 업체를 한 번에 모두 선택하거나 해제해요" style={{ ...ghost, padding: "6px 10px", marginLeft: "auto", fontSize: 11 }}>전체 선택/해제</button></div>
        <Help>카드의 체크칸으로 역추적할 업체를 고르세요. <b style={{ color: C.ink }}>지도에서 보기</b>를 누르면 네이버 플레이스가 열려요.</Help>
        {!places.length ? <div style={{ textAlign: "center", padding: 35, color: C.sub, fontSize: 13 }}>아직 찾은 업체가 없어요. 위에서 지역과 업종을 정해 시작하세요.</div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,245px),1fr))", gap: 11 }}>{places.map(p => <article className="pc-card" key={p.placeId} onClick={() => setSelectedPlaces(s => { const n = new Set(s); n.has(p.placeId) ? n.delete(p.placeId) : n.add(p.placeId); return n; })} style={{ minWidth: 0, padding: 15, borderRadius: 16, border: `1.5px solid ${selectedPlaces.has(p.placeId) ? C.accent : C.line}`, background: selectedPlaces.has(p.placeId) ? `${C.accent}0e` : C.surf2, cursor: "pointer", transition: "all .18s" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}><input type="checkbox" checked={selectedPlaces.has(p.placeId)} onChange={() => {}} style={{ accentColor: C.accent, marginTop: 4 }} /><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 14.5, fontWeight: 900, overflowWrap: "anywhere" }}>{p.name}</div>{p.category && <span style={{ display: "inline-block", fontSize: 10, color: C.accent, background: C.accentSoft, borderRadius: 99, padding: "3px 8px", marginTop: 6, fontWeight: 800 }}>{p.category}</span>}</div></div>
          <div style={{ color: C.sub, fontSize: 11.5, margin: "10px 0", minHeight: 34, lineHeight: 1.5 }}>📌 {p.address || "주소 정보 없음"}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: C.ink, fontWeight: 700 }}><span>👥 방문자리뷰 {(p.visitorReviewCount || 0).toLocaleString()}</span><span>✍️ 블로그리뷰 {(p.blogReviewCount || 0).toLocaleString()}</span></div>
          <a href={p.placeUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ display: "inline-block", marginTop: 12, color: C.accent, fontSize: 11.5, fontWeight: 900 }}>지도에서 보기 ↗</a>
        </article>)}</div>}
        <div style={{ marginTop: 14 }}><Help><b style={{ color: C.accent }}>이 업체 리뷰 쓴 블로거 찾기</b>는 체크한 업체의 리뷰 작성자를 이어서 찾아요. 업체를 먼저 골라야 해요.</Help><ActionButton onClick={startBloggers} disabled={!selectedPlaces.size || bloggerRunning}>🧭 이 업체 리뷰 쓴 블로거 찾기 ({selectedPlaces.size})</ActionButton></div>
      </section>
    </> : <section style={{ ...card, padding: 19, marginBottom: 15 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><b style={{ fontSize: 17 }}>🧭 블로거 역추적 · {bloggers.length}명</b><span style={{ color: C.accent, fontSize: 12, fontWeight: 800 }}>선택 {selectedBloggers.size}명</span></div>
      <Help>업체 리뷰를 실제로 쓴 블로거가 찾는 즉시 한 장씩 나타나요. 블로그를 열어 글을 확인하거나 필요한 사람만 체크해 CSV로 저장하세요.</Help>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{bloggerRunning ? <ActionButton onClick={() => stop("bloggers")} style={{ background: "#d45b50" }}>■ 역추적 중단</ActionButton> : <ActionButton onClick={startBloggers} disabled={!selectedPlaces.size}>다시 역추적</ActionButton>}<button className="pc-action" onClick={() => exportCsv("bloggers")} title="체크한 블로거만, 체크가 없으면 전체 블로거를 저장해요" style={ghost}>CSV 내보내기</button><button className="pc-action" onClick={() => setSelectedBloggers(selectedBloggers.size === bloggers.length ? new Set() : new Set(bloggers.map(b => b.blogId)))} title="블로거를 모두 선택하거나 해제해요" style={ghost}>전체 선택/해제</button></div>
      {!bloggers.length ? <div style={{ textAlign: "center", padding: 40, color: C.sub }}>① 업체 발굴에서 업체를 체크한 뒤 역추적 버튼을 눌러주세요.</div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,235px),1fr))", gap: 11 }}>{bloggers.map(b => <article className="pc-card" key={b.blogId} onClick={() => setSelectedBloggers(s => { const n = new Set(s); n.has(b.blogId) ? n.delete(b.blogId) : n.add(b.blogId); return n; })} style={{ minWidth: 0, padding: 15, borderRadius: "16px 16px 16px 4px", border: `1.5px solid ${selectedBloggers.has(b.blogId) ? C.accent : C.line}`, background: selectedBloggers.has(b.blogId) ? `${C.accent}0e` : C.surf2, cursor: "pointer", transition: "all .18s" }}>
        <div style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={selectedBloggers.has(b.blogId)} onChange={() => {}} style={{ accentColor: C.accent }} /><div style={{ minWidth: 0 }}><b style={{ fontSize: 14 }}>{b.nick || b.blogId}</b><div style={{ color: C.sub, fontSize: 10.5, marginTop: 2 }}>@{b.blogId}</div></div></div>
        <div style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 11, overflowWrap: "anywhere" }}>{b.title || "리뷰 제목 없음"}</div><div style={{ marginTop: 9, fontSize: 10.5, color: C.accent, fontWeight: 800 }}>📍 {b.fromPlace || "선택 업체"}에서 발견</div>
        <a href={`https://blog.naver.com/${b.blogId}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ display: "inline-block", marginTop: 11, color: C.accent, fontSize: 11.5, fontWeight: 900 }}>블로그 열기 ↗</a>
      </article>)}</div>}
    </section>}

    <section style={{ ...card, padding: 18, marginBottom: 15 }}><div style={{ fontSize: 15, fontWeight: 900, marginBottom: 5 }}>📟 진행 안내</div><Help>찾는 동안 봇이 무엇을 하고 있는지 보여줘요. 문제가 생기면 마지막 빨간 안내를 확인하세요.</Help>{quota && <div style={{ fontSize: 12, color: quota.remaining <= 0 ? "#d45b50" : C.accent, fontWeight: 900, marginBottom: 8 }}>{plan === "admin" || plan === "unlimited" ? "관리자 무제한 ∞" : `오늘 발굴 ${quota.used} / ${quota.limit} · ${quota.remaining} 남음`}</div>}<div style={{ background: C.logBg, color: C.logInk, borderRadius: 13, padding: 13, maxHeight: 150, overflowY: "auto", fontFamily: "monospace", fontSize: 11, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{logs.length ? logs.join("\n") : "작업을 시작하면 진행 내용이 여기에 나와요."}</div></section>

    <section style={{ ...card, padding: 18 }}><div style={{ fontSize: 15, fontWeight: 900, marginBottom: 5 }}>📋 등급별 플레이스 발굴 한도</div><Help>플레이스 발굴은 크롤링 발굴과 <b style={{ color: C.ink }}>같은 하루 한도</b>를 함께 써요. 매일 자정에 다시 채워져요.</Help><div style={{ border: `1px solid ${C.line}`, borderRadius: 13, overflow: "hidden" }}><div style={{ display: "grid", gridTemplateColumns: "1fr .8fr 1fr", background: C.surf2 }}>{["등급", "계정", "발굴/일"].map((h, i) => <div key={h} style={{ padding: "9px 10px", fontSize: 10.5, color: C.sub, fontWeight: 900, borderLeft: i ? `1px solid ${C.line}` : "none" }}>{h}</div>)}</div>{(["free", "basic", "pro"] as const).map(pl => { const conf = PLAN_CONFIG[pl]; const current = plan === pl; return <div key={pl} style={{ display: "grid", gridTemplateColumns: "1fr .8fr 1fr", borderTop: `1px solid ${C.line}`, background: current ? C.accentSoft : "transparent" }}><div style={{ padding: 10, fontSize: 12, color: current ? C.accent : C.ink, fontWeight: 900 }}>{conf.label}{current ? " (내 등급)" : ""}</div><div style={{ padding: 10, fontSize: 12, borderLeft: `1px solid ${C.line}` }}>{conf.maxAccounts}개</div><div style={{ padding: 10, fontSize: 12, borderLeft: `1px solid ${C.line}`, fontWeight: 800 }}>{CRAWL_DAILY_LIMIT[pl] ?? conf.dailyCrawl}곳</div></div>; })}</div><div style={{ fontSize: 10.5, color: C.sub, marginTop: 9 }}>💡 관리자·무제한 등급은 이 회원용 표에서 제외되며 실제 작업은 무제한으로 처리돼요.</div></section>
  </div>;
}
