/* CardPrime admin portál. Statikus oldal, egyetlen közös admin fiókkal (cardprime-admin Cognito pool).
   A védelem a backendben van: POST /admin csak az admin pool tokenjét fogadja el (terraform/admin-portal.tf). */
(function () {
  'use strict';

  // A terraform apply után: `terraform output admin_portal_client_id`
  var CONFIG = {
    region: 'eu-north-1',
    clientId: '7dtcoiimm7qb67sp7istpqmslf',
    apiUrl: 'https://q8gld60qn0.execute-api.eu-north-1.amazonaws.com/prod/admin'
  };
  var COGNITO_URL = 'https://cognito-idp.' + CONFIG.region + '.amazonaws.com/';
  var TOKEN_KEY = 'cpAdminToken';
  var OPERATOR_KEY = 'cpAdminOperator';

  var $ = function (sel) { return document.querySelector(sel); };
  var state = { token: null, challenge: null, order: null, action: null, growth: null, growthLoading: false,
    weekly: null, weeklyLoading: false };

  // ---------- segédek ----------
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatHuf(cents) {
    if (cents == null) return '—';
    var forint = Math.round(Number(cents) / 100);
    return String(forint).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';
  }
  function formatNum(n) {
    return n == null ? '—' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? esc(iso) : d.toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' });
  }
  function badge(value) {
    if (!value) return '<span class="muted">—</span>';
    return '<span class="badge s-' + esc(value) + '">' + esc(value) + '</span>';
  }
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.classList.remove('is-on'); }, 3500);
  }
  function busy(btn, on) {
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // A JWT payload base64url -> bájtok -> UTF-8 szöveg; a kódolás kimondva (atob csak bájtokat ad).
  function jwtPayload(token) {
    var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (part.length % 4) part += '=';
    var bin = atob(part);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  }

  // ---------- munkamenet ----------
  function loadToken() {
    try {
      var t = sessionStorage.getItem(TOKEN_KEY);
      if (t && jwtPayload(t).exp * 1000 > Date.now() + 60000) return t;
    } catch (e) { /* sérült vagy tiltott tároló: újra belépés */ }
    return null;
  }
  function saveToken(t) {
    state.token = t;
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { /* csak memóriában marad */ }
  }
  function logout() {
    state.token = null;
    state.growth = null;
    state.weekly = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nincs teendő */ }
    showLogin();
  }

  function cognito(target, body) {
    return fetch(COGNITO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.' + target
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(cognitoError(data));
        return data;
      });
    });
  }
  function cognitoError(data) {
    var type = String((data && (data.__type || data.code)) || '');
    if (type.indexOf('NotAuthorized') !== -1) return 'Hibás felhasználónév vagy jelszó (vagy túl sok próbálkozás).';
    if (type.indexOf('InvalidPassword') !== -1) return 'Az új jelszó nem felel meg a szabályoknak.';
    if (type.indexOf('PasswordResetRequired') !== -1) return 'Jelszó-visszaállítás szükséges — AWS Console-ban állítsd be.';
    return (data && data.message) || 'Belépési hiba.';
  }

  function onLogin(ev) {
    ev.preventDefault();
    var form = ev.target;
    var btn = form.querySelector('button[type="submit"]');
    var errEl = $('#login-error');
    errEl.textContent = '';
    if (!CONFIG.clientId) {
      errEl.textContent = 'Hiányzik a CONFIG.clientId az admin.js-ben (terraform output admin_portal_client_id).';
      return;
    }
    busy(btn, true);
    var username = form.username.value.trim();
    var request;
    if (state.challenge) {
      // Első belépés: a Console-ban létrehozott felhasználónak ideiglenes jelszava van.
      request = cognito('RespondToAuthChallenge', {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: CONFIG.clientId,
        Session: state.challenge,
        ChallengeResponses: { USERNAME: username, NEW_PASSWORD: form.newPassword.value }
      });
    } else {
      request = cognito('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CONFIG.clientId,
        AuthParameters: { USERNAME: username, PASSWORD: form.password.value }
      });
    }
    request.then(function (data) {
      if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        state.challenge = data.Session;
        $('#new-password-row').hidden = false;
        form.newPassword.required = true;
        form.newPassword.focus();
        return;
      }
      if (!data.AuthenticationResult) throw new Error('Váratlan válasz: ' + (data.ChallengeName || 'nincs token'));
      state.challenge = null;
      form.reset();
      $('#new-password-row').hidden = true;
      saveToken(data.AuthenticationResult.IdToken);
      showApp();
    }).catch(function (e) {
      errEl.textContent = e.message;
    }).then(function () { busy(btn, false); });
  }

  // ---------- API ----------
  function api(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    return fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.token },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 401) { logout(); throw new Error('A munkamenet lejárt, lépj be újra.'); }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || data.message || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  // ---------- nézetek ----------
  var VIEWS = ['overview', 'growth', 'orders', 'collection', 'weekly', 'statuses'];
  function showLogin() {
    $('#tabs').hidden = true;
    $('#logout').hidden = true;
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = true; });
    $('#view-login').hidden = false;
  }
  function showApp() {
    $('#view-login').hidden = true;
    $('#tabs').hidden = false;
    $('#logout').hidden = false;
    switchView('overview');
  }
  function switchView(view) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.view === view ? 'true' : 'false');
    });
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== view; });
    if (view === 'overview') loadStats();
    if (view === 'growth' && !state.growth) loadGrowth();
    if (view === 'orders') loadOrders();
    if (view === 'collection') loadCollection();
    if (view === 'weekly' && !state.weekly) loadWeekly();
  }

  function loadStats() {
    $('#kpis').innerHTML = '<p class="muted">Betöltés…</p>';
    api('stats').then(function (s) {
      var paid = (s.ordersByStatus.paid || {}).count || 0;
      var u = s.users || {};
      var shop = s.shop || {};
      var mix = shop.basketMix || {};
      var kpis = [
        ['Készlet (pool)', formatNum(s.poolStock), 'tasak még eladható', true],
        ['Eladott tasak', formatNum(s.packsSold), 'fizetett rendelésekben, dobozok tasakjaival együtt'],
        ['Felhasználók', formatNum(u.total), s.users ? 'pontos szám · megerősített: ' + formatNum(u.confirmed) +
          ' · nem megerősített: ' + formatNum(u.unconfirmed) + (u.other ? ' · egyéb: ' + formatNum(u.other) : '') : 'nem sikerült lekérdezni'],
        ['Összes rendelés', formatNum(s.totalOrders), 'minden státusz, a lejártakkal együtt'],
        ['Fizetett rendelések', formatNum(paid), channelHint(s.paidByChannel)],
        ['Bevétel', formatHuf(s.revenueCents), 'fizetett, bruttó'],
        ['Visszatérítve', formatHuf(s.refundedCents), 'refunded + cancelled']
      ];
      var basket = [
        ['Átlagos kosárérték', formatHuf(shop.avgBasketCents), 'fizetett tasak-rendelés, szállítás nélkül', true],
        ['Eladott doboz', formatNum(shop.boxes), 'átlag ' + formatAvg(shop.avgBoxesPerOrder) + ' / rendelés'],
        ['Eladott önálló tasak', formatNum(shop.loosePacks), 'átlag ' + formatAvg(shop.avgLoosePacksPerOrder) + ' / rendelés'],
        ['Tasak / rendelés', formatAvg(shop.avgPacksPerOrder), 'átlag, a dobozok 4 tasakjával együtt'],
        ['Kosár összetétele', formatNum(mix.looseOnly) + ' / ' + formatNum(mix.boxOnly) + ' / ' + formatNum(mix.mixed),
          'csak tasak / csak doboz / vegyes']
      ];
      $('#kpis').innerHTML = kpis.map(kpiHtml).join('');
      $('#basket-kpis').innerHTML = basket.map(kpiHtml).join('');
      var prows = (shop.products || []).map(function (p) {
        return '<tr><td>' + esc(p.name || p.packId) + '</td><td>' + (p.packCount > 1 ? 'doboz (' + esc(p.packCount) + ' tasak)' : 'tasak') +
          '</td><td class="num">' + formatNum(p.quantity) + '</td><td class="num">' + formatNum(p.orders) +
          '</td><td class="num">' + formatHuf(p.revenueCents) + '</td><td class="num">' + share(p.revenueCents, shop.revenueCents) + '</td></tr>';
      }).join('');
      $('#product-table').innerHTML = '<thead><tr><th>Termék</th><th>Típus</th><th class="num">Eladott db</th><th class="num">Rendelésben</th>' +
        '<th class="num">Bevétel</th><th class="num">Arány</th></tr></thead><tbody>' +
        (prows || '<tr><td colspan="6" class="muted">Még nincs fizetett rendelés.</td></tr>') + '</tbody>';
      $('#auction-meta').textContent = s.auction && s.auction.orders
        ? 'Aukció (nincs benne a fenti átlagokban): ' + formatNum(s.auction.orders) + ' rendelés, ' + formatHuf(s.auction.revenueCents)
        : '';
      var rows = Object.keys(s.ordersByStatus).sort().map(function (st) {
        var e = s.ordersByStatus[st];
        return '<tr><td>' + badge(st) + '</td><td class="num">' + formatNum(e.count) + '</td><td class="num">' + formatHuf(e.totalCents) + '</td></tr>';
      }).join('');
      $('#status-table').innerHTML = '<thead><tr><th>Státusz</th><th class="num">Darab</th><th class="num">Összeg</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="3" class="muted">Még nincs rendelés.</td></tr>') + '</tbody>';
      $('#stats-meta').textContent = 'Frissítve: ' + formatDate(s.generatedAt);
    }).catch(function (e) {
      $('#kpis').innerHTML = '<p class="error">' + esc(e.message) + '</p>';
    });
  }
  // Mit rendelt a vevő: dobozt vagy önálló tasakot. A készlet ezt nem látja (egy doboz és
  // 4 önálló tasak egyaránt 4-et von le), ezért külön, a tételekből számolva mutatjuk.
  function compositionText(c) {
    if (!c || !c.kind) return '';
    var parts = [];
    if (c.boxes) parts.push(c.boxes + ' doboz');
    if (c.loosePacks) parts.push(c.loosePacks + ' önálló tasak');
    return parts.join(' + ');
  }
  function compositionHtml(c, packs) {
    var text = compositionText(c);
    if (!text) return '<span class="muted">—</span>';
    return esc(text) + (packs ? '<br><span class="muted">készletből: ' + esc(packs) + ' tasak</span>' : '');
  }
  function kpiHtml(k) {
    return '<div class="kpi' + (k[3] ? ' kpi--accent' : '') + '"><div class="kpi__label">' + esc(k[0]) +
      '</div><div class="kpi__value">' + esc(k[1]) + '</div><div class="kpi__hint">' + esc(k[2]) + '</div></div>';
  }
  function formatAvg(n) {
    return n == null ? '—' : Number(n).toLocaleString('hu-HU', { maximumFractionDigits: 2 });
  }
  function share(part, whole) {
    return whole ? Math.round(part / whole * 100) + '%' : '—';
  }
  function channelHint(ch) {
    var parts = Object.keys(ch || {}).map(function (k) { return k + ': ' + ch[k]; });
    return parts.length ? parts.join(' · ') : 'csatorna szerint';
  }

  // ---------- növekedés ----------
  // A 10-es Lambda-kvóta miatt (2026-10-14) fülváltásra nem kér újra adatot, csak az első
  // megnyitáskor és Frissítésre, és amíg egy kérés fut, másikat nem indít.
  function loadGrowth() {
    if (state.growthLoading) return;
    state.growthLoading = true;
    var btn = $('#growth-refresh');
    busy(btn, true);
    $('#growth-kpis').innerHTML = '<p class="muted">Betöltés…</p>';
    api('growthStats').then(function (g) {
      state.growth = g;
      renderGrowth();
    }).catch(function (e) {
      $('#growth-kpis').innerHTML = '<p class="error">' + esc(e.message) + '</p>';
    }).then(function () {
      state.growthLoading = false;
      busy(btn, false);
    });
  }
  function renderGrowth() {
    var g = state.growth;
    var hint = function (field, money) {
      var f = money ? formatHuf : formatNum;
      return 'előző 7 nap: ' + f(g.prev7[field]) + ' · 30 nap: ' + f(g.last30[field]);
    };
    var total = g.usersTotal == null ? 'összesen: nem sikerült lekérdezni' : 'összesen: ' + formatNum(g.usersTotal) +
      (g.usersWithoutDate ? ' · dátum nélkül: ' + formatNum(g.usersWithoutDate) : '');
    var kpis = [
      ['Napi aktív (ma eddig)', formatNum(g.days[0].activeUsers), 'tegnap: ' + formatNum(g.days[1].activeUsers) +
        ' · átlag 7 nap: ' + formatAvg(g.activeAvg7) + ' · 30 nap: ' + formatAvg(g.activeAvg30), true],
      ['Új felhasználók (7 nap)', formatNum(g.last7.newUsers), hint('newUsers') + ' · ' + total],
      ['Beolvasási kísérlet (7 nap)', formatNum(g.last7.scanAttempts), hint('scanAttempts')],
      ['Gyűjteménybe vett kártya (7 nap)', formatNum(g.last7.claims), hint('claims')],
      ['Elfogadott licit (7 nap)', formatNum(g.last7.bidsAccepted), hint('bidsAccepted')],
      ['Fizetett rendelés (7 nap)', formatNum(g.last7.ordersPaid), hint('ordersPaid')],
      ['Bevétel (7 nap)', formatHuf(g.last7.revenueCents), hint('revenueCents', true) + ' · aukcióval együtt'],
      ['Félbehagyott fizetés (30 nap)', pct(g.last30.abandonedPct), formatNum(g.last30.ordersExpired) + ' lejárt / ' +
        formatNum(g.last30.ordersCreated) + ' indított tasak-rendelés']
    ];
    $('#growth-kpis').innerHTML = kpis.map(kpiHtml).join('');
    renderGrowthTable();
    $('#growth-meta').textContent = 'Frissítve: ' + formatDate(g.generatedAt);
  }
  // Az időszakváltó a már letöltött adatból dolgozik, nem hív Lambdát.
  function renderGrowthTable() {
    if (!state.growth) return;
    var rows = state.growth.days.slice(0, Number($('#growth-range').value)).map(function (d) {
      return '<tr><td>' + esc(d.day) + '</td><td class="num">' + formatNum(d.activeUsers) + '</td><td class="num">' + formatNum(d.newUsers) +
        '</td><td class="num">' + formatNum(d.scanAttempts) + '</td><td class="num">' + formatNum(d.scansAuthenticated) +
        '</td><td class="num">' + formatNum(d.claims) + '</td><td class="num">' + formatNum(d.bidsAccepted) +
        '</td><td class="num">' + formatNum(d.ordersCreated) + '</td><td class="num">' + formatNum(d.ordersPaid) +
        '</td><td class="num">' + formatNum(d.ordersExpired) + '</td><td class="num">' + formatHuf(d.revenueCents) + '</td></tr>';
    }).join('');
    $('#growth-table').innerHTML = '<thead><tr><th>Nap (UTC)</th><th class="num">Aktív</th><th class="num">Új felhasználó</th><th class="num">Beolvasás</th>' +
      '<th class="num">Sikeres</th><th class="num">Gyűjteménybe</th><th class="num">Licit</th><th class="num">Indított rendelés</th>' +
      '<th class="num">Fizetett</th><th class="num">Lejárt</th><th class="num">Bevétel</th></tr></thead><tbody>' + rows + '</tbody>';
  }

  // ---------- heti questek (2026-11-09) ----------
  // A user semmilyen összesítést nem lát, ez a csapat nézete (backend: admin_handler
  // _weekly_quest_stats). A szövegek az app magyar i18n-jéből vannak átmásolva
  // (demo_app src/i18n/hu/weekly.ts): ha ott változik egy cím vagy kérdés, itt is kell.
  var WEEKLY_KINDS = { duel: 'Design-párbaj', top3: 'Top 3 választás', survey: 'Kérdőív' };
  var WEEKLY_TITLES = {
    w1_duel: 'Inszert-párbaj', w1_top3: 'Egy kártya, hét arc', w1_survey: 'Első benyomások',
    w2_duel: 'Parallel-párbaj', w2_top3: 'A legjobb parallel', w2_survey: 'Gyűjtés és csomagok',
    w3_duel: 'A fiatalok párbaja', w3_top3: 'Future Wave Top 3', w3_survey: 'Aukciók és nyeremények',
    w4_duel: 'Döntő párbaj', w4_top3: 'A szezon kártyája', w4_survey: 'Szezonzáró'
  };
  var WEEKLY_WHY = { colors: 'Színek', photo: 'Játékosfotó', layout: 'Elrendezés', typography: 'Betűk', vibe: 'Összhatás' };
  // Skálánál a két vég felirata, választásnál az opciók a szerver sorrendjében.
  var WEEKLY_QUESTIONS = {
    look: { prompt: 'Mennyire tetszik a CardPrime-kártyák kinézete?', scale: ['Egyáltalán nem', 'Imádom'] },
    heard_from: { prompt: 'Honnan hallottál a CardPrime-ról?', options: ['Egy baráttól', 'Közösségi médiából', 'Meccsen', 'Boltban', 'Máshonnan'] },
    app_ease: { prompt: 'Mennyire könnyű használni az appot?', scale: ['Nagyon nehéz', 'Nagyon könnyű'] },
    scan_ease: { prompt: 'Mennyire könnyű beolvasni egy kártyát?', scale: ['Nagyon nehéz', 'Nagyon könnyű'] },
    collect_why: { prompt: 'Miért gyűjtöd a CardPrime-kártyákat?', options: ['A csapatom miatt', 'A kedvenc játékosaim miatt', 'A designok miatt', 'A nyereményekért', 'Csak a játék kedvéért'] },
    packs_bought: { prompt: 'Hány csomagot bontottál eddig?', options: ['Még egyet sem', 'Egyet', 'Kettőt-hármat', 'Négyet vagy többet'] },
    price_fair: { prompt: 'Mennyire korrekt egy csomag ára?', scale: ['Túl drága', 'Nagyon megéri'] },
    auction_joined: { prompt: 'Részt vettél már CardPrime-aukción?', options: ['Igen, licitáltam', 'Néztem egyet', 'Még nem'] },
    auction_interest: { prompt: 'Mennyire érdekelnek a kártyaaukciók?', scale: ['Egyáltalán nem', 'Nagyon'] },
    buy_more: { prompt: 'Mitől bontanál több csomagot?', options: ['Több játékostól', 'Ritkább kártyáktól', 'Több aláírt laptól', 'Alacsonyabb ártól', 'Csapatos szettektől'] },
    prize_wish: { prompt: 'Melyik nyereményt szeretnéd a legjobban?', options: ['Közös edzés a csapattal', 'Meccsjegyek', 'Dedikált ajándéktárgy', 'Egy ritka kártya'] },
    season_rating: { prompt: 'Összességében milyen volt ez a szezon?', scale: ['Gyenge', 'Kiváló'] },
    recommend: { prompt: 'Mennyire valószínű, hogy ajánlanád a CardPrime-ot egy barátodnak?', scale: ['Nem valószínű', 'Nagyon valószínű'] },
    next_season: { prompt: 'Játszol a következő szezonban is?', options: ['Igen, biztosan', 'Talán', 'Valószínűleg nem'] },
    next_feature: { prompt: 'Mit építsünk legközelebb?', options: ['Kártyacsere', 'Több aukció', 'Statok és kvíz', 'Csapatkihívások', 'Digitális kártyák'] },
    wish: { prompt: 'Van még valami, amit elmondanál nekünk?' }
  };
  var WEEKLY_STATES = { locked: ['Még nem nyílt meg', 's-expired'], open: ['Nyitva', 's-paid'], closed: ['Lezárva', 's-refunded'] };

  // Ugyanaz a kímélet, mint a Növekedésnél: csak első megnyitáskor és Frissítésre.
  function loadWeekly() {
    if (state.weeklyLoading) return;
    state.weeklyLoading = true;
    var btn = $('#weekly-refresh');
    busy(btn, true);
    $('#weekly-kpis').innerHTML = '<p class="muted">Betöltés…</p>';
    api('weeklyQuestStats').then(function (w) {
      state.weekly = w;
      renderWeekly();
    }).catch(function (e) {
      $('#weekly-kpis').innerHTML = '<p class="error">' + esc(e.message) + '</p>';
    }).then(function () {
      state.weeklyLoading = false;
      busy(btn, false);
    });
  }

  function pctOf(part, whole) {
    return whole ? Math.round(part / whole * 100) : 0;
  }
  // A CSP (style-src 'self') a style="" attribútumot tiltja, ezért a sávok szélessége
  // data-w-ben megy, és a beszúrás után JS-ből (CSSOM) kerül a helyére.
  function barHtml(value, max, cls) {
    return '<span class="wbar"><span class="wbar__fill' + (cls ? ' ' + cls : '') + '" data-w="' + pctOf(value, max) + '"></span></span>';
  }
  function applyBars(root) {
    root.querySelectorAll('[data-w]').forEach(function (el) { el.style.width = el.dataset.w + '%'; });
    root.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('error', function () { img.hidden = true; });
    });
  }
  function designName(id) {
    var d = (state.weekly.designs || {})[id] || {};
    return (d.playerName || id) + (d.variant ? ' — ' + d.variant : '');
  }
  function designHtml(id) {
    var d = (state.weekly.designs || {})[id] || {};
    return '<span class="wdesign">' + (d.imageUrl ? '<img src="' + esc(d.imageUrl) + '" alt="" loading="lazy">' : '') +
      '<span><b>' + esc(d.playerName || id) + '</b><br><span class="muted">' + esc(d.variant || '') + ' · ' + esc(id) + '</span></span></span>';
  }

  // Képellenőrzés (2026-11-10): a kézi weeklyQuestCheck helyett. Melyik betervezett designnak
  // nincs még képe (a telefonon üres keret lenne), vagy nincs is a katalógusban.
  function renderWeeklyCheck(c) {
    var el = $('#weekly-check');
    if (!c) { el.innerHTML = ''; return; }
    var rows = (c.missingDesigns || []).map(function (m) { return [m, 'Nincs a katalógusban']; })
      .concat((c.missingArtwork || []).map(function (m) { return [m, 'Nincs kép feltöltve']; }));
    if (c.missingArtwork === null) {
      el.innerHTML = '<p class="wcheck wcheck--warn">A képek listázása nem sikerült, ezért most nem tudni, melyik design képe hiányzik. Próbáld a Frissítéssel.</p>';
      return;
    }
    if (!rows.length) {
      el.innerHTML = '<p class="wcheck wcheck--ok">Képek rendben: mind a ' + c.designs + ' betervezett design képe fent van.</p>';
      return;
    }
    rows.sort(function (a, b) { return (a[0].week || 0) - (b[0].week || 0); });
    var d = (state.weekly.designs || {});
    el.innerHTML = '<p class="wcheck wcheck--warn">' + rows.length + ' betervezett design (' + c.designs + '-ből) nem jelenne meg rendesen: ' +
      'a telefonon üres keret lenne a helyén. Töltsd fel a képüket, majd Frissítés.</p>' +
      '<div class="table-wrap"><table class="table table--tight"><thead><tr><th>Hét</th><th>Design</th><th>Hiba</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var x = d[r[0].cardTypeId] || {};
        var name = x.playerName ? '<b>' + esc(x.playerName) + '</b> <span class="muted">' +
          esc((x.variant ? x.variant + ' · ' : '') + r[0].cardTypeId) + '</span>' : '<b>' + esc(r[0].cardTypeId) + '</b>';
        return '<tr><td>' + esc(r[0].week || '–') + '.</td><td>' + name + '</td><td>' + esc(r[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderWeekly() {
    var w = state.weekly;
    var s = w.season;
    renderWeeklyCheck(w.check);
    if (!s) {
      $('#weekly-season').textContent = 'Nincs beállított szezon (WEEKLY_SEASON_START üres).';
      ['#weekly-kpis', '#weekly-completion', '#weekly-daily', '#weekly-quests'].forEach(function (sel) { $(sel).innerHTML = ''; });
      $('#weekly-week').innerHTML = '';
      $('#weekly-meta').textContent = 'Frissítve: ' + formatDate(w.generatedAt);
      return;
    }
    $('#weekly-season').textContent = 'Szezon ' + s.seasonId + ' · ' + s.weeks + ' hét' +
      (s.startsAt ? ' · ' + formatDate(s.startsAt) + ' – ' + formatDate(s.endsAt) : '');

    var t = w.totals;
    var per = t.questsPerRespondent || {};
    var avg = t.respondents ? Object.keys(per).reduce(function (sum, k) { return sum + Number(k) * per[k]; }, 0) / t.respondents : null;
    $('#weekly-kpis').innerHTML = [
      ['Beküldött válasz', formatNum(t.answers), 'mind a ' + t.quests + ' quest együtt, törölt fiókokkal', true],
      ['Válaszadó', formatNum(t.respondents), 'legalább egy questre válaszolt (meglévő fiók)'],
      ['Mindet teljesítette', formatNum(t.completedAll), pctOf(t.completedAll, t.respondents) + '% a válaszadókból · +' +
        t.bonusPoints + ' bónusz fejenként'],
      ['Quest / válaszadó', formatAvg(avg), 'átlag, ' + t.quests + '-ből']
    ].map(kpiHtml).join('');

    var maxPer = Math.max.apply(null, Object.keys(per).map(function (k) { return per[k]; }).concat([1]));
    var crows = Object.keys(per).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) {
      return '<tr><td>' + esc(k) + ' / ' + t.quests + (Number(k) === t.quests ? ' <span class="muted">(bónusz)</span>' : '') +
        '</td><td class="num">' + formatNum(per[k]) + '</td><td class="wcol">' + barHtml(per[k], maxPer) + '</td></tr>';
    }).join('');
    $('#weekly-completion').innerHTML = '<thead><tr><th>Teljesített quest</th><th class="num">Válaszadó</th><th></th></tr></thead><tbody>' +
      (t.respondents ? crows : '<tr><td colspan="3" class="muted">Még senki nem válaszolt.</td></tr>') + '</tbody>';
    applyBars($('#weekly-completion'));

    var drows = w.daily.slice().reverse().map(function (d) {
      return '<tr><td>' + esc(d.date) + '</td><td class="num">' + formatNum(d.duel) + '</td><td class="num">' + formatNum(d.top3) +
        '</td><td class="num">' + formatNum(d.survey) + '</td><td class="num"><b>' + formatNum(d.duel + d.top3 + d.survey) + '</b></td></tr>';
    }).join('');
    $('#weekly-daily').innerHTML = '<thead><tr><th>Nap (UTC)</th><th class="num">Párbaj</th><th class="num">Top 3</th>' +
      '<th class="num">Kérdőív</th><th class="num">Összesen</th></tr></thead><tbody>' +
      (drows || '<tr><td colspan="5" class="muted">Még nincs válasz.</td></tr>') + '</tbody>';

    // Hétválasztó: alapból a legutóbb megnyílt hét.
    var sel = $('#weekly-week');
    var keep = sel.value;
    var current = 1;
    w.quests.forEach(function (q) { if (q.state !== 'locked' && q.week > current) current = q.week; });
    var opts = ['<option value="all">Minden hét</option>'];
    for (var i = 1; i <= s.weeks; i++) opts.push('<option value="' + i + '">' + i + '. hét</option>');
    sel.innerHTML = opts.join('');
    sel.value = keep && sel.querySelector('option[value="' + keep + '"]') ? keep : String(current);
    renderWeeklyQuests();
    $('#weekly-meta').textContent = 'Frissítve: ' + formatDate(w.generatedAt);
  }

  // A hétváltó a már letöltött adatból dolgozik, nem hív Lambdát.
  function renderWeeklyQuests() {
    if (!state.weekly || !state.weekly.season) return;
    var week = $('#weekly-week').value;
    var html = state.weekly.quests.filter(function (q) {
      return week === 'all' || String(q.week) === week;
    }).map(function (q) {
      var st = WEEKLY_STATES[q.state];
      var body = q.kind === 'duel' ? duelHtml(q) : q.kind === 'top3' ? top3Html(q) : surveyHtml(q);
      return '<article class="card wquest"><div class="wquest__head"><div><div class="wquest__kind">' + esc(WEEKLY_KINDS[q.kind]) +
        ' · ' + q.week + '. hét · ' + esc(q.questId) + '</div><h3>' + esc(WEEKLY_TITLES[q.questId] || q.questId) + '</h3></div>' +
        (st ? '<span class="badge ' + st[1] + '">' + esc(st[0]) + '</span>' : '') + '</div>' +
        '<p class="muted">' + formatNum(q.respondents) + ' válasz' +
        (q.storedAnswers !== q.respondents ? ' (ebből ' + formatNum(q.storedAnswers) + ' meglévő fióktól)' : '') +
        ' · +' + q.points + ' pont' + (q.opensAt ? ' · nyílt: ' + formatDate(q.opensAt) : '') + '</p>' + body + '</article>';
    }).join('');
    var root = $('#weekly-quests');
    root.innerHTML = html;
    applyBars(root);
  }

  function whyText(counts) {
    var parts = Object.keys(WEEKLY_WHY).filter(function (r) { return counts && counts[r]; }).map(function (r) {
      return WEEKLY_WHY[r] + ' ' + counts[r];
    });
    return parts.length ? parts.join(' · ') : '—';
  }
  function duelHtml(q) {
    var legend = '<p class="wlegend"><span class="wswatch wswatch--a"></span>A design <span class="wswatch wswatch--b"></span>B design</p>';
    return legend + q.pairs.map(function (p, i) {
      var voted = p.votesA + p.votesB;
      var pa = pctOf(p.votesA, voted);
      var pb = voted ? 100 - pa : 0;
      var tip = 'A: ' + p.votesA + ' · B: ' + p.votesB + ' · kihagyta: ' + p.skipped;
      return '<div class="wpair"><div class="wpair__title">' + (i + 1) + '. pár</div>' +
        '<div class="wpair__sides"><div>' + designHtml(p.a) + '<div class="wpair__num">A · <b>' + formatNum(p.votesA) + '</b> szavazat' +
        (voted ? ' · ' + pa + '%' : '') + '</div><div class="muted wsmall">Miért: ' + esc(whyText(p.whyBySide && p.whyBySide.a)) + '</div></div>' +
        '<div>' + designHtml(p.b) + '<div class="wpair__num">B · <b>' + formatNum(p.votesB) + '</b> szavazat' +
        (voted ? ' · ' + pb + '%' : '') + '</div><div class="muted wsmall">Miért: ' + esc(whyText(p.whyBySide && p.whyBySide.b)) + '</div></div></div>' +
        '<div class="wsplit" title="' + esc(tip) + '" role="img" aria-label="' + esc(tip) + '">' +
        (voted ? '<span class="wsplit__a" data-w="' + pa + '"></span><span class="wsplit__b" data-w="' + pb + '"></span>' : '') + '</div>' +
        '<div class="muted wsmall">Nem tudott dönteni: ' + formatNum(p.skipped) + ' · „Miért” összesen (névtelen összesítő): ' + esc(whyText(p.why)) + '</div></div>';
    }).join('');
  }
  function top3Html(q) {
    var max = Math.max.apply(null, q.options.map(function (o) { return o.score; }).concat([1]));
    var rows = q.options.map(function (o, i) {
      return '<tr><td class="num">' + (i + 1) + '.</td><td>' + designHtml(o.cardTypeId) + '</td><td class="num"><b>' + formatNum(o.score) +
        '</b></td><td class="wcol" title="' + esc(designName(o.cardTypeId) + ': ' + o.score + ' pont') + '">' + barHtml(o.score, max) +
        '</td><td class="num">' + formatNum(o.first) + '</td><td class="num">' + o.places.map(formatNum).join(' / ') + '</td></tr>';
    }).join('');
    return '<div class="table-wrap"><table class="table"><thead><tr><th class="num">#</th><th>Design</th><th class="num">Pont</th><th></th>' +
      '<th class="num">Első hely</th><th class="num">1. / 2. / 3.</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted wsmall">Pont: 1. hely 3, 2. hely 2, 3. hely 1. Az „1. / 2. / 3.” oszlop a meglévő fiókok válaszaiból számol.</p>';
  }
  function surveyHtml(q) {
    return q.questions.map(function (item, i) {
      var label = WEEKLY_QUESTIONS[item.id] || { prompt: item.id };
      var head = '<div class="wq__prompt">' + (i + 1) + '. ' + esc(label.prompt) + (item.required ? '' : ' <span class="muted">(nem kötelező)</span>') + '</div>';
      if (item.type === 'text') {
        var texts = item.texts || [];
        return '<div class="wq">' + head + (texts.length
          ? '<ul class="wtexts">' + texts.map(function (x) {
            return '<li><span class="muted wsmall">' + formatDate(x.at) + '</span><br>' + esc(x.text) + '</li>';
          }).join('') + '</ul>'
          : '<p class="muted">Még nincs szöveges válasz.</p>') + '</div>';
      }
      var keys = Object.keys(item.distribution).sort(function (a, b) { return Number(a) - Number(b); });
      var max = Math.max.apply(null, keys.map(function (k) { return item.distribution[k]; }).concat([1]));
      var rows = keys.map(function (k, j) {
        var name = item.type === 'scale'
          ? k + (j === 0 && label.scale ? ' — ' + label.scale[0] : j === keys.length - 1 && label.scale ? ' — ' + label.scale[1] : '')
          : (label.options && label.options[Number(k)]) || ('#' + k);
        var n = item.distribution[k];
        return '<tr><td>' + esc(name) + '</td><td class="num">' + formatNum(n) + '</td><td class="num">' + pctOf(n, item.answered) +
          '%</td><td class="wcol" title="' + esc(name + ': ' + n) + '">' + barHtml(n, max) + '</td></tr>';
      }).join('');
      return '<div class="wq">' + head + '<p class="muted wsmall">' + formatNum(item.answered) + ' válasz' +
        (item.type === 'scale' ? ' · átlag: ' + (item.average == null ? '—' : formatAvg(item.average)) + ' / 5' : '') + '</p>' +
        '<div class="table-wrap"><table class="table table--tight"><tbody>' + rows + '</tbody></table></div></div>';
    }).join('');
  }

  // CSV: minden válasz soronként (válaszadó-álnév, quest, mező, érték). UTF-8 BOM-mal, hogy az
  // Excel ékezethelyesen nyissa; a Blob típusában is kimondva a kódolás.
  function exportWeeklyCsv() {
    var btn = $('#weekly-export');
    busy(btn, true);
    api('weeklyQuestStats', { export: true }).then(function (w) {
      if (!w.season) { toast('Nincs beállított szezon.'); return; }
      state.weekly = w;
      renderWeekly();
      var cols = ['respondent', 'seasonId', 'week', 'questId', 'kind', 'submittedAt', 'field', 'value', 'label', 'design', 'designName', 'detail'];
      var lines = [cols.join(';')].concat((w.export || []).map(function (r) {
        var label = '';
        var qd = WEEKLY_QUESTIONS[r.field];
        if (r.kind === 'survey' && qd && qd.options) label = qd.options[Number(r.value)] || '';
        else if (r.kind === 'duel') label = r.value === 'skip' ? 'kihagyta' : r.value.toUpperCase() + ' design';
        else if (r.kind === 'top3') label = r.value + '. hely';
        var row = Object.assign({}, r, {
          label: label,
          designName: r.design ? designName(r.design) : '',
          detail: r.kind === 'duel' && r.detail ? r.detail.split(' ').map(function (x) { return WEEKLY_WHY[x] || x; }).join(', ') : r.detail
        });
        return cols.map(function (c) { return csvCell(row[c]); }).join(';');
      }));
      var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'heti-questek-' + w.season.seasonId + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast((w.export || []).length + ' sor letöltve.');
    }).catch(function (e) {
      toast(e.message);
    }).then(function () { busy(btn, false); });
  }
  // Pontosvessző az elválasztó (a magyar Excel ezt várja); idézőjel, ha kell. A '=+-@'
  // kezdetű cellát aposztróffal semlegesítjük, hogy a szabad szöveg ne fusson képletként.
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---------- szállító + feladási folyamat (2026-10-17) ----------
  // A backend (admin_handler _carrier / _fulfillment) adja: carrier = foxpost | gls | null,
  // fulfillment csak fizetett rendelésnél. Foxpost: címke API-n → kinyomtatva → feladva
  // (kézi jelölés); GLS: GLS-be felvinni → felvive (kézi pipa).
  var FULFILLMENT = {
    label_ready: { text: 'Nyomtatásra vár', cls: 's-pending_payment' },
    label_failed: { text: 'Címke hiba', cls: 's-failed' },
    printed: { text: 'Kinyomtatva', cls: 's-refunded' },
    handed_over: { text: 'Feladva', cls: 's-paid' },
    gls_todo: { text: 'GLS-be felvinni', cls: 's-pending_payment' },
    gls_entered: { text: 'GLS-ben felvive', cls: 's-paid' }
  };
  function fulfillmentBadge(value) {
    var f = FULFILLMENT[value];
    return f ? '<span class="badge ' + f.cls + '">' + esc(f.text) + '</span>' : '<span class="muted">—</span>';
  }
  function carrierText(o) {
    if (!o.carrier) return '<span class="muted">—</span>';
    var mode = o.shippingMethod === 'home_delivery' ? 'házhoz' : (o.carrier === 'gls' ? 'csomagpont' : 'automata');
    return '<b>' + (o.carrier === 'gls' ? 'GLS' : 'Foxpost') + '</b><br><span class="muted">' + mode + '</span>';
  }

  // A pipák állapotából a következő tárolt lépés (fulfillmentStep); null = visszavonás.
  function nextStep(o, step, checked) {
    if (o.carrier === 'gls') return checked ? 'entered' : null;
    if (step === 'printed') return checked ? 'printed' : null;
    return checked ? 'handed_over' : 'printed';
  }

  function renderFulfillment(o) {
    if (!o.fulfillment) return '';
    var f = o.fulfillment;
    var boxes;
    if (o.carrier === 'gls') {
      boxes = checkbox('entered', 'Felvittem a GLS felületén (feladás kész)', f === 'gls_entered', false);
    } else {
      var noLabel = f === 'label_failed';
      boxes =
        '<p class="muted">' + (noLabel
          ? 'A Foxpost címke nem jött létre — vidd fel kézzel a Foxpost ügyfélportálon.'
          : 'Címke létrehozva (API): ' + esc(o.foxpostTrackingNumber || '') + ' · méret: XS') + '</p>' +
        checkbox('printed', 'Kinyomtatva', f === 'printed' || f === 'handed_over', noLabel) +
        checkbox('handed_over', 'Feladva (automatában / csomagponton leadva)', f === 'handed_over', noLabel);
    }
    return '<div class="section fulfillment"><h3>Feladás — ' + (o.carrier === 'gls' ? 'GLS (kézi)' : 'Foxpost') + ' ' +
      fulfillmentBadge(f) + '</h3>' + boxes +
      (o.fulfillmentAt ? '<p class="muted">Utoljára módosítva: ' + formatDate(o.fulfillmentAt) + '</p>' : '') + '</div>';
  }
  function checkbox(step, label, checked, disabled) {
    return '<label class="check"><input type="checkbox" data-step="' + step + '"' + (checked ? ' checked' : '') +
      (disabled ? ' disabled' : '') + '> ' + esc(label) + '</label>';
  }

  function onFulfillmentChange(ev) {
    var input = ev.target.closest('input[data-step]');
    if (!input) return;
    var o = state.order;
    var operator = '';
    try { operator = localStorage.getItem(OPERATOR_KEY) || ''; } catch (e) { /* nincs tároló */ }
    if (!operator) {
      operator = (window.prompt('Operátor neve (a naplóba kerül):') || '').trim();
      if (!operator) { input.checked = !input.checked; return; }
      try { localStorage.setItem(OPERATOR_KEY, operator); } catch (e) { /* csak most */ }
    }
    var boxes = document.querySelectorAll('#order-body input[data-step]');
    Array.prototype.forEach.call(boxes, function (b) { b.disabled = true; });
    api('setFulfillment', { orderId: o.orderId, step: nextStep(o, input.dataset.step, input.checked), operator: operator })
      .then(function (data) {
        renderOrder(data.order);
        toast('Feladási állapot: ' + (FULFILLMENT[data.order.fulfillment] || {}).text);
        if (!$('#view-orders').hidden) loadOrders();
      }).catch(function (e) {
        toast(e.message);
        api('getOrder', { orderId: o.orderId }).then(function (d) { renderOrder(d.order); }).catch(function () {});
      });
  }

  function loadOrders() {
    var f = $('#order-filters');
    $('#orders-table').innerHTML = '<tbody><tr><td class="muted">Betöltés…</td></tr></tbody>';
    api('listOrders', {
      status: f.status.value, content: f.content.value, carrier: f.carrier.value,
      fulfillment: f.fulfillment.value, q: f.q.value
    }).then(function (data) {
      var rows = data.orders.map(function (o) {
        return '<tr tabindex="0" data-id="' + esc(o.orderId) + '">' +
          '<td><b>' + esc(o.orderNumber || o.orderId) + '</b></td>' +
          '<td>' + formatDate(o.createdAt) + '</td>' +
          '<td>' + esc(o.customerName || '') + '<br><span class="muted">' + esc(o.customerEmail || '') + '</span></td>' +
          '<td>' + compositionHtml(o.composition, o.packsReserved) + '</td>' +
          '<td class="num">' + formatHuf(o.totalCents) + '</td>' +
          '<td>' + badge(o.status) + '</td>' +
          '<td>' + carrierText(o) + '</td>' +
          '<td>' + fulfillmentBadge(o.fulfillment) + '</td>' +
          '<td>' + badge(o.invoiceStatus) + '</td>' +
          '<td>' + (o.auctionId ? 'aukció' : esc(o.channel || 'app')) + '</td></tr>';
      }).join('');
      $('#orders-table').innerHTML = '<thead><tr><th>Rendelés</th><th>Dátum</th><th>Vevő</th><th>Tartalom</th><th class="num">Összeg</th><th>Státusz</th><th>Szállító</th><th>Feladás</th><th>Számla</th><th>Csatorna</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="10" class="muted">Nincs találat.</td></tr>') + '</tbody>';
      $('#orders-meta').textContent = data.orders.length + ' / ' + data.total + ' rendelés';
    }).catch(function (e) {
      $('#orders-table').innerHTML = '<tbody><tr><td class="error">' + esc(e.message) + '</td></tr></tbody>';
    });
  }

  // ---------- V2 gyűjtemény ----------
  // Fő bontás: legalább egyszer beolvasott (van claim-sora) vs. még soha. Külön kategória
  // ezen belül a kivett / törölt fiókos: a kivett kártya a beolvasás alapján továbbra is az
  // utolsó ismert tulajé (pontostul); a törölt fiókosé is kihúzott marad — egyiket sem
  // igényelheti más (termékdöntés 2026-10-04). A törölt user kártyái a véletlen
  // formerOwnerRef alapján együtt látszanak ("törölt fiók #ref"), név nélkül.
  var CLAIM_STATES = { inCollection: 'Gyűjteményben', removed: 'Kivette', released: 'Fiók törölve' };
  function pct(n) {
    return n == null ? '—' : Number(n).toLocaleString('hu-HU', { maximumFractionDigits: 1 }) + '%';
  }
  function tierText(c) {
    return esc([c.tier, c.variant].filter(Boolean).join(' · '));
  }

  function loadCollection() {
    $('#scan-kpis').innerHTML = '<p class="muted">Betöltés…</p>';
    api('collectionStats').then(function (c) {
      var scans = c.scans || {};
      var t = scans.totals || {};
      var scanKpis = [
        ['Hitelesítési kísérlet', formatNum(t.attempts), 'kamerás beolvasás eredménnyel (sikeres + sikertelen)', true],
        ['Sikeres', formatNum(t.authenticated), pct(t.successPct) + ' a kísérletekből — a kód a mi nyomtatott kártyánk'],
        ['Sikertelen', formatNum(t.failed), pct(t.failedPct) + ' a kísérletekből'],
        ['Ismeretlen kód', formatNum(t.notFound), pct(t.notFoundPct) + ' a kísérletekből — olvasható, de nem a mi kártyánk'],
        ['SDK nem tudta hitelesíteni', formatNum(t.sdkFailed), pct(t.sdkFailedPct) + ' a kísérletekből']
      ];
      $('#scan-kpis').innerHTML = scanKpis.map(kpiHtml).join('');
      var drows = (scans.days || []).slice(0, 30).map(function (d) {
        return '<tr><td>' + esc(d.day) + '</td><td class="num">' + formatNum(d.attempts) +
          '</td><td class="num">' + formatNum(d.authenticated) + ' (' + pct(d.successPct) + ')' +
          '</td><td class="num">' + formatNum(d.notFound) + ' (' + pct(d.notFoundPct) + ')' +
          '</td><td class="num">' + formatNum(d.sdkFailed) + ' (' + pct(d.sdkFailedPct) + ')</td></tr>';
      }).join('');
      $('#scan-days').innerHTML = '<thead><tr><th>Nap (UTC)</th><th class="num">Kísérlet</th><th class="num">Sikeres</th><th class="num">Ismeretlen kód</th>' +
        '<th class="num">SDK hiba</th></tr></thead><tbody>' +
        (drows || '<tr><td colspan="5" class="muted">Még nem volt beolvasás.</td></tr>') + '</tbody>';

      var u = c.users || {};
      var colKpis = [
        ['Nyomtatott kártyák', formatNum(c.printed), 'minden példány (cardprime-card-skus)', true],
        ['Legalább egyszer beolvasott', formatNum(c.scanned), pct(c.scannedPct)],
        ['Még nem beolvasott', formatNum(c.unscanned), pct(c.scannedPct == null ? null : 100 - c.scannedPct)],
        ['Gyűjteményben', formatNum(c.inCollection), 'beolvasott, most is valakinek a gyűjteményében'],
        ['Kivett / törölt fiók', formatNum(c.notInCollection), 'kivette, de az övé maradt: ' + formatNum(c.removed) + ' · fiók törölve: ' + formatNum(c.released) + ' (' + formatNum(c.deletedOwners || 0) + ' volt user)'],
        ['Gyűjtők', formatNum(c.collectors), 'akiknek most legalább 1 kártya van a gyűjteményükben'],
        ['Kártya / gyűjtő', formatAvg(c.avgCardsPerCollector), 'átlag · legtöbb: ' + formatNum(c.maxCardsPerCollector)],
        ['Kártya / felhasználó', formatAvg(c.avgCardsPerUser), 'átlag az összes megerősített felhasználóra (' + formatNum(u.confirmed) + ')']
      ];
      $('#collection-kpis').innerHTML = colKpis.map(kpiHtml).join('');
      var rows = (c.designs || []).map(function (d) {
        return '<tr><td><code>' + esc(d.cardTypeId) + '</code></td><td>' + esc(d.playerName || '') + '</td><td>' + tierText(d) +
          '</td><td class="num">' + formatNum(d.printed) + '</td><td class="num">' + formatNum(d.scanned) + '</td><td class="num">' + share(d.scanned, d.printed) + '</td></tr>';
      }).join('');
      $('#design-table').innerHTML = '<thead><tr><th>Dizájn</th><th>Játékos</th><th>Tier</th><th class="num">Nyomtatva</th><th class="num">Beolvasva</th><th class="num">Arány</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="6" class="muted">Nincs nyomtatott kártya a táblában.</td></tr>') + '</tbody>';
      $('#collection-meta').textContent = 'Frissítve: ' + formatDate(c.generatedAt);
    }).catch(function (e) {
      $('#scan-kpis').innerHTML = '<p class="error">' + esc(e.message) + '</p>';
    });

    $('#leaderboard-table').innerHTML = '<tbody><tr><td class="muted">Betöltés…</td></tr></tbody>';
    api('leaderboard', { limit: 100 }).then(function (data) {
      var rows = data.entries.map(function (e) {
        return '<tr><td class="num">' + esc(e.rank) + '.</td><td>' + esc(e.name) + '<br><span class="muted">' + esc(e.publicId || '') +
          '</span></td><td class="num">' + formatNum(e.score) + '</td><td class="num">' + formatNum(e.cards) + '</td></tr>';
      }).join('');
      $('#leaderboard-table').innerHTML = '<thead><tr><th class="num">Hely</th><th>Gyűjtő</th><th class="num">Pont</th><th class="num">Kártya</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="4" class="muted">Még senki nincs a ranglistán.</td></tr>') + '</tbody>';
    }).catch(function (e) {
      $('#leaderboard-table').innerHTML = '<tbody><tr><td class="error">' + esc(e.message) + '</td></tr></tbody>';
    });

    loadCards();
  }

  function loadCards() {
    var f = $('#card-filters');
    var scanned = f.state.value !== 'unscanned';
    $('#cards-table').innerHTML = '<tbody><tr><td class="muted">Betöltés…</td></tr></tbody>';
    $('#cards-meta').textContent = '';
    api('listCards', { state: f.state.value, q: f.q.value, limit: 500 }).then(function (data) {
      var rows = data.cards.map(function (c) {
        return '<tr tabindex="0" data-sku="' + esc(c.sku) + '"><td><code>' + esc(c.sku) + '</code></td><td>' + esc(c.playerName || '') + '</td><td>' + tierText(c) +
          '</td><td class="num">' + formatNum(c.points) + '</td>' +
          (scanned ? '<td>' + esc(CLAIM_STATES[c.state] || c.state) + (c.leftAt ? '<br><span class="muted">' + formatDate(c.leftAt) + '</span>' : '') +
            '</td><td>' + (c.owner ? esc(c.owner) : '<span class="muted">törölt fiók' + (c.formerOwnerRef ? ' #' + esc(c.formerOwnerRef) : '') + '</span>') + '</td><td>' + formatDate(c.claimedAt) + '</td>' : '') + '</tr>';
      }).join('');
      $('#cards-table').innerHTML = '<thead><tr><th>SKU</th><th>Játékos</th><th>Tier</th><th class="num">Pont</th>' +
        (scanned ? '<th>Állapot</th><th>Tulaj / utolsó ismert tulaj</th><th>Beolvasva</th>' : '') + '</tr></thead><tbody>' +
        (rows || '<tr><td colspan="7" class="muted">Nincs találat.</td></tr>') + '</tbody>';
      $('#cards-meta').textContent = data.cards.length + ' / ' + data.total + ' kártya';
    }).catch(function (e) {
      $('#cards-table').innerHTML = '<tbody><tr><td class="error">' + esc(e.message) + '</td></tr></tbody>';
    });
  }

  // ---------- kártya-előzmény ----------
  // Egy nyomtatott példány teljes története: tulajdonosi események (cardprime-v2-ownership-
  // events) és minden beolvasási kísérlet (cardprime-v2-scan-events), időkorlát nélkül
  // megőrizve (termékdöntés 2026-10-06). Törölt fióknál csak az álnév (#ref) látszik.
  var OWNERSHIP_EVENTS = {
    claimed: ['Gyűjteménybe vette (első beolvasó)', 's-paid'],
    removed: ['Kivette a gyűjteményből', 's-pending_payment'],
    restored: ['Visszatette a gyűjteményébe', 's-paid'],
    released: ['Fiók törölve', 's-refunded']
  };
  var SCAN_RESULTS = {
    authenticated: ['Sikeres', 's-paid'],
    notFound: ['Ismeretlen kód', 's-failed'],
    sdkFailed: ['SDK hiba', 's-failed']
  };

  function whoHtml(w) {
    if (!w) return '—';
    if (w.name) return esc(w.name) + (w.publicId ? ' <span class="muted">' + esc(w.publicId) + '</span>' : '');
    return '<span class="muted">törölt fiók' + (w.formerOwnerRef ? ' #' + esc(w.formerOwnerRef) : '') + '</span>';
  }
  function labelBadge(map, key) {
    var m = map[key] || [key, ''];
    return '<span class="badge ' + m[1] + '">' + esc(m[0]) + '</span>';
  }
  function placeText(s) {
    if (s.lat == null || s.lng == null) return '<span class="muted">nincs (nem engedélyezte)</span>';
    return esc(Number(s.lat).toFixed(2) + ', ' + Number(s.lng).toFixed(2));
  }

  function openCard(sku) {
    $('#card-title').textContent = sku;
    $('#card-body').innerHTML = '<p class="muted">Betöltés…</p>';
    var dlg = $('#card-dialog');
    if (!dlg.open) dlg.showModal();
    api('cardHistory', { sku: sku }).then(renderCard)
      .catch(function (e) { $('#card-body').innerHTML = '<p class="error">' + esc(e.message) + '</p>'; });
  }

  function renderCard(h) {
    $('#card-title').textContent = h.sku;
    var c = h.card || {};
    var cur = h.current;
    var own = (h.ownership || []).map(function (e) {
      return '<li>' + labelBadge(OWNERSHIP_EVENTS, e.event) + ' · ' + formatDate(e.at) + '<br>' + whoHtml(e.who) + '</li>';
    }).join('');
    var scans = (h.scans || []).map(function (s) {
      return '<tr><td>' + formatDate(s.at) + '</td><td>' + whoHtml(s.who) + '</td><td>' + labelBadge(SCAN_RESULTS, s.result) +
        (s.geoVelocityAlert ? ' <span class="badge s-failed" title="Ugyanez a példány túl gyorsan, túl messze is beolvasva (>200 km/h, 30 percen belül)">helyjelzés</span>' : '') +
        '</td><td>' + placeText(s) + '</td></tr>';
    }).join('');
    var alerts = (h.scans || []).filter(function (s) { return s.geoVelocityAlert; }).length;

    $('#card-body').innerHTML =
      kv([
        ['Játékos', c.playerName],
        ['Dizájn', c.cardTypeId],
        ['Tier', [c.tier, c.variant].filter(Boolean).join(' · ')],
        ['Pont', c.points],
        ['Mesteradat', h.card ? 'van' : 'NINCS — ez a kód nem a mi nyomtatott kártyánk']
      ]) +
      '<div class="section"><h3>Jelenlegi állapot</h3>' + (cur ? kv([
        ['Állapot', CLAIM_STATES[cur.state] || cur.state],
        ['Tulaj / utolsó ismert tulaj', whoHtml(cur.owner), true],
        ['Első beolvasás (igénylés)', formatDate(cur.claimedAt), true],
        ['Kikerült a gyűjteményből', cur.leftAt ? formatDate(cur.leftAt) : '—', true],
        ['Kapott pont', cur.pointsAwarded]
      ]) : '<p class="muted">Még senki nem vette gyűjteményébe.</p>') + '</div>' +
      '<div class="section"><h3>Tulajdonosi történet</h3>' +
        (h.ownershipDerived ? '<p class="muted">A tulajdonosi napló előtti kártya: a történet a jelenlegi állapotból van visszaállítva, a korábbi kivétel/visszatétel nem látszik.</p>' : '') +
        (own ? '<ul class="log">' + own + '</ul>' : '<p class="muted">Nincs tulajdonosi esemény.</p>') + '</div>' +
      '<div class="section"><h3>Beolvasási történet</h3>' +
        '<p class="muted">' + formatNum((h.scans || []).length) + ' beolvasás' + (h.scansTruncated ? ' (a legutóbbiak)' : '') +
        (alerts ? ' · <b>' + formatNum(alerts) + ' helyjelzés</b>' : '') + '. Hely: kb. 1 km pontosság.</p>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Időpont</th><th>Ki olvasta be</th><th>Eredmény</th><th>Hely (kb.)</th></tr></thead><tbody>' +
        (scans || '<tr><td colspan="4" class="muted">Nincs beolvasás.</td></tr>') + '</tbody></table></div></div>' +
      '<p class="muted">Frissítve: ' + formatDate(h.generatedAt) + '</p>';
  }

  // ---------- rendelés-részletek ----------
  function openOrder(orderId) {
    $('#order-body').innerHTML = '<p class="muted">Betöltés…</p>';
    $('#order-actions').innerHTML = '';
    $('#action-form').hidden = true;
    var dlg = $('#order-dialog');
    if (!dlg.open) dlg.showModal();
    api('getOrder', { orderId: orderId }).then(function (data) { renderOrder(data.order); })
      .catch(function (e) { $('#order-body').innerHTML = '<p class="error">' + esc(e.message) + '</p>'; });
  }

  function kv(pairs) {
    return '<dl class="kv">' + pairs.map(function (p) {
      return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1] == null || p[1] === '' ? '—' : p[1])) + '</dd>';
    }).join('') + '</dl>';
  }

  function addressText(a) {
    return [a.postalCode, a.city, [a.line1, a.houseNumber].filter(Boolean).join(' '), a.line2, a.country].filter(Boolean).join(', ');
  }

  // ---------- GLS export (kézi feladás, 2026-10-17; Lotte Kft. díjak 2026-11-02) ----------
  // A GLS-nek nincs API-ja a mi esetünkben: a külföldi (EU) házhoz rendeléseket kézzel kell
  // felvinni a GLS felületére. A zónák és a díjak a Lotte Kft. (GLS szerződött partner)
  // 2026-10-27-i export ajánlatából jönnek, 0–2 kg, pótdíjakkal, bruttó — ugyanazok, mint
  // a backend shipping_fees.py-ban. Ez a fájl nyilvános: a nettó beszerzési ár NEM kerül ide.
  var GLS_ZONES = {
    SK: { label: 'Kedvezményes zóna', fee: 4770, countries: { SK: 'Szlovákia' } },
    1: { label: '1. zóna', fee: 8780, countries: { AT: 'Ausztria', CZ: 'Csehország', HR: 'Horvátország', RO: 'Románia', SI: 'Szlovénia' } },
    2: { label: '2. zóna', fee: 12280, countries: { BE: 'Belgium', DE: 'Németország', LU: 'Luxemburg', NL: 'Hollandia', PL: 'Lengyelország' } },
    3: { label: '3. zóna', fee: 13000, countries: { DK: 'Dánia', FR: 'Franciaország', IT: 'Olaszország' } },
    4: { label: '4. zóna', fee: 26910, countries: { FI: 'Finnország', SE: 'Svédország' } }
  };
  function glsZone(country) {
    for (var z in GLS_ZONES) {
      if (GLS_ZONES[z].countries[country]) return { name: GLS_ZONES[z].countries[country], zone: GLS_ZONES[z] };
    }
    return null;
  }
  function isGlsOrder(o) {
    return o.shippingMethod === 'gls_locker' || (o.shippingMethod === 'home_delivery' && o.homeCarrier === 'gls');
  }
  function forintText(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';
  }

  function renderGlsExport(o) {
    var a = o.deliveryAddress || o.shippingAddress || {};
    var z = glsZone(a.country);
    var countryText = z ? z.name + ' (' + a.country + ')' : (a.countryName || a.country || '');
    // A feladáshoz kellő adatok; minden sor külön másolható.
    var fields = [
      ['Címzett neve', o.customerName],
      ['Telefon', o.customerPhone],
      ['E-mail', o.customerEmail],
      ['Ország', countryText],
      ['Irányítószám', a.postalCode],
      ['Település', a.city],
      ['Utca', a.line1],
      ['Házszám', a.houseNumber],
      ['Emelet, ajtó, egyéb', a.line2],
      ['Hivatkozás (rendelésszám)', o.orderNumber || o.orderId]
    ];
    var all = fields.filter(function (f) { return f[1]; }).map(function (f) { return f[0] + ': ' + f[1]; }).join('\n');
    var rows = fields.map(function (f) {
      var v = f[1];
      return '<dt>' + esc(f[0]) + '</dt><dd class="copy-row">' +
        (v ? '<span class="copy-val">' + esc(v) + '</span>' +
          '<button type="button" class="copy-btn" data-copy="' + esc(v) + '" aria-label="' + esc('Másolás: ' + f[0]) + '">Másol</button>'
          : '<span class="muted">—</span>') +
        '</dd>';
    }).join('');

    var warn = '';
    if (o.shippingMethod === 'gls_locker') {
      warn = '<p class="ecsomag-warn">Régi GLS csomagpontos rendelés (' + esc(o.glsPointName || '') + ' ' + esc(o.glsPointId || '') +
        ') — ilyet már nem kínálunk, egyeztess a vevővel.</p>';
    } else if (!z) {
      warn = '<p class="ecsomag-warn">Ebbe az országba (' + esc(a.country || '?') + ') a GLS-ajánlatban nincs díj — egyeztess a vevővel, vagy sztornózd.</p>';
    }
    var cost = z
      ? kv([
        ['Zóna', z.zone.label],
        ['Díjlista szerint', forintText(z.zone.fee) + ' bruttó (0–2 kg, Euro Business, pótdíjakkal; 681 Ft/l gázolajjal számolva)'],
        ['A vevő fizetett', formatHuf(o.shippingFeeCents), true]
      ])
      : '';

    return '<div class="section ecsomag"><h3>GLS — export feladás</h3>' +
      '<p class="muted">Feladás kézzel, a GLS felületén. ' +
      'Állapot: ' + badge(o.glsLabelStatus) + '</p>' + warn +
      '<dl class="kv">' + rows + '</dl>' +
      '<div class="ecsomag-tools"><button type="button" class="btn btn--ghost copy-btn" data-copy="' + esc(all) + '">Összes adat másolása</button></div>' +
      cost + '</div>';
  }

  // Vágólap: a Clipboard API csak biztonságos (https) környezetben él; helyben a régi úton.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* lent kezeljük */ }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  function renderOrder(o) {
    state.order = o;
    $('#order-title').textContent = o.orderNumber || o.orderId;
    var addr = o.shippingAddress || {};
    var items = (o.items || []).map(function (i) {
      var kind = i.packId === 'shipping' ? '' : (Number(i.packCount) > 1 ? ' — doboz, ' + esc(i.packCount) + ' tasak' : ' — önálló tasak');
      return esc(i.quantity) + ' × ' + esc(i.packName || i.packId) + kind + ' (' + formatHuf(i.priceCentsAtPurchase) + ' / db)';
    }).join('<br>');
    var log = (o.adminLog || []).slice().reverse().map(function (l) {
      return '<li><b>' + esc(l.action) + '</b> · ' + formatDate(l.at) + ' · ' + esc(l.operator) +
        '<br>' + esc(l.reason) + (l.result ? '<br><span class="muted">' + esc(l.result) + '</span>' : '') + '</li>';
    }).join('');

    $('#order-body').innerHTML =
      kv([
        ['Státusz', badge(o.status) + (o.reversalTarget ? ' → ' + badge(o.reversalTarget) : ''), true],
        ['Order ID', o.orderId],
        ['Létrehozva', formatDate(o.createdAt), true],
        ['Frissítve', formatDate(o.updatedAt), true],
        ['Csatorna', o.auctionId ? 'aukció (' + o.auctionId + ')' : (o.channel || 'app')],
        ['Összeg', formatHuf(o.totalCents), true],
        ['Tartalom', compositionText(o.composition)],
        ['Készletből levonva', o.packsReserved != null ? o.packsReserved + ' tasak' : null],
        ['Visszavett tasak', o.restockedPacks]
      ]) +
      '<div class="section"><h3>Vevő</h3>' + kv([
        ['Név', o.customerName], ['E-mail', o.customerEmail], ['Telefon', o.customerPhone],
        // A házszám 2026-10-06 óta külön mező (a MyGLS csak számot fogad el); régi rendelésnél nincs.
        [o.deliveryAddress ? 'Számlázási cím' : 'Cím', addressText(addr)],
        // Eltérő házhoz szállítási cím (2026-10-09 óta); hiánya = a számlázási címre megy.
        o.deliveryAddress ? ['Szállítási cím', addressText(o.deliveryAddress)] : null,
        ['Szállítás', o.shippingMethod +
          // Házhozszállításnál a választott szállító; régi rendelésnél nincs → Foxpost.
          (o.shippingMethod === 'home_delivery' ? ' — ' + (o.homeCarrier === 'gls' ? 'GLS' : 'Foxpost') : '') +
          (o.foxpostLockerName ? ' — ' + o.foxpostLockerName : '') +
          (o.glsPointName ? ' — ' + o.glsPointName + (o.glsPointId ? ' (' + o.glsPointId + ')' : '') : '')],
        ['Tételek', items || '—', true]
      ].filter(Boolean)) + '</div>' +
      renderFulfillment(o) +
      (isGlsOrder(o) ? renderGlsExport(o) : '') +
      '<div class="section"><h3>Szolgáltatók</h3>' + kv([
        ['Stripe fizetés', o.stripePaymentIntentId],
        ['Stripe visszatérítés', o.stripeRefundId],
        ['Számla (Számlázz.hu)', badge(o.invoiceStatus) + ' ' + esc(o.invoiceNumber || ''), true],
        ['Sztornó számla', badge(o.stornoInvoiceStatus) + ' ' + esc(o.stornoInvoiceNumber || ''), true],
        ['Foxpost címke', badge(o.foxpostLabelStatus) + ' ' + esc(o.foxpostTrackingNumber || ''), true],
        ['GLS (export, kézi)', badge(o.glsLabelStatus) + ' ' + esc(o.glsParcelId || ''), true],
        ['Szállító lemondás', badge(o.carrierCancelStatus), true],
        ['Visszaigazoló e-mail', badge(o.confirmationEmailStatus), true]
      ]) + '</div>' +
      (log ? '<div class="section"><h3>Admin napló</h3><ul class="log">' + log + '</ul></div>' : '');

    renderActions(o);
  }

  var ACTIONS = {
    refundOrder: {
      label: 'Visszatérítés (refund)', cls: 'btn--danger', restock: false, cancelCarrier: false,
      title: 'Visszatérítés',
      desc: 'Valódi vásárlás visszafordítása, akár már kézbesített csomagnál is. Stripe: teljes összeg vissza a vevőnek → Számlázz.hu: sztornó számla → szállító: a csomagot csak akkor törli, ha bejelölöd. Státusz: refunded.'
    },
    stornoPaid: {
      api: 'stornoOrder', label: 'Sztornó (hibás / teszt)', cls: 'btn--warn', restock: null, cancelCarrier: true,
      title: 'Sztornó — fizetett rendelés',
      desc: 'Hibás vagy teszt vásárlás érvénytelenítése. Stripe: pénz vissza → Számlázz.hu: sztornó számla → szállító: a csomag törlése API-n. A tasakok mindig visszakerülnek a készletbe (bontatlanok, újra eladhatók). Státusz: cancelled.'
    },
    stornoUnpaid: {
      api: 'stornoOrder', label: 'Sztornó (fizetés lezárása)', cls: 'btn--warn', restock: null,
      title: 'Sztornó — fizetetlen rendelés',
      desc: 'A Stripe fizetési oldal lezárul (a vevő már nem tud fizetni), a lefoglalt tasakok visszakerülnek a készletbe. Számla és szállító felé nincs teendő. Státusz: cancelled.'
    },
    retryStorno: {
      label: 'Sztornó számla újra', cls: 'btn--ghost', restock: null,
      title: 'Sztornó számla újrapróbálása',
      desc: 'Csak a Számlázz.hu sztornó számlát próbálja újra kiállítani. Pénzmozgás nincs.'
    },
    cancelCarrier: {
      label: 'Csomag törlése a szállítónál', cls: 'btn--ghost', restock: null,
      title: 'Szállító — csomag törlése API-n',
      desc: 'Újra megpróbálja törölni a csomagot a Foxpostnál / GLS-nél (vagy törli a visszatérítéskor megtartottat). Pénzmozgás és számla nincs. Ha a szállító elutasítja (pl. már feladott csomag), kézi teendő marad.'
    },
    markCarrierCancelled: {
      label: 'Szállítónál lemondva ✓', cls: 'btn--ghost', restock: null,
      title: 'Szállító — kézi lemondás jelölése',
      desc: 'Jelöld, ha a szállító elutasította az API-s törlést, és a csomagot kézzel rendezted (Foxpost ügyfélportál, GLS-nél a MyGLS, vagy a csomag már kézbesítve, nincs teendő).'
    }
  };

  function renderActions(o) {
    var keys = [];
    if (o.status === 'paid') keys.push('refundOrder', 'stornoPaid');
    if (o.status === 'reversing') keys.push(o.reversalTarget === 'cancelled' ? 'stornoPaid' : 'refundOrder');
    if (o.status === 'pending_payment') keys.push('stornoUnpaid');
    if ((o.status === 'refunded' || o.status === 'cancelled') && o.invoiceNumber && o.stornoInvoiceStatus !== 'issued') keys.push('retryStorno');
    if ((o.status === 'refunded' || o.status === 'cancelled') &&
        (o.carrierCancelStatus === 'manual_required' || o.carrierCancelStatus === 'kept')) keys.push('cancelCarrier');
    if (o.carrierCancelStatus === 'manual_required') keys.push('markCarrierCancelled');

    $('#order-actions').innerHTML = keys.length ? '<div class="actions">' + keys.map(function (k) {
      var a = ACTIONS[k];
      var label = o.status === 'reversing' ? 'Folytatás: ' + a.label : a.label;
      return '<button type="button" class="btn ' + a.cls + '" data-action="' + k + '">' + esc(label) + '</button>';
    }).join('') + '</div>' : '';
  }

  function openActionForm(key) {
    var a = ACTIONS[key];
    var form = $('#action-form');
    state.action = key;
    $('#action-title').textContent = a.title + ' — ' + (state.order.orderNumber || state.order.orderId);
    $('#action-desc').textContent = a.desc + (state.order.totalCents != null ? ' Összeg: ' + formatHuf(state.order.totalCents) + '.' : '');
    $('#action-error').textContent = '';
    form.reason.value = '';
    try { form.operator.value = localStorage.getItem(OPERATOR_KEY) || ''; } catch (e) { /* nincs tároló */ }
    var showRestock = a.restock !== null && Number(state.order.packsReserved || 0) > 0;
    $('#restock-row').hidden = !showRestock;
    form.restock.checked = !!a.restock;
    // Csak ha van csomag a szállítónál; sztornónál alapból törlés, visszatérítésnél nem
    // (ott a csomag gyakran már úton van vagy kézbesítve).
    var hasParcel = state.order.foxpostLabelStatus === 'created' || state.order.glsLabelStatus === 'created';
    $('#carrier-row').hidden = !(a.cancelCarrier !== undefined && hasParcel);
    form.cancelCarrier.checked = !!a.cancelCarrier;
    form.hidden = false;
    (form.operator.value ? form.reason : form.operator).focus();
  }

  function onActionSubmit(ev) {
    ev.preventDefault();
    var form = ev.target;
    var key = state.action;
    var a = ACTIONS[key];
    var o = state.order;
    if (!window.confirm(a.title + ': ' + (o.orderNumber || o.orderId) + '\nBiztosan végrehajtod? Ez nem vonható vissza.')) return;

    var btn = $('#action-submit');
    busy(btn, true);
    $('#action-error').textContent = '';
    try { localStorage.setItem(OPERATOR_KEY, form.operator.value.trim()); } catch (e) { /* nincs tároló */ }
    var payload = { orderId: o.orderId, operator: form.operator.value, reason: form.reason.value };
    if (!$('#restock-row').hidden) payload.restock = form.restock.checked;
    if (!$('#carrier-row').hidden) payload.cancelCarrier = form.cancelCarrier.checked;

    api(a.api || key, payload).then(function (data) {
      form.hidden = true;
      renderOrder(data.order);
      toast('Kész: ' + a.title);
      if (!$('#view-orders').hidden) loadOrders();
    }).catch(function (e) {
      $('#action-error').textContent = e.message;
      // A szerver oldali állapot változhatott (pl. közben kifizették) — mindig friss adatot mutatunk.
      api('getOrder', { orderId: o.orderId }).then(function (d) { renderOrder(d.order); }).catch(function () {});
    }).then(function () { busy(btn, false); });
  }

  // ---------- eseménykötések ----------
  $('#login-form').addEventListener('submit', onLogin);
  $('#logout').addEventListener('click', logout);
  $('#tabs').addEventListener('click', function (ev) {
    var t = ev.target.closest('.tab');
    if (t) switchView(t.dataset.view);
  });
  $('#stats-refresh').addEventListener('click', loadStats);
  $('#growth-refresh').addEventListener('click', loadGrowth);
  $('#growth-range').addEventListener('change', renderGrowthTable);
  $('#weekly-refresh').addEventListener('click', loadWeekly);  $('#weekly-export').addEventListener('click', exportWeeklyCsv);
  $('#weekly-week').addEventListener('change', renderWeeklyQuests);
  $('#collection-refresh').addEventListener('click', loadCollection);
  $('#card-filters').addEventListener('submit', function (ev) { ev.preventDefault(); loadCards(); });
  $('#order-filters').addEventListener('submit', function (ev) { ev.preventDefault(); loadOrders(); });
  $('#orders-table').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-id]');
    if (tr) openOrder(tr.dataset.id);
  });
  $('#orders-table').addEventListener('keydown', function (ev) {
    var tr = ev.target.closest('tr[data-id]');
    if (tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openOrder(tr.dataset.id); }
  });
  $('#order-close').addEventListener('click', function () { $('#order-dialog').close(); });
  $('#order-body').addEventListener('change', onFulfillmentChange);
  $('#order-body').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-copy]');
    if (!b) return;
    copyText(b.dataset.copy).then(function () {
      toast('Vágólapra másolva');
      b.classList.add('is-copied');
      setTimeout(function () { b.classList.remove('is-copied'); }, 1500);
    }).catch(function () { toast('Nem sikerült másolni — jelöld ki kézzel'); });
  });
  $('#cards-table').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-sku]');
    if (tr) openCard(tr.dataset.sku);
  });
  $('#cards-table').addEventListener('keydown', function (ev) {
    var tr = ev.target.closest('tr[data-sku]');
    if (tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openCard(tr.dataset.sku); }
  });
  $('#history-lookup').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var sku = ev.target.sku.value.trim().toUpperCase();
    if (sku) openCard(sku);
  });
  $('#card-close').addEventListener('click', function () { $('#card-dialog').close(); });
  $('#order-actions').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-action]');
    if (b) openActionForm(b.dataset.action);
  });
  $('#action-cancel').addEventListener('click', function () { $('#action-form').hidden = true; });
  $('#action-form').addEventListener('submit', onActionSubmit);

  state.token = loadToken();
  if (state.token) showApp(); else showLogin();
})();
