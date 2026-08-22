import { chromium, BrowserContext } from "playwright";
import fs from "fs";
import https from "https";
import http from "http";
import os from "os";
import path from "path";
import { deleteSession, hasSession, readSession, writeSession, SESSION_DIR } from "./session-store";
import { getAdminBlogSearchKeys } from "./supabase";

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

/* ── 당일 중복방지 공용 유틸 ──
   done 기록에 처리 날짜(KST)를 함께 저장 → "오늘 이미 작업한 대상"은 skipDone 토글과 무관하게 항상 스킵.
   기존 배열([blogId,...]) 파일은 자동 하위호환(과거 처리분=legacy로 취급, 당일 아님). */
export function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD (Asia/Seoul)
}
export function loadDoneMap(fp: string): Record<string, string> {
  try {
    if (!fs.existsSync(fp)) return {};
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
    if (Array.isArray(raw)) { const m: Record<string, string> = {}; for (const id of raw) m[String(id)] = "legacy"; return m; }
    if (raw && typeof raw === "object") return raw as Record<string, string>;
    return {};
  } catch { return {}; }
}

/* ── 재신청 방지 기간: 실패/무응답 건은 마지막 시도일 기록 → N일 지나면 재시도 허용 ── */
function attemptsPath(accountId: string): string {
  return path.join(SESSION_DIR, `attempts_${accountId}.json`);
}
export function loadAttempts(accountId: string): Record<string, number> {
  try { return JSON.parse(fs.readFileSync(attemptsPath(accountId), "utf-8")) || {}; } catch { return {}; }
}
export function saveAttempt(accountId: string, blogId: string, map: Record<string, number>): void {
  map[blogId] = Date.now();
  try { fs.writeFileSync(attemptsPath(accountId), JSON.stringify(map)); } catch {}
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
  qualityFilter?: boolean;   // 죽은/광고/서이추불가 블로그 자동 스킵 (기본 ON)
  retryDays?: number;        // 실패/무응답 건 재시도까지 대기일 (기본 30, 0=영구 스킵)
  onLog?: (msg: string) => void;
  onResult?: (r: NeighborResult) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const { accountId, targets, message, delayMin, delayMax, dailyLimit, skipDone, qualityFilter = true, retryDays = 30, onLog, onResult, onProgress, stopSignal } = params;
  const log = onLog || console.log;

  // 다중 멘트 파싱 (|||로 구분된 경우 순환 사용)
  const msgs = message.split("|||").map(m => m.trim()).filter(Boolean);
  if (msgs.length === 0) msgs.push(message);
  let msgIdx = 0;

  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { cookies } = loadSession(accountId);

  const dp = donePath(accountId);
  const doneMap = loadDoneMap(dp);   // { blogId: "YYYY-MM-DD" | "legacy" }
  const today = todayKST();
  // 재신청 방지: 실패/무응답 시도 이력 (blogId → 마지막 시도 ms)
  const attempts = loadAttempts(accountId);
  const retryMs = (retryDays > 0 ? retryDays : 0) * 86400 * 1000;
  const attemptedRecently = (blogId: string) =>
    retryMs > 0 && attempts[blogId] && (Date.now() - attempts[blogId]) < retryMs;

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
      // dailyLimit = 서버가 넘겨준 '오늘 남은 한도'(플랜별 quota). 도달 시 자동 정지.
      if (done >= dailyLimit) { log(`[서이추] 오늘 한도 도달 (${dailyLimit}건) — 자동 정지`); break; }
      if (stopSignal?.()) { log("[서이추] 중단 신호 수신"); break; }

      const { keyword, blogId } = target;

      const doneToday = doneMap[blogId] === today;                 // 오늘 이미 처리 → 항상 스킵(당일 중복방지)
      const donePerm = skipDone && (blogId in doneMap);            // 완료 스킵 ON → 과거 처리분도 스킵
      if (doneToday || donePerm || runSeen.has(blogId)) {
        await onResult?.({ keyword, blogId, status: "skip", message: doneToday ? "오늘 이미 처리됨(당일 중복방지)" : donePerm ? "이미 처리됨" : "중복(이번 목록)" });
        onProgress?.(done, fail);
        continue;
      }
      // 최근 실패/무응답 → 재신청 대기기간(retryDays) 안이면 스킵
      if (skipDone && attemptedRecently(blogId)) {
        const daysAgo = Math.floor((Date.now() - attempts[blogId]) / 86400000);
        await onResult?.({ keyword, blogId, status: "skip", message: `최근 시도(${daysAgo}일 전) — ${retryDays}일 후 재시도` });
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

        // ── ★품질 필터: 죽은/광고/마켓 블로그 자동 스킵(헛신청 방지, 한도 절약) ──
        if (qualityFilter) {
          const q = await page.evaluate(() => {
            const txt = document.body.innerText || "";
            const title = document.title || "";
            // 최근 글 날짜 흔적 (모바일/PC 공통 상대·절대 시간 표기)
            const hasRecent = /방금 전|분 전|시간 전|일 전|어제|오늘|20\d\d\.\s?\d{1,2}\.\s?\d{1,2}/.test(txt);
            // 마켓/광고/판매 블로그 신호
            const isMarket = /블로그마켓|마켓 바로가기|스토어 바로가기|공동구매|공구 진행|판매중|구매하기|장바구니|가격문의|DM문의|비즈니스/.test(txt + title);
            return { hasRecent, isMarket, len: txt.length };
          }).catch(() => ({ hasRecent: true, isMarket: false, len: 999 }));

          if (q.isMarket) {
            await onResult?.({ keyword, blogId, status: "skip", message: "마켓·광고 블로그(자동 스킵)" });
            log(`[서이추] ⏭ ${blogId} 마켓·광고 블로그 → 스킵`);
            onProgress?.(done, fail);
            await page.waitForTimeout(humanDelay(1, 2));
            continue;
          }
          if (!q.hasRecent && q.len < 4000) {
            await onResult?.({ keyword, blogId, status: "skip", message: "최근 글 없는 휴면 블로그(자동 스킵)" });
            log(`[서이추] ⏭ ${blogId} 휴면(최근 글 없음) → 스킵`);
            onProgress?.(done, fail);
            await page.waitForTimeout(humanDelay(1, 2));
            continue;
          }
        }

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
          doneMap[blogId] = today;
          fs.writeFileSync(dp, JSON.stringify(doneMap, null, 2));
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
          doneMap[blogId] = today;
          fs.writeFileSync(dp, JSON.stringify(doneMap, null, 2));
          done++;
          await onResult?.({ keyword, blogId, status: "success", message: "서이추 신청 완료" });
          log(`[서이추] ✅ ${blogId} 완료 (${done}/${dailyLimit})`);
        } else {
          throw new Error("신청 버튼을 찾을 수 없음");
        }
      } catch (e: any) {
        fail++;
        // 실패/무응답 시도일 기록 → retryDays 동안 재신청 안 함(무한 헛시도 방지)
        if (skipDone && retryMs > 0) saveAttempt(accountId, blogId, attempts);
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

/* ── AI 자동 댓글: 블로그 글을 읽고 Gemini로 자연스러운 댓글 1개 생성 ── */
async function extractPostText(ctx: any): Promise<string> {
  try {
    return await ctx.evaluate(() => {
      const pick = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.innerText || "";
      const title = pick(".se-title-text") || pick(".htitle") || pick(".pcol1") || document.title || "";
      const body = pick(".se-main-container") || pick("#postViewArea") || pick(".post_ct") || pick(".se_component_wrap") || "";
      return (title + "\n" + body).replace(/\s+/g, " ").trim().slice(0, 1200);
    });
  } catch { return ""; }
}
async function generateAiComment(key: string, tone: string, postText: string, log: (m: string) => void): Promise<string> {
  if (!key) { log("[AI댓글] ⚠️ Gemini 키가 없어 건너뜁니다 (설정 → 글쓰기 AI에서 Gemini 키 입력)"); return ""; }
  if (!postText || postText.length < 10) { log("[AI댓글] 글 내용을 못 읽어 건너뜀"); return ""; }
  const toneGuide = tone === "담백" ? "깔끔하고 담백한" : tone === "짧게" ? "짧고 간결한" : "다정하고 따뜻한";
  const prompt = `너는 네이버 블로그 이웃이야. 아래 블로그 글을 읽고 ${toneGuide} 말투의 자연스러운 한국어 공감 댓글을 딱 1개만 써줘.\n규칙: 1~2문장, 45자 이내, 글 내용에 구체적으로 반응, 이모지 1개 정도만, 광고·링크·해시태그 금지, 따옴표 없이 댓글 문장만 출력.\n\n[블로그 글]\n${postText}`;
  const models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 200, temperature: 1.0 } }),
      });
      const d: any = await r.json();
      if (!r.ok) { if (r.status === 404) continue; log(`[AI댓글] 생성 실패(${model}): ${d?.error?.message || r.status}`); return ""; }
      const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (txt) return txt.replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0].slice(0, 120);
    } catch (e: any) { log(`[AI댓글] 오류(${model}): ${e.message}`); }
  }
  log("[AI댓글] 모든 모델 생성 실패");
  return "";
}

/* ── 블로그 건강검진: 내 블로그 실제 지표 크롤 ──
   네이버는 공식 '지수'를 공개하지 않으므로, 실제로 읽을 수 있는 지표만 수집한다:
   총 게시글 수, 이웃 수, 최근 글 날짜들(→발행 빈도/마지막 활동). 점수·등급은 이 지표로 산출. */
export type BlogExposureCheck = {
  logNo: string;
  title: string;
  exposed: boolean | null;
  rank: number | null;
  postUrl?: string;
};

export type BlogVisitorDay = { date: string; visitors: number };

type NaverPostItem = { logNo: string; title: string; date: string; dateMs: number; url: string };

function koreanDate(date: Date): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
  catch { return date.toISOString().slice(0, 10); }
}

function decodeNaverText(value: unknown): string {
  let text = String(value ?? "").replace(/\+/g, " ");
  try { text = decodeURIComponent(text); } catch {}
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}

function normalizePostDate(value: unknown): { date: string; dateMs: number } {
  const raw = String(value ?? "").trim();
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw) * (raw.length === 10 ? 1000 : 1);
    const d = new Date(numeric);
    if (!Number.isNaN(d.getTime())) return { date: koreanDate(d), dateMs: d.getTime() };
  }
  const match = raw.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
  if (match) {
    const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    return { date, dateMs: new Date(`${date}T00:00:00+09:00`).getTime() };
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? { date: raw.slice(0, 20), dateMs: 0 } : { date: koreanDate(new Date(parsed)), dateMs: parsed };
}

function cookieHeader(cookies: any[]): string {
  return (Array.isArray(cookies) ? cookies : []).filter(cookie => cookie?.name).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

async function fetchNaverPostList(params: {
  blogId: string; cookies: any[]; maxCount?: number | null; log?: (msg: string) => void;
}): Promise<{ posts: NaverPostItem[]; source: "api" | "rss" | "none"; totalCount: number }> {
  const { blogId, cookies, maxCount = null } = params;
  const log = params.log || console.log;
  const posts: NaverPostItem[] = [];
  const seen = new Set<string>();
  let totalCount = 0;
  try {
    // ★공개 요청(쿠키 없이). 세션 쿠키를 넣으면 네이버가 막아 빈 응답을 주는 것을 실측 확인(2026-08-23).
    //   PostTitleListAsync/RSS는 공개 데이터라 쿠키 불필요. review-check(체험단 심사)의 검증된 방식과 동일.
    const headers = { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}`, Accept: "application/json,text/plain,*/*" };
    for (let pageNo = 1; pageNo <= 1000 && (maxCount === null || posts.length < maxCount); pageNo++) {
      const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=${pageNo}&categoryNo=&parentCategoryNo=&countPerPage=30`;
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end < start) throw new Error("JSON 본문 없음");
      // ★네이버 PostTitleListAsync 응답의 pagingHtml에 잘못된 이스케이프(\')가 있어 JSON.parse가 죽는다(실측 2026-08-23).
      //   JSON에서 작은따옴표는 이스케이프 불필요 → \' 를 ' 로 정리한 뒤 파싱. (이게 posts 0개의 진짜 원인이었음)
      const jsonText = raw.slice(start, end + 1).replace(/\\'/g, "'");
      const json: any = JSON.parse(jsonText);
      const list: any[] = Array.isArray(json?.postList) ? json.postList : Array.isArray(json?.result?.postList) ? json.result.postList : [];
      const countCandidate = Number(json?.totalCount ?? json?.totalPostCount ?? json?.result?.totalCount ?? json?.result?.totalPostCount ?? json?.count ?? 0);
      if (Number.isFinite(countCandidate) && countCandidate > totalCount) totalCount = countCandidate;
      if (!list.length) break;
      let added = 0;
      for (const item of list) {
        const logNo = String(item?.logNo ?? item?.logno ?? item?.postNo ?? "").trim();
        const title = decodeNaverText(item?.title ?? item?.postTitle);
        if (!/^\d+$/.test(logNo) || !title || seen.has(logNo)) continue;
        const normalized = normalizePostDate(item?.addDate ?? item?.writeDate ?? item?.regDate ?? item?.date);
        seen.add(logNo); added++;
        posts.push({ logNo, title, ...normalized, url: `https://blog.naver.com/${blogId}/${logNo}` });
        if (maxCount !== null && posts.length >= maxCount) break;
      }
      if (!added || (totalCount > 0 ? posts.length >= totalCount : list.length < 30)) break;
    }
    if (posts.length) {
      log(`[글목록] PostTitleListAsync API에서 ${posts.length}개 수집`);
      return { posts, source: "api", totalCount: Math.max(totalCount, posts.length) };
    }
  } catch (e: any) { log(`[글목록] PostTitleListAsync 실패 (${e.message}) · RSS로 재시도`); }

  try {
    const response = await fetch(`https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`, { headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    for (const item of items) {
      const title = decodeNaverText(item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
      const link = decodeNaverText(item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]);
      const logNo = link.match(/(?:logNo=|\/)(\d{6,})(?:[/?&]|$)/)?.[1] || "";
      if (!logNo || !title || seen.has(logNo)) continue;
      const normalized = normalizePostDate(decodeNaverText(item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1]));
      seen.add(logNo);
      posts.push({ logNo, title, ...normalized, url: `https://blog.naver.com/${blogId}/${logNo}` });
      if (maxCount !== null && posts.length >= maxCount) break;
    }
    if (posts.length) { log(`[글목록] RSS 폴백에서 최근 글 ${posts.length}개 수집`); return { posts, source: "rss", totalCount: posts.length }; }
  } catch (e: any) { log(`[글목록] RSS 폴백 실패 (${e.message})`); }
  return { posts: [], source: "none", totalCount: 0 };
}

export type BlogStats = {
  blogId: string;
  totalPosts: number;
  neighbors: number;
  recentDates: string[];
  exposureChecks: BlogExposureCheck[];
  lowQualitySuspected: boolean | null;
  visitorDays: BlogVisitorDay[];
  inflowKeywords: { keyword: string; count?: number }[];
  visitorDrop: { detected: boolean; rate: number | null; message: string } | null;
  totalPostsForExposure: number;
  checkedTodayCount: number;
  exposureCompletedCount: number;
  exposureLimit: number | null;
};

type ExposurePost = { logNo: string; title: string };
type ExposureHistory = { dailyDate: string; dailyCount: number; lastChecked: Record<string, number> };
type ExposureProgress = { checks: BlogExposureCheck[]; checkedTodayCount: number; completedCount: number; limit: number | null };

const EXPOSURE_DAILY_LIMIT: Record<string, number | null> = { free: 5, basic: 10, pro: 20, unlimited: null, admin: null };

function exposureToday(): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

function exposureHistoryPath(blogId: string): string {
  const safeBlogId = blogId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(SESSION_DIR, `exposure_checked_${safeBlogId}.json`);
}

function readExposureHistory(blogId: string): ExposureHistory {
  const today = exposureToday();
  try {
    const parsed = JSON.parse(fs.readFileSync(exposureHistoryPath(blogId), "utf8"));
    return {
      dailyDate: today,
      dailyCount: parsed?.dailyDate === today && Number.isFinite(parsed?.dailyCount) ? Math.max(0, parsed.dailyCount) : 0,
      lastChecked: parsed?.lastChecked && typeof parsed.lastChecked === "object" ? parsed.lastChecked : {},
    };
  } catch { return { dailyDate: today, dailyCount: 0, lastChecked: {} }; }
}

function writeExposureHistory(blogId: string, history: ExposureHistory): void {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    const target = exposureHistoryPath(blogId);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(history, null, 2), { mode: 0o600 });
    fs.renameSync(temp, target);
  } catch (e: any) { console.warn(`[검색노출] 검사 기록 저장 실패: ${e.message}`); }
}

async function checkBlogExposure(blogId: string, posts: ExposurePost[], plan: string, log: (msg: string) => void): Promise<ExposureProgress> {
  const normalizedPlan = Object.prototype.hasOwnProperty.call(EXPOSURE_DAILY_LIMIT, plan) ? plan : "free";
  const limit = EXPOSURE_DAILY_LIMIT[normalizedPlan];
  if (!posts.length) return { checks: [], checkedTodayCount: 0, completedCount: 0, limit };
  const unlimited = limit === null;
  const history = unlimited ? { dailyDate: exposureToday(), dailyCount: 0, lastChecked: {} } : readExposureHistory(blogId);
  const remaining = unlimited ? posts.length : Math.max(0, limit - history.dailyCount);
  const selected = unlimited ? posts : [...posts]
    .sort((a, b) => (history.lastChecked[a.logNo] || 0) - (history.lastChecked[b.logNo] || 0))
    .slice(0, remaining);
  if (!unlimited && remaining === 0) log(`[검색노출] 오늘 등급 한도 ${limit}개를 모두 검사했어요`);
  const keys = await getAdminBlogSearchKeys();
  if (!keys) {
    log("[검색노출] 검색 API 키를 읽지 못해 노출 검사를 건너뜁니다");
    return { checks: selected.map(post => ({ ...post, exposed: null, rank: null })), checkedTodayCount: history.dailyCount, completedCount: posts.filter(post => history.lastChecked[post.logNo]).length, limit };
  }
  const checks: BlogExposureCheck[] = [];
  for (const post of selected) {
    const { logNo, title } = post;
    try {
      const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(title)}&display=100&start=1&sort=sim`;
      const response = await fetch(url, { headers: { "X-Naver-Client-Id": keys.clientId, "X-Naver-Client-Secret": keys.clientSecret } });
      if (!response.ok) throw new Error(`검색 API ${response.status}`);
      const json: any = await response.json();
      const items: any[] = Array.isArray(json?.items) ? json.items : [];
      const wanted = blogId.toLowerCase();
      const index = items.findIndex(item => {
        const link = String(item?.link || "").toLowerCase();
        const bloggerLink = String(item?.bloggerlink || "").toLowerCase();
        return link.includes(`blog.naver.com/${wanted}/`) || link.includes(`blog.naver.com/${wanted}?`) || bloggerLink.replace(/\/$/, "").endsWith(`/` + wanted);
      });
      checks.push({ logNo, title, exposed: index >= 0, rank: index >= 0 ? index + 1 : null, postUrl: index >= 0 ? String(items[index]?.link || "") : undefined });
      log(`[검색노출] ${index >= 0 ? `노출 약 ${index + 1}위` : "100위 내 누락"} · ${title.slice(0, 28)}`);
    } catch (e: any) {
      log(`[검색노출] 확인 실패 · ${title.slice(0, 28)} (${e.message})`);
      checks.push({ logNo, title, exposed: null, rank: null });
    } finally {
      if (!unlimited) {
        history.dailyCount += 1;
        history.lastChecked[logNo] = Date.now();
        writeExposureHistory(blogId, history);
      }
    }
  }
  return { checks, checkedTodayCount: unlimited ? checks.length : history.dailyCount, completedCount: unlimited ? posts.length : posts.filter(post => history.lastChecked[post.logNo]).length, limit };
}

export async function crawlBlogStats(params: {
  accountId: string;
  plan?: string;
  onLog?: (msg: string) => void;
}): Promise<BlogStats> {
  const { accountId, plan = "free", onLog } = params;
  const log = onLog || console.log;
  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { blogId, cookies } = loadSession(accountId);
  if (!blogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  let totalPosts = 0, neighbors = 0;
  const recentDates: string[] = [];
  let exposurePosts: ExposurePost[] = [];
  let postListSource: "api" | "rss" | "none" = "none";
  let exposureChecks: BlogExposureCheck[] = [];
  let visitorDays: BlogVisitorDay[] = [];
  let inflowKeywords: { keyword: string; count?: number }[] = [];
  let checkedTodayCount = 0, exposureCompletedCount = 0;
  let exposureLimit: number | null = EXPOSURE_DAILY_LIMIT[Object.prototype.hasOwnProperty.call(EXPOSURE_DAILY_LIMIT, plan) ? plan : "free"];
  try {
    log(`[건강검진] 내 블로그(${blogId}) 지표 수집 중...`);
    // 1) 이웃 수 — 프로필/버디 위젯 Ajax
    try {
      await page.goto(`https://blog.naver.com/BuddyMe.naver?blogId=${blogId}`, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      const body = await page.content();
      const m = body.match(/이웃[^\d]{0,6}([\d,]+)\s*명/) || body.match(/buddyCnt["'\s:]+([\d,]+)/);
      if (m) neighbors = parseInt(m[1].replace(/,/g, ""), 10) || 0;
    } catch {}
    // 2) 총 게시글 수 + 최근 글 날짜 — 글 목록 페이지
    await page.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=1&widgetTypeCall=true`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const frame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
    const ctx: any = frame ?? page;
    const data = await ctx.evaluate((bid: string) => {
      const txt = document.body.innerText || "";
      // "전체보기 (1,234)" 형태에서 총 글 수
      let total = 0;
      const tm = txt.match(/전체\s*보기?\s*\(?\s*([\d,]+)\s*\)?/) || txt.match(/전체글\s*([\d,]+)/);
      if (tm) total = parseInt(tm[1].replace(/,/g, ""), 10) || 0;
      // 최근 글 날짜들
      const dates: string[] = [];
      document.querySelectorAll("[class*='date'],[class*='se_date'],[class*='time']").forEach(el => {
        const t = (el.textContent || "").trim();
        const dm = t.match(/(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
        if (dm && dates.length < 30) dates.push(`${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`);
      });
      const posts: { logNo: string; title: string }[] = [], seenPosts = new Set<string>();
      const links = Array.from(document.querySelectorAll("a[href*='logNo='],a[href*='/PostView'],a[href*='" + bid + "/']"));
      for (const el of links) {
        const href = (el as HTMLAnchorElement).href || "";
        const post = href.match(/logNo=(\d+)/) || href.match(new RegExp(bid + "\\/(\\d{6,})"));
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (post && !seenPosts.has(post[1]) && t.length >= 4 && t.length <= 200) {
          seenPosts.add(post[1]); posts.push({ logNo: post[1], title: t });
        }
      }
      return { total, dates, posts };
    }, blogId).catch(() => ({ total: 0, dates: [], posts: [] }));
    totalPosts = data.total;
    recentDates.push(...data.dates);
    exposurePosts = data.posts;
    // 공식 비동기 글목록 API가 1순위. 실패하면 헬퍼 내부 RSS, 그마저 실패하면 위 HTML 결과를 유지한다.
    try {
      const postList = await fetchNaverPostList({ blogId, cookies, maxCount: null, log });
      postListSource = postList.source;
      if (postList.posts.length) {
        exposurePosts = postList.posts.map(post => ({ logNo: post.logNo, title: post.title }));
        recentDates.splice(0, recentDates.length, ...postList.posts.map(post => post.date).filter(Boolean).slice(0, 30));
        totalPosts = Math.max(totalPosts, postList.totalCount, postList.posts.length);
      }
    } catch (e: any) { log(`[글목록] API/RSS 처리 실패 (${e.message}) · HTML 결과 유지`); }
    log(`[건강검진] 총 글 ${totalPosts}개 · 이웃 ${neighbors}명 · 최근 날짜 ${recentDates.length}개 수집`);

    try {
      // API/RSS가 모두 막힌 경우에만 기존 HTML 페이지 파싱을 최종 폴백으로 사용한다.
      const seenExposure = new Set(exposurePosts.map(post => post.logNo));
      const expectedPages = totalPosts > 0 ? Math.ceil(totalPosts / Math.max(1, exposurePosts.length || 5)) + 2 : 100;
      for (let pg = 2; postListSource === "none" && pg <= expectedPages && (totalPosts <= 0 || exposurePosts.length < totalPosts); pg++) {
        try {
          await page.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=${pg}&widgetTypeCall=true`, { waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(500);
          const listFrame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
          const listCtx: any = listFrame ?? page;
          const pagePosts: ExposurePost[] = await listCtx.evaluate((bid: string) => {
            const out: { logNo: string; title: string }[] = [], seen = new Set<string>();
            const links = Array.from(document.querySelectorAll("a[href*='logNo='],a[href*='/PostView'],a[href*='" + bid + "/']"));
            for (const el of links) {
              const href = (el as HTMLAnchorElement).href || "";
              const match = href.match(/logNo=(\d+)/) || href.match(new RegExp(bid + "\\/(\\d{6,})"));
              const title = (el.textContent || "").replace(/\s+/g, " ").trim();
              if (match && !seen.has(match[1]) && title.length >= 4 && title.length <= 200) { seen.add(match[1]); out.push({ logNo: match[1], title }); }
            }
            return out;
          }, blogId).catch(() => []);
          let added = 0;
          for (const post of pagePosts) if (!seenExposure.has(post.logNo)) { seenExposure.add(post.logNo); exposurePosts.push(post); added++; }
          if (!pagePosts.length || added === 0) break;
        } catch { break; }
      }
      log(`[검색노출] 검사 대상 글 ${exposurePosts.length}개 확보 · ${plan} 등급 검사 시작`);
      const exposure = await checkBlogExposure(blogId, exposurePosts, plan, log);
      exposureChecks = exposure.checks;
      checkedTodayCount = exposure.checkedTodayCount;
      exposureCompletedCount = exposure.completedCount;
      exposureLimit = exposure.limit;
    } catch (e: any) { log(`[검색노출] 검사 실패: ${e.message}`); }

    // 관리자 통계 화면은 수시로 DOM/경로가 바뀌므로 여러 후보를 읽고, 일자-방문자/유입어 패턴만 보수적으로 채택한다.
    try {
      log("[방문자] 관리자 통계에서 최근 7일 방문자와 유입 검색어 수집 중...");
      const statUrls = [
        `https://admin.blog.naver.com/${blogId}/stat/visitor`,
        `https://admin.blog.naver.com/${blogId}/stat/traffic`,
        `https://admin.blog.naver.com/${blogId}/stat/keyword`,
        `https://admin.blog.naver.com/${blogId}`,
      ];
      for (const statUrl of statUrls) {
        try {
          await page.goto(statUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(900);
          const parsed = await page.evaluate(() => {
            const text = (document.body?.innerText || "").replace(/\u00a0/g, " ");
            const days: { date: string; visitors: number }[] = [];
            const seen = new Set<string>();
            const dateNumber = /(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})[^\d]{0,20}([\d,]+)\s*(?:명|회)?/g;
            let m: RegExpExecArray | null;
            while ((m = dateNumber.exec(text)) && days.length < 14) {
              const date = `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
              const visitors = Number(m[4].replace(/,/g, ""));
              if (!seen.has(date) && Number.isFinite(visitors)) { seen.add(date); days.push({ date, visitors }); }
            }
            const keywords: { keyword: string; count?: number }[] = [];
            const keywordRoots = Array.from(document.querySelectorAll("[class*='keyword'],[class*='searchword'],[class*='referer']"));
            for (const root of keywordRoots) {
              for (const row of Array.from(root.querySelectorAll("li,tr"))) {
                const t = (row.textContent || "").replace(/\s+/g, " ").trim();
                const km = t.match(/^(?:\d+[.)]?\s*)?(.{2,50}?)(?:\s+([\d,]+)(?:회|명|건)?)?$/);
                if (km && !keywords.some(k => k.keyword === km[1])) keywords.push({ keyword: km[1], ...(km[2] ? { count: Number(km[2].replace(/,/g,"")) } : {}) });
                if (keywords.length >= 5) break;
              }
              if (keywords.length >= 5) break;
            }
            return { days, keywords };
          });
          if (parsed.days.length > visitorDays.length) visitorDays = parsed.days;
          if (parsed.keywords.length > inflowKeywords.length) inflowKeywords = parsed.keywords;
          if (visitorDays.length >= 7 && inflowKeywords.length >= 3) break;
        } catch {}
      }
      visitorDays = visitorDays.sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
      inflowKeywords = inflowKeywords.slice(0, 5);
      log(`[방문자] 일별 ${visitorDays.length}일 · 유입 검색어 ${inflowKeywords.length}개 수집`);
    } catch (e: any) { log(`[방문자] 통계 확인 실패: ${e.message}`); }
  } finally {
    await browser.close().catch(() => {});
  }
  const knownChecks = exposureChecks.filter(c => c.exposed !== null);
  const missing = knownChecks.filter(c => c.exposed === false).length;
  const lowQualitySuspected = knownChecks.length >= 3 ? missing / knownChecks.length > 0.5 : null;
  let visitorDrop: BlogStats["visitorDrop"] = null;
  if (visitorDays.length >= 2) {
    const prev = visitorDays[visitorDays.length - 2].visitors;
    const curr = visitorDays[visitorDays.length - 1].visitors;
    const rate = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;
    visitorDrop = { detected: rate !== null && rate <= -30, rate, message: rate === null ? "전일 비교 불가" : rate <= -30 ? `전일 대비 ${Math.abs(rate)}% 급감` : `전일 대비 ${rate >= 0 ? "+" : ""}${rate}%` };
  }
  return { blogId, totalPosts, neighbors, recentDates, exposureChecks, lowQualitySuspected, visitorDays, inflowKeywords, visitorDrop, totalPostsForExposure: exposurePosts.length, checkedTodayCount, exposureCompletedCount, exposureLimit };
}

/* ── 답방 ①: 내 블로그 글 목록 불러오기 ──
   세션에 저장된 내 blogId로 최근 글을 수집. selectMode=count(최근 N개)/period(최근 N일)/all(전체). */
export async function crawlMyPosts(params: {
  accountId: string;
  selectMode: "count" | "all" | "period";
  count: number;
  period: number;
  onLog?: (msg: string) => void;
}): Promise<{ url: string; title: string; date: string }[]> {
  const { accountId, selectMode, count, period, onLog } = params;
  const log = onLog || console.log;
  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { blogId, cookies } = loadSession(accountId);
  if (!blogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");

  const limit = selectMode === "count" ? Math.max(1, count) : Number.MAX_SAFE_INTEGER;
  const cutoff = selectMode === "period" ? Date.now() - period * 86400000 : 0;

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  const out: { url: string; title: string; date: string; dateMs: number }[] = [];
  const seen = new Set<string>();
  try {
    log(`[답방] 내 블로그(${blogId}) 글 목록 불러오는 중...`);
    let sharedSource: "api" | "rss" | "none" = "none";
    try {
      const shared = await fetchNaverPostList({ blogId, cookies, maxCount: selectMode === "count" ? limit : null, log });
      sharedSource = shared.source;
      for (const post of shared.posts) {
        if (selectMode === "period" && post.dateMs && post.dateMs < cutoff) continue;
        out.push(post);
      }
    } catch (e: any) { log(`[답방] API/RSS 글목록 처리 실패 (${e.message}) · HTML로 재시도`); }
    for (let pg = 1; sharedSource === "none" && pg <= 15 && out.length < limit; pg++) {
      await page.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=${pg}&widgetTypeCall=true&topReferer=`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const frame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
      const ctx: any = frame ?? page;
      const posts: { logNo: string; title: string; date: string }[] = await ctx.evaluate((bid: string) => {
        const res: { logNo: string; title: string; date: string }[] = [];
        const seenIds = new Set<string>();
        const links = Array.from(document.querySelectorAll("a[href*='logNo='], a[href*='/PostView'], a[href*='" + bid + "/']"));
        for (const a of links) {
          const href = (a as HTMLAnchorElement).href || "";
          const m = href.match(/logNo=(\d+)/) || href.match(new RegExp(bid + "\\/(\\d{6,})"));
          if (!m) continue;
          const logNo = m[1];
          if (seenIds.has(logNo)) continue;
          const title = (a.textContent || "").replace(/\s+/g, " ").trim();
          if (!title || title.length < 2 || title.length > 100) continue;
          seenIds.add(logNo);
          const container = a.closest("li,div[class*='post'],div[class*='item'],div[class*='list']");
          let date = "";
          const dEl = container?.querySelector("[class*='date'],[class*='time'],[class*='se_date']");
          if (dEl) date = (dEl.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12);
          res.push({ logNo, title, date });
        }
        return res;
      }, blogId);
      if (!posts.length) break;
      let added = 0;
      for (const p of posts) {
        if (seen.has(p.logNo)) continue;
        seen.add(p.logNo);
        let dateMs = 0;
        const dm = p.date.match(/(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
        if (dm) dateMs = new Date(`${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`).getTime();
        if (selectMode === "period" && dateMs && dateMs < cutoff) continue;
        out.push({ url: `https://blog.naver.com/${blogId}/${p.logNo}`, title: p.title, date: p.date, dateMs });
        added++;
        if (out.length >= limit) break;
      }
      if (added === 0 && pg > 1) break; // 더 없음
    }
    log(`[답방] 글 ${out.length}개 수집 완료`);
  } finally {
    await browser.close().catch(() => {});
  }
  const sliced = selectMode === "count" ? out.slice(0, count) : out;
  return sliced.map(p => ({ url: p.url, title: p.title, date: p.date }));
}

/* ── 답방 ②: 내 글 댓글에 대댓글(답글) 달기 ──
   posts: 내 글 URL 배열. 각 글의 댓글을 훑어 (onlyNew면 아직 답글 없는 것만) 답글 작성.
   mode=ai면 댓글 내용을 읽고 Gemini로 답글 생성, fixed면 고정 문구. */
export async function replyToComments(params: {
  accountId: string;
  posts: string[];
  mode: "ai" | "fixed";
  comment: string;
  tone: string;
  onlyNew: boolean;
  delayMin: number;
  delayMax: number;
  geminiKey?: string;
  onLog?: (msg: string) => void;
  onResult?: (r: { blogId?: string; postTitle?: string; status: "success" | "skip" | "fail"; message?: string }) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const { accountId, posts, mode, comment, tone, onlyNew, delayMin, delayMax, geminiKey = "", onLog, onResult, onProgress, stopSignal } = params;
  const log = onLog || console.log;
  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { cookies } = loadSession(accountId);

  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  let done = 0, fail = 0;

  try {
    for (const postUrl of posts) {
      if (stopSignal?.()) { log("[답방] 중단 신호 수신"); break; }
      try {
        log(`[답방] 글 진입: ${postUrl}`);
        await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(1800);
        const frame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
        const ctx: any = frame ?? page;
        const scrollInto = async (el: any) => { try { await el.evaluate((n: Element) => { const s = document.scrollingElement || document.documentElement; const r = n.getBoundingClientRect(); s.scrollTop = Math.max(0, s.scrollTop + r.top - window.innerHeight * 0.4); }); await page.waitForTimeout(300); } catch {} };

        // 댓글 위젯 로드
        for (let s = 0; s < 4; s++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(400); }
        for (const os of ["a.btn_comment._cmtList", "a._cmtList", "a.btn_comment", "a._floating_bottom_btn_comment"]) {
          const ob = await ctx.$(os); if (ob) { await scrollInto(ob); await ob.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1500); break; }
        }
        await ctx.waitForSelector(".u_cbox_comment, li.u_cbox_comment, .u_cbox_list", { timeout: 6000 }).catch(() => {});

        // 이 글의 댓글 목록 파악 (작성자·내용·이미 답글있는지)
        const commentInfos: { idx: number; author: string; text: string; hasReply: boolean }[] = await ctx.evaluate(() => {
          const items = Array.from(document.querySelectorAll("li.u_cbox_comment, .u_cbox_comment"));
          const res: { idx: number; author: string; text: string; hasReply: boolean }[] = [];
          items.forEach((li, i) => {
            // 답글(대댓글)은 보통 u_cbox_reply_area 안 → 원댓글만 대상
            if (li.closest(".u_cbox_reply_area")) return;
            const author = (li.querySelector(".u_cbox_nick")?.textContent || "").trim();
            const text = (li.querySelector(".u_cbox_contents")?.textContent || "").trim();
            const hasReply = !!li.querySelector(".u_cbox_reply_area .u_cbox_comment, .u_cbox_reply_cnt");
            if (text) res.push({ idx: i, author, text, hasReply });
          });
          return res;
        }).catch(() => []);

        if (!commentInfos.length) { log(`[답방] 댓글 없음, 스킵`); await onResult?.({ postTitle: postUrl, status: "skip", message: "댓글 없음" }); onProgress?.(done, fail); continue; }

        const targets = onlyNew ? commentInfos.filter(c => !c.hasReply) : commentInfos;
        log(`[답방] 댓글 ${commentInfos.length}개 중 답방 대상 ${targets.length}개`);

        for (const c of targets) {
          if (stopSignal?.()) break;
          // 답글 문구 결정
          let replyText = comment;
          if (mode === "ai") {
            replyText = await generateAiReply(geminiKey, tone, c.text, log);
            if (!replyText) { log(`[답방] AI 답글 생성 실패 — 이 댓글 스킵`); continue; }
          }
          // 해당 댓글의 '답글' 버튼 클릭 → 입력창 → 등록
          const ok = await ctx.evaluate((args: { idx: number }) => {
            const items = Array.from(document.querySelectorAll("li.u_cbox_comment, .u_cbox_comment")).filter(li => !li.closest(".u_cbox_reply_area"));
            const li = items[args.idx] as HTMLElement | undefined;
            if (!li) return false;
            const replyBtn = li.querySelector(".u_cbox_btn_reply, a[class*='reply']") as HTMLElement | null;
            if (replyBtn) { replyBtn.click(); return true; }
            return false;
          }, { idx: c.idx }).catch(() => false);
          if (!ok) { log(`[답방] 답글 버튼 못찾음 — 스킵`); continue; }
          await page.waitForTimeout(1000);

          // 펼쳐진 답글 입력창(u_cbox_reply_wrap 안 textarea)에 입력
          const wrote = await ctx.evaluate((txt: string) => {
            const areas = Array.from(document.querySelectorAll(".u_cbox_reply_wrap textarea, .u_cbox_write_area textarea, textarea.u_cbox_text"));
            const ta = areas[areas.length - 1] as HTMLTextAreaElement | undefined;
            if (!ta) return false;
            ta.focus(); ta.value = txt;
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            ta.dispatchEvent(new Event("keyup", { bubbles: true }));
            return true;
          }, replyText).catch(() => false);
          if (!wrote) { log(`[답방] 답글 입력창 못찾음 — 스킵`); continue; }
          await page.waitForTimeout(700);

          // 등록 버튼
          const submitted = await ctx.evaluate(() => {
            const btns = Array.from(document.querySelectorAll(".u_cbox_reply_wrap .u_cbox_btn_upload, .u_cbox_btn_upload, button.u_cbox_btn_upload"));
            const btn = btns[btns.length - 1] as HTMLElement | undefined;
            if (btn) { btn.click(); return true; }
            return false;
          }).catch(() => false);
          await page.waitForTimeout(1500);

          if (submitted) { done++; log(`[답방] ✅ ${c.author}님 댓글에 답글: "${replyText}"`); await onResult?.({ postTitle: c.author, status: "success", message: replyText.slice(0, 30) }); }
          else { fail++; log(`[답방] ❌ 등록 버튼 못찾음`); await onResult?.({ postTitle: c.author, status: "fail", message: "등록 실패" }); }
          onProgress?.(done, fail);
          await page.waitForTimeout(humanDelay(delayMin, delayMax));
        }
      } catch (e: any) {
        fail++; log(`[답방] 글 처리 오류: ${e.message}`); onProgress?.(done, fail);
      }
    }
    log(`[답방] 완료 — 답글 ${done}개 / 실패 ${fail}개`);
  } finally {
    await browser.close().catch(() => {});
  }
}
async function generateAiReply(key: string, tone: string, commentText: string, log: (m: string) => void): Promise<string> {
  if (!key) { log("[답방] Gemini 키 없음 — AI 답글 건너뜀"); return ""; }
  const toneGuide = tone === "담백" ? "깔끔하고 담백한" : tone === "짧게" ? "짧고 간결한" : "다정하고 따뜻한";
  const prompt = `너는 네이버 블로그 주인이야. 내 글에 아래 댓글이 달렸어. 이 댓글에 ${toneGuide} 말투로 고마움을 담은 자연스러운 한국어 답글을 딱 1개만 써줘.\n규칙: 1문장, 35자 이내, 댓글 내용에 구체적으로 반응, 이모지 1개 정도, 광고·링크 금지, 따옴표 없이 답글만 출력.\n\n[받은 댓글]\n${commentText}`;
  for (const model of ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 150, temperature: 1.0 } }),
      });
      const d: any = await r.json();
      if (!r.ok) { if (r.status === 404) continue; return ""; }
      const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (txt) return txt.replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0].slice(0, 100);
    } catch {}
  }
  return "";
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
  commentRate?: number;   // 댓글 확률 % (0~100, 기본 100). 도배 감지 회피용
  likeRate?: number;      // 공감 확률 % (0~100, 기본 100)
  aiComment?: boolean;    // ★AI 자동 댓글: 글 내용을 읽고 Gemini로 매번 다른 댓글 생성
  commentTone?: string;   // AI 댓글 말투(담백/다정/짧게)
  geminiKey?: string;     // 사용자 Gemini API 키
  onLog?: (msg: string) => void;
  onResult?: (r: EngageResult) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const {
    accountId, targets, comment, doLike, doComment,
    periodDays, postsPerBlog, delayMin, delayMax,
    dailyLimit, skipDone, commentRate = 100, likeRate = 100,
    aiComment = false, commentTone = "다정", geminiKey = "", onLog, onResult, onProgress, stopSignal,
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
  const doneMap = loadDoneMap(engageDonePath);   // { blogId: "YYYY-MM-DD" | "legacy" }
  const today = todayKST();

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

      const doneToday = doneMap[blogId] === today;               // 오늘 이미 처리 → 항상 스킵(당일 중복방지)
      const donePerm = skipDone && (blogId in doneMap);          // 완료 스킵 ON → 과거 처리분도 스킵
      if (doneToday || donePerm) {
        await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: doneToday ? "오늘 이미 처리됨(당일 중복방지)" : "이미 처리됨" });
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

        // 확률 게이트: 이 글에 공감/댓글을 실제로 할지 매번 주사위 (도배 감지 회피)
        const rollLike = doLike && (likeRate >= 100 || Math.random() * 100 < likeRate);
        let rollComment = doComment && (commentRate >= 100 || Math.random() * 100 < commentRate);
        // ★AI 자동 댓글: 이 글 내용을 읽고 Gemini로 생성 → comments에 반영(실패 시 이 글 댓글만 건너뜀)
        if (rollComment && aiComment) {
          const postText = await extractPostText(ctx);
          const gen = await generateAiComment(geminiKey, commentTone, postText, log);
          if (gen) { comments.length = 0; comments.push(gen); commentIdx = 0; log(`[AI댓글] ${blogId}: "${gen}"`); }
          else { rollComment = false; }
        } else if (rollComment && comments.length === 0) {
          rollComment = false;
        }
        if (doLike && !rollLike) log(`[공감·댓글] ${blogId} 공감 건너뜀(확률 ${likeRate}%)`);
        if (doComment && !aiComment && comment.trim() && !rollComment) log(`[공감·댓글] ${blogId} 댓글 건너뜀(확률 ${commentRate}%)`);

        // ── 공감 클릭 ──
        //  실측(2026-08): 네이버 공감버튼 = a.u_likeit_list_button (텍스트 "공감"), 이미 눌렀으면 class에 'on'
        if (rollLike) {
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
        if (rollComment) {
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
          doneMap[blogId] = today;
          fs.writeFileSync(engageDonePath, JSON.stringify(doneMap, null, 2));
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
