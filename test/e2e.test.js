// Browser end-to-end tests (Playwright). Skipped automatically when Playwright
// isn't installed: `npm i -D playwright && npx playwright install chromium`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {}
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch {
    return null;
  }
}

const pw = loadPlaywright();
const skip = pw ? false : 'Playwright not installed';

let server;
let base;
let browser;

before(async () => {
  if (skip) return;
  const { createServer } = await import('../src/server/server.js');
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  browser = await pw.chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function newPage(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...opts });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base }).catch(() => {});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|fonts\.g/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('mode-badge').textContent !== '…');
  return { page, context, errors };
}

const visible = (page, view) => page.waitForSelector(`#view-${view}:not([hidden])`, { timeout: 10000 });

async function ask(page, question) {
  await page.fill('#question', question);
  await page.click('#ask-form button[type=submit]');
  await visible(page, 'framing');
  await page.click('#start-interview');
  await visible(page, 'interview');
}

async function answerN(page, n, pick = (opts) => opts.length - 1) {
  for (let i = 0; i < n; i++) {
    if (!(await page.isVisible('#view-interview'))) return;
    const opts = await page.$$('#q-options .opt');
    await opts[pick(opts)].click();
    await page.waitForTimeout(60);
  }
}

const gaugeValue = async (page, sel) => Number((await page.textContent(`${sel} .g-value`)).replace(/\D/g, ''));

test('full flow: ask → interview → result → what-if → journal', { skip }, async () => {
  const { page, context, errors } = await newPage();
  await ask(page, 'Will I be rich in the future?');
  await answerN(page, 4, () => 2);
  await page.click('#reveal-now');
  await visible(page, 'result');
  await page.waitForTimeout(900);
  const p = await gaugeValue(page, '#result-gauge');
  assert.ok(p >= 0 && p <= 100);
  assert.ok((await page.textContent('#r-headline')).length > 10);

  // Applying the top lever raises the forecast.
  await page.click('[data-try]');
  await page.waitForTimeout(900);
  assert.ok((await gaugeValue(page, '#result-gauge')) > p);
  await page.click('#whatif-reset');
  await page.waitForTimeout(900);
  assert.equal(await gaugeValue(page, '#result-gauge'), p);

  // Calibration check renders.
  await page.click('.method summary');
  await page.click('#run-calib');
  assert.match(await page.textContent('#calib-check'), /Naive Bayes/);

  // Downloads.
  const [card] = await Promise.all([page.waitForEvent('download'), page.click('#download-card')]);
  assert.match(card.suggestedFilename(), /\.png$/);
  const [json] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  assert.match(json.suggestedFilename(), /\.json$/);

  // Journal.
  await page.click('#save-journal');
  await page.click('#save-form button[value=save]');
  await page.click('[data-nav=journal]');
  await visible(page, 'journal');
  assert.equal(await page.$$eval('.jitem', (els) => els.length), 1);
  await page.click('[data-act=no]');
  assert.match(await page.textContent('#calibration'), /Brier/);
  await page.click('[data-act=open]');
  await visible(page, 'result');
  assert.deepEqual(errors, []);
  await context.close();
});

test('script injection in the question never executes', { skip }, async () => {
  const { page, context, errors } = await newPage();
  const payload = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>"'&`;
  await ask(page, payload);
  await answerN(page, 3);
  await page.click('#reveal-now');
  await visible(page, 'result');
  await page.waitForTimeout(500);
  await page.click('#save-journal');
  await page.click('#save-form button[value=save]');
  await page.click('[data-nav=journal]');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.$$eval('img[src="x"]', (els) => els.length), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('keyboard-only interview with back and skip', { skip }, async () => {
  const { page, context, errors } = await newPage();
  await ask(page, 'Will my startup succeed?');
  const first = await page.textContent('#q-text');
  await page.keyboard.press('1');
  await page.waitForTimeout(100);
  assert.notEqual(await page.textContent('#q-text'), first);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  assert.equal(await page.textContent('#q-text'), first);
  await page.keyboard.press('s');
  await page.keyboard.press('2');
  await page.keyboard.press('3');
  await page.keyboard.press('2');
  await page.waitForTimeout(100);
  assert.equal(await page.isDisabled('#reveal-now'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('skipping every question still produces a result', { skip }, async () => {
  const { page, context, errors } = await newPage();
  await ask(page, 'Will I live to 90?');
  for (let i = 0; i < 30 && (await page.isVisible('#view-interview')); i++) {
    await page.click('#q-skip');
    await page.waitForTimeout(40);
  }
  await visible(page, 'result');
  await page.waitForTimeout(800);
  const p = await gaugeValue(page, '#result-gauge');
  assert.ok(p >= 15 && p <= 35, `expected ≈ base rate, got ${p}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('answering everything ends the interview automatically', { skip }, async () => {
  const { page, context, errors } = await newPage();
  await ask(page, 'Will it rain on Mars?');
  await answerN(page, 40, (opts) => Math.floor(opts.length / 2));
  await visible(page, 'result');
  assert.deepEqual(errors, []);
  await context.close();
});

test('share link reproduces the forecast; tampered links fail gracefully', { skip }, async () => {
  const { page, context, errors } = await newPage();
  await ask(page, 'Will my relationship last?');
  await answerN(page, 5, () => 0);
  await page.click('#reveal-now');
  await visible(page, 'result');
  await page.waitForTimeout(900);
  const p = await gaugeValue(page, '#result-gauge');
  await page.click('#share-link');
  await page.waitForFunction(() => location.hash.startsWith('#r='));
  const url = page.url();
  assert.match(url, /#r=z/);

  const other = await context.newPage();
  await other.goto(url);
  await visible(other, 'result');
  await other.waitForTimeout(900);
  assert.equal(await gaugeValue(other, '#result-gauge'), p);

  for (const bad of ['#r=zAAAA', '#r=jnotbase64!!', '#r=', '#r=z' + 'A'.repeat(5000)]) {
    const tampered = await context.newPage();
    const tErrors = [];
    tampered.on('pageerror', (e) => tErrors.push(e.message));
    await tampered.goto(base + '/' + bad);
    await visible(tampered, 'home');
    assert.deepEqual(tErrors, []);
    await tampered.close();
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('malformed journal imports are rejected or repaired', { skip }, async () => {
  const { page, context, errors } = await newPage();
  await page.click('[data-nav=journal]');
  await visible(page, 'journal');
  const upload = (text) => page.setInputFiles('#journal-import', { name: 'j.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await upload('not json');
  await upload('{"not":"array"}');
  await upload(JSON.stringify([{ id: 'a', p: 0.4 }, { id: 'b', p: 'x' }, null, 42, { id: 'c', p: 2, title: '<img src=x onerror=window.__pwned=1>', createdAt: 5 }]));
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('.jitem', (els) => els.length), 2);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await page.click('.jitem [data-act=yes]');
  assert.deepEqual(errors, []);
  await context.close();
});

test('mobile layout never scrolls sideways', { skip }, async () => {
  const { page, context, errors } = await newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const noOverflow = async (label) => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= iw + 1, `${label}: page is ${sw}px wide in a ${iw}px viewport`);
  };
  await noOverflow('home');
  await ask(page, `Will I ${'really '.repeat(30)}become rich?`);
  await noOverflow('interview');
  await answerN(page, 4);
  await page.click('#reveal-now');
  await visible(page, 'result');
  await page.waitForTimeout(600);
  await noOverflow('result');
  await page.click('.method summary');
  await page.click('#run-calib');
  await noOverflow('method');
  await page.click('[data-nav=journal]');
  await noOverflow('journal');
  assert.deepEqual(errors, []);
  await context.close();
});

test('what-if lab: clearing a parent answer hides its follow-up question', { skip }, async () => {
  const { page, context, errors } = await newPage();
  await ask(page, 'Will I be rich?');
  // Answer until the conditional "Business trajectory" question has been asked.
  for (let i = 0; i < 20 && (await page.isVisible('#view-interview')); i++) {
    const label = await page.textContent('#q-kicker');
    const opts = await page.$$('#q-options .opt');
    await opts[/Ownership/.test(label) ? 2 : 1].click();
    await page.waitForTimeout(40);
  }
  await visible(page, 'result');
  const has = () => page.$('select[data-id="business_growth"]');
  assert.ok(await has(), 'follow-up should be present');
  await page.selectOption('select[data-id="business"]', '0');
  await page.waitForTimeout(200);
  assert.equal(await has(), null, 'follow-up should disappear');
  await page.selectOption('select[data-id="business"]', '2');
  await page.waitForTimeout(200);
  assert.ok(await has(), 'follow-up should come back');
  assert.deepEqual(errors, []);
  await context.close();
});
