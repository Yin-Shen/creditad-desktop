/**
 * WCAG 2.1 AA text-contrast audit — inventory items B15 / H10.
 *
 *   node tests/a11y/contrast.audit.mjs            # from frontend/
 *
 * Requires the backend and the vite dev server to be up (same prerequisites as
 * tests/e2e/*). Exit codes follow the shared harness: 0 pass, 1 fail, 2 skipped.
 *
 * Why this is not a `getComputedStyle(el).color vs .backgroundColor` walk:
 *
 *  1. Most of this UI's coloured wording sits on a TINTED panel —
 *     `rgba(22,163,74,.14)` and friends. The nearest ancestor with a non-transparent
 *     background is `transparent` or semi-transparent, so the naive walk either
 *     reports "no background" or compares against the raw rgba, and both answers are
 *     wrong. Here every layer from the page canvas up is alpha-composited in order.
 *  2. Several panels use `linear-gradient(...)`, which has no single background
 *     colour at all. A gradient contributes one candidate backdrop per colour stop
 *     and the WORST resulting ratio is the one reported, so a label that is legible
 *     at one end of the ramp and illegible at the other still fails.
 *  3. Inherited `opacity` fades the text toward its backdrop; it is folded into the
 *     text alpha. (`.vci-legend` failed only because of an inline `opacity:.7`.)
 *  4. Text inside a disabled control is exempt under WCAG 1.4.3 ("inactive user
 *     interface component"); counting it made every `:disabled { opacity }` rule
 *     look like a palette bug.
 *
 * Thresholds: 4.5:1 normal text, 3:1 large text (>=24px, or >=18.66px at weight>=700).
 *
 * KNOWN OPEN at the time of writing: the four numbered step chips in
 * HomePage.vue ("How it works", lines ~114-130) still carry literal
 * `color: var(--primary) / #3B82F6 / #8B5CF6 / var(--accent)` inline. They need the
 * text-safe tokens (--primary-text / --info-text / --purple-text / --accent-text)
 * that assets/styles.css already defines. Every other surface is clean.
 */
import {
  FRONTEND_BASE, launchChromium, log, ok, requireBackend, requireFrontend,
  requirePlaywright, runScript, skip,
} from '../e2e/lib/harness.mjs'

const AUDIT_FN = `(() => {
  function parseColor(s) {
    if (!s) return null;
    s = s.trim();
    if (s === 'transparent') return [0, 0, 0, 0];
    let m = s.match(/^rgba?\\(([^)]+)\\)$/);
    if (m) {
      const p = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      if (h.length === 6) h += 'ff';
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16),
              parseInt(h.slice(4,6),16), parseInt(h.slice(6,8),16)/255];
    }
    return null;
  }
  function over(src, dst) {              // src over an opaque dst
    const a = src[3];
    return [src[0]*a + dst[0]*(1-a), src[1]*a + dst[1]*(1-a), src[2]*a + dst[2]*(1-a), 1];
  }
  function lum(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]);
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05);
  }
  function gradientStops(bgImage) {
    if (!bgImage || bgImage === 'none') return [];
    const out = [];
    const re = /(rgba?\\([^)]*\\))|(#[0-9a-fA-F]{3,8})\\b/g;
    let m;
    while ((m = re.exec(bgImage)) !== null) {
      const c = parseColor(m[0]);
      if (c) out.push(c);
    }
    return out;
  }
  function backdrops(el) {
    const chain = [];
    let n = el;
    while (n && n.nodeType === 1) { chain.push(n); n = n.parentElement; }
    const htmlBg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
    let base = [255,255,255,1];
    if (htmlBg && htmlBg[3] > 0) base = over(htmlBg, base);
    if (bodyBg && bodyBg[3] > 0) base = over(bodyBg, base);
    let cands = [base];
    for (let i = chain.length - 1; i >= 0; i--) {
      const cs = getComputedStyle(chain[i]);
      const bc = parseColor(cs.backgroundColor);
      const stops = gradientStops(cs.backgroundImage);
      if (bc && bc[3] > 0) cands = cands.map(c => over(bc, c));
      if (stops.length) {
        const next = [];
        for (const c of cands) for (const s of stops) next.push(over(s, c));
        const seen = new Set(); const uniq = [];
        for (const c of next) {
          const k = c.map(v => Math.round(v)).join(',');
          if (!seen.has(k)) { seen.add(k); uniq.push(c); }
        }
        cands = uniq.slice(0, 24);
      }
    }
    return cands;
  }
  function elementOpacity(el) {
    let o = 1, n = el;
    while (n && n.nodeType === 1) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (!isNaN(v)) o *= v;
      n = n.parentElement;
    }
    return o;
  }
  function isInactive(el) {              // WCAG 1.4.3 incidental exemption
    let n = el;
    while (n && n.nodeType === 1) {
      if (n.disabled === true) return true;
      if (n.getAttribute && n.getAttribute('aria-disabled') === 'true') return true;
      n = n.parentElement;
    }
    return false;
  }
  function hasOwnText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim().length) return true;
    }
    return false;
  }
  const results = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!hasOwnText(el) || isInactive(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const opa = elementOpacity(el);
    if (opa < 0.05) continue;
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3.0 : 4.5;
    let worst = Infinity, worstBg = null;
    for (const bg of backdrops(el)) {
      const eff = over([fg[0], fg[1], fg[2], fg[3] * opa], bg);
      const r = ratio(eff, bg);
      if (r < worst) { worst = r; worstBg = bg; }
    }
    if (worst < need) {
      results.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 70),
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
        color: cs.color,
        bg: worstBg ? 'rgb(' + worstBg.slice(0,3).map(v => Math.round(v)).join(',') + ')' : '?',
        size, weight, need, ratio: Math.round(worst * 100) / 100,
      });
    }
  }
  return results;
})()`

async function auditSurface(page, label, totals) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('dark', t === 'dark')
    }, theme)
    await page.waitForTimeout(250)
    const failures = await page.evaluate(AUDIT_FN)
    totals.push({ label, theme, failures })
    log(`\n  ${label} / ${theme}: ${failures.length} AA text failures`)
    const seen = new Set()
    for (const f of failures) {
      const key = `${f.cls}|${f.color}|${f.bg}`
      if (seen.has(key)) continue
      seen.add(key)
      log(`    ${f.ratio.toFixed(2)} (need ${f.need})  ${f.tag}.${f.cls}`
        + `  color=${f.color} on ${f.bg}  :: "${f.text}"`)
    }
  }
}

await runScript('contrast.audit', async () => {
  await requireBackend()
  await requireFrontend()
  requirePlaywright()

  const browser = await launchChromium()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const totals = []
  try {
    await page.goto(FRONTEND_BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.main-content', { timeout: 180000 })
    await page.waitForTimeout(1500)
    await auditSurface(page, 'Home', totals)

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /help/i.test(x.textContent || ''))
      if (b) b.click()
    })
    await page.waitForTimeout(600)
    await auditSurface(page, 'Help modal', totals)
    await page.evaluate(() => document.querySelector('.modal-bg')?.click())
    await page.waitForTimeout(400)

    const loaded = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => /^Load .* demo$/.test((x.textContent || '').trim()))
      if (!b) return false
      b.click()
      return true
    })
    if (!loaded) skip('the Home demo picker has no "Load … demo" button')
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid^="tick-"]'), null, { timeout: 240000 })
    await page.waitForTimeout(2500)
    await auditSurface(page, 'Visualization', totals)

    // The tier ticks are 2.5px SVG rects that may sit below the fold; a real click
    // would need scrolling, which changes the layout being audited.
    const tick = await page.evaluate(() => {
      const t = document.querySelector('[data-testid^="tick-"]')
      if (!t) return null
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return t.getAttribute('data-testid')
    })
    if (!tick) skip('no tier tick rendered, so the evidence panel cannot be opened')
    await page.waitForSelector('[data-testid="ev-bid"]', { timeout: 30000 })
    await page.waitForTimeout(1200)
    await auditSurface(page, 'Evidence panel', totals)

    // Error branch: an empty rationale is rejected, which paints .ve-err.
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="signout-btn"]')
      if (b && !b.disabled) b.click()
    })
    await page.waitForTimeout(1200)
    await auditSurface(page, 'Evidence panel (error)', totals)

    for (const [pattern, label] of [[/local reviews/i, 'Local Reviews'], [/data manager/i, 'Data Manager']]) {
      await page.evaluate((src) => {
        const re = new RegExp(src, 'i')
        const b = [...document.querySelectorAll('.nav-item')].find(x => re.test(x.textContent || ''))
        if (b) b.click()
      }, pattern.source)
      await page.waitForTimeout(2500)
      await auditSurface(page, label, totals)
    }
  } finally {
    await browser.close()
  }

  log('\n  summary')
  for (const t of totals) log(`    ${t.label} / ${t.theme}: ${t.failures.length}`)
  const total = totals.reduce((n, t) => n + t.failures.length, 0)
  ok(total === 0, `zero WCAG AA text-contrast failures across ${totals.length} surface/theme`
    + ` combinations (found ${total})`)
})
