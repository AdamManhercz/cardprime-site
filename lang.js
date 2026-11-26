// Nyelvválasztás (2026-11-25). A magyar oldalak a gyökér-URL-eken vannak, az angolok az /en/ alatt.
// Minden oldal a <head>-ben, a GTM ELŐTT tölti be (szinkron), hogy az átirányítás még az első
// oldalmegtekintés-mérés előtt megtörténjen. Az oldal párját a <link rel="alternate" hreflang>
// adja meg, így a 404-oldal is a saját párjára mutat, nem egy nem létező útvonalra.
//
// Sorrend:
//   1. ?lang=hu|en az URL-ben (pl. az app nyelve szerinti link) — erre a látogatásra dönt.
//   2. A látogató saját választása (HU | EN kapcsoló), localStorage-ban.
//   3. Ha nincs választás: budapesti időzóna vagy magyar böngészőnyelv → magyar, különben angol.
//      IP-alapú földrajzi helymeghatározás szándékosan nincs: statikus tárhelyen csak egy külső
//      szolgáltatás tudná, ami a látogató IP-címét harmadik félnek adná át (adatkezelés + süti-hozzájárulás).
// Keresőrobotot nem irányítunk át, különben a magyar oldalak nem kerülnének az indexbe.
(function () {
  'use strict';
  var KEY = 'cardprime:lang';
  var here = document.documentElement.lang === 'hu' ? 'hu' : 'en';

  function stored() {
    try { var v = window.localStorage.getItem(KEY); return v === 'hu' || v === 'en' ? v : null; } catch (e) { return null; }
  }
  function store(v) {
    try { window.localStorage.setItem(KEY, v); } catch (e) { /* tiltott tároló: csak nem emlékszünk */ }
  }

  // A kapcsoló kattintása elmenti a választást; a link maga visz át a párra.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-lang]') : null;
    if (a) store(a.getAttribute('data-lang'));
  });

  function detect() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* régi böngésző */ }
    if (tz === 'Europe/Budapest') return 'hu';
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < langs.length; i++) {
      if (String(langs[i]).toLowerCase().indexOf('hu') === 0) return 'hu';
    }
    return 'en';
  }

  if (/bot|crawl|spider|slurp|lighthouse|facebookexternalhit|preview/i.test(navigator.userAgent || '')) return;

  var param = /[?&]lang=(hu|en)\b/.exec(window.location.search);
  var want = param ? param[1] : (stored() || detect());
  if (want === here) return;

  var alt = document.querySelector('link[rel="alternate"][hreflang="' + want + '"]');
  if (!alt) return;
  window.location.replace(alt.href + window.location.search + window.location.hash);
})();
