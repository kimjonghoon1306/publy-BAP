import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// Node 20 등 native WebSocket 없는 런타임 폴리필 (Supabase Realtime 초기화 크래시 방지)
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── 등급별 서이추 일일 한도 (프론트 src/lib/supabase.ts와 동일하게 유지!) ── */
//  ★unlimited 누락 주의: 이 키가 없으면 무제한 회원이 free(10)로 폴백돼 "오늘 한도(10명) 모두 사용"으로 막힌다(실측 버그).
export const NEIGHBOR_DAILY_LIMIT: Record<string, number> = {
  free: 10,
  basic: 50,
  pro: 100,
  unlimited: 999999,
  admin: 9999,
};

function neighborQuotaKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `neighbor_daily_${userId}_${today}`;
}

/* ── 서이추 히스토리 저장 ── */
export async function addNeighborHistory(data: {
  user_id: string;
  keyword: string;
  target_blog_id: string;
  status: "success" | "fail" | "skip";
  message: string;
}): Promise<void> {
  try {
    await supabase.from("publy_neighbor_history").insert({
      user_id: data.user_id,
      keyword: data.keyword,
      target_blog_id: data.target_blog_id,
      target_url: `https://blog.naver.com/${data.target_blog_id}`,
      status: data.status,
      message: data.message,
    });
  } catch (e) {
    console.error("[neighbor] 히스토리 저장 오류:", e);
  }
}

// 답방 이력 저장
export async function addReplyHistory(data: {
  user_id: string;
  post_title: string;
  status: "success" | "fail" | "skip";
  message: string;
}): Promise<void> {
  try {
    await supabase.from("publy_reply_history").insert({
      user_id: data.user_id,
      post_title: data.post_title,
      status: data.status,
      message: data.message,
    });
  } catch (e) {
    console.error("[reply] 히스토리 저장 오류:", e);
  }
}

// 블로그지수 진단 이력 저장
export async function addBlogscoreHistory(data: {
  user_id: string;
  blog_id: string;
  total_posts: number;
  neighbors: number;
  low_quality_suspected: boolean | null;
}): Promise<void> {
  try {
    await supabase.from("publy_blogscore_history").insert({
      user_id: data.user_id,
      blog_id: data.blog_id,
      total_posts: data.total_posts,
      neighbors: data.neighbors,
      low_quality_suspected: data.low_quality_suspected,
    });
  } catch (e) {
    console.error("[blogscore] 히스토리 저장 오류:", e);
  }
}
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

/* ── 쿼타 체크 ── */
export async function checkNeighborQuota(userId: string, plan: string): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = NEIGHBOR_DAILY_LIMIT[plan] ?? NEIGHBOR_DAILY_LIMIT.free;
  const used = await getNeighborDailyUsage(userId);
  return { ok: used < limit, used, limit };
}

/* ── 쿼타 증가 (신청 성공 시) ── */
export async function incrementNeighborQuota(userId: string): Promise<void> {
  const key = neighborQuotaKey(userId);
  const used = await getNeighborDailyUsage(userId);
  await supabase
    .from("publy_settings")
    .upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

/* ── 공감·댓글 일일 한도(서이추와 동일 등급 한도) + 사용량/증가 ── */
function engageQuotaKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `engage_daily_${userId}_${today}`;
}
export async function getEngageDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", engageQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementEngageQuota(userId: string): Promise<void> {
  const key = engageQuotaKey(userId);
  const used = await getEngageDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

// 품앗이 하루 사용량(공감·댓글 총건수) — 자정 자동 리셋
function pumasiQuotaKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `pumasi_daily_${userId}_${today}`;
}
export async function getPumasiDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", pumasiQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementPumasiQuota(userId: string): Promise<void> {
  const key = pumasiQuotaKey(userId);
  const used = await getPumasiDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

// ── 제목 수정 하루 한도(쓰기 작업이라 지수 검사와 별도) — 무료3·베10·프30·무제한∞ ──
export const TITLE_EDIT_DAILY_LIMIT: Record<string, number> = {
  free: 3, basic: 10, pro: 30, unlimited: 999999, admin: 999999,
};
function titleEditQuotaKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `titleedit_daily_${userId}_${today}`;
}
export async function getTitleEditDailyUsage(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from("publy_settings").select("value").eq("key", titleEditQuotaKey(userId)).maybeSingle();
    return data?.value ? parseInt(data.value) || 0 : 0;
  } catch { return 0; }
}
export async function incrementTitleEditQuota(userId: string): Promise<void> {
  const key = titleEditQuotaKey(userId);
  const used = await getTitleEditDailyUsage(userId);
  await supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
}

/* ── 회원 플랜 조회 ── */
export async function getUserPlan(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("publy_users")
      .select("plan")
      .eq("id", userId)
      .maybeSingle();
    return data?.plan || "free";
  } catch { return "free"; }
}

/* ── 관리자 블로그 검색 API 키 조회 ── */
export async function getAdminBlogSearchKeys(): Promise<{ clientId: string; clientSecret: string } | null> {
  try {
    const { data: idRow } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", "admin_naver_datalab_client_id")
      .maybeSingle();
    const { data: secRow } = await supabase
      .from("publy_settings")
      .select("value")
      .eq("key", "admin_naver_datalab_client_secret")
      .maybeSingle();
    if (!idRow?.value || !secRow?.value) return null;
    return { clientId: idRow.value, clientSecret: secRow.value };
  } catch {
    return null;
  }
}

export interface PublyJob {
  id: string;
  user_id: string;
  platform: "naver" | "tistory";
  title: string;
  content: string;
  tags: string[];
  image_prompt?: string;
  status: "pending" | "running" | "success" | "fail";
  result_url?: string;
  error?: string;
  created_at: string;
}

export async function fetchPendingJobs(userId: string): Promise<PublyJob[]> {
  const { data, error } = await supabase
    .from("publy_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) return [];
  return data || [];
}

export async function fetchAllPendingJobs(userIds: string[]): Promise<PublyJob[]> {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from("publy_jobs")
    .select("*")
    .in("user_id", userIds)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) return [];
  return data || [];
}

export async function updateJob(id: string, update: Partial<PublyJob>) {
  await supabase.from("publy_jobs").update(update).eq("id", id);
}

export async function addHistory(params: {
  user_id: string;
  platform: string;
  title: string;
  post_url?: string;
  status: "success" | "fail";
  error_message?: string;
}) {
  await supabase.from("publy_history").insert({
    ...params,
    published_at: new Date().toISOString(),
  });
}

/* ── 프록시(계정별 IP) ──
   IP가 계속 같은 곳에서 나가면 네이버가 여러 계정을 한 사람으로 묶어 차단한다.
   계정마다 배정된 프록시로 브라우저를 띄우기 위한 조회 헬퍼.
   업체와 무관: server(host:port)·username·password 4개만 있으면 Playwright가 그대로 사용. */
export interface ProxyConfig { server: string; username?: string; password?: string }
const _proxyCache = new Map<string, { proxy: ProxyConfig | null; ts: number }>();
const PROXY_CACHE_MS = 60000;

// server 문자열에 스킴이 없으면 http:// 를 붙여 Playwright가 인식하게 정규화
function normalizeProxyServer(server: string): string {
  const s = (server || "").trim();
  if (!s) return s;
  return /^(https?|socks[45]?):\/\//i.test(s) ? s : `http://${s}`;
}

// 특정 user_id(계정 또는 회원)에 배정된 프록시를 조회. feature 토글 반영.
async function _lookupProxy(userId: string, feature?: string): Promise<ProxyConfig | null> {
  const key = `${userId}::${feature || ""}`;
  const cached = _proxyCache.get(key);
  if (cached && Date.now() - cached.ts < PROXY_CACHE_MS) return cached.proxy;
  try {
    const { data: map } = await supabase
      .from("publy_account_proxy")
      .select("proxy_id, features")
      .eq("user_id", userId)
      .maybeSingle();
    let proxy: ProxyConfig | null = null;
    // 기능 토글: feature가 주어졌는데 그 계정의 프록시 사용 기능 목록에 없으면 프록시 미적용(내 IP로).
    const features: string[] = Array.isArray((map as any)?.features) ? (map as any).features : [];
    const featureOk = !feature || features.includes(feature);
    if (map?.proxy_id && featureOk) {
      const { data: px } = await supabase
        .from("publy_proxies")
        .select("server, username, password, active")
        .eq("id", map.proxy_id)
        .maybeSingle();
      if (px?.server && px.active !== false) {
        // ★복붙 공백·개행 제거(인증 조용히 실패 방지). id는 내부 공백까지, pw는 앞뒤만.
        proxy = {
          server: normalizeProxyServer(px.server),
          username: (px.username || "").replace(/[\s]+/g, "") || undefined,
          password: (px.password || "").trim() || undefined,
        };
      }
    }
    _proxyCache.set(key, { proxy, ts: Date.now() });
    return proxy;
  } catch {
    return null;
  }
}

// 계정(accountId)에 직접 배정된 프록시 우선, 없으면 그 계정을 쓰는 회원(ownerUserId)에 배정된 프록시를 쓴다.
//   → 관리자가 "회원"에게 프록시를 배정하면, 그 회원이 어느 계정으로 돌리든 프록시가 적용된다.
export async function getProxyForAccount(userId?: string | null, feature?: string, ownerUserId?: string | null): Promise<ProxyConfig | null> {
  if (!userId) return null;
  let proxy = await _lookupProxy(userId, feature);
  if (!proxy && ownerUserId && ownerUserId !== userId) proxy = await _lookupProxy(ownerUserId, feature);
  return proxy;
}

export function clearProxyCache(userId?: string): void {
  if (userId) { for (const k of Array.from(_proxyCache.keys())) if (k.startsWith(`${userId}::`)) _proxyCache.delete(k); }
  else _proxyCache.clear();
}

export async function useQuota(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("publy_quotas")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (!data || data.remaining_quota <= 0) return false;

  const { data: updated } = await supabase
    .from("publy_quotas")
    .update({ used_quota: data.used_quota + 1 })
    .eq("user_id", userId)
    .eq("used_quota", data.used_quota)
    .select("id");

  return !!(updated && updated.length > 0);
}

// ═══════════════════════════════════════════════════════════════════
// 📧 아웃리치(체험단 제안) — 발신 계정 + 보낸글 이력
// ═══════════════════════════════════════════════════════════════════
export interface OutreachSender {
  user_id: string; from_name?: string; from_email: string;
  smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; daily_limit: number;
}
export async function getOutreachSender(userId: string): Promise<OutreachSender | null> {
  const { data } = await supabase.from("publy_outreach_sender").select("*").eq("user_id", userId).maybeSingle();
  return (data as OutreachSender) || null;
}
// 오늘 이 회원이 보낸 이메일 수(하루 제한 체크용)
export async function getOutreachSentToday(userId: string): Promise<number> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { count } = await supabase.from("publy_outreach")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("channel", "email").eq("status", "sent")
    .gte("sent_at", start.toISOString());
  return count || 0;
}
export async function addOutreachLog(row: {
  user_id: string; blog_id: string; nickname?: string; channel: string;
  to_email?: string; subject?: string; message?: string; status: string; error?: string;
}): Promise<void> {
  const { error } = await supabase.from("publy_outreach").insert(row);
  if (error) console.warn("[outreach] 이력 저장 실패:", error.message);
}
