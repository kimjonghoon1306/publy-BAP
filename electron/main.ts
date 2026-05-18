import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";

let mainWindow: BrowserWindow | null = null;
let botProcess: ChildProcess | null = null;
const isDev = !app.isPackaged;

// 앱 종료 플래그 (봇 재시작 루프 방지)
declare global { namespace Electron { interface App { isQuitting: boolean; } } }
app.isQuitting = false;

async function startBotServer() {
  const botPath = isDev
    ? path.join(__dirname, "../../naver-bot")
    : path.join(process.resourcesPath, "naver-bot");

  try {
    const fs = await import("fs");
    if (!fs.existsSync(path.join(botPath, "package.json"))) {
      console.error("[bot] naver-bot 폴더를 찾을 수 없습니다:", botPath);
      return;
    }
  } catch { return; }

  if (isDev) {
    // 개발 모드: ts-node-dev 로 직접 실행 (빌드 불필요)
    console.log("[bot] 개발 모드 - ts-node-dev 로 봇 서버 시작...");
    botProcess = spawn("npm", ["run", "dev"], {
      cwd: botPath,
      stdio: "pipe",
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } else {
    // 프로덕션 모드: 빌드된 dist/server.js 실행
    console.log("[bot] 프로덕션 모드 - node dist/server.js 로 봇 서버 시작...");
    botProcess = spawn("node", ["dist/server.js"], {
      cwd: botPath,
      stdio: "pipe",
      shell: true,
      env: { ...process.env },
    });
  }

  botProcess.stdout?.on("data", d => console.log("[bot]", d.toString().trim()));
  botProcess.stderr?.on("data", d => {
    const msg = d.toString().trim();
    // ts-node-dev 컴파일 로그는 필터링
    if (!msg.includes("[INFO]") && !msg.includes("Compilation")) {
      console.error("[bot]", msg);
    }
  });

  botProcess.on("exit", (code) => {
    console.warn(`[bot] 서버 종료 (code: ${code}). 3초 후 재시작...`);
    botProcess = null;
    // 앱이 살아있으면 자동 재시작
    if (!app.isQuitting) {
      setTimeout(() => startBotServer(), 3000);
    }
  });
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
  app.isQuitting = true;
  botProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});

// 봇 서버 상태 확인
ipcMain.handle("get-bot-status", async () => {
  try {
    const res = await fetch("http://localhost:3333/health", { signal: AbortSignal.timeout(2000) });
    return res.ok ? "online" : "offline";
  } catch { return "offline"; }
});

// 로그인 후 유저 등록 → 봇 서버에 userId 전달
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
