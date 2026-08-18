import { chromium, BrowserContext } from "playwright";
import fs from "fs";
import https from "https";
import http from "http";
import os from "os";
import path from "path";
import { deleteSession, hasSession, readSession, writeSession } from "./session-store";

const LEGACY_SESSION_DIRS = [path.join(__dirname, "../sessions")];

const naverSessionName = (userId: string) => `naver_${userId}`;
const googleSessionName = (userId: string) => `google_${userId}`;

export function naverSessionExists(userId: string): boolean {
  return hasSession(naverSessionName(userId), LEGACY_SESSION_DIRS);
}
export function deleteNaverSession(userId: string): void { deleteSession(naverSessionName(userId), LEGACY_SESSION_DIRS); }
export function deleteGoogleSession(userId: string): void { deleteSession(googleSessionName(userId), LEGACY_SESSION_DIRS); }

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
    // base64 data URL 처리 (AI 생성 이미지 — Replicate/DALL-E 등)
    if (url.startsWith("data:")) {
      const m = url.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if (!m) return null;
      const dext = m[1].includes("png") ? ".png" : m[1].includes("webp") ? ".webp" : ".jpg";
      const dtmp = path.join(os.tmpdir(), `publy_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${dext}`);
      fs.writeFileSync(dtmp, Buffer.from(m[2], "base64"));
      return dtmp;
    }
    const ext = url.includes(".png") ? ".png" : ".jpg";
    // 로컬 파일 경로면 바로 반환 (Flow 이미지)
    if (!url.startsWith("http")) {
      if (fs.existsSync(url)) return url;
      return null;
    }
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

    // 로그인 버튼 클릭 (네이버 개편: #loginBtn_row/#loginBtn_column, class btn_done, type=button — 옛 .btn_login 사라짐)
    let _loginClicked = false;
    for (const _sel of ["#loginBtn_row", "#loginBtn_column"]) {
      try { const _el = await page.$(_sel); if (_el && await _el.isVisible()) { await _el.click(); _loginClicked = true; break; } } catch {}
    }
    if (!_loginClicked) { try { await page.click(".btn_login", { timeout: 2000 }); _loginClicked = true; } catch {} }
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
    writeSession(naverSessionName(userId), {
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
  console.log("[naver] 자동재로그인 생략: 저장된 비밀번호 없음");
  return false;
}

/* ── 카테고리 목록 조회 ── */
export async function getNaverCategories(
  userId: string
): Promise<{ id: string; name: string }[]> {
  if (!naverSessionExists(userId)) throw new Error("네이버 세션 없음");
  const { blogId, cookies } = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS);
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
      `https://blog.naver.com/GoBlogWrite.naver?blogId=${blogId}`,
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

    // 발행 레이어 열기(상단 '발행' 버튼) — option_category가 뜰 때까지 재시도
    let panelReady = false;
    for (let attempt = 0; attempt < 4 && !panelReady; attempt++) {
      await frame.$$eval("button", (bs) => {
        const b = bs.find(x => (x.textContent||"").trim()==="발행" && /publish_btn/.test((x as HTMLElement).className))
          || bs.find(x => (x.textContent||"").trim()==="발행");
        if (b) (b as HTMLElement).click();
      }).catch(()=>{});
      try { await frame.waitForSelector("[class*='option_category']", { timeout: 6000 }); panelReady = true; } catch {}
    }
    if (!panelReady) { await browser.close(); return []; }

    // 카테고리 드롭다운 펼치기(selectbox_button)
    await frame.evaluate(() => {
      const oc = document.querySelector("[class*='option_category']");
      const btn = oc?.querySelector("button,[role='button']") as HTMLElement | null;
      if (btn) btn.click();
    }).catch(()=>{});
    await page.waitForTimeout(1500);

    // 라디오 목록에서 카테고리 추출: input id="{카테고리ID}_{이름}", data-testid="categoryBtn_{ID}"
    const categories: { id: string; name: string }[] = await frame.evaluate(() => {
      const oc = document.querySelector("[class*='option_category']");
      if (!oc) return [];
      const seen = new Set<string>();
      const list: { id: string; name: string }[] = [];
      oc.querySelectorAll("li input[type=radio]").forEach((inp) => {
        const el = inp as HTMLInputElement;
        const testid = el.getAttribute("data-testid") || "";           // categoryBtn_1
        const idm = testid.match(/categoryBtn_(\d+)/);
        const idAttr = el.id || "";                                     // 1_맛집 리뷰
        const id = idm ? idm[1] : (idAttr.split("_")[0] || "");
        const lbl = oc.querySelector(`label[for="${CSS.escape(el.id)}"] .text__sraQE, label[for="${CSS.escape(el.id)}"]`);
        const name = (lbl?.textContent || idAttr.replace(/^\d+_/, "") || "").trim();
        if (id && name && !seen.has(id)) { seen.add(id); list.push({ id, name }); }
      });
      return list;
    });
    await browser.close();
    return categories;
  } catch (e) {
    await browser.close().catch(() => {});
    console.error("[naver] 카테고리 조회 실패:", e);
    return [];
  }
}

/* ── 마커 및 영문 섞임 텍스트 정리 ── */
function cleanContent(text: string): string {
  return text
    .replace(/\[FAQ시작\][\s\S]*?\[FAQ끝\]/g, "")
    .replace(/\[참고자료시작\][\s\S]*?\[참고자료끝\]/g, "")
    .replace(/\[관련글시작\][\s\S]*?\[관련글끝\]/g, "")
    .replace(/\[[^\]]*\]/g, "")        // 나머지 [마커] 제거
    // 자주 쓰이는 영문 → 한국어 표기 변환
    .replace(/\bQ(\d+)\s*:/g, "Q$1.")   // Q1: → Q1.
    .replace(/\bA(\d+)\s*:/g, "A$1.")   // A1: → A1.
    .replace(/\bFAQ\b/g, "자주 묻는 질문")
    .replace(/\bTIP\b/gi, "팁")
    .replace(/\bNOTE\b/gi, "참고")
    .replace(/\n{3,}/g, "\n\n")        // 3줄 이상 공백 → 2줄로
    .trim();
}

/* ── 네이버 블로그 자동발행 ── */
export async function publishNaver(params: {
  userId: string;
  title: string;
  content: string;
  pubScope?: "body" | "faq" | "full";
  tags: string[];
  imageUrl?: string;
  categoryId?: string;
  visibility?: "public" | "neighbor" | "private";
  scheduleTime?: string;
  blocks?: Array<{type: string; content?: string; src?: string; alt?: string; link?: string}>;
  videoUrl?: string;
  videoPosition?: "top" | "middle" | "bottom";
}): Promise<string> {
  const { userId, title: rawTitle, content, pubScope = "full", tags, imageUrl, categoryId, visibility = "public", scheduleTime, blocks, videoUrl, videoPosition = "middle" } = params;
  const title = rawTitle.replace(/\n/g, " ").trim().slice(0, 40);

  // pubScope에 따라 블록 필터링 + 마커 제거
  const processedBlocks = (blocks || []).map(b => {
    if (b.type !== "text") return b;
    const text = b.content || "";
    if (pubScope === "body" && /\[FAQ시작\]|\[참고자료시작\]|\[관련글시작\]/.test(text)) return null;
    if (pubScope === "faq" && /\[참고자료시작\]|\[관련글시작\]/.test(text)) return null;
    return { ...b, content: cleanContent(text) };
  }).filter(Boolean) as typeof blocks;

  const cleanedContent = cleanContent(content);
  if (!naverSessionExists(userId)) throw new Error("네이버 세션 없음. 계정 재연결 필요");
  const { blogId, cookies } = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS);

  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
  });
  await applyAntiDetection(context);
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    const writeUrl = `https://blog.naver.com/GoBlogWrite.naver?blogId=${blogId}`;
    console.log(`[naver] 글쓰기 진입: ${writeUrl}`);
    await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (page.url().includes("nidlogin") || page.url().includes("login.naver")) {
      deleteSession(naverSessionName(userId), LEGACY_SESSION_DIRS);
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
    // 제목 클릭 후 입력
    try {
      await frame.click(".se-section-documentTitle", { timeout: 5000 });
    } catch {
      await frame.click(".se-main-container", { timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(500);
    await page.keyboard.type(title, { delay: 30 });
    await page.waitForTimeout(600);

    // 본문으로 이동 1순위: Enter (SE4 표준 - 제목에서 Enter → 본문 이동)
    console.log("[naver] 본문 영역으로 이동...");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);

    // 이동됐는지 확인
    const stillInTitle = await frame.evaluate(() => {
      const el = document.activeElement;
      return !!document.querySelector(".se-section-documentTitle")?.contains(el);
    }).catch(() => false);
    if (stillInTitle) {
      // 2순위: frame.click으로 본문 contenteditable 직접 클릭
      try {
        await frame.click(".se-section:not(.se-section-documentTitle) [contenteditable='true']", { timeout: 3000, force: true });
        await page.waitForTimeout(400);
      } catch {
        // 3순위: 마우스로 제목 아래 클릭
        const titleEl = await frame.$(".se-section-documentTitle").catch(() => null);
        if (titleEl) {
          const box = await titleEl.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height + 100);
            await page.waitForTimeout(400);
          }
        }
      }
    }
    await page.waitForTimeout(300);

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

    // ── 커서를 문서 맨 끝(마지막 블록의 끝)으로 확실히 이동 ──
    //   기존 Meta+End 단독은 Mac에서 '스크롤'만 하고 커서를 안 옮겨 글/이미지가 중간에 끼어들던 근본 버그를 잡음.
    async function moveCursorToEnd() {
      // 마지막 편집영역(가장 아래 contenteditable)을 실제 클릭 → 커서가 문서 끝으로.
      //   ⚠️ frame.evaluate(Selection API)는 이미지 업로드 직후 실제 브라우저에서 무한 대기/페이지 닫힘을
      //   유발(headless에선 재현 안 됨, 실측으로 확인). Meta+End(Mac)도 페이지 닫힘 유발. → 클릭 방식만 사용.
      const bodySels = [
        ".se-section-text:last-of-type [contenteditable='true']",
        ".se-main-container .se-section:not(.se-section-documentTitle):last-of-type [contenteditable='true']",
        ".se-section-text [contenteditable='true']",
        ".se-main-container .se-section:not(.se-section-documentTitle) [contenteditable='true']",
      ];
      for (const sel of bodySels) {
        try {
          const els = await frame.$$(sel);
          if (els.length) { await els[els.length - 1].click({ timeout: 3000 }); await page.waitForTimeout(120); return; }
        } catch {}
      }
      await frame.click(".se-main-container", { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(120);
    }

    // 텍스트 블록 입력 헬퍼
    //   spacerBefore=true면 앞 내용과 사이에 빈 줄 하나를 먼저 넣어 문단이 붙지 않게(모바일 가독성)
    let anyBodyWritten = false;
    async function insertText(text: string, spacerBefore = false) {
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

      await moveCursorToEnd();
      await page.waitForTimeout(200);
      // 앞 문단/이미지와 사이에 빈 줄 하나 → 문단이 딱 붙지 않게(모바일 가독성)
      //   블록 사이도 "엔터 2번(빈 줄 하나)"으로 통일 — 블록 안 문단 간격과 동일하게 숨통 트이게.
      if (spacerBefore && anyBodyWritten) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(120);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(120);
      }
      const lines = plain.split("\n").filter(l => l.trim().length > 0); // 빈 줄 정리 후 균일 간격 적용
      for (let i = 0; i < lines.length; i++) {
        // delay를 높여 SE4가 붙여넣기가 아닌 진짜 타이핑으로 인식
        await page.keyboard.type(lines[i], { delay: 80 });
        await page.waitForTimeout(100);
        anyBodyWritten = true;
        if (i < lines.length - 1) {
          // 문단 사이: Enter 2번(빈 줄 하나) → 줄글이 빽빽하지 않게
          await page.keyboard.press("Enter");
          await page.waitForTimeout(120);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(120);
        }
      }
    }

    // ★ 올린 이미지의 "네이버 전용 캡션칸"에 설명 직접 입력 (실측 DOM: .se-caption / placeholder "사진 설명을 입력하세요.")
    //   fromEnd=0 이면 가장 최근 이미지, 1이면 그 앞 이미지(페어의 첫 장 등)
    async function fillLastImageCaption(text: string, fromEnd: number = 0): Promise<boolean> {
      const cap = (text || "").trim();
      if (!cap) return false;
      try {
        // 대상 이미지 컴포넌트 선택
        const comps = await frame.$$(".se-component.se-image");
        const comp = comps[comps.length - 1 - fromEnd];
        if (!comp) return false;
        await comp.scrollIntoViewIfNeeded().catch(() => {});
        // ★ 이미지를 먼저 클릭해 컴포넌트 활성화 → 빈 캡션(height 0)이 열림 (실측 확인)
        const imgRes = await comp.$(".se-image-resource") ?? await comp.$("img");
        if (imgRes) { await imgRes.click({ force: true }).catch(() => {}); await page.waitForTimeout(500); }
        // 캡션 문단 클릭 → 타이핑 (force 실패 시 좌표 클릭 폴백)
        const capMod = await comp.$(".se-caption");
        if (!capMod) return false;
        const p = await capMod.$(".se-text-paragraph") ?? capMod;
        try { await p.click({ timeout: 5000, force: true }); }
        catch { const r = await p.boundingBox(); if (r) await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
        await page.waitForTimeout(300);
        await page.keyboard.type(cap, { delay: 25 });
        await page.waitForTimeout(200);
        return true;
      } catch { return false; }
    }

    // 이미지 업로드 헬퍼
    // ★ 마지막 이미지에 링크 걸기(온파트너 배너 클릭 → 쇼핑몰). 실측 DOM: .se-link-toolbar-button + .se-custom-layer-link-input
    async function linkLastImage(url: string): Promise<boolean> {
      const link = (url || "").trim();
      if (!/^https?:\/\//.test(link)) return false;
      try {
        const comps = await frame.$$(".se-component.se-image");
        const comp = comps[comps.length - 1];
        if (!comp) return false;
        await comp.scrollIntoViewIfNeeded().catch(() => {});
        const imgRes = await comp.$(".se-image-resource") ?? await comp.$("img");
        if (imgRes) { await imgRes.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
        // 이미지 링크 버튼 클릭
        const btnClicked = await frame.evaluate(() => {
          const b = document.querySelector(".se-link-toolbar-button") as HTMLElement | null;
          if (b) { b.click(); return true; } return false;
        });
        if (!btnClicked) return false;
        await page.waitForTimeout(600);
        // URL 입력칸에 입력
        const input = await frame.$(".se-custom-layer-link-input");
        if (!input) return false;
        await input.click({ force: true }).catch(() => {});
        await input.fill(link).catch(async () => { await page.keyboard.type(link, { delay: 15 }); });
        await page.waitForTimeout(300);
        // ★확인은 Enter가 아니라 "링크 입력" 적용 버튼 클릭이어야 실제로 걸린다(실측 확인).
        let applied = await frame.evaluate(() => {
          const b = document.querySelector(".se-custom-layer-link-apply-button") as HTMLElement | null;
          if (b) { b.click(); return true; } return false;
        });
        if (!applied) { await page.keyboard.press("Enter"); }  // 폴백
        await page.waitForTimeout(600);
        // 검증: 이미지가 링크로 감싸졌는지 확인(안 됐으면 실패 반환)
        const ok = await frame.evaluate(() => {
          const comp = [...document.querySelectorAll(".se-component.se-image")].pop();
          return !!(comp && comp.querySelector("a[href]"));
        });
        return ok;
      } catch { return false; }
    }
    // ★ 마지막 이미지 가운데 정렬
    async function centerLastImage(): Promise<void> {
      try {
        const comps = await frame.$$(".se-component.se-image");
        const comp = comps[comps.length - 1];
        if (!comp) return;
        const imgRes = await comp.$(".se-image-resource") ?? await comp.$("img");
        if (imgRes) { await imgRes.click({ force: true }).catch(() => {}); await page.waitForTimeout(300); }
        await frame.evaluate(() => {
          const btn = [...document.querySelectorAll("button")].find(b => /가운데 정렬/.test(b.getAttribute("aria-label") || "")) as HTMLElement | null;
          if (btn) btn.click();
        });
        await page.waitForTimeout(300);
      } catch {}
    }

    async function uploadImage(imgUrl: string, alt?: string, link?: string) {
      const tmpFile = await downloadImageToTemp(imgUrl);
      if (!tmpFile) { console.log("[naver] 이미지 다운로드 실패:", imgUrl.slice(0,60)); return; }
      try {
        await moveCursorToEnd();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);

        const ok = await uploadFileToEditor(tmpFile);
        if (ok) {
          console.log("[naver] ✅ 이미지 업로드 완료");
          // 가운데 정렬(항상)
          await centerLastImage();
          if (alt?.trim()) {
            // 네이버 전용 캡션칸에만 입력(★밖 문단 폴백 제거 — 캡션이 본문 밖으로 새지 않게)
            const capOk = await fillLastImageCaption(alt.trim());
            console.log(capOk ? "[naver] ✅ 이미지 캡션 입력: " + alt.trim() : "[naver] ⚠️ 캡션칸 못찾음(캡션 생략)");
          }
          // 온파트너 배너 등: 이미지에 링크 걸기(클릭 시 쇼핑몰)
          if (link?.trim()) {
            const linkOk = await linkLastImage(link.trim());
            console.log(linkOk ? "[naver] ✅ 이미지 링크 연결: " + link.trim() : "[naver] ⚠️ 이미지 링크 연결 실패");
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

    // ── 영상 임베드 헬퍼 ──
    //   네이버 블로그는 본문에 유튜브/네이버TV URL을 타이핑+Enter하면 자동 임베드됨(실측 확인).
    async function embedVideo(url: string) {
      const u = (url || "").trim();
      if (!u || !/^https?:\/\//.test(u)) return;
      try {
        console.log(`[naver] 영상 임베드: ${u.slice(0, 60)}`);
        await moveCursorToEnd();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(200);
        await page.keyboard.type(u, { delay: 40 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3500); // 임베드 변환 대기
        console.log("[naver] ✅ 영상 임베드 완료");
      } catch (e: any) {
        console.log("[naver] 영상 임베드 실패(무시):", e.message);
      }
    }

    // 영상을 상단에 넣는 경우: 본문 시작 전에 먼저
    if (videoUrl && videoPosition === "top") await embedVideo(videoUrl);

    // 영상 middle 위치용: 텍스트 블록 중간 지점 계산
    const totalTextBlocks = (processedBlocks || []).filter(b => b.type === "text").length;
    const videoMidPoint = Math.max(1, Math.floor(totalTextBlocks / 2));
    let textSeen = 0, videoMidDone = false;

    // processedBlocks(필터링+마커제거) 사용, 없으면 cleanedContent
    if (processedBlocks && processedBlocks.length > 0) {
      for (const block of processedBlocks) {
        if (block.type === "text" && block.content) {
          await insertText(block.content, true); // 앞 블록과 빈 줄 간격
          await page.waitForTimeout(200);
          // 영상 middle: 중간 문단 뒤에 삽입
          if (videoUrl && videoPosition === "middle" && !videoMidDone) {
            textSeen++;
            if (textSeen >= videoMidPoint) { await embedVideo(videoUrl); videoMidDone = true; }
          }
        } else if (block.type === "image-pair" && (block as any).images?.length >= 2) {
          // 2장 동시 업로드 → 한 줄 나란히 배치
          const pairImages = (block as any).images as {src:string;alt:string}[];
          const tmp1 = await downloadImageToTemp(pairImages[0].src);
          const tmp2 = await downloadImageToTemp(pairImages[1].src);
          if (tmp1 && tmp2) {
            try {
              await moveCursorToEnd();
              await page.keyboard.press("Enter");
              await page.waitForTimeout(500);
              const ok = await uploadFileToEditor([tmp1, tmp2]);
              if (ok) {
                console.log("[naver] ✅ 이미지 페어 업로드 완료");
                // 두 장 각각의 캡션칸에 입력 (fromEnd 0=둘째장, 1=첫째장)
                let capDone = false;
                if (pairImages[1].alt?.trim()) capDone = await fillLastImageCaption(pairImages[1].alt.trim(), 0) || capDone;
                if (pairImages[0].alt?.trim()) capDone = await fillLastImageCaption(pairImages[0].alt.trim(), 1) || capDone;
                // 캡션칸을 못 찾으면 문단 폴백
                if (!capDone) {
                  const pairAlt = pairImages[0].alt || pairImages[1].alt;
                  if (pairAlt?.trim()) {
                    try { await moveCursorToEnd(); await page.keyboard.press("Enter"); await insertText(pairAlt.trim()); } catch {}
                  }
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
            await uploadImage(block.src, block.alt, (block as any).link);
          }
        }
      }
    } else {
      // fallback: blocks 없으면 cleanedContent 입력
      await insertText(cleanedContent);
    }

    // 영상 bottom(끝) + middle이 못 들어간 경우(텍스트 적음) 폴백으로 끝에 삽입
    if (videoUrl && (videoPosition === "bottom" || (videoPosition === "middle" && !videoMidDone))) {
      await embedVideo(videoUrl);
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

    // ── 카테고리 선택 (SmartEditor ONE: option_category 안의 라디오 목록) ──
    if (categoryId) {
      console.log(`[naver] 카테고리 선택: ${categoryId}`);
      try {
        // 발행 레이어의 카테고리 영역 대기
        try { await frame.waitForSelector("[class*='option_category']", { timeout: 6000 }); } catch {}
        // 드롭다운 펼치기
        await frame.evaluate(() => {
          const oc = document.querySelector("[class*='option_category']");
          const btn = oc?.querySelector("button,[role='button']") as HTMLElement | null;
          if (btn) btn.click();
        });
        await page.waitForTimeout(800);
        // categoryId(숫자)와 일치하는 라디오/라벨 클릭 (data-testid=categoryBtn_{id} 또는 input id="{id}_이름")
        const done = await frame.evaluate((cid: string) => {
          const oc = document.querySelector("[class*='option_category']");
          if (!oc) return false;
          const radios = Array.from(oc.querySelectorAll("li input[type=radio]")) as HTMLInputElement[];
          const match = radios.find(r => {
            const t = r.getAttribute("data-testid") || "";
            const m = t.match(/categoryBtn_(\d+)/);
            const idFromTest = m ? m[1] : "";
            const idFromId = (r.id || "").split("_")[0];
            return idFromTest === cid || idFromId === cid;
          });
          if (!match) return false;
          const label = oc.querySelector(`label[for="${CSS.escape(match.id)}"]`) as HTMLElement | null;
          (label || match).click();
          return true;
        }, categoryId);
        await page.waitForTimeout(500);
        console.log(done ? "[naver] ✅ 카테고리 선택 완료" : "[naver] ⚠️ 일치 카테고리 못찾음(ID:" + categoryId + ")");
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
    const session = readSession<any>(naverSessionName(userId), LEGACY_SESSION_DIRS);
    session.cookies = newCookies;
    writeSession(naverSessionName(userId), session);

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
  return hasSession(googleSessionName(userId), LEGACY_SESSION_DIRS);
}

export async function saveGoogleSession(userId: string, email?: string, pw?: string): Promise<void> {
  const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR",
  });
  await applyAntiDetection(context);
  const page = await context.newPage();
  try {
    console.log("[google] Chrome이 열립니다. Google로 직접 로그인해주세요.");
    await page.goto("https://labs.google/fx/ko/tools/flow", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 로그인 완료까지 대기 (최대 3분) - 로그인 버튼이 사라지면 완료
    console.log("[google] 로그인 대기 중... (Chrome에서 직접 로그인 후 3분 이내 완료)");
    await page.waitForFunction(
      () => {
        // 로그인 버튼이 없어지면 완료
        const btn = document.querySelector("button");
        const hasLoginBtn = btn && (btn.textContent?.includes("로그인") || btn.textContent?.includes("Sign in"));
        return !hasLoginBtn || document.querySelector("[data-testid='user-avatar'], .user-menu, img[alt*='profile']");
      },
      { timeout: 180000 }
    ).catch(() => {
      console.log("[google] ⚠️ 로그인 대기 시간 초과 - 현재 상태로 저장");
    });
    await page.waitForTimeout(3000);

    // 3단계: 로그인 후 storageState 전체 저장 (쿠키 + localStorage + sessionStorage)
    const saved = await context.storageState();
    writeSession(googleSessionName(userId), saved);

    await browser.close();
    console.log("[google] ✅ Google Flow 세션 저장 완료 (storageState)");
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── Flow 이미지 프롬프트 → SEO 캡션 변환 ── */
function captionFromPrompt(prompt: string, idx: number, total: number): string {
  // 프롬프트에서 "제목" 형태로 키워드 추출
  const titleMatch = prompt.match(/"([^"]+)"/);
  const keyword = titleMatch ? titleMatch[1] : prompt.split(",")[0].replace(/^A\s+\w+\s+\w+\s+\w+\s+/i, "").trim();
  const p = prompt.toLowerCase();
  let style = "";
  if (p.includes("food") || p.includes("gourmet") || p.includes("cuisine")) style = "음식 스타일링 사진";
  else if (p.includes("travel") || p.includes("landscape") || p.includes("scenic")) style = "여행 풍경 사진";
  else if (p.includes("financial") || p.includes("business") || p.includes("workspace")) style = "비즈니스 컨셉 사진";
  else if (p.includes("technology") || p.includes("tech") || p.includes("device")) style = "기술 컨셉 사진";
  else if (p.includes("interior") || p.includes("home") || p.includes("decor")) style = "인테리어 스타일 사진";
  else if (p.includes("health") || p.includes("fitness") || p.includes("wellness")) style = "건강 라이프스타일 사진";
  else if (p.includes("fashion") || p.includes("outfit") || p.includes("style")) style = "패션 스타일 사진";
  else if (p.includes("car") || p.includes("vehicle") || p.includes("automotive")) style = "자동차 사진";
  else if (p.includes("sport") || p.includes("athlete") || p.includes("action")) style = "스포츠 액션 사진";
  else if (p.includes("beauty") || p.includes("skincare") || p.includes("cosmetic")) style = "뷰티 사진";
  else if (p.includes("nature") || p.includes("outdoor") || p.includes("garden")) style = "자연 풍경 사진";
  else if (p.includes("family") || p.includes("baby") || p.includes("child")) style = "가족 사진";
  else if (p.includes("pet") || p.includes("dog") || p.includes("cat")) style = "반려동물 사진";
  else if (p.includes("education") || p.includes("study") || p.includes("book")) style = "교육 컨셉 사진";
  else if (p.includes("wedding") || p.includes("couple") || p.includes("romance")) style = "웨딩 사진";
  else style = "관련 사진";
  return total > 1 ? `${keyword} ${style} (${idx + 1}/${total})` : `${keyword} ${style}`;
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

  if (!googleSessionExists(userId)) throw new Error("Google 세션 없음 — 계정 관리 탭에서 Google 로그인 먼저 해주세요");
  const googleSession = readSession<any>(googleSessionName(userId), LEGACY_SESSION_DIRS);

  const DOWNLOAD_DIR = path.join(__dirname, "../flow_downloads");
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  // storageState 방식으로 로드 (쿠키+localStorage+sessionStorage 전체)
  const hasStorageState = googleSession.origins !== undefined;
  const context = await browser.newContext({
    ...(hasStorageState ? { storageState: googleSession } : {}),
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    acceptDownloads: true,
  });

  await applyAntiDetection(context);
  // 구버전 세션(쿠키만 있는 경우) 호환
  if (!hasStorageState && googleSession.cookies?.length) {
    await context.addCookies(googleSession.cookies);
  }
  const page = await context.newPage();

  // ── 헬퍼: Google 로그인 처리 ──
  async function handleGoogleLogin() {
    const email = googleSession.email || "";
    const pw = googleSession.pw ? Buffer.from(googleSession.pw, "base64").toString("utf-8") : "";

    // 로그인 버튼 클릭 (텍스트 다양하게 시도)
    const loginBtnSels = [
      "button:has-text('로그인')",
      "button:has-text('Google 계정으로 로그인')",
      "button:has-text('Sign in with Google')",
      "button:has-text('Sign in')",
      "a:has-text('로그인')",
      "a:has-text('Google 계정으로 로그인')",
      "[aria-label*='Sign in']",
      "[aria-label*='로그인']",
    ];
    let clicked = false;
    for (const sel of loginBtnSels) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          log("[Flow] Google 로그인 버튼 클릭...");
          // 팝업 대기
          const popupPromise = page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null);
          await btn.click();
          await page.waitForTimeout(2000);
          const popup = await popupPromise;
          if (popup) {
            await popup.waitForLoadState("domcontentloaded");
            await popup.waitForTimeout(1500);
            if (email) {
              const emailInput = await popup.$("input[type='email'], input[name='identifier']").catch(() => null);
              if (emailInput) {
                await emailInput.fill(email);
                await popup.keyboard.press("Enter");
                await popup.waitForTimeout(2500);
              }
            }
            if (pw) {
              const pwInput = await popup.$("input[type='password'], input[name='Passwd']").catch(() => null);
              if (pwInput) {
                await pwInput.fill(pw);
                await popup.keyboard.press("Enter");
                await popup.waitForTimeout(3000);
              }
            }
            // 팝업 닫힐 때까지 대기
            await popup.waitForEvent("close", { timeout: 60000 }).catch(() => {});
          }
          clicked = true;
          break;
        }
      } catch {}
    }
    if (!clicked && email && pw) {
      // 팝업 없이 현재 페이지에서 로그인
      await page.goto("https://accounts.google.com/signin", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(1500);
      const emailInput = await page.$("input[type='email'], input[name='identifier']").catch(() => null);
      if (emailInput) {
        await emailInput.fill(email);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(2500);
        const pwInput = await page.$("input[type='password'], input[name='Passwd']").catch(() => null);
        if (pwInput) {
          await pwInput.fill(pw);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(3000);
        }
      }
      // ImageFX로 돌아가기
      await page.goto("https://labs.google/fx/ko/tools/flow", { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    await page.waitForTimeout(3000);
  }

  // ── 헬퍼: 프롬프트 입력 ──
  async function enterPrompt(prompt: string): Promise<boolean> {
    // 팝업 오버레이 재확인 및 제거
    await page.evaluate(() => {
      document.querySelectorAll("[data-state='open']").forEach(el => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(500);

    let input: any = null;

    // textarea (visible 우선)
    try {
      await page.waitForSelector("textarea:visible", { timeout: 5000 });
      input = await page.$("textarea:visible");
    } catch {}

    // 모든 textarea
    if (!input) {
      try {
        input = await page.$("textarea");
        if (input) {
          await page.evaluate(() => {
            const ta = document.querySelector("textarea");
            if (ta) { ta.style.display = "block"; ta.style.visibility = "visible"; }
          }).catch(() => {});
        }
      } catch {}
    }

    // contenteditable
    if (!input) {
      try { input = await page.$("[contenteditable='true']:not([role='combobox'])"); } catch {}
    }

    if (!input) {
      log("⚠️ [Flow] 프롬프트 입력창을 찾을 수 없음");
      return false;
    }

    await input.click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(200);
    await page.keyboard.type(prompt, { delay: 25 });
    await page.waitForTimeout(500);
    log(`  📝 프롬프트 입력: ${prompt.slice(0, 50)}...`);
    return true;
  }

  // ── 헬퍼: 생성 버튼 클릭 ──
  async function clickGenerate(): Promise<boolean> {
    // Enter 키 우선 (대부분의 AI 이미지 사이트에서 작동)
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // 버튼 클릭 시도
    const btns = [
      "button[aria-label*='generate' i]",
      "button[aria-label*='create' i]",
      "button[aria-label*='생성']",
      "button[aria-label*='만들기']",
      "button:has-text('Create')",
      "button:has-text('Generate')",
      "button:has-text('만들기')",
      "button:has-text('생성')",
    ];
    for (const sel of btns) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const visible = await btn.isVisible();
          if (visible) { await btn.click(); return true; }
        }
      } catch {}
    }
    return true; // Enter로 이미 시도했음
  }

  // ── 헬퍼: 생성된 이미지 저장 ──
  async function saveGeneratedImage(idx: number, caption: string): Promise<boolean> {
    log("  ⏳ 이미지 생성 대기 (최대 30초)...");
    await page.waitForTimeout(25000);

    // 생성된 이미지 찾기 - 다양한 방법
    const imgSrcs: string[] = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      return imgs
        .map(img => img.src)
        .filter(src =>
          src && src.length > 100 &&
          (src.includes("blob:") || src.includes("generativelanguage") ||
           src.includes("aidemos") || src.includes("googleusercontent") ||
           src.includes("data:image"))
        );
    });

    if (imgSrcs.length > 0) {
      const src = imgSrcs[0];
      if (src.startsWith("blob:")) {
        // blob URL → base64 변환 후 파일 저장
        const base64 = await page.evaluate(async (blobUrl) => {
          const res = await fetch(blobUrl);
          const blob = await res.blob();
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }, src);
        if (base64) {
          const filePath = path.join(DOWNLOAD_DIR, `flow_${Date.now()}_${idx}.png`);
          const base64Data = base64.replace(/^data:image\/\w+;base64,/, "");
          fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
          results.push({ src: filePath, alt: caption });
          log(`  ✅ [Flow] 이미지 ${idx + 1} 저장 완료`);
          return true;
        }
      } else if (src.startsWith("http")) {
        results.push({ src, alt: caption });
        log(`  ✅ [Flow] 이미지 ${idx + 1} URL 저장`);
        return true;
      }
    }

    // 다운로드 버튼 시도
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 5000 }),
        page.click("[aria-label*='download' i], [aria-label*='다운로드'], button[title*='download' i]"),
      ]);
      const filePath = path.join(DOWNLOAD_DIR, `flow_${Date.now()}_${idx}.png`);
      await download.saveAs(filePath);
      results.push({ src: filePath, alt: caption });
      log(`  ✅ [Flow] 이미지 ${idx + 1} 다운로드 완료`);
      return true;
    } catch {}

    log(`  ⚠️ [Flow] 이미지 ${idx + 1} 저장 실패`);
    return false;
  }

  try {
    // 첫 페이지 로드
    await page.goto("https://labs.google/fx/ko/tools/flow", {
      waitUntil: "domcontentloaded", timeout: 30000,
    });
    await page.waitForTimeout(4000);

    // 팝업 오버레이 제거 + 버튼 클릭 (data-state="open" 오버레이가 클릭 차단)
    const dismissPopups = async () => {
      await page.evaluate(() => {
        document.querySelectorAll("[data-state='open']").forEach(el => el.remove());
        const btns = Array.from(document.querySelectorAll("button"));
        btns.forEach(btn => {
          const t = btn.textContent || "";
          if (t.includes("시작") || t.includes("닫기") || t.includes("동의") || t.includes("started") || t.includes("Get started")) {
            btn.click();
          }
        });
      }).catch(() => {});
      await page.waitForTimeout(1500);
    };
    await dismissPopups();

    // 로그인 버튼 있으면 처리
    const needLogin = await page.$("button:has-text('로그인'), button:has-text('Sign in')").catch(() => null);
    if (needLogin || page.url().includes("accounts.google.com")) {
      await handleGoogleLogin();
      await page.waitForTimeout(3000);
    }

    // 각 프롬프트별 이미지 생성
    for (let i = 0; i < prompts.length; i++) {
      log(`🎨 [Flow] ${i + 1}/${prompts.length} 이미지 생성 중...`);

      // 첫 번째 아니면 페이지 새로고침
      if (i > 0) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        await dismissPopups();
      }

      // 로그인 상태 재확인
      if (page.url().includes("accounts.google.com")) {
        await handleGoogleLogin();
        await page.waitForTimeout(3000);
      }

      const entered = await enterPrompt(prompts[i]);
      if (!entered) continue;

      await clickGenerate();
      // 프롬프트 기반 SEO 캡션 생성 (이미지 검색 노출용)
      const seoCaption = captionFromPrompt(prompts[i], i, prompts.length);
      await saveGeneratedImage(i, seoCaption);
    }

    await browser.close();
    log(`✅ [Flow] 전체 ${results.length}장 생성 완료`);
    return results;
  } catch (e: any) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/* ── Google Flow 이미지 생성 (CDP 방식 · 사용자 실크롬 연결) ──────────
   구글이 자동화 브라우저 로그인을 차단하므로, 사용자가 로그인해둔 실제 크롬을
   디버깅 포트(--remote-debugging-port)로 띄우고 봇이 CDP로 붙어 Flow를 조작한다.
   별도 브라우저를 열지 않아 구글 봇 감지를 우회한다. (2026-08 실측 검증)      */
export async function generateFlowImagesCDP(params: {
  prompts: string[];
  captions?: string[];
  cdpPort?: number;
  onLog?: (msg: string) => void;
}): Promise<{ src: string; alt: string }[]> {
  const { prompts, captions = [], cdpPort = 9222, onLog } = params;
  const log = onLog || console.log;
  const results: { src: string; alt: string }[] = [];

  // 0) 백업 폴더 준비: 바탕화면/Publy_Flow이미지_YYYY-MM-DD (생성 이미지 자동 보관)
  let backupDir = "";
  try {
    const today = new Date().toISOString().slice(0, 10);
    backupDir = path.join(os.homedir(), "Desktop", `Publy_Flow이미지_${today}`);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  } catch { backupDir = ""; }

  // 1) 사용자 실크롬(디버깅 포트)에 연결
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  } catch (e: any) {
    throw new Error(`CDP_CONNECT_FAIL: 크롬이 디버깅 모드로 열려있지 않습니다 (포트 ${cdpPort}). Flow 준비 버튼을 먼저 눌러주세요.`);
  }

  try {
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error("크롬 컨텍스트를 찾을 수 없습니다");

    // 2) Flow 탭 찾기(없으면 새로 열기)
    let page = ctx.pages().find(p => p.url().includes("labs.google/fx"));
    if (!page) {
      log("[Flow] Flow 탭이 없어 새로 엽니다");
      page = await ctx.newPage();
      await page.goto("https://labs.google/fx/ko/tools/flow", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(4000);
    }
    await page.bringToFront();
    await page.waitForTimeout(1500);

    // 3) 로그인 상태 확인
    const loggedIn = await page.evaluate(() => {
      const t = document.body.innerText;
      const hasLoginBtn = [...document.querySelectorAll("button,a")].some(e => /sign in with google|Google 계정으로 로그인/i.test(e.textContent || ""));
      return !hasLoginBtn && /Flow|프로젝트|크레딧|안녕하세요/.test(t);
    });
    if (!loggedIn) throw new Error("FLOW_NOT_LOGGED_IN: 크롬에서 Google Flow에 먼저 로그인해주세요");

    // 4) ★항상 새 프로젝트로 시작 (이전 작업 컨텍스트/텍스트가 이미지에 섞이는 것 방지)
    //    기존 프로젝트에 있으면 홈으로 나갔다가 새로 생성한다.
    log("[Flow] 새 프로젝트 생성(이전 컨텍스트 초기화)...");
    if (page.url().includes("/project/")) {
      await page.goto("https://labs.google/fx/ko/tools/flow", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3500);
    }
    try {
      await page.click("text=새 프로젝트", { timeout: 8000 });
    } catch {
      // 폴백: '만들기'/'프로젝트' 계열 버튼
      try { await page.locator("button:has-text('프로젝트')").first().click({ timeout: 4000 }); } catch {}
    }
    await page.waitForTimeout(5000);
    if (!page.url().includes("/project/")) {
      log("[Flow] ⚠️ 새 프로젝트 진입 실패 — 현재 화면에서 진행");
    }

    // 5) 프롬프트별 생성 — ★ 큐 방식: 실패한 프롬프트는 다시 시도(최대 3회)해서 "요청한 개수 정확히" 채운다.
    const target = prompts.length;              // 요청한 총 장수
    const queue: number[] = prompts.map((_, i) => i);
    const attemptsById: Record<number, number> = {};
    while (queue.length > 0 && results.length < target) {
      const i = queue.shift()!;
      attemptsById[i] = (attemptsById[i] || 0) + 1;
      const requeue = () => { if (attemptsById[i] < 3) { queue.push(i); log(`[Flow] 🔁 (${i + 1}) 재시도 예약 (${attemptsById[i]}/3)`); } else { log(`[Flow] ⛔ (${i + 1}) 3회 실패 — 이 장은 포기`); } };
      // 텍스트 오염 방지 안전장치(어떤 경로로 온 프롬프트든 글자 없이 순수 이미지)
      let prompt = prompts[i];
      if (!/no text|no letters|글자 ?없/i.test(prompt)) {
        prompt += ", (photo only, absolutely no text, no letters, no words, no watermark, no logo)";
      }
      log(`[Flow] (${i + 1}/${prompts.length}) 프롬프트 입력: ${prompt.slice(0, 40)}...`);

      // 입력창(보이는 contenteditable/textarea)에 입력
      let entered = false;
      const editables = await page.$$("[contenteditable=true], textarea");
      for (const el of editables) {
        try {
          if (await el.isVisible()) {
            await el.click();
            await page.waitForTimeout(400);
            await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
            await page.keyboard.press("Backspace");
            await page.keyboard.type(prompt, { delay: 15 });
            entered = true;
            break;
          }
        } catch {}
      }
      if (!entered) { log("[Flow] ⚠️ 입력창을 못 찾음"); requeue(); continue; }
      await page.waitForTimeout(1500); // 입력 반영 + 전송버튼 활성화 대기

      // 전송 전 이미지 URL 집합 기록(개수가 아닌 URL diff로 새 이미지 판별 → 견고)
      const beforeSrcs: string[] = await page.evaluate(() =>
        [...document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]')]
          .filter(im => (im as HTMLImageElement).naturalWidth >= 500)
          .map(im => (im as HTMLImageElement).src)
      );

      // 클릭 API가 성공해도 React가 이벤트를 놓칠 수 있으므로, 반드시 UI의 "전송 성공 신호"를
      // 확인한다. 실패하면 매번 다른 방식으로 다시 보내고, 전부 실패해도 생성 대기에는 진입하지 않는다.
      // '만들기' 버튼 2개(add_2만들기=업로드, arrow_forward만들기=전송) → 정확 텍스트로 구분.
      const submissionStarted = async (): Promise<boolean> => page.evaluate((expectedPrompt: string) => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        };
        const values = [...document.querySelectorAll("[contenteditable=true], textarea")]
          .filter(visible)
          .map(el => el instanceof HTMLTextAreaElement ? el.value : (el.textContent || ""));
        // Flow는 제출 때 입력 노드를 비우거나 통째로 재렌더한다. 페이지의 다른
        // contenteditable을 잘못 집지 않도록, 방금 입력한 프롬프트의 잔존 여부로 판단한다.
        const inputCleared = !values.some(value => value.includes(expectedPrompt));
        // 완료형인 '이미지를 생성했습니다'는 일부러 포함하지 않는다.
        const generating = /생성\s*중|만들고\s*있|생성하고\s*있|generating|creating\b|thinking/i.test(document.body.innerText);
        return inputCleared || generating;
      }, prompt).catch(() => false);

      const waitForSubmission = async (): Promise<boolean> => {
        for (let check = 0; check < 6; check++) {
          await page.waitForTimeout(500);
          if (await submissionStarted()) return true;
        }
        return false;
      };

      let sent = false;
      for (let attempt = 1; attempt <= 4 && !sent; attempt++) {
        log(`[Flow] 📤 전송 시도 ${attempt}/4`);
        try {
          if (attempt === 1) {
            const btn = page.locator("button").filter({ hasText: /^arrow_forward만들기$/ }).first();
            await btn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            await btn.click({ force: true, timeout: 5000 });
          } else if (attempt === 2) {
            // DOM에서 정확 텍스트 버튼을 다시 찾아 native click 이벤트 발생.
            await page.evaluate(() => {
              const btn = [...document.querySelectorAll("button")]
                .find(el => (el.textContent || "").trim() === "arrow_forward만들기") as HTMLButtonElement | undefined;
              if (!btn) throw new Error("submit button not found");
              btn.click();
            });
          } else if (attempt === 3) {
            const inp = page.locator("[contenteditable=true]:visible, textarea:visible").first();
            await inp.click({ timeout: 3000 });
            await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
          } else {
            // UI가 재렌더된 뒤의 최신 버튼을 다시 resolve해 일반 실제 클릭.
            const btn = page.locator("button").filter({ hasText: /^arrow_forward만들기$/ }).first();
            await btn.waitFor({ state: "visible", timeout: 4000 });
            await btn.click({ timeout: 5000 });
          }
        } catch (e: any) {
          log(`[Flow] ⚠️ 전송 시도 ${attempt} 동작 실패: ${String(e?.message || e).split("\n")[0]}`);
        }
        sent = await waitForSubmission();
        if (sent) log(`[Flow] ✅ 전송 확인 (${attempt}번째 시도)`);
        else if (attempt < 4) log(`[Flow] ⚠️ 전송 신호 없음 — 다른 방식으로 재시도`);
      }
      if (!sent) {
        log(`[Flow] ❌ (${i + 1}/${prompts.length}) 4회 전송 실패`);
        requeue();
        continue;
      }

      // 생성 대기(최대 165초): beforeSet에 없던 "새 URL"이 나타나면 성공(개수비교보다 견고).
      log("[Flow] ⏳ 이미지 생성 대기...");
      let freshSrcs: string[] = [];
      for (let t = 0; t < 55; t++) {
        await page.waitForTimeout(3000);
        const snap = await page.evaluate((beforeArr: string[]) => {
          const before = new Set(beforeArr);
          const fresh: string[] = [];
          document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]').forEach(im => {
            const el = im as HTMLImageElement;
            if (el.naturalWidth >= 500 && !before.has(el.src)) fresh.push(el.src);
          });
          // ⚠️ '이미지를 생성했습니다'(완료) 오탐 방지 — 진행중 표현만 (~중/~ing만)
          const generating = /생성\s*중|만들고\s*있|생성하고\s*있|generating|creating\b|thinking/i.test(document.body.innerText);
          return { fresh, generating };
        }, beforeSrcs);
        if (snap.fresh.length > 0) {
          freshSrcs = snap.fresh;
          // 새 이미지가 잡혔으면: 생성중 문구 없으면 바로, 있어도 안전하게 진행
          if (!snap.generating) { await page.waitForTimeout(2500); break; }
          // 생성중이어도 새 이미지가 이미 목표 수만큼 나왔으면 완료로 간주(오탐 대비)
          if (freshSrcs.length >= 1) { await page.waitForTimeout(4000); break; }
        }
      }

      // 최종 새 URL 재수집(마지막 스냅샷 기준)
      freshSrcs = await page.evaluate((beforeArr: string[]) => {
        const before = new Set(beforeArr);
        const fresh: string[] = [];
        document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]').forEach(im => {
          const el = im as HTMLImageElement;
          if (el.naturalWidth >= 500 && !before.has(el.src)) fresh.push(el.src);
        });
        return fresh;
      }, beforeSrcs);

      if (freshSrcs.length === 0) { log(`[Flow] ⚠️ (${i + 1}) 이미지 생성 실패/타임아웃`); requeue(); continue; }

      // 새로 생긴 이미지 1장 다운로드(가장 최근 것 = 배열 마지막)
      const targetSrc = freshSrcs[freshSrcs.length - 1];
      const dataUrl: string = await page.evaluate(async (src) => {
        try {
          const res = await fetch(src);
          if (!res.ok) return "ERR:" + res.status;
          const blob = await res.blob();
          return await new Promise<string>(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result as string); rd.readAsDataURL(blob); });
        } catch (e: any) { return "ERR:" + e.message; }
      }, targetSrc);

      if (dataUrl.startsWith("data:image")) {
        results.push({ src: dataUrl, alt: captions[i] || "" });
        // 바탕화면 날짜 폴더에 자동 백업
        if (backupDir) {
          try {
            const safeName = (captions[i] || prompts[i] || `flow_${i + 1}`).slice(0, 30).replace(/[\/\\:*?"<>|]/g, "_").trim();
            const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
            const file = path.join(backupDir, `${safeName}_${ts}.png`);
            fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
            log(`[Flow] 💾 백업: ${file}`);
          } catch {}
        }
        log(`[Flow] ✅ (${i + 1}) 이미지 다운로드 완료`);
      } else {
        log(`[Flow] ⚠️ (${i + 1}) 다운로드 실패: ${dataUrl.slice(0, 40)}`);
        requeue();
      }
      await page.waitForTimeout(1000);
    }
    if (results.length < target) log(`[Flow] ⚠️ 목표 ${target}장 중 ${results.length}장만 확보 (일부 프롬프트 3회 실패)`);

    // CDP는 연결만 끊고 사용자 크롬은 유지
    await browser.close().catch(() => {});
    log(`✅ [Flow] 전체 ${results.length}장 생성/다운로드 완료`);
    return results;
  } catch (e: any) {
    await browser.close().catch(() => {});
    throw e;
  }
}
