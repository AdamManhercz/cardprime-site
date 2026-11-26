// Shared storefront logic: the API client, forint formatting and the cart.
//
// Loaded by /shop/, /checkout/, /checkout/success/ and /checkout/cancel/. It is one file
// on purpose — the price a shopper sees on the shop page and the total they see on the
// checkout page have to be produced by the same code, or the two pages drift apart and
// only Stripe knows which one was right.
//
// No framework, no build step: the rest of this site is hand-written HTML served by
// Cloudflare Pages, and a storefront with four pages does not justify changing that.
window.CardPrimeShop = (function () {
  'use strict';

  // The guest checkout route. It has no authorizer — a buyer on cardprime.io has no
  // Cognito account — and CORS on the API admits exactly this origin, so calls from a
  // file:// page or any other host fail the preflight rather than returning data.
  var API = 'https://q8gld60qn0.execute-api.eu-north-1.amazonaws.com/prod/shop';

  // These mirror packs_handler.py's constants. The server rejects anything past them, so
  // the client's copy exists only to say so before the buyer has filled in an address —
  // it is never the enforcement.
  var MAX_ORDER_LINES = 10;
  var MAX_LINE_QUANTITY = 99;
  var MAX_ORDER_PACKS = 40;

  var CART_KEY = 'cardprime:cart:v1';

  // A webshop főkapcsolója (2026-11-26). Amíg false: a termékoldal gombjai „Hamarosan”
  // feliratúak és inaktívak, a pénztár zárva, és SEMMILYEN rendelés nem indul innen. A teljes
  // folyamat (kosár → createOrder → Stripe → webhook → Számlázz.hu számla) kódja kész,
  // nyitáskor csak ezt kell true-ra állítani (és a ?v= számokat emelni).
  // A ?preview a címben (pl. /shop/?preview) helyben megmutatja a nyitott felületet és a
  // pénztár lépéseit — a fizetés gombja ilyenkor is zárva marad, rendelés nem jön létre.
  var SHOP_OPEN = false;
  var PREVIEW = /[?&]preview\b/.test(window.location.search);

  // Ahová szállítunk: Magyarország + a 16 GLS-es EU-ország (backend/tax.py COUNTRIES,
  // owner 2026-11-16). Ami nincs itt, azt a createOrder 400-zal elutasítja.
  var COUNTRIES = [
    { code: 'HU', hu: 'Magyarország', en: 'Hungary', dial: '+36' },
    { code: 'AT', hu: 'Ausztria', en: 'Austria', dial: '+43' },
    { code: 'BE', hu: 'Belgium', en: 'Belgium', dial: '+32' },
    { code: 'HR', hu: 'Horvátország', en: 'Croatia', dial: '+385' },
    { code: 'CZ', hu: 'Csehország', en: 'Czechia', dial: '+420' },
    { code: 'DK', hu: 'Dánia', en: 'Denmark', dial: '+45' },
    { code: 'FI', hu: 'Finnország', en: 'Finland', dial: '+358' },
    { code: 'FR', hu: 'Franciaország', en: 'France', dial: '+33' },
    { code: 'DE', hu: 'Németország', en: 'Germany', dial: '+49' },
    { code: 'IT', hu: 'Olaszország', en: 'Italy', dial: '+39' },
    { code: 'LU', hu: 'Luxemburg', en: 'Luxembourg', dial: '+352' },
    { code: 'NL', hu: 'Hollandia', en: 'Netherlands', dial: '+31' },
    { code: 'PL', hu: 'Lengyelország', en: 'Poland', dial: '+48' },
    { code: 'RO', hu: 'Románia', en: 'Romania', dial: '+40' },
    { code: 'SK', hu: 'Szlovákia', en: 'Slovakia', dial: '+421' },
    { code: 'SI', hu: 'Szlovénia', en: 'Slovenia', dial: '+386' },
    { code: 'SE', hu: 'Svédország', en: 'Sweden', dial: '+46' }
  ];

  // --- Money ------------------------------------------------------------------
  // priceCents is in fillér: HUF is a two-decimal currency at Stripe, so 6 399 Ft is
  // 639900. Dividing by 100 here is what turns it back into forint.
  //
  // Grouping is done by hand rather than with toLocaleString for the same reason the
  // app's format.ts does it by hand: Intl's grouping character varies between engines,
  // and a price has to render identically on every device and next to itself in the app.
  function group(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function formatPrice(cents, currency) {
    var amount = Number(cents) || 0;
    var cur = (currency || 'huf').toLowerCase();
    if (cur === 'huf') {
      return group(Math.round(amount / 100)) + ' Ft';
    }
    var whole = Math.floor(amount / 100);
    var frac = String(Math.abs(amount) % 100);
    if (frac.length < 2) frac = '0' + frac;
    return group(whole) + '.' + frac + ' ' + cur.toUpperCase();
  }

  // --- API --------------------------------------------------------------------
  // Errors carry the server's own message: packs_handler answers a rejected cart with a
  // sentence a shopper can act on ("Not enough packs in stock"), and swallowing it for a
  // generic failure message would leave them with nothing to do about it.
  function call(action, payload) {
    var body = { action: action };
    if (payload) {
      for (var k in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
      }
    }
    return fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
        if (!res.ok) {
          var failed = document.documentElement.lang === 'hu' ? 'A kérés nem sikerült (' : 'The request failed (';
          var err = new Error(data.error || (failed + res.status + ').'));
          err.status = res.status;
          err.payload = data;
          throw err;
        }
        return data;
      });
    });
  }

  function listPacks() {
    return call('listPacks');
  }

  function createOrder(payload) {
    return call('createOrder', payload);
  }

  function getOrderStatus(orderId) {
    return call('getOrderStatus', { orderId: orderId });
  }

  // Megjelenítéshez: csomag- és szállítási díjak a célország szerint (packs_handler.py
  // _get_pricing). A null díj = az a mód oda nem elérhető. A createOrder mindent újraszámol.
  function getPricing(country) {
    return call('getPricing', { country: country });
  }

  // --- Cart -------------------------------------------------------------------
  // localStorage, not a cookie: nothing here is sent to a server on its own, so the cart
  // needs no consent banner. It holds packIds and quantities and deliberately NO prices —
  // a stored price is a price that can go stale, and the shop and checkout pages both
  // re-read the live figures from listPacks on every load.
  //
  // Every access is wrapped: a private window, cleared site data or a browser set to
  // block storage throws on the accessor itself, and a shop that cannot remember a cart
  // is still a shop that has to render.
  function readCart() {
    var raw = null;
    try { raw = window.localStorage.getItem(CART_KEY); } catch (e) { return []; }
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    var lines = [];
    for (var i = 0; i < parsed.length && lines.length < MAX_ORDER_LINES; i++) {
      var entry = parsed[i];
      if (!entry || typeof entry.packId !== 'string' || !entry.packId) continue;
      var qty = parseInt(entry.quantity, 10);
      if (!(qty >= 1)) continue;
      if (qty > MAX_LINE_QUANTITY) qty = MAX_LINE_QUANTITY;
      lines.push({ packId: entry.packId, quantity: qty });
    }
    return lines;
  }

  function writeCart(lines) {
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(lines)); } catch (e) { /* ignore */ }
    document.dispatchEvent(new CustomEvent('cardprime:cart-changed'));
    return lines;
  }

  function addToCart(packId, quantity) {
    var lines = readCart();
    var qty = parseInt(quantity, 10) || 1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].packId === packId) {
        lines[i].quantity = Math.min(MAX_LINE_QUANTITY, lines[i].quantity + qty);
        return writeCart(lines);
      }
    }
    if (lines.length >= MAX_ORDER_LINES) return lines;
    lines.push({ packId: packId, quantity: Math.min(MAX_LINE_QUANTITY, qty) });
    return writeCart(lines);
  }

  function setQuantity(packId, quantity) {
    var qty = parseInt(quantity, 10);
    var lines = readCart();
    var kept = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].packId !== packId) { kept.push(lines[i]); continue; }
      if (qty >= 1) kept.push({ packId: packId, quantity: Math.min(MAX_LINE_QUANTITY, qty) });
    }
    return writeCart(kept);
  }

  function removeFromCart(packId) {
    return setQuantity(packId, 0);
  }

  function clearCart() {
    return writeCart([]);
  }

  function cartCount() {
    var lines = readCart();
    var total = 0;
    for (var i = 0; i < lines.length; i++) total += lines[i].quantity;
    return total;
  }

  // How many loose packs a cart draws from the shared pool: a box counts as its packCount,
  // not as one. This is the same arithmetic _create_order does server-side, and it is what
  // MAX_ORDER_PACKS is measured in.
  function packsInCart(lines, packsById) {
    var total = 0;
    for (var i = 0; i < lines.length; i++) {
      var pack = packsById[lines[i].packId];
      if (!pack) continue;
      total += (parseInt(pack.packCount, 10) || 1) * lines[i].quantity;
    }
    return total;
  }

  function indexPacks(packs) {
    var byId = {};
    for (var i = 0; i < packs.length; i++) byId[packs[i].packId] = packs[i];
    return byId;
  }

  // A kosár darabszáma az új fejlécben: a kosár-ikonban lévő [data-cart-count]. A régi
  // dizájnú oldalakon ezt a nav.js csinálja (.cart-link .cart-count). Más fülön történt
  // változást a storage esemény hoz.
  function renderCartBadges() {
    var count = cartCount();
    var badges = document.querySelectorAll('[data-cart-count]');
    for (var i = 0; i < badges.length; i++) {
      badges[i].textContent = count > 99 ? '99+' : String(count);
      badges[i].hidden = count === 0;
    }
  }
  document.addEventListener('cardprime:cart-changed', renderCartBadges);
  window.addEventListener('storage', function (ev) { if (ev.key === CART_KEY) renderCartBadges(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderCartBadges);
  else renderCartBadges();

  return {
    API: API,
    SHOP_OPEN: SHOP_OPEN,
    PREVIEW: PREVIEW,
    COUNTRIES: COUNTRIES,
    getPricing: getPricing,
    MAX_ORDER_LINES: MAX_ORDER_LINES,
    MAX_LINE_QUANTITY: MAX_LINE_QUANTITY,
    MAX_ORDER_PACKS: MAX_ORDER_PACKS,
    formatPrice: formatPrice,
    call: call,
    listPacks: listPacks,
    createOrder: createOrder,
    getOrderStatus: getOrderStatus,
    readCart: readCart,
    addToCart: addToCart,
    setQuantity: setQuantity,
    removeFromCart: removeFromCart,
    clearCart: clearCart,
    cartCount: cartCount,
    packsInCart: packsInCart,
    indexPacks: indexPacks
  };
})();
