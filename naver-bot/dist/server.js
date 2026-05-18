"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setCurrentUser = setCurrentUser;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const naver_1 = require("./naver");
const tistory_1 = require("./tistory");
const supabase_1 = require("./supabase");
const app = (0, express_1.default)();
const PORT = 3333;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
/* ── 동시 발행 제한 큐 ── */
const MAX_CONCURRENT = 3;
let running = 0;
const waitQueue = [];
async function acquireSlot() {
    if (running < MAX_CONCURRENT) {
        running++;
        return;
    }
    return new Promise((resolve) => {
        waitQueue.push(() => { running++; resolve(); });
    });
}
function releaseSlot() {
    running--;
    const next = waitQueue.shift();
    if (next)
        next();
}
/* ── 헬스체크 ── */
app.get("/health", (_req, res) => {
    res.json({ ok: true, version: "2.0.0", running, queued: waitQueue.length });
});
/* ── 세션 저장 (계정 연결) ── */
app.post("/api/naver/save-session", async (req, res) => {
    const { userId, id, pw } = req.body;
    if (!userId || !id || !pw)
        return res.status(400).json({ success: false, error: "userId, id, pw 필요" });
    try {
        const result = await (0, naver_1.saveNaverSession)(userId, id, pw);
        res.json({ success: true, blogId: result.blogId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post("/api/tistory/save-session", async (req, res) => {
    const { userId, id, pw, blogName } = req.body;
    if (!userId || !id || !pw || !blogName)
        return res.status(400).json({ success: false, error: "userId, id, pw, blogName 필요" });
    try {
        await (0, tistory_1.saveTistorySession)(userId, id, pw, blogName);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
/* ── 세션 상태 확인 ── */
app.get("/api/session-status/:userId", (req, res) => {
    const { userId } = req.params;
    res.json({
        naver: (0, naver_1.naverSessionExists)(userId),
        tistory: (0, tistory_1.tistorySessionExists)(userId),
    });
});
/* ── 직접 발행 (앱에서 즉시 발행) ── */
app.post("/api/publish-full", async (req, res) => {
    const { userId, platform, title, content, tags = [], imagePrompt } = req.body;
    if (!userId || !platform || !title || !content) {
        return res.status(400).json({ error: "userId, platform, title, content 필요" });
    }
    await acquireSlot();
    try {
        let postUrl = "";
        if (platform === "naver") {
            postUrl = await (0, naver_1.publishNaver)({ userId, title, content, tags });
        }
        else if (platform === "tistory") {
            postUrl = await (0, tistory_1.publishTistory)({ userId, title, content, tags });
        }
        else {
            return res.status(400).json({ error: "platform은 naver 또는 tistory" });
        }
        await (0, supabase_1.addHistory)({ user_id: userId, platform, title, post_url: postUrl, status: "success" });
        res.json({ success: true, postUrl });
    }
    catch (e) {
        await (0, supabase_1.addHistory)({ user_id: userId, platform, title, status: "fail", error_message: e.message });
        if (e.message?.includes("세션 만료") || e.message?.includes("재연결")) {
            return res.status(401).json({ error: e.message, code: "SESSION_EXPIRED" });
        }
        res.status(500).json({ error: e.message });
    }
    finally {
        releaseSlot();
    }
});
/* ── Supabase Job Queue 폴링 ── */
let currentUserId = null;
let isProcessing = false;
function setCurrentUser(userId) {
    currentUserId = userId;
    console.log(`[bot] 유저 설정: ${userId}`);
}
async function processJobs() {
    if (!currentUserId || isProcessing)
        return;
    isProcessing = true;
    try {
        const jobs = await (0, supabase_1.fetchPendingJobs)(currentUserId);
        for (const job of jobs) {
            console.log(`[bot] 작업 시작: ${job.platform} - ${job.title}`);
            await (0, supabase_1.updateJob)(job.id, { status: "running" });
            await acquireSlot();
            try {
                const ok = await (0, supabase_1.useQuota)(job.user_id);
                if (!ok) {
                    await (0, supabase_1.updateJob)(job.id, { status: "fail", error: "쿼터 초과" });
                    continue;
                }
                let postUrl = "";
                if (job.platform === "naver") {
                    postUrl = await (0, naver_1.publishNaver)({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags });
                }
                else if (job.platform === "tistory") {
                    postUrl = await (0, tistory_1.publishTistory)({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags });
                }
                await (0, supabase_1.updateJob)(job.id, { status: "success", result_url: postUrl });
                await (0, supabase_1.addHistory)({ user_id: job.user_id, platform: job.platform, title: job.title, post_url: postUrl, status: "success" });
                console.log(`[bot] 발행 완료: ${postUrl}`);
            }
            catch (e) {
                await (0, supabase_1.updateJob)(job.id, { status: "fail", error: e.message });
                await (0, supabase_1.addHistory)({ user_id: job.user_id, platform: job.platform, title: job.title, status: "fail", error_message: e.message });
                console.error(`[bot] 발행 실패: ${e.message}`);
            }
            finally {
                releaseSlot();
            }
        }
    }
    finally {
        isProcessing = false;
    }
}
setInterval(processJobs, 10000);
/* ── 유저 등록 (Electron에서 로그인 시 호출) ── */
app.post("/api/register-user", (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return res.status(400).json({ error: "userId 필요" });
    setCurrentUser(userId);
    res.json({ success: true });
});
/* ── 서버 시작 ── */
app.listen(PORT, () => {
    console.log(`[bot] Publy 봇 서버 v2.0 → http://localhost:${PORT}`);
});
exports.default = app;
//# sourceMappingURL=server.js.map