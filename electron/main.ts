import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import { randomBytes } from "crypto";

let mainWindow: BrowserWindow | null = null;
let botProcess: ChildProcess | null = null;
let neighborBotProcess: ChildProcess | null = null;
let instaBotProcess: ChildProcess | null = null;
const isDev = !app.isPackaged;
const botAuthToken = randomBytes(32).toString("hex");

async function startBotServer() {
  const botPath = isDev
    ? path.join(__dirname, "../../naver-bot")
    : path.join(process.resourcesPath, "naver-bot");

  const chromiumPath = isDev
    ? path.join(__dirname, "../../chromium")
    : path.join(process.resourcesPath, "chromium");

  try {
    const fs = await import("fs");
    if (!fs.existsSync(path.join(botPath, "dist", "server.js"))) {
      console.error("[bot] dist/server.js 없음:", botPath);
      return;
    }
  } catch { return; }

  // macOS에서 node 경로 찾기
  const nodePath = process.platform === "darwin"
    ? (require("fs").existsSync("/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node"
      : require("fs").existsSync("/usr/local/bin/node") ? "/usr/local/bin/node"
      : "node")
    : "node";

  const startBot = () => {
    console.log("[bot] 봇 서버 시작...");
    botProcess = spawn(nodePath, ["dist/server.js"], {
      cwd: botPath,
      stdio: "pipe",
      shell: true,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: chromiumPath,
        BOT_AUTH_TOKEN: botAuthToken,
      },
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

async function startNeighborBotServer() {
  const botPath = isDev
    ? path.join(__dirname, "../../neighbor-bot")
    : path.join(process.resourcesPath, "neighbor-bot");

  // playwright는 naver-bot node_modules 공유
  const naverBotPath = isDev
    ? path.join(__dirname, "../../naver-bot")
    : path.join(process.resourcesPath, "naver-bot");

  const chromiumPath = isDev
    ? path.join(__dirname, "../../chromium")
    : path.join(process.resourcesPath, "chromium");

  const fs = await import("fs");
  if (!fs.existsSync(path.join(botPath, "dist", "server.js"))) {
    console.warn("[neighbor-bot] dist/server.js 없음:", botPath);
    return;
  }

  // macOS에서 node 경로 찾기
  const nodePath = process.platform === "darwin"
    ? (require("fs").existsSync("/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node"
      : require("fs").existsSync("/usr/local/bin/node") ? "/usr/local/bin/node"
      : "node")
    : "node";

  const startBot = () => {
    console.log("[neighbor-bot] 서버 시작...");
    neighborBotProcess = spawn(nodePath, ["dist/server.js"], {
      cwd: botPath,
      stdio: "pipe",
      shell: true,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: chromiumPath,
        NODE_PATH: path.join(naverBotPath, "node_modules"),
        BOT_AUTH_TOKEN: botAuthToken,
      },
    });

    neighborBotProcess.stdout?.on("data", d => console.log("[neighbor-bot]", d.toString().trim()));
    neighborBotProcess.stderr?.on("data", d => console.error("[neighbor-bot]", d.toString().trim()));

    neighborBotProcess.on("exit", (code) => {
      console.warn(`[neighbor-bot] 종료 (code: ${code}). 3초 후 재시작...`);
      neighborBotProcess = null;
      if (!app.isQuitting) setTimeout(startBot, 3000);
    });
  };

  startBot();
}

async function startInstaBotServer() {
  const botPath = isDev
    ? path.join(__dirname, "../../insta-bot")
    : path.join(process.resourcesPath, "insta-bot");

  // playwright는 naver-bot node_modules 공유
  const naverBotPath = isDev
    ? path.join(__dirname, "../../naver-bot")
    : path.join(process.resourcesPath, "naver-bot");

  const chromiumPath = isDev
    ? path.join(__dirname, "../../chromium")
    : path.join(process.resourcesPath, "chromium");

  const fs = await import("fs");
  if (!fs.existsSync(path.join(botPath, "dist", "server.js"))) {
    console.warn("[insta-bot] dist/server.js 없음:", botPath);
    return;
  }

  const nodePath = process.platform === "darwin"
    ? (require("fs").existsSync("/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node"
      : require("fs").existsSync("/usr/local/bin/node") ? "/usr/local/bin/node"
      : "node")
    : "node";

  const startBot = () => {
    console.log("[insta-bot] 서버 시작...");
    instaBotProcess = spawn(nodePath, ["dist/server.js"], {
      cwd: botPath,
      stdio: "pipe",
      shell: true,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: chromiumPath,
        NODE_PATH: path.join(naverBotPath, "node_modules"),
        BOT_AUTH_TOKEN: botAuthToken,
      },
    });

    instaBotProcess.stdout?.on("data", d => console.log("[insta-bot]", d.toString().trim()));
    instaBotProcess.stderr?.on("data", d => console.error("[insta-bot]", d.toString().trim()));

    instaBotProcess.on("exit", (code) => {
      console.warn(`[insta-bot] 종료 (code: ${code}). 3초 후 재시작...`);
      instaBotProcess = null;
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
  await startNeighborBotServer();
  await startInstaBotServer();
  createWindow();
  app.on("activate", () => { if (!mainWindow) createWindow(); });
});

app.on("window-all-closed", () => {
  app.isQuitting = true;
  botProcess?.kill();
  neighborBotProcess?.kill();
  instaBotProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("get-bot-status", async () => {
  try {
    const res = await fetch("http://127.0.0.1:3333/health", { headers: { Authorization: `Bearer ${botAuthToken}` }, signal: AbortSignal.timeout(2000) });
    return res.ok ? "online" : "offline";
  } catch { return "offline"; }
});

ipcMain.handle("get-bot-secret", async () => botAuthToken);

ipcMain.handle("register-user", async (_event, userId: string) => {
  try {
    const res = await fetch("http://127.0.0.1:3333/api/register-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${botAuthToken}` },
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
    const res = await fetch("http://127.0.0.1:3333/api/unregister-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${botAuthToken}` },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch { return false; }
});

/* ── Google Flow 준비: 디버깅 크롬 자동 실행 ──
   Flow 이미지를 봇이 조작하려면 사용자 크롬이 디버깅 포트(9222)로 떠 있어야 한다.
   이 핸들러가 OS별 크롬 경로를 찾아 별도 프로필로 디버깅 크롬을 띄우고 Flow 페이지를 연다.
   별도 프로필이라 사용자의 평소 크롬과 분리되고, 로그인은 그 프로필에 유지된다. */
let flowChromeProc: ChildProcess | null = null;
ipcMain.handle("flow-launch-chrome", async () => {
  const fs = await import("fs");
  const os = await import("os");

  // 이미 디버깅 크롬이 떠 있으면 재사용
  try {
    const r = await fetch("http://localhost:9222/json/version", { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { ok: true, already: true };
  } catch {}

  // OS별 크롬 실행 파일 경로 후보
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32"
    ? [
        path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
        path.join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
      ]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser"];

  const chromePath = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (!chromePath) {
    return { ok: false, error: "크롬을 찾을 수 없어요. Google Chrome을 먼저 설치해주세요." };
  }

  // 전용 프로필 폴더(사용자 평소 크롬과 분리, 로그인 유지됨)
  const profileDir = path.join(os.homedir(), ".publy-flow-chrome");

  try {
    flowChromeProc = spawn(chromePath, [
      "--remote-debugging-port=9222",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://labs.google/fx/ko/tools/flow",
    ], { detached: true, stdio: "ignore" });
    flowChromeProc.unref();
  } catch (e: any) {
    return { ok: false, error: "크롬 실행 실패: " + e.message };
  }

  // 디버깅 포트가 열릴 때까지 대기(최대 15초)
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await fetch("http://localhost:9222/json/version", { signal: AbortSignal.timeout(1500) });
      if (r.ok) return { ok: true, launched: true };
    } catch {}
  }
  return { ok: false, error: "크롬은 실행됐지만 준비 확인에 실패했어요. 잠시 후 다시 시도해주세요." };
});

/* ── Flow 준비 상태 확인 (디버깅 크롬 떠있나) ── */
ipcMain.handle("flow-status", async () => {
  try {
    const r = await fetch("http://localhost:9222/json/version", { signal: AbortSignal.timeout(1500) });
    return { ready: r.ok };
  } catch { return { ready: false }; }
});
