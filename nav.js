// Site menu: <details> handles opening on its own; this only closes it again
// when the user clicks away or presses Escape, which <details> does not do.
(function () {
  var menu = document.querySelector('.site-nav details');
  if (!menu) return;

  document.addEventListener('click', function (e) {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      var summary = menu.querySelector('summary');
      if (summary) summary.focus();
    }
  });
})();

// Cart icon: the count beside the menu. It lives here rather than in shop.js because
// the icon is on every page, and the legal pages do not load the storefront script.
// It only reads the cart — shop.js stays the one place that writes it.
(function () {
  var link = document.querySelector('.site-nav .cart-link');
  if (!link) return;
  var badge = link.querySelector('.cart-count');

  // ⚠️ The same key as CART_KEY in shop.js. Rename one, rename both.
  var CART_KEY = 'cardprime:cart:v1';

  // Every access is wrapped for the same reason as in shop.js: blocked storage throws
  // on the accessor itself, and a page has to render without a count.
  function count() {
    var lines;
    try { lines = JSON.parse(window.localStorage.getItem(CART_KEY) || '[]'); } catch (e) { return 0; }
    if (!Array.isArray(lines)) return 0;
    var total = 0;
    for (var i = 0; i < lines.length; i++) {
      var qty = parseInt(lines[i] && lines[i].quantity, 10);
      if (qty >= 1) total += qty;
    }
    return total;
  }

  function render() {
    var n = count();
    if (badge) {
      badge.hidden = !n;
      badge.textContent = n > 99 ? '99+' : String(n);
    }
    link.setAttribute('aria-label', !n ? 'Cart, empty' : n === 1 ? 'Cart, 1 item' : 'Cart, ' + n + ' items');
  }

  render();
  document.addEventListener('cardprime:cart-changed', render);
  // Another tab is the same cart: localStorage fires `storage` in every other document
  // on this origin, so a cart emptied on the success page updates a shop tab left open.
  window.addEventListener('storage', function (e) {
    if (e.key === CART_KEY) render();
  });
})();
