import { chromium, BrowserContext } from "playwright";
import fs from "fs";
import https from "https";
import http from "http";
import os from "os";
import path from "path";
import { deleteSession, hasSession, readSession, writeSession, SESSION_DIR } from "./session-store";

const LEGACY_SESSION_DIRS = [path.join(__dirname, "../sessions"), path.join(__dirname, "../../naver-bot/sessions")];
const sessionName = (userId: string) => `naver_${userId}`;
const loadSession = (userId: string) => readSession<any>(sessionName(userId), LEGACY_SESSION_DIRS);

export function naverSessionExists(userId: string): boolean {
  return hasSession(sessionName(userId), LEGACY_SESSION_DIRS);
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
// ★ 네이버 서이추/댓글 메시지 필드는 4바이트 이모지(😊)를 "?"로 저장함 → 텍스트 이모티콘으로 치환
function emojiToSafeText(s: string): string {
  const map: Record<string, string> = {
    "😊":"^^", "🙂":"^^", "😄":"^^", "😍":"^^", "🤗":"^^", "😆":"^^", "☺️":"^^", "☺":"^^",
    "👍":" 👍", "🙌":"~", "✨":"~", "🌟":"~", "💕":" ♥", "❤️":" ♥", "❤":" ♥", "🎁":"", "🙏":"",
  };
  let out = s;
  for (const [e, t] of Object.entries(map)) out = out.split(e).join(t);
  // 👍/♥ 같은 BMP·이미 안전한 기호는 두되, 남은 4바이트 이모지(😀류)는 제거
  out = out.replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "");
  return out.replace(/ {2,}/g, " ").trim();
}

function naturalizeMsg(msg: string): string {
  let result = msg;

  // 1) 끝 이모티콘 랜덤 교체/추가 (네이버 안전한 텍스트 이모티콘)
  const emojiPool = ["^^", "~", " :)", " ^^*", "^^~", "!"];
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

  // 5) ★ 유니코드 이모지 → 네이버 안전 텍스트 (메시지 어디에 있든 "?" 방지)
  return emojiToSafeText(result);
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

  // ★ 스프레드로 순회 = 코드포인트 단위 → 이모지(😊)가 반토막 안 남
  for (const ch of text) {
    // 오타 삽입 (영문/숫자만)
    if (typoRate > 0 && Math.random() < typoRate && /[a-zA-Z]/.test(ch)) {
      const typoPool = NEARBY[ch.toLowerCase()] || ["x"];
      const typo = typoPool[Math.floor(Math.random() * typoPool.length)];
      await page.keyboard.type(typo);
      await page.waitForTimeout(randNorm(120, 40));
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(randNorm(80, 20));
    }

    // 이모지 등 BMP 밖 문자는 keyboard.type이 "?"로 깨짐 → insertText로 직접 삽입
    if ((ch.codePointAt(0) || 0) > 0xFFFF) {
      await page.keyboard.insertText(ch);
    } else {
      await page.keyboard.type(ch);
    }

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

    // 로그인 버튼 클릭 (네이버 개편: #loginBtn_row/#loginBtn_column, 옛 .btn_login 사라짐)
    let _loginClicked = false;
    for (const _sel of ["#loginBtn_row", "#loginBtn_column"]) {
      try { const _el = await page.$(_sel); if (_el && await _el.isVisible()) { await _el.click(); _loginClicked = true; break; } } catch {}
    }
    if (!_loginClicked) { try { await page.click(".btn_login", { timeout: 2000 }); _loginClicked = true; } catch {} }
    if (!_loginClicked) { try { await page.click("button[type='submit']", { timeout: 2000 }); _loginClicked = true; } catch {} }
    if (!_loginClicked) { await page.keyboard.press("Enter"); }

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
    writeSession(sessionName(userId), {
      loginId: id,
      blogId,
      cookies,
    });
    await browser.close();
    return { blogId };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 자동 재로그인 (세션 만료 시) ── */
export async function reloginNaverSilent(userId: string): Promise<boolean> {
  if (!naverSessionExists(userId)) return false;
  const session = loadSession(userId);
  let loginId: string = session.loginId;
  let pw: string | null = null;

  // 1순위: 세션 파일에 저장된 pw
  if (session.pw) {
    try { pw = Buffer.from(session.pw, "base64").toString("utf-8"); } catch {}
  }
  // DB 비밀번호 조회는 보안상 지원하지 않는다.
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
    // 로그인 버튼 (네이버 개편: #loginBtn_row/#loginBtn_column)
    {
      let _c = false;
      for (const _s of ["#loginBtn_row", "#loginBtn_column"]) { try { const _e = await page.$(_s); if (_e && await _e.isVisible()) { await _e.click(); _c = true; break; } } catch {} }
      if (!_c) { try { await page.click(".btn_login", { timeout: 2000 }); _c = true; } catch {} }
      if (!_c) { try { await page.click("button[type='submit']", { timeout: 2000 }); _c = true; } catch {} }
      if (!_c) { await page.keyboard.press("Enter"); }
    }

    // 캡차가 나오면 실패 (헤드리스라 처리 불가)
    await page.waitForFunction(
      () => !location.href.includes("nid.naver.com/nidlogin"),
      { timeout: 15000 }
    );
    await page.waitForTimeout(1500);

    if (page.url().includes("nidlogin")) { await browser.close(); return false; }

    const cookies = await context.cookies();
    const oldSession = loadSession(userId);
    writeSession(sessionName(userId), { ...oldSession, pw: undefined, cookies });
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
  if (!naverSessionExists(userId)) throw new Error("네이버 세션 없음");
  const { blogId, cookies } = loadSession(userId);
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
  if (!naverSessionExists(userId)) throw new Error("네이버 세션 없음. 계정 재연결 필요");
  const { blogId, cookies } = loadSession(userId);

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
      deleteSession(sessionName(userId), LEGACY_SESSION_DIRS);
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
    const session = loadSession(userId);
    session.cookies = newCookies;
    writeSession(sessionName(userId), session);

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

// 계정 로그인 세션 삭제 (계정 삭제 시)
export function removeSession(accountId: string): void {
  try { deleteSession(sessionName(accountId), LEGACY_SESSION_DIRS); } catch {}
}

export async function saveSession(
  accountId: string, id: string, pw: string
): Promise<{ blogId: string }> {
  return saveNaverSession(accountId, id, pw);
}

export function donePath(accountId: string): string {
  return path.join(SESSION_DIR, `done_${accountId}.json`);
}

/* ── 키워드로 블로그 수집 (체험단 최적화판) ──
   네이버 검색이 SPA로 바뀌어 HTML 스크레이핑이 죽음 → ajax JSON API로 전환.
   추가로 체험단 모집에 맞게: 최신활동 우선 정렬 / 판매·마켓글 제외 / 활동 블로거 필터 / 메타데이터 수집. */
const INVALID_BLOG_IDS = ["PostList","BlogHome","FeedList","neighborPostList","TagList","GoBlogWrite","search","Search","blogpeople","people","section","recommend","ThemePost","BlogTop"];

export interface BlogTarget {
  keyword: string;
  blogId: string;
  nickName?: string;
  blogName?: string;
  addDate?: number;   // 최근 글 작성일(ms) — 활동성 판단용
  postUrl?: string;
  thumbnail?: string;
}

export async function crawlBlogIds(params: {
  accountId: string;
  keywords: string[];
  countPerKeyword: number;
  orderBy?: "sim" | "recentdate";   // 정렬: 정확도 vs 최신(기본 최신 = 활동중 블로거 우선)
  activeDays?: number;              // 최근 N일 내 글쓴 블로거만 (0/미지정 = 무제한)
  excludeMarket?: boolean;          // 판매·마켓 블로거 제외 (기본 true)
  onLog?: (msg: string) => void;
}): Promise<BlogTarget[]> {
  const { keywords, countPerKeyword, onLog } = params;
  const orderBy = params.orderBy || "recentdate";
  const activeDays = params.activeDays ?? 0;
  const excludeMarket = params.excludeMarket !== false;
  const log = onLog || console.log;
  const activeCutoff = activeDays > 0 ? Date.now() - activeDays * 86400000 : 0;

  const results: BlogTarget[] = [];
  const seen = new Set<string>();   // ★ 키워드 전체에 걸쳐 중복 블로그 제거(루프 밖에서 유지)
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    for (const kw of keywords) {
      log(`[수집] "${kw}" 검색 중... (정렬: ${orderBy === "recentdate" ? "최신활동" : "정확도"}${excludeMarket ? ", 판매글 제외" : ""})`);
      // Referer/쿠키 세팅 위해 검색 페이지 먼저 방문
      await page.goto(`https://section.blog.naver.com/Search/Post.naver?term=${encodeURIComponent(kw)}`,
        { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);

      let got = 0, skippedMarket = 0, skippedStale = 0;
      const perPage = 10, maxPages = 20;

      for (let pageNum = 1; pageNum <= maxPages && got < countPerKeyword; pageNum++) {
        const apiUrl = `https://section.blog.naver.com/ajax/SearchList.naver?countPerPage=${perPage}&currentPage=${pageNum}&endDate=&keyword=${encodeURIComponent(kw)}&orderBy=${orderBy}&startDate=&type=post`;
        let list: any[] = [];
        try {
          const raw = await page.evaluate(async (u) => {
            const r = await fetch(u, { headers: { Referer: location.href } });
            return await r.text();
          }, apiUrl);
          const data = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""));
          list = data?.result?.searchList || [];
        } catch { list = []; }

        if (!list.length) break;

        for (const item of list) {
          const blogId = item.domainIdOrBlogId || item.blogId;
          if (!blogId || INVALID_BLOG_IDS.includes(blogId) || seen.has(blogId)) continue;
          if (excludeMarket && (item.marketPost || item.product)) { skippedMarket++; continue; }
          if (activeCutoff && item.addDate && item.addDate < activeCutoff) { skippedStale++; continue; }
          seen.add(blogId);
          results.push({
            keyword: kw,
            blogId,
            nickName: item.nickName || undefined,
            blogName: item.blogName || undefined,
            addDate: item.addDate || undefined,
            postUrl: item.postUrl || undefined,
            thumbnail: item.thumbnails?.[0]?.url || item.profileImgUrl || undefined,
          });
          got++;
          if (got >= countPerKeyword) break;
        }
        await page.waitForTimeout(250);
      }

      log(`[수집] "${kw}" → ${got}개 수집` +
        (skippedMarket ? ` (판매글 ${skippedMarket}개 제외)` : "") +
        (skippedStale ? ` (오래된 블로그 ${skippedStale}개 제외)` : ""));

      // 폴백: JSON에서 하나도 못 얻으면 모바일 검색 스크레이핑
      if (got === 0) {
        log(`[수집] "${kw}" API 0건 → 모바일 검색 폴백...`);
        try {
          const fb = await crawlMobileFallback(context, kw, countPerKeyword);
          for (const b of fb) { if (!seen.has(b.blogId)) { seen.add(b.blogId); results.push(b); } }
          log(`[수집] "${kw}" 폴백 → ${fb.length}개`);
        } catch (e: any) { log(`[수집] 폴백 실패: ${e.message}`); }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return results;
}

/* ── 내 이웃새글 수집 (키워드 대신 "내 서로이웃들의 최근 글") ──
   네이버 이웃새글 API(BuddyPostList.naver)를 세션으로 호출 → 이웃 블로거 중복제거해 반환.
   실측: blogId/nickName/postUrl/addDate/sympathyEnable/commentEnable 제공. */
export async function crawlBuddyPosts(params: {
  accountId: string;
  maxCount: number;
  onLog?: (msg: string) => void;
}): Promise<BlogTarget[]> {
  const { accountId, maxCount, onLog } = params;
  const log = onLog || console.log;
  if (!sessionExists(accountId)) throw new Error("세션 없음 — 먼저 계정을 연결하세요");
  const { cookies } = loadSession(accountId);

  const results: BlogTarget[] = [];
  const seen = new Set<string>();
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  try {
    await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    log("[이웃새글] 내 서로이웃 최근 글 수집 중...");

    const maxPages = 30;
    for (let pageNum = 1; pageNum <= maxPages && results.length < maxCount; pageNum++) {
      const apiUrl = `https://section.blog.naver.com/ajax/BuddyPostList.naver?page=${pageNum}&groupId=0`;
      let list: any[] = [];
      try {
        const raw = await page.evaluate(async (u) => {
          const r = await fetch(u, { headers: { Referer: "https://section.blog.naver.com/BlogHome.naver" } });
          return await r.text();
        }, apiUrl);
        const data = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""));
        list = data?.result?.buddyPostList || data?.result?.postList || data?.result?.list || [];
      } catch { list = []; }
      if (!list.length) break;

      for (const item of list) {
        const blogId = item.domainIdOrBlogId || item.blogId;
        if (!blogId || INVALID_BLOG_IDS.includes(blogId) || seen.has(blogId)) continue;
        // 공감/댓글 둘 다 막힌 글은 스킵
        if (item.sympathyEnable === false && item.commentEnable === false) continue;
        seen.add(blogId);
        results.push({
          keyword: "이웃새글",
          blogId,
          nickName: item.nickName || undefined,
          blogName: item.blogName || item.nickName || undefined,
          addDate: item.addDate || undefined,
          postUrl: item.postUrl || undefined,
          thumbnail: item.thumbnails?.[0]?.url || item.profileUrl || undefined,
        });
        if (results.length >= maxCount) break;
      }
      await page.waitForTimeout(250);
    }
    log(`[이웃새글] ✅ 이웃 블로거 ${results.length}명 수집 완료`);
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

/* ── 내 이웃새글 제목·내용에서 "자주 나오는 키워드" 추출 (이웃들이 뭘 쓰는지 분석) ── */
export async function analyzeBuddyKeywords(params: {
  accountId: string;
  scanCount?: number;   // 스캔할 이웃글 수(기본 100)
  onLog?: (msg: string) => void;
}): Promise<{ word: string; count: number }[]> {
  const { accountId, scanCount = 100, onLog } = params;
  const log = onLog || console.log;
  if (!sessionExists(accountId)) throw new Error("세션 없음 — 먼저 계정을 연결하세요");
  const { cookies } = loadSession(accountId);
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  const texts: string[] = [];
  try {
    await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    log("[키워드분석] 내 이웃새글 스캔 중...");
    for (let pageNum = 1; pageNum <= 30 && texts.length < scanCount; pageNum++) {
      const apiUrl = `https://section.blog.naver.com/ajax/BuddyPostList.naver?page=${pageNum}&groupId=0`;
      let list: any[] = [];
      try {
        const raw = await page.evaluate(async (u) => {
          const r = await fetch(u, { headers: { Referer: "https://section.blog.naver.com/BlogHome.naver" } });
          return await r.text();
        }, apiUrl);
        list = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""))?.result?.buddyPostList || [];
      } catch { list = []; }
      if (!list.length) break;
      for (const it of list) texts.push(`${it.title || ""} ${it.briefContents || ""}`);
      await page.waitForTimeout(200);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  // 한글 2글자+ 단어 빈도 (조사·인삿말·불용어 제거)
  const STOP = new Set(["안녕하세요","있는","합니다","입니다","그리고","하는","이번","오늘","저는","제가","너무","정말","진짜","우리","그것","이것","해서","에서","으로","까지","부터","했습니다","같은","위해","통해","대한","관련","경우","때문","많이","다시","바로","여기","거기","하지만","그런","이런","저런","하고","했어요","합니다만","입니다만","보고","보다","되는","되어","있어요","없이도","없는","위한","때는","면서"]);
  const freq: Record<string, number> = {};
  const joined = texts.join(" ");
  for (const w of joined.match(/[가-힣]{2,}/g) || []) {
    if (STOP.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  const top = Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([word, count]) => ({ word, count }));
  return top;
}

/* 모바일 통합검색 블로그탭 폴백 (ajax API가 막혔을 때) */
async function crawlMobileFallback(context: BrowserContext, keyword: string, limit: number): Promise<BlogTarget[]> {
  const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const page = await context.newPage();
  const out: BlogTarget[] = [];
  const seen = new Set<string>();
  try {
    await page.setExtraHTTPHeaders({ "User-Agent": MUA });
    await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(keyword)}`,
      { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
    const hrefs: string[] = await page.$$eval('a[href*="blog.naver.com"]', els => els.map(e => (e as HTMLAnchorElement).href));
    for (const h of hrefs) {
      const m = h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
      if (m && m[1] && !INVALID_BLOG_IDS.includes(m[1]) && !seen.has(m[1])) {
        seen.add(m[1]);
        out.push({ keyword, blogId: m[1] });
        if (out.length >= limit) break;
      }
    }
  } finally { await page.close().catch(() => {}); }
  return out;
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

  // 다중 멘트 파싱 (|||로 구분된 경우 순환 사용)
  const msgs = message.split("|||").map(m => m.trim()).filter(Boolean);
  if (msgs.length === 0) msgs.push(message);
  let msgIdx = 0;

  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { cookies } = loadSession(accountId);

  const dp = donePath(accountId);
  let doneSet = new Set<string>();
  if (skipDone && fs.existsSync(dp)) {
    try {
      const list: string[] = JSON.parse(fs.readFileSync(dp, "utf-8"));
      doneSet = new Set(list);
    } catch {}
  }

  // 서이추 신청 페이지가 모바일(m.blog.naver.com)만 작동 → 모바일 UA/뷰포트로 실행
  const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: MOBILE_UA, viewport: { width: 390, height: 844 }, locale: "ko-KR", isMobile: true, hasTouch: true,
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  let done = 0;
  let fail = 0;
  const runSeen = new Set<string>();   // 이번 실행에서 이미 처리한 blogId (중복 신청 방지)

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

      if ((skipDone && doneSet.has(blogId)) || runSeen.has(blogId)) {
        await onResult?.({ keyword, blogId, status: "skip", message: doneSet.has(blogId) ? "이미 처리됨" : "중복(이번 목록)" });
        onProgress?.(done, fail);
        continue;
      }
      runSeen.add(blogId);   // 이번 실행 내 중복 방지

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
        //  ⚠️ 네이버가 PC용 BlogAddNeighbor.naver URL 폐기 → 모바일 BuddyAddForm.naver만 작동(2026-08 실측)
        await page.goto(
          `https://m.blog.naver.com/BuddyAddForm.naver?blogId=${blogId}`,
          { waitUntil: "domcontentloaded", timeout: 20000 }
        );
        await page.waitForTimeout(1500);

        // 페이지 유효성 확인 (폐기/에러/로그인 튕김)
        const bodyTxt = await page.evaluate(() => document.body.innerText).catch(() => "");
        const curUrl = page.url();
        if (curUrl.includes("login") || /사라졌거나|주소를 확인|페이지를 찾을/.test(bodyTxt)) {
          throw new Error("신청 페이지 접근 불가(비공개 블로그이거나 세션 만료)");
        }
        if (/이미 이웃|이웃입니다|나와의 관계/.test(bodyTxt)) {
          throw new Error("이미 이웃이거나 신청 불가");
        }

        // 서로이웃 라디오 선택 (#bothBuddyRadio = relation 1). 없으면 이웃추가로 진행.
        try {
          const bothRadio = await page.$("#bothBuddyRadio, input[name='relation'][value='1']");
          if (bothRadio) {
            await bothRadio.click({ timeout: 2000 }).catch(() => page.evaluate(() => {
              const r = document.querySelector("#bothBuddyRadio, input[name='relation'][value='1']") as HTMLInputElement;
              if (r) { r.checked = true; r.click(); }
            }));
            await page.waitForTimeout(400);
          }
        } catch {}

        // 메시지 입력 (모바일: textarea.textarea_t1)
        const msgSels = ["textarea.textarea_t1", "textarea[name='message']", "textarea#sendMessage", "textarea"];
        let msgFilled = false;
        for (const sel of msgSels) {
          try {
            const el = await page.$(sel);
            if (el) {
              await page.click(sel);
              await page.waitForTimeout(300);
              await page.fill(sel, "");
              const currentMsg = msgs[msgIdx % msgs.length];
              msgIdx++;
              const naturalMsg = naturalizeMsg(currentMsg);
              log(`[서이추] 💬 멘트 [${((msgIdx-1) % msgs.length)+1}/${msgs.length}]: "${naturalMsg.slice(0, 30)}..."`);
              await humanType(page, naturalMsg);
              msgFilled = true;
              break;
            }
          } catch {}
        }
        await page.waitForTimeout(400);

        // 확인 버튼 (모바일: a.btn_ok)
        const confirmSels = [
          "a.btn_ok", "button.btn_ok", "a:has-text('확인')", "button:has-text('확인')", "button:has-text('신청')", "input[type='submit']",
        ];
        const clickConfirm = async () => {
          for (const sel of confirmSels) {
            try { const el = await page.$(sel); if (el) { await page.click(sel, { timeout: 3000 }); return true; } } catch {}
          }
          return false;
        };
        const readBody = async () => (await page.evaluate(() => document.body.innerText).catch(() => ""));
        // 팝업(레이어) 안의 '확인' 버튼을 눌러 닫기(폼 헤더의 '확인'과 구분). 눌렀으면 true.
        const clickPopupConfirm = async () => await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("a,button,span")) as HTMLElement[];
          const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const b = [...els].reverse().find(el => (el.textContent || "").replace(/\s+/g, "") === "확인" && vis(el) &&
            el.closest('[class*="pop"],[class*="layer"],[class*="lyr"],[class*="alert"],[class*="modal"],[role="dialog"]'));
          if (b) { ((b.closest("a,button") as HTMLElement) || b).click(); return true; }
          return false;
        }).catch(() => false);

        let submitted = await clickConfirm();
        await page.waitForTimeout(1200);
        let afterTxt = await readBody();

        // ★"이미 추가한 이웃입니다" 팝업 → 확인 눌러 닫고 이 블로그는 건너뜀(이미 이웃)
        const ALREADY_RE = /이미\s*추가한?\s*이웃|이미\s*(서로)?이웃|이미\s*신청/;
        if (ALREADY_RE.test(afterTxt)) {
          await clickPopupConfirm();
          doneSet.add(blogId);
          fs.writeFileSync(dp, JSON.stringify([...doneSet], null, 2));
          await onResult?.({ keyword, blogId, status: "skip", message: "이미 추가한 이웃" });
          log(`[서이추] ⏭ ${blogId} 이미 이웃 — 건너뜀`);
          onProgress?.(done, fail);
          await page.waitForTimeout(humanDelay(delayMin, delayMax));
          continue;
        }

        // 신청 후 결과 확인
        const LIMIT_RE = /하루 최대|신청 한도|초과하여|더 이상 신청/;
        //  ★"선택 그룹의 이웃수가 초과되어 … 다른 그룹을 선택해주세요" 팝업 = 그룹당 500명 한도.
        //   기존 코드는 이 팝업을 못 잡아 '확인 클릭=성공'으로 잘못 카운트했음 → 아래에서 감지·재시도.
        const GROUP_FULL_RE = /이웃\s*수가\s*초과|다른\s*그룹을?\s*선택|그룹의\s*이웃/;
        // 실제 '신청 완료'를 나타내는 문구(폼 라벨 "서로이웃을 신청합니다"와 구분 — 완료/되었/했만 매칭)
        const SUCCESS_RE = /신청.{0,4}(완료|되었습니다|하였습니다|했습니다)|이웃.{0,4}(추가되었|추가하였|추가\s*완료)/;

        if (GROUP_FULL_RE.test(afterTxt)) {
          //  ★네이버는 수동: 팝업 '확인'만 눌러선 그룹이 안 넘어감(무한반복). 팝업 닫고 → 그룹 목록에서
          //   '다른 그룹'을 직접 선택 → 재신청 을 반복해야 함. 빈 그룹 만나면 신청완료, 다 차면 건너뜀.
          log(`[서이추] ⚠️ ${blogId} 그룹 가득참 → 다른 그룹 선택 후 재신청 반복`);

          // 경고 팝업(레이어)의 '확인'을 눌러 닫기(폼의 '확인'과 구분)
          const dismissPopup = async () => {
            await page.evaluate(() => {
              const els = Array.from(document.querySelectorAll("a,button,span")) as HTMLElement[];
              const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
              const b = [...els].reverse().find(el => (el.textContent || "").replace(/\s+/g, "") === "확인" && vis(el) &&
                el.closest('[class*="pop"],[class*="layer"],[class*="lyr"],[class*="alert"],[class*="modal"],[role="dialog"]'));
              if (b) ((b.closest("a,button") as HTMLElement) || b).click();
            }).catch(() => {});
          };

          //  ★실측(테리 로그): 폼 그룹 드롭다운 id="buddyGroupSelect", 옵션=기존 그룹뿐("새 그룹","new"…).
          //   '새 그룹 만들기' 항목은 폼에 없음 → 폼 안에선 그룹 신규 생성 불가. 안 찬 기존 그룹을 골라 재신청.
          const sel: any = await page.evaluate(() => {
            const s: any = document.querySelector("#buddyGroupSelect") || document.querySelector("select");
            if (!s) return null;
            return { id: s.id, name: s.name, opts: Array.from(s.options).map((o: any) => ({ t: (o.text || "").trim(), v: o.value, sel: o.selected })) };
          }).catch(() => null);

          let recovered = false;
          if (sel && sel.opts.length > 1) {
            const selSelector = sel.id ? `#${sel.id}` : (sel.name ? `select[name="${sel.name}"]` : "select");
            //  마지막(최근 생성) 그룹이 가장 여유 있을 확률이 높아 뒤에서부터 시도
            const cands = [...sel.opts].reverse().filter((o: any) => o.v && !o.sel && !/^\s*(그룹\s*선택|선택하세요|선택)$/.test(o.t));
            for (const o of cands) {
              try {
                await dismissPopup(); await page.waitForTimeout(400);
                await page.selectOption(selSelector, o.v).catch(() => {});   // 다른 그룹 선택
                await page.waitForTimeout(400);
                await page.click("a.btn_ok").catch(() => clickConfirm());     // 폼 재신청
                await page.waitForTimeout(1500);
                afterTxt = await readBody();
                if (SUCCESS_RE.test(afterTxt)) { log(`[서이추] ✅ '${o.t}' 그룹으로 신청`); recovered = true; break; }
              } catch {}
            }
            if (!recovered) log(`[서이추] ⛔ ${blogId} 모든 그룹(${cands.length}개) 가득참`);
          } else {
            log(`[서이추] ⛔ ${blogId} 그룹 목록을 못 읽음`);
          }
          submitted = recovered;
          if (!recovered) throw new Error("모든 이웃 그룹이 가득 참 — 건너뜀(네이버 블로그에서 빈 이웃 그룹을 하나 만들어 주세요)");
        }

        if (LIMIT_RE.test(afterTxt)) {
          throw new Error("네이버 일일 서이추 한도 도달");
        }

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

  // 다중 댓글 파싱 (|||로 구분된 경우 순환 사용)
  const comments = comment.split("|||").map(c => c.trim()).filter(Boolean);
  if (comments.length === 0 && comment.trim()) comments.push(comment);
  let commentIdx = 0;

  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { cookies } = loadSession(accountId);

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
        let likeReason = "";     // 공감 못한 이유 (결과 표시용)
        let commentReason = "";  // 댓글 못단 이유 (결과 표시용)
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

        // mainFrame은 높이 800px인 iframe 안에서 자체 문서를 스크롤한다.
        // frame locator의 scrollIntoViewIfNeeded()는 네이버의 스크롤 동기화와 충돌해
        // 요소가 y=800 아래에 남을 수 있으므로 내부 scrollingElement를 명시적으로 이동한다.
        const scrollFrameElementIntoView = async (el: any) => {
          if (!frame) {
            await el.scrollIntoViewIfNeeded();
            return;
          }
          await el.evaluate((node: Element) => {
            const scroller = document.scrollingElement || document.documentElement;
            const rect = node.getBoundingClientRect();
            const target = scroller.scrollTop + rect.top - Math.max(120, window.innerHeight * 0.35);
            scroller.scrollTop = Math.max(0, target);
            window.scrollTo(0, Math.max(0, target));
          });
          await page.waitForTimeout(350);
        };

        // ── 공감 클릭 ──
        //  실측(2026-08): 네이버 공감버튼 = a.u_likeit_list_button (텍스트 "공감"), 이미 눌렀으면 class에 'on'
        if (doLike) {
          try {
            const likeSels = [
              // 실제 보이는 메인 버튼. list_button은 닫힌 리액션 레이어 안의 0x0 요소다.
              "a.u_likeit_button._face",
              // 구버전 폴백
              ".sympathy_toggle_btn",
              "a[class*='sympathy']",
            ];
            for (const sel of likeSels) {
              try {
                const el = await ctx.$(sel);
                if (el) {
                  // 이미 공감했는지: class에 'on'(off가 없음)이면 눌린 상태
                  const isActive = await ctx.evaluate((s: string) => {
                    const btn = document.querySelector(s);
                    if (!btn) return false;
                    const c = btn.className || "";
                    return btn.getAttribute("aria-pressed") === "true" || (/\bon\b/.test(c) && !/\boff\b/.test(c));
                  }, sel);
                  if (!isActive) {
                    await scrollFrameElementIntoView(el);
                    await el.click({ timeout: 6000 });
                    // 클릭 호출 성공만으로 처리하지 않고 실제 DOM 상태 전환을 확인한다.
                    await ctx.waitForFunction((s: string) => {
                      const btn = document.querySelector(s);
                      if (!btn) return false;
                      return btn.getAttribute("aria-pressed") === "true" ||
                        (/\bon\b/.test(btn.className || "") && !/\boff\b/.test(btn.className || ""));
                    }, sel, { timeout: 5000 });
                    liked = true;
                    log(`[공감·댓글] ❤️ ${blogId} 공감 완료 (상태 확인)`);
                  } else {
                    liked = true; // 이미 공감됨
                    log(`[공감·댓글] ${blogId} 이미 공감됨`);
                  }
                  break;
                }
              } catch {}
            }
            if (!liked) { likeReason = "공감 버튼 없음(막힘/비공개)"; log(`[공감·댓글] ${blogId} 공감 버튼 못 찾음`); }
          } catch (e: any) {
            log(`[공감·댓글] ${blogId} 공감 실패: ${e.message}`);
          }
        }

        // ── 댓글 작성 ──
        if (doComment && comment.trim()) {
          try {
            await page.waitForTimeout(1000);

            // ★ 실측(2026-08): 댓글 입력창은 lazy-load. 순서=①끝까지 스크롤 ②'댓글 쓰기'(_cmtList) 클릭해 위젯 로드
            //    ③'댓글쓰기' 화살표버튼(a.btn_write_comment._naverCommentWriteBtn) 클릭해야 u_cbox_text 입력칸이 펼쳐짐
            try {
              // 여러 단계로 끝까지 스크롤(긴 글도 댓글 위젯 로드되게)
              for (let s = 0; s < 4; s++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(500); }
              await ctx.evaluate(() => { const sc = document.scrollingElement || document.documentElement; sc.scrollTop = sc.scrollHeight; }).catch(() => {});
              await page.waitForTimeout(1200);
              // ① 댓글 영역 열기(위젯 로드) — btn_comment/_cmtList/플로팅
              for (const os of ["a.btn_comment._cmtList", "a._cmtList", "a.btn_comment", "a._floating_bottom_btn_comment"]) {
                const ob = await ctx.$(os);
                if (ob) { await scrollFrameElementIntoView(ob); await ob.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500); break; }
              }
              // ② ★'댓글쓰기' 버튼(화살표) 클릭 → 입력칸 펼쳐짐 (실측 클래스 _naverCommentWriteBtn)
              for (const ws of ["a.btn_write_comment._naverCommentWriteBtn", "a._naverCommentWriteBtn", "a.btn_write_comment"]) {
                const wb = await ctx.$(ws);
                if (wb) { await scrollFrameElementIntoView(wb); await wb.click({ force: true, timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1500); break; }
              }
              // ③ u_cbox 입력칸이 뜰 때까지 대기(최대 6초)
              await ctx.waitForSelector(".u_cbox_text, .u_cbox_write_wrap textarea", { timeout: 6000 }).catch(() => {});
              // 접힌 작성영역(beforeClickWriteBox) 한 번 더 클릭해 포커스
              const writeArea = await ctx.$(".u_cbox_write, .u_cbox_write_wrap");
              if (writeArea) { await scrollFrameElementIntoView(writeArea); await writeArea.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(600); }
            } catch {}

            // 댓글 입력창 셀렉터 (u_cbox = 네이버 공용 댓글 위젯)
            const commentSels = [
              ".u_cbox_text",
              "textarea.u_cbox_text",
              ".u_cbox_write_wrap textarea",
              "textarea#commentArea",
              "textarea[name='comment']",
              "textarea[placeholder*='댓글']",
              "textarea[class*='comment']",
              "#naverComment textarea",
              "iframe#naverComment",
            ];

            let commentDone = false;

            // 댓글은 보통 mainFrame(ctx) 안에 있음. iframe도 대비.
            const commentFrame = page.frames().find(f =>
              f.url().includes("comment") || f.name().includes("comment")
            );
            const commentCtx = commentFrame ?? ctx;

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
                      const currentComment = comments[commentIdx % comments.length];
                      commentIdx++;
                      const naturalComment = naturalizeMsg(currentComment);
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
                  // ★ 안내문(.u_cbox_guide placeholder)이 입력칸 클릭을 가로챔 → 안내문 먼저 클릭해 활성화
                  const guide = await commentCtx.$(".u_cbox_guide");
                  if (guide) { await guide.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); }
                  // force 클릭(오버레이 무시) + 좌표 폴백
                  try { await el.click({ force: true, timeout: 3000 }); }
                  catch { const b = await el.boundingBox(); if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
                  await page.waitForTimeout(400);
                  // contenteditable(.u_cbox_text)은 fill 안됨 → 전체선택 후 삭제로 비우기
                  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
                  await page.keyboard.press("Backspace").catch(() => {});
                  const currentComment2 = comments[commentIdx % comments.length];
                  const naturalComment2 = naturalizeMsg(currentComment2);
                  await humanType(page, naturalComment2);
                  await page.waitForTimeout(600);
                  // ★ 실제로 입력됐는지 확인 (안됐으면 다음 셀렉터 시도, commentIdx는 성공시에만 증가)
                  const typedOk = await commentCtx.evaluate((s: string) => {
                    const t = document.querySelector(s) as any;
                    return !!t && (t.value || t.textContent || "").trim().length > 0;
                  }, sel).catch(() => false);
                  if (!typedOk) { continue; }
                  commentIdx++;
                  // 등록 버튼 (u_cbox_btn_upload = 네이버 댓글 등록)
                  const submitSels = [
                    ".u_cbox_btn_upload",
                    "button.u_cbox_btn_upload",
                    "a.u_cbox_btn_upload",
                    "button[type='submit']",
                    "button[class*='submit']",
                    "button.btn_ok",
                  ];
                  for (const ss of submitSels) {
                    try {
                      const sb = await commentCtx.$(ss);
                      if (sb) { await sb.click({ force: true, timeout: 3000 }); commentDone = true; break; }
                    } catch {}
                  }
                  if (commentDone) { log(`[공감·댓글] 💬 ${blogId} 댓글 등록`); break; }
                }
              } catch {}
            }

            if (commentDone) {
              commented = true;
              await page.waitForTimeout(1000);
              log(`[공감·댓글] 💬 ${blogId} 댓글 완료`);
            } else {
              commentReason = "댓글 입력창 못 찾음(댓글 막힘 가능)";
              log(`[공감·댓글] ${blogId} 댓글 입력창 못 찾음`);
            }
          } catch (e: any) {
            commentReason = `댓글 오류(${(e.message || "").slice(0, 20)})`;
            log(`[공감·댓글] ${blogId} 댓글 실패: ${e.message}`);
          }
        }

        // ★ 목표 달성 기준: 댓글 작업이면 "댓글이 실제로 써졌는가"가 핵심(공감만 된 건 완료 아님 → 다음에 댓글 재시도)
        const goalMet = doComment ? commented : liked;
        if (goalMet) {
          // 목표 달성한 것만 "완료 목록"에 기록(다음번 '이미 처리됨' 대상)
          doneSet.add(blogId);
          fs.writeFileSync(engageDonePath, JSON.stringify([...doneSet], null, 2));
          done++;
          const msg = commented ? "통과 (댓글 작성)" : "공감 완료";
          await onResult?.({ keyword, blogId, postUrl: targetPost.url, liked, commented, status: "success", message: msg });
          log(`[공감·댓글] ✅ ${blogId} ${msg} (${done}/${dailyLimit})`);
        } else {
          // 목표 미달 → 완료기록 안 함(재시도 가능) + 결과에 "사실" 그대로 표시
          const parts: string[] = [];
          if (doLike) parts.push(liked ? "공감됨" : `공감 ${likeReason || "실패"}`);
          if (doComment) parts.push(commented ? "댓글됨" : `댓글 ${commentReason || "실패"}`);
          const msg = parts.join(" / ") || "대상 아님";
          await onResult?.({ keyword, blogId, postUrl: targetPost.url, liked, commented, status: "skip", message: msg });
          log(`[공감·댓글] ⏭ ${blogId} 스킵: ${msg}`);
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
