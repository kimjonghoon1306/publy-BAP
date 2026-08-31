import { app, BrowserWindow, ipcMain, shell, powerSaveBlocker } from "electron";
import path from "path";
import { spawn, exec as _exec, execSync, ChildProcess } from "child_process";
import { randomBytes } from "crypto";

let mainWindow: BrowserWindow | null = null;
// 봇 서버는 Electron 메인과 분리된 Node 자식 프로세스로 실행한다.
let botProcess: ChildProcess | null = null;
let neighborBotProcess: ChildProcess | null = null;
let instaBotProcess: ChildProcess | null = null;

// ── 봇 서버 워치독 등록부 ──
// 각 봇 서버가 자신을 여기 등록한다. 주기적 health 체크가 "죽었거나 응답 없는(hung)"
// 서버를 발견하면 restart()를 불러 스스로 되살린다(회원이 손대지 않아도 복구).
type BotState = "idle" | "restarting" | "grace";
type BotEntry = {
  name: string;
  port: number;
  state: BotState;
  restart: () => Promise<boolean>;
  cancelScheduledRestart: () => void;
};
const botRegistry: BotEntry[] = [];
const isDev = !app.isPackaged;
const botAuthToken = randomBytes(32).toString("hex");

// 이전 실행에서 남은(orphan) 봇 프로세스가 포트를 물고 있으면 새 봇이 못 뜨고
// 토큰이 어긋나 "Unauthorized/봇 오프라인"이 남 → 해당 포트를 강제 정리.
//
// ★★멈춤(파란 원 깜빡+로딩 김) 근본원인: 예전엔 execSync(동기)로 netstat/taskkill을 돌렸다.
//   봇이 시작 못하고 3초마다 재시작 루프를 돌면, 매번 이 동기 netstat(윈도우선 특히 느림)이
//   메인 스레드를 막아 커서가 계속 깜빡이고 창이 버벅였다. → exec(비동기)로 바꿔 메인 스레드를
//   절대 막지 않는다. 완료를 기다려야 하는 곳은 await(이벤트 루프는 안 막힘).
function execAsync(cmd: string): Promise<string> {
  return new Promise(resolve => {
    try { _exec(cmd, { windowsHide: true, timeout: 8000 }, (_e, stdout) => resolve(stdout || "")); }
    catch { resolve(""); }
  });
}

async function listeningPids(port: number): Promise<number[]> {
  const output = process.platform === "win32"
    ? await execAsync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`)
    : await execAsync(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`);
  const pids = process.platform === "win32"
    ? output.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts =>
        (parts[1] || "").endsWith(`:${port}`)
      ).map(parts => Number(parts.at(-1)))
    : output.split(/\s+/).map(Number);
  return [...new Set(pids.filter(pid => Number.isInteger(pid) && pid > 0))];
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function terminateTrackedChild(child: ChildProcess | null): Promise<void> {
  const pid = child?.pid;
  if (!pid) return;
  try { child.kill("SIGTERM"); } catch {}
  if (await waitForExit(pid, 2500)) return;
  if (process.platform === "win32") await execAsync(`taskkill /PID ${pid} /T /F`);
  else { try { process.kill(pid, "SIGKILL"); } catch {} }
  await waitForExit(pid, 1000);
}

type HealthState = "online" | "unauthorized" | "offline";
async function botHealth(port: number, timeoutMs = 2500): Promise<HealthState> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: `Bearer ${botAuthToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return "online";
    if (res.status === 401) {
      // 세 봇 서버의 인증 미들웨어가 내는 고정 응답까지 일치해야 이전 Publy 봇으로 본다.
      // 단순히 401을 냈다는 이유만으로 같은 포트의 타 프로그램을 종료하지 않는다.
      try {
        const body = await res.json() as { error?: unknown };
        if (body?.error === "Unauthorized") return "unauthorized";
      } catch {}
    }
    return "offline";
  } catch { return "offline"; }
}

// 등록된 자식만 우선 종료한다. PID를 모르는 LISTEN 프로세스는 401을 반환하는 이전
// Publy 봇으로 확인된 경우에만 정리하며, 그 외 포트 소유자는 충돌로 남겨 둔다.
async function killPort(port: number, child: ChildProcess | null): Promise<"clear" | "collision"> {
  await terminateTrackedChild(child);
  let pids = await listeningPids(port);
  if (pids.length === 0) return "clear";
  if (await botHealth(port, 1200) !== "unauthorized") return "collision";
  for (const pid of pids) {
    if (process.platform === "win32") await execAsync(`taskkill /PID ${pid} /T /F`);
    else { try { process.kill(pid, "SIGKILL"); } catch {} }
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  pids = await listeningPids(port);
  return pids.length === 0 ? "clear" : "collision";
}

/* ── 봇 로그 파이핑을 완전히 제거함 (v2.0.26) ──
   ★★진짜 멈춤(뱅글뱅글+클릭불가) 원인 = 봇 자식 프로세스의 출력을 메인이 받은 것.
   카테고리 로드 등에서 봇이 Playwright/크롬을 실행하다 실패하면 stderr로 에러를 초당 수천 줄
   폭주시키는데, v2.0.22가 그 출력을 `child.stdout/stderr.on("data")`로 메인 프로세스에서 받아
   줄마다 처리(문자열+콘솔+파일)했다 → 메인 스레드가 이벤트 폭주에 묶여 창이 응답 불가(busy 커서,
   클릭·창닫기 전부 안 됨), 봇도 결국 죽어 "서버 오프라인". 파일 위치/동기·비동기 문제가 아니라
   **봇 출력을 메인이 받는 것 자체가 독**이었다. → stdio를 'ignore'로 두어 봇 출력이 메인에
   아예 도달하지 않게 한다(로그 저장 기능 폐기). 봇이 아무리 토해내도 메인은 무사하다. */

function botEnvironment(extra: NodeJS.ProcessEnv = {}): Record<string, string> {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra,
    PUBLY_SESSION_DIR: path.join(app.getPath("userData"), "publy-sessions"),
    PUBLY_LOCK_DIR: path.join(app.getPath("userData"), "account-locks"),
    // 봇이 "자기 로그를 스스로" 이 폴더에 쓴다(메인은 봇 출력을 안 받음 → 화면 안 멈춤).
    // 버그 신고 시 이 폴더의 로그를 회원이 보내주면 아이디로 확인 가능.
    PUBLY_LOG_DIR: path.join(app.getPath("userData"), "logs"),
    BOT_AUTH_TOKEN: botAuthToken,
  };
  // child_process env에 undefined가 섞이지 않도록 문자열 값만 전달
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (typeof v === "string") clean[k] = v;
  return clean;
}

/* 봇은 Electron utility-process가 아닌 독립 Node 자식으로 실행한다.
   Playwright가 Chromium 자식 프로세스 트리를 만드는 동안 봇을 Electron 메인의
   utility-process 생명주기/IPC에 결합하지 않는다. */
async function forkBotServer(opts: {
  name: string;
  botPath: string;      // dist/server.js 가 들어있는 폴더
  chromiumPath: string;
  port: number;
  extraEnv?: NodeJS.ProcessEnv;
  getProc: () => ChildProcess | null;
  setProc: (p: ChildProcess | null) => void;
}) {
  const fs = await import("fs");
  const serverJs = path.join(opts.botPath, "dist", "server.js");
  if (!fs.existsSync(serverJs)) {
    console.error(`[${opts.name}] dist/server.js 없음:`, serverJs);
    return;
  }

  const env = botEnvironment({ PLAYWRIGHT_BROWSERS_PATH: opts.chromiumPath, ...(opts.extraEnv || {}) });

  // 짧게 뜬 뒤 죽는 프로세스는 성공 기동이 아니다. 일정 시간 생존해야 백오프를 리셋한다.
  let restartAttempts = 0;
  let generation = 0;
  let restartInFlight: Promise<boolean> | null = null;
  let scheduledRestart: NodeJS.Timeout | null = null;
  let graceTimer: NodeJS.Timeout | null = null;
  let lastRestartAt = 0;
  const expectedExits = new WeakSet<ChildProcess>();
  const cancelScheduledRestart = () => {
    if (scheduledRestart) clearTimeout(scheduledRestart);
    scheduledRestart = null;
  };
  const setState = (state: BotState, entry?: BotEntry) => { if (entry) entry.state = state; };
  const scheduleRestart = () => {
    if (app.isQuitting) return;
    cancelScheduledRestart();
    restartAttempts++;
    const delay = Math.min(60000, 3000 * restartAttempts); // 3s,6s,9s…최대 60s
    scheduledRestart = setTimeout(() => {
      scheduledRestart = null;
      void restart("scheduled");
    }, delay);
  };

  const start = async (myGeneration: number): Promise<boolean> => {
    const current = opts.getProc();
    if (current && current.exitCode === null && !current.killed) return true;
    console.log(`[${opts.name}] 서버 시작...`);
    const portResult = await killPort(opts.port, current);
    if (portResult === "collision") {
      console.error(`[${opts.name}] :${opts.port} 포트를 다른 프로그램이 사용 중이라 시작하지 않음`);
      return false;
    }
    if (app.isQuitting) return false;
    const child = spawn(process.execPath, [serverJs], {
      cwd: opts.botPath,
      stdio: "ignore",
      windowsHide: true,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    });
    if (myGeneration !== generation || app.isQuitting) {
      expectedExits.add(child);
      await terminateTrackedChild(child);
      return false;
    }
    opts.setProc(child);
    const stableTimer = setTimeout(() => { restartAttempts = 0; }, 30000);
    child.on("spawn", () => console.log(`[${opts.name}] 실행됨 pid=${child.pid}`));
    child.on("error", (error) => console.error(`[${opts.name}] 실행 실패:`, error.message));
    child.on("close", (code) => {
      clearTimeout(stableTimer);
      if (opts.getProc() === child) opts.setProc(null);
      if (expectedExits.has(child) || myGeneration !== generation || app.isQuitting) return;
      console.warn(`[${opts.name}] 종료 (code: ${code}). 재시작 예약...`);
      scheduleRestart();
    });
    return true;
  };

  let entry: BotEntry;
  const restart = (reason: "initial" | "scheduled" | "watchdog" | "manual"): Promise<boolean> => {
    if (restartInFlight) return restartInFlight;
    cancelScheduledRestart();
    if (graceTimer) clearTimeout(graceTimer);
    const waitMs = reason === "manual" ? Math.max(0, 2000 - (Date.now() - lastRestartAt)) : 0;
    setState("restarting", entry);
    restartInFlight = (async () => {
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      const oldChild = opts.getProc();
      generation++;
      if (oldChild) expectedExits.add(oldChild);
      await terminateTrackedChild(oldChild);
      if (opts.getProc() === oldChild) opts.setProc(null);
      if (reason !== "scheduled") restartAttempts = 0;
      lastRestartAt = Date.now();
      return await start(generation);
    })().finally(() => {
      restartInFlight = null;
      if (app.isQuitting) return;
      setState("grace", entry);
      const graceGeneration = generation;
      graceTimer = setTimeout(() => {
        if (generation === graceGeneration) setState("idle", entry);
        graceTimer = null;
      }, 15000);
    });
    return restartInFlight;
  };

  entry = {
    name: opts.name,
    port: opts.port,
    state: "idle",
    restart: () => restart("manual"),
    cancelScheduledRestart,
  };
  botRegistry.push(entry);

  await restart("initial");
}

// ── 봇 서버 워치독 ──
// 30초마다 각 봇의 /health를 확인. 응답이 없으면(프로세스는 살아도 hung 포함)
// 해당 서버만 조용히 재시작한다. crash는 forkBotServer의 close 핸들러가 이미 처리하지만,
// "포트는 물고 있는데 응답 없는 좀비"는 close가 안 떠서 이 워치독이 잡아낸다.
async function pingBot(port: number): Promise<boolean> {
  return await botHealth(port) === "online";
}

async function waitForBotHealth(port: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await pingBot(port)) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline && !app.isQuitting);
  return false;
}

function startBotWatchdog() {
  const scan = async () => {
    try {
      if (app.isQuitting) return;
      for (const bot of botRegistry) {
        if (bot.state !== "idle") continue;
        if (await pingBot(bot.port)) continue;
        await new Promise((r) => setTimeout(r, 1500));
        if (await pingBot(bot.port)) continue;
        console.warn(`[watchdog] ${bot.name}(:${bot.port}) 인증 health 실패 → 자동 재시작`);
        try { await bot.restart(); } catch (e: any) { console.error(`[watchdog] ${bot.name} 재시작 실패:`, e?.message); }
      }
    } catch (e: any) {
      console.error("[watchdog] 검사 실패:", e?.message);
    } finally {
      if (!app.isQuitting) setTimeout(() => { void scan(); }, 30000);
    }
  };
  setTimeout(() => { void scan(); }, 30000);
}

const resourceDir = (rel: string) =>
  isDev ? path.join(__dirname, "../../", rel) : path.join(process.resourcesPath, rel);

async function startBotServer() {
  await forkBotServer({
    name: "bot",
    botPath: resourceDir("naver-bot"),
    chromiumPath: resourceDir("chromium"),
    port: 3333,
    getProc: () => botProcess,
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
    getProc: () => neighborBotProcess,
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
    getProc: () => instaBotProcess,
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
  startBotWatchdog();            // ★ 봇 서버 자동 감시·복구 시작
  createWindow();
  app.on("activate", () => { if (!mainWindow) createWindow(); });
});

let shutdownPromise: Promise<void> | null = null;
let shutdownComplete = false;
function shutdownBots(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  app.isQuitting = true;
  for (const bot of botRegistry) bot.cancelScheduledRestart();
  shutdownPromise = Promise.all([
    killPort(3333, botProcess),
    killPort(3334, neighborBotProcess),
    killPort(3335, instaBotProcess),
  ]).then(() => undefined);
  return shutdownPromise;
}

app.on("window-all-closed", () => {
  void shutdownBots().finally(() => {
    shutdownComplete = true;
    if (process.platform !== "darwin") app.quit();
  });
});
app.on("before-quit", event => {
  if (shutdownComplete) return;
  event.preventDefault();
  void shutdownBots().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});

ipcMain.handle("get-bot-status", async () => {
  try {
    const res = await fetch("http://127.0.0.1:3333/health", { headers: { Authorization: `Bearer ${botAuthToken}` }, signal: AbortSignal.timeout(2000) });
    return res.ok ? "online" : "offline";
  } catch { return "offline"; }
});

// 봇 3종 개별 상태(발행/이웃/인스타). 탭별로 정확한 온·오프라인 표시용.
ipcMain.handle("get-all-bot-status", async () => {
  const ports = { publish: 3333, neighbor: 3334, insta: 3335 };
  const out: Record<string, "online" | "offline"> = {};
  await Promise.all(Object.entries(ports).map(async ([k, p]) => {
    out[k] = (await pingBot(p)) ? "online" : "offline";
  }));
  return out;
});

// 회원이 직접 누르는 "봇 다시 시작"(터미널 없이 스스로 복구). name 없으면 전부.
ipcMain.handle("restart-bots", async (event, name?: string) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error("Unauthorized IPC sender");
  }
  const allowedNames = new Set(botRegistry.map(bot => bot.name));
  if (name !== undefined && (typeof name !== "string" || !allowedNames.has(name))) {
    throw new Error("Invalid bot name");
  }
  const targets = name ? botRegistry.filter(b => b.name === name) : botRegistry;
  const results: Record<string, boolean> = {};
  for (const bot of targets) {
    try {
      const started = await bot.restart();
      if (!started) { results[bot.name] = false; continue; }
      results[bot.name] = await waitForBotHealth(bot.port);
    }
    catch { results[bot.name] = false; }
  }
  return results;
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

/* ── 앱 버전 (화면에 표시해 회원이 최신인지 눈으로 확인) ── */
ipcMain.handle("get-app-version", () => app.getVersion());

/* ── 앱 창 앞으로 가져오기 ──
   봇이 로그인용 브라우저 창(headless:false)을 띄웠다 닫으면, macOS에서 포커스가 딴 데로 가며
   퍼블리 창이 뒤로 숨는 현상이 있다. 로그인·발송 등 봇 브라우저 작업 후 renderer가 이걸 호출해 앱을 다시 앞으로. */
ipcMain.handle("focus-app", () => {
  try {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
  } catch {}
});

/* ── 절전 방지: 글쓰기(발행)·이미지 생성 중에는 화면/시스템이 안 꺼지게 (맥·윈도우 공통) ──
   powerSaveBlocker('prevent-display-sleep')는 디스플레이+시스템 잠자기를 둘 다 막는다.
   작업 끝나면 renderer가 keepAwake(false)로 꺼서 원래대로 복귀(평소엔 정상 절전). */
let powerBlockerId = -1;
ipcMain.handle("keep-awake", (_e, on: boolean) => {
  try {
    if (on) {
      if (powerBlockerId === -1 || !powerSaveBlocker.isStarted(powerBlockerId)) {
        powerBlockerId = powerSaveBlocker.start("prevent-display-sleep");
        console.log("[power] 절전 방지 ON (작업 중 화면 안 꺼짐)");
      }
    } else if (powerBlockerId !== -1 && powerSaveBlocker.isStarted(powerBlockerId)) {
      powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = -1;
      console.log("[power] 절전 방지 OFF (작업 끝 — 평소대로)");
    }
    return { ok: true, active: powerBlockerId !== -1 };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

/* ── 버그 신고: 봇 로그 폴더 열기 ── 회원이 문제 신고 시 이 폴더의 로그 파일을 보내면 원인 확인 가능. */
ipcMain.handle("open-log-folder", async () => {
  const dir = path.join(app.getPath("userData"), "logs");
  try { require("fs").mkdirSync(dir, { recursive: true }); } catch {}
  try { await shell.openPath(dir); return true; } catch { return false; }
});

/* ── 버그 신고: 최근 로그 텍스트 읽기 ── (오늘/어제 로그의 마지막 ~400줄) 신고에 첨부해 관리자 페이지로 전송. */
ipcMain.handle("read-bot-log", async () => {
  try {
    const fs = require("fs") as typeof import("fs");
    const dir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(dir)) return "";
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".log")).sort();
    const pick = files.slice(-2); // 어제+오늘
    let text = "";
    for (const f of pick) {
      try { text += `\n===== ${f} =====\n` + fs.readFileSync(path.join(dir, f), "utf8"); } catch {}
    }
    const lines = text.split("\n");
    return lines.slice(-400).join("\n").slice(-20000); // 마지막 400줄, 최대 20KB
  } catch { return ""; }
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
  preview.setMenuBarVisibility(false);
  // ★data: URL은 길이 제한이 있어 base64 이미지가 든 글이면 로드 실패(백지)가 난다.
  //   임시 HTML 파일로 써서 loadFile로 연다(이미지 크기 무관). 창 닫히면 파일 삭제.
  try {
    const fs = await import("fs");
    const os = await import("os");
    const tmp = path.join(os.tmpdir(), `publy-preview-${Date.now()}.html`);
    fs.writeFileSync(tmp, html, "utf-8");
    await preview.loadFile(tmp);
    preview.on("closed", () => { try { fs.unlinkSync(tmp); } catch {} });
  } catch (e) {
    // 폴백: 파일 실패 시 기존 data URL 방식
    preview.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  }
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
  try {
    if (flowChromeProc?.pid) {
      if (process.platform === "win32") await execAsync(`taskkill /PID ${flowChromeProc.pid} /T /F`);
      else {
        // ★먼저 정상종료(SIGTERM)로 크롬이 세션·쿠키를 디스크에 안전하게 쓰고 닫게 한다 → 프로필 손상으로
        //   인한 불필요한 구글 재로그인 방지. 안 죽으면 그때 강제종료(SIGKILL).
        try { process.kill(-flowChromeProc.pid, "SIGTERM"); } catch {} try { flowChromeProc.kill("SIGTERM"); } catch {}
        await new Promise(r => setTimeout(r, 1500));
        try { process.kill(-flowChromeProc.pid, "SIGKILL"); } catch {} try { flowChromeProc.kill("SIGKILL"); } catch {}
      }
    }
  } catch {}
  flowChromeProc = null;
  try {
    if (process.platform === "win32") {
      // WMIC은 최신 Windows에서 제거됐다. 인자를 Base64로 전달해 사용자 경로의 따옴표/특수문자도
      // 명령으로 해석되지 않게 하고, 이 전용 프로필을 사용하는 Chrome 트리만 정리한다.
      const escapedDir = dir.replace(/'/g, "''");
      const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir=${escapedDir}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      await execAsync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`);
    } else {
      try { execSync(`pkill -TERM -f "user-data-dir=${dir}"`, { stdio: "ignore" }); } catch {}
      await new Promise(r => setTimeout(r, 1200));
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
  const flowUrl = "https://labs.google/fx/ko/tools/flow";

  // Windows Chrome singleton은 같은 프로필의 두 번째 실행 요청을 기존의 최소화/후면 창으로
  // 넘길 수 있다. 준비 버튼을 다시 누르면 새 창 요청을 기존 인스턴스에 전달해 사용자가 볼 수 있게 한다.
  if (await flowChromeHealthy()) {
    if (process.platform === "win32") {
      try {
        const reveal = spawn(chromePath, [`--user-data-dir=${profileDir}`, "--new-window", flowUrl], { detached: true, stdio: "ignore" });
        reveal.unref();
      } catch {}
    }
    return { ok: true, already: true };
  }

  // 포트는 응답해도 좀비(타겟 0개)이거나 죽은 크롬일 수 있음 → 깨끗이 정리 후 새로 띄운다
  await killStaleFlowChrome();

  try {
    flowChromeProc = spawn(chromePath, [
      `--remote-debugging-port=${FLOW_CDP_PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      "--new-window",
      flowUrl,
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
