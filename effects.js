/* Főoldali effektek (a lab v6-ból). Mindegyik a <html> egy fx-* osztályára indul,
   az engine-t és a főoldal JS-ét csak olvassa (--sc-p, inline opacity).
   Nincs globális változó, nincs hálózati hívás, nincs naplózás. */
(function () {
  var root = document.documentElement;
  function has(c) { return root.classList.contains(c); }
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var phone = matchMedia('(max-width: 760px)');
  // fx-sync: semmi nem mozog magától; minden pontosan a lépés tweenjével együtt indul és áll meg
  var sync = has('fx-sync');
  var PK = sync ? [0.10, 0.30, 0.56, 0.94] : [0.06, 0.31, 0.575, 0.96];

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { return t * t * (3 - 2 * t); }
  function pOf(el) { return parseFloat(el.style.getPropertyValue('--sc-p')) || 0; }
  function absTop(el) { return el.getBoundingClientRect().top + scrollY; }
  function maxY() { return document.scrollingElement.scrollHeight - innerHeight; }

  // Egyetlen rAF-hurok, amire az effektek feliratkoznak.
  var tasks = [];
  function loop() { for (var i = 0; i < tasks.length; i++) tasks[i](); requestAnimationFrame(loop); }

  var quiet = document.querySelector('.quiet');
  var peakAct = document.getElementById('parallels');
  var peak = document.getElementById('peak');
  var series = document.getElementById('series');
  var fb = document.getElementById('front-back');
  var app = document.getElementById('app');
  var entries = peakAct.querySelectorAll('.entry');

  // ---------- megállók: a lépéses görgetés, az oldalsín és a fényfoltok közös térképe ----------
  // A csúcs-aktuson belüli pozíciók ugyanazok, mint a gyűjtőlista ugrásai a főoldalon.
  // fx-sync alatt közelebb állnak a söprések széleihez, hogy a váltás a teljes tweent kitöltse.
  var STOPS = [
    { label: 'Intro',        at: function () { return 0; },                                  a: [6,182,212],   b: [124,58,237] },
    { label: 'Prelude',      at: function () { return absTop(quiet) + innerHeight * 0.2; },  a: [124,58,237],  b: [6,182,212] },
    { label: 'Base',         at: function () { return inAct(peakAct, PK[0]); },              a: [6,182,212],   b: [124,58,237] },
    { label: 'Refractor',    at: function () { return inAct(peakAct, PK[1]); },              a: [236,72,153],  b: [34,211,238] },
    { label: 'Numbered',     at: function () { return inAct(peakAct, PK[2]); },              a: [233,170,60],  b: [217,119,6] },
    { label: 'Autograph',    at: function () { return inAct(peakAct, PK[3]); },              a: [210,218,255], b: [96,130,250] },
    // a sín eleje: itt még áll a "Beyond the base set." felvezetés, mielőtt a sín elindul
    { label: 'Beyond',       at: function () { return inAct(series, 0); },                   a: [124,58,237],  b: [6,182,212] },
    { label: 'Illustrated',  at: function () { return inAct(series, 0.29); },                a: [167,139,250], b: [249,115,22] },
    { label: 'Inserts',      at: function () { return inAct(series, 0.59); },                a: [34,211,238],  b: [239,68,68] },
    // a sín 0.78-nál ér végig; fx-sync alatt ott állunk meg (a zárószöveg a jobb szélnél), nem üres görgetés után
    { label: 'Clubs',        at: function () { return inAct(series, sync ? 0.78 : 0.88); },              a: [6,182,212],   b: [167,139,250] },
    // előbb az előlap áll, a következő lépés törli át a hátoldalra (reveal: 0.22..0.8)
    { label: 'Front',        at: function () { return inAct(fb, 0.04); },                    a: [6,182,212],   b: [124,58,237] },
    { label: 'Back',         at: function () { return inAct(fb, 0.9); },                     a: [6,182,212],   b: [100,116,139] },
    { label: 'Collection',   at: function () { return absTop(app) + (app.offsetHeight - innerHeight) / 2; }, a: [167,139,250], b: [99,102,241] },
    { label: 'Get the app',  at: function () { return maxY(); },                             a: [6,182,212],   b: [233,196,106] }
  ];
  function inAct(act, f) { return absTop(act) + (act.offsetHeight - innerHeight) * f; }
  var ys = [];
  function measure() {
    var m = maxY();
    ys = STOPS.map(function (s) { return Math.round(Math.max(0, Math.min(m, s.at()))); });
  }
  function nearest(y) {
    var best = 0;
    for (var i = 1; i < ys.length; i++) if (Math.abs(ys[i] - y) < Math.abs(ys[best] - y)) best = i;
    return best;
  }
  measure();
  addEventListener('resize', function () { requestAnimationFrame(measure); });
  addEventListener('load', measure);

  // ---------- fx-blur: a scroll-hajtott sorok elmosódásból élesednek ----------
  // Az engine (cue-k) és a főoldal JS-e (bejegyzések) inline opacity-t ír; ebből számoljuk a blurt.
  if (has('fx-blur') && !reduce) {
    var blurred = Array.prototype.slice.call(document.querySelectorAll('[data-sc-cue]')).concat(Array.prototype.slice.call(entries));
    var blurLast = blurred.map(function () { return -1; });
    tasks.push(function () {
      for (var i = 0; i < blurred.length; i++) {
        var o = blurred[i].style.opacity;
        var b = o === '' ? 0 : Math.round((1 - parseFloat(o)) * 60) / 10;
        if (b !== blurLast[i]) { blurLast[i] = b; blurred[i].style.filter = b > 0.05 ? 'blur(' + b + 'px)' : ''; }
      }
    });
  }

  // ---------- fx-glass: a sáv a hero után üveg hátteret kap ----------
  if (has('fx-glass')) {
    var bar = document.querySelector('.bar');
    var onGlass = function () { bar.classList.toggle('is-solid', scrollY > innerHeight * 0.6); };
    addEventListener('scroll', onGlass, { passive: true });
    onGlass();
  }

  // ---------- fx-giant: óriási körvonalas szó a csúcs mögött, a bejegyzéssel együtt ----------
  if (has('fx-giant') && !reduce) {
    var WIN = [[0, 0.185], [0.185, 0.445], [0.445, 0.705], [0.705, 1]];
    var giantEl = function (w, parent, before) {
      var el = document.createElement('div');
      el.className = 'lab-giant';
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('data-tone', w.toLowerCase());
      el.textContent = w;
      parent.insertBefore(el, before);
      return el;
    };
    var giants = ['Base', 'Refractor', 'Numbered', 'Autograph'].map(function (w) {
      return giantEl(w, peak, peak.querySelector('.peak__copy'));
    });
    var fbStage = fb.querySelector('[data-sc-stage]');
    var back = giantEl('Back', fbStage, fbStage.firstChild);

    var place = function (el, o, t) {
      // dhirty: a szó lassan, ellenirányban vándorol, miközben a bejegyzés látszik;
      // a fény (fx-glow) a szóval szemben úszik át a betűkön
      var x = ((0.6 - t) * 36).toFixed(2);
      el.style.opacity = o.toFixed(3);
      el.style.transform = 'translate3d(calc(50vw - 50% + ' + x + 'vw),' + (phone.matches ? '0' : '-50%') + ',0)';
      el.style.setProperty('--gx', (15 + t * 70).toFixed(1) + '%');
    };
    tasks.push(function () {
      var p = pOf(peakAct);
      for (var i = 0; i < 4; i++) {
        var o = parseFloat(entries[i].style.opacity) || 0;
        place(giants[i], o, clamp((p - WIN[i][0]) / (WIN[i][1] - WIN[i][0])));
      }
      var q = pOf(fb);
      place(back, ease(clamp(q / 0.25)) * (1 - ease(clamp((q - 0.92) / 0.08))), q);
    });
  }

  // ---------- fx-atmos: két fényfolt, színük a legközelebbi két megálló között átúszik ----------
  if (has('fx-atmos')) {
    var atmos = document.createElement('div');
    atmos.className = 'lab-atmos';
    atmos.setAttribute('aria-hidden', 'true');
    document.body.appendChild(atmos);
    var mix = function (c1, c2, t) { return [0, 1, 2].map(function (k) { return Math.round(c1[k] + (c2[k] - c1[k]) * t); }); };
    var atmosLast = '';
    tasks.push(function () {
      var y = scrollY, i = 0;
      while (i < ys.length - 2 && y > ys[i + 1]) i++;
      var span = ys[i + 1] - ys[i];
      var t = span > 0 ? ease(clamp((y - ys[i]) / span)) : 0;
      var a = mix(STOPS[i].a, STOPS[i + 1].a, t), b = mix(STOPS[i].b, STOPS[i + 1].b, t);
      var css = 'radial-gradient(48% 52% at 16% 28%, rgba(' + a + ',.13), transparent 72%),' +
                'radial-gradient(44% 48% at 86% 78%, rgba(' + b + ',.11), transparent 72%)';
      if (css !== atmosLast) { atmosLast = css; atmos.style.background = css; }
    });
  }

  // ---------- fx-sway: a kártya nyugalomban lassan ring, egérrel a mutató felé dől ----------
  if (has('fx-sway') && !reduce) {
    var swayEls = [peak.querySelector('.peak__anim'), fb.querySelector('.fb__fig')];
    var calm = 0, lastY = scrollY, lastMove = 0, px = 0, py = 0, tx = 0, ty = 0;
    if (fine) addEventListener('pointermove', function (e) {
      tx = e.clientX / innerWidth * 2 - 1;
      ty = e.clientY / innerHeight * 2 - 1;
    }, { passive: true });
    tasks.push(function () {
      var now = performance.now();
      if (scrollY !== lastY) { lastY = scrollY; lastMove = now; }
      // görgetés közben elhal, megállás után ~0.4 mp-cel tér vissza
      // fx-sync: nincs magától ringás, csak a mutató dönti meg
      calm += ((!sync && now - lastMove > 400 ? 1 : 0) - calm) * 0.04;
      px += (tx - px) * 0.06;
      py += (ty - py) * 0.06;
      var s = now / 1000;
      var rx = (Math.sin(s * 0.7) * 2.2 * calm - py * 4).toFixed(2);
      var ry = (Math.sin(s * 0.45 + 1) * 3.2 * calm + px * 6).toFixed(2);
      var css = 'perspective(1400px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
      for (var i = 0; i < swayEls.length; i++) {
        var r = swayEls[i].getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight) swayEls[i].style.transform = css;
      }
    });
  }

  // ---------- fx-turn: a Front & Back kártya a lépéssel együtt 3D-ben átfordul (a törlés helyett) ----------
  // A fordulás a szakasz p 0.06..0.88 sávjában fut, így a Front -> Back lépés teljes tweenjét kitölti.
  // Fordulás közben a kártya kicsit kiemelkedik és megdől, az élein látszik a vastagsága.
  if (has('fx-turn') && !reduce) {
    var tFig = fb.querySelector('.fb__fig');
    var tFront = tFig.querySelector('.fb__fig > .slab');
    var tBack = tFig.querySelector('.fb__back');
    var turn = document.createElement('div');
    turn.className = 'lab-turn';
    tFig.insertBefore(turn, tFront);
    turn.appendChild(tFront);
    turn.appendChild(tBack);
    var DEPTH = 9, TURN = [0.06, 0.88];
    turn.style.setProperty('--half', DEPTH / 2 + 'px');
    // élek: bal, jobb (függőleges), felső, alsó (vízszintes)
    var tEdges = ['', '', '--y', '--y'].map(function (k) {
      var e = document.createElement('i');
      e.className = 'lab-turn__edge' + (k ? ' lab-turn__edge' + k : '');
      e.setAttribute('aria-hidden', 'true');
      turn.appendChild(e);
      return e;
    });
    function placeEdges() {
      var w = turn.offsetWidth, h = turn.offsetHeight, r = w * 0.05;
      var spec = [
        [DEPTH, h - 2 * r, 'rotateY(-90deg) translateZ(' + w / 2 + 'px)'],
        [DEPTH, h - 2 * r, 'rotateY(90deg) translateZ(' + w / 2 + 'px)'],
        [w - 2 * r, DEPTH, 'rotateX(90deg) translateZ(' + h / 2 + 'px)'],
        [w - 2 * r, DEPTH, 'rotateX(-90deg) translateZ(' + h / 2 + 'px)']
      ];
      tEdges.forEach(function (e, i) {
        var s = spec[i];
        e.style.width = s[0] + 'px';
        e.style.height = s[1] + 'px';
        e.style.margin = (-s[1] / 2) + 'px 0 0 ' + (-s[0] / 2) + 'px';
        e.style.transform = s[2];
      });
    }
    placeEdges();
    addEventListener('resize', placeEdges);
    var turnLast = '';
    tasks.push(function () {
      var r = fb.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      var t = ease(clamp((pOf(fb) - TURN[0]) / (TURN[1] - TURN[0])));
      var lift = Math.sin(Math.PI * t);
      var css = 'perspective(1600px) translateZ(' + (70 * lift).toFixed(1) + 'px) rotateX(' + (-7 * lift).toFixed(2) +
                'deg) rotateY(' + (180 * t).toFixed(2) + 'deg) rotateZ(' + (-3 * lift).toFixed(2) + 'deg)';
      if (css !== turnLast) {
        turnLast = css;
        turn.style.transform = css;
        // a fény a forgással együtt söpör át balról jobbra; a hátlap tükrözött, ott fordított irányban fut
        // nyugalomban (t = 0 és t = 1) a lapon kívül áll
        turn.style.setProperty('--glare', (t < 0.5 ? -40 + 280 * t : 100 - 280 * (t - 0.5)).toFixed(1));
      }
    });
  }

  // ---------- fx-curtain: a kimenő felület áll és hátralép, amíg a következő ráfut (mint a hero) ----------
  // Ugyanaz a mozgás, mint a főoldal hero-emelése: -9vh, 0.95-ös méret, 0.4-es fényerő a takarás végére.
  if (has('fx-curtain') && !reduce) {
    var OUT = [
      [quiet.querySelector('.sc-wrap'), quiet],
      [peak, peakAct],
      [series.querySelector('[data-sc-stage]'), series],
      [fb.querySelector('[data-sc-stage]'), fb],
      [app.querySelector('.sc-wrap'), app]
    ];
    var outLast = OUT.map(function () { return ''; });
    OUT.forEach(function (o) { o[0].style.transformOrigin = '50% 35%'; });
    tasks.push(function () {
      var vh = innerHeight;
      for (var i = 0; i < OUT.length; i++) {
        var bottom = OUT[i][1].getBoundingClientRect().bottom, k = vh - bottom, css = '', op = '';
        if (k > 0 && bottom > 0) {
          var t = clamp(k / vh), e = ease(t);
          // k: a görgetés kioltása, így a felület helyben marad, amíg a következő letakarja
          css = 'translate3d(0,' + (k - 0.09 * vh * e).toFixed(1) + 'px,0) scale(' + (1 - 0.05 * e).toFixed(4) + ')';
          op = (1 - 0.6 * t).toFixed(3);
        }
        if (css !== outLast[i]) { outLast[i] = css; OUT[i][0].style.transform = css; OUT[i][0].style.opacity = op; }
      }
    });
  }

  // ---------- fx-stepped: egy mozdulat = egy megálló (dhirty / fullPage.js szabály) ----------
  var tweening = false, idx = nearest(scrollY), tw = 0;
  function eSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  // fx-sync: azonnal indul (nincs lassú felfutás), nyugodtan érkezik
  function eOut(t) { return 1 - Math.pow(1 - t, 3); }
  function goTo(i) {
    i = Math.max(0, Math.min(ys.length - 1, i));
    measure();
    var from = scrollY, to = ys[i], t0 = performance.now(), dur = sync ? 1100 : 1300, curve = sync ? eOut : eSine;
    var my = ++tw; // egy új lépés a futó tweent átveszi
    idx = i;
    if (Math.abs(to - from) < 2) { tweening = false; return; }
    tweening = true;
    (function step(now) {
      if (my !== tw) return;
      var t = clamp((now - t0) / dur);
      scrollTo({ top: from + (to - from) * curve(t), behavior: 'instant' });
      if (t < 1) requestAnimationFrame(step);
      else tweening = false;
    })(t0);
  }
  var stepped = has('fx-stepped') && !reduce;
  if (stepped) {
    var blocked = function () { return tweening || document.body.classList.contains('menu-open'); };
    // natív görgetés (görgetősáv, fókusz, keresés) után a legközelebbi megállóból lépünk tovább
    addEventListener('scroll', function () { if (!tweening) idx = nearest(scrollY); }, { passive: true });

    var deltas = [], lastWheel = 0, fresh = true;
    var avg = function (n) {
      var s = deltas.slice(-n), sum = 0;
      for (var i = 0; i < s.length; i++) sum += s[i];
      return sum / s.length;
    };
    addEventListener('wheel', function (e) {
      if (e.ctrlKey || document.body.classList.contains('menu-open')) return;
      e.preventDefault();
      var now = performance.now();
      if (now - lastWheel > 200) { deltas = []; fresh = true; }
      lastWheel = now;
      var d = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (Math.abs(d) < 1) return;
      deltas.push(Math.abs(d));
      if (deltas.length > 150) deltas.shift();
      // fx-sync: új mozdulat (szünet utáni első esemény) a futó tweent is azonnal átveszi
      if (tweening && !(sync && fresh)) return;
      // gyorsuló mozdulat = új szándék; a lecsengő trackpad-tehetetlenség nem lép.
      // fx-sync: egy mozdulat egyszer lép; a lépés után csak szünet vagy erős gyorsulás indít újat,
      // különben az egyenletes (nem csengő) tehetetlenség a tween végén magától továbbvinné
      var go = !sync ? avg(10) >= avg(70)
        : fresh ? avg(10) >= avg(70)
        : deltas.length > 12 && avg(5) > avg(40) * 1.6;
      if (go) { fresh = false; goTo(idx + (d > 0 ? 1 : -1)); }
    }, { passive: false });

    var touchY = null, touchFired = false;
    addEventListener('touchstart', function (e) { touchY = e.touches[0].clientY; touchFired = false; }, { passive: true });
    addEventListener('touchmove', function (e) {
      if (touchY === null || document.body.classList.contains('menu-open')) return;
      e.preventDefault();
      var dy = touchY - e.touches[0].clientY;
      if (!touchFired && (sync ? !document.body.classList.contains('menu-open') : !blocked()) && Math.abs(dy) > 36) { touchFired = true; goTo(idx + (dy > 0 ? 1 : -1)); }
    }, { passive: false });
    addEventListener('touchend', function () { touchY = null; }, { passive: true });

    addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!sync && blocked()) return;
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return;
      if (sync && document.body.classList.contains('menu-open')) return;
      var k = e.key, dir = 0;
      if (k === 'ArrowDown' || k === 'PageDown') dir = 1;
      else if (k === 'ArrowUp' || k === 'PageUp') dir = -1;
      else if (k === ' ' && tag !== 'BUTTON' && tag !== 'A') dir = e.shiftKey ? -1 : 1;
      else if (k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      // fx-sync: nyomva tartott billentyű nem lépked tovább; egy új leütés a futó tweent átveszi
      if (sync && e.repeat) return;
      if (k === 'Home') goTo(0);
      else if (k === 'End') goTo(ys.length - 1);
      else goTo(idx + dir);
    });
  }

  // ---------- fx-prail: oldalsín csak a parallel-részhez (dhirty "üzletágak"), számláló és doboz nélkül ----------
  if (has('fx-prail')) {
    var prail = document.createElement('nav');
    prail.className = 'lab-prail';
    prail.setAttribute('aria-label', 'Parallels');
    var PSTOP = [2, 3, 4, 5]; // a STOPS-beli Base..Autograph megállók
    var pBtns = ['Base', 'Refractor', 'Numbered', 'Autograph'].map(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span></span><i aria-hidden="true"></i>';
      b.firstChild.textContent = w;
      b.addEventListener('click', function () {
        if (stepped) goTo(PSTOP[i]);
        else { measure(); scrollTo({ top: ys[PSTOP[i]], behavior: reduce ? 'auto' : 'smooth' }); }
      });
      prail.appendChild(b);
      return b;
    });
    document.body.appendChild(prail);
    var pCur = -1, pShown = null;
    tasks.push(function () {
      var r = peakAct.getBoundingClientRect();
      // csak amíg a csúcs-aktus rögzítve áll
      var show = r.top <= 1 && r.bottom >= innerHeight - 1;
      if (show !== pShown) { pShown = show; prail.classList.toggle('is-on', show); }
      var p = pOf(peakAct);
      var i = p < 0.185 ? 0 : p < 0.445 ? 1 : p < 0.705 ? 2 : 3;
      if (i === pCur) return;
      if (pCur >= 0) pBtns[pCur].removeAttribute('aria-current');
      pBtns[i].setAttribute('aria-current', 'true');
      pCur = i;
    });
  }

  if (tasks.length) requestAnimationFrame(loop);
})();
