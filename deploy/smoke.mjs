// Live smoke test after a deploy: one short golden interaction in a real browser against the deployed URL.
// open -> fresh Race Car -> Evaluate -> pick a pin -> Connect mode -> wire STBY into ground (a known-bad merge through the
// normal UI) -> evaluation reads stale -> Re-evaluate -> the standby violation appears -> apply its structured fix ->
// Re-evaluate -> the violation clears -> preview an optimization (before/after renders) -> phone viewport checks.
// Fails on any page error or unhandled rejection, a console error, missing critical UI, a wrong stale/current transition,
// a missing expected finding, or horizontal overflow at 390 px. A deployment confidence check, not an E2E framework.
// Usage: node deploy/smoke.mjs [base-url]   (needs puppeteer-core and the Chrome binary below)
import puppeteer from 'puppeteer-core';
const base = process.argv[2] ?? 'https://circuit.davidwolinsky.com';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/opt/google/chrome/chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const fail = async (msg) => { console.error(`SMOKE FAIL: ${msg}`); await browser.close(); process.exit(1); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 860 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  await page.evaluateOnNewDocument(() => { window.__rejections = []; window.addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason))); });
  const step = (name) => steps.push(name);
  const text = (sel) => page.$eval(sel, (el) => el.textContent ?? '').catch(() => null);
  const clickText = async (sel, re) => { for (const el of await page.$$(sel)) { const t = await el.evaluate((e) => e.textContent ?? ''); if (re.test(t)) { await el.click(); return true; } } return false; };
  const clickPin = (node, pin) => page.evaluate((node, pin) => {
    const g = [...document.querySelectorAll('.node')].find((n) => n.querySelector('.title')?.textContent?.includes(node));
    const p = g && [...g.querySelectorAll('.pin')].find((x) => x.querySelector('text')?.textContent === pin);
    if (!p) return false; p.querySelector('.hitpin').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true;
  }, node, pin);
  const expectChip = async (cls, what) => { await wait(300); if (!(await page.$(`.chip.${cls}`))) await fail(`${what}: expected the state chip to read ${cls}`); };
  const evaluate = async () => { await page.click('#btn-evaluate'); await wait(1500); };

  // 1. health and the library, from a clean browser state
  const health = await fetch(`${base}/healthz`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) await fail('healthz not ok');
  await page.goto(`${base}/`, { timeout: 20000 }); await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.goto(`${base}/`, { timeout: 20000 }); await page.waitForSelector('.cards', { timeout: 10000 }); step('open library');

  // 2. a fresh Bluetooth Race Car (the first card; storage was cleared so it offers Open)
  if (!(await clickText('.card .btn', /^Open$/))) await fail('no Open button on the first card');
  await page.waitForSelector('.dia svg', { timeout: 15000 }); await wait(800);
  if (!/Race Car/i.test((await text('.appbar .brand')) ?? '')) await fail('the opened project is not the Race Car');
  step('open race car');

  // 2b. Learn: the guide opens beside the diagram, a step highlights its parts, Esc closes it, nothing else changes
  if (!(await page.$('#btn-learn'))) await fail('no Learn card in the design panel');
  await page.click('#btn-learn'); await page.waitForSelector('#panel-learn', { timeout: 5000 });
  if (!(await clickText('#panel-learn .chain button', /Motor driver/))) await fail('Learn has no Motor driver step');
  await wait(300); if (!(await page.$('.node.focus'))) await fail('a Learn step did not highlight a part in the diagram');
  await page.keyboard.press('Escape'); await wait(300); if (await page.$('#panel-learn')) await fail('Esc did not close Learn');
  if (await page.$('.chip.cur, .chip.stale')) await fail('Learn changed the evaluation state before any evaluation');
  step('learn');

  // 3. Evaluate
  await evaluate(); await expectChip('cur', 'after Evaluate');
  const header = (await text('#panel-findings h4')) ?? '';
  if (!/violations/.test(header)) await fail(`findings header not rendered: "${header}"`);
  if (await page.$('.finding.bad:not(.res)')) await fail('the baseline Race Car shows a violation');
  step('evaluate baseline');

  // 4-6. select a real pin, enter Connect mode, wire STBY into ground through the merge confirmation
  if (!(await clickPin('XIAO', 'D6'))) await fail('could not click pin XIAO D6');
  await page.waitForSelector('.sheet', { timeout: 5000 });
  if (!(await clickText('.sheet .btn', /Connect to another pin/))) await fail('pin sheet has no Connect button');
  await page.waitForSelector('.dia.connecting .connectbar', { timeout: 5000 });
  if ((await page.$$('.pin.cand')).length === 0) await fail('connect mode shows no candidate pins');
  if (!(await clickPin('TB6612', 'GND'))) await fail('could not click pin TB6612 GND');
  await page.waitForSelector('.connectbar', { timeout: 5000 });
  if (!(await clickText('.connectbar .btn', /^Merge$/))) await fail('merge confirmation did not appear');
  step('connect D6 to GND');

  // 7. the previous evaluation is stale
  await expectChip('stale', 'after the connect');
  if (!/from the previous state/.test((await text('#panel-findings h4')) ?? '')) await fail('findings header does not say the result is from the previous state');
  if (!/Undo \(1\)/.test((await text('.appbar')) ?? '')) await fail('Undo does not count the connect');
  step('stale after edit');

  // 8-9. re-evaluate: the deterministic standby finding appears with a fix
  await evaluate(); await expectChip('cur', 'after Re-evaluate');
  if (!(await clickText('.finding.bad .t', /standby/i))) await fail('expected violation about the driver held in standby is missing');
  await page.waitForSelector('.finding.open .detail', { timeout: 5000 });
  const detail = (await text('.finding.open .detail')) ?? '';
  if (!/driver_enable_state/.test(detail)) await fail('the open finding is not driver_enable_state');
  if (!/Evidence/.test(detail) || !/Consequence/.test(detail)) await fail('finding detail lacks evidence or consequence');
  step('standby violation with detail');

  // 10-11. apply the structured fix, re-evaluate, the violation clears
  if (!(await clickText('.finding.open .fixes .btn', /^Apply/))) await fail('the standby finding offers no structured fix');
  await expectChip('stale', 'after applying the fix');
  await evaluate(); await expectChip('cur', 'after the fix re-evaluation');
  if (await page.$('.finding.bad:not(.res)')) await fail('a violation remains after the fix');
  if (!(await page.$('.finding.res'))) await fail('the cleared violation is not shown as resolved');
  step('fix applied, violation cleared');

  // 11b. disconnect a pin, then wire it back from the freed pin itself: the pin stays drawn and selectable
  if (!(await clickPin('TB6612', 'MOTORB2'))) await fail('could not click pin TB6612 MOTORB2');
  await page.waitForSelector('#panel-pin', { timeout: 5000 });
  if (!(await clickText('#panel-pin .btn', /^Disconnect$/))) await fail('pin sheet has no Disconnect button');
  await expectChip('stale', 'after the disconnect');
  const freed = await page.evaluate(() => { const g = [...document.querySelectorAll('.node')].find((n) => n.querySelector('.title')?.textContent?.includes('TB6612')); const p = g && [...g.querySelectorAll('.pin')].find((x) => x.querySelector('text')?.textContent === 'MOTORB2'); return p ? p.getAttribute('class') : null; });
  if (!freed) await fail('MOTORB2 disappeared from the diagram after the disconnect');
  if (!/\bnc\b/.test(freed)) await fail('MOTORB2 is not drawn as unconnected after the disconnect');
  if (!(await clickPin('TB6612', 'MOTORB2'))) await fail('could not select the freed pin MOTORB2');
  if (!(await clickText('#panel-pin .btn', /Connect to another pin/))) await fail('freed pin sheet has no Connect button');
  await page.waitForSelector('.dia.connecting', { timeout: 5000 });
  if (!(await clickPin('Right motor', 'M-'))) await fail('could not click pin Right motor M-');
  await wait(400); if (await page.$('.dia.connecting')) await fail('connect mode did not finish after picking M-');
  await evaluate(); await expectChip('cur', 'after the reconnect');
  if (await page.$('.finding.bad:not(.res)')) await fail('a violation remains after reconnecting MOTORB2');
  step('disconnect and reconnect a pin');

  // 12. preview one optimization: the before/after comparison renders with modeled quantities
  if (!(await clickText('#panel-optimize .btn', /Preview before/))) await fail('no optimization preview button');
  await page.waitForSelector('.overlay .compare', { timeout: 5000 });
  const cmp = (await text('.overlay .compare')) ?? '';
  if (!/Before/.test(cmp) || !/After/.test(cmp) || !/Modeled quantities/.test(cmp)) await fail('compare overlay lacks the before/after table');
  if (!(await clickText('.compare .btn', /Keep current design/))) await fail('compare overlay has no Keep button');
  await wait(300); if (await page.$('.overlay .compare')) await fail('compare overlay did not close');
  step('optimization preview');

  // 13. phone viewport: no horizontal overflow, tabs and the bottom bar render
  await page.setViewport({ width: 390, height: 844 }); await wait(900);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth); if (sw > 390) await fail(`phone page scrolls horizontally (${sw}px)`);
  if (!(await page.$('.tabs'))) await fail('phone layout has no tabs');
  if (!(await page.$('.evalbar'))) await fail('phone layout has no bottom bar after edits');
  if (!(await page.$('.dia svg'))) await fail('phone layout has no diagram');
  step('phone viewport');

  const rejections = await page.evaluate(() => window.__rejections ?? []);
  if (rejections.length) errors.push(...rejections.map((r) => `unhandledrejection: ${r}`));
  if (errors.length) await fail(`browser errors: ${errors.join(' | ')}`);
  console.log(`SMOKE OK: ${base} commit ${health.commit} · ${steps.join(' → ')}`);
  await browser.close();
} catch (e) { await fail(`${e.message} (after: ${steps.join(' → ') || 'nothing'})`); }
