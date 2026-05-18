import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import http from "http";
import express from "express";
import cors from "cors";

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;
let server: http.Server | null = null;

async function startBotServer() {
  try {
    // 봇 서버를 Electron 메인 프로세스 안에서 직접 실행
    const botPath = isDev
      ? path.join(__dirname, "../../naver-bot/src")
      : path.join(process.resourcesPath, "naver-bot/dist");

    const { publishNaver, saveNaverSession, naverSessionExists } = await import(
      isDev
        ? path.join(__dirname, "../../naver-bot/src/naver")
        : path.join(process.resourcesPath, "naver-bot/dist/naver.js")
    );
    const { publishTistory, saveTistorySession, tistorySessionExists } = await import(
      isDev
        ? path.join(__dirname, "../../naver-bot/src/tistory")
        : path.join(process.resourcesPath, "naver-bot/dist/tistory.js")
    );
    const { fetchPendingJobs, updateJob, addHistory, useQuota } = await import(
      isDev
        ? path.join(__dirname, "../../naver-bot/src/supabase")
        : path.join(process.resourcesPath, "naver-bot/dist/supabase.js")
    );

    const app2 = express();
    app2.use(cors());
    app2.use(express.json());

    const MAX_CONCURRENT = 3;
    let running = 0;
    const waitQueue: Array<() => void> = [];
    const acquireSlot = (): Promise<void> => {
      if (running < MAX_CONCURRENT) { running++; return Promise.resolve(); }
      return new Promise(resolve => waitQueue.push(() => { running++; resolve(); }));
    };
    const releaseSlot = () => {
      running--;
      const next = waitQueue.shift();
      if (next) next();
    };

    app2.get("/health", (_req: any, res: any) => res.json({ ok: true, running, queued: waitQueue.length }));

    app2.post("/api/naver/save-session", async (req: any, res: any) => {
      const { userId, id, pw } = req.body;
      if (!userId || !id || !pw) return res.status(400).json({ success: false, error: "userId, id, pw 필요" });
      try {
        const result = await saveNaverSession(userId, id, pw);
        res.json({ success: true, blogId: result.blogId });
      } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
    });

    app2.post("/api/tistory/save-session", async (req: any, res: any) => {
      const { userId, id, pw, blogName } = req.body;
      if (!userId || !id || !pw || !blogName) return res.status(400).json({ success: false, error: "파라미터 필요" });
      try {
        await saveTistorySession(userId, id, pw, blogName);
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
    });

    app2.get("/api/session-status/:userId", (req: any, res: any) => {
      const { userId } = req.params;
      res.json({ naver: naverSessionExists(userId), tistory: tistorySessionExists(userId) });
    });

    app2.post("/api/publish-full", async (req: any, res: any) => {
      const { userId, platform, title, content, tags = [] } = req.body;
      if (!userId || !platform || !title || !content) return res.status(400).json({ error: "파라미터 필요" });
      await acquireSlot();
      try {
        let postUrl = "";
        if (platform === "naver") postUrl = await publishNaver({ userId, title, content, tags });
        else if (platform === "tistory") postUrl = await publishTistory({ userId, title, content, tags });
        await addHistory({ user_id: userId, platform, title, post_url: postUrl, status: "success" });
        res.json({ success: true, postUrl });
      } catch (e: any) {
        await addHistory({ user_id: userId, platform, title, status: "fail", error_message: e.message });
        res.status(500).json({ error: e.message });
      } finally { releaseSlot(); }
    });

    let currentUserId: string | null = null;
    app2.post("/api/register-user", (req: any, res: any) => {
      currentUserId = req.body.userId;
      res.json({ success: true });
    });

    // Job Queue 폴링
    setInterval(async () => {
      if (!currentUserId) return;
      const jobs = await fetchPendingJobs(currentUserId);
      for (const job of jobs) {
        await updateJob(job.id, { status: "running" });
        await acquireSlot();
        try {
          const ok = await useQuota(job.user_id);
          if (!ok) { await updateJob(job.id, { status: "fail", error: "쿼터 초과" }); continue; }
          let postUrl = "";
          if (job.platform === "naver") postUrl = await publishNaver({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags });
          else if (job.platform === "tistory") postUrl = await publishTistory({ userId: job.user_id, title: job.title, content: job.content, tags: job.tags });
          await updateJob(job.id, { status: "success", result_url: postUrl });
          await addHistory({ user_id: job.user_id, platform: job.platform, title: job.title, post_url: postUrl, status: "success" });
        } catch (e: any) {
          await updateJob(job.id, { status: "fail", error: e.message });
          await addHistory({ user_id: job.user_id, platform: job.platform, title: job.title, status: "fail", error_message: e.message });
        } finally { releaseSlot(); }
      }
    }, 10000);

    server = app2.listen(3333, () => console.log("[bot] 서버 시작 → http://localhost:3333"));
    console.log("[bot] ✅ 봇 서버 Electron 내장 실행 완료");
  } catch (e: any) {
    console.error("[bot] 서버 시작 실패:", e.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 380, minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#02040a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: "deny" };
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startBotServer();
  createWindow();
  app.on("activate", () => { if (!mainWindow) createWindow(); });
});

app.on("window-all-closed", () => {
  server?.close();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("get-bot-status", async () => {
  try {
    const res = await fetch("http://localhost:3333/health", { signal: AbortSignal.timeout(2000) });
    return res.ok ? "online" : "offline";
  } catch { return "offline"; }
});

ipcMain.handle("register-user", async (_event, userId: string) => {
  try {
    const res = await fetch("http://localhost:3333/api/register-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch { return false; }
});
