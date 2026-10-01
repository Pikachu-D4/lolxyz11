(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const els = {
    urlInput: $('#urlInput'), clearBtn: $('#clearBtn'), analyzeBtn: $('#analyzeBtn'), analyzeBtnText: $('#analyzeBtnText'),
    errorMessage: $('#errorMessage'), errorText: $('#errorText'), demoNotice: $('#demoNotice'), resultSection: $('#resultSection'),
    skeletonCard: $('#skeletonCard'), resultCard: $('#resultCard'), resultThumbnail: $('#resultThumbnail'), platformBadge: $('#platformBadge'),
    durationBadge: $('#durationBadge'), resultMeta: $('#resultMeta'), resultTitle: $('#resultTitle'), formatFilters: $('#formatFilters'),
    formatsList: $('#formatsList'), upscaleSection: $('#upscaleSection'), themeToggle: $('#themeToggle'), themeIcon: $('#themeIcon'),
    historyToggle: $('#historyToggle'), historyBadge: $('#historyBadge'), historyPanel: $('#historyPanel'), historyBackdrop: $('#historyBackdrop'),
    historyCloseBtn: $('#historyCloseBtn'), historyClearBtn: $('#historyClearBtn'), historyList: $('#historyList')
  };

  let analysisData = null;
  let currentFilter = 'all';

  const YT_REGEX = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)/i;
  const IG_REGEX = /^https?:\/\/(www\.)?(instagram\.com\/(p|reel|reels|tv|share\/reel|share\/p)\/|instagr\.am\/(p|reel|reels|tv)\/)/i;

  function init() {
    initTheme();
    renderHistory();
    els.urlInput.addEventListener('input', () => els.clearBtn.classList.toggle('visible', !!els.urlInput.value.trim()));
    els.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyzeUrl(); });
    els.clearBtn.addEventListener('click', () => { els.urlInput.value = ''; els.clearBtn.classList.remove('visible'); hideError(); els.urlInput.focus(); });
    els.analyzeBtn.addEventListener('click', analyzeUrl);
    els.themeToggle.addEventListener('click', toggleTheme);
    els.historyToggle.addEventListener('click', () => { els.historyPanel.classList.add('open'); els.historyBackdrop.classList.add('open'); });
    els.historyCloseBtn.addEventListener('click', closeHistory);
    els.historyBackdrop.addEventListener('click', closeHistory);
    els.historyClearBtn.addEventListener('click', () => { localStorage.removeItem('eomeg-download-history'); renderHistory(); });
    $('#anotherQualityBtn')?.addEventListener('click', () => { $('#resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' }); setState('result'); });
  }

  function initTheme() {
    const theme = localStorage.getItem('eomeg-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    els.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('eomeg-theme', next);
    els.themeIcon.textContent = next === 'dark' ? '☀️' : '🌙';
  }

  function closeHistory() {
    els.historyPanel.classList.remove('open'); els.historyBackdrop.classList.remove('open');
  }

  async function postJSON(endpoint, body) {
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({ success: false, error: `Request failed (${res.status}).` }));
    return data;
  }

  function validUrl(url) { return YT_REGEX.test(url) || IG_REGEX.test(url); }

  async function analyzeUrl() {
    const url = els.urlInput.value.trim();
    if (!url) return showError('Please enter a URL.');
    if (!validUrl(url)) return showError('Please enter a valid YouTube or Instagram URL.');

    hideError(); setState('loading');
    try {
      const data = await postJSON('/api/analyze', { url });
      if (!data.success) { showError(data.error || 'Analysis failed.'); setState('empty'); return; }
      analysisData = data;
      renderResult(data);
      setState('result');
    } catch (e) {
      console.error(e); showError('The media service is temporarily unavailable.'); setState('empty');
    }
  }

  function setState(state) {
    els.resultSection.classList.toggle('hidden', state === 'empty');
    els.skeletonCard.classList.toggle('hidden', state !== 'loading');
    els.resultCard.classList.toggle('hidden', state !== 'result');
  }

  function renderResult(data) {
    els.resultThumbnail.src = data.thumbnail || '';
    els.resultThumbnail.alt = data.title || 'Media thumbnail';
    els.platformBadge.textContent = data.platform || '';
    els.durationBadge.textContent = data.duration ? formatDuration(data.duration) : '';
    els.durationBadge.classList.toggle('hidden', !data.duration);
    els.resultTitle.textContent = data.title || 'Untitled media';
    const tags = [data.type, data.originalResolution].filter(Boolean);
    els.resultMeta.innerHTML = tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    renderFormatFilters(data.formats || []);
    renderFormats(data.formats || []);
    renderCarouselItems(data.items || []);
    // The downloader build keeps AI upscaling disabled until a real provider is configured.
    els.upscaleSection?.classList.add('hidden');
    if (els.demoNotice) els.demoNotice.classList.add('hidden');
  }

  function renderFormatFilters(formats) {
    const types = new Set(['all']);
    formats.forEach(f => {
      if (f.width && f.hasAudio) types.add('video+audio');
      else if (f.width) types.add('video only');
      else if (f.hasAudio) types.add('audio only');
    });
    els.formatFilters.innerHTML = '';
    types.forEach(type => {
      const btn = document.createElement('button');
      btn.className = `filter-btn${type === currentFilter ? ' active' : ''}`;
      btn.textContent = type === 'all' ? 'All' : capitalize(type);
      btn.onclick = () => { currentFilter = type; $$('.filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); renderFormats(analysisData.formats || []); };
      els.formatFilters.appendChild(btn);
    });
  }

  function renderFormats(formats) {
    let list = formats.slice();
    if (currentFilter === 'video+audio') list = list.filter(f => f.width && f.hasAudio);
    if (currentFilter === 'video only') list = list.filter(f => f.width && !f.hasAudio);
    if (currentFilter === 'audio only') list = list.filter(f => !f.width && f.hasAudio);
    list.sort((a, b) => (b.height || 0) - (a.height || 0));

    els.formatsList.innerHTML = '';
    if (!list.length) {
      els.formatsList.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:1rem">No downloadable formats found.</p>';
      return;
    }

    list.forEach(format => {
      const item = document.createElement('div'); item.className = 'format-item';
      const audio = format.hasAudio ? '🔊 Audio' : format.width ? '🔇 Video only' : '🎵 Audio only';
      item.innerHTML = `
        <div class="format-details">
          <span class="format-quality">${escapeHtml(format.quality || 'Best')}</span>
          ${format.fps ? `<span class="format-info-chip">${escapeHtml(String(format.fps))} FPS</span>` : ''}
          ${format.codec ? `<span class="format-info-chip">${escapeHtml(String(format.codec).toUpperCase())}</span>` : ''}
          <span class="format-info-chip">${audio}</span>
          <span class="format-info-chip">${escapeHtml(String(format.format || 'MP4').toUpperCase())}</span>
          ${format.fileSize ? `<span class="format-size">${formatFileSize(format.fileSize)}</span>` : ''}
        </div>
        <button class="download-btn" type="button">⬇️ Download</button>`;
      item.querySelector('.download-btn').onclick = () => startDownload(format);
      els.formatsList.appendChild(item);
    });
  }

  function renderCarouselItems(items) {
    const old = $('#carouselItems'); if (old) old.remove();
    if (!items.length) return;
    const box = document.createElement('div'); box.id = 'carouselItems'; box.className = 'carousel-items';
    box.innerHTML = `<div style="font-weight:700;margin:0 0 .8rem">Carousel / multiple media (${items.length})</div>`;
    items.forEach(item => {
      const row = document.createElement('div'); row.className = 'format-item';
      row.innerHTML = `<div class="format-details"><span class="format-quality">Item ${item.index}</span><span>${escapeHtml(item.type || 'media')}</span></div><button class="download-btn" type="button">⬇️ Download</button>`;
      row.querySelector('button').onclick = () => downloadCarouselItem(item.index);
      box.appendChild(row);
    });
    els.formatsList.parentElement?.insertBefore(box, els.formatsList);
  }

  function startDownload(format) {
    const source = els.urlInput.value.trim();
    if (!source) return showError('Please enter a URL.');

    const params = new URLSearchParams({ url: source, format: format.id || 'best' });
    window.open(`/api/download?${params.toString()}`, '_blank', 'noopener');
    saveToHistory({ title: analysisData?.title, thumbnail: analysisData?.thumbnail, platform: analysisData?.platform, quality: format.quality, format: format.format, date: new Date().toISOString() });
  }

  function downloadCarouselItem(index) {
    const source = els.urlInput.value.trim();
    const params = new URLSearchParams({ url: source, format: 'best', entry: String(index) });
    window.open(`/api/download?${params.toString()}`, '_blank', 'noopener');
  }

  function saveToHistory(entry) {
    try {
      const old = JSON.parse(localStorage.getItem('eomeg-download-history') || '[]');
      const next = [entry, ...old].slice(0, 20); localStorage.setItem('eomeg-download-history', JSON.stringify(next)); renderHistory();
    } catch {}
  }

  function renderHistory() {
    try {
      const history = JSON.parse(localStorage.getItem('eomeg-download-history') || '[]');
      els.historyBadge.textContent = String(history.length); els.historyBadge.classList.toggle('hidden', !history.length);
      els.historyList.innerHTML = history.length ? history.map(h => `<div class="history-item"><div><strong>${escapeHtml(h.title || 'Media')}</strong><div class="history-meta">${escapeHtml(h.platform || '')} • ${escapeHtml(h.quality || '')} • ${escapeHtml(h.format || '')}</div></div></div>`).join('') : '<p style="color:var(--text-tertiary);padding:1rem">No downloads yet.</p>';
    } catch {}
  }

  function showError(message) { els.errorText.textContent = message; els.errorMessage.classList.remove('hidden'); }
  function hideError() { els.errorMessage.classList.add('hidden'); els.errorText.textContent = ''; }
  function formatDuration(sec) { sec = Math.max(0, Math.round(Number(sec) || 0)); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`; }
  function formatFileSize(bytes) { if (!Number.isFinite(bytes) || bytes <= 0) return ''; const units = ['B','KB','MB','GB']; let n = bytes; let i = 0; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`; }
  function capitalize(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }

  // Prevent accidental navigation while a direct download is being initiated.
  window.addEventListener('beforeunload', () => {});
  init();
})();
