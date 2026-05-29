import express from "express";
import cors from "cors";
import { saveSession, sessionExists, crawlBlogIds, addNeighbors, NeighborResult, donePath } from "./naver";
import fs from "fs";

const app = express();
const PORT = 3334;

app.use(cors());
app.use(express.json());

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
  const { accountId, keywords, countPerKeyword } = req.query as Record<string, string>;
  if (!accountId || !keywords)
    return res.status(400).json({ error: "accountId, keywords 필요" });

  sseSetup(res);

  try {
    const kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean);
    const count = parseInt(countPerKeyword || "30", 10);

    const results = await crawlBlogIds({
      accountId,
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

/* ── 서로이웃 신청 (SSE) ── */
app.get("/api/add-neighbor", async (req, res) => {
  const {
    accountId, targets: targetsRaw, message, delayMin, delayMax,
    dailyLimit, skipDone, jobId,
  } = req.query as Record<string, string>;

  if (!accountId || !targetsRaw)
    return res.status(400).json({ error: "accountId, targets 필요" });

  sseSetup(res);

  const jid = jobId || Date.now().toString();
  stopMap.set(jid, false);

  try {
    const targets = JSON.parse(decodeURIComponent(targetsRaw));

    await addNeighbors({
      accountId,
      targets,
      message: message || "안녕하세요! 좋은 글 잘 읽고 갑니다. 서로이웃 신청드려요 😊",
      delayMin: parseFloat(delayMin || "5"),
      delayMax: parseFloat(delayMax || "10"),
      dailyLimit: parseInt(dailyLimit || "100", 10),
      skipDone: skipDone === "true",
      onLog: (msg) => sseSend(res, { type: "log", msg }),
      onResult: (r: NeighborResult) => sseSend(res, { type: "result", ...r }),
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

app.listen(PORT, () => {
  console.log(`[neighbor-bot] 서버 시작 → http://localhost:${PORT}`);
});

export default app;
