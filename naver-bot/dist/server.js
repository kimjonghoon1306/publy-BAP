import express from "express";
import cors from "cors";
import fs from "fs-extra";
import path from "path";
import { saveNaverSession, publishNaver, naverSessionExists } from "./naver";
import { saveTistorySession, publishTistory, tistorySessionExists } from "./tistory";
import { fetchPendingJobs, fetchAllPendingJobs, updateJob, addHistory, useQuota } from "./supabase";

const app = express();
const PORT = 3333;

// Electron이 시작 시 랜덤 생성 후 환경변수로 주입하는 시크릿
const BOT_SECRET = process.env.BOT_SECRET;
if (!BOT_SECRET) {
  console.error("[bot] ⚠️  BOT_SECRET 환경변수 없음. API 인증이 비활성화됩니다 (개발 모드로 간주).");
}

app.use(cors({ origin: "http://localhost:5173" })); // 개발 서버만 허용
app.use(express.json());

/* ── API 인증 미들웨어 ── */
function requireSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!BOT_SECRET) return next(); // 시크릿 없으면 개발 모드 (로컬 only)
  const provided = req.headers["x-bot-secret"];
  if (provided !== BOT_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

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

/* ── 헬스체크 (인증 불필요) ── */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "2.0.0", running, queued: waitQueue.length });
});

/* ── 세션 저장 (계정 연결) ── */
app.post("/api/naver/save-session", requireSecret, async (req, res) => {
  const { userId, id, pw } = req.body;
  if (!userId || !id || !pw) return res.status(400).json({ success: false, error: "userId, id, pw 필요" });
  try {
    const result = await saveNaverSession(userId, id, pw);
    res.json({ success: true, blogId: result.blogId });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/api/tistory/save-session", requireSecret, async (req, res) => {
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
app.get("/api/session-status/:userId", requireSecret, (req, res) => {
  const { userId } = req.params;
  res.json({
    naver: naverSessionExists(userId),
    tistory: tistorySessionExists(userId),
  });
});

/* ── 직접 발행 (앱에서 즉시 발행) ── */
app.post("/api/publish-full", requireSecret, async (req, res) => {
  const { userId, platform, title, content, tags = [], imagePrompt } = req.body;
  if (!userId || !platform || !title || !content) {
    return res.status(400).json({ error: "userId, platform, title, content 필요" });
  }

  await acquireSlot();
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

    if (e.message?.includes("세션 만료") || e.message?.includes("재연결")) {
      return res.status(401).json({ error: e.message, code: "SESSION_EXPIRED" });
    }
    res.status(500).json({ error: e.message });
  } finally {
    releaseSlot();
  }
});

/* ── Supabase Job Queue 폴링 (다중 유저 지원) ── */
const registeredUsers = new Set<string>(); // 현재 로그인한 유저들
let isProcessing = false;

export function registerUser(userId: string) {
  registeredUsers.add(userId);
  console.log(`[bot] 유저 등록: ${userId} (총 ${registeredUsers.size}명)`);
}

export function unregisterUser(userId: string) {
  registeredUsers.delete(userId);
  console.log(`[bot] 유저 해제: ${userId}`);
}

async function processJobs() {
  if (registeredUsers.size === 0 || isProcessing) return;
  isProcessing = true;

  try {
    const jobs = await fetchAllPendingJobs([...registeredUsers]);
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
      } finally {
        releaseSlot();
      }
    }
  } finally {
    isProcessing = false;
  }
}

setInterval(processJobs, 10000);

/* ── 유저 등록/해제 (Electron에서 로그인/로그아웃 시 호출) ── */
app.post("/api/register-user", requireSecret, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId 필요" });
  registerUser(userId);
  res.json({ success: true });
});

app.post("/api/unregister-user", requireSecret, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId 필요" });
  unregisterUser(userId);
  res.json({ success: true });
});

/* ── 네이버 검색광고 키워드 API 프록시 ── */
app.post("/api/naver-keywords", requireSecret, async (req, res) => {
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
    const url = `https://api.naver.com/keywordstool?hintKeywords=${encodeURIComponent(keywords.join(","))}&showDetail=1`;
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
app.post("/api/naver-datalab", requireSecret, async (req, res) => {
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

/* ── 서버 시작 ── */
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[bot] Publy 봇 서버 v2.0 → http://127.0.0.1:${PORT}`);
});

export default app;
