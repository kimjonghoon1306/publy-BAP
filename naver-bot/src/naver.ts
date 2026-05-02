import { chromium, BrowserContext } from "playwright";
import fs from "fs";
import path from "path";

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

async function applyAntiDetection(context: BrowserContext) {
  await context.addInitScript(ANTI_DETECTION_SCRIPT);
}

/* ── 네이버 로그인 + blogId 추출 ── */
export async function saveNaverSession(userId: string, id: string, pw: string): Promise<{ blogId: string }> {
  const browser = await chromium.launch({
    headless: false,
    args: LAUNCH_ARGS,
    slowMo: 50,
  });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();

  try {
    console.log("[naver] 로그인 페이지 진입...");
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);

    // ID/PW 입력 (evaluate 방식 - 봇 탐지 우회)
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

    // 로그인 완료 대기 (캡차/2FA 있으면 사용자가 직접 풂 - 최대 90초)
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

    // blogId 추출 - GoBlogWrite.naver 리다이렉트 방식 (100% 안정)
    console.log("[naver] blogId 추출 중...");
    let blogId: string | null = null;

    try {
      await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const finalUrl = page.url();
      const m = finalUrl.match(/[?&]blogId=([a-zA-Z0-9_-]+)/);
      if (m && m[1]) blogId = m[1];
    } catch {}

    // 폴백
    if (!blogId) {
      try {
        await page.goto("https://m.blog.naver.com", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);
        const m = page.url().match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !["PostList", "BlogHome"].includes(m[1])) blogId = m[1];
      } catch {}
    }

    if (!blogId) blogId = id;
    console.log(`[naver] ✅ blogId: ${blogId}`);

    const cookies = await context.cookies();
    fs.writeFileSync(sessionPath(userId), JSON.stringify({ loginId: id, blogId, cookies }, null, 2));
    await browser.close();
    return { blogId };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── 네이버 블로그 자동발행 (헤드리스) ── */
export async function publishNaver(params: {
  userId: string;
  title: string;
  content: string;
  tags: string[];
}): Promise<string> {
  const { userId, title, content, tags } = params;
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) throw new Error("네이버 세션 없음. 계정 재연결 필요");

  const { blogId, cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));

  const browser = await chromium.launch({
    headless: true,
    args: LAUNCH_ARGS,
  });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    // 1. PostWriteForm.naver로 직접 진입 (Redirect=Write 안 씀)
    const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`;
    console.log(`[naver] 글쓰기 진입: ${writeUrl}`);
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (page.url().includes("nidlogin") || page.url().includes("login.naver")) {
      fs.unlinkSync(sp);
      throw new Error("네이버 세션 만료. 계정 재연결 필요");
    }

    // 2. #mainFrame iframe 찾기
    console.log("[naver] mainFrame 로드 대기...");
    await page.waitForSelector("iframe#mainFrame, frame#mainFrame", { timeout: 30000 });
    await page.waitForTimeout(3000);
    const mainFrame = page.frameLocator("#mainFrame");

    // 3. "작성 중인 글 복원" 팝업 처리
    try {
      const popup = mainFrame.locator(".se-popup-button-cancel, button:has-text('취소')").first();
      await popup.click({ timeout: 3000 });
      console.log("[naver] 팝업 닫음");
    } catch {}

    // 4. 도움말 레이어 닫기
    try {
      const help = mainFrame.locator(".se-help-panel-close-button, button[aria-label='닫기']").first();
      if (await help.isVisible({ timeout: 1500 })) await help.click();
    } catch {}

    // 5. 에디터 로드 대기
    console.log("[naver] SmartEditor 로드 대기...");
    await mainFrame.locator(".se-section-documentTitle, .se_documentTitle").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 6. 제목 입력
    console.log("[naver] 제목 입력...");
    const titleEl = mainFrame.locator(".se-section-documentTitle .se-text-paragraph, .se-title-text [contenteditable='true']").first();
    await titleEl.click({ timeout: 10000 });
    await page.waitForTimeout(500);
    await page.keyboard.type(title, { delay: 30 });
    await page.waitForTimeout(800);

    // 7. 본문 입력
    console.log("[naver] 본문 입력...");
    const bodyEl = mainFrame.locator(".se-component-content .se-text-paragraph, .se-main-container .se-text-paragraph").first();
    await bodyEl.click({ timeout: 10000 });
    await page.waitForTimeout(500);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await page.keyboard.type(lines[i], { delay: 8 });
      if (i < lines.length - 1) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(50);
      }
    }
    await page.waitForTimeout(800);

    // 8. 발행 1단계
    console.log("[naver] 발행 버튼...");
    const publishBtn = mainFrame.locator("button[class*='publish_btn'], button:has-text('발행')").first();
    await publishBtn.click({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // 9. 태그 입력
    if (tags.length > 0) {
      try {
        const tagInput = mainFrame.locator("input.tag_input, input[placeholder*='태그']").first();
        await tagInput.click({ timeout: 5000 });
        for (const tag of tags.slice(0, 30)) {
          await tagInput.fill(tag);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(150);
        }
      } catch {}
    }

    // 10. 발행 2단계 (최종)
    console.log("[naver] 최종 발행...");
    try {
      const finalBtn = mainFrame.locator("button[class*='confirm_btn'], button[data-testid='seOnePublishBtn']").first();
      await finalBtn.click({ timeout: 10000 });
    } catch {
      await mainFrame.locator("button:has-text('발행')").last().click({ timeout: 10000 });
    }

    await page.waitForTimeout(5000);

    // URL 추출
    let postUrl = page.url();
    const viewMatch = postUrl.match(/blog\.naver\.com\/[^/]+\/(\d+)/) || postUrl.match(/logNo=(\d+)/);
    if (viewMatch) postUrl = `https://blog.naver.com/${blogId}/${viewMatch[1]}`;

    // 쿠키 갱신
    const newCookies = await context.cookies();
    const session = JSON.parse(fs.readFileSync(sp, "utf-8"));
    session.cookies = newCookies;
    fs.writeFileSync(sp, JSON.stringify(session, null, 2));

    await browser.close();
    console.log(`[naver] ✅ 발행 완료: ${postUrl}`);
    return postUrl;
  } catch (e: any) {
    // 디버그 스크린샷
    try {
      const debugDir = path.join(__dirname, "../debug");
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, `naver_error_${Date.now()}.png`), fullPage: true });
    } catch {}
    await browser.close().catch(() => {});
    throw e;
  }
}
