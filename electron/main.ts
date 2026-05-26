import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";

let mainWindow: BrowserWindow | null = null;
let botProcess: ChildProcess | null = null;
const isDev = !app.isPackaged;

async function startBotServer() {
  const botPath = isDev
    ? path.join(__dirname, "../../naver-bot")
    : path.join(process.resourcesPath, "naver-bot");

  try {
    const fs = await import("fs");
    if (!fs.existsSync(path.join(botPath, "dist", "server.js"))) {
      console.error("[bot] dist/server.js 없음:", botPath);
      return;
    }
  } catch { return; }

  const startBot = () => {
    console.log("[bot] 봇 서버 시작...");
    botProcess = spawn("node", ["dist/server.js"], {
      cwd: botPath,
      stdio: "pipe",
      shell: true,
      env: { ...process.env },
    });

    botProcess.stdout?.on("data", d => console.log("[bot]", d.toString().trim()));
    botProcess.stderr?.on("data", d => console.error("[bot]", d.toString().trim()));

    botProcess.on("exit", (code) => {
      console.warn(`[bot] 종료 (code: ${code}). 3초 후 재시작...`);
      botProcess = null;
      if (!app.isQuitting) setTimeout(startBot, 3000);
    });
  };

  startBot();
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

declare global { namespace Electron { interface App { isQuitting: boolean; } } }
app.isQuitting = false;

app.whenReady().then(async () => {
  await startBotServer();
  createWindow();
  app.on("activate", () => { if (!mainWindow) createWindow(); });
});

app.on("window-all-closed", () => {
  app.isQuitting = true;
  botProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("get-bot-status", async () => {
  try {
    const res = await fetch("http://localhost:3333/health", { signal: AbortSignal.timeout(2000) });
    return res.ok ? "online" : "offline";
  } catch { return "offline"; }
});

ipcMain.handle("get-bot-secret", async () => "");

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

ipcMain.handle("open-preview", async (_event, html: string) => {
  const preview = new BrowserWindow({
    width: 900,
    height: 960,
    title: "구독자 시점 미리보기",
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  preview.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  preview.setMenuBarVisibility(false);
});

ipcMain.handle("unregister-user", async (_event, userId: string) => {
  try {
    const res = await fetch("http://localhost:3333/api/unregister-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch { return false; }
});
