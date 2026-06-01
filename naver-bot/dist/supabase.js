"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
exports.fetchPendingJobs = fetchPendingJobs;
exports.fetchAllPendingJobs = fetchAllPendingJobs;
exports.updateJob = updateJob;
exports.addHistory = addHistory;
exports.useQuota = useQuota;
exports.getAccountCredentials = getAccountCredentials;
const supabase_js_1 = require("@supabase/supabase-js");
const ws_1 = __importDefault(require("ws"));
if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = ws_1.default;
}
const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4MzA5NzcsImV4cCI6MjA2MTQwNjk3N30.bHtF5g_cJjlcLLFH5JaTzqOeD03j6fNXQYhYkVvTKM";
exports.supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_KEY);
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
async function fetchAllPendingJobs(userIds) {
    if (!userIds.length)
        return [];
    const { data, error } = await exports.supabase
        .from("publy_jobs")
        .select("*")
        .in("user_id", userIds)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(10);
    if (error)
        return [];
    return data || [];
}
async function updateJob(id, update) {
    await exports.supabase.from("publy_jobs").update(update).eq("id", id);
}
async function addHistory(params) {
    await exports.supabase.from("publy_history").insert({
        ...params,
        published_at: new Date().toISOString(),
    });
}
async function useQuota(userId) {
    const { data } = await exports.supabase
        .from("publy_quotas")
        .select("*")
        .eq("user_id", userId)
        .single();
    if (!data || data.remaining_quota <= 0)
        return false;
    const { data: updated } = await exports.supabase
        .from("publy_quotas")
        .update({ used_quota: data.used_quota + 1 })
        .eq("user_id", userId)
        .eq("used_quota", data.used_quota)
        .select("id");
    return !!(updated && updated.length > 0);
}
async function getAccountCredentials(userId, platform) {
    const { data, error } = await exports.supabase
        .from("publy_accounts")
        .select("username, password_encrypted")
        .eq("user_id", userId)
        .eq("platform", platform)
        .single();
    if (error || !data)
        return null;
    try {
        const pw = Buffer.from(data.password_encrypted || "", "base64").toString("utf-8");
        return { id: data.username, pw };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=supabase.js.map