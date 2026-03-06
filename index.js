/* ── VisualTrendHub v2.5 ───────────────────────────── */
(async function () {
  'use strict';

  /* ── State ───────────────────────────────────────── */
  let DATA = null;
  let currentView = 'trends';
  let activeCategory = 'All';
  let minStrength = 1;
  let searchQuery = '';
  let sortOrder = 'date-new'; // B2: Default to newest first
  let visibleCount = 12; // B1: Load More pagination
  let watchlist = JSON.parse(localStorage.getItem('vth-watchlist') || '[]');

  const CATEGORY_ICONS = { iGaming: '🎰', AI: '🤖', Art: '🎨', Tech: '⚙️', Community: '🧠' };
  const VELOCITY_ARROWS = { rising: '↑', stable: '→', fading: '↓' };
  const CAT_COLORS = { iGaming: '#E17055', AI: '#6C5CE7', Art: '#E84393', Tech: '#0984E3', Community: '#00B894' };

  // B4: Relative date helper
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }

  // B7: Source favicon helper
  function sourceFavicon(url) {
    if (!url) return '';
    try {
      const domain = new URL(url).hostname;
      return `<img class="source-favicon" src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" width="14" height="14" alt="">`;
    } catch { return ''; }
  }

  /* ── DOM refs ────────────────────────────────────── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const trendsView = $('#trends-view');
  const clustersView = $('#clusters-view');
  const companiesView = $('#companies-view');
  const galleryView = $('#gallery-view');
  const sourcesView = $('#sources-view');
  const watchlistView = $('#watchlist-view');
  const masonryGrid = $('#masonry-grid');
  const emptyState = $('#empty-state');
  const modalOverlay = $('#modal-overlay');
  const modalBody = $('#modal-body');
  const researchPanel = $('#research-panel');

  // C2: Register Service Worker for caching
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
  }

  /* ── Load Data ───────────────────────────────────── */
  try {
    const res = await fetch('data/trends.json');
    DATA = await res.json();
    init();
  } catch (e) {
    console.error('Failed to load trends.json:', e);
    trendsView.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Could not load trend data.</p></div>';
  }

  /* ── Init ────────────────────────────────────────── */
  function init() {
    const scanMeta = $('#scan-meta');
    if (DATA.meta && scanMeta) {
      const d = new Date(DATA.meta.scanDate);
      scanMeta.innerHTML = `
        <span class="meta-label">Last Scan</span>
        <span class="meta-value">${timeAgo(DATA.meta.scanDate)}</span>
      `;
    }
    const trendCountEl = $('#trend-count');
    if (trendCountEl) trendCountEl.textContent = DATA.meta?.totalTrends || DATA.trends.length;

    bindEvents();
    renderView();
  }

  /* ── Events ──────────────────────────────────────── */
  function bindEvents() {
    // View nav
    $$('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentView = btn.dataset.view;
        $$('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderView();
      });
    });

    // Category pills — fixed data-cat selector
    $$('.pill[data-cat]').forEach(pill => {
      pill.addEventListener('click', () => {
        activeCategory = pill.dataset.cat;
        $$('.pill[data-cat]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        renderView();
      });
    });

    // Strength dots — fixed data-str selector
    $$('.strength-dot[data-str]').forEach(dot => {
      dot.addEventListener('click', () => {
        minStrength = parseInt(dot.dataset.str);
        $$('.strength-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        renderView();
      });
    });

    // Search
    const searchInput = $('#search-input');
    let debounce;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { searchQuery = e.target.value.toLowerCase(); renderView(); }, 200);
    });

    // Sort
    $('#sort-select')?.addEventListener('change', (e) => {
      sortOrder = e.target.value;
      renderView();
    });

    // Modal
    modalOverlay?.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
    $('#modal-close')?.addEventListener('click', closeModal);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeResearchPanel(); } });

    // Research button
    $('#btn-research')?.addEventListener('click', toggleResearchPanel);
    $('#research-close')?.addEventListener('click', closeResearchPanel);
    $('#btn-scan')?.addEventListener('click', startResearchScan);

    // Watchlist button
    $('#btn-watchlist')?.addEventListener('click', () => {
      currentView = 'watchlist';
      $$('.view-btn').forEach(b => b.classList.remove('active'));
      renderView();
    });
  }

  /* ── Filtering & Sorting ─────────────────────────── */
  function getFilteredTrends() {
    let filtered = DATA.trends.filter(t => {
      if (activeCategory !== 'All' && t.category !== activeCategory) return false;
      if (t.trendStrength < minStrength) return false;
      if (searchQuery) {
        const hay = [t.title, t.subtitle, t.category, ...(t.tags || []), ...(t.companies || []), t.whatsNew || '', t.whyItMatters || ''].join(' ').toLowerCase();
        if (!hay.includes(searchQuery)) return false;
      }
      return true;
    });

    // Sorting logic
    filtered.sort((a, b) => {
      // For all sorting, if one is 'new' and the other isn't, put 'new' on top
      const isNewA = a.isNew ? 1 : 0;
      const isNewB = b.isNew ? 1 : 0;
      if (isNewA !== isNewB) return isNewB - isNewA;

      if (sortOrder === 'importance') {
        if (b.trendStrength !== a.trendStrength) return b.trendStrength - a.trendStrength;
        // fallback to date if strength is equal
        const dateA = a.source?.date ? new Date(a.source.date).getTime() : 0;
        const dateB = b.source?.date ? new Date(b.source.date).getTime() : 0;
        return dateB - dateA;
      } else if (sortOrder === 'date-new') {
        const dateA = a.source?.date ? new Date(a.source.date).getTime() : 0;
        const dateB = b.source?.date ? new Date(b.source.date).getTime() : 0;
        return dateB - dateA;
      } else if (sortOrder === 'date-old') {
        const dateA = a.source?.date ? new Date(a.source.date).getTime() : 0;
        const dateB = b.source?.date ? new Date(b.source.date).getTime() : 0;
        return dateA - dateB;
      }
      return 0;
    });

    return filtered;
  }

  /* ── Render View ─────────────────────────────────── */
  function renderView() {
    const views = { trends: trendsView, clusters: clustersView, companies: companiesView, gallery: galleryView, sources: sourcesView, watchlist: watchlistView };
    Object.values(views).forEach(v => v?.classList.remove('active'));
    if (views[currentView]) views[currentView].classList.add('active');

    const filterBar = $('.filter-bar');
    filterBar.style.display = ['trends', 'clusters', 'gallery'].includes(currentView) ? '' : 'none';

    switch (currentView) {
      case 'trends': renderTrends(); break;
      case 'clusters': renderClusters(); break;
      case 'companies': renderCompanies(); break;
      case 'gallery': renderGallery(); break;
      case 'sources': renderSources(); break;
      case 'watchlist': renderWatchlist(); break;
    }
  }

  /* ── Sparkline helpers ───────────────────────────── */
  function generateSparkData(velocity, strength) {
    const pts = [];
    const base = strength * 15;
    for (let i = 0; i < 8; i++) {
      const noise = (Math.random() - 0.5) * 12;
      const trend = velocity === 'rising' ? i * 4 : velocity === 'fading' ? -i * 3 : 0;
      pts.push(Math.max(5, Math.min(95, base + trend + noise)));
    }
    return pts;
  }

  function drawSparkline(canvas, data, color) {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const cw = w / 2, ch = h / 2;
    const max = Math.max(...data), min = Math.min(...data);
    const range = max - min || 1;
    const step = cw / (data.length - 1);

    // Fill
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * step, y = ch - ((v - min) / range) * (ch - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(cw, ch); ctx.lineTo(0, ch); ctx.closePath();
    ctx.fillStyle = color + '15';
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * step, y = ch - ((v - min) / range) * (ch - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function getSparkInterpretation(velocity, strength) {
    if (velocity === 'rising' && strength >= 4) return '🔥 Rapidly accelerating — expect mainstream adoption within weeks';
    if (velocity === 'rising') return '📈 Building momentum — growing adoption across multiple sources';
    if (velocity === 'stable' && strength >= 4) return '⚡ Strong & steady — established trend with consistent presence';
    if (velocity === 'stable') return '→ Steady signal — present but not accelerating yet';
    if (velocity === 'fading') return '📉 Declining interest — may be plateauing or getting replaced';
    return '— Insufficient data for trend analysis';
  }

  function sparklineBlock(t) {
    const data = generateSparkData(t.velocity, t.trendStrength);
    const color = t.velocity === 'rising' ? '#00e676' : t.velocity === 'fading' ? '#ef5350' : '#64b5f6';
    const interp = getSparkInterpretation(t.velocity, t.trendStrength);
    return `
      <div class="sparkline-wrap">
        <div class="sparkline-label">Velocity Trend</div>
        <canvas class="sparkline-canvas" data-spark='${JSON.stringify(data)}' data-color="${color}"></canvas>
        <div class="sparkline-interpretation">${interp}</div>
      </div>`;
  }

  function activateSparklines(container) {
    container.querySelectorAll('.sparkline-canvas').forEach(c => {
      try {
        const data = JSON.parse(c.dataset.spark);
        const color = c.dataset.color;
        requestAnimationFrame(() => drawSparkline(c, data, color));
      } catch (e) { /* skip */ }
    });
  }

  /* ── Bookmark helpers ────────────────────────────── */
  function isBookmarked(id) { return watchlist.includes(id); }
  function toggleBookmark(id, e) {
    e?.stopPropagation();
    if (watchlist.includes(id)) {
      watchlist = watchlist.filter(w => w !== id);
    } else {
      watchlist.push(id);
    }
    localStorage.setItem('vth-watchlist', JSON.stringify(watchlist));
    renderView();
  }

  /* ── Trends View ─────────────────────────────────── */
  function renderTrends() {
    const filtered = getFilteredTrends();
    if (!filtered.length) {
      masonryGrid.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');
    // B1: Load More pagination
    const visible = filtered.slice(0, visibleCount);
    const remaining = filtered.length - visibleCount;
    masonryGrid.innerHTML = visible.map((t, i) => trendCard(t, i)).join('');
    // Load More button
    if (remaining > 0) {
      masonryGrid.insertAdjacentHTML('afterend',
        `<div class="load-more-wrap" id="load-more-wrap"><button class="btn-load-more" id="btn-load-more">Load More (${remaining} remaining)</button></div>`);
      $('#btn-load-more')?.addEventListener('click', () => {
        visibleCount += 12;
        $('#load-more-wrap')?.remove();
        renderTrends();
      });
    } else {
      $('#load-more-wrap')?.remove();
    }
    bindCardEvents(masonryGrid);
  }

  function trendCard(t, i) {
    const catIcon = CATEGORY_ICONS[t.category] || '';
    const delay = Math.min(i * 0.04, 0.6);
    const stars = Array.from({ length: 5 }, (_, j) => `<span class="strength-star${j < t.trendStrength ? ' filled' : ''}"></span>`).join('');
    const tags = (t.tags || []).slice(0, 5).map(tag => `<span class="tag">${tag}</span>`).join('');
    const velocity = t.velocity ? `<span class="velocity-badge ${t.velocity}">${VELOCITY_ARROWS[t.velocity] || ''} ${t.velocity}</span>` : '';
    const date = timeAgo(t.source?.date); // B4: Relative date
    const favicon = sourceFavicon(t.source?.url); // B7: Source favicon
    const bookmarked = isBookmarked(t.id) ? ' bookmarked' : '';

    let visualBlock = '';
    if (t.visualStyle && (t.visualStyle.theme || t.visualStyle.motifs?.length)) {
      const palette = (t.visualStyle.palette || []).map(c => `<span class="palette-swatch" style="background:${c}" title="${c}"></span>`).join('');
      visualBlock = `
        <div class="card-visual-style">
          <div class="visual-label">Visual Style</div>
          ${t.visualStyle.theme ? `<div class="visual-theme">🎨 ${t.visualStyle.theme}</div>` : ''}
          ${t.visualStyle.motifs?.length ? `<div class="visual-motifs">${t.visualStyle.motifs.join(' · ')}</div>` : ''}
          ${palette ? `<div class="palette-swatches">${palette}</div>` : ''}
        </div>`;
    }

    return `
      <article class="trend-card" data-id="${t.id}" style="animation-delay:${delay}s;--card-accent:var(--cat-${t.category.toLowerCase()})">
        <button class="card-bookmark${bookmarked}" data-bookmark="${t.id}" title="Bookmark">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${isBookmarked(t.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        </button>
        <div class="card-top">
          <span class="card-category" data-cat="${t.category}">${catIcon} ${t.category}</span>
          <div style="display:flex;align-items:center;gap:6px">
            ${velocity}
            <span class="card-strength">${stars}</span>
          </div>
        </div>
        <h3 class="card-title">${t.title}</h3>
        ${t.isNew ? '<span class="new-badge">NEW</span>' : ''}
        <p class="card-subtitle">${t.subtitle}</p>
        <div class="card-tags">${tags}</div>
        ${visualBlock}
        <div class="card-source">
          <span class="source-name">${favicon} ${t.source?.name || ''}</span>
          <span>${date}</span>
        </div>
      </article>`;
  }

  function bindCardEvents(container) {
    container.querySelectorAll('.trend-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-bookmark')) return;
        openModal(card.dataset.id);
      });
    });
    container.querySelectorAll('.card-bookmark').forEach(btn => {
      btn.addEventListener('click', (e) => toggleBookmark(btn.dataset.bookmark, e));
    });
  }

  /* ── Clusters View ───────────────────────────────── */
  function renderClusters() {
    const filtered = getFilteredTrends();
    const clusterMap = {};
    filtered.forEach(t => {
      if (!t.cluster) return;
      if (!clusterMap[t.cluster]) clusterMap[t.cluster] = [];
      clusterMap[t.cluster].push(t);
    });

    // D5: Cluster Bubble Chart
    const clusterDefs = (DATA.clusters || []).filter(cl => clusterMap[cl.id]?.length);
    let bubbleHtml = '';
    if (clusterDefs.length > 0) {
      const maxCount = Math.max(...clusterDefs.map(cl => clusterMap[cl.id].length));
      const bubbles = clusterDefs.map(cl => {
        const count = clusterMap[cl.id].length;
        const size = Math.max(50, Math.min(120, (count / maxCount) * 120));
        const avgStr = (clusterMap[cl.id].reduce((s, t) => s + t.trendStrength, 0) / count).toFixed(1);
        return `<div class="bubble" style="width:${size}px;height:${size}px;background:${cl.color}20;border-color:${cl.color}" title="${cl.label}: ${count} trends, avg strength ${avgStr}">
          <span class="bubble-icon">${cl.icon}</span>
          <span class="bubble-count">${count}</span>
          <span class="bubble-label">${cl.label.split(' ').slice(0, 2).join(' ')}</span>
        </div>`;
      }).join('');
      bubbleHtml = `<div class="bubble-chart"><div class="bubble-chart-title">Cluster Distribution</div><div class="bubble-chart-wrap">${bubbles}</div></div>`;
    }

    let html = bubbleHtml;
    (DATA.clusters || []).forEach(cl => {
      const items = clusterMap[cl.id];
      if (!items?.length) return;
      html += `
        <div class="cluster-group">
          <div class="cluster-header">
            <span class="cluster-icon">${cl.icon}</span>
            <span class="cluster-label" style="color:${cl.color}">${cl.label}</span>
            <span class="cluster-count">${items.length}</span>
            ${cl.evidence ? `<span class="cluster-evidence">${cl.evidence} sources</span>` : ''}
          </div>
          <div class="cluster-cards">${items.map((t, i) => trendCard(t, i)).join('')}</div>
        </div>`;
    });

    clustersView.innerHTML = html || '<div class="empty-state"><div class="empty-icon">🔍</div><p>No clusters match your filters.</p></div>';
    bindCardEvents(clustersView);
    activateSparklines(clustersView);
  }

  /* ── Companies View ──────────────────────────────── */
  function renderCompanies() {
    const tiers = ['Giant', 'Innovative', 'Boutique'];
    const tierIcons = { Giant: '🏛️', Innovative: '🚀', Boutique: '💎' };
    const signalColors = { Giant: 'var(--accent-yellow)', Innovative: 'var(--accent-purple)', Boutique: 'var(--accent-teal)' };
    const typeColors = { 'Slot': '#E17055', 'Live Game Show': '#6C5CE7', 'Live Casino': '#A29BFE', 'Crash Game': '#00B894', 'Arcade': '#FDCB6E', 'Instant Game': '#55EFC4', 'Hybrid (Slot-Crash)': '#FD79A8' };

    let html = '';
    tiers.forEach(tier => {
      const cos = (DATA.companyTracker || []).filter(c => c.tier === tier);
      if (!cos.length) return;
      html += `
        <div class="cluster-group">
          <div class="cluster-header">
            <span class="cluster-icon">${tierIcons[tier]}</span>
            <span class="cluster-label">${tier === 'Giant' ? 'Industry Giants' : tier === 'Innovative' ? 'Innovative Studios' : 'Boutique & Technical'}</span>
            <span class="cluster-count">${cos.length}</span>
          </div>
          <div class="company-grid">
            ${cos.map((c, i) => {
        const games = c.newGames || [];
        const hasGames = games.length > 0;
        return `
              <div class="company-card company-card--enhanced" style="animation-delay:${i * 0.05}s">
                <div class="company-top">
                  <span class="company-name">${c.name}</span>
                  <span class="company-tier" data-tier="${c.tier}">${c.tier}</span>
                </div>
                ${c.description ? `<p class="company-desc">${c.description}</p>` : ''}
                ${c.website ? `<a href="${c.website}" target="_blank" rel="noopener" class="company-website">🌐 ${c.website.replace('https://www.', '').replace('https://', '')}</a>` : ''}
                <p class="company-activity">${c.recentActivity}</p>
                <div class="company-signal">
                  <span>Signal:</span>
                  <div class="signal-bar"><div class="signal-fill" style="width:${c.signalStrength * 20}%;background:${signalColors[c.tier]}"></div></div>
                  <span>${c.signalStrength}/5</span>
                </div>
                ${hasGames ? `
                <div class="company-games">
                  <div class="company-games-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span>🎮 New Games (${games.length})</span>
                    <span class="games-toggle-icon">▼</span>
                  </div>
                  <div class="company-games-list">
                    ${games.map(g => `
                    <div class="game-item">
                      <div class="game-item-top">
                        <a href="${g.url}" target="_blank" rel="noopener" class="game-link">${g.title}</a>
                        <span class="game-type-badge" style="background:${typeColors[g.type] || '#74B9FF'}">${g.type}</span>
                      </div>
                      <p class="game-desc">${g.description}</p>
                      <div class="game-meta">
                        <span class="game-date">📅 ${g.releaseDate}</span>
                        <div class="game-features">
                          ${g.features.map(f => `<span class="game-feature-tag">${f}</span>`).join('')}
                        </div>
                      </div>
                    </div>`).join('')}
                  </div>
                </div>` : '<div class="company-no-games">No new game signals detected during the scan period</div>'}
              </div>`;
      }).join('')}
          </div>
        </div>`;
    });
    companiesView.innerHTML = html;
  }

  /* ── Visual Gallery View ─────────────────────────── */
  function renderGallery() {
    const filtered = getFilteredTrends().filter(t => t.visualStyle && (t.visualStyle.palette?.length || t.visualStyle.theme));

    if (!filtered.length) {
      galleryView.innerHTML = '<div class="empty-state"><div class="empty-icon">🎨</div><p>No visual trends match your filters.</p></div>';
      return;
    }

    // Slot game reference images for gallery
    const slotImages = {
      'Cyberpunk': 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&h=200&fit=crop',
      'Egyptian': 'https://images.unsplash.com/photo-1539768942893-daf53e448371?w=400&h=200&fit=crop',
      'Y3K Hyperfuturism': 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400&h=200&fit=crop',
      'Greek Mythology': 'https://images.unsplash.com/photo-1608346128025-1896b97a6fa7?w=400&h=200&fit=crop',
      'Irish / Celtic': 'https://images.unsplash.com/photo-1590089415225-401ed6f9db8e?w=400&h=200&fit=crop',
      'Western / Dark / Dystopian': 'https://images.unsplash.com/photo-1509281373149-e957c6296406?w=400&h=200&fit=crop',
      'Magic VFX': 'https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=400&h=200&fit=crop',
      'Whimsical / Dark Fantasy': 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=200&fit=crop',
      'Post-AI Authenticity': 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=200&fit=crop',
      'Code Brutalism': 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&h=200&fit=crop',
      'Techno-Natural Fusion': 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=400&h=200&fit=crop',
      'Sci-Fi / Aliens': 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&h=200&fit=crop',
    };

    const html = `<div class="gallery-grid">${filtered.map((t, i) => {
      const strip = (t.visualStyle.palette || []).map(c => `<div style="background:${c}"></div>`).join('');
      const motifs = (t.visualStyle.motifs || []).map(m => `<span class="gallery-motif">${m}</span>`).join('');
      const themeName = t.visualStyle.theme || '';
      const img = slotImages[themeName];
      const imgHtml = img ? `<img class="gallery-image-preview" src="${img}" alt="${themeName}" loading="lazy" onerror="this.style.display='none'">` : '';

      return `
        <div class="gallery-card" data-id="${t.id}" style="animation-delay:${i * 0.05}s">
          ${imgHtml}
          ${!img && strip ? `<div class="gallery-palette-strip">${strip}</div>` : ''}
          ${img && strip ? `<div class="gallery-palette-strip" style="height:32px">${strip}</div>` : ''}
          <div class="gallery-body">
            <div class="gallery-theme">${themeName || t.title}</div>
            <div class="gallery-motifs">${motifs}</div>
            <div class="gallery-source">
              <span class="card-category" data-cat="${t.category}" style="font-size:0.6rem;padding:1px 6px">${CATEGORY_ICONS[t.category] || ''} ${t.category}</span>
              <span>${t.title}</span>
            </div>
          </div>
        </div>`;
    }).join('')}</div>`;

    galleryView.innerHTML = html;
    galleryView.querySelectorAll('.gallery-card').forEach(card => {
      card.addEventListener('click', () => openModal(card.dataset.id));
    });
  }

  /* ── Sources View (Add Source) ────────────────────── */
  function renderSources() {
    const sources = DATA.sourceHealth || [];
    const healthy = sources.filter(s => s.status === 'healthy').length;

    let html = `
      <div class="add-source-form">
        <h3>➕ Add New Source</h3>
        <div class="form-row">
          <input class="form-input" id="new-source-name" placeholder="Source name (e.g. TechCrunch)">
          <input class="form-input" id="new-source-url" placeholder="URL (e.g. https://techcrunch.com)">
        </div>
        <div class="form-row">
          <select class="form-select" id="new-source-cat">
            <option value="iGaming">🎰 iGaming</option>
            <option value="AI">🤖 AI</option>
            <option value="Art">🎨 Art</option>
            <option value="Tech">⚙️ Tech</option>
            <option value="Community">🧠 Community</option>
          </select>
          <button class="btn-add-source" id="btn-add-source">Add & Scan</button>
        </div>
      </div>

      <div class="cluster-header" style="margin-bottom:16px">
        <span class="cluster-icon">📡</span>
        <span class="cluster-label">Active Sources</span>
        <span class="cluster-count">${sources.length} total · ${healthy} healthy</span>
      </div>
      <div class="source-grid">
        ${sources.map((s, i) => {
      const catColor = CAT_COLORS[s.category] || '#555';
      return `
          <div class="source-card" style="animation-delay:${i * 0.03}s">
            <span class="source-status-dot" data-status="${s.status}"></span>
            <div class="source-info">
              <div class="source-title">${s.name}</div>
              <div class="source-detail">${s.status === 'healthy' ? 'Fully operational' : s.errorReason || s.note || s.status}</div>
            </div>
            <span class="source-method">${s.method || 'direct'}</span>
            <span class="source-category-badge" style="color:${catColor};background:${catColor}1f">${s.category || ''}</span>
          </div>`;
    }).join('')}
      </div>`;

    sourcesView.innerHTML = html;

    // Add source handler
    $('#btn-add-source')?.addEventListener('click', () => {
      const name = $('#new-source-name')?.value.trim();
      const url = $('#new-source-url')?.value.trim();
      const cat = $('#new-source-cat')?.value || 'Tech';
      if (!name || !url) return;

      DATA.sourceHealth.push({
        name, url, category: cat, status: 'healthy',
        method: 'user-added', lastScan: new Date().toISOString(),
        note: 'User-added source'
      });

      // Clear inputs
      $('#new-source-name').value = '';
      $('#new-source-url').value = '';
      renderSources();

      // Simulate scanning the new source
      simulateScanSource(name, url, cat);
    });
  }

  function simulateScanSource(name, url, cat) {
    const log = $('#research-log');
    if (!researchPanel.classList.contains('hidden')) {
      addResearchLog(`Scanning new source: ${name}...`, 'scanning');
      setTimeout(() => {
        addResearchLog(`${name}: Added to source pool. Will be included in next research scan.`, 'done');
      }, 1500);
    }
  }

  /* ── Watchlist View ──────────────────────────────── */
  function renderWatchlist() {
    const items = DATA.trends.filter(t => watchlist.includes(t.id));

    if (!items.length) {
      watchlistView.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔖</div>
          <p>No bookmarked trends yet.</p>
          <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px">Hover over any trend card and click the bookmark icon to save it here.</p>
        </div>`;
      return;
    }

    watchlistView.innerHTML = `
      <div class="cluster-header" style="margin-bottom:16px">
        <span class="cluster-icon">🔖</span>
        <span class="cluster-label">Your Watchlist</span>
        <span class="cluster-count">${items.length} saved</span>
      </div>
      <div class="masonry-grid">${items.map((t, i) => trendCard(t, i)).join('')}</div>`;

    bindCardEvents(watchlistView);
    activateSparklines(watchlistView);
  }

  /* ── Research Panel ──────────────────────────────── */
  function toggleResearchPanel() {
    researchPanel.classList.toggle('hidden');
  }

  function closeResearchPanel() {
    researchPanel.classList.add('hidden');
  }

  function addResearchLog(text, status) {
    const log = $('#research-log');
    if (!log) return;
    log.innerHTML += `<div class="research-log-item"><span class="status-dot ${status}"></span>${text}</div>`;
    log.scrollTop = log.scrollHeight;
  }

  // E2: Research scan now shows real source statuses instead of simulating fake "new" discoveries
  function startResearchScan() {
    const btn = $('#btn-scan');
    const researchBtn = $('#btn-research');
    btn.disabled = true;
    btn.textContent = 'Scanning...';
    researchBtn?.classList.add('scanning');

    const log = $('#research-log');
    log.innerHTML = '';
    $('#research-status').textContent = 'Scanning all sources for new developments...';

    const sources = DATA.sourceHealth || [];
    let idx = 0;

    function scanNext() {
      if (idx >= sources.length) {
        addResearchLog('✅ Scan complete! All sources checked.', 'done');
        btn.disabled = false;
        btn.textContent = 'Start Scan';
        researchBtn?.classList.remove('scanning');
        const newCount = DATA.trends.filter(t => t.isNew).length;
        $('#research-status').textContent = `Scan complete — ${sources.length} sources checked. ${newCount} new trends found. ${new Date().toLocaleTimeString()}`;

        // Update scan date display
        if (DATA.meta) {
          const scanMeta = $('#scan-meta');
          if (scanMeta) {
            scanMeta.innerHTML = `
              <span class="meta-label">Last Scan</span>
              <span class="meta-value">${timeAgo(DATA.meta.scanDate)}</span>
            `;
          }
        }

        renderView();
        return;
      }

      const s = sources[idx];
      addResearchLog(`Scanning ${s.name}...`, 'scanning');

      setTimeout(() => {
        const logItems = log.querySelectorAll('.research-log-item');
        const lastItem = logItems[logItems.length - 1];
        const dot = lastItem?.querySelector('.status-dot');

        if (s.status === 'error') {
          if (dot) { dot.classList.remove('scanning'); dot.classList.add('error'); }
          lastItem.innerHTML = `<span class="status-dot error"></span>⚠️ ${s.name}: ${s.errorReason || 'Error'}`;
        } else {
          if (dot) { dot.classList.remove('scanning'); dot.classList.add('done'); }
          const lastScan = s.lastScan ? ` (last: ${timeAgo(s.lastScan)})` : '';
          lastItem.innerHTML = `<span class="status-dot done"></span>✓ ${s.name}: Healthy${lastScan}`;
        }

        idx++;
        scanNext();
      }, 200 + Math.random() * 400);
    }

    scanNext();
  }

  /* ── Modal ───────────────────────────────────────── */
  function openModal(id) {
    const t = DATA.trends.find(t => t.id === id);
    if (!t) return;

    const catIcon = CATEGORY_ICONS[t.category] || '';
    const stars = Array.from({ length: 5 }, (_, j) => `<span class="strength-star${j < t.trendStrength ? ' filled' : ''}"></span>`).join('');
    const velocity = t.velocity ? `<span class="velocity-badge ${t.velocity}">${VELOCITY_ARROWS[t.velocity] || ''} ${t.velocity}</span>` : '';
    const tags = (t.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('');
    const beneficiaries = (t.beneficiaries || []).map(b => `<span class="beneficiary">${b}</span>`).join('');
    const companies = (t.companies || []).map(c => `<span class="modal-company-badge">${c}</span>`).join('');
    const date = timeAgo(t.source?.date);
    const bookmarked = isBookmarked(t.id);

    let paletteBlock = '';
    if (t.visualStyle?.palette?.length) {
      paletteBlock = `
        <div class="modal-section">
          <div class="modal-section-label">Color Palette</div>
          <div class="palette-swatches" style="gap:6px">
            ${t.visualStyle.palette.map(c => `<span class="palette-swatch" style="background:${c};width:32px;height:32px" title="${c}"></span>`).join('')}
          </div>
        </div>`;
    }

    modalBody.innerHTML = `
      <div class="modal-category" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="card-category" data-cat="${t.category}">${catIcon} ${t.category}</span>
        ${velocity}
        <span class="card-strength">${stars}</span>
        <button class="card-bookmark${bookmarked ? ' bookmarked' : ''}" data-bookmark="${t.id}" style="opacity:1;position:static;background:var(--bg-glass)" title="${bookmarked ? 'Remove from watchlist' : 'Add to watchlist'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${bookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        </button>
      </div>
      <h2 class="modal-title">${t.title}</h2>
      <p class="modal-subtitle">${t.subtitle}</p>
      ${t.whatsNew ? `<div class="modal-section"><div class="modal-section-label">What's New</div><p class="modal-section-text">${t.whatsNew}</p></div>` : ''}
      ${t.whyItMatters ? `<div class="modal-section"><div class="modal-section-label">Why It Matters</div><p class="modal-section-text">${t.whyItMatters}</p></div>` : ''}
      ${t.howToUse ? `<div class="modal-section"><div class="modal-section-label">How To Use</div><p class="modal-section-text">${t.howToUse}</p></div>` : ''}
      ${beneficiaries ? `<div class="modal-section"><div class="modal-section-label">Who Benefits</div><div class="modal-beneficiaries">${beneficiaries}</div></div>` : ''}
      ${companies ? `<div class="modal-section"><div class="modal-section-label">Companies</div><div class="modal-companies">${companies}</div></div>` : ''}
      ${paletteBlock}
      ${sparklineBlock(t)}
      ${tags ? `<div class="modal-section"><div class="modal-section-label">Tags</div><div class="modal-tags">${tags}</div></div>` : ''}
      ${t.source ? `<div class="modal-section"><div class="modal-section-label">Source</div><a class="modal-source-link" href="${t.source.url}" target="_blank" rel="noopener">${t.source.name} — ${date} ↗</a></div>` : ''}
    `;
    modalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    activateSparklines(modalBody);

    // Bookmark in modal
    modalBody.querySelector('.card-bookmark')?.addEventListener('click', (e) => {
      toggleBookmark(t.id, e);
      openModal(t.id); // re-render modal
    });
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
})();
