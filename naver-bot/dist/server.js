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
/* ���� �숈떆 諛쒗뻾 �쒗븳 �� ���� */
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
/* ���� �ъ뒪泥댄겕 ���� */
app.get("/health", (_req, res) => {
    res.json({ ok: true, version: "2.0.0", running, queued: waitQueue.length });
});
/* ���� �몄뀡 ���� (怨꾩젙 �곌껐) ���� */
app.post("/api/naver/save-session", async (req, res) => {
    const { userId, id, pw } = req.body;
    if (!userId || !id || !pw)
        return res.status(400).json({ success: false, error: "userId, id, pw �꾩슂" });
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
        return res.status(400).json({ success: false, error: "userId, id, pw, blogName �꾩슂" });
    try {
        await (0, tistory_1.saveTistorySession)(userId, id, pw, blogName);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
/* ���� �ㅼ씠踰� 移댄뀒怨좊━ 議고쉶 ���� */
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
/* ���� Google �몄뀡 �곹깭 �뺤씤 ���� */
app.get("/api/google/session-exists/:userId", (req, res) => {
    res.json({ exists: (0, naver_1.googleSessionExists)(req.params.userId) });
});
/* ���� Google 濡쒓렇�� �몄뀡 ���� ���� */
app.post("/api/google/save-session", async (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return res.status(400).json({ success: false, error: "userId �꾩슂" });
    try {
        await (0, naver_1.saveGoogleSession)(userId);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
/* ���� �몄뀡 �곹깭 �뺤씤 ���� */
app.get("/api/session-status/:userId", (req, res) => {
    const { userId } = req.params;
    res.json({
        naver: (0, naver_1.naverSessionExists)(userId),
        tistory: (0, tistory_1.tistorySessionExists)(userId),
    });
});
/* ���� 吏곸젒 諛쒗뻾 (�깆뿉�� 利됱떆 諛쒗뻾) ���� */
app.post("/api/publish-full", async (req, res) => {
    const { userId, platform, title, content, tags = [], imageUrl, categoryId, visibility, scheduleTime, blocks, useFlow, flowImgCount, flowPrompts, flowCaptions } = req.body;
    if (!userId || !platform || !title || !content) {
        return res.status(400).json({ error: "userId, platform, title, content �꾩슂" });
    }
    await acquireSlot();
    try {
        let finalBlocks = blocks || [];
        // ���� Flow �대�吏� �앹꽦 ����
        if (useFlow && flowPrompts?.length > 0 && platform === "naver") {
            console.log(`[server] Flow �대�吏� �앹꽦 �쒖옉: ${flowImgCount}��`);
            try {
                const flowImages = await (0, naver_1.generateFlowImages)({
                    userId,
                    prompts: flowPrompts,
                    captions: flowCaptions || [],
                    onLog: (msg) => console.log(msg),
                });
                if (flowImages.length > 0) {
                    // �띿뒪�� 釉붾줉�� Flow �대�吏� 洹좊벑 �쎌엯
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
                    // �⑥� �대�吏� 留덉�留됱뿉 異붽�
                    while (imgIdx < flowImages.length) {
                        result.push({ type: "image", src: flowImages[imgIdx].src, alt: flowImages[imgIdx].alt });
                        imgIdx++;
                    }
                    finalBlocks = result;
                    console.log(`[server] Flow �대�吏� ${flowImages.length}�� 釉붾줉 �쎌엯 �꾨즺`);
                }
            }
            catch (flowErr) {
                console.error("[server] Flow �대�吏� �앹꽦 �ㅽ뙣:", flowErr.message);
                // Flow �ㅽ뙣�대룄 �대�吏� �놁씠 諛쒗뻾 怨꾩냽
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
            return res.status(400).json({ error: "platform�� naver �먮뒗 tistory" });
        }
        await (0, supabase_1.addHistory)({ user_id: userId, platform, title, post_url: postUrl, status: "success" });
        res.json({ success: true, postUrl });
    }
    catch (e) {
        await (0, supabase_1.addHistory)({ user_id: userId, platform, title, status: "fail", error_message: e.message });
        if (e.message?.includes("�몄뀡 留뚮즺") || e.message?.includes("�ъ뿰寃�")) {
            return res.status(401).json({ error: e.message, code: "SESSION_EXPIRED" });
        }
        res.status(500).json({ error: e.message });
    }
    finally {
        releaseSlot();
    }
});
/* ���� Supabase Job Queue �대쭅 ���� */
let currentUserId = null;
let isProcessing = false;
function setCurrentUser(userId) {
    currentUserId = userId;
    console.log(`[bot] �좎� �ㅼ젙: ${userId}`);
}
async function processJobs() {
    if (!currentUserId || isProcessing)
        return;
    isProcessing = true;
    try {
        const jobs = await (0, supabase_1.fetchPendingJobs)(currentUserId);
        for (const job of jobs) {
            console.log(`[bot] �묒뾽 �쒖옉: ${job.platform} - ${job.title}`);
            await (0, supabase_1.updateJob)(job.id, { status: "running" });
            await acquireSlot();
            try {
                const ok = await (0, supabase_1.useQuota)(job.user_id);
                if (!ok) {
                    await (0, supabase_1.updateJob)(job.id, { status: "fail", error: "荑쇳꽣 珥덇낵" });
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
                console.log(`[bot] 諛쒗뻾 �꾨즺: ${postUrl}`);
            }
            catch (e) {
                await (0, supabase_1.updateJob)(job.id, { status: "fail", error: e.message });
                await (0, supabase_1.addHistory)({ user_id: job.user_id, platform: job.platform, title: job.title, status: "fail", error_message: e.message });
                console.error(`[bot] 諛쒗뻾 �ㅽ뙣: ${e.message}`);
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
/* ���� �좎� �깅줉 (Electron�먯꽌 濡쒓렇�� �� �몄텧) ���� */
app.post("/api/register-user", (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return res.status(400).json({ error: "userId �꾩슂" });
    setCurrentUser(userId);
    res.json({ success: true });
});
/* ���� �좎� �깅줉 �댁젣 (濡쒓렇�꾩썐 �� �몄텧) ���� */
app.post("/api/unregister-user", (req, res) => {
    const { userId } = req.body;
    if (currentUserId === userId) {
        currentUserId = null;
        console.log(`[bot] �좎� �깅줉 �댁젣: ${userId}`);
    }
    res.json({ success: true });
});
/* ���� �ㅼ씠踰� 寃��됯킅怨� �ㅼ썙�� API �꾨줉�� ���� */
app.post("/api/naver-keywords", async (req, res) => {
    const { accessLicense, secretKey, customerId, keywords } = req.body;
    if (!accessLicense || !secretKey || !customerId || !keywords?.length)
        return res.status(400).json({ error: "accessLicense, secretKey, customerId, keywords �꾩슂" });
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
            return res.status(r.status).json({ error: `�ㅼ씠踰� API �ㅻ쪟 ${r.status}: ${txt}` });
        }
        const data = await r.json();
        res.json(data);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/* ���� �ㅼ씠踰� DataLab 寃��됱뼱 �몃젋�� API �꾨줉�� ���� */
app.post("/api/naver-datalab", async (req, res) => {
    const { clientId, clientSecret, keyword } = req.body;
    if (!clientId || !clientSecret || !keyword)
        return res.status(400).json({ error: "clientId, clientSecret, keyword �꾩슂" });
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
            return res.status(r.status).json({ error: `DataLab API �ㅻ쪟 ${r.status}: ${txt}` });
        }
        const data = await r.json();
        res.json({ ok: true, ...data });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/* ���� Gemini �꾨줉�� ���� */
app.post("/api/gemini-vision", async (req, res) => {
    const { apiKey, parts, prompt } = req.body;
    if (!apiKey || !parts || !prompt)
        return res.status(400).json({ error: "�뚮씪誘명꽣 �꾨씫" });
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
    return res.status(500).json({ error: "�앹꽦 �ㅽ뙣. Gemini �ㅻ� �뺤씤�섍굅�� �좎떆 �� �ㅼ떆 �쒕룄�댁＜�몄슂." });
});
/* ���� �쒕쾭 �쒖옉 ���� */
app.listen(PORT, () => {
    console.log(`[bot] Publy 遊� �쒕쾭 v2.0 �� http://localhost:${PORT}`);
});
exports.default = app;
//# sourceMappingURL=server.js.map
