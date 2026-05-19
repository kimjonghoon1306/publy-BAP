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
    const INVALID_IDS = ["PostList", "BlogHome", "FeedList", "neighborPostList", "TagList", "GoBlogWrite"];

    try {
      await page.goto("https://blog.naver.com/GoBlogWrite.naver", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const finalUrl = page.url();
      const m = finalUrl.match(/[?&]blogId=([a-zA-Z0-9_-]+)/);
      if (m && m[1] && !INVALID_IDS.includes(m[1])) blogId = m[1];
    } catch {}

    // 폴백 1: 모바일 블로그
    if (!blogId) {
      try {
        await page.goto("https://m.blog.naver.com", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);
        const m = page.url().match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !INVALID_IDS.includes(m[1])) blogId = m[1];
      } catch {}
    }

    // 폴백 2: 로그인 ID 직접 사용
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
    headless: false,
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
    // 1. PostWriteForm.naver로 직접 진입
    const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`;
    console.log(`[naver] 글쓰기 진입: ${writeUrl}`);
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (page.url().includes("nidlogin") || page.url().includes("login.naver")) {
      fs.unlinkSync(sp);
      throw new Error("네이버 세션 만료. 계정 재연결 필요");
    }

    // 2. 페이지 로드 대기
    console.log("[naver] 글쓰기 페이지 로드 대기...");
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // frame 객체 직접 획득
    const getFrame = () => {
      const frames = page.frames();
      return frames.find(f => f.name() === "mainFrame") 
        ?? frames.find(f => f.url().includes("blog.naver.com"))
        ?? frames[1] 
        ?? null;
    };
    
    let frame = getFrame();
    if (!frame) {
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        frame = getFrame();
        if (frame) break;
        console.log(`[naver] frame 재시도 ${i+1}/10...`);
      }
    }
    if (!frame) throw new Error("mainFrame을 찾을 수 없습니다");
    console.log("[naver] mainFrame 획득 성공!");

    // 3. "작성 중인 글 복원" 팝업 처리
    try {
      await frame.click(".se-popup-button-cancel", { timeout: 3000 });
      console.log("[naver] 복원 팝업 취소");
      await page.waitForTimeout(1000);
    } catch {}

    // 4. 도움말 레이어 닫기
    try {
      const helpVisible = await frame.isVisible(".se-help-panel-close-button");
      if (helpVisible) await frame.click(".se-help-panel-close-button", { timeout: 2000 });
    } catch {}

    // 5. SmartEditor 4.0 로드 완료 대기
    console.log("[naver] SmartEditor 로드 대기...");
    try {
      await frame.waitForSelector(".se-section-documentTitle, .se-editor, .se-container", { timeout: 40000 });
      console.log("[naver] SmartEditor 로드 완료!");
    } catch (e) {
      console.log("[naver] SmartEditor 셀렉터 못 찾음, 계속 진행...");
    }
    await page.waitForTimeout(3000);

    // ── clipboard 헬퍼: execCommand 방식으로 텍스트 주입 ──────────────────
    // SE4는 keyboard.type보다 execCommand('insertText') 가 훨씬 안정적
    const insertText = async (selector: string, text: string) => {
      await frame!.click(selector, { timeout: 10000 });
      await page.waitForTimeout(400);
      // 전체 선택 후 삽입
      await frame!.evaluate((t) => {
        const el = document.activeElement as HTMLElement;
        if (el) {
          el.focus();
          document.execCommand("selectAll", false);
          document.execCommand("insertText", false, t);
        }
      }, text);
      await page.waitForTimeout(600);
    };

    // 6. 제목 입력
    console.log("[naver] 제목 입력...");
    // SE4 제목 영역 셀렉터 (여러 버전 대응)
    const titleSel = [
      ".se-section-documentTitle .se-text-paragraph span[contenteditable='true']",
      ".se-section-documentTitle [contenteditable='true']",
      ".se-section-documentTitle .se-text-paragraph",
    ];
    let titleInserted = false;
    for (const sel of titleSel) {
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
          console.log(`[naver] 제목 입력 완료 (sel: ${sel})`);
          break;
        }
      } catch {}
    }
    if (!titleInserted) {
      // 최후 폴백: keyboard.type
      await frame.click(".se-section-documentTitle", { timeout: 5000 });
      await page.waitForTimeout(500);
      await page.keyboard.type(title, { delay: 40 });
    }

    // 7. 본문 입력
    console.log("[naver] 본문 입력...");
    // SE4 본문 첫 단락 셀렉터
    const bodySel = [
      ".se-section-text .se-text-paragraph span[contenteditable='true']",
      ".se-section-text [contenteditable='true']",
      ".se-main-container .se-section:not(.se-section-documentTitle) [contenteditable='true']",
      ".se-component-content [contenteditable='true']",
    ];
    let bodyInserted = false;
    for (const sel of bodySel) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await frame.click(sel, { timeout: 5000 });
          await page.waitForTimeout(500);
          // 본문은 줄바꿈 처리 필요 — 단락별로 Enter 입력
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim()) {
              await frame.evaluate((t) => {
                document.execCommand("insertText", false, t);
              }, lines[i]);
            }
            if (i < lines.length - 1) {
              await page.keyboard.press("Enter");
              await page.waitForTimeout(30);
            }
          }
          bodyInserted = true;
          console.log(`[naver] 본문 입력 완료 (sel: ${sel})`);
          break;
        }
      } catch {}
    }
    if (!bodyInserted) {
      // 최후 폴백
      await frame.click(".se-main-container", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.keyboard.type(content, { delay: 8 });
    }
    await page.waitForTimeout(1000);

    // 8. 발행 1단계 버튼
    console.log("[naver] 발행 버튼 클릭...");
    const publishSel = [
      "button.publish_btn__Y8C4q",
      "button[class*='publish_btn']",
      "button[data-testid='seOnePublishBtn']",
      "button:has-text('발행')",
    ];
    let published = false;
    for (const sel of publishSel) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await frame.click(sel, { timeout: 5000 });
          published = true;
          console.log(`[naver] 발행 버튼 클릭 완료 (sel: ${sel})`);
          break;
        }
      } catch {}
    }
    if (!published) throw new Error("발행 버튼을 찾을 수 없습니다");
    await page.waitForTimeout(2500);

    // 9. 태그 입력
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
          console.log(`[naver] 태그 ${tags.length}개 입력 완료`);
        }
      } catch (e) {
        console.log("[naver] 태그 입력 실패 (무시):", e);
      }
    }

    // 10. 최종 발행 (2단계)
    console.log("[naver] 최종 발행...");
    const finalSel = [
      "button.confirm_btn__xiHQQ",
      "button[class*='confirm_btn']",
      "button[data-testid='seOnePublishBtn']",
    ];
    let finalPublished = false;
    for (const sel of finalSel) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await frame.click(sel, { timeout: 8000 });
          finalPublished = true;
          break;
        }
      } catch {}
    }
    if (!finalPublished) {
      // 마지막 '발행' 버튼 클릭
      const btns = await frame.$$("button");
      for (const btn of btns.reverse()) {
        const txt = await btn.textContent();
        if (txt?.includes("발행")) { await btn.click(); finalPublished = true; break; }
      }
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
    console.error("[naver] ❌ 에러 발생:", e.message);
    // 디버그 스크린샷
    try {
      const debugDir = path.join(__dirname, "../debug");
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, `naver_error_${Date.now()}.png`), fullPage: true });
      console.log("[naver] 스크린샷 저장됨");
    } catch {}
    await browser.close().catch(() => {});
    throw e;
  }
}
