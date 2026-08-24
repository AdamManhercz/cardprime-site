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
