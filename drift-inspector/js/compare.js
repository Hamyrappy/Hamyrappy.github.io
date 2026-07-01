/* ==========================================================================
   compare.js — Compare view: thematic profiles of subsamples.
   A subsample (cohort) is defined by conference (venue), author, or keyword set.
   - Each cohort gets its OWN profile diagram (treemap of its topic mix).
   - With two cohorts, a dumbbell ranks the clusters where they differ most.
   - "Over time" shows a single subsample's drift across years (stacked area /
     lines), so you can watch a venue/author/keyword move year to year.
   One or two cohorts (leave B empty to study just one). All client-side.
   ========================================================================== */
'use strict';

window.CompareView = (function () {
  let built = false;
  let claims = null;            // unified claim stream across all sources
  let nameToId = null;          // author display name -> id
  let metric = 'mix';           // 'mix' = % of claims · 'df' = % of papers
  let scope = 'ALL';            // 'ALL' | <year> | 'overtime'
  let A = null, B = null;       // cohort definitions {type, value}
  const TOP_TREEMAP = 22, TOP_DIFF = 16, TOP_DRIFT = 8;
  let profileMode = 'treemap';   // 'treemap' | 'bars'
  let diffMode = 'diverging';    // 'diverging' | 'dumbbell' | 'scatter'
  let driftMode = 'bump';        // 'bump' | 'stacked'

  // A small segmented view-switcher; onPick(value) re-renders.
  function modeSeg(current, opts, onPick) {
    const seg = document.createElement('div');
    seg.className = 'seg cmp-modeseg';
    opts.forEach(([v, l]) => {
      const b = document.createElement('button');
      b.className = 'seg-btn' + (v === current ? ' active' : '');
      b.textContent = l;
      b.addEventListener('click', () => onPick(v));
      seg.appendChild(b);
    });
    return seg;
  }

  /* --------------------------- data assembly ---------------------------- */
  function sources() { return ACC.state.data.sources || []; }
  function venues() { return sources().map(s => s.venue); }
  function venueColor(v) { const s = sources().find(x => x.venue === v); return s ? s.color : ACC.pal().acc; }

  function buildClaims() {
    const d = ACC.state.data, out = [];
    // All venues live in `points`, tagged by `points.source` (index into sources).
    const srcs = sources(), P = d.points, abp = d.authorsByPaper || [], src = P.source || [];
    for (let i = 0; i < P.x.length; i++) {
      const venue = (srcs[src[i]] || {}).venue || '?';
      out.push({ y: P.year[i], c: P.cluster[i], pk: src[i] + ':' + P.paper[i], venue,
                 aids: abp[P.paper[i]] || [], t: P.claim[i].toLowerCase() });
    }
    const idx = d.authorsIndex || {}, byName = {};
    for (const id in idx) { const [nm, n] = idx[id]; if (!byName[nm] || n > byName[nm][1]) byName[nm] = [id, n]; }
    nameToId = {}; for (const nm in byName) nameToId[nm] = byName[nm][0];
    return out;
  }

  /* ----------------------------- cohorts -------------------------------- */
  function predicate(cohort) {
    if (!cohort || cohort.type === 'none') return null;
    if (cohort.type === 'venue') return cl => cl.venue === cohort.value;
    if (cohort.type === 'author') { const id = cohort.value; return id ? (cl => cl.aids.includes(id)) : null; }
    if (cohort.type === 'keyword') {
      const terms = String(cohort.value || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
      return terms.length ? (cl => terms.some(t => cl.t.includes(t))) : null;
    }
    return null;
  }
  function isSet(cohort) { return !!predicate(cohort); }

  function profileAt(cohort, year) {
    const pred = predicate(cohort);
    const byC = new Map(), papers = new Set();
    let nClaims = 0;
    if (pred) for (const cl of claims) {
      if (year !== 'ALL' && cl.y !== year) continue;
      if (!pred(cl)) continue;
      nClaims++; papers.add(cl.pk);
      if (cl.c === -1) continue;
      if (metric === 'df') { if (!byC.has(cl.c)) byC.set(cl.c, new Set()); byC.get(cl.c).add(cl.pk); }
      else byC.set(cl.c, (byC.get(cl.c) || 0) + 1);
    }
    const denom = metric === 'df' ? papers.size : nClaims;
    const out = new Map();
    for (const [c, v] of byC) { const num = metric === 'df' ? v.size : v; out.set(c, denom ? num / denom * 100 : 0); }
    return { nPapers: papers.size, nClaims, byCluster: out };
  }

  function cohortLabel(cohort) {
    if (!cohort || cohort.type === 'none') return '—';
    if (cohort.type === 'venue') return cohort.value;
    if (cohort.type === 'author') { const idx = ACC.state.data.authorsIndex || {}; return cohort.value && idx[cohort.value] ? idx[cohort.value][0] : 'author?'; }
    if (cohort.type === 'keyword') return '“' + (cohort.value || '…') + '”';
    return '—';
  }
  function cohortColor(cohort) {
    if (cohort && cohort.type === 'venue') return venueColor(cohort.value);
    return cohort === A ? ACC.pal().acc : ACC.pal().mut;
  }
  function clusterLabel(c) { const cl = ACC.state.clusterById.get(c); return cl ? cl.label : ('cluster ' + c); }
  function metricWord() { return metric === 'df' ? '% of papers' : '% of claims'; }

  /* ------------------------------ render -------------------------------- */
  function draw() {
    const cohorts = [A, B].filter(isSet);
    drawSummary();
    if (scope === 'overtime') { drawDrift(cohorts); document.getElementById('compare-versus').innerHTML = ''; }
    else { drawProfiles(cohorts); drawVersus(); }
  }

  function drawSummary() {
    const el = document.getElementById('compare-summary');
    const yr = scope === 'ALL' ? 'all years' : (scope === 'overtime' ? 'over time' : scope);
    const chip = (cohort, tag) => {
      if (!isSet(cohort)) return '';
      const p = profileAt(cohort, scope === 'overtime' ? 'ALL' : scope);
      const warn = p.nPapers < 5 ? ' <span class="cmp-warn">small sample</span>' : '';
      return `<span class="cmp-chip" style="border-left-color:${cohortColor(cohort)}"><b>${tag}</b> ` +
        `${ACC.escapeHtml(cohortLabel(cohort))} · ${p.nPapers.toLocaleString()} papers · ${p.nClaims.toLocaleString()} claims${warn}</span>`;
    };
    el.innerHTML = chip(A, 'A') + chip(B, 'B') +
      `<span class="cmp-note">${metricWord()} · ${yr}</span>`;
  }

  /* -- per-cohort profile treemaps (each subsample's own diagram) --------- */
  function drawProfiles(cohorts) {
    const host = document.getElementById('profile-panels');
    host.innerHTML = '';
    host.style.display = 'flex'; host.style.flexDirection = 'column'; host.style.gap = '10px';
    if (!cohorts.length) { host.innerHTML = '<div class="cmp-empty">Pick a subsample to see its topic profile.</div>'; return; }
    const bar = document.createElement('div'); bar.className = 'panel-modes';
    bar.innerHTML = '<span class="ctl-label">TOPICS AS</span>';
    bar.appendChild(modeSeg(profileMode, [['treemap', 'Treemap'], ['bars', 'Ranked bars']],
      v => { profileMode = v; draw(); }));
    host.appendChild(bar);
    const grid = document.createElement('div'); grid.className = 'panel-grid';
    grid.style.gridTemplateColumns = cohorts.length === 2 ? '1fr 1fr' : '1fr';
    host.appendChild(grid);
    cohorts.forEach((cohort, k) => {
      const panel = document.createElement('div');
      panel.className = 'profile-panel';
      panel.innerHTML = `<div class="panel-h"><span class="panel-tag" style="background:${cohortColor(cohort)}">${k === 0 ? 'A' : 'B'}</span>` +
        `<span class="panel-ttl">${ACC.escapeHtml(cohortLabel(cohort))}</span></div><div class="panel-plot"></div>`;
      grid.appendChild(panel);
      (profileMode === 'bars' ? drawRankedBars : drawTreemap)(panel.querySelector('.panel-plot'), cohort);
    });
  }

  /* -- ranked horizontal bars (readable per-cohort profile) -------------- */
  function drawRankedBars(div, cohort) {
    const prof = profileAt(cohort, scope === 'overtime' ? 'ALL' : scope);
    const entries = [...prof.byCluster.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_TREEMAP);
    if (!entries.length) { div.innerHTML = '<div class="cmp-empty">No claims in this subsample.</div>'; return; }
    const p = ACC.pal();
    const rows = entries.slice().reverse();   // largest on top
    Plotly.react(div, [{
      type: 'bar', orientation: 'h',
      y: rows.map(([c]) => clusterLabel(c)),
      x: rows.map(([, v]) => +v.toFixed(2)),
      marker: { color: rows.map(([c]) => ACC.clusterColor(ACC.state.clusterById.get(c) || { id: c })) },
      text: rows.map(([, v]) => v.toFixed(1) + '%'), textposition: 'outside',
      textfont: { size: 9.5, color: p.fnt }, cliponaxis: false,
      customdata: rows.map(([c]) => c),
      hovertemplate: `%{y}<br>%{x:.1f}% ${metric === 'df' ? 'of papers' : 'of claims'}<extra></extra>`,
    }], ACC.plBase({
      height: Math.max(300, rows.length * 20 + 40),
      margin: { l: 190, r: 46, t: 6, b: 26 },
      xaxis: { gridcolor: p.line, tickfont: { size: 9.5, color: p.fnt }, rangemode: 'tozero', ticksuffix: '%' },
      yaxis: { tickfont: { size: 10.5, color: p.ink2 }, gridcolor: 'rgba(0,0,0,0)', automargin: true },
      bargap: 0.28,
    }), ACC.plConfig({ displayModeBar: false }));
    div.on('plotly_click', ev => {
      const c = ev.points && ev.points[0] && ev.points[0].customdata;
      if (typeof c === 'number' && c >= 0) ACC.emit('open-cluster', c);
    });
  }

  function drawTreemap(div, cohort) {
    const prof = profileAt(cohort, scope === 'overtime' ? 'ALL' : scope);
    const entries = [...prof.byCluster.entries()].sort((a, b) => b[1] - a[1]);
    if (!entries.length) { div.innerHTML = '<div class="cmp-empty">No claims in this subsample.</div>'; return; }
    const top = entries.slice(0, TOP_TREEMAP), rest = entries.slice(TOP_TREEMAP);
    const labels = [], values = [], colors = [], cdata = [];
    for (const [c, v] of top) { labels.push(clusterLabel(c)); values.push(+v.toFixed(2)); colors.push(ACC.clusterColor(ACC.state.clusterById.get(c) || { id: c })); cdata.push(c); }
    if (rest.length) { labels.push('other (' + rest.length + ')'); values.push(+rest.reduce((a, [, v]) => a + v, 0).toFixed(2)); colors.push(ACC.pal().line2); cdata.push(-99); }
    const p = ACC.pal();
    Plotly.react(div, [{
      type: 'treemap', labels, values, parents: labels.map(() => ''), customdata: cdata,
      marker: { colors, line: { width: 1, color: p.plot } },
      textinfo: 'label+value', texttemplate: '%{label}<br>%{value:.1f}%',
      textfont: { size: 11, color: '#fff', family: "'IBM Plex Sans', sans-serif" },
      hovertemplate: `%{label}<br>%{value:.1f}% ${metric === 'df' ? 'of papers' : 'of claims'}<extra></extra>`,
      tiling: { pad: 1 }, branchvalues: 'remainder',
    }], ACC.plBase({ height: 360, margin: { l: 4, r: 4, t: 4, b: 4 } }),
      ACC.plConfig({ displayModeBar: false }));
    div.removeAllListeners && div.removeAllListeners('plotly_treemapclick');
    div.on('plotly_click', ev => {
      const c = ev.points && ev.points[0] && ev.points[0].customdata;
      if (typeof c === 'number' && c >= 0) ACC.emit('open-cluster', c);
    });
  }

  /* -- two-cohort comparison: dumbbell of the biggest gaps --------------- */
  function drawVersus() {
    const host = document.getElementById('compare-versus');
    if (!(isSet(A) && isSet(B))) { host.innerHTML = ''; return; }
    const pa = profileAt(A, scope === 'overtime' ? 'ALL' : scope);
    const pb = profileAt(B, scope === 'overtime' ? 'ALL' : scope);
    const ids = new Set([...pa.byCluster.keys(), ...pb.byCluster.keys()]);
    const rows = [...ids].map(c => {
      const a = pa.byCluster.get(c) || 0, b = pb.byCluster.get(c) || 0;
      return { c, a, b, d: a - b, label: clusterLabel(c) };
    }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, TOP_DIFF);

    host.innerHTML = '';
    const head = document.createElement('div'); head.className = 'versus-head';
    head.innerHTML = '<span class="versus-h">Where they differ most</span>';
    head.appendChild(modeSeg(diffMode,
      [['diverging', 'Diverging'], ['dumbbell', 'Dumbbell'], ['scatter', 'Scatter']],
      v => { diffMode = v; draw(); }));
    host.appendChild(head);
    const plot = document.createElement('div'); host.appendChild(plot);
    const hl = document.createElement('div'); hl.className = 'compare-headlines'; host.appendChild(hl);

    const cA = cohortColor(A), cB = cohortColor(B);
    if (diffMode === 'dumbbell') drawDumbbell(plot, rows, cA, cB);
    else if (diffMode === 'scatter') drawScatter(plot, rows, cA, cB);
    else drawDiverging(plot, rows, cA, cB);
    drawHeadlines(hl, rows, cA, cB);
  }

  function drawDiverging(div, rows, cA, cB) {
    const p = ACC.pal();
    const r = rows.slice().sort((x, y) => x.d - y.d);          // B-leaning at the bottom
    Plotly.react(div, [{
      type: 'bar', orientation: 'h', y: r.map(x => x.label), x: r.map(x => +x.d.toFixed(2)),
      marker: { color: r.map(x => x.d >= 0 ? cA : cB) },
      customdata: r.map(x => [x.a, x.b]),
      text: r.map(x => (x.d >= 0 ? '+' : '') + x.d.toFixed(1)), textposition: 'outside',
      textfont: { size: 9, color: p.fnt }, cliponaxis: false,
      hovertemplate: `<b>%{y}</b><br>${ACC.escapeHtml(cohortLabel(A))}: %{customdata[0]:.1f}%25 · ` +
        `${ACC.escapeHtml(cohortLabel(B))}: %{customdata[1]:.1f}%25<br>Δ %{x:+.1f} pp<extra></extra>`,
    }], ACC.plBase({
      height: Math.max(280, r.length * 24 + 60), margin: { l: 200, r: 46, t: 8, b: 40 },
      xaxis: { title: { text: `◀ ${cohortLabel(B)}   ·   Δ ${metricWord()}   ·   ${cohortLabel(A)} ▶`, font: { size: 10, color: p.mut } },
               zeroline: true, zerolinecolor: p.line2, gridcolor: p.line, tickfont: { size: 9.5, color: p.fnt } },
      yaxis: { tickfont: { size: 10.5, color: p.ink2 }, gridcolor: 'rgba(0,0,0,0)', automargin: true },
      bargap: 0.3,
    }), ACC.plConfig({ displayModeBar: false }));
    div.on('plotly_click', ev => { const i = ev.points[0].pointIndex; if (r[i]) ACC.emit('open-cluster', r[i].c); });
  }

  function drawDumbbell(div, rows, cA, cB) {
    const p = ACC.pal();
    const r = rows.slice().sort((x, y) => x.d - y.d);
    const lx = [], ly = [];
    r.forEach(x => { lx.push(x.a, x.b, null); ly.push(x.label, x.label, null); });
    const mk = (key, color, tag) => ({ type: 'scatter', mode: 'markers',
      x: r.map(x => x[key]), y: r.map(x => x.label), marker: { size: 10, color }, name: tag,
      hovertemplate: `<b>%{y}</b><br>${ACC.escapeHtml(tag)}: %{x:.1f}%<extra></extra>` });
    Plotly.react(div, [
      { type: 'scatter', mode: 'lines', x: lx, y: ly, line: { color: p.line2, width: 2 }, hoverinfo: 'skip', showlegend: false },
      mk('a', cA, cohortLabel(A)), mk('b', cB, cohortLabel(B)),
    ], ACC.plBase({
      height: Math.max(280, r.length * 24 + 70), margin: { l: 200, r: 24, t: 8, b: 42 },
      xaxis: { title: { text: metricWord(), font: { size: 10.5, color: p.mut } }, gridcolor: p.line, rangemode: 'tozero', tickfont: { size: 9.5, color: p.fnt }, ticksuffix: '%' },
      yaxis: { tickfont: { size: 10.5, color: p.ink2 }, gridcolor: 'rgba(0,0,0,0)', automargin: true },
      legend: { orientation: 'h', y: -0.14, font: { size: 10.5, color: p.ink2 } }, hovermode: 'closest',
    }), ACC.plConfig({ displayModeBar: false }));
  }

  function drawScatter(div, rows, cA, cB) {
    const p = ACC.pal();
    const mx = Math.max(1, ...rows.map(r => Math.max(r.a, r.b)));
    Plotly.react(div, [
      { type: 'scatter', mode: 'lines', x: [0, mx], y: [0, mx], line: { color: p.line2, width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false },
      { type: 'scatter', mode: 'markers+text', x: rows.map(r => r.a), y: rows.map(r => r.b),
        text: rows.map(r => r.label), textposition: 'top center', textfont: { size: 8.5, color: p.fnt },
        marker: { size: 9, color: rows.map(r => r.d >= 0 ? cA : cB), line: { width: 0.5, color: p.plot } },
        customdata: rows.map(r => r.c),
        hovertemplate: `<b>%{text}</b><br>${ACC.escapeHtml(cohortLabel(A))}: %{x:.1f}%25 · ${ACC.escapeHtml(cohortLabel(B))}: %{y:.1f}%25<extra></extra>` },
    ], ACC.plBase({
      height: 440, margin: { l: 52, r: 20, t: 10, b: 46 },
      xaxis: { title: { text: cohortLabel(A) + ' · ' + metricWord(), font: { size: 10.5, color: p.mut } }, gridcolor: p.line, rangemode: 'tozero', tickfont: { size: 9.5, color: p.fnt }, ticksuffix: '%' },
      yaxis: { title: { text: cohortLabel(B) + ' · ' + metricWord(), font: { size: 10.5, color: p.mut } }, gridcolor: p.line, rangemode: 'tozero', tickfont: { size: 9.5, color: p.fnt }, ticksuffix: '%' },
      hovermode: 'closest', showlegend: false,
    }), ACC.plConfig({ displayModeBar: false }));
    div.on('plotly_click', ev => { const c = ev.points[0].customdata; if (typeof c === 'number' && c >= 0) ACC.emit('open-cluster', c); });
  }

  function drawHeadlines(el, rows, cA, cB) {
    const aTop = rows.filter(r => r.d > 0).sort((x, y) => y.d - x.d).slice(0, 4);
    const bTop = rows.filter(r => r.d < 0).sort((x, y) => x.d - y.d).slice(0, 4);
    const list = arr => arr.length ? arr.map(r => `<li>${ACC.escapeHtml(r.label)} <span class="cmp-pp">${ACC.fmtPp(r.d)}</span></li>`).join('') : '<li class="cmp-dim">—</li>';
    el.innerHTML =
      `<div class="cmp-col"><div class="cmp-col-h" style="color:${cA}">${ACC.escapeHtml(cohortLabel(A))} leans toward</div><ul>${list(aTop)}</ul></div>` +
      `<div class="cmp-col"><div class="cmp-col-h" style="color:${cB}">${ACC.escapeHtml(cohortLabel(B))} leans toward</div><ul>${list(bTop)}</ul></div>`;
  }

  /* -- single-subsample drift over years --------------------------------- */
  function drawDrift(cohorts) {
    const host = document.getElementById('profile-panels');
    host.innerHTML = '';
    host.style.display = 'flex'; host.style.flexDirection = 'column'; host.style.gap = '10px';
    if (!cohorts.length) { host.innerHTML = '<div class="cmp-empty">Pick a subsample to see how it drifts over the years.</div>'; return; }
    const bar = document.createElement('div'); bar.className = 'panel-modes';
    bar.innerHTML = '<span class="ctl-label">DRIFT AS</span>';
    bar.appendChild(modeSeg(driftMode, [['bump', 'Bump chart'], ['stacked', 'Stacked area']],
      v => { driftMode = v; draw(); }));
    host.appendChild(bar);
    const grid = document.createElement('div'); grid.className = 'panel-grid';
    grid.style.gridTemplateColumns = cohorts.length === 2 ? '1fr 1fr' : '1fr';
    host.appendChild(grid);
    cohorts.forEach((cohort, k) => {
      const panel = document.createElement('div');
      panel.className = 'profile-panel';
      panel.innerHTML = `<div class="panel-h"><span class="panel-tag" style="background:${cohortColor(cohort)}">${k === 0 ? 'A' : 'B'}</span>` +
        `<span class="panel-ttl">${ACC.escapeHtml(cohortLabel(cohort))} · drift over time</span></div><div class="panel-plot"></div>`;
      grid.appendChild(panel);
      (driftMode === 'bump' ? drawBump : drawDriftPlot)(panel.querySelector('.panel-plot'), cohort);
    });
  }

  /* -- bump chart: how the top topics' RANKS move year to year ----------- */
  function drawBump(div, cohort) {
    const years = ACC.state.data.meta.years;
    const prof = years.map(y => profileAt(cohort, y));
    const perYear = prof.map(pp => pp.byCluster);
    const gapped = prof.some(pp => pp.nPapers === 0);   // non-annual venue → dashed
    const totals = new Map();
    perYear.forEach(mp => mp.forEach((v, c) => totals.set(c, (totals.get(c) || 0) + v)));
    if (!totals.size) { div.innerHTML = '<div class="cmp-empty">No claims in this subsample.</div>'; return; }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_DRIFT).map(e => e[0]);
    const rankByYear = perYear.map(mp => {
      const rk = new Map();
      [...mp.entries()].sort((a, b) => b[1] - a[1]).forEach(([c], i) => rk.set(c, i + 1));
      return rk;
    });
    let maxRank = 1;
    top.forEach(c => years.forEach((_, i) => { const r = rankByYear[i].get(c); if (r) maxRank = Math.max(maxRank, r); }));
    // Headroom so the spline's overshoot isn't clipped at the edges; label only
    // real ranks (>=1) via tickvals, so the padding never shows a 0/negative rank.
    const pad = Math.max(1.2, maxRank * 0.08);
    const step = maxRank <= 12 ? 1 : Math.ceil(maxRank / 10);
    const rankTicks = [];
    for (let r = 1; r <= maxRank; r += step) rankTicks.push(r);
    const p = ACC.pal();
    const traces = top.map(c => ({
      type: 'scatter', mode: 'lines+markers', x: years, connectgaps: true,
      y: years.map((_, i) => rankByYear[i].get(c) || null),
      name: clusterLabel(c),
      line: { width: 2.4, shape: 'spline', smoothing: 0.6, dash: gapped ? 'dot' : 'solid',
              color: ACC.clusterColor(ACC.state.clusterById.get(c) || { id: c }) },
      marker: { size: 7 },
      hovertemplate: `<b>${clusterLabel(c)}</b><br>%{x}: rank %{y}<extra></extra>`,
    }));
    Plotly.react(div, traces, ACC.plBase({
      height: 380, margin: { l: 40, r: 150, t: 8, b: 30 },
      xaxis: { tickvals: years, tickfont: { size: 11, color: p.fnt }, gridcolor: p.line, fixedrange: true },
      // reversed range with padding for the spline overshoot; tickvals label only
      // ranks >=1, and fixedrange stops zoom from ever exposing a 0/negative label
      yaxis: { title: { text: 'rank (1 = most common)', font: { size: 10, color: p.mut } },
               range: [maxRank + pad, 1 - pad], tickmode: 'array', tickvals: rankTicks,
               tickfont: { size: 10, color: p.fnt }, gridcolor: p.line, fixedrange: true },
      showlegend: true, legend: { font: { size: 9.5, color: p.ink2 }, x: 1.02, y: 1, xanchor: 'left' },
      hovermode: 'closest',
    }), ACC.plConfig({ displayModeBar: false }));
  }

  function drawDriftPlot(div, cohort) {
    const years = ACC.state.data.meta.years;
    const prof = years.map(y => profileAt(cohort, y));
    const perYear = prof.map(pp => pp.byCluster);
    const gapped = prof.some(pp => pp.nPapers === 0);   // non-annual venue → dashed line
    const totals = new Map();
    perYear.forEach(mp => mp.forEach((v, c) => totals.set(c, (totals.get(c) || 0) + v)));
    if (!totals.size) { div.innerHTML = '<div class="cmp-empty">No claims in this subsample.</div>'; return; }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_DRIFT).map(e => e[0]);
    const p = ACC.pal();
    // With gaps: line mode (never stack) with dashed connectors across the missing years.
    const stacked = metric === 'mix' && !gapped;
    const traces = top.map(c => ({
      type: 'scatter', mode: 'lines', x: years, connectgaps: true,
      y: years.map((_, i) => prof[i].nPapers ? +(perYear[i].get(c) || 0).toFixed(2) : null),
      name: clusterLabel(c),
      line: { width: stacked ? 0 : 2.2, dash: gapped ? 'dot' : 'solid',
              color: ACC.clusterColor(ACC.state.clusterById.get(c) || { id: c }) },
      stackgroup: stacked ? 'one' : undefined,
      hovertemplate: `<b>${clusterLabel(c)}</b><br>%{x}: %{y:.1f}%<extra></extra>`,
    }));
    Plotly.react(div, traces, ACC.plBase({
      height: 360, margin: { l: 46, r: 10, t: 8, b: 34 },
      xaxis: { tickvals: years, tickfont: { size: 11, color: p.fnt }, gridcolor: p.line },
      yaxis: { title: { text: metricWord(), font: { size: 11, color: p.mut } }, rangemode: 'tozero', tickfont: { size: 10, color: p.fnt }, gridcolor: p.line },
      legend: { orientation: 'h', y: -0.14, font: { size: 10, color: p.ink2 } },
      hovermode: 'closest',
    }), ACC.plConfig({ displayModeBar: false }));
  }

  /* --------------------------- controls UI ------------------------------ */
  function cohortControl(side) {
    const cohort = side === 'A' ? A : B;
    const set = c => { if (side === 'A') A = c; else B = c; draw(); renderControls(); };
    const wrap = document.createElement('div');
    wrap.className = 'cohort-card';
    wrap.style.borderColor = isSet(cohort) ? cohortColor(cohort) : 'var(--line2)';

    const types = side === 'A'
      ? [['venue', 'Conference'], ['author', 'Author'], ['keyword', 'Keyword']]
      : [['none', '— none —'], ['venue', 'Conference'], ['author', 'Author'], ['keyword', 'Keyword']];
    const typeSel = document.createElement('select');
    typeSel.className = 'select';
    types.forEach(([v, lab]) => { const o = document.createElement('option'); o.value = v; o.textContent = lab; if (cohort.type === v) o.selected = true; typeSel.appendChild(o); });
    typeSel.addEventListener('change', () => {
      const t = typeSel.value;
      set({ type: t, value: t === 'venue' ? venues()[0] : '' });
    });

    const head = document.createElement('div');
    head.className = 'cohort-head';
    head.innerHTML = `<span class="cohort-tag" style="background:${isSet(cohort) ? cohortColor(cohort) : 'var(--fnt2)'}">${side}</span>`;
    head.appendChild(typeSel);
    wrap.appendChild(head);

    const val = document.createElement('div');
    val.className = 'cohort-val';
    if (cohort.type === 'venue') {
      const sel = document.createElement('select'); sel.className = 'select';
      venues().forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; if (cohort.value === v) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', () => set({ type: 'venue', value: sel.value }));
      val.appendChild(sel);
    } else if (cohort.type === 'author') {
      const inp = document.createElement('input'); inp.className = 'field'; inp.setAttribute('list', 'cmp-authors'); inp.placeholder = 'Type an author name…';
      const idx = ACC.state.data.authorsIndex || {};
      if (cohort.value && idx[cohort.value]) inp.value = idx[cohort.value][0];
      inp.addEventListener('change', () => set({ type: 'author', value: nameToId[inp.value.trim()] || '' }));
      val.appendChild(inp);
      const quick = document.createElement('div'); quick.className = 'cohort-quick';
      [['christopher-d-manning', 'Manning'], ['hinrich-schutze', 'Schütze'], ['dan-jurafsky', 'Jurafsky']].forEach(([id, nm]) => {
        if (!idx[id]) return;
        const b = document.createElement('button'); b.className = 'chip-btn'; b.textContent = nm;
        b.addEventListener('click', () => set({ type: 'author', value: id }));
        quick.appendChild(b);
      });
      val.appendChild(quick);
    } else if (cohort.type === 'keyword') {
      const inp = document.createElement('input'); inp.className = 'field'; inp.placeholder = 'words, comma or space separated…'; inp.value = cohort.value || '';
      inp.addEventListener('change', () => set({ type: 'keyword', value: inp.value }));
      val.appendChild(inp);
    } else {
      val.innerHTML = '<span class="cohort-none">no second subsample — showing A only</span>';
    }
    wrap.appendChild(val);
    return wrap;
  }

  function renderControls() {
    const row = document.getElementById('cohort-row');
    if (!row) return;
    row.innerHTML = '';
    row.appendChild(cohortControl('A'));
    const vs = document.createElement('div'); vs.className = 'cohort-vs'; vs.textContent = 'vs';
    row.appendChild(vs);
    row.appendChild(cohortControl('B'));
  }

  function build() {
    if (built) return;
    built = true;
    claims = buildClaims();
    const vs = venues();
    A = { type: 'venue', value: vs.find(v => v !== 'EMNLP') || vs[0] };
    B = { type: 'venue', value: 'EMNLP' };

    const yearOpts = ['ALL', ...ACC.state.data.meta.years].map(y =>
      `<option value="${y}">${y === 'ALL' ? 'all years' : y}</option>`).join('');

    document.getElementById('compare-body').innerHTML = `
      <div class="compare-head">
        <div class="compare-eyebrow">COMPARE</div>
        <h1 class="compare-h1">Thematic profiles of subsamples</h1>
        <p class="compare-lead">Pick a subsample — a conference, an author, or a keyword set — to see its topic profile. Add a second to compare them directly, or switch to <i>over time</i> to watch one subsample drift across the years.</p>
      </div>
      <div class="cohort-row" id="cohort-row"></div>
      <div class="compare-opts">
        <span class="ctl-label">MEASURE</span>
        <div class="seg" id="cmp-metric">
          <button class="seg-btn active" data-m="mix">topic mix</button>
          <button class="seg-btn" data-m="df">paper share</button>
        </div>
        <span class="ctl-divider"></span>
        <span class="ctl-label">VIEW</span>
        <div class="seg" id="cmp-view">
          <button class="seg-btn active" data-view="snapshot">Snapshot</button>
          <button class="seg-btn" data-view="overtime">Over time</button>
        </div>
        <select class="select" id="cmp-year" title="Restrict the snapshot to one year">${yearOpts}</select>
      </div>
      <div class="compare-summary" id="compare-summary"></div>
      <div class="profile-panels" id="profile-panels"></div>
      <div class="compare-versus" id="compare-versus"></div>
      <datalist id="cmp-authors"></datalist>`;

    const dl = document.getElementById('cmp-authors');
    Object.values(ACC.state.data.authorsIndex || {}).sort((a, b) => b[1] - a[1]).forEach(([nm, n]) => {
      const o = document.createElement('option'); o.value = nm; o.label = n + ' papers'; dl.appendChild(o);
    });

    document.querySelectorAll('#cmp-metric .seg-btn').forEach(b =>
      b.addEventListener('click', () => {
        metric = b.dataset.m;
        document.querySelectorAll('#cmp-metric .seg-btn').forEach(x => x.classList.toggle('active', x === b));
        draw();
      }));
    const yearSel = document.getElementById('cmp-year');
    document.querySelectorAll('#cmp-view .seg-btn').forEach(b =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#cmp-view .seg-btn').forEach(x => x.classList.toggle('active', x === b));
        const overtime = b.dataset.view === 'overtime';
        yearSel.style.display = overtime ? 'none' : '';
        scope = overtime ? 'overtime' : (yearSel.value === 'ALL' ? 'ALL' : +yearSel.value);
        draw();
      }));
    yearSel.addEventListener('change', () => {
      scope = yearSel.value === 'ALL' ? 'ALL' : +yearSel.value;
      draw();
    });

    renderControls();
    draw();
  }

  function activate() {
    build();
    document.querySelectorAll('#view-compare .js-plotly-plot').forEach(d => { if (d.data) Plotly.Plots.resize(d); });
  }
  function rebuildTheme() { if (built) { renderControls(); draw(); } }

  return { activate, rebuildTheme };
})();
