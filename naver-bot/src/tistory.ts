import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SESSION_DIR = path.join(__dirname, "../sessions");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessionPath = (userId: string) => path.join(SESSION_DIR, `tistory_${userId}.json`);

export function tistorySessionExists(userId: string): boolean {
  return fs.existsSync(sessionPath(userId));
}

// 티스토리 세션 저장 — headless: false (창 띄워서 로그인)
export async function saveTistorySession(userId: string, id: string, pw: string, blogName: string): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded" });

    // 카카오 로그인
    const kakaoBtn = page.locator("a.btn_kakao, .login_kakao, a:has-text('카카오')");
    if (await kakaoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await kakaoBtn.click();
      await page.waitForTimeout(1500);
    }

    // 카카오 아이디/비번 입력
    await page.fill("#loginId, [name='loginKey']", id);
    await page.fill("#password, [name='password']", pw);
    await page.click("button[type='submit'], .btn_confirm, .btn_g.highlight");

    // 로그인 완료 대기
    await page.waitForURL(url => url.toString().includes("tistory.com") && !url.toString().includes("login"), { timeout: 20000 });

    const cookies = await context.cookies();
    fs.writeFileSync(sessionPath(userId), JSON.stringify({ blogName, cookies }, null, 2));
  } finally {
    await browser.close();
  }
}

// 티스토리 자동발행
export async function publishTistory(params: {
  userId: string;
  title: string;
  content: string;
  tags: string[];
}): Promise<string> {
  const { userId, title, content, tags } = params;
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) throw new Error("티스토리 세션 없음. 계정 연결 먼저 해주세요.");

  const { blogName, cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    const writeUrl = `https://${blogName}.tistory.com/manage/newpost/`;
    await page.goto(writeUrl, { waitUntil: "networkidle", timeout: 30000 });

    // 로그인 세션 만료 체크
    if (page.url().includes("login")) {
      fs.unlinkSync(sp);
      throw new Error("티스토리 세션 만료. 계정을 다시 연결해주세요.");
    }

    // iframe 진입
    const frame = page.frameLocator("#editor-tistory, iframe[id*='editor']");

    // 제목 입력
    await page.waitForSelector("#post-title-inp, .title-input, input[placeholder*='제목']", { timeout: 10000 });
    await page.fill("#post-title-inp, .title-input", title);

    // 기본 에디터 모드 (텍스트)
    try {
      const textModeBtn = page.locator("button:has-text('기본모드'), .btn-mode-basic");
      if (await textModeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await textModeBtn.click();
        await page.waitForTimeout(500);
      }
    } catch { /* 스킵 */ }

    // 본문 입력
    const editorArea = page.locator(".CodeMirror, .editor-area, textarea#content, .ProseMirror");
    await editorArea.first().click();
    await page.keyboard.type(content, { delay: 10 });

    // 태그 입력
    if (tags.length > 0) {
      try {
        const tagInput = page.locator("#tagText, .tag-input, input[placeholder*='태그']");
        await tagInput.fill(tags.join(","));
        await page.keyboard.press("Enter");
      } catch { /* 스킵 */ }
    }

    // 발행 버튼
    await page.click("button:has-text('완료'), .btn-publish, #publish-btn");
    await page.waitForTimeout(1500);

    // 발행 확인
    const confirmBtn = page.locator("button:has-text('공개 발행'), .btn-confirm-publish");
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await page.waitForTimeout(3000);
    return page.url();
  } finally {
    await browser.close();
  }
}
