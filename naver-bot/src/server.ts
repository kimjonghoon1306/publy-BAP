import express from "express";
import cors from "cors";
import { saveNaverSession, publishNaver, naverSessionExists } from "./naver";
import { saveTistorySession, publishTistory, tistorySessionExists } from "./tistory";
import { fetchPendingJobs, updateJob, addHistory, useQuota } from "./supabase";

const app = express();
const PORT = 3333;

app.use(cors());
app.use(express.json());

// ── 헬스체크 ────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "1.0.0", time: new Date().toISOString() });
});

// ── 세션 저장 (계정 연결) ────────────────────────────────
app.post("/api/naver/save-session", async (req, res) => {
  const { userId, id, pw } = req.body;
  if (!userId || !id || !pw) return res.status(400).json({ success: false, error: "userId, id, pw 필요" });
  try {
    await saveNaverSession(userId, id, pw);
    res.json({ success: true });
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

// ── 세션 상태 확인 ───────────────────────────────────────
app.get("/api/session-status/:userId", (req, res) => {
  const { userId } = req.params;
  res.json({
    naver: naverSessionExists(userId),
    tistory: tistorySessionExists(userId),
  });
});

// ── 직접 발행 (앱에서 즉시 발행) ────────────────────────
app.post("/api/publish-full", async (req, res) => {
  const { userId, platform, title, content, tags = [], imagePrompt } = req.body;
  if (!userId || !platform || !title || !content) {
    return res.status(400).json({ error: "userId, platform, title, content 필요" });
  }

  try {
    let postUrl = "";
    if (platform === "naver") {
      postUrl = await publishNaver({ userId, title, content, tags });
    } else if (platform === "tistory") {
      postUrl = await publishTistory({ userId, title, content, tags });
    } else {
      return res.status(400).json({ error: "platform은 naver 또는 tistory" });
    }

    await addHistory({ user_id: userId, platform, title, post_url: postUrl, status: "success" });
    res.json({ success: true, postUrl });
  } catch (e: any) {
    await addHistory({ user_id: userId, platform, title, status: "fail", error_message: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── Supabase Job Queue 폴링 ──────────────────────────────
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

      // 상태를 running으로
      await updateJob(job.id, { status: "running" });

      try {
        const ok = await useQuota(job.user_id);
        if (!ok) {
          await updateJob(job.id, { status: "fail", error: "쿼터 초과" });
          continue;
        }

        let postUrl = "";
        if (job.platform === "naver") {
          postUrl = await publishNaver({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags });
        } else if (job.platform === "tistory") {
          postUrl = await publishTistory({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags });
        }

        await updateJob(job.id, { status: "success", result_url: postUrl });
        await addHistory({ user_id: job.user_id, platform: job.platform, title: job.title, post_url: postUrl, status: "success" });
        console.log(`[bot] 발행 완료: ${postUrl}`);
      } catch (e: any) {
        await updateJob(job.id, { status: "fail", error: e.message });
        await addHistory({ user_id: job.user_id, platform: job.platform, title: job.title, status: "fail", error_message: e.message });
        console.error(`[bot] 발행 실패: ${e.message}`);
      }
    }
  } finally {
    isProcessing = false;
  }
}

// 10초마다 폴링
setInterval(processJobs, 10000);

// ── 유저 등록 엔드포인트 (Electron 앱에서 로그인 시 호출) ─
app.post("/api/register-user", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId 필요" });
  setCurrentUser(userId);
  res.json({ success: true });
});

// ── 서버 시작 ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[bot] 서버 시작 → http://localhost:${PORT}`);
  console.log(`[bot] Supabase 폴링 시작 (10초 간격)`);
});

export default app;
