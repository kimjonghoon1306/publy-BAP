// No server, real browser, credentials, or production session files are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const ts = require('../naver-bot/node_modules/typescript');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'publy-regression-'));
const quiet = { log() {}, warn() {}, error() {} };
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
}
let response = { status: 302, location: 'https://blog.naver.com/s9653?Redirect=Write' };
let launches = 0;
let loginUrl = 'https://www.naver.com/';
const cookies = value => [{ name: 'NID_AUT', value, domain: '.naver.com', path: '/', expires: -1 }];
const fakePage = {
  goto: async () => {}, waitForTimeout: async () => {}, click: async () => {}, type: async () => {},
  $: async () => ({ isVisible: async () => true, click: async () => {} }),
  waitForFunction: async () => {}, url: () => loginUrl,
};
const playwright = { chromium: { launch: async () => {
  launches++;
  return { close: async () => {}, newContext: async () => ({
    addInitScript: async () => {}, addCookies: async () => {}, newPage: async () => fakePage,
    cookies: async () => cookies('renewed'),
  }) };
} } };
const modules = new Map();
function load(relative, extra = '', revision = '') {
  const key = revision + relative;
  if (modules.has(key)) return modules.get(key);
  const filename = path.join(root, relative);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, __dirname: path.dirname(filename), Buffer, URL, AbortSignal,
    console: quiet, setTimeout, clearTimeout,
    process: { env: { PUBLY_SESSION_DIR: path.join(temp, 'sessions') }, pid: process.pid },
    fetch: async () => ({ status: response.status, url: 'https://blog.naver.com/GoBlogWrite.naver', headers: { get: () => response.location } }),
    require: name => name === 'playwright' ? playwright : name === 'os' ? { ...os, homedir: () => temp } : name === './session-store' ? load('naver-bot/src/session-store.ts') : nativeRequire(name),
  };
  vm.runInNewContext(compile((revision ? execFileSync('git', ['show', `${revision}:${relative}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(filename, 'utf8')) + extra), sandbox, { filename });
  modules.set(key, module.exports);
  return module.exports;
}
(async () => {
  try {
    const n = load('naver-bot/src/naver.ts', '\nexport { pickNaverBlogId, persistNaverSession, resolveNaverBlogId, isSessionAliveNaver, naverCookieHeader };');
    const store = load('naver-bot/src/session-store.ts');
    for (const bad of [
      'https://blog.naver.com/Recommendation', 'https://m.blog.naver.com/recommendation.naver?blogId=s9653',
      'https://nid.naver.com/nidlogin.login?blogId=s9653', 'https://evil.test/?blogId=s9653',
      'https://blog.naver.com.evil.test/s9653', 'https://blog.naver.com/PostList.naver?blogId=Recommendation',
      'https://blog.naver.com/protect?blogId=s9653', 'https://blog.naver.com/MyBlog.naver',
    ]) assert.equal(n.pickNaverBlogId(bad), '', bad);
    for (const good of ['https://blog.naver.com/s9653?Redirect=Write', '/PostWriteForm.naver?blogId=s9653', 'https://m.blog.naver.com/s9653/123']) assert.equal(n.pickNaverBlogId(good), 's9653');
    assert.equal(n.pickNaverBlogId('https://blog.naver.com/system-b?Redirect=Write'), 'system-b');
    assert.equal(n.naverCookieHeader([...cookies('ok'), { ...cookies('bad')[0], domain: '.google.com' }], 'https://blog.naver.com/GoBlogWrite.naver'), 'NID_AUT=ok');
    const account = { loginId: 's9653', blogId: 's9653', cookies: cookies('old'), pw: 'cHc=' };
    // Execute both sides of the actual regression commit, using isolated session files.
    const before = load('naver-bot/src/naver.ts', '', 'dff6485^');
    const after = load('naver-bot/src/naver.ts', '', 'dff6485');
    store.writeSession('naver_history', account);
    await before.reloginNaverSilent('history');
    assert.equal(store.readSession('naver_history').cookies[0].value, 'renewed');
    store.writeSession('naver_history__s9653', account);
    await after.reloginNaverSilent('history');
    after.activateNaverAccount('history', 's9653');
    assert.equal(store.readSession('naver_history').cookies[0].value, 'old');
    const head = load('naver-bot/src/naver.ts', '\nexport { resolveNaverBlogId };', 'HEAD');
    response.location = 'https://blog.naver.com/Recommendation';
    assert.equal(await head.resolveNaverBlogId('s9653', cookies('ok'), 'history', () => {}), 'Recommendation');
    response.location = 'https://blog.naver.com/s9653?Redirect=Write';
    launches = 0;
    console.log('PASS: historical reproduction — dff6485 reverts refreshed cookies; HEAD accepts Recommendation');

    n.persistNaverSession('test', account, true);
    account.cookies = cookies('fresh');
    n.persistNaverSession('test', account);
    assert.equal(n.activateNaverAccount('test', 's9653'), true);
    assert.equal(store.readSession('naver_test').cookies[0].value, 'fresh');
    const other = { loginId: 'other', blogId: 'other', cookies: cookies('other') };
    n.persistNaverSession('test', other, true);
    account.cookies = cookies('newest');
    n.persistNaverSession('test', account);
    assert.equal(store.readSession('naver_test').loginId, 'other');
    n.activateNaverAccount('test', 's9653');
    assert.equal(store.readSession('naver_test').cookies[0].value, 'newest');
    const polluted = { ...account, blogId: 'Recommendation' };
    n.persistNaverSession('test', polluted, true);
    assert.equal(store.readSession('naver_test').blogId, '');
    assert.equal(await n.resolveNaverBlogId('Recommendation', cookies('ok'), 'test', () => {}, polluted), 's9653');
    assert.equal(store.readSession('naver_test__s9653').blogId, 's9653');
    response.location = 'https://blog.naver.com/Recommendation';
    await assert.rejects(n.resolveNaverBlogId('Recommendation', cookies('ok'), 'test', () => {}, polluted));
    await assert.rejects(n.ensureLiveSessionNaver('test'));
    assert.equal(launches, 0, 'protection/recommendation must not submit credentials');
    response = { status: 503, location: '' };
    await assert.rejects(n.ensureLiveSessionNaver('test'));
    assert.equal(launches, 0, 'HTTP errors must not submit credentials');
    response = { status: 302, location: 'https://nid.naver.com/nidlogin.login' };
    loginUrl = 'https://nid.naver.com/protect';
    await assert.rejects(n.ensureLiveSessionNaver('test'));
    assert.equal(launches, 1, 'failed silent login must not retry with another browser');
    n.activateNaverAccount('test', 's9653');
    await assert.rejects(n.ensureLiveSessionNaver('test'), /반복 로그인/);
    assert.equal(launches, 1, 'cooldown must survive account activation');
    // Real cookie refresh writes both encrypted slots, then survives activation.
    loginUrl = 'https://www.naver.com/';
    response.location = 'https://blog.naver.com/s9653?Redirect=Write';
    assert.equal(await n.reloginNaverSilent('test'), true);
    n.activateNaverAccount('test', 'other');
    n.activateNaverAccount('test', 's9653');
    assert.equal(store.readSession('naver_test').cookies[0].value, 'renewed');
    n.deleteNaverSession('test');
    assert.equal(n.activateNaverAccount('test', 's9653'), false);
    assert.equal(n.activateNaverAccount('test', 'other'), false);
    n.persistNaverSession('test', account);
    assert.equal(n.activateNaverAccount('test', 's9653'), false, 'late work must not resurrect disconnected sessions');
    console.log('PASS: URL validation, encrypted account refresh/switch/isolation/delete, protection, HTTP failures, login cooldown');

    // Execute the actual queue/activity code with a fake IPC endpoint.
    const server = fs.readFileSync(path.join(root, 'naver-bot/src/server.ts'), 'utf8');
    const messages = [];
    const activity = { process: { connected: true, send: message => messages.push(message) } };
    vm.createContext(activity);
    vm.runInContext(compile(server.slice(server.indexOf('let activeWork ='), server.indexOf('/* ── 헬스체크')) + '\nglobalThis.api = { beginWork, acquireSlot, releaseSlot };'), activity);
    const endFlow = activity.api.beginWork();
    await activity.api.acquireSlot();
    endFlow();
    assert.equal(messages.at(-1).busy, true);
    activity.api.releaseSlot();
    assert.equal(messages.at(-1).busy, false);
    console.log('PASS: overlapping Flow/publish work retains busy until all work finishes');

    // Execute the actual watchdog scan with simulated time and no process operations.
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    let now = 100000, timer, restarts = 0;
    const bot = { name: 'bot', port: 3333, state: 'idle', busy: true, isAlive: () => true, restart: async () => { restarts++; } };
    const watchdog = { console: quiet, app: { isQuitting: false }, botRegistry: [bot], pingBot: async () => false, Date: { now: () => now }, setTimeout: (fn, ms) => { if (ms === 1000) fn(); else timer = fn; } };
    vm.createContext(watchdog);
    vm.runInContext(compile(main.slice(main.indexOf('const botOfflineSince:'), main.indexOf('const resourceDir =')) + '\nstartBotWatchdog();'), watchdog);
    const scan = async () => { timer(); await new Promise(resolve => setImmediate(resolve)); };
    await scan(); now += 120000; await scan();
    assert.equal(restarts, 0, 'busy and alive must survive repeated health timeouts');
    bot.busy = false; await scan(); assert.equal(restarts, 1);
    bot.state = 'restarting'; await scan(); assert.equal(restarts, 1);
    console.log('PASS: busy watchdog protection, idle recovery, no overlapping restart');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
