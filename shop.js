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

  // --- Countries --------------------------------------------------------------
  // A mirror of the app's src/data/countries.ts, field for field: the shipping country
  // picker AND the phone dial-code picker are built from this one array, on both surfaces.
  //
  // It is written out here rather than fetched, because the country list is not a fact the
  // server owns — it is a UI convenience. backend/tax.py carries its own copy and validates
  // the ISO code on every order, so a country offered here that it does not know is a 400,
  // never a wrongly taxed sale.
  //
  // ⚠️ Two lists is how the app got this wrong once already: the dial codes and the
  // shipping destinations were unrelated arrays, and picking a prefix silently implied a
  // country we might not ship to. Add a country in ONE place — countries.ts and here —
  // and never split the dial code back out into a second table.
  var COUNTRIES = [
    { code: 'HU', name: 'Hungary', dialCode: '+36', zone: 'domestic' },

    // EU member states — alphabetical.
    { code: 'AT', name: 'Austria', dialCode: '+43', zone: 'eu' },
    { code: 'BE', name: 'Belgium', dialCode: '+32', zone: 'eu' },
    { code: 'BG', name: 'Bulgaria', dialCode: '+359', zone: 'eu' },
    { code: 'HR', name: 'Croatia', dialCode: '+385', zone: 'eu' },
    { code: 'CY', name: 'Cyprus', dialCode: '+357', zone: 'eu' },
    { code: 'CZ', name: 'Czechia', dialCode: '+420', zone: 'eu' },
    { code: 'DK', name: 'Denmark', dialCode: '+45', zone: 'eu' },
    { code: 'EE', name: 'Estonia', dialCode: '+372', zone: 'eu' },
    { code: 'FI', name: 'Finland', dialCode: '+358', zone: 'eu' },
    { code: 'FR', name: 'France', dialCode: '+33', zone: 'eu' },
    { code: 'DE', name: 'Germany', dialCode: '+49', zone: 'eu' },
    { code: 'GR', name: 'Greece', dialCode: '+30', zone: 'eu' },
    { code: 'IE', name: 'Ireland', dialCode: '+353', zone: 'eu' },
    { code: 'IT', name: 'Italy', dialCode: '+39', zone: 'eu' },
    { code: 'LV', name: 'Latvia', dialCode: '+371', zone: 'eu' },
    { code: 'LT', name: 'Lithuania', dialCode: '+370', zone: 'eu' },
    { code: 'LU', name: 'Luxembourg', dialCode: '+352', zone: 'eu' },
    { code: 'MT', name: 'Malta', dialCode: '+356', zone: 'eu' },
    { code: 'NL', name: 'Netherlands', dialCode: '+31', zone: 'eu' },
    { code: 'PL', name: 'Poland', dialCode: '+48', zone: 'eu' },
    { code: 'PT', name: 'Portugal', dialCode: '+351', zone: 'eu' },
    { code: 'RO', name: 'Romania', dialCode: '+40', zone: 'eu' },
    { code: 'SK', name: 'Slovakia', dialCode: '+421', zone: 'eu' },
    { code: 'SI', name: 'Slovenia', dialCode: '+386', zone: 'eu' },
    { code: 'ES', name: 'Spain', dialCode: '+34', zone: 'eu' },
    { code: 'SE', name: 'Sweden', dialCode: '+46', zone: 'eu' },

    // Outside the EU. Every one of these is an export: no EU VAT, and a customs declaration
    // travels with the parcel. See the shipping policy before adding to this group.
    { code: 'AU', name: 'Australia', dialCode: '+61', zone: 'export' },
    { code: 'CA', name: 'Canada', dialCode: '+1', zone: 'export' },
    { code: 'JP', name: 'Japan', dialCode: '+81', zone: 'export' },
    { code: 'NO', name: 'Norway', dialCode: '+47', zone: 'export' },
    { code: 'RS', name: 'Serbia', dialCode: '+381', zone: 'export' },
    { code: 'CH', name: 'Switzerland', dialCode: '+41', zone: 'export' },
    { code: 'UA', name: 'Ukraine', dialCode: '+380', zone: 'export' },
    { code: 'GB', name: 'United Kingdom', dialCode: '+44', zone: 'export' },
    { code: 'US', name: 'United States', dialCode: '+1', zone: 'export' }
  ];

  var DEFAULT_COUNTRY_CODE = 'HU';

  function findCountry(code) {
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].code === code) return COUNTRIES[i];
    }
    return null;
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
          var err = new Error(data.error || ('The request failed (' + res.status + ').'));
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

  // --- Cart pill --------------------------------------------------------------
  // Rendered into #cart-pill wherever a page includes one. Hidden while the cart is
  // empty: a permanently visible "0 items" link is noise on a two-product shop.
  function renderCartPill() {
    var pill = document.getElementById('cart-pill');
    if (!pill) return;
    var count = cartCount();
    if (!count) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    pill.textContent = count === 1 ? 'Cart · 1 item' : 'Cart · ' + count + ' items';
  }

  document.addEventListener('cardprime:cart-changed', renderCartPill);
  // Another tab is the same cart: localStorage fires `storage` in every other document
  // on this origin, so a cart emptied on the success page updates a shop tab left open.
  window.addEventListener('storage', function (e) {
    if (e.key === CART_KEY) renderCartPill();
  });
  document.addEventListener('DOMContentLoaded', renderCartPill);

  return {
    API: API,
    COUNTRIES: COUNTRIES,
    DEFAULT_COUNTRY_CODE: DEFAULT_COUNTRY_CODE,
    findCountry: findCountry,
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
    indexPacks: indexPacks,
    renderCartPill: renderCartPill
  };
})();
