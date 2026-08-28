import { useEffect, useMemo, useState } from "react";
import PlaceCenter from "./PlaceCenter";
import { getPlace360Snapshots, place360StoreKey, Place360Snapshot, savePlace360Snapshot } from "../lib/supabase";

type Props = {
  showToast?: (message: string, type?: any) => void;
  theme?: "dark" | "light";
  userId?: string;
  plan?: string;
  onOpenCrawl?: () => void;
};

type Place360Tab = "overview" | "diagnosis" | "discovery";
type StoreProfile = {
  name: string;
  placeUrl: string;
  category: string;
  region: string;
  goal: "visitors" | "reviews" | "exposure" | "repeat";
};
type CollectedPlace = { placeId: string; name: string; category?: string; address?: string; visitorReviewCount?: number; blogReviewCount?: number; placeUrl: string };

const EMPTY_PROFILE: StoreProfile = { name: "", placeUrl: "", category: "", region: "", goal: "visitors" };

const DIAGNOSIS_ITEMS = [
  { icon: "🧲", title: "신규 고객", state: "진단 준비", desc: "검색 노출과 최근 리뷰 증가를 경쟁업체와 비교해요." },
  { icon: "📍", title: "플레이스 노출", state: "진단 준비", desc: "지역·업종 키워드에서 매장이 얼마나 잘 보이는지 확인해요." },
  { icon: "⭐", title: "리뷰 활동", state: "진단 준비", desc: "방문자 리뷰와 블로그 리뷰가 꾸준히 늘고 있는지 살펴봐요." },
  { icon: "🔁", title: "재방문 가능성", state: "자료 필요", desc: "반복 방문 표현을 분석하고, POS 자료 연결 시 실제 재방문율도 확인해요." },
  { icon: "📣", title: "광고 효율", state: "자료 필요", desc: "광고 보고서를 연결하면 비용 대비 클릭·전화·예약을 진단해요." },
  { icon: "🏙️", title: "상권 관심도", state: "추정 진단", desc: "주변 업체와 지역 검색 변화를 이용해 상권 흐름을 추정해요." },
] as const;

function profileKey(userId?: string) {
  return `publy_place360_profile_v1:${userId || "guest"}`;
}

function loadProfile(userId?: string): StoreProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(profileKey(userId)) || "null");
    return saved && typeof saved.name === "string" ? { ...EMPTY_PROFILE, ...saved } : EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
}

export default function Place360({ showToast, theme = "light", userId, plan = "free", onOpenCrawl }: Props) {
  const [tab, setTab] = useState<Place360Tab>("overview");
  const [profile, setProfile] = useState<StoreProfile>(() => loadProfile(userId));
  const [draft, setDraft] = useState<StoreProfile>(() => loadProfile(userId));
  const [collectedPlaces, setCollectedPlaces] = useState<CollectedPlace[]>([]);
  const [snapshots, setSnapshots] = useState<Place360Snapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const hasStore = Boolean(profile.name.trim());
  const ownPlace = useMemo(() => {
    const needle = profile.name.replace(/\s+/g, "").toLowerCase();
    if (!needle) return undefined;
    return collectedPlaces.find(place => {
      const name = place.name.replace(/\s+/g, "").toLowerCase();
      return name.includes(needle) || needle.includes(name);
    });
  }, [collectedPlaces, profile.name]);
  const comparison = useMemo(() => {
    const competitors = collectedPlaces.filter(place => place.placeId !== ownPlace?.placeId);
    if (!competitors.length) return null;
    const avgVisitor = Math.round(competitors.reduce((sum, place) => sum + (place.visitorReviewCount || 0), 0) / competitors.length);
    const avgBlog = Math.round(competitors.reduce((sum, place) => sum + (place.blogReviewCount || 0), 0) / competitors.length);
    return { count: competitors.length, avgVisitor, avgBlog };
  }, [collectedPlaces, ownPlace?.placeId]);
  const storeKey = place360StoreKey(profile.name, profile.region);
  useEffect(() => {
    if (!storeKey || plan === "admin") { setSnapshots([]); return; }
    let active = true;
    setHistoryLoading(true);
    getPlace360Snapshots(storeKey).then(rows => { if (active) setSnapshots(rows); }).catch(() => { if (active) setSnapshots([]); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [plan, storeKey]);

  const onPlacesCollected = async (rows: CollectedPlace[]) => {
    setCollectedPlaces(rows);
    const needle = profile.name.replace(/\s+/g, "").toLowerCase();
    const own = needle ? rows.find(place => {
      const name = place.name.replace(/\s+/g, "").toLowerCase();
      return name.includes(needle) || needle.includes(name);
    }) : undefined;
    if (!own || plan === "admin") return;
    const competitors = rows.filter(place => place.placeId !== own.placeId);
    if (!competitors.length) return;
    const avgVisitor = Math.round(competitors.reduce((sum, place) => sum + (place.visitorReviewCount || 0), 0) / competitors.length);
    const avgBlog = Math.round(competitors.reduce((sum, place) => sum + (place.blogReviewCount || 0), 0) / competitors.length);
    try {
      await savePlace360Snapshot({ store_key: storeKey, store_name: own.name, region: profile.region, category: profile.category, visitor_reviews: own.visitorReviewCount || 0, blog_reviews: own.blogReviewCount || 0, competitor_count: competitors.length, competitor_avg_visitor: avgVisitor, competitor_avg_blog: avgBlog, collected_count: rows.length });
      setSnapshots(await getPlace360Snapshots(storeKey));
      showToast?.("오늘의 플레이스 360 측정 기록을 안전하게 저장했어요", "success");
    } catch {
      showToast?.("비교는 완료됐지만 측정 기록 서버가 아직 준비되지 않았어요", "info");
    }
  };

  const trend = useMemo(() => {
    if (snapshots.length < 2) return null;
    const latest = snapshots[0];
    const latestTime = new Date(latest.measured_on).getTime();
    const prior = snapshots.find(row => latestTime - new Date(row.measured_on).getTime() >= 6 * 86400000) || snapshots[snapshots.length - 1];
    return { days: Math.max(1, Math.round((latestTime - new Date(prior.measured_on).getTime()) / 86400000)), visitor: latest.visitor_reviews - prior.visitor_reviews, blog: latest.blog_reviews - prior.blog_reviews };
  }, [snapshots]);
  const prescriptions = useMemo(() => {
    const items: Array<{ level: "danger" | "warning" | "ready"; title: string; reason: string; action: string; go: Place360Tab }> = [];
    if (!ownPlace || !comparison) {
      items.push({ level: "ready", title: "먼저 내 매장과 주변 업체를 찾아주세요", reason: "첫 수집 결과가 앞으로 변화를 판단하는 기준선이 됩니다.", action: "업체 찾기 시작", go: "discovery" });
      return items;
    }
    if ((ownPlace.blogReviewCount || 0) < comparison.avgBlog) items.push({ level: "danger", title: "블로그 리뷰 보강이 먼저예요", reason: `내 매장은 ${(ownPlace.blogReviewCount || 0).toLocaleString()}개, 주변 평균은 ${comparison.avgBlog.toLocaleString()}개로 차이가 있어요.`, action: "경쟁업체 리뷰어 찾기", go: "discovery" });
    if ((ownPlace.visitorReviewCount || 0) < comparison.avgVisitor) items.push({ level: "warning", title: "방문 고객의 리뷰 참여를 점검하세요", reason: `방문자 리뷰가 주변 평균보다 ${(comparison.avgVisitor - (ownPlace.visitorReviewCount || 0)).toLocaleString()}개 적어요.`, action: "업체 비교 근거 보기", go: "diagnosis" });
    if (trend && trend.blog <= 0) items.push({ level: "warning", title: `최근 ${trend.days}일 블로그 리뷰가 정체됐어요`, reason: "새로운 지역형 리뷰어를 찾고 협업 후보로 보내는 작업을 추천해요.", action: "리뷰어 역추적", go: "discovery" });
    if (!items.length) items.push({ level: "ready", title: "현재 리뷰 기준은 주변 평균 이상이에요", reason: "지금 상태를 유지하면서 다음 측정에서 증가 속도를 비교해 보세요.", action: "다음 측정 준비", go: "discovery" });
    return items.slice(0, 3);
  }, [comparison, ownPlace, trend]);
  const dark = theme === "dark";

  const colors = useMemo(() => dark ? {
    bg: "#221f1b", card: "#2e2b26", soft: "#39352f", line: "#4a443c", text: "#f7f3ec", sub: "#cabeae", rose: "#ff7daa", green: "#67d5b5", amber: "#ffc466",
  } : {
    bg: "#eee9df", card: "#fffdf8", soft: "#f5efe4", line: "#e0d7c9", text: "#2b2620", sub: "#756b5e", rose: "#e93f79", green: "#16856b", amber: "#aa7100",
  }, [dark]);

  const saveStore = () => {
    if (!draft.name.trim()) {
      showToast?.("먼저 내 매장 이름을 입력해 주세요", "info");
      return;
    }
    const next = { ...draft, name: draft.name.trim(), placeUrl: draft.placeUrl.trim() };
    localStorage.setItem(profileKey(userId), JSON.stringify(next));
    setProfile(next);
    showToast?.("내 매장을 저장했어요. 이제 진단을 시작할 수 있어요", "success");
    setTab("diagnosis");
  };

  const tabs: Array<{ id: Place360Tab; icon: string; label: string; desc: string }> = [
    { id: "overview", icon: "🏠", label: "한눈에 보기", desc: "현재 상태와 다음 할 일" },
    { id: "diagnosis", icon: "🩺", label: "내 매장 진단", desc: "손님이 줄어든 이유 찾기" },
    { id: "discovery", icon: "🕵️", label: "업체·리뷰어 찾기", desc: "업체 발굴과 리뷰어 역추적" },
  ];

  const fieldStyle: React.CSSProperties = { width: "100%", minHeight: 48, borderRadius: 12, border: `1px solid ${colors.line}`, background: dark ? colors.soft : "#fff", color: colors.text, padding: "11px 13px", fontFamily: "inherit", fontSize: 16, outline: "none" };
  const cardStyle: React.CSSProperties = { border: `1px solid ${colors.line}`, borderRadius: 20, background: colors.card };

  return <div className="p360" style={{ minHeight: 600, padding: "clamp(10px,2vw,22px)", borderRadius: 10, background: colors.bg, color: colors.text }}>
    <style>{`
      .p360 *{box-sizing:border-box}.p360-button{min-height:48px;border:0;border-radius:13px;padding:11px 16px;font-family:inherit;font-weight:900;cursor:pointer;transition:transform .15s,filter .15s}.p360-button:hover{filter:brightness(1.04);transform:translateY(-1px)}
      .p360-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.p360-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.p360-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      @media(max-width:760px){.p360{padding:8px 6px 120px!important}.p360-tabs{grid-template-columns:1fr}.p360-grid,.p360-two{grid-template-columns:1fr}.p360-tab{text-align:left!important;display:grid!important;grid-template-columns:42px 1fr!important;align-items:center}.p360-hero{padding:20px 16px!important}.p360-title{font-size:25px!important}.p360-card{padding:16px!important}.p360-prescription{grid-template-columns:1fr!important}.p360-prescription .p360-button{width:100%}}
    `}</style>

    <header className="p360-hero" style={{ ...cardStyle, position: "relative", overflow: "hidden", padding: "26px 28px", marginBottom: 12 }}>
      <div style={{ position: "absolute", right: -55, top: -70, width: 210, height: 210, borderRadius: "50%", border: `34px solid ${colors.rose}12` }} />
      <div style={{ color: colors.rose, fontSize: 11, fontWeight: 950, letterSpacing: ".16em" }}>PUBLY PLACE 360</div>
      <h1 className="p360-title" style={{ margin: "7px 0 6px", fontSize: 32, letterSpacing: "-.045em" }}>🏪 내 매장을 한눈에, 해결까지 한 번에</h1>
      <p style={{ margin: 0, maxWidth: 760, color: colors.sub, fontSize: 13, lineHeight: 1.75 }}>손님이 줄어든 이유를 찾고, 경쟁업체와 리뷰어를 확인한 뒤 실제 홍보 작업까지 순서대로 이어드려요.</p>
    </header>

    <nav className="p360-tabs" aria-label="플레이스 360 메뉴" style={{ marginBottom: 12 }}>
      {tabs.map(item => <button key={item.id} type="button" className="p360-button p360-tab" aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)} style={{ display: "flex", gap: 10, justifyContent: "center", border: `1px solid ${tab === item.id ? colors.rose : colors.line}`, background: tab === item.id ? `${colors.rose}16` : colors.card, color: tab === item.id ? colors.rose : colors.text }}>
        <span style={{ fontSize: 24 }}>{item.icon}</span><span><b style={{ display: "block", fontSize: 14 }}>{item.label}</b><small style={{ display: "block", marginTop: 2, color: colors.sub, fontSize: 10.5 }}>{item.desc}</small></span>
      </button>)}
    </nav>

    {tab === "overview" && <main>
      {!hasStore ? <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12 }}>
        <div style={{ fontSize: 19, fontWeight: 950 }}>먼저 내 매장을 알려주세요</div>
        <p style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.7, margin: "6px 0 16px" }}>매장 이름만 입력해도 시작할 수 있어요. 플레이스 주소를 함께 넣으면 이후 자동 진단 연결이 더 정확해져요.</p>
        <div className="p360-two">
          <label><b style={{ display: "block", marginBottom: 7, fontSize: 12 }}>매장 이름 · 필수</b><input value={draft.name} onChange={e => setDraft(v => ({ ...v, name: e.target.value }))} placeholder="예: 퍼블리 식당 성수점" style={fieldStyle} /></label>
          <label><b style={{ display: "block", marginBottom: 7, fontSize: 12 }}>네이버 플레이스 주소 · 선택</b><input value={draft.placeUrl} onChange={e => setDraft(v => ({ ...v, placeUrl: e.target.value }))} placeholder="플레이스 주소를 붙여 넣으세요" style={fieldStyle} /></label>
          <label><b style={{ display: "block", marginBottom: 7, fontSize: 12 }}>지역</b><input value={draft.region} onChange={e => setDraft(v => ({ ...v, region: e.target.value }))} placeholder="예: 성수동" style={fieldStyle} /></label>
          <label><b style={{ display: "block", marginBottom: 7, fontSize: 12 }}>업종</b><input value={draft.category} onChange={e => setDraft(v => ({ ...v, category: e.target.value }))} placeholder="예: 한식, 카페, 미용실" style={fieldStyle} /></label>
        </div>
        <button type="button" className="p360-button" onClick={saveStore} style={{ marginTop: 14, width: "100%", background: colors.rose, color: "#fff" }}>내 매장 저장하고 진단 시작하기 →</button>
      </section> : <>
        <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12 }}>
          <div style={{ color: colors.green, fontWeight: 900, fontSize: 11 }}>내 매장 성장 프로젝트</div>
          <h2 style={{ margin: "5px 0", fontSize: 23 }}>{profile.name}</h2>
          <p style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.65 }}>{[profile.region, profile.category].filter(Boolean).join(" · ") || "지역과 업종을 추가하면 더 정확하게 비교할 수 있어요."}</p>
          <div className="p360-grid" style={{ marginTop: 15 }}>
            {[{ icon: "🩺", title: "1. 원인 진단", desc: "신규 고객·노출·리뷰·재방문을 확인해요.", action: () => setTab("diagnosis") }, { icon: "🏪", title: "2. 경쟁업체 확인", desc: "주변 업체의 리뷰와 홍보 상태를 비교해요.", action: () => setTab("discovery") }, { icon: "🤝", title: "3. 리뷰어 찾기", desc: "업체 리뷰어를 찾아 크롤링 제안으로 보내요.", action: () => setTab("discovery") }].map(item => <button key={item.title} type="button" className="p360-button" onClick={item.action} style={{ minHeight: 130, textAlign: "left", border: `1px solid ${colors.line}`, background: colors.soft, color: colors.text }}><span style={{ fontSize: 25 }}>{item.icon}</span><b style={{ display: "block", marginTop: 8, fontSize: 15 }}>{item.title}</b><span style={{ display: "block", marginTop: 5, color: colors.sub, fontSize: 11.5, lineHeight: 1.5 }}>{item.desc}</span></button>)}
          </div>
        </section>
        <section className="p360-card" style={{ ...cardStyle, padding: 20 }}><b>✅ 오늘은 이것부터 하세요</b><p style={{ margin: "7px 0 13px", color: colors.sub, fontSize: 12.5, lineHeight: 1.65 }}>최초 진단을 실행해 기준을 만든 다음, 주변 경쟁업체와 리뷰어를 찾아보세요. 진단하지 않은 내용은 결과처럼 단정하지 않아요.</p><button type="button" className="p360-button" onClick={() => setTab("diagnosis")} style={{ background: colors.rose, color: "#fff" }}>내 매장 진단 준비하기</button></section>
      </>}
    </main>}

    {tab === "diagnosis" && <main>
      <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 950 }}>🩺 손님이 줄어든 이유를 찾아볼까요?</div>
        <p style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.7, margin: "7px 0 0" }}>{hasStore ? <><b style={{ color: colors.text }}>{profile.name}</b>의 공개 데이터를 먼저 점검하고, 광고·POS 자료가 필요한 항목은 따로 알려드려요.</> : <>정확한 진단을 시작하려면 먼저 한눈에 보기에서 내 매장을 등록해 주세요.</>}</p>
      </section>
      {collectedPlaces.length > 0 && <section className="p360-card" style={{ ...cardStyle, padding: 20, marginBottom: 12 }}>
        <b>📊 방금 수집한 {collectedPlaces.length}개 업체 비교 결과</b>
        {ownPlace && comparison ? <div className="p360-two" style={{ marginTop: 12 }}><div style={{ padding: 14, borderRadius: 14, background: colors.soft }}><span style={{ color: colors.sub, fontSize: 11 }}>내 매장</span><b style={{ display: "block", marginTop: 5 }}>{ownPlace.name}</b><p style={{ margin: "7px 0 0", fontSize: 12 }}>방문자 리뷰 {(ownPlace.visitorReviewCount || 0).toLocaleString()} · 블로그 리뷰 {(ownPlace.blogReviewCount || 0).toLocaleString()}</p></div><div style={{ padding: 14, borderRadius: 14, background: colors.soft }}><span style={{ color: colors.sub, fontSize: 11 }}>주변 {comparison.count}곳 평균</span><b style={{ display: "block", marginTop: 5 }}>경쟁업체 기준선</b><p style={{ margin: "7px 0 0", fontSize: 12 }}>방문자 리뷰 {comparison.avgVisitor.toLocaleString()} · 블로그 리뷰 {comparison.avgBlog.toLocaleString()}</p></div></div> : <p style={{ margin: "8px 0 0", color: colors.sub, fontSize: 12, lineHeight: 1.7 }}>수집은 완료됐지만 등록한 매장 이름과 정확히 일치하는 업체를 찾지 못했어요. 업체·리뷰어 찾기에서 상호명이 보이도록 지역과 업종을 조정해 주세요.</p>}
      </section>}
      <section className="p360-card" style={{ ...cardStyle, padding: 20, marginBottom: 12 }}>
        <b>📈 7일·30일 변화 기록</b>
        {historyLoading ? <p style={{ color: colors.sub, fontSize: 12, marginTop: 8 }}>지난 측정 기록을 불러오고 있어요…</p> : trend ? <div className="p360-two" style={{ marginTop: 12 }}><div style={{ padding: 14, borderRadius: 14, background: colors.soft }}><span style={{ color: colors.sub, fontSize: 11 }}>최근 {trend.days}일</span><b style={{ display: "block", marginTop: 5, color: trend.visitor >= 0 ? colors.green : colors.rose }}>방문자 리뷰 {trend.visitor >= 0 ? "+" : ""}{trend.visitor}</b></div><div style={{ padding: 14, borderRadius: 14, background: colors.soft }}><span style={{ color: colors.sub, fontSize: 11 }}>최근 {trend.days}일</span><b style={{ display: "block", marginTop: 5, color: trend.blog >= 0 ? colors.green : colors.rose }}>블로그 리뷰 {trend.blog >= 0 ? "+" : ""}{trend.blog}</b></div></div> : <p style={{ color: colors.sub, fontSize: 12, lineHeight: 1.7, marginTop: 8 }}>첫 측정은 비교 기준을 만드는 날이에요. 다른 날짜에 다시 측정하면 증가·감소와 개선 효과를 보여드려요.</p>}
      </section>
      <section className="p360-card" style={{ ...cardStyle, padding: 20, marginBottom: 12 }}>
        <b>✅ 오늘의 매장 처방전</b>
        <p style={{ color: colors.sub, fontSize: 11.5, lineHeight: 1.65, margin: "6px 0 13px" }}>확인된 자료만으로 우선순위를 정했어요. 광고와 재방문은 자료가 연결되기 전까지 원인으로 단정하지 않아요.</p>
        <div style={{ display: "grid", gap: 8 }}>{prescriptions.map((item, index) => <div className="p360-prescription" key={`${item.title}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: 14, borderRadius: 14, background: colors.soft, borderLeft: `4px solid ${item.level === "danger" ? colors.rose : item.level === "warning" ? colors.amber : colors.green}` }}><div><b style={{ display: "block", fontSize: 13.5 }}>{index + 1}. {item.title}</b><span style={{ display: "block", marginTop: 4, color: colors.sub, fontSize: 11.5, lineHeight: 1.55 }}>{item.reason}</span></div><button type="button" className="p360-button" onClick={() => setTab(item.go)} style={{ background: item.level === "danger" ? colors.rose : colors.green, color: "#fff", whiteSpace: "nowrap" }}>{item.action}</button></div>)}</div>
      </section>
      <div className="p360-grid">{DIAGNOSIS_ITEMS.map(item => {
        const reviewItem = item.title === "리뷰 활동";
        const state = reviewItem && ownPlace && comparison ? "확인됨" : item.state;
        const desc = reviewItem && ownPlace && comparison
          ? `내 매장 블로그 리뷰는 ${(ownPlace.blogReviewCount || 0).toLocaleString()}개, 주변 평균은 ${comparison.avgBlog.toLocaleString()}개예요. 현재 개수 비교이며 증가·감소 판단은 다음 측정부터 가능해요.`
          : item.desc;
        return <article key={item.title} className="p360-card" style={{ ...cardStyle, padding: 18 }}><div style={{ display: "flex", gap: 9, alignItems: "center" }}><span style={{ fontSize: 23 }}>{item.icon}</span><b style={{ fontSize: 14.5 }}>{item.title}</b></div><span style={{ display: "inline-block", margin: "10px 0 7px", borderRadius: 99, padding: "4px 9px", background: state === "자료 필요" ? `${colors.amber}18` : `${colors.green}16`, color: state === "자료 필요" ? colors.amber : colors.green, fontSize: 10.5, fontWeight: 900 }}>{state}</span><p style={{ color: colors.sub, fontSize: 11.5, lineHeight: 1.65 }}>{desc}</p></article>;
      })}</div>
      <section className="p360-card" style={{ ...cardStyle, padding: 20, marginTop: 12 }}><b>진단 프로세스</b><p style={{ color: colors.sub, fontSize: 12, lineHeight: 1.75, margin: "7px 0 14px" }}>내 매장 확인 → 주변 경쟁업체 수집 → 리뷰·노출 변화 비교 → 원인과 근거 표시 → 해결할 작업 추천 순서로 이어집니다.</p><button type="button" className="p360-button" disabled={!hasStore} onClick={() => setTab(hasStore ? "discovery" : "overview")} style={{ width: "100%", opacity: hasStore ? 1 : .6, background: colors.green, color: "#fff" }}>{hasStore ? "경쟁업체와 리뷰어 찾으러 가기 →" : "먼저 내 매장 등록하기 →"}</button></section>
    </main>}

    <div style={{ display: tab === "discovery" ? "block" : "none" }} aria-hidden={tab !== "discovery"}>
      <PlaceCenter showToast={showToast} theme={theme} userId={userId} plan={plan} initialRegion={profile.region} onPlacesCollected={onPlacesCollected} onOpenCrawl={onOpenCrawl} />
    </div>
  </div>;
}
