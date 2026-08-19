import { app, BrowserWindow, ipcMain, shell, utilityProcess } from "electron";
import path from "path";
import { spawn, execSync, ChildProcess } from "child_process";
import { randomBytes } from "crypto";

let mainWindow: BrowserWindow | null = null;
// 봇 서버는 Electron 공식 utilityProcess로 실행한다.
// (구버전은 spawn(process.execPath, ELECTRON_RUN_AS_NODE)로 앱 실행파일을 Node로 재실행했는데,
//  갓 다운로드한 macOS 앱은 격리+미공증 상태라 그 자식 프로세스가 Gatekeeper에 막혀 조용히 죽어
//  → 봇이 안 떠 "서버 오프라인"이 됨. utilityProcess 자식은 앱 서명/권한을 물려받아 안 막힌다.)
let botProcess: Electron.UtilityProcess | ChildProcess | null = null;
let neighborBotProcess: Electron.UtilityProcess | ChildProcess | null = null;
let instaBotProcess: Electron.UtilityProcess | ChildProcess | null = null;
const isDev = !app.isPackaged;
const botAuthToken = randomBytes(32).toString("hex");

// 이전 실행에서 남은(orphan) 봇 프로세스가 포트를 물고 있으면 새 봇이 못 뜨고
// 토큰이 어긋나 "Unauthorized/봇 오프라인"이 남 → 앱 시작 시 해당 포트를 강제 정리.
function killPort(port: number) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const pids = new Set(
        out.split(/\r?\n/).map(l => l.trim().split(/\s+/).pop() || "").filter(p => /^\d+$/.test(p) && p !== "0")
      );
      pids.forEach(pid => { try { execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" }); } catch {} });
    } else {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      out.split(/\s+/).filter(Boolean).forEach(pid => { try { process.kill(Number(pid), "SIGKILL"); } catch {} });
    }
    console.log(`[bot] 포트 ${port} 정리 완료`);
  } catch { /* 점유 프로세스 없으면 명령이 비정상 종료 → 무시 */ }
}

/* ── 봇 로그를 파일로 저장 ──
   봇 내부 로그(발행/Flow 등)는 원래 콘솔로만 나가 사용자가 볼 수 없었다.
   바탕화면의 "Publy_로그" 폴더에 날짜별로 남긴다.

   ★중요: 예전엔 로그 한 줄마다 mkdirSync + appendFileSync(둘 다 동기)를 메인 프로세스에서
   실행했다. 봇이 로그를 조금만 자주 뿜어도 메인 스레드가 디스크 I/O에 묶여 창이 응답을 못 해
   맥/윈도우 모두 "뱅글뱅글(busy 커서)+클릭 안 됨" 상태로 얼어붙었다.
   → 폴더는 한 번만 만들고, 쓰기는 비동기 append WriteStream(논블로킹)으로 처리한다. */
const fsMod = require("fs") as typeof import("fs");
const LOG_DIR = () => path.join(app.getPath("desktop"), "Publy_로그");
let logStream: import("fs").WriteStream | null = null;
let logStreamYmd = "";
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getLogStream(): import("fs").WriteStream | null {
  const ymd = todayYmd();
  if (logStream && logStreamYmd === ymd) return logStream;
  try {
    const dir = LOG_DIR();
    fsMod.mkdirSync(dir, { recursive: true }); // 스트림 새로 열 때만(하루 1회 수준)
    if (logStream) { try { logStream.end(); } catch {} }
    logStream = fsMod.createWriteStream(path.join(dir, `bot-${ymd}.log`), { flags: "a" });
    logStream.on("error", () => { logStream = null; }); // 쓰기 실패해도 앱은 계속
    logStreamYmd = ymd;
    return logStream;
  } catch { return null; }
}
function botLog(tag: string, text: string, isErr = false) {
  const line = `[${new Date().toLocaleTimeString("ko-KR")}] ${tag} ${text}`;
  (isErr ? console.error : console.log)(line);
  try { getLogStream()?.write(line + "\n"); } catch {} // 비동기 write → 메인 스레드 안 막힘
}
export function openLogFolder() {
  try { shell.openPath(LOG_DIR()); } catch {}
}

function botEnvironment(extra: NodeJS.ProcessEnv = {}): Record<string, string> {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra,
    PUBLY_SESSION_DIR: path.join(app.getPath("userData"), "publy-sessions"),
    BOT_AUTH_TOKEN: botAuthToken,
  };
  // utilityProcess.fork의 env는 문자열 값만 허용 → undefined 값 제거
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (typeof v === "string") clean[k] = v;
  return clean;
}

/* ── 봇 서버 실행(공용) ──
   Electron utilityProcess.fork로 dist/server.js를 Node 서비스로 띄운다.
   utilityProcess 자식은 앱 코드서명/entitlement를 그대로 물려받아
   갓 다운로드한(격리·미공증) 앱에서도 Gatekeeper에 막히지 않고 확실히 뜬다.
   혹시 fork가 실패하면 구방식(spawn)으로 폴백해 최소한의 동작을 보장한다. */
async function forkBotServer(opts: {
  name: string;
  botPath: string;      // dist/server.js 가 들어있는 폴더
  chromiumPath: string;
  port: number;
  extraEnv?: NodeJS.ProcessEnv;
  setProc: (p: Electron.UtilityProcess | ChildProcess | null) => void;
}) {
  const fs = await import("fs");
  const serverJs = path.join(opts.botPath, "dist", "server.js");
  if (!fs.existsSync(serverJs)) {
    console.error(`[${opts.name}] dist/server.js 없음:`, serverJs);
    return;
  }

  const env = botEnvironment({ PLAYWRIGHT_BROWSERS_PATH: opts.chromiumPath, ...(opts.extraEnv || {}) });

  const start = () => {
    console.log(`[${opts.name}] 서버 시작(utilityProcess)...`);
    killPort(opts.port);
    try {
      const child = utilityProcess.fork(serverJs, [], {
        cwd: opts.botPath,
        serviceName: opts.name,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
      opts.setProc(child);
      child.stdout?.on("data", d => botLog(`[${opts.name}]`, d.toString().trim()));
      child.stderr?.on("data", d => botLog(`[${opts.name}]`, d.toString().trim(), true));
      child.on("spawn", () => console.log(`[${opts.name}] 실행됨 pid=${child.pid}`));
      child.on("exit", (code) => {
        console.warn(`[${opts.name}] 종료 (code: ${code}). 3초 후 재시작...`);
        opts.setProc(null);
        if (!app.isQuitting) setTimeout(start, 3000);
      });
    } catch (e: any) {
      // utilityProcess가 어떤 이유로 실패하면 구방식으로라도 띄운다.
      console.error(`[${opts.name}] utilityProcess 실패 → spawn 폴백:`, e?.message);
      const child = spawn(process.execPath, ["dist/server.js"], {
        cwd: opts.botPath,
        stdio: "pipe",
        env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      });
      opts.setProc(child);
      child.stdout?.on("data", d => botLog(`[${opts.name}]`, d.toString().trim()));
      child.stderr?.on("data", d => botLog(`[${opts.name}]`, d.toString().trim(), true));
      child.on("exit", (code) => {
        console.warn(`[${opts.name}] (폴백) 종료 (code: ${code}). 3초 후 재시작...`);
        opts.setProc(null);
        if (!app.isQuitting) setTimeout(start, 3000);
      });
    }
  };

  start();
}

const resourceDir = (rel: string) =>
  isDev ? path.join(__dirname, "../../", rel) : path.join(process.resourcesPath, rel);

async function startBotServer() {
  await forkBotServer({
    name: "bot",
    botPath: resourceDir("naver-bot"),
    chromiumPath: resourceDir("chromium"),
    port: 3333,
    setProc: p => { botProcess = p; },
  });
}

async function startNeighborBotServer() {
  await forkBotServer({
    name: "neighbor-bot",
    botPath: resourceDir("neighbor-bot"),
    chromiumPath: resourceDir("chromium"),
    port: 3334,
    // playwright는 naver-bot node_modules 공유
    extraEnv: { NODE_PATH: path.join(resourceDir("naver-bot"), "node_modules") },
    setProc: p => { neighborBotProcess = p; },
  });
}

async function startInstaBotServer() {
  await forkBotServer({
    name: "insta-bot",
    botPath: resourceDir("insta-bot"),
    chromiumPath: resourceDir("chromium"),
    port: 3335,
    // playwright는 naver-bot node_modules 공유
    extraEnv: { NODE_PATH: path.join(resourceDir("naver-bot"), "node_modules") },
    setProc: p => { instaBotProcess = p; },
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

declare global { namespace Electron { interface App { isQuitting: boolean; } } }
app.isQuitting = false;

/* ── ★ macOS 격리 딱지 자가 제거 ──
   갓 다운로드한 앱은 번들 내부 파일에 com.apple.quarantine 격리 속성이 남는다.
   메인 앱은 "그래도 열기"로 승인돼 실행되지만, 그 뒤 봇(내부 Electron/Node 바이너리)을
   spawn/fork 하면 격리된 자식이 Gatekeeper에 막혀 죽는다 → 봇이 안 떠 "서버 오프라인".
   (실측 확정: 격리 O→봇 안뜸, 격리 제거→봇 정상.)
   메인 프로세스는 이미 승인·실행 중이고 사용자가 설치한 번들이라 쓰기 권한이 있으므로,
   봇을 띄우기 전에 자기 번들의 격리 속성을 통째로 벗겨낸다. */
function stripSelfQuarantine() {
  if (process.platform !== "darwin" || isDev) return;
  try {
    const appBundle = path.resolve(app.getPath("exe"), "..", "..", ".."); // .../Publy.app
    execSync(`/usr/bin/xattr -dr com.apple.quarantine ${JSON.stringify(appBundle)}`, { stdio: "ignore", timeout: 30000 });
    console.log("[startup] 격리 속성 제거 완료:", appBundle);
  } catch (e: any) {
    console.warn("[startup] 격리 제거 실패(무시하고 진행):", e?.message);
  }
}

app.whenReady().then(async () => {
  stripSelfQuarantine();          // ★ 봇 스폰 전에 반드시 먼저
  await startBotServer();
  await startNeighborBotServer();
  await startInstaBotServer();
  createWindow();
  app.on("activate", () => { if (!mainWindow) createWindow(); });
});

function shutdownBots() {
  app.isQuitting = true;
  botProcess?.kill();
  neighborBotProcess?.kill();
  instaBotProcess?.kill();
  // .kill()이 놓친 프로세스가 있어도 포트를 확실히 비워 다음 실행이 깨끗하게 시작되도록.
  killPort(3333); killPort(3334); killPort(3335);
}

app.on("window-all-closed", () => {
  shutdownBots();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", shutdownBots);

ipcMain.handle("get-bot-status", async () => {
  try {
    const res = await fetch("http://127.0.0.1:3333/health", { headers: { Authorization: `Bearer ${botAuthToken}` }, signal: AbortSignal.timeout(2000) });
    return res.ok ? "online" : "offline";
  } catch { return "offline"; }
});

ipcMain.handle("get-bot-secret", async () => botAuthToken);

/* ── GitHub Latest 설치 파일 기준 업데이트 확인 ── */
function compareVersions(a: string, b: string) {
  const av = a.split(".").map(Number), bv = b.split(".").map(Number);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] || 0) - (bv[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

ipcMain.handle("check-app-update", async () => {
  if (!app.isPackaged) return { available: false, currentVersion: app.getVersion() };
  try {
    const response = await fetch("https://api.github.com/repos/kimjonghoon1306/publy-BAP/releases/tags/latest", {
      headers: { "User-Agent": `Publy/${app.getVersion()}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    const release: any = await response.json();
    const versions = (release.assets || []).flatMap((asset: any) =>
      [...String(asset.name || "").matchAll(/(\d+\.\d+\.\d+)/g)].map(match => match[1])
    );
    const latestVersion = versions.sort(compareVersions).at(-1) || app.getVersion();
    return {
      available: compareVersions(latestVersion, app.getVersion()) > 0,
      currentVersion: app.getVersion(),
      latestVersion,
      url: release.html_url,
    };
  } catch (error: any) {
    console.warn("[update] 확인 실패:", error.message);
    return { available: false, currentVersion: app.getVersion() };
  }
});

ipcMain.handle("open-app-update", async (_event, url: string) => {
  if (!/^https:\/\/github\.com\/kimjonghoon1306\/publy-BAP\/releases\//.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

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
const FLOW_CDP_PORT = 9222;
function flowProfileDir() { return path.join(app.getPath("home"), ".publy-flow-chrome"); }

/* ── Flow 크롬 "건강검진" ──
   좀비 크롬은 /json/version(포트)엔 응답해도 실제 조작할 페이지 타겟이 0개라
   봇의 Playwright가 못 붙는다(Browser context management is not supported).
   그래서 단순 포트 확인이 아니라 "쓸 수 있는 page 타겟이 실제로 있는지"까지 확인한다. */
async function flowChromeHealthy(): Promise<boolean> {
  try {
    const v = await fetch(`http://localhost:${FLOW_CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!v.ok) return false;
    const listRes = await fetch(`http://localhost:${FLOW_CDP_PORT}/json`, { signal: AbortSignal.timeout(1500) });
    if (!listRes.ok) return false;
    const targets = await listRes.json();
    return Array.isArray(targets) && targets.some((t: any) => t && t.type === "page");
  } catch { return false; }
}

/* ── 좀비/잔여 Flow 크롬 강제 정리 ── (재실행 전에 깨끗이 청소) */
async function killStaleFlowChrome() {
  const dir = flowProfileDir();
  try { if (flowChromeProc && flowChromeProc.pid) { try { process.kill(-flowChromeProc.pid, "SIGKILL"); } catch {} try { flowChromeProc.kill("SIGKILL"); } catch {} } } catch {}
  flowChromeProc = null;
  try {
    if (process.platform === "win32") {
      try { execSync(`wmic process where "commandline like '%.publy-flow-chrome%'" call terminate`, { stdio: "ignore" }); } catch {}
    } else {
      try { execSync(`pkill -9 -f "user-data-dir=${dir}"`, { stdio: "ignore" }); } catch {}
    }
  } catch {}
  // 싱글턴 락 제거(프로필 재사용 시 새 인스턴스가 깨끗하게 뜨도록)
  try {
    const fs = await import("fs");
    ["SingletonLock", "SingletonSocket", "SingletonCookie"].forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch {} });
  } catch {}
  await new Promise(r => setTimeout(r, 800));
}

ipcMain.handle("flow-launch-chrome", async () => {
  const fs = await import("fs");

  // 이미 "건강한" 디버깅 크롬이 떠 있으면 재사용 (좀비면 재사용 안 하고 아래에서 재생성)
  if (await flowChromeHealthy()) return { ok: true, already: true };

  // 포트는 응답해도 좀비(타겟 0개)이거나 죽은 크롬일 수 있음 → 깨끗이 정리 후 새로 띄운다
  await killStaleFlowChrome();

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
  const profileDir = flowProfileDir();

  try {
    flowChromeProc = spawn(chromePath, [
      `--remote-debugging-port=${FLOW_CDP_PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      "https://labs.google/fx/ko/tools/flow",
    ], { detached: true, stdio: "ignore" });
    flowChromeProc.unref();
  } catch (e: any) {
    return { ok: false, error: "크롬 실행 실패: " + e.message };
  }

  // 단순 포트 응답이 아니라 "실제 쓸 수 있는(page 타겟 존재)" 상태가 될 때까지 대기(최대 20초)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await flowChromeHealthy()) return { ok: true, launched: true };
  }
  return { ok: false, error: "크롬은 실행됐지만 준비 확인에 실패했어요. 잠시 후 다시 시도해주세요." };
});

/* ── Flow 준비 상태 확인 ── 포트만 보지 않고 "봇이 실제로 붙을 수 있는지"까지 확인(좀비 방지) */
ipcMain.handle("flow-status", async () => {
  return { ready: await flowChromeHealthy() };
});
