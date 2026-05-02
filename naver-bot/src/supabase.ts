import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4MzA5NzcsImV4cCI6MjA2MTQwNjk3N30.bHtF5g_cJjlcLLFH5JaTzqOeD03j6fNXQYhYkVvTKM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// 내 유저의 pending 작업 가져오기
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

// 작업 상태 업데이트
export async function updateJob(id: string, update: Partial<PublyJob>) {
  await supabase.from("publy_jobs").update(update).eq("id", id);
}

// 발행 히스토리 추가
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

// 쿼터 차감
export async function useQuota(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("publy_quotas")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (!data || data.remaining_quota <= 0) return false;
  await supabase
    .from("publy_quotas")
    .update({ used_quota: data.used_quota + 1 })
    .eq("user_id", userId);
  return true;
}
