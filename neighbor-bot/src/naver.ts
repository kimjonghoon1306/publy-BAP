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

// ★AI 한도 소진 시 자동 전환용 순환 댓글 풀(다양한 시작·자연스러운 표현, "와~" 편중 없음).
//   Gemini 무료 한도(하루 제한)를 넘겨도 댓글이 끊기지 않도록 이 중에서 랜덤으로 단다.
const FALLBACK_COMMENTS = [
  "좋은 정보 얻어가요, 잘 보고 갑니다!",
  "정성스러운 글이네요, 잘 읽었어요.",
  "오늘도 유익한 글 감사합니다.",
  "덕분에 많이 배우고 가요, 감사해요.",
  "글이 깔끔해서 읽기 편했어요!",
  "필요했던 내용인데 도움 많이 됐어요.",
  "꼼꼼하게 정리해주셔서 감사합니다.",
  "잘 보고 갑니다, 다음 글도 기대할게요!",
  "공감하며 읽었어요, 좋은 하루 보내세요.",
  "사진이랑 설명이 딱 좋네요, 잘 봤어요.",
  "유용한 팁 감사해요, 참고할게요!",
  "정보 감사합니다, 자주 들를게요.",
];
function pickFallbackComment(): string {
  return FALLBACK_COMMENTS[Math.floor(Math.random() * FALLBACK_COMMENTS.length)];
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
  // 한글 2글자+ 단어 빈도 (조사·인삿말·불용어·활용형 제거 → 실제 '주제 명사'만 남김)
  const STOP = new Set([
    // 인삿말·기본 불용어
    "안녕하세요","있는","합니다","입니다","그리고","하는","이번","오늘","저는","제가","너무","정말","진짜","우리","그것","이것","해서","에서","으로","까지","부터","했습니다","같은","위해","통해","대한","관련","경우","때문","많이","다시","바로","여기","거기","하지만","그런","이런","저런","하고","했어요","합니다만","입니다만","보고","보다","되는","되어","있어요","없이도","없는","위한","때는","면서",
    // 부사·정도어
    "요즘","오늘은","지금","이제","아주","매우","제일","가장","자주","계속","먼저","이렇게","그렇게","저렇게","크게","작게","조금","함께","특히","역시","물론","그냥","점점","훨씬","완전","엄청","살짝","드디어","이미","아직","항상","가끔","보통","대부분","무려","각종","다양","여러",
    // 흔한 동사·형용사 활용(주제 아님)
    "보면","하면","되면","있다","없다","한다","된다","같다","보는","하기","되기","위해서","대해","라는","이라는","싶은","싶어","좋은","좋아","많은","적은","해요","돼요","네요","거예요","거에요","나눠서","갈래로","다녀","다녀왔","봤어요","였어요","이었",
    // 주제성 낮은 흔한 명사
    "추천","후기","이유","방법","경우","사람","생각","시간","하루","정도","이번주","다음","부분","모습","느낌","마음","사실","여러분","블로그","포스팅","글쓰기","시작","마지막","전체","기본","정보","내용","이야기","얘기","자신","본인","우리집","여기저기","최근","오늘","내일","어제","요새","최고","완전","진행","사용","경험","선택","고민","준비","확인","소개",
  ]);
  // 활용형 어미로 끝나는 단어(동사·형용사·부사) 제거: ~습니다/~해서/~하면/~네요/~게 등
  const CONJ = /(습니다|었습니다|였습니다|해요|아요|어요|에요|예요|이에요|이예요|네요|더라|겠다|었다|였다|린다|긴다|한다|된다|간다|온다|왔다|갔다|봤다|해서|아서|어서|하고|하며|하니|하는|되는|있는|없는|같은|으면|하면|되면|려고|면서|어도|아도|처럼|만큼|보다|라고|다고|든지|거나|지만|는데|은데|으로|에서|까지|부터|에게|한테)$/;
  const freq: Record<string, number> = {};
  const joined = texts.join(" ");
  for (const w of joined.match(/[가-힣]{2,}/g) || []) {
    if (STOP.has(w)) continue;
    if (CONJ.test(w)) continue;                 // 활용형 어미로 끝나면 제외(동사·형용사·부사)
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

/* ── 글 제목 수정(기존 글 편집·재발행) ──
   실측(2026-08-23): 수정 URL = PostWriteForm.naver?blogId=&logNo=&Redirect=Update (자기 글만).
   스마트에디터라 발행과 동일: 제목칸 .se-section-documentTitle 교체 → publish_btn → confirm_btn 재발행. */
export async function updatePostTitle(params: {
  accountId: string; logNo: string; newTitle: string; onLog?: (m: string) => void;
}): Promise<{ ok: boolean; message: string }> {
  const { accountId, logNo, newTitle, onLog } = params;
  const log = onLog || console.log;
  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { blogId, cookies } = loadSession(accountId);
  if (!blogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");
  if (!/^\d+$/.test(String(logNo))) throw new Error("글 번호(logNo)가 올바르지 않아요");
  if (!newTitle || !newTitle.trim()) throw new Error("새 제목이 비어 있어요");
  const title = newTitle.trim().slice(0, 100);

  const browser = await chromium.launch({ headless: false, args: [...LAUNCH_ARGS, "--start-maximized"] });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});
  try {
    const editUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}&logNo=${logNo}&Redirect=Update`;
    log(`[제목수정] ① 수정 페이지 여는 중... (${blogId}/${logNo})`);
    await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    log(`[제목수정] 페이지 도착: ${page.url().slice(0, 60)}`);
    // 자기 글이 아니거나 세션 만료면 홈으로 튕김 → 감지
    if (/section\.blog\.naver\.com|BlogHome/.test(page.url())) {
      throw new Error("수정 페이지를 열 수 없어요(내 글이 아니거나 로그인이 풀렸어요). 계정을 다시 연결해주세요.");
    }
    log(`[제목수정] ② 에디터 프레임 찾는 중...`);
    let frame = page.frames().find(f => f.name() === "mainFrame") ?? page.frames().find(f => f.url().includes("blog.naver.com")) ?? null;
    for (let i = 0; i < 12 && !frame; i++) { await page.waitForTimeout(700); frame = page.frames().find(f => f.name() === "mainFrame") ?? null; }
    if (!frame) throw new Error("에디터 프레임을 찾지 못했어요");
    // 에디터 로드 대기
    log(`[제목수정] ③ 에디터 로딩 대기 중...`);
    const edLoaded = await frame.waitForSelector(".se-section-documentTitle, .se-editor, .se-container", { timeout: 40000 }).then(() => true).catch(() => false);
    log(`[제목수정] 에디터 ${edLoaded ? "로드됨" : "로드 확인 실패(계속 시도)"}`);
    await page.waitForTimeout(2000);
    // '작성 중 글 이어쓰기'·도움말 등 팝업/레이어 닫기(있으면)
    let popupClosed = false;
    for (const cancelSel of ["button:has-text('취소')", "button:has-text('아니오')", "button:has-text('닫기')", "button[class*='cancel']", "button[class*='close']", ".se-help-panel-close-button", "button[class*='_close']"]) {
      try { const c = await frame.$(cancelSel); if (c) { await c.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(600); popupClosed = true; } } catch {}
    }
    if (popupClosed) log(`[제목수정] 방해 팝업/패널 닫음`);

    // 현재(원래) 제목 읽어서 로그
    const before = await frame.evaluate(() => (document.querySelector(".se-section-documentTitle")?.textContent || "").trim().slice(0, 40)).catch(() => "");
    log(`[제목수정] ④ 현재 제목: "${before}" → 바꿀 제목: "${title}"`);

    // ── 제목 교체 (발행 코드와 동일 셀렉터) ──
    const titleSels = [
      ".se-section-documentTitle .se-text-paragraph span[contenteditable='true']",
      ".se-section-documentTitle [contenteditable='true']",
      ".se-section-documentTitle .se-text-paragraph",
    ];
    let replaced = false;
    for (const sel of titleSels) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await frame.click(sel, { timeout: 5000 });
          await page.waitForTimeout(400);
          await frame.evaluate(t => { document.execCommand("selectAll", false); document.execCommand("insertText", false, t as string); }, title);
          await page.waitForTimeout(600);
          const cur = await frame.evaluate(s => (document.querySelector(s as string)?.textContent || "").trim(), sel).catch(() => "");
          if (cur.includes(title.slice(0, 8))) { replaced = true; break; }
        }
      } catch {}
    }
    if (!replaced) {
      log(`[제목수정] 기본 셀렉터 실패 → 키보드 입력으로 재시도`);
      try { await frame.click(".se-section-documentTitle", { timeout: 5000 }); await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.type(title, { delay: 35 }); replaced = true; } catch {}
    }
    if (!replaced) throw new Error("제목 입력칸을 찾지 못했어요(에디터 구조 변경 가능)");
    log(`[제목수정] ⑤ 새 제목 입력 완료: "${title}"`);

    // ── 발행(재발행) ──
    await page.waitForTimeout(500);
    log(`[제목수정] ⑥ 발행 버튼 누르는 중...`);
    let panelOpened = false;
    for (const sel of ["button.publish_btn__m9KHH", "button[class*='publish_btn']", "button:has-text('발행')"]) {
      try { const el = await frame.$(sel); if (el) { await frame.click(sel, { timeout: 6000 }); panelOpened = true; break; } } catch {}
    }
    if (!panelOpened) throw new Error("발행 버튼을 찾지 못했어요");
    log(`[제목수정] 발행 패널 열림, 최종 확인 누르는 중...`);
    await page.waitForTimeout(2000);
    // 발행 패널의 최종 확인 버튼
    let finalDone = false;
    for (const sel of ["button.confirm_btn__xiHQQ", "button[class*='confirm_btn']", "button:has-text('발행')"]) {
      try { const el = await frame.$(sel); if (el) { await frame.click(sel, { timeout: 8000 }); finalDone = true; break; } } catch {}
    }
    if (!finalDone) {
      const btns = await frame.$$("button");
      for (const btn of btns.reverse()) { const t = await btn.textContent(); if (t && t.includes("발행")) { await btn.click().catch(() => {}); finalDone = true; break; } }
    }
    await page.waitForTimeout(4000);
    // 세션 쿠키 갱신
    try { const nc = await context.cookies(); const s = loadSession(accountId); s.cookies = nc; writeSession(sessionName(accountId), s); } catch {}
    if (!finalDone) throw new Error("발행 확인 버튼을 누르지 못했어요");
    log(`[제목수정] ✅ ${blogId}/${logNo} 제목 변경 완료`);
    return { ok: true, message: `제목을 "${title}"로 변경했어요` };
  } catch (e: any) {
    log(`[제목수정] ❌ 실패: ${e.message}`);
    return { ok: false, message: e.message };
  } finally {
    await browser.close().catch(() => {});
  }
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
  minVisitors?: number;      // ★대상 블로그 최근 방문자 하한(0=제한없음) — 범위 밖이면 스킵
  maxVisitors?: number;      // ★대상 블로그 최근 방문자 상한(0=제한없음)
  searchEntry?: boolean;     // ★검색 경유 진입(검색 유입): 블로그 방문을 검색→클릭으로. 못 찾으면 URL 폴백
  onLog?: (msg: string) => void;
  onResult?: (r: NeighborResult) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const { accountId, targets, message, delayMin, delayMax, dailyLimit, skipDone, qualityFilter = true, retryDays = 30, minVisitors = 0, maxVisitors = 0, searchEntry = false, onLog, onResult, onProgress, stopSignal } = params;
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
  const browser = await chromium.launch({ headless: false, args: [...LAUNCH_ARGS, "--start-maximized"] });
  const context = await browser.newContext({
    userAgent: MOBILE_UA, viewport: { width: 390, height: 844 }, locale: "ko-KR", isMobile: true, hasTouch: true,
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});   // ★크롬 창을 화면 앞으로

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

        // ★방문자 수 필터: 최근 방문자가 범위 밖이면 신청하지 않고 스킵(공개 API, 세션 불필요). 못 읽으면 통과.
        if (minVisitors > 0 || maxVisitors > 0) {
          const v = await fetchRecentVisitors(blogId);
          if (v >= 0 && ((minVisitors > 0 && v < minVisitors) || (maxVisitors > 0 && v > maxVisitors))) {
            const msg = `방문자 ${v}명 (범위 ${minVisitors || 0}~${maxVisitors || "∞"} 밖) — 스킵`;
            log(`[서이추] ⏭ ${blogId} ${msg}`);
            await onResult?.({ keyword, blogId, status: "skip", message: msg });
            onProgress?.(done, fail);
            await page.waitForTimeout(humanDelay(1, 2));
            continue;
          }
        }

        // ── 서이추 전 블로그 먼저 방문 (읽는 척) ──
        log(`[서이추] 👀 ${blogId} 블로그 방문 중...`);
        // ★검색 경유 진입(켜진 경우): 그 키워드로 검색해 이 블로그 글을 찾아 클릭(검색 유입). 못 찾으면 URL 직행.
        let nbEntered = false;
        if (searchEntry) nbEntered = await enterViaSearch(page, keyword, blogId, null, log);
        if (!nbEntered) {
          await page.goto(`https://blog.naver.com/${blogId}`, { waitUntil: "domcontentloaded", timeout: 20000 });
        }
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
// ── 체류시간 엔진: 글 분량(글자·이미지 수)을 읽어 실제 독서처럼 스크롤·머무름 ──
//   짧은 글은 빨리, 긴 글은 오래(단 상한 있음). 즉시 이탈 패턴을 줄여 체류시간을 자연스럽게 높인다.
// ★체류 속도 모드: 글 많은 블로그를 자주 돌릴 때 시간을 줄일 수 있게 3단계.
//   fast=빠르게(최대 10초)·normal=보통(최대 22초)·natural=자연스럽게(최대 40초, 기본). 딜레이로 안전은 별도 유지.
type ReadSpeed = "fast" | "normal" | "natural";
async function readPostNaturally(page: any, ctx: any, log?: (m: string) => void, speed: ReadSpeed = "natural"): Promise<void> {
  let chars = 0, imgs = 0;
  try {
    const info = await ctx.evaluate(() => {
      const body = (document.querySelector(".se-main-container") as HTMLElement) || (document.querySelector("#postViewArea") as HTMLElement) || document.body;
      const text = (body?.innerText || "").replace(/\s+/g, "").length;
      const images = body?.querySelectorAll("img").length || 0;
      return { text, images };
    });
    chars = info.text || 0; imgs = info.images || 0;
  } catch {}
  // 목표 체류시간(초): 글자 500자당 약 2.5초 + 이미지 1장당 1.2초. 속도 모드에 따라 배율·상한·하한을 다르게.
  const mul = speed === "fast" ? 0.25 : speed === "normal" ? 0.55 : 1;
  const cap = speed === "fast" ? 10 : speed === "normal" ? 22 : 40;
  const floor = speed === "fast" ? 2 : speed === "normal" ? 3 : 4;
  const target = Math.min(cap, Math.max(floor, ((chars / 500) * 2.5 + imgs * 1.2) * mul));
  const scrolls = Math.min(14, Math.max(2, Math.round(target / 2.2)));   // 체류시간에 비례한 스크롤 횟수
  log?.(`[체류] 글 약 ${chars}자·이미지 ${imgs}장 → ${Math.round(target)}초 정독(스크롤 ${scrolls}회, ${speed === "fast" ? "빠르게" : speed === "normal" ? "보통" : "자연스럽게"})`);
  const per = (target * 1000) / scrolls;
  for (let s = 0; s < scrolls; s++) {
    await page.mouse.wheel(0, 140 + Math.random() * 260);
    await page.waitForTimeout(per * (0.7 + Math.random() * 0.6));       // 스크롤 간 텀 편차
    if (Math.random() < 0.18) { await page.mouse.wheel(0, -(180 + Math.random() * 260)); await page.waitForTimeout(per * 0.5); } // 가끔 위로(다시 읽는 척)
  }
}
// ★한도 초과 여부를 밖으로 알리기 위한 플래그(모델 로직은 그대로, 반환만 유지). true면 순환 댓글로 자동 전환.
let __aiQuotaExhausted = false;
async function generateAiComment(key: string, tone: string, postText: string, log: (m: string) => void): Promise<string> {
  __aiQuotaExhausted = false;
  if (!key) { log("[AI댓글] ⚠️ Gemini 키가 없어 건너뜁니다 (설정 → 글쓰기 AI에서 Gemini 키 입력)"); return ""; }
  if (!postText || postText.length < 10) { log("[AI댓글] 글 내용을 못 읽어 건너뜀"); return ""; }
  const toneGuide = tone === "담백" ? "깔끔하고 담백한" : tone === "짧게" ? "짧고 간결한" : "다정하고 따뜻한";
  // ★시작 표현 다양화: 매번 "와~"로 시작해 다 비슷해지는 문제 방지. 랜덤 힌트로 첫 단어를 흩뿌린다.
  const starters = ["글 내용에 바로 반응하며", "질문을 던지듯", "공감하는 어투로", "가볍게 감탄하며", "정보에 고마움을 표하며", "담담하게 한마디로", "본문의 한 부분을 콕 집어", "내 경험을 살짝 곁들여"];
  const starterHint = starters[Math.floor(Math.random() * starters.length)];
  const prompt = `너는 네이버 블로그 이웃이야. 아래 블로그 글을 읽고 ${toneGuide} 말투의 자연스러운 한국어 공감 댓글을 딱 1개만 써줘.\n규칙: 1~2문장, 45자 이내, 글 내용에 구체적으로 반응, 이모지 1개 정도만, 광고·링크·해시태그 금지, 따옴표 없이 댓글 문장만 출력.\n★중요(시작 표현 다양화): 이번 댓글은 "${starterHint}" 시작해줘. "와", "우와", "와아" 같은 감탄사로 시작하지 마. 매번 다른 첫 단어로 시작해서 다른 댓글들과 겹치지 않게 해.\n\n[블로그 글]\n${postText}`;
  const models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
  for (const model of models) {
    try {
      // ★2.5계열은 thinking 토큰을 먼저 소비 → maxOutputTokens가 작으면 실제 댓글이 잘려나옴.
      //   그래서 thinking 끄고(thinkingBudget 0), 토큰도 넉넉히(800) 준다.
      const generationConfig: any = { maxOutputTokens: 800, temperature: 1.0 };
      if (model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      });
      const d: any = await r.json();
      // ★한도 초과(429 또는 quota 메시지) 감지 — 모델 로직은 건드리지 않고 플래그만 세운다.
      if (r.status === 429 || /quota|exceeded|rate.?limit/i.test(d?.error?.message || "")) __aiQuotaExhausted = true;
      if (!r.ok) { if (r.status === 404 || r.status === 400) continue; log(`[AI댓글] 생성 실패(${model}): ${d?.error?.message || r.status}`); return ""; }
      const cand = d?.candidates?.[0];
      const raw = cand?.content?.parts?.[0]?.text?.trim();
      const finish = cand?.finishReason;
      // ★응답이 토큰 상한에 걸려 잘렸거나(MAX_TOKENS) 비어있으면 → 잘린 댓글을 등록하지 말고 다음 모델 재시도
      if (!raw) { log(`[AI댓글] ${model} 빈 응답(${finish || "?"}) → 다음 모델 시도`); continue; }
      if (finish === "MAX_TOKENS") { log(`[AI댓글] ${model} 응답이 잘림(MAX_TOKENS) → 다음 모델 시도`); continue; }
      // 줄바꿈은 첫 줄만 자르지 말고 공백으로 합쳐 전체 문장을 살린다.
      const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 120);
      if (cleaned.length < 4) { log(`[AI댓글] ${model} 응답이 너무 짧음("${cleaned}") → 다음 모델 시도`); continue; }
      return cleaned;
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

/* ── 블로그 방문자 수 조회 (공개 위젯 API, 세션 불필요) ──
   NVisitorgp4Ajax는 최근 5일 정도의 일별 방문자를 XML로 준다. 오늘은 진행 중이라 최근 며칠의 최댓값을 대표값으로 쓴다.
   못 읽으면 -1 반환(필터에서 '통과'로 처리 → 조회 실패로 억울하게 스킵되지 않게). */
async function fetchRecentVisitors(blogId: string): Promise<number> {
  try {
    const r = await fetch(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${encodeURIComponent(blogId)}`, {
      headers: { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}` },
    });
    if (!r.ok) return -1;
    const t = await r.text();
    const nums = [...t.matchAll(/cnt="(\d+)"/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n));
    if (!nums.length) return -1;
    return Math.max(...nums);   // 최근 며칠 중 최대(대표 방문자 규모)
  } catch { return -1; }
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
  } catch (e: any) { log(`[글목록] PostTitleListAsync 실패 (${e.message}) · 모바일 API로 재시도`); }

  // ★모바일 블로그 API 폴백 (실측 2026-08-23): PostTitleListAsync가 막힌 블로그(에러 페이지)도
  //   m.blog.naver.com/api 는 JSON으로 전체 글(logNo·제목·작성일 epoch)을 안정적으로 준다. RSS(최근 몇 개)보다 정확.
  if (posts.length === 0) {
    try {
      const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
      for (let pageNo = 1; pageNo <= 1000 && (maxCount === null || posts.length < maxCount); pageNo++) {
        const u = `https://m.blog.naver.com/api/blogs/${encodeURIComponent(blogId)}/post-list?categoryNo=0&itemCount=30&page=${pageNo}`;
        const resp = await fetch(u, { headers: { "User-Agent": MUA, Referer: `https://m.blog.naver.com/${blogId}` } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const jt = (await resp.text()).replace(/^\)\]\}',?\s*/, "");
        const j: any = JSON.parse(jt);
        const items: any[] = j?.result?.items || [];
        const tc = Number(j?.result?.totalCount ?? 0);
        if (Number.isFinite(tc) && tc > totalCount) totalCount = tc;
        if (!items.length) break;
        let added = 0;
        for (const it of items) {
          const logNo = String(it?.logNo ?? "").trim();
          const title = decodeNaverText(it?.titleWithInspectMessage ?? it?.title);
          if (!/^\d+$/.test(logNo) || !title || seen.has(logNo)) continue;
          const ms = Number(it?.addDate) || 0;
          seen.add(logNo); added++;
          posts.push({ logNo, title, date: ms > 0 ? koreanDate(new Date(ms)) : "", dateMs: ms > 0 ? ms : 0, url: `https://blog.naver.com/${blogId}/${logNo}` });
          if (maxCount !== null && posts.length >= maxCount) break;
        }
        if (!added || items.length < 30) break;
      }
      if (posts.length) {
        log(`[글목록] 모바일 API에서 ${posts.length}개 수집`);
        return { posts, source: "api", totalCount: Math.max(totalCount, posts.length) };
      }
    } catch (e: any) { log(`[글목록] 모바일 API 실패 (${e.message}) · RSS로 재시도`); }
  }

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
  // ★발행 활성도(상위노출 핵심): 최근 발행 간격으로 활성/보통/비활성 판정
  activity: { level: "active" | "normal" | "inactive"; daysSinceLast: number | null; postsIn7d: number; postsIn30d: number; message: string } | null;
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

/* ── 검색 경유 진입: 네이버 통합검색(블로그탭)에서 대상 글/블로그를 찾아 클릭해 들어간다 ──
   URL 직행 대신 검색을 거쳐 방문하면 상대 블로그에 "검색 유입"으로 잡혀 자연스럽고 지수(홈판)에 유리.
   찾아서 클릭 진입하면 true, 검색 결과에 없으면 false(호출부에서 URL로 폴백). keyword로 검색.
   targetLogNo가 있으면 그 글을, 없으면 그 블로그의 아무 글이나 클릭. */
async function enterViaSearch(page: any, keyword: string, blogId: string, targetLogNo: string | null, log: (m: string) => void): Promise<boolean> {
  if (!keyword || !keyword.trim()) return false;
  const wanted = blogId.toLowerCase();
  try {
    await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(keyword.trim())}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1000);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(500); }
    // 대상 블로그(+글) 링크를 찾는다
    const sel = await page.evaluate((args: { wanted: string; logNo: string | null }) => {
      const as = Array.from(document.querySelectorAll('a[href*="blog.naver.com"]')) as HTMLAnchorElement[];
      for (let i = 0; i < as.length; i++) {
        const h = as[i].href || "";
        const m = h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d{6,})/) || h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)[?].*logNo=(\d{6,})/);
        if (!m) continue;
        if (m[1].toLowerCase() !== args.wanted) continue;
        if (args.logNo && m[2] !== args.logNo) continue;
        as[i].setAttribute("data-publy-hit", "1");   // 클릭 대상 표시
        return true;
      }
      return false;
    }, { wanted, logNo: targetLogNo });
    if (!sel) return false;
    const el = await page.$('a[data-publy-hit="1"]');
    if (!el) return false;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400 + Math.random() * 600);   // 사람처럼 잠깐
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}),
      el.click({ timeout: 5000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(800);
    log(`[검색유입] 🔎 "${keyword}" 검색 결과에서 ${blogId} 클릭 진입`);
    return true;
  } catch (e: any) {
    log(`[검색유입] 검색 경유 실패(${(e.message || "").slice(0, 25)}) — 링크로 진입`);
    return false;
  }
}

/* ── 제목에서 검색용 핵심 키워드 뽑기 ──
   제목 전체로 검색하면 실제 노출 순위와 안 맞는다(네이버가 여러 단어 조합으로 처리).
   장식·조사·흔한 단어를 걷어내고 의미 있는 명사 위주로 6단어 이내로 줄인다. */
function extractSearchQuery(title: string): string {
  const cleaned = title.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const drop = new Set(["그리고","하는","한","및","의","가","이","은","는","을","를","에","에서","으로","와","과","도","만","best","BEST","top","TOP","추천","후기","방법","정리","총정리","완벽","꿀팁","리뷰"]);
  const words = cleaned.split(" ").filter(w => w.length >= 2 && !drop.has(w));
  const q = (words.length ? words : cleaned.split(" ")).slice(0, 6).join(" ").trim();
  return q.slice(0, 80) || title.slice(0, 80);
}

/* ── 실제 통합검색(모바일 블로그탭) 순위 크롤 ──
   개발자 API(openapi, sort=sim)는 실제 노출 순위와 다르다. 실제 사용자가 보는 순서를 그대로 읽으려면
   m.search.naver.com 블로그탭 결과의 blog링크 순서에서 내 (blogId + logNo) 위치를 찾는다. 세션 쿠키 사용. */
async function searchRealRank(context: BrowserContext, blogId: string, logNo: string, query: string, log: (m: string) => void): Promise<{ rank: number | null; total: number }> {
  const MUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const page = await context.newPage();
  try {
    await page.setExtraHTTPHeaders({ "User-Agent": MUA });
    await page.goto(`https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
    // 더 많은 결과 로드(스크롤)
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(600); }
    const links: string[] = await page.$$eval('a[href*="blog.naver.com"]', els => els.map(e => (e as HTMLAnchorElement).href));
    // 블로그 글 링크만 순서대로(중복 제거). 각 링크에서 blogId/logNo 추출.
    const seq: { blogId: string; logNo: string }[] = [];
    const seen = new Set<string>();
    for (const h of links) {
      const m = h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d{6,})/) || h.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)[?].*logNo=(\d{6,})/);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key); seq.push({ blogId: m[1].toLowerCase(), logNo: m[2] });
    }
    const idx = seq.findIndex(s => s.blogId === blogId.toLowerCase() && s.logNo === String(logNo));
    return { rank: idx >= 0 ? idx + 1 : null, total: seq.length };
  } catch (e: any) {
    log(`[검색노출] 실검색 실패(${(e.message || "").slice(0, 30)})`);
    return { rank: null, total: 0 };
  } finally { await page.close().catch(() => {}); }
}

async function checkBlogExposure(blogId: string, posts: ExposurePost[], plan: string, log: (msg: string) => void, searchContext?: BrowserContext): Promise<ExposureProgress> {
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
      // ★핵심 키워드로 검색(제목 전체X). 실제 노출 순위와 맞추기 위해 의미 단어만 추린다.
      const query = extractSearchQuery(title);
      let rank: number | null = null;
      let exposed = false;
      let via = "";
      // ① 실제 통합검색(모바일 블로그탭) 순위 우선 — 사용자가 실제 보는 순서. 세션 context 있을 때.
      if (searchContext) {
        const real = await searchRealRank(searchContext, blogId, logNo, query, log);
        if (real.rank !== null) { rank = real.rank; exposed = true; via = "실검색"; }
        else if (real.total > 0) { exposed = false; via = `실검색 ${real.total}개 중 없음`; }
      }
      // ② 실검색에서 못 찾았고 개발자 API 키 있으면 보조 확인(참고용)
      if (rank === null && keys) {
        const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=100&start=1&sort=sim`;
        const response = await fetch(url, { headers: { "X-Naver-Client-Id": keys.clientId, "X-Naver-Client-Secret": keys.clientSecret } });
        if (response.ok) {
          const json: any = await response.json();
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          const wanted = blogId.toLowerCase();
          const index = items.findIndex(item => {
            const link = String(item?.link || "").replace(/&amp;/gi, "&").toLowerCase();
            const bloggerLink = String(item?.bloggerlink || "").toLowerCase();
            try {
              const parsed = new URL(link);
              const linkBlogId = (parsed.searchParams.get("blogId") || "").toLowerCase();
              const linkLogNo = parsed.searchParams.get("logNo") || parsed.pathname.match(/\/(\d{6,})(?:\/)?$/)?.[1] || "";
              const pathOwner = parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
              const profileOwner = bloggerLink.replace(/\/$/, "").split("/").pop() || "";
              return (linkBlogId === wanted || pathOwner === wanted || profileOwner === wanted) && (!linkLogNo || linkLogNo === logNo);
            } catch {
              return link.includes(`blog.naver.com/${wanted}/${logNo}`) || bloggerLink.replace(/\/$/, "").endsWith(`/` + wanted);
            }
          });
          if (index >= 0 && !via) { rank = index + 1; exposed = true; via = "API참고"; }
        }
      }
      checks.push({ logNo, title, exposed, rank, postUrl: undefined });
      log(`[검색노출] "${query}" → ${rank !== null ? `${rank}위(${via})` : `노출 안됨(${via || "확인불가"})`} · ${title.slice(0, 24)}`);
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

export async function checkSelectedBlogExposure(params: {
  accountId: string; plan?: string; logNos: string[]; onLog?: (msg: string) => void;
}): Promise<ExposureProgress & { totalPostsForExposure: number; lowQualitySuspected: boolean | null }> {
  const { accountId, plan = "free", onLog } = params;
  const log = onLog || console.log;
  if (!naverSessionExists(accountId)) throw new Error("세션 없음 — 먼저 로그인하세요");
  const { blogId, cookies } = loadSession(accountId);
  if (!blogId) throw new Error("내 블로그 ID를 찾을 수 없어요 — 계정을 다시 연결해주세요");
  const wanted = new Set((Array.isArray(params.logNos) ? params.logNos : []).map(String).filter(value => /^\d+$/.test(value)));
  if (!wanted.size) throw new Error("검색노출을 확인할 글을 선택해주세요");
  const list = await fetchNaverPostList({ blogId, cookies, maxCount: null, log });
  const selected = list.posts.filter(post => wanted.has(post.logNo)).map(post => ({ logNo: post.logNo, title: post.title }));
  if (!selected.length) throw new Error("선택한 글 정보를 다시 찾지 못했어요. 글 목록을 새로 불러와주세요");
  log(`[검색노출] 선택 ${selected.length}개 · ${plan} 등급 한도 적용 · 실제 통합검색 순위 확인`);
  // ★실제 통합검색 순위 확인용 browser context(세션 쿠키). 개발자 API보다 실제 노출 순위에 맞다.
  const exBrowser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const exContext = await exBrowser.newContext({ locale: "ko-KR" });
  await exContext.addCookies(cookies).catch(() => {});
  let progress;
  try {
    progress = await checkBlogExposure(blogId, selected, plan, log, exContext);
  } finally {
    await exBrowser.close().catch(() => {});
  }
  const known = progress.checks.filter(check => check.exposed !== null);
  const missing = known.filter(check => check.exposed === false).length;
  return { ...progress, totalPostsForExposure: list.totalCount || list.posts.length, lowQualitySuspected: known.length >= 3 ? missing / known.length > 0.5 : null };
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
    log(`[건강검진] 총 글 ${totalPosts}개 · 최근 날짜 ${recentDates.length}개 수집`);

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
      // 검색 API 호출은 별도 2단계(사용자가 글 선택 후)에만 수행한다.
      const normalizedPlan = Object.prototype.hasOwnProperty.call(EXPOSURE_DAILY_LIMIT, plan) ? plan : "free";
      exposureLimit = EXPOSURE_DAILY_LIMIT[normalizedPlan];
      if (exposureLimit !== null) {
        const history = readExposureHistory(blogId);
        checkedTodayCount = history.dailyCount;
        exposureCompletedCount = exposurePosts.filter(post => history.lastChecked[post.logNo]).length;
      }
      log(`[검색노출] 선택용 글 ${exposurePosts.length}개 확보 · 글 선택 후 별도로 검사하세요`);
    } catch (e: any) { log(`[검색노출] 검사 실패: ${e.message}`); }

    // ★방문자 수: 네이버 공개 방문자 위젯 API(NVisitorgp4Ajax) — 쿠키 없이 일별 방문자 XML을 준다(실측 2026-08-23).
    try {
      log("[방문자] 방문자 위젯에서 일별 방문자 수집 중...");
      const vres = await fetch(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${encodeURIComponent(blogId)}`, {
        headers: { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}` },
      });
      const vxml = await vres.text();
      const vdays: { date: string; visitors: number }[] = [];
      const vre = /<visitorcnt\s+id="(\d{8})"\s+cnt="(\d+)"/gi;
      let vm: RegExpExecArray | null;
      while ((vm = vre.exec(vxml))) {
        vdays.push({ date: `${vm[1].slice(0,4)}-${vm[1].slice(4,6)}-${vm[1].slice(6,8)}`, visitors: Number(vm[2]) || 0 });
      }
      if (vdays.length) visitorDays = vdays.sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
      log(`[방문자] 일별 ${visitorDays.length}일 수집 완료`);
    } catch (e: any) { log(`[방문자] 위젯 확인 실패: ${e.message}`); }

    // ★이웃 수: 공감·댓글과 같은 세션 방식(section.blog.naver.com 이웃API)으로 전체 이웃 수 읽기.
    try {
      await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      const buddyInfo = await page.evaluate(async () => {
        try {
          const r = await fetch("https://section.blog.naver.com/ajax/BuddyPostList.naver?page=1&groupId=0", { headers: { Referer: "https://section.blog.naver.com/BlogHome.naver" } });
          const raw = await r.text();
          const d = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""));
          const result = d?.result || {};
          const total = Number(result.totalCount ?? result.buddyCount ?? result.totalBuddyCount ?? result.buddyTotalCount ?? result.pagination?.totalCount ?? d?.totalCount ?? 0) || 0;
          const list = result.buddyPostList || result.postList || result.list || [];
          const unique = Array.isArray(list) ? new Set(list.map((item: any) => item?.domainIdOrBlogId || item?.blogId).filter(Boolean)).size : 0;
          return { total, unique };
        } catch { return { total: 0, unique: 0 }; }
      }).catch(() => ({ total: 0, unique: 0 }));
      // ★buddyInfo.total(응답의 진짜 총 이웃수)만 신뢰한다. unique(최근 글 쓴 이웃 수)는 총수와 전혀 달라 쓰지 않는다.
      //   (예전엔 unique=7을 이웃수로 써서 실제 200+인데 7로 잘못 표시됐다 — 그래서 폴백도 안 탔음)
      if (buddyInfo.total > 0) neighbors = buddyInfo.total;

      // 총수를 못 얻으면 이웃 관리/프로필 페이지에서 총 이웃수를 직접 읽는다(세션 필요).
      if (neighbors <= 0) {
        const manageUrls = [
          `https://admin.blog.naver.com/${blogId}/buddy/BuddyListManage.naver`,
          `https://blog.naver.com/BuddyListManage.naver?blogId=${blogId}`,
          `https://m.blog.naver.com/BuddyList.naver?blogId=${blogId}`,
          `https://blog.naver.com/BuddyMe.naver?blogId=${blogId}`,
          `https://m.blog.naver.com/${blogId}`,
        ];
        for (const url of manageUrls) {
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForTimeout(500);
            const text = `${await page.locator("body").innerText().catch(() => "")}\n${await page.content()}`;
            const match = text.match(/(?:전체\s*이웃|서로이웃|이웃\s*수|이웃)[^\d]{0,20}([\d,]{1,7})\s*명/)
              || text.match(/"?(?:buddyCnt|buddyCount|totalBuddyCount|buddyAllCount|totalCount)"?\s*[:=]\s*"?([\d,]{1,7})/i);
            if (match) { const n = Number(match[1].replace(/,/g, "")) || 0; if (n > 0) { neighbors = n; break; } }
          } catch {}
        }
      }
      // 그래도 총수를 못 구하면 최소한 "확인된 최근활동 이웃 N명 이상"으로 참고값 제공(0보다 낫게)
      if (neighbors <= 0 && buddyInfo.unique > 0) neighbors = buddyInfo.unique;
      log(`[이웃수] ${neighbors > 0 ? `${neighbors}명 수집` : "확인 실패(진단은 계속)"}`);
    } catch {}

    // ★유입 검색어: 세션 필요(공개 불가). 이웃수처럼 로그인된 browser context 안에서 통계 유입분석 API를 fetch.
    try {
      log("[유입검색어] 통계 유입분석 수집 중...");
      await page.goto(`https://admin.blog.naver.com/${blogId}`, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      const kws = await page.evaluate(async (bid: string) => {
        const urls = [
          `https://admin.blog.naver.com/api/blogs/${bid}/stats/inflow-search-keyword?range=DAILY`,
          `https://admin.blog.naver.com/api/blogs/${bid}/stats/keyword`,
          `https://blog.naver.com/RabbitAsync.naver?blogId=${bid}&countPerPage=10&type=inflow`,
        ];
        for (const u of urls) {
          try {
            const r = await fetch(u, { headers: { Referer: `https://admin.blog.naver.com/${bid}` } });
            const raw = await r.text();
            const j = JSON.parse(raw.replace(/^\)\]\}',?\s*/, ""));
            const arr = j?.result?.searchKeywordList || j?.result?.keywordList || j?.searchKeywords || (Array.isArray(j?.result) ? j.result : []);
            if (Array.isArray(arr) && arr.length) {
              return arr.slice(0, 5).map((x: any) => ({ keyword: String(x.keyword ?? x.searchKeyword ?? x.query ?? x.name ?? "").trim(), count: Number(x.count ?? x.cnt ?? x.pv ?? x.value ?? 0) || undefined })).filter((k: any) => k.keyword);
            }
          } catch {}
        }
        return [] as { keyword: string; count?: number }[];
      }, blogId).catch(() => [] as { keyword: string; count?: number }[]);
      if (Array.isArray(kws) && kws.length) inflowKeywords = kws;
      log(`[유입검색어] ${inflowKeywords.length}개 수집`);
    } catch (e: any) { log(`[유입검색어] 확인 실패: ${e.message}`); }

    if (false) {
      const statUrls = [`https://admin.blog.naver.com/${blogId}`];
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
    }
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
  // ★발행 활성도: 최근 글 날짜로 마지막 발행 경과일 + 7일/30일 발행 수 → 활성/보통/비활성 판정(상위노출 핵심 지표)
  let activity: BlogStats["activity"] = null;
  {
    const now = Date.now();
    const dayMs = 86400000;
    const times = recentDates.map(d => new Date(`${d}T00:00:00+09:00`).getTime()).filter(t => Number.isFinite(t) && t > 0).sort((a, b) => b - a);
    if (times.length) {
      const daysSinceLast = Math.floor((now - times[0]) / dayMs);
      const postsIn7d = times.filter(t => now - t <= 7 * dayMs).length;
      const postsIn30d = times.filter(t => now - t <= 30 * dayMs).length;
      let level: "active" | "normal" | "inactive"; let message: string;
      if (daysSinceLast >= 14) { level = "inactive"; message = `${daysSinceLast}일째 새 글이 없어요 — 지수가 떨어지는 중. 지금 발행이 가장 급해요.`; }
      else if (postsIn7d >= 3) { level = "active"; message = `최근 7일 ${postsIn7d}개 발행 중 — 좋은 페이스예요. 이 꾸준함을 유지하세요.`; }
      else if (postsIn30d >= 4) { level = "normal"; message = `최근 30일 ${postsIn30d}개 — 나쁘지 않지만, 주 3회 이상이면 지수에 더 유리해요.`; }
      else { level = "inactive"; message = `발행이 뜸해요(30일 ${postsIn30d}개) — 꾸준히 올릴수록 상위노출에 유리해요.`; }
      activity = { level, daysSinceLast, postsIn7d, postsIn30d, message };
    }
  }
  return { blogId, totalPosts, neighbors, recentDates, exposureChecks, lowQualitySuspected, visitorDays, inflowKeywords, visitorDrop, activity, totalPostsForExposure: exposurePosts.length, checkedTodayCount, exposureCompletedCount, exposureLimit };
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

  const browser = await chromium.launch({ headless: false, args: [...LAUNCH_ARGS, "--start-maximized"] });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});   // ★크롬 창을 화면 앞으로
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

        // 이 글의 댓글 목록 파악 (작성자·내용·commentNo·이미 답글있는지)
        //  ★2026-08 실측: 답글 버튼 a.u_cbox_btn_reply[data-param='{commentNo}'], 입력창 id는 …__reply_textarea_{commentNo}(contenteditable),
        //    답글 등록 버튼 [data-ui-selector='replyButton_{commentNo}']. commentNo로 타겟해야 순번 어긋남이 없다(기존 idx 매칭 버그 제거).
        const commentInfos: { commentNo: string; author: string; text: string; hasReply: boolean }[] = await ctx.evaluate(() => {
          // 원댓글만: 대댓글(u_cbox_reply_area 안)은 제외
          const items = Array.from(document.querySelectorAll("li.u_cbox_comment")).filter(li => !li.closest(".u_cbox_reply_area"));
          const res: { commentNo: string; author: string; text: string; hasReply: boolean }[] = [];
          items.forEach((li) => {
            const author = (li.querySelector(".u_cbox_nick")?.textContent || "").trim();
            const text = (li.querySelector(".u_cbox_contents")?.textContent || "").trim();
            const replyBtn = li.querySelector("a.u_cbox_btn_reply[data-action='reply#toggle'], a.u_cbox_btn_reply");
            const commentNo = replyBtn?.getAttribute("data-param") || "";
            const hasReply = !!li.querySelector(".u_cbox_reply_area .u_cbox_comment, .u_cbox_reply_cnt");
            if (text && commentNo) res.push({ commentNo, author, text, hasReply });
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
            replyText = await generateAiReply(geminiKey, tone, c.text, c.author || "", log);
            if (!replyText) { log(`[답방] AI 답글 생성 실패 — 이 댓글 스킵`); continue; }
          }
          // ① 해당 댓글의 '답글' 버튼 클릭(commentNo로 정확히 타겟) → 답글 입력 영역 펼침
          const opened = await ctx.evaluate((cno: string) => {
            const btns = Array.from(document.querySelectorAll(`a.u_cbox_btn_reply[data-param='${cno}']`)) as HTMLElement[];
            // 열기(off) 상태이면서 화면에 보이는 버튼 우선
            const btn = btns.find(b => !b.classList.contains("u_cbox_btn_reply_on") && b.style.display !== "none") || btns[0];
            if (!btn) return false;
            btn.click();
            return true;
          }, c.commentNo).catch(() => false);
          if (!opened) { log(`[답방] 답글 버튼 못찾음 — 스킵`); continue; }
          await page.waitForTimeout(1000);

          // ② 펼쳐진 답글 입력창(contenteditable div, id가 …reply_textarea_{commentNo}로 끝남)에 키보드로 입력
          const inputSel = `[id$='reply_textarea_${c.commentNo}']`;
          const inputEl = await ctx.$(inputSel);
          if (!inputEl) { log(`[답방] 답글 입력창 못찾음 — 스킵`); continue; }
          try { await inputEl.scrollIntoViewIfNeeded({ timeout: 2000 }); } catch {}
          // placeholder 안내(.u_cbox_guide)가 클릭을 가로챌 수 있어 force 클릭으로 포커스
          try { await inputEl.click({ force: true, timeout: 3000 }); }
          catch { const b = await inputEl.boundingBox(); if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
          await page.waitForTimeout(400);
          // contenteditable은 value 대입이 안 먹음 → 전체선택·삭제 후 사람처럼 타이핑
          await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
          await page.keyboard.press("Backspace").catch(() => {});
          await humanType(page, naturalizeMsg(replyText));
          await page.waitForTimeout(500);
          // 실제 입력됐는지 확인(안 됐으면 이 댓글 스킵)
          const typedOk = await ctx.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            return !!el && (el.textContent || "").trim().length > 0;
          }, inputSel).catch(() => false);
          if (!typedOk) { log(`[답방] 답글 입력 실패 — 스킵`); continue; }

          // ③ 등록 버튼(해당 commentNo의 답글 등록)
          const submitted = await ctx.evaluate((cno: string) => {
            const btn = (document.querySelector(`[data-ui-selector='replyButton_${cno}']`)
              || document.querySelector(`button.u_cbox_btn_upload[data-action*='reply']`)) as HTMLElement | null;
            if (btn) { btn.click(); return true; }
            return false;
          }, c.commentNo).catch(() => false);
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
async function generateAiReply(key: string, tone: string, commentText: string, authorName: string, log: (m: string) => void): Promise<string> {
  if (!key) { log("[답방] Gemini 키 없음 — AI 답글 건너뜀"); return ""; }
  const toneGuide = tone === "담백" ? "깔끔하고 담백한" : tone === "짧게" ? "짧고 간결한" : "다정하고 따뜻한";
  // ★이름 오타 방지: 작성자 닉네임을 정확히 주고, 부를 거면 한 글자도 바꾸지 말라고 강하게 지시(테리→타리 같은 변형 방지).
  const nameRule = authorName
    ? `상대 닉네임은 정확히 "${authorName}" 야. 답글에서 상대를 부를 때는 반드시 "${authorName}"를 한 글자도 바꾸지 말고 그대로 써. 이름을 임의로 줄이거나 바꾸거나 새로 지어내지 마. 닉네임이 부르기 어색하면 차라리 이름을 부르지 말고 내용에만 반응해.`
    : `상대 닉네임을 모르니, 답글에 사람 이름·호칭을 지어내서 쓰지 말고 내용에만 반응해.`;
  const rStarters = ["고마움을 먼저 표하며", "상대 댓글에 되물으며", "공감하며", "가볍게 인사하며", "댓글 내용을 콕 집어", "반가움을 담아", "담담하게 한마디로"];
  const rHint = rStarters[Math.floor(Math.random() * rStarters.length)];
  const prompt = `너는 네이버 블로그 주인이야. 내 글에 아래 댓글이 달렸어. 이 댓글에 ${toneGuide} 말투로 고마움을 담은 자연스러운 한국어 답글을 딱 1개만 써줘.\n${nameRule}\n규칙: 1문장, 35자 이내, 댓글 내용에 구체적으로 반응, 이모지 1개 정도, 광고·링크 금지, 따옴표 없이 답글만 출력.\n★시작 표현 다양화: 이번 답글은 "${rHint}" 시작해줘. "와", "우와", "감사합니다"로만 매번 시작하지 말고 첫 단어를 다르게.\n\n[받은 댓글]\n${commentText}`;
  for (const model of ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"]) {
    try {
      // ★2.5계열 thinking 끄고 토큰 넉넉히 — 답글이 중간에 잘리는 것 방지
      const generationConfig: any = { maxOutputTokens: 800, temperature: 1.0 };
      if (model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      });
      const d: any = await r.json();
      if (!r.ok) { if (r.status === 404 || r.status === 400) continue; return ""; }
      const cand = d?.candidates?.[0];
      const raw = cand?.content?.parts?.[0]?.text?.trim();
      if (!raw || cand?.finishReason === "MAX_TOKENS") { log(`[답방] ${model} 답글 잘림/빈응답 → 다음 모델`); continue; }
      const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 100);
      if (cleaned.length >= 3) return cleaned;
    } catch {}
  }
  return "";
}

/* ── 품앗이 순환 매칭 이력: 같은 actor→target 조합 최근 방문시각 기록 ── */
const PUMASI_PAIRS_PATH = path.join(SESSION_DIR, "pumasi_pairs.json");
function loadPumasiPairs(): Record<string, number> {
  try { return fs.existsSync(PUMASI_PAIRS_PATH) ? JSON.parse(fs.readFileSync(PUMASI_PAIRS_PATH, "utf-8")) : {}; }
  catch { return {}; }
}
function savePumasiPairs(m: Record<string, number>) {
  try { fs.writeFileSync(PUMASI_PAIRS_PATH, JSON.stringify(m)); } catch {}
}
const PUMASI_PAIR_COOLDOWN_MS = 2 * 24 * 3600 * 1000; // 같은 조합 2일 쿨다운

/* ── 품앗이 댓글 이력: (actor→target) 조합마다 이미 댓글 단 글(logNo)을 저장 ──
   같은 글에 두 번 댓글 달지 않게(도배 방지). 최신→과거로 거슬러 올라가며 안 단 글에만 단다.
   파일 하나에 { "actorId>targetId": ["logNo", …] } 로 모아 관리. */
const PUMASI_COMMENTED_PATH = path.join(SESSION_DIR, "pumasi_commented.json");
function loadPumasiCommented(): Record<string, string[]> {
  try { return fs.existsSync(PUMASI_COMMENTED_PATH) ? JSON.parse(fs.readFileSync(PUMASI_COMMENTED_PATH, "utf-8")) : {}; }
  catch { return {}; }
}
function savePumasiCommented(m: Record<string, string[]>) {
  try { fs.writeFileSync(PUMASI_COMMENTED_PATH, JSON.stringify(m)); } catch {}
}

/* ── 품앗이 실행 로그: 효과 리포트용(대상 blogId가 언제 품앗이 방문을 받았는지 기록) ── */
const PUMASI_RUNS_PATH = path.join(SESSION_DIR, "pumasi_runs.json");
function appendPumasiRun(targetBlogId: string, actorBlogId: string) {
  try {
    const arr: { target: string; actor: string; ts: number }[] = fs.existsSync(PUMASI_RUNS_PATH) ? JSON.parse(fs.readFileSync(PUMASI_RUNS_PATH, "utf-8")) : [];
    arr.push({ target: targetBlogId, actor: actorBlogId, ts: Date.now() });
    // 90일 이전 로그는 정리(파일 비대 방지)
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    fs.writeFileSync(PUMASI_RUNS_PATH, JSON.stringify(arr.filter(r => r.ts >= cutoff)));
  } catch {}
}
// ★품앗이 시작 전 미리보기: 각 대상 계정의 총 글 수와, 이 계정을 향한 조합들이 이미 댓글 단 글 수를 요약해 반환.
//   (누가 얼마나 남았는지 눈으로 확인 → "이미 단 글은 건너뛴다"를 시작 전에 보여줌). 공개 API로 빠르게 총 글 수만 조회.
export async function pumasiPreview(accounts: { accountId: string; blogId: string }[], log: (m: string) => void = console.log): Promise<{ blogId: string; total: number; commented: number; remaining: number }[]> {
  const commentedAll = loadPumasiCommented();
  const res: { blogId: string; total: number; commented: number; remaining: number }[] = [];
  for (const target of accounts) {
    if (!target.blogId) continue;
    // 이 target을 향한 모든 (actor→target) 조합에서 이미 댓글 단 글(logNo) 합집합
    const doneSet = new Set<string>();
    for (const actor of accounts) {
      if (actor.accountId === target.accountId) continue;
      (commentedAll[`${actor.accountId}>${target.accountId}`] || []).forEach(l => doneSet.add(String(l)));
    }
    let total = 0;
    // maxCount=null(전체) → PostTitleListAsync는 첫 응답의 totalCount가 정확하고, 모바일 API/RSS 폴백 블로그는
    //   실제 글을 다 세어 정확한 총 글 수를 얻는다(1개만 가져와 "총 1"로 잘못 나오던 문제 해결).
    try { const list = await fetchNaverPostList({ blogId: target.blogId, cookies: [], maxCount: null, log }); total = Math.max(list.totalCount || 0, list.posts.length); }
    catch { total = 0; }
    const commented = doneSet.size;
    res.push({ blogId: target.blogId, total, commented, remaining: Math.max(0, total - commented) });
  }
  return res;
}

function pumasiRunsFor(targetBlogId: string): { actor: string; ts: number }[] {
  try {
    const arr: { target: string; actor: string; ts: number }[] = fs.existsSync(PUMASI_RUNS_PATH) ? JSON.parse(fs.readFileSync(PUMASI_RUNS_PATH, "utf-8")) : [];
    return arr.filter(r => r.target === targetBlogId).map(r => ({ actor: r.actor, ts: r.ts }));
  } catch { return []; }
}

// ── 품앗이 효과 리포트: 방문자 추이(위젯) + 일별 품앗이 방문 횟수 상관 ──
//   순위 상승을 품앗이 효과라고 단정하지 않고, 방문자·품앗이 실행일을 함께 보여줘 스스로 판단하게 함.
export async function crawlPumasiReport(blogId: string, log: (m: string) => void = console.log): Promise<{
  blogId: string;
  days: { date: string; visitors: number; pumasiVisits: number }[];
  totalReceived7d: number;
  avgWithPumasi: number | null;
  avgWithoutPumasi: number | null;
}> {
  const koDate = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 1) 방문자 위젯(최근 ~7일)
  const visitor: Record<string, number> = {};
  try {
    const vres = await fetch(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${encodeURIComponent(blogId)}`, { headers: { "User-Agent": UA, Referer: `https://blog.naver.com/${blogId}` } });
    const vxml = await vres.text();
    const vre = /<visitorcnt\s+id="(\d{8})"\s+cnt="(\d+)"/gi; let vm: RegExpExecArray | null;
    while ((vm = vre.exec(vxml))) visitor[`${vm[1].slice(0,4)}-${vm[1].slice(4,6)}-${vm[1].slice(6,8)}`] = Number(vm[2]) || 0;
  } catch (e: any) { log(`[리포트] 방문자 위젯 실패: ${e.message}`); }
  // 2) 일별 품앗이 방문 횟수
  const runs = pumasiRunsFor(blogId);
  const runsByDay: Record<string, number> = {};
  for (const r of runs) { const d = koDate(r.ts); runsByDay[d] = (runsByDay[d] || 0) + 1; }
  // 3) 최근 7일 병합
  const dates = Object.keys(visitor).sort();
  const days = dates.map(date => ({ date, visitors: visitor[date] || 0, pumasiVisits: runsByDay[date] || 0 }));
  const withP = days.filter(d => d.pumasiVisits > 0);
  const withoutP = days.filter(d => d.pumasiVisits === 0);
  const avg = (arr: typeof days) => arr.length ? Math.round(arr.reduce((s, d) => s + d.visitors, 0) / arr.length) : null;
  const totalReceived7d = days.reduce((s, d) => s + d.pumasiVisits, 0);
  log(`[리포트] ${blogId} — ${days.length}일 방문자·품앗이 상관 집계 완료`);
  return { blogId, days, totalReceived7d, avgWithPumasi: avg(withP), avgWithoutPumasi: avg(withoutP) };
}

/* ── 공감·댓글 작업 ── */
// ── 품앗이: 내 여러 계정끼리 서로 글에 공감·댓글 ──
//   각 계정(작성자)의 세션으로 로그인 상태에서, 나머지 계정(대상)의 blogId 글에 engageBlogs 호출.
//   계정별 postsPerBlog(대상 글 수)를 다르게 지정 가능. 세션은 이미 저장돼 있어 재로그인 불필요.
export async function pumasiEngage(params: {
  accounts: { accountId: string; blogId: string; posts: number; receiveLimit: number }[];  // posts=대상 글 수, receiveLimit=방문 받을 actor 수
  comment: string;                 // 고정/순환(|||) 멘트
  doLike: boolean;
  doComment: boolean;
  aiComment: boolean;
  commentTone: string;
  geminiKey: string;
  delayMin: number;
  delayMax: number;
  readRelated?: boolean;   // ★관련 글 1편 더 읽기(체류·투데이↑)
  readRelatedMode?: "always" | "random";  // ★매번=각 대상 글마다 항상 / 가끔=확률 60%
  readSpeed?: ReadSpeed;   // ★체류 속도(fast/normal/natural)
  periodDays?: number;     // ★대상 글 기간 제한(최근 N일 이내 글만, 0/미지정=전체 무제한)
  searchEntry?: boolean;   // ★검색 경유 진입(검색 유입)
  searchKeyword?: string;  // ★검색 경유 시 사용할 키워드(내 글 목표 키워드). 없으면 blogId로 검색
  spreadHours?: number;    // ★시간 분산 큐: 방문을 N시간에 걸쳐 분산(0=즉시 연속)
  onLog?: (msg: string) => void;
  onResult?: (r: EngageResult & { actor?: string }) => Promise<void>;
  onProgress?: (done: number, fail: number, skip?: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const { accounts, comment, doLike, doComment, aiComment, commentTone, geminiKey, delayMin, delayMax, readRelated = true, readRelatedMode = "random", readSpeed = "natural", periodDays = 0, searchEntry = false, searchKeyword = "", spreadHours = 0, onLog, onResult, onProgress, stopSignal } = params;
  const log = onLog || console.log;
  let done = 0, fail = 0, skip = 0;
  // ★세션 상태를 계정별로 로그에 남긴다(크롬이 안 뜰 때 어느 계정이 문제인지 즉시 파악).
  const sessionState = accounts.map(a => ({ blogId: a.blogId || a.accountId, ok: !!(a.accountId && naverSessionExists(a.accountId)), hasBlog: !!a.blogId }));
  log(`[품앗이] 세션 확인 — ${sessionState.map(s => `${s.blogId}:${s.ok ? "세션OK" : "세션없음"}${s.hasBlog ? "" : "·blogId없음"}`).join(", ")}`);
  const valid = accounts.filter(a => a.accountId && a.blogId && naverSessionExists(a.accountId));
  if (valid.length < 2) {
    const bad = sessionState.filter(s => !s.ok).map(s => s.blogId).join(", ");
    throw new Error(`품앗이는 세션 연결된 계정이 2개 이상 필요해요. 연결이 풀린 계정을 다시 연결해주세요${bad ? ` (${bad})` : ""}.`);
  }
  log(`[품앗이] 시작 — 계정 ${valid.length}개가 서로 글에 공감·댓글`);
  // ★계정 순환 매칭: 이력을 보고 '아직 안 갔거나 가장 오래된' 조합을 우선 배정
  //   (고정된 계정끼리만 반복 소통하는 패턴↓). 같은 actor→target 조합은 2일 쿨다운.
  const pairs = loadPumasiPairs();
  const commentedAll = loadPumasiCommented();   // (actor→target)별 이미 댓글 단 글 이력(도배 방지·최신→과거)
  const now = Date.now();
  const pairKey = (a: string, t: string) => `${a}>${t}`;
  const visitPlan: { actor: typeof valid[number]; target: typeof valid[number] }[] = [];
  for (const target of valid) {
    const receiveLimit = Math.max(1, target.receiveLimit || 3);
    // 후보 actor(자기 자신 제외)를 최근 방문시각 오름차순(안 간 계정=0 최우선)으로 정렬
    const cands = valid.filter(a => a.accountId !== target.accountId)
      .map(a => ({ a, last: pairs[pairKey(a.accountId, target.accountId)] || 0 }))
      .sort((x, y) => x.last - y.last);
    // 쿨다운(2일) 안 지난 조합은 뒤로 미루되, 받을 수를 못 채우면 오래된 순으로 채움
    const fresh = cands.filter(c => now - c.last >= PUMASI_PAIR_COOLDOWN_MS);
    const chosen = (fresh.length >= receiveLimit ? fresh : cands).slice(0, receiveLimit);
    for (const c of chosen) visitPlan.push({ actor: c.a, target });
  }
  // 같은 대상·같은 actor가 연달아 오지 않도록 라운드로빈 인터리브(actor별로 흩뿌림)
  visitPlan.sort((p, q) => valid.indexOf(p.actor) - valid.indexOf(q.actor));

  // ★시간 분산 큐: 전체 방문을 spreadHours 시간에 걸쳐 고르게 분산(투데이·댓글 폭증 방지)
  const totalCombos = visitPlan.length;
  const spreadGapMs = spreadHours > 0 && totalCombos > 1 ? (spreadHours * 3600 * 1000) / totalCombos : 0;
  if (spreadGapMs > 0) log(`[품앗이] ⏰ 시간 분산: 총 ${totalCombos}회 방문을 약 ${spreadHours}시간에 걸쳐(방문 간 평균 ${Math.round(spreadGapMs/60000)}분) 진행`);
  log(`[품앗이] 순환 매칭 완료 — 이번엔 총 ${totalCombos}회 방문 예정(받을 수·쿨다운 반영)`);
  let comboIdx = 0;

  // ★크롬 창을 한 번만 띄워 계속 유지(방문 사이 대기에도 창이 안 닫혀 "멈춘 것처럼" 보이지 않음).
  //   대기 안내 페이지를 하나 열어두어 시간 분산으로 쉬는 동안에도 창이 보이게 한다.
  const sharedBrowser = await chromium.launch({ headless: false, args: [...LAUNCH_ARGS, "--start-maximized"] });
  const holdPage = await sharedBrowser.newPage().catch(() => null);
  const showHold = async (msg: string) => {
    if (!holdPage) return;
    try {
      await holdPage.setContent(`<html><head><meta charset="utf-8"><style>body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,'Malgun Gothic',sans-serif;background:linear-gradient(135deg,#fdf2f8,#fce7f3);color:#831843}h1{font-size:26px;margin:0 0 10px}p{font-size:15px;color:#9d174d;margin:4px}</style></head><body><h1>💞 품앗이 진행 중…</h1><p>${msg}</p><p style="color:#be185d;font-size:13px">이 창은 작업이 끝날 때까지 켜져 있어요. 닫지 마세요.</p></body></html>`);
      await holdPage.bringToFront().catch(() => {});
    } catch {}
  };
  await showHold("계정을 전환하며 서로의 글에 공감·댓글을 남기고 있어요.");

  try {
  for (const { actor, target } of visitPlan) {
    if (stopSignal?.()) { log("[품앗이] 중단 신호 수신"); break; }
    log(`[품앗이] ${actor.blogId} → ${target.blogId} 글 ${target.posts}개에 ${doLike ? "공감" : ""}${doLike && doComment ? "+" : ""}${doComment ? "댓글" : ""}`);
    pairs[pairKey(actor.accountId, target.accountId)] = Date.now(); // 조합 방문시각 기록(쿨다운·순환용)
    savePumasiPairs(pairs);
    appendPumasiRun(target.blogId, actor.blogId);                   // 효과 리포트용 실행 로그
    try {
      // ★도배 방지: 이 (actor→target) 조합에서 이미 댓글 단 글은 제외 → 최신부터 안 단 글에만 단다(과거로 자동 진행)
      const ckey = `${actor.accountId}>${target.accountId}`;
      const commentedSet = new Set<string>(commentedAll[ckey] || []);
      await engageBlogs({
        accountId: actor.accountId,
        // 검색 경유 진입 시 목표 키워드로 검색(없으면 대상 blogId로 검색). 아니면 기존처럼 "품앗이"(URL 직행)
        targets: [{ keyword: searchEntry ? (searchKeyword.trim() || target.blogId) : "품앗이", blogId: target.blogId }],
        comment, doLike, doComment,
        periodDays: periodDays > 0 ? periodDays : 3650,   // 0=전체(무제한), 값 있으면 최근 N일 글만
        postsPerBlog: Math.max(1, target.posts),
        delayMin, delayMax,
        dailyLimit: 999999,
        skipDone: false,                // 서로 계속 달 수 있게(당일 중복방지는 아래 excludeLogNos가 담당)
        commentRate: 100, likeRate: 100,
        aiComment, commentTone, geminiKey, readRelated, readRelatedMode, readSpeed, searchEntry,
        sharedBrowser,   // ★공유 크롬 재사용(방문 사이에도 창 유지)
        excludeLogNos: commentedSet,
        onCommented: (logNo) => { commentedSet.add(logNo); commentedAll[ckey] = [...commentedSet]; savePumasiCommented(commentedAll); },
        onLog: (m) => log(m),
        onResult: async (r) => { if (r.status === "success") done++; else if (r.status === "fail") fail++; else if (r.status === "skip") skip++; await onResult?.({ ...r, actor: actor.blogId }); onProgress?.(done, fail, skip); },
        stopSignal,
      });
    } catch (e: any) { fail++; log(`[품앗이] ${actor.blogId}→${target.blogId} 오류: ${e.message}`); onProgress?.(done, fail, skip); }

    // ★시간 분산: 다음 방문까지 계산된 간격만큼 대기(±30% 편차). 마지막 방문 뒤엔 대기 안 함.
    comboIdx++;
    if (spreadGapMs > 0 && comboIdx < totalCombos && !stopSignal?.()) {
      const wait = Math.round(spreadGapMs * (0.7 + Math.random() * 0.6));
      log(`[품앗이] ⏰ 다음 방문까지 ${Math.round(wait/60000)}분 ${Math.round((wait%60000)/1000)}초 대기(시간 분산)...`);
      await showHold(`다음 방문까지 잠시 쉬는 중이에요 (약 ${Math.round(wait/60000)}분). 자연스럽게 시간을 나눠 방문하고 있어요.`);
      const until = Date.now() + wait;
      while (Date.now() < until) { if (stopSignal?.()) break; await new Promise(r => setTimeout(r, Math.min(5000, until - Date.now()))); }
      await showHold("계정을 전환하며 서로의 글에 공감·댓글을 남기고 있어요.");
    }
  }
  } finally {
    await sharedBrowser.close().catch(() => {});   // 작업 완료/중단 시 공유 크롬 닫기
  }
  log(`[품앗이] 완료 — 성공 ${done} / 스킵 ${skip} / 실패 ${fail}`);
}

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
  readRelated?: boolean;  // ★관련 글 1편 더 읽기: 각 대상 글 처리 직후 같은 블로그 다른 글 1편 정독(공감·댓글 없음)
  readRelatedMode?: "always" | "random";  // ★매번=각 대상 글마다 항상 1편 / 가끔=확률 60%
  excludeLogNos?: Set<string>;   // ★이미 댓글 단 글(logNo) 제외 → 최신→과거로 안 단 글에만 단다(품앗이 도배 방지)
  onCommented?: (logNo: string) => void;   // ★댓글 성공 시 그 글 logNo 통보(이력 저장용)
  readSpeed?: ReadSpeed;         // ★체류 속도(fast/normal/natural)
  sharedBrowser?: any;           // ★품앗이: 여러 방문이 크롬 창 하나를 공유(대기 중에도 창 유지). 있으면 이 browser 재사용·안 닫음
  minVisitors?: number;          // ★대상 블로그 최근 방문자 하한(0=제한없음) — 범위 밖이면 스킵
  maxVisitors?: number;          // ★대상 블로그 최근 방문자 상한(0=제한없음)
  searchEntry?: boolean;         // ★검색 경유 진입: 글에 URL직행 대신 네이버 검색→클릭(검색 유입 발생). 못 찾으면 URL 폴백
  onLog?: (msg: string) => void;
  onResult?: (r: EngageResult) => Promise<void>;
  onProgress?: (done: number, fail: number) => void;
  stopSignal?: () => boolean;
}): Promise<void> {
  const {
    accountId, targets, comment, doLike, doComment,
    periodDays, postsPerBlog, delayMin, delayMax,
    dailyLimit, skipDone, commentRate = 100, likeRate = 100,
    // ★readRelated 기본 false: 일반 공감·댓글(여러 블로그 순회)은 관련글 더 읽기를 켜지 않음(시간 급증 방지).
    //   품앗이(pumasiEngage)만 명시적으로 true를 넘겨 켠다.
    aiComment = false, commentTone = "다정", geminiKey = "", readRelated = false, readRelatedMode = "random", excludeLogNos, onCommented, readSpeed = "natural", sharedBrowser, minVisitors = 0, maxVisitors = 0, searchEntry = false, onLog, onResult, onProgress, stopSignal,
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

  // ★품앗이는 sharedBrowser(공유 크롬)를 재사용 → 방문 사이 대기에도 창이 안 닫힌다. 없으면(공감·댓글 단독) 자체 생성.
  const ownBrowser = !sharedBrowser;
  const browser = sharedBrowser || await chromium.launch({ headless: false, args: [...LAUNCH_ARGS, "--start-maximized"] });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});   // ★크롬 창을 화면 앞으로(백그라운드로 뜨는 것 방지)
  if (ownBrowser) log(`[공감·댓글] 🌐 작업용 크롬 창을 띄웠어요 (화면에 안 보이면 작업표시줄/독을 확인하세요)`);

  let done = 0;
  let fail = 0;
  let aiFallbackActive = false;   // ★AI 한도 소진 → 순환 댓글로 자동 전환된 상태(한 번 전환하면 이번 실행 내내 유지)

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

      // ★품앗이(excludeLogNos 사용)는 글 단위 이력으로 중복을 관리하므로 blogId 단위 당일 스킵을 건너뛴다.
      //   (같은 계정이 하루에 여러 번 돌려도 과거 글로 계속 내려갈 수 있게)
      const doneToday = !excludeLogNos && doneMap[blogId] === today;   // 오늘 이미 처리 → 스킵(당일 중복방지)
      const donePerm = skipDone && (blogId in doneMap);               // 완료 스킵 ON → 과거 처리분도 스킵
      if (doneToday || donePerm) {
        await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: doneToday ? "오늘 이미 처리됨(당일 중복방지)" : "이미 처리됨" });
        onProgress?.(done, fail);
        continue;
      }

      try {
        // ★방문자 수 필터: 대상 블로그 최근 방문자가 범위 밖이면 건너뛴다(공개 API, 세션 불필요). 못 읽으면 통과.
        if (minVisitors > 0 || maxVisitors > 0) {
          const v = await fetchRecentVisitors(blogId);
          if (v >= 0 && ((minVisitors > 0 && v < minVisitors) || (maxVisitors > 0 && v > maxVisitors))) {
            const msg = `방문자 ${v}명 (범위 ${minVisitors || 0}~${maxVisitors || "∞"} 밖) — 스킵`;
            log(`[공감·댓글] ⏭ ${blogId} ${msg}`);
            await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: msg });
            onProgress?.(done, fail);
            continue;
          }
        }
        log(`[공감·댓글] ${blogId} 방문 중...`);

        // 검증된 PostTitleListAsync 기반 목록만 사용 — target blogId 소유 글 외 링크가 섞이지 않는다.
        // ★관련 글 읽기용 여분 풀 + 품앗이 이력 제외(excludeLogNos) 시엔 과거 글까지 전부(무제한) 훑는다.
        const wantCount = Math.max(1, postsPerBlog);
        const fetchCount = excludeLogNos ? null : wantCount * 2 + 3;   // null=전체(무제한). 품앗이는 과거 글까지 다 확보
        const postList = await fetchNaverPostList({ blogId, cookies, maxCount: fetchCount, log });
        const inPeriod = postList.posts.filter(post => post.dateMs === 0 || post.dateMs >= cutoff);
        // ★품앗이: 이미 댓글 단 글은 제외 → 최신부터 훑어 아직 안 단 글에만 단다(같은 글 도배 방지, 자동으로 과거로 내려감)
        const alreadyDone = excludeLogNos ? inPeriod.filter(post => excludeLogNos.has(String(post.logNo))).length : 0;
        const periodOk = excludeLogNos ? inPeriod.filter(post => !excludeLogNos.has(String(post.logNo))) : inPeriod;
        if (excludeLogNos) log(`[품앗이] ${blogId} — 기간 내 글 ${inPeriod.length}개 중 이미 댓글 단 글 ${alreadyDone}개 건너뜀, 새로 달 수 있는 글 ${periodOk.length}개`);
        const filtered = periodOk.slice(0, wantCount);
        // 댓글 안 다는 여분 글(관련 글 1편 더 읽기용): 대상 글 이후의 글들
        const extraPool = periodOk.slice(filtered.length);
        const relRead = new Set<string>();   // ★이미 관련글로 읽은 URL(사이클마다 다른 글 고르기 위한 중복 방지)

        if (filtered.length === 0) {
          const msg = excludeLogNos ? "댓글 달 새 글이 없어요(모든 글에 이미 댓글 완료)" : `최근 ${periodDays}일 내 글 없음`;
          log(`[공감·댓글] ${blogId} — ${msg}, 스킵`);
          await onResult?.({ keyword, blogId, postUrl: "", liked: false, commented: false, status: "skip", message: msg });
          onProgress?.(done, fail);
          continue;
        }

        for (let postIndex = 0; postIndex < filtered.length; postIndex++) {
        if (done >= dailyLimit || stopSignal?.()) break;
        const targetPost = filtered[postIndex];
        let liked = false;
        let commented = false;
        let likeReason = "";     // 공감 못한 이유 (결과 표시용)
        let commentReason = "";  // 댓글 못단 이유 (결과 표시용)

        log(`[공감·댓글] ${blogId} → 글 진입: ${targetPost.url}`);
        // ★검색 경유 진입(켜진 경우): 키워드로 검색해 이 글을 찾아 클릭(검색 유입). 못 찾으면 URL 직행.
        let entered = false;
        if (searchEntry) entered = await enterViaSearch(page, keyword, blogId, targetPost.logNo, log);
        if (!entered) { await page.goto(targetPost.url, { waitUntil: "domcontentloaded", timeout: 20000 }); }
        await page.waitForTimeout(2000);

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
        let ctx = frame ?? page as any;

        // ★본문 로딩 확인(재시도): iframe이 덜 로딩되면 본문·공감·댓글 버튼을 못 잡아 글이 통째로 스킵된다.
        //   본문이 비어 있으면 2.5초씩 최대 2번 더 기다렸다 frame 재취득 후 재확인(순간 로딩 지연 대응).
        let bodyLen = (await extractPostText(ctx).catch(() => "")).length;
        for (let rtry = 0; rtry < 2 && bodyLen < 10; rtry++) {
          log(`[공감·댓글] ${blogId} 본문 로딩 대기 후 재확인 ${rtry + 1}/2...`);
          await page.waitForTimeout(2500);
          frame = getFrame();
          ctx = frame ?? page as any;
          bodyLen = (await extractPostText(ctx).catch(() => "")).length;
        }
        // 그래도 본문을 못 읽으면 이 글만 건너뛰고 다음 글로(그 글 하나 때문에 방문 전체가 막히는 것 방지).
        if (bodyLen < 10) {
          await onResult?.({ keyword, blogId, postUrl: targetPost.url, liked: false, commented: false, status: "skip", message: "본문을 못 읽음(로딩 지연) — 다음 글로" });
          log(`[공감·댓글] ⏭ ${blogId} 본문 못 읽어 이 글 건너뜀`);
          onProgress?.(done, fail);
          if (postIndex < filtered.length - 1 && !stopSignal?.()) await page.waitForTimeout(humanDelay(delayMin, delayMax));
          continue;
        }

        // ★체류시간 엔진: 글 분량 읽어 실제 독서처럼 스크롤·머무름(즉시 이탈 방지). 속도 모드 반영.
        await readPostNaturally(page, ctx, log, readSpeed);

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
          if (aiFallbackActive) {
            // 이미 한도 소진으로 전환됨 → 순환 댓글 사용(AI 호출 안 함)
            const fb = pickFallbackComment(); comments.length = 0; comments.push(fb); commentIdx = 0;
            log(`[AI댓글] (순환 댓글) ${blogId}: "${fb}"`);
          } else {
            const postText = await extractPostText(ctx);
            const gen = await generateAiComment(geminiKey, commentTone, postText, log);
            if (gen) { comments.length = 0; comments.push(gen); commentIdx = 0; log(`[AI댓글] ${blogId}: "${gen}"`); }
            else if (__aiQuotaExhausted) {
              // ★한도 소진 → 지금부터 순환 댓글로 자동 전환(댓글이 끊기지 않게). 프론트가 감지할 특수 로그 + 안내.
              aiFallbackActive = true;
              log(`AI_FALLBACK::⚠️ Gemini 무료 한도 소진 — 지금부터 순환 댓글로 자동 전환합니다`);
              const fb = pickFallbackComment(); comments.length = 0; comments.push(fb); commentIdx = 0;
              log(`[AI댓글] (순환 댓글) ${blogId}: "${fb}"`);
            }
            else { rollComment = false; }
          }
        } else if (rollComment && comments.length === 0) {
          rollComment = false;
        }
        if (doLike && !rollLike) log(`[공감·댓글] ${blogId} 공감 건너뜀(확률 ${likeRate}%)`);
        if (doComment && !aiComment && comment.trim() && !rollComment) log(`[공감·댓글] ${blogId} 댓글 건너뜀(확률 ${commentRate}%)`);

        // ── 공감 클릭 ──
        //  ★실측(2026-08-23): 메인 공감버튼 = a.u_likeit_button._face. 안 눌렸으면 class에 'off', 누르면 'on'으로 바뀐다.
        //   (기존 "on 있고 off 없으면 눌림" 판정이 이 버튼과 안 맞아 공감이 안 눌렸음)
        if (rollLike) {
          try {
            const likeSels = [
              "a.u_likeit_button._face",   // 메인 공감 버튼(실측)
              "a.u_likeit_button",
              "a[data-clk*='like']",
              ".sympathy_toggle_btn",      // 구버전 폴백
              "a[class*='sympathy']",
            ];
            // off/on/aria-pressed로 현재 공감 상태 판정
            const likedState = (cls: string, pressed: string | null) => {
              if (pressed === "true") return true;
              if (/\boff\b/.test(cls)) return false;        // off 클래스 = 아직 공감 안 함
              return /\bon\b/.test(cls);                    // on 클래스 = 공감함
            };
            for (const sel of likeSels) {
              try {
                const el = await ctx.$(sel);
                if (!el) continue;
                const before = await ctx.evaluate((s: string) => {
                  const b = document.querySelector(s); if (!b) return null;
                  return { cls: b.className || "", pressed: b.getAttribute("aria-pressed") };
                }, sel);
                if (!before) continue;
                if (likedState(before.cls, before.pressed)) { liked = true; log(`[공감·댓글] ${blogId} 이미 공감됨`); break; }
                await scrollFrameElementIntoView(el);
                // force 클릭 + 좌표 폴백(오버레이·0x0 대응)
                try { await el.click({ force: true, timeout: 5000 }); }
                catch { const b = await el.boundingBox(); if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
                await page.waitForTimeout(1500);
                // off→on 전환(또는 aria-pressed=true) 확인. 안 바뀌면 한 번 더 클릭 시도.
                let after = await ctx.evaluate((s: string) => {
                  const b = document.querySelector(s); if (!b) return null;
                  return { cls: b.className || "", pressed: b.getAttribute("aria-pressed") };
                }, sel).catch(() => null);
                if (after && !likedState(after.cls, after.pressed)) {
                  try { await el.click({ force: true, timeout: 3000 }); } catch {}
                  await page.waitForTimeout(1200);
                  after = await ctx.evaluate((s: string) => { const b = document.querySelector(s); return b ? { cls: b.className || "", pressed: b.getAttribute("aria-pressed") } : null; }, sel).catch(() => null);
                }
                const ok = after ? likedState(after.cls, after.pressed) : false;
                if (ok) { liked = true; log(`[공감·댓글] ❤️ ${blogId} 공감 완료 (off→on 확인) · ${sel}`); break; }
                else { log(`[공감·댓글] ${blogId} 공감 클릭했으나 상태 전환 미확인(${sel}) — 다음 셀렉터 시도`); }
              } catch {}
            }
            if (!liked) {
              // ★진단: 실제 페이지에 어떤 공감 관련 버튼이 있는지 로그로 남긴다(실계정 실행 시 정확한 셀렉터 파악용)
              const diag = await ctx.evaluate(() => {
                const els = Array.from(document.querySelectorAll("a,button")).filter(e => {
                  const c = typeof e.className === "string" ? e.className : "";
                  const t = (e.textContent || "").replace(/\s+/g, "");
                  return /like|sympath|recomm|reaction/i.test(c) || /^공감/.test(t);
                });
                return els.slice(0, 6).map(e => `${e.tagName.toLowerCase()}.${(typeof e.className === "string" ? e.className : "").split(/\s+/).slice(0, 2).join(".")}[${(e.textContent || "").replace(/\s+/g, "").slice(0, 6)}]`).join(" / ");
              }).catch(() => "");
              likeReason = "공감 버튼 없음(막힘/비공개)";
              log(`[공감·댓글] ${blogId} 공감 버튼 못 찾음 · 페이지 내 공감 후보: ${diag || "(없음)"}`);
            }
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
            //  ★2026-08 실측: 메인 댓글 입력창은 contenteditable div(.u_cbox_text). 옛 textarea 셀렉터는 죽었지만 폴백으로 남겨둠.
            //   contenteditable엔 value 대입 불가 → 아래 humanType(키보드 입력)으로 처리.
            const commentSels = [
              ".u_cbox_text[contenteditable='true']",
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
          // ★품앗이 도배 방지: 댓글 단 글은 이력에 기록 → 다음엔 이 글 건너뛰고 과거 글로
          if (commented && onCommented && targetPost.logNo) onCommented(String(targetPost.logNo));
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

        onProgress?.(done, fail);

        // ★관련 글 1편 더 읽기(1사이클 = 이 대상 글 공감·댓글 + 같은 블로그 다른 글 1편 정독).
        //   각 대상 글 처리 직후 실행 → 대상 글 3개면 관련글도 최대 3번(테리 정의). 관련글엔 공감·댓글 안 함.
        //   매번=항상 1편 / 가끔=확률 60%. 이미 읽은 글은 빼고 골라 사이클마다 다른 글을 읽는다(여분 부족 시에만 스킵).
        if (readRelated && extraPool.length > 0 && !stopSignal?.() && (readRelatedMode === "always" || Math.random() < 0.6)) {
          const unread = extraPool.filter(p => !relRead.has(p.url));
          const pool = unread.length ? unread : extraPool;
          const relPost = pool[Math.floor(Math.random() * pool.length)];
          relRead.add(relPost.url);
          try {
            await page.waitForTimeout(humanDelay(delayMin, delayMax));
            log(`[관련글] 📖 ${blogId} — 다른 글 1편 더 읽기(공감·댓글 없음): ${relPost.url}`);
            await page.goto(relPost.url, { waitUntil: "domcontentloaded", timeout: 20000 });
            await page.waitForTimeout(1500);
            const relFrame = page.frames().find((f: any) => f.name() === "mainFrame")
              ?? page.frames().find((f: any) => f.url().includes("blog.naver.com")) ?? page;
            await readPostNaturally(page, relFrame as any, log, readSpeed);
          } catch (e: any) {
            log(`[관련글] ⏭ 추가 읽기 건너뜀 (${(e.message || "").slice(0, 30)})`);
          }
        }

        if (postIndex < filtered.length - 1 && done < dailyLimit && !stopSignal?.()) {
          const postDelay = humanDelay(delayMin, delayMax);
          log(`[공감·댓글] ⏱ 다음 글까지 ${(postDelay / 1000).toFixed(1)}초 대기...`);
          await page.waitForTimeout(postDelay);
        }
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
    // 공유 크롬(품앗이)이면 context만 닫아 창을 유지하고, 단독 실행이면 browser까지 닫는다.
    await context.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
  }
}

/* ── 공감·댓글용 완료 목록 경로 ── */
export function engageDonePath(accountId: string): string {
  return path.join(SESSION_DIR, `engage_done_${accountId}.json`);
}
