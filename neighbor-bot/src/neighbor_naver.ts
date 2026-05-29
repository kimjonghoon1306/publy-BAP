import { chromium, BrowserContext, Page } from "playwright";
import fs from "fs";
import path from "path";

const SESSION_DIR = path.join(__dirname, "../sessions");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessionPath = (accountId: string) =>
  path.join(SESSION_DIR, `neighbor_${accountId}.json`);

const DONE_DIR = path.join(__dirname, "../done");
if (!fs.existsSync(DONE_DIR)) fs.mkdirSync(DONE_DIR, { recursive: true });

export const donePath = (accountId: string) =>
  path.join(DONE_DIR, `done_${accountId}.json`);

const ANTI_DETECTION_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) { window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} }; }
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5].map(() => ({ name: 'Chrome PDF Plugin' })) });
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US','en'] });
`;

const LAUNCH_ARGS = [
  "--no-sandbox","--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-first-run","--no-default-browser-check",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function applyAntiDetection(context: BrowserContext) {
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
}
async function randomDelay(min: number, max: number) {
  const ms = (Math.random() * (max - min) + min) * 1000;
  await new Promise((r) => setTimeout(r, ms));
}

export function sessionExists(accountId: string): boolean {
  return fs.existsSync(sessionPath(accountId));
}

/* ── 로그인 & 세션 저장 ── */
export async function saveSession(accountId: string, id: string, pw: string): Promise<{ blogId: string }> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS, slowMo: 50 });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await applyAntiDetection(context);
  const page = await context.newPage();
  try {
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);
    await page.evaluate((v) => { const el = document.querySelector("#id") as HTMLInputElement; if(el){el.focus();el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));} }, id);
    await page.waitForTimeout(400);
    await page.evaluate((v) => { const el = document.querySelector("#pw") as HTMLInputElement; if(el){el.focus();el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));} }, pw);
    await page.waitForTimeout(400);
    await page.click(".btn_login").catch(() => page.click("button[type='submit']"));
    console.log("[neighbor] 로그인 대기... (캡차 있으면 직접 풀어주세요)");
    await page.waitForFunction(() => !location.href.includes("nid.naver.com/nidlogin"), { timeout: 90000 });
    await page.waitForTimeout(2000);
    if (page.url().includes("nidlogin")) throw new Error("로그인 실패");

    let blogId: string | null = null;
    const INVALID = ["PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite"];
    try {
      await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const m = page.url().match(/[?&]blogId=([a-zA-Z0-9_-]+)/);
      if (m && m[1] && !INVALID.includes(m[1])) blogId = m[1];
    } catch {}
    if (!blogId) {
      try {
        await page.goto("https://m.blog.naver.com", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);
        const m = page.url().match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !INVALID.includes(m[1])) blogId = m[1];
      } catch {}
    }
    if (!blogId) blogId = id;

    const cookies = await context.cookies();
    fs.writeFileSync(sessionPath(accountId), JSON.stringify({ loginId: id, blogId, cookies, pw: Buffer.from(pw).toString("base64") }, null, 2));
    await browser.close();
    console.log(`[neighbor] ✅ 세션 저장 완료 blogId=${blogId}`);
    return { blogId };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 세션 불러오기 ── */
async function loadSession(accountId: string) {
  const sp = sessionPath(accountId);
  if (!fs.existsSync(sp)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const saved = JSON.parse(fs.readFileSync(sp, "utf-8"));
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await applyAntiDetection(context);
  await context.addCookies(saved.cookies);
  return { context, browser, blogId: saved.blogId as string };
}

/* ── 키워드로 블로그 ID 수집 ── */
export async function crawlBlogIds(params: {
  accountId: string;
  keywords: string[];
  countPerKeyword: number;
  onLog: (msg: string) => void;
}): Promise<{ keyword: string; blogId: string }[]> {
  const { accountId, keywords, countPerKeyword, onLog } = params;
  const results: { keyword: string; blogId: string }[] = [];
  const { context, browser } = await loadSession(accountId);
  const page = await context.newPage();
  const INVALID = ["PostView","PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite","search","api"];

  try {
    for (const kw of keywords) {
      onLog(`🔍 [${kw}] 수집 시작...`);
      let collected = 0;
      let start = 1;

      while (collected < countPerKeyword) {
        try {
          const url = `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(kw)}&start=${start}`;
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(1500);

          const links: string[] = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll("a[href*='blog.naver.com']"));
            return anchors.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.includes("blog.naver.com"));
          });

          for (const link of links) {
            if (collected >= countPerKeyword) break;
            const m = link.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
            if (!m) continue;
            const blogId = m[1];
            if (INVALID.some(inv => blogId.toLowerCase().includes(inv.toLowerCase()))) continue;
            if (blogId.length < 3) continue;
            if (results.some((r) => r.blogId === blogId)) continue;
            results.push({ keyword: kw, blogId });
            collected++;
            onLog(`  📌 [${kw}] ${blogId} (${collected}/${countPerKeyword})`);
          }

          if (collected >= countPerKeyword) break;
          start += 10;
          await randomDelay(0.5, 1.5);
        } catch (e: any) {
          onLog(`  ⚠️ [${kw}] 오류: ${e.message}`);
          break;
        }
      }
      onLog(`✅ [${kw}] 완료: ${collected}개 수집`);
    }
    await browser.close();
    return results;
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 서로이웃 신청 ── */
export interface NeighborResult {
  keyword: string;
  blogId: string;
  status: "success" | "fail" | "skip" | "limit";
  message: string;
}

export async function addNeighbors(params: {
  accountId: string;
  targets: { keyword: string; blogId: string }[];
  message: string;
  delayMin: number;
  delayMax: number;
  dailyLimit: number;
  skipDone: boolean;
  onLog: (msg: string) => void;
  onResult: (r: NeighborResult) => void;
  onProgress: (done: number, fail: number) => void;
  stopSignal: () => boolean;
}): Promise<void> {
  const { accountId, targets, message, delayMin, delayMax, dailyLimit, skipDone, onLog, onResult, onProgress, stopSignal } = params;

  let doneSet = new Set<string>();
  const dp = donePath(accountId);
  if (skipDone && fs.existsSync(dp)) {
    try { doneSet = new Set(JSON.parse(fs.readFileSync(dp, "utf-8"))); } catch {}
  }

  let done = 0;
  let fail = 0;
  const { context, browser } = await loadSession(accountId);
  const page = await context.newPage();

  try {
    for (const target of targets) {
      if (stopSignal()) { onLog("⛔ 작업 중단됨"); break; }
      if (done >= dailyLimit) {
        onLog(`🚫 일일 한도(${dailyLimit}개) 도달`);
        onResult({ ...target, status: "limit", message: "일일 한도 도달" });
        break;
      }
      if (skipDone && doneSet.has(target.blogId)) {
        onLog(`⏭️ [${target.blogId}] 이미 완료 — 스킵`);
        onResult({ ...target, status: "skip", message: "이미 완료" });
        continue;
      }

      onLog(`👥 [${target.blogId}] 서로이웃 신청 중...`);
      try {
        await page.goto(`https://blog.naver.com/${target.blogId}`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(1500);

        // 신청 버튼 탐색 (메인 + 모든 iframe)
        const BTNS = ["a[onclick*='addNeighbor']","a[onclick*='neighbor']",".btn_buddy","a.btn_buddy","#followBtn",".followBtn","a[class*='mutual']","button[class*='neighbor']"];
        let clicked = false;

        for (const sel of BTNS) {
          try { if (await page.$(sel)) { await page.click(sel); clicked = true; break; } } catch {}
        }
        if (!clicked) {
          for (const frame of page.frames()) {
            for (const sel of BTNS) {
              try { if (await frame.$(sel)) { await frame.click(sel); clicked = true; break; } } catch {}
            }
            if (clicked) break;
          }
        }
        if (!clicked) {
          // 직접 URL 시도
          await page.goto(`https://blog.naver.com/${target.blogId}?Redirect=AddBuddy`, { waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(1000);
          for (const sel of BTNS) {
            try { if (await page.$(sel)) { await page.click(sel); clicked = true; break; } } catch {}
          }
        }
        if (!clicked) throw new Error("신청 버튼을 찾을 수 없음");

        await page.waitForTimeout(1500);

        // 모달 처리
        const MODALS = [".layer_buddy",".popup_buddy","#neighbor_popup","[class*='AddBuddy']","[class*='addBuddy']","[role='dialog']"];
        for (const sel of MODALS) {
          try {
            await page.waitForSelector(sel, { timeout: 3000 });
            // 서로이웃 라디오 선택
            for (const ms of ["input[value='mutual']","input[id*='mutual']",".radio_mutual","input[type='radio']:last-child"]) {
              try { await page.click(ms); break; } catch {}
            }
            await page.waitForTimeout(400);
            // 메시지 입력
            for (const ts of ["textarea[name='message']","textarea[id*='message']","textarea"]) {
              try { const ta = await page.$(ts); if(ta){ await ta.fill(""); await ta.type(message, { delay: 30 }); break; } } catch {}
            }
            await page.waitForTimeout(400);
            // 확인
            for (const cs of ["button[type='submit']",".btn_confirm",".btn_ok","button:has-text('신청')","button:has-text('확인')"]) {
              try { await page.click(cs); break; } catch {}
            }
            await page.waitForTimeout(1000);
            break;
          } catch {}
        }

        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.includes("이웃수가 5") || bodyText.includes("한도") || bodyText.includes("초과")) {
          onLog(`🚫 [${target.blogId}] 상대방 이웃 한도 초과`);
          onResult({ ...target, status: "fail", message: "상대방 이웃 한도 초과" });
          fail++;
        } else if (bodyText.includes("이미 이웃") || bodyText.includes("already")) {
          onLog(`⏭️ [${target.blogId}] 이미 이웃`);
          onResult({ ...target, status: "skip", message: "이미 이웃" });
        } else {
          onLog(`✅ [${target.blogId}] 신청 완료!`);
          onResult({ ...target, status: "success", message: "신청 완료" });
          done++;
          doneSet.add(target.blogId);
          if (skipDone) fs.writeFileSync(dp, JSON.stringify([...doneSet], null, 2));
        }
        onProgress(done, fail);
      } catch (e: any) {
        onLog(`❌ [${target.blogId}] 오류: ${e.message}`);
        onResult({ ...target, status: "fail", message: e.message });
        fail++;
        onProgress(done, fail);
      }

      if (!stopSignal()) await randomDelay(delayMin, delayMax);
    }
    await browser.close();
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
