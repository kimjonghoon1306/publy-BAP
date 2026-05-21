import { chromium, BrowserContext } from "playwright";
import fs from "fs";
import path from "path";
import { getAccountCredentials } from "./supabase";

const SESSION_DIR = path.join(__dirname, "../sessions");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessionPath = (userId: string) => path.join(SESSION_DIR, `tistory_${userId}.json`);

export function tistorySessionExists(userId: string): boolean {
  return fs.existsSync(sessionPath(userId));
}

const ANTI_DETECTION_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US','en'] });
`;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function applyAntiDetection(context: BrowserContext) {
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
}

/* ── 티스토리 로그인 (카카오 OAuth) ── */
export async function saveTistorySession(
  userId: string, id: string, pw: string, blogName: string
): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS, slowMo: 50 });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.click(".btn_login.link_kakao_id, a:has-text('카카오')").catch(() => {});
    await page.waitForTimeout(2500);

    await page.fill("#loginId--1", id).catch(async () => {
      await page.fill("input[name='loginId']", id);
    });
    await page.waitForTimeout(400);
    await page.fill("#password--2", pw).catch(async () => {
      await page.fill("input[name='password']", pw);
    });
    await page.waitForTimeout(400);

    await page.click(".btn_confirm.btn_login, button.submit").catch(() => {});

    console.log("[tistory] 로그인 대기 중...");
    try {
      await page.waitForURL("**tistory.com/**", { timeout: 90000 });
    } catch {
      throw new Error("티스토리 로그인 시간 초과");
    }

    await page.waitForTimeout(2000);
    if (page.url().includes("login") || page.url().includes("accounts.kakao.com")) {
      throw new Error("티스토리 로그인 실패");
    }

    const cookies = await context.cookies();
    // 비밀번호 저장 (자동 재로그인용)
    fs.writeFileSync(sessionPath(userId), JSON.stringify({
      blogName,
      cookies,
      loginId: id,
      pw: Buffer.from(pw).toString("base64"),
    }, null, 2));
    await browser.close();
    console.log(`[tistory] ✅ 세션 저장 완료: ${blogName}`);
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 자동 재로그인 ── */
export async function reloginTistorySilent(userId: string): Promise<boolean> {
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) return false;

  const session = JSON.parse(fs.readFileSync(sp, "utf-8"));
  let loginId: string = session.loginId;
  let pw: string | null = null;

  if (session.pw) {
    try { pw = Buffer.from(session.pw, "base64").toString("utf-8"); } catch {}
  }
  if (!pw) {
    const creds = await getAccountCredentials(userId, "tistory").catch(() => null);
    if (creds) { loginId = creds.id; pw = creds.pw; }
  }
  if (!pw) { console.log("[tistory] 자동재로그인 실패: 비밀번호 없음"); return false; }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.click(".btn_login.link_kakao_id, a:has-text('카카오')").catch(() => {});
    await page.waitForTimeout(2000);

    await page.fill("#loginId--1", loginId).catch(async () => {
      await page.fill("input[name='loginId']", loginId);
    });
    await page.waitForTimeout(300);
    await page.fill("#password--2", pw).catch(async () => {
      await page.fill("input[name='password']", pw!);
    });
    await page.waitForTimeout(300);
    await page.click(".btn_confirm.btn_login, button.submit").catch(() => {});

    await page.waitForURL("**tistory.com/**", { timeout: 15000 });
    await page.waitForTimeout(1500);

    if (page.url().includes("login") || page.url().includes("accounts.kakao.com")) {
      await browser.close(); return false;
    }

    const cookies = await context.cookies();
    const oldSession = JSON.parse(fs.readFileSync(sp, "utf-8"));
    fs.writeFileSync(sp, JSON.stringify({ ...oldSession, cookies }, null, 2));
    await browser.close();
    console.log("[tistory] ✅ 자동 재로그인 성공");
    return true;
  } catch {
    await browser.close().catch(() => {});
    return false;
  }
}

/* ── 카테고리 목록 조회 ── */
export async function getTistoryCategories(
  userId: string
): Promise<{ id: string; name: string }[]> {
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) throw new Error("티스토리 세션 없음");

  const { blogName, cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));
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
      `https://${blogName}.tistory.com/manage/newpost/`,
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(3000);

    const categories: { id: string; name: string }[] = [];
    // #categoryId select 에서 옵션 읽기
    const catSels = [
      "#categoryId",
      "select[name='categoryId']",
      "select[id='category']",
      ".category-select select",
    ];
    for (const sel of catSels) {
      try {
        const opts = await page.$$(sel + " option");
        if (opts.length > 0) {
          for (const opt of opts) {
            const value = await opt.getAttribute("value");
            const text  = await opt.textContent();
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
    console.error("[tistory] 카테고리 조회 실패:", e);
    return [];
  }
}

/* ── 티스토리 자동발행 ── */
export async function publishTistory(params: {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  imageUrl?: string;
  categoryId?: string;
  visibility?: "public" | "private";
  scheduleTime?: string;
}): Promise<string> {
  const { userId, title, content, tags, imageUrl, categoryId, visibility = "public", scheduleTime } = params;
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) throw new Error("티스토리 세션 없음. 계정 재연결 필요");

  const { blogName, cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    const writeUrl = `https://${blogName}.tistory.com/manage/newpost/`;
    console.log(`[tistory] 글쓰기 진입: ${writeUrl}`);
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (page.url().includes("kakao.com") || page.url().includes("login")) {
      fs.unlinkSync(sp);
      throw new Error("티스토리 세션 만료. 재연결 필요");
    }

    await page.waitForTimeout(3000);

    // 임시저장 팝업 닫기
    try {
      const popup = page.locator(".btn-cancel:has-text('취소'), button:has-text('새로 작성')").first();
      if (await popup.isVisible({ timeout: 3000 })) await popup.click();
    } catch {}

    // 제목 입력
    console.log("[tistory] 제목 입력...");
    const titleInput = page.locator("#post-title-inp, input[name='title'], textarea[name='title']").first();
    await titleInput.waitFor({ timeout: 15000 });
    await titleInput.click();
    await titleInput.fill(title);
    await page.waitForTimeout(500);

    // 카테고리 선택
    if (categoryId) {
      console.log(`[tistory] 카테고리 선택: ${categoryId}`);
      try {
        const catSels = [
          "#categoryId",
          "select[name='categoryId']",
          "select[id='category']",
        ];
        for (const sel of catSels) {
          try {
            const el = await page.$(sel);
            if (el) {
              await page.selectOption(sel, categoryId);
              await page.waitForTimeout(400);
              console.log("[tistory] ✅ 카테고리 선택 완료");
              break;
            }
          } catch {}
        }
      } catch (e) { console.log("[tistory] 카테고리 선택 실패 (무시):", e); }
    }

    // HTML 모드 전환
    console.log("[tistory] HTML 모드 전환...");
    try {
      await page.click("#editor-mode-layer-btn-open, .btn-edit-mode", { timeout: 5000 });
      await page.waitForTimeout(800);
      await page.click("#editor-mode-html, [data-mode='html']", { timeout: 5000 });
      await page.waitForTimeout(800);
      await page.click(".btn-default.btn-confirm, button:has-text('확인')", { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
    } catch {
      console.warn("[tistory] HTML 모드 전환 실패, 기본 모드 진행");
    }

    // 본문 입력 (이미지 포함 HTML)
    console.log("[tistory] 본문 입력...");
    // 이미지가 있으면 맨 앞에 삽입
    const imgHtml = imageUrl
      ? `<img src="${imageUrl}" alt="${title}" style="width:100%;max-width:800px;height:auto;display:block;margin:0 auto 16px;"><br>\n`
      : "";
    const htmlContent = imgHtml + content.replace(/\n/g, "<br>");

    try {
      await page.evaluate((html) => {
        const editor = document.querySelector(".CodeMirror") as any;
        if (editor && editor.CodeMirror) { editor.CodeMirror.setValue(html); return true; }
        const ta = document.querySelector("textarea#html-editor, textarea.html-source") as HTMLTextAreaElement;
        if (ta) { ta.value = html; ta.dispatchEvent(new Event("input", { bubbles: true })); return true; }
        return false;
      }, htmlContent);
      await page.waitForTimeout(800);
    } catch {
      try {
        const editorFrame = page.frameLocator(".tox-edit-area iframe, iframe.tx_canvas_iframe").first();
        await editorFrame.locator("body").click({ timeout: 5000 });
        await page.keyboard.type(content, { delay: 5 });
      } catch {}
    }

    // 태그 입력
    if (tags.length > 0) {
      try {
        const tagInput = page.locator("#tagText, input[name='tag'], input.tagText").first();
        await tagInput.click({ timeout: 5000 });
        for (const tag of tags.slice(0, 30)) {
          await tagInput.fill(tag);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(150);
        }
      } catch {}
    }

    // 발행 레이어 열기
    console.log("[tistory] 발행 레이어 열기...");
    await page.click("#publish-layer-btn, button.btn-publish, button:has-text('완료'), button:has-text('발행')", { timeout: 10000 });
    await page.waitForTimeout(2000);

    // ── 공개 설정 ──
    console.log(`[tistory] 공개 설정: ${visibility}`);
    try {
      if (visibility === "private") {
        // 비공개
        await page.click("#open0, label[for='open0'], label:has-text('비공개')", { timeout: 5000 }).catch(() => {});
      } else {
        // 전체공개 (기본)
        await page.click("#open20, label[for='open20'], label:has-text('전체공개'), label:has-text('공개')", { timeout: 5000 }).catch(() => {});
      }
      await page.waitForTimeout(500);
    } catch (e) { console.log("[tistory] 공개 설정 실패 (무시):", e); }

    // ── 예약 발행 ──
    if (scheduleTime) {
      console.log(`[tistory] 예약 발행 설정: ${scheduleTime}`);
      try {
        // 예약 라디오/체크박스 선택
        await page.click(
          "#reserve, input[name='publishType'][value='reserve'], label:has-text('예약'), button:has-text('예약')",
          { timeout: 5000 }
        ).catch(() => {});
        await page.waitForTimeout(800);

        const dt = new Date(scheduleTime);
        const year  = dt.getFullYear().toString();
        const month = String(dt.getMonth() + 1).padStart(2, "0");
        const day   = String(dt.getDate()).padStart(2, "0");
        const hour  = String(dt.getHours()).padStart(2, "0");
        const min   = String(dt.getMinutes()).padStart(2, "0");

        // 날짜 입력
        const dateInput = await page.$(
          "#reserveDate, input[name='reserveDate'], input[placeholder*='날짜'], input[type='date']"
        );
        if (dateInput) {
          await dateInput.triple_click().catch(() => dateInput.click());
          await dateInput.fill(`${year}-${month}-${day}`);
          await page.waitForTimeout(300);
        }
        // 시간 입력
        const timeInput = await page.$(
          "#reserveTime, input[name='reserveTime'], #reserveHour, input[placeholder*='시간'], input[type='time']"
        );
        if (timeInput) {
          await timeInput.triple_click().catch(() => timeInput.click());
          await timeInput.fill(`${hour}:${min}`);
          await page.waitForTimeout(300);
        }
        console.log(`[tistory] ✅ 예약 날짜 설정: ${year}-${month}-${day} ${hour}:${min}`);
      } catch (e) { console.log("[tistory] 예약 설정 실패 (무시):", e); }
    }

    // ── 최종 발행 / 예약 확정 ──
    console.log("[tistory] 최종 발행...");
    if (scheduleTime) {
      try {
        await page.click(
          "button:has-text('예약 발행'), button:has-text('예약'), #reserve-btn, .btn-reserve-publish",
          { timeout: 8000 }
        );
      } catch {
        await page.locator("button:has-text('예약'), button:has-text('발행')").last().click({ timeout: 8000 }).catch(() => {});
      }
    } else {
      try {
        await page.click(
          "#publish-btn, button.btn-publish-confirm, .layer-btn-publish button:has-text('공개 발행'), button:has-text('발행')",
          { timeout: 10000 }
        );
      } catch {
        await page.locator("button:has-text('공개 발행'), button:has-text('발행')").last().click({ timeout: 10000 });
      }
    }

    await page.waitForTimeout(5000);

    let postUrl = `https://${blogName}.tistory.com`;
    if (!scheduleTime) {
      const m = page.url().match(/\/(\d+)(?:\?|$)/);
      if (m) postUrl = `https://${blogName}.tistory.com/${m[1]}`;
    }

    // 쿠키 갱신
    const newCookies = await context.cookies();
    const oldSession = JSON.parse(fs.readFileSync(sp, "utf-8"));
    fs.writeFileSync(sp, JSON.stringify({ ...oldSession, cookies: newCookies }, null, 2));

    await browser.close();
    console.log(`[tistory] ✅ ${scheduleTime ? "예약 완료" : "발행 완료"}: ${postUrl}`);
    return postUrl;
  } catch (e: any) {
    try {
      const debugDir = path.join(__dirname, "../debug");
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, `tistory_error_${Date.now()}.png`), fullPage: true });
    } catch {}
    await browser.close().catch(() => {});
    throw e;
  }
}
