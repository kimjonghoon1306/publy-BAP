import express from "express";
import cors from "cors";
import { saveSession, sessionExists, crawlBlogIds, addNeighbors, NeighborResult, donePath, engageBlogs, EngageResult, engageDonePath } from "./naver";
import { checkNeighborQuota, incrementNeighborQuota, getNeighborDailyUsage, getUserPlan, NEIGHBOR_DAILY_LIMIT, addNeighborHistory } from "./supabase";
import fs from "fs";

const app = express();
const PORT = 3334;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

/* ── 헬스체크 ── */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "1.0.0", service: "neighbor-bot" });
});

/* ── 세션 상태 ── */
app.get("/api/session/:accountId", (req, res) => {
  const { accountId } = req.params;
  res.json({ exists: sessionExists(accountId) });
});

/* ── 로그인 (세션 저장) ── */
app.post("/api/login", async (req, res) => {
  const { accountId, id, pw } = req.body;
  if (!accountId || !id || !pw)
    return res.status(400).json({ success: false, error: "accountId, id, pw 필요" });
  try {
    const result = await saveSession(accountId, id, pw);
    res.json({ success: true, blogId: result.blogId });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── 쿼타 조회 ── */
app.get("/api/quota/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const plan = await getUserPlan(userId);
    const used = await getNeighborDailyUsage(userId);
    const limit = NEIGHBOR_DAILY_LIMIT[plan] ?? NEIGHBOR_DAILY_LIMIT.free;
    res.json({ ok: true, used, limit, plan, remaining: Math.max(0, limit - used) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── SSE 헬퍼 ── */
function sseSetup(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}
function sseSend(res: express.Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/* ── 작업 중단 신호 맵 ── */
const stopMap = new Map<string, boolean>();

app.post("/api/stop/:jobId", (req, res) => {
  stopMap.set(req.params.jobId, true);
  res.json({ ok: true });
});

/* ── 블로그 수집 (SSE) ── */
app.get("/api/crawl", async (req, res) => {
  const { userId, keywords, countPerKeyword, orderBy, activeDays, excludeMarket } = req.query as Record<string, string>;
  if (!keywords)
    return res.status(400).json({ error: "keywords 필요" });

  sseSetup(res);

  try {
    // 쿼타 체크 (userId 있을 때만)
    if (userId) {
      const plan = await getUserPlan(userId);
      const quota = await checkNeighborQuota(userId, plan);
      if (!quota.ok) {
        sseSend(res, { type: "quota_exceeded", used: quota.used, limit: quota.limit });
        res.end();
        return;
      }
      sseSend(res, { type: "quota_info", used: quota.used, limit: quota.limit, remaining: quota.limit - quota.used });
    }

    const kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean);
    const count = parseInt(countPerKeyword || "30", 10);

    const results = await crawlBlogIds({
      accountId: "",
      keywords: kwList,
      countPerKeyword: count,
      orderBy: orderBy === "sim" ? "sim" : "recentdate",
      activeDays: activeDays ? parseInt(activeDays, 10) : 0,
      excludeMarket: excludeMarket !== "false",
      onLog: (msg) => sseSend(res, { type: "log", msg }),
    });

    sseSend(res, { type: "crawl_done", results });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 서이추 신청 (SSE) ── */
app.get("/api/add-neighbor", async (req, res) => {
  const {
    userId, accountId, targets: targetsRaw, message,
    delayMin, delayMax, skipDone, jobId,
  } = req.query as Record<string, string>;

  if (!accountId || !targetsRaw)
    return res.status(400).json({ error: "accountId, targets 필요" });

  sseSetup(res);

  const jid = jobId || Date.now().toString();
  stopMap.set(jid, false);

  try {
    const targets = JSON.parse(decodeURIComponent(targetsRaw));

    // 쿼타 체크 (userId 있을 때)
    let dailyLimit = 100;
    if (userId) {
      const plan = await getUserPlan(userId);
      const quota = await checkNeighborQuota(userId, plan);
      dailyLimit = quota.limit - quota.used; // 오늘 남은 한도만큼
      if (dailyLimit <= 0) {
        sseSend(res, { type: "quota_exceeded", used: quota.used, limit: quota.limit });
        res.end();
        return;
      }
      sseSend(res, { type: "quota_info", used: quota.used, limit: quota.limit, remaining: dailyLimit });
    }

    await addNeighbors({
      accountId,
      targets,
      message: message || "안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊",
      delayMin: parseFloat(delayMin || "5"),
      delayMax: parseFloat(delayMax || "10"),
      dailyLimit,
      skipDone: skipDone === "true",
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r: NeighborResult) => {
        sseSend(res, { type: "result", ...r });
        // 신청 성공 시 쿼타 증가 + 히스토리 저장
        if (r.status === "success" && userId) {
          await incrementNeighborQuota(userId);
          await addNeighborHistory({ user_id: userId, keyword: r.keyword, target_blog_id: r.blogId, status: "success", message: r.message });
        } else if ((r.status === "fail" || r.status === "skip") && userId) {
          await addNeighborHistory({ user_id: userId, keyword: r.keyword, target_blog_id: r.blogId, status: r.status === "fail" ? "fail" : "skip", message: r.message });
        }
      },
      onProgress: (done, fail) => sseSend(res, { type: "progress", done, fail }),
      stopSignal: () => stopMap.get(jid) === true,
    });

    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  stopMap.delete(jid);
  res.end();
});

/* ── 완료 목록 조회 ── */
app.get("/api/done/:accountId", (req, res) => {
  const dp = donePath(req.params.accountId);
  try {
    const list = fs.existsSync(dp) ? JSON.parse(fs.readFileSync(dp, "utf-8")) : [];
    res.json({ list });
  } catch {
    res.json({ list: [] });
  }
});

/* ── 완료 목록 초기화 ── */
app.delete("/api/done/:accountId", (req, res) => {
  const dp = donePath(req.params.accountId);
  try { if (fs.existsSync(dp)) fs.unlinkSync(dp); } catch {}
  res.json({ ok: true });
});

/* ── 공감·댓글용 키워드 수집 (SSE) ── */
app.get("/api/engage-crawl", async (req, res) => {
  const { keywords, countPerKeyword } = req.query as Record<string, string>;
  if (!keywords) return res.status(400).json({ error: "keywords 필요" });

  sseSetup(res);
  try {
    const kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean);
    const count = parseInt(countPerKeyword || "20", 10);
    const results = await crawlBlogIds({
      accountId: "",
      keywords: kwList,
      countPerKeyword: count,
      onLog: (msg) => sseSend(res, { type: "log", msg }),
    });
    sseSend(res, { type: "crawl_done", results });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 공감·댓글 작업 (SSE) ── */
app.get("/api/engage", async (req, res) => {
  const {
    accountId, targets: targetsRaw, comment,
    doLike, doComment, periodDays, postsPerBlog,
    delayMin, delayMax, dailyLimit, skipDone, jobId,
  } = req.query as Record<string, string>;

  if (!accountId || !targetsRaw)
    return res.status(400).json({ error: "accountId, targets 필요" });

  sseSetup(res);
  const jid = jobId || Date.now().toString();
  stopMap.set(jid, false);

  try {
    const targets = JSON.parse(decodeURIComponent(targetsRaw));
    sseSend(res, { type: "start", total: targets.length });

    await engageBlogs({
      accountId,
      targets,
      comment: comment || "",
      doLike: doLike !== "false",
      doComment: doComment !== "false" && !!(comment?.trim()),
      periodDays: parseInt(periodDays || "7", 10),
      postsPerBlog: parseInt(postsPerBlog || "1", 10),
      delayMin: parseFloat(delayMin || "5"),
      delayMax: parseFloat(delayMax || "10"),
      dailyLimit: parseInt(dailyLimit || "50", 10),
      skipDone: skipDone === "true",
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r: EngageResult) => {
        sseSend(res, { type: "result", ...r });
      },
      onProgress: (done, fail) => sseSend(res, { type: "progress", done, fail }),
      stopSignal: () => stopMap.get(jid) === true,
    });

    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  stopMap.delete(jid);
  res.end();
});

/* ── 공감·댓글 완료 목록 조회/초기화 ── */
app.get("/api/engage-done/:accountId", (req, res) => {
  const dp = engageDonePath(req.params.accountId);
  try {
    const list = fs.existsSync(dp) ? JSON.parse(fs.readFileSync(dp, "utf-8")) : [];
    res.json({ list });
  } catch { res.json({ list: [] }); }
});

app.delete("/api/engage-done/:accountId", (req, res) => {
  const dp = engageDonePath(req.params.accountId);
  try { if (fs.existsSync(dp)) fs.unlinkSync(dp); } catch {}
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[neighbor-bot] 서버 시작 → http://localhost:${PORT}`);
});

export default app;
