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
const googleSessionPath = (userId: string) => path.join(SESSION_DIR, `google_${userId}.json`);

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
  const { userId, title: rawTitle, content, tags, imageUrl, categoryId, visibility = "public", scheduleTime, blocks } = params;
  const title = rawTitle.slice(0, 100);
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
          await page.keyboard.type(title, { delay: 30 });
          await page.waitForTimeout(400);
          await page.keyboard.press("Tab");
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

    // ── 파일 업로드 헬퍼 (OS 파일 피커 다이얼로그 차단) ──
    const IMG_BTN_SELS = [
      "button[data-type='image']",
      ".se-toolbar-item-imageUpload button",
      "button[title='이미지']",
      "button[aria-label='이미지']",
      ".se-toolbar button[class*='image']",
    ];
    const PC_UPLOAD_SELS = [
      ".se-popup-button-upload-file",
      "button:has-text('내 PC에서')",
      "button:has-text('컴퓨터에서')",
      ".se-image-select-type-upload button",
    ];

    async function uploadFileToEditor(files: string | string[]): Promise<boolean> {
      const fileList = Array.isArray(files) ? files : [files];
      for (const sel of IMG_BTN_SELS) {
        try {
          const btn = await frame.$(sel) ?? await page.$(sel);
          if (!btn) continue;
          // filechooser 인터셉션 먼저 등록 → OS 다이얼로그 차단
          const chooserPromise = page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
          await btn.click();
          await page.waitForTimeout(1200);
          // 일부 SE4 버전은 모달 → "내 PC에서 올리기" 버튼 필요
          for (const pcSel of PC_UPLOAD_SELS) {
            try {
              const pcBtn = await frame.$(pcSel) ?? await page.$(pcSel);
              if (pcBtn) { await pcBtn.click(); await page.waitForTimeout(500); break; }
            } catch {}
          }
          const chooser = await chooserPromise;
          if (chooser) {
            await chooser.setFiles(fileList);
            await page.waitForTimeout(4000);
            return true;
          }
          // fallback: 숨겨진 file input 직접 세팅
          const fi = await page.$("input[type='file']") ?? await frame.$("input[type='file']");
          if (fi) { await fi.setInputFiles(fileList); await page.waitForTimeout(4000); return true; }
        } catch {}
      }
      return false;
    }

    // ── 이미지 삽입 (썸네일) ──
    if (imageUrl) {
      console.log("[naver] 이미지 삽입 시도...");
      const tmpFile = await downloadImageToTemp(imageUrl);
      if (tmpFile) {
        try {
          const ok = await uploadFileToEditor(tmpFile);
          if (ok) console.log("[naver] ✅ 썸네일 이미지 업로드 완료");
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
          await page.keyboard.type(lines[i], { delay: 30 });
        }
        if (i < lines.length - 1) {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(120);
          if (!lines[i].trim() && i + 1 < lines.length && lines[i + 1].trim()) {
            await page.keyboard.press("Enter");
            await page.waitForTimeout(80);
          }
        }
      }
    }

    // 이미지 업로드 헬퍼
    async function uploadImage(imgUrl: string, alt?: string) {
      const tmpFile = await downloadImageToTemp(imgUrl);
      if (!tmpFile) { console.log("[naver] 이미지 다운로드 실패:", imgUrl.slice(0,60)); return; }
      try {
        await clickEditor();
        await page.waitForTimeout(500);
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);

        const ok = await uploadFileToEditor(tmpFile);
        if (ok) {
          console.log("[naver] ✅ 이미지 업로드 완료");
          if (alt?.trim()) {
            try {
              await clickEditor();
              await page.keyboard.press("End");
              await page.keyboard.press("Enter");
              await insertText(alt.trim());
              console.log("[naver] ✅ 캡션 입력:", alt.trim());
            } catch {}
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
              const ok = await uploadFileToEditor([tmp1, tmp2]);
              if (ok) {
                console.log("[naver] ✅ 이미지 페어 업로드 완료");
                const pairAlt = pairImages[0].alt || pairImages[1].alt;
                if (pairAlt?.trim()) {
                  try {
                    await clickEditor();
                    await page.keyboard.press("End");
                    await page.keyboard.press("Enter");
                    await insertText(pairAlt.trim());
                  } catch {}
                }
              }
            } catch(e) { console.log("[naver] 페어 이미지 업로드 실패:", e); }
            finally {
              try { fs.unlinkSync(tmp1); } catch {}
              try { fs.unlinkSync(tmp2); } catch {}
            }
          }
        } else if (block.type === "image" && block.src) {
          if (block.src !== imageUrl) {
            await uploadImage(block.src, block.alt);
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

/* ── Google 세션 ── */
export function googleSessionExists(userId: string): boolean {
  return fs.existsSync(googleSessionPath(userId));
}

export async function saveGoogleSession(userId: string, email?: string, pw?: string): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS, slowMo: 60 });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();
  try {
    // 1단계: Google 로그인
    await page.goto("https://accounts.google.com/signin/v2/identifier", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    if (email) {
      const emailSel = "input[type='email'], input[name='identifier']";
      await page.waitForSelector(emailSel, { timeout: 10000 });
      await page.fill(emailSel, email);
      await page.waitForTimeout(600);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2500);
    }

    if (pw) {
      const pwSel = "input[type='password'], input[name='Passwd']";
      await page.waitForSelector(pwSel, { timeout: 12000 });
      await page.fill(pwSel, pw);
      await page.waitForTimeout(600);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
    }

    // 2단계: 2FA 등 추가 인증 대기 후 Flow 사이트로 이동
    console.log("[google] 로그인 후 Flow 사이트 접속 중...");
    await page.goto("https://labs.google/fx/ko/tools/image-fx", { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(3000);

    // 3단계: 아직 Google 로그인 페이지면 2FA 처리 대기 (최대 90초)
    if (page.url().includes("accounts.google.com")) {
      console.log("[google] 추가 인증 필요 — Chrome에서 직접 처리해주세요 (90초)");
      await page.waitForFunction(
        () => !location.hostname.includes("accounts.google.com"),
        { timeout: 90000 }
      );
      await page.waitForTimeout(2000);
    }

    // 4단계: 쿠키 저장
    const cookies = await context.cookies();
    fs.writeFileSync(googleSessionPath(userId), JSON.stringify({
      cookies,
      email: email || "",
    }, null, 2));
    await browser.close();
    console.log("[google] ✅ Google Flow 세션 저장 완료");
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── Google Flow 이미지 생성 ── */
export async function generateFlowImages(params: {
  userId: string;
  prompts: string[];
  captions: string[];
  onLog?: (msg: string) => void;
}): Promise<{src: string; alt: string}[]> {
  const { userId, prompts, captions, onLog } = params;
  const log = onLog || console.log;
  const results: {src: string; alt: string}[] = [];

  const gsp = googleSessionPath(userId);
  if (!fs.existsSync(gsp)) throw new Error("Google 세션 없음 — 계정 관리 탭에서 Google 로그인 먼저 해주세요");
  const googleSession = JSON.parse(fs.readFileSync(gsp, "utf-8"));

  const DOWNLOAD_DIR = path.join(__dirname, "../flow_downloads");
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    acceptDownloads: true,
  });

  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  `);
  await context.addCookies(googleSession.cookies);

  const page = await context.newPage();

  try {
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const caption = captions[i] || "";
      log(`🎨 [Flow] ${i + 1}/${prompts.length} 이미지 생성 중...`);

      await page.goto("https://labs.google/fx/ko/tools/image-fx", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(3000);

      // 로그인 확인
      const url = page.url();
      if (url.includes("accounts.google.com")) {
        throw new Error("Google 로그인이 필요합니다. 크롬에서 Google에 로그인해주세요.");
      }

      // 프롬프트 입력창 찾기
      const promptSelectors = [
        "textarea[placeholder*='image']",
        "textarea[placeholder*='이미지']",
        "textarea[aria-label*='prompt']",
        ".prompt-input textarea",
        "textarea",
      ];

      let promptInput = null;
      for (const sel of promptSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 5000 });
          promptInput = await page.$(sel);
          if (promptInput) break;
        } catch {}
      }

      if (!promptInput) {
        log(`⚠️ [Flow] 프롬프트 입력창 못 찾음 - 스킵`);
        continue;
      }

      // 프롬프트 입력
      await promptInput.click();
      await page.waitForTimeout(500);
      await page.keyboard.press("Meta+a");
      await page.keyboard.press("Backspace");
      await promptInput.type(prompt, { delay: 20 });
      await page.waitForTimeout(500);

      log(`  📝 프롬프트: ${prompt.slice(0, 60)}...`);

      // 생성 버튼 클릭
      const generateBtns = [
        "button[aria-label*='generate']",
        "button[aria-label*='생성']",
        "button:has-text('Create')",
        "button:has-text('Generate')",
        "button[type='submit']",
      ];

      for (const sel of generateBtns) {
        try {
          const btn = await page.$(sel);
          if (btn) { await btn.click(); break; }
        } catch {}
      }

      // 이미지 생성 대기 (최대 30초)
      log(`  ⏳ 이미지 생성 대기...`);
      await page.waitForTimeout(15000);

      // 생성된 이미지 다운로드
      const imgSelectors = [
        ".generated-image img",
        "[data-testid='generated-image'] img",
        ".image-result img",
        ".output-image img",
        "img[alt*='generated']",
      ];

      let downloaded = false;
      for (const sel of imgSelectors) {
        try {
          const imgs = await page.$$(sel);
          if (imgs.length > 0) {
            // 첫 번째 이미지 다운로드
            const downloadBtn = await page.$("[aria-label*='download'], button[title*='download'], .download-btn");
            if (downloadBtn) {
              const [download] = await Promise.all([
                page.waitForEvent("download", { timeout: 15000 }),
                downloadBtn.click(),
              ]);
              const filePath = path.join(DOWNLOAD_DIR, `flow_${Date.now()}_${i}.png`);
              await download.saveAs(filePath);
              results.push({ src: filePath, alt: caption });
              log(`  ✅ [Flow] 이미지 ${i + 1} 다운로드 완료`);
              downloaded = true;
              break;
            } else {
              // 다운로드 버튼 없으면 이미지 URL로 직접 저장
              const src = await imgs[0].getAttribute("src");
              if (src && src.startsWith("http")) {
                results.push({ src, alt: caption });
                log(`  ✅ [Flow] 이미지 ${i + 1} URL 저장`);
                downloaded = true;
                break;
              }
            }
          }
        } catch {}
      }

      if (!downloaded) {
        log(`  ⚠️ [Flow] 이미지 ${i + 1} 다운로드 실패 - 스킵`);
      }

      await page.waitForTimeout(2000);
    }

    await browser.close();
    log(`✅ [Flow] 전체 ${results.length}장 생성 완료`);
    return results;
  } catch (e: any) {
    await browser.close().catch(() => {});
    throw e;
  }
}
