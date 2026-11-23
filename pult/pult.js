/* CardPrime Pult — helyszíni (rendezvényes) eladás tableten / laptopon.
   Külön pult fiók (pult_admin, a „pult” csoport tagja az admin poolban), NEM az admin fiók.
   A backend a pult fióknak csak az eladást engedi, az admin fióknak az eladást nem.
   Az eladás fizetettként íródik és készletet von le, ezért nyilvános oldalon nem lehet.
   Az összesítő az admin felület „Pult” fülén van, itt nincs.
   Minden eladásról e-számla készül (Számlázz.hu), amit a Számlázz.hu e-mailben küld a vevőnek. */
(function () {
  'use strict';

  var CONFIG = {
    region: 'eu-north-1',
    clientId: '7dtcoiimm7qb67sp7istpqmslf',
    apiUrl: 'https://q8gld60qn0.execute-api.eu-north-1.amazonaws.com/prod/admin'
  };
  var COGNITO_URL = 'https://cognito-idp.' + CONFIG.region + '.amazonaws.com/';
  var TOKEN_KEY = 'cpPultToken';        // saját munkamenet, független az admin oldalétól
  var SELLER_KEY = 'cpPultSeller';      // az utolsó eladó neve, hogy ne kelljen minden eladásnál beírni
  var POS_GROUP = 'pult';
  var CASH_STEP_CENTS = 500;            // készpénz: 5 Ft-ra kerekített végösszeg (a backend is ellenőrzi)

  // A backend tax.COUNTRIES listája (HU + a GLS-es EU-országok). Más ország a backendnél 400.
  var COUNTRIES = [
    ['HU', 'Magyarország'], ['AT', 'Ausztria'], ['BE', 'Belgium'], ['CZ', 'Csehország'], ['DK', 'Dánia'],
    ['FI', 'Finnország'], ['FR', 'Franciaország'], ['HR', 'Horvátország'], ['NL', 'Hollandia'],
    ['PL', 'Lengyelország'], ['LU', 'Luxemburg'], ['DE', 'Németország'], ['IT', 'Olaszország'],
    ['RO', 'Románia'], ['SK', 'Szlovákia'], ['SI', 'Szlovénia'], ['SE', 'Svédország']
  ];

  var $ = function (sel) { return document.querySelector(sel); };
  var state = {
    token: null, challenge: null,
    products: [], poolStock: 0, cart: {},
    requestId: null,   // egy eladás = egy azonosító; újrapróbáláskor UGYANAZ megy újra
    sending: false, lastOrder: null
  };

  // ---------- segédek ----------
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatHuf(cents) {
    if (cents == null) return '—';
    var forint = Math.round(Number(cents) / 100);
    return String(forint).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';
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
  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // tartalék: RFC 4122 v4 a crypto.getRandomValues-ból
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
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
      if (t && isPultToken(t) && jwtPayload(t).exp * 1000 > Date.now() + 60000) return t;
    } catch (e) { /* sérült vagy tiltott tároló: újra belépés */ }
    return null;
  }
  // Csak kényelmi ellenőrzés (az admin fiókkal ne lehessen „belépni”); a tényleges tiltás a backendben van.
  function isPultToken(t) {
    var groups = jwtPayload(t)['cognito:groups'] || [];
    return groups.indexOf(POS_GROUP) !== -1;
  }
  function saveToken(t) {
    state.token = t;
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { /* csak memóriában marad */ }
  }
  function logout() {
    state.token = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nincs teendő */ }
    showLogin();
  }
  function loadSeller() {
    try { return localStorage.getItem(SELLER_KEY) || ''; } catch (e) { return ''; }
  }
  function saveSeller(v) {
    try { localStorage.setItem(SELLER_KEY, v); } catch (e) { /* nincs teendő */ }
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
    busy(btn, true);
    var username = form.username.value.trim();
    var request;
    if (state.challenge) {
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
      $('#new-password-row').hidden = true;
      if (!isPultToken(data.AuthenticationResult.IdToken)) {
        throw new Error('Ez nem a pult fiók. A pult_admin felhasználóval lépj be (az admin fiók itt nem működik).');
      }
      form.reset();
      saveToken(data.AuthenticationResult.IdToken);
      showApp();
    }).catch(function (e) {
      errEl.textContent = e.message;
    }).then(function () { busy(btn, false); });
  }

  // ---------- API ----------
  // A hibának van .status mezője: 0 = hálózati hiba (nem tudjuk, megtörtént-e), 4xx = a backend
  // biztosan elutasította (semmi nem íródott), 5xx = bizonytalan.
  function api(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    return fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.token },
      body: JSON.stringify(body)
    }).catch(function () {
      var err = new Error('Nincs kapcsolat a szerverrel. Ellenőrizd a netet, majd nyomd meg újra — nem lesz dupla eladás.');
      err.status = 0;
      throw err;
    }).then(function (res) {
      if (res.status === 401) {
        logout();
        var e401 = new Error('A munkamenet lejárt, lépj be újra.');
        e401.status = 401;
        throw e401;
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || data.message || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  // A backend angol hibaüzenetei közül a pultnál gyakoriak magyarul.
  var ERRORS_HU = {
    'Not enough stock for this sale': 'Nincs ennyi a készletben. Frissítsd a termékeket.',
    'A cash total must be a multiple of 5 Ft': 'Készpénznél a végösszegnek 5 Ft-ra kell végződnie.',
    'A Hungarian postal code has 4 digits': 'A magyar irányítószám 4 számjegy.',
    'customer.email is not a valid e-mail address': 'Az e-mail cím hibás.',
    'The buyer must accept the terms and the privacy notice': 'A vevőnek el kell fogadnia az ÁSZF-et és az adatkezelési tájékoztatót.'
  };
  function errorText(e) { return ERRORS_HU[e.message] || e.message; }

  // ---------- nézetek ----------
  function showLogin() {
    $('#view-sale').hidden = true;
    $('#logout').hidden = true;
    $('#view-login').hidden = false;
  }
  function showApp() {
    $('#view-login').hidden = true;
    $('#view-sale').hidden = false;
    $('#logout').hidden = false;
    $('#seller').value = loadSeller();
    if (!addr.data) loadAddressData();
    loadProducts();
    updateSummary();
  }

  // ---------- termékek ----------
  function loadProducts() {
    var box = $('#products');
    return api('posProducts').then(function (data) {
      state.products = data.products || [];
      state.poolStock = Number(data.poolStock) || 0;
      // a kosárból kiesik, ami már nincs a listában
      Object.keys(state.cart).forEach(function (id) {
        if (!state.products.some(function (p) { return p.packId === id; })) delete state.cart[id];
      });
      renderProducts();
      updateSummary();
    }).catch(function (e) {
      if (e.status !== 401) box.innerHTML = '<p class="error">A termékek nem töltődtek be: ' + esc(errorText(e)) + '</p>';
    });
  }
  function packsInCart() {
    return state.products.reduce(function (sum, p) { return sum + p.packCount * (state.cart[p.packId] || 0); }, 0);
  }
  function renderProducts() {
    var box = $('#products');
    if (!state.products.length) {
      box.innerHTML = '<p class="muted">Nincs aktív termék.</p>';
      return;
    }
    box.innerHTML = state.products.map(function (p) {
      var qty = state.cart[p.packId] || 0;
      var meta = p.packCount > 1 ? p.packCount + ' csomag' : '1 csomag';
      // Csomagajánlat (pl. dupla doboz): „2 × 23 990 Ft”, alatta a teljes ár — mint a webshopban.
      var bundle = Math.max(1, Number(p.bundleCount) || 1);
      var price = bundle > 1
        ? '<div class="product__price">' + bundle + ' × ' + formatHuf(p.priceCents / bundle) + '</div>' +
          '<div class="product__unit">összesen ' + formatHuf(p.priceCents) + '</div>'
        : '<div class="product__price">' + formatHuf(p.priceCents) + '</div>';
      return '<div class="product' + (qty ? ' is-picked' : '') + '" data-id="' + esc(p.packId) + '">' +
        '<div><div class="product__name">' + esc(p.name || p.packId) + '</div>' +
        '<div class="product__meta">' + esc(meta) + ' · <span data-role="avail"></span></div></div>' +
        '<div>' + price + '</div>' +
        '<div class="stepper">' +
          '<button type="button" data-step="-1" aria-label="' + esc((p.name || p.packId) + ': eggyel kevesebb') + '">−</button>' +
          '<output aria-live="polite" aria-label="' + esc((p.name || p.packId) + ' darabszám') + '">' + qty + '</output>' +
          '<button type="button" data-step="1" aria-label="' + esc((p.name || p.packId) + ': eggyel több') + '">+</button>' +
        '</div></div>';
    }).join('');
    refreshSteppers();
  }
  // A dobozok és a laza csomagok ugyanabból a csomag-poolból fogynak: a „+” csak akkor él,
  // ha a pool maradéka még elbír egy darabot ebből a termékből.
  function refreshSteppers() {
    var left = state.poolStock - packsInCart();
    state.products.forEach(function (p) {
      var tile = document.querySelector('.product[data-id="' + CSS.escape(p.packId) + '"]');
      if (!tile) return;
      var qty = state.cart[p.packId] || 0;
      tile.classList.toggle('is-picked', qty > 0);
      tile.querySelector('output').textContent = qty;
      tile.querySelector('[data-step="-1"]').disabled = qty <= 0;
      tile.querySelector('[data-step="1"]').disabled = p.packCount > left || qty >= 50;
      tile.querySelector('[data-role="avail"]').textContent = 'még ' + Math.max(0, Math.floor(left / p.packCount)) + ' adható';
    });
    $('#stock-line').textContent = 'Készlet: ' + state.poolStock + ' csomag';
  }
  function onStep(ev) {
    var btn = ev.target.closest('button[data-step]');
    if (!btn || btn.disabled) return;
    var id = btn.closest('.product').dataset.id;
    var next = (state.cart[id] || 0) + Number(btn.dataset.step);
    if (next <= 0) delete state.cart[id]; else state.cart[id] = next;
    refreshSteppers();
    updateSummary();
  }

  // ---------- összesítő + beküldés ----------
  function cartTotal() {
    return state.products.reduce(function (sum, p) { return sum + p.priceCents * (state.cart[p.packId] || 0); }, 0);
  }
  function paymentMethod() {
    var el = document.querySelector('input[name="paymentMethod"]:checked');
    return el ? el.value : '';
  }
  function validationProblem() {
    var form = $('#sale-form');
    var total = cartTotal();
    if (!$('#seller').value.trim()) return 'Írd be az eladó nevét.';
    if (!total) return 'Válassz terméket.';
    if (!form.name.value.trim() || !form.email.value.trim() || !form.postalCode.value.trim() ||
        !form.city.value.trim() || !form.street.value.trim()) return 'Töltsd ki a vevő adatait.';
    if (!form.houseNumber.value.trim()) return 'Írd be a házszámot.';
    if (!form.email.checkValidity()) return 'Az e-mail cím hibás.';
    if (form.country.value === 'HU' && !/^\d{4}$/.test(form.postalCode.value.trim())) return 'A magyar irányítószám 4 számjegy.';
    if (!paymentMethod()) return 'Válaszd ki a fizetési módot.';
    if (paymentMethod() === 'cash' && total % CASH_STEP_CENTS) return 'Készpénznél a végösszegnek 5 Ft-ra kell végződnie.';
    if (!form.terms.checked || !form.privacy.checked) return 'A vevőnek el kell fogadnia az ÁSZF-et és az adatkezelési tájékoztatót.';
    if (!form.paid.checked) return 'Pipáld be, hogy a fizetés megtörtént.';
    return '';
  }
  function updateSummary() {
    var lines = state.products.filter(function (p) { return state.cart[p.packId]; }).map(function (p) {
      var q = state.cart[p.packId];
      return '<li><span>' + q + ' × ' + esc(p.name || p.packId) + '</span><span>' + formatHuf(p.priceCents * q) + '</span></li>';
    });
    $('#lines').innerHTML = lines.length ? lines.join('') : '<li class="muted">Még nincs termék.</li>';
    var total = cartTotal();
    $('#total').textContent = formatHuf(total);
    var method = paymentMethod();
    var how = method === 'cash' ? 'készpénzben' : method === 'card' ? 'kártyával, a terminálon' : '';
    $('#paid-text').textContent = 'A fizetés megtörtént' + (how ? ' ' + how : '') + ': ' + formatHuf(total) + '.';
    var problem = state.sending ? 'busy' : validationProblem();
    $('#submit').disabled = !!problem;
    $('#submit').title = problem === 'busy' ? '' : problem;
  }
  // Ha az összeg vagy a mód változik, a „fizetés megtörtént” pipát újra kell tenni.
  function resetPaid() { $('#sale-form').paid.checked = false; }

  function onSubmit(ev) {
    ev.preventDefault();
    var problem = validationProblem();
    var errEl = $('#sale-error');
    if (problem) { errEl.textContent = problem; return; }
    errEl.textContent = '';
    var form = ev.target;
    var seller = $('#seller').value.trim();
    saveSeller(seller);
    if (!state.requestId) state.requestId = newRequestId();
    var payload = {
      operator: seller,  // a backend „soldBy”-ként tárolja: ki adta el
      requestId: state.requestId,
      paymentMethod: paymentMethod(),
      items: Object.keys(state.cart).map(function (id) { return { packId: id, quantity: state.cart[id] }; }),
      customer: {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        country: form.country.value,
        postalCode: form.postalCode.value.trim(),
        city: form.city.value.trim(),
        street: form.street.value.trim(),
        houseNumber: form.houseNumber.value.trim()
      },
      consents: { terms: form.terms.checked, privacy: form.privacy.checked }
    };
    var btn = $('#submit');
    state.sending = true;
    busy(btn, true);
    btn.textContent = 'Számla készül…';
    api('createPosSale', payload).then(function (data) {
      state.requestId = null;
      showResult(data.order, !!data.duplicate);
      loadProducts();
    }).catch(function (e) {
      // 4xx: a backend biztosan nem írt semmit -> a következő próbálkozás új eladás lehet.
      // Hálózati hiba / 5xx: nem tudjuk, megtörtént-e -> ugyanaz az azonosító megy újra.
      if (e.status >= 400 && e.status < 500) state.requestId = null;
      if (e.status !== 401) errEl.textContent = errorText(e);
      if (e.status === 409) loadProducts();
    }).then(function () {
      state.sending = false;
      btn.textContent = 'Számla kiállítása és küldése';
      busy(btn, false);
      updateSummary();
    });
  }

  function showResult(order, duplicate) {
    state.lastOrder = order;
    var ok = order.invoiceStatus === 'issued';
    var box = $('#result');
    box.className = 'card result ' + (ok ? 'result--ok' : 'result--warn');
    $('#result-title').textContent = ok ? 'Kész — a számla elment' : 'Az eladás rögzítve, a számla NEM készült el';
    var items = (order.items || []).map(function (i) { return i.quantity + ' × ' + (i.packName || i.packId); }).join(', ');
    var rows = [
      ['Számlaszám', order.invoiceNumber || '—'],
      ['Vevő', order.customerName],
      ['E-mail', order.customerEmail],
      ['Tételek', items],
      ['Összesen', formatHuf(order.totalCents)],
      ['Fizetés', order.paymentMethod === 'cash' ? 'Készpénz' : 'Bankkártya'],
      ['Rendelésszám', order.orderNumber]
    ];
    $('#result-kv').innerHTML = rows.map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
    }).join('');
    var note = ok
      ? 'A Számlázz.hu e-mailben küldi a számlát a vevőnek.'
      : 'A készlet levonva, a fizetés rögzítve. Újrapróbálás előtt nézd meg a Számlázz.hu-ban, nem készült-e el mégis a számla (ha igen, ne próbáld újra).';
    if (duplicate) note = 'Ez az eladás már korábban rögzült (dupla küldés volt) — nem lett két eladás. ' + note;
    $('#result-note').textContent = note;
    $('#retry-invoice').hidden = ok;
    $('#sale-form').hidden = true;
    box.hidden = false;
    box.focus();
  }

  function onRetryInvoice() {
    var order = state.lastOrder;
    var seller = $('#seller').value.trim();
    if (!order) return;
    if (!seller) { toast('Írd be az eladó nevét.'); return; }
    if (!window.confirm('Megnézted a Számlázz.hu-ban, hogy nincs még számla erről az eladásról (' + order.orderNumber + ')?')) return;
    var btn = $('#retry-invoice');
    busy(btn, true);
    api('retryPosInvoice', { orderId: order.orderId, operator: seller }).then(function (data) {
      showResult(data.order, false);
    }).catch(function (e) {
      if (e.status !== 401) toast(errorText(e));
    }).then(function () { busy(btn, false); });
  }

  function newSale() {
    var form = $('#sale-form');
    form.reset();
    form.country.value = 'HU';
    $('#seller').value = loadSeller();  // az eladó marad a következő eladásra is
    addr.cityAuto = '';
    $('#postal-hint').textContent = '';
    $('#street-hint').textContent = '';
    $('#city-options').innerHTML = '';
    closeStreetList();
    state.cart = {};
    state.requestId = null;
    state.lastOrder = null;
    $('#sale-error').textContent = '';
    $('#result').hidden = true;
    form.hidden = false;
    refreshSteppers();
    updateSummary();
    window.scrollTo(0, 0);
  }

  // ---------- cím-segítség (csak HU) ----------
  // /pult/irsz.json: a Magyar Posta irányítószám-jegyzékéből (tools: build_irsz.py).
  // c: irányítószám -> település(ek); s: irányítószám -> közterületek (Budapest + 5 nagyváros).
  // Helyben fut, a beírt adat nem megy sehova; ha a fájl nem jön le, minden kézzel írható.
  var addr = { data: null, cityAuto: '', matches: [], active: -1 };
  function loadAddressData() {
    return fetch('/pult/irsz.json', { credentials: 'omit' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      addr.data = JSON.parse(new TextDecoder('utf-8').decode(buf));
      onPostalInput();
    }).catch(function () { addr.data = null; /* nincs segítség, kézi kitöltés */ });
  }
  // kis- és nagybetű, ékezet nélkül: „cs” = „Cs”, „o” = „ö/ő”
  function fold(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function isHu() { return $('#country').value === 'HU'; }
  function postalStreets() {
    var code = $('#postal-code').value.trim();
    return (isHu() && addr.data && addr.data.s[code]) || [];
  }
  function onPostalInput() {
    var code = $('#postal-code').value.trim();
    var hint = $('#postal-hint');
    var city = $('#city');
    var names = (isHu() && addr.data && /^\d{4}$/.test(code) && addr.data.c[code]) || [];
    $('#city-options').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
    // csak akkor írjuk felül a települést, ha üres, vagy mi töltöttük ki korábban
    var untouched = !city.value.trim() || city.value === addr.cityAuto;
    if (names.length && untouched) {
      city.value = names[0];
      addr.cityAuto = names[0];
    } else if (!names.length && untouched && addr.cityAuto) {
      city.value = '';
      addr.cityAuto = '';
    }
    if (!isHu() || !addr.data || code.length < 4) hint.textContent = '';
    else if (!names.length) hint.textContent = 'Ismeretlen irányítószám — ellenőrizd, vagy írd be kézzel a települést.';
    else if (names.length > 1) hint.textContent = 'Több település tartozik ide: ' + names.join(', ') + ' — válaszd ki a Település mezőben.';
    else hint.textContent = postalStreets().length ? 'Az utcához kezdd el írni a nevét, és válassz a listából.' : '';
    closeStreetList();
  }

  function streetQuery() { return $('#street').value.trim(); }  // a házszám külön mezőben van
  function onStreetInput() {
    var q = streetQuery();
    var all = postalStreets();
    if (!q || !all.length) { closeStreetList(); return; }
    var f = fold(q);
    var starts = [], inside = [];
    all.forEach(function (s) {
      var fs = fold(s);
      if (fs === f) return;
      if (fs.indexOf(f) === 0) starts.push(s);
      else if (fs.indexOf(' ' + f) !== -1) inside.push(s);   // pl. „Dürer” -> Ajtósi Dürer sor
    });
    addr.matches = starts.concat(inside).slice(0, 12);
    addr.active = -1;
    renderStreetList(f.length);
  }
  function renderStreetList(n) {
    var list = $('#street-list');
    if (!addr.matches.length) { closeStreetList(); $('#street-hint').textContent = 'Nincs ilyen közterület ennél az irányítószámnál — írd be kézzel.'; return; }
    $('#street-hint').textContent = '';
    list.innerHTML = addr.matches.map(function (s, i) {
      var head = fold(s).indexOf(fold($('#street').value.trim())) === 0 ? '<b>' + esc(s.slice(0, n)) + '</b>' + esc(s.slice(n)) : esc(s);
      return '<li role="option" id="street-opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === addr.active) + '">' + head + '</li>';
    }).join('');
    list.hidden = false;
    var input = $('#street');
    input.setAttribute('aria-expanded', 'true');
    if (addr.active >= 0) input.setAttribute('aria-activedescendant', 'street-opt-' + addr.active);
    else input.removeAttribute('aria-activedescendant');
  }
  function closeStreetList() {
    var list = $('#street-list');
    list.hidden = true;
    list.innerHTML = '';
    addr.matches = [];
    addr.active = -1;
    var input = $('#street');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function pickStreet(i) {
    var s = addr.matches[i];
    if (!s) return;
    $('#street').value = s;
    $('#street-hint').textContent = '';
    closeStreetList();
    $('#house-number').focus();  // választás után egyből a házszám jön
    updateSummary();
  }
  function onStreetKey(ev) {
    if ($('#street-list').hidden) return;
    var n = addr.matches.length;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); addr.active = (addr.active + 1) % n; }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); addr.active = (addr.active - 1 + n) % n; }
    else if (ev.key === 'Enter' && addr.active >= 0) { ev.preventDefault(); pickStreet(addr.active); return; }
    else if (ev.key === 'Escape') { closeStreetList(); return; }
    else return;
    renderStreetList(fold(streetQuery()).length);
    var el = $('#street-opt-' + addr.active);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  // ---------- indulás ----------
  function init() {
    $('#country').innerHTML = COUNTRIES.map(function (c) {
      return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>';
    }).join('');
    $('#login-form').addEventListener('submit', onLogin);
    $('#logout').addEventListener('click', logout);
    $('#products').addEventListener('click', function (ev) { onStep(ev); resetPaid(); updateSummary(); });
    var form = $('#sale-form');
    form.addEventListener('submit', onSubmit);
    form.addEventListener('input', updateSummary);
    form.addEventListener('change', function (ev) {
      if (ev.target.name === 'paymentMethod') resetPaid();
      updateSummary();
    });
    $('#seller').addEventListener('input', function (ev) { saveSeller(ev.target.value.trim()); });
    $('#postal-code').addEventListener('input', onPostalInput);
    $('#country').addEventListener('change', onPostalInput);
    var street = $('#street');
    street.addEventListener('input', function () { $('#street-hint').textContent = ''; onStreetInput(); });
    street.addEventListener('focus', onStreetInput);
    street.addEventListener('keydown', onStreetKey);
    street.addEventListener('blur', function () { setTimeout(closeStreetList, 150); });
    // pointerdown: a választás még a blur előtt megtörténik (érintőképernyőn is)
    $('#street-list').addEventListener('pointerdown', function (ev) {
      var li = ev.target.closest('li[data-i]');
      if (!li) return;
      ev.preventDefault();
      pickStreet(Number(li.dataset.i));
    });
    $('#new-sale').addEventListener('click', newSale);
    $('#retry-invoice').addEventListener('click', onRetryInvoice);
    $('#refresh-products').addEventListener('click', loadProducts);

    state.token = loadToken();
    if (state.token) showApp(); else showLogin();
  }
  init();
})();
