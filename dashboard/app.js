// Harbor Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, and a
// per-protocol detail view with the model's own factors and the protocol's
// farm plan. No network: every byte it shows is in data.js. The detail view
// and the filtered view are reachable by hash, so a screenshot can open them
// directly: #detail=<slug> and #cat=<category>.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', cat: '', status: 'pre', sort: 'implied', dir: -1, selected: null };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function $(id) { return document.getElementById(id); }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (p.get('detail')) state.selected = p.get('detail');
    if (p.get('cat')) state.cat = p.get('cat');
    if (p.get('q')) state.q = p.get('q');
    if (p.get('status')) state.status = p.get('status');
    if (p.get('sort')) state.sort = p.get('sort');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.selected) p.set('detail', state.selected);
    if (state.cat) p.set('cat', state.cat);
    if (state.q) p.set('q', state.q);
    if (state.status !== 'pre') p.set('status', state.status);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.cat && (r.category || 'Other') !== state.cat) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      var av, bv;
      if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return list;
  }

  function rowHtml(r, maxImplied) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var pct = Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100));
    return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></td>' +
      '<td>' + esc(r.category || 'Other') + '</td>' +
      '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num ' + gc + '">' + growth + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '<td><div class="bar"><i style="width:' + pct + '%"></i></div><span class="num">' + fmtUsd(r.implied_value_usd) + '</span></td>' +
      '<td><span class="tag">no token</span></td></tr>';
  }

  function liveHtml(r) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return '<tr><td class="num">live</td>' +
      '<td><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></td>' +
      '<td>' + esc(r.category || 'Other') + '</td>' +
      '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num ' + gc + '">' + growth + '</td>' +
      '<td class="num">—</td>' +
      '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
      '<td><span class="tag live">already trades</span></td></tr>';
  }

  function detailHtml() {
    var box = $('detail');
    if (!state.selected) {
      box.innerHTML = '<p class="detail-empty">Select a row below for its model breakdown and farm plan — or open a detail link directly.</p>';
      return;
    }
    var r = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { r = DATA.rows[i]; break; }
    if (!r) {
      box.innerHTML = '<p class="detail-empty">No protocol matches that detail link.</p>';
      return;
    }
    var steps = (r.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    box.innerHTML = '<h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
      '<p>' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).join(', ') || 'an unnamed chain') +
      ' · TVL ' + fmtUsd(r.tvl_usd) + ' · 7-day ' + fmtPct(r.change_7d) + ' · age ' + fmtAge(r.age_days) +
      ' · records no token.</p>' +
      '<div class="factors">' +
      '<div class="factor"><span>Category multiple</span><b>×' + r.category_multiple.toFixed(2) + '</b><small>' + esc(r.category || 'Other') + '</small></div>' +
      '<div class="factor"><span>Growth factor</span><b>×' + r.growth_factor.toFixed(2) + '</b><small>7-day ' + fmtPct(r.change_7d) + '</small></div>' +
      '<div class="factor"><span>Age factor</span><b>×' + r.age_factor.toFixed(2) + '</b><small>' + fmtAge(r.age_days) + ' with no token</small></div>' +
      '<div class="factor"><span>Breadth factor</span><b>×' + r.breadth_factor.toFixed(2) + '</b><small>' + (r.chains || []).length + ' chain(s)</small></div>' +
      '<div class="factor"><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b><small>model harbor-1</small></div>' +
      '</div>' +
      '<h2>Farm plan</h2><ol class="steps">' + steps + '</ol>';
  }

  function render() {
    $('topmeta').textContent = 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · ' + DATA.model_version + ' model';
    $('modelnote').innerHTML = 'Model <b>' + esc(DATA.model_version) + '</b>: implied = TVL × category multiple × growth factor × age factor × breadth factor. ' +
      'Every row shows its four factors in the detail view.';
    $('stats').innerHTML =
      '<div class="stat"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="stat"><span>Pre-token rows scored</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="stat"><span>Early rows below the floor</span><b>' + DATA.early_size + '</b></div>' +
      '<div class="stat"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>';

    var catSel = $('cat');
    if (catSel.options.length <= 1) {
      var cats = [];
      DATA.rows.forEach(function (r) { var c = r.category || 'Other'; if (cats.indexOf(c) < 0) cats.push(c); });
      cats.sort().forEach(function (c) {
        var o = document.createElement('option');
        o.value = c; o.textContent = c;
        catSel.appendChild(o);
      });
    }
    catSel.value = state.cat;
    $('status').value = state.status;
    $('sort').value = state.sort;
    if ($('q').value !== state.q) $('q').value = state.q;

    var tbody = $('rows');
    var headRow = document.querySelector('#board thead tr');
    if (state.status === 'live') {
      headRow.children[7].textContent = 'Market cap';
      tbody.innerHTML = DATA.live.map(liveHtml).join('');
      $('count').textContent = DATA.live.length + ' live-token protocols';
    } else {
      headRow.children[7].textContent = 'Implied value';
      var list = visibleRows();
      var max = list.length ? list[0].implied_value_usd : 1;
      tbody.innerHTML = list.length ? list.map(function (r) { return rowHtml(r, max); }).join('') :
        '<tr><td colspan="9" class="empty">No protocol matches that filter. Clear the search or pick another category.</td></tr>';
      $('count').textContent = list.length + ' rows shown';
    }
    detailHtml();
  }

  function bind() {
    $('q').addEventListener('input', function () { state.q = this.value; writeHash(); render(); });
    $('cat').addEventListener('change', function () { state.cat = this.value; writeHash(); render(); });
    $('status').addEventListener('change', function () { state.status = this.value; state.selected = null; writeHash(); render(); });
    $('sort').addEventListener('change', function () { state.sort = this.value; writeHash(); render(); });
    document.querySelectorAll('#board thead th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (!k) return;
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === 'name' || k === 'rank' ? 1 : -1; }
        $('sort').value = state.sort;
        writeHash(); render();
      });
    });
    $('rows').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (!tr) return;
      state.selected = tr.getAttribute('data-slug');
      writeHash(); render();
      $('detail').scrollIntoView({ block: 'nearest' });
    });
  }

  readHash();
  bind();
  render();
})();
