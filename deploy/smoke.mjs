// Live smoke test after a deploy: login, open the race car, evaluate, see findings, check the phone viewport, no page errors.
// Usage: node deploy/smoke.mjs [base-url]   (run from the repo checkout; needs puppeteer-core and the Chrome binary below)
import puppeteer from 'puppeteer-core';
const base = process.argv[2] ?? 'https://circuit.davidwolinsky.com';
const user = process.env.GATE_USER, pass = process.env.GATE_PASS;
if (!user || !pass) { console.error('SMOKE FAIL: set GATE_USER and GATE_PASS in the environment'); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/opt/google/chrome/chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const fail = async (msg) => { console.error(`SMOKE FAIL: ${msg}`); await browser.close(); process.exit(1); };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 860 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const health = await fetch(`${base}/healthz`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) await fail('healthz not ok');
  await page.goto(`${base}/login`, { timeout: 20000 }); await page.type('#username', user); await page.type('#password', pass);
  await Promise.all([page.waitForNavigation({ timeout: 20000 }), page.click('button[type=submit]')]);
  await page.waitForSelector('.cards', { timeout: 10000 });
  const btn = (await page.$$('.card .btn'))[0]; await btn.click(); await page.waitForSelector('.dia svg', { timeout: 15000 }); await wait(800);
  await page.click('#btn-evaluate'); await wait(1500);
  const header = await page.$eval('#panel-findings h4', (h) => h.textContent).catch(() => '');
  if (!/violations/.test(header)) await fail(`findings header not rendered: "${header}"`);
  await page.setViewport({ width: 390, height: 844 }); await wait(800);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth); if (sw > 390) await fail(`phone page scrolls horizontally (${sw}px)`);
  if (errors.length) await fail(`page errors: ${errors.join(' | ')}`);
  console.log(`SMOKE OK: ${base} commit ${health.commit}, findings header "${header.trim()}"`);
  await browser.close();
} catch (e) { await fail(e.message); }
