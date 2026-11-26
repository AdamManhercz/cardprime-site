// /checkout/ és /en/checkout/ — vendég pénztár, három lépésben:
//   1. adatok (név, e-mail, telefon, számlázási cím, opcionálisan külön szállítási cím)
//   2. szállítás (Foxpost / GLS / személyes átvétel, csomagpont-választóval)
//   3. áttekintés → createOrder → átirányítás a Stripe fizetési oldalára.
// Fizetés után a Stripe webhookja (stripe_webhook_handler.py) jelöli fizetettnek a rendelést,
// ő állítja ki a Számlázz.hu számlát és adja fel a csomagot; a vevő a /checkout/success/
// oldalra érkezik vissza, ami a getOrderStatus-t kérdezi le, és ott ürül a kosár.
//
// A szabályok a backend packs_handler.py _create_order-ét és az app CheckoutScreen.tsx-ét
// követik: ami itt átmegy, azt a backend sem utasítja el. A végső döntés mindig a backendé.
//
// Zárt boltban (shop.js SHOP_OPEN = false) a pénztár nem jelenik meg, és nincs API-hívás.
// ?preview esetén a lépések bejárhatók (csak olvasó hívásokkal: listPacks, getPricing), de a
// rendelés gombja zárva marad — createOrder csak SHOP_OPEN = true mellett indulhat.
(function () {
  'use strict';
  var Shop = window.CardPrimeShop;
  var HU = document.documentElement.lang === 'hu';
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var T = HU ? {
    names: { 'single-pack': 'Csomag', 'box-of-4': 'Doboz', 'double-box': 'Dupla doboz' },
    remove: 'Törlés', less: 'eggyel kevesebb', more: 'eggyel több',
    required: 'Kötelező mező.', email: 'Érvénytelen e-mail-cím.', postcode: 'Négyjegyű magyar irányítószám kell.',
    house: 'Csak a házszám száma (pl. 17).', info: 'Legfeljebb 60 karakter.',
    phoneFoxpost: 'A Foxpost csak magyar mobilszámmal (+36 20/30/31/50/51/70) működik.',
    chooseCarrier: 'Válassz szállítási módot.', chooseMode: 'Válaszd ki, hogyan kéred.',
    chooseFoxpost: 'Válassz Foxpost-automatát.', chooseGls: 'Válassz GLS-csomagpontot.',
    unavailable: 'Ez a mód ide nem elérhető.', pricingLoading: 'Az árak betöltése…',
    pricingFailed: 'Most nem érjük el az árakat. Próbáld újra egy perc múlva.',
    carriers: { foxpost: 'Foxpost', gls: 'GLS', store: 'Személyes átvétel' },
    carrierSub: { foxpost: 'Automata vagy házhoz', gls: 'Csomagpont vagy házhoz', glsAbroad: 'Házhoz szállítás', store: 'King of Hoops, Budapest' },
    modes: { pickup: 'Csomagpontba', home: 'Házhoz' },
    modeSub: { foxpost: { pickup: 'Foxpost-automatába', home: 'Futárral a címedre' }, gls: { pickup: 'GLS-csomagpontba vagy -automatába', home: 'Futárral a címedre' } },
    methods: { foxpost_locker: 'Foxpost-automata', gls_locker: 'GLS-csomagpont', foxpost_home: 'Foxpost házhoz', gls_home: 'GLS házhoz', store: 'Személyes átvétel – King of Hoops' },
    free: 'Ingyenes', notAvailable: 'nem elérhető', calcLater: 'a 2. lépésben',
    ptLoading: 'A pontok betöltése…', ptFailed: 'A pontlistát most nem értük el. Próbáld újra.', ptNone: 'Nincs találat erre a keresésre.',
    ptMore: function (n) { return 'További ' + n + ' találat — pontosíts a keresésen.'; },
    ptFull: 'majdnem tele', ptPicked: 'Kiválasztva: ',
    foreignOnly: 'Külföldi címre GLS házhoz szállítással vagy személyes átvétellel kérheted.',
    review: { contact: 'Kapcsolat', billing: 'Számlázási cím', shipping: 'Szállítás', delivery: 'Szállítási cím', edit: 'Módosítás' },
    payClosed: 'Hamarosan', pay: 'Fizetési kötelezettséggel járó megrendelés', paying: 'Átirányítás a Stripe-ra…',
    orderFailed: 'A rendelést nem sikerült leadni: ', emptyStep: 'A kosarad üres.',
    vatNote: function (p) { return 'Az árak bruttó árak, ' + p + '% áfát tartalmaznak.'; },
    stockShort: 'Ennyi csomag most nincs raktáron — csökkentsd a mennyiséget.'
  } : {
    names: { 'single-pack': 'Pack', 'box-of-4': 'Box', 'double-box': 'Double box' },
    remove: 'Remove', less: 'one fewer', more: 'one more',
    required: 'Required.', email: 'That email address is not valid.', postcode: 'A Hungarian postal code has 4 digits.',
    house: 'The house number only, as digits (e.g. 17).', info: 'At most 60 characters.',
    phoneFoxpost: 'Foxpost needs a Hungarian mobile number (+36 20/30/31/50/51/70).',
    chooseCarrier: 'Choose a delivery option.', chooseMode: 'Choose how you want it delivered.',
    chooseFoxpost: 'Choose a Foxpost locker.', chooseGls: 'Choose a GLS ParcelShop.',
    unavailable: 'This option is not available for that address.', pricingLoading: 'Loading prices…',
    pricingFailed: 'We could not load prices just now. Please try again in a minute.',
    carriers: { foxpost: 'Foxpost', gls: 'GLS', store: 'Store pickup' },
    carrierSub: { foxpost: 'Locker or home delivery', gls: 'ParcelShop or home delivery', glsAbroad: 'Home delivery', store: 'King of Hoops, Budapest' },
    modes: { pickup: 'Pickup point', home: 'Home delivery' },
    modeSub: { foxpost: { pickup: 'To a Foxpost locker', home: 'By courier to your address' }, gls: { pickup: 'To a GLS ParcelShop or locker', home: 'By courier to your address' } },
    methods: { foxpost_locker: 'Foxpost locker', gls_locker: 'GLS ParcelShop', foxpost_home: 'Foxpost home delivery', gls_home: 'GLS home delivery', store: 'Store pickup – King of Hoops' },
    free: 'Free', notAvailable: 'not available', calcLater: 'in step 2',
    ptLoading: 'Loading pickup points…', ptFailed: 'We could not load the pickup points. Please try again.', ptNone: 'Nothing matches that search.',
    ptMore: function (n) { return n + ' more — narrow your search.'; },
    ptFull: 'nearly full', ptPicked: 'Selected: ',
    foreignOnly: 'For an address outside Hungary we offer GLS home delivery or store pickup.',
    review: { contact: 'Contact', billing: 'Billing address', shipping: 'Delivery', delivery: 'Delivery address', edit: 'Change' },
    payClosed: 'Coming soon', pay: 'Order with obligation to pay', paying: 'Taking you to Stripe…',
    orderFailed: 'We could not place the order: ', emptyStep: 'Your cart is empty.',
    vatNote: function (p) { return 'Prices include ' + p + '% VAT.'; },
    stockShort: 'We do not have that many packs in stock right now — lower the quantity.'
  };

  var IMAGES = { 'single-pack': 'pack_front', 'box-of-4': 'box_front', 'double-box': 'box_double_fb' };
  var STORE_MAPS = 'https://www.google.com/maps/search/?api=1&query=King+of+Hoops+Budapest+Ap%C3%A1czai+Csere+J%C3%A1nos+u.+17';
  var FOXPOST_FEED = 'https://cdn.foxpost.hu/foxplus.json';
  var GLS_FEED = 'https://map.gls-hungary.com/data/deliveryPoints/hu.json';
  var HU_MOBILE = /^(\+36|36)(20|30|31|70|50|51)\d{7}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var FORM_KEY = 'cardprime:checkout:v1';

  var open = Shop.SHOP_OPEN || Shop.PREVIEW;
  if (!open) {
    // Zárt bolt: csak a „hamarosan” sáv látszik, a pénztár el sem indul.
    $('#co-closed').hidden = false;
    return;
  }
  if (!Shop.SHOP_OPEN) $('#co-preview').hidden = false;

  var state = {
    step: 1, packsById: {}, poolStock: null, packsLoaded: false,
    pricing: {}, pricingFailed: {}, carrier: null, mode: null, point: null,
    attempted: { 1: false, 2: false, 3: false }, submitting: false
  };

  // --- segédek ---------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function money(cents) { return Shop.formatPrice(cents, 'huf'); }
  function countryName(code) {
    for (var i = 0; i < Shop.COUNTRIES.length; i++) if (Shop.COUNTRIES[i].code === code) return HU ? Shop.COUNTRIES[i].hu : Shop.COUNTRIES[i].en;
    return code;
  }
  function dialOf(code) {
    for (var i = 0; i < Shop.COUNTRIES.length; i++) if (Shop.COUNTRIES[i].code === code) return Shop.COUNTRIES[i].dial;
    return '';
  }

  function fillCountrySelects() {
    $$('select[data-countries]').forEach(function (sel) {
      var dial = sel.hasAttribute('data-dial');
      sel.innerHTML = Shop.COUNTRIES.map(function (c) {
        var label = dial ? c.dial + ' ' + c.code : (HU ? c.hu : c.en);
        return '<option value="' + c.code + '">' + esc(label) + '</option>';
      }).join('');
      sel.value = 'HU';
    });
  }

  // --- űrlap mentése a fülön belül ---------------------------------------------
  // sessionStorage: ha a vevő a Stripe-oldalon a „vissza”-t választja, ne kelljen mindent
  // újra beírnia. Csak ebben a fülben él, a fül bezárásával törlődik.
  var SAVED_IDS = ['lastName', 'firstName', 'email', 'phoneCountry', 'phone', 'b_country', 'b_postcode', 'b_city', 'b_street', 'b_house', 'b_info',
                   'd_country', 'd_postcode', 'd_city', 'd_street', 'd_house', 'd_info'];
  function saveForm() {
    var data = { sep: $('#sepDelivery').checked };
    SAVED_IDS.forEach(function (id) { data[id] = document.getElementById(id).value; });
    try { window.sessionStorage.setItem(FORM_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }
  function restoreForm() {
    var data = null;
    try { data = JSON.parse(window.sessionStorage.getItem(FORM_KEY) || 'null'); } catch (e) { data = null; }
    if (!data) return;
    SAVED_IDS.forEach(function (id) { if (typeof data[id] === 'string') document.getElementById(id).value = data[id]; });
    $('#sepDelivery').checked = !!data.sep;
  }

  // --- cím ------------------------------------------------------------------
  function address(prefix) {
    return {
      country: val(prefix + '_country'), postalCode: val(prefix + '_postcode'), city: val(prefix + '_city'),
      line1: val(prefix + '_street'), houseNumber: val(prefix + '_house'), line2: val(prefix + '_info')
    };
  }
  function toPayload(a) {
    var out = { line1: a.line1, houseNumber: a.houseNumber, city: a.city, postalCode: a.postalCode, country: a.country };
    if (a.line2) out.line2 = a.line2;
    return out;
  }
  function addressText(a) {
    return a.postalCode + ' ' + a.city + ', ' + a.line1 + ' ' + a.houseNumber + (a.line2 ? ' (' + a.line2 + ')' : '') + ', ' + countryName(a.country);
  }
  function addressErrors(prefix, errs) {
    var a = address(prefix);
    if (!a.postalCode) errs[prefix + '_postcode'] = T.required;
    else if (a.country === 'HU' && !/^[1-9]\d{3}$/.test(a.postalCode)) errs[prefix + '_postcode'] = T.postcode;
    if (!a.city) errs[prefix + '_city'] = T.required;
    if (!a.line1) errs[prefix + '_street'] = T.required;
    if (!a.houseNumber) errs[prefix + '_house'] = T.required;
    else if (!/^\d{1,6}$/.test(a.houseNumber) || parseInt(a.houseNumber, 10) < 1) errs[prefix + '_house'] = T.house;
    if (a.line2.length > 60) errs[prefix + '_info'] = T.info;
  }

  // Magyar irányítószám → település és utcajavaslat a pult oldal jegyzékéből (/pult/irsz.json,
  // Magyar Posta). Csak magyar címnél; a vevő bármikor felülírhatja kézzel.
  var irsz = { promise: null, data: null };
  function loadIrsz() {
    if (!irsz.promise) {
      irsz.promise = fetch('/pult/irsz.json', { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('irsz'); return r.json(); })
        .then(function (d) { irsz.data = d; return d; })
        .catch(function () { irsz.promise = null; return null; });
    }
    return irsz.promise;
  }
  function onPostcode(prefix) {
    var code = val(prefix + '_postcode');
    var cityList = document.getElementById(prefix + '_cities');
    var streetList = document.getElementById(prefix + '_streets');
    if (val(prefix + '_country') !== 'HU' || !/^\d{4}$/.test(code)) { cityList.innerHTML = ''; streetList.innerHTML = ''; return; }
    loadIrsz().then(function (d) {
      if (!d || val(prefix + '_postcode') !== code) return;
      var cities = (d.c && d.c[code]) || [];
      var streets = (d.s && d.s[code]) || [];
      cityList.innerHTML = cities.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
      streetList.innerHTML = streets.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('');
      var city = document.getElementById(prefix + '_city');
      if (cities.length === 1 && cities.indexOf(city.value.trim()) < 0) { city.value = cities[0]; saveForm(); }
    });
  }

  // --- kosár + összesítő ------------------------------------------------------
  function deliveryCountry() { return $('#sepDelivery').checked ? val('d_country') : val('b_country'); }
  function domestic() { return deliveryCountry() === 'HU' && val('b_country') === 'HU'; }
  function priceMode() { return state.carrier === 'store' ? 'pickup' : state.mode; }
  function currentPricing() { return state.pricing[deliveryCountry()] || null; }

  function linePrice(line) {
    var pricing = currentPricing();
    var mode = priceMode();
    if (pricing && mode && pricing.packs[line.packId]) return pricing.packs[line.packId][mode];
    var pack = state.packsById[line.packId];
    return pack ? pack.priceCents : null;
  }
  function shippingFee() {
    var pricing = currentPricing();
    var mode = priceMode();
    if (!pricing || !state.carrier || !mode) return undefined;
    var c = pricing.shipping[state.carrier];
    return c ? c[mode] : null;
  }

  function renderSummary() {
    var lines = Shop.readCart();
    var empty = lines.length === 0;
    $('#co-empty').hidden = !empty;
    $('#co').hidden = empty;
    if (empty) return;
    var list = $('#lines');
    list.innerHTML = lines.map(function (l) {
      var pack = state.packsById[l.packId];
      var name = T.names[l.packId] || (pack && pack.name) || l.packId;
      var price = linePrice(l);
      var img = IMAGES[l.packId] ? '<img src="/assets/shop/' + IMAGES[l.packId] + '-thumb.webp" alt="" width="64" height="64">' : '<span></span>';
      return '<li class="line" data-line="' + esc(l.packId) + '">' + img +
        '<div class="line__body"><div class="line__top"><span>' + esc(name) + '</span><span>' +
        (price != null ? money(price * l.quantity) : '') + '</span></div>' +
        '<div class="line__ctl"><div class="qty qty--sm">' +
        '<button type="button" data-q="-1" aria-label="' + esc(name + ': ' + T.less) + '"' + (l.quantity <= 1 ? ' disabled' : '') + '>−</button>' +
        '<output aria-live="polite">' + l.quantity + '</output>' +
        '<button type="button" data-q="1" aria-label="' + esc(name + ': ' + T.more) + '">+</button></div>' +
        '<button type="button" class="line__rm" data-rm aria-label="' + esc(T.remove + ': ' + name) + '">' + esc(T.remove) + '</button></div></div></li>';
    }).join('');

    var items = 0, known = true;
    lines.forEach(function (l) { var p = linePrice(l); if (p == null) known = false; else items += p * l.quantity; });
    var fee = shippingFee();
    $('#t-items').textContent = known ? money(items) : '–';
    var shipRow = $('#t-ship');
    shipRow.parentNode.classList.toggle('muted', fee === undefined);
    shipRow.textContent = fee === undefined ? T.calcLater : fee === null ? T.notAvailable : fee === 0 ? T.free : money(fee);
    $('#t-total').textContent = known && typeof fee === 'number' ? money(items + fee) : (known ? money(items) + '+' : '–');
    var pricing = currentPricing();
    var vat = pricing && priceMode() ? pricing.vatRatePercent[priceMode()] : null;
    $('#t-vat').textContent = vat != null ? T.vatNote(vat) : '';

    // A közös csomagkészlet és a 40-es plafon: ha a kosár túllépi, szólunk, a gomb zárva.
    var used = Shop.packsInCart(lines, state.packsById);
    var cap = state.poolStock === null ? Shop.MAX_ORDER_PACKS : Math.min(Shop.MAX_ORDER_PACKS, state.poolStock);
    var over = state.packsLoaded && used > cap;
    $('#cart-err').textContent = over ? T.stockShort : '';
    $('#cart-err').hidden = !over;
    $$('#lines [data-q="1"]').forEach(function (b) {
      var pack = state.packsById[b.closest('[data-line]').getAttribute('data-line')];
      var per = pack ? Math.max(1, parseInt(pack.packCount, 10) || 1) : 1;
      b.disabled = state.packsLoaded && used + per > cap;
    });
  }

  $('#lines').addEventListener('click', function (ev) {
    var li = ev.target.closest('[data-line]');
    if (!li) return;
    var id = li.getAttribute('data-line');
    var q = ev.target.closest('[data-q]');
    if (q && !q.disabled) {
      var line = Shop.readCart().filter(function (l) { return l.packId === id; })[0];
      if (line) Shop.setQuantity(id, line.quantity + parseInt(q.getAttribute('data-q'), 10));
    } else if (ev.target.closest('[data-rm]')) {
      Shop.removeFromCart(id);
    }
  });
  document.addEventListener('cardprime:cart-changed', renderSummary);

  // --- árak ------------------------------------------------------------------
  function ensurePricing(country) {
    // Hiba után NEM próbálkozunk magától újra (minden render ide fut → végtelen hívási
    // hurok lenne a Lambdára); újra csak a „Tovább” gomb kéri (next()).
    if (state.pricing[country] || state.pricing[country] === 0 || state.pricingFailed[country]) return;
    state.pricing[country] = 0; // folyamatban
    Shop.getPricing(country).then(function (p) {
      state.pricing[country] = p;
      render();
    }).catch(function () {
      delete state.pricing[country];
      state.pricingFailed[country] = true;
      render();
    });
  }

  // --- 2. lépés: szállítás -----------------------------------------------------
  function carriersAvailable() { return domestic() ? ['foxpost', 'gls', 'store'] : ['gls', 'store']; }
  function modesFor(carrier) {
    if (carrier === 'store') return ['pickup'];
    if (!domestic()) return ['home'];
    return ['pickup', 'home'];
  }
  function method() {
    if (!state.carrier || !state.mode) return null;
    if (state.carrier === 'store') return 'store_pickup';
    if (state.mode === 'home') return 'home_delivery';
    return state.carrier === 'foxpost' ? 'foxpost_locker' : 'gls_locker';
  }
  function methodLabel() {
    var m = method();
    if (m === 'store_pickup') return T.methods.store;
    if (m === 'home_delivery') return T.methods[state.carrier + '_home'];
    return m ? T.methods[m] : '';
  }

  function feeText(carrier, mode) {
    var pricing = currentPricing();
    if (!pricing) return '';
    var c = pricing.shipping[carrier];
    var fee = c ? c[mode] : null;
    if (fee === null || fee === undefined) return T.notAvailable;
    return fee === 0 ? T.free : money(fee);
  }

  // Ország- vagy szállítóváltáskor a már nem kínált választás nem maradhat kiválasztva.
  function normalizeChoice() {
    var carriers = carriersAvailable();
    if (state.carrier && carriers.indexOf(state.carrier) < 0) { state.carrier = null; state.mode = null; state.point = null; }
    if (state.carrier) {
      var modes = modesFor(state.carrier);
      if (modes.length === 1) state.mode = modes[0];
      else if (state.mode && modes.indexOf(state.mode) < 0) state.mode = null;
    }
    if (state.point && (state.point.carrier !== state.carrier || state.mode !== 'pickup' || state.carrier === 'store')) state.point = null;
  }

  function renderStep2() {
    normalizeChoice();
    var carriers = carriersAvailable();
    $('#carriers').innerHTML = carriers.map(function (c) {
      var sub = c === 'gls' && !domestic() ? T.carrierSub.glsAbroad : T.carrierSub[c];
      var price = c === 'store' ? feeText('store', 'pickup') : '';
      return '<label class="choice"><input type="radio" name="carrier" value="' + c + '"' + (state.carrier === c ? ' checked' : '') + '>' +
        '<b>' + esc(T.carriers[c]) + '</b><span>' + esc(sub) + (price ? ' · ' + esc(price) : '') + '</span></label>';
    }).join('');
    $('#foreign-note').textContent = T.foreignOnly;
    $('#foreign-note').hidden = domestic();

    var modes = state.carrier ? modesFor(state.carrier) : [];
    var showModes = state.carrier && state.carrier !== 'store';
    $('#modes-wrap').hidden = !showModes;
    if (showModes) {
      $('#modes').innerHTML = modes.map(function (m) {
        var fee = feeText(state.carrier, m);
        return '<label class="choice"><input type="radio" name="mode" value="' + m + '"' + (state.mode === m ? ' checked' : '') +
          (fee === T.notAvailable ? ' disabled' : '') + '>' +
          '<b>' + esc(T.modes[m]) + '</b><span>' + esc(T.modeSub[state.carrier][m]) + (fee ? ' · ' + esc(fee) : '') + '</span></label>';
      }).join('');
    }
    $('#store-info').hidden = state.carrier !== 'store';
    var pickupCarrier = state.mode === 'pickup' && state.carrier !== 'store' ? state.carrier : null;
    $('#picker').hidden = !pickupCarrier;
    if (pickupCarrier) renderPicker(pickupCarrier);
    $('#home-note').hidden = !(state.mode === 'home' && state.carrier !== 'store');
    if (state.mode === 'home') $('#home-addr').textContent = addressText(address($('#sepDelivery').checked ? 'd' : 'b'));
  }

  $('#carriers').addEventListener('change', function (ev) {
    if (ev.target.name !== 'carrier') return;
    state.carrier = ev.target.value;
    if (state.point && state.point.carrier !== state.carrier) state.point = null;
    render();
  });
  $('#modes').addEventListener('change', function (ev) {
    if (ev.target.name !== 'mode') return;
    state.mode = ev.target.value;
    render();
  });

  // --- csomagpont-választó -------------------------------------------------------
  // A két szállító nyilvános pontlistája (mindkettő CORS-szal elérhető). Nagyok (Foxpost
  // ~7 MB, GLS ~2 MB), ezért csak akkor töltjük le, amikor a vevő csomagpontot választ.
  var feeds = { foxpost: { promise: null, points: null }, gls: { promise: null, points: null } };
  function loadFeed(carrier) {
    var f = feeds[carrier];
    if (f.promise) return f.promise;
    f.promise = fetch(carrier === 'foxpost' ? FOXPOST_FEED : GLS_FEED, { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('feed'); return r.json(); })
      .then(function (raw) {
        var pts = [];
        if (carrier === 'foxpost') {
          (Array.isArray(raw) ? raw : []).forEach(function (p) {
            var id = p.operator_id || p.place_id;
            if (!id || !p.name) return;
            pts.push({ carrier: 'foxpost', id: String(id), name: p.name, zip: String(p.zip || ''), city: p.city || '',
                       address: p.address || [p.zip, p.city].join(' '), full: p.load === 'overloaded' });
          });
        } else {
          ((raw && raw.items) || []).forEach(function (p) {
            if (p.lockerSaturation === 'outOfOrder' || (p.features || []).indexOf('delivery') < 0 || !p.contact) return;
            pts.push({ carrier: 'gls', id: String(p.id), name: p.name, zip: String(p.contact.postalCode || ''), city: p.contact.city || '',
                       address: [p.contact.postalCode, p.contact.city].join(' ') + ', ' + (p.contact.address || ''), full: p.lockerSaturation === 'highVolume' });
          });
        }
        pts.forEach(function (p) { p.hay = fold(p.name + ' ' + p.address + ' ' + p.zip + ' ' + p.city); });
        f.points = pts;
        return pts;
      })
      .catch(function (e) { f.promise = null; throw e; });
    return f.promise;
  }

  var pickerFor = null;
  function renderPicker(carrier) {
    $('#picker-title').textContent = (carrier === 'foxpost' ? T.chooseFoxpost : T.chooseGls).replace(/\.$/, '');
    var picked = $('#pt-picked');
    picked.hidden = !state.point;
    if (state.point) picked.textContent = T.ptPicked + state.point.name + ' — ' + state.point.address;
    var search = $('#pt-search');
    if (pickerFor !== carrier) {
      pickerFor = carrier;
      // Első megnyitáskor a szállítási cím irányítószámára keresünk rá.
      if (!search.value) search.value = val($('#sepDelivery').checked ? 'd_postcode' : 'b_postcode');
    }
    var f = feeds[carrier];
    if (!f.points) {
      $('#pt-status').textContent = T.ptLoading;
      $('#pt-list').innerHTML = '';
      loadFeed(carrier).then(function () { if (pickerFor === carrier) renderPicker(carrier); })
        .catch(function () { if (pickerFor === carrier) $('#pt-status').textContent = T.ptFailed; });
      return;
    }
    var q = fold(search.value.trim()).split(/\s+/).filter(Boolean);
    var hits = f.points.filter(function (p) { return q.every(function (w) { return p.hay.indexOf(w) >= 0; }); });
    // Pontos irányítószám-egyezés előre, aztán ABC.
    var zip = /^\d{4}$/.test(search.value.trim()) ? search.value.trim() : null;
    hits.sort(function (a, b) {
      if (zip) { var az = a.zip === zip ? 0 : 1, bz = b.zip === zip ? 0 : 1; if (az !== bz) return az - bz; }
      return a.zip.localeCompare(b.zip) || a.name.localeCompare(b.name);
    });
    var LIMIT = 40;
    $('#pt-list').innerHTML = hits.slice(0, LIMIT).map(function (p, i) {
      var on = state.point && state.point.id === p.id && state.point.carrier === p.carrier;
      return '<li><button type="button" data-pt="' + i + '" aria-pressed="' + (on ? 'true' : 'false') + '"><b>' + esc(p.name) + '</b>' +
        '<span>' + esc(p.address) + (p.full ? ' · <span class="warn">' + esc(T.ptFull) + '</span>' : '') + '</span></button></li>';
    }).join('');
    $('#pt-list').hitList = hits;
    $('#pt-status').textContent = !hits.length ? T.ptNone : hits.length > LIMIT ? T.ptMore(hits.length - LIMIT) : '';
  }
  $('#pt-search').addEventListener('input', function () { if (pickerFor) renderPicker(pickerFor); });
  $('#pt-list').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-pt]');
    if (!b) return;
    var p = $('#pt-list').hitList[parseInt(b.getAttribute('data-pt'), 10)];
    if (!p) return;
    state.point = p;
    render();
  });

  // --- hibák ------------------------------------------------------------------
  function errorsFor(step) {
    var e = {};
    if (step === 1) {
      if (!val('lastName')) e.lastName = T.required;
      if (!val('firstName')) e.firstName = T.required;
      if (!val('email')) e.email = T.required; else if (!EMAIL_RE.test(val('email'))) e.email = T.email;
      if (!val('phone')) e.phone = T.required;
      addressErrors('b', e);
      if ($('#sepDelivery').checked) addressErrors('d', e);
    }
    if (step === 2) {
      var pricing = currentPricing();
      if (!pricing) e.s2 = state.pricingFailed[deliveryCountry()] ? T.pricingFailed : T.pricingLoading;
      else if (!state.carrier) e.s2 = T.chooseCarrier;
      else if (!state.mode) e.s2 = T.chooseMode;
      else if (shippingFee() === null) e.s2 = T.unavailable;
      else if (state.mode === 'pickup' && state.carrier !== 'store' && !state.point) e.s2 = state.carrier === 'foxpost' ? T.chooseFoxpost : T.chooseGls;
      else if (state.carrier === 'foxpost' && !HU_MOBILE.test(composedPhone().replace(/\s/g, ''))) e.s2 = T.phoneFoxpost;
    }
    return e;
  }

  function showErrors(step) {
    var e = state.attempted[step] ? errorsFor(step) : {};
    if (step === 1) {
      $$('#step1 [data-err]').forEach(function (el) {
        var key = el.getAttribute('data-err');
        el.textContent = e[key] || '';
        var input = document.getElementById(key);
        if (input) { if (e[key]) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
      });
    }
    if (step === 2) { $('#s2-err').textContent = e.s2 || ''; $('#s2-err').hidden = !e.s2; }
    return e;
  }

  function composedPhone() { return val('phone') ? dialOf(val('phoneCountry')) + ' ' + val('phone') : ''; }

  // --- 3. lépés: áttekintés -----------------------------------------------------
  function renderReview() {
    var sep = $('#sepDelivery').checked;
    var rows = [
      [T.review.contact, val('lastName') && (HU ? val('lastName') + ' ' + val('firstName') : val('firstName') + ' ' + val('lastName')) + '\n' + val('email') + '\n' + composedPhone(), 1],
      [T.review.billing, addressText(address('b')), 1],
      [T.review.shipping, methodLabel() + (state.point ? '\n' + state.point.name + ' — ' + state.point.address : '') +
        (state.carrier === 'store' ? '\nApáczai Csere János u. 17, 1051 Budapest' : ''), 2]
    ];
    if (method() === 'home_delivery') rows.push([T.review.delivery, addressText(address(sep ? 'd' : 'b')), 1]);
    $('#review').innerHTML = rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]).replace(/\n/g, '<br>') +
        '<br><button type="button" data-goto="' + r[2] + '">' + esc(T.review.edit) + '</button></dd></div>';
    }).join('');
    var pay = $('#pay');
    pay.disabled = !Shop.SHOP_OPEN || state.submitting;
    pay.textContent = !Shop.SHOP_OPEN ? T.payClosed : state.submitting ? T.paying : T.pay;
  }
  $('#review').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-goto]');
    if (b) goTo(parseInt(b.getAttribute('data-goto'), 10));
  });

  // --- lépések -------------------------------------------------------------------
  function render() {
    $$('#steps li').forEach(function (li) {
      var n = parseInt(li.getAttribute('data-step'), 10);
      if (n === state.step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('is-done', n < state.step);
    });
    [1, 2, 3].forEach(function (n) { $('#step' + n).hidden = n !== state.step; });
    $('#sep-fields').hidden = !$('#sepDelivery').checked;
    if (state.step >= 2) { ensurePricing(deliveryCountry()); renderStep2(); }
    if (state.step === 3) renderReview();
    showErrors(state.step);
    renderSummary();
  }

  function goTo(step) {
    state.step = step;
    render();
    var top = $('#co').getBoundingClientRect().top + window.scrollY - 96;
    if (window.scrollY > top) window.scrollTo({ top: top, behavior: 'smooth' });
    var heading = $('#step' + step + ' h2');
    if (heading) heading.focus({ preventScroll: true });
  }

  function next(step) {
    state.attempted[step] = true;
    if (step === 2 && state.pricingFailed[deliveryCountry()]) {
      state.pricingFailed[deliveryCountry()] = false;
      render();
    }
    var e = showErrors(step);
    var keys = Object.keys(e);
    if (keys.length) {
      var first = document.getElementById(keys[0]) || $('#s2-err');
      if (first && first.focus) first.focus();
      return;
    }
    goTo(step + 1);
  }

  $('#next1').addEventListener('click', function () { next(1); });
  $('#next2').addEventListener('click', function () { next(2); });
  $('#back2').addEventListener('click', function () { goTo(1); });
  $('#back3').addEventListener('click', function () { goTo(2); });

  $('#step1').addEventListener('input', function (ev) {
    saveForm();
    var id = ev.target.id;
    if (id === 'b_postcode' || id === 'b_country') onPostcode('b');
    if (id === 'd_postcode' || id === 'd_country') onPostcode('d');
    if (id === 'b_country' && val('b_country') !== 'HU' && val('phoneCountry') === 'HU' && !val('phone')) {
      $('#phoneCountry').value = val('b_country');
    }
    if (state.attempted[1]) showErrors(1);
  });
  $('#sepDelivery').addEventListener('change', function () { saveForm(); render(); });

  // --- rendelés ---------------------------------------------------------------
  // Csak SHOP_OPEN = true mellett: createOrder → a backend lefoglalja a csomagokat, létrehozza
  // a Stripe Checkout Sessiont, és visszaadja a checkoutUrl-t, ahová átirányítunk.
  $('#pay').addEventListener('click', function () {
    if (!Shop.SHOP_OPEN || state.submitting) return;
    var e1 = errorsFor(1), e2 = errorsFor(2);
    if (Object.keys(e1).length) { state.attempted[1] = true; goTo(1); return; }
    if (Object.keys(e2).length) { state.attempted[2] = true; goTo(2); return; }
    var lines = Shop.readCart();
    if (!lines.length) { renderSummary(); return; }
    var m = method();
    var payload = {
      items: lines.map(function (l) { return { packId: l.packId, quantity: l.quantity }; }),
      customerName: val('firstName') + ' ' + val('lastName'),
      customerEmail: val('email'),
      customerPhone: composedPhone(),
      shippingMethod: m,
      // Mindig megy: ebből készül a Számlázz.hu számla, bármilyen a szállítás módja.
      shippingAddress: toPayload(address('b'))
    };
    if (m === 'home_delivery') {
      payload.homeCarrier = state.carrier;
      if ($('#sepDelivery').checked) payload.deliveryAddress = toPayload(address('d'));
    }
    if (m === 'foxpost_locker') { payload.foxpostLockerId = state.point.id; payload.foxpostLockerName = state.point.name; }
    if (m === 'gls_locker') { payload.glsPointId = state.point.id; payload.glsPointName = state.point.name; }

    state.submitting = true;
    $('#s3-err').hidden = true;
    renderReview();
    Shop.createOrder(payload).then(function (res) {
      if (!res || !res.checkoutUrl) throw new Error('checkoutUrl');
      window.location.assign(res.checkoutUrl);
    }).catch(function (err) {
      state.submitting = false;
      $('#s3-err').textContent = T.orderFailed + ((err && err.message) || '');
      $('#s3-err').hidden = false;
      renderReview();
    });
  });

  // --- indulás -----------------------------------------------------------------
  fillCountrySelects();
  restoreForm();
  $('#store-maps').href = STORE_MAPS;
  onPostcode('b');
  if ($('#sepDelivery').checked) onPostcode('d');
  $('#co-main').hidden = false;
  render();
  Shop.listPacks().then(function (data) {
    state.packsById = Shop.indexPacks((data && data.packs) || []);
    state.poolStock = typeof data.poolStock === 'number' ? data.poolStock : null;
    state.packsLoaded = true;
    renderSummary();
  }).catch(function () { renderSummary(); });
})();
