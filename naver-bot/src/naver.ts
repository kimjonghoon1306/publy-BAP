import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SESSION_DIR = path.join(__dirname, "../sessions");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessionPath = (userId: string) => path.join(SESSION_DIR, `naver_${userId}.json`);

export function naverSessionExists(userId: string): boolean {
  return fs.existsSync(sessionPath(userId));
}

// 로그인 후 실제 블로그ID 추출 + 세션 저장
export async function saveNaverSession(userId: string, id: string, pw: string): Promise<{ blogId: string }> {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded" });
    await page.fill("#id", id);
    await page.fill("#pw", pw);
    await page.click(".btn_login");
    await page.waitForURL(url => !url.includes("nidlogin"), { timeout: 20000 });

    // 실제 블로그 ID 추출
    await page.goto("https://blog.naver.com/", { waitUntil: "networkidle" });

    let blogId = "";

    // 방법 1: 내 블로그 링크 href에서 추출
    try {
      const links = await page.$$eval("a[href*='blog.naver.com/']", els =>
        els.map(e => e.getAttribute("href") || "")
      );
      for (const href of links) {
        const match = href.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)(?:\/|$)/);
        if (match && match[1] && !["PostList", "search", "BlogTypeSelect"].includes(match[1])) {
          blogId = match[1];
          break;
        }
      }
    } catch { }

    // 방법 2: 내 블로그 클릭 후 URL
    if (!blogId) {
      try {
        await page.click("a:has-text('내 블로그')");
        await page.waitForTimeout(2000);
        const url = page.url();
        const match = url.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
        if (match) blogId = match[1];
      } catch { }
    }

    // 최후 수단: 로그인 ID 사용
    if (!blogId) blogId = id;

    console.log(`[naver] 로그인ID: ${id} / 블로그ID: ${blogId}`);

    const cookies = await context.cookies();
    fs.writeFileSync(sessionPath(userId), JSON.stringify({ loginId: id, blogId, cookies }, null, 2));
    return { blogId };
  } finally {
    await browser.close();
  }
}

// 네이버 블로그 자동발행 (클립보드 붙여넣기 방식)
export async function publishNaver(params: {
  userId: string;
  title: string;
  content: string;
  tags: string[];
}): Promise<string> {
  const { userId, title, content, tags } = params;
  const sp = sessionPath(userId);
  if (!fs.existsSync(sp)) throw new Error("네이버 세션 없음. 계정 연결 먼저 해주세요.");

  const { blogId, cookies } = JSON.parse(fs.readFileSync(sp, "utf-8"));

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    await page.goto(`https://blog.naver.com/${blogId}`, { waitUntil: "networkidle", timeout: 30000 });

    if (page.url().includes("nidlogin")) {
      fs.unlinkSync(sp);
      throw new Error("네이버 세션 만료. 계정을 다시 연결해주세요.");
    }

    await page.goto("https://blog.naver.com/PostWriteForm.naver", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const frame = page.frame("mainFrame");
    if (!frame) throw new Error("에디터 프레임을 찾을 수 없습니다.");

    // 제목 입력
    await frame.waitForSelector(".se-title-input", { timeout: 15000 });
    await frame.click(".se-title-input");
    await page.waitForTimeout(300);
    await page.evaluate((t) => navigator.clipboard.writeText(t), title);
    await frame.locator(".se-title-input").press("Control+v");
    await page.waitForTimeout(500);

    // 본문 클릭
    await frame.click(".se-content .se-component-content");
    await page.waitForTimeout(500);

    // 본문 클립보드 붙여넣기
    await page.evaluate((t) => navigator.clipboard.writeText(t), content);
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(1500);

    // 태그 입력
    if (tags.length > 0) {
      try {
        const tagInput = frame.locator("input[placeholder*='태그']").first();
        if (await tagInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await tagInput.fill(tags.join(" "));
          await page.keyboard.press("Enter");
        }
      } catch { }
    }

    // 발행 버튼
    await frame.click(".publish_btn, button:has-text('발행')");
    await page.waitForTimeout(2000);

    // 확인 팝업
    try {
      const confirmBtn = page.locator("button:has-text('발행하기'), button:has-text('확인')").first();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
      }
    } catch { }

    await page.waitForTimeout(3000);
    return page.url();
  } finally {
    await browser.close();
  }
}
