// Sanity check for phase U3, in a real browser against a running server.
//   1. change the name, leave without saving  -> the in-app "Discard unsaved changes?" dialog appears (no browser alert)
//   2. Keep editing stays; Discard leaves and nothing was saved
//   3. change the name, Save, reload          -> the change is kept; greeting shows it
//   4. change something, Cancel               -> reverted
// Usage:  node scripts/check-settings.mjs http://127.0.0.1:8001
import fs from 'node:fs';

import puppeteer from 'puppeteer-core';

const base = (process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) { console.error('No Edge/Chrome found. Set BROWSER_PATH.'); process.exit(2); }

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok     ' : 'PROBLEM'} ${msg}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 800 });
const nativeDialogs = [];
page.on('dialog', async (d) => { nativeDialogs.push(d.type()); await d.dismiss(); });

const profile = { onboarded: true, name: 'Tanish', voiceOn: true, language: 'en', caution: 'cautious', home: { label: 'Sector 29', lat: 28.467, lon: 77.065 }, work: { label: 'Cyber Hub', lat: 28.4951, lon: 77.0891 }, recentTrips: [] };
await page.goto(base + '/about', { waitUntil: 'domcontentloaded' });
await page.evaluate((p) => { localStorage.clear(); localStorage.setItem('routerain.profile', JSON.stringify(p)); }, profile);

const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('routerain.profile') || 'null'));
const nameValue = () => page.$eval('#settings-name', (e) => e.value);
const saveDisabled = () => page.$eval('.rr-savebar .rr-btn.primary', (e) => e.disabled);
const clickText = (sel, text) => page.evaluate((s, t) => { [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t)?.click(); }, sel, text);
const typeName = async (v) => {
  await page.focus('#settings-name');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(v);
};
const dialogTitle = () => page.evaluate(() => document.querySelector('[role=alertdialog] h2')?.textContent ?? null);
const path = () => page.evaluate(() => location.pathname);

await page.goto(base + '/settings', { waitUntil: 'networkidle0' });
check(await nameValue() === 'Tanish' && await saveDisabled(), 'opens with the saved name; Save is disabled');

// 1 + 2: leave without saving
await typeName('Aryan');
check(!(await saveDisabled()), 'typing enables Save');
check((await stored()).name === 'Tanish', 'nothing stored while editing');
await clickText('.rr-tabs a, nav a', 'Hotspots');
await sleep(300);
check(await dialogTitle() === 'Discard unsaved changes?', 'leaving by a tab shows "Discard unsaved changes?"');
check(await path() === '/settings', 'still on /settings while the dialog is open');
await clickText('[role=alertdialog] button', 'Keep editing');
await sleep(150);
check(await dialogTitle() === null && await nameValue() === 'Aryan', 'Keep editing closes the dialog and keeps the draft');
await clickText('.rr-tabs a, nav a', 'Hotspots');
await sleep(200);
await clickText('[role=alertdialog] button', 'Discard changes');
await sleep(500);
check(await path() === '/hotspots', 'Discard changes leaves');
check((await stored()).name === 'Tanish', 'the discarded name was never saved');

// 3: save -> reload
await page.goto(base + '/settings', { waitUntil: 'networkidle0' });
await typeName('Preet');
await clickText('.rr-savebar button', 'Save changes');
await sleep(200);
check(await page.$eval('.rr-toast', (e) => e.textContent) === 'Settings saved', 'toast says "Settings saved"');
check(await saveDisabled(), 'Save is disabled again after saving');
check((await page.$eval('header, [role=banner]', (e) => e.textContent)).includes('Preet'), 'the header greeting changed at once');
await clickText('.rr-tabs a, nav a', 'About');
await sleep(300);
check(await dialogTitle() === null && await path() === '/about', 'no prompt after saving');
await page.goto(base + '/settings', { waitUntil: 'networkidle0' });
await page.reload({ waitUntil: 'networkidle0' });
check(await nameValue() === 'Preet' && (await stored()).name === 'Preet', 'reload: the saved name is kept');

// 4: cancel
await typeName('Someone');
await page.evaluate(() => document.querySelector('input[type=checkbox]')?.click());
await clickText('.rr-savebar button', 'Cancel');
await sleep(150);
check(await nameValue() === 'Preet' && await saveDisabled(), 'Cancel reverts the draft');
check((await stored()).name === 'Preet', 'Cancel stored nothing');

// validation
await page.evaluate(() => { const i = document.querySelector('#settings-name'); i.removeAttribute('maxlength'); });
await typeName('x'.repeat(45));
await clickText('.rr-savebar button', 'Save changes');
await sleep(150);
check((await page.$eval('#name-error', (e) => e.textContent)).includes('at most 40'), 'a 45-character name is refused with a message');
check((await stored()).name === 'Preet', 'and nothing was stored');

check(nativeDialogs.length === 0, `no native browser alert/confirm used (${nativeDialogs.join(',') || 'none'})`);
await browser.close();
console.log(failed ? `\n${failed} problem(s)` : '\nAll U3 browser checks passed.');
process.exit(failed ? 1 : 0);
