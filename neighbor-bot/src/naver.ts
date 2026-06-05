import { chromium, BrowserContext } from "playwright";
import fs from "fs";
import https from "https";
import http from "http";
import os from "os";
import path from "path";
import { getAccountCredentials } from "./supabase";

const SESSION_DIR = path.join(__dirname, "../sessions");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessionPath = (userId: string) => path.join(SESSION_DIR, `naver_${userId}.json`);

export function naverSessionExists(userId: string): boolean {
  return fs.existsSync(sessionPath(userId));
}

/* ── 봇 탐지 우회 ── */
const ANTI_DETECTION_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) {
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
  }
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1,2,3,4,5].map(() => ({ name: 'Chrome PDF Plugin' }))
  });
  Object.defineProperty(navigator, 'languages', {
    get: () => ['ko-KR','ko','en-US','en']
  });
  const origQuery = window.navigator.permissions?.query;
  if (origQuery) {
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  }
`;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-first-run",
  "--no-default-browser-check",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ── 멘트 자연 변형 헬퍼 ── */
function naturalizeMsg(msg: string): string {
  let result = msg;

  // 1) 끝 이모지 랜덤 교체/추가
  const emojiPool = ["😊", "🙂", "😄", "👍", "✨", "🌟", "💕", "🤗", "😍", "🙌"];
  result = result.replace(/[😊🙂😄👍✨🌟💕🤗😍🙌]$/u, () =>
    emojiPool[Math.floor(Math.random() * emojiPool.length)]
  );

  // 2) 인삿말 미세 변형
  const greetings: Record<string, string[]> = {
    "안녕하세요!": ["안녕하세요~", "안녕하세요 :)", "안녕하세요^^", "안녕하세요!"],
    "안녕하세요": ["안녕하세요~", "안녕하세요^^", "안녕하세요!"],
    "좋은 글": ["좋은 글", "유익한 글", "좋은 내용"],
    "잘 읽고 갑니다": ["잘 읽었습니다", "잘 보고 갑니다", "잘 읽고 갑니다"],
  };
  for (const [key, variants] of Object.entries(greetings)) {
    if (result.includes(key)) {
      const pick = variants[Math.floor(Math.random() * variants.length)];
      result = result.replace(key, pick);
      break;
    }
  }

  // 3) 가끔 앞에 감탄사 추가 (15% 확률)
  const interjections = ["오, ", "와~ ", "정말 ", ""];
  if (Math.random() < 0.15) {
    const interj = interjections[Math.floor(Math.random() * (interjections.length - 1))];
    result = interj + result.charAt(0).toLowerCase() + result.slice(1);
  }

  // 4) 문장 끝 느낌표 ↔ ~ 랜덤 교체 (20% 확률)
  if (Math.random() < 0.2) {
    result = result.replace(/!$/, "~").replace(/~$/, "!");
  }

  return result;
}

/* ── 휴먼 딜레이 헬퍼 (정규분포) ── */
function humanDelay(minSec: number, maxSec: number): number {
  // 균등 랜덤 대신 정규분포 (중간값에 몰리는 사람 패턴)
  const mean = (minSec + maxSec) / 2;
  const std = (maxSec - minSec) / 4;
  const u = 1 - Math.random();
  const v = Math.random();
  const normal = mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(maxSec, Math.max(minSec, normal)) * 1000;
}

/* ── 휴먼 타이핑 헬퍼 ── */
async function humanType(page: any, text: string, opts?: { typoRate?: number }) {
  const typoRate = opts?.typoRate ?? 0.04; // 4% 확률로 오타

  // 정규분포 난수 (Box-Muller)
  const randNorm = (mean: number, std: number) => {
    const u = 1 - Math.random();
    const v = Math.random();
    return Math.max(0, mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  };

  const PUNCTUATION = new Set([".", ",", "!", "?", "~", " ", "\n"]);
  const NEARBY: Record<string, string[]> = {
    "ㄱ":["ㅂ","ㄴ"],"ㄴ":["ㄱ","ㅇ"],"ㄷ":["ㄹ","ㅅ"],"ㄹ":["ㄷ","ㅎ"],
    "a":["s","q"],"s":["a","d"],"d":["s","f"],"e":["w","r"],
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // 오타 삽입 (영문/숫자만)
    if (typoRate > 0 && Math.random() < typoRate && /[a-zA-Z]/.test(ch)) {
      const typoPool = NEARBY[ch.toLowerCase()] || ["x"];
      const typo = typoPool[Math.floor(Math.random() * typoPool.length)];
      await page.keyboard.type(typo);
      await page.waitForTimeout(randNorm(120, 40));
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(randNorm(80, 20));
    }

    await page.keyboard.type(ch);

    // 글자마다 랜덤 딜레이
    if (PUNCTUATION.has(ch)) {
      // 구두점/공백 뒤: 더 긴 멈춤
      await page.waitForTimeout(randNorm(220, 60));
    } else {
      await page.waitForTimeout(randNorm(75, 30));
    }

    // 가끔 생각하는 척 멈춤 (7% 확률, 300~700ms)
    if (Math.random() < 0.07) {
      await page.waitForTimeout(randNorm(500, 120));
    }
  }
}

async function applyAntiDetection(context: BrowserContext) {
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
}

/* ── 이미지 다운로드 (썸네일용) ── */
async function downloadImageToTemp(url: string): Promise<string | null> {
  try {
    const ext = url.includes(".png") ? ".png" : ".jpg";
    const tmpFile = path.join(os.tmpdir(), `publy_img_${Date.now()}${ext}`);
    const proto = url.startsWith("https") ? https : http;
    return new Promise((resolve) => {
      const file = fs.createWriteStream(tmpFile);
      proto.get(url, (res) => {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(tmpFile); });
      }).on("error", () => {
        try { fs.unlinkSync(tmpFile); } catch {}
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

/* ── 네이버 로그인 + blogId 추출 ── */
export async function saveNaverSession(
  userId: string, id: string, pw: string
): Promise<{ blogId: string }> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS, slowMo: 50 });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    console.log("[naver] 로그인 페이지 진입...");
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);

    await page.evaluate((v) => {
      const el = document.querySelector("#id") as HTMLInputElement;
      if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }, id);
    await page.waitForTimeout(400);

    await page.evaluate((v) => {
      const el = document.querySelector("#pw") as HTMLInputElement;
      if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }, pw);
    await page.waitForTimeout(400);

    await page.click(".btn_login").catch(() => page.click("button[type='submit']"));

    console.log("[naver] 로그인 대기 중... (캡차 있으면 직접 풀어주세요)");
    try {
      await page.waitForFunction(
        () => !location.href.includes("nid.naver.com/nidlogin"),
        { timeout: 90000 }
      );
    } catch {
      throw new Error("로그인 시간 초과 (90초)");
    }

    await page.waitForTimeout(2000);
    if (page.url().includes("nidlogin")) throw new Error("로그인 실패");
    console.log("[naver] ✅ 로그인 성공");

    let blogId: string | null = null;
    const INVALID_IDS = ["PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite"];

    try {
      await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const m = page.url().match(/[?&]blogId=([a-zA-Z0-9_-]+)/);
      if (m && m[1] && !INVALID_IDS.includes(m[1])) blogId = m[1];
    } catch {}

    if (!blogId) {
      try {
        await page.goto("https://m.blog.naver.com", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);
        const m = page.url().match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !INVALID_IDS.includes(m[1])) blogId = m[1];
      } catch {}
    }

    if (!blogId) blogId = id;
    console.log(`[naver] ✅ blogId: ${blogId}`);

    const cookies = await context.cookies();
    // 비밀번호 저장 (자동 재로그인용, base64)
    fs.writeFileSync(sessionPath(userId), JSON.stringify({
      loginId: id,
      blogId,
      cookies,
      pw: Buffer.from(pw).toString("base64"),
    }, null, 2));
    await browser.close();
    return { blogId };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 자동 재로그인 (세션 만료 시) ── */
export async function reloginNaverSilent(userId: string): Promise<boolean> {
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) return false;

  const session = JSON.parse(fs.readFileSync(sp, "utf-8"));
  let loginId: string = session.loginId;
  let pw: string | null = null;

  // 1순위: 세션 파일에 저장된 pw
  if (session.pw) {
    try { pw = Buffer.from(session.pw, "base64").toString("utf-8"); } catch {}
  }
  // 2순위: Supabase publy_accounts에서 조회
  if (!pw) {
    const creds = await getAccountCredentials(userId, "naver").catch(() => null);
    if (creds) { loginId = creds.id; pw = creds.pw; }
  }
  if (!pw) { console.log("[naver] 자동재로그인 실패: 비밀번호 없음"); return false; }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(600);

    await page.evaluate((v) => {
      const el = document.querySelector("#id") as HTMLInputElement;
      if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }, loginId);
    await page.waitForTimeout(300);
    await page.evaluate((v) => {
      const el = document.querySelector("#pw") as HTMLInputElement;
      if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }, pw);
    await page.waitForTimeout(300);
    await page.click(".btn_login").catch(() => page.click("button[type='submit']"));

    // 캡차가 나오면 실패 (헤드리스라 처리 불가)
    await page.waitForFunction(
      () => !location.href.includes("nid.naver.com/nidlogin"),
      { timeout: 15000 }
    );
    await page.waitForTimeout(1500);

    if (page.url().includes("nidlogin")) { await browser.close(); return false; }

    const cookies = await context.cookies();
    const oldSession = JSON.parse(fs.readFileSync(sp, "utf-8"));
    fs.writeFileSync(sp, JSON.stringify({ ...oldSession, cookies }, null, 2));
    await browser.close();
    console.log("[naver] ✅ 자동 재로그인 성공");
    return true;
  } catch {
    await browser.close().catch(() => {});
    return false;
  }
}

/* ── 카테고리 목록 조회 ── */
export async function getNaverCategories(
  userId: string
): Promise<{ id: string; name: string }[]> {
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) throw new Error("네이버 세션 없음");

  const { blogId, cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    await page.goto(
      `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`,
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(4000);

    const getFrame = () => {
      const frames = page.frames();
      return frames.find(f => f.name() === "mainFrame")
        ?? frames.find(f => f.url().includes("blog.naver.com"))
        ?? frames[1] ?? null;
    };
    let frame = getFrame();
    for (let i = 0; i < 6; i++) {
      if (frame) break;
      await page.waitForTimeout(1000);
      frame = getFrame();
    }
    if (!frame) { await browser.close(); return []; }

    // 발행 패널 열기
    const publishSels = [
      "button.publish_btn__Y8C4q",
      "button[class*='publish_btn']",
      "button:has-text('발행')",
    ];
    for (const sel of publishSels) {
      try {
        const el = await frame.$(sel);
        if (el) { await frame.click(sel, { timeout: 5000 }); break; }
      } catch {}
    }
    await page.waitForTimeout(2500);

    // 카테고리 select 옵션 추출
    const categories: { id: string; name: string }[] = [];
    const catSels = [
      "select.category_select__YWKIP",
      "select[class*='category_select']",
      "select[class*='category']",
      ".publish_panel select",
      "select[name='categoryNo']",
    ];
    for (const sel of catSels) {
      try {
        const opts = await frame.$$(sel + " option");
        if (opts.length > 0) {
          for (const opt of opts) {
            const value = await opt.getAttribute("value");
            const text = await opt.textContent();
            if (value && value !== "0" && value !== "-1" && text?.trim()) {
              categories.push({ id: value, name: text.trim() });
            }
          }
          break;
        }
      } catch {}
    }
    await browser.close();
    return categories;
  } catch (e) {
    await browser.close().catch(() => {});
    console.error("[naver] 카테고리 조회 실패:", e);
    return [];
  }
}

/* ── 네이버 블로그 자동발행 ── */
export async function publishNaver(params: {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  imageUrl?: string;
  categoryId?: string;
  visibility?: "public" | "neighbor" | "private";
  scheduleTime?: string;
  blocks?: Array<{type: string; content?: string; src?: string; alt?: string}>;
}): Promise<string> {
  const { userId, title, content, tags, imageUrl, categoryId, visibility = "public", scheduleTime, blocks } = params;
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) throw new Error("네이버 세션 없음. 계정 재연결 필요");

  const { blogId, cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));

  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`;
    console.log(`[naver] 글쓰기 진입: ${writeUrl}`);
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (page.url().includes("nidlogin") || page.url().includes("login.naver")) {
      fs.unlinkSync(sp);
      throw new Error("네이버 세션 만료. 재연결 필요");
    }

    console.log("[naver] SE4 로드 대기...");
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const getFrame = () => {
      const frames = page.frames();
      return frames.find(f => f.name() === "mainFrame")
        ?? frames.find(f => f.url().includes("blog.naver.com"))
        ?? frames[1] ?? null;
    };

    let frame = getFrame();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      frame = getFrame();
      if (frame) break;
    }
    if (!frame) throw new Error("mainFrame을 찾을 수 없습니다");
    console.log("[naver] mainFrame 획득!");

    // 복원 팝업 처리
    try {
      await frame.click(".se-popup-button-cancel", { timeout: 3000 });
      await page.waitForTimeout(1000);
    } catch {}

    // 도움말 닫기
    try {
      const helpVisible = await frame.isVisible(".se-help-panel-close-button");
      if (helpVisible) await frame.click(".se-help-panel-close-button", { timeout: 2000 });
    } catch {}

    // SE4 로드 완료 대기
    try {
      await frame.waitForSelector(".se-section-documentTitle, .se-editor, .se-container", { timeout: 40000 });
    } catch {}
    await page.waitForTimeout(3000);

    // ── 제목 입력 ──
    console.log("[naver] 제목 입력...");
    const titleSels = [
      ".se-section-documentTitle .se-text-paragraph span[contenteditable='true']",
      ".se-section-documentTitle [contenteditable='true']",
      ".se-section-documentTitle .se-text-paragraph",
    ];
    let titleInserted = false;
    for (const sel of titleSels) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await frame.click(sel, { timeout: 5000 });
          await page.waitForTimeout(400);
          await frame.evaluate((t) => {
            document.execCommand("selectAll", false);
            document.execCommand("insertText", false, t);
          }, title);
          await page.waitForTimeout(600);
          titleInserted = true;
          break;
        }
      } catch {}
    }
    if (!titleInserted) {
      await frame.click(".se-section-documentTitle", { timeout: 5000 });
      await page.waitForTimeout(500);
      await page.keyboard.type(title, { delay: 40 });
    }

    // ── 이미지 삽입 (썸네일) ──
    if (imageUrl) {
      console.log("[naver] 이미지 삽입 시도...");
      const tmpFile = await downloadImageToTemp(imageUrl);
      if (tmpFile) {
        try {
          // SE4 툴바 이미지 버튼
          const imgBtnSels = [
            "button[data-type='image']",
            ".se-toolbar-item-imageUpload button",
            "button[title='이미지']",
            "button[class*='image']",
          ];
          let imgBtnClicked = false;
          for (const sel of imgBtnSels) {
            try {
              const el = await frame.$(sel);
              if (el) { await frame.click(sel, { timeout: 3000 }); imgBtnClicked = true; break; }
            } catch {}
          }
          if (imgBtnClicked) {
            await page.waitForTimeout(1500);
            // 파일 업로드 input 찾기
            const fileInput = await page.$("input[type='file']");
            if (fileInput) {
              await fileInput.setInputFiles(tmpFile);
              await page.waitForTimeout(3000);
              console.log("[naver] ✅ 이미지 업로드 완료");
            }
          }
        } catch (e) {
          console.log("[naver] 이미지 삽입 실패 (무시):", e);
        } finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      }
    }

    // ── 본문 + 이미지 블록 순서대로 입력 ──
    console.log("[naver] 본문+이미지 블록 순서 발행 시작...");

    // SE4 에디터 클릭 헬퍼
    async function clickEditor() {
      const bodySels = [
        ".se-section-text .se-text-paragraph span[contenteditable='true']",
        ".se-section-text [contenteditable='true']",
        ".se-main-container .se-section:not(.se-section-documentTitle) [contenteditable='true']",
        ".se-component-content [contenteditable='true']",
      ];
      for (const sel of bodySels) {
        try {
          const el = await frame.$(sel);
          if (el) { await frame.click(sel, { timeout: 3000 }); return true; }
        } catch {}
      }
      await frame.click(".se-main-container", { timeout: 3000 }).catch(() => {});
      return false;
    }

    // 텍스트 블록 입력 헬퍼
    async function insertText(text: string) {
      const isHtml = /<[a-z][\s\S]*>/i.test(text);
      const plain = isHtml
        ? text
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n").replace(/<\/h[1-6]>/gi, "\n").replace(/<\/div>/gi, "\n")
            .replace(/<hr[^>]*>/gi, "\n---\n")
            .replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, "[$1]")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
            .replace(/[\n]{3,}/g, "\n\n").trim()
        : text;

      await clickEditor();
      await page.waitForTimeout(300);
      const lines = plain.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
          await frame.evaluate((t) => { document.execCommand("insertText", false, t); }, lines[i]);
        }
        if (i < lines.length - 1) {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(20);
        }
      }
    }

    // 이미지 업로드 헬퍼
    async function uploadImage(imgUrl: string) {
      const tmpFile = await downloadImageToTemp(imgUrl);
      if (!tmpFile) { console.log("[naver] 이미지 다운로드 실패:", imgUrl.slice(0,60)); return; }
      try {
        // 에디터 포커스
        await clickEditor();
        await page.waitForTimeout(500);
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);

        // 이미지 버튼 클릭 - page 레벨과 frame 레벨 모두 시도
        const imgBtnSels = [
          "button[data-type='image']",
          ".se-toolbar-item-imageUpload button",
          "button[title='이미지']",
          "button[aria-label='이미지']",
          ".se-toolbar button[class*='image']",
        ];
        let clicked = false;

        // frame에서 먼저 시도
        for (const sel of imgBtnSels) {
          try {
            await frame.waitForSelector(sel, { timeout: 1000 });
            await frame.click(sel, { timeout: 2000 });
            clicked = true;
            console.log("[naver] 이미지 버튼 클릭:", sel);
            break;
          } catch {}
        }

        // page 전체에서도 시도
        if (!clicked) {
          for (const sel of imgBtnSels) {
            try {
              await page.waitForSelector(sel, { timeout: 1000 });
              await page.click(sel, { timeout: 2000 });
              clicked = true;
              break;
            } catch {}
          }
        }

        if (clicked) {
          await page.waitForTimeout(2000);
          // file input 찾기 - page 전체에서
          const fileInput = await page.$("input[type='file']") || await frame.$("input[type='file']");
          if (fileInput) {
            await fileInput.setInputFiles(tmpFile);
            await page.waitForTimeout(4000);
            console.log("[naver] ✅ 이미지 업로드 완료");
          } else {
            console.log("[naver] file input 못 찾음");
          }
        } else {
          console.log("[naver] 이미지 버튼 못 찾음 - 이미지 스킵");
        }
      } catch (e) {
        console.log("[naver] 이미지 업로드 실패:", e);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
      await page.waitForTimeout(1000);
    }

    // blocks가 있으면 블록 순서대로, 없으면 기존 방식
    if (blocks && blocks.length > 0) {
      for (const block of blocks) {
        if (block.type === "text" && block.content) {
          await insertText(block.content);
          await page.waitForTimeout(200);
        } else if (block.type === "image-pair" && (block as any).images?.length >= 2) {
          // 2장 동시 업로드 → 한 줄 나란히 배치
          const pairImages = (block as any).images as {src:string;alt:string}[];
          const tmp1 = await downloadImageToTemp(pairImages[0].src);
          const tmp2 = await downloadImageToTemp(pairImages[1].src);
          if (tmp1 && tmp2) {
            try {
              await clickEditor();
              await page.waitForTimeout(500);
              await page.keyboard.press("End");
              await page.keyboard.press("Enter");
              await page.waitForTimeout(500);
              const imgBtnSels = [
                "button[data-type='image']",
                ".se-toolbar-item-imageUpload button",
                "button[title='이미지']",
                "button[aria-label='이미지']",
              ];
              let clicked = false;
              for (const sel of imgBtnSels) {
                try { await frame.waitForSelector(sel,{timeout:1000}); await frame.click(sel,{timeout:2000}); clicked=true; break; } catch {}
              }
              if (!clicked) {
                for (const sel of imgBtnSels) {
                  try { await page.waitForSelector(sel,{timeout:1000}); await page.click(sel,{timeout:2000}); clicked=true; break; } catch {}
                }
              }
              if (clicked) {
                await page.waitForTimeout(2000);
                const fileInput = await page.$("input[type='file']") || await frame.$("input[type='file']");
                if (fileInput) {
                  // 2장 동시 선택
                  await fileInput.setInputFiles([tmp1, tmp2]);
                  await page.waitForTimeout(5000);
                  console.log("[naver] ✅ 이미지 페어 업로드 완료");
                }
              }
            } catch(e) { console.log("[naver] 페어 이미지 업로드 실패:", e); }
            finally {
              try { fs.unlinkSync(tmp1); } catch {}
              try { fs.unlinkSync(tmp2); } catch {}
            }
          }
        } else if (block.type === "image" && block.src) {
          // 썸네일(imageUrl)과 같은 이미지는 이미 상단에 올라가 있으므로 스킵
          if (block.src !== imageUrl) {
            await uploadImage(block.src);
          }
        }
      }
    } else {
      // fallback: blocks 없으면 기존 텍스트 입력 방식
      await insertText(content);
    }

    await page.waitForTimeout(1000);

    // ── 발행 패널 열기 ──
    console.log("[naver] 발행 패널 열기...");
    const publishSels = [
      "button.publish_btn__Y8C4q",
      "button[class*='publish_btn']",
      "button[data-testid='seOnePublishBtn']",
      "button:has-text('발행')",
    ];
    let panelOpened = false;
    for (const sel of publishSels) {
      try {
        const el = await frame.$(sel);
        if (el) { await frame.click(sel, { timeout: 5000 }); panelOpened = true; break; }
      } catch {}
    }
    if (!panelOpened) throw new Error("발행 버튼을 찾을 수 없습니다");
    await page.waitForTimeout(2500);

    // ── 태그 입력 ──
    if (tags.length > 0) {
      try {
        const tagSel = "input.tag_input__YWKIP, input[class*='tag_input'], input[placeholder*='태그']";
        const tagEl = await frame.$(tagSel);
        if (tagEl) {
          await frame.click(tagSel, { timeout: 5000 });
          for (const tag of tags.slice(0, 30)) {
            await frame.fill(tagSel, tag);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(200);
          }
          console.log(`[naver] 태그 ${tags.length}개 입력`);
        }
      } catch (e) { console.log("[naver] 태그 입력 실패 (무시):", e); }
    }

    // ── 카테고리 선택 ──
    if (categoryId) {
      console.log(`[naver] 카테고리 선택: ${categoryId}`);
      try {
        const catSels = [
          "select.category_select__YWKIP",
          "select[class*='category_select']",
          "select[class*='category']",
          "select[name='categoryNo']",
        ];
        for (const sel of catSels) {
          try {
            const el = await frame.$(sel);
            if (el) {
              await frame.selectOption(sel, categoryId);
              await page.waitForTimeout(500);
              console.log("[naver] ✅ 카테고리 선택 완료");
              break;
            }
          } catch {}
        }
      } catch (e) { console.log("[naver] 카테고리 선택 실패 (무시):", e); }
    }

    // ── 공개 설정 ──
    console.log(`[naver] 공개 설정: ${visibility}`);
    try {
      if (visibility === "neighbor") {
        // 이웃공개
        const neighborSels = [
          "button:has-text('이웃공개')",
          "label:has-text('이웃공개')",
          "input[value='1'] + label",
          ".option_publish [class*='neighbor']",
        ];
        for (const sel of neighborSels) {
          try {
            const el = await frame.$(sel);
            if (el) { await frame.click(sel, { timeout: 3000 }); break; }
          } catch {}
        }
      } else if (visibility === "private") {
        // 비공개
        const privateSels = [
          "button:has-text('비공개')",
          "label:has-text('비공개')",
          "input[value='2'] + label",
          ".option_publish [class*='private']",
        ];
        for (const sel of privateSels) {
          try {
            const el = await frame.$(sel);
            if (el) { await frame.click(sel, { timeout: 3000 }); break; }
          } catch {}
        }
      }
      // public은 기본값이므로 별도 클릭 불필요
      await page.waitForTimeout(400);
    } catch (e) { console.log("[naver] 공개 설정 실패 (무시):", e); }

    // ── 예약 발행 ──
    if (scheduleTime) {
      console.log(`[naver] 예약 발행 설정: ${scheduleTime}`);
      try {
        // "예약" 옵션 선택
        const scheduleSels = [
          "label:has-text('예약')",
          "button:has-text('예약')",
          "input[value='schedule'] + label",
          ".se-schedule-button",
          "[class*='schedule']",
        ];
        let scheduleToggled = false;
        for (const sel of scheduleSels) {
          try {
            const el = await frame.$(sel);
            if (el) { await frame.click(sel, { timeout: 3000 }); scheduleToggled = true; break; }
          } catch {}
        }
        if (scheduleToggled) {
          await page.waitForTimeout(1000);
          // 날짜/시간 입력
          // scheduleTime format: "2025-03-15T10:00"
          const dt = new Date(scheduleTime);
          const year  = dt.getFullYear().toString();
          const month = String(dt.getMonth() + 1).padStart(2, "0");
          const day   = String(dt.getDate()).padStart(2, "0");
          const hour  = String(dt.getHours()).padStart(2, "0");
          const min   = String(dt.getMinutes()).padStart(2, "0");

          // 날짜 입력
          const dateSels = [
            "input[class*='date']",
            "input[name='publishDate']",
            "input[placeholder*='날짜']",
            "input[type='date']",
          ];
          for (const sel of dateSels) {
            try {
              const el = await frame.$(sel);
              if (el) {
                await frame.click(sel, { clickCount: 3 }).catch(() => frame.click(sel));
                await frame.fill(sel, `${year}-${month}-${day}`);
                await page.waitForTimeout(300);
                break;
              }
            } catch {}
          }
          // 시간 입력
          const timeSels = [
            "input[class*='time']",
            "input[name='publishTime']",
            "input[placeholder*='시간']",
            "input[type='time']",
          ];
          for (const sel of timeSels) {
            try {
              const el = await frame.$(sel);
              if (el) {
                await frame.click(sel, { clickCount: 3 }).catch(() => frame.click(sel));
                await frame.fill(sel, `${hour}:${min}`);
                await page.waitForTimeout(300);
                break;
              }
            } catch {}
          }
          await page.waitForTimeout(500);
          console.log(`[naver] ✅ 예약 날짜 설정: ${year}-${month}-${day} ${hour}:${min}`);
        }
      } catch (e) { console.log("[naver] 예약 발행 설정 실패 (무시):", e); }
    }

    // ── 최종 발행 또는 예약 확정 ──
    console.log("[naver] 최종 발행...");
    const finalLabel = scheduleTime ? "예약" : "발행";
    const finalSels = scheduleTime
      ? [
          "button[class*='confirm']:has-text('예약')",
          "button:has-text('예약 발행')",
          "button:has-text('예약')",
          "button.confirm_btn__xiHQQ",
          "button[class*='confirm_btn']",
        ]
      : [
          "button.confirm_btn__xiHQQ",
          "button[class*='confirm_btn']",
          "button:has-text('발행')",
        ];

    let finalDone = false;
    for (const sel of finalSels) {
      try {
        const el = await frame.$(sel);
        if (el) { await frame.click(sel, { timeout: 8000 }); finalDone = true; break; }
      } catch {}
    }
    if (!finalDone) {
      const btns = await frame.$$("button");
      for (const btn of btns.reverse()) {
        const txt = await btn.textContent();
        if (txt?.includes(finalLabel)) { await btn.click(); finalDone = true; break; }
      }
    }

    await page.waitForTimeout(scheduleTime ? 3000 : 5000);

    // URL 추출
    let postUrl = page.url();
    const viewMatch = postUrl.match(/blog\.naver\.com\/[^/]+\/(\d+)/) || postUrl.match(/logNo=(\d+)/);
    if (viewMatch) postUrl = `https://blog.naver.com/${blogId}/${viewMatch[1]}`;
    if (scheduleTime) postUrl = `https://blog.naver.com/${blogId}`;

    // 쿠키 갱신
    const newCookies = await context.cookies();
    const session = JSON.parse(fs.readFileSync(sp, "utf-8"));
    session.cookies = newCookies;
    fs.writeFileSync(sp, JSON.stringify(session, null, 2));

    await browser.close();
    console.log(`[naver] ✅ ${scheduleTime ? "예약 완료" : "발행 완료"}: ${postUrl}`);
    return postUrl;
  } catch (e: any) {
    console.error("[naver] ❌ 에러:", e.message);
    try {
      const debugDir = path.join(__dirname, "../debug");
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, `naver_error_${Date.now()}.png`), fullPage: true });
    } catch {}
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 서이추 전용 함수들 ──────────────────────────────────── */

export interface NeighborResult {
  keyword: string;
  blogId: string;
  status: "success" | "fail" | "skip";
  message: string;
}

// server.ts가 사용하는 이름으로 re-export
export function sessionExists(accountId: string): boolean {
  return naverSessionExists(accountId);
}

export async function saveSession(
  accountId: string, id: string, pw: string
): Promise<{ blogId: string }> {
  return saveNaverSession(accountId, id, pw);
}

export function donePath(accountId: string): string {
  return path.join(SESSION_DIR, `done_${accountId}.json`);
}

/* ── 키워드로 블로그 ID 수집 ── */
const INVALID_BLOG_IDS = ["PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite","search","Search","blogpeople","people"];

export async function crawlBlogIds(params: {
  accountId: string;
  keywords: string[];
  countPerKeyword: number;
  onLog?: (msg: string) => void;
}): Promise<{ keyword: string; blogId: string }[]> {
  const { keywords, countPerKeyword, onLog } = params;
  const log = onLog || console.log;
  const results: { keyword: string; blogId: string }[] = [];

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    for (const kw of keywords) {
      log(`[수집] "${kw}" 검색 중...`);
      const collected = new Set<string>();
      let pageNum = 1;

      while (collected.size < countPerKeyword && pageNum <= 15) {
        try {
          const url = `https://section.blog.naver.com/Search/Post.naver?term=${encodeURIComponent(kw)}&currentPage=${pageNum}`;
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(800);

          const hrefs: string[] = await page.$$eval('a[href*="blog.naver.com"]', (els) =>
            els.map((el) => (el as HTMLAnchorElement).href)
          );

          let found = 0;
          for (const href of hrefs) {
            const m = href.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
            if (m && m[1] && !INVALID_BLOG_IDS.includes(m[1])) {
              if (!collected.has(m[1])) { collected.add(m[1]); found++; }
            }
            if (collected.size >= countPerKeyword) break;
          }

          if (found === 0) break;
          pageNum++;
          await page.waitForTimeout(300);
        } catch { break; }
      }

      for (const blogId of collected) {
        results.push({ keyword: kw, blogId });
      }
      log(`[수집] "${kw}" → ${collected.size}개 수집 완료`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return results;
}

/* ── 서이추 신청 ── */
export async function addNeighbors(params: {
  accountId: string;
  targets: { keyword: string; blogId: string }[];
  message: string;
  delayMin: number;
  delayMax: number;
  dailyLimit: number;
  skipDone: boolean;
  onLog?: (msg: string) => void;
  onResult?: (r: NeighborResult) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const { accountId, targets, message, delayMin, delayMax, dailyLimit, skipDone, onLog, onResult, onProgress, stopSignal } = params;
  const log = onLog || console.log;

  const sp = sessionPath(accountId);
  if (!fs.existsSync(sp)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));

  const dp = donePath(accountId);
  let doneSet = new Set<string>();
  if (skipDone && fs.existsSync(dp)) {
    try {
      const list: string[] = JSON.parse(fs.readFileSync(dp, "utf-8"));
      doneSet = new Set(list);
    } catch {}
  }

  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  let done = 0;
  let fail = 0;

  try {
    // 키워드 교차 셔플 — A키워드1→B키워드1→A키워드2... 패턴으로 자연스럽게
    const kwMap = new Map<string, typeof targets>();
    for (const t of targets) {
      if (!kwMap.has(t.keyword)) kwMap.set(t.keyword, []);
      kwMap.get(t.keyword)!.push(t);
    }
    const shuffled: typeof targets = [];
    const kwArrays = [...kwMap.values()];
    const maxLen = Math.max(...kwArrays.map(a => a.length));
    for (let i = 0; i < maxLen; i++) {
      for (const arr of kwArrays) {
        if (i < arr.length) shuffled.push(arr[i]);
      }
    }
    // 같은 키워드 내에서도 순서 랜덤화
    for (const arr of kwArrays) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    log(`[서이추] 🔀 작업 순서 셔플 완료 — ${shuffled.length}개`);

    for (const target of shuffled) {
      if (done >= dailyLimit) { log("[서이추] 일일 한도 도달"); break; }
      if (stopSignal?.()) { log("[서이추] 중단 신호 수신"); break; }

      const { keyword, blogId } = target;

      if (skipDone && doneSet.has(blogId)) {
        await onResult?.({ keyword, blogId, status: "skip", message: "이미 처리됨" });
        onProgress?.(done, fail);
        continue;
      }

      try {
        log(`[서이추] ${blogId} 신청 시도...`);

        // ── 서이추 전 블로그 먼저 방문 (읽는 척) ──
        log(`[서이추] 👀 ${blogId} 블로그 방문 중...`);
        await page.goto(
          `https://blog.naver.com/${blogId}`,
          { waitUntil: "domcontentloaded", timeout: 20000 }
        );
        await page.waitForTimeout(humanDelay(2, 5));

        // 스크롤 (3~7초에 걸쳐 천천히 읽는 척)
        const scrollCount = 2 + Math.floor(Math.random() * 3);
        for (let s = 0; s < scrollCount; s++) {
          await page.mouse.wheel(0, 200 + Math.random() * 300);
          await page.waitForTimeout(humanDelay(0.8, 2.5));
        }

        // 가끔 뒤로가기 후 재진입 (15% 확률)
        if (Math.random() < 0.15) {
          log(`[서이추] 🔄 ${blogId} 재방문 중...`);
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(humanDelay(1, 3));
          await page.goto(
            `https://blog.naver.com/${blogId}`,
            { waitUntil: "domcontentloaded", timeout: 20000 }
          );
          await page.waitForTimeout(humanDelay(1, 3));
        }

        // 서이추 신청 페이지로 이동
        await page.goto(
          `https://blog.naver.com/BlogAddNeighbor.naver?targetBlogId=${blogId}&neighborType=1`,
          { waitUntil: "domcontentloaded", timeout: 20000 }
        );
        await page.waitForTimeout(1200);

        // 이미 이웃인 경우 또는 나 자신 체크
        const curUrl = page.url();
        if (curUrl.includes("error") || curUrl.includes("login")) {
          throw new Error("세션 만료 — 재로그인 필요");
        }

        // 메시지 입력 (humanType — 사람처럼 타이핑)
        const msgSels = ["textarea#sendMessage","textarea[name='message']","textarea.neighbor_message","textarea"];
        for (const sel of msgSels) {
          try {
            const el = await page.$(sel);
            if (el) {
              await page.click(sel);
              await page.waitForTimeout(300);
              await page.fill(sel, ""); // 기존 내용 지우기
              const naturalMsg = naturalizeMsg(message); // 자연 변형 적용
              log(`[서이추] 💬 멘트: "${naturalMsg.slice(0, 30)}..."`);
              await humanType(page, naturalMsg);
              break;
            }
          } catch {}
        }
        await page.waitForTimeout(400);

        // 확인/신청 버튼
        const confirmSels = [
          "button.btn_ok","button:has-text('확인')","button:has-text('신청')","button:has-text('추가')","input[type='submit']",
        ];
        let submitted = false;
        for (const sel of confirmSels) {
          try {
            const el = await page.$(sel);
            if (el) { await page.click(sel, { timeout: 3000 }); submitted = true; break; }
          } catch {}
        }

        await page.waitForTimeout(800);

        if (submitted) {
          doneSet.add(blogId);
          fs.writeFileSync(dp, JSON.stringify([...doneSet], null, 2));
          done++;
          await onResult?.({ keyword, blogId, status: "success", message: "서이추 신청 완료" });
          log(`[서이추] ✅ ${blogId} 완료 (${done}/${dailyLimit})`);
        } else {
          throw new Error("신청 버튼을 찾을 수 없음");
        }
      } catch (e: any) {
        fail++;
        await onResult?.({ keyword, blogId, status: "fail", message: e.message });
        log(`[서이추] ❌ ${blogId} 실패: ${e.message}`);
      }

      onProgress?.(done, fail);
      const delay = humanDelay(delayMin, delayMax);
      log(`[서이추] ⏱ 다음 작업까지 ${(delay/1000).toFixed(1)}초 대기...`);
      await page.waitForTimeout(delay);
      if ((done + fail) % 10 === 0 && (done + fail) > 0) {
        const longRest = humanDelay(30, 90);
        log(`[서이추] ☕ ${(longRest/1000).toFixed(0)}초 긴 휴식 중...`);
        await page.waitForTimeout(longRest);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}


export interface EngageResult {
  keyword: string;
  blogId: string;
  postUrl: string;
  liked: boolean;
  commented: boolean;
  status: "success" | "fail" | "skip";
  message: string;
}

/* ── 공감·댓글 작업 ── */
export async function engageBlogs(params: {
  accountId: string;
  targets: { keyword: string; blogId: string }[];
  comment: string;
  doLike: boolean;
  doComment: boolean;
  periodDays: number;        // 최근 N일 이내 글만
  postsPerBlog: number;      // 블로그당 최대 글 수
  delayMin: number;
  delayMax: number;
  dailyLimit: number;
  skipDone: boolean;
  onLog?: (msg: string) => void;
  onResult?: (r: EngageResult) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const {
    accountId, targets, comment, doLike, doComment,
    periodDays, postsPerBlog, delayMin, delayMax,
    dailyLimit, skipDone, onLog, onResult, onProgress, stopSignal,
  } = params;
  const log = onLog || console.log;

  const sp = sessionPath(accountId);
  if (!fs.existsSync(sp)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));

  // 완료 기록 (서이추와 별도 파일)
  const engageDonePath = path.join(SESSION_DIR, `engage_done_${accountId}.json`);
  let doneSet = new Set<string>();
  if (skipDone && fs.existsSync(engageDonePath)) {
    try { doneSet = new Set(JSON.parse(fs.readFileSync(engageDonePath, "utf-8"))); } catch {}
  }

  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;

  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  let done = 0;
  let fail = 0;

  try {
    // 키워드 교차 셔플
    const kwMap2 = new Map<string, typeof targets>();
    for (const t of targets) {
      if (!kwMap2.has(t.keyword)) kwMap2.set(t.keyword, []);
      kwMap2.get(t.keyword)!.push(t);
    }
    const shuffled2: typeof targets = [];
    const kwArrays2 = [...kwMap2.values()];
    for (const arr of kwArrays2) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    const maxLen2 = Math.max(...kwArrays2.map(a => a.length));
    for (let i = 0; i < maxLen2; i++) {
      for (const arr of kwArrays2) {
        if (i < arr.length) shuffled2.push(arr[i]);
      }
    }
    log(`[공감·댓글] 🔀 작업 순서 셔플 완료 — ${shuffled2.length}개`);

    for (const target of shuffled2) {
      if (done >= dailyLimit) { log("[공감·댓글] 일일 한도 도달"); break; }
      if (stopSignal?.()) { log("[공감·댓글] 중단 신호 수신"); break; }

      const { keyword, blogId } = target;

      if (skipDone && doneSet.has(blogId)) {
        await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: "이미 처리됨" });
        onProgress?.(done, fail);
        continue;
      }

      try {
        log(`[공감·댓글] ${blogId} 방문 중...`);

        // ── 블로그 최근 글 목록 수집 ──
        await page.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&widgetTypeCall=true`, {
          waitUntil: "domcontentloaded", timeout: 20000,
        });
        await page.waitForTimeout(1500);

        // 글 링크 + 날짜 추출
        type PostInfo = { url: string; date: number };
        const posts: PostInfo[] = await page.evaluate((cutoffMs: number) => {
          const results: { url: string; date: number }[] = [];
          // 포스트 링크 후보
          const links = Array.from(document.querySelectorAll("a[href*='blog.naver.com'], a[href*='/PostView']"));
          for (const link of links) {
            const href = (link as HTMLAnchorElement).href;
            if (!href.match(/blog\.naver\.com\/[a-zA-Z0-9_-]+\/\d+/)) continue;
            // 날짜 텍스트 탐색 (부모 컨테이너 내)
            const container = link.closest("li,div[class*='post'],div[class*='item'],div[class*='list']");
            let dateMs = 0;
            if (container) {
              const dateEl = container.querySelector("[class*='date'],[class*='time'],span[class*='date']");
              if (dateEl) {
                const txt = dateEl.textContent?.trim() || "";
                // 형식: "2025. 01. 15." or "2025.01.15" or "01-15"
                const m = txt.match(/(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
                if (m) {
                  dateMs = new Date(`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`).getTime();
                }
              }
            }
            if (dateMs === 0 || dateMs >= cutoffMs) {
              results.push({ url: href, date: dateMs });
            }
            if (results.length >= 10) break;
          }
          return results;
        }, cutoff);

        // 기간 내 글 필터 (날짜 파싱 실패한 글은 일단 포함)
        const filtered = posts.filter(p => p.date === 0 || p.date >= cutoff).slice(0, postsPerBlog);

        if (filtered.length === 0) {
          log(`[공감·댓글] ${blogId} — 기간 내 글 없음, 스킵`);
          await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: `최근 ${periodDays}일 내 글 없음` });
          onProgress?.(done, fail);
          continue;
        }

        let liked = false;
        let commented = false;
        const targetPost = filtered[0];

        log(`[공감·댓글] ${blogId} → 글 진입: ${targetPost.url}`);
        await page.goto(targetPost.url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);

        // 글 읽는 척 스크롤 (3~8초)
        const readScrolls = 3 + Math.floor(Math.random() * 4);
        for (let s = 0; s < readScrolls; s++) {
          await page.mouse.wheel(0, 150 + Math.random() * 250);
          await page.waitForTimeout(humanDelay(0.5, 2));
        }
        // 가끔 위로 다시 스크롤 (다시 읽는 척, 20% 확률)
        if (Math.random() < 0.2) {
          await page.mouse.wheel(0, -(200 + Math.random() * 300));
          await page.waitForTimeout(humanDelay(0.5, 1.5));
        }

        // iframe 처리 (네이버 블로그는 mainFrame 안에 있음)
        const getFrame = () => {
          const frames = page.frames();
          return frames.find(f => f.name() === "mainFrame")
            ?? frames.find(f => f.url().includes("blog.naver.com"))
            ?? null;
        };
        let frame = getFrame();
        for (let i = 0; i < 5; i++) {
          await page.waitForTimeout(800);
          frame = getFrame();
          if (frame) break;
        }
        const ctx = frame ?? page as any;

        // ── 공감 클릭 ──
        if (doLike) {
          try {
            const likeSels = [
              ".sympathy_toggle_btn",
              "button[class*='sympathy']",
              "button[class*='like']",
              "a[class*='sympathy']",
              ".btn_like",
              "[class*='btn_sympathy']",
            ];
            for (const sel of likeSels) {
              try {
                const el = await ctx.$(sel);
                if (el) {
                  // 이미 공감한 경우 체크
                  const isActive = await ctx.evaluate((s: string) => {
                    const btn = document.querySelector(s);
                    return btn ? (btn.classList.contains("on") || btn.classList.contains("active") || btn.getAttribute("aria-pressed") === "true") : false;
                  }, sel);
                  if (!isActive) {
                    await ctx.click(sel, { timeout: 3000 });
                    await page.waitForTimeout(800);
                    liked = true;
                    log(`[공감·댓글] ❤️ ${blogId} 공감 완료`);
                  } else {
                    liked = true; // 이미 공감됨
                    log(`[공감·댓글] ${blogId} 이미 공감됨`);
                  }
                  break;
                }
              } catch {}
            }
          } catch (e: any) {
            log(`[공감·댓글] ${blogId} 공감 실패: ${e.message}`);
          }
        }

        // ── 댓글 작성 ──
        if (doComment && comment.trim()) {
          try {
            await page.waitForTimeout(1000);

            // 댓글 입력창 셀렉터 (네이버 블로그 댓글 구조)
            const commentSels = [
              "textarea#commentArea",
              "textarea[name='comment']",
              "textarea[placeholder*='댓글']",
              "textarea[class*='comment']",
              ".u_cbox_write_wrap textarea",
              "#naverComment textarea",
              "iframe#naverComment",
            ];

            let commentDone = false;

            // 댓글 iframe 처리
            const commentFrame = page.frames().find(f =>
              f.url().includes("comment") || f.name().includes("comment")
            );
            const commentCtx = commentFrame ?? page as any;

            for (const sel of commentSels) {
              try {
                // iframe 안 textarea 처리
                if (sel === "iframe#naverComment") {
                  const cf = page.frames().find((f: any) => f.url().includes("comment"));
                  if (cf) {
                    const ta = await cf.$("textarea");
                    if (ta) {
                      await ta.click();
                      await page.waitForTimeout(500);
                      await cf.fill("textarea", "");
                      const naturalComment = naturalizeMsg(comment);
                      await humanType(page, naturalComment);
                      await page.waitForTimeout(500);
                      const submitSels = ["button[type='submit']","button:has-text('등록')","button[class*='submit']"];
                      for (const ss of submitSels) {
                        try {
                          const sb = await cf.$(ss);
                          if (sb) { await cf.click(ss, { timeout: 3000 }); commentDone = true; break; }
                        } catch {}
                      }
                      if (commentDone) break;
                    }
                  }
                  continue;
                }

                const el = await commentCtx.$(sel);
                if (el) {
                  await commentCtx.click(sel, { timeout: 3000 });
                  await page.waitForTimeout(500);
                  await commentCtx.fill(sel, "");
                  const naturalComment2 = naturalizeMsg(comment);
                  await humanType(page, naturalComment2);
                  await page.waitForTimeout(500);
                  // 등록 버튼
                  const submitSels = [
                    "button[type='submit']",
                    "button:has-text('등록')",
                    "button[class*='submit']",
                    ".u_cbox_btn_upload",
                    "button.btn_ok",
                  ];
                  for (const ss of submitSels) {
                    try {
                      const sb = await commentCtx.$(ss);
                      if (sb) { await commentCtx.click(ss, { timeout: 3000 }); commentDone = true; break; }
                    } catch {}
                  }
                  if (commentDone) break;
                }
              } catch {}
            }

            if (commentDone) {
              commented = true;
              await page.waitForTimeout(1000);
              log(`[공감·댓글] 💬 ${blogId} 댓글 완료`);
            } else {
              log(`[공감·댓글] ${blogId} 댓글 입력창 못 찾음`);
            }
          } catch (e: any) {
            log(`[공감·댓글] ${blogId} 댓글 실패: ${e.message}`);
          }
        }

        if (liked || commented) {
          doneSet.add(blogId);
          fs.writeFileSync(engageDonePath, JSON.stringify([...doneSet], null, 2));
          done++;
          await onResult?.({ keyword, blogId, postUrl: targetPost.url, liked, commented, status: "success", message: `${liked ? "공감" : ""}${liked && commented ? "+" : ""}${commented ? "댓글" : ""} 완료` });
          log(`[공감·댓글] ✅ ${blogId} 완료 (${done}/${dailyLimit})`);
        } else {
          throw new Error("공감·댓글 모두 실패");
        }

      } catch (e: any) {
        fail++;
        await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "fail", message: e.message });
        log(`[공감·댓글] ❌ ${blogId} 실패: ${e.message}`);
      }

      onProgress?.(done, fail);
      const delay = humanDelay(delayMin, delayMax);
      log(`[공감·댓글] ⏱ 다음 작업까지 ${(delay/1000).toFixed(1)}초 대기...`);
      await page.waitForTimeout(delay);
      if ((done + fail) % 10 === 0 && (done + fail) > 0) {
        const longRest = humanDelay(30, 90);
        log(`[공감·댓글] ☕ ${(longRest/1000).toFixed(0)}초 긴 휴식 중...`);
        await page.waitForTimeout(longRest);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ── 공감·댓글용 완료 목록 경로 ── */
export function engageDonePath(accountId: string): string {
  return path.join(SESSION_DIR, `engage_done_${accountId}.json`);
}
