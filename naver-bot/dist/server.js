import express from "express";
import cors from "cors";
import { saveNaverSession, publishNaver, naverSessionExists, getNaverCategories, reloginNaverSilent } from "./naver";
import { saveTistorySession, publishTistory, tistorySessionExists, getTistoryCategories, reloginTistorySilent } from "./tistory";
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
  res.json({ ok: true, version: "2.1.0", running, queued: waitQueue.length });
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

/* ── 세션 상태 확인 ── */
app.get("/api/session-status/:userId", (req, res) => {
  const { userId } = req.params;
  res.json({
    naver: naverSessionExists(userId),
    tistory: tistorySessionExists(userId),
  });
});

/* ── 카테고리 조회 ── */
app.get("/api/naver/categories/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const categories = await getNaverCategories(userId);
    res.json({ success: true, categories });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, categories: [] });
  }
});

app.get("/api/tistory/categories/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const categories = await getTistoryCategories(userId);
    res.json({ success: true, categories });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, categories: [] });
  }
});

/* ── 직접 발행 (앱에서 즉시/예약 발행) ── */
app.post("/api/publish-full", async (req, res) => {
  const {
    userId, platform, title, content, tags = [],
    imageUrl,
    categoryId,
    visibility = "public",
    scheduleTime,
  } = req.body;

  if (!userId || !platform || !title || !content) {
    return res.status(400).json({ error: "userId, platform, title, content 필요" });
  }

  await acquireSlot();
  try {
    let postUrl = "";

    const publishParams = { userId, title, content, tags, imageUrl, categoryId, visibility, scheduleTime };

    if (platform === "naver") {
      postUrl = await publishNaver(publishParams);
    } else if (platform === "tistory") {
      postUrl = await publishTistory(publishParams);
    } else {
      return res.status(400).json({ error: "platform은 naver 또는 tistory" });
    }

    await addHistory({ user_id: userId, platform, title, post_url: postUrl, status: "success" });
    res.json({ success: true, postUrl });
  } catch (e: any) {
    // ── 세션 만료 자동 재로그인 1회 재시도 ──
    if (e.message?.includes("세션 만료") || e.message?.includes("재연결")) {
      console.log(`[server] 세션 만료 감지 → 자동 재로그인 시도 (${platform})`);
      try {
        let relogined = false;
        if (platform === "naver") relogined = await reloginNaverSilent(userId);
        else if (platform === "tistory") relogined = await reloginTistorySilent(userId);

        if (relogined) {
          console.log("[server] 재로그인 성공 → 발행 재시도");
          const publishParams = { userId, title, content: req.body.content, tags: req.body.tags || [],
            imageUrl: req.body.imageUrl, categoryId: req.body.categoryId,
            visibility: req.body.visibility || "public", scheduleTime: req.body.scheduleTime };
          let retryUrl = "";
          if (platform === "naver") retryUrl = await publishNaver(publishParams);
          else retryUrl = await publishTistory(publishParams);
          await addHistory({ user_id: userId, platform, title, post_url: retryUrl, status: "success" });
          return res.json({ success: true, postUrl: retryUrl });
        }
      } catch (retryErr: any) {
        console.error("[server] 재시도 실패:", retryErr.message);
      }
      // 재로그인 실패 → 사용자에게 재연결 요청
      await addHistory({ user_id: userId, platform, title, status: "fail", error_message: "세션 만료. 계정 재연결 필요" });
      return res.status(401).json({ error: "세션 만료. 앱에서 계정을 재연결해주세요.", code: "SESSION_EXPIRED" });
    }

    await addHistory({ user_id: userId, platform, title, status: "fail", error_message: e.message });
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
        if (!ok) { await updateJob(job.id, { status: "fail", error: "쿼터 초과" }); continue; }

        const publishParams = {
          userId: job.user_id, title: job.title, content: job.content, tags: job.tags,
          imageUrl: (job as any).image_url,
          categoryId: (job as any).category_id,
          visibility: (job as any).visibility || "public",
          scheduleTime: (job as any).schedule_time,
        };

        let postUrl = "";
        if (job.platform === "naver") postUrl = await publishNaver(publishParams);
        else if (job.platform === "tistory") postUrl = await publishTistory(publishParams);

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

/* ── 유저 등록 ── */
app.post("/api/register-user", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId 필요" });
  setCurrentUser(userId);
  res.json({ success: true });
});

/* ── 서버 시작 ── */
app.listen(PORT, () => {
  console.log(`[bot] Publy 봇 서버 v2.1 → http://localhost:${PORT}`);
});

export default app;
