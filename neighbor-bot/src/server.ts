import express from "express";
import cors from "cors";
import { saveSession, sessionExists, removeSession, crawlBlogIds, crawlBuddyPosts, analyzeBuddyKeywords, addNeighbors, NeighborResult, donePath, engageBlogs, EngageResult, engageDonePath, crawlMyPosts, replyToComments, crawlBlogStats, checkSelectedBlogExposure, pumasiEngage, crawlPumasiReport, pumasiPreview, updatePostTitle, checkProxy, analyzeBlogAuthenticity, fetchPostBody, crawlPostViews } from "./naver";
import { checkNeighborQuota, incrementNeighborQuota, getNeighborDailyUsage, incrementEngageQuota, getEngageDailyUsage, getUserPlan, NEIGHBOR_DAILY_LIMIT, addNeighborHistory, addReplyHistory, addBlogscoreHistory, incrementPumasiQuota, TITLE_EDIT_DAILY_LIMIT, getTitleEditDailyUsage, incrementTitleEditQuota, getProxyForAccount, supabase, getOutreachSender, getOutreachSentToday, addOutreachLog } from "./supabase";
import nodemailer from "nodemailer";
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
      ownerUserId: userId || null,   // 🔒 크롤링 프록시: 이 회원에 crawl 토글이 켜져 있으면 그 IP로 접속
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
    delayMin, delayMax, skipDone, qualityFilter, retryDays, minVisitors, maxVisitors, searchEntry, jobId,
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
      ownerUserId: userId,
      targets,
      message: message || "안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊",
      delayMin: parseFloat(String(delayMin ?? "5")),
      delayMax: parseFloat(String(delayMax ?? "10")),
      dailyLimit,
      skipDone: skipDone === true || skipDone === "true",
      qualityFilter: qualityFilter !== false && qualityFilter !== "false",   // 기본 ON
      retryDays: retryDays === undefined ? 30 : parseInt(String(retryDays), 10),
      minVisitors: Math.max(0, parseInt(String(minVisitors ?? "0"), 10) || 0),
      maxVisitors: Math.max(0, parseInt(String(maxVisitors ?? "0"), 10) || 0),
      searchEntry: searchEntry === true || searchEntry === "true",
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
  endJob(jid);
  res.end();
});

/* ── 완료 목록 조회 ── */
app.get("/api/done/:accountId", (req, res) => {
  const dp = donePath(req.params.accountId);
  try {
    const raw = fs.existsSync(dp) ? JSON.parse(fs.readFileSync(dp, "utf-8")) : [];
    const list = Array.isArray(raw) ? raw : Object.keys(raw);   // 신형식({blogId:date})도 blogId 목록으로 반환
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

/* ── 블로그 건강검진: 내 블로그 지표 크롤 (SSE) ── */
app.get("/api/blog-stats", async (req, res) => {
  const { accountId, plan, userId } = req.query as Record<string, string>;
  if (!accountId) return res.status(400).json({ error: "accountId 필요" });
  sseSetup(res);
  try {
    const stats = await crawlBlogStats({ accountId, plan, onLog: (msg) => sseSend(res, { type: "log", msg }) });
    sseSend(res, { type: "stats", stats });
    if (userId) await addBlogscoreHistory({ user_id: userId, blog_id: stats.blogId, total_posts: stats.totalPosts, neighbors: stats.neighbors, low_quality_suspected: stats.lowQualitySuspected });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

/* ── 🩺 P4: 글별 조회수 수집 (통계 조회수 순위 페이지 파싱) ── */
app.post("/api/post-views", async (req, res) => {
  const { accountId } = req.body || {};
  if (!accountId) return res.status(400).json({ ok: false, error: "accountId 필요" });
  try {
    const views = await crawlPostViews({ accountId, onLog: (msg) => console.log(msg) });
    res.json({ ok: true, views });
  } catch (e: any) {
    console.error(`[post-views] 실패: ${e.message || e}`);
    res.status(400).json({ ok: false, error: e.message || "조회수 수집 실패" });
  }
});

/* ── 블로그 건강검진 2단계: 사용자가 선택한 글만 검색 노출 검사 ── */
app.post("/api/exposure-check", async (req, res) => {
  const { accountId, plan, logNos } = req.body as { accountId?: string; plan?: string; logNos?: string[] };
  if (!accountId) return res.status(400).json({ error: "accountId 필요" });
  if (!Array.isArray(logNos) || !logNos.length) return res.status(400).json({ error: "검사할 logNos 필요" });
  try {
    const result = await checkSelectedBlogExposure({ accountId, plan, logNos });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── 답방 ①: 내 블로그 글 목록 불러오기 (SSE) ── */
app.get("/api/my-posts", async (req, res) => {
  const { accountId, selectMode, count, period } = req.query as Record<string, string>;
  if (!accountId) return res.status(400).json({ error: "accountId 필요" });
  stopAllActiveJobs();
  sseSetup(res);
  try {
    const posts = await crawlMyPosts({
      accountId,
      selectMode: (selectMode === "all" || selectMode === "period") ? selectMode : "count",
      count: parseInt(count || "10", 10),
      period: parseInt(period || "7", 10),
      onLog: (msg) => sseSend(res, { type: "log", msg }),
    });
    sseSend(res, { type: "posts", posts });
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
    aiComment, commentTone, geminiKey, minVisitors, maxVisitors, searchEntry,
  } = req.body as Record<string, any>;
  const isAiComment = aiComment === true || aiComment === "true";

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
      ownerUserId: userId,
      targets,
      comment: comment || "",
      doLike: doLike !== false && doLike !== "false",
      doComment: doComment !== false && doComment !== "false" && (isAiComment || !!(comment?.trim())),
      aiComment: isAiComment,
      commentTone: commentTone || "다정",
      geminiKey: geminiKey || "",
      periodDays: parseInt(String(periodDays ?? "7"), 10),
      postsPerBlog: parseInt(String(postsPerBlog ?? "1"), 10),
      delayMin: parseFloat(String(delayMin ?? "5")),
      delayMax: parseFloat(String(delayMax ?? "10")),
      dailyLimit: parseInt(String(dailyLimit ?? "50"), 10),
      skipDone: skipDone === true || skipDone === "true",
      commentRate: commentRate === undefined ? 100 : parseInt(String(commentRate), 10),
      likeRate: likeRate === undefined ? 100 : parseInt(String(likeRate), 10),
      minVisitors: Math.max(0, parseInt(String(minVisitors ?? "0"), 10) || 0),
      maxVisitors: Math.max(0, parseInt(String(maxVisitors ?? "0"), 10) || 0),
      searchEntry: searchEntry === true || searchEntry === "true",
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

/* ── 답방 ②: 내 글 댓글에 대댓글(답글) 작업 (SSE) ── */
app.post("/api/reply", async (req, res) => {
  const { userId, accountId, posts, mode, comment, tone, onlyNew, delayMin, delayMax, geminiKey, jobId } = req.body as Record<string, any>;
  if (!accountId || !Array.isArray(posts) || posts.length === 0)
    return res.status(400).json({ error: "accountId, posts 필요" });
  sseSetup(res);
  const jid = jobId || Date.now().toString();
  beginJob(jid, res);
  try {
    sseSend(res, { type: "start", total: posts.length });
    await replyToComments({
      accountId,
      ownerUserId: userId,
      posts,
      mode: mode === "fixed" ? "fixed" : "ai",
      comment: comment || "댓글 감사합니다 😊",
      tone: tone || "다정",
      onlyNew: onlyNew !== false && onlyNew !== "false",
      delayMin: parseFloat(String(delayMin ?? "5")),
      delayMax: parseFloat(String(delayMax ?? "10")),
      geminiKey: geminiKey || "",
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r) => {
        sseSend(res, { type: "result", ...r });
        if (userId) await addReplyHistory({ user_id: userId, post_title: r.postTitle || "", status: r.status, message: r.message || "" });
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

/* ── 품앗이: 내 계정들끼리 서로 공감·댓글 (SSE) ── */
app.post("/api/pumasi", async (req, res) => {
  const { userId, accounts, comment, doLike, doComment, aiComment, commentTone, geminiKey, delayMin, delayMax, readRelated, readRelatedMode, readSpeed, periodDays, searchEntry, searchKeyword, spreadHours, jobId } = req.body as Record<string, any>;
  if (!Array.isArray(accounts) || accounts.length < 2)
    return res.status(400).json({ error: "품앗이는 계정 2개 이상 필요" });
  sseSetup(res);
  const jid = jobId || Date.now().toString();
  beginJob(jid, res);
  try {
    sseSend(res, { type: "start", total: accounts.length });
    await pumasiEngage({
      ownerUserId: userId,
      accounts: accounts.map((a: any) => ({ accountId: String(a.accountId), blogId: String(a.blogId), posts: parseInt(String(a.posts ?? "3"), 10) || 3, receiveLimit: Math.max(0, parseInt(String(a.receiveLimit ?? "3"), 10) || 0), noGive: !!a.noGive })),   // 받기 0=안받기, noGive=안가기
      comment: comment || "",
      doLike: doLike !== false && doLike !== "false",
      doComment: doComment !== false && doComment !== "false",
      aiComment: aiComment === true || aiComment === "true",
      commentTone: commentTone || "다정",
      geminiKey: geminiKey || "",
      delayMin: parseFloat(String(delayMin ?? "8")),
      delayMax: parseFloat(String(delayMax ?? "15")),
      readRelated: readRelated !== false && readRelated !== "false",
      readRelatedMode: readRelatedMode === "always" ? "always" : "random",
      readSpeed: readSpeed === "fast" ? "fast" : readSpeed === "normal" ? "normal" : "natural",
      periodDays: Math.max(0, parseInt(String(periodDays ?? "0"), 10) || 0),
      searchEntry: searchEntry === true || searchEntry === "true",
      searchKeyword: String(searchKeyword ?? "").slice(0, 80),
      spreadHours: Math.max(0, parseFloat(String(spreadHours ?? "0")) || 0),
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: async (r) => { sseSend(res, { type: "result", ...r }); if (userId && r.status === "success") await incrementPumasiQuota(userId); },
      onProgress: (done, fail, skip) => sseSend(res, { type: "progress", done, fail, skip }),
      stopSignal: () => stopMap.get(jid) === true,
    });
    sseSend(res, { type: "done" });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  endJob(jid);
  res.end();
});

/* ── 품앗이 효과 리포트: 방문자 추이 + 품앗이 실행일 상관 ── */
app.get("/api/pumasi-report", async (req, res) => {
  const blogId = String(req.query.blogId || "").trim();
  if (!blogId) return res.status(400).json({ error: "blogId 필요" });
  try {
    const report = await crawlPumasiReport(blogId, (m) => console.log(m));
    res.json(report);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 품앗이 시작 전 미리보기: 대상별 총 글 / 이미 댓글 단 글 / 남은 글 ── */
app.post("/api/pumasi-preview", async (req, res) => {
  const { accounts } = req.body as Record<string, any>;
  if (!Array.isArray(accounts)) return res.status(400).json({ error: "accounts 필요" });
  try {
    const rows = await pumasiPreview(accounts.map((a: any) => ({ accountId: String(a.accountId), blogId: String(a.blogId) })), (m) => console.log(m));
    res.json({ rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 제목 수정 한도 조회 ── */
app.get("/api/title-edit-quota/:userId", async (req, res) => {
  try {
    const plan = await getUserPlan(req.params.userId);
    const limit = TITLE_EDIT_DAILY_LIMIT[plan] ?? TITLE_EDIT_DAILY_LIMIT.free;
    const used = await getTitleEditDailyUsage(req.params.userId);
    res.json({ ok: true, used, limit, plan, remaining: Math.max(0, limit - used) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── 글 제목 자동 수정(재발행) — SSE로 모든 단계 로그를 실시간 전송 ── */
app.post("/api/update-title", async (req, res) => {
  const { userId, accountId, logNo, newTitle } = req.body as Record<string, any>;
  if (!accountId || !logNo || !newTitle) return res.status(400).json({ error: "accountId, logNo, newTitle 필요" });
  sseSetup(res);
  try {
    sseSend(res, { type: "log", msg: `✏️ 제목 수정 시작 — 글 ${logNo}` });
    // 등급 한도 체크
    if (userId) {
      const plan = await getUserPlan(userId);
      const limit = TITLE_EDIT_DAILY_LIMIT[plan] ?? TITLE_EDIT_DAILY_LIMIT.free;
      const used = await getTitleEditDailyUsage(userId);
      if (used >= limit) {
        sseSend(res, { type: "log", msg: `⛔ 오늘 제목 수정 한도(${limit}회)를 모두 사용했어요` });
        sseSend(res, { type: "done", ok: false, message: `오늘 제목 수정 한도(${limit}회)를 모두 사용했어요. 자정에 초기화됩니다.`, quotaExceeded: true });
        return res.end();
      }
    }
    const result = await updatePostTitle({ accountId: String(accountId), logNo: String(logNo), newTitle: String(newTitle), onLog: (m) => sseSend(res, { type: "log", msg: m }) });
    if (result.ok && userId) await incrementTitleEditQuota(userId);
    sseSend(res, { type: "done", ok: result.ok, message: result.message });
  } catch (e: any) {
    sseSend(res, { type: "log", msg: `❌ 제목 수정 오류: ${e.message}` });
    sseSend(res, { type: "done", ok: false, message: e.message });
  }
  res.end();
});

/* ── 공감·댓글 완료 목록 조회/초기화 ── */
app.get("/api/engage-done/:accountId", (req, res) => {
  const dp = engageDonePath(req.params.accountId);
  try {
    const raw = fs.existsSync(dp) ? JSON.parse(fs.readFileSync(dp, "utf-8")) : [];
    const list = Array.isArray(raw) ? raw : Object.keys(raw);   // 신형식({blogId:date})도 blogId 목록으로 반환
    res.json({ list });
  } catch { res.json({ list: [] }); }
});

app.delete("/api/engage-done/:accountId", (req, res) => {
  const dp = engageDonePath(req.params.accountId);
  try { if (fs.existsSync(dp)) fs.unlinkSync(dp); } catch {}
  res.json({ ok: true });
});

// ── 회원 프록시 상태: 이 회원(user_id)에게 배정된 프록시가 있는지 (대시보드 노란불용) ──
app.get("/api/my-proxy/:userId", async (req, res) => {
  try {
    // ①회원 본인 id에 배정됐는지 ②없으면 회원의 연결 계정(accts=accountId 목록) 중 하나라도
    //   배정됐는지 확인 → 봇이 실제로 프록시를 쓰는 조건과 노란불을 일치시킨다.
    let px = await getProxyForAccount(req.params.userId);
    if (!px && req.query.accts) {
      const accts = String(req.query.accts).split(",").map(s => s.trim()).filter(Boolean);
      for (const aid of accts) { px = await getProxyForAccount(aid); if (px) break; }
    }
    res.json({ active: !!px });
  } catch { res.json({ active: false }); }
});

// ── 프록시 헬스체크: 주어진 프록시로 실제 나가는 IP·응답속도 확인(관리자 상태판용) ──
app.post("/api/proxy-check", async (req, res) => {
  try {
    const { server, username, password } = req.body || {};
    if (!server) return res.status(400).json({ ok: false, error: "server(주소:포트)가 필요해요" });
    const r = await checkProxy({ server, username, password });
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "검사 실패" });
  }
});

/* ═══ 📧 아웃리치(체험단 제안) — 발신계정 + 이메일 실발송 + 이력 ═══ */

// 발신 계정 조회(비번은 등록여부만, 값은 숨김)
app.get("/api/outreach/sender/:userId", async (req, res) => {
  try {
    const s = await getOutreachSender(req.params.userId);
    if (!s) return res.json({ ok: true, sender: null });
    res.json({ ok: true, sender: { from_name: s.from_name, from_email: s.from_email, smtp_host: s.smtp_host, smtp_port: s.smtp_port, smtp_user: s.smtp_user, daily_limit: s.daily_limit, has_pass: !!s.smtp_pass } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 발신 계정 저장(회원별). SMTP 연결 검증 후 저장.
app.post("/api/outreach/sender", async (req, res) => {
  const { userId, from_name, from_email, smtp_host, smtp_port, smtp_user, smtp_pass, daily_limit } = req.body || {};
  if (!userId || !from_email || !smtp_user || !smtp_pass) return res.status(400).json({ ok: false, error: "필수 항목(발신 이메일·아이디·비밀번호)을 채워주세요" });
  const host = smtp_host || "smtp.naver.com";
  const port = Number(smtp_port) || 465;
  console.log(`[sender] 발신계정 저장 시도 user=${userId} host=${host}:${port} user=${smtp_user} from=${from_email}`);
  try {
    // 실제 연결 검증(잘못된 비번이면 여기서 실패 → 저장 안 함)
    const tx = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: smtp_user, pass: smtp_pass } });
    await tx.verify();
    console.log(`[sender] ✅ SMTP 연결/로그인 성공 (${smtp_user}@${host})`);
    const { error } = await supabase.from("publy_outreach_sender").upsert({
      user_id: userId, from_name: from_name || null, from_email, smtp_host: host, smtp_port: port,
      smtp_user, smtp_pass, daily_limit: Number(daily_limit) || 50, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    console.log(`[sender] ✅ 저장 완료 user=${userId}`);
    res.json({ ok: true });
  } catch (e: any) {
    // 실패 원인을 로그에 그대로 남김(535/응답코드·서버 응답 전문 포함)
    const code = e.responseCode || e.code || "";
    console.error(`[sender] ❌ 저장 실패 user=${userId} host=${host}:${port} smtp_user=${smtp_user} code=${code} :: ${e.message || e}`);
    if (e.response) console.error(`[sender]    ↳ 서버 응답: ${e.response}`);
    const msg = /auth|credential|password|535/i.test(e.message || "") ? "로그인 실패 — 네이버 메일 '환경설정 → POP3/IMAP → IMAP/SMTP 사용'을 먼저 켜세요. 2단계 인증 쓰면 '앱 비밀번호 16자리'가 필요해요(로그인 비번 불가)." : e.message;
    res.status(400).json({ ok: false, error: msg });
  }
});

// 이메일 실발송(SSE) — 선택한 블로거들에게 개인화 발송. 블로그 창 안 열고 SMTP로 바로.
app.get("/api/outreach/send-email", async (req, res) => {
  const { userId, subject, message, targets } = req.query as Record<string, string>;
  sseSetup(res);
  const L = (msg: string) => sseSend(res, { type: "log", msg });   // 다른 탭처럼 매 단계 로그
  try {
    L("📧 이메일 발송 준비를 시작해요…");
    if (!userId) throw new Error("userId 필요");
    L("① 발신 이메일 계정을 확인하는 중…");
    const sender = await getOutreachSender(userId);
    if (!sender) { sseSend(res, { type: "error", msg: "먼저 발신 이메일 계정을 등록하세요" }); return res.end(); }
    L(`   → 발신 계정: ${sender.from_email} (${sender.smtp_host}:${sender.smtp_port})`);
    let list: any[] = [];
    try { list = JSON.parse(targets || "[]"); } catch {}
    const withEmail = list.filter(t => t.email);
    L(`② 받는 사람을 정리하는 중… 이메일 있는 대상 ${withEmail.length}명`);
    if (!withEmail.length) { sseSend(res, { type: "error", msg: "공개 이메일이 있는 대상이 없어요" }); return res.end(); }

    const sentToday = await getOutreachSentToday(userId);
    const remain = Math.max(0, sender.daily_limit - sentToday);
    L(`③ 오늘 발송 현황: 이미 ${sentToday}통 보냄 · 남은 한도 ${remain}통 (하루 ${sender.daily_limit}통)`);
    if (remain <= 0) { sseSend(res, { type: "error", msg: `오늘 발송 한도(${sender.daily_limit}통)를 다 썼어요. 내일 다시 해주세요.` }); return res.end(); }
    const todo = withEmail.slice(0, remain);
    if (withEmail.length > remain) L(`⚠️ 하루 한도 때문에 ${remain}명만 보냅니다(계정 안전). 나머지는 내일.`);

    L("④ 네이버 메일 서버에 로그인 연결하는 중…");
    const tx = nodemailer.createTransport({ host: sender.smtp_host, port: sender.smtp_port, secure: sender.smtp_port === 465, auth: { user: sender.smtp_user, pass: sender.smtp_pass } });
    try { await tx.verify(); L("   → ✅ 서버 연결 성공"); console.log(`[send] ✅ SMTP 로그인 성공 (${sender.smtp_user}@${sender.smtp_host})`); }
    catch (ve: any) {
      const code = ve.responseCode || ve.code || "";
      console.error(`[send] ❌ SMTP 로그인 실패 smtp_user=${sender.smtp_user} host=${sender.smtp_host}:${sender.smtp_port} code=${code} :: ${ve.message || ve}`);
      if (ve.response) console.error(`[send]    ↳ 서버 응답: ${ve.response}`);
      sseSend(res, { type: "error", msg: `메일 서버 로그인 실패 — 네이버 메일 '환경설정 → POP3/IMAP → IMAP/SMTP 사용'을 먼저 켜세요. 2단계 인증 쓰면 '앱 비밀번호 16자리' 필요 (${code || ""} ${(ve.message || "").slice(0, 50)})` });
      return res.end();
    }

    L(`⑤ 이제 ${todo.length}통을 3~6초 간격으로 한 통씩 보낼게요(계정 안전)…`);
    let ok = 0, fail = 0;
    for (let i = 0; i < todo.length; i++) {
      const t = todo[i];
      const who = t.nick || t.email;
      const nick = t.nick || "블로거";
      const subj = String(subject || "체험단 제안").replace(/\{닉네임\}/g, t.nick || "").replace(/\{관심키워드\}/g, (t.keywords?.[0] || "")).replace(/\{관심품목\}/g, (t.categories?.[0] || ""));
      const body = String(message || "").replace(/\{닉네임\}/g, nick).replace(/\{관심키워드\}/g, (t.keywords?.[0] || "관심 있으신 분야")).replace(/\{관심품목\}/g, (t.categories?.[0] || "관심 품목"));
      L(`✉️ (${i + 1}/${todo.length}) ${who} <${t.email}> 에게 보내는 중…`);
      try {
        await tx.sendMail({ from: sender.from_name ? `"${sender.from_name}" <${sender.from_email}>` : sender.from_email, to: t.email, subject: subj, text: body });
        ok++;
        await addOutreachLog({ user_id: userId, blog_id: t.id || t.blogId || "", nickname: t.nick, channel: "email", to_email: t.email, subject: subj, message: body, status: "sent" });
        L(`   → ✅ 발송 완료 (성공 ${ok} · 실패 ${fail})`);
        sseSend(res, { type: "sent", id: t.id });
      } catch (e: any) {
        fail++;
        await addOutreachLog({ user_id: userId, blog_id: t.id || t.blogId || "", nickname: t.nick, channel: "email", to_email: t.email, subject: subj, message: body, status: "failed", error: e.message });
        L(`   → ❌ 실패: ${e.message}`);
      }
      if (i < todo.length - 1) { const wait = 3000 + Math.random() * 3000; L(`   ⏳ 다음 발송까지 ${(wait / 1000).toFixed(1)}초 대기(계정 보호)…`); await new Promise(r => setTimeout(r, wait)); }
    }
    L(`🎉 발송 마무리 — 성공 ${ok}통 · 실패 ${fail}통`);
    sseSend(res, { type: "done", ok, fail });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

// 보낸글 이력 조회
app.get("/api/outreach/history/:userId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("publy_outreach").select("*").eq("user_id", req.params.userId).order("sent_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    res.json({ ok: true, history: data || [] });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// 🩺 진정성 정밀 분석(공개 정보, 세션 불필요) — blogIds 배치. SSE로 하나씩 결과 스트림.
app.get("/api/outreach/authenticity", async (req, res) => {
  const { blogIds } = req.query as Record<string, string>;
  sseSetup(res);
  try {
    let ids: string[] = [];
    try { ids = JSON.parse(blogIds || "[]"); } catch {}
    ids = ids.filter(Boolean).slice(0, 60);   // 과부하 방지
    for (const id of ids) {
      const r = await analyzeBlogAuthenticity(id);
      sseSend(res, { type: "auth", ...r });
      await new Promise(rs => setTimeout(rs, 250));   // 네이버 예의상 간격
    }
    sseSend(res, { type: "done", count: ids.length });
  } catch (e: any) {
    sseSend(res, { type: "error", msg: e.message });
  }
  res.end();
});

// 📄 글 본문 읽기 — 개선안 제안 시 제목만 보지 않게 실제 내용을 읽어 AI에 준다(공개, 세션 불필요)
app.get("/api/post-body", async (req, res) => {
  const { blogId, logNo } = req.query as Record<string, string>;
  if (!blogId || !logNo) return res.status(400).json({ ok: false, error: "blogId·logNo 필요" });
  try {
    const r = await fetchPostBody(blogId, logNo);
    res.json({ ok: true, ...r });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[neighbor-bot] 서버 시작 → http://localhost:${PORT}`);
});

export default app;
