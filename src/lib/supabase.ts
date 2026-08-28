import { createClient } from "@supabase/supabase-js";
import { botFetch } from "./botApi";
import { koreaDateKey } from "./date";

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";

// This app uses its own publy_users login, not Supabase Auth. Keep PostgREST
// requests explicitly anonymous so a stale sb-*-auth-token in Electron's
// localStorage cannot silently change the RLS role/uid used by supabase-js.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

// ── 타입 ─────────────────────────────────────────────────
export interface PublyUser {
  id: string;
  email: string;
  name: string;
  plan: "free" | "basic" | "pro" | "unlimited";
  app_type: "app" | "web" | "both";
  is_active: boolean;
  created_at: string;
  referred_by?: string;
  last_seen?: string;   // 마지막 접속(앱 켜짐/사용) 시각
}

export interface PublyQuota {
  id: string;
  user_id: string;
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  reset_date: string;
}

export interface PublyAccount {
  id: string;
  user_id: string;
  platform: "naver" | "tistory" | "google";
  username: string;
  blog_name?: string;
  is_connected: boolean;
  connected_at?: string;
}

export interface PublyHistory {
  id: string;
  user_id: string;
  platform: string;
  title: string;
  post_url?: string;
  status: "pending" | "success" | "fail";
  error_message?: string;
  published_at: string;
  content?: any;  // 재발행용: 발행 당시 payload(title/blocks/thumbnail/tags/visibility 등) 전체 저장
}

export interface Place360Snapshot {
  id: string;
  user_id: string;
  store_key: string;
  store_name: string;
  region: string;
  category: string;
  visitor_reviews: number;
  blog_reviews: number;
  competitor_count: number;
  competitor_avg_visitor: number;
  competitor_avg_blog: number;
  collected_count: number;
  measured_on: string;
  created_at: string;
}

export const PLACE360_STORE_LIMIT: Record<string, number> = { free: 1, basic: 3, pro: 10, unlimited: 999999, admin: 999999 };
export const PLACE360_DAILY_DIAGNOSIS_LIMIT: Record<string, number> = { free: 1, basic: 3, pro: 10, unlimited: 999999, admin: 999999 };
export const PLACE360_HISTORY_DAYS: Record<string, number> = { free: 30, basic: 90, pro: 365, unlimited: 3650, admin: 3650 };

export function place360StoreKey(name: string, region = ""): string {
  return `${region.trim()}::${name.trim()}`.toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").slice(0, 180);
}

export async function savePlace360Snapshot(input: Omit<Place360Snapshot, "id" | "user_id" | "measured_on" | "created_at">): Promise<Place360Snapshot | null> {
  const token = getMemberSessionToken();
  if (!token) return null;
  const { data, error } = await supabase.rpc("publy_place360_save_snapshot", {
    p_token: token, p_store_key: input.store_key, p_store_name: input.store_name,
    p_region: input.region, p_category: input.category,
    p_visitor_reviews: input.visitor_reviews, p_blog_reviews: input.blog_reviews,
    p_competitor_count: input.competitor_count, p_competitor_avg_visitor: input.competitor_avg_visitor,
    p_competitor_avg_blog: input.competitor_avg_blog, p_collected_count: input.collected_count,
  });
  if (error) throw new Error(error.message);
  return (data as Place360Snapshot) || null;
}

export async function getPlace360Snapshots(storeKey: string): Promise<Place360Snapshot[]> {
  const token = getMemberSessionToken();
  if (!token || !storeKey) return [];
  const { data, error } = await supabase.rpc("publy_place360_get_snapshots", { p_token: token, p_store_key: storeKey });
  if (error) throw new Error(error.message);
  return (data || []) as Place360Snapshot[];
}

export async function getAdminPlace360Snapshots(search = ""): Promise<Place360Snapshot[]> {
  const token = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
  if (!token) return [];
  const { data, error } = await supabase.rpc("publy_place360_admin_list", { p_token: token, p_search: search });
  if (error) throw new Error(error.message);
  return (data || []) as Place360Snapshot[];
}

export async function deleteAdminPlace360Snapshot(id: string): Promise<void> {
  const token = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
  const { data, error } = await supabase.rpc("publy_place360_admin_delete", { p_token: token, p_id: id });
  if (error || data !== true) throw new Error(error?.message || "측정 기록 삭제에 실패했습니다");
}

// ── 인증 ─────────────────────────────────────────────────
const MEMBER_SESSION_KEY = "publy_session_token";
const ADMIN_SESSION_KEY = "publy_admin_token";

export function getMemberSessionToken(): string {
  return localStorage.getItem(MEMBER_SESSION_KEY) || "";
}

export async function signUp(email: string, password: string, name: string, phone?: string, referredBy?: string) {
  const { data, error } = await supabase.rpc("publy_signup", {
    p_email: email, p_password: password, p_name: name, p_phone: phone || null,
  });
  if (error || !data?.token || !data?.user) {
    if (error?.message?.includes("EMAIL_EXISTS")) throw new Error("이미 가입된 이메일입니다");
    if (error?.message?.includes("WEAK_PASSWORD")) throw new Error("비밀번호는 8자 이상이어야 합니다");
    throw new Error(error?.message || "회원가입에 실패했습니다");
  }
  localStorage.setItem(MEMBER_SESSION_KEY, data.token);
  // 추천인 컬럼이 없는 기존 운영 스키마에서는 가입 자체를 막지 않고 추후 추천 테이블로 처리한다.
  void referredBy;
  return data.user as PublyUser;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.rpc("publy_login", { p_email: email, p_password: password });
  if (error || !data?.token || !data?.user) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다");
  localStorage.setItem(MEMBER_SESSION_KEY, data.token);
  return data.user as PublyUser;
}

export async function logoutServerSession(): Promise<void> {
  const token = getMemberSessionToken();
  localStorage.removeItem(MEMBER_SESSION_KEY);
  if (token) {
    try { await supabase.rpc("publy_logout", { p_token: token }); } catch {}
  }
}

// 마지막 접속 시각 기록(앱 켜짐/사용 중). 관리자가 "누가 언제 마지막에 썼는지" 확인용.
//   컬럼이 아직 없으면 조용히 무시(마이그레이션 전에도 앱이 죽지 않게).
export async function touchLastSeen(userId: string): Promise<void> {
  try { await supabase.from("publy_users").update({ last_seen: new Date().toISOString() }).eq("id", userId); } catch {}
}

// 최신 회원정보(등급/활성 등)를 id로 다시 읽는다. 관리자가 등급을 바꾸면 회원 앱이 실시간으로 반영하기 위함.
export async function refreshUserById(userId: string): Promise<PublyUser | null> {
  const token = getMemberSessionToken();
  if (token) {
    const { data, error } = await supabase.rpc("publy_session_get", { p_token: token });
    if (error || !data?.user || data.user.id !== userId) return null;
    return data.user as PublyUser;
  }
  const { data } = await supabase
    .from("publy_users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return (data as PublyUser) || null;
}

// ── 쿼터 ─────────────────────────────────────────────────
export async function getQuota(userId: string): Promise<PublyQuota | null> {
  const { data } = await supabase
    .from("publy_quotas")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function useQuota(userId: string): Promise<boolean> {
  // 무제한(unlimited) 등급은 총 발행 쿼타 체크/차감 없이 항상 통과.
  try {
    const { data: u } = await supabase.from("publy_users").select("plan").eq("id", userId).maybeSingle();
    if (u?.plan === "unlimited") return true;
  } catch {}
  const quota = await getQuota(userId);
  if (!quota || quota.remaining_quota <= 0) return false;

  const { data: updated, error } = await supabase
    .from("publy_quotas")
    .update({ used_quota: quota.used_quota + 1 })
    .eq("user_id", userId)
    .eq("used_quota", quota.used_quota)
    .select("id");

  return !error && !!updated?.length;
}

/** 발행이 실제로 실패했을 때만 호출한다. */
export async function refundQuota(userId: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const quota = await getQuota(userId);
    if (!quota || quota.used_quota <= 0) return;
    const { data, error } = await supabase
      .from("publy_quotas")
      .update({ used_quota: quota.used_quota - 1 })
      .eq("user_id", userId)
      .eq("used_quota", quota.used_quota)
      .select("id");
    if (!error && data?.length) return;
  }
}

// ── 히스토리 ─────────────────────────────────────────────
export async function addHistory(data: Omit<PublyHistory, "id" | "published_at">) {
  const { error } = await supabase.from("publy_history").insert(data);
  if (error) throw new Error(error.message);
}

// ★목록엔 본문(content) 컬럼 제외 — content엔 발행 본문 전체(이미지 등)가 담겨 115건이어도
//   수십 MB라 select("*")가 문 타임아웃(57014)을 낸다. 목록에 필요한 가벼운 컬럼만 가져온다.
const HISTORY_COLS = "id,user_id,platform,title,post_url,status,error_message,image_used,published_at";

// 재발행(글·이미지 통째 복원)용 — 목록엔 무거운 content를 안 싣지만, 재발행 버튼을
// 누른 그 한 건만 PK로 단건 조회한다(인덱스 1행이라 빠름, 타임아웃 없음).
// content는 DB에 JSON 문자열로 저장돼 있어 문자열이면 파싱해 객체로 돌려준다.
export async function getHistoryContent(id: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("publy_history")
    .select("content")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  let c: any = (data as any)?.content;
  if (c == null) return null;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { return null; } }
  return c;
}

export async function getHistory(userId: string): Promise<PublyHistory[]> {
  const ordered = await supabase
    .from("publy_history")
    .select(HISTORY_COLS)
    .eq("user_id", userId)
    .order("published_at", { ascending: false })
    .limit(2000);   // 발행 흔적을 자동으로 지우지 않는다(테리). 삭제는 사용자가 개별/전체 버튼으로만.

  if (!ordered.error) return (ordered.data || []) as PublyHistory[];

  // A missing/renamed/non-orderable published_at column must not make valid
  // history disappear. Retry without server-side ordering, then sort valid
  // timestamps locally. If this also fails, expose both PostgREST diagnostics.
  const unordered = await supabase
    .from("publy_history")
    .select(HISTORY_COLS)
    .eq("user_id", userId)
    .limit(2000);

  if (unordered.error) {
    const details = [
      `ordered: ${ordered.error.code || "unknown"} ${ordered.error.message}`,
      ordered.error.details && `details: ${ordered.error.details}`,
      ordered.error.hint && `hint: ${ordered.error.hint}`,
      `fallback: ${unordered.error.code || "unknown"} ${unordered.error.message}`,
      unordered.error.details && `details: ${unordered.error.details}`,
      unordered.error.hint && `hint: ${unordered.error.hint}`,
    ].filter(Boolean).join(" | ");
    console.error("[publy_history] query failed", { userId, ordered: ordered.error, fallback: unordered.error });
    throw new Error(`발행 기록 조회 실패 (${details})`);
  }

  console.warn("[publy_history] published_at ordering failed; using local sort", {
    userId,
    error: ordered.error,
  });
  return ((unordered.data || []) as PublyHistory[]).sort((a, b) => {
    const aTime = Date.parse(a.published_at);
    const bTime = Date.parse(b.published_at);
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });
}

export async function deleteHistory(id: string): Promise<void> {
  await supabase.from("publy_history").delete().eq("id", id);
}

export async function deleteAllHistory(userId: string): Promise<void> {
  await supabase.from("publy_history").delete().eq("user_id", userId);
}

// 실패(fail)한 발행 기록만 전체 삭제 — 성공/대기 건은 그대로 둔다.
export async function deleteFailedHistory(userId: string): Promise<void> {
  await supabase.from("publy_history").delete().eq("user_id", userId).eq("status", "fail");
}

// ── 계정 ─────────────────────────────────────────────────
export async function getAccounts(userId: string): Promise<PublyAccount[]> {
  const { data } = await supabase
    .from("publy_accounts")
    .select("id, user_id, platform, username, password_encrypted, blog_name, is_connected, connected_at")
    .eq("user_id", userId);
  // 기존 Base64 값은 한 번만 메모리로 반환하고 DB에서는 즉시 제거한다.
  if (data?.some((account: any) => account.password_encrypted)) {
    await supabase.from("publy_accounts").update({ password_encrypted: "" }).eq("user_id", userId);
  }
  return data || [];
}

export async function upsertAccount(account: Partial<PublyAccount> & { password_encrypted?: string }) {
  // Legacy NOT NULL schemas accept an empty marker; credentials are never persisted.
  account.password_encrypted = "";
  const { error } = await supabase.from("publy_accounts").upsert(account);
  if (error) throw new Error(error.message);
}

// ── 관리자 비밀번호 (publy_settings 테이블) ──────────────
export async function verifyAdminPassword(pw: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("publy_admin_login", { p_password: pw });
  if (error || !data) return false;
  sessionStorage.setItem(ADMIN_SESSION_KEY, data);
  return true;
}

export async function verifyAdminSession(): Promise<boolean> {
  const token = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
  if (!token) return false;
  const { data, error } = await supabase.rpc("publy_admin_session_get", { p_token: token });
  return !error && data === true;
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export async function setAdminPassword(newPw: string): Promise<void> {
  const token = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
  const { error } = await supabase.rpc("publy_admin_change_password", { p_token: token, p_new_password: newPw });
  if (error) throw new Error(error.message);
  clearAdminSession();
  localStorage.removeItem("publy_admin_pw");
}

// ── 일반 회원 비밀번호 변경 ───────────────────────────────
export async function changeUserPassword(userId: string, currentPw: string, newPw: string): Promise<void> {
  void userId;
  const { error } = await supabase.rpc("publy_change_password", {
    p_token: getMemberSessionToken(), p_current_password: currentPw, p_new_password: newPw,
  });
  if (error?.message?.includes("INVALID_CURRENT_PASSWORD")) throw new Error("현재 비밀번호가 올바르지 않습니다");
  if (error) throw new Error(error.message);
}

// ── 네이버 API 키 관리 ────────────────────────────────────
export interface NaverApiKeys {
  naver_access_license?: string;
  naver_secret_key?: string;
  naver_customer_id?: string;
  naver_datalab_client_id?: string;
  naver_datalab_client_secret?: string;
}

export async function saveNaverApiKeys(userId: string, keys: NaverApiKeys): Promise<void> {
  for (const [key, value] of Object.entries(keys)) {
    if (!value) continue;
    const { error } = await supabase
      .from("publy_settings")
      .upsert({ key: `user_${userId}_${key}`, value }, { onConflict: "key" });
    if (error) throw new Error(error.message);
  }
}

export async function getNaverApiKeys(userId: string): Promise<NaverApiKeys> {
  const names = ["naver_access_license","naver_secret_key","naver_customer_id","naver_datalab_client_id","naver_datalab_client_secret"];
  const result: NaverApiKeys = {};
  for (const k of names) {
    const { data: uRow } = await supabase.from("publy_settings").select("value").eq("key",`user_${userId}_${k}`).maybeSingle();
    if (uRow?.value) { (result as any)[k] = uRow.value; continue; }
    const { data: aRow } = await supabase.from("publy_settings").select("value").eq("key",`admin_${k}`).maybeSingle();
    if (aRow?.value) (result as any)[k] = aRow.value;
  }
  return result;
}

export async function saveAdminNaverApiKeys(keys: NaverApiKeys): Promise<void> {
  for (const [key, value] of Object.entries(keys)) {
    if (!value) continue;
    const { error } = await supabase
      .from("publy_settings")
      .upsert({ key: `admin_${key}`, value }, { onConflict: "key" });
    if (error) throw new Error(error.message);
  }
}

// ── 네이버 API 일일 쿼타 ──────────────────────────────────
/* ── 등급별 설정 ── */
export const PLAN_CONFIG: Record<string, {
  label: string;
  maxAccounts: number;
  dailyPublish: number;
  dailyCrawl: number;    // 크롤링 하루 발굴 인원(무제한=999999)
  dailyEmail: number;    // 크롤링 아웃리치 하루 이메일 발송(무제한=999999, 계정 안전상 100 권장)
  dailyComment: number;  // 크롤링 아웃리치 하루 댓글 제안(★계정 안전상 매우 낮게 — 도배 감지 위험)
  trialDays: number;
}> = {
  free:  { label: "FREE",  maxAccounts: 1, dailyPublish: 2,  dailyCrawl: 5,  dailyEmail: 5,  dailyComment: 3,  trialDays: 7  },
  basic: { label: "BASIC", maxAccounts: 2, dailyPublish: 6,  dailyCrawl: 20, dailyEmail: 20, dailyComment: 5,  trialDays: 30 },
  pro:   { label: "PRO",   maxAccounts: 3, dailyPublish: 15, dailyCrawl: 50, dailyEmail: 50, dailyComment: 8,  trialDays: 30 },
  unlimited: { label: "무제한", maxAccounts: 999, dailyPublish: 999999, dailyCrawl: 999999, dailyEmail: 999999, dailyComment: 999999, trialDays: 99999 },
  admin: { label: "ADMIN", maxAccounts: 99, dailyPublish: 9999, dailyCrawl: 999999, dailyEmail: 999999, dailyComment: 999999, trialDays: 9999 },
};

function publishQuotaKey(userId: string): string {
  const today = koreaDateKey();
  return `publish_daily_${userId}_${today}`;
}

/* ── 오늘 발행 수 조회 ── */
export async function getDailyPublishUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", publishQuotaKey(userId))
      .maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}

/* ── 오늘 발행 쿼타 체크 ── */
export async function checkDailyPublishQuota(userId: string, plan: string): Promise<{ ok: boolean; used: number; limit: number }> {
  const config = PLAN_CONFIG[plan] ?? PLAN_CONFIG.free;
  const used = await getDailyPublishUsage(userId);
  return { ok: used < config.dailyPublish, used, limit: config.dailyPublish };
}

/* ── 오늘 발행 수 증가 ── */
export async function incrementDailyPublish(userId: string): Promise<void> {
  const key = publishQuotaKey(userId);
  const used = await getDailyPublishUsage(userId);
  await supabase
    .from("publy_settings")
    .upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

/* ── 관리자: 오늘 발행 카운트 초기화 ── (실제 한도체크가 읽는 publy_settings 키를 0으로) */
export async function resetDailyPublish(userId: string): Promise<void> {
  const key = publishQuotaKey(userId);
  const { data, error } = await supabase
    .from("publy_settings")
    .upsert({ key, value: "0" }, { onConflict: "key" })
    .select("key,value");
  if (error) throw new Error(`일일 발행 건수 초기화 실패: ${error.message}`);
  const saved = data?.find(row => row.key === key);
  if (!saved || saved.value !== "0") {
    throw new Error("일일 발행 건수 초기화 실패 — 권한/RLS로 반영된 행이 없습니다");
  }
}

export const NAVER_DAILY_LIMIT: Record<string, number> = {
  free: 5,
  basic: 10,
  pro: 20,
  business: 100,
  unlimited: 999999,
  admin: 9999,
};

/* ── 서이추 히스토리 조회 (관리자) ── */
export interface NeighborHistory {
  id: string;
  user_id: string;
  keyword: string;
  target_blog_id: string;
  target_url: string;
  status: "success" | "fail" | "skip";
  message: string;
  created_at: string;
}

export async function getNeighborHistory(userId: string): Promise<NeighborHistory[]> {
  try {
    const { data } = await supabase
      .from("publy_neighbor_history")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    return data || [];
  } catch { return []; }
}

export async function getAllNeighborHistory(): Promise<(NeighborHistory & { user_name?: string; user_email?: string })[]> {
  try {
    const { data } = await supabase
      .from("publy_neighbor_history")
      .select("*, publy_users(name, email)")
      .order("created_at", { ascending: false })
      .limit(500);
    return (data || []).map((d: Record<string, any>) => ({
      id: d.id,
      user_id: d.user_id,
      keyword: d.keyword,
      target_blog_id: d.target_blog_id,
      target_url: d.target_url,
      status: d.status,
      message: d.message,
      created_at: d.created_at,
      user_name: d.publy_users?.name,
      user_email: d.publy_users?.email,
    }));
  } catch { return []; }
}
export const NEIGHBOR_DAILY_LIMIT: Record<string, number> = {
  free: 10,
  basic: 50,
  pro: 100,
  unlimited: 999999,
  admin: 9999,
};

export const ENGAGE_DAILY_LIMIT: Record<string, number> = {
  free: 10,
  basic: 50,
  pro: 100,
  unlimited: 999999,
  admin: 9999,
};

function engageQuotaKey(userId: string): string {
  const today = koreaDateKey();
  return `engage_daily_${userId}_${today}`;
}

// ── 답방(내 글 댓글 답글) 일일 한도 ──
export const REPLY_DAILY_LIMIT: Record<string, number> = {
  free: 10, basic: 50, pro: 100, unlimited: 999999, admin: 9999,
};
function replyQuotaKey(userId: string): string {
  return `reply_daily_${userId}_${koreaDateKey()}`;
}
export async function getReplyDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", replyQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementReplyQuota(userId: string, by = 1): Promise<void> {
  const key = replyQuotaKey(userId);
  const used = await getReplyDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + by) }, { onConflict: "key" });
}

// ── 🔍 크롤링 발굴 일일 한도(자정 초기화 = 날짜별 키) ──
export const CRAWL_DAILY_LIMIT: Record<string, number> = {
  free: PLAN_CONFIG.free.dailyCrawl, basic: PLAN_CONFIG.basic.dailyCrawl, pro: PLAN_CONFIG.pro.dailyCrawl, unlimited: PLAN_CONFIG.unlimited.dailyCrawl, admin: PLAN_CONFIG.admin.dailyCrawl,
};
function crawlQuotaKey(userId: string): string {
  return `crawl_daily_${userId}_${koreaDateKey()}`;
}
export async function getCrawlDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", crawlQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementCrawlQuota(userId: string, by = 1): Promise<void> {
  const key = crawlQuotaKey(userId);
  const used = await getCrawlDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + by) }, { onConflict: "key" });
}

// ── ✉️ 아웃리치 이메일 발송 일일 한도(자정 초기화). 실제 발송 성공 수는 봇이 publy_outreach에 기록하지만,
//    게이지/사전차단용 카운터는 여기(publy_settings)에도 둔다(다른 탭과 동일 패턴, 자정 리셋). ──
export const EMAIL_DAILY_LIMIT: Record<string, number> = {
  free: PLAN_CONFIG.free.dailyEmail, basic: PLAN_CONFIG.basic.dailyEmail, pro: PLAN_CONFIG.pro.dailyEmail, unlimited: PLAN_CONFIG.unlimited.dailyEmail, admin: PLAN_CONFIG.admin.dailyEmail,
};
// 💬 댓글 하루 한도(계정 안전상 매우 낮게 — 도배 감지 위험)
export const COMMENT_DAILY_LIMIT: Record<string, number> = {
  free: PLAN_CONFIG.free.dailyComment, basic: PLAN_CONFIG.basic.dailyComment, pro: PLAN_CONFIG.pro.dailyComment, unlimited: PLAN_CONFIG.unlimited.dailyComment, admin: PLAN_CONFIG.admin.dailyComment,
};
// 🗺️ 플레이스 블로거 역추적 — 업체당 몇 명까지 긁어올지 등급 상한(무제한=∞). ★적당히 잡음, 나중에 조정 가능.
export const PLACE_BLOGGER_LIMIT: Record<string, number> = {
  free: 5, basic: 15, pro: 30, unlimited: 999999, admin: 999999,
};
function emailQuotaKey(userId: string): string {
  return `email_daily_${userId}_${koreaDateKey()}`;
}
export async function getEmailDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", emailQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementEmailQuota(userId: string, by = 1): Promise<void> {
  const key = emailQuotaKey(userId);
  const used = await getEmailDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + by) }, { onConflict: "key" });
}

// ── 블로그 진단(건강검진) 일일 한도 ── (무거운 크롤이라 횟수 적게)
export const BLOGSCORE_DAILY_LIMIT: Record<string, number> = {
  free: 1, basic: 5, pro: 20, unlimited: 999999, admin: 9999,
};
function blogscoreQuotaKey(userId: string): string {
  return `blogscore_daily_${userId}_${koreaDateKey()}`;
}
export async function getBlogscoreDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", blogscoreQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementBlogscoreQuota(userId: string): Promise<void> {
  const key = blogscoreQuotaKey(userId);
  const used = await getBlogscoreDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

// ── 품앗이(내 계정들끼리 상호 공감·댓글) 등급 한도 ──
//   계정 수 한도(등록 가능한 내 계정 개수) + 계정당 대상 글 수 한도.
export const PUMASI_ACCOUNT_LIMIT: Record<string, number> = {
  free: 2, basic: 3, pro: 5, unlimited: 999999, admin: 999999,   // 무제한(관리자)은 계정 수 한도 없음
};
export const PUMASI_POSTS_LIMIT: Record<string, number> = {
  free: 3, basic: 5, pro: 10, unlimited: 999999, admin: 999999,
};
// ── 단탭(서이추·공감댓글·답방·지수) 계정 연결 개수 한도 ──
//   각 탭이 계정을 따로 관리(완전 격리). 무료 1개 · 베이직 2 · 프로 3 · 무제한 ∞.
export const TAB_ACCOUNT_LIMIT: Record<string, number> = {
  free: 1, basic: 2, pro: 3, unlimited: 999999, admin: 999999,   // 무제한(관리자)은 무한
};
// 하루 품앗이로 남긴 공감·댓글 총 건수(사용량 게이지용) — 자정 자동 리셋
function pumasiQuotaKey(userId: string): string {
  return `pumasi_daily_${userId}_${koreaDateKey()}`;
}
export async function getPumasiDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", pumasiQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementPumasiQuota(userId: string, by = 1): Promise<void> {
  const key = pumasiQuotaKey(userId);
  const used = await getPumasiDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + by) }, { onConflict: "key" });
}

// ── 관리자용: 전체 회원의 "오늘" 기능별 사용량 한 번에 집계 ──
//    모든 사용량이 publy_settings의 `{기능}_daily_{userId}_{날짜}` 키로 저장되므로 오늘 날짜로 끝나는 키를 통째로 조회해 집계.
export interface DailyUsageRow { userId: string; publish: number; neighbor: number; engage: number; reply: number; blogscore: number; total: number; }
export async function getAllDailyUsageToday(): Promise<DailyUsageRow[]> {
  const today = koreaDateKey();
  const map: Record<string, DailyUsageRow> = {};
  const ensure = (uid: string) => (map[uid] ||= { userId: uid, publish: 0, neighbor: 0, engage: 0, reply: 0, blogscore: 0, total: 0 });
  try {
    const { data } = await supabase.from("publy_settings").select("key,value").like("key", `%_daily_%_${today}`);
    for (const row of (data || [])) {
      // key = `{feature}_daily_{userId}_{date}` — feature는 언더스코어 없음, date는 끝 10자
      const m = String(row.key).match(/^([a-z]+)_daily_(.+)_(\d{4}-\d{2}-\d{2})$/);
      if (!m) continue;
      const [, feature, uid] = m;
      if (!["publish", "neighbor", "engage", "reply", "blogscore"].includes(feature)) continue; // naver 등 기타 키 제외
      const val = parseInt(row.value) || 0;
      const r = ensure(uid);
      if (feature === "publish") r.publish += val;
      else if (feature === "neighbor") r.neighbor += val;
      else if (feature === "engage") r.engage += val;
      else if (feature === "reply") r.reply += val;
      else if (feature === "blogscore") r.blogscore += val;
    }
    for (const uid in map) map[uid].total = map[uid].publish + map[uid].neighbor + map[uid].engage + map[uid].reply + map[uid].blogscore;
  } catch { /* 조회 실패 시 빈 배열 */ }
  return Object.values(map).sort((a, b) => b.total - a.total);
}

export async function getEngageDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", engageQuotaKey(userId))
      .maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}

export async function incrementEngageQuota(userId: string): Promise<void> {
  const key = engageQuotaKey(userId);
  const used = await getEngageDailyUsage(userId);
  await supabase
    .from("publy_settings")
    .upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

function naverQuotaKey(userId: string): string {
  const today = koreaDateKey();
  return `naver_daily_${userId}_${today}`;
}

function neighborQuotaKey(userId: string): string {
  const today = koreaDateKey();
  return `neighbor_daily_${userId}_${today}`;
}

export async function getNaverDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", naverQuotaKey(userId))
      .maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}

export async function checkNaverQuota(userId: string, plan: string, hasPersonalKey: boolean): Promise<{ok: boolean; used: number; limit: number}> {
  if (hasPersonalKey) return { ok: true, used: 0, limit: 9999 };
  const limit = NAVER_DAILY_LIMIT[plan] ?? 5;
  const used = await getNaverDailyUsage(userId);
  return { ok: used < limit, used, limit };
}

export async function incrementNaverQuota(userId: string): Promise<void> {
  const key = naverQuotaKey(userId);
  const used = await getNaverDailyUsage(userId);
  await supabase
    .from("publy_settings")
    .upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

/* ── 서이추 일일 사용량 조회 ── */
export async function getNeighborDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", neighborQuotaKey(userId))
      .maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}

/* ── 서이추 쿼타 체크 ── */
export async function checkNeighborQuota(userId: string, plan: string): Promise<{ok: boolean; used: number; limit: number}> {
  const limit = NEIGHBOR_DAILY_LIMIT[plan] ?? NEIGHBOR_DAILY_LIMIT.free;
  const used = await getNeighborDailyUsage(userId);
  return { ok: used < limit, used, limit };
}

/* ── 서이추 쿼타 증가 ── */
export async function incrementNeighborQuota(userId: string): Promise<void> {
  const key = neighborQuotaKey(userId);
  const used = await getNeighborDailyUsage(userId);
  await supabase
    .from("publy_settings")
    .upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

// ── 이메일 찾기 ───────────────────────────────────────────
export async function findEmailByNamePhone(name: string, phone: string): Promise<string | null> {
  const { data } = await supabase
    .from("publy_users")
    .select("email")
    .eq("name", name.trim())
    .eq("phone", phone.trim())
    .maybeSingle();
  return data?.email || null;
}

// ── 임시 비밀번호 발급 ────────────────────────────────────
export async function resetPasswordTemp(email: string, name: string, phone: string): Promise<string> {
  const { data, error } = await supabase.rpc("publy_recover_password", {
    p_email: email.trim(), p_name: name.trim(), p_phone: phone.trim(),
  });
  if (error?.message?.includes("TRY_LATER")) throw new Error("시도가 너무 많습니다. 15분 후 다시 시도해주세요");
  if (error || !data) throw new Error("입력한 회원 정보가 일치하지 않습니다");
  return data as string;
}

// ── 회원 개인키만 조회 (관리자 폴백 없음, UI 표시용) ──────
export async function getUserNaverApiKeys(userId: string): Promise<NaverApiKeys> {
  const names = ["naver_access_license","naver_secret_key","naver_customer_id","naver_datalab_client_id","naver_datalab_client_secret"];
  const result: NaverApiKeys = {};
  for (const k of names) {
    const { data } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", `user_${userId}_${k}`)
      .maybeSingle();
    if (data?.value) (result as any)[k] = data.value;
  }
  return result;
}

// ── 래퍼럴 조회 ─────────────────────────────────────────
export async function getReferrals(): Promise<{referrer: PublyUser; referred: PublyUser[]}[]> {
  const { data: users } = await supabase
    .from("publy_users")
    .select("id, email, name, plan, app_type, is_active, created_at, referred_by")
    .order("created_at", { ascending: true });
  if (!users) return [];
  const referred = users.filter(u => u.referred_by);
  const referrerIds = [...new Set(referred.map(u => u.referred_by))];
  return referrerIds.map(rid => ({
    referrer: users.find(u => u.id === rid) as PublyUser,
    referred: referred.filter(u => u.referred_by === rid) as PublyUser[],
  })).filter(r => r.referrer);
}

export async function logError(params: {
  user_id: string;
  user_name?: string;
  user_email?: string;
  feature: string;
  error_message: string;
}) {
  try {
    await supabase.from("publy_error_logs").insert({
      user_id: params.user_id,
      user_name: params.user_name || "",
      user_email: params.user_email || "",
      feature: params.feature,
      error_message: params.error_message,
    });
  } catch {}
}

/* ══════════ 📡 실시간 라이브 로그 — 회원이 신고 안 해도 관리자가 회원 검색해 현재 진행 로그를 봄 ══════════
   회원당 1행(user_id PK)에 '현재 진행 중인 작업 로그' 스냅샷을 담는다(누적 아님, 최신). 새 작업이 이전을 덮음.
   회원 앱은 로그가 바뀔 때 throttle로 upsert(과도한 쓰기 방지). 관리자는 폴링으로 실시간 조회. */
export interface LiveLogRow { user_id: string; user_name?: string; user_email?: string; context: string; log_text: string; is_running: boolean; updated_at: string; }

const _liveLogState: { userId?: string; name?: string; email?: string; context?: string; text?: string; running?: boolean; timer?: any; pending?: boolean; last?: number } = {};
// 회원 앱에서 호출: 현재 로그 스냅샷을 서버로(2초 throttle). 마지막 상태는 반드시 반영(trailing).
export function pushLiveLog(userId: string, opts: { name?: string; email?: string; context: string; text: string; running: boolean }) {
  if (!userId) return;
  _liveLogState.userId = userId; _liveLogState.name = opts.name; _liveLogState.email = opts.email;
  _liveLogState.context = opts.context; _liveLogState.text = opts.text; _liveLogState.running = opts.running;
  const flush = async () => {
    _liveLogState.pending = false; _liveLogState.last = Date.now();
    try {
      await supabase.from("publy_live_logs").upsert({
        user_id: _liveLogState.userId, user_name: _liveLogState.name || "", user_email: _liveLogState.email || "",
        context: _liveLogState.context || "", log_text: (_liveLogState.text || "").slice(-8000),   // 최근 8KB만
        is_running: !!_liveLogState.running, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    } catch {}
  };
  const since = Date.now() - (_liveLogState.last || 0);
  if (since >= 2000) { void flush(); }              // 2초 지났으면 즉시
  else if (!_liveLogState.pending) {                // 아니면 trailing 1회 예약
    _liveLogState.pending = true;
    clearTimeout(_liveLogState.timer);
    _liveLogState.timer = setTimeout(flush, 2000 - since);
  }
}

// 관리자: 특정 회원의 현재 라이브 로그 1건 조회.
export async function getLiveLog(userId: string): Promise<LiveLogRow | null> {
  const { data } = await supabase.from("publy_live_logs").select("*").eq("user_id", userId).maybeSingle();
  return (data as LiveLogRow) || null;
}

// 관리자: 지금 작업 중인(is_running) 회원들의 로그 목록(최근 갱신순).
export async function getRunningLiveLogs(): Promise<LiveLogRow[]> {
  const { data } = await supabase.from("publy_live_logs").select("*").order("updated_at", { ascending: false }).limit(200);
  return (data || []) as LiveLogRow[];
}

export async function getErrorLogs(userId?: string) {
  let query = supabase.from("publy_error_logs").select("*").order("created_at", { ascending: false }).limit(100);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw new Error(`오류 로그 조회 실패: ${error.message}`);
  return (data || []) as {id:string;user_id:string;user_name:string;user_email:string;feature:string;error_message:string;created_at:string;is_read:boolean}[];
}

export async function getUnreadErrorCount(): Promise<number> {
  const { count } = await supabase.from("publy_error_logs").select("*", { count: "exact", head: true }).eq("is_read", false);
  return count || 0;
}

export async function markErrorsAsRead(ids?: string[]) {
  let query = supabase.from("publy_error_logs").update({ is_read: true });
  if (ids?.length) query = query.in("id", ids);
  else query = query.eq("is_read", false);
  await query;
}

/* ── 공감·댓글 히스토리 ── */
export interface EngageHistory {
  id: string;
  user_id: string;
  keyword: string;
  target_blog_id: string;
  post_url: string;
  liked: boolean;
  commented: boolean;
  status: "success" | "fail" | "skip";
  message: string;
  created_at: string;
}

export async function addEngageHistory(params: {
  user_id: string;
  keyword: string;
  target_blog_id: string;
  post_url: string;
  liked: boolean;
  commented: boolean;
  status: "success" | "fail" | "skip";
  message: string;
}) {
  try {
    await supabase.from("publy_engage_history").insert([params]);
  } catch {}
}

export async function getEngageHistory(userId: string): Promise<EngageHistory[]> {
  try {
    const { data } = await supabase
      .from("publy_engage_history")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    return data || [];
  } catch { return []; }
}

// ── 답방 이력 (관리자) ──
export interface ReplyHistory { id: string; user_id: string; post_title: string; status: "success"|"fail"|"skip"; message: string; created_at: string; }
export async function getAllReplyHistory(): Promise<(ReplyHistory & { user_name?: string; user_email?: string })[]> {
  try {
    const { data } = await supabase.from("publy_reply_history").select("*, publy_users(name, email)").order("created_at", { ascending: false }).limit(500);
    return (data || []).map((d: Record<string, any>) => ({ id: d.id, user_id: d.user_id, post_title: d.post_title, status: d.status, message: d.message, created_at: d.created_at, user_name: d.publy_users?.name, user_email: d.publy_users?.email }));
  } catch { return []; }
}

// ── 블로그지수 진단 이력 (관리자) ──
export interface BlogscoreHistory { id: string; user_id: string; blog_id: string; total_posts: number; neighbors: number; low_quality_suspected: boolean|null; created_at: string; }
export async function getAllBlogscoreHistory(): Promise<(BlogscoreHistory & { user_name?: string; user_email?: string })[]> {
  try {
    const { data } = await supabase.from("publy_blogscore_history").select("*, publy_users(name, email)").order("created_at", { ascending: false }).limit(500);
    return (data || []).map((d: Record<string, any>) => ({ id: d.id, user_id: d.user_id, blog_id: d.blog_id, total_posts: d.total_posts, neighbors: d.neighbors, low_quality_suspected: d.low_quality_suspected, created_at: d.created_at, user_name: d.publy_users?.name, user_email: d.publy_users?.email }));
  } catch { return []; }
}

export async function getAllEngageHistory(): Promise<(EngageHistory & { user_name?: string; user_email?: string })[]> {
  try {
    const { data } = await supabase
      .from("publy_engage_history")
      .select("*, publy_users(name, email)")
      .order("created_at", { ascending: false })
      .limit(500);
    return (data || []).map((d: Record<string, any>) => ({
      id: d.id,
      user_id: d.user_id,
      keyword: d.keyword,
      target_blog_id: d.target_blog_id,
      post_url: d.post_url,
      liked: d.liked,
      commented: d.commented,
      status: d.status,
      message: d.message,
      created_at: d.created_at,
      user_name: d.publy_users?.name,
      user_email: d.publy_users?.email,
    }));
  } catch { return []; }
}

// ── 인스타 DM ────────────────────────────────────────────

export interface InstaDmTarget {
  id: string;
  user_id: string;
  username: string;
  followers: number;
  bio: string;
  keywords: string;
  status: "pending" | "sent" | "fail" | "skip";
  instagram_account: string;
  created_at: string;
}

export interface InstaDmHistory {
  id: string;
  user_id: string;
  target_username: string;
  message: string;
  instagram_account: string;
  status: "sent" | "fail";
  created_at: string;
}

export interface InstaDmQuota {
  id: string;
  user_id: string;
  daily_limit: number;
  used_today: number;
  is_enabled: boolean;
  reset_date: string;
}

export const INSTA_DM_DAILY_LIMIT: Record<string, number> = {
  free: 5,
  basic: 10,
  pro: 30,
  unlimited: 999999,
  admin: 9999,
};

export async function getInstaDmTargets(userId: string): Promise<InstaDmTarget[]> {
  try {
    const { data } = await supabase
      .from("insta_dm_targets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300);
    return data || [];
  } catch { return []; }
}

export async function addInstaDmTarget(params: Omit<InstaDmTarget, "id" | "created_at">) {
  try {
    await supabase.from("insta_dm_targets").insert([params]);
  } catch {}
}

export async function updateInstaDmTargetStatus(id: string, status: InstaDmTarget["status"]) {
  try {
    await supabase.from("insta_dm_targets").update({ status }).eq("id", id);
  } catch {}
}

export async function deleteInstaDmTarget(id: string) {
  try {
    await supabase.from("insta_dm_targets").delete().eq("id", id);
  } catch {}
}

export async function getInstaDmHistory(userId: string): Promise<InstaDmHistory[]> {
  try {
    const { data } = await supabase
      .from("insta_dm_history")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    return data || [];
  } catch { return []; }
}

export async function addInstaDmHistory(params: Omit<InstaDmHistory, "id" | "created_at">) {
  try {
    await supabase.from("insta_dm_history").insert([params]);
  } catch {}
}

export async function getAllInstaDmHistory(): Promise<(InstaDmHistory & { user_name?: string; user_email?: string })[]> {
  try {
    const { data } = await supabase
      .from("insta_dm_history")
      .select("*, publy_users(name, email)")
      .order("created_at", { ascending: false })
      .limit(500);
    return (data || []).map((d: Record<string, any>) => ({
      id: d.id,
      user_id: d.user_id,
      target_username: d.target_username,
      message: d.message,
      instagram_account: d.instagram_account,
      status: d.status,
      created_at: d.created_at,
      user_name: d.publy_users?.name,
      user_email: d.publy_users?.email,
    }));
  } catch { return []; }
}

export async function getInstaDmQuota(userId: string): Promise<InstaDmQuota | null> {
  try {
    const today = koreaDateKey();
    const { data } = await supabase
      .from("insta_dm_quota")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (!data) return null;
    if (data.reset_date !== today) {
      await supabase.from("insta_dm_quota").update({ used_today: 0, reset_date: today }).eq("user_id", userId);
      return { ...data, used_today: 0, reset_date: today };
    }
    return data;
  } catch { return null; }
}

export async function upsertInstaDmQuota(userId: string, params: Partial<InstaDmQuota>) {
  try {
    const today = koreaDateKey();
    await supabase.from("insta_dm_quota").upsert([{ user_id: userId, reset_date: today, ...params }], { onConflict: "user_id" });
  } catch {}
}

export async function incrementInstaDmUsage(userId: string) {
  try {
    const quota = await getInstaDmQuota(userId);
    if (!quota) return;
    await supabase.from("insta_dm_quota").update({ used_today: (quota.used_today || 0) + 1 }).eq("user_id", userId);
  } catch {}
}

export async function getAllInstaDmQuotas(): Promise<(InstaDmQuota & { user_name?: string; user_email?: string; plan?: string })[]> {
  try {
    const { data } = await supabase
      .from("insta_dm_quota")
      .select("*, publy_users(name, email, plan)")
      .order("created_at", { ascending: false });
    return (data || []).map((d: Record<string, any>): any => ({
      ...d,
      user_name: d.publy_users?.name,
      user_email: d.publy_users?.email,
      plan: d.publy_users?.plan,
    }));
  } catch { return []; }
}

// ── 버그 신고 ──
export interface PublyBugReport {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  app_version?: string;
  memo?: string;
  log_text?: string;
  status?: "open" | "resolved";
  admin_reply?: string;
  user_notified?: boolean;
  created_at: string;
}

export async function submitBugReportRow(row: {
  user_id: string; user_name?: string; user_email?: string;
  app_version?: string; memo?: string; log_text?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("publy_bug_reports").insert({ ...row, status: "open" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getBugReports(): Promise<PublyBugReport[]> {
  const { data } = await supabase
    .from("publy_bug_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  return (data || []) as PublyBugReport[];
}

// 관리자: 처리완료 시 답변 저장 + user_notified=false 로 초기화(회원이 팝업 받도록). 미처리 전환은 그대로.
export async function updateBugReportStatus(id: string, status: "open" | "resolved", adminReply?: string) {
  const patch: Record<string, any> = { status };
  if (status === "resolved") { patch.user_notified = false; patch.admin_reply = (adminReply || "").trim() || null; }
  await supabase.from("publy_bug_reports").update(patch).eq("id", id);
}

export async function deleteBugReport(id: string) {
  await supabase.from("publy_bug_reports").delete().eq("id", id);
}

// 회원: 내가 신고한 것 중 "처리완료 됐고 아직 팝업으로 안 본" 건 (팝업 알림용)
export async function getMyResolvedBugAlerts(userId: string): Promise<PublyBugReport[]> {
  try {
    const { data } = await supabase
      .from("publy_bug_reports")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "resolved")
      .eq("user_notified", false)
      .order("created_at", { ascending: false });
    return (data || []) as PublyBugReport[];
  } catch { return []; }
}

// 회원이 팝업 "확인" 누르면 다시 안 뜨게 표시
export async function markBugNotified(id: string) {
  try { await supabase.from("publy_bug_reports").update({ user_notified: true }).eq("id", id); } catch {}
}

/* ── 프록시(계정별 IP) 관리 (관리자 전용) ──
   계정이 많으면 같은 IP로 나가 네이버가 한 사람으로 묶어 차단한다.
   IP(프록시)를 등록하고, 각 IP에 계정들을 배정한다(1 IP에 여러 계정 가능). */
export interface PublyProxy {
  id: string;
  label?: string | null;
  server: string;            // 주소:포트 (예: 1.2.3.4:8000)
  username?: string | null;
  password?: string | null;
  region?: string | null;
  active?: boolean;
  last_ok?: boolean | null;
  last_ip?: string | null;
  last_ms?: number | null;
  last_checked_at?: string | null;
  created_at?: string;
}

export async function getProxies(): Promise<PublyProxy[]> {
  try {
    const { data } = await supabase.from("publy_proxies").select("*").order("created_at", { ascending: true });
    return (data || []) as PublyProxy[];
  } catch { return []; }
}

export async function addProxy(p: { label?: string; server: string; username?: string; password?: string; region?: string }): Promise<PublyProxy | null> {
  try {
    const { data, error } = await supabase.from("publy_proxies")
      .insert({ label: (p.label || "").trim() || null, server: p.server.trim(), username: (p.username || "").replace(/[\s]+/g, "") || null, password: (p.password || "").trim() || null, region: p.region || "KR", active: true })
      .select("*").single();
    if (error) { alert("프록시 추가 실패: " + error.message); return null; }
    return data as PublyProxy;
  } catch (e: any) { alert("프록시 추가 오류: " + (e?.message || e)); return null; }
}

export async function updateProxy(id: string, p: Partial<PublyProxy>): Promise<void> {
  const { error } = await supabase.from("publy_proxies").update(p).eq("id", id);
  if (error) alert("프록시 수정 실패: " + error.message);
}

export async function deleteProxy(id: string): Promise<void> {
  const { error } = await supabase.from("publy_proxies").delete().eq("id", id);
  if (error) alert("프록시 삭제 실패: " + error.message);
}

// 프록시가 적용될 기능 4종(관리자가 계정별로 on/off)
export const PROXY_FEATURES = [
  { k: "neighbor", l: "서이추" },
  { k: "engage",   l: "공감·댓글" },
  { k: "pumasi",   l: "품앗이" },
  { k: "reply",    l: "답방" },
  { k: "crawl",    l: "크롤링" },
] as const;
export const ALL_PROXY_FEATURES = PROXY_FEATURES.map(f => f.k) as string[];

export interface ProxyAssign { userId: string; features: string[] }
// 프록시별 배정 계정 목록 조회: { proxyId: [{userId, features}, ...] }
export async function getProxyAssignments(): Promise<Record<string, ProxyAssign[]>> {
  try {
    const { data } = await supabase.from("publy_account_proxy").select("user_id, proxy_id, features");
    const map: Record<string, ProxyAssign[]> = {};
    (data || []).forEach((r: any) => { if (r.proxy_id) { (map[r.proxy_id] ||= []).push({ userId: r.user_id, features: Array.isArray(r.features) ? r.features : ALL_PROXY_FEATURES }); } });
    return map;
  } catch { return {}; }
}

// 한 프록시에 계정 목록을 통째로 설정(기존 배정 교체). 다른 프록시에 있던 계정은 이 프록시로 이동.
export async function setProxyAccounts(proxyId: string, userIds: string[]): Promise<void> {
  try {
    // 이 프록시에 기존 배정된 계정 클리어
    await supabase.from("publy_account_proxy").delete().eq("proxy_id", proxyId);
    const rows = userIds.map(u => u.trim()).filter(Boolean).map(user_id => ({ user_id, proxy_id: proxyId, updated_at: new Date().toISOString() }));
    if (rows.length) {
      const { error } = await supabase.from("publy_account_proxy").upsert(rows, { onConflict: "user_id" });
      if (error) alert("계정 배정 실패: " + error.message);
    }
  } catch (e: any) { alert("계정 배정 오류: " + (e?.message || e)); }
}

// 계정 하나를 특정 프록시에 배정(체크). user_id가 PK라 다른 IP에 있었으면 이 IP로 자동 이동(중복 방지).
// features 미지정이면 4개 기능 전체 ON으로 시작(관리자가 이후 개별 토글).
export async function assignAccountToProxy(userId: string, proxyId: string, features: string[] = ALL_PROXY_FEATURES): Promise<void> {
  const { error } = await supabase.from("publy_account_proxy")
    .upsert({ user_id: userId, proxy_id: proxyId, features, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) alert("계정 배정 실패: " + error.message);
}

// 배정된 계정이 프록시를 쓸 기능만 변경(서이추/공감/품앗이/답방 개별 토글).
export async function setAccountFeatures(userId: string, features: string[]): Promise<void> {
  const { error } = await supabase.from("publy_account_proxy").update({ features, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (error) alert("기능 설정 실패: " + error.message);
}

// 계정의 프록시 배정 해제(체크 해제) → 그 계정은 다시 내 IP로 접속.
export async function unassignAccount(userId: string): Promise<void> {
  const { error } = await supabase.from("publy_account_proxy").delete().eq("user_id", userId);
  if (error) alert("배정 해제 실패: " + error.message);
}

// 봇 헬스체크 API 호출 + 결과를 DB에 저장. bot = neighbor-bot 주소(기본 3334).
// ★botFetch를 써야 한다: 봇은 모든 요청에 Authorization: Bearer 토큰을 요구(없으면 401 Unauthorized).
export async function checkProxyHealth(bot: string, p: PublyProxy): Promise<{ ok: boolean; ip?: string; ms?: number; error?: string }> {
  try {
    const r = await botFetch(`${bot}/api/proxy-check`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server: p.server, username: p.username, password: p.password }),
    });
    const j = await r.json();
    await updateProxy(p.id, { last_ok: !!j.ok, last_ip: j.ip || null, last_ms: j.ms ?? null, last_checked_at: new Date().toISOString() });
    return j;
  } catch (e: any) {
    const err = e?.message || "봇 연결 실패(봇이 꺼져 있으면 확인 불가)";
    await updateProxy(p.id, { last_ok: false, last_checked_at: new Date().toISOString() });
    return { ok: false, error: err };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🩺 블로그 주치의 — 글별 진료차트(publy_post_care)
// 검사할 때마다 순위를 기록하고, 개선안·제목수정·완치 날짜를 저장해
// "언제 손봤는지"를 기억한다(무한루프 차단 + 멘토 지휘의 근거).
// ★ 제목 자동변경 실행 로직은 건드리지 않음 — 성공 후 날짜만 여기 기록.
// ═══════════════════════════════════════════════════════════════════
export interface PostCare {
  id?: string;
  user_id: string;
  account: string | null;
  post_key: string;                 // 글 고유번호(logNo)
  title?: string | null;
  published_at?: string | null;     // YYYY-MM-DD
  rank_history: { date: string; rank: number | null }[];
  prescribed_at?: string | null;    // 개선안 받은 시각
  title_changed_at?: string | null; // 제목 수정한 시각
  cured_at?: string | null;         // 완치(노출) 시각
  view_history?: { date: string; views: number }[] | null;   // 🩺 P4: 글별 조회수 일별 누적(통계 rank_pv에서 수집)
}
// 완치 기준: 100위 안에 노출되면 완치. / 경과관찰: 제목 수정 후 30일은 "기다리세요"(리서치 근거).
export const CURE_RANK = 100;
export const OBSERVE_DAYS = 30;

// 검사 결과 저장 — 각 글의 오늘 순위를 rank_history에 누적(같은 날 재검사면 갱신).
// 100위 내면 cured_at을 채우고, '이번에 새로 완치된 글'을 반환(→ 축포 세리머니).
export async function savePostCareChecks(
  userId: string,
  account: string,
  checks: { logNo?: string; title: string; rank: number | null; exposed: boolean | null; date?: string }[],
): Promise<{ newlyCured: PostCare[] }> {
  const today = koreaDateKey();
  const items = checks.filter(c => c.logNo);   // 번호 있는 글만(제목만으론 식별 불안정)
  if (!items.length) return { newlyCured: [] };
  const keys = items.map(c => c.logNo!) as string[];
  const { data: existing } = await supabase
    .from("publy_post_care").select("*")
    .eq("user_id", userId).eq("account", account).in("post_key", keys);
  const byKey: Record<string, any> = {};
  (existing || []).forEach((r: any) => { byKey[r.post_key] = r; });
  const newlyCured: PostCare[] = [];
  const rows = items.map(c => {
    const prev = byKey[c.logNo!];
    const hist = ((prev?.rank_history as { date: string; rank: number | null }[]) || []).filter(h => h.date !== today);
    hist.push({ date: today, rank: c.rank });
    const exposed = c.exposed === true || (c.rank != null && c.rank <= CURE_RANK);
    let cured_at = prev?.cured_at || null;
    const row: any = {
      user_id: userId, account, post_key: c.logNo,
      title: c.title, rank_history: hist,
      published_at: c.date || prev?.published_at || null,
      updated_at: new Date().toISOString(),
    };
    if (exposed && !cured_at) { cured_at = new Date().toISOString(); newlyCured.push({ ...row, cured_at }); }
    row.cured_at = cured_at;
    return row;
  });
  const { error } = await supabase.from("publy_post_care").upsert(rows, { onConflict: "user_id,account,post_key" });
  if (error) console.warn("[post_care] 저장 실패:", error.message);
  return { newlyCured };
}

export async function getPostCare(userId: string, account: string): Promise<PostCare[]> {
  const { data } = await supabase.from("publy_post_care").select("*").eq("user_id", userId).eq("account", account);
  return (data as PostCare[]) || [];
}

// 🩺 P4: 글별 조회수를 진료차트에 누적(같은 날 재수집이면 갱신). 이미 카르테가 있는 글(logNo 매칭)만 update.
export async function savePostViews(
  userId: string, account: string,
  views: { logNo?: string | null; views: number }[],
): Promise<void> {
  const today = koreaDateKey();
  const items = views.filter(v => v.logNo);
  if (!items.length) return;
  const keys = items.map(v => v.logNo!) as string[];
  const { data: existing } = await supabase
    .from("publy_post_care").select("post_key, view_history")
    .eq("user_id", userId).eq("account", account).in("post_key", keys);
  const byKey: Record<string, any> = {};
  (existing || []).forEach((r: any) => { byKey[r.post_key] = r; });
  // 카르테가 이미 있는 글만(신규 insert는 rank_history 제약 때문에 피함 — 순위검사로 먼저 등록됨)
  const rows = items.filter(v => byKey[v.logNo!]).map(v => {
    const prev = byKey[v.logNo!];
    const hist = ((prev?.view_history as { date: string; views: number }[]) || []).filter(h => h.date !== today);
    hist.push({ date: today, views: v.views });
    return { user_id: userId, account, post_key: v.logNo, view_history: hist, updated_at: new Date().toISOString() };
  });
  if (!rows.length) return;
  const { error } = await supabase.from("publy_post_care").upsert(rows, { onConflict: "user_id,account,post_key" });
  if (error) console.warn("[post_care] 조회수 저장 실패:", error.message);
}

// 글의 최신 조회수(가장 최근 기록). 없으면 null.
export function latestViews(c: PostCare): number | null {
  const h = c.view_history; if (!h || !h.length) return null;
  return h[h.length - 1].views ?? null;
}

// 🔴 오류를 관리자에게 중앙 전송 — 기존 오류로그 시스템(publy_error_logs)을 재사용하는 얇은 래퍼.
//    블로그지수 파이프라인(순위검사·조회수·진단)이 실패하면 관리자 '버그 신고/오류' 화면에 빨간 항목으로 뜬다.
//    수천 명이 써도 관리자가 한곳에서 어디서 뻑나는지 바로 인지. (리포트 자체가 에러 내도 logError가 삼킴)
export async function reportError(info: { userId?: string | null; blogId?: string | null; stage: string; message: string; detail?: string }): Promise<void> {
  await logError({
    user_id: info.userId || "",
    feature: `블로그지수·${info.stage}`,
    error_message: `${info.message || ""}${info.blogId ? ` [blogId=${info.blogId}]` : ""}${info.detail ? ` (${info.detail})` : ""}`.slice(0, 500),
  });
}

// 개선안 받은 날 기록
export async function markPrescribed(userId: string, account: string, postKey: string): Promise<void> {
  const { error } = await supabase.from("publy_post_care").upsert(
    { user_id: userId, account, post_key: postKey, prescribed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "user_id,account,post_key" });
  if (error) console.warn("[post_care] 처방 기록 실패:", error.message);
}

// 제목 수정한 날 기록(자동 변경 실행과 별개 — 성공 후 호출)
export async function markTitleChanged(userId: string, account: string, postKey: string, newTitle?: string): Promise<void> {
  const patch: any = { user_id: userId, account, post_key: postKey, title_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (newTitle) patch.title = newTitle;
  const { error } = await supabase.from("publy_post_care").upsert(patch, { onConflict: "user_id,account,post_key" });
  if (error) console.warn("[post_care] 수정 기록 실패:", error.message);
}

// 글의 현재 생애 상태를 날짜로 계산(단일 소스 — 상태를 저장하지 않음).
export type CareStatus = "new" | "needs" | "prescribed" | "observing" | "relapse" | "cured";
export function computeCareStatus(c: PostCare): { status: CareStatus; daysLeft?: number; daysUnexposed?: number } {
  const last = c.rank_history?.[c.rank_history.length - 1];
  const exposed = c.cured_at || (last && last.rank != null && last.rank <= CURE_RANK);
  if (exposed) return { status: "cured" };
  if (c.title_changed_at) {
    const days = Math.floor((Date.now() - new Date(c.title_changed_at).getTime()) / 86400000);
    if (days < OBSERVE_DAYS) return { status: "observing", daysLeft: OBSERVE_DAYS - days };
    return { status: "relapse", daysUnexposed: days };
  }
  if (c.prescribed_at) return { status: "prescribed" };
  if (c.rank_history?.length) return { status: "needs" };
  return { status: "new" };
}
