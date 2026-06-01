"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
/* ── 네이버 카테고리 조회 ── */
app.get("/api/naver/categories/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
        const categories = await (0, naver_1.getNaverCategories)(userId);
        res.json({ categories });
    }
    catch (e) {
        res.status(500).json({ error: e.message, categories: [] });
    }
});
/* ── Google 세션 상태 확인 ── */
app.get("/api/google/session-exists/:userId", (req, res) => {
    res.json({ exists: (0, naver_1.googleSessionExists)(req.params.userId) });
});
/* ── Google 로그인 세션 저장 ── */
app.post("/api/google/save-session", async (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return res.status(400).json({ success: false, error: "userId 필요" });
    try {
        await (0, naver_1.saveGoogleSession)(userId);
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
    const { userId, platform, title, content, tags = [], imageUrl, categoryId, visibility, scheduleTime, blocks, useFlow, flowImgCount, flowPrompts, flowCaptions } = req.body;
    if (!userId || !platform || !title || !content) {
        return res.status(400).json({ error: "userId, platform, title, content 필요" });
    }
    await acquireSlot();
    try {
        let finalBlocks = blocks || [];
        // ── Flow 이미지 생성 ──
        if (useFlow && flowPrompts?.length > 0 && platform === "naver") {
            console.log(`[server] Flow 이미지 생성 시작: ${flowImgCount}장`);
            try {
                const flowImages = await (0, naver_1.generateFlowImages)({
                    userId,
                    prompts: flowPrompts,
                    captions: flowCaptions || [],
                    onLog: (msg) => console.log(msg),
                });
                if (flowImages.length > 0) {
                    // 텍스트 블록에 Flow 이미지 균등 삽입
                    const textBlocks = finalBlocks.filter((b) => b.type === "text");
                    const result = [];
                    const step = Math.max(1, Math.floor(textBlocks.length / flowImages.length));
                    let imgIdx = 0;
                    let textCount = 0;
                    for (const block of finalBlocks) {
                        result.push(block);
                        if (block.type === "text") {
                            textCount++;
                            if (imgIdx < flowImages.length && textCount % step === 0) {
                                result.push({
                                    type: "image",
                                    src: flowImages[imgIdx].src,
                                    alt: flowImages[imgIdx].alt,
                                });
                                imgIdx++;
                            }
                        }
                    }
                    // 남은 이미지 마지막에 추가
                    while (imgIdx < flowImages.length) {
                        result.push({ type: "image", src: flowImages[imgIdx].src, alt: flowImages[imgIdx].alt });
                        imgIdx++;
                    }
                    finalBlocks = result;
                    console.log(`[server] Flow 이미지 ${flowImages.length}장 블록 삽입 완료`);
                }
            }
            catch (flowErr) {
                console.error("[server] Flow 이미지 생성 실패:", flowErr.message);
                // Flow 실패해도 이미지 없이 발행 계속
            }
        }
        let postUrl = "";
        if (platform === "naver") {
            postUrl = await (0, naver_1.publishNaver)({ userId, title, content, tags, imageUrl, categoryId, visibility, scheduleTime, blocks: finalBlocks });
        }
        else if (platform === "tistory") {
            postUrl = await (0, tistory_1.publishTistory)({ userId, title, content, tags, categoryId, visibility });
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
                    postUrl = await (0, naver_1.publishNaver)({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags, categoryId: job.category_id, visibility: job.visibility });
                }
                else if (job.platform === "tistory") {
                    postUrl = await (0, tistory_1.publishTistory)({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags, categoryId: job.category_id, visibility: job.visibility });
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
/* ── 유저 등록 해제 (로그아웃 시 호출) ── */
app.post("/api/unregister-user", (req, res) => {
    const { userId } = req.body;
    if (currentUserId === userId) {
        currentUserId = null;
        console.log(`[bot] 유저 등록 해제: ${userId}`);
    }
    res.json({ success: true });
});
/* ── 네이버 검색광고 키워드 API 프록시 ── */
app.post("/api/naver-keywords", async (req, res) => {
    const { accessLicense, secretKey, customerId, keywords } = req.body;
    if (!accessLicense || !secretKey || !customerId || !keywords?.length)
        return res.status(400).json({ error: "accessLicense, secretKey, customerId, keywords 필요" });
    try {
        const crypto = await Promise.resolve().then(() => __importStar(require("crypto")));
        const timestamp = Date.now().toString();
        const message = `${timestamp}.GET./keywordstool`;
        const signature = crypto.default
            .createHmac("sha256", secretKey)
            .update(message)
            .digest("base64");
        const params = new URLSearchParams({ hintKeywords: keywords.join(","), showDetail: "1" });
        const url = `https://api.naver.com/keywordstool?${params.toString()}`;
        const r = await fetch(url, {
            headers: {
                "X-Timestamp": timestamp,
                "X-API-KEY": accessLicense,
                "X-Customer": customerId,
                "X-Signature": signature,
            },
        });
        if (!r.ok) {
            const txt = await r.text();
            return res.status(r.status).json({ error: `네이버 API 오류 ${r.status}: ${txt}` });
        }
        const data = await r.json();
        res.json(data);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/* ── 네이버 DataLab 검색어 트렌드 API 프록시 ── */
app.post("/api/naver-datalab", async (req, res) => {
    const { clientId, clientSecret, keyword } = req.body;
    if (!clientId || !clientSecret || !keyword)
        return res.status(400).json({ error: "clientId, clientSecret, keyword 필요" });
    try {
        const endDate = new Date().toISOString().slice(0, 10);
        const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const body = {
            startDate, endDate, timeUnit: "week",
            keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
        };
        const r = await fetch("https://openapi.naver.com/v1/datalab/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Naver-Client-Id": clientId,
                "X-Naver-Client-Secret": clientSecret,
            },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const txt = await r.text();
            return res.status(r.status).json({ error: `DataLab API 오류 ${r.status}: ${txt}` });
        }
        const data = await r.json();
        res.json({ ok: true, ...data });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/* ── Gemini 프록시 ── */
app.post("/api/gemini-vision", async (req, res) => {
    const { apiKey, parts, prompt } = req.body;
    if (!apiKey || !parts || !prompt)
        return res.status(400).json({ error: "파라미터 누락" });
    const models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
    const body = {
        contents: [{ parts: [...parts, { text: prompt }] }],
        generationConfig: { maxOutputTokens: 4000, temperature: 0.9 }
    };
    for (const model of models) {
        try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            if (!r.ok)
                continue;
            const d = await r.json();
            const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text)
                return res.json({ text });
        }
        catch { }
    }
    return res.status(500).json({ error: "생성 실패. Gemini 키를 확인하거나 잠시 후 다시 시도해주세요." });
});
/* ── 서버 시작 ── */
app.listen(PORT, () => {
    console.log(`[bot] Publy 봇 서버 v2.0 → http://localhost:${PORT}`);
});
exports.default = app;
//# sourceMappingURL=server.js.map