// Pontoldal fülsora (Points · Levels · Quests): egyszerre egy panel látszik.
// JS nélkül a fülsor rejtve marad és minden szakasz egymás alatt olvasható.
// A hash követi a választást (#points, #levels, #quests), így a link megosztható;
// a régi horgonyok (#overview, #card-points) a Points fülre visznek.
(function () {
  var bar = document.querySelector('.tabs');
  if (!bar) return;
  var tabs = Array.prototype.slice.call(bar.querySelectorAll('[role="tab"]'));
  var ALIAS = { overview: 'points', 'card-points': 'points' };

  function select(name, focus, push) {
    var found = false;
    tabs.forEach(function (tab) {
      var on = tab.id === 'tab-' + name;
      if (on) found = true;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) tab.focus();
    });
    if (!found) return select('points', focus, push);
    if (push && history.replaceState) history.replaceState(null, '', '#' + name);
  }

  function fromHash() {
    var h = location.hash.replace('#', '');
    return ALIAS[h] || h || 'points';
  }

  tabs.forEach(function (tab, i) {
    var name = tab.id.replace('tab-', '');
    tab.addEventListener('click', function () {
      select(name, false, true);
      var top = bar.getBoundingClientRect().top + window.scrollY - 96;
      if (window.scrollY > top) window.scrollTo({ top: top });
    });
    tab.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var next = tabs[(i + d + tabs.length) % tabs.length];
      select(next.id.replace('tab-', ''), true, true);
    });
  });

  window.addEventListener('hashchange', function () { select(fromHash(), false, false); });
  bar.hidden = false;
  select(fromHash(), false, false);
})();
