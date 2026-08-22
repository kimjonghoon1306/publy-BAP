import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// Node 20 등 native WebSocket 없는 런타임 폴리필 (Supabase Realtime 초기화 크래시 방지)
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── 등급별 서이추 일일 한도 ── */
export const NEIGHBOR_DAILY_LIMIT: Record<string, number> = {
  free: 10,
  basic: 50,
  pro: 100,
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
