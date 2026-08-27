/* ==========================================================================
   PROXY SERVER LOG - DOCUMENTATION PAGE CONTROLLER
   Theme sync (shared with the dashboard), scroll-spy TOC, live search,
   copy-to-clipboard, collapsible groups, mobile menu, back-to-top.
   ========================================================================== */

(function () {
  'use strict';

  var THEME_KEY = 'proxy_theme';

  // --- Element handles -----------------------------------------------------
  var docEl = document.documentElement;
  var main = document.getElementById('doc-main');
  var sidebar = document.getElementById('doc-sidebar');
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  var sections = tocLinks
    .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
    .filter(Boolean);
  var searchInput = document.getElementById('doc-search');
  var searchHint = document.getElementById('search-hint');
  var fnRows = Array.prototype.slice.call(document.querySelectorAll('tr.fn-row'));
  var groups = Array.prototype.slice.call(document.querySelectorAll('details.fn-group'));
  var backToTop = document.getElementById('back-to-top');

  // --- Theme (shared with dashboard via localStorage) ----------------------
  function applyDocTheme(theme) {
    docEl.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    var btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.innerHTML = theme === 'dark' ? '&#9788;' : '&#9789;';
  }

  applyDocTheme(localStorage.getItem(THEME_KEY) || 'dark');

  var themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.onclick = function () {
      var next = docEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyDocTheme(next);
    };
  }

  // --- Scroll spy ----------------------------------------------------------
  function setActiveLink(id) {
    tocLinks.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + id);
    });
    var active = document.querySelector('.toc a.active');
    if (active && sidebar) {
      var top = active.offsetTop - sidebar.clientHeight / 2;
      sidebar.scrollTop = Math.max(0, top);
    }
  }

  if ('IntersectionObserver' in window && main) {
    var visible = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible[entry.target.id] = entry.isIntersecting ? entry.intersectionRatio : 0;
      });
      var bestId = null;
      var bestRatio = 0;
      Object.keys(visible).forEach(function (id) {
        if (visible[id] > bestRatio) {
          bestRatio = visible[id];
          bestId = id;
        }
      });
      if (bestId) setActiveLink(bestId);
    }, { root: main, rootMargin: '-10% 0px -55% 0px', threshold: [0, 0.25, 0.5] });

    sections.forEach(function (sec) { observer.observe(sec); });
  }

  tocLinks.forEach(function (a) {
    a.addEventListener('click', function () {
      if (sidebar) sidebar.classList.remove('open');
      var id = a.getAttribute('href').slice(1);
      setActiveLink(id);
    });
  });

  // --- Copy buttons for every code block -----------------------------------
  Array.prototype.slice.call(document.querySelectorAll('.code-block')).forEach(function (block) {
    var head = block.querySelector('.code-head');
    var pre = block.querySelector('pre');
    if (!head || !pre) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function () {
      var text = pre.innerText;
      var done = function () {
        btn.textContent = 'Copied';
        btn.classList.add('done');
        setTimeout(function () {
          btn.textContent = 'Copy';
          btn.classList.remove('done');
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
        done();
      }
    });
    head.appendChild(btn);
  });

  // --- Expand / collapse all function groups --------------------------------
  var expandBtn = document.getElementById('expand-all-btn');
  var collapseBtn = document.getElementById('collapse-all-btn');

  function setAllGroups(open) {
    groups.forEach(function (g) { g.open = open; });
  }

  if (expandBtn) expandBtn.onclick = function () { setAllGroups(true); };
  if (collapseBtn) collapseBtn.onclick = function () { setAllGroups(false); };

  // --- Live search -----------------------------------------------------------
  function resetSearch() {
    searchHint.textContent = '';
    sections.forEach(function (sec) { sec.classList.remove('hidden'); });
    tocLinks.forEach(function (a) { a.classList.remove('hidden'); });
    fnRows.forEach(function (row) { row.classList.remove('hidden'); });
  }

  function runSearch() {
    var q = (searchInput.value || '').trim().toLowerCase();

    if (q.length < 2) {
      resetSearch();
      return;
    }

    var sectionHits = 0;

    sections.forEach(function (sec) {
      var text = sec.textContent.toLowerCase() + ' ' + sec.id;
      var show = text.indexOf(q) !== -1;
      sec.classList.toggle('hidden', !show);
      if (show) sectionHits += 1;
    });

    tocLinks.forEach(function (a) {
      var target = document.getElementById(a.getAttribute('href').slice(1));
      a.classList.toggle('hidden', !target || target.classList.contains('hidden'));
    });

    var rowHits = 0;
    fnRows.forEach(function (row) {
      var match = row.textContent.toLowerCase().indexOf(q) !== -1;
      row.classList.toggle('hidden', !match);
      if (match) rowHits += 1;
    });

    if (rowHits > 0) {
      groups.forEach(function (g) {
        var hasVisible = g.querySelectorAll('tr.fn-row:not(.hidden)').length > 0;
        if (hasVisible) g.open = true;
      });
    }

    searchHint.textContent = sectionHits + ' section' + (sectionHits === 1 ? '' : 's') +
      ', ' + rowHits + ' function row' + (rowHits === 1 ? '' : 's');
  }

  if (searchInput) {
    searchInput.addEventListener('input', runSearch);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchInput.value = '';
        resetSearch();
        searchInput.blur();
      }
      if (e.key === 'Enter') {
        var first = tocLinks.filter(function (a) { return !a.classList.contains('hidden'); })[0];
        if (first) first.click();
      }
    });
  }

  // --- Mobile menu -------------------------------------------------------------
  var menuBtn = document.getElementById('menu-btn');
  if (menuBtn && sidebar) {
    menuBtn.onclick = function () { sidebar.classList.toggle('open'); };
  }

  // --- Back to top (scroll container is .doc-main, not window) -----------------
  if (main && backToTop) {
    main.addEventListener('scroll', function () {
      backToTop.classList.toggle('visible', main.scrollTop > 500);
    });
    backToTop.onclick = function () {
      main.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  // --- Footer date ----------------------------------------------------------------
  var genDate = document.getElementById('gen-date');
  if (genDate) genDate.textContent = new Date().toISOString().slice(0, 10);
})();
