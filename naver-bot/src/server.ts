import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { saveNaverSession, publishNaver, activateNaverAccount, naverSessionExists, generateFlowImages, generateFlowImagesCDP, getNaverCategories, saveGoogleSession, googleSessionExists, deleteNaverSession, deleteGoogleSession } from "./naver";
import { saveTistorySession, publishTistory, tistorySessionExists, deleteTistorySession } from "./tistory";
import { fetchPendingJobs, updateJob, claimPendingJob, finishQueuedHistory, useQuota, refundQuota, checkPublishEntitlement, incrementDailyPublish } from "./supabase";
import { acquireAccountLock } from "./account-lock";

/* ── 봇 자체 로그 파일 (버그 신고용) ──
   메인 프로세스가 아니라 "봇 프로세스가 자기 로그를 직접" 쓴다. 봇은 별도 프로세스라
   파일 I/O로 잠깐 바빠도 앱 화면(메인/렌더러)은 절대 안 멈춘다.
   비동기 append 스트림 1개로만 기록(줄마다 열지 않음). 회원이 문제 신고 시 이 파일을 보내면
   userId·에러가 남아 원인 확인 가능. 크롬(Playwright) stderr 폭주는 봇 console으로 안 들어와
   여기 볼륨은 낮고 안전하다. */
const LOG_DIR = process.env.PUBLY_LOG_DIR || "";
let _logStream: fs.WriteStream | null = null;
if (LOG_DIR) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ymd = new Date().toISOString().slice(0, 10);
    _logStream = fs.createWriteStream(path.join(LOG_DIR, `bot-${ymd}.log`), { flags: "a" });
    _logStream.on("error", () => { _logStream = null; });
  } catch { _logStream = null; }
}
function fileLog(args: unknown[], isErr = false) {
  if (!_logStream) return;
  try {
    const line = `[${new Date().toLocaleString("ko-KR")}]${isErr ? " ERROR" : ""} ` +
      args.map(a => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ");
    _logStream.write(line + "\n");
  } catch {}
}
{
  const _log = console.log.bind(console), _err = console.error.bind(console), _warn = console.warn.bind(console);
  console.log = (...a: unknown[]) => { fileLog(a); _log(...a); };
  console.error = (...a: unknown[]) => { fileLog(a, true); _err(...a); };
  console.warn = (...a: unknown[]) => { fileLog(a); _warn(...a); };
}
// ★봇 프로세스 시작 구분선 — 로그에서 "봇이 언제 떴는지/재시작됐는지" 한눈에(오프라인 디버깅 핵심).
console.log(`\n━━━━━━━━━━━━━━ 봇 시작 (PID ${process.pid}) ━━━━━━━━━━━━━━`);

// ★★프로세스 크래시 가드(테리 2026-08-26 'Flow 하다 서버 오프라인' 근본해결) ──
//   Playwright/CDP는 크롬이 닫히거나 탭이 사라질 때 "Target closed"·"browser has been closed" 같은
//   비동기 에러(unhandledRejection)를 던지는데, 핸들러가 없으면 Node가 봇 프로세스를 통째로 종료한다.
//   → 헤더 "서버 오프라인" + 이후 모든 요청 "Failed to fetch"의 진짜 원인. 여기서 잡아 로그만 남기고
//   프로세스는 계속 살려 HTTP 응답을 유지한다(개별 요청은 각 핸들러 try/catch가 이미 처리).
process.on("unhandledRejection", (reason: any) => {
  console.error(`[bot] ⚠️ 처리 안 된 Promise 거부(프로세스 유지): ${String(reason?.stack || reason?.message || reason).split("\n").slice(0, 3).join(" | ")}`);
});
process.on("uncaughtException", (err: any) => {
  console.error(`[bot] ⚠️ 예기치 못한 예외(프로세스 유지): ${String(err?.stack || err?.message || err).split("\n").slice(0, 3).join(" | ")}`);
});

const app = express();
const PORT = 3333;
const AUTH_TOKEN = process.env.BOT_AUTH_TOKEN || "";

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173", "null"] }));
app.use(express.json({ limit: "50mb" })); // base64 이미지 포함 발행 대비
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next(); // standalone local development fallback
  if (req.get("Authorization") === `Bearer ${AUTH_TOKEN}`) return next();
  res.status(401).json({ error: "Unauthorized" });
});

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
    await saveGoogleSession(userId, email, pw);
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

app.delete("/api/session/:platform/:userId", (req, res) => {
  const { platform, userId } = req.params;
  if (platform === "naver") deleteNaverSession(userId);
  else if (platform === "tistory") deleteTistorySession(userId);
  else if (platform === "google") deleteGoogleSession(userId);
  else return res.status(400).json({ error: "지원하지 않는 플랫폼" });
  res.json({ success: true });
});

/* ── 직접 발행 (앱에서 즉시 발행) ── */
app.post("/api/publish-full", async (req, res) => {
  const { userId, platform, naverId, title, content, pubScope = "full", tags = [], imageUrl, categoryId, visibility, scheduleTime, blocks,
    videoUrl, videoPosition,
    useFlow, flowImgCount, flowPrompts, flowCaptions } = req.body;
  if (!userId || !platform || !title || !content) {
    return res.status(400).json({ error: "userId, platform, title, content 필요" });
  }

  await acquireSlot();
  const accountLock = platform === "naver" ? acquireAccountLock(String(naverId || userId), "글 발행") : null;
  if (accountLock && !accountLock.ok) {
    releaseSlot();
    return res.status(409).json({ error: `같은 네이버 계정에서 '${accountLock.owner}' 작업이 진행 중이에요. 완료 후 다시 시도해주세요.`, code: "ACCOUNT_BUSY" });
  }
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
          // ★Q&A/해시태그/FAQ/관련글 경계 계산 — 이미지는 이 "위"에만 들어가야 함(경계 아래로 내려가면 안 됨)
          const isBoundary = (b: any) => b.type === "text" && /\[FAQ시작\]|\[관련글시작\]|질문\s*답변|Q\s*&\s*A|큐앤에이|해시태그|자주\s*묻는/i.test(b.content || "");
          let boundaryIdx = finalBlocks.findIndex(isBoundary);
          if (boundaryIdx < 0) boundaryIdx = finalBlocks.length;
          // 경계 앞 구간의 텍스트 블록 개수로 균등 분할
          const safeTextCount = finalBlocks.slice(0, boundaryIdx).filter((b: any) => b.type === "text").length || 1;
          const step = Math.max(1, Math.floor(safeTextCount / flowImages.length));
          const result: any[] = [];
          let imgIdx = 0;
          let textCount = 0;
          finalBlocks.forEach((block: any, i: number) => {
            // 경계 직전(경계 블록 바로 앞)에서 남은 이미지를 전부 소진 → 경계 아래로 안 내려감
            if (i === boundaryIdx) {
              while (imgIdx < flowImages.length) { result.push({ type: "image", src: flowImages[imgIdx].src, alt: flowImages[imgIdx].alt }); imgIdx++; }
            }
            result.push(block);
            if (i < boundaryIdx && block.type === "text") {
              textCount++;
              if (imgIdx < flowImages.length && textCount % step === 0) {
                result.push({ type: "image", src: flowImages[imgIdx].src, alt: flowImages[imgIdx].alt });
                imgIdx++;
              }
            }
          });
          // 경계가 없던(맨 끝) 경우 남은 이미지 소진
          while (imgIdx < flowImages.length) { result.push({ type: "image", src: flowImages[imgIdx].src, alt: flowImages[imgIdx].alt }); imgIdx++; }
          finalBlocks = result;
          console.log(`[server] Flow 이미지 ${flowImages.length}장 블록 삽입 완료(경계 위)`);
        }
      } catch (flowErr: any) {
        console.error("[server] Flow 이미지 생성 실패:", flowErr.message);
        // Flow 실패해도 이미지 없이 발행 계속
      }
    }

    let postUrl = "";
    if (platform === "naver") {
      if (naverId) {
        const ok = activateNaverAccount(userId, naverId);
        if (!ok) console.log(`[publish] 계정 세션 없음: ${naverId}`);
      }
      postUrl = await publishNaver({ userId, title, content, pubScope, tags, imageUrl, categoryId, visibility, scheduleTime, blocks: finalBlocks, videoUrl, videoPosition });
    } else if (platform === "tistory") {
      postUrl = await publishTistory({ userId, title, content, tags, categoryId, visibility });
    } else {
      return res.status(400).json({ error: "platform은 naver 또는 tistory" });
    }

    // 발행기록 저장은 앱(회원 DashboardPage / 관리자 AdminPage)이 content까지 통째로 전담한다.
    // 여기서 또 저장하면 content 없는 중복 기록이 생겨(이중저장) 그 기록을 재발행하면 "제목만" 복원된다.
    res.json({ success: true, postUrl });
  } catch (e: any) {
    // 실패 기록도 앱이 저장(이중저장 방지)
    if (e.message?.includes("세션 만료") || e.message?.includes("재연결")) {
      return res.status(401).json({ error: e.message, code: "SESSION_EXPIRED" });
    }
    res.status(500).json({ error: e.message });
  } finally {
    if (accountLock?.ok) accountLock.release();
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
      console.log(`\n━━━━━ [발행 작업 시작] ${job.platform} · "${job.title}" ${(job as any).schedule_time?`· 예약 ${(job as any).schedule_time}`:"· 즉시"} ━━━━━`);
      if (!await claimPendingJob(job.id)) continue;

      let quotaReserved = false;
      await acquireSlot();
      const p = job.payload || null;
      const accountLock = job.platform === "naver" ? acquireAccountLock(String(p?.naverId || job.user_id), "예약 글 발행") : null;
      try {
        if (accountLock && !accountLock.ok) {
          await updateJob(job.id, { status: "pending", error: `계정 사용 중: ${accountLock.owner}` });
          continue;
        }
        const entitlement = await checkPublishEntitlement(job.user_id);
        if (!entitlement.ok) {
          await updateJob(job.id, { status: "fail", error: entitlement.reason || "회원 정책 제한" });
          await finishQueuedHistory({ user_id: job.user_id, platform: job.platform, title: job.title, status: "fail", error_message: entitlement.reason });
          continue;
        }
        const ok = await useQuota(job.user_id);
        if (!ok) {
          await updateJob(job.id, { status: "fail", error: "쿼터 초과" });
          await finishQueuedHistory({ user_id: job.user_id, platform: job.platform, title: job.title, status: "fail", error_message: "쿼터 초과" });
          continue;
        }
        quotaReserved = true;

        let postUrl = "";
        // ★ payload가 있으면(예약/큐 발행) 이미지 블록까지 그대로 발행. 없으면 옛 방식(텍스트만) 폴백.
        // 예약시간이 미래면 네이버 예약발행으로, 이미 지났으면 즉시 발행.
        const sched = (job as any).schedule_time as string | undefined;
        const schedFuture = sched && new Date(sched).getTime() > Date.now() ? sched : undefined;
        if (job.platform === "naver") {
          if (p?.naverId) {
            const ok = activateNaverAccount(job.user_id, p.naverId);
            if (!ok) console.log(`[publish] 계정 세션 없음: ${p.naverId}`);
          }
          postUrl = p
            ? await publishNaver({ userId: job.user_id, title: p.title || job.title, content: p.content ?? job.content, pubScope: p.pubScope, tags: p.tags || job.tags, imageUrl: p.imageUrl, categoryId: p.categoryId ?? (job as any).category_id, visibility: p.visibility, blocks: p.blocks as any, videoUrl: p.videoUrl, videoPosition: p.videoPosition, scheduleTime: schedFuture })
            : await publishNaver({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags, imageUrl: job.image_url || undefined, categoryId: (job as any).category_id, visibility: (job as any).visibility, scheduleTime: schedFuture });
        } else if (job.platform === "tistory") {
          postUrl = p
            ? await publishTistory({ userId: job.user_id, title: p.title || job.title, content: p.content ?? job.content, tags: p.tags || job.tags, categoryId: p.categoryId ?? (job as any).category_id, visibility: p.visibility as any })
            : await publishTistory({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags, categoryId: (job as any).category_id, visibility: (job as any).visibility });
        }

        await updateJob(job.id, { status: "success", result_url: postUrl });
        await incrementDailyPublish(job.user_id);
        await finishQueuedHistory({ user_id: job.user_id, platform: job.platform, title: job.title, post_url: postUrl, status: "success" });
        console.log(`✅━━━ [발행 완료] "${job.title}" → ${postUrl} ━━━✅\n`);
      } catch (e: any) {
        if (quotaReserved) await refundQuota(job.user_id);
        await updateJob(job.id, { status: "fail", error: e.message });
        await finishQueuedHistory({ user_id: job.user_id, platform: job.platform, title: job.title, status: "fail", error_message: e.message });
        console.error(`❌━━━ [발행 실패] "${job.title}" — ${e.message} ━━━❌\n`);
      } finally {
        if (accountLock?.ok) accountLock.release();
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
  if (userId) {
    deleteNaverSession(userId);
    deleteTistorySession(userId);
    deleteGoogleSession(userId);
  }
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
  const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest"];
  for (const model of models) {
    try {
      // ★사진글은 길어서 4000토큰이면 잘림 → 8000 + 2.5계열 thinking 끄기(사고에 토큰 뺏겨 본문 잘리는 것 방지)
      const generationConfig: any = { maxOutputTokens: 8000, temperature: 0.9 };
      if (model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const body = { contents: [{ parts: [...parts, { text: prompt }] }], generationConfig };
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const cand = d?.candidates?.[0];
      const text = cand?.content?.parts?.[0]?.text;
      // 잘렸으면(MAX_TOKENS) 다음 모델로 재시도 — 잘린 글을 그대로 주지 않음
      if (text && cand?.finishReason !== "MAX_TOKENS") return res.json({ text });
      if (text && cand?.finishReason === "MAX_TOKENS") { console.log(`[vision] ${model} 응답 잘림 → 다음 모델`); continue; }
    } catch {}
  }
  return res.status(500).json({ error: "생성 실패. Gemini 키를 확인하거나 잠시 후 다시 시도해주세요." });
});

/* ── Google Flow 디버깅 크롬 준비 상태 확인 ──
   좀비 크롬(포트는 응답해도 page 타겟이 0개 → 봇이 못 붙음)을 걸러내기 위해
   /json/version(포트)뿐 아니라 실제 page 타겟 존재까지 확인한다. */
app.get("/api/flow/status", async (_req, res) => {
  try {
    const v = await fetch("http://localhost:9222/json/version", { signal: AbortSignal.timeout(2000) });
    if (!v.ok) return res.json({ ready: false, reason: "cdp_not_ok" });
    const listRes = await fetch("http://localhost:9222/json", { signal: AbortSignal.timeout(2000) });
    if (!listRes.ok) return res.json({ ready: false, reason: "cdp_no_targets" });
    const targets = await listRes.json();
    const hasPage = Array.isArray(targets) && targets.some((t: any) => t && t.type === "page");
    if (!hasPage) return res.json({ ready: false, reason: "zombie_no_page" });
    return res.json({ ready: true });
  } catch {
    return res.json({ ready: false, reason: "chrome_not_debug" });
  }
});

/* ── Google Flow 이미지 생성 (CDP 방식) ── */
app.post("/api/flow-generate", async (req, res) => {
  const { prompts, captions } = req.body;
  if (!Array.isArray(prompts) || prompts.length === 0)
    return res.status(400).json({ error: "prompts 배열 필요" });
  // ★요청 받자마자 즉시 로그(테리 요청): 사용자가 버튼 누른 걸 인식했다는 신호를 바로 보여준다.
  //   (봇의 상세 "생성 시작" 로그는 크롬 연결·세션 준비 후라 10~20초 뒤에야 나오므로, 그 전에 확인용.)
  console.log(`\n━━━━━ 🎨 그림 만들기를 시작합니다! 총 ${prompts.length}장을 만들 거예요. 잠시만 기다려 주세요 😊 ━━━━━`);
  try {
    const images = await generateFlowImagesCDP({
      prompts,
      captions: Array.isArray(captions) ? captions : [],
      cdpPort: 9222,
      onLog: (m) => console.log(m),
    });
    if (images.length === 0) {
      return res.status(500).json({ error: "이미지가 생성되지 않았어요. Flow 로그인/크레딧을 확인하거나 잠시 후 다시 시도해주세요." });
    }
    const partial = images.length < prompts.length;
    console.log(`[server] 🎉 다 됐어요! 그림 ${images.length}장을 퍼블리로 가져왔어요${partial ? ` (${prompts.length}장 중 ${images.length}장 성공)` : " (전부 성공)"}. 이제 글에 넣으면 돼요!`);
    res.status(200).json({ images, partial, requested: prompts.length, received: images.length });
  } catch (e: any) {
    const msg = e.message || "";
    console.error(`[server] Flow 생성 핸들러 오류 (프로세스 유지): ${msg}`);
    if (msg.includes("CDP_CONNECT_FAIL")) return res.status(503).json({ error: "Flow 준비가 안 됐어요. 'Flow 준비' 버튼으로 크롬을 먼저 열어주세요.", code: "CDP_CONNECT_FAIL" });
    if (msg.includes("FLOW_NOT_LOGGED_IN")) return res.status(401).json({ error: "크롬에서 Google Flow에 먼저 로그인해주세요.", code: "FLOW_NOT_LOGGED_IN" });
    res.status(500).json({ error: msg });
  }
});

/* ── Replicate 이미지 생성 프록시 (브라우저 CORS 우회) ── */
app.post("/api/replicate-image", async (req, res) => {
  const { key, prompt, aspectRatio } = req.body;
  if (!key || !prompt) return res.status(400).json({ error: "key, prompt 필요" });
  try {
    // 1) prediction 생성
    const cr = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ input: { prompt, num_outputs: 1, aspect_ratio: aspectRatio || "16:9" } }),
    });
    if (!cr.ok) {
      const t = await cr.text();
      return res.status(cr.status).json({ error: `Replicate ${cr.status}: ${t.slice(0, 300)}` });
    }
    let pred: any = await cr.json();
    const pollUrl = pred?.urls?.get;
    if (!pollUrl) return res.status(500).json({ error: "Replicate 응답 오류(폴링 URL 없음)" });

    // 2) 완료까지 폴링 (최대 ~90초)
    for (let i = 0; i < 60 && !["succeeded", "failed", "canceled"].includes(pred.status); i++) {
      await new Promise(r => setTimeout(r, 1500));
      const pr = await fetch(pollUrl, { headers: { "Authorization": `Bearer ${key}` } });
      pred = await pr.json();
    }
    if (pred.status !== "succeeded") {
      return res.status(500).json({ error: `이미지 생성 실패: ${pred.status}${pred.error ? " - " + pred.error : ""}` });
    }
    const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    if (!out) return res.status(500).json({ error: "이미지 URL이 비어있음" });

    // 3) 이미지를 base64로 변환해 반환 (replicate.delivery도 브라우저 CORS 걸리므로 서버에서 다운로드)
    const imgRes = await fetch(out);
    if (!imgRes.ok) return res.status(500).json({ error: "이미지 다운로드 실패" });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "image/webp";
    res.json({ image: `data:${ct};base64,${buf.toString("base64")}`, sourceUrl: out });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 범용 AI 프록시 (브라우저 CORS 우회 — OpenAI/Groq 등) ──
   허용 호스트만 통과시켜 SSRF 방지. 프론트는 이걸 경유해 외부 AI를 호출한다. */
const PROXY_ALLOW = ["api.openai.com", "api.groq.com", "api.anthropic.com"];
app.post("/api/ai-proxy", async (req, res) => {
  const { url, method, headers, body } = req.body || {};
  try {
    if (!url || typeof url !== "string") return res.status(400).json({ error: "url 필요" });
    const host = new URL(url).hostname;
    if (!PROXY_ALLOW.includes(host)) return res.status(403).json({ error: `허용되지 않은 호스트: ${host}` });
    const r = await fetch(url, {
      method: method || "POST",
      headers: headers || { "Content-Type": "application/json" },
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 🔥 핫이슈 추천 (무료·키 불필요·누구나) — 카테고리별 실시간 인기 주제 ──
   실시간 종합=구글 트렌드 KR RSS, 분야별=연합뉴스 섹션 RSS. 서버에서 fetch(브라우저 CORS 회피). 30분 캐시. */
const HOT_CACHE: Record<string, { at: number; items: string[] }> = {};
const YNA_SECTIONS: Record<string, string> = {
  경제: "economy", 증권: "market", 산업: "industry", 정치: "politics", 사회: "society",
  전국: "local", 세계: "international", 문화: "culture", 연예: "entertainment", 스포츠: "sports", 건강: "health",
};
// 🆕 대중 생활 카테고리 — 뉴스에 안 나오는 블로그 실전 주제. 각 카테고리를 여러 '씨앗 키워드'로 잡고,
//    네이버 실시간 자동완성(지금 사람들이 검색하는 것)으로 실제 인기 주제를 뽑는다(실시간).
const LIFE_SEEDS: Record<string, string[]> = {
  음식레시피: ["레시피", "집밥", "간단요리", "다이어트 요리", "에어프라이어", "밑반찬", "자취요리"],
  패션: ["패션", "코디", "여자 코디", "남자 코디", "가을 코디", "데일리룩", "신발 추천"],
  뷰티: ["화장품 추천", "스킨케어", "메이크업", "다이어트", "헤어스타일", "네일", "향수 추천"],
  여행: ["여행", "국내여행", "가볼만한곳", "당일치기", "제주 여행", "해외여행", "캠핑"],
  인테리어: ["인테리어", "셀프 인테리어", "원룸 인테리어", "홈카페", "수납 정리", "소품 추천", "이사 준비"],
  반려동물: ["강아지", "고양이", "반려동물 용품", "강아지 훈련", "고양이 사료", "펫 미용", "반려견 간식"],
  재테크: ["재테크", "부업", "적금 추천", "주식 초보", "청약", "절약 방법", "정부지원금"],
  육아: ["육아", "이유식", "아기 용품", "신생아", "육아템", "어린이집", "출산 준비"],
  건강운동: ["홈트", "다이어트 운동", "헬스", "스트레칭", "런닝", "요가", "체중 감량"],
};
// 네이버 자동완성으로 씨앗 키워드의 실시간 인기 연관검색어를 가져온다(공개 API, 세션 불필요).
async function naverAutocomplete(seed: string): Promise<string[]> {
  try {
    const u = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(seed)}&con=0&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100`;
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://search.naver.com/" } });
    const j: any = await r.json();
    const items: string[] = [];
    for (const grp of (j.items || [])) for (const row of (grp || [])) { const kw = Array.isArray(row) ? row[0] : row; if (typeof kw === "string" && kw.trim()) items.push(kw.trim()); }
    return items;
  } catch { return []; }
}
function cleanHeadline(s: string): string {
  return s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&[a-z]+;/g, " ")
    .replace(/^\[[^\]]*\]\s*/g, "").replace(/\([^)]*종합[^)]*\)/g, "").replace(/\.{2,}$/, "")
    .replace(/\s+/g, " ").trim();
}
app.get("/api/hot-issues", async (req, res) => {
  const category = String(req.query.category || "실시간");
  const now = Date.now();
  const cached = HOT_CACHE[category];
  if (cached && now - cached.at < 30 * 60 * 1000) return res.json({ ok: true, category, items: cached.items, cached: true });
  try {
    // 주제를 풍부하게: 소스에서 당겨올 수 있는 건 최대한 다 당겨와 중복만 제거(양을 크게).
    const uniq = (arr: string[]) => { const seen = new Set<string>(); const out: string[] = []; for (const x of arr) { const k = x.replace(/\s+/g, ""); if (x && !seen.has(k)) { seen.add(k); out.push(x); } } return out; };
    let items: string[] = [];
    if (category === "실시간") {
      // 구글 트렌드(KR) + 연합뉴스 주요 섹션 헤드라인을 합쳐서 실시간 주제를 최대한 풍부하게
      const pulls = await Promise.allSettled([
        fetch("https://trends.google.com/trending/rss?geo=KR", { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()),
        ...["economy", "society", "entertainment", "sports", "industry"].map(sec =>
          fetch(`https://www.yna.co.kr/rss/${sec}.xml`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text())),
      ]);
      const merged: string[] = [];
      pulls.forEach((p, i) => {
        if (p.status !== "fulfilled") return;
        const cleaned = [...p.value.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map(m => cleanHeadline(m[1]))
          .filter(x => x && !/trends|google|피드|연합뉴스|저작권|헤드라인|알림|RSS/i.test(x));
        // 구글 트렌드는 앞쪽(더 뜨거움) 우선, 뉴스는 섹션당 상위 몇 개만
        merged.push(...(i === 0 ? cleaned.slice(0, 30) : cleaned.slice(0, 8)));
      });
      items = uniq(merged).slice(0, 60);
    } else if (LIFE_SEEDS[category]) {
      // 🆕 대중 생활 카테고리 — 네이버 실시간 자동완성으로 지금 뜨는 검색 주제 수집(뉴스와 별개)
      const seeds = LIFE_SEEDS[category];
      const pulls = await Promise.allSettled(seeds.map(s => naverAutocomplete(s)));
      const merged: string[] = [];
      pulls.forEach(p => { if (p.status === "fulfilled") merged.push(...p.value); });
      // 씨앗 단어 자체(너무 일반적)만 남는 건 제외, 2글자 이상만
      items = uniq(merged).filter(x => x.length >= 2 && !seeds.includes(x)).slice(0, 60);
      // 혹시 자동완성이 다 막히면 씨앗이라도 넣어 빈 화면 방지
      if (!items.length) items = uniq(seeds);
    } else {
      const sec = YNA_SECTIONS[category];
      if (!sec) return res.status(400).json({ ok: false, error: "알 수 없는 카테고리" });
      const r = await fetch(`https://www.yna.co.kr/rss/${sec}.xml`, { headers: { "User-Agent": "Mozilla/5.0" } });
      const t = await r.text();
      const raw = [...t.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map(m => cleanHeadline(m[1]))
        .filter(x => x && !/연합뉴스|저작권|헤드라인|알림|RSS/i.test(x));
      items = uniq(raw).slice(0, 60);
    }
    HOT_CACHE[category] = { at: now, items };
    res.json({ ok: true, category, items });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── 📈 성과 추적: 발행한 글의 현재 검색 순위 조회(브라우저 불필요, 공개 통합검색) ──
   제목에서 핵심 키워드를 뽑아 모바일 통합검색 블로그탭에서 내 (blogId/logNo) 위치를 찾는다. */
function extractCoreQuery(title: string): string {
  const cleaned = String(title||"").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const drop = new Set(["그리고","하는","및","의","가","이","은","는","을","를","에","에서","으로","와","과","도","만","best","BEST","top","TOP","추천","후기","방법","정리","총정리","완벽","꿀팁","리뷰"]);
  const words = cleaned.split(" ").filter(w => w.length >= 2 && !drop.has(w));
  return (words.length ? words : cleaned.split(" ")).slice(0, 6).join(" ").slice(0, 80) || cleaned.slice(0,80);
}
app.post("/api/post-rank", async (req, res) => {
  const { items } = req.body as { items?: {title:string; blogId:string; logNo:string}[] };
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items 필요" });
  const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const out: { logNo:string; rank:number|null; query:string }[] = [];
  for (const it of items.slice(0, 30)) {
    const query = extractCoreQuery(it.title);
    try {
      const r = await fetch(`https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(query)}`, { headers: { "User-Agent": MUA } });
      const t = await r.text();
      const seq: string[] = []; const seen = new Set<string>();
      for (const m of t.matchAll(/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d{6,})/g)) {
        const k = `${m[1].toLowerCase()}/${m[2]}`; if (!seen.has(k)) { seen.add(k); seq.push(k); }
      }
      const idx = seq.indexOf(`${String(it.blogId).toLowerCase()}/${String(it.logNo)}`);
      out.push({ logNo: String(it.logNo), rank: idx >= 0 ? idx + 1 : null, query });
    } catch { out.push({ logNo: String(it.logNo), rank: null, query }); }
    await new Promise(r => setTimeout(r, 300));
  }
  res.json({ ok: true, ranks: out });
});

/* ── 서버 시작 ── */
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[bot] Publy 봇 서버 v2.0 → http://localhost:${PORT}`);
});

export default app;
