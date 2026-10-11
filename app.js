/* Gistihúsið, Lake Hotel Egilsstaðir: the Hótel Holt engine, transplanted whole from
   the Óðinsvé build (03-prototypes/odinsve), identity re-skinned
   scroller (lerp .1 + gravity wells + snap) · parallax-V-E keyframe engine ·
   reveal system · split titles · lazy media · preloader · themed header · menu ·
   sticky slider · WebGL rings · map · quotes cursor · footer mask */
/* three.js is 671KB. Importing it at the top costs that on EVERY page, including
   the four room pages that have no WebGL at all. Load it on demand instead, the
   first time a ring chapter comes within range, and let the chapter loader cover
   the wait. */
let THREE = null, texLoader = null, threeReq = null;
const ensureThree = () => threeReq || (threeReq = import('three').then(m => { THREE = m; texLoader = new m.TextureLoader(); return m; }));

import Lenis from './assets/vendor/lenis.js';

const html = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const isMac = /Mac/.test(navigator.platform);
const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Match the CSS breakpoint EXACTLY. `innerWidth >= 768` is not the same test:
   when content overflows horizontally, mobile Chrome shrink-to-fits and reports a
   ballooned innerWidth (measured 1500 on a 375px iPhone), so the JS took the
   desktop path while the CSS took the mobile one — which produced the very
   overflow that caused the zoom-out. matchMedia cannot drift from the stylesheet. */
const mdUp = () => matchMedia('(min-width: 768px)').matches;
const SMOOTH = !isTouch && !reduced && mdUp();
html.classList.add(SMOOTH ? 'has-scroll-smooth' : 'no-scroll-smooth');
if (isTouch) html.classList.add('no-hover');

/* ---------- viewport ---------- */
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:100svh;pointer-events:none;visibility:hidden';
document.body.appendChild(probe);
let VH = probe.offsetHeight || innerHeight, VW = document.documentElement.clientWidth || innerWidth;
const measureViewport = () => { VH = probe.offsetHeight || innerHeight; VW = document.documentElement.clientWidth || innerWidth; };
const spacing = () => parseFloat(getComputedStyle(html).getPropertyValue('--spacing')) || 20;

/* ---------- easings ---------- */
const E = {
  linear: t => t,
  easeInQuad: t => t * t, easeOutQuad: t => t * (2 - t), easeInOutQuad: t => t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: t => t ** 3, easeOutCubic: t => 1 - (1 - t) ** 3, easeInOutCubic: t => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  easeOutExpo: t => t === 1 ? 1 : 1 - 2 ** (-10 * t),
  easeSection: t => 2 * t - t * t, easeSectionInverse: t => t * t,
};
const bezier = (x1, y1, x2, y2) => {
  const A = (a1, a2) => 1 - 3 * a2 + 3 * a1, B = (a1, a2) => 3 * a2 - 6 * a1, C = a1 => 3 * a1;
  const calc = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const slope = (t, a1, a2) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const s = slope(t, x1, x2); if (!s) break; t -= (calc(t, x1, x2) - x) / s; }
    return calc(t, y1, y2);
  };
};
const easeSnap = bezier(.25, 0, .35, 1);
const easeHouse = bezier(.7, 0, .3, 1);

/* ---------- doc positions (layout, transform-free) ---------- */
const docTop = el => { let y = 0; while (el) { y += el.offsetTop; el = el.offsetParent; } return y; };
const docLeft = el => { let x = 0; while (el) { x += el.offsetLeft; el = el.offsetParent; } return x; };

/* ============================================================
   SCROLLER
   ============================================================ */
const scroller = (() => {
  /* Lenis drives the damped wheel, as on the rest of the fleet, instead of the
     hand-rolled lerp this engine shipped with. Two things are kept from the old
     scroller because Lenis has no equivalent:
       - the gravity wells, applied by modulating lenis.options.lerp per frame, and
       - the snap points, applied through lenis.scrollTo.
     Everything downstream still reads `scroller.y`, so the parallax, the reveals and
     the WebGL ring are untouched.
     Lenis is mounted ONLY when SMOOTH is true, and SMOOTH is
     `!isTouch && !reduced && mdUp()` — on a phone the page scrolls natively, which is
     the whole point: a JS scroller keeps iOS Safari's tall toolbar for the entire
     visit and freezes every nested scroller. */
  const s = { y: scrollY, target: scrollY, limit: 0, moving: false, wells: [], snaps: [], listeners: [] };
  const LERP = .14, BAND = () => VH * .25;
  let snapTimer = 0, lenis = null, tweening = false;

  const setLimit = () => { s.limit = Math.max(0, document.scrollingElement.scrollHeight - innerHeight); };
  const wellFactor = y => {
    let f = 1;
    for (const w of s.wells) { const d = Math.abs(y - w); if (d < BAND()) f = Math.min(f, clamp((d / BAND() + .62) / 1.62)); }
    return f;
  };
  const inBand = y => s.wells.some(w => Math.abs(y - w) < BAND());

  if (SMOOTH) {
    lenis = new Lenis({
      lerp: LERP,
      smoothWheel: true,
      syncTouch: false,          // never take over touch scrolling
      wheelMultiplier: isMac ? .85 : 1.15,
      autoRaf: false,            // this engine already owns the rAF loop
    });
    lenis.on('scroll', () => { clearTimeout(snapTimer); snapTimer = setTimeout(trySnap, 250); });
  }

  const trySnap = () => {
    if (!lenis || !s.snaps.length || tweening) return;
    const y = lenis.targetScroll, pts = s.snaps;
    const first = pts[0].y, last = pts[pts.length - 1].y;
    if (y < first - VH * .5 || y > last + VH * .5) return;
    const lastScrollable = pts[pts.length - 1].scrollable;
    if (lastScrollable && y > pts[pts.length - 2].y + VH * .5) return;
    let best = pts[0]; for (const p of pts) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
    if (Math.abs(best.y - y) < 1) return;
    tweenTo(best.y, 1000, easeSnap);
  };

  const tweenTo = (to, dur, ease = easeHouse) => {
    if (!lenis) { window.scrollTo({ top: to, behavior: reduced ? 'auto' : 'smooth' }); return; }
    tweening = true;
    lenis.scrollTo(to, { duration: dur / 1000, easing: ease, lock: true,
      onComplete: () => { tweening = false; } });
  };

  /* Snap the value the parallax reads to the device-pixel grid. The browser places
     position:sticky on whole device pixels; a transform written from the raw
     fractional scroll disagrees with it by a fraction, and that is what read as
     shimmer on the pinned chapters. */
  const DPR = () => Math.max(1, Math.min(devicePixelRatio || 1, 3));
  const snap = v => Math.round(v * DPR()) / DPR();

  const tick = () => {
    if (!lenis) { s.y = s.target = scrollY; s.moving = false; return; }
    // the gravity band, re-expressed as a per-frame lerp and wheel damping
    const t = lenis.targetScroll;
    lenis.options.lerp = tweening ? LERP : LERP * wellFactor(lenis.animatedScroll);
    lenis.options.wheelMultiplier = (isMac ? .85 : 1.15) * (inBand(t) ? .45 : 1);
    lenis.raf(performance.now());
    s.y = snap(lenis.animatedScroll);
    s.target = lenis.targetScroll;
    s.moving = !!lenis.isScrolling;
    html.classList.toggle('has-scroll-scrolling', s.moving);
  };

  const scrollToEl = (el, offset = 0) => {
    const to = clamp(docTop(el) + offset, 0, s.limit);
    if (!lenis) { window.scrollTo({ top: to, behavior: reduced ? 'auto' : 'smooth' }); return; }
    const dist = Math.abs(to - s.y);
    if (dist > VH * 2) {
      // a long jump goes behind the curtain rather than tweening through ten chapters
      const ov = $('#page-overlay'); ov.classList.add('is-on');
      setTimeout(() => {
        lenis.scrollTo(to, { immediate: true });
        setTimeout(() => ov.classList.remove('is-on'), 80);
      }, 420);
    } else tweenTo(to, 1000, easeHouse);
  };

  // a modal must not scroll the page behind it; nested scrollers inside it carry
  // data-lenis-prevent so stopping Lenis cannot freeze them
  const setStopped = v => { if (lenis) v ? lenis.stop() : lenis.start(); };

  return Object.assign(s, { tick, setLimit, scrollToEl, tweenTo, wellFactor, setStopped,
    get lenis() { return lenis; }, get isTweening() { return tweening; } });
})();

/* custom scrollbar */
(() => {
  if (!SMOOTH) return;
  const bar = $('#scrollbar'), thumb = $('.c-scrollbar__thumb', bar);
  let drag = false, startY = 0, startScroll = 0;
  const update = () => {
    const total = document.scrollingElement.scrollHeight;
    const h = Math.max(40, VH * VH / total);
    thumb.style.height = h + 'px';
    thumb.style.transform = `translateY(${(scroller.y / (scroller.limit || 1)) * (VH - h)}px)` + (bar.matches(':hover') || drag ? ' scaleX(1.45)' : '');
  };
  thumb.addEventListener('pointerdown', e => { drag = true; startY = e.clientY; startScroll = scroller.y; bar.classList.add('is-dragging'); thumb.setPointerCapture(e.pointerId); e.preventDefault(); });
  thumb.addEventListener('pointermove', e => { if (!drag) return; const h = thumb.offsetHeight; const dy = e.clientY - startY; const to = clamp(startScroll + dy / (VH - h) * scroller.limit, 0, scroller.limit); if (scroller.lenis) scroller.lenis.scrollTo(to, { immediate: true }); else window.scrollTo(0, to); scroller.y = scroller.target = to; });
  thumb.addEventListener('pointerup', () => { drag = false; bar.classList.remove('is-dragging'); });
  scroller.listeners.push(update);
})();

/* ============================================================
   PARALLAX ENGINE — parallax-<V>-<E>
   key scroll = measureTop + measureH*E/100 - VH*V/100 (+ off*VH)
   ============================================================ */
const sp = () => spacing();
const PATTERNS = {
  sectionOutTiny: { measure: 'self', keys: el => el.classList.contains('sticky--under-next')
      ? [{ v: 200, e: 100, p: { transform: 'translateY(0svh)' } }, { v: 100, e: 100, p: { transform: 'translateY(-10svh)' } }]
      : [{ v: 100, e: 100, p: { transform: 'translateY(0svh)' } }, { v: 0, e: 100, p: { transform: 'translateY(10svh)' } }], clamp: true },
  imageMove: { measure: 'self', target: 'img', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(-16.667%)' } }, { v: 0, e: 100, p: { transform: 'translateY(0%)' } }], clamp: true, mobile: true },
  backgroundMove: { measure: 'closest:.section', target: 'img', keys: () => [{ v: 100, e: 0, p: { transform: 'scale(1.2) translateY(-8.33%)' } }, { v: 0, e: 100, p: { transform: 'scale(1.2) translateY(8.33%)' } }], clamp: true, mobile: true },
  landingLuxuryTitle: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: `translateY(${-5 * sp()}px)` }, easing: 'easeOutQuad' }, { v: 0, e: 0, p: { transform: 'translateY(0px)' } }], clamp: true },
  landingLuxuryMoveSideDesktop: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: `translateY(${-10 * sp()}px)` } }, { v: 25, e: 0, p: { transform: `translateY(${-2.5 * sp()}px)` }, easing: 'easeOutQuad' }, { v: 0, e: 0, p: { transform: 'translateY(0px)' } }], clamp: true },
  landingLuxuryScaleCenterDesktop: { measure: 'closest:.sticky', keys: () => [{ v: 65, e: 0, p: { transform: 'scale(1)', 'clip-path': 'inset(0% 0)' } }, { v: 0, e: 0, off: 1, p: { transform: 'scale(1.4)', 'clip-path': 'inset(10% 0)' } }], easing: 'easeInOutQuad', clamp: true },
  landingLuxuryScaleSideLeftDesktop: { measure: 'closest:.sticky', keys: () => [{ v: 65, e: 0, p: { transform: 'translateX(0vw)' } }, { v: 0, e: 0, off: 1, p: { transform: 'translateX(-8.33vw)' } }], easing: 'easeInOutQuad', clamp: true },
  landingLuxuryScaleSideRightDesktop: { measure: 'closest:.sticky', keys: () => [{ v: 65, e: 0, p: { transform: 'translateX(0vw)' } }, { v: 0, e: 0, off: 1, p: { transform: 'translateX(8.33vw)' } }], easing: 'easeInOutQuad', clamp: true },
  landingSensationBackground: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(-10svh)' } }, { v: 0, e: 0, p: { transform: 'translateY(0svh)' } }], clamp: true },
  landingThreeWorldsBackground: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(-40svh)' } }, { v: -200, e: 0, p: { transform: 'translateY(80svh)' } }], clamp: false },
  landingThreeWorldsTitle: { measure: 'closest:.sticky', keys: () => [{ v: 50, e: 0, p: { transform: 'translateY(-8svh)' }, easing: 'easeOutQuad' }, { v: 0, e: 0, p: { transform: 'translateY(0svh)' } }, { v: -100, e: 0, p: { transform: 'translateY(0svh)' }, easing: 'easeInOutQuad' }, { v: -200, e: 0, p: { transform: 'translateY(-61.4svh)' } }], clamp: true },
  landingThreeWorldsWebGl: { measure: 'closest:.sticky', keys: () => [{ v: 50, e: 0, p: { transform: 'translateY(-25svh)' } }, { v: 0, e: 0, p: { transform: 'translateY(0svh)' } }], clamp: true },
  // unused since the ring became a selector: it clipped the canvas for the reference's
  // wipe-shader stage, and left on it simply chopped the room images in half
  landingThreeWorldsWebGlClip: { measure: 'closest:.sticky', keys: () => [{ v: -100, e: 0, p: { 'clip-path': 'inset(0 0 0% 0)' } }, { v: -200, e: 0, p: { 'clip-path': 'inset(0 0 50% 0)' } }], clamp: true },
  landingTenetsBackground: { measure: 'closest:.sticky', keys: (el) => [{ v: 0, e: 0, p: { transform: 'translateY(0%)' } }, { v: 100, e: 100, p: { transform: `translateY(${-((el.offsetHeight - VH) / el.offsetHeight) * 100}%)` } }], clamp: true, mobile: true },
  landingExpansiveCard: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { transform: 'translate(-50%,-50%) translateY(-100svh)' } }, { v: -60, e: 0, p: { transform: 'translate(-50%,-50%) translateY(0svh)' } }], clamp: true },
  landingExpansiveCardScale: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { transform: 'scale(0.3333)' } }, { v: -60, e: 0, p: { transform: 'scale(1)' } }], easing: 'easeInOutQuad', clamp: true },
  landingExpansiveCardText: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { transform: 'scale(3)' } }, { v: -60, e: 0, p: { transform: 'scale(1)' } }], easing: 'easeInOutQuad', clamp: true },
  landingExpansiveCardContent: { measure: 'closest:.section', keys: () => [{ v: -30, e: 0, p: { opacity: '0' } }, { v: -60, e: 0, p: { opacity: '1' } }], clamp: true },
  landingExpansiveCardVideo: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { 'clip-path': 'inset(0 26.66%)', transform: 'scale(1.25)' } }, { v: -60, e: 0, p: { 'clip-path': 'inset(0 0%)', transform: 'scale(1)' } }], easing: 'easeInOutQuad', clamp: true },
  landingHandpickedTitle: { measure: 'closest:.sticky', keys: () => [{ v: -35, e: 0, p: { opacity: '0', transform: 'translateY(20svh)' }, easing: 'easeSection' }, { v: -75, e: 0, p: { opacity: '1', transform: 'translateY(0svh)' } }, { v: -130, e: 0, p: { opacity: '1', transform: 'translateY(0svh)' }, easing: 'easeSectionInverse' }, { v: -170, e: 0, p: { opacity: '0', transform: 'translateY(-20svh)' } }], clamp: true },
  /* the flight is computed from where the hotel and the walks sit (mapCam, above the
     map chapter), never typed: Óðinsvé's numbers flew this map past its hotel */
  landingLocationMapDesktop: { measure: 'closest:.sticky', keys: () => {
      const c = mapCam.desktop();
      return [
        { v: 100, e: 0, p: { transform: mapCam.css(c.introFrom) } },
        { v: 0, e: 0, p: { transform: mapCam.css(c.intro) } },
        { v: -100, e: 0, p: { transform: mapCam.css(c.overview) } },
        { v: -450, e: 0, p: { transform: mapCam.css(c.overview) }, easing: 'easeSection' },
        { v: -500, e: 0, p: { transform: mapCam.css(c.overview) } }];
    }, clamp: true },
  landingLocationMapTitleDesktop: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { opacity: '1' }, easing: 'easeOutQuad' }, { v: -100, e: 0, p: { opacity: '0' } }], clamp: true },
  landingLocationMapPinDesktop: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { opacity: '0' } }, { v: -80, e: 0, p: { opacity: '0' } }, { v: -100, e: 0, p: { opacity: '1' } }], clamp: true, onUpdate: (el, p) => el.classList.toggle('is-seen', p > .99) },
  landingLocationMapProgress: { measure: 'closest:.sticky', keys: () => [{ v: 0, e: 0, p: { transform: 'scaleX(0)', progress: '0' } }, { v: -100, e: 0, p: { transform: 'scaleX(0.25)', progress: '0.25' } }, { v: -200, e: 0, p: { transform: 'scaleX(0.5)', progress: '0.5' } }, { v: -300, e: 0, p: { transform: 'scaleX(0.75)', progress: '0.75' } }, { v: 100, e: 100, p: { transform: 'scaleX(1)', progress: '1' } }], clamp: true },
  landingJourneyBackgroundDesktop: { measure: 'closest:.section', keys: () => [{ v: 0, e: 0, p: { transform: 'translateY(0svh)' } }, { v: 100, e: 100, p: { transform: 'translateY(250svh)' } }], clamp: false },
  registerBgMove: { measure: 'closest:.section', target: 'img', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(0svh)' } }, { v: 0, e: 100, p: { transform: 'translateY(-40svh)' } }], clamp: true, mobile: true },
  registerBgScale: { measure: 'closest:.section', target: 'img', keys: () => [{ v: 100, e: 0, p: { transform: 'scale(1.1)' } }, { v: 0, e: 100, p: { transform: 'scale(1)' } }], clamp: true, mobile: true },
  registerScreen: { measure: 'closest:.section', keys: () => [{ v: 100, e: 0, p: { transform: 'translateY(35svh)' } }, { v: 100, e: 100, p: { transform: 'translateY(0svh)' } }], clamp: true },
  landingExpansiveCarousel: { skip: true },
};

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/g;
const mixStr = (a, b, t) => {
  if (a === b) return a;
  const an = a.match(NUM) || [], bn = b.match(NUM) || [];
  if (an.length !== bn.length) return t < .5 ? a : b;
  let i = 0;
  return b.replace(NUM, () => { const v = lerp(parseFloat(an[i]), parseFloat(bn[i]), t); i++; return (Math.round(v * 10000) / 10000).toString(); });
};

const parallax = (() => {
  const groups = [];
  /* Every element we have ever written an inline style onto. Rebuilding the groups
     (on resize) drops the desktop-only patterns, but the styles they already wrote
     stayed on the element - so crossing the breakpoint left the heritage card with
     translateY(-100svh) and its title at scale(3). Clear before rebuilding. */
  const managed = new Set();
  const resolveMeasure = (el, spec, attr) => {
    if (spec === 'self') return el;
    if (spec && spec.startsWith('closest:')) return el.closest(spec.slice(8)) || el;
    if (attr) return el.closest(attr) || el;
    return el;
  };
  const build = () => {
    managed.forEach(el => { el.style.transform = ''; el.style.opacity = ''; el.style.removeProperty('clip-path'); delete el.dataset.pyOpacity; });
    managed.clear();
    groups.length = 0;
    const mobile = !mdUp();
    $$('[data-parallax-pattern]').forEach(el => {
      el.dataset.parallaxPattern.split(/\s+/).filter(Boolean).forEach(name => {
        const pat = PATTERNS[name];
        if (!pat || pat.skip) return;
        if (mobile && !pat.mobile) return;
        if (el.closest('.l-expansive-slider') && mobile) return;
        const measure = resolveMeasure(el, pat.measure, el.dataset.parallaxMeasure);
        const target = pat.target ? (el.matches(pat.target) ? el : $(pat.target, el)) : el;
        if (!target) return;
        groups.push({ el, target, measure, pat, name, keys: pat.keys(target, el), clamp: pat.clamp !== false, easing: pat.easing, onUpdate: pat.onUpdate, scroll: [] });
      });
    });
    // inline JSON variant
    $$('[data-parallax-100-0],[data-parallax-0-100]').forEach(el => {
      if (mobile) return;
      const keys = [];
      for (const a of el.attributes) {
        const m = a.name.match(/^data-parallax-(-?\d+)-(-?\d+)$/);
        if (m) keys.push({ v: +m[1], e: +m[2], p: JSON.parse(a.value) });
      }
      if (!keys.length) return;
      const measure = el.closest(el.dataset.parallaxMeasure || '.section') || el;
      groups.push({ el, target: el, measure, keys, clamp: el.dataset.parallaxClamp === 'true', scroll: [] });
    });
    measure();
  };
  const measure = () => {
    for (const g of groups) {
      const top = docTop(g.measure), h = g.measure.offsetHeight;
      if (g.pat && g.pat.keys.length >= 1 && (g.name === 'landingTenetsBackground')) g.keys = g.pat.keys(g.target, g.el);
      g.scroll = g.keys.map(k => top + h * (k.e || 0) / 100 - VH * (k.v || 0) / 100 + (k.off || 0) * VH);
      // sort by scroll
      const order = g.scroll.map((s, i) => i).sort((a, b) => g.scroll[a] - g.scroll[b]);
      g.sorted = order.map(i => ({ s: g.scroll[i], k: g.keys[i] }));
    }
  };
  const apply = (y) => {
    const acc = new Map();
    for (const g of groups) {
      const ks = g.sorted; if (!ks || ks.length < 2) continue;
      const first = ks[0].s, last = ks[ks.length - 1].s;
      let props;
      if (y <= first) { if (!g.clamp && y < first - VH * 3) continue; props = ks[0].k.p; }
      else if (y >= last) { props = ks[ks.length - 1].k.p; }
      else {
        let i = 0; while (i < ks.length - 2 && y > ks[i + 1].s) i++;
        const a = ks[i], b = ks[i + 1];
        let t = (y - a.s) / (b.s - a.s || 1);
        const ez = a.k.easing || g.easing; if (ez && E[ez]) t = E[ez](t);
        props = {};
        for (const p in b.k.p) props[p] = mixStr(a.k.p[p] ?? b.k.p[p], b.k.p[p], t);
      }
      // out-of-range visibility for non-clamped groups: keep extrapolation simple (hold)
      let a = acc.get(g.target); if (!a) { a = { transform: [], opacity: 1, other: {} }; acc.set(g.target, a); }
      for (const p in props) {
        if (p === 'transform') a.transform.push(props[p]);
        else if (p === 'opacity') a.opacity *= parseFloat(props[p]);
        else if (p === 'progress') { a.progress = parseFloat(props[p]); }
        else a.other[p] = props[p];
      }
      if (g.onUpdate) { const prog = clamp((y - first) / (last - first || 1)); g.onUpdate(g.el, prog); }
    }
    acc.forEach((a, el) => {
      managed.add(el);
      const st = el.style;
      if (a.transform.length) st.transform = a.transform.join(' ');
      if (a.opacity !== 1 || el.dataset.pyOpacity) { st.opacity = a.opacity; el.dataset.pyOpacity = '1'; }
      for (const p in a.other) st.setProperty(p, a.other[p]);
      if (a.progress !== undefined) el.dataset.progress = a.progress;
    });
  };
  // scroll progress helper for custom modules: progress of measure element between two keys
  const progressOf = (measureEl, v1, e1, v2, e2, y) => {
    const top = docTop(measureEl), h = measureEl.offsetHeight;
    const s1 = top + h * e1 / 100 - VH * v1 / 100, s2 = top + h * e2 / 100 - VH * v2 / 100;
    return clamp((y - s1) / (s2 - s1 || 1));
  };
  return { build, measure, apply, progressOf, groups };
})();

/* ============================================================
   SPLITTING
   ============================================================ */
const splitTitle = (el) => {
  if (el.dataset.split) return;
  el.dataset.split = 'title';
  const centred = el.matches('.text-center') || getComputedStyle(el).textAlign === 'center';
  const tokens = [];
  const walk = n => { n.childNodes.forEach(c => { if (c.nodeType === 3) { c.textContent.split(/(\s+)/).forEach(t => { if (/^\s+$/.test(t)) tokens.push({ sp: true }); else if (t) tokens.push({ w: t, lower: /[a-zà-ÿ]/.test(t) && t === t.toLowerCase(), em: !!c.parentElement.closest('em') }); }); } else if (c.tagName === 'BR') tokens.push({ br: true }); else walk(c); }); };
  walk(el);
  el.textContent = '';
  const words = [];
  tokens.forEach(t => {
    if (t.sp) { el.appendChild(document.createTextNode(' ')); return; }
    if (t.br) { const b = document.createElement('br'); b.dataset.forced = '1'; el.appendChild(b); words.push(b); return; }
    const w = document.createElement('span'); w.className = 'word' + (t.lower ? ' is-lower' : '') + (t.em ? ' is-em' : '');
    [...t.w].forEach(ch => { const c = document.createElement('span'); c.className = 'char'; c.textContent = ch; w.appendChild(c); });
    el.appendChild(w); words.push(w);
  });
  // line detection
  const lines = []; let cur = null, lastTop = null;
  words.forEach(w => {
    if (w.tagName === 'BR') { cur = null; lastTop = null; return; }
    const top = w.offsetTop;
    if (!cur || (lastTop !== null && Math.abs(top - lastTop) > 2)) { cur = []; lines.push(cur); }
    cur.push(w); lastTop = top;
  });
  el.textContent = '';
  const maxChars = Math.max(...lines.map(l => l.reduce((n, w) => n + w.children.length, 0) + l.length - 1));
  lines.forEach((l, li) => {
    const wrap = document.createElement('span'); wrap.className = 'line-wrap'; wrap.style.setProperty('--line-index', li);
    const chars = l.reduce((n, w) => n + w.children.length, 0) + l.length - 1;
    wrap.style.setProperty('--line-char-offset', centred ? (maxChars - chars) / 2 : 0);
    const line = document.createElement('span'); line.className = 'line';
    let ci = 0;
    l.forEach((w, wi) => {
      [...w.children].forEach(c => c.style.setProperty('--char-index', ci++));
      line.appendChild(w);
      if (wi < l.length - 1) { const s = document.createElement('span'); s.className = 'whitespace'; line.appendChild(s); ci++; }
    });
    wrap.appendChild(line); el.appendChild(wrap);
  });
  el.dataset.charTotal = maxChars;
};
const splitLines = (el) => {
  if (el.dataset.split) return;
  el.dataset.split = 'lines';
  const tokens = [];
  const walk = n => { n.childNodes.forEach(c => { if (c.nodeType === 3) c.textContent.split(/(\s+)/).forEach(t => { if (/^\s+$/.test(t)) tokens.push({ sp: true }); else if (t) tokens.push({ w: t }); }); else if (c.tagName === 'BR') tokens.push({ br: true }); else if (c.tagName === 'SPAN') tokens.push({ br: true }, { sub: c.cloneNode(true) }); else walk(c); }); };
  walk(el);
  el.textContent = '';
  const words = [];
  tokens.forEach(t => {
    if (t.sp) { el.appendChild(document.createTextNode(' ')); return; }
    if (t.br) { const b = document.createElement('br'); el.appendChild(b); words.push(b); return; }
    if (t.sub) { const w = document.createElement('span'); w.className = 'word'; w.style.display = 'block'; w.appendChild(t.sub); el.appendChild(w); words.push(w); return; }
    const w = document.createElement('span'); w.className = 'word'; w.textContent = t.w; el.appendChild(w); words.push(w);
  });
  const lines = []; let cur = null, lastTop = null;
  words.forEach(w => { if (w.tagName === 'BR') { cur = null; lastTop = null; return; } const top = w.offsetTop; if (!cur || (lastTop !== null && Math.abs(top - lastTop) > 2)) { cur = []; lines.push(cur); } cur.push(w); lastTop = top; });
  el.textContent = '';
  lines.forEach((l, li) => { const line = document.createElement('span'); line.className = 'line'; line.style.setProperty('--line-index', li); l.forEach((w, wi) => { line.appendChild(w); if (wi < l.length - 1) line.appendChild(document.createTextNode(' ')); }); el.appendChild(line); });
  el.dataset.lineTotal = lines.length;
};

/* ============================================================
   TRANSITION ENGINE
   ============================================================ */
const DUR = { rise: 800, title: 1400, subtitle: 1400, text: 1000, 'fade-in': 400, 'fade-out': 400, 'zoom-in': 400, 'slide-in-bottom': 400, 'slide-in-top': 400, 'slide-in': 1000, fast: 200, slow: 1000, block: 1600 };
/* Split into two halves so a reveal can be ARMED (split + inactive state applied)
   while the element is still hidden, and only RUN later. Doing both at once meant
   the finished text was on screen for the whole reveal delay before it animated. */
const prepareTransition = (el, names) => {
  const list = names.split(/\s+/).filter(Boolean);
  if (list.includes('title')) splitTitle(el);
  if (list.includes('text')) splitLines(el);
  const cls = [];
  list.forEach(n => cls.push('animation', `animation--${n}`, `animation--${n}--inactive`));
  el.classList.add(...cls, 'disable-transitions');
  void el.offsetWidth;                       // flush, so the inactive state is what paints
  return { list, cls };
};
const runTransition = (el, prepared, cb) => {
  const { list, cls } = prepared;
  let dur = Math.max(...list.map(n => DUR[n] || 400));
  if (list.includes('block')) dur = 1600; else if (list.includes('slow')) dur = 1000; else if (list.includes('fast')) dur = 200;
  if (list.includes('title')) dur = 1400 + (+el.dataset.charTotal || 0) * 39;
  if (list.includes('text')) dur = 1000 + (+el.dataset.lineTotal || 0) * 40;
  el.classList.remove('disable-transitions');
  requestAnimationFrame(() => {
    list.forEach(n => { el.classList.remove(`animation--${n}--inactive`); el.classList.add(`animation--${n}--active`); });
    setTimeout(() => {
      el.classList.remove(...cls, ...list.map(n => `animation--${n}--active`));
      cb && cb();
    }, dur + 90);
  });
};
const transition = (el, names, cb) => runTransition(el, prepareTransition(el, names), cb);

/* ============================================================
   REVEAL
   ============================================================ */
const reveal = (() => {
  let started = false;
  const done = (el, name) => { el.removeAttribute('data-reveal'); el.setAttribute('data-reveal-old', name); };
  const show = (el, extraDelay = 0) => {
    if (el.hasAttribute('data-reveal-visible')) return;
    const name = el.dataset.reveal;
    const delay = (+el.dataset.revealDelay || 0) + extraDelay;
    const overshoot = el.getBoundingClientRect().bottom < 0;
    if (overshoot || reduced) { el.setAttribute('data-reveal-visible', ''); done(el, name); return; }
    // arm while still hidden, THEN drop the hidden state: the inactive state is
    // what paints, never the finished text
    // touch: one cheap rise instead of splitting every character
    const effective = mdUp() ? name : name.split(/\s+/).map(n => (n === 'title' || n === 'subtitle' || n === 'text') ? 'rise' : n).join(' ');
    const prepared = prepareTransition(el, effective);
    el.setAttribute('data-reveal-visible', '');
    setTimeout(() => runTransition(el, prepared, () => done(el, name)), mdUp() ? delay : Math.min(delay, 260));
  };
  /* Trigger on VISUAL position, not on IntersectionObserver boxes.
     Most titles here live inside pinned/parallaxed layers, and IO reports the
     element's TRANSFORMED box: a line can be sitting in the middle of the screen
     while its IO box is still a viewport away, so the reveal fired long after the
     text was already on screen (that is the "fades in too late" and the blank-then-
     pop glitch). A rect check each frame is accurate under transforms, and 50-odd
     reads at 10Hz is cheap. Reads run before the parallax writes, so no thrash. */
  let pending = [];
  const ENTER = .88;                     // fire once the top edge is inside 88% of the viewport
  const start = () => {
    if (started) return; started = true;
    if (reduced) { $$('[data-reveal]').forEach(el => { el.setAttribute('data-reveal-visible', ''); el.setAttribute('data-reveal-old', el.dataset.reveal); el.removeAttribute('data-reveal'); }); return; }
    pending = $$('[data-reveal]').map(el => {
      const group = el.closest('[data-reveal-group]');
      return { el, group, trigger: group || el, delay: group ? (+group.dataset.revealDelay || 30) : 0 };
    });
    check();
  };
  const check = () => {
    if (!pending.length) return;
    const still = [];
    for (const p of pending) {
      if (p.el.hasAttribute('data-reveal-visible')) continue;
      const r = p.trigger.getBoundingClientRect();
      if (!r.height && !r.width) { still.push(p); continue; }
      if (r.top < VH * ENTER && r.bottom > 0) show(p.el, p.delay);
      else if (r.bottom <= 0) show(p.el, 0);          // scrolled past before it ever fired
      else still.push(p);
    }
    pending = still;
  };
  let lastCheck = 0;
  const tick = now => {
    if (!started || now - lastCheck < 100) return; lastCheck = now;
    check();
  };
  return { start, tick };
})();

/* ============================================================
   LAZY MEDIA (appear)
   ============================================================ */
const media = (() => {
  const imgs = $$('img[data-img]');
  imgs.forEach(img => {
    const name = img.dataset.img, ws = img.dataset.w.split(/\s+/).map(Number);
    img.dataset.srcset = ws.map(w => `assets/img/${name}@${w}.webp ${w}w`).join(', ');
    img.dataset.src = `assets/img/${name}@${ws[Math.min(1, ws.length - 1)]}.webp`;
    img.loading = 'lazy'; img.decoding = 'async';
  });
  const load = img => {
    if (img.dataset.loaded) return; img.dataset.loaded = '1';
    img.srcset = img.dataset.srcset; img.src = img.dataset.src;
    const done = () => img.classList.add('is-loaded');
    if (img.decode) img.decode().then(done, done); else img.onload = done;
  };
  const pre = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { pre.unobserve(en.target); load(en.target); } }), { rootMargin: '600px 0px' });
  imgs.forEach(i => pre.observe(i));
  $$('.intro__img, .header__logo-mark, .modal__img').forEach(i => { if (i.complete) i.classList.add('is-loaded'); else i.addEventListener('load', () => i.classList.add('is-loaded')); });
  if ('requestIdleCallback' in window) requestIdleCallback(() => imgs.forEach(i => { if (!i.closest('.l-expansive-slider') || mdUp()) load(i); }), { timeout: 8000 });
  return { load };
})();

/* ============================================================
   PRELOADER
   ============================================================ */
const preloader = (() => {
  const el = $('#preloader'), counter = $('#preloader-counter'), fill = $('#preloader-fill');
  const skip = !mdUp() || location.hash === '#skip-preloader' || sessionStorage.getItem('lakehotel-preloaded');
  const MIN = 1200; const t0 = performance.now();
  let assets = 0, total = 2, shown = 0, done = false;
  const hero = $('.intro__img');
  const bump = () => { assets++; };
  if (!hero) bump(); else if (hero.complete) bump(); else { hero.addEventListener('load', bump); hero.addEventListener('error', bump); }
  document.fonts.ready.then(bump);
  const finish = (cb) => {
    if (done) return; done = true;
    setTimeout(() => {
      el.classList.add('is-done');
      setTimeout(() => { el.classList.add('is-removed'); }, 1700);
      cb();
    }, skip ? 0 : 1000);
  };
  const tick = (cb) => {
    const p = Math.min(1, ((performance.now() - t0) / MIN + assets / total) / 2);
    shown = lerp(shown, p, .15);
    if (fill) fill.style.transform = `scaleX(${shown.toFixed(4)})`;
    if (counter) counter.textContent = Math.round(shown * 100);
    if (p >= 1 && shown > .995) finish(cb);
  };
  return { skip, tick, finish, el };
})();

/* ============================================================
   THEMED HEADER + TOP + HIDE
   ============================================================ */
const header = (() => {
  const h = $('#header');
  const sections = $$('[data-themed]');
  let ranges = [];
  const measure = () => { ranges = sections.map(s => ({ top: docTop(s), bottom: docTop(s) + s.offsetHeight, cls: s.dataset.themed })); };
  let lastCls = '';
  const tick = y => {
    const line = y + 30;
    let cur = ranges[0];
    for (const r of ranges) if (line >= r.top && line < r.bottom) { cur = r; }
    // later sections overlap earlier ones (negative margins): pick the last match
    for (let i = ranges.length - 1; i >= 0; i--) { if (line >= ranges[i].top && line < ranges[i].bottom) { cur = ranges[i]; break; } }
    if (cur && cur.cls !== lastCls) {
      h.classList.remove('ui-dark', 'ui-light', 'ui-gradient', 'ui-intro');
      h.classList.add(...cur.cls.split(/\s+/)); lastCls = cur.cls;
    }
    h.classList.toggle('header--top', y <= 10);
  };
  const hideIO = new IntersectionObserver(es => es.forEach(en => h.classList.toggle('header--hidden', en.isIntersecting)), { rootMargin: '0px 0px -86% 0px', threshold: 0 });
  const ht = $('.js-hide-header'); if (ht) hideIO.observe(ht);
  return { measure, tick, el: h };
})();

/* ============================================================
   OVERLAYS — one owner for the scroll lock and the layer
   ============================================================ */
/* The menu and the booking panel are both full-screen and both sat at z-index 9.
   Opening the menu from behind an open booking panel put it underneath, so the
   hamburger looked dead, and closing either one dropped the shared `with-modal`
   flag while the other was still open, which let the page scroll away behind it.
   One registry now: opening an overlay closes any other, and the scroll lock is
   derived from what is actually open rather than toggled by whoever ran last. */
const overlays = (() => {
  const closers = new Map();
  const live = new Set();
  const sync = () => {
    const on = live.size > 0;
    html.classList.toggle('with-modal', on);
    // stop Lenis while an overlay is open, or the page scrolls behind it. Every
    // scroller inside an overlay carries data-lenis-prevent, so stopping Lenis
    // cannot freeze them (lenis.stop() preventDefaults wheel/touch document-wide).
    scroller.setStopped(on);
  };
  return {
    register: (name, closeFn) => closers.set(name, closeFn),
    opened(name) {
      closers.forEach((fn, other) => { if (other !== name && live.has(other)) fn(); });
      live.add(name); sync();
    },
    closed(name) { live.delete(name); sync(); },
    closeAll() { closers.forEach((fn, name) => { if (live.has(name)) fn(); }); },
    has: (name) => live.has(name),
    get any() { return live.size > 0; },
  };
})();

/* ============================================================
   MENU
   ============================================================ */
const menu = (() => {
  const modal = $('#menu'), list = $('.js-menu-list'), scrollerEl = $('.js-menu-scroller'), toggle = $('.js-menu-toggle');
  /* Escape and the toggle both worked, but on a phone the toggle is a thin X in the
     corner with no label, so people got stuck. The backdrop and the scroller's own
     empty space now close it as well. */
  let open = false, mouseY = .5, ty = 0, cy = 0;
  const show = () => {
    if (open) return;
    overlays.opened('menu');
    open = true; modal.classList.remove('is-hidden'); modal.setAttribute('aria-hidden', 'false'); void modal.offsetWidth;
    modal.classList.add('is-open'); html.classList.add('with-modal-menu'); toggle.setAttribute('aria-expanded', 'true');
    const active = $$('.js-menu-link').find(a => { const id = a.getAttribute('href'); const el = $(id); return el && docTop(el) <= scroller.y + VH * .5 && docTop(el) + el.offsetHeight > scroller.y + VH * .5; });
    $$('.js-menu-link').forEach(a => a.classList.toggle('is-active', a === active));
  };
  const hide = () => {
    if (!open) return;
    open = false; modal.classList.remove('is-open'); modal.classList.add('is-closing'); html.classList.remove('with-modal-menu'); toggle.setAttribute('aria-expanded', 'false');
    overlays.closed('menu');
    setTimeout(() => { modal.classList.remove('is-closing'); modal.classList.add('is-hidden'); modal.setAttribute('aria-hidden', 'true'); }, 420);
  };
  overlays.register('menu', hide);
  /* The burger is the one exit that is always on screen, above every overlay. If
     something else is open it dismisses that first rather than opening the menu
     underneath it. */
  toggle.addEventListener('click', () => {
    if (!open && overlays.any) { overlays.closeAll(); return; }
    open ? hide() : show();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && open) hide(); });
  // the backdrop and any empty space in the list column close it too
  modal.addEventListener('click', e => {
    if (!open) return;
    if (e.target === modal || e.target === scrollerEl || e.target.classList.contains('modal__bg')
        || e.target.classList.contains('modal__img') || e.target === list) hide();
  });
  $$('.js-menu-link').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); const t = $(a.getAttribute('href')); hide(); if (t) setTimeout(() => scroller.scrollToEl(t, t.id === 'tenets' ? -VH * .62 : 0), 200); });
    a.addEventListener('mouseenter', () => list.classList.add('is-hovering'));
    a.addEventListener('mouseleave', () => list.classList.remove('is-hovering'));
  });
  modal.addEventListener('mousemove', e => { mouseY = e.clientY / innerHeight; });
  const tick = () => {
    if (!open || !mdUp()) return;
    const over = list.offsetHeight - scrollerEl.offsetHeight + 120;
    ty = over > 0 ? -over * mouseY : 0;
    cy = lerp(cy, ty, .1);
    list.style.transform = `translateY(${cy.toFixed(2)}px)`;
  };
  return { tick, hide, isOpen: () => open };
})();

/* ============================================================
   STICKY SLIDER (horizontal chapter)
   ============================================================ */
const slider = (() => {
  const root = $('.js-sticky-slider'); if (!root) return { tick() {}, measure() {} };
  const sticky = $('.sticky-slider__sticky', root), track = $('[data-sticky-slider-content]', root);
  const moves = $$('.js-hmove', track), column = $('.l-expansive-slider__column', track), card = $('.js-expansive-card', track);
  let max = 0, top = 0, height = 0, itemsMeta = [];
  const measure = () => {
    if (!mdUp()) { root.style.minHeight = ''; track.style.transform = ''; return; }
    max = track.scrollWidth - VW;
    /* PACE: 1:1 vertical-to-horizontal made this one chapter 20 viewports long, about
       40% of the whole page. 0.58 keeps the full track but moves it 1.7x faster per
       turn of the wheel. */
    root.style.minHeight = (max * .58 + VH) + 'px';
    height = root.offsetHeight; top = docTop(root);
    itemsMeta = moves.map(f => ({ f, img: $('img', f), left: docLeft(f) - docLeft(track), w: f.offsetWidth }));
    if (column) { column._meta = { left: docLeft(column) - docLeft(track), w: column.offsetWidth, h: column.offsetHeight }; }
  };
  let lastP = -1;
  const tick = y => {
    if (!mdUp()) return;
    const p = clamp((y - top) / (height - VH || 1));
    if (p === lastP) return; lastP = p;
    const tx = -p * max;
    track.style.transform = `translate3d(${tx.toFixed(2)}px,0,0)`;
    for (const m of itemsMeta) {
      const x = m.left + tx;                       // screen x of figure
      const t = clamp((VW - x) / (VW + m.w));     // 0 entering from right → 1 left edge gone
      m.img.style.transform = `translateX(${(-16.667 * (1 - t)).toFixed(3)}%)`;
    }
    if (column && column._meta) {
      const x = column._meta.left + tx; const t = clamp((VW - x) / (VW + column._meta.w));
      column.style.transform = `translateY(${((VH - column._meta.h - VH * .1) * t).toFixed(2)}px)`;
    }
  };
  return { tick, measure };
})();

/* ============================================================
   WEBGL — rooms ring + art ring
   ============================================================ */
/* Try the asked-for width, then fall back: not every photo was resized to every
   step, and a miss here silently renders a BLANK WHITE PLANE rather than erroring. */
const loadTex = (name, w = 1440) => {
  /* The fallback ladder must match the widths _images.mjs actually emits, or the ring
     requests files that were never generated and 404s on the way down. */
  const widths = [w, 1920, 1440, 1080, 720].filter((v, i, a) => a.indexOf(v) === i);
  const attempt = i => new Promise(res => {
    if (i >= widths.length) { console.warn('[lakehotel] no texture for', name); return res(null); }
    texLoader.load(`assets/img/${name}@${widths[i]}.webp`,
      t => { t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; res(t); },
      undefined, () => res(attempt(i + 1)));
  });
  return attempt(0);
};
const makeRenderer = canvas => { const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' }); r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setClearColor(0x000000, 0); return r; };
/* A quiet loader for chapters that fetch their own assets. */
const chapterLoader = (host, label) => {
  if (!host) return { show() {}, hide() {} };
  const el = document.createElement('div');
  el.className = 'chapter-loader';
  el.innerHTML = `<span class="chapter-loader__bar"></span><span class="chapter-loader__label">${label}</span>`;
  host.appendChild(el);
  return { show: () => el.classList.add('is-on'), hide: () => el.classList.remove('is-on') };
};

const R = 15;
/* Ring geometry, shared by both chapters. The ring is centred on the origin with
   radius R; the camera sits out at +Z, so the NEAR point of the ring (phi 0 →
   (0,0,R)) is what faces the lens. CAM_Z must leave real clearance: at 26 the
   front card is 11 units out, which is what makes a ~4-unit card read AS a card
   instead of swallowing the frame. Never set camera.rotation by hand in here —
   a manual roll with no lookAt tilts the entire ring (that was the bug). */
const CAM_Z = 26;
/* The ring radius has to be chosen against the plane width: neighbours sit
   2*r*sin(step/2) apart, so if that chord equals the plane width the cards tile
   edge-to-edge into a closed drum (which is exactly what the 13-plane art ring
   did at r=15). Keep the chord comfortably wider than the plane. */
const ringPos = (m, phi, r = R) => { m.position.set(r * Math.sin(phi), 0, r * Math.cos(phi)); m.rotation.y = phi; };
/* Fit every texture into a common box, preserving aspect, so a 2.5:1 banner crop
   and a square canvas carry the same visual weight on the ring. */
const fitPlane = (tex, maxW, maxH) => {
  const asp = tex && tex.image ? tex.image.width / tex.image.height : 1.5;
  let w = maxW, h = w / asp;
  if (h > maxH) { h = maxH; w = h * asp; }
  return new THREE.PlaneGeometry(w, h);
};

/* ---- ROOMS: a browsable selector, not only a scrubbed animation.
   Scroll advances it, drag moves it by hand, hover raycasts to drive the "View"
   cursor, click opens that room's page. Four items, so it is a clamped fan
   rather than an endless ring. ---- */
const rooms = (() => {
  const canvas = $('#worlds-canvas'), stage = $('#worlds-stage'); if (!canvas) return { tick() {}, resize() {} };
  const names = $$('.l-three-worlds__name'), ringBar = $('.progress-ring__bar', $('#worlds-ring')), counter = $('#worlds-counter');
  const cursor = $('#room-cursor');
  /* data-w is a LADDER ("720 1080 1440 …"), so +dataset.w is NaN and the old
     `|| 1200` fallback asked for a width that is not generated. Take the largest
     candidate the ring can sensibly use instead. */
  const pickW = v => { const ws = String(v || '').trim().split(/\s+/).map(Number).filter(n => n > 0);
    return ws.length ? Math.max(...ws.filter(w => w <= 1920).concat(Math.min(...ws))) : 1440; };
  const ROOMS = names.map(n => ({ label: n.textContent.trim(), href: n.dataset.href, img: n.dataset.img, w: pickW(n.dataset.w), price: n.dataset.price }));
  const splitChars = (el, text) => {
    el.textContent = '';
    [...text].forEach((ch, i) => {
      const c = document.createElement('span'); c.className = 'char';
      c.style.setProperty('--char-index', i);
      c.textContent = ch === ' ' ? '\u00A0' : ch;   // a plain space in an inline-block collapses
      el.appendChild(c);
    });
  };
  const priceBox = $('#worlds-price');
  const priceLines = priceBox ? ROOMS.map((r, k) => {
    const el = k === 0 ? $('.l-three-worlds__price-line', priceBox) : document.createElement('span');
    el.className = 'l-three-worlds__price-line' + (k === 0 ? ' is-active' : '');
    splitChars(el, r.price || '');
    if (k) priceBox.appendChild(el);
    return el;
  }) : [];
  names.forEach(n => { const t = n.textContent; n.textContent = ''; [...t].forEach((ch, i) => { const c = document.createElement('span'); c.className = 'char'; c.style.setProperty('--char-index', i); c.textContent = ch === ' ' ? '\u00A0' : ch; n.appendChild(c); }); });
  const SPREAD = 34 * Math.PI / 180;
  let renderer, scene, camera, ready = false, planes = [], inited = false, W = 0, H = 0, lastIndex = -1, dirty = true;
  let sel = 0, selShown = 0, dragSel = 0, dragging = false, lastX = 0, dragV = 0, hovered = -1, pointer = null, moved = 0;
  let raycaster, ndc;
  const loader = chapterLoader($('.l-three-worlds-webgl'), 'Loading the rooms');
  // the gesture differs by input, so the instruction has to as well
  if (isTouch) { const hint = $('.l-three-worlds__hint'); if (hint) hint.innerHTML = 'Swipe to browse<span>Tap a room to open it</span>'; }
  const init = async () => {
    if (inited) return; inited = true;
    loader.show();
    await ensureThree();
    raycaster = new THREE.Raycaster(); ndc = new THREE.Vector2();
    renderer = makeRenderer(canvas); scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, .1, 100); camera.position.set(0, 0, CAM_Z); camera.lookAt(0, 0, 0); camera.setFocalLength(22.56);
    const texs = await Promise.all(ROOMS.map(r => loadTex(r.img, r.w)));
    texs.forEach((t, i) => {
      const m = new THREE.Mesh(fitPlane(t, 6.2, 4.1), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
      m.userData.i = i; planes.push(m); scene.add(m);
    });
    resize(); ready = true; dirty = true; loader.hide(); bind();
  };
  const bind = () => {
    canvas.addEventListener('pointerdown', e => { dragging = true; moved = 0; lastX = e.clientX; dragV = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add('is-grabbing'); });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      pointer = { x: e.clientX, y: e.clientY };
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (dragging) { const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx); dragV = dx; dragSel -= dx / (r.width * .28); }
      dirty = true;
    });
    canvas.addEventListener('pointerup', () => {
      canvas.classList.remove('is-grabbing');
      if (dragging && moved < 6 && hovered >= 0) go(hovered);      // a tap, not a drag
      dragging = false;
    });
    canvas.addEventListener('pointercancel', () => { dragging = false; canvas.classList.remove('is-grabbing'); });
    canvas.addEventListener('pointerleave', () => { pointer = null; hovered = -1; canvas.classList.remove('is-hit'); if (cursor) cursor.classList.remove('is-visible'); dirty = true; });
    // keyboard equivalent for the drag/click gesture
    $$('.l-three-worlds__link').forEach((a, i) => {
      a.addEventListener('focus', () => { dragSel += i - sel; dirty = true; });
    });
  };
  const go = i => { const r = ROOMS[i]; if (r && r.href) (window.__lakeNav || (h => { location.href = h; }))(r.href); };
  const resize = () => { if (!renderer) return; W = canvas.clientWidth || VW; H = canvas.clientHeight || VH; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); dirty = true; };
  const setIndex = i => {
    if (i === lastIndex) return;
    const up = i > lastIndex;
    names.forEach((n, k) => { n.classList.toggle('is-active', k === i); n.classList.toggle('is-leaving-up', up && k < i); });
    priceLines.forEach((el, k) => { el.classList.toggle('is-active', k === i); el.classList.toggle('is-leaving-up', up && k < i); });
    counter.textContent = i + 1;
    ringBar.style.strokeDashoffset = 373.25 * (1 - (i + 1) / ROOMS.length);
    const link = $('#worlds-link'); if (link && ROOMS[i]) { link.href = ROOMS[i].href; }
    lastIndex = i;
  };
  const tick = y => {
    if (!mdUp()) return;                       // touch uses .l-rooms-mobile instead
    const top = docTop(stage), h = stage.offsetHeight;
    const near = y > top - VH * 2 && y < top + h + VH;
    if (near && !inited) init();
    if (!ready || !near) return;
    /* Scroll is AUTHORITATIVE: it must walk all four rooms and then let the page go.
       The old snap-to-nearest term (dragSel += (round(sel) - sel) * .08) ran every
       frame and accumulated an offset that fought this mapping, so the set often
       ended on 3/4 and the chapter released early. Drag is now a temporary offset
       that decays back to the scroll position instead. */
    /* The reference reached p=1 only 1.35 viewports before the stage ended, and the
       tenets wipe (sticky--under-previous, -100svh) began covering the canvas at the
       same moment the fourth room became active, so room 4 was never seen clean.
       Measured on this build: room 4 arrived at y=8182 with the backdrop already
       136px over the canvas. Finishing the set 2.9 viewports early leaves a genuine
       held viewport on the last room before anything moves over it. */
    const p = clamp((y - top) / (h - VH * 2.4));
    const scrollSel = p * (ROOMS.length - 1);
    if (!dragging) {
      if (Math.abs(dragV) > .05) { dragV *= .88; dragSel -= dragV / (W * .28) * .4; }
      dragSel *= .94;                                    // rejoin the scroll within ~half a second
      if (Math.abs(dragSel) < .002) dragSel = 0;
    }
    sel = clamp(scrollSel + dragSel, 0, ROOMS.length - 1);
    const prev = selShown; selShown = lerp(selShown, sel, .18);
    if (Math.abs(selShown - prev) > 1e-4) dirty = true;
    // entry dolly: the reference's tele flattening, stopped short of 300mm so the
    // fan stays browsable instead of collapsing into a flat stack
    const de = E.easeInOutQuad(clamp((y - (top - VH * .5)) / VH));
    camera.position.set(0, -.35 * de, CAM_Z + 6 * de); camera.lookAt(0, -.35 * de, 0);
    camera.setFocalLength(lerp(22.56, 42, de));
    planes.forEach((m, i) => {
      ringPos(m, (i - selShown) * SPREAD);
      const d = Math.abs(i - selShown);
      m.material.opacity = clamp(1 - d * .42, .18, 1);
      m.scale.setScalar(hovered === i ? 1.03 : 1);
      m.visible = d < 3.2;
      m.renderOrder = 10 - Math.round(d * 10);
    });
    if (pointer && !dragging) {
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(planes.filter(m => m.visible), false)[0];
      const h2 = hit ? hit.object.userData.i : -1;
      if (h2 !== hovered) { hovered = h2; dirty = true; }
      if (cursor) {
        cursor.classList.toggle('is-visible', hovered >= 0);
        cursor.style.transform = `translate(${pointer.x}px,${pointer.y}px)`;
        if (hovered >= 0) { const l = $('.room-cursor__room', cursor); if (l) l.textContent = ROOMS[hovered].label; }
      }
      canvas.classList.toggle('is-hit', hovered >= 0);
    }
    setIndex(Math.round(selShown));
    if (!dirty) return; dirty = dragging || Math.abs(sel - selShown) > 1e-3;
    renderer.render(scene, camera);
  };
  return { tick, resize: () => { resize(); dirty = true; } };
})();

/* ---- THE HANG: the art chapter, plain DOM.
   Scroll pans the wall; pointer drag walks it by hand. One transform on one
   element, no 3D, no extra dependency — and the paintings stay rectangular. ---- */
const hang = (() => {
  const stage = $('#hang-stage'), track = $('.js-hang-track'); if (!stage || !track) return { tick() {}, measure() {} };
  const fill = $('.js-hang-fill'), idxEl = $('.js-hang-index'), totalEl = $('.js-hang-total');
  const items = $$('.l-hang__item', track);
  let maxScroll = 0, top = 0, height = 0, drag = 0, dragging = false, lastX = 0, dragV = 0, shown = 0, lastIdx = -1;
  if (totalEl) totalEl.textContent = String(items.length).padStart(2, '0');
  const measure = () => {
    maxScroll = Math.max(0, track.scrollWidth - VW);
    top = docTop(stage); height = stage.offsetHeight;
  };
  track.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; dragV = 0; track.setPointerCapture(e.pointerId); track.classList.add('is-grabbing'); });
  track.addEventListener('pointermove', e => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; dragV = dx; drag -= dx; });
  const up = () => { dragging = false; track.classList.remove('is-grabbing'); };
  track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
  const tick = y => {
    if (!mdUp()) return;                       // native scroll-snap on touch
    if (!maxScroll) measure();
    const near = y > top - VH * 2 && y < top + height + VH;
    if (!near) return;
    if (!dragging && Math.abs(dragV) > .1) { drag -= dragV * .35; dragV *= .9; }
    const p = clamp((y - top) / (height - VH || 1));
    const target = clamp(p * maxScroll + drag, 0, maxScroll);
    drag = target - p * maxScroll;                       // keep the hand-offset inside the rails
    shown = lerp(shown, target, .12);
    track.style.transform = `translate3d(${(-shown).toFixed(2)}px,0,0)`;
    const prog = maxScroll ? shown / maxScroll : 0;
    if (fill) fill.style.transform = `scaleX(${prog.toFixed(4)})`;
    const i = Math.min(items.length - 1, Math.round(prog * (items.length - 1)));
    if (i !== lastIdx && idxEl) { idxEl.textContent = String(i + 1).padStart(2, '0'); lastIdx = i; }
  };
  return { tick, measure };
})();

/* ---- SCROLL CUE ---- */
const scrollCue = (() => {
  const el = $('#scroll-cue'); if (!el) return { tick() {} };
  const holds = $$('[data-hold]');
  let lastY = -1, idleSince = 0, on = false;
  const tick = (y, now) => {
    if (Math.abs(y - lastY) > 1.5) { lastY = y; idleSince = now; if (on) { el.classList.remove('is-on'); on = false; } return; }
    if (on) return;
    if (now - idleSince < 1100) return;                       // only once the reader has gone still
    const hold = holds.find(s => { const t = docTop(s); return y > t - VH * .2 && y < t + s.offsetHeight - VH * 1.1; });
    if (!hold) return;
    el.classList.toggle('is-light', !!$('#header').classList.contains('ui-light'));
    el.classList.add('is-on'); on = true;
  };
  return { tick };
})();

/* ============================================================
   MAP CAMERA
   ============================================================
   The map is translate(-50%,-50%) translate(tx%,ty%) scale(s) inside its pin, tx/ty in
   percent of the map's own box. fit() frames a set of map points (fractions of the sheet)
   inside a region of the screen and clamps so the sheet always covers it. Everything comes
   from the hotel's and the pins' own positions, so a new sheet or a new walk reframes itself
   (Sindri 10-10: the Óðinsvé numbers never showed this hotel). */
const mapCam = (() => {
  const mapEl = () => $('.js-location-map'), pinBox = () => $('.l-location__map-pin');
  const pt = el => el ? { x: parseFloat(el.style.left) / 100, y: parseFloat(el.style.top) / 100 } : null;
  const home = () => pt($('.l-location__home'));
  const pins = () => $$('.l-location__pin').map(pt);
  const dims = () => {
    const m = mapEl(), b = pinBox();
    return { vw: b ? b.clientWidth : innerWidth, vh: b ? b.clientHeight : innerHeight, W: m ? m.offsetWidth : innerWidth, H: m ? m.offsetHeight : innerHeight };
  };
  // where the map may put things: left of the location card on desktop; between the
  // title and the swipe cards on a phone
  // phone points stay ~80 px in from the sides, or the centred labels run off the screen
  const REGION_D = { x0: .06, x1: .6, y0: .18, y1: .86 }, REGION_M = { x0: .22, x1: .78, y0: .3, y1: .68 };
  const fit = (P, R, sMax, d, m = 1.25) => {
    const xs = P.map(p => p.x), ys = P.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sMin = Math.max(d.vw / d.W, d.vh / d.H);
    let s = Math.min(sMax, (R.x1 - R.x0) * d.vw / (Math.max(x1 - x0, .02) * d.W * m), (R.y1 - R.y0) * d.vh / (Math.max(y1 - y0, .02) * d.H * m));
    s = Math.max(s, sMin);
    let tx = ((R.x0 + R.x1) / 2 - .5) * d.vw / d.W - s * ((x0 + x1) / 2 - .5);
    let ty = ((R.y0 + R.y1) / 2 - .5) * d.vh / d.H - s * ((y0 + y1) / 2 - .5);
    const lx = (s - d.vw / d.W) / 2, ly = (s - d.vh / d.H) / 2;
    tx = Math.max(-lx, Math.min(lx, tx)); ty = Math.max(-ly, Math.min(ly, ty));
    return { s, tx: tx * 100, ty: ty * 100 };
  };
  const css = c => `translate(-50%,-50%) translate(${c.tx.toFixed(3)}%,${c.ty.toFixed(3)}%) scale(${c.s.toFixed(4)})`;
  const desktop = () => {
    const d = dims(), h = home(), P = pins();
    if (!h) { const z = { s: 1, tx: 0, ty: 0 }; return { introFrom: z, intro: z, overview: z }; }
    // the title moment: the hotel itself, close up, a little below the centred title
    const intro = fit([h], { x0: .48, x1: .52, y0: .66, y1: .7 }, 2.4, d);
    const introFrom = { ...intro, ty: Math.max(intro.ty - 30, -((intro.s - d.vh / d.H) / 2) * 100) };
    const overview = fit([h, ...P], REGION_D, 3, d);
    return { intro, introFrom, overview };
  };
  // one walk: the hotel and that destination, both in frame
  const walk = (i, mobile) => { const h = home(), p = pins()[i]; return h && p ? fit([h, p], mobile ? REGION_M : REGION_D, 3.2, dims()) : null; };
  // where a map point lands in the pin box under a camera, in px
  const screen = (c, q, d = dims()) => ({ x: d.vw / 2 + c.tx / 100 * d.W + c.s * (q.x - .5) * d.W, y: d.vh / 2 + c.ty / 100 * d.H + c.s * (q.y - .5) * d.H });
  /* A phone is too narrow for the longest walk (Selskógur, 2.2 km east) and the hotel
     together at any scale that still fills the box. Then the destination is framed, the
     route runs in from the left, and an edge marker points back to the hotel. */
  const walkPhone = i => {
    const h = home(), p = pins()[i], d = dims(); if (!h || !p) return null;
    let c = fit([h, p], REGION_M, 3.2, d), hs = screen(c, h, d);
    const fits = hs.x > d.vw * .12 && hs.x < d.vw * .88;
    if (!fits) { c = fit([p], { x0: .62, x1: .62, y0: .48, y1: .48 }, fit([h, p], REGION_M, 3.2, d).s, d); hs = screen(c, h, d); }
    return { cam: c, home: hs, homeVisible: hs.x > d.vw * .06 && hs.x < d.vw * .94 };
  };
  return { fit, css, desktop, walk, walkPhone, screen, dims };
})();

/* ============================================================
   MAP CHAPTER
   ============================================================ */
const map = (() => {
  const pins = $$('.l-location__pin'), labels = $$('.js-loc-labels p'), texts = $$('.js-loc-texts p'), counter = $('#loc-counter'), prog = $('.js-loc-progress');
  const routes = $$('.l-location__route'), inner = $('.js-map-inner');
  const section = $('#locations'), sheet = $('.l-location__map-img');
  const loader = chapterLoader($('.l-location__map-pin'), 'Loading the map');
  let sheetStarted = false;
  const loadSheet = () => {
    if (sheetStarted || !sheet) return; sheetStarted = true;
    loader.show();
    const src = sheet.dataset.src || sheet.getAttribute('src');
    const done = () => loader.hide();
    if (sheet.dataset.src) { sheet.src = src; }
    if (sheet.complete) done(); else { sheet.addEventListener('load', done, { once: true }); sheet.addEventListener('error', done, { once: true }); }
  };
  const mobile = $('.js-mobile-scrollable'), mapPin = $('.l-location__map-pin');
  const mapEl = $('.js-location-map');
  /* Dash the routes from their MEASURED length. pathLength normalisation is
     ignored by Chrome once a stroke is non-scaling, which turned the draw-on
     into a permanently dashed line. */
  const lens = routes.map(r => { const L = r.getTotalLength(); r.style.strokeDasharray = L; r.style.strokeDashoffset = L; return L; });
  let overview = null;
  addEventListener('resize', () => { overview = null; last = -1; });
  let last = -1, panX = 0, panY = 0, panK = 1, tx = 0, ty = 0, tk = 1, walkCam = null;
  /* markers are drawn for a map at scale 3; hold them at that size whatever the camera
     does, or the hotel shrinks to a 5 px dot in the wide overview */
  const MARK_REF = 3, MARK_REF_PHONE = 2.1;
  const homeEdge = $('.l-location__home-edge');
  const setIndex = i => {
    if (i === last) return; last = i;
    pins.forEach((p, k) => p.classList.toggle('is-active', k === i));
    labels.forEach((p, k) => p.classList.toggle('is-active', k === i));
    texts.forEach((p, k) => p.classList.toggle('is-active', k === i));
    routes.forEach((r, k) => { const on = k === i; r.classList.toggle('is-drawn', on); r.style.strokeDashoffset = on ? 0 : lens[k]; });
    if (counter) counter.textContent = i + 1;
    // the walk's own framing: hotel and destination both in view (desktop zooms the inner
    // layer on top of the overview flight; a phone moves the whole map)
    walkCam = mapCam.walk(i, !mdUp());
    if (!mdUp() && mapEl) {
      const w = mapCam.walkPhone(i);
      if (w) {
        mapEl.style.setProperty('transform', mapCam.css(w.cam), 'important');
        mapEl.style.setProperty('--map-inv', (MARK_REF_PHONE / w.cam.s).toFixed(3));
        // the edge marker replaces the hotel's own label while the hotel is off screen,
        // or both show at once where its name peeks in from the edge
        mapPin.classList.toggle('is-home-off', !w.homeVisible);
        // a place label that would be cut by the screen edge is hidden for that card
        const d = mapCam.dims();
        $$('.l-location__landmark', mapPin).forEach(l => {
          const q = mapCam.screen(w.cam, { x: parseFloat(l.style.left) / 100, y: parseFloat(l.style.top) / 100 }, d);
          const half = l.offsetWidth * MARK_REF_PHONE / 2;
          l.classList.toggle('is-clipped', q.x - half < 6 || q.x + half > d.vw - 6);
        });
        if (homeEdge) {
          homeEdge.classList.toggle('is-on', !w.homeVisible);
          homeEdge.style.top = `${Math.max(mapPin.clientHeight * .3, Math.min(mapPin.clientHeight * .68, w.home.y)).toFixed(0)}px`;
        }
      }
    }
  };
  const tick = y => {
    if (section && !sheetStarted) { const t = docTop(section); if (y > t - VH * 2.5 && y < t + section.offsetHeight) loadSheet(); }
    // desktop only: on touch the horizontal card swipe is the source of truth, and
    // driving the index from the (hidden, desktop) progress line every frame stamped
    // straight over it, so the route never followed the swipe
    if (prog && mdUp()) setIndex(Math.min(pins.length - 1, Math.floor(parseFloat(prog.dataset.progress || '0') * pins.length)));
    if (inner && mdUp()) {
      // the overview the flight lands on; zoom the inner layer from it to this walk's frame,
      // only once the flight has landed (progress past the first quarter's lead-in)
      const p = parseFloat(prog && prog.dataset.progress || '0');
      if (!overview) overview = mapCam.desktop().overview;
      if (walkCam && p > .2) { tk = walkCam.s / overview.s; tx = (walkCam.tx - overview.tx) / overview.s; ty = (walkCam.ty - overview.ty) / overview.s; }
      else { tk = 1; tx = 0; ty = 0; }
      panX = lerp(panX, tx, .06); panY = lerp(panY, ty, .06); panK = lerp(panK, tk, .06);
      inner.style.transform = `translate(${panX.toFixed(3)}%, ${panY.toFixed(3)}%) scale(${panK.toFixed(4)})`;
      const m = mapEl && /scale\(([\d.]+)\)/.exec(mapEl.style.transform);
      const S = (m ? parseFloat(m[1]) : 1) * panK;
      if (mapEl) mapEl.style.setProperty('--map-inv', (MARK_REF / S).toFixed(3));
    }
  };
  if (mobile) {
    const cards = $$('.l-location__mcard', mobile);
    mobile.addEventListener('scroll', () => {
      const i = Math.round(mobile.scrollLeft / (mobile.scrollWidth - mobile.clientWidth || 1) * (cards.length - 1));
      setIndex(i);
    }, { passive: true });
    setIndex(0);
  }
  return { tick };
})();

/* ============================================================
   QUOTES + RING CURSOR
   ============================================================ */
const quotes = (() => {
  const root = $('#quotes'), items = $$('.js-quote-items p'), cursor = $('#cursor'), bar = $('.cursor__bar'), cnt = $('#cursor-counter'), container = $('.js-cursor-target-container');
  if (!root) return { tick() {} };
  let last = -1, mx = 0, my = 0, cx = 0, cy = 0, inside = false;
  const setIndex = i => { if (i === last) return; last = i; items.forEach((p, k) => p.classList.toggle('is-active', k === i)); cnt.textContent = i + 1; bar.style.strokeDashoffset = 370.7 * (1 - (i + 1) / 3); };
  container.addEventListener('mouseenter', () => { inside = true; cursor.classList.add('is-visible'); });
  container.addEventListener('mouseleave', () => { inside = false; cursor.classList.remove('is-visible'); });
  container.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  const tick = y => {
    const top = docTop(root), h = root.offsetHeight;
    const p = clamp((y - top) / (h - VH || 1));
    setIndex(Math.min(2, Math.floor(p * 3)));
    if (inside && SMOOTH) { cx = lerp(cx, mx, .5); cy = lerp(cy, my, .5); cursor.style.transform = `translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px) ${mx < innerWidth / 2 ? '' : ''}`; }
  };
  setIndex(0);
  return { tick };
})();

/* ============================================================
   FOOTER MASK
   ============================================================ */
const footerMask = (() => {
  const root = $('.js-mask-text'); if (!root) return { tick() {} };
  const maskEl = $('.footer__text--mask', root);
  let mx = -300, my = -300, cx = -300, cy = -300;
  root.addEventListener('mousemove', e => { const r = maskEl.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
  root.addEventListener('mouseleave', () => { mx = -300; my = -300; });
  const tick = () => { cx = lerp(cx, mx, .25); cy = lerp(cy, my, .25); maskEl.style.setProperty('--x', cx.toFixed(1) + 'px'); maskEl.style.setProperty('--y', cy.toFixed(1) + 'px'); };
  return { tick };
})();

/* ============================================================
   BOOK: straight through to the hotel's own engine
   ============================================================
   Godo is the hotel's booking engine AND its channel manager, so this site never
   replaces it. It hands the guest over with dates, guests and room already chosen.
   Deep link verified live on 2026-10-10 against propid 304801: checkin and checkout
   echo back, roomid narrows the engine to that one room, referer tags the source in
   the hotel's own reports. Nothing is sent from this page; the engine opens in a new
   tab from a real link, so it also survives a middle-click or a blocked pop-up. */
const booking = (() => {
  const triggers = $$('[data-booking]');
  if (!triggers.length) return;
  const BASE = 'https://property.godo.is/booking2.php';
  /* engine room ids, read off booking2.php?propid=304801 on 2026-10-10:
     [the room, the same room facing Lagarfljót] */
  const ROOMS = [
    { key: 'single',   name: 'Single',   note: 'One single bed, one guest',          ids: [635360, 635373] },
    { key: 'twin',     name: 'Twin',     note: 'Two single beds',                    ids: [635376, 635377] },
    { key: 'double',   name: 'Double',   note: 'One double bed',                     ids: [635391, 635398] },
    { key: 'superior', name: 'Superior', note: 'A double bed, 30 m\u00B2',            ids: [635576, 635577] },
    { key: 'deluxe',   name: 'Deluxe',   note: 'A double bed, 40 m\u00B2',            ids: [635578, 635579] },
    { key: 'pet',      name: 'Twin, pets allowed', note: 'Two single beds, pets may stay in the room', ids: [635390, null] },
  ];
  let el = null, prevFocus = null;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const godoDate = s => { const [y, m, d] = s.split('-').map(Number); return `${y}-${m}-${d}`; };   // Beds24 wants it unpadded
  const build = () => {
    const today = new Date();
    const inD = new Date(today.getTime() + 864e5 * 14), outD = new Date(today.getTime() + 864e5 * 16);
    el = document.createElement('div');
    el.className = 'modal modal--booking is-hidden';
    el.id = 'booking';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="modal__bg"><img class="modal__img" src="assets/img/hero-aurora@1440.webp" alt=""></div>
      <div class="modal__scroller bk" data-lenis-prevent>
        <div class="bk__inner" role="dialog" aria-modal="true" aria-labelledby="bk-h">
          <div class="bk__head">
            <h2 class="bk__title" id="bk-h"><span class="text-subtitle">Book</span><span class="h2">DIRECTLY</span></h2>
            <p class="bk__lead">Choose your dates and a room. The hotel's own booking engine opens with them filled in, and you finish the booking there.</p>
          </div>
          <form class="bk__form" novalidate>
            <div class="bk__row">
              <label class="bk__f"><span class="text-small">Arriving</span><input type="date" name="in" autocomplete="off" value="${iso(inD)}" min="${iso(today)}"></label>
              <label class="bk__f"><span class="text-small">Leaving</span><input type="date" name="out" autocomplete="off" value="${iso(outD)}" min="${iso(today)}"></label>
              <label class="bk__f bk__f--n"><span class="text-small">Guests</span><select name="guests" autocomplete="off"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></label>
            </div>
            <p class="bk__nights text-small" data-nights role="status" aria-live="polite"></p>
            <fieldset class="bk__rooms">
              <legend class="text-small">Room</legend>
              ${ROOMS.map((r, i) => `
                <label class="bk__room${i === 1 ? ' is-on' : ''}">
                  <input type="radio" name="room" value="${r.key}"${i === 1 ? ' checked' : ''}>
                  <span class="bk__room-n h3">${r.name}</span>
                  <span class="bk__room-d text-small">${r.note}</span>
                </label>`).join('')}
            </fieldset>
            <label class="bk__check"><input type="checkbox" name="lake"><span>Facing Lagarfljót<i class="text-small">sold as its own room, at a higher rate</i></span></label>
            <div class="bk__actions">
              <a class="btn btn--primary" data-bk-go href="${BASE}" target="_blank" rel="noopener">Check availability</a>
              <a class="btn btn--underline" data-bk-all href="${BASE}" target="_blank" rel="noopener"><span class="btn__underline">See every room</span></a>
            </div>
            <p class="bk__fine text-small">Opens property.godo.is, the engine the hotel uses today, in a new tab. Nothing is sent from this page.</p>
          </form>
        </div>
      </div>`;
    document.body.appendChild(el);
    const form = $('.bk__form', el), go = $('[data-bk-go]', el), all = $('[data-bk-all]', el);
    const nightsEl = $('[data-nights]', el), lake = form.lake;
    let prevKey = form.room.value;
    const sync = () => {
      const a = new Date(form.in.value), b = new Date(form.out.value);
      const n = Math.round((b - a) / 864e5);
      const ok = n > 0 && form.in.value && form.out.value;
      const room = ROOMS.find(r => r.key === form.room.value) || ROOMS[1];
      if (room.key === 'single') form.guests.value = '1';
      else if (prevKey === 'single' && form.guests.value === '1') form.guests.value = '2';   // undo the single's forced one
      prevKey = room.key;
      lake.disabled = !room.ids[1];
      if (lake.disabled) lake.checked = false;
      $('.bk__check', el).classList.toggle('is-off', lake.disabled);
      nightsEl.textContent = ok ? `${n} night${n > 1 ? 's' : ''} at Egilsstaðir 1` : 'The leaving date has to be after the arriving date.';
      nightsEl.classList.toggle('is-error', !ok);
      const p = new URLSearchParams({ propid: '304801', invoicee: '652194' });
      if (ok) { p.set('checkin', godoDate(form.in.value)); p.set('checkout', godoDate(form.out.value)); }
      p.set('numadult', form.guests.value); p.set('numchild', '0');
      const base = p.toString();
      p.set('roomid', String(room.ids[lake.checked ? 1 : 0]));
      p.set('lang', 'en'); p.set('referer', 'lakehotel-web');
      go.href = `${BASE}?${p}`;
      all.href = `${BASE}?${base}&lang=en&referer=lakehotel-web`;
      go.setAttribute('aria-disabled', ok ? 'false' : 'true');
      $$('.bk__room', el).forEach(l => l.classList.toggle('is-on', $('input', l).checked));
    };
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    form.addEventListener('submit', e => e.preventDefault());
    go.addEventListener('click', e => { if (go.getAttribute('aria-disabled') === 'true') { e.preventDefault(); form.out.focus(); } });
    el.addEventListener('click', e => { if (e.target === el || e.target.classList.contains('modal__scroller')) close(); });
    el.__sync = sync;
    sync();
  };
  const open = (roomKey) => {
    if (!el) build();
    if (roomKey) {
      const r = $(`input[name="room"][value="${roomKey}"]`, el);
      if (r) { r.checked = true; el.__sync(); }
    }
    if (el.classList.contains('is-open')) return;
    overlays.opened('booking');
    html.classList.add('with-modal-booking');   // the header's own Book a stay would re-open what is already open
    prevFocus = document.activeElement;
    el.classList.remove('is-hidden'); el.setAttribute('aria-hidden', 'false');
    void el.offsetWidth; el.classList.add('is-open');
    // a phone opens the native date picker the moment a date field takes focus, so on
    // touch the dialog itself takes focus (iOS Simulator pass, 2026-10-10)
    if (isTouch) { const h = $('#bk-h', el); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
    else { const f = $('.bk__form input', el); if (f) f.focus({ preventScroll: true }); }
  };
  const close = () => {
    if (!el || !el.classList.contains('is-open')) return;
    el.classList.remove('is-open'); el.classList.add('is-closing');
    html.classList.remove('with-modal-booking');
    overlays.closed('booking');
    setTimeout(() => { el.classList.remove('is-closing'); el.classList.add('is-hidden'); el.setAttribute('aria-hidden', 'true'); }, 420);
    if (prevFocus) prevFocus.focus({ preventScroll: true });
  };
  overlays.register('booking', close);
  triggers.forEach(t => t.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;   // let a deliberate new-tab through to the real engine
    e.preventDefault(); open(t.dataset.room);
  }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el && el.classList.contains('is-open')) close(); });
  return { open, close };
})();

/* ============================================================
   HASH LINKS
   ============================================================ */
$$('a[href^="#"]').forEach(a => {
  if (a.classList.contains('js-menu-link')) return;
  a.addEventListener('click', e => {
    const id = a.getAttribute('href'); if (id.length < 2) return;
    const t = $(id); if (!t) return;
    /* the wordmark and Map sit in the header, above any open overlay: going
       somewhere on the page has to dismiss what is covering it */
    overlays.closeAll();
    e.preventDefault();
    const off = t.id === 'tenets' ? -VH * .62 : 0;
    scroller.scrollToEl(t, off);
  });
});

/* ============================================================
   WELLS + SNAPS
   ============================================================ */
const measureWellsSnaps = () => {
  scroller.wells = [];
  $$('[data-gravity-well]').forEach(el => { const top = docTop(el), h = el.offsetHeight; JSON.parse(el.dataset.gravityWell).forEach(w => scroller.wells.push(top + h * w.element / 100 - VH * w.viewport / 100)); });
  scroller.snaps = [];
  $$('[data-snap]').forEach(el => { const top = docTop(el), h = el.offsetHeight; JSON.parse(el.dataset.snap).forEach(p => scroller.snaps.push({ y: top + h * p.element / 100 - VH * p.viewport / 100, scrollable: !!p.scrollable })); });
  scroller.snaps.sort((a, b) => a.y - b.y);
};

/* ============================================================
   MEASURE + LOOP
   ============================================================ */
const measureAll = () => {
  measureViewport();
  slider.measure();
  parallax.measure();
  header.measure();
  measureWellsSnaps();
  scroller.setLimit();
  rooms.resize(); hang.measure();
};
let resizeT;
const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { parallax.build(); measureAll(); }, 120); };
window.addEventListener('resize', onResize);
const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(measureAll, 120); });
ro.observe(document.body);

let running = false;
const loop = (now) => {
  if (!running) { preloader.tick(startPage); }
  scroller.tick();
  const y = SMOOTH ? scroller.y : scrollY;
  reveal.tick(now);          // rect READS first, before the transform writes below
  parallax.apply(y);
  slider.tick(y);
  header.tick(y);
  rooms.tick(y);
  hang.tick(y);
  scrollCue.tick(y, now);
  map.tick(y);
  quotes.tick(y);
  footerMask.tick();
  menu.tick();
  scroller.listeners.forEach(f => f());
  requestAnimationFrame(loop);
};

const startPage = () => {
  if (running) return; running = true;
  sessionStorage.setItem('lakehotel-preloaded', '1');
  measureAll();
  // header + reveals
  if (mdUp() && !reduced) { setTimeout(() => transition(header.el, 'slide-in-top block'), 250); }
  reveal.start();
};

/* Cross-page curtain. Same-origin links inside the site fade out before they
   navigate; the incoming page raises its curtain in the head and drops it here,
   so moving between the landing page and a room never flashes raw content. */
const pageTransition = (() => {
  const ov = $('#page-overlay');
  const drop = () => { html.classList.remove('is-entering'); ov.classList.remove('is-on'); };
  const raise = href => { ov.classList.add('is-on'); setTimeout(() => { location.href = href; }, 380); };
  window.__lakeNav = raise;                                       // the WebGL ring navigates through the same curtain
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname) return;             // in-page anchors keep the smooth scroll
    if (!/\.html?$/.test(url.pathname) && url.pathname !== '/') return;
    e.preventDefault(); raise(url.href);
  });
  addEventListener('pageshow', drop);                            // also covers the bfcache back button
  return { drop };
})();

const boot = async () => {
  await document.fonts.ready;
  requestAnimationFrame(() => setTimeout(pageTransition.drop, 60));
  parallax.build();
  measureAll();
  // hash on load
  if (location.hash && location.hash !== '#skip-preloader') { const t = $(location.hash); if (t) { const to = docTop(t); window.scrollTo(0, to); if (scroller.lenis) scroller.lenis.scrollTo(to, { immediate: true }); scroller.y = scroller.target = to; } }
  if (preloader.skip) { preloader.el.classList.add('is-removed'); startPage(); }
  requestAnimationFrame(loop);
};
boot();
