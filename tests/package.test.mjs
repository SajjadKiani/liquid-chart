import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('packed library installs outside this repository and exposes valid ESM, CSS, history and TypeScript exports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liquid-chart-consumer-'));
  try {
    const [archive] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root));
    const files = archive.files.map(file => file.path);
    assert.ok(files.includes('dist/index.js') && files.includes('dist/index.d.ts') && files.includes('dist/style.css'));
    assert.ok(files.every(file => file.startsWith('dist/') || ['README.md', 'LICENSE', 'package.json'].includes(file)), files.join('\n'));
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    run('npm', ['install', join(directory, archive.filename), '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], directory);
    const installed = JSON.parse(await readFile(join(directory, 'node_modules/liquid-chart/package.json'), 'utf8'));
    assert.equal(installed.license, 'MIT');
    assert.ok(files.includes('LICENSE'));
    assert.equal(await readFile(join(directory, 'node_modules/liquid-chart/LICENSE'), 'utf8'), await readFile(join(root, 'LICENSE'), 'utf8'));
    assert.deepEqual(installed.dependencies ?? {}, {});
    const script = `
      import assert from 'node:assert/strict';
      import { createChart, ChartEngine, DRAWING_KINDS, restoreDrawings, validateIndicatorOutput } from 'liquid-chart';
      import { CandleStore } from 'liquid-chart/model';
      import { createHistoryPager } from 'liquid-chart/history';
      assert.equal(typeof document, 'undefined');
      assert.equal(typeof createChart, 'function');
      assert.equal(typeof ChartEngine, 'function');
      assert.equal(DRAWING_KINDS.length, 21);
      assert.deepEqual(restoreDrawings(null), []);
      assert.deepEqual(validateIndicatorOutput({panes:[],series:[]}), {panes:[],series:[]});
      for (const method of ['setIndicator','removeIndicator','clearIndicators']) assert.equal(typeof ChartEngine.prototype[method], 'function');
      const store = new CandleStore();
      store.setData([{time: 1000, open: 1, high: 3, low: 1, close: 2, volume: 0}]);
      assert.equal(store.candles.length, 1);
      assert.ok(import.meta.resolve('liquid-chart/style.css').endsWith('/dist/style.css'));
      const pager = createHistoryPager({oldestTime:()=>undefined,fetchPage:async()=>[],prepend:()=>0,onStatus:()=>{}});
      pager.stop();
    `;
    run(process.execPath, ['--input-type=module', '-e', script], directory);
    await writeFile(join(directory, 'consumer.ts'), `
      import { createChart, type Candle, type ChartState, type IndicatorOutput } from 'liquid-chart';
      import { CandleStore } from 'liquid-chart/model';
      import { createHistoryPager, type HistoryPagerOptions } from 'liquid-chart/history';
      const chart = createChart(document.createElement('div'), {priceScale: 'log'});
      const candles: Candle[] = [{time: 1000,open:1,high:3,low:1,close:2,volume:0}];
      chart.setData(candles); chart.setTool('fib'); chart.setMagnet('weak');
      const output: IndicatorOutput = {panes:[{id:'custom',title:'Custom'}],series:[{id:'value',name:'Value',paneId:'custom',type:'line',color:'#abcdef',points:[{time:1000,value:null}]}]};
      chart.setIndicator('custom-program', output); chart.removeIndicator('custom-program'); chart.clearIndicators();
      const cloud: IndicatorOutput = {panes:[],series:[{id:'band',name:'Band',paneId:'price',type:'band',color:'#00ff00',negativeColor:'#ff0000',offset:26,points:[{time:1000,value:1,value2:2}]}]};
      chart.setIndicator('custom-band', cloud);
      const unsubscribe = chart.subscribe((state: ChartState) => console.log(state.firstVisibleIndex));
      const store = new CandleStore(); store.setData(candles);
      const options: HistoryPagerOptions = {oldestTime:()=>1000,fetchPage:async()=>[],prepend:c=>chart.prependData(c),onStatus:()=>{}};
      createHistoryPager(options).stop(); unsubscribe(); chart.destroy();
      // @ts-expect-error Unsupported drawing tools must fail type checking.
      chart.setTool('unsupported');
      // @ts-expect-error Magnet modes are constrained.
      chart.setMagnet('always');
    `);
    const compiler = join(root, 'node_modules/typescript/bin/tsc');
    run(process.execPath, [compiler, '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts'], directory);
    run(process.execPath, [compiler, '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', 'consumer.ts'], directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('library host styling and chart teardown are self-contained and preserve existing host classes', async () => {
  const { createChart } = await import('../dist/index.js');
  const original = Object.fromEntries(['document', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let disconnected = 0, cancelled = 0;
  const listeners = new Map();
  const canvases = [];
  const classes = new Set(['application-chart']);
  const host = { clientWidth: 640, clientHeight: 400, classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) }, append: (...children) => canvases.push(...children) };
  const context = { setTransform() {}, clearRect() {}, fillRect() {} };
  const makeCanvas = () => ({ style: {}, setAttribute() {}, getContext: () => context, addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); }, remove() { canvases.splice(canvases.indexOf(this), 1); } });
  try {
    globalThis.document = { createElement: () => makeCanvas() };
    globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected++; } };
    globalThis.requestAnimationFrame = () => 123;
    globalThis.cancelAnimationFrame = id => { if (id === 123) cancelled++; };
    // Constructor reads the browser window's pixel ratio.
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    globalThis.window = { devicePixelRatio: 2 };
    try {
      const chart = createChart(host, { priceScale: 'log', backgroundColor: '#000000' });
      assert.equal(chart.options.backgroundColor, '#000000');
      assert.equal(chart.options.priceScale, 'log');
      assert.equal(chart.canvas.width, 1280);
      assert.ok(classes.has('liquid-chart-host'));
      assert.equal(canvases.length, 2);
      assert.equal(listeners.size, 9);
      chart.destroy(); chart.destroy();
      assert.equal(disconnected, 1); assert.equal(cancelled, 1);
      assert.equal(canvases.length, 0); assert.equal(listeners.size, 0);
      assert.deepEqual([...classes], ['application-chart']);
    } finally { if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete globalThis.window; }
  } finally {
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
