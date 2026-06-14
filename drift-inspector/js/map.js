/* ==========================================================================
   map.js — the Map view: WebGL scatter of all claims (v5 design).
   Traces: 0 noise · 1 clustered points · 2 search overlay.
   Cluster labels are layout annotations (not a trace). Every filter / color /
   search / theme change rebuilds via Plotly.react (uirevision keeps the
   viewport unless Auto-fit is on).
   ========================================================================== */
'use strict';

window.MapView = (function () {
  let gd = null, wrap = null;
  let built = false;
  let showLabels = true, showNoise = true, autoFit = false;
  let searchQ = '';
  let pinEl = null;

  /* --------------------------- filtering -------------------------------- */
  function pointLayer(i) {
    const pts = ACC.state.data.points;
    if (ACC.state.year !== 'ALL' && pts.year[i] !== ACC.state.year) return null;
    const cid = pts.cluster[i];
    if (cid === -1) return showNoise ? 'noise' : null;
    const sel = ACC.state.selectedClusters;
    return (!sel.size || sel.has(cid)) ? 'pts' : null;
  }
  function computeIndices() {
    const pts = ACC.state.data.points;
    const noise = [], idx = [];
    for (let i = 0; i < pts.x.length; i++) {
      const l = pointLayer(i);
      if (l === 'noise') noise.push(i);
      else if (l === 'pts') idx.push(i);
    }
    return { noise, pts: idx };
  }
  const sl = (list, arr) => list.map(i => arr[i]);

  function pointColors(idx) {
    const pts = ACC.state.data.points;
    const drift = ACC.state.colorMode === 'drift';
    return idx.map(i => {
      const c = ACC.state.clusterById.get(pts.cluster[i]);
      return drift ? ACC.driftColor(c) : ACC.clusterColor(c);
    });
  }

  function labelAnnotations() {
    const p = ACC.pal();
    const pts = ACC.state.data.points;
    return ACC.state.sorted.slice(0, 15).map(c => {
      const xs = [], ys = [];
      for (let i = 0; i < pts.x.length; i++) {
        if (pts.cluster[i] === c.id) { xs.push(pts.x[i]); ys.push(pts.y[i]); }
      }
      xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
      return {
        x: xs[xs.length >> 1], y: ys[ys.length >> 1], xref: 'x', yref: 'y',
        text: ACC.escapeHtml(c.label), showarrow: false,
        bgcolor: p.labelBg, bordercolor: ACC.clusterColor(c), borderwidth: 1.2, borderpad: 3,
        font: { size: 11.5, color: p.ink, family: "'IBM Plex Sans', sans-serif", weight: 600 },
      };
    });
  }

  /* ------------------------------ search -------------------------------- */
  function searchMatches() {
    if (searchQ.length < 3) return null;
    const pts = ACC.state.data.points, titles = ACC.state.data.titles;
    const xs = [], ys = [], per = new Map();
    let hidden = 0;
    const lq = searchQ.toLowerCase();
    for (let i = 0; i < pts.x.length; i++) {
      if (pts.claim[i].toLowerCase().includes(lq) || titles[pts.paper[i]].toLowerCase().includes(lq)) {
        if (pointLayer(i) === null) { hidden++; continue; }
        xs.push(pts.x[i]); ys.push(pts.y[i]);
        per.set(pts.cluster[i], (per.get(pts.cluster[i]) || 0) + 1);
      }
    }
    return { xs, ys, per, hidden };
  }

  function updateSearchUi() {
    const m = searchMatches();
    const countEl = document.getElementById('map-search-count');
    const box = document.getElementById('search-top');
    if (!m) { countEl.textContent = ''; box.hidden = true; box.innerHTML = ''; return; }
    countEl.textContent = m.xs.length + ' match' + (m.xs.length === 1 ? '' : 'es') +
      (m.hidden ? ` (+${m.hidden} filtered out)` : '');
    const top = [...m.per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!top.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="pop-head">TOP CLUSTERS BY MATCHES</div>';
    for (const [cid, n] of top) {
      const c = cid === -1 ? null : ACC.state.clusterById.get(cid);
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML =
        `<span class="legend-dot" style="background:${ACC.clusterColor(c || { id: -1 })}"></span>` +
        `<span class="legend-name">${c ? ACC.escapeHtml(c.label) : 'Unclustered'}</span>` +
        `<span class="legend-count">${n}</span>`;
      item.title = 'click: isolate on map · double-click: details';
      item.addEventListener('click', () => isolate(cid));
      item.addEventListener('dblclick', () => ACC.emit('open-cluster', cid));
      box.appendChild(item);
    }
    box.hidden = false;
  }

  /* ------------------------------- traces ------------------------------- */
  function mapTraces() {
    const pts = ACC.state.data.points;
    const tt = ACC.tooltips();
    const p = ACC.pal();
    const idx = computeIndices();
    const m = searchMatches();
    return [
      { type: 'scattergl', mode: 'markers', x: sl(idx.noise, pts.x), y: sl(idx.noise, pts.y),
        text: sl(idx.noise, tt), customdata: idx.noise, hoverinfo: 'text',
        marker: { symbol: 'circle-open', size: 3, color: p.noise }, name: 'Unclustered' },
      { type: 'scattergl', mode: 'markers', x: sl(idx.pts, pts.x), y: sl(idx.pts, pts.y),
        text: sl(idx.pts, tt), customdata: idx.pts, hoverinfo: 'text',
        marker: { size: 5.5, color: pointColors(idx.pts), opacity: 0.88 }, name: 'Claims' },
      { type: 'scattergl', mode: 'markers', x: m ? m.xs : [], y: m ? m.ys : [],
        visible: !!(m && m.xs.length), hoverinfo: 'skip',
        marker: { symbol: 'circle-open', size: 13, color: p.ink, line: { width: 2.5, color: p.ink } } },
    ];
  }

  /** Current viewport, or null before the first plot. */
  function currentRanges() {
    if (!gd || !gd._fullLayout || !gd._fullLayout.xaxis) return null;
    return { x: gd._fullLayout.xaxis.range.slice(),
             y: gd._fullLayout.yaxis.range.slice() };
  }

  function draw() {
    // Auto-fit off: pin the viewport explicitly, otherwise Plotly.react
    // re-runs autorange whenever the (filtered) data extents change.
    const keep = autoFit ? null : currentRanges();
    const layout = ACC.plBase({
      showlegend: false,
      margin: { l: 8, r: 8, t: 8, b: 8 },
      xaxis: Object.assign({ visible: false },
        keep ? { range: keep.x, autorange: false } : {}),
      yaxis: Object.assign({ visible: false },
        keep ? { range: keep.y, autorange: false } : {}),
      annotations: showLabels ? labelAnnotations() : [],
      dragmode: 'pan', uirevision: 'keep',
    });
    Plotly.react(gd, mapTraces(), layout,
      ACC.plConfig({ scrollZoom: true, displayModeBar: true }));
    if (autoFit) Plotly.relayout(gd, { 'xaxis.autorange': true, 'yaxis.autorange': true });
    updateSearchUi();
  }
  function refresh() { draw(); }

  /* ------------------------------ pin card ------------------------------ */
  function dismissPin() { if (pinEl) { pinEl.remove(); pinEl = null; } }

  function pinCard(i, px, py) {
    dismissPin();
    const pts = ACC.state.data.points;
    const cid = pts.cluster[i];
    const c = cid === -1 ? null : ACC.state.clusterById.get(cid);
    const years = ACC.state.data.meta.years;
    const card = document.createElement('div');
    card.className = 'pin-card';
    card.dataset.pin = '1';
    let html = '<div class="pin-head">' +
      `<span class="pin-label">${c ? ACC.escapeHtml(c.label) : 'Unclustered claim'}</span>`;
    if (c) {
      const dc = c.deltaPp >= 0 ? 'up-c' : 'down-c';
      html += `<span class="pin-delta ${dc}">${c.deltaPp >= 0 ? '▲ ' : '▼ '}${ACC.fmtPp(c.deltaPp)}</span>`;
    }
    html += '</div>';
    if (c && c.reviewed) html += `<div class="pin-raw">c-TF-IDF · ${ACC.escapeHtml(c.raw)}</div>`;
    html += '<div class="pin-meta">' + (c
      ? `${pts.year[i]} · DF ${years[0]}: ${ACC.fmtPct(c.df[0])} → ${years[years.length - 1]}: ${ACC.fmtPct(c.df[c.df.length - 1])}`
      : `Year ${pts.year[i]}`) + '</div>';
    html += `<div class="pin-claim">${ACC.escapeHtml(pts.claim[i])}</div>`;
    html += `<div class="pin-title">${ACC.escapeHtml(ACC.state.data.titles[pts.paper[i]])}</div>`;
    html += '<div class="pin-actions">' +
      `<a href="${ACC.paperUrl(pts.paper[i])}" target="_blank">Open in Anthology ↗</a>` +
      `<span class="link pin-goto">${c ? 'Cluster details' : 'Unclustered details'} →</span></div>`;
    card.innerHTML = html;
    const rect = wrap.getBoundingClientRect();
    card.style.left = Math.max(8, Math.min(px + 14, rect.width - 360)) + 'px';
    card.style.top = Math.max(8, Math.min(py + 10, rect.height - 250)) + 'px';
    wrap.appendChild(card);
    pinEl = card;
    card.querySelector('.pin-goto')
      .addEventListener('click', () => { dismissPin(); ACC.emit('open-cluster', cid); });
  }

  /* ------------------------------ legend -------------------------------- */
  function renderLegend() {
    const list = document.getElementById('legend-list');
    const lf = document.getElementById('legend-filter').value.trim().toLowerCase();
    const sel = ACC.state.selectedClusters;
    list.innerHTML = '';
    for (const c of ACC.state.sorted) {
      if (lf && !(c.label + ' ' + c.raw).toLowerCase().includes(lf)) continue;
      const isSel = sel.has(c.id);
      const item = document.createElement('div');
      item.className = 'legend-item' + (isSel ? ' selected' : (sel.size ? ' dimmed' : ''));
      item.title = `${c.label} · c-TF-IDF: ${c.raw} · ${c.size} claims · ` +
        `${ACC.fmtPp(c.deltaPp)} (${ACC.fmtRel(c)}) — click: isolate · ctrl/cmd-click: add · double-click: details`;
      item.innerHTML =
        `<span class="legend-dot" style="background:${ACC.clusterColor(c)}"></span>` +
        `<span class="legend-name">${ACC.escapeHtml(c.label)}</span>` +
        `<span class="legend-arrow ${c.deltaPp >= 0 ? 'up' : 'down'}">${ACC.trendArrow(c)}</span>` +
        `<span class="legend-count">${c.size.toLocaleString()}</span>`;
      item.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); }
        else if (sel.size === 1 && sel.has(c.id)) sel.clear();
        else { sel.clear(); sel.add(c.id); }
        renderLegend(); refresh();
      });
      item.addEventListener('dblclick', () => ACC.emit('open-cluster', c.id));
      list.appendChild(item);
    }
  }

  /* ------------------------------ controls ------------------------------ */
  function buildControls() {
    const years = ACC.state.data.meta.years;

    const yb = document.getElementById('year-buttons');
    const mkYear = (label, val) => {
      const b = document.createElement('button');
      b.className = 'seg-btn' + (val === ACC.state.year ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        ACC.state.year = val;
        yb.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        refresh();
      });
      yb.appendChild(b);
    };
    years.forEach(y => mkYear(String(y), y));
    mkYear('All', 'ALL');

    const cb = document.getElementById('color-buttons');
    [['Topics', 'cluster'], ['Drift', 'drift']].forEach(([label, val]) => {
      const b = document.createElement('button');
      b.className = 'seg-btn' + (val === ACC.state.colorMode ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        ACC.state.colorMode = val;
        cb.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        refresh();
      });
      cb.appendChild(b);
    });

    // display popover
    const dBtn = document.getElementById('display-btn');
    const dPop = document.getElementById('display-pop');
    dBtn.addEventListener('click', () => { dPop.hidden = !dPop.hidden; });
    document.addEventListener('mousedown', e => {
      if (!dPop.hidden && !dPop.contains(e.target) && !dBtn.contains(e.target)) dPop.hidden = true;
    });
    document.getElementById('toggle-labels').addEventListener('change', e => {
      showLabels = e.target.checked;
      Plotly.relayout(gd, { annotations: showLabels ? labelAnnotations() : [] });
    });
    document.getElementById('toggle-noise').addEventListener('change', e => {
      showNoise = e.target.checked; refresh();
    });
    document.getElementById('toggle-autofit').addEventListener('change', e => {
      autoFit = e.target.checked;
      if (autoFit) Plotly.relayout(gd, { 'xaxis.autorange': true, 'yaxis.autorange': true });
    });

    // search
    let timer = null;
    document.getElementById('map-search').addEventListener('input', e => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      timer = setTimeout(() => { searchQ = q; refresh(); }, 250);
    });

    // legend
    document.getElementById('legend-filter').addEventListener('input', renderLegend);
    document.getElementById('legend-reset').addEventListener('click', () => {
      ACC.state.selectedClusters.clear(); renderLegend(); refresh();
    });

    // intro
    const overlay = document.getElementById('intro-overlay');
    const closeIntro = () => {
      try { localStorage.setItem('di5.introDismissed', '1'); } catch (e) {}
      overlay.hidden = true;
    };
    document.getElementById('intro-dismiss').addEventListener('click', closeIntro);
    document.getElementById('intro-methods').addEventListener('click', () => { closeIntro(); ACC.emit('switch-view', 'methods'); });
    document.getElementById('reopen-intro').addEventListener('click', () => { overlay.hidden = false; });
    let introDismissed = false;
    try { introDismissed = localStorage.getItem('di5.introDismissed') === '1'; } catch (e) {}
    overlay.hidden = introDismissed;
  }

  /* ------------------------------- build -------------------------------- */
  function build() {
    if (built) return;
    built = true;
    gd = document.getElementById('map-plot');
    wrap = document.getElementById('map-plot-wrap');

    draw();
    gd.on('plotly_click', ev => {
      if (!ev.points || !ev.points.length) return;
      const pt = ev.points[0];
      if (pt.curveNumber > 1) return;              // ignore search overlay
      const i = pt.customdata;
      const rect = wrap.getBoundingClientRect();
      const px = ev.event.clientX - rect.left, py = ev.event.clientY - rect.top;
      setTimeout(() => pinCard(i, px, py), 0);
    });
    document.addEventListener('mousedown', e => {
      if (pinEl && !e.target.closest('[data-pin]')) dismissPin();
    });

    buildControls();
    renderLegend();
  }

  function activate() {
    build();
    if (gd && gd.data) Plotly.Plots.resize(gd);
  }

  function isolate(cid) {
    ACC.state.selectedClusters.clear();
    ACC.state.selectedClusters.add(cid);
    // Isolating the unclustered layer only makes sense with noise visible.
    if (cid === -1 && !showNoise) {
      showNoise = true;
      const t = document.getElementById('toggle-noise');
      if (t) t.checked = true;
    }
    if (built) { renderLegend(); refresh(); }
  }

  function rebuildTheme() {
    if (!built) return;
    dismissPin();
    draw();
    renderLegend();
  }

  return { activate, isolate, rebuildTheme };
})();
