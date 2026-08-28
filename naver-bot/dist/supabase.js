"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
exports.fetchPendingJobs = fetchPendingJobs;
exports.fetchAllPendingJobs = fetchAllPendingJobs;
exports.updateJob = updateJob;
exports.claimPendingJob = claimPendingJob;
exports.addHistory = addHistory;
exports.finishQueuedHistory = finishQueuedHistory;
exports.checkPublishEntitlement = checkPublishEntitlement;
exports.incrementDailyPublish = incrementDailyPublish;
exports.useQuota = useQuota;
exports.refundQuota = refundQuota;
const supabase_js_1 = require("@supabase/supabase-js");
const ws_1 = __importDefault(require("ws"));
if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = ws_1.default;
}
const SUPABASE_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTMzOTQsImV4cCI6MjA5Mjg4OTM5NH0.pw_qUR0oOxgt82S_DA6GTka3WP0JBu2vmWuKZ9VvTKM";
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
    const now = new Date().toISOString();
    const { data, error } = await exports.supabase
        .from("publy_jobs")
        .select("*")
        .in("user_id", userIds)
        .eq("status", "pending")
        .or(`schedule_time.is.null,schedule_time.lte.${now}`)
        .order("created_at", { ascending: true })
        .limit(10);
    if (error)
        return [];
    return data || [];
}
async function updateJob(id, update) {
    await exports.supabase.from("publy_jobs").update(update).eq("id", id);
}
/** 여러 앱이 같은 대기 작업을 보더라도 한 프로세스만 running으로 선점한다. */
async function claimPendingJob(id) {
    const { data, error } = await exports.supabase
        .from("publy_jobs")
        .update({ status: "running" })
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
    return !error && !!data?.length;
}
async function addHistory(params) {
    await exports.supabase.from("publy_history").insert({
        ...params,
        published_at: new Date().toISOString(),
    });
}
async function finishQueuedHistory(params) {
    const { data: pending } = await exports.supabase
        .from("publy_history")
        .select("id")
        .eq("user_id", params.user_id)
        .eq("platform", params.platform)
        .eq("title", params.title)
        .eq("status", "pending")
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (pending?.id) {
        const { error } = await exports.supabase.from("publy_history").update({
            status: params.status,
            post_url: params.post_url,
            error_message: params.error_message,
            published_at: new Date().toISOString(),
        }).eq("id", pending.id);
        if (!error)
            return;
    }
    await addHistory(params);
}
const koreaDateKey = () => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const PUBLISH_DAILY_LIMIT = {
    free: 2, basic: 6, pro: 15, unlimited: 999999, admin: 9999,
};
async function checkPublishEntitlement(userId) {
    const [{ data: user }, { data: quota }] = await Promise.all([
        exports.supabase.from("publy_users").select("plan,is_active").eq("id", userId).maybeSingle(),
        exports.supabase.from("publy_quotas").select("reset_date").eq("user_id", userId).maybeSingle(),
    ]);
    if (!user || user.is_active === false)
        return { ok: false, reason: "비활성 회원" };
    if (!quota?.reset_date || new Date(quota.reset_date).getTime() <= Date.now())
        return { ok: false, reason: "이용기간 만료" };
    const limit = PUBLISH_DAILY_LIMIT[user.plan] ?? PUBLISH_DAILY_LIMIT.free;
    const key = `publish_daily_${userId}_${koreaDateKey()}`;
    const { data: row } = await exports.supabase.from("publy_settings").select("value").eq("key", key).maybeSingle();
    const used = Number.parseInt(row?.value || "0", 10) || 0;
    return used < limit ? { ok: true } : { ok: false, reason: `오늘 발행 한도(${limit}건) 초과` };
}
async function incrementDailyPublish(userId) {
    const key = `publish_daily_${userId}_${koreaDateKey()}`;
    const { data } = await exports.supabase.from("publy_settings").select("value").eq("key", key).maybeSingle();
    const used = Number.parseInt(data?.value || "0", 10) || 0;
    await exports.supabase.from("publy_settings").upsert({ key, value: String(used + 1) }, { onConflict: "key" });
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
async function refundQuota(userId) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data } = await exports.supabase.from("publy_quotas").select("used_quota").eq("user_id", userId).maybeSingle();
        const used = data?.used_quota || 0;
        if (used <= 0)
            return;
        const { data: updated, error } = await exports.supabase.from("publy_quotas")
            .update({ used_quota: used - 1 }).eq("user_id", userId).eq("used_quota", used).select("id");
        if (!error && updated?.length)
            return;
    }
}
//# sourceMappingURL=supabase.js.map