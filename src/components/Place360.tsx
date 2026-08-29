import { useEffect, useMemo, useRef, useState } from "react";
import PlaceCenter from "./PlaceCenter";
import { botFetch } from "../lib/botApi";
import { deletePlace360Store, getPlace360BusinessMetrics, getPlace360Progress, getPlace360Ranks, getPlace360Snapshots, getPlace360StoreProfiles, PLACE360_DAILY_DIAGNOSIS_LIMIT, PLACE360_HISTORY_DAYS, PLACE360_RANK_DAILY_LIMIT, PLACE360_STORE_LIMIT, place360StoreKey, Place360BusinessMetrics, Place360RankMeasurement, Place360Snapshot, recordPlace360ReviewerHandoff, renamePlace360Store, savePlace360BusinessMetrics, savePlace360MissionProgress, savePlace360Rank, savePlace360Snapshot, savePlace360StoreProfile } from "../lib/supabase";
import { koreaDateKey } from "../lib/date";

type Props = {
  showToast?: (message: string, type?: any) => void;
  theme?: "dark" | "light";
  userId?: string;
  plan?: string;
  onOpenCrawl?: () => void;
};

type Place360Tab = "overview" | "rank" | "diagnosis" | "data" | "mission" | "discovery";
type StoreProfile = {
  name: string;
  placeUrl: string;
  category: string;
  region: string;
  goal: "visitors" | "reviews" | "exposure" | "repeat";
};
type CollectedPlace = { placeId: string; name: string; category?: string; address?: string; visitorReviewCount?: number; blogReviewCount?: number; placeUrl: string };
type RankMeasurement = { query: string; rank: number | null; checkedCount: number; measuredAt: string; surface: string };

const EMPTY_PROFILE: StoreProfile = { name: "", placeUrl: "", category: "", region: "", goal: "visitors" };
type BusinessMetricDraft = Pick<Place360BusinessMetrics, "current_new_customers" | "previous_new_customers" | "current_repeat_customers" | "previous_repeat_customers" | "current_ad_spend" | "previous_ad_spend" | "current_ad_actions" | "previous_ad_actions" | "current_sales" | "previous_sales">;
const EMPTY_BUSINESS_METRICS: BusinessMetricDraft = { current_new_customers: 0, previous_new_customers: 0, current_repeat_customers: 0, previous_repeat_customers: 0, current_ad_spend: 0, previous_ad_spend: 0, current_ad_actions: 0, previous_ad_actions: 0, current_sales: 0, previous_sales: 0 };

const DIAGNOSIS_ITEMS = [
  { icon: "🧲", title: "신규 고객", state: "진단 준비", desc: "검색 노출과 최근 리뷰 증가를 경쟁업체와 비교해요." },
  { icon: "📍", title: "플레이스 노출", state: "진단 준비", desc: "지역·업종 키워드에서 매장이 얼마나 잘 보이는지 확인해요." },
  { icon: "⭐", title: "리뷰 활동", state: "진단 준비", desc: "방문자 리뷰와 블로그 리뷰가 꾸준히 늘고 있는지 살펴봐요." },
  { icon: "🔁", title: "재방문 가능성", state: "자료 필요", desc: "반복 방문 표현을 분석하고, POS 자료 연결 시 실제 재방문율도 확인해요." },
  { icon: "📣", title: "광고 효율", state: "자료 필요", desc: "광고 보고서를 연결하면 비용 대비 클릭·전화·예약을 진단해요." },
  { icon: "🏙️", title: "상권 관심도", state: "추정 진단", desc: "주변 업체와 지역 검색 변화를 이용해 상권 흐름을 추정해요." },
] as const;

const BOT = "http://127.0.0.1:3334";

/* 붙여넣은 플레이스 주소에서 매장 번호(placeId)만 뽑아낸다.
   pcmap.place / m.place / place.naver.com/{domain}/{id}, map.naver.com/p/entry/place/{id}, 순수 숫자 지원.
   naver.me 단축주소는 여기선 못 뽑으므로(""), '주소로 불러오기'가 봇을 통해 최종 URL로 판별한다. */
function placeIdFromUrl(url?: string): string {
  const s = String(url || "");
  let m = s.match(/(?:pcmap\.place|m\.place|place)\.naver\.com\/[a-z]+\/(\d{5,})/i);
  if (m) return m[1];
  m = s.match(/entry\/place\/(\d{5,})/i) || s.match(/[?&]placeId=(\d{5,})/i) || s.match(/\/(\d{6,})(?:[/?#]|$)/) || s.match(/^\s*(\d{6,})\s*$/);
  return m ? m[1] : "";
}

function profileKey(userId?: string) {
  return `publy_place360_profile_v1:${userId || "guest"}`;
}

function profilesKey(userId?: string) {
  return `publy_place360_profiles_v2:${userId || "guest"}`;
}

function missionKey(userId: string | undefined, storeKey: string) {
  return `publy_place360_missions_v1:${userId || "guest"}:${storeKey}:${koreaDateKey()}`;
}

function adminMetricsKey(storeKey: string) {
  return `publy_place360_admin_metrics_v1:${storeKey}`;
}

function loadCompletedMissions(userId: string | undefined, storeKey: string): string[] {
  if (!storeKey) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(missionKey(userId, storeKey)) || "[]");
    return Array.isArray(saved) ? saved.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function loadProfile(userId?: string): StoreProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(profileKey(userId)) || "null");
    return saved && typeof saved.name === "string" ? { ...EMPTY_PROFILE, ...saved } : EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
}

function loadProfiles(userId?: string): StoreProfile[] {
  try {
    const saved = JSON.parse(localStorage.getItem(profilesKey(userId)) || "[]");
    if (Array.isArray(saved) && saved.length) return saved.filter(item => item && typeof item.name === "string" && item.name.trim()).map(item => ({ ...EMPTY_PROFILE, ...item }));
  } catch {}
  const legacy = loadProfile(userId);
  return legacy.name.trim() ? [legacy] : [];
}

function loadSelectedProfile(userId?: string): StoreProfile {
  const profiles = loadProfiles(userId);
  const selected = loadProfile(userId);
  const selectedKey = place360StoreKey(selected.name, selected.region);
  return profiles.find(item => place360StoreKey(item.name, item.region) === selectedKey) || profiles[0] || EMPTY_PROFILE;
}

function persistProfiles(userId: string | undefined, profiles: StoreProfile[], selected: StoreProfile) {
  localStorage.setItem(profilesKey(userId), JSON.stringify(profiles));
  localStorage.setItem(profileKey(userId), JSON.stringify(selected));
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

function normalizeCsvHeader(value: string) {
  return value.replace(/^\ufeff/, "").trim().toLocaleLowerCase("ko-KR").replace(/[\s_·/()-]/g, "");
}

export default function Place360({ showToast, theme = "light", userId, plan = "free", onOpenCrawl }: Props) {
  const [tab, setTab] = useState<Place360Tab>("overview");
  const [profiles, setProfiles] = useState<StoreProfile[]>(() => loadProfiles(userId));
  const [profile, setProfile] = useState<StoreProfile>(() => loadSelectedProfile(userId));
  const [draft, setDraft] = useState<StoreProfile>(() => loadSelectedProfile(userId));
  const [editingStoreKey, setEditingStoreKey] = useState<string | null>(() => {
    const selected = loadSelectedProfile(userId);
    return selected.name ? place360StoreKey(selected.name, selected.region) : null;
  });
  const [storeFormOpen, setStoreFormOpen] = useState(() => loadProfiles(userId).length === 0);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    if (plan === "admin") return;
    let active = true;
    getPlace360StoreProfiles().then(rows => {
      if (!active || !rows.length) return;
      const serverProfiles = rows.map(row => ({ name: row.store_name, placeUrl: row.place_url, category: row.category, region: row.region, goal: row.goal }));
      const selectedKey = place360StoreKey(profile.name, profile.region);
      const selected = serverProfiles.find(item => place360StoreKey(item.name, item.region) === selectedKey) || serverProfiles[0];
      setProfiles(serverProfiles); setProfile(selected); setDraft(selected); setEditingStoreKey(place360StoreKey(selected.name, selected.region)); setStoreFormOpen(false);
      persistProfiles(userId, serverProfiles, selected);
    }).catch(() => {});
    return () => { active = false; };
  }, [plan, userId]);
  const [collectedPlaces, setCollectedPlaces] = useState<CollectedPlace[]>([]);
  const [snapshots, setSnapshots] = useState<Place360Snapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [latestRank, setLatestRank] = useState<RankMeasurement | null>(null);
  const [rankHistory, setRankHistory] = useState<Place360RankMeasurement[]>([]);
  const hasStore = Boolean(profile.name.trim());
  const ownPlace = useMemo(() => {
    // 1순위: 등록한 플레이스 주소의 매장 번호로 정확히 매칭(상호명 띄어쓰기·지점명 달라도 100% 일치)
    const myId = placeIdFromUrl(profile.placeUrl);
    if (myId) {
      const byId = collectedPlaces.find(place => place.placeId === myId);
      if (byId) return byId;
    }
    // 2순위: 이름 정규화(공백·괄호·지점표기 제거) 후 포함 매칭
    const norm = (s: string) => s.replace(/\(.*?\)/g, "").replace(/[\s·・,]/g, "").toLowerCase();
    const needle = norm(profile.name);
    if (!needle) return undefined;
    return collectedPlaces.find(place => {
      const name = norm(place.name);
      return name.includes(needle) || needle.includes(name);
    });
  }, [collectedPlaces, profile.name, profile.placeUrl]);
  const comparison = useMemo(() => {
    const competitors = collectedPlaces.filter(place => place.placeId !== ownPlace?.placeId);
    if (!competitors.length) return null;
    const avgVisitor = Math.round(competitors.reduce((sum, place) => sum + (place.visitorReviewCount || 0), 0) / competitors.length);
    const avgBlog = Math.round(competitors.reduce((sum, place) => sum + (place.blogReviewCount || 0), 0) / competitors.length);
    return { count: competitors.length, avgVisitor, avgBlog };
  }, [collectedPlaces, ownPlace?.placeId]);
  const storeKey = place360StoreKey(profile.name, profile.region);
  const [completedMissions, setCompletedMissions] = useState<string[]>(() => loadCompletedMissions(userId, storeKey));
  const [reviewerHandoffCount, setReviewerHandoffCount] = useState(0);
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetricDraft>(EMPTY_BUSINESS_METRICS);
  const [metricsSavedAt, setMetricsSavedAt] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const localMissions = loadCompletedMissions(userId, storeKey);
    setCompletedMissions(localMissions);
    setReviewerHandoffCount(Number(localStorage.getItem(`${missionKey(userId, storeKey)}:reviewers`) || 0));
    if (!storeKey || plan === "admin") return;
    let active = true;
    getPlace360Progress(storeKey).then(async row => {
      if (!active) return;
      if (row) {
        const todayMissions = row.mission_date === koreaDateKey() ? (row.completed_missions || []) : [];
        setCompletedMissions(todayMissions);
        setReviewerHandoffCount(row.reviewer_handoff_count || 0);
        localStorage.setItem(missionKey(userId, storeKey), JSON.stringify(todayMissions));
        localStorage.setItem(`${missionKey(userId, storeKey)}:reviewers`, String(row.reviewer_handoff_count || 0));
      } else if (localMissions.length) {
        await savePlace360MissionProgress(storeKey, localMissions);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [plan, storeKey, userId]);
  useEffect(() => {
    if (!storeKey) { setBusinessMetrics(EMPTY_BUSINESS_METRICS); setMetricsSavedAt(""); return; }
    let active = true;
    setMetricsLoading(true);
    const load = plan === "admin"
      ? Promise.resolve((() => { try { return JSON.parse(localStorage.getItem(adminMetricsKey(storeKey)) || "null") as Place360BusinessMetrics | null; } catch { return null; } })())
      : getPlace360BusinessMetrics(storeKey);
    load.then(row => { if (!active) return; setBusinessMetrics(row ? { current_new_customers: row.current_new_customers, previous_new_customers: row.previous_new_customers, current_repeat_customers: row.current_repeat_customers, previous_repeat_customers: row.previous_repeat_customers, current_ad_spend: row.current_ad_spend, previous_ad_spend: row.previous_ad_spend, current_ad_actions: row.current_ad_actions, previous_ad_actions: row.previous_ad_actions, current_sales: row.current_sales, previous_sales: row.previous_sales } : EMPTY_BUSINESS_METRICS); setMetricsSavedAt(row?.updated_at || ""); }).catch(() => { if (active) setBusinessMetrics(EMPTY_BUSINESS_METRICS); }).finally(() => { if (active) setMetricsLoading(false); });
    return () => { active = false; };
  }, [plan, storeKey]);
  useEffect(() => {
    if (!storeKey || plan === "admin") { setSnapshots([]); return; }
    let active = true;
    setHistoryLoading(true);
    getPlace360Snapshots(storeKey).then(rows => { if (active) setSnapshots(rows); }).catch(() => { if (active) setSnapshots([]); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [plan, storeKey]);
  useEffect(() => {
    if (!storeKey || plan === "admin") { setRankHistory([]); return; }
    let active = true;
    getPlace360Ranks(storeKey).then(rows => { if (active) setRankHistory(rows); }).catch(() => { if (active) setRankHistory([]); });
    return () => { active = false; };
  }, [plan, storeKey]);

  const onPlacesCollected = async (rows: CollectedPlace[], meta: { query: string; measuredAt: string; surface: string }) => {
    setCollectedPlaces(rows);
    const myId = placeIdFromUrl(profile.placeUrl);
    const norm = (s: string) => s.replace(/\(.*?\)/g, "").replace(/[\s·・,]/g, "").toLowerCase();
    const needle = norm(profile.name);
    const own = (myId ? rows.find(place => place.placeId === myId) : undefined)
      || (needle ? rows.find(place => {
        const name = norm(place.name);
        return name.includes(needle) || needle.includes(name);
      }) : undefined);
    const rankIndex = own ? rows.findIndex(place => place.placeId === own.placeId) : -1;
    setLatestRank({ query: meta.query, rank: rankIndex >= 0 ? rankIndex + 1 : null, checkedCount: rows.length, measuredAt: meta.measuredAt, surface: meta.surface });
    if (plan !== "admin") {
      try {
        await savePlace360Rank({ store_key: storeKey, keyword: meta.query, rank: rankIndex >= 0 ? rankIndex + 1 : null, checked_count: rows.length, surface: meta.surface, device: "PC" });
        const nextRankHistory = await getPlace360Ranks(storeKey);
        setRankHistory(nextRankHistory);
        if (nextRankHistory.length >= 2) void completeMissionAutomatically("remeasure");
      } catch (error: any) {
        if (String(error?.message || "").includes("PLACE360_RANK_DAILY_LIMIT")) showToast?.("오늘 사용할 수 있는 순위 측정 횟수를 모두 사용했어요", "info");
      }
    }
    if (!own) return;
    const competitors = rows.filter(place => place.placeId !== own.placeId);
    if (!competitors.length) return;
    const avgVisitor = Math.round(competitors.reduce((sum, place) => sum + (place.visitorReviewCount || 0), 0) / competitors.length);
    const avgBlog = Math.round(competitors.reduce((sum, place) => sum + (place.blogReviewCount || 0), 0) / competitors.length);
    if (plan === "admin") {
      const now = new Date().toISOString();
      setSnapshots(current => [{ id: `admin-${Date.now()}`, user_id: "admin", store_key: storeKey, store_name: own.name, region: profile.region, category: profile.category, visitor_reviews: own.visitorReviewCount || 0, blog_reviews: own.blogReviewCount || 0, competitor_count: competitors.length, competitor_avg_visitor: avgVisitor, competitor_avg_blog: avgBlog, collected_count: rows.length, measured_on: now.slice(0, 10), created_at: now }, ...current].slice(0, 120));
      showToast?.("관리자 무제한 진단이 완료됐어요", "success");
      return;
    }
    try {
      await savePlace360Snapshot({ store_key: storeKey, store_name: own.name, region: profile.region, category: profile.category, visitor_reviews: own.visitorReviewCount || 0, blog_reviews: own.blogReviewCount || 0, competitor_count: competitors.length, competitor_avg_visitor: avgVisitor, competitor_avg_blog: avgBlog, collected_count: rows.length });
      setSnapshots(await getPlace360Snapshots(storeKey));
      showToast?.("오늘의 플레이스 360 측정 기록을 안전하게 저장했어요", "success");
    } catch (error: any) {
      const message = String(error?.message || "");
      showToast?.(message.includes("PLACE360_STORE_LIMIT") ? "내 등급에서 등록할 수 있는 매장 수를 모두 사용했어요" : message.includes("PLACE360_DAILY_LIMIT") ? "오늘 사용할 수 있는 매장 진단 횟수를 모두 사용했어요" : "비교는 완료됐지만 측정 기록 서버가 아직 준비되지 않았어요", "info");
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
    if (metricsSavedAt && businessMetrics.previous_new_customers > 0 && businessMetrics.current_new_customers < businessMetrics.previous_new_customers) items.push({ level: "danger", title: "신규 고객 감소를 먼저 확인하세요", reason: `신규 고객이 ${businessMetrics.previous_new_customers.toLocaleString()}명에서 ${businessMetrics.current_new_customers.toLocaleString()}명으로 줄었어요.`, action: "운영자료 원인 보기", go: "data" });
    if ((ownPlace.blogReviewCount || 0) < comparison.avgBlog) items.push({ level: "danger", title: "블로그 리뷰 보강이 먼저예요", reason: `내 매장은 ${(ownPlace.blogReviewCount || 0).toLocaleString()}개, 주변 평균은 ${comparison.avgBlog.toLocaleString()}개로 차이가 있어요.`, action: "경쟁업체 리뷰어 찾기", go: "discovery" });
    if ((ownPlace.visitorReviewCount || 0) < comparison.avgVisitor) items.push({ level: "warning", title: "방문 고객의 리뷰 참여를 점검하세요", reason: `방문자 리뷰가 주변 평균보다 ${(comparison.avgVisitor - (ownPlace.visitorReviewCount || 0)).toLocaleString()}개 적어요.`, action: "업체 비교 근거 보기", go: "diagnosis" });
    if (trend && trend.blog <= 0) items.push({ level: "warning", title: `최근 ${trend.days}일 블로그 리뷰가 정체됐어요`, reason: "새로운 지역형 리뷰어를 찾고 협업 후보로 보내는 작업을 추천해요.", action: "리뷰어 역추적", go: "discovery" });
    if (!metricsSavedAt) items.push({ level: "ready", title: "실제 운영자료를 연결하면 원인이 더 정확해져요", reason: "POS·예약·광고 숫자가 있어야 신규·재방문·광고 문제를 서로 구분할 수 있어요.", action: "30일 자료 입력", go: "data" });
    if (!items.length) items.push({ level: "ready", title: "현재 리뷰 기준은 주변 평균 이상이에요", reason: "지금 상태를 유지하면서 다음 측정에서 증가 속도를 비교해 보세요.", action: "다음 측정 준비", go: "discovery" });
    return items.slice(0, 3);
  }, [businessMetrics.current_new_customers, businessMetrics.previous_new_customers, comparison, metricsSavedAt, ownPlace, trend]);
  const growthMissions = useMemo(() => {
    if (!hasStore) return [{ id: "register", icon: "🏪", title: "내 매장 먼저 등록하기", why: "매장 이름을 알아야 순위와 경쟁업체를 정확히 비교할 수 있어요.", how: "한눈에 보기에서 매장 이름·지역·업종을 입력하고 저장하세요.", action: "매장 등록하기", go: "overview" as Place360Tab }];
    if (!ownPlace || !comparison) return [{ id: "baseline", icon: "📍", title: "오늘 기준 순위 만들기", why: "첫 측정값이 있어야 다음 측정에서 상승·하락을 판단할 수 있어요.", how: "업체·리뷰어 찾기에서 지역과 업종을 입력하고 업체 찾기를 한 번 실행하세요.", action: "지금 측정하기", go: "discovery" as Place360Tab }];
    const missions: Array<{ id: string; icon: string; title: string; why: string; how: string; action: string; go: Place360Tab }> = [];
    if ((ownPlace.blogReviewCount || 0) < comparison.avgBlog) missions.push({ id: "blogger", icon: "🤝", title: "지역 리뷰어 후보 찾기", why: `블로그 리뷰가 주변 평균보다 ${Math.max(0, comparison.avgBlog - (ownPlace.blogReviewCount || 0)).toLocaleString()}개 적어요.`, how: "경쟁업체 2~3곳을 체크하고 리뷰어 역추적을 실행한 뒤 크롤링 협업 제안으로 보내세요.", action: "리뷰어 찾기", go: "discovery" });
    if ((ownPlace.visitorReviewCount || 0) < comparison.avgVisitor) missions.push({ id: "visitor", icon: "🧾", title: "방문 고객 리뷰 동선 점검하기", why: `방문자 리뷰가 주변 평균보다 ${Math.max(0, comparison.avgVisitor - (ownPlace.visitorReviewCount || 0)).toLocaleString()}개 적어요.`, how: "결제 후 영수증 리뷰 안내가 고객 눈높이에 보이는지 확인하고, 과도한 보상 없이 정직하게 참여를 안내하세요.", action: "비교 근거 보기", go: "diagnosis" });
    if (!metricsSavedAt) missions.push({ id: "owner-data", icon: "📊", title: "신규·재방문·광고 숫자 넣기", why: "공개 플레이스 자료만으로는 손님이 줄어든 실제 원인을 알 수 없어요.", how: "POS·예약 장부·광고 보고서에서 최근 30일과 이전 30일 숫자를 입력하세요.", action: "운영자료 입력", go: "data" });
    if (metricsSavedAt && businessMetrics.previous_new_customers > 0 && businessMetrics.current_new_customers < businessMetrics.previous_new_customers) missions.push({ id: "new-customer", icon: "🧲", title: "신규 고객 감소 원인 좁히기", why: `신규 고객이 ${businessMetrics.previous_new_customers.toLocaleString()}명에서 ${businessMetrics.current_new_customers.toLocaleString()}명으로 줄었어요.`, how: "같은 기간의 순위가 함께 하락했는지 확인하고, 순위가 유지됐다면 고객 화면·광고 유입을 차례로 점검하세요.", action: "원인표 다시 보기", go: "data" });
    const currentTotal = businessMetrics.current_new_customers + businessMetrics.current_repeat_customers;
    const previousTotal = businessMetrics.previous_new_customers + businessMetrics.previous_repeat_customers;
    const currentRepeatRate = currentTotal > 0 ? businessMetrics.current_repeat_customers / currentTotal : null;
    const previousRepeatRate = previousTotal > 0 ? businessMetrics.previous_repeat_customers / previousTotal : null;
    if (metricsSavedAt && currentRepeatRate !== null && previousRepeatRate !== null && currentRepeatRate < previousRepeatRate) missions.push({ id: "repeat-customer", icon: "🔁", title: "재방문 고객 회복하기", why: `재방문 비율이 ${Math.round(previousRepeatRate * 100)}%에서 ${Math.round(currentRepeatRate * 100)}%로 낮아졌어요.`, how: "최근 불만·대기시간·품절·서비스 변화를 확인하고, 기존 고객에게 다시 올 이유가 되는 새 소식이나 혜택을 준비하세요.", action: "재방문 진단 보기", go: "data" });
    const currentCpa = businessMetrics.current_ad_actions > 0 ? businessMetrics.current_ad_spend / businessMetrics.current_ad_actions : null;
    const previousCpa = businessMetrics.previous_ad_actions > 0 ? businessMetrics.previous_ad_spend / businessMetrics.previous_ad_actions : null;
    if (metricsSavedAt && currentCpa !== null && previousCpa !== null && currentCpa > previousCpa) missions.push({ id: "ad-efficiency", icon: "📣", title: "비싸진 광고부터 정리하기", why: `광고 행동 1건당 비용이 ${Math.round(previousCpa).toLocaleString()}원에서 ${Math.round(currentCpa).toLocaleString()}원으로 올랐어요.`, how: "비용은 쓰지만 전화·예약·길찾기가 적은 키워드와 광고 소재를 먼저 중지하거나 수정하세요.", action: "광고 진단 보기", go: "data" });
    missions.push({ id: "customer", icon: "👀", title: "고객 화면 빠진 정보 확인하기", why: "사진·영업시간·메뉴·예약 정보가 비어 있으면 방문 전 이탈할 수 있어요.", how: "내 매장의 ‘고객 화면 보기’를 눌러 정보 완성도와 먼저 고칠 순서를 확인하세요.", action: "고객 화면 보기", go: "discovery" });
    missions.push({ id: "remeasure", icon: "📈", title: "같은 조건으로 다시 측정하기", why: "위치와 검색어가 달라지면 순위를 정확히 비교할 수 없어요.", how: "오늘 작업을 마친 뒤 다음 측정일에 같은 지역·업종·계정으로 다시 확인하세요.", action: "순위 기록 보기", go: "rank" });
    return missions.slice(0, 4);
  }, [businessMetrics, comparison, hasStore, metricsSavedAt, ownPlace]);
  const toggleMission = async (id: string) => {
    const next = completedMissions.includes(id) ? completedMissions.filter(item => item !== id) : [...completedMissions, id];
    setCompletedMissions(next);
    if (storeKey) localStorage.setItem(missionKey(userId, storeKey), JSON.stringify(next));
    if (storeKey && plan !== "admin") {
      try { await savePlace360MissionProgress(storeKey, next); }
      catch { showToast?.("완료 표시는 저장했지만 서버 동기화는 잠시 후 다시 시도해 주세요", "info"); }
    }
  };
  const completeMissionAutomatically = async (id: string) => {
    if (completedMissions.includes(id)) return;
    const next = [...completedMissions, id];
    setCompletedMissions(next);
    if (storeKey) localStorage.setItem(missionKey(userId, storeKey), JSON.stringify(next));
    if (storeKey && plan !== "admin") {
      try { await savePlace360MissionProgress(storeKey, next); } catch {}
    }
  };
  const onReviewerHandoff = async (count: number) => {
    if (!storeKey) return;
    const next = reviewerHandoffCount + count;
    setReviewerHandoffCount(next);
    localStorage.setItem(`${missionKey(userId, storeKey)}:reviewers`, String(next));
    if (plan !== "admin") {
      try {
        const row = await recordPlace360ReviewerHandoff(storeKey, count);
        if (row) setReviewerHandoffCount(row.reviewer_handoff_count);
      } catch { showToast?.("협업 후보는 전달했지만 완료 기록 동기화는 잠시 후 다시 시도해 주세요", "info"); }
    }
    await completeMissionAutomatically("blogger");
  };
  const updateBusinessMetric = (key: keyof BusinessMetricDraft, raw: string) => {
    const value = Math.min(1000000000, Math.max(0, Math.round(Number(raw) || 0)));
    setBusinessMetrics(current => ({ ...current, [key]: value }));
  };
  const downloadMetricsTemplate = () => {
    const csv = "\ufeff기간,신규고객수,재방문고객수,광고비,광고행동수,매출\r\n최근30일,0,0,0,0,0\r\n이전30일,0,0,0,0,0\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "퍼블리-플레이스360-운영자료.csv"; anchor.click(); URL.revokeObjectURL(url);
    showToast?.("CSV 양식을 저장했어요. 숫자를 채운 뒤 다시 불러오세요", "success");
  };
  const importMetricsCsv = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast?.("CSV 파일은 2MB보다 작아야 해요", "error"); return; }
    try {
      const bytes = await file.arrayBuffer();
      let decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (decoded.includes("�")) {
        try { decoded = new TextDecoder("euc-kr", { fatal: false }).decode(bytes); } catch {}
      }
      const text = decoded.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = text.split("\n").filter(line => line.trim()).slice(0, 1002);
      if (lines.length < 3) throw new Error("최근 30일과 이전 30일, 두 줄이 필요해요");
      const headers = parseCsvLine(lines[0]).map(normalizeCsvHeader);
      const aliases: Record<string, string[]> = {
        period: ["기간", "period", "구분"], newCustomers: ["신규고객수", "신규고객", "newcustomers", "newcustomer"],
        repeatCustomers: ["재방문고객수", "재방문고객", "repeatcustomers", "returningcustomers"], adSpend: ["광고비", "광고비용", "adspend", "adcost"],
        adActions: ["광고행동수", "광고전환수", "전화예약길찾기", "adactions", "conversions"], sales: ["매출", "총매출", "sales", "revenue"],
      };
      const column = (name: keyof typeof aliases) => headers.findIndex(header => aliases[name].includes(header));
      const indexes = { period: column("period"), newCustomers: column("newCustomers"), repeatCustomers: column("repeatCustomers"), adSpend: column("adSpend"), adActions: column("adActions"), sales: column("sales") };
      if (Object.values(indexes).some(index => index < 0)) throw new Error("양식의 열 이름이 달라요. ‘CSV 양식 받기’ 파일을 사용해 주세요");
      const rows = lines.slice(1).map(parseCsvLine);
      const recent = rows.find(row => /최근|current|이번/.test(normalizeCsvHeader(row[indexes.period] || "")));
      const previous = rows.find(row => /이전|previous|직전/.test(normalizeCsvHeader(row[indexes.period] || "")));
      if (!recent || !previous) throw new Error("기간 칸에 ‘최근30일’과 ‘이전30일’이 모두 필요해요");
      const numberAt = (row: string[], index: number) => Math.min(1000000000, Math.max(0, Math.round(Number((row[index] || "0").replace(/[^0-9.-]/g, "")) || 0)));
      setBusinessMetrics({
        current_new_customers: numberAt(recent, indexes.newCustomers), previous_new_customers: numberAt(previous, indexes.newCustomers),
        current_repeat_customers: numberAt(recent, indexes.repeatCustomers), previous_repeat_customers: numberAt(previous, indexes.repeatCustomers),
        current_ad_spend: numberAt(recent, indexes.adSpend), previous_ad_spend: numberAt(previous, indexes.adSpend),
        current_ad_actions: numberAt(recent, indexes.adActions), previous_ad_actions: numberAt(previous, indexes.adActions),
        current_sales: numberAt(recent, indexes.sales), previous_sales: numberAt(previous, indexes.sales),
      });
      showToast?.("CSV 숫자를 불러왔어요. 내용을 확인하고 진단 버튼을 눌러주세요", "success");
    } catch (error: any) { showToast?.(error?.message || "CSV 파일을 읽지 못했어요", "error"); }
    finally { if (csvInputRef.current) csvInputRef.current.value = ""; }
  };
  const saveBusinessMetrics = async () => {
    if (!hasStore || !storeKey) { showToast?.("먼저 내 매장을 등록해 주세요", "info"); setTab("overview"); return; }
    setMetricsLoading(true);
    try {
      const input = { store_key: storeKey, store_name: profile.name, ...businessMetrics };
      if (plan === "admin") {
        const local = { id: `admin-${storeKey}`, user_id: "admin", ...input, measured_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() };
        localStorage.setItem(adminMetricsKey(storeKey), JSON.stringify(local));
        setMetricsSavedAt(local.updated_at);
      } else {
        const saved = await savePlace360BusinessMetrics(input);
        setMetricsSavedAt(saved?.updated_at || new Date().toISOString());
      }
      await completeMissionAutomatically("owner-data");
      showToast?.("최근 30일 운영자료를 안전하게 저장하고 진단했어요", "success");
    } catch (error: any) {
      const message = String(error?.message || "");
      showToast?.(message.includes("PLACE360_STORE_LIMIT") ? "내 등급의 등록 매장 수를 모두 사용했어요" : "운영자료를 저장하지 못했어요. 잠시 후 다시 시도해 주세요", "error");
    } finally { setMetricsLoading(false); }
  };
  const operationalDiagnosis = useMemo(() => {
    const percent = (current: number, previous: number) => previous > 0 ? Math.round((current - previous) / previous * 100) : null;
    const newChange = percent(businessMetrics.current_new_customers, businessMetrics.previous_new_customers);
    const currentTotal = businessMetrics.current_new_customers + businessMetrics.current_repeat_customers;
    const previousTotal = businessMetrics.previous_new_customers + businessMetrics.previous_repeat_customers;
    const repeatRate = currentTotal > 0 ? Math.round(businessMetrics.current_repeat_customers / currentTotal * 100) : null;
    const previousRepeatRate = previousTotal > 0 ? Math.round(businessMetrics.previous_repeat_customers / previousTotal * 100) : null;
    const currentCpa = businessMetrics.current_ad_actions > 0 ? Math.round(businessMetrics.current_ad_spend / businessMetrics.current_ad_actions) : null;
    const previousCpa = businessMetrics.previous_ad_actions > 0 ? Math.round(businessMetrics.previous_ad_spend / businessMetrics.previous_ad_actions) : null;
    const salesChange = percent(businessMetrics.current_sales, businessMetrics.previous_sales);
    return { newChange, repeatRate, previousRepeatRate, currentCpa, previousCpa, salesChange };
  }, [businessMetrics]);
  const currentRank = useMemo<RankMeasurement | null>(() => {
    if (latestRank) return latestRank;
    const saved = rankHistory[0];
    return saved ? { query: saved.keyword, rank: saved.rank, checkedCount: saved.checked_count, measuredAt: saved.measured_at, surface: saved.surface } : null;
  }, [latestRank, rankHistory]);
  const rankTimeline = useMemo(() => currentRank ? rankHistory.filter(row => row.keyword === currentRank.query).slice(0, 12) : [], [currentRank, rankHistory]);
  const previousRank = useMemo(() => {
    if (!currentRank) return undefined;
    const currentTime = new Date(currentRank.measuredAt).getTime();
    return rankTimeline.find(row => new Date(row.measured_at).getTime() < currentTime - 1000);
  }, [currentRank, rankTimeline]);
  const weeklySummary = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000;
    const ranks = rankHistory.filter(row => (!currentRank || row.keyword === currentRank.query) && new Date(row.measured_at).getTime() >= cutoff);
    const ranked = ranks.filter(row => row.rank !== null);
    const newest = ranked[0]?.rank ?? null;
    const oldest = ranked[ranked.length - 1]?.rank ?? null;
    const rankChange = newest !== null && oldest !== null ? oldest - newest : null;
    const recentSnapshots = snapshots.filter(row => new Date(row.created_at || row.measured_on).getTime() >= cutoff);
    const missionDone = growthMissions.filter(item => completedMissions.includes(item.id)).length;
    return { measurements: ranks.length, bestRank: ranked.length ? Math.min(...ranked.map(row => row.rank as number)) : null, rankChange, diagnoses: recentSnapshots.length, missionDone };
  }, [completedMissions, currentRank, growthMissions, rankHistory, snapshots]);
  const dark = theme === "dark";

  const colors = useMemo(() => dark ? {
    bg: "#221f1b", card: "#2e2b26", soft: "#39352f", line: "#4a443c", text: "#f7f3ec", sub: "#cabeae", rose: "#ff7daa", green: "#67d5b5", amber: "#ffc466",
  } : {
    bg: "#eee9df", card: "#fffdf8", soft: "#f5efe4", line: "#e0d7c9", text: "#2b2620", sub: "#756b5e", rose: "#e93f79", green: "#16856b", amber: "#aa7100",
  }, [dark]);

  // 🔎 플레이스 주소만 붙여넣으면 이름·업종·지역을 봇이 공개 페이지에서 바로 당겨온다(로그인 불필요).
  const resolveFromUrl = async () => {
    const url = draft.placeUrl.trim();
    if (!url) { showToast?.("먼저 네이버 플레이스 주소를 붙여넣어 주세요", "info"); return; }
    setResolving(true);
    try {
      const res = await botFetch(`${BOT}/api/place/resolve?userId=${encodeURIComponent(userId || "")}&placeUrl=${encodeURIComponent(url)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data?.detail) {
        showToast?.(data?.error || "매장 정보를 불러오지 못했어요. 주소를 확인해 주세요", "error");
        return;
      }
      const d = data.detail as { name?: string; category?: string; address?: string; placeUrl?: string };
      // 주소에서 '동/구' 같은 지역 힌트를 추출(있으면 지역칸 자동 채움)
      const regionHint = String(d.address || "").match(/([가-힣]+(?:동|읍|면|리|가|로|구|시))/)?.[1] || "";
      setDraft(v => ({
        ...v,
        name: d.name?.trim() || v.name,
        category: d.category?.trim() || v.category,
        region: v.region.trim() || regionHint,
        placeUrl: d.placeUrl?.trim() || url,
      }));
      showToast?.(`'${d.name || "매장"}' 정보를 불러왔어요`, "success");
    } catch {
      showToast?.("봇 서버에 연결하지 못했어요. 퍼블리 앱이 실행 중인지 확인해 주세요", "error");
    } finally {
      setResolving(false);
    }
  };

  const saveStore = async () => {
    if (!draft.name.trim()) {
      showToast?.("먼저 내 매장 이름을 입력해 주세요", "info");
      return;
    }
    const next = { ...draft, name: draft.name.trim(), placeUrl: draft.placeUrl.trim() };
    const nextKey = place360StoreKey(next.name, next.region);
    const existingIndex = profiles.findIndex(item => place360StoreKey(item.name, item.region) === (editingStoreKey || nextKey));
    const duplicateIndex = profiles.findIndex(item => place360StoreKey(item.name, item.region) === nextKey);
    const isNew = existingIndex < 0 && duplicateIndex < 0;
    const storeLimit = PLACE360_STORE_LIMIT[plan] ?? PLACE360_STORE_LIMIT.free;
    if (isNew && profiles.length >= storeLimit) {
      showToast?.(`내 등급은 매장을 ${storeLimit}개까지 등록할 수 있어요`, "info");
      return;
    }
    if (editingStoreKey && editingStoreKey !== nextKey && duplicateIndex >= 0 && duplicateIndex !== existingIndex) {
      showToast?.("같은 이름과 지역으로 등록된 매장이 이미 있어요", "info");
      return;
    }
    if (editingStoreKey && editingStoreKey !== nextKey && plan !== "admin") {
      try { await renamePlace360Store(editingStoreKey, nextKey, next.name, next.region); }
      catch (error: any) { showToast?.(String(error?.message || "").includes("PLACE360_STORE_EXISTS") ? "같은 이름과 지역으로 등록된 매장이 이미 있어요" : "저장된 측정 기록의 매장 정보를 바꾸지 못했어요", "error"); return; }
    }
    if (plan !== "admin") {
      try { await savePlace360StoreProfile({ store_key: nextKey, store_name: next.name, place_url: next.placeUrl, category: next.category, region: next.region, goal: next.goal }); }
      catch (error: any) { const message = String(error?.message || ""); showToast?.(message.includes("PLACE360_STORE_LIMIT") ? `내 등급은 매장을 ${storeLimit}개까지 등록할 수 있어요` : "매장 정보를 서버에 저장하지 못했어요", "error"); return; }
    }
    const updated = existingIndex >= 0
      ? profiles.map((item, index) => index === existingIndex ? next : item)
      : duplicateIndex >= 0
        ? profiles.map((item, index) => index === duplicateIndex ? next : item)
        : [...profiles, next];
    persistProfiles(userId, updated, next);
    setProfiles(updated);
    setProfile(next);
    setDraft(next);
    setEditingStoreKey(nextKey);
    setStoreFormOpen(false);
    showToast?.("내 매장을 저장했어요. 이제 진단을 시작할 수 있어요", "success");
    setTab("diagnosis");
  };
  const selectStore = (next: StoreProfile) => {
    setProfile(next); setDraft(next); setEditingStoreKey(place360StoreKey(next.name, next.region));
    localStorage.setItem(profileKey(userId), JSON.stringify(next));
    setCollectedPlaces([]); setLatestRank(null); setStoreFormOpen(false);
  };
  const startAddingStore = () => {
    const storeLimit = PLACE360_STORE_LIMIT[plan] ?? PLACE360_STORE_LIMIT.free;
    if (profiles.length >= storeLimit) { showToast?.(`내 등급은 매장을 ${storeLimit}개까지 등록할 수 있어요`, "info"); return; }
    setProfile(EMPTY_PROFILE); setDraft(EMPTY_PROFILE); setEditingStoreKey(null); setCollectedPlaces([]); setLatestRank(null); setStoreFormOpen(true); setTab("overview");
  };
  const removeCurrentStore = async () => {
    if (!hasStore || !window.confirm(`${profile.name} 매장을 삭제할까요? 이 매장의 저장된 순위·진단·운영자료가 함께 삭제되며 되돌릴 수 없습니다.`)) return;
    try {
      if (plan !== "admin") await deletePlace360Store(storeKey);
      else localStorage.removeItem(adminMetricsKey(storeKey));
      const remaining = profiles.filter(item => place360StoreKey(item.name, item.region) !== storeKey);
      const next = remaining[0] || EMPTY_PROFILE;
      setProfiles(remaining); setProfile(next); setDraft(next); setEditingStoreKey(next.name ? place360StoreKey(next.name, next.region) : null);
      persistProfiles(userId, remaining, next); setCollectedPlaces([]); setLatestRank(null); setStoreFormOpen(!next.name);
      showToast?.("매장과 저장된 진단 기록을 삭제했어요", "success");
    } catch (error: any) { showToast?.(error?.message || "매장을 삭제하지 못했어요", "error"); }
  };

  const tabs: Array<{ id: Place360Tab; icon: string; label: string; desc: string }> = [
    { id: "overview", icon: "🏠", label: "한눈에 보기", desc: "현재 상태와 다음 할 일" },
    { id: "rank", icon: "📍", label: "지금 내 순위", desc: "누르는 순간 최신 위치 확인" },
    { id: "diagnosis", icon: "🩺", label: "내 매장 진단", desc: "손님이 줄어든 이유 찾기" },
    { id: "data", icon: "📊", label: "운영자료 진단", desc: "신규·재방문·광고 비교" },
    { id: "mission", icon: "✅", label: "오늘 할 일", desc: "그대로 따라 하는 성장 미션" },
    { id: "discovery", icon: "🕵️", label: "업체·리뷰어 찾기", desc: "업체 발굴과 리뷰어 역추적" },
  ];

  const guideStepStates: Array<{ id: Place360Tab; label: string; done: boolean }> = [
    { id: "overview", label: "매장 등록", done: hasStore },
    { id: "rank", label: "순위 확인", done: Boolean(currentRank) },
    { id: "diagnosis", label: "원인 진단", done: Boolean(comparison || snapshots.length) },
    { id: "data", label: "운영자료", done: Boolean(metricsSavedAt) },
    { id: "mission", label: "오늘 미션", done: growthMissions.length > 0 && growthMissions.every(item => completedMissions.includes(item.id)) },
    { id: "discovery", label: "리뷰어 제안", done: reviewerHandoffCount > 0 },
  ];

  const growthGuide: Record<Place360Tab, { step: number; title: string; instruction: string; nextLabel: string; nextTab?: Place360Tab; openCrawl?: boolean; scrollToStore?: boolean }> = {
    overview: hasStore
      ? { step: 1, title: "내 매장 등록 완료", instruction: "이제 고객이 검색할 때 내 매장이 어디에 보이는지 확인하세요.", nextLabel: "2단계 · 내 순위 확인", nextTab: "rank" }
      : { step: 1, title: "먼저 내 매장을 등록하세요", instruction: "매장 이름을 입력하고 저장하면 나머지 진단이 내 가게 기준으로 연결돼요.", nextLabel: "아래에서 매장 등록하기", scrollToStore: true },
    rank: currentRank
      ? { step: 2, title: `현재 ${currentRank.rank ? `${currentRank.rank}위` : "확인 범위 밖"}`, instruction: "순위를 확인했어요. 다음은 경쟁업체와 비교해 이유를 찾을 차례예요.", nextLabel: "3단계 · 원인 진단", nextTab: "diagnosis" }
      : { step: 2, title: "내 순위를 먼저 측정하세요", instruction: "업체 찾기에서 지역과 업종을 검색하면 내 매장의 현재 순위가 함께 기록돼요.", nextLabel: "업체 찾기에서 측정", nextTab: "discovery" },
    diagnosis: { step: 3, title: "공개자료로 원인을 좁히는 단계", instruction: "리뷰·노출·정보 완성도를 확인한 뒤 실제 매출 자료와 함께 비교하세요.", nextLabel: "4단계 · 운영자료 입력", nextTab: "data" },
    data: { step: 4, title: "신규·재방문·광고를 나눠보는 단계", instruction: "최근 30일과 이전 30일을 입력하면 무엇이 줄었는지 구분해 드려요.", nextLabel: "5단계 · 오늘 할 일 받기", nextTab: "mission" },
    mission: { step: 5, title: "오늘 할 일을 실행하는 단계", instruction: "위에서부터 하나씩 실행하고 완료 체크를 누르면 오늘 진행률을 기억해요.", nextLabel: "6단계 · 리뷰어 찾기", nextTab: "discovery" },
    discovery: { step: 6, title: "업체와 리뷰어를 찾아 제안하는 단계", instruction: "업체 선택 → 리뷰어 역추적 → 분홍색 협업 제안 준비 버튼 순서로 진행하세요.", nextLabel: "선택을 보냈다면 크롤링 열기", openCrawl: true },
  };
  const activeGuide = growthGuide[tab];

  const fieldStyle: React.CSSProperties = { width: "100%", minHeight: 48, borderRadius: 12, border: `1px solid ${colors.line}`, background: dark ? colors.soft : "#fff", color: colors.text, padding: "11px 13px", fontFamily: "inherit", fontSize: 16, outline: "none" };
  const cardStyle: React.CSSProperties = { border: `1px solid ${colors.line}`, borderRadius: 20, background: colors.card };

  return <div className="p360" style={{ minHeight: 600, padding: "clamp(10px,2vw,22px)", borderRadius: 10, background: colors.bg, color: colors.text }}>
    <style>{`
      .p360 *{box-sizing:border-box}.p360-button{min-height:48px;border:0;border-radius:13px;padding:11px 16px;font-family:inherit;font-weight:900;cursor:pointer;transition:transform .15s,filter .15s}.p360-button:hover{filter:brightness(1.04);transform:translateY(-1px)}
      .p360-tabs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.p360-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.p360-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      @media(max-width:760px){.p360{padding:8px 6px 120px!important}.p360-tabs{grid-template-columns:1fr}.p360-grid,.p360-two{grid-template-columns:1fr}.p360-tab{text-align:left!important;display:grid!important;grid-template-columns:42px 1fr!important;align-items:center}.p360-hero{padding:20px 16px!important}.p360-title{font-size:25px!important}.p360-card{padding:16px!important}.p360-prescription,.p360-guide{grid-template-columns:1fr!important}.p360-prescription .p360-button,.p360-guide .p360-button{width:100%}}
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

    {/* 회원이 어느 기능 탭에 있든 바로 확인할 수 있는 공통 등급표. 관리자 화면에는 노출하지 않는다. */}
    {plan !== "admin" && <section className="p360-card" aria-label="플레이스 360 등급별 사용 한도" style={{ ...cardStyle, padding: 18, marginBottom: 12, overflow: "hidden", border: `2px solid ${colors.rose}35` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><b style={{ fontSize: 14 }}>📋 플레이스 360 등급별 사용 한도</b><span style={{ padding: "5px 9px", borderRadius: 99, background: `${colors.rose}13`, color: colors.rose, fontSize: 10.5, fontWeight: 900 }}>모든 메뉴에서 항상 확인</span></div>
      <p style={{ color: colors.sub, fontSize: 11.5, lineHeight: 1.65, margin: "6px 0 12px" }}>매장 등록·진단·기록 보관 한도예요. 업체 발굴과 리뷰어 역추적은 아래 업체·리뷰어 찾기의 기존 등급표를 사용해요.</p>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><div style={{ minWidth: 560, border: `1px solid ${colors.line}`, borderRadius: 13, overflow: "hidden" }}><div style={{ display: "grid", gridTemplateColumns: "1fr repeat(3,1.1fr)", background: colors.soft }}>{["등급", "등록 매장", "진단/일", "기록 보관"].map(title => <b key={title} style={{ padding: 10, fontSize: 11 }}>{title}</b>)}</div>{(["free", "basic", "pro"] as const).map(level => <div key={level} style={{ display: "grid", gridTemplateColumns: "1fr repeat(3,1.1fr)", borderTop: `1px solid ${colors.line}`, background: plan === level ? `${colors.rose}10` : colors.card }}><b style={{ padding: 10, color: plan === level ? colors.rose : colors.text }}>{level.toUpperCase()}{plan === level ? " · 내 등급" : ""}</b><span style={{ padding: 10 }}>{PLACE360_STORE_LIMIT[level]}개</span><span style={{ padding: 10 }}>{PLACE360_DAILY_DIAGNOSIS_LIMIT[level]}회</span><span style={{ padding: 10 }}>{PLACE360_HISTORY_DAYS[level]}일</span></div>)}</div></div>
      <p style={{ color: colors.sub, fontSize: 10.5, lineHeight: 1.6, margin: "9px 0 0" }}>같은 매장 진단은 같은 날 추가 차감 없이 갱신해요. 순위 측정은 별도 한도로 무료 {PLACE360_RANK_DAILY_LIMIT.free}회·베이직 {PLACE360_RANK_DAILY_LIMIT.basic}회·프로 {PLACE360_RANK_DAILY_LIMIT.pro}회/일이에요.</p>
    </section>}

    <section className="p360-card p360-guide" aria-label="플레이스 순위 상승 프로젝트 안내" style={{ ...cardStyle, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 14, padding: 18, marginBottom: 12, borderLeft: `6px solid ${colors.green}` }}>
      <div>
        <div style={{ color: colors.green, fontSize: 10.5, fontWeight: 950 }}>나를 따라와라 · STEP {activeGuide.step}/6</div>
        <b style={{ display: "block", marginTop: 4, fontSize: 16 }}>{activeGuide.title}</b>
        <p style={{ margin: "5px 0 10px", color: colors.sub, fontSize: 11.5, lineHeight: 1.65 }}>{activeGuide.instruction}</p>
        <div aria-label={`전체 6단계 중 ${activeGuide.step}단계`} style={{ height: 8, borderRadius: 99, overflow: "hidden", background: colors.soft }}><div style={{ width: `${activeGuide.step / 6 * 100}%`, height: "100%", background: `linear-gradient(90deg,${colors.green},${colors.rose})` }} /></div>
        <div aria-label="플레이스 성장 단계별 완료 상태" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 }}>{guideStepStates.map((item, index) => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? "step" : undefined} aria-label={`${index + 1}단계 ${item.label} ${item.done ? "완료" : "진행 전"}`} style={{ minHeight: 36, padding: "7px 10px", borderRadius: 99, border: `1px solid ${tab === item.id ? colors.rose : item.done ? colors.green : colors.line}`, background: tab === item.id ? `${colors.rose}13` : item.done ? `${colors.green}13` : colors.soft, color: tab === item.id ? colors.rose : item.done ? colors.green : colors.sub, fontFamily: "inherit", fontSize: 10.5, fontWeight: 900, cursor: "pointer" }}>{item.done ? "✓" : index + 1} {item.label}</button>)}</div>
      </div>
      <button type="button" className="p360-button" onClick={() => activeGuide.scrollToStore ? document.getElementById("p360-store-form")?.scrollIntoView({ behavior: "smooth", block: "start" }) : activeGuide.openCrawl ? onOpenCrawl?.() : activeGuide.nextTab && setTab(activeGuide.nextTab)} style={{ minWidth: 210, background: colors.green, color: "#fff" }}>{activeGuide.nextLabel} →</button>
    </section>

    {profiles.length > 0 && <section className="p360-card" aria-label="내 매장 선택" style={{ ...cardStyle, padding: 14, marginBottom: 12 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9, flexWrap: "wrap" }}><div><b style={{ fontSize: 13 }}>🏪 어느 매장을 볼까요?</b><div style={{ marginTop: 3, color: colors.sub, fontSize: 10.5 }}>매장을 누르면 순위·진단·운영자료가 그 매장으로 바뀌어요.</div></div><span style={{ color: colors.sub, fontSize: 11, fontWeight: 800 }}>{plan === "admin" || plan === "unlimited" ? `${profiles.length}개 등록` : `${profiles.length}/${PLACE360_STORE_LIMIT[plan] ?? PLACE360_STORE_LIMIT.free}개 등록`}</span></div><div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>{profiles.map(item => { const key = place360StoreKey(item.name, item.region); const active = key === storeKey && hasStore; return <button key={key} type="button" aria-pressed={active} className="p360-button" onClick={() => selectStore(item)} style={{ minHeight: 43, background: active ? colors.green : colors.soft, color: active ? "#fff" : colors.text, border: `1px solid ${active ? colors.green : colors.line}` }}>🏷️ {item.name}{item.region ? ` · ${item.region}` : ""}</button>; })}<button type="button" className="p360-button" onClick={startAddingStore} style={{ minHeight: 43, background: "transparent", color: colors.rose, border: `1px dashed ${colors.rose}` }}>＋ 다른 매장 등록</button></div></section>}

    {tab === "overview" && <main>
      {!hasStore || storeFormOpen ? <section id="p360-store-form" className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12, scrollMarginTop: 12 }}>
        <div style={{ fontSize: 19, fontWeight: 950 }}>먼저 내 매장을 알려주세요</div>
        <p style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.7, margin: "6px 0 16px" }}>네이버 플레이스 <b style={{ color: colors.text }}>주소만 붙여넣고 ‘불러오기’</b>를 누르면 매장 이름·업종·지역을 자동으로 채워드려요. 순위 측정도 이 주소를 기준으로 정확히 잡아요.</p>
        <div style={{ marginBottom: 12 }}>
          <b style={{ display: "block", marginBottom: 7, fontSize: 12 }}>네이버 플레이스 주소 · 추천</b>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
            <input value={draft.placeUrl} onChange={e => setDraft(v => ({ ...v, placeUrl: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void resolveFromUrl(); } }} placeholder="예: https://naver.me/xxxx 또는 플레이스 공유 주소" style={fieldStyle} />
            <button type="button" className="p360-button" disabled={resolving} onClick={() => void resolveFromUrl()} style={{ background: colors.green, color: "#fff", whiteSpace: "nowrap", opacity: resolving ? 0.7 : 1 }}>{resolving ? "불러오는 중…" : "🔎 주소로 불러오기"}</button>
          </div>
          <p style={{ color: colors.sub, fontSize: 11, lineHeight: 1.6, margin: "6px 2px 0" }}>네이버 지도에서 내 매장 → ‘공유’ 버튼의 주소를 붙여넣으면 가장 정확해요.</p>
        </div>
        <div className="p360-two">
          <label><b style={{ display: "block", marginBottom: 7, fontSize: 12 }}>매장 이름 · 필수</b><input value={draft.name} onChange={e => setDraft(v => ({ ...v, name: e.target.value }))} placeholder="예: 퍼블리 식당 성수점" style={fieldStyle} /></label>
          <label><b style={{ display: "block", marginBottom: 7, fontSize: 12 }}>업종</b><input value={draft.category} onChange={e => setDraft(v => ({ ...v, category: e.target.value }))} placeholder="예: 한식, 카페, 미용실" style={fieldStyle} /></label>
          <label><b style={{ display: "block", marginBottom: 7, fontSize: 12 }}>지역</b><input value={draft.region} onChange={e => setDraft(v => ({ ...v, region: e.target.value }))} placeholder="예: 성수동" style={fieldStyle} /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: profiles.length ? "1fr auto" : "1fr", gap: 8, marginTop: 14 }}><button type="button" className="p360-button" onClick={() => void saveStore()} style={{ width: "100%", background: colors.rose, color: "#fff" }}>내 매장 저장하고 진단 시작하기 →</button>{profiles.length > 0 && <button type="button" className="p360-button" onClick={() => { const selected = profiles.find(item => place360StoreKey(item.name, item.region) === editingStoreKey) || profiles[0]; selectStore(selected); }} style={{ background: colors.soft, color: colors.text, border: `1px solid ${colors.line}` }}>취소</button>}</div>
      </section> : <>
        <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12 }}>
          <div style={{ color: colors.green, fontWeight: 900, fontSize: 11 }}>내 매장 성장 프로젝트</div>
          <h2 style={{ margin: "5px 0", fontSize: 23 }}>{profile.name}</h2>
          <p style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.65 }}>{[profile.region, profile.category].filter(Boolean).join(" · ") || "지역과 업종을 추가하면 더 정확하게 비교할 수 있어요."}</p>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}><button type="button" className="p360-button" onClick={() => { setDraft(profile); setEditingStoreKey(storeKey); setStoreFormOpen(true); }} style={{ minHeight: 42, background: colors.soft, color: colors.text, border: `1px solid ${colors.line}` }}>✏️ 매장 정보 수정</button><button type="button" className="p360-button" onClick={() => void removeCurrentStore()} style={{ minHeight: 42, background: "transparent", color: colors.rose, border: `1px solid ${colors.rose}` }}>매장과 기록 삭제</button></div>
          <div className="p360-grid" style={{ marginTop: 15 }}>
            {[{ icon: "📍", title: "1. 지금 순위", desc: "지역·업종 검색에서 내 매장이 몇 번째인지 확인해요.", action: () => setTab("rank") }, { icon: "🩺", title: "2. 공개자료 진단", desc: "주변 업체와 리뷰·노출 상태를 비교해요.", action: () => setTab("diagnosis") }, { icon: "📊", title: "3. 운영자료 진단", desc: "신규·재방문·광고·매출의 최근 30일 변화를 비교해요.", action: () => setTab("data") }, { icon: "✅", title: "4. 오늘 할 일", desc: "진단 결과에 맞춘 행동을 위에서부터 하나씩 따라 해요.", action: () => setTab("mission") }, { icon: "👀", title: "5. 고객 화면 점검", desc: "사진·영업시간·메뉴·예약 정보를 실제 공개 화면에서 확인해요.", action: () => setTab("discovery") }, { icon: "🤝", title: "6. 리뷰어 찾기", desc: "경쟁업체 리뷰어를 찾아 크롤링 제안으로 보내요.", action: () => setTab("discovery") }].map(item => <button key={item.title} type="button" className="p360-button" onClick={item.action} style={{ minHeight: 130, textAlign: "left", border: `1px solid ${colors.line}`, background: colors.soft, color: colors.text }}><span style={{ fontSize: 25 }}>{item.icon}</span><b style={{ display: "block", marginTop: 8, fontSize: 15 }}>{item.title}</b><span style={{ display: "block", marginTop: 5, color: colors.sub, fontSize: 11.5, lineHeight: 1.5 }}>{item.desc}</span></button>)}
          </div>
        </section>
        <section className="p360-card" aria-label="최근 7일 매장 성장 리포트" style={{ ...cardStyle, padding: 20, marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}><div><b style={{ fontSize: 16 }}>📅 최근 7일 성장 리포트</b><p style={{ margin: "5px 0 0", color: colors.sub, fontSize: 11.5, lineHeight: 1.6 }}>측정과 실행 기록을 섞지 않고 한눈에 보여드려요. 숫자가 없으면 아직 실행 전이라는 뜻이에요.</p></div><span style={{ padding: "5px 9px", borderRadius: 99, background: `${colors.green}15`, color: colors.green, fontSize: 10.5, fontWeight: 900 }}>매장별 자동 집계</span></div><div className="p360-grid" style={{ marginTop: 13 }}><div style={{ padding: 14, borderRadius: 14, background: colors.soft }}><span style={{ color: colors.sub, fontSize: 10.5 }}>순위 측정</span><b style={{ display: "block", marginTop: 5, fontSize: 20 }}>{weeklySummary.measurements}회</b><small style={{ color: colors.sub }}>{weeklySummary.bestRank ? `최고 ${weeklySummary.bestRank}위` : "첫 측정이 필요해요"}</small></div><div style={{ padding: 14, borderRadius: 14, background: colors.soft }}><span style={{ color: colors.sub, fontSize: 10.5 }}>순위 변화</span><b style={{ display: "block", marginTop: 5, fontSize: 20, color: weeklySummary.rankChange === null ? colors.sub : weeklySummary.rankChange > 0 ? colors.green : weeklySummary.rankChange < 0 ? colors.rose : colors.text }}>{weeklySummary.rankChange === null ? "비교 전" : weeklySummary.rankChange > 0 ? `▲ ${weeklySummary.rankChange}단계` : weeklySummary.rankChange < 0 ? `▼ ${Math.abs(weeklySummary.rankChange)}단계` : "순위 유지"}</b><small style={{ color: colors.sub }}>같은 검색어 기록 기준</small></div><div style={{ padding: 14, borderRadius: 14, background: colors.soft }}><span style={{ color: colors.sub, fontSize: 10.5 }}>진단 · 오늘 실행</span><b style={{ display: "block", marginTop: 5, fontSize: 20 }}>{weeklySummary.diagnoses}회 · {weeklySummary.missionDone}개</b><small style={{ color: colors.sub }}>진단 기록 · 미션 완료</small></div></div><button type="button" className="p360-button" onClick={() => setTab(weeklySummary.measurements ? "rank" : "discovery")} style={{ width: "100%", marginTop: 12, background: colors.green, color: "#fff" }}>{weeklySummary.measurements ? "순위 변화 자세히 보기" : "첫 순위 측정 시작하기"} →</button></section>
        <section className="p360-card" style={{ ...cardStyle, padding: 20 }}><b>✅ 오늘은 이것부터 하세요</b><p style={{ margin: "7px 0 13px", color: colors.sub, fontSize: 12.5, lineHeight: 1.65 }}>무엇부터 해야 할지 고민하지 마세요. 오늘 할 일에서 내 매장 상태에 맞는 작업을 위에서부터 하나씩 안내해 드려요.</p><button type="button" className="p360-button" onClick={() => setTab("mission")} style={{ background: colors.rose, color: "#fff" }}>오늘의 성장 미션 시작하기 →</button></section>
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
        const operationalItem = metricsSavedAt && ["신규 고객", "재방문 가능성", "광고 효율", "상권 관심도"].includes(item.title);
        const rankItem = item.title === "플레이스 노출" && currentRank;
        const state = reviewItem && ownPlace && comparison ? "확인됨" : rankItem ? "순위 확인됨" : operationalItem ? "입력자료 확인됨" : item.state;
        let desc = reviewItem && ownPlace && comparison
          ? `내 매장 블로그 리뷰는 ${(ownPlace.blogReviewCount || 0).toLocaleString()}개, 주변 평균은 ${comparison.avgBlog.toLocaleString()}개예요. 현재 개수 비교이며 증가·감소 판단은 다음 측정부터 가능해요.`
          : item.desc;
        if (item.title === "신규 고객" && metricsSavedAt) desc = operationalDiagnosis.newChange === null ? "이전 30일 자료가 없어 아직 증감을 단정하지 않아요." : `최근 30일 신규 고객이 이전 기간보다 ${Math.abs(operationalDiagnosis.newChange)}% ${operationalDiagnosis.newChange < 0 ? "줄었어요" : "늘었거나 유지됐어요"}.`;
        if (item.title === "플레이스 노출" && currentRank) desc = `“${currentRank.query}” 검색에서 ${currentRank.rank ? `${currentRank.rank}위로 확인됐어요` : `확인한 ${currentRank.checkedCount}곳 안에 보이지 않았어요`}. 같은 조건의 지난 기록과 함께 보세요.`;
        if (item.title === "재방문 가능성" && metricsSavedAt) desc = operationalDiagnosis.repeatRate === null ? "신규·재방문 고객 수가 없어 아직 비율을 계산하지 않아요." : `최근 30일 재방문 비율은 ${operationalDiagnosis.repeatRate}%${operationalDiagnosis.previousRepeatRate === null ? "예요" : `, 이전 기간은 ${operationalDiagnosis.previousRepeatRate}%예요`}.`;
        if (item.title === "광고 효율" && metricsSavedAt) desc = operationalDiagnosis.currentCpa === null ? "광고 행동 수가 없어 건당 비용을 계산하지 않아요." : `광고에서 발생한 전화·예약·길찾기 1건당 비용은 ${operationalDiagnosis.currentCpa.toLocaleString()}원이에요.`;
        if (item.title === "상권 관심도" && metricsSavedAt) desc = operationalDiagnosis.salesChange === null ? "두 기간 매출자료가 없어 흐름을 판단하지 않아요." : `매출은 이전 기간보다 ${Math.abs(operationalDiagnosis.salesChange)}% ${operationalDiagnosis.salesChange < 0 ? "줄었어요" : "늘었거나 유지됐어요"}. 이것만으로 유동인구 변화라고 단정하지 않아요.`;
        return <article key={item.title} className="p360-card" style={{ ...cardStyle, padding: 18 }}><div style={{ display: "flex", gap: 9, alignItems: "center" }}><span style={{ fontSize: 23 }}>{item.icon}</span><b style={{ fontSize: 14.5 }}>{item.title}</b></div><span style={{ display: "inline-block", margin: "10px 0 7px", borderRadius: 99, padding: "4px 9px", background: state === "자료 필요" ? `${colors.amber}18` : `${colors.green}16`, color: state === "자료 필요" ? colors.amber : colors.green, fontSize: 10.5, fontWeight: 900 }}>{state}</span><p style={{ color: colors.sub, fontSize: 11.5, lineHeight: 1.65 }}>{desc}</p></article>;
      })}</div>
      <section className="p360-card" style={{ ...cardStyle, padding: 20, marginTop: 12 }}><b>진단 프로세스</b><p style={{ color: colors.sub, fontSize: 12, lineHeight: 1.75, margin: "7px 0 14px" }}>내 매장 확인 → 주변 경쟁업체 수집 → 리뷰·노출 변화 비교 → 원인과 근거 표시 → 해결할 작업 추천 순서로 이어집니다.</p><button type="button" className="p360-button" disabled={!hasStore} onClick={() => setTab(hasStore ? "discovery" : "overview")} style={{ width: "100%", opacity: hasStore ? 1 : .6, background: colors.green, color: "#fff" }}>{hasStore ? "경쟁업체와 리뷰어 찾으러 가기 →" : "먼저 내 매장 등록하기 →"}</button></section>
    </main>}

    {tab === "data" && <main>
      <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12 }}>
        <div style={{ color: colors.amber, fontSize: 11, fontWeight: 950 }}>OWNER DATA CHECK</div>
        <h2 style={{ margin: "6px 0", fontSize: 23 }}>📊 신규·재방문·광고, 무엇이 문제인지 나눠봐요</h2>
        <p style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.75, margin: 0 }}>플레이스 공개 화면만으로는 실제 신규 고객·재방문·광고 성과를 알 수 없어요. 포스(POS), 예약 장부, 광고 보고서에서 <b style={{ color: colors.text }}>최근 30일</b>과 <b style={{ color: colors.text }}>그 이전 30일</b> 숫자만 입력하면 서로 섞지 않고 비교해요.</p>
        {!hasStore && <button type="button" className="p360-button" onClick={() => setTab("overview")} style={{ marginTop: 14, background: colors.rose, color: "#fff" }}>먼저 내 매장 등록하기 →</button>}
      </section>
      {hasStore && <>
        <section className="p360-card" style={{ ...cardStyle, padding: 20, marginBottom: 12 }}>
          <b>✍️ 숫자 입력 · 모르면 0으로 두세요</b><p style={{ margin: "6px 0 14px", color: colors.sub, fontSize: 11.5, lineHeight: 1.65 }}>두 기간은 반드시 같은 기준으로 세어야 해요. 예: 네이버 예약만 적었다면 이전 기간도 네이버 예약만 적으세요.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}><button type="button" className="p360-button" onClick={downloadMetricsTemplate} style={{ minHeight: 43, background: colors.soft, color: colors.text, border: `1px solid ${colors.line}` }}>⬇️ CSV 양식 받기</button><button type="button" className="p360-button" onClick={() => csvInputRef.current?.click()} style={{ minHeight: 43, background: colors.amber, color: dark ? "#2b2620" : "#fff" }}>📂 작성한 CSV 불러오기</button><input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={event => void importMetricsCsv(event.target.files?.[0])} style={{ display: "none" }} aria-label="운영자료 CSV 파일 선택" /></div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}><div style={{ minWidth: 620, display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 1fr", gap: 8, padding: "0 8px", color: colors.sub, fontSize: 10.5, fontWeight: 900 }}><span>무엇을 적나요?</span><span>최근 30일</span><span>이전 30일</span></div>
            {([
              ["신규 고객 수", "처음 방문·첫 예약 고객", "current_new_customers", "previous_new_customers", "명"],
              ["재방문 고객 수", "두 번 이상 방문한 고객", "current_repeat_customers", "previous_repeat_customers", "명"],
              ["광고비", "네이버 등 유료 광고 지출", "current_ad_spend", "previous_ad_spend", "원"],
              ["광고 행동 수", "광고에서 발생한 전화·예약·길찾기", "current_ad_actions", "previous_ad_actions", "건"],
              ["매출", "같은 기준의 총매출", "current_sales", "previous_sales", "원"],
            ] as const).map(([title, desc, currentKey, previousKey, unit]) => <label key={currentKey} style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 1fr", gap: 8, alignItems: "center", padding: 10, borderRadius: 13, background: colors.soft }}><span><b style={{ display: "block", fontSize: 12.5 }}>{title}</b><small style={{ color: colors.sub, fontSize: 10.5 }}>{desc}</small></span><span style={{ position: "relative" }}><input aria-label={`${title} 최근 30일`} inputMode="numeric" min={0} max={1000000000} type="number" value={businessMetrics[currentKey]} onChange={e => updateBusinessMetric(currentKey, e.target.value)} style={{ ...fieldStyle, paddingRight: 30 }} /><small style={{ position: "absolute", right: 10, top: 16, color: colors.sub }}>{unit}</small></span><span style={{ position: "relative" }}><input aria-label={`${title} 이전 30일`} inputMode="numeric" min={0} max={1000000000} type="number" value={businessMetrics[previousKey]} onChange={e => updateBusinessMetric(previousKey, e.target.value)} style={{ ...fieldStyle, paddingRight: 30 }} /><small style={{ position: "absolute", right: 10, top: 16, color: colors.sub }}>{unit}</small></span></label>)}
          </div></div>
          <button type="button" className="p360-button" disabled={metricsLoading} onClick={() => void saveBusinessMetrics()} style={{ width: "100%", marginTop: 14, background: colors.green, color: "#fff", opacity: metricsLoading ? .6 : 1 }}>{metricsLoading ? "자료를 확인하는 중…" : "이 숫자로 원인 진단하기 →"}</button>{metricsSavedAt && <p style={{ margin: "8px 0 0", textAlign: "center", color: colors.sub, fontSize: 10.5 }}>마지막 저장 · {new Date(metricsSavedAt).toLocaleString("ko-KR")}</p>}
        </section>
        <section className="p360-card" style={{ ...cardStyle, padding: 20, marginBottom: 12 }}>
          <b>🩺 입력자료 진단 결과</b><p style={{ margin: "6px 0 13px", color: colors.sub, fontSize: 11.5, lineHeight: 1.65 }}>입력한 숫자만 계산한 결과예요. 0은 자료가 없는 것으로 보고 나쁜 상태라고 단정하지 않아요.</p>
          <div className="p360-two">
            {[
              { icon: "🧲", title: "신규 고객", value: operationalDiagnosis.newChange === null ? "비교자료 필요" : `${operationalDiagnosis.newChange >= 0 ? "+" : ""}${operationalDiagnosis.newChange}%`, desc: operationalDiagnosis.newChange === null ? "이전 30일 신규 고객 수를 넣으면 증감을 계산해요." : operationalDiagnosis.newChange < 0 ? "신규 고객이 줄었어요. 같은 기간 순위·노출 변화와 함께 확인하세요." : "신규 고객이 이전 기간보다 늘었거나 유지됐어요.", danger: operationalDiagnosis.newChange !== null && operationalDiagnosis.newChange < 0 },
              { icon: "🔁", title: "재방문 비율", value: operationalDiagnosis.repeatRate === null ? "비교자료 필요" : `${operationalDiagnosis.repeatRate}%`, desc: operationalDiagnosis.repeatRate === null ? "신규·재방문 고객 수를 입력하면 비율을 계산해요." : operationalDiagnosis.previousRepeatRate !== null && operationalDiagnosis.repeatRate < operationalDiagnosis.previousRepeatRate ? `이전 ${operationalDiagnosis.previousRepeatRate}%보다 낮아졌어요. 재방문 안내와 고객 경험을 점검하세요.` : "이전 기간과 비교해 유지되거나 좋아졌어요.", danger: operationalDiagnosis.repeatRate !== null && operationalDiagnosis.previousRepeatRate !== null && operationalDiagnosis.repeatRate < operationalDiagnosis.previousRepeatRate },
              { icon: "📣", title: "광고 1건당 비용", value: operationalDiagnosis.currentCpa === null ? "광고 행동 필요" : `${operationalDiagnosis.currentCpa.toLocaleString()}원`, desc: operationalDiagnosis.currentCpa === null ? "광고비와 광고에서 생긴 전화·예약·길찾기 수를 넣어주세요." : operationalDiagnosis.previousCpa !== null && operationalDiagnosis.currentCpa > operationalDiagnosis.previousCpa ? `이전 ${operationalDiagnosis.previousCpa.toLocaleString()}원보다 비싸졌어요. 키워드와 소재를 점검하세요.` : "이전 기간과 비교해 유지되거나 효율이 좋아졌어요.", danger: operationalDiagnosis.currentCpa !== null && operationalDiagnosis.previousCpa !== null && operationalDiagnosis.currentCpa > operationalDiagnosis.previousCpa },
              { icon: "🏙️", title: "매출 흐름", value: operationalDiagnosis.salesChange === null ? "비교자료 필요" : `${operationalDiagnosis.salesChange >= 0 ? "+" : ""}${operationalDiagnosis.salesChange}%`, desc: operationalDiagnosis.salesChange === null ? "두 기간 매출을 입력하면 전체 흐름을 비교해요." : operationalDiagnosis.salesChange < 0 ? "매출이 줄었어요. 신규·재방문·광고 결과를 함께 보고 원인을 좁히세요." : "매출이 이전 기간보다 늘었거나 유지됐어요.", danger: operationalDiagnosis.salesChange !== null && operationalDiagnosis.salesChange < 0 },
            ].map(item => <article key={item.title} style={{ padding: 16, borderRadius: 15, background: colors.soft, borderLeft: `4px solid ${item.danger ? colors.rose : colors.green}` }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{item.icon} {item.title}</b><strong style={{ color: item.danger ? colors.rose : colors.green }}>{item.value}</strong></div><p style={{ margin: "8px 0 0", color: colors.sub, fontSize: 11.5, lineHeight: 1.6 }}>{item.desc}</p></article>)}
          </div>
          <p style={{ margin: "12px 0 0", color: colors.sub, fontSize: 10.5, lineHeight: 1.65 }}>※ 매출 감소만으로 유동인구 감소라고 단정할 수 없어요. 상권 유동인구는 공공·통신 상권 데이터가 연결될 때 별도 근거로 표시합니다.</p>
        </section>
      </>}
    </main>}

    {tab === "mission" && <main>
      <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12 }}>
        <div style={{ color: colors.green, fontSize: 11, fontWeight: 950 }}>TODAY'S PLACE GROWTH MISSION</div>
        <h2 style={{ margin: "6px 0", fontSize: 23 }}>✅ 오늘은 이것만 순서대로 하세요</h2>
        <p style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.75, margin: 0 }}>어려운 분석표를 읽지 않아도 돼요. 위에서부터 하나씩 실행하고 끝났으면 <b style={{ color: colors.text }}>완료 체크</b>를 누르세요. 체크는 매장별로 안전하게 저장되어 다른 PC에서도 이어집니다.</p>
        <div style={{ marginTop: 14, height: 11, borderRadius: 99, overflow: "hidden", background: colors.soft }}><div style={{ width: `${growthMissions.length ? Math.round(growthMissions.filter(item => completedMissions.includes(item.id)).length / growthMissions.length * 100) : 0}%`, height: "100%", background: `linear-gradient(90deg,${colors.green},${colors.rose})`, transition: "width .25s" }} /></div>
        <div style={{ marginTop: 7, color: colors.sub, fontSize: 11.5, fontWeight: 800 }}>{growthMissions.filter(item => completedMissions.includes(item.id)).length}개 완료 · 전체 {growthMissions.length}개</div>
      </section>
      <div style={{ display: "grid", gap: 10 }}>
        {growthMissions.map((item, index) => {
          const done = completedMissions.includes(item.id);
          return <article key={item.id} className="p360-card p360-prescription" style={{ ...cardStyle, display: "grid", gridTemplateColumns: "54px minmax(0,1fr) auto", alignItems: "center", gap: 13, padding: 18, opacity: done ? .72 : 1, borderLeft: `5px solid ${done ? colors.green : colors.rose}` }}>
            <div aria-hidden="true" style={{ width: 50, height: 50, display: "grid", placeItems: "center", borderRadius: 15, background: done ? `${colors.green}18` : `${colors.rose}14`, fontSize: 26 }}>{done ? "✓" : item.icon}</div>
            <div><div style={{ color: done ? colors.green : colors.rose, fontSize: 10.5, fontWeight: 950 }}>STEP {index + 1}{done ? " · 완료" : ""}</div><h3 style={{ margin: "4px 0 7px", fontSize: 16, textDecoration: done ? "line-through" : "none" }}>{item.title}</h3><p style={{ margin: 0, color: colors.sub, fontSize: 11.5, lineHeight: 1.65 }}><b style={{ color: colors.text }}>왜 하나요?</b> {item.why}<br/><b style={{ color: colors.text }}>어떻게 하나요?</b> {item.how}</p></div>
            <div style={{ display: "grid", gap: 7, minWidth: 138 }}><button type="button" className="p360-button" onClick={() => setTab(item.go)} style={{ background: done ? colors.soft : colors.rose, color: done ? colors.text : "#fff", border: done ? `1px solid ${colors.line}` : 0 }}>{item.action} →</button><button type="button" className="p360-button" aria-pressed={done} onClick={() => void toggleMission(item.id)} style={{ minHeight: 42, background: done ? colors.green : "transparent", color: done ? "#fff" : colors.green, border: `1px solid ${colors.green}` }}>{done ? "✓ 완료했어요" : "끝나면 완료 체크"}</button></div>
          </article>;
        })}
      </div>
      {growthMissions.length > 0 && growthMissions.every(item => completedMissions.includes(item.id)) && <section role="status" className="p360-card" style={{ ...cardStyle, padding: 22, marginTop: 12, textAlign: "center", borderColor: colors.green }}><div style={{ fontSize: 38 }}>🎉</div><b style={{ display: "block", marginTop: 7, fontSize: 18 }}>오늘의 매장 성장 작업을 모두 마쳤어요</b><p style={{ color: colors.sub, fontSize: 12, lineHeight: 1.7 }}>다음 측정일에 같은 조건으로 순위를 확인하면 오늘 작업의 변화를 비교할 수 있어요.</p><button type="button" className="p360-button" onClick={() => setTab("rank")} style={{ background: colors.green, color: "#fff" }}>순위 기록 확인하기 →</button></section>}
    </main>}

    {tab === "rank" && <main>
      <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12 }}>
        <div style={{ color: colors.rose, fontSize: 11, fontWeight: 950 }}>PLACE RANK GROWTH PROJECT</div>
        <h2 style={{ margin: "6px 0", fontSize: 23 }}>📍 지금 고객 검색에서 내 매장은 몇 번째일까요?</h2>
        <p style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.7 }}>업체·리뷰어 찾기에서 지역과 업종을 입력해 측정하면, 그 검색 결과 안에서 내 매장의 관찰 순위를 바로 보여드려요. 같은 결과를 다시 사용하므로 불필요한 중복 수집을 하지 않아요.</p>
      </section>
      {currentRank ? <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12 }}><span style={{ color: colors.sub, fontSize: 11 }}>검색어 · {currentRank.query}</span><div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "10px 0", flexWrap: "wrap" }}><strong style={{ color: currentRank.rank ? colors.rose : colors.amber, fontSize: 46, lineHeight: 1 }}>{currentRank.rank ? `${currentRank.rank}위` : `상위 ${currentRank.checkedCount}곳 밖`}</strong>{previousRank?.rank && currentRank.rank ? <b style={{ color: previousRank.rank > currentRank.rank ? colors.green : previousRank.rank < currentRank.rank ? colors.rose : colors.sub }}>{previousRank.rank > currentRank.rank ? `▲ ${previousRank.rank - currentRank.rank}단계 상승` : previousRank.rank < currentRank.rank ? `▼ ${currentRank.rank - previousRank.rank}단계 하락` : "— 순위 유지"}</b> : <b style={{ color: colors.sub }}>첫 기준 순위</b>}</div><p style={{ color: colors.sub, fontSize: 11.5, lineHeight: 1.65 }}>{currentRank.surface} · 비로그인 검색 화면 기준 · {new Date(currentRank.measuredAt).toLocaleString("ko-KR")} 측정<br/>위치·시간·기기·개인화에 따라 실제 고객 화면과 차이가 날 수 있어요.</p><button type="button" className="p360-button" onClick={() => setTab("diagnosis")} style={{ marginTop: 12, background: colors.rose, color: "#fff" }}>왜 이 순위인지 진단하기 →</button></section> : <section className="p360-card" style={{ ...cardStyle, padding: 22, marginBottom: 12, textAlign: "center" }}><div style={{ fontSize: 38 }}>🚀</div><b style={{ display: "block", marginTop: 7 }}>아직 측정한 순위가 없어요</b><p style={{ color: colors.sub, fontSize: 12, lineHeight: 1.65, margin: "7px 0 14px" }}>내 매장을 먼저 등록한 뒤 지역·업종으로 업체를 찾으면 순위가 자동 측정돼요.</p><button type="button" className="p360-button" onClick={() => setTab(hasStore ? "discovery" : "overview")} style={{ background: colors.green, color: "#fff" }}>{hasStore ? "지금 내 순위 측정하기" : "먼저 내 매장 등록하기"}</button></section>}
      {rankTimeline.length > 0 && <section className="p360-card" style={{ ...cardStyle, padding: 20, marginBottom: 12 }}>
        <b>🕒 같은 검색어 순위 기록</b>
        <p style={{ color: colors.sub, fontSize: 11.5, lineHeight: 1.65, margin: "6px 0 13px" }}><b style={{ color: colors.text }}>{currentRank?.query}</b>를 같은 조건으로 측정한 최근 기록이에요. 숫자가 작아질수록 고객 화면 위쪽으로 올라간 거예요.</p>
        <div style={{ display: "grid", gap: 7 }}>{rankTimeline.map((row, index) => {
          const older = rankTimeline[index + 1];
          const change = row.rank && older?.rank ? older.rank - row.rank : null;
          return <div key={row.id} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) auto auto", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 12, background: index === 0 ? `${colors.rose}10` : colors.soft, border: `1px solid ${index === 0 ? `${colors.rose}35` : colors.line}` }}><span style={{ color: colors.sub, fontSize: 11 }}>{new Date(row.measured_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}{index === 0 ? <b style={{ marginLeft: 6, color: colors.rose }}>최신</b> : null}</span><b style={{ fontSize: 16, color: row.rank ? colors.text : colors.amber }}>{row.rank ? `${row.rank}위` : `${row.checked_count}위 밖`}</b><span style={{ minWidth: 66, textAlign: "right", color: change === null ? colors.sub : change > 0 ? colors.green : change < 0 ? colors.rose : colors.sub, fontSize: 11.5, fontWeight: 900 }}>{change === null ? "기준" : change > 0 ? `▲ ${change} 상승` : change < 0 ? `▼ ${Math.abs(change)} 하락` : "— 유지"}</span></div>;
        })}</div>
      </section>}
      <section className="p360-card" style={{ ...cardStyle, padding: 20 }}><b>🌱 순위 상승 프로젝트</b><p style={{ color: colors.sub, fontSize: 12, lineHeight: 1.75, margin: "7px 0 0" }}>현재 순위 측정 → 상위 경쟁업체 비교 → 리뷰·정보 완성도 진단 → 오늘의 성장 미션 → 같은 조건 재측정 순서로 키워갑니다.</p></section>
    </main>}

    <div style={{ display: tab === "discovery" ? "block" : "none" }} aria-hidden={tab !== "discovery"}>
      <PlaceCenter showToast={showToast} theme={theme} userId={userId} plan={plan} initialRegion={profile.region} ownStoreName={profile.name} onPlacesCollected={onPlacesCollected} onReviewerHandoff={onReviewerHandoff} onOwnStoreDetailViewed={() => completeMissionAutomatically("customer")} onOpenCrawl={onOpenCrawl} />
    </div>
  </div>;
}
