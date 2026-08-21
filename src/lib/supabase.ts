import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// ── 인증 ─────────────────────────────────────────────────
export async function signUp(email: string, password: string, name: string, phone?: string, referredBy?: string) {
  const hash = await bcrypt.hash(password, 10);
  const insertData: any = { email, password_hash: hash, name };
  if (phone) insertData.phone = phone;
  if (referredBy) insertData.referred_by = referredBy;

  const { data: user, error } = await supabase
    .from("publy_users")
    .insert(insertData)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // 기본 쿼터 생성 (FREE 7일 체험)
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + PLAN_CONFIG.free.trialDays);
  await supabase.from("publy_quotas").insert({
    user_id: user.id,
    total_quota: PLAN_CONFIG.free.dailyPublish,
    used_quota: 0,
    reset_date: trialEnd.toISOString(),
  });

  return user;
}

export async function signIn(email: string, password: string) {

  const { data: user } = await supabase
    .from("publy_users")
    .select("*")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (!user) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다");

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다");

  return user as PublyUser;
}

// 마지막 접속 시각 기록(앱 켜짐/사용 중). 관리자가 "누가 언제 마지막에 썼는지" 확인용.
//   컬럼이 아직 없으면 조용히 무시(마이그레이션 전에도 앱이 죽지 않게).
export async function touchLastSeen(userId: string): Promise<void> {
  try { await supabase.from("publy_users").update({ last_seen: new Date().toISOString() }).eq("id", userId); } catch {}
}

// 최신 회원정보(등급/활성 등)를 id로 다시 읽는다. 관리자가 등급을 바꾸면 회원 앱이 실시간으로 반영하기 위함.
export async function refreshUserById(userId: string): Promise<PublyUser | null> {
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

  await supabase
    .from("publy_quotas")
    .update({ used_quota: quota.used_quota + 1 })
    .eq("user_id", userId);

  return true;
}

// ── 히스토리 ─────────────────────────────────────────────
export async function addHistory(data: Omit<PublyHistory, "id" | "published_at">) {
  const { error } = await supabase.from("publy_history").insert(data);
  if (error) throw new Error(error.message);
}

export async function getHistory(userId: string): Promise<PublyHistory[]> {
  const { data } = await supabase
    .from("publy_history")
    .select("*")
    .eq("user_id", userId)
    .order("published_at", { ascending: false })
    .limit(100);
  return data || [];
}

export async function deleteHistory(id: string): Promise<void> {
  await supabase.from("publy_history").delete().eq("id", id);
}

export async function deleteAllHistory(userId: string): Promise<void> {
  await supabase.from("publy_history").delete().eq("user_id", userId);
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
  const { data, error } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", "admin_pw_hash")
      .maybeSingle();
  if (error) throw new Error("관리자 인증 설정을 확인할 수 없습니다");
  if (!data?.value) throw new Error("초기 비밀번호 설정 필요");
  return await bcrypt.compare(pw, data.value);
}

export async function setAdminPassword(newPw: string): Promise<void> {
  const hash = await bcrypt.hash(newPw, 10);
  const { error } = await supabase
    .from("publy_settings")
    .upsert({ key: "admin_pw_hash", value: hash }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  localStorage.removeItem("publy_admin_pw");
}

// ── 일반 회원 비밀번호 변경 ───────────────────────────────
export async function changeUserPassword(userId: string, currentPw: string, newPw: string): Promise<void> {
  const { data: user } = await supabase
    .from("publy_users")
    .select("password_hash")
    .eq("id", userId)
    .maybeSingle();
  if (!user) throw new Error("사용자를 찾을 수 없습니다");
  const match = await bcrypt.compare(currentPw, user.password_hash);
  if (!match) throw new Error("현재 비밀번호가 올바르지 않습니다");
  const newHash = await bcrypt.hash(newPw, 10);
  const { error } = await supabase
    .from("publy_users")
    .update({ password_hash: newHash })
    .eq("id", userId);
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
  trialDays: number;
}> = {
  free:  { label: "FREE",  maxAccounts: 1, dailyPublish: 2,  trialDays: 7  },
  basic: { label: "BASIC", maxAccounts: 2, dailyPublish: 6,  trialDays: 30 },
  pro:   { label: "PRO",   maxAccounts: 3, dailyPublish: 15, trialDays: 30 },
  unlimited: { label: "무제한", maxAccounts: 999, dailyPublish: 999999, trialDays: 99999 },
  admin: { label: "ADMIN", maxAccounts: 99, dailyPublish: 9999, trialDays: 9999 },
};

function publishQuotaKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
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
  try {
    await supabase
      .from("publy_settings")
      .upsert({ key: publishQuotaKey(userId), value: "0" }, { onConflict: "key" });
  } catch {}
}

export const NAVER_DAILY_LIMIT: Record<string, number> = {
  free: 5,
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
  const today = new Date().toISOString().slice(0, 10);
  return `engage_daily_${userId}_${today}`;
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
  const today = new Date().toISOString().slice(0, 10);
  return `naver_daily_${userId}_${today}`;
}

function neighborQuotaKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
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
export async function resetPasswordTemp(email: string): Promise<string> {
  const { data: user } = await supabase
    .from("publy_users")
    .select("id")
    .eq("email", email.trim())
    .maybeSingle();
  if (!user) throw new Error("가입된 이메일이 없습니다");
  // 임시 비번: 영문+숫자 8자
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const tempPw = Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const hash = await bcrypt.hash(tempPw, 10);
  const { error } = await supabase.from("publy_users").update({ password_hash: hash }).eq("id", user.id);
  if (error) throw new Error(error.message);
  return tempPw;
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

export async function getErrorLogs(userId?: string) {
  let query = supabase.from("publy_error_logs").select("*").order("created_at", { ascending: false }).limit(100);
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query;
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
    const today = new Date().toISOString().slice(0, 10);
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
    const today = new Date().toISOString().slice(0, 10);
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
