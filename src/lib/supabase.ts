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
  plan: "free" | "basic" | "pro";
  app_type: "app" | "web" | "both";
  is_active: boolean;
  created_at: string;
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
}

// ── 인증 ─────────────────────────────────────────────────
export async function signUp(email: string, password: string, name: string) {
  const hash = await bcrypt.hash(password, 10);

  const { data: user, error } = await supabase
    .from("publy_users")
    .insert({ email, password_hash: hash, name })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // 기본 쿼터 생성
  await supabase.from("publy_quotas").insert({
    user_id: user.id,
    total_quota: 10,
    used_quota: 0,
  });

  return user;
}

export async function signIn(email: string, password: string) {

  const { data: user, error } = await supabase
    .from("publy_users")
    .select("*")
    .eq("email", email)
    .eq("is_active", true)
    .single();

  if (error || !user) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다");

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다");

  return user as PublyUser;
}

// ── 쿼터 ─────────────────────────────────────────────────
export async function getQuota(userId: string): Promise<PublyQuota | null> {
  const { data } = await supabase
    .from("publy_quotas")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data;
}

export async function useQuota(userId: string): Promise<boolean> {
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
  return data || [];
}

export async function upsertAccount(account: Partial<PublyAccount> & { password_encrypted: string }) {
  const { error } = await supabase.from("publy_accounts").upsert(account);
  if (error) throw new Error(error.message);
}
