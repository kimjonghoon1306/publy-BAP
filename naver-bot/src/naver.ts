import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SESSION_DIR = path.join(__dirname, "../sessions");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessionPath = (userId: string) => path.join(SESSION_DIR, `naver_${userId}.json`);

export function naverSessionExists(userId: string): boolean {
  return fs.existsSync(sessionPath(userId));
}

// 로그인 후 세션(쿠키) 저장 — headless: false (창 띄워서 로그인)
export async function saveNaverSession(userId: string, id: string, pw: string): Promise<void> {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded" });
    await page.fill("#id", id);
    await page.fill("#pw", pw);
    await page.click(".btn_login");
    await page.waitForURL(url => !url.includes("nidlogin"), { timeout: 20000 });
    const cookies = await context.cookies();
    fs.writeFileSync(sessionPath(userId), JSON.stringify(cookies, null, 2));
  } finally {
    await browser.close();
  }
}

// 네이버 블로그 자동발행
export async function publishNaver(params: {
  userId: string;
  title: string;
  content: string;
  tags: string[];
}): Promise<string> {
  const { userId, title, content, tags } = params;
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) throw new Error("네이버 세션 없음. 계정 연결 먼저 해주세요.");

  const cookies = JSON.parse(fs.readFileSync(sp, "utf-8"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    // 스마트에디터 글쓰기 페이지
    await page.goto("https://blog.naver.com/PostWriteForm.naver", { waitUntil: "networkidle", timeout: 30000 });

    // 로그인 세션 만료 체크
    if (page.url().includes("nidlogin")) {
      fs.unlinkSync(sp);
      throw new Error("네이버 세션 만료. 계정을 다시 연결해주세요.");
    }

    // iframe 안으로 진입
    const frameEl = page.frameLocator("#mainFrame");

    // 제목
    await frameEl.locator(".se-title-input").waitFor({ timeout: 15000 });
    await frameEl.locator(".se-title-input").click();
    await page.keyboard.type(title, { delay: 30 });

    // 본문 (스마트에디터 ONE)
    await frameEl.locator(".se-content .se-component").first().click();
    await page.keyboard.type(content, { delay: 10 });

    // 태그
    if (tags.length > 0) {
      try {
        await frameEl.locator(".se-tag-input").fill(tags.join(" "));
      } catch { /* 태그 없으면 스킵 */ }
    }

    // 발행 버튼 클릭
    await frameEl.locator("button.publish_btn, .btn_register").click();
    await page.waitForTimeout(2000);

    // 발행 확인 팝업
    const confirmBtn = page.locator("button:has-text('발행'), .btn_publish_ok");
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await page.waitForTimeout(3000);
    const postUrl = page.url();
    return postUrl;
  } finally {
    await browser.close();
  }
}
