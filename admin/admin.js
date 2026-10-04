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
  var state = { token: null, challenge: null, order: null, action: null };

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
  function showLogin() {
    $('#tabs').hidden = true;
    $('#logout').hidden = true;
    ['overview', 'orders', 'statuses'].forEach(function (v) { $('#view-' + v).hidden = true; });
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
    ['overview', 'orders', 'statuses'].forEach(function (v) { $('#view-' + v).hidden = v !== view; });
    if (view === 'overview') loadStats();
    if (view === 'orders') loadOrders();
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
        ['Foglalva', formatNum(s.packsReservedPending), 'tasak fizetésre vár'],
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

  function loadOrders() {
    var f = $('#order-filters');
    $('#orders-table').innerHTML = '<tbody><tr><td class="muted">Betöltés…</td></tr></tbody>';
    api('listOrders', { status: f.status.value, content: f.content.value, q: f.q.value }).then(function (data) {
      var rows = data.orders.map(function (o) {
        return '<tr tabindex="0" data-id="' + esc(o.orderId) + '">' +
          '<td><b>' + esc(o.orderNumber || o.orderId) + '</b></td>' +
          '<td>' + formatDate(o.createdAt) + '</td>' +
          '<td>' + esc(o.customerName || '') + '<br><span class="muted">' + esc(o.customerEmail || '') + '</span></td>' +
          '<td>' + compositionHtml(o.composition, o.packsReserved) + '</td>' +
          '<td class="num">' + formatHuf(o.totalCents) + '</td>' +
          '<td>' + badge(o.status) + '</td>' +
          '<td>' + badge(o.invoiceStatus) + '</td>' +
          '<td>' + (o.auctionId ? 'aukció' : esc(o.channel || 'app')) + '</td></tr>';
      }).join('');
      $('#orders-table').innerHTML = '<thead><tr><th>Rendelés</th><th>Dátum</th><th>Vevő</th><th>Tartalom</th><th class="num">Összeg</th><th>Státusz</th><th>Számla</th><th>Csatorna</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="8" class="muted">Nincs találat.</td></tr>') + '</tbody>';
      $('#orders-meta').textContent = data.orders.length + ' / ' + data.total + ' rendelés';
    }).catch(function (e) {
      $('#orders-table').innerHTML = '<tbody><tr><td class="error">' + esc(e.message) + '</td></tr></tbody>';
    });
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
        ['Cím', [addr.postalCode, addr.city, addr.line1, addr.line2, addr.country].filter(Boolean).join(', ')],
        ['Szállítás', o.shippingMethod + (o.foxpostLockerName ? ' — ' + o.foxpostLockerName : '')],
        ['Tételek', items || '—', true]
      ]) + '</div>' +
      '<div class="section"><h3>Szolgáltatók</h3>' + kv([
        ['Stripe fizetés', o.stripePaymentIntentId],
        ['Stripe visszatérítés', o.stripeRefundId],
        ['Számla (Számlázz.hu)', badge(o.invoiceStatus) + ' ' + esc(o.invoiceNumber || ''), true],
        ['Sztornó számla', badge(o.stornoInvoiceStatus) + ' ' + esc(o.stornoInvoiceNumber || ''), true],
        ['Foxpost címke', badge(o.foxpostLabelStatus) + ' ' + esc(o.foxpostTrackingNumber || ''), true],
        ['Szállító lemondás', badge(o.carrierCancelStatus), true],
        ['Visszaigazoló e-mail', badge(o.confirmationEmailStatus), true]
      ]) + '</div>' +
      (log ? '<div class="section"><h3>Admin napló</h3><ul class="log">' + log + '</ul></div>' : '');

    renderActions(o);
  }

  var ACTIONS = {
    refundOrder: {
      label: 'Visszatérítés (refund)', cls: 'btn--danger', restock: false,
      title: 'Visszatérítés',
      desc: 'Valódi vásárlás visszafordítása. Stripe: teljes összeg vissza a vevőnek → Számlázz.hu: sztornó számla → szállító: kézi teendő, ha volt címke. Státusz: refunded.'
    },
    stornoPaid: {
      api: 'stornoOrder', label: 'Sztornó (hibás / teszt)', cls: 'btn--warn', restock: null,
      title: 'Sztornó — fizetett rendelés',
      desc: 'Hibás vagy teszt vásárlás érvénytelenítése. Stripe: pénz vissza → Számlázz.hu: sztornó számla → szállító: kézi teendő, ha volt címke. A tasakok mindig visszakerülnek a készletbe (bontatlanok, újra eladhatók). Státusz: cancelled.'
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
    markCarrierCancelled: {
      label: 'Szállítónál lemondva ✓', cls: 'btn--ghost', restock: null,
      title: 'Szállító — kézi lemondás jelölése',
      desc: 'Jelöld, ha a Foxpost felé a csomagot kézzel lemondtad / visszahívtad (Foxpost ügyfélportál). Az API-integráció később jön.'
    }
  };

  function renderActions(o) {
    var keys = [];
    if (o.status === 'paid') keys.push('refundOrder', 'stornoPaid');
    if (o.status === 'reversing') keys.push(o.reversalTarget === 'cancelled' ? 'stornoPaid' : 'refundOrder');
    if (o.status === 'pending_payment') keys.push('stornoUnpaid');
    if ((o.status === 'refunded' || o.status === 'cancelled') && o.invoiceNumber && o.stornoInvoiceStatus !== 'issued') keys.push('retryStorno');
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
  $('#order-actions').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-action]');
    if (b) openActionForm(b.dataset.action);
  });
  $('#action-cancel').addEventListener('click', function () { $('#action-form').hidden = true; });
  $('#action-form').addEventListener('submit', onActionSubmit);

  state.token = loadToken();
  if (state.token) showApp(); else showLogin();
})();
