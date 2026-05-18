"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tistorySessionExists = tistorySessionExists;
exports.saveTistorySession = saveTistorySession;
exports.publishTistory = publishTistory;
const playwright_1 = require("playwright");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const SESSION_DIR = path_1.default.join(__dirname, "../sessions");
if (!fs_1.default.existsSync(SESSION_DIR))
    fs_1.default.mkdirSync(SESSION_DIR, { recursive: true });
const sessionPath = (userId) => path_1.default.join(SESSION_DIR, `tistory_${userId}.json`);
function tistorySessionExists(userId) {
    return fs_1.default.existsSync(sessionPath(userId));
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
async function applyAntiDetection(context) {
    await context.addInitScript(ANTI_DETECTION_SCRIPT);
}
/* ── 티스토리 로그인 (카카오 OAuth) ── */
async function saveTistorySession(userId, id, pw, blogName) {
    const browser = await playwright_1.chromium.launch({ headless: false, args: LAUNCH_ARGS, slowMo: 50 });
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    await applyAntiDetection(context);
    const page = await context.newPage();
    try {
        await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1500);
        await page.click(".btn_login.link_kakao_id, a:has-text('카카오')").catch(() => { });
        await page.waitForTimeout(2500);
        await page.fill("#loginId--1", id).catch(async () => {
            await page.fill("input[name='loginId']", id);
        });
        await page.waitForTimeout(400);
        await page.fill("#password--2", pw).catch(async () => {
            await page.fill("input[name='password']", pw);
        });
        await page.waitForTimeout(400);
        await page.click(".btn_confirm.btn_login, button.submit").catch(() => { });
        console.log("[tistory] 로그인 대기 중...");
        try {
            await page.waitForURL("**tistory.com/**", { timeout: 90000 });
        }
        catch {
            throw new Error("티스토리 로그인 시간 초과");
        }
        await page.waitForTimeout(2000);
        if (page.url().includes("login") || page.url().includes("accounts.kakao.com")) {
            throw new Error("티스토리 로그인 실패");
        }
        const cookies = await context.cookies();
        fs_1.default.writeFileSync(sessionPath(userId), JSON.stringify({ blogName, cookies }, null, 2));
        await browser.close();
        console.log(`[tistory] ✅ 세션 저장 완료: ${blogName}`);
    }
    catch (e) {
        await browser.close().catch(() => { });
        throw e;
    }
}
/* ── 티스토리 자동발행 (헤드리스) ── */
async function publishTistory(params) {
    const { userId, title, content, tags } = params;
    const sp = sessionPath(userId);
    if (!fs_1.default.existsSync(sp))
        throw new Error("티스토리 세션 없음. 계정 재연결 필요");
    const { blogName, cookies } = JSON.parse(fs_1.default.readFileSync(sp, "utf-8"));
    const browser = await playwright_1.chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    await applyAntiDetection(context);
    await context.addCookies(cookies);
    const page = await context.newPage();
    try {
        const writeUrl = `https://${blogName}.tistory.com/manage/newpost/`;
        console.log(`[tistory] 글쓰기 진입: ${writeUrl}`);
        await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        if (page.url().includes("kakao.com") || page.url().includes("login")) {
            fs_1.default.unlinkSync(sp);
            throw new Error("티스토리 세션 만료. 계정 재연결 필요");
        }
        await page.waitForTimeout(3000);
        // 임시저장 팝업 닫기
        try {
            const popup = page.locator(".btn-cancel:has-text('취소'), button:has-text('새로 작성')").first();
            if (await popup.isVisible({ timeout: 3000 }))
                await popup.click();
        }
        catch { }
        // 제목 입력
        console.log("[tistory] 제목 입력...");
        const titleInput = page.locator("#post-title-inp, input[name='title'], textarea[name='title']").first();
        await titleInput.waitFor({ timeout: 15000 });
        await titleInput.click();
        await titleInput.fill(title);
        await page.waitForTimeout(500);
        // HTML 모드 전환
        console.log("[tistory] HTML 모드 전환...");
        try {
            await page.click("#editor-mode-layer-btn-open, .btn-edit-mode", { timeout: 5000 });
            await page.waitForTimeout(800);
            await page.click("#editor-mode-html, [data-mode='html']", { timeout: 5000 });
            await page.waitForTimeout(800);
            await page.click(".btn-default.btn-confirm, button:has-text('확인')", { timeout: 3000 }).catch(() => { });
            await page.waitForTimeout(1500);
        }
        catch {
            console.warn("[tistory] HTML 모드 전환 실패, 기본 모드로 진행");
        }
        // 본문 입력
        console.log("[tistory] 본문 입력...");
        const htmlContent = content.replace(/\n/g, "<br>");
        try {
            await page.evaluate((html) => {
                const editor = document.querySelector(".CodeMirror");
                if (editor && editor.CodeMirror) {
                    editor.CodeMirror.setValue(html);
                    return true;
                }
                const ta = document.querySelector("textarea#html-editor, textarea.html-source");
                if (ta) {
                    ta.value = html;
                    ta.dispatchEvent(new Event("input", { bubbles: true }));
                    return true;
                }
                return false;
            }, htmlContent);
            await page.waitForTimeout(800);
        }
        catch {
            try {
                const editorFrame = page.frameLocator(".tox-edit-area iframe, iframe.tx_canvas_iframe").first();
                await editorFrame.locator("body").click({ timeout: 5000 });
                await page.keyboard.type(content, { delay: 5 });
            }
            catch { }
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
            }
            catch { }
        }
        // 발행
        console.log("[tistory] 발행...");
        await page.click("#publish-layer-btn, button.btn-publish, button:has-text('완료'), button:has-text('발행')", { timeout: 10000 });
        await page.waitForTimeout(2000);
        try {
            await page.click("#open20, label[for='open20']", { timeout: 5000 }).catch(() => { });
            await page.waitForTimeout(500);
            await page.click("#publish-btn, button.btn-publish-confirm, .layer-btn-publish button:has-text('공개 발행')", { timeout: 10000 });
        }
        catch {
            await page.locator("button:has-text('공개 발행'), button:has-text('발행')").last().click({ timeout: 10000 });
        }
        await page.waitForTimeout(5000);
        let postUrl = `https://${blogName}.tistory.com`;
        const m = page.url().match(/\/(\d+)(?:\?|$)/);
        if (m)
            postUrl = `https://${blogName}.tistory.com/${m[1]}`;
        // 쿠키 갱신
        const newCookies = await context.cookies();
        fs_1.default.writeFileSync(sp, JSON.stringify({ blogName, cookies: newCookies }, null, 2));
        await browser.close();
        console.log(`[tistory] ✅ 발행 완료: ${postUrl}`);
        return postUrl;
    }
    catch (e) {
        try {
            const debugDir = path_1.default.join(__dirname, "../debug");
            if (!fs_1.default.existsSync(debugDir))
                fs_1.default.mkdirSync(debugDir, { recursive: true });
            await page.screenshot({ path: path_1.default.join(debugDir, `tistory_error_${Date.now()}.png`), fullPage: true });
        }
        catch { }
        await browser.close().catch(() => { });
        throw e;
    }
}
//# sourceMappingURL=tistory.js.map