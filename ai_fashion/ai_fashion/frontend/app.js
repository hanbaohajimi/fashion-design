/* ─────────────────────────────────────────────────────────────────
   app.js — AI Fashion Frontend
   Single-page app: Dashboard / Reports / Seasons / Articles / Keywords
   Connects to FastAPI backend at same origin (or VITE_API_BASE)
───────────────────────────────────────────────────────────────── */

const API = '';          // same origin; change to 'http://localhost:8000' for dev
const PAGE_TITLES = {
  dashboard : '仪表盘',
  reports   : '趋势报告',
  seasons   : '季节趋势',
  articles  : '文章库',
  keywords  : '热词',
};

const PAGE_EYEBROWS = {
  dashboard : '总览',
  reports   : '报告',
  seasons   : '季节',
  articles  : '文章',
  keywords  : '热词',
};

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 与后端 normalize_task_run_statuses 一致：修正历史上误标为 success 的任务展示口径 */
function effectiveTaskStatus(t) {
  if (!t) return '';
  const st = String(t.status || '').toLowerCase();
  if (st !== 'success') return st;
  const mode = t.pipeline_mode || '';
  const aa = _num(t.articles_analyzed);
  const rg = _num(t.reports_generated);
  const adm = _num(t.analyze_duration_ms);
  const em = String(t.error_message || '').trim();
  const sf = _num(t.sites_failed);
  const analysisModes = ['full', 'analyze_only', 'analyze_library'];
  if (analysisModes.includes(mode) && aa > 0 && rg === 0 && adm > 0) return 'failed';
  if (sf > 0 || em) return 'partial';
  return 'success';
}

/** 流水线模式短标签（进度条旁） */
function pipelineModeShort(mode) {
  return '完整工作流分析';
}

/** 仪表盘 / 最近任务：一行说明入库与参与分析篇数 */
function taskArticlesOneLine(t) {
  const mode = t.pipeline_mode || '';
  const nNew = _num(t.articles_new);
  const nAn = _num(t.articles_analyzed);
  const nCrawl = _num(t.articles_crawled);
  if (mode === 'analyze_only' || mode === 'analyze_library') {
    if (mode === 'analyze_library') {
      return nAn ? `全库季节分析 ${nAn} 篇` : '无可用文章';
    }
    return nAn ? `参与趋势分析 ${nAn} 篇` : '无待分析文章';
  }
  if (mode === 'crawl_only') {
    return `新入库 ${nNew} 篇`;
  }
  if (nNew) return `新入库 ${nNew} 篇` + (nAn ? ` · 分析 ${nAn} 篇` : '');
  if (nCrawl && nAn) return `新入库 0（抓取 ${nCrawl} 条均为已有）· 分析 ${nAn} 篇`;
  if (nCrawl) return `新入库 0（抓取 ${nCrawl} 条均为已有）`;
  return nAn ? `分析 ${nAn} 篇` : '新入库 0';
}

/** 任务表「文章」列：短数字或短语 */
function taskArticlesTableCell(t) {
  const mode = t.pipeline_mode || '';
  const nNew = _num(t.articles_new);
  const nAn = _num(t.articles_analyzed);
  if (mode === 'analyze_only' || mode === 'analyze_library') return nAn ? String(nAn) : '—';
  if (mode === 'crawl_only') return String(nNew);
  if (nNew) return String(nNew);
  return nAn ? `0(${nAn})` : '0';
}

function taskCompleteToastSummary(data) {
  if (!data) return '';
  const mode = data.pipeline_mode || '';
  const rep = _num(data.reports_generated);
  const nNew = _num(data.articles_new);
  const nAn = _num(data.articles_analyzed);
  const nCrawl = _num(data.articles_crawled);
  const eff = effectiveTaskStatus(data);
  const stSuf =
    eff === 'failed' || eff === 'partial' ? ` · ${statusLabel(eff)}` : '';
  if (mode === 'analyze_only' || mode === 'analyze_library') {
    const lab = mode === 'analyze_library' ? '全库季节' : '分析';
    return `${lab} ${nAn} 篇 · ${rep} 份报告` + stSuf;
  }
  if (mode === 'crawl_only') {
    return `新入库 ${nNew} 篇 · 抓取 ${nCrawl} 条` + stSuf;
  }
  if (nNew) return `新入库 ${nNew} 篇 · ${rep} 份报告` + stSuf;
  if (nCrawl) return `新入库 0（${nCrawl} 条均为已有）· ${rep} 份报告` + stSuf;
  return `${rep} 份报告` + stSuf;
}

// ── State ────────────────────────────────────────────────────────
let currentPage      = 'dashboard';
let reportsOffset    = 0;
let articlesOffset   = 0;
let articlesTotal    = 0;
let reportsTotal     = 0;
let articlesSearchTm = null;
let selectedReportId = null;
let ws               = null;
let wsReconnectTimer = null;
let pipelineRunning  = false;
let pipelinePaused   = false;
let pipelineLastData = null;
/** 从「季节趋势」跳入「趋势报告」时待应用的季节标签 id（null 表示不处理） */
let _pendingSeasonTag = null;
/** 从季节趋势点标签进入时：列表加载后自动打开该筛选下第一条报告的详情 */
let _autoOpenFirstReportAfterLoad = false;

const PIPELINE_STAGE_FLOW = [
  { key: 'boot', label: '初始化' },
  { key: 'search', label: '搜索候选' },
  { key: 'search_select', label: '筛选子文章' },
  { key: 'crawl', label: '深抓正文' },
  { key: 'season_bucket', label: '季节分组' },
  { key: 'article_analysis', label: '逐篇分析' },
  { key: 'aggregate_report', label: '汇总报告' },
  { key: 'finalize', label: '完成' },
];

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  createToastContainer();
  setupNav();
  setupImageLightbox();
  setupArticleHtmlModal();
  connectWS();
  loadMeta();
  loadDashboard();
  requestAnimationFrame(() => document.body.classList.add('app-ready'));
});

// ── Image lightbox（报告/仪表盘/文章缩略图点击放大）────────────────
function setupImageLightbox() {
  // 捕获阶段处理，避免文章卡片的「打开原文」先于灯箱冒泡执行
  document.body.addEventListener(
    'click',
    (e) => {
      const img = e.target.closest('img.img-zoomable[data-lb]');
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        openImageLightbox(decodeURIComponent(img.dataset.lb || ''));
      } catch (_) {
        openImageLightbox(img.src);
      }
    },
    true
  );
  document.getElementById('imageLightbox')?.addEventListener('click', (e) => {
    if (e.target.id === 'imageLightbox') closeImageLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const am = document.getElementById('articleHtmlModal');
    if (am && !am.hidden) {
      closeArticleHtmlModal();
      return;
    }
    closeImageLightbox();
  });
}

// ── 报告来源文章：本地抓取 HTML 预览 / 源码 ───────────────────────
function setupArticleHtmlModal() {
  document.querySelectorAll('.article-html-tab').forEach(btn => {
    btn.addEventListener('click', () => setArticleHtmlTab(btn.dataset.tab || 'preview'));
  });
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('.source-html-btn');
    if (!btn) return;
    const row = btn.closest('.source-article-row');
    if (!row) return;
    const uk = decodeURIComponent(row.dataset.uk || '');
    const titleEl = row.querySelector('.source-article-title');
    const title = titleEl ? titleEl.textContent : uk;
    openArticleHtmlModal(uk, title);
  });
}

function openArticleHtmlModal(uniqueKey, title) {
  const modal = document.getElementById('articleHtmlModal');
  const iframe = document.getElementById('articleHtmlIframe');
  const code = document.getElementById('articleHtmlSourceCode');
  if (!modal || !iframe || !code) return;
  const path = '/api/articles/' + encodeURIComponent(uniqueKey) + '/raw-html';
  document.getElementById('articleHtmlModalTitle').textContent = title || uniqueKey;
  iframe.src = API + path;
  code.textContent = '加载中…';
  fetch(API + path + '?plain=true')
    .then(r => {
      if (!r.ok) throw new Error(r.statusText);
      return r.text();
    })
    .then(t => {
      code.textContent = t;
    })
    .catch(() => {
      code.textContent = '无法加载源码（可能无本地 HTML 或无权限）';
    });
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  setArticleHtmlTab('preview');
}

function setArticleHtmlTab(which) {
  const iframe = document.getElementById('articleHtmlIframe');
  const pre = document.getElementById('articleHtmlSource');
  if (!iframe || !pre) return;
  document.querySelectorAll('.article-html-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === which);
  });
  const preview = which === 'preview';
  iframe.hidden = !preview;
  pre.hidden = preview;
}

function closeArticleHtmlModal() {
  const modal = document.getElementById('articleHtmlModal');
  const iframe = document.getElementById('articleHtmlIframe');
  if (!modal || !iframe) return;
  modal.hidden = true;
  iframe.src = 'about:blank';
  document.body.style.overflow = '';
}

function openImageLightbox(url) {
  if (!url) return;
  const box = document.getElementById('imageLightbox');
  const im = document.getElementById('imageLightboxImg');
  if (!box || !im) return;
  im.src = url;
  box.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeImageLightbox() {
  const box = document.getElementById('imageLightbox');
  const im = document.getElementById('imageLightboxImg');
  if (!box || !im) return;
  box.hidden = true;
  im.removeAttribute('src');
  document.body.style.overflow = '';
}

function lightboxDataAttrs(url) {
  const enc = encodeURIComponent(String(url));
  return `class="img-zoomable" data-lb="${enc}"`;
}

async function loadMeta() {
  const el = document.getElementById('llmBanner');
  if (!el) return;
  try {
    const m = await apiFetch('/api/meta');
    if (!m.llm_configured) {
      el.textContent =
        '未配置 LLM（请在 .env 设置 LLM_PROVIDER / LLM_MODEL / API_KEY），趋势分析不可用；抓取仍可运行。';
      el.hidden = false;
    }
  } catch (_) {
    /* API 不可用时忽略 */
  }
}

// ── Navigation ───────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => nav(el.dataset.page));
  });
}

function nav(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page)
  );
  document.querySelectorAll('.page').forEach(el => el.style.display = 'none');
  document.getElementById('page-' + page).style.display = '';
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;
  const eyebrow = document.getElementById('pageEyebrow');
  if (eyebrow) eyebrow.textContent = PAGE_EYEBROWS[page] || '';

  if (page === 'dashboard')  loadDashboard();
  if (page === 'reports') {
    loadReportFilterSites().then(() => {
      const sb = document.getElementById('reportSeasonBucketFilter');
      if (sb && _pendingSeasonTag != null) {
        const p = _pendingSeasonTag;
        _pendingSeasonTag = null;
        if (p && [...sb.options].some(o => o.value === p)) sb.value = p;
      }
      loadReports(0);
    });
  }
  if (page === 'seasons')    loadSeasonTrendsPage();
  if (page === 'articles')   loadArticles(0);
  if (page === 'keywords')   loadKeywords();
}

function openSeasonTag(tagId) {
  const id = (tagId || '').trim();
  if (!id) return;
  _pendingSeasonTag = id;
  _autoOpenFirstReportAfterLoad = true;
  nav('reports');
}

async function loadSeasonTrendsPage() {
  const el = document.getElementById('seasonTrendsContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner-center card"><div class="spinner"></div></div>';
  try {
    const d = await apiFetch('/api/reports/filters');
    const rawBuckets = (d.season_facets && d.season_facets.buckets) || [];
    const seasonTagRows = rawBuckets.filter((b) => {
      const c = String(b.season_code || '').toUpperCase();
      const id = String(b.season_bucket_id || '');
      if (c === 'UNKNOWN') return false;
      if (id.toUpperCase().endsWith('_UNKNOWN')) return false;
      const lab = String(b.season_label_zh || '');
      if (lab.includes('未归类')) return false;
      return true;
    });
    if (!seasonTagRows.length) {
      el.innerHTML =
        '<div class="card card-inner text-muted" style="padding:24px;line-height:1.6">' +
        '暂无带<strong>季节归类</strong>的报告。请先运行分析流水线生成趋势报告；凡已写入<strong>季节标签</strong>（含仅有季次、未必对应日历年份）都会在下列表中展示。若「趋势报告」已有条目而此处仍空，多为索引缺少季节标签字段（<code>season_bucket_id</code>）：刷新仪表盘或运行 <code>python -m main backfill-report-seasons</code> 可从 JSON 补齐。' +
        '</div>';
      el.onclick = null;
      return;
    }
    const codeRank = (code) =>
      ({ SS: 0, FW: 1, AW: 1, RESORT: 2, CRUISE: 3, PREFALL: 4, TRANSITION: 5, UNKNOWN: 9 }[String(code || '').toUpperCase()] ?? 8);
    const inferYear = (b) => {
      let y = Number(b.season_year) || 0;
      if (!y && b.season_bucket_id) {
        const head = String(b.season_bucket_id).split('_')[0];
        if (head && /^\d{4}$/.test(head)) y = parseInt(head, 10);
      }
      return y;
    };
    const sortTagList = (list) =>
      [...list].sort(
        (a, b) =>
          codeRank(a.season_code) - codeRank(b.season_code) ||
          String(a.season_bucket_id).localeCompare(String(b.season_bucket_id))
      );
    const byYear = {};
    for (const b of seasonTagRows) {
      const y = inferYear(b) || 0;
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(b);
    }
    const yearOrder = Object.keys(byYear)
      .map(Number)
      .filter((y) => y > 0)
      .sort((a, b) => b - a);
    const orphan = sortTagList(byYear[0] || []);
    for (const y of yearOrder) {
      byYear[y] = sortTagList(byYear[y]);
    }
    const renderTiles = (list) =>
      list
        .map((b) => {
          const bid = String(b.season_bucket_id || '');
          const attr = encodeURIComponent(bid);
          const lab = (b.season_label_zh || bid).replace(/</g, '');
          const n = b.n != null ? b.n : 0;
          const sub = bid && lab !== bid ? bid.replace(/</g, '') : '';
          // 勿用 onclick="openSeasonTag(JSON.stringify(bid))"：双引号会截断 HTML 属性，导致点击无反应
          return `
            <button type="button" class="season-tag-tile" data-tag-id="${attr}">
              <span class="season-tag-tile-title">${escapeHtml(lab)}</span>
              ${sub ? `<span class="season-tag-tile-id">${escapeHtml(sub)}</span>` : ''}
              <span class="season-tag-tile-n">${n} 份报告</span>
            </button>`;
        })
        .join('');
    const renderBlock = (heading, lead, list, dataYearAttr) => {
      const tiles = renderTiles(list);
      const leadHtml = lead
        ? `<p class="season-block-lead text-muted" style="margin:0 0 12px;font-size:13px;line-height:1.5">${lead}</p>`
        : '';
      const dataAttr =
        dataYearAttr !== undefined && dataYearAttr !== null
          ? ` data-display-year="${escapeHtml(String(dataYearAttr))}"`
          : '';
      return `
        <div class="card season-year-card"${dataAttr}>
          <h2 class="season-year-heading font-display">${escapeHtml(heading)}</h2>
          ${leadHtml}
          <div class="season-tag-grid">${tiles}</div>
        </div>`;
    };
    const cy = new Date().getFullYear();
    const windowYears = [];
    for (let i = 0; i <= 7; i++) windowYears.push(cy - i);
    const displayYears = [...new Set([...windowYears, ...yearOrder])]
      .filter((y) => y > 1990 && y <= cy + 1)
      .sort((a, b) => b - a);
    const parts = [];
    const chipYears = [...new Set([cy, cy - 1, cy - 2, cy - 3, cy - 4, ...yearOrder])]
      .filter((y) => y > 1990 && y <= cy + 1)
      .sort((a, b) => b - a);
    parts.push(
      `<div class="card season-toolbar">
        <p class="season-toolbar-lead text-muted" style="margin:0 0 10px;font-size:13px;line-height:1.55">
          <strong>往年与当季</strong>：下列按<strong>季次年份</strong>分组（如 2025 春夏系列、2025 秋冬系列）。行业常用
          <code>SS</code>≈春夏系列、<code>FW</code>/<code>AW</code>≈秋冬系列；若文章单独标出春/夏/秋/冬，会对应
          <code>SPRING</code> 等单季标签。无数据的年份也会列出，便于对照补数与跑流水线。
        </p>
        <div class="season-year-chips" role="tablist" aria-label="按年份筛选">
          <button type="button" class="season-year-chip is-active" data-year-filter="all">全部年份</button>
          ${chipYears
            .map(
              (y) =>
                `<button type="button" class="season-year-chip" data-year-filter="${y}">${escapeHtml(String(y))} 年</button>`
            )
            .join('')}
        </div>
      </div>`
    );
    // 无具体年份仍属季节归类：优先展示，避免被误认为「只有按年才出现」
    if (orphan.length) {
      parts.push(
        renderBlock(
          '季节标签',
          '下列为未能对应到具体日历年份的标签，同样是有效的季节归类。',
          orphan,
          'orphan'
        )
      );
    }
    for (const y of displayYears) {
      const list = byYear[y] || [];
      const emptyLead =
        list.length === 0
          ? '该年份下尚无已归类的季节趋势报告。可将该季 runway/资讯文章入库后运行分析流水线，或检查标题中是否含季次词（如 2025 春夏、SS26）。'
          : '';
      parts.push(renderBlock(`${y} 年`, emptyLead, list, String(y)));
    }
    el.innerHTML = parts.join('');
    const applyYearFilter = (filterVal) => {
      const cards = el.querySelectorAll('.season-year-card[data-display-year]');
      cards.forEach((card) => {
        const dy = card.getAttribute('data-display-year');
        if (filterVal === 'all' || dy === filterVal) {
          card.classList.remove('is-hidden-by-year-filter');
        } else {
          card.classList.add('is-hidden-by-year-filter');
        }
      });
      el.querySelectorAll('.season-year-chip').forEach((c) => {
        const v = c.getAttribute('data-year-filter');
        const active = v === filterVal || (filterVal === 'all' && v === 'all');
        c.classList.toggle('is-active', !!active);
      });
    };
    el.onclick = (e) => {
      const chip = e.target.closest('.season-year-chip');
      if (chip && el.contains(chip)) {
        const f = chip.getAttribute('data-year-filter');
        if (f != null) applyYearFilter(f === 'all' ? 'all' : String(f));
        return;
      }
      const btn = e.target.closest('.season-tag-tile');
      if (!btn || !el.contains(btn)) return;
      const raw = btn.getAttribute('data-tag-id');
      if (raw == null || raw === '') return;
      let id;
      try {
        id = decodeURIComponent(raw);
      } catch (_) {
        id = raw;
      }
      openSeasonTag(id);
    };
  } catch (e) {
    el.innerHTML = `<div class="card card-inner text-muted" style="padding:20px">加载失败：${escapeHtml(e.message || String(e))}</div>`;
    el.onclick = null;
  }
}

// ── WebSocket ────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const base  = API || (proto + '://' + location.host);
  try {
    ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws/pipeline');
  } catch(e) {
    setWsStatus('error');
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    setWsStatus('connected');
    clearTimeout(wsReconnectTimer);
  };

  ws.onmessage = (e) => {
    try { handleWsMessage(JSON.parse(e.data)); }
    catch(err) { console.warn('WS parse error', err); }
  };

  ws.onclose = ws.onerror = () => {
    setWsStatus('error');
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(wsReconnectTimer);
  wsReconnectTimer = setTimeout(connectWS, 5000);
}

function setWsStatus(state) {
  const dot   = document.getElementById('wsStatus').querySelector('.ws-dot');
  const label = document.getElementById('wsStatus').querySelector('.ws-label');
  dot.className = 'ws-dot ' + (state === 'connected' ? 'connected' : state === 'error' ? 'error' : '');
  label.textContent = state === 'connected' ? '已连接' : state === 'error' ? '未连接' : '连接中...';
}

function handleWsMessage(msg) {
  const { type, data } = msg;
  if (type === 'ping') { ws && ws.readyState === 1 && ws.send(JSON.stringify({type:'pong'})); return; }

  if (type === 'started') {
    pipelinePaused = false;
    setPipelineRunning(true);
    renderPipelineProgress({ stage_code: 'boot', stage_label: '初始化任务', stage_detail: '工作流已触发，正在准备执行', progress_percent: 3 });
    toast('流水线已启动 (' + (data.mode || '') + ')', 'info');
  }
  if (type === 'progress') {
    pipelinePaused = !!(data && data.pause_requested);
    setPipelineRunning(true);
    renderPipelineProgress(data);
    updatePauseButton();
  }
  if (type === 'paused') {
    pipelinePaused = true;
    renderPipelineProgress(pipelineLastData || { stage_detail: '已请求暂停，等待安全检查点' });
    updatePauseButton();
    toast('已请求暂停，等待当前任务到达安全检查点', 'info');
  }
  if (type === 'resumed') {
    pipelinePaused = false;
    renderPipelineProgress(pipelineLastData || { stage_detail: '流水线继续运行' });
    updatePauseButton();
    toast('流水线继续运行', 'info');
  }
  if (type === 'completed') {
    pipelinePaused = false;
    renderPipelineProgress({ ...(data || {}), stage_code: 'finalize', stage_label: '完成', stage_detail: '完整工作流分析已完成', progress_percent: 100 });
    setPipelineRunning(false);
    const eff = data ? effectiveTaskStatus(data) : '';
    const toastKind = eff === 'failed' ? 'error' : eff === 'partial' ? 'info' : 'success';
    toast('流水线完成 · ' + taskCompleteToastSummary(data), toastKind);
    if (currentPage === 'dashboard') loadDashboard();
    if (currentPage === 'reports')   loadReports(reportsOffset);
  }
  if (type === 'error') {
    pipelinePaused = false;
    renderPipelineProgress({ ...(pipelineLastData || {}), stage_code: 'failed', stage_label: '失败', stage_detail: data.message || '未知错误' });
    setPipelineRunning(false);
    toast('流水线错误: ' + (data.message || '未知错误'), 'error');
  }
  if (type === 'connected') {
    if (data && data.status === 'running') {
      setPipelineRunning(true);
      pipelinePaused = !!data.pause_requested;
      renderPipelineProgress(data);
      updatePauseButton();
    }
  }
}

function estimateProgress(data) {
  if (data && data.progress_percent != null) return Math.max(0, Math.min(100, _num(data.progress_percent)));
  if (!data) return 10;
  const n = _num(data.articles_analyzed) || _num(data.articles_new);
  const base = n ? Math.min(n / 50 * 80, 80) : 10;
  return Math.max(10, base);
}

function renderPipelineProgress(data) {
  pipelineLastData = data || null;
  const pct = estimateProgress(data);
  const progressBar = document.getElementById('progressBar');
  const statusText = document.getElementById('pipelineStatusText');
  const percentText = document.getElementById('pipelinePercentText');
  const detailText = document.getElementById('pipelineStageDetail');
  const stagesWrap = document.getElementById('pipelineStages');
  if (progressBar) progressBar.style.width = pct + '%';
  if (percentText) percentText.textContent = pct + '%';

  const label = (data && data.stage_label) ? String(data.stage_label) : pipelineModeShort(data ? data.pipeline_mode : '');
  const prefix = pipelinePaused ? '已暂停' : (pipelineRunning ? '运行中' : '已完成');
  if (statusText) statusText.textContent = label ? `${prefix} · ${label}` : prefix;

  const detail = (data && data.stage_detail) ? String(data.stage_detail) : '正在执行工作流';
  if (detailText) detailText.textContent = detail;

  const activeKey = String((data && data.stage_code) || '').trim();
  if (!stagesWrap) return;
  const activeIdx = PIPELINE_STAGE_FLOW.findIndex(s => s.key === activeKey);
  stagesWrap.innerHTML = PIPELINE_STAGE_FLOW.map((stage, idx) => {
    let cls = 'pipeline-stage-item is-pending';
    if (activeKey === 'failed') {
      cls = idx <= Math.max(activeIdx, 0) ? 'pipeline-stage-item is-done' : cls;
    } else if (activeIdx >= 0) {
      if (idx < activeIdx) cls = 'pipeline-stage-item is-done';
      else if (idx === activeIdx) cls = 'pipeline-stage-item is-active';
    } else if (!pipelineRunning && pct >= 100) {
      cls = 'pipeline-stage-item is-done';
    }
    return `<div class="${cls}"><span class="pipeline-stage-dot"></span><span class="pipeline-stage-label">${escapeHtml(stage.label)}</span></div>`;
  }).join('');
}

function setPipelineRunning(running) {
  pipelineRunning = running;
  document.getElementById('pipelineBanner').style.display = running ? '' : 'none';
  const btn = document.getElementById('triggerBtn');
  btn.disabled = running;
  document.getElementById('triggerBtnText').textContent = running ? '运行中...' : '启动完整工作流分析';
}

function updatePauseButton() {
  return;
}

// ── Pipeline Trigger ─────────────────────────────────────────────
async function triggerPipeline() {
  if (pipelineRunning) return;
  const mode = 'full';
  try {
    const res = await apiFetch('/api/pipeline/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (res.status === 'triggered') {
      pipelinePaused = false;
      setPipelineRunning(true);
      renderPipelineProgress({ stage_code: 'boot', stage_label: '初始化任务', stage_detail: '已提交后端任务，等待开始执行', progress_percent: 3 });
      toast('已触发 · 完整工作流分析', 'info');
    }
  } catch (e) {
    toast(e.message || '触发失败', 'error');
  }
}

async function togglePipelinePause() {
  if (!pipelineRunning) return;
  try {
    if (pipelinePaused) {
      await apiFetch('/api/pipeline/resume', { method: 'POST' });
      pipelinePaused = false;
      document.getElementById('pipelineStatusText').textContent = '恢复中...';
    } else {
      await apiFetch('/api/pipeline/pause', { method: 'POST' });
      pipelinePaused = true;
      document.getElementById('pipelineStatusText').textContent = '暂停请求中...';
    }
    updatePauseButton();
  } catch (e) {
    toast(e.message || '操作失败', 'error');
  }
}

// ── API Helper ───────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const d = err.detail;
    const msg = typeof d === 'string' ? d : (Array.isArray(d) ? d.map(x => x.msg || x).join('; ') : res.statusText);
    throw new Error(msg || res.statusText);
  }
  return res.json();
}

// ── Dashboard ────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [stats, latest, tasksData] = await Promise.all([
      apiFetch('/api/stats'),
      apiFetch('/api/reports/latest').catch(() => null),
      apiFetch('/api/tasks?limit=5'),
    ]);
    renderStats(stats);
    renderLatestReport(latest);
    renderRecentTasks(tasksData.tasks || []);
    if (stats.is_running) {
      setPipelineRunning(true);
      try {
        const st = await apiFetch('/api/pipeline/state');
        pipelinePaused = !!st.pause_requested;
        renderPipelineProgress(st.current_task || st);
        updatePauseButton();
      } catch (_) { /* ignore */ }
    } else {
      pipelinePaused = false;
      updatePauseButton();
    }
    // 加载热词速览（非阻塞）
    loadDashHotKeywords().catch(() => {});
  } catch (e) {
    console.error('Dashboard load error', e);
  }
}

async function loadDashHotKeywords() {
  const el = document.getElementById('dashHotKeywords');
  if (!el) return;
  try {
    const data = await apiFetch('/api/trends/hot?limit=40');
    if (!data || !data.length) {
      el.innerHTML = '<span class="text-muted" style="font-size:12px">暂无关键词数据（请先运行分析）</span>';
      return;
    }
    // Group by category, show top 6 per dimension
    const groups = {};
    data.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      if (groups[item.category].length < 6) groups[item.category].push(item);
    });
    const dimOrder = ['colors','fabrics','items','silhouettes','patterns','style_keywords','consumer_signals'];
    const dimLabel = {'colors':'色彩','fabrics':'面料','items':'单品','silhouettes':'廓形','patterns':'图案','style_keywords':'风格词','consumer_signals':'消费信号'};
    const html = dimOrder.filter(k => groups[k] && groups[k].length).map(k => `
      <div class="dash-kw-group">
        <div class="dash-kw-dim-label">${dimLabel[k]}</div>
        <div class="dash-kw-tags">
          ${groups[k].map(item => {
            const swatch = k === 'colors' ? colorSwatchHtml(item.keyword) : '';
            return `<span class="dash-kw-tag kw-cat-${k}" onclick="nav('keywords');setTimeout(()=>clickKeyword(${JSON.stringify(item.keyword)}),200)">${swatch}${escapeHtml(item.keyword)}<sup>${item.count}</sup></span>`;
          }).join('')}
        </div>
      </div>
    `).join('');
    el.innerHTML = html || '<span class="text-muted" style="font-size:12px">暂无关键词数据</span>';
  } catch (e) {
    el.innerHTML = '<span class="text-muted" style="font-size:12px">加载失败</span>';
  }
}

function renderStats(s) {
  const grid = document.getElementById('statsGrid');
  const latestRun = s.latest_run;
  const runStatus = latestRun
    ? (() => {
        const es = effectiveTaskStatus(latestRun);
        return `<span class="badge ${statusBadge(es)}">${statusLabel(es)}</span>`;
      })()
    : '<span class="badge badge-gray">无记录</span>';

  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-accent-bar coral"></div>
      <div class="stat-label">文章总数</div>
      <div class="stat-value">${fmt(s.total_articles)}</div>
      <div class="stat-sub">已分析 ${fmt(s.analyzed_articles)} 篇</div>
    </div>
    <div class="stat-card">
      <div class="stat-accent-bar rose"></div>
      <div class="stat-label">趋势报告</div>
      <div class="stat-value">${fmt(s.total_reports)}</div>
      <div class="stat-sub">LLM 生成</div>
    </div>
    <div class="stat-card">
      <div class="stat-accent-bar amber"></div>
      <div class="stat-label">数据站点</div>
      <div class="stat-value">${fmt(s.total_sites)}</div>
      <div class="stat-sub">已抓取站点</div>
    </div>
    <div class="stat-card">
      <div class="stat-accent-bar mint"></div>
      <div class="stat-label">最近任务</div>
      <div class="stat-value" style="font-size:20px;margin-top:4px">${runStatus}</div>
      <div class="stat-sub">${latestRun ? fmtDate(latestRun.started_at) : '—'}</div>
    </div>
  `;
}

function renderLatestReport(r) {
  const el = document.getElementById('latestReportContent');
  if (!r) {
    el.innerHTML = '<div class="empty-state" style="height:120px"><span class="empty-icon">◉</span><p>暂无报告</p></div>';
    return;
  }
  const trends = r.key_trends || [];
  const repImgs = (r.representative_images || []).slice(0, 5);
  const thumbRow = repImgs.length ? `
    <div class="dash-thumb-row">
      ${repImgs.map(u => {
        const src = String(u).replace(/"/g, '&quot;');
        return `<img ${lightboxDataAttrs(u)} src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border-soft)" onerror="this.style.display='none'">`;
      }).join('')}
    </div>
  ` : '';
  const colorTags = (r.colors || []).slice(0, 8).map(c =>
    `${colorSwatchHtml(c)}<span class="kw-tag kw-cat-colors" style="font-size:11px">${escapeHtml(c)}</span>`
  ).join('');
  const colorRow = colorTags ? `<div class="dash-dim-row" style="margin-top:8px;margin-bottom:6px">${colorTags}</div>` : '';

  el.innerHTML = `
    <div style="margin-bottom:10px">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:4px">${fmtDate(r.generated_at)} · ${(r.covered_sites||[]).join(', ')}</div>
      <div style="font-weight:600;margin-bottom:8px">${escapeHtml(r.summary || '无摘要')}</div>
    </div>
    ${thumbRow}
    ${colorRow}
    ${trends.slice(0,3).map(t => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border-soft)">
        <span class="badge badge-purple" style="flex-shrink:0">${escapeHtml(t.category || '趋势')}</span>
        <span style="font-size:13px">${escapeHtml(t.trend_name || t.name || '')}</span>
      </div>
    `).join('')}
    ${trends.length > 3 ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">还有 ${trends.length - 3} 条趋势...</div>` : ''}
    <button class="btn btn-ghost" style="margin-top:12px;font-size:12px" onclick="nav('reports')">查看完整报告 →</button>
  `;
}

function renderRecentTasks(tasks) {
  const el = document.getElementById('recentTasksContent');
  if (!tasks.length) {
    el.innerHTML = '<div class="text-muted" style="padding:20px 0;text-align:center;font-size:13px">暂无历史分析。点击上方按钮开始一次完整工作流分析。</div>';
    return;
  }
  const t = tasks[0];
  const es = effectiveTaskStatus(t);
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-soft)">
      <div>
        <span class="badge ${statusBadge(es)}">${statusLabel(es)}</span>
        <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${fmtDate(t.started_at)}</span>
      </div>
      <span style="font-size:12px;color:var(--text-muted);text-align:right;max-width:62%">${escapeHtml(taskArticlesOneLine(t))}</span>
    </div>
  `;
}

// ── Reports ──────────────────────────────────────────────────────
async function loadReportFilterSites() {
  try {
    const d = await apiFetch('/api/reports/filters');
    const sel = document.getElementById('reportSiteFilter');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部站点</option>' +
      (d.sites || []).map(s => `<option value="${s}">${s}</option>`).join('');
    if (cur) sel.value = cur;

    const sb = document.getElementById('reportSeasonBucketFilter');
    if (sb) {
      const curB = sb.value;
      const facets = ((d.season_facets && d.season_facets.buckets) || []).filter((b) => {
        const c = String(b.season_code || '').toUpperCase();
        const id = String(b.season_bucket_id || '');
        if (c === 'UNKNOWN') return false;
        if (id.toUpperCase().endsWith('_UNKNOWN')) return false;
        if (String(b.season_label_zh || '').includes('未归类')) return false;
        return true;
      });
      sb.innerHTML = '<option value="">全部季节标签</option>' +
        facets.map(b => {
          const id = String(b.season_bucket_id || '');
          const lab = ((b.season_label_zh || id) + (b.n != null ? ` (${b.n})` : '')).replace(/</g, '');
          const esc = id.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
          return `<option value="${esc}">${lab}</option>`;
        }).join('');
      if (curB) sb.value = curB;
    }
  } catch (_) { /* ignore */ }
}

async function loadReports(offset) {
  reportsOffset = offset;
  document.getElementById('reportsList').innerHTML =
    '<div class="spinner-center"><div class="spinner"></div></div>';

  try {
    const qs = new URLSearchParams({ limit: '20', offset: String(offset) });
    const sf = document.getElementById('reportSiteFilter');
    const sb = document.getElementById('reportSeasonBucketFilter');
    const dq = document.getElementById('reportDimQ');
    if (sf && sf.value) qs.set('site_name', sf.value);
    if (sb && sb.value) qs.set('season_bucket_id', sb.value);
    if (dq && dq.value.trim()) qs.set('dimension_q', dq.value.trim());

    const data = await apiFetch(`/api/reports?${qs}`);
    reportsTotal = data.total;
    renderReportsList(data.reports);
    renderPagination('reportsPagination', reportsTotal, 20, offset, loadReports);

    if (_autoOpenFirstReportAfterLoad) {
      _autoOpenFirstReportAfterLoad = false;
      const rows = data.reports || [];
      if (rows.length && rows[0].report_id) {
        await selectReport(rows[0].report_id);
      }
    }
  } catch (e) {
    document.getElementById('reportsList').innerHTML =
      `<div class="text-muted" style="padding:20px;font-size:13px">加载失败: ${e.message}</div>`;
    if (_autoOpenFirstReportAfterLoad) _autoOpenFirstReportAfterLoad = false;
  }
}

let _allReports = [];
function renderReportsList(reports) {
  _allReports = reports;
  filterReports();
}

function exportReportHtml(reportId) {
  window.location.href = `/api/reports/${reportId}/export?format=html`;
}

function reportImgBox(url) {
  if (!url) return '';
  const u = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const enc = encodeURIComponent(String(url));
  return `<div class="report-img-box">
    <img ${lightboxDataAttrs(url)} src="${u}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="reportImgFail(this)" />
    <div class="img-fail-placeholder" hidden>加载失败 <button type="button" class="btn-mini" data-src-enc="${enc}" onclick="reportImgRetry(this)">重试</button></div>
  </div>`;
}

function reportImgFail(img) {
  img.style.visibility = 'hidden';
  const ph = img.nextElementSibling;
  if (ph) ph.hidden = false;
}

function reportImgRetry(btn) {
  const u = decodeURIComponent(btn.getAttribute('data-src-enc') || '');
  const box = btn.closest('.report-img-box');
  const img = box.querySelector('img');
  btn.parentElement.hidden = true;
  img.style.visibility = 'visible';
  img.src = u + (u.includes('?') ? '&' : '?') + '_r=' + Date.now();
}

async function subscribeEmail() {
  const el = document.getElementById('subscribeEmail');
  const email = (el && el.value || '').trim();
  if (!email) { toast('请输入邮箱'); return; }
  try {
    await apiFetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    toast('已保存订阅偏好（邮件推送需服务端配置 SMTP）');
    el.value = '';
  } catch (e) {
    toast(e.message || '失败');
  }
}

async function dedupeArticles() {
  if (!confirm('将合并：① 规范化后相同的链接（忽略 ? 参数等）② 同站点且标题相同。保留最早抓取的一条。继续？')) return;
  try {
    const d = await apiFetch('/api/articles/dedupe', { method: 'POST' });
    const n = d.removed ?? 0;
    const a = d.removed_normalized_url ?? 0;
    const b = d.removed_title_site ?? 0;
    toast(`已删除 ${n} 条（链接规范化 ${a}，同站同标题 ${b}）`);
    loadArticles(articlesOffset);
  } catch (e) {
    toast(e.message || '失败');
  }
}

function filterReports() {
  const q = (document.getElementById('reportsSearch').value || '').toLowerCase();
  const filtered = q ? _allReports.filter(r =>
    (r.summary || '').toLowerCase().includes(q) ||
    (r.report_date || '').includes(q) ||
    (r.season_label_zh || '').toLowerCase().includes(q) ||
    (r.season_bucket_id || '').toLowerCase().includes(q) ||
    (r.covered_sites || []).some(s => s.toLowerCase().includes(q))
  ) : _allReports;

  const el = document.getElementById('reportsList');
  if (!filtered.length) {
    el.innerHTML = '<div class="text-muted" style="padding:20px;font-size:13px;text-align:center">无匹配报告</div>';
    return;
  }
  el.innerHTML = filtered.map(r => `
    <div class="report-list-item ${r.report_id === selectedReportId ? 'active' : ''}"
         onclick="selectReport('${r.report_id}')">
      <div class="report-item-date">${fmtDate(r.generated_at)}</div>
      <div class="report-item-title">${r.summary ? r.summary.slice(0, 60) + (r.summary.length > 60 ? '…' : '') : r.report_id}</div>
      ${r.season_label_zh ? `<div class="report-item-season"><span class="badge badge-purple">${r.season_label_zh}</span></div>` : ''}
      <div class="report-item-sites">
        ${(r.covered_sites || []).map(s => `<span class="badge badge-gray">${s}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

async function selectReport(id) {
  selectedReportId = id;
  filterReports(); // re-render list to update active state
  const panel = document.getElementById('reportDetailPanel');
  panel.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
  try {
    const r = await apiFetch(`/api/reports/${id}`);
    renderReportDetail(r, panel);
  } catch (e) {
    panel.innerHTML = `<div class="text-muted" style="padding:20px;font-size:13px">加载失败: ${e.message}</div>`;
  }
}

function renderReportDetail(r, el) {
  const trends = r.key_trends || [];
  const srcKeys = r.source_articles || [];
  const details = r.source_article_details || [];
  const detailMap = Object.fromEntries(details.map(d => [d.unique_key, d]));
  const sourceRows = srcKeys.map(k =>
    detailMap[k] || {
      unique_key: k,
      title: k,
      site_name: '',
      article_url: '',
      has_raw_html: false,
    }
  );

  // 四大板块渲染辅助
  function renderDetailSection(title, items, isColorSection) {
    if (!items || !items.length) return '';
    return `
      <div class="trends-section">
        <h2>${title} (${items.length})</h2>
        <div class="detail-cards-grid">
          ${items.map(item => {
            const conf = item.confidence || 0;
            const pct = Math.round(conf * 100);
            const swatch = isColorSection ? colorSwatchHtml(item.name) : '';
            const dirIcon = { '上升': '↑', '新兴': '★', '稳定': '→' }[item.trend_direction] || '';
            return `
            <div class="detail-card">
              <div class="detail-card-header">
                <span class="detail-name">${swatch}${escapeHtml(item.name || '')}</span>
                ${item.trend_direction ? `<span class="badge ${dirBadge(item.trend_direction)}">${dirIcon} ${item.trend_direction}</span>` : ''}
              </div>
              ${pct ? `
                <div class="confidence-mini-bar">
                  <div class="confidence-mini-fill" style="width:${pct}%"></div>
                  <span class="confidence-mini-label">${pct}%</span>
                </div>` : ''}
              ${item.selected_images && item.selected_images.length ? `
                <div class="detail-images">
                  ${item.selected_images.slice(0,2).map(url => reportImgBox(url)).join('')}
                </div>
              ` : ''}
              <div class="detail-desc">${escapeHtml(item.description || '')}</div>
              ${item.representative_brands && item.representative_brands.length ? `
                <div class="detail-brands">
                  ${item.representative_brands.map(b => `<span class="badge badge-brand">${escapeHtml(b)}</span>`).join('')}
                </div>
              ` : ''}
              ${item.style_tips && item.style_tips.length ? `
                <ul class="detail-tips">
                  ${item.style_tips.map(tip => `<li>${escapeHtml(tip)}</li>`).join('')}
                </ul>
              ` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderNarrativeSection(title, intro, items, opts = {}) {
    if (!items || !items.length) return '';
    const imageKey = opts.imageKey || 'selected_images';
    const titleKey = opts.titleKey || 'name';
    const descKey = opts.descKey || 'description';
    const badgeKey = opts.badgeKey || '';
    return `
      <div class="trends-section report-prose-section">
        <h2>${title}</h2>
        ${intro ? `<p class="report-prose-lead">${escapeHtml(intro)}</p>` : ''}
        <div class="report-prose-grid">
          ${items.map(item => {
            const label = item[titleKey] || '未命名';
            const desc = item[descKey] || '';
            const badge = badgeKey && item[badgeKey] ? `<span class="badge badge-purple">${escapeHtml(item[badgeKey])}</span>` : '';
            const imgs = (item[imageKey] || []).slice(0, 3);
            return `
              <article class="report-prose-card">
                <div class="report-prose-card-head">
                  <h3>${escapeHtml(label)}</h3>
                  ${badge}
                </div>
                <p class="report-prose-text">${renderEnhancedDescription(desc || '暂无文字说明')}</p>
                ${imgs.length ? `<div class="report-prose-images">${imgs.map(url => reportImgBox(url)).join('')}</div>` : ''}
              </article>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  const proseBlocks = [];
  if (trends.length) {
    proseBlocks.push(
      renderNarrativeSection(
        'DeepSeek 汇总趋势解读',
        '以下内容以 DeepSeek 汇总后的文字分析为主，并配对应代表图片。',
        trends.map(t => ({
          name: t.trend_name || t.name || '未命名趋势',
          description: t.description || t.desc || '',
          category: t.category || '',
          selected_images: t.selected_images || [],
        })),
        { badgeKey: 'category' }
      )
    );
  }
  if ((r.style_details || []).length) {
    proseBlocks.push(
      renderNarrativeSection('款式观察', '围绕款式方向的汇总文字解读。', r.style_details)
    );
  }
  if ((r.item_details || []).length) {
    proseBlocks.push(
      renderNarrativeSection('单品观察', '围绕重点单品的汇总文字解读。', r.item_details)
    );
  }
  if ((r.silhouette_details || []).length) {
    proseBlocks.push(
      renderNarrativeSection('廓形观察', '围绕版型和轮廓变化的汇总文字解读。', r.silhouette_details)
    );
  }
  if ((r.color_details || []).length) {
    proseBlocks.push(
      renderNarrativeSection('色彩观察', '围绕色彩方向的汇总文字解读。', r.color_details)
    );
  }

  el.innerHTML = `
    ${renderReportHeaderImage(r)}
    <div class="report-detail-header">
      ${r.season_label_zh ? `<div class="report-season-banner">${r.season_label_zh}</div>` : ''}
      <h1>${r.summary ? r.summary.slice(0, 80) : 'DeepSeek 汇总分析'}</h1>
      <div class="report-meta">
        <span class="badge badge-purple">${r.report_date || ''}</span>
        ${r.season_label_zh && !r.season_label_zh.includes('未归类') ? '' : `<span class="badge badge-teal">${r.season_label_zh || ''}</span>`}
        <span class="badge badge-gray">${r.llm_model || 'LLM'}</span>
        ${(r.covered_sites || []).map(s => `<span class="badge badge-blue">${s}</span>`).join('')}
        ${r.partial ? '<span class="badge badge-yellow">部分数据</span>' : ''}
        ${r.confidence ? renderConfidenceRing(r.confidence, 36) : ''}
      </div>
      <div class="report-summary">${r.summary || '—'}</div>
      ${r.body_notice_zh ? `<div class="report-body-notice" role="status">${escapeHtml(r.body_notice_zh)}</div>` : ''}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-ghost" style="font-size:12px" onclick="exportReportHtml('${r.report_id}')">导出 HTML（可打印 PDF）</button>
      </div>
    </div>

    <!-- Color Palette Board -->
    ${renderColorPaletteBoard(r.colors)}

    <!-- Moodboard from representative images -->
    ${(r.representative_images && r.representative_images.length) ? `
      <div class="trends-section">
        <h2>趋势视觉板 · Moodboard</h2>
        ${renderMoodboard(r.representative_images, 8)}
      </div>
    ` : ''}

    <!-- Dimension Summary Cards -->
    ${renderDimensionSummaryCards(r)}

    <!-- Consumer Signals -->
    ${renderConsumerSignals(r.consumer_signals)}

    ${proseBlocks.join('')}

    <details class="archived-report-block">
      <summary>归档查看原始结构化趋势报告</summary>
      <div class="archived-report-inner">
        ${['colors','fabrics','items','silhouettes','patterns','style_keywords'].some(k => (r[k]||[]).length) ? `
          <div class="trends-section dimension-overview">
            <h2>维度概览</h2>
            <div class="dim-overview-grid">
              ${[
                ['colors','色彩', true],
                ['fabrics','面料', false],
                ['items','单品', false],
                ['silhouettes','廓形', false],
                ['patterns','图案', false],
                ['style_keywords','风格词', false],
                ['consumer_signals','消费信号', false],
              ].filter(([k]) => (r[k]||[]).length).map(([k, lbl, isColor]) => `
                <div class="dim-group">
                  <div class="dim-group-label">${lbl}</div>
                  <div class="dim-group-tags">
                    ${(r[k]||[]).slice(0,10).map(w => `${isColor ? colorSwatchHtml(w) : ''}<span class="kw-tag kw-cat-${k}" onclick="nav('keywords');setTimeout(()=>showKwTimeline(${JSON.stringify(w)}),200)">${escapeHtml(w)}</span>`).join('')}
                  </div>
                </div>`).join('')}
            </div>
          </div>
        ` : ''}

        ${trends.length ? `
          <div class="trends-section">
            <h2>关键趋势 (${trends.length})</h2>
            ${trends.map(t => renderTrendCard(t)).join('')}
          </div>
        ` : ''}

        ${renderDetailSection('款式板块', r.style_details, false)}
        ${renderDetailSection('单品板块', r.item_details, false)}
        ${renderDetailSection('版型板块', r.silhouette_details, false)}
        ${renderDetailSection('颜色板块', r.color_details, true)}
      </div>
    </details>

    ${sourceRows.length ? `
      <div class="trends-section">
        <h2>来源文章 (${sourceRows.length})</h2>
        <p class="source-articles-hint">以下为分析所依据的抓取文章；若已保存本地 HTML，可预览或查看源码。</p>
        ${sourceRows.slice(0, 10).map(row => {
          const uk = row.unique_key || '';
          const title = escapeHtml(row.title || uk);
          const site = row.site_name ? escapeHtml(row.site_name) : '';
          const url = (row.article_url || '').replace(/"/g, '&quot;');
          const has = row.has_raw_html;
          return `
            <div class="source-article-row" data-uk="${encodeURIComponent(uk)}">
              <div class="source-article-main">
                <div class="source-article-title">${title}</div>
                <div class="source-article-meta">
                  ${site ? `<span class="badge badge-gray">${site}</span>` : ''}
                  ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="source-article-link">原文链接</a>` : ''}
                </div>
              </div>
              <div class="source-article-actions">
                ${has
                  ? `<button type="button" class="btn btn-ghost btn-mini source-html-btn">抓取 HTML</button>`
                  : `<span class="source-no-html">未存本地 HTML</span>`
                }
              </div>
            </div>`;
        }).join('')}
        ${sourceRows.length > 10 ? `<div class="source-articles-more">…共 ${sourceRows.length} 篇</div>` : ''}
      </div>
    ` : ''}

    <div style="margin-top:20px;font-size:12px;color:var(--text-dim)">
      生成于 ${fmtDate(r.generated_at)} · ID: ${r.report_id}
    </div>
  `;
}

function renderTrendCard(t) {
  const conf = t.confidence || t.confidence_score || 0;
  const pct = Math.round(conf * 100);
  const imgs = t.selected_images || [];
  const relColors = t.related_colors || [];
  const relFabrics = t.related_fabrics || [];
  const relItems = t.related_items || [];
  const evidence = t.evidence || t.supporting_evidence || [];
  return `
    <div class="trend-card">
      <div class="trend-card-header">
        <div style="flex:1;min-width:0">
          <div class="trend-name">${escapeHtml(t.trend_name || t.name || '未命名趋势')}</div>
          ${t.category ? `<span class="badge badge-purple" style="margin-top:4px">${escapeHtml(t.category)}</span>` : ''}
        </div>
        ${conf ? `
          <div class="confidence-bar-wrap">
            <div class="confidence-label">${pct}%</div>
            <div style="height:5px;border-radius:3px;background:var(--border);min-width:80px">
              <div class="confidence-bar" style="width:${pct}%"></div>
            </div>
          </div>
        ` : ''}
      </div>
      ${imgs.length ? `
        <div class="trend-images">
          ${imgs.map(url => reportImgBox(url)).join('')}
        </div>
      ` : ''}
      <div class="trend-desc">${escapeHtml(t.description || t.desc || '')}</div>
      ${relColors.length ? `
        <div class="trend-related-row">
          <span class="trend-related-label">关联色彩</span>
          ${relColors.slice(0, 6).map(c => `${colorSwatchHtml(c)}<span class="kw-tag kw-cat-colors">${escapeHtml(c)}</span>`).join('')}
        </div>` : ''}
      ${relFabrics.length ? `
        <div class="trend-related-row">
          <span class="trend-related-label">关联面料</span>
          ${relFabrics.slice(0, 5).map(f => `<span class="kw-tag kw-cat-fabrics">${escapeHtml(f)}</span>`).join('')}
        </div>` : ''}
      ${relItems.length ? `
        <div class="trend-related-row">
          <span class="trend-related-label">关联单品</span>
          ${relItems.slice(0, 5).map(i => `<span class="kw-tag kw-cat-items">${escapeHtml(i)}</span>`).join('')}
        </div>` : ''}
      ${evidence.length ? `
        <details class="trend-evidence-toggle">
          <summary>证据来源 (${evidence.length})</summary>
          <div class="trend-evidence">
            ${evidence.slice(0, 3).map(ev => {
              if (typeof ev === 'string') return `<div class="ev-item">· ${escapeHtml(ev)}</div>`;
              const link = ev.article_url ? `<a href="${String(ev.article_url).replace(/"/g,'&quot;')}" target="_blank" rel="noopener" class="ev-link">↗</a>` : '';
              return `<div class="ev-item">· <strong>${escapeHtml(ev.site_name || '')}</strong> ${link}<br><span class="ev-snippet">${escapeHtml(ev.snippet || ev.title || '')}</span></div>`;
            }).join('')}
          </div>
        </details>
      ` : ''}
    </div>
  `;
}

// ── Articles ─────────────────────────────────────────────────────
async function loadArticles(offset) {
  articlesOffset = offset;
  const site     = document.getElementById('articleSiteFilter').value;
  const analyzed = document.getElementById('articleAnalyzedFilter').value;
  const search   = (document.getElementById('articlesSearch').value || '').trim();
  const hint     = document.getElementById('articlesSearchHint');

  let url = `/api/articles?limit=24&offset=${offset}`;
  if (site) url += `&site_name=${encodeURIComponent(site)}`;
  if (analyzed !== '') url += `&analyzed=${analyzed}`;
  if (search) url += `&q=${encodeURIComponent(search)}`;

  document.getElementById('articlesGrid').innerHTML =
    '<div class="spinner-center" style="grid-column:1/-1"><div class="spinner"></div></div>';
  if (hint) hint.textContent = search ? '搜索中…' : '';

  try {
    const data = await apiFetch(url);
    articlesTotal = data.total;

    // populate site filter
    const sel = document.getElementById('articleSiteFilter');
    const curVal = sel.value;
    if (sel.options.length <= 1) {
      (data.site_names || []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        sel.appendChild(opt);
      });
      sel.value = curVal;
    }

    const articles = data.articles || [];
    if (hint) hint.textContent = search ? `共 ${data.total} 条结果` : '';

    renderArticles(articles);
    renderPagination('articlesPagination', articlesTotal, 24, offset, loadArticles);
  } catch (e) {
    document.getElementById('articlesGrid').innerHTML =
      `<div class="text-muted" style="padding:20px;font-size:13px">加载失败: ${e.message}</div>`;
    if (hint) hint.textContent = '';
  }
}

function renderArticles(articles) {
  const grid = document.getElementById('articlesGrid');
  if (!articles.length) {
    grid.innerHTML = '<div class="text-muted" style="grid-column:1/-1;text-align:center;padding:40px;font-size:13px">无文章数据</div>';
    return;
  }
  // Category-based placeholder colors
  const catColors = {
    'fashion': '#C9A96E', 'trend': '#7C2D3A', 'runway': '#2D6A5A',
    'street-style': '#C45C48', 'shopping': '#4A6FA5', 'default': '#9C9590'
  };
  grid.innerHTML = articles.map(a => {
    const img = (a.image_urls || [])[0];
    const rawUrl = (a.article_url || '').trim();
    const hasUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://');
    const href = hasUrl ? rawUrl.replace(/"/g, '&quot;') : '';
    const cat = (a.category || 'default').toLowerCase();
    const placeholderColor = catColors[cat] || catColors['default'];
    const placeholderSvg = `<div class="article-thumb-placeholder" style="background:${placeholderColor}20;color:${placeholderColor};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:300;font-family:serif">${(a.title||'F')[0]}</div>`;
    const inner = `
        ${img
          ? `<img class="article-thumb" src="${String(img).replace(/"/g, '&quot;')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=this.nextElementSibling.innerHTML" /><template>${placeholderSvg}</template>`
          : placeholderSvg
        }
        <div class="article-body">
          <div class="article-site">${escapeHtml(a.site_name || '')}</div>
          <div class="article-title">${escapeHtml(a.title || '无标题')}</div>
          <div class="article-summary">${escapeHtml(a.summary || '')}</div>
          <div class="article-footer">
            <span class="article-date">${fmtDate(a.published_at || a.crawled_at)}</span>
            ${a.llm_analyzed
              ? '<span class="badge badge-green">已分析</span>'
              : '<span class="badge badge-gray">未分析</span>'
            }
          </div>
        </div>`;
    if (hasUrl) {
      return `<a class="article-card" href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    return `<div class="article-card article-card-nolink" title="该条未记录原文链接">${inner}</div>`;
  }).join('');
}

function debounceArticleSearch() {
  clearTimeout(articlesSearchTm);
  articlesSearchTm = setTimeout(() => loadArticles(0), 350);
}

// ── Tasks ─────────────────────────────────────────────────────────
async function loadTasks() {
  try {
    const data = await apiFetch('/api/tasks?limit=50');
    renderTasks(data.tasks || []);
  } catch (e) {
    document.getElementById('tasksList').innerHTML =
      `<div class="text-muted" style="padding:20px;font-size:13px">加载失败: ${e.message}</div>`;
  }
}

function renderTasks(tasks) {
  const el = document.getElementById('tasksList');
  const detail = document.getElementById('taskDetailPanel');
  if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
  if (!tasks.length) {
    el.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;font-size:13px">暂无任务记录</div>';
    return;
  }
  el.innerHTML = `
    <div class="task-row task-row-header">
      <span>#</span>
      <span>开始时间</span>
      <span>状态</span>
      <span>模式</span>
      <span title="完整模式：新入库篇数；仅分析：参与趋势分析篇数">文章</span>
      <span>抓取</span>
      <span>分析</span>
      <span>Token</span>
      <span>备注 / 操作</span>
    </div>
    ${tasks.map((t, i) => {
      const cm = t.crawl_duration_ms ? `${Math.round(t.crawl_duration_ms / 100) / 10}s` : '—';
      const am = t.analyze_duration_ms ? `${Math.round(t.analyze_duration_ms / 100) / 10}s` : '—';
      const tk = t.llm_tokens_total_est != null && t.llm_tokens_total_est > 0 ? String(t.llm_tokens_total_est) : '—';
      const mode = t.pipeline_mode || '—';
      const es = effectiveTaskStatus(t);
      const canRetry = es === 'failed' || es === 'partial';
      return `
      <div class="task-row task-row-clickable" data-rid="${t.run_id}">
        <span class="task-num">${i + 1}</span>
        <span style="font-size:12px">${fmtDate(t.started_at)}</span>
        <span><span class="badge ${statusBadge(es)}">${statusLabel(es)}</span></span>
        <span style="font-size:11px">${mode}</span>
        <span style="font-size:11px" title="${escapeHtml(taskArticlesOneLine(t))}">${taskArticlesTableCell(t)}</span>
        <span style="font-size:11px">${cm}</span>
        <span style="font-size:11px">${am}</span>
        <span style="font-size:11px">${tk}</span>
        <span style="font-size:11px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span style="color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis">${(t.error_message || '').slice(0, 80)}</span>
          <button type="button" class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="event.stopPropagation();showTaskDetail('${t.run_id}')">详情</button>
          ${canRetry ? `<button type="button" class="btn btn-primary" style="font-size:11px;padding:2px 8px" onclick="event.stopPropagation();retryTask('${t.run_id}')">重试</button>` : ''}
        </span>
      </div>`;
    }).join('')}
  `;
}

async function showTaskDetail(runId) {
  const panel = document.getElementById('taskDetailPanel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
  try {
    const t = await apiFetch(`/api/tasks/${runId}`);
    const es = effectiveTaskStatus(t);
    const canRetry = es === 'failed' || es === 'partial';
    panel.innerHTML = `
      <div style="padding:16px;font-size:13px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px">
          <div>
            <strong>任务 ${t.run_id}</strong>
            <div style="font-size:12px;color:var(--text-muted);margin-top:6px">
              模式 ${t.pipeline_mode || '—'} · 抓取 ${t.crawl_duration_ms || 0} ms · 分析 ${t.analyze_duration_ms || 0} ms
            </div>
          </div>
          ${canRetry ? `<button type="button" class="btn btn-primary" onclick="retryTask('${t.run_id}')">重试</button>` : ''}
        </div>
        <pre style="white-space:pre-wrap;font-size:11px;color:var(--text-muted);max-height:320px;overflow:auto;background:var(--bg-soft);padding:12px;border-radius:8px">${JSON.stringify(t, null, 2)}</pre>
      </div>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    panel.innerHTML = `<div class="text-muted" style="padding:16px">${e.message}</div>`;
  }
}

async function retryTask(runId) {
  try {
    await apiFetch(`/api/pipeline/retry/${runId}`, { method: 'POST' });
    toast('已触发重试');
    loadTasks();
  } catch (e) {
    toast(e.message || '失败');
  }
}

// ── Sites ─────────────────────────────────────────────────────────
async function loadSites() {
  document.getElementById('sitesGrid').innerHTML =
    '<div class="spinner-center" style="grid-column:1/-1"><div class="spinner"></div></div>';
  try {
    const data = await apiFetch('/api/sites');
    renderSites(data.sites || []);
  } catch (e) {
    document.getElementById('sitesGrid').innerHTML =
      `<div class="text-muted" style="padding:20px;font-size:13px">加载失败: ${e.message}</div>`;
  }
}

function renderSites(sites) {
  const grid = document.getElementById('sitesGrid');
  if (!sites.length) {
    grid.innerHTML = '<div class="text-muted" style="grid-column:1/-1;text-align:center;padding:40px;font-size:13px">无站点配置</div>';
    return;
  }
  grid.innerHTML = sites.map(s => `
    <div class="site-card" style="border-color:${s.is_valid ? 'var(--border)' : 'var(--danger)'}">
      <div class="site-card-header">
        <span class="site-name">${s.site_name}</span>
        <div style="display:flex;gap:6px">
          ${s.enabled ? '<span class="badge badge-green">启用</span>' : '<span class="badge badge-gray">禁用</span>'}
          ${s.is_valid ? '<span class="badge badge-blue">有效</span>' : '<span class="badge badge-red">配置错误</span>'}
        </div>
      </div>
      <div class="site-meta">
        <div class="site-meta-row">
          <span class="site-meta-label">分页方式</span>
          <span>${s.pagination_type}</span>
        </div>
        <div class="site-meta-row">
          <span class="site-meta-label">最大页数</span>
          <span>${s.max_pages}</span>
        </div>
        <div class="site-meta-row">
          <span class="site-meta-label">每次最多文章</span>
          <span>${s.max_articles_per_run}</span>
        </div>
        <div class="site-meta-row">
          <span class="site-meta-label">需要登录</span>
          <span>${s.has_login ? '是' : '否'}</span>
        </div>
        <div class="site-meta-row">
          <span class="site-meta-label">选择器配置</span>
          <span>${s.selectors_configured ? '<span class="badge badge-green">完整</span>' : '<span class="badge badge-yellow">不完整</span>'}</span>
        </div>
      </div>
      <div class="site-urls">
        ${(s.entry_urls || []).slice(0,2).map(u => `<div class="site-url">${u}</div>`).join('')}
      </div>
      ${s.validation_errors && s.validation_errors.length ? `
        <div class="site-errors">
          ${s.validation_errors.map(e => `<div class="site-error-item">· ${e}</div>`).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
}

// ── Keywords / 热词追踪 ───────────────────────────────────────────
let _kwAllData = [];  // cache for filter

async function loadKeywords() {
  const cat = document.getElementById('kwCategoryFilter')?.value || '';
  const board = document.getElementById('kwBoardGrid');
  const title = document.getElementById('kwBoardTitle');
  if (!board) return;
  board.innerHTML = '<div class="spinner-center" style="grid-column:1/-1"><div class="spinner"></div></div>';

  try {
    let url = `/api/trends/hot?limit=100`;
    if (cat) url += `&category=${encodeURIComponent(cat)}`;
    _kwAllData = await apiFetch(url);
    if (title) title.textContent = cat ? `热词排行 · ${{'colors':'色彩','fabrics':'面料','items':'单品','silhouettes':'廓形','patterns':'图案','style_keywords':'风格词','consumer_signals':'消费信号'}[cat] || cat}` : '热词排行';
    filterKeywords();
    setupKwResize();
  } catch (e) {
    board.innerHTML = `<div class="text-muted" style="padding:20px">加载失败: ${e.message}</div>`;
  }
}

function filterKeywords() {
  const q = (document.getElementById('kwFilterInput')?.value || '').toLowerCase();
  const data = q ? _kwAllData.filter(item => item.keyword.toLowerCase().includes(q)) : _kwAllData;
  renderHotKeywords(data);
}

// ResizeObserver for word cloud auto-redraw
let _kwResizeObserver = null;
function setupKwResize() {
  if (_kwResizeObserver) return;
  const board = document.getElementById('kwBoardGrid');
  if (!board) return;
  let debounceTimer = null;
  _kwResizeObserver = new ResizeObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (_kwAllData && _kwAllData.length && document.getElementById('page-keywords')?.style.display !== 'none') {
        filterKeywords();
      }
    }, 200);
  });
  _kwResizeObserver.observe(board);
}

function renderHotKeywords(data) {
  const board = document.getElementById('kwBoardGrid');
  if (!board) return;
  if (!data || !data.length) {
    board.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center">暂无关键词数据（请先运行趋势分析）</div>';
    return;
  }

  const cat = document.getElementById('kwCategoryFilter')?.value || '';

  // ═══ Canvas-based word cloud with real text measurement ═══
  const parentCard = board.closest('.card');
  const W = Math.max(600, (parentCard ? parentCard.clientWidth - 40 : board.clientWidth) || 800);
  const H = Math.max(480, Math.round(W * 0.55));
  const maxCount = data[0]?.count || 1;
  const colors = ['#8B6914','#7C2D3A','#1A1A1A','#2D6A5A','#C45C48','#A8894E','#4A6FA5','#6B6560'];

  // Create off-screen canvas for text measurement
  const measureCanvas = document.createElement('canvas');
  const mCtx = measureCanvas.getContext('2d');

  const words = data.slice(0, 60).map((item, idx) => {
    const weight = item.count / maxCount;
    const size = Math.round(15 + Math.pow(weight, 0.7) * 50);
    const fontWeight = size > 36 ? '700' : size > 22 ? '500' : '400';
    const font = `${fontWeight} ${size}px "Noto Serif SC", "Georgia", serif`;
    mCtx.font = font;
    const metrics = mCtx.measureText(item.keyword);
    const textW = Math.ceil(metrics.width) + 12;
    const textH = Math.ceil(size * 1.25) + 6;
    return {
      text: item.keyword, count: item.count, category: item.category,
      size, font, fontWeight, color: colors[idx % colors.length],
      w: textW, h: textH,
    };
  });

  // Spiral placement with real bounding boxes
  const placed = [];
  const cx = W / 2, cy = H / 2;

  function overlaps(x, y, w, h) {
    for (const p of placed) {
      if (Math.abs(x - p.x) < (w + p.w) / 2 + 6 &&
          Math.abs(y - p.y) < (h + p.h) / 2 + 4) return true;
    }
    return false;
  }

  function inBounds(x, y, w, h) {
    return x - w/2 > 8 && x + w/2 < W - 8 && y - h/2 > 8 && y + h/2 < H - 8;
  }

  const positioned = [];
  for (const word of words) {
    let bestX = -1, bestY = -1;
    // Archimedean spiral: r = a + b*theta
    for (let t = 0; t < 2000 && bestX < 0; t++) {
      const r = 2.5 * t * 0.05;
      const angle = t * 0.15;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle) * 0.85; // slight vertical compression for oval shape
      if (inBounds(x, y, word.w, word.h) && !overlaps(x, y, word.w, word.h)) {
        bestX = x; bestY = y;
      }
    }
    if (bestX >= 0) {
      placed.push({ x: bestX, y: bestY, w: word.w, h: word.h });
      positioned.push({ ...word, x: bestX, y: bestY });
    }
  }

  // Render as SVG
  const svgItems = positioned.map((w, i) => {
    const delay = i * 12;
    const esc = w.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const escSingle = w.text.replace(/'/g, "\\'");
    return `<text x="${Math.round(w.x)}" y="${Math.round(w.y)}"
      font-size="${w.size}" fill="${w.color}" text-anchor="middle" dominant-baseline="central"
      font-family="'Noto Serif SC','Georgia',serif" font-weight="${w.fontWeight}"
      cursor="pointer" opacity="0"
      data-keyword="${esc}" data-count="${w.count}" data-category="${w.category||''}"
      style="transition:opacity 0.2s,transform 0.2s;animation:wordFadeIn 0.4s ease ${delay}ms forwards"
      onmouseenter="wordCloudHover(this,true)" onmouseleave="wordCloudHover(this,false)"
      onclick="showKwTimeline('${escSingle}')">${esc}</text>`;
  }).join('');

  board.innerHTML = `
    <style>
      @keyframes wordFadeIn { from{opacity:0;transform:scale(0.85)} to{opacity:0.92;transform:scale(1)} }
      .wc-tooltip{position:absolute;pointer-events:none;z-index:100;background:rgba(26,26,26,0.92);
        color:#fff;padding:10px 16px;border-radius:10px;font-size:12px;line-height:1.6;
        box-shadow:0 8px 24px rgba(0,0,0,0.2);opacity:0;transition:opacity 0.15s;
        backdrop-filter:blur(8px);font-family:Arial,sans-serif;max-width:220px}
      .wc-tooltip.visible{opacity:1}
    </style>
    <div style="position:relative;width:100%;border-radius:12px;background:var(--bg-card,#fffcf7);overflow:hidden">
      <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${svgItems}</svg>
      <div class="wc-tooltip" id="wcTooltip"></div>
    </div>
    <p style="text-align:center;margin-top:10px;font-size:11px;color:var(--text-dim,#999)">
      点击词语查看趋势时间线 · 已展示 ${positioned.length} / ${data.length} 个热词
    </p>`;
}

// Word cloud hover interaction
function wordCloudHover(el, entering) {
  const svg = el.closest('svg');
  if (!svg) return;
  const tooltip = document.getElementById('wcTooltip');
  const allTexts = svg.querySelectorAll('text');

  if (entering) {
    // Dim others, highlight this
    allTexts.forEach(t => {
      if (t === el) {
        t.style.opacity = '1';
        t.style.transform = 'scale(1.15)';
        t.style.transformOrigin = 'center';
      } else {
        t.style.opacity = '0.2';
      }
    });
    // Show tooltip
    if (tooltip) {
      const kw = el.getAttribute('data-keyword');
      const count = el.getAttribute('data-count');
      const category = el.getAttribute('data-category');
      const dimLabel = {'colors':'色彩','fabrics':'面料','items':'单品','silhouettes':'廓形','patterns':'图案','style_keywords':'风格词','consumer_signals':'消费信号'};
      tooltip.innerHTML = `<strong>${kw}</strong><br/>出现 ${count} 次${category ? ` · ${dimLabel[category] || category}` : ''}`;
      tooltip.classList.add('visible');
      const rect = el.getBoundingClientRect();
      const container = svg.closest('div').getBoundingClientRect();
      tooltip.style.left = (rect.left - container.left + rect.width/2 - 60) + 'px';
      tooltip.style.top = (rect.top - container.top - 44) + 'px';
    }
  } else {
    // Restore all
    allTexts.forEach(t => {
      t.style.opacity = '';
      t.style.transform = '';
    });
    if (tooltip) tooltip.classList.remove('visible');
  }
}

async function showKwTimeline(keyword) {
  const card = document.getElementById('kwTimelineCard');
  const title = document.getElementById('kwTimelineTitle');
  const hint = document.getElementById('kwTimelineHint');
  const canvas = document.getElementById('kwTimelineCanvas');
  if (!card || !canvas) return;

  card.style.display = '';
  if (title) title.textContent = keyword;
  if (hint) hint.textContent = '加载中…';
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const data = await apiFetch(
      `/api/trends/timeline?keyword=${encodeURIComponent(keyword)}&lookback_days=730&max_points=500`
    );
    if (!data || !data.length) {
      if (hint) hint.textContent = '暂无时间线数据（需要多份历史报告）';
      return;
    }
    drawKwSparkline(canvas, data);
    const presentCount = data.filter(d => d.present).length;
    if (hint) {
      hint.textContent =
        `近约 2 年（730 天）时间线：共 ${data.length} 个报告点，「${keyword}」在维度中出现于其中 ${presentCount} 份（按报告日期升序，含历史非仅最新）`;
    }
  } catch (e) {
    if (hint) hint.textContent = `加载失败: ${e.message}`;
  }
}

function closeKwTimeline() {
  const card = document.getElementById('kwTimelineCard');
  if (card) card.style.display = 'none';
}

function clickKeyword(keyword) {
  // Called from dashboard hot-keywords to jump to timeline
  const inp = document.getElementById('kwFilterInput');
  if (inp) inp.value = keyword;
  showKwTimeline(keyword);
}

function drawKwSparkline(canvas, data) {
  const W = canvas.offsetWidth || 800;
  const H = canvas.height;
  canvas.width = W;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const pad = { top: 20, bottom: 30, left: 40, right: 16 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const n = data.length;

  // Grid lines
  ctx.strokeStyle = '#e8e0e4';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + chartH - (i / 4) * chartH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#999';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round((i / 4) * maxCount), pad.left - 4, y + 3);
  }

  // Filled area
  const getX = i => pad.left + (n === 1 ? chartW / 2 : i / (n - 1) * chartW);
  const getY = v => pad.top + chartH - (v / maxCount) * chartH;

  ctx.beginPath();
  ctx.moveTo(getX(0), H - pad.bottom);
  data.forEach((d, i) => ctx.lineTo(getX(i), getY(d.count)));
  ctx.lineTo(getX(n - 1), H - pad.bottom);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, 'rgba(157,58,89,0.28)');
  grad.addColorStop(1, 'rgba(157,58,89,0.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#9d3a59';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  data.forEach((d, i) => i === 0 ? ctx.moveTo(getX(i), getY(d.count)) : ctx.lineTo(getX(i), getY(d.count)));
  ctx.stroke();

  // Dots + labels
  data.forEach((d, i) => {
    const x = getX(i), y = getY(d.count);
    ctx.beginPath();
    ctx.arc(x, y, d.present ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = d.present ? '#9d3a59' : '#ccc';
    ctx.fill();

    // Date labels（点很多时略增间隔，避免重叠）
    const labelSlots = Math.min(8, Math.max(4, Math.floor(n / 40) + 4));
    const step = Math.max(1, Math.floor(n / labelSlots));
    if (i % step === 0 || i === n - 1) {
      ctx.fillStyle = '#888';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      const label = (d.date || '').slice(5); // MM-DD
      ctx.fillText(label, x, H - pad.bottom + 14);
    }
  });
}

// ── Color Swatch ─────────────────────────────────────────────────
const COLOR_MAP = {
  // ── 白色系 ──
  '白': '#FFFFFF', '纯白': '#FFFFFF', '雪白': '#FFFAFA', '米白': '#FAF0E6',
  '奶白': '#FFF8E7', '象牙白': '#FFFFF0', '云白': '#F5F5F5', '乳白': '#FFFDD0',
  '珍珠白': '#F5F0EC', '月白': '#F0F4F8', '霜白': '#F8F8FF',
  // ── 黑色系 ──
  '黑': '#1a1a1a', '纯黑': '#000000', '炭黑': '#1C1C1C', '墨黑': '#2C2C2C',
  '曜石黑': '#0B0B0B', '深邃黑': '#111111', '松烟墨': '#2B2B2B',
  // ── 灰色系 ──
  '灰': '#9E9E9E', '浅灰': '#D3D3D3', '深灰': '#696969', '银灰': '#C0C0C0',
  '烟灰': '#878787', '雾灰': '#B0BEC5', '石灰': '#A9A9A9', '铅灰': '#6E7B8B',
  '水泥灰': '#8B8E8A', '暖灰': '#A69E94', '冷灰': '#8A949E',
  // ── 红色系 ──
  '红': '#E53935', '玫红': '#C2185B', '酒红': '#722F37', '深红': '#B71C1C',
  '砖红': '#C62828', '橙红': '#E64A19', '绛红': '#8B0000', '绯红': '#DC143C',
  '朱红': '#FF4500', '玫瑰红': '#FF007F', '正红': '#FF0000', '中国红': '#D62828',
  '樱桃红': '#DE3163', '覆盆子红': '#E30B5C', '西瓜红': '#FC6C85',
  '番茄红': '#FF6347', '铁锈红': '#B7410E', '暗红': '#8B0000',
  '红棕': '#A0522D', '赭红': '#CC4444',
  // ── 品牌红 ──
  'Valentino红': '#BE0025', 'valentino': '#BE0025', '华伦天奴红': '#BE0025',
  'Hermès橙红': '#F37021', 'Louboutin红': '#E50000',
  'Chanel红': '#C41E3A', 'Dior红': '#CD0C2A',
  // ── 粉色系 ──
  '粉': '#F48FB1', '粉红': '#FF69B4', '淡粉': '#FFB6C1', '肉粉': '#FFDAB9',
  '玫瑰粉': '#FF91A4', '桃粉': '#FFCBA4', '樱花粉': '#FFB7C5',
  '芭比粉': '#DA1884', '腮红粉': '#E8A0BF', '烟粉': '#D4A5A5',
  '裸粉': '#E6C2B8', '脏粉': '#C9A0A0', '蜜桃粉': '#FFDAB9',
  '千禧粉': '#E8B4B8', '豆沙粉': '#C08B8B',
  // ── 橙色系 ──
  '橙': '#FF8C00', '橙色': '#FFA500', '杏色': '#FBCEB1', '姜黄': '#E5AA04',
  '焦糖': '#C68642', '燕麦': '#F5DEB3', '沙色': '#F4A460',
  '蜜橙': '#FFB347', '南瓜橙': '#FF7518', '赤陶橙': '#E07C4F',
  '暖橙': '#ED820E', '落日橙': '#F07623', '柿子色': '#ED6B21',
  // ── 黄色系 ──
  '黄': '#FFD600', '柠黄': '#FFF44F', '金黄': '#FFD700', '奶油黄': '#FFFDD0',
  '香草': '#F3E5AB', '稻草色': '#E4D96F', '鹅黄': '#FFF8DC',
  '芥末黄': '#E1AD01', '琥珀黄': '#FFBF00', '暖黄': '#FFD54F',
  '明黄': '#FFEB3B', '土黄': '#D4A735', '米黄': '#F5F5DC',
  // ── 棕/驼色系 ──
  '棕': '#795548', '咖啡棕': '#6F4E37', '卡其': '#C3B091', '驼色': '#C19A6B',
  '可可棕': '#7B3F00', '巧克力': '#7B3F00', '栗色': '#800000',
  '骆驼棕': '#C19A6B', '焦糖棕': '#A0522D', '太妃糖': '#B8860B',
  '肉桂': '#D2691E', '琥珀': '#FFBF00', '古铜棕': '#8B4513',
  '深棕': '#5C3317', '浅棕': '#D2B48C', '奶茶色': '#C8A882',
  '大地色': '#A07850', '摩卡': '#967969', '裸色': '#E3BC9A',
  '燕麦色': '#D4C5A9', '亚麻色': '#C4B29A',
  // ── 绿色系 ──
  '绿': '#4CAF50', '墨绿': '#2E7D32', '军绿': '#556B2F', '橄榄绿': '#808000',
  '薄荷绿': '#98FF98', '豆绿': '#78C878', '翠绿': '#00A86B', '苔藓绿': '#8A9A5B',
  '草绿': '#7CFC00', '艾草绿': '#9EA587', '松绿': '#2F6D5E',
  '湖绿': '#3A8C7A', '鼠尾草绿': '#87AE73', '牛油果绿': '#568203',
  '孔雀绿': '#009B7D', '青绿': '#00827F', '森林绿': '#228B22',
  '抹茶绿': '#BDD6A2', '深绿': '#006400',
  // ── 蓝色系 ──
  '蓝': '#2196F3', '藏青': '#00356B', '海军蓝': '#001F5B', '牛仔蓝': '#4B6FA5',
  '天蓝': '#87CEEB', '宝蓝': '#4169E1', '普蓝': '#003087', '矢车菊蓝': '#6495ED',
  '水蓝': '#00CED1', '雾霾蓝': '#8EAFC2', '克莱因蓝': '#002FA7',
  '静谧蓝': '#92A8D1', '冰蓝': '#B0E0E6', '钴蓝': '#0047AB',
  '电光蓝': '#7DF9FF', '深蓝': '#00008B', '浅蓝': '#ADD8E6',
  '灰蓝': '#6D8EA0', '靛蓝': '#4B0082', '午夜蓝': '#191970',
  '湖蓝': '#30A9DE', '婴儿蓝': '#89CFF0',
  // ── 蓝绿色系 ──
  '蓝绿': '#008B8B', '青色': '#00BCD4', '湖水绿': '#4FBDBA',
  '蒂芙尼蓝': '#81D8D0', '孔雀蓝': '#006D6F',
  // ── 紫色系 ──
  '紫': '#9C27B0', '薰衣草': '#E6E6FA', '葡萄紫': '#6F2DA8', '丁香紫': '#C9A0DC',
  '茄紫': '#674172', '紫罗兰': '#EE82EE', '靛紫': '#4B0082',
  '梅紫': '#8E4585', '藕紫': '#B8A9C9', '烟紫': '#736AFF',
  '深紫': '#301934', '浅紫': '#DDA0DD', '兰紫': '#7B68EE',
  '紫红': '#C71585', '暗紫': '#483D8B', '莓紫': '#8B008B',
  // ── 金属色 ──
  '金': '#FFD700', '银': '#C0C0C0', '玫瑰金': '#B76E79', '古铜': '#CD7F32',
  '香槟金': '#F7E7CE', '铂金': '#E5E4E2', '黄铜': '#B5A642',
  '金铜': '#C9A96E', '暗金': '#B8860B', '钛金': '#878681',
  // ── 流行色/趋势色 ──
  '云舞白': '#F5F0EC', '蜜桃': '#FFBE98', '珊瑚': '#FF6B6B', '薄荷': '#98FF98',
  '草木绿': '#5C8A5C', '活珊瑚': '#FF6F61', '经典蓝': '#0F4C81',
  '极致灰': '#939597', '亮丽黄': '#F5DF4D', '长春花蓝': '#6667AB',
  '洋红': '#BB2649', '柔和桃': '#FFBE98', '数码薰衣草': '#E6E6FA',
  // ── 低饱和/莫兰迪色系 ──
  '低饱和': '#A8A0A0', '莫兰迪': '#B8AFA6', '灰调': '#9B9B9B',
  '莫兰迪粉': '#D4A5A5', '莫兰迪蓝': '#8EAFC2', '莫兰迪绿': '#9EA587',
  '莫兰迪紫': '#B8A9C9', '低饱和蓝': '#8EAFC2', '低饱和绿': '#9EA587',
  '低饱和紫': '#B8A9C9', '哑光': '#A09880',
  // ── 多色/复合描述 ──
  '黑白': '#1a1a1a', '红黑': '#8B0000', '蓝白': '#4169E1',
  '大地色系': '#A07850', '中性色': '#BEB8AE', '暖色调': '#D4956A',
  '冷色调': '#7B9BAD', '高饱和': '#FF4500', '撞色': '#FF6B6B',
};

function colorSwatchHtml(colorName) {
  const hex = resolveColorHex(colorName);
  if (!hex) return '';
  const textColor = isLightColor(hex) ? '#555' : '#fff';
  return `<span class="color-swatch" style="background:${hex};border-color:${isLightColor(hex)?'#ccc':hex};color:${textColor}" title="${colorName}"></span>`;
}

function resolveColorHex(name) {
  if (!name) return null;
  const n = name.trim();

  // 1. Direct exact match
  if (COLOR_MAP[n]) return COLOR_MAP[n];

  // 2. Case-insensitive match for English names
  const lower = n.toLowerCase();
  for (const [key, hex] of Object.entries(COLOR_MAP)) {
    if (key.toLowerCase() === lower) return hex;
  }

  // 3. Handle compound colors like "棕色/驼色/红棕" — take first segment
  if (n.includes('/') || n.includes('、') || n.includes('与') || n.includes('和')) {
    const parts = n.split(/[/、与和]+/);
    for (const part of parts) {
      const trimmed = part.trim().replace(/色$/, '');
      if (COLOR_MAP[trimmed]) return COLOR_MAP[trimmed];
      // Substring match
      for (const [key, hex] of Object.entries(COLOR_MAP)) {
        if (trimmed.includes(key) || key.includes(trimmed)) return hex;
      }
    }
  }

  // 4. Remove common suffixes/prefixes and retry
  const cleaned = n.replace(/色系?$|系$|调$|风$/, '');
  if (COLOR_MAP[cleaned]) return COLOR_MAP[cleaned];

  // 5. Substring match — name contains a known color key
  for (const [key, hex] of Object.entries(COLOR_MAP)) {
    if (n.includes(key) && key.length >= 2) return hex;
  }

  // 6. Known color key is contained in the name
  for (const [key, hex] of Object.entries(COLOR_MAP)) {
    if (key.includes(n) && n.length >= 2) return hex;
  }

  // 7. Handle "低饱和XXX色系" pattern
  const lowSat = n.match(/低饱和.*(红|粉|橙|黄|绿|蓝|紫|棕)/);
  if (lowSat) {
    const base = lowSat[1];
    const muted = { '红':'#C08080','粉':'#D4A5A5','橙':'#C9A080','黄':'#C9C080',
      '绿':'#9EA587','蓝':'#8EAFC2','紫':'#B8A9C9','棕':'#A89080' };
    return muted[base] || '#A8A0A0';
  }

  // 8. Handle brand+color like "Valentino红" "Chanel黑"
  const brandColor = n.match(/(红|粉|橙|黄|绿|蓝|紫|黑|白|金|银|棕|驼|灰)$/);
  if (brandColor) {
    return COLOR_MAP[brandColor[1]] || null;
  }

  return null;
}

function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

// ── Pagination ────────────────────────────────────────────────────
function renderPagination(containerId, total, pageSize, currentOffset, loadFn) {
  const el = document.getElementById(containerId);
  if (total <= pageSize) { el.innerHTML = ''; return; }
  const pages = Math.ceil(total / pageSize);
  const cur   = Math.floor(currentOffset / pageSize);

  let html = `<button class="page-btn" ${cur === 0 ? 'disabled' : ''} onclick="${loadFn.name}(${(cur-1)*pageSize})">‹</button>`;
  const range = pageRange(cur, pages);
  range.forEach(p => {
    if (p === '…') {
      html += `<span style="color:var(--text-dim);padding:0 4px">…</span>`;
    } else {
      html += `<button class="page-btn ${p === cur ? 'active' : ''}" onclick="${loadFn.name}(${p*pageSize})">${p+1}</button>`;
    }
  });
  html += `<button class="page-btn" ${cur >= pages-1 ? 'disabled' : ''} onclick="${loadFn.name}(${(cur+1)*pageSize})">›</button>`;
  el.innerHTML = html;
}

function pageRange(cur, total) {
  if (total <= 7) return Array.from({length: total}, (_, i) => i);
  const r = [0];
  if (cur > 2) r.push('…');
  for (let i = Math.max(1, cur-1); i <= Math.min(total-2, cur+1); i++) r.push(i);
  if (cur < total - 3) r.push('…');
  r.push(total - 1);
  return r;
}

// ── Toast ─────────────────────────────────────────────────────────
function createToastContainer() {
  if (!document.getElementById('toastContainer')) {
    const div = document.createElement('div');
    div.id = 'toastContainer';
    document.body.appendChild(div);
  }
}

function toast(msg, type = 'info') {
  const tc = document.getElementById('toastContainer');
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  tc.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// ── Helpers ───────────────────────────────────────────────────────
function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('zh-CN'); }

function escapeHtml(s) {
  if (s == null || s === '') return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtDate(str) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    if (isNaN(d)) return str;
    return d.toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch { return str; }
}

function statusBadge(s) {
  return { running:'badge-yellow', success:'badge-green', failed:'badge-red', partial:'badge-blue', pending:'badge-gray' }[s] || 'badge-gray';
}

function statusLabel(s) {
  return { running:'运行中', success:'成功', failed:'失败', partial:'部分完成', pending:'等待' }[s] || s || '—';
}

function dirBadge(d) {
  return { '上升':'badge-green', '新兴':'badge-purple', '稳定':'badge-blue' }[d] || 'badge-gray';
}

// ═══════════════════════════════════════════════════════════════
// FASHION DESIGN ENHANCEMENTS
// Color palette boards, moodboard views, trend direction chips,
// confidence rings, consumer signal visualization
// ═══════════════════════════════════════════════════════════════

/**
 * Render a visual color palette board from color names array.
 * Shows proportional strips like a Pantone swatch board.
 */
function renderColorPaletteBoard(colors) {
  if (!colors || !colors.length) return '';
  const strips = colors.slice(0, 12).map(c => {
    const hex = resolveColorHex(c) || '#ccc';
    const textColor = isLightColor(hex) ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)';
    return `<div class="color-palette-strip" style="background:${hex}" title="${escapeHtml(c)}">
      <span class="cp-label" style="color:${textColor}">${escapeHtml(c)}</span>
    </div>`;
  }).join('');
  return `<div class="color-palette-board">${strips}</div>`;
}

/**
 * Render a moodboard from representative images.
 * First image gets hero (2x2) treatment.
 */
function renderMoodboard(images, maxCount) {
  if (!images || !images.length) return '';
  const max = maxCount || 8;
  const items = images.slice(0, max);
  const html = items.map((url, idx) => {
    const heroClass = idx === 0 ? 'moodboard-hero' : '';
    const src = String(url).replace(/"/g, '&quot;');
    return `<div class="${heroClass}">
      <img ${lightboxDataAttrs(url)} src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
    </div>`;
  }).join('');
  return `<div class="moodboard-grid">${html}</div>`;
}

/**
 * Render a trend direction chip with icon.
 */
function renderTrendDirChip(direction) {
  if (!direction) return '';
  const map = {
    '上升': { cls: 'rising', icon: '<path d="M7 17l5-5 5 5M7 7l5 5 5-5"/>', label: '上升' },
    '新兴': { cls: 'emerging', icon: '<path d="M12 2v10m-5-5l5 5 5-5"/>', label: '新兴' },
    '稳定': { cls: 'stable', icon: '<path d="M5 12h14"/>', label: '稳定' },
  };
  const d = map[direction] || map['稳定'];
  return `<span class="trend-dir-chip ${d.cls}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${d.icon}</svg>
    ${d.label}
  </span>`;
}

/**
 * Render a confidence ring (SVG donut chart).
 */
function renderConfidenceRing(confidence, size) {
  if (confidence == null || confidence <= 0) return '';
  const pct = Math.round(confidence * 100);
  const s = size || 48;
  const r = (s - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - confidence);
  const color = pct >= 75 ? '#2d6a5a' : pct >= 50 ? '#c87941' : '#b91c1c';
  return `<div class="confidence-ring" style="width:${s}px;height:${s}px">
    <svg width="${s}" height="${s}">
      <circle cx="${s/2}" cy="${s/2}" r="${r}" stroke="#e8e4df" stroke-width="4" fill="none"/>
      <circle cx="${s/2}" cy="${s/2}" r="${r}" stroke="${color}" stroke-width="4" fill="none"
        stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
    </svg>
    <span class="cr-value">${pct}%</span>
  </div>`;
}

/**
 * Render dimension summary cards (compact grid overview).
 */
function renderDimensionSummaryCards(report) {
  const dims = [
    { key: 'colors', label: '色彩趋势', isColor: true },
    { key: 'fabrics', label: '面料趋势', isColor: false },
    { key: 'items', label: '流行单品', isColor: false },
    { key: 'silhouettes', label: '廓形趋势', isColor: false },
    { key: 'patterns', label: '图案趋势', isColor: false },
    { key: 'style_keywords', label: '风格标签', isColor: false },
    { key: 'consumer_signals', label: '消费信号', isColor: false },
  ];
  const cards = dims.filter(d => (report[d.key] || []).length > 0).map(d => {
    const items = (report[d.key] || []).slice(0, 8);
    const tags = items.map(w => {
      const swatch = d.isColor ? colorSwatchHtml(w) : '';
      return `${swatch}<span class="kw-tag kw-cat-${d.key}" style="font-size:11px">${escapeHtml(w)}</span>`;
    }).join('');
    return `<div class="dim-summary-card">
      <div class="dim-title">${d.label} (${(report[d.key] || []).length})</div>
      <div class="dim-items">${tags}</div>
    </div>`;
  }).join('');
  if (!cards) return '';
  return `<div class="trends-section"><h2>维度概览</h2>
    <div class="dim-summary-grid">${cards}</div>
  </div>`;
}

/**
 * Render consumer signals section with dedicated cards.
 */
function renderConsumerSignals(signals) {
  if (!signals || !signals.length) return '';
  const cards = signals.slice(0, 6).map(s => {
    return `<div class="signal-card">
      <div class="signal-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>
        </svg>
      </div>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text)">${escapeHtml(s)}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="trends-section"><h2>消费者信号与行为洞察</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">${cards}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════
// TASK 3: LLM Intelligent Image Insertion in Reports
// Parses {{IMAGE: keyword | description | position}} markers
// and injects Unsplash images
// ═══════════════════════════════════════════════════════

function parseAndInjectReportImages(text) {
  if (!text) return text;
  // Regex to find {{IMAGE: keyword | description | position}}
  const imageRegex = /\{\{IMAGE:\s*([^|]+?)(?:\s*\|\s*([^|]*?))?(?:\s*\|\s*([^}]*?))?\s*\}\}/g;
  let result = text;
  let match;
  const replacements = [];

  while ((match = imageRegex.exec(text)) !== null) {
    const keyword = (match[1] || '').trim();
    const description = (match[2] || '').trim();
    const position = (match[3] || '段后').trim();
    if (!keyword) continue;

    const encodedKw = encodeURIComponent(keyword.replace(/\s+/g, ','));
    const imgUrl = `https://source.unsplash.com/featured/800x500/?${encodedKw}`;
    const figureHtml = `
      <figure style="margin:24px 0;position:relative;border-radius:12px;overflow:hidden;background:#f5f2ee">
        <img src="${imgUrl}" alt="${escapeHtml(description || keyword)}" loading="lazy"
          style="width:100%;height:auto;display:block;border-radius:12px;min-height:200px;object-fit:cover"
          onerror="this.closest('figure').style.display='none'" />
        ${description ? `
        <figcaption style="position:absolute;bottom:0;left:0;right:0;padding:16px 20px 14px;
          background:linear-gradient(transparent,rgba(0,0,0,0.6));color:white;font-size:12px;
          font-style:italic;border-radius:0 0 12px 12px">${escapeHtml(description)}</figcaption>` : ''}
      </figure>`;

    replacements.push({ original: match[0], replacement: figureHtml });
  }

  for (const r of replacements) {
    result = result.replace(r.original, r.replacement);
  }

  return result;
}

// Enhance report description rendering to support image markers
function renderEnhancedDescription(text) {
  if (!text) return '';
  // First try to parse image markers
  const processed = parseAndInjectReportImages(text);
  if (processed !== text) return processed;
  // No markers found - return escaped text
  return escapeHtml(text);
}

// Auto-generate a header image for reports without images
function renderReportHeaderImage(report) {
  if (!report) return '';
  const hasImages = (report.representative_images || []).length > 0;
  if (hasImages) return '';
  // Generate from report title keywords
  const summary = report.summary || '';
  const keywords = summary.replace(/[，。、！？；：（）]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 3).join(',');
  if (!keywords) return '';
  const url = `https://source.unsplash.com/featured/1200x400/?fashion,${encodeURIComponent(keywords)}`;
  return `
    <figure style="margin:0 0 20px;border-radius:12px;overflow:hidden;background:#f5f2ee;max-height:300px">
      <img src="${url}" alt="趋势报告配图" loading="lazy"
        style="width:100%;height:300px;object-fit:cover;display:block"
        onerror="this.closest('figure').style.display='none'" />
    </figure>`;
}

// ═══════════════════════════════════════════════════════
// UX: Offline detection
// ═══════════════════════════════════════════════════════
(function initOfflineDetection() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.textContent = '当前处于离线状态，部分功能可能不可用';
  document.body.prepend(banner);

  function update() {
    banner.classList.toggle('visible', !navigator.onLine);
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
})();

// ═══════════════════════════════════════════════════════
// UX: Retry wrapper for API calls
// ═══════════════════════════════════════════════════════
function renderRetryError(containerId, message, retryFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="empty-state" style="min-height:200px">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
      </svg>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="btn btn-ghost" style="margin-top:12px" onclick="${retryFn}">
        重试
      </button>
    </div>`;
}
