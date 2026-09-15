// Isolated lifecycle tests: no real ports, processes, sessions or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../naver-bot/node_modules/typescript');
const { EventEmitter } = require('node:events');
const main = fs.readFileSync('electron/main.ts', 'utf8');
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const flush = () => new Promise(r => setImmediate(r));
(async () => {
  let now = 100000, proc = null, spawns = 0, kills = 0, collision = true, release;
  const timers = new Set();
  const registry = [];
  const fakeFs = { existsSync: () => true, promises: {
    mkdir: async () => {}, stat: async () => ({ size: 0 }),
    open: async () => ({ fd: 77, write: async () => {}, close: async () => {} }),
  }};
  const sandbox = {
    console, require: n => { assert.equal(n, 'fs'); return fakeFs; },
    path: require('node:path'), app: { isQuitting: false, getPath: () => '/fake' },
    botEnvironment: () => ({ BOT_AUTH_TOKEN: 'stable-token' }), botRegistry: registry,
    process: { execPath: '/fake/node' }, Date: class extends Date { constructor() { super(now); } static now() { return now; } },
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.add(t); return t; },
    clearTimeout: t => timers.delete(t),
    terminateTrackedChild: async () => { kills++; if (release) await new Promise(r => release = r); },
    killPort: async () => collision ? 'collision' : 'clear',
    spawn: (_exe, _args, opts) => {
      spawns++; assert.equal(opts.env.BOT_AUTH_TOKEN, 'stable-token');
      const child = new EventEmitter(); Object.assign(child, { pid: spawns, exitCode: null, signalCode: null, killed: false }); return child;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(compile(main.slice(main.indexOf('async function forkBotServer('), main.indexOf('// ── 봇 서버 워치독 ──')) + '\nglobalThis.start = forkBotServer;'), sandbox);
  await sandbox.start({ name: 'bot', port: 3333, botPath: '/fake', chromiumPath: '/fake', getProc: () => proc, setProc: p => proc = p });
  await flush();
  const entry = registry[0];
  assert(entry.hasScheduledRestart());
  const first = [...timers].find(t => t.ms === 3000); assert(first);
  const before = kills;
  await entry.restart('watchdog'); assert.equal(kills, before, 'watchdog must preserve queued backoff');
  timers.delete(first); first.fn(); await flush();
  assert([...timers].some(t => t.ms === 6000), 'repeated failure increases delay');
  collision = false;
  now += 3000;
  release = true;
  const a = entry.restart(); await flush();
  now += 120000;
  const b = entry.restart(); assert.equal(a, b, 'even after 45 seconds do not overlap unfinished restart');
  const resume = release; release = null; resume();
  await a; await flush(); assert.equal(spawns, 1);
  proc.emit('message', { type: 'publy-activity', busy: true });
  assert.equal(await entry.restart(), false); assert.equal(spawns, 1, 'reconnect/publish busy is preserved');
  console.log('PASS: collision backoff, watchdog deferral, slow restart serialization, stable token, busy guard');

  let scanTimer, restarts = 0;
  const bot = { name: 'bot', port: 3333, state: 'idle', busy: false, isAlive: () => false, hasScheduledRestart: () => true, restart: async reason => { assert.equal(reason, 'watchdog'); restarts++; } };
  const watchdog = { console, app: { isQuitting: false }, botRegistry: [bot], pingBot: async () => false, Date: { now: () => now }, setTimeout: (fn, ms) => { if (ms === 1000) fn(); else scanTimer = fn; } };
  vm.createContext(watchdog);
  vm.runInContext(compile(main.slice(main.indexOf('const botOfflineSince:'), main.indexOf('const resourceDir =')) + '\nstartBotWatchdog();'), watchdog);
  const scan = async () => { scanTimer(); await flush(); };
  await scan(); now += 120000; await scan(); assert.equal(restarts, 0);
  bot.hasScheduledRestart = () => false; await scan(); assert.equal(restarts, 1);
  bot.state = 'restarting'; await scan(); assert.equal(restarts, 1);
  bot.state = 'idle'; bot.busy = true; bot.isAlive = () => true; await scan(); assert.equal(restarts, 1);
  console.log('PASS: watchdog respects scheduled/restarting/busy states and recovers idle offline bot');
  // Same scenario against deployed code: watchdog overrides a queued restart.
  const oldMain = require('node:child_process').execFileSync('git', ['show', '92de2c8:electron/main.ts'], { encoding: 'utf8' });
  restarts = 0;
  bot.busy = false; bot.isAlive = () => false; bot.hasScheduledRestart = () => true;
  bot.restart = async () => { restarts++; };
  const oldWatchdog = { ...watchdog };
  vm.createContext(oldWatchdog);
  vm.runInContext(compile(oldMain.slice(oldMain.indexOf('const botOfflineSince:'), oldMain.indexOf('const resourceDir =')) + '\nstartBotWatchdog();'), oldWatchdog);
  await scan(); now += 120000; await scan();
  assert.equal(restarts, 1, 'deployed revision reproduces watchdog bypassing queued backoff');
  console.log('PASS: git baseline reproduces scheduled-backoff regression');

  for (const owns of [false, true]) {
    const handlers = {}; let exits = 0, shows = 0;
    const context = { app: { requestSingleInstanceLock: () => owns, exit: () => exits++, on: (name, fn) => handlers[name] = fn }, mainWindow: { isMinimized: () => true, restore() {}, show: () => shows++, focus() {} } };
    vm.runInNewContext(main.slice(main.indexOf('const ownsInstance ='), main.indexOf('app.whenReady().then')), context);
    assert.equal(exits, owns ? 0 : 1);
    if (owns) { handlers['second-instance'](); assert.equal(shows, 1); }
  }
  console.log('PASS: duplicate app exits; owner restores its existing window');
})().catch(e => { console.error(e); process.exitCode = 1; });
