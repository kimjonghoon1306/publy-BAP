import express from "express";
import cors from "cors";
import { saveSession, sessionExists, removeSession, crawlBlogIds, crawlBuddyPosts, analyzeBuddyKeywords, addNeighbors, NeighborResult, donePath, engageBlogs, EngageResult, engageDonePath, getNeighborDailyCount, NEIGHBOR_SAFE_DAILY_LIMIT } from "./naver";
import { checkNeighborQuota, incrementNeighborQuota, getNeighborDailyUsage, incrementEngageQuota, getEngageDailyUsage, getUserPlan, NEIGHBOR_DAILY_LIMIT, addNeighborHistory } from "./supabase";
import fs from "fs";

const app = express();
const PORT = 3334;
const AUTH_TOKEN = process.env.BOT_AUTH_TOKEN || "";

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173", "null"] }));
app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  if (req.get("Authorization") === `Bearer ${AUTH_TOKEN}`) return next();
  res.status(401).json({ error: "Unauthorized" });
});

/* ── 헬스체크 ── */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "1.0.0", service: "neighbor-bot" });
});

/* ── 세션 상태 ── */
app.get("/api/session/:accountId", (req, res) => {
  const { accountId } = req.params;
  res.json({ exists: sessionExists(accountId) });
});

/* ── 세션 삭제 (계정 삭제) ── */
app.delete("/api/session/:accountId", (req, res) => {
  try { removeSession(req.params.accountId); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── 내 이웃 키워드 분석 (이웃들이 자주 쓰는 주제) ── */
app.get("/api/buddy-keywords/:accountId", async (req, res) => {
  const { accountId } = req.params;
  if (!sessionExists(accountId)) return res.status(400).json({ error: "계정 연결 필요" });
  try {
    const keywords = await analyzeBuddyKeywords({ accountId, scanCount: 120 });
    res.json({ ok: true, keywords });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
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

/* ── 자동 정리: 한 번에 작업 하나만. 새 작업 시작 시 이전 작업 전부 중단(브라우저는 각 job의 finally에서 닫힘) ── */
const activeJobs = new Set<string>();
function stopAllActiveJobs(exceptJid?: string) {
  for (const j of activeJobs) {
    if (j !== exceptJid) stopMap.set(j, true);
  }
  activeJobs.clear();
}
// SSE 작업 시작 등록: 이전 작업 자동 중단 + 클라이언트 연결 끊기면 자동 중단(기능 전환/탭이동에도 안전)
//   ★ req.on("close")는 POST body 수신 완료 시점에도 발동 → 자기 작업을 즉시 중단시키는 버그.
//     실제 "연결 끊김"은 res.on("close")로 감지해야 함.
function beginJob(jid: string, res: express.Response) {
  stopAllActiveJobs();          // 서이추→공감댓글 등 전환 시 이전 작업 클린 종료
  stopMap.set(jid, false);
  activeJobs.add(jid);
  res.on("close", () => { stopMap.set(jid, true); activeJobs.delete(jid); }); // 화면 벗어남/전환 시 자동 중단
}
function endJob(jid: string) {
  activeJobs.delete(jid);
  stopMap.delete(jid);
}

app.post("/api/stop/:jobId", (req, res) => {
  stopMap.set(req.params.jobId, true);
  res.json({ ok: true });
});

/* ── 블로그 수집 (SSE) ── */
app.get("/api/crawl", async (req, res) => {
  const { userId, keywords, countPerKeyword, orderBy, activeDays, excludeMarket } = req.query as Record<string, string>;
  if (!keywords)
    return res.status(400).json({ error: "keywords 필요" });

  stopAllActiveJobs();   // 새 수집 시작 → 이전 작업(서이추/공감댓글) 자동 중단
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
app.post("/api/add-neighbor", async (req, res) => {
  const {
    userId, accountId, targets: targetsRaw, message,
    delayMin, delayMax, skipDone, qualityFilter, retryDays, jobId,
  } = req.body as Record<string, any>;

  if (!accountId || !targetsRaw)
    return res.status(400).json({ error: "accountId, targets 필요" });

  sseSetup(res);

  const jid = jobId || Date.now().toString();
  beginJob(jid, res);   // 이전 작업 자동 중단 + 연결 끊기면 자동 정리

  try {
    // targets는 이제 body로 배열째 옴 (문자열이면 파싱 폴백)
    const targets = Array.isArray(targetsRaw) ? targetsRaw : JSON.parse(decodeURIComponent(targetsRaw));

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
      delayMin: parseFloat(String(delayMin ?? "5")),
      delayMax: parseFloat(String(delayMax ?? "10")),
      dailyLimit,
      skipDone: skipDone === true || skipDone === "true",
      qualityFilter: qualityFilter !== false && qualityFilter !== "false",   // 기본 ON
      retryDays: retryDays === undefined ? 30 : parseInt(String(retryDays), 10),
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
      onLimit: (info) => sseSend(res, { type: "daily_limit", count: info.count, limit: info.limit }),
      stopSignal: () => stopMap.get(jid) === true,
    });

    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  endJob(jid);
  res.end();
});

/* ── 오늘 서이추 안전 한도 현황 (계정 보호용, 자정 리셋) ── */
app.get("/api/daily/:accountId", (req, res) => {
  const d = getNeighborDailyCount(req.params.accountId);
  res.json({ ...d, limit: NEIGHBOR_SAFE_DAILY_LIMIT });
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

/* ── 공감·댓글용 수집 (SSE) — source=keyword(기본) | buddy(내 이웃새글) ── */
app.get("/api/engage-crawl", async (req, res) => {
  const { keywords, countPerKeyword, source, accountId } = req.query as Record<string, string>;
  const isBuddy = source === "buddy";
  if (!isBuddy && !keywords) return res.status(400).json({ error: "keywords 필요" });
  if (isBuddy && !accountId) return res.status(400).json({ error: "accountId 필요(이웃새글)" });

  stopAllActiveJobs();   // 새 수집 시작 → 이전 작업(서이추/공감댓글) 자동 중단
  sseSetup(res);
  try {
    const count = parseInt(countPerKeyword || "20", 10);
    let results;
    if (isBuddy) {
      // 내 서로이웃들의 최근 글 → 이웃 블로거 수집 (키워드 불필요)
      results = await crawlBuddyPosts({
        accountId,
        maxCount: Math.max(count, 30),
        onLog: (msg) => sseSend(res, { type: "log", msg }),
      });
    } else {
      const kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean);
      results = await crawlBlogIds({
        accountId: "",
        keywords: kwList,
        countPerKeyword: count,
        onLog: (msg) => sseSend(res, { type: "log", msg }),
      });
    }
    sseSend(res, { type: "crawl_done", results });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 공감·댓글 작업 (SSE) ── */
app.post("/api/engage", async (req, res) => {
  const {
    userId, accountId, targets: targetsRaw, comment,
    doLike, doComment, periodDays, postsPerBlog,
    delayMin, delayMax, dailyLimit, skipDone, commentRate, likeRate, jobId,
  } = req.body as Record<string, any>;

  if (!accountId || !targetsRaw)
    return res.status(400).json({ error: "accountId, targets 필요" });

  sseSetup(res);
  const jid = jobId || Date.now().toString();
  beginJob(jid, res);   // 이전 작업(서이추 등) 자동 중단 + 연결 끊기면 자동 정리

  try {
    const targets = Array.isArray(targetsRaw) ? targetsRaw : JSON.parse(decodeURIComponent(targetsRaw));
    sseSend(res, { type: "start", total: targets.length });

    await engageBlogs({
      accountId,
      targets,
      comment: comment || "",
      doLike: doLike !== false && doLike !== "false",
      doComment: doComment !== false && doComment !== "false" && !!(comment?.trim()),
      periodDays: parseInt(String(periodDays ?? "7"), 10),
      postsPerBlog: parseInt(String(postsPerBlog ?? "1"), 10),
      delayMin: parseFloat(String(delayMin ?? "5")),
      delayMax: parseFloat(String(delayMax ?? "10")),
      dailyLimit: parseInt(String(dailyLimit ?? "50"), 10),
      skipDone: skipDone === true || skipDone === "true",
      commentRate: commentRate === undefined ? 100 : parseInt(String(commentRate), 10),
      likeRate: likeRate === undefined ? 100 : parseInt(String(likeRate), 10),
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r: EngageResult) => {
        sseSend(res, { type: "result", ...r });
        // ★ 통과(성공)한 것만 상단 하루 카운트 증가
        if (r.status === "success" && userId) {
          await incrementEngageQuota(userId);
          const used = await getEngageDailyUsage(userId);
          sseSend(res, { type: "quota_info", used });
        }
      },
      onProgress: (done, fail) => sseSend(res, { type: "progress", done, fail }),
      stopSignal: () => stopMap.get(jid) === true,
    });

    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  endJob(jid);
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[neighbor-bot] 서버 시작 → http://localhost:${PORT}`);
});

export default app;
