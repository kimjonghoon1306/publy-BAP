import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface PublyJob {
  id: string;
  user_id: string;
  platform: "naver" | "tistory";
  title: string;
  content: string;
  tags: string[];
  image_prompt?: string;
  schedule_time?: string | null;
  status: "pending" | "running" | "success" | "fail";
  result_url?: string;
  error?: string;
  created_at: string;
  category_id?: string | null;
  visibility?: string | null;
  // ★ 예약/큐 발행의 전체 발행 데이터(blocks=이미지 포함). 있으면 이걸로 발행, 없으면 옛 방식(텍스트만).
  payload?: PublyJobPayload | null;
}

export interface PublyJobPayload {
  title?: string;
  content?: string;
  pubScope?: "body" | "faq" | "full";
  tags?: string[];
  imageUrl?: string;
  categoryId?: string;
  visibility?: "public" | "neighbor" | "private";
  videoUrl?: string;
  videoPosition?: "top" | "middle" | "bottom";
  blocks?: Array<{ type: string; content?: string; src?: string; alt?: string; link?: string; images?: {src:string;alt:string}[] }>;
}

export async function fetchPendingJobs(userId: string): Promise<PublyJob[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("publy_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .or(`schedule_time.is.null,schedule_time.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) return [];
  return data || [];
}

export async function fetchAllPendingJobs(userIds: string[]): Promise<PublyJob[]> {
  if (!userIds.length) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("publy_jobs")
    .select("*")
    .in("user_id", userIds)
    .eq("status", "pending")
    .or(`schedule_time.is.null,schedule_time.lte.${now}`)
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
