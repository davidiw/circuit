// Captures the reviewer walkthrough from a running build into out/walkthrough/ (git-ignored): walkthrough.md plus 12 PNGs.
// The published walkthrough page is built from that output; it is not tracked in this repository.
// Usage: WALKTHROUGH_URL=http://127.0.0.1:8797 GATE_USER=... GATE_PASS=... node scripts/walkthrough.mjs   (npm run walkthrough)
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.WALKTHROUGH_URL ?? 'http://127.0.0.1:8797'; const user = process.env.GATE_USER, pass = process.env.GATE_PASS;
if (!user || !pass) { console.error('set GATE_USER and GATE_PASS'); process.exit(1); }
const out = process.env.WALKTHROUGH_OUT ?? 'out/walkthrough'; mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/opt/google/chrome/chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (sel, text) => { for (const el of await page.$$(sel)) { const t = await el.evaluate((e) => e.textContent); if (t !== null && t.includes(text)) { await el.click(); return; } } throw new Error(`no ${sel} containing "${text}"`); };
const clickPin = async (node, pin) => { await page.evaluate((node, pin) => { const g = [...document.querySelectorAll('.node')].find((n) => n.querySelector('.title')?.textContent?.includes(node)); const p = [...g.querySelectorAll('.pin')].find((x) => x.querySelector('text')?.textContent === pin); p.querySelector('.hitpin').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, node, pin); await wait(500); };
const shot = (n, o = {}) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true, ...o });
const steps = [
  ['01-project', 'Open', 'The artifact, before evaluation', 'One line says what the design is. The strip says what it is made of: power source, parts, nets, assumptions, rules. The stepper shows the loop with one inline hint. Below the diagram: findings (empty, and it says why), guided changes, Optimize, and the design panel with requirements, assumptions, and parts.'],
  ['02-learn', 'Learn', 'How this design works', 'The card at the top of the design panel opens the guide beside the diagram: the system flow as clickable steps (here Regulation is selected and its parts and wires are highlighted), power, control, and result in three lines, what each part does and why it is here, and the engineering decisions behind the design. Every number is a live fact or assumption with its provenance tag.'],
  ['03-evaluated', 'Evaluate', 'Clean, with two opportunities', 'The deterministic rules ran in the browser. No violations. Requirements flip to "met", the runtime target reads "above target", and two opportunities appear: the battery is far larger than the runtime goal needs, and the motors run below their rating. Coverage docks under the findings with a status and an outcome per dimension; rows that leaned on an assumption read "partial" and say which value.'],
  ['04-connect', 'Wire a pin', 'Connect mode', 'Tapping the XIAO D6 pin opened its sheet; "Connect to another pin" armed connect mode. The source pin glows, every legal target pin gets a ring, the rest dim, a rubber band follows the pointer, and the bar names the source and offers Cancel.'],
  ['05-stale', 'Commit the change', 'Merge confirmed, evaluation stale', 'Picking the driver GND pin asked to merge STBY with GND. After confirming, the ground net kept its identity, the state chip reads "changed since evaluation", the findings header says the result is from the previous state, and Undo counts one change.'],
  ['06-finding', 'Re-evaluate, open the finding', 'The rule fires and offers fixes', 'The driver is held in standby. Evidence names the pin, the net, and the board pull-up with its source. Under "Fix it", Apply buttons run the same structured op a manual edit would.'],
  ['07-fixed', 'Apply a fix, re-evaluate', 'The finding clears', 'The violation shows once more, dimmed and marked resolved, with the reason it cleared. The hint moves the reviewer on to Optimize.'],
  ['08-part', 'Inspect a part', 'Role and key constraints first', 'The driver sheet shows its role, verification status, key constraints with per-fact provenance, findings that touch it, and its connections. Every fact, pin, and source is one disclosure away.'],
  ['09-compare', 'Optimize', 'Before and after, no score', 'Right-sizing the battery previewed: capacity, estimated runtime, and mass before and after; the runtime requirement from "above target" to "met"; one assumption changed; the runtime opportunity resolves; the accepted risk is spelled out. The evaluator ran on the real candidate state.'],
  ['10-optimized', 'Apply', 'The optimization is an edit like any other', 'After applying, the battery assumption carries "you" provenance, the requirement reads "met", the optimization is marked applied, and Undo can take it back.'],
  ['11-library', 'Library', 'Resume or start fresh', 'Saved sessions are versioned per browser. A card offers Resume or Start fresh with an inline confirm. Cards state exact parts versus component classes and the number of guided changes and optimizations.'],
  ['12-phone', 'Phone', 'Same artifact at 390 px', 'Fit-to-width thumbnail, tabs for Findings, Changes, and Design, a bottom sheet for the selection, and a bottom bar only when there is an action.'],
  ['13-phone-full', 'Phone, full-screen', 'Wiring on a phone', 'The full-screen view zooms in steps for touch targets and hosts the selection sheet inside it.'],
];
try {
  await page.goto(`${base}/login`); await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.type('#username', user); await page.type('#password', pass); await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]); await page.waitForSelector('.cards');
  await clickText('.card .btn', 'Open'); await page.waitForSelector('.dia svg'); await wait(900); await shot('01-project');
  await page.click('#btn-learn'); await page.waitForSelector('#panel-learn'); await clickText('#panel-learn .chain button', 'Regulation'); await wait(500); await shot('02-learn'); await page.keyboard.press('Escape'); await wait(300);
  await page.click('#btn-evaluate'); await wait(1300); await shot('03-evaluated');
  await clickPin('XIAO', 'D6'); await clickText('.sheet .btn', 'Connect to another pin'); await wait(300); await page.mouse.move(700, 300); await wait(200); await shot('04-connect', { fullPage: false });
  await clickPin('TB6612', 'GND'); await wait(300); await clickText('.connectbar .btn', 'Merge'); await wait(1000); await shot('05-stale');
  await page.click('#btn-evaluate'); await wait(1300); await clickText('.finding .t', 'standby'); await wait(400); await shot('06-finding');
  await clickText('.fixes .btn', 'Apply'); await wait(900); await page.click('#btn-evaluate'); await wait(1300); await shot('07-fixed');
  await page.evaluate(() => { const t = [...document.querySelectorAll('.node .title')].find((x) => x.textContent.includes('TB6612')); t?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await wait(400); await shot('08-part');
  await page.keyboard.press('Escape'); await clickText('.optimize .btn', 'Preview'); await wait(800); await shot('09-compare', { fullPage: false });
  await clickText('.compare .btn', 'Apply this change'); await wait(1200); await shot('10-optimized');
  await page.goto(`${base}/`); await page.waitForSelector('.cards'); await wait(300); await shot('11-library');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); await clickText('.card .btn', 'Resume'); await page.waitForSelector('.dia svg'); await wait(900); await shot('12-phone', { fullPage: false });
  await clickText('.fullbtn', 'full-screen'); await wait(700); await shot('13-phone-full', { fullPage: false });
} finally { await browser.close(); }
const md = ['# Circuit Factory walkthrough', '', 'Screenshots of the running build along the loop a cold reviewer takes: inspect, change actual connectivity, watch the evaluation go stale, evaluate, understand the consequence, fix it, optimize, and compare the tradeoffs. Regenerate with `npm run walkthrough` against a running build.', ''];
steps.forEach(([f, num, h, p], i) => md.push(`## ${i + 1}. ${num}: ${h}`, '', p, '', `![${h}](${f}.png)`, ''));
writeFileSync(`${out}/walkthrough.md`, md.join('\n')); console.log(`wrote ${out}/walkthrough.md and ${steps.length} screenshots`);
