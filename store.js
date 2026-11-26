// /shop/ és /en/shop/ — a három ajánlat kosárba tétele.
//
// Az árak, a megtakarítás és az összetétel statikusan a HTML-ben vannak (így a lap API
// nélkül is teljes), nyitott boltban pedig a listPacks élő számai írják felül őket. A
// termék nevét és leírását NEM a backendből vesszük: azok egynyelvűek, a lap kétnyelvű.
//
// Zárt boltban (shop.js SHOP_OPEN = false) a gombok „Hamarosan” feliratúak és inaktívak,
// és a lap egyetlen API-hívást sem indít.
(function () {
  'use strict';
  var Shop = window.CardPrimeShop;
  var HU = document.documentElement.lang === 'hu';
  var T = HU ? {
    add: 'Kosárba', added: 'Kosárban ✓', soon: 'Hamarosan', soldOut: 'Elfogyott', full: 'Nem fér a kosárba',
    perPack: ' csomagonként · ', save: '% megtakarítás', left: function (n) { return 'Még ' + n + ' db'; }
  } : {
    add: 'Add to cart', added: 'In your cart ✓', soon: 'Coming soon', soldOut: 'Sold out', full: 'Cart is full',
    perPack: ' per pack · ', save: '% saving', left: function (n) { return n + ' left'; }
  };

  var open = Shop.SHOP_OPEN || Shop.PREVIEW;
  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-pack]'));
  var packsById = {};
  var poolStock = null;

  function qtyOf(card) { return parseInt(card.querySelector('[data-qty] output').textContent, 10) || 1; }

  // Hány darab fér még ebből a kosárba: a közös csomagkészlet (poolStock) és a rendelésenkénti
  // 40 csomagos plafon, a kosárban lévő tételekkel együtt — ugyanaz a számítás, mint a backendé.
  function roomFor(packId) {
    var pack = packsById[packId];
    var per = pack ? Math.max(1, parseInt(pack.packCount, 10) || 1) : 1;
    var used = Shop.packsInCart(Shop.readCart(), packsById);
    var cap = Shop.MAX_ORDER_PACKS;
    if (poolStock !== null) cap = Math.min(cap, poolStock);
    return Math.max(0, Math.floor((cap - used) / per));
  }

  function setQty(card, n) {
    var max = open ? Math.max(1, roomFor(card.getAttribute('data-pack'))) : 1;
    n = Math.min(Math.max(1, n), max, Shop.MAX_LINE_QUANTITY);
    card.querySelector('[data-qty] output').textContent = String(n);
    var steps = card.querySelectorAll('[data-step]');
    steps[0].disabled = !open || n <= 1;
    steps[1].disabled = !open || n >= max;
  }

  function refreshButton(card) {
    var btn = card.querySelector('[data-add]');
    var pack = packsById[card.getAttribute('data-pack')];
    btn.classList.remove('is-added');
    if (!open) { btn.disabled = true; btn.textContent = T.soon; return; }
    if (pack && pack.stock <= 0) { btn.disabled = true; btn.textContent = T.soldOut; return; }
    if (roomFor(card.getAttribute('data-pack')) < 1) { btn.disabled = true; btn.textContent = T.full; return; }
    btn.disabled = false;
    btn.textContent = T.add;
  }

  function refreshAll() {
    cards.forEach(function (card) { refreshButton(card); setQty(card, qtyOf(card)); });
  }

  // Élő árak: a dupla doboz „2 × …” alakban (bundleCount), a csomagonkénti ár és a
  // megtakarítás a sima csomag árához mérve.
  function applyPrices() {
    var single = packsById['single-pack'];
    cards.forEach(function (card) {
      var pack = packsById[card.getAttribute('data-pack')];
      if (!pack) return;
      var bundle = Math.max(1, parseInt(pack.bundleCount, 10) || 1);
      var packCount = Math.max(1, parseInt(pack.packCount, 10) || 1);
      var priceEl = card.querySelector('[data-price]');
      priceEl.textContent = bundle > 1
        ? bundle + ' × ' + Shop.formatPrice(Math.round(pack.priceCents / bundle), pack.currency)
        : Shop.formatPrice(pack.priceCents, pack.currency);
      var perEl = card.querySelector('[data-per-pack]');
      if (perEl && single && packCount > 1) {
        var per = Math.round(pack.priceCents / packCount);
        var pct = Math.round((1 - per / single.priceCents) * 100);
        perEl.innerHTML = '';
        perEl.appendChild(document.createTextNode(Shop.formatPrice(per, pack.currency) + T.perPack));
        var s = document.createElement('span');
        s.className = 'save';
        s.textContent = pct + T.save;
        perEl.appendChild(s);
      }
      var stockEl = card.querySelector('[data-stock]');
      if (stockEl) {
        stockEl.hidden = !(pack.stock > 0 && pack.stock <= 10);
        stockEl.textContent = T.left(pack.stock);
      }
    });
  }

  cards.forEach(function (card) {
    card.querySelectorAll('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () { setQty(card, qtyOf(card) + parseInt(b.getAttribute('data-step'), 10)); });
    });
    var btn = card.querySelector('[data-add]');
    btn.addEventListener('click', function () {
      if (!open || btn.disabled) return;
      var packId = card.getAttribute('data-pack');
      var qty = Math.min(qtyOf(card), roomFor(packId));
      if (qty < 1) { refreshButton(card); return; }
      Shop.addToCart(packId, qty);
      btn.textContent = T.added;
      btn.classList.add('is-added');
      window.setTimeout(function () { refreshAll(); }, 1400);
      setQty(card, 1);
    });
  });

  refreshAll();
  if (!open) return;

  Shop.listPacks().then(function (data) {
    var packs = (data && data.packs) || [];
    packsById = Shop.indexPacks(packs);
    poolStock = typeof data.poolStock === 'number' ? data.poolStock : null;
    applyPrices();
    refreshAll();
  }).catch(function () {
    // Az API nélkül is vásárolható marad a lap: a statikus árak érvényesek, a pénztár
    // úgyis újraolvassa az élő számokat, és a createOrder dönt a készletről.
  });
  document.addEventListener('cardprime:cart-changed', function () { cards.forEach(function (c) { setQty(c, qtyOf(c)); }); });
})();
