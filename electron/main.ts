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
    if (!fs.existsSync(path.join(botPath, "package.json"))) return;
  } catch { return; }
  botProcess = spawn("node", ["dist/server.js"], {
    cwd: botPath, stdio: "pipe", shell: true, env: { ...process.env },
  });
  botProcess.stdout?.on("data", d => console.log("[bot]", d.toString().trim()));
  botProcess.stderr?.on("data", d => console.error("[bot]", d.toString().trim()));
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
  botProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("get-bot-status", async () => {
  try {
    const res = await fetch("http://localhost:3333/health", { signal: AbortSignal.timeout(2000) });
    return res.ok ? "online" : "offline";
  } catch { return "offline"; }
});
