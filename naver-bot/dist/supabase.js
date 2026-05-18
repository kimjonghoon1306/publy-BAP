"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
exports.fetchPendingJobs = fetchPendingJobs;
exports.updateJob = updateJob;
exports.addHistory = addHistory;
exports.useQuota = useQuota;
const supabase_js_1 = require("@supabase/supabase-js");
const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4MzA5NzcsImV4cCI6MjA2MTQwNjk3N30.bHtF5g_cJjlcLLFH5JaTzqOeD03j6fNXQYhYkVvTKM";
exports.supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_KEY);
// 내 유저의 pending 작업 가져오기
async function fetchPendingJobs(userId) {
    const { data, error } = await exports.supabase
        .from("publy_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(5);
    if (error)
        return [];
    return data || [];
}
// 작업 상태 업데이트
async function updateJob(id, update) {
    await exports.supabase.from("publy_jobs").update(update).eq("id", id);
}
// 발행 히스토리 추가
async function addHistory(params) {
    await exports.supabase.from("publy_history").insert({
        ...params,
        published_at: new Date().toISOString(),
    });
}
// 쿼터 차감
async function useQuota(userId) {
    const { data } = await exports.supabase
        .from("publy_quotas")
        .select("*")
        .eq("user_id", userId)
        .single();
    if (!data || data.remaining_quota <= 0)
        return false;
    await exports.supabase
        .from("publy_quotas")
        .update({ used_quota: data.used_quota + 1 })
        .eq("user_id", userId);
    return true;
}
//# sourceMappingURL=supabase.js.map