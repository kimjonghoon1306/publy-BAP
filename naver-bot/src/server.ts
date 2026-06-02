import express from "express";
import cors from "cors";
import fs from "fs-extra";
import path from "path";
import { saveNaverSession, publishNaver, naverSessionExists, generateFlowImages, getNaverCategories, saveGoogleSession, googleSessionExists } from "./naver";
import { saveTistorySession, publishTistory, tistorySessionExists } from "./tistory";
import { fetchPendingJobs, updateJob, addHistory, useQuota } from "./supabase";

const app = express();
const PORT = 3333;

app.use(cors());
app.use(express.json());

/* ── 동시 발행 제한 큐 ── */
const MAX_CONCURRENT = 3;
let running = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) { running++; return; }
  return new Promise((resolve) => {
    waitQueue.push(() => { running++; resolve(); });
  });
}

function releaseSlot() {
  running--;
  const next = waitQueue.shift();
  if (next) next();
}

/* ── 헬스체크 ── */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "2.0.0", running, queued: waitQueue.length });
});

/* ── 세션 저장 (계정 연결) ── */
app.post("/api/naver/save-session", async (req, res) => {
  const { userId, id, pw } = req.body;
  if (!userId || !id || !pw) return res.status(400).json({ success: false, error: "userId, id, pw 필요" });
  try {
    const result = await saveNaverSession(userId, id, pw);
    res.json({ success: true, blogId: result.blogId });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/api/tistory/save-session", async (req, res) => {
  const { userId, id, pw, blogName } = req.body;
  if (!userId || !id || !pw || !blogName) return res.status(400).json({ success: false, error: "userId, id, pw, blogName 필요" });
  try {
    await saveTistorySession(userId, id, pw, blogName);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── 네이버 카테고리 조회 ── */
app.get("/api/naver/categories/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const categories = await getNaverCategories(userId);
    res.json({ categories });
  } catch (e: any) {
    res.status(500).json({ error: e.message, categories: [] });
  }
});

/* ── Google 세션 상태 확인 ── */
app.get("/api/google/session-exists/:userId", (req, res) => {
  res.json({ exists: googleSessionExists(req.params.userId) });
});

/* ── Google 로그인 세션 저장 ── */
app.post("/api/google/save-session", async (req, res) => {
  const { userId, email, pw } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: "userId 필요" });
  try {
    // 이메일/비번 없으면 기존 세션 파일에서 읽어서 재연결
    let finalEmail = email;
    let finalPw = pw;
    if (!finalEmail || !finalPw) {
      const gsp = path.join(__dirname, `../sessions/google_${userId}.json`);
      if (fs.existsSync(gsp)) {
        const saved = JSON.parse(fs.readFileSync(gsp, "utf-8"));
        finalEmail = finalEmail || saved.email || "";
        finalPw = finalPw || (saved.pw ? Buffer.from(saved.pw, "base64").toString("utf-8") : "");
      }
    }
    await saveGoogleSession(userId, finalEmail, finalPw);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── 세션 상태 확인 ── */
app.get("/api/session-status/:userId", (req, res) => {
  const { userId } = req.params;
  res.json({
    naver: naverSessionExists(userId),
    tistory: tistorySessionExists(userId),
    google: googleSessionExists(userId),
  });
});

/* ── 직접 발행 (앱에서 즉시 발행) ── */
app.post("/api/publish-full", async (req, res) => {
  const { userId, platform, title, content, pubScope = "full", tags = [], imageUrl, categoryId, visibility, scheduleTime, blocks,
    useFlow, flowImgCount, flowPrompts, flowCaptions } = req.body;
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
        const flowImages = await generateFlowImages({
          userId,
          prompts: flowPrompts,
          captions: flowCaptions || [],
          onLog: (msg) => console.log(msg),
        });

        if (flowImages.length > 0) {
          // 텍스트 블록에 Flow 이미지 균등 삽입
          const textBlocks = finalBlocks.filter((b: any) => b.type === "text");
          const result: any[] = [];
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
      } catch (flowErr: any) {
        console.error("[server] Flow 이미지 생성 실패:", flowErr.message);
        // Flow 실패해도 이미지 없이 발행 계속
      }
    }

    let postUrl = "";
    if (platform === "naver") {
      postUrl = await publishNaver({ userId, title, content, pubScope, tags, imageUrl, categoryId, visibility, scheduleTime, blocks: finalBlocks });
    } else if (platform === "tistory") {
      postUrl = await publishTistory({ userId, title, content, tags, categoryId, visibility });
    } else {
      return res.status(400).json({ error: "platform은 naver 또는 tistory" });
    }

    await addHistory({ user_id: userId, platform, title, post_url: postUrl, status: "success" });
    res.json({ success: true, postUrl });
  } catch (e: any) {
    await addHistory({ user_id: userId, platform, title, status: "fail", error_message: e.message });

    if (e.message?.includes("세션 만료") || e.message?.includes("재연결")) {
      return res.status(401).json({ error: e.message, code: "SESSION_EXPIRED" });
    }
    res.status(500).json({ error: e.message });
  } finally {
    releaseSlot();
  }
});

/* ── Supabase Job Queue 폴링 ── */
let currentUserId: string | null = null;
let isProcessing = false;

export function setCurrentUser(userId: string) {
  currentUserId = userId;
  console.log(`[bot] 유저 설정: ${userId}`);
}

async function processJobs() {
  if (!currentUserId || isProcessing) return;
  isProcessing = true;

  try {
    const jobs = await fetchPendingJobs(currentUserId);
    for (const job of jobs) {
      console.log(`[bot] 작업 시작: ${job.platform} - ${job.title}`);
      await updateJob(job.id, { status: "running" });

      await acquireSlot();
      try {
        const ok = await useQuota(job.user_id);
        if (!ok) {
          await updateJob(job.id, { status: "fail", error: "쿼터 초과" });
          continue;
        }

        let postUrl = "";
        if (job.platform === "naver") {
          postUrl = await publishNaver({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags, categoryId: (job as any).category_id, visibility: (job as any).visibility });
        } else if (job.platform === "tistory") {
          postUrl = await publishTistory({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags, categoryId: (job as any).category_id, visibility: (job as any).visibility });
        }

        await updateJob(job.id, { status: "success", result_url: postUrl });
        await addHistory({ user_id: job.user_id, platform: job.platform, title: job.title, post_url: postUrl, status: "success" });
        console.log(`[bot] 발행 완료: ${postUrl}`);
      } catch (e: any) {
        await updateJob(job.id, { status: "fail", error: e.message });
        await addHistory({ user_id: job.user_id, platform: job.platform, title: job.title, status: "fail", error_message: e.message });
        console.error(`[bot] 발행 실패: ${e.message}`);
      } finally {
        releaseSlot();
      }
    }
  } finally {
    isProcessing = false;
  }
}

setInterval(processJobs, 10000);

/* ── 유저 등록 (Electron에서 로그인 시 호출) ── */
app.post("/api/register-user", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId 필요" });
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
    const crypto = await import("crypto");
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
  } catch (e: any) {
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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── Gemini 프록시 ── */
app.post("/api/gemini-vision", async (req, res) => {
  const { apiKey, parts, prompt } = req.body;
  if (!apiKey || !parts || !prompt) return res.status(400).json({ error: "파라미터 누락" });
  const models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
  const body = {
    contents: [{ parts: [...parts, { text: prompt }] }],
    generationConfig: { maxOutputTokens: 4000, temperature: 0.9 }
  };
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return res.json({ text });
    } catch {}
  }
  return res.status(500).json({ error: "생성 실패. Gemini 키를 확인하거나 잠시 후 다시 시도해주세요." });
});

/* ── 서버 시작 ── */
app.listen(PORT, () => {
  console.log(`[bot] Publy 봇 서버 v2.0 → http://localhost:${PORT}`);
});

export default app;
