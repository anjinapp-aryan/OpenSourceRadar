// Phase 5.5 browser validation: serves ./out, drives installed Chrome through playwright-core, records overflow,
// console errors, axe-core violations and screenshots. Usage: node scripts/browser-validate.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const OUT = 'out';
const SHOTS = 'results/phase5.5/shots';
mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = join(OUT, u);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  // Next 16 static export requests __next.a.b.txt but writes __next.a/b.txt; hosts such as Vercel rewrite this, so mirror it here.
  if (!existsSync(f)) f = join(OUT, u.replace(/^(.*\/)__next\.(.+)\.__PAGE__\.txt$/, (_, d, segs) => `${d}__next.${segs.split('.').join('/')}/__PAGE__.txt`));
  if (!existsSync(f)) { f = join(OUT, '404.html'); res.statusCode = 404; console.log('404', u); }
  res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
}).listen(4600);

const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const widths = [1440, 1280, 1024, 768, 390, 375];
const pages = [['home', '/'], ['explore', '/explore/'], ['explore-filtered', '/explore/?category=ai-agents&filter=rising&sort=growth7d'], ['repo', '/repo/vectorize-io/hindsight/'], ['methodology', '/methodology/']];
const report = [];
const mode = process.argv[2] === 'reduced' ? 'reduce' : 'no-preference';
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: mode });
  for (const [name, path] of pages) {
    const page = await ctx.newPage();
    const errors = [];
    const external = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4600')) external.push(r.url()); });
    await page.goto('http://localhost:4600' + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const clipped = [...document.querySelectorAll('.card,.metric,.catcard,.panel,.seg:not(.scroll) .pill')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > de.clientWidth + 1 || r.left < -1; }).length;
      const small = [...document.querySelectorAll('body *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).length;
      const targets = [...document.querySelectorAll('.pill,.linkbtn,.nav a')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 43.5; }).length;
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, clipped, small, smallTargets: targets, bodyBg: getComputedStyle(document.body).backgroundColor, h1: document.querySelectorAll('h1').length };
    });
    let axe = null;
    if (mode === 'no-preference' && (w === 1440 || w === 390)) {
      await page.evaluate(axeSrc);
      axe = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0].target.join(' ') })); });
    }
    if (mode === 'no-preference') await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: w === 1440 || w === 390 });
    report.push({ page: name, width: w, overflowX: m.scrollW > m.clientW, ...m, errors, external, axe });
    await page.close();
  }
  await ctx.close();
}
// keyboard: tab order reaches skip link, nav, then a card link; focus outline visible
const kctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const kp = await kctx.newPage();
await kp.goto('http://localhost:4600/', { waitUntil: 'networkidle' });
const seq = [];
for (let i = 0; i < 6; i++) { await kp.keyboard.press('Tab'); seq.push(await kp.evaluate(() => { const a = document.activeElement; return `${a.tagName}:${(a.textContent || '').trim().slice(0, 24)}:${getComputedStyle(a).outlineStyle}/${getComputedStyle(a).outlineWidth}`; })); }
// interaction: click filter pill, check URL and result count
await kp.goto('http://localhost:4600/explore/', { waitUntil: 'networkidle' });
await kp.click('nav[aria-label="Filter by trend"] >> text=Rising');
await kp.waitForURL(/filter=rising/);
const count = await kp.textContent('.resultbar');
await kp.click('nav[aria-label="Filter by category"] >> text=MCP');
await kp.waitForURL(/category=mcp/);
const url2 = kp.url();
await kp.reload({ waitUntil: 'networkidle' });
const count2 = await kp.textContent('.resultbar');
const cur = await kp.$$eval('[aria-current="true"]', (e) => e.map((x) => x.textContent));
await kctx.close();
await browser.close();
server.close();
writeFileSync(`results/phase5.5/validation-${mode}.json`, JSON.stringify({ report, keyboard: seq, interaction: { count, url2, count2, cur } }, null, 1));
const bad = report.filter((r) => r.overflowX || r.clipped || r.errors.length || r.external.length || (r.axe && r.axe.length));
console.log('runs', report.length, 'problems', bad.length);
for (const b of bad) console.log(b.page, b.width, JSON.stringify({ ox: b.overflowX, clipped: b.clipped, err: b.errors, ext: b.external.length, axe: b.axe }));
console.log('smallText', report.filter((r) => r.small).length, 'smallTargets', report.filter((r) => r.smallTargets).length);
console.log(seq.join('\n'), '\n', count, url2, count2, cur.join('|'));
