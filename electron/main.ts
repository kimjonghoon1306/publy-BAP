import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import fs from "fs-extra";

let mainWindow: BrowserWindow | null = null;
let botProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV === "development";

// ── 봇 서버 자동 시작 ─────────────────────────────────────
async function startBotServer() {
  const botPath = isDev
    ? path.join(__dirname, "../../naver-bot")
    : path.join(process.resourcesPath, "naver-bot");

  console.log("[Publy] 봇 서버 시작:", botPath);

  botProcess = spawn("node", ["dist/server.js"], {
    cwd: botPath,
    stdio: "pipe",
    shell: true,
  });

  botProcess.stdout?.on("data", (d) => console.log("[bot]", d.toString()));
  botProcess.stderr?.on("data", (d) => console.error("[bot-err]", d.toString()));
  botProcess.on("close", (code) => console.log("[bot] 종료:", code));
}

// ── 메인 윈도우 ───────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 380,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#050a12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, "../public/icon.png"),
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startBotServer();
  createWindow();
});

app.on("window-all-closed", () => {
  botProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});

// ── IPC ──────────────────────────────────────────────────
ipcMain.handle("get-bot-status", async () => {
  try {
    const res = await fetch("http://localhost:3333/health");
    return res.ok ? "online" : "offline";
  } catch {
    return "offline";
  }
});
