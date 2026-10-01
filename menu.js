// Menü-toggle: nyit/zár, Escape és a panelen kívüli Tab kezelése, fókusz visszaadása.
// Jogi oldalakon a tartalomjegyzék kiemeli az éppen olvasott szakaszt.
(function () {
  var toggle = document.querySelector('[data-menu-toggle]');
  var menu = document.getElementById('site-menu');
  if (toggle && menu) {
    var bar = toggle.closest('.bar');

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.classList.toggle('is-open', open);
      document.body.classList.toggle('menu-open', open);
      if (open) {
        var first = menu.querySelector('a');
        if (first) first.focus({ preventScroll: true });
      } else {
        toggle.focus({ preventScroll: true });
      }
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    document.addEventListener('keydown', function (e) {
      if (!menu.classList.contains('is-open')) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      // A fókusz a sávban és a panelen belül marad, amíg a menü nyitva van.
      var items = Array.prototype.slice.call(bar.querySelectorAll('a, button'))
        .concat(Array.prototype.slice.call(menu.querySelectorAll('a')));
      var i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    });

    // Oldalon belüli horgony után a panel bezárul, különben eltakarná a célt.
    menu.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (a && a.getAttribute('href').charAt(0) === '#') setOpen(false);
    });
  }

  var toc = document.querySelectorAll('.toc a');
  if (toc.length && 'IntersectionObserver' in window) {
    var byId = {};
    toc.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        toc.forEach(function (a) { a.classList.remove('is-here'); a.removeAttribute('aria-current'); });
        var a = byId[e.target.id];
        if (a) { a.classList.add('is-here'); a.setAttribute('aria-current', 'location'); }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('.legal section[id]').forEach(function (s) { io.observe(s); });
  }
})();
