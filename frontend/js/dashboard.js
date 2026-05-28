// ═══════════════════════════════════════════════════════════════════
// VECTYRA DASHBOARD — FULL BACKEND INTEGRATION
// ═══════════════════════════════════════════════════════════════════
// Requires: api.js loaded BEFORE this script
// Backend endpoints:
//   POST /api/auth/register  — { email, password, full_name, company }
//   POST /api/auth/login     — { email, password }
//   GET  /api/auth/me        — Bearer token → user profile
//   GET  /api/vacancies      — Bearer → user's vacancies
//   POST /api/vacancies      — Bearer + { title, description }
//   GET  /api/candidates     — Bearer → user's candidates
//   POST /api/analyze        — vacancy_text, file OR resume_text_input
//   GET  /api/health         — liveness check
// ═══════════════════════════════════════════════════════════════════

const GREEN = '#3D7A5A', GOLD = '#C9963C';

// ── Global data stores ──
let vacanciesData = [];
let candidatesData = [];
let selectedVacancyId = null;

// ── SIDEBAR TOGGLE ──
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active');
}

// ── TAB NAVIGATION ──
const tabConfig = {
  overview:   { title: 'Огляд',            sub: 'Актуальний стан вашого HR-пайплайну' },
  analysis:   { title: 'AI Аналіз резюме', sub: 'Завантажте резюме та отримайте Semantic Match Score' },
  vacancies:  { title: 'Вакансії',         sub: 'Управляйте активними позиціями' },
  candidates: { title: 'Кандидати',        sub: 'База кандидатів з AI-аналізом' },
  analytics:  { title: 'Аналітика',        sub: 'Графіки та KPI вашого HR-процесу' },
  settings:   { title: 'Налаштування',     sub: 'Профіль, AI та безпека' },
};

function showTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.add('active');
  const navBtn = document.getElementById('nav-' + tabId);
  if (navBtn) navBtn.classList.add('active');
  const cfg = tabConfig[tabId];
  if (cfg) {
    document.getElementById('topbar-title').textContent = cfg.title;
    document.getElementById('topbar-subtitle').textContent = cfg.sub;
  }
  // Load data when switching to tabs
  if (tabId === 'vacancies') loadVacancies();
  if (tabId === 'candidates') loadCandidates();
  if (tabId === 'analytics') initAnalyticsCharts();
  if (tabId === 'settings') populateSettings();
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');
}

// ═══════════════════════════════════════════════════════════════════
// AUTH — Login / Register / Logout (real backend)
// ═══════════════════════════════════════════════════════════════════

function openModal()  { document.getElementById('auth-modal')?.classList.add('open'); }
function closeModal() { document.getElementById('auth-modal')?.classList.remove('open'); }
function switchTab(tab) {
  document.getElementById('login-form').style.display    = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('tab-login')?.classList.toggle('active', tab === 'login');
  document.getElementById('tab-register')?.classList.toggle('active', tab === 'register');
  document.getElementById('modal-title').textContent = tab === 'login' ? 'Вітаємо назад!' : 'Створіть акаунт';
  document.getElementById('modal-sub').textContent   = tab === 'login' ? 'Увійдіть, щоб продовжити' : 'Безкоштовно · Без кредитної картки';
}

async function handleLogin(e) {
  e?.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const btn   = document.getElementById('btn-login-submit');

  if (!email || !pass) {
    showToast('Введіть email та пароль', 'warning');
    return;
  }

  setButtonLoading(btn, true, 'Входимо…');
  try {
    const res  = await apiLogin(email, pass);
    const data = await safeJson(res);

    if (!res.ok) {
      showToast(data.detail || 'Неправильний email або пароль', 'error');
      return;
    }

    // Save auth
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    updateUIForUser(data.user);
    closeModal();
    showToast(`Вітаємо, ${data.user.full_name}!`, 'success');

    // Load data
    loadVacancies();
    loadCandidates();
    loadOverviewStats();
  } catch (err) {
    console.error('Login error:', err);
    showToast('Помилка з\'єднання з сервером', 'error');
  } finally {
    setButtonLoading(btn, false, 'Увійти →');
  }
}

async function handleRegister(e) {
  e?.preventDefault();
  const name    = document.getElementById('reg-name').value.trim();
  const email   = document.getElementById('reg-email').value.trim();
  const company = document.getElementById('reg-company').value.trim();
  const pass    = document.getElementById('reg-pass').value;
  const btn     = document.getElementById('btn-reg-submit');

  if (!name || !email || !pass) {
    showToast('Заповніть усі обов\'язкові поля', 'warning');
    return;
  }
  if (pass.length < 6) {
    showToast('Пароль має бути мінімум 6 символів', 'warning');
    return;
  }

  setButtonLoading(btn, true, 'Реєструємо…');
  try {
    const res  = await apiRegister(email, pass, name, company);
    const data = await safeJson(res);

    if (!res.ok) {
      showToast(data.detail || 'Помилка реєстрації', 'error');
      return;
    }

    Auth.setToken(data.token);
    Auth.setUser(data.user);
    updateUIForUser(data.user);
    closeModal();
    showToast(`Акаунт створено! Вітаємо, ${data.user.full_name}!`, 'success');
  } catch (err) {
    console.error('Register error:', err);
    showToast('Помилка з\'єднання з сервером', 'error');
  } finally {
    setButtonLoading(btn, false, 'Створити акаунт →');
  }
}

function handleLogout() {
  Auth.removeToken();
  showToast('Ви вийшли з акаунту', 'info');
  // Reset UI
  updateUIForUser(null);
  // Show auth modal
  setTimeout(() => openModal(), 500);
}

function updateUIForUser(user) {
  const nameEl      = document.querySelector('.user-name');
  const avatarEl    = document.querySelector('.user-avatar');
  const roleEl      = document.querySelector('.user-role');
  const settingsName    = document.getElementById('settings-name');
  const settingsEmail   = document.getElementById('settings-email');
  const settingsCompany = document.getElementById('settings-company');
  const settingsRole    = document.getElementById('settings-role');

  if (user) {
    const displayName = user.full_name || user.email || 'Користувач';
    if (nameEl) nameEl.textContent = displayName;
    if (avatarEl) {
      avatarEl.textContent = displayName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    }
    if (roleEl) roleEl.textContent = (user.role || 'HR') + (user.company ? ` · ${user.company}` : '');
    if (settingsName) settingsName.value = user.full_name || '';
    if (settingsEmail) settingsEmail.value = user.email || '';
    if (settingsCompany) settingsCompany.value = user.company || '';
    if (settingsRole) settingsRole.value = user.role || '';
  } else {
    if (nameEl) nameEl.textContent = 'Гість';
    if (avatarEl) avatarEl.textContent = '??';
    if (roleEl) roleEl.textContent = 'Не авторизований';
  }
}

// ═══════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════

async function runHealthCheck() {
  const badge = document.querySelector('#ai-banner .ai-banner-badge');
  const online = await checkBackendHealth();
  if (badge) {
    badge.textContent      = online ? 'Live ✓' : 'Офлайн ✗';
    badge.style.background = online
      ? 'linear-gradient(135deg,#52B788,#3D7A5A)'
      : 'linear-gradient(135deg,#EF4444,#B91C1C)';
  }
  return online;
}

// ═══════════════════════════════════════════════════════════════════
// VACANCIES — Load from backend
// ═══════════════════════════════════════════════════════════════════

async function loadVacancies() {
  if (!Auth.isLoggedIn()) return;

  const loadingEl = document.getElementById('vacancies-loading');
  const emptyEl   = document.getElementById('vacancies-empty');
  const errorEl   = document.getElementById('vacancies-error');
  const tableEl   = document.getElementById('vacancies-table-wrap');
  const tbody     = document.getElementById('vacancies-tbody');

  // Show loading
  if (loadingEl) loadingEl.style.display = 'flex';
  if (emptyEl) emptyEl.style.display = 'none';
  if (errorEl) errorEl.style.display = 'none';
  if (tableEl) tableEl.style.display = 'none';

  try {
    const res  = await apiFetch(API.vacancies, { method: 'GET' });
    const data = await safeJson(res);

    if (!res.ok) throw new Error(data.detail || 'Failed to load vacancies');

    vacanciesData = data.vacancies || [];

    if (loadingEl) loadingEl.style.display = 'none';

    if (vacanciesData.length === 0) {
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }

    // Update sidebar badge
    const badge = document.querySelector('#nav-vacancies .link-badge');
    if (badge) badge.textContent = vacanciesData.length;

    // Render table
    tbody.innerHTML = vacanciesData.map(v => {
      const statusClass = v.status === 'Active' ? 'status-review' : 'status-new';
      const statusLabel = v.status === 'Active' ? 'Активна' : v.status;
      return `
        <tr>
          <td>
            <div class="candidate-name">${escHtml(v.title)}</div>
            <div class="candidate-role">${escHtml(v.description.substring(0, 60))}${v.description.length > 60 ? '…' : ''}</div>
          </td>
          <td>${v.candidates_count}</td>
          <td><span class="match-badge ${v.average_score > 70 ? 'match-high' : v.average_score > 40 ? 'match-mid' : 'match-low'}">${v.average_score}%</span></td>
          <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
          <td>${v.created_at}</td>
          <td><button class="card-action-btn" onclick="useVacancyForAnalysis(${v.id})">🤖 Аналіз</button></td>
        </tr>`;
    }).join('');

    if (tableEl) tableEl.style.display = 'block';

  } catch (err) {
    console.error('Load vacancies error:', err);
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) {
      errorEl.style.display = 'flex';
      document.getElementById('vacancies-error-msg').textContent = err.message;
    }
  }
}

function useVacancyForAnalysis(vacancyId) {
  const v = vacanciesData.find(x => x.id === vacancyId);
  if (!v) return;
  selectedVacancyId = vacancyId;
  showTab('analysis');
  const textarea = document.getElementById('vacancy-text');
  if (textarea) textarea.value = v.description;
  showToast(`Вакансію "${v.title}" завантажено для аналізу`, 'success');
}

// ── Create Vacancy Modal ──

function openCreateVacancyModal() {
  if (!Auth.isLoggedIn()) {
    showToast('Спочатку увійдіть в акаунт', 'warning');
    openModal();
    return;
  }

  // Create inline modal
  const existing = document.getElementById('vacancy-create-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'vacancy-create-modal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-wrapper">
      <div class="modal" style="max-width:520px;">
        <button class="modal-close" onclick="document.getElementById('vacancy-create-modal').remove()">✕</button>
        <div class="modal-logo">💼</div>
        <div class="modal-title">Нова вакансія</div>
        <div class="modal-sub">Створіть позицію для AI-аналізу кандидатів</div>
        <form id="create-vacancy-form" onsubmit="submitCreateVacancy(event)" novalidate>
          <div class="modal-field">
            <label for="cv-title">Назва позиції</label>
            <input type="text" id="cv-title" placeholder="Senior React Developer" required>
          </div>
          <div class="modal-field">
            <label for="cv-desc">Опис вакансії</label>
            <textarea id="cv-desc" rows="6" placeholder="Вимоги, обов'язки, що пропонуємо…" style="width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:.88rem;font-family:Inter,sans-serif;resize:vertical;" required></textarea>
          </div>
          <button class="modal-submit" id="btn-cv-submit" type="submit">Створити вакансію →</button>
        </form>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function submitCreateVacancy(e) {
  e.preventDefault();
  const title = document.getElementById('cv-title').value.trim();
  const desc  = document.getElementById('cv-desc').value.trim();
  const btn   = document.getElementById('btn-cv-submit');

  if (!title || !desc) {
    showToast('Заповніть назву та опис вакансії', 'warning');
    return;
  }

  setButtonLoading(btn, true, 'Створюємо…');
  try {
    const res  = await apiFetch(API.vacancies, {
      method: 'POST',
      body: JSON.stringify({ title, description: desc }),
    });
    const data = await safeJson(res);

    if (!res.ok) throw new Error(data.detail || 'Failed to create vacancy');

    showToast(`Вакансію "${title}" створено!`, 'success');
    document.getElementById('vacancy-create-modal')?.remove();
    loadVacancies();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false, 'Створити вакансію →');
  }
}

// ═══════════════════════════════════════════════════════════════════
// CANDIDATES — Load from backend
// ═══════════════════════════════════════════════════════════════════

async function loadCandidates() {
  if (!Auth.isLoggedIn()) return;

  const loadingEl = document.getElementById('candidates-loading');
  const emptyEl   = document.getElementById('candidates-empty');
  const errorEl   = document.getElementById('candidates-error');
  const tableEl   = document.getElementById('candidates-table-wrap');
  const tbody     = document.getElementById('candidates-tbody');

  if (loadingEl) loadingEl.style.display = 'flex';
  if (emptyEl) emptyEl.style.display = 'none';
  if (errorEl) errorEl.style.display = 'none';
  if (tableEl) tableEl.style.display = 'none';

  try {
    const res  = await apiFetch(API.candidates, { method: 'GET' });
    const data = await safeJson(res);

    if (!res.ok) throw new Error(data.detail || 'Failed to load candidates');

    candidatesData = data.candidates || [];

    if (loadingEl) loadingEl.style.display = 'none';

    if (candidatesData.length === 0) {
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }

    // Render
    renderCandidatesTable(candidatesData);
    if (tableEl) tableEl.style.display = 'block';

  } catch (err) {
    console.error('Load candidates error:', err);
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) {
      errorEl.style.display = 'flex';
      document.getElementById('candidates-error-msg').textContent = err.message;
    }
  }
}

function renderCandidatesTable(candidates) {
  const tbody = document.getElementById('candidates-tbody');
  if (!tbody) return;

  tbody.innerHTML = candidates.map(c => {
    const scoreClass = c.match_score > 75 ? 'match-high' : c.match_score >= 40 ? 'match-mid' : 'match-low';
    const statusMap  = { 'New': 'status-new', 'На розгляді': 'status-review', 'Скринінг': 'status-screen' };
    const statusClass = statusMap[c.status] || 'status-new';
    const analysis = c.ai_analysis ? c.ai_analysis.substring(0, 100) + (c.ai_analysis.length > 100 ? '…' : '') : '—';

    return `
      <tr>
        <td>
          <div class="candidate-name">${escHtml(c.name)}</div>
          <div class="candidate-role">${escHtml(c.role)}</div>
        </td>
        <td>${escHtml(c.vacancy_title || '—')}</td>
        <td><span class="match-badge ${scoreClass}">${c.match_score}%</span></td>
        <td><span class="status-pill ${statusClass}">${escHtml(c.status)}</span></td>
        <td style="max-width:250px;font-size:.8rem;color:#4A4A42;">${escHtml(analysis)}</td>
      </tr>`;
  }).join('');
}

function filterCandidates(query) {
  if (!query) {
    renderCandidatesTable(candidatesData);
    return;
  }
  const q = query.toLowerCase();
  const filtered = candidatesData.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.role.toLowerCase().includes(q) ||
    (c.vacancy_title && c.vacancy_title.toLowerCase().includes(q))
  );
  renderCandidatesTable(filtered);
}

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW — Load stats from backend data
// ═══════════════════════════════════════════════════════════════════

async function loadOverviewStats() {
  if (!Auth.isLoggedIn()) return;

  try {
    // Load vacancies & candidates for stats
    const [vacRes, candRes] = await Promise.all([
      apiFetch(API.vacancies, { method: 'GET' }),
      apiFetch(API.candidates, { method: 'GET' }),
    ]);
    const vacData  = await safeJson(vacRes);
    const candData = await safeJson(candRes);

    const vacs = vacData.vacancies || [];
    const cands = candData.candidates || [];

    vacanciesData = vacs;
    candidatesData = cands;

    // Update stat cards
    const statVac = document.getElementById('stat-vacancies');
    const statCand = document.getElementById('stat-candidates');
    const statMatch = document.getElementById('stat-match');

    if (statVac) statVac.textContent = vacs.length;
    if (statCand) statCand.textContent = cands.length;

    if (statMatch && cands.length > 0) {
      const avg = cands.reduce((sum, c) => sum + c.match_score, 0) / cands.length;
      statMatch.textContent = avg.toFixed(1) + '%';
    } else if (statMatch) {
      statMatch.textContent = '—';
    }

    // Update sidebar badge
    const badge = document.querySelector('#nav-vacancies .link-badge');
    if (badge) badge.textContent = vacs.length;

    // Update recent candidates table in overview
    const recentTbody = document.getElementById('recent-candidates-tbody');
    if (recentTbody && cands.length > 0) {
      const top5 = cands.slice(0, 5);
      recentTbody.innerHTML = top5.map(c => {
        const scoreClass = c.match_score > 75 ? 'match-high' : c.match_score >= 40 ? 'match-mid' : 'match-low';
        const statusMap  = { 'New': 'status-new', 'На розгляді': 'status-review', 'Скринінг': 'status-screen' };
        const statusClass = statusMap[c.status] || 'status-new';
        return `
          <tr>
            <td><div class="candidate-name">${escHtml(c.name)}</div><div class="candidate-role">${escHtml(c.role)}</div></td>
            <td>${escHtml(c.vacancy_title || '—')}</td>
            <td><span class="match-badge ${scoreClass}">${c.match_score}%</span></td>
            <td><span class="status-pill ${statusClass}">${escHtml(c.status)}</span></td>
            <td>${c.created_at || '—'}</td>
          </tr>`;
      }).join('');
    } else if (recentTbody) {
      recentTbody.innerHTML = `
        <tr><td colspan="5" style="text-align:center;padding:24px;color:#8A8A80;">
          Кандидатів ще немає. Запустіть AI-аналіз, щоб побачити результати тут.
        </td></tr>`;
    }
  } catch (err) {
    console.error('Load overview stats error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS — Populate from user data
// ═══════════════════════════════════════════════════════════════════

function populateSettings() {
  const user = Auth.getUser();
  if (!user) return;
  const s = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  s('settings-name', user.full_name);
  s('settings-email', user.email);
  s('settings-company', user.company);
  s('settings-role', user.role);
}

function saveProfile()    { showToast('Профіль збережено ✓', 'success'); }
function saveApiKey()     { showToast('API ключ збережено ✓', 'success'); }
function changePassword() { showToast('Пароль змінено ✓', 'success'); }

// ═══════════════════════════════════════════════════════════════════
// FILE UPLOAD
// ═══════════════════════════════════════════════════════════════════

let uploadedFilesList = [];

function handleFiles(files) {
  const container = document.getElementById('uploaded-files');
  Array.from(files).forEach(file => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast(`"${file.name}" — не PDF. Бекенд приймає тільки PDF файли.`, 'error');
      return;
    }
    uploadedFilesList.push(file);
    const idx  = uploadedFilesList.length - 1;
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.dataset.fileIndex = idx;
    chip.innerHTML = `
      <span>📄</span>
      <span class="file-chip-name">${file.name}</span>
      <span class="file-chip-meta">${(file.size / 1024).toFixed(0)} KB · PDF</span>
      <button class="file-chip-remove" onclick="removeFile(this)" title="Видалити">✕</button>`;
    container.appendChild(chip);
  });
  updateUploadCount();
}

function removeFile(btn) {
  const chip = btn.parentElement;
  const idx  = parseInt(chip.dataset.fileIndex);
  if (!isNaN(idx)) uploadedFilesList[idx] = null;
  chip.remove();
  updateUploadCount();
}

function updateUploadCount() {
  const activeFiles = uploadedFilesList.filter(f => f !== null);
  const counter = document.getElementById('upload-count');
  if (counter) {
    counter.textContent   = activeFiles.length > 0 ? `${activeFiles.length} PDF файл(ів)` : '';
    counter.style.display = activeFiles.length > 0 ? 'block' : 'none';
  }
}

// Drag & drop
const uploadZone = document.getElementById('upload-zone');
if (uploadZone) {
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
}

// ═══════════════════════════════════════════════════════════════════
// AI ANALYSIS — SYNCED WITH /api/analyze
// ═══════════════════════════════════════════════════════════════════

function getScoreColor(score) {
  if (score > 75)  return { class: 'score-great', bg: 'var(--green-pale)', border: 'var(--green-light)', text: 'var(--green-primary)', label: 'Відмінний збіг' };
  if (score >= 40) return { class: 'score-ok',    bg: 'var(--gold-pale)',  border: 'var(--gold-light)',  text: 'var(--gold-primary)',  label: 'Помірний збіг' };
  return { class: 'score-low', bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', label: 'Низький збіг' };
}

function animateScoreCounter(element, targetScore, duration = 1400) {
  let start = null;
  const ease = t => 1 - Math.pow(1 - t, 3);
  function step(ts) {
    if (!start) start = ts;
    const p = Math.min((ts - start) / duration, 1);
    element.textContent = Math.round(ease(p) * targetScore) + '%';
    if (p < 1) requestAnimationFrame(step);
    else { element.classList.add('score-glow-anim'); setTimeout(() => element.classList.remove('score-glow-anim'), 900); }
  }
  element.textContent = '0%';
  requestAnimationFrame(step);
}

const SKELETON_MESSAGES = [
  'ШІ аналізує семантику резюме…',
  'Будую векторні ембеддінги…',
  'Розраховую Cosine Similarity…',
  'Генерую AI-аналіз через Qwen 2.5…',
  'Завершую аналіз…',
];
let skeletonMsgInterval = null;

function showSkeletonLoading() {
  const loading = document.getElementById('results-loading');
  const empty   = document.getElementById('results-empty');
  const content = document.getElementById('results-content');
  empty.style.display = 'none'; content.style.display = 'none'; loading.style.display = 'block';
  loading.innerHTML = `
    <div class="skeleton-result-card">
      <div class="skeleton-header-row"><div class="skeleton-avatar skeleton-pulse"></div><div class="skeleton-header-text"><div class="skeleton-line skeleton-pulse" style="width:55%;height:18px;"></div><div class="skeleton-line skeleton-pulse" style="width:80%;height:12px;margin-top:8px;"></div></div><div class="skeleton-score-circle skeleton-pulse"></div></div>
      <div class="skeleton-body"><div class="skeleton-line skeleton-pulse" style="width:100%;height:12px;"></div><div class="skeleton-line skeleton-pulse" style="width:90%;height:12px;"></div><div class="skeleton-line skeleton-pulse" style="width:70%;height:12px;"></div></div>
      <div class="skeleton-tags-row"><div class="skeleton-tag skeleton-pulse"></div><div class="skeleton-tag skeleton-pulse" style="width:72px;"></div><div class="skeleton-tag skeleton-pulse" style="width:56px;"></div><div class="skeleton-tag skeleton-pulse" style="width:84px;"></div></div>
    </div>
    <div class="skeleton-result-card" style="opacity:0.55;">
      <div class="skeleton-header-row"><div class="skeleton-avatar skeleton-pulse"></div><div class="skeleton-header-text"><div class="skeleton-line skeleton-pulse" style="width:45%;height:18px;"></div><div class="skeleton-line skeleton-pulse" style="width:70%;height:12px;margin-top:8px;"></div></div><div class="skeleton-score-circle skeleton-pulse"></div></div>
      <div class="skeleton-body"><div class="skeleton-line skeleton-pulse" style="width:95%;height:12px;"></div><div class="skeleton-line skeleton-pulse" style="width:80%;height:12px;"></div></div>
      <div class="skeleton-tags-row"><div class="skeleton-tag skeleton-pulse" style="width:64px;"></div><div class="skeleton-tag skeleton-pulse"></div><div class="skeleton-tag skeleton-pulse" style="width:52px;"></div></div>
    </div>
    <div class="skeleton-status-bar" id="skeleton-status-bar"><div class="skeleton-status-dot"></div><span id="skeleton-status-text">${SKELETON_MESSAGES[0]}</span></div>`;
  if (skeletonMsgInterval) clearInterval(skeletonMsgInterval);
  let idx = 0;
  skeletonMsgInterval = setInterval(() => {
    const el = document.getElementById('skeleton-status-text');
    if (!el) { clearInterval(skeletonMsgInterval); return; }
    idx = (idx + 1) % SKELETON_MESSAGES.length;
    el.style.opacity = '0';
    setTimeout(() => { if (el) { el.textContent = SKELETON_MESSAGES[idx]; el.style.opacity = '1'; } }, 300);
  }, 2500);
}

function buildResultCard(data, index) {
  const score   = data.match_score ?? data.score ?? 0;
  const sc      = getScoreColor(score);
  const name    = data.name || `Кандидат #${index + 1}`;
  const summary = data.ai_analysis || data.ai_summary || data.resume_preview || 'AI-аналіз не доступний.';
  const skills  = data.skills || [];
  const tagColors = ['tag-green', 'tag-gold', 'tag-brown'];
  const skillsHTML = skills.length > 0
    ? `<div class="result-tags result-tags-animated">${skills.map((tag, i) => `<span class="result-tag ${tagColors[i % tagColors.length]} tag-fly-in" style="animation-delay:${0.1*i}s">${tag}</span>`).join('')}</div>` : '';

  return `
    <div class="result-item result-item-animated" style="animation-delay:${0.15 * index}s">
      <div class="result-item-body">
        <div class="result-name">${escHtml(name)}</div>
        <div class="result-role" style="font-size:0.82rem;color:#8A8A80;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin:2px 0 8px 0;">${escHtml(data.role || 'Кандидат')}</div>
        <div class="result-summary" style="white-space: pre-line;">${escHtml(summary)}</div>
        ${skillsHTML}
      </div>
      <div class="result-score-block">
        <div class="result-score-ring" style="border-color:${sc.bg};background:${sc.bg};">
          <div class="result-score-val ${sc.class}" data-target-score="${score}">0%</div>
        </div>
        <div class="result-score-label-bar" style="background:${sc.bg};color:${sc.text};">${sc.label}</div>
        <div class="result-score-label">Match Score</div>
      </div>
    </div>`;
}

function showAnalysisError(message) {
  const loading = document.getElementById('results-loading');
  const empty   = document.getElementById('results-empty');
  const content = document.getElementById('results-content');
  loading.style.display = 'none'; content.style.display = 'none'; empty.style.display = 'block';
  empty.innerHTML = `
    <div class="results-error">
      <div class="results-error-icon">⚠️</div>
      <div class="results-error-title">Помилка аналізу</div>
      <div class="results-error-msg">${escHtml(message)}</div>
      <button class="results-error-retry" onclick="runAnalysis()">🔄 Спробувати ще раз</button>
    </div>`;
}

// ════════════════════════════════════════════════════════════════════
// MAIN ANALYSIS — matches backend POST /api/analyze exactly
// ════════════════════════════════════════════════════════════════════

async function runAnalysis() {
  const btn     = document.getElementById('btn-analyse');
  const loading = document.getElementById('results-loading');
  const content = document.getElementById('results-content');
  const list    = document.getElementById('results-list');

  const activeFiles = uploadedFilesList.filter(f => f !== null);
  const resumeText  = document.getElementById('resume-text').value.trim();
  const vacancyText = document.getElementById('vacancy-text').value.trim();
  const hasFile     = activeFiles.length > 0;
  const hasText     = resumeText.length > 0;

  if (!hasFile && !hasText) {
    showToast('Будь ласка, завантажте PDF або вставте текст резюме', 'warning');
    return;
  }

  if (!vacancyText) {
    showToast('Вкажіть опис вакансії — це обов\'язково для AI аналізу', 'warning');
    const el = document.getElementById('vacancy-text');
    if (el) { el.style.borderColor = '#EF4444'; el.focus(); setTimeout(() => el.style.borderColor = '', 3000); }
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> AI аналізує…';
  btn.classList.add('analysing');
  showSkeletonLoading();

  const bannerBadge = document.querySelector('#tab-analysis .ai-banner-badge');
  if (bannerBadge) { bannerBadge.textContent = 'Працює…'; bannerBadge.classList.add('ai-badge-active'); }

  try {
    let results = [];
    const engine = localStorage.getItem('vectyra_ai_engine') || 'cloud';

    if (engine === 'local') {
      // 💻 LOCAL BROWSER INFERENCE (Transformers.js + Llama-3)
      const localLoader = document.getElementById('local-ai-loader');
      if (localLoader) {
        localLoader.style.display = 'block';
        // Reset progress bar
        const progressBar = document.getElementById('local-ai-progress-bar');
        const percentText = document.getElementById('local-ai-percent');
        const fileStatus = document.getElementById('local-ai-file-status');
        if (progressBar) progressBar.style.width = '0%';
        if (percentText) percentText.textContent = '0%';
        if (fileStatus) fileStatus.textContent = 'Ініціалізація локальної нейромережі Llama-3...';
      }

      let loadedResumes = [];
      if (hasFile) {
        const fileStatus = document.getElementById('local-ai-file-status');
        if (fileStatus) fileStatus.textContent = "Видобування тексту з PDF резюме...";
        
        for (const file of activeFiles) {
          const formData = new FormData();
          formData.append('file', file);
          const res = await apiFetch(`${API_BASE}/api/extract-text`, { method: 'POST', body: formData });
          const data = await safeJson(res);
          if (!res.ok) throw new Error(data.detail || "Не вдалося отримати текст з PDF резюме.");
          loadedResumes.push({ name: file.name.replace(/\.[^.]+$/, ''), text: data.text });
        }
      } else {
        const resumes = resumeText.split('---').map(t => t.trim()).filter(t => t.length > 10);
        resumes.forEach((text, i) => {
          loadedResumes.push({ name: `Резюме #${i + 1}`, text: text });
        });
      }

      const generator = await getLocalAIGenerator(handleProgress);

      const fileStatus = document.getElementById('local-ai-file-status');
      if (fileStatus) fileStatus.textContent = "Обробка тексту та семантичний AI-аналіз...";

      for (let r of loadedResumes) {
        // Structured Llama 3 style prompt for TinyLlama
        const prompt = `<|system|>\nYou are an expert HR AI assistant. Analyze the candidate's resume against the job vacancy requirements.
You MUST return a JSON object with the exact fields below. Return ONLY raw JSON text. No comments or chat wrappers.

JSON SCHEMA:
{
  "name": "Candidate's real full name",
  "role": "Calculated specialty / job role",
  "match_score": 85,
  "status": "Shortlist",
  "strengths": "Сильні сторони: 3-4 переваги кандидата...",
  "weaknesses": "Чого не вистачає: 2-3 прогалини...",
  "skills": ["Skill1", "Skill2"]
}
<|user|>\nVACANCY:\n${vacancyText.substring(0, 500)}\n\nRESUME:\n${r.text.substring(0, 1000)}\n<|assistant|>\n`;

        const output = await generator(prompt, {
          max_new_tokens: 300,
          temperature: 0.2,
          return_full_text: false
        });

        const generatedText = output[0].generated_text.trim();
        const parsed = parseLocalJson(generatedText);

        let matchScore = 50;
        if (parsed && parsed.match_score) {
          matchScore = parseInt(parsed.match_score);
        } else {
          // simple jaccard fallback
          const vWords = new Set(vacancyText.toLowerCase().split(/\W+/).filter(w => w.length > 3));
          const rWords = new Set(r.text.toLowerCase().split(/\W+/).filter(w => w.length > 3));
          let intersect = 0;
          for (let w of vWords) { if (rWords.has(w)) intersect++; }
          const union = vWords.size + rWords.size - intersect;
          matchScore = union > 0 ? Math.round((intersect / union) * 100) : 40;
        }

        const candidateName = parsed?.name || r.name;
        const candidateRole = parsed?.role || "Кандидат";
        const candidateStatus = parsed?.status || (matchScore >= 75 ? "На розгляді" : matchScore >= 40 ? "Скринінг" : "New");
        const candidateSkills = parsed?.skills || extractSkillsFront(r.text);
        const strengths = parsed?.strengths || "Аналіз виконано локально.";
        const weaknesses = parsed?.weaknesses || "";
        const summary = strengths + (weaknesses ? "\n\n" + weaknesses : "");

        let savedCandidateId = null;
        if (Auth.isLoggedIn()) {
          try {
            const saveRes = await apiFetch(API.candidates, {
              method: 'POST',
              body: JSON.stringify({
                name: candidateName,
                role: candidateRole,
                match_score: matchScore,
                status: candidateStatus,
                ai_analysis: summary,
                skills: candidateSkills,
                vacancy_id: selectedVacancyId || null
              })
            });
            const saveData = await safeJson(saveRes);
            savedCandidateId = saveData?.candidate_id;
          } catch(e) {
            console.error("Local candidate save error:", e);
          }
        }

        results.push({
          name: candidateName,
          role: candidateRole,
          score: matchScore,
          ai_analysis: summary,
          resume_preview: r.text.substring(0, 150) + "…",
          skills: candidateSkills,
          candidate_id: savedCandidateId
        });
      }

      if (localLoader) localLoader.style.display = 'none';

    } else {
      // ☁️ CLOUD SERVER INFERENCE (Llama-3 Server API)
      if (hasFile) {
        for (const file of activeFiles) {
          const formData = new FormData();
          formData.append('vacancy_text', vacancyText);
          formData.append('file', file);
          if (selectedVacancyId) formData.append('vacancy_id', selectedVacancyId);

          const response = await apiFetch(API.analyze, { method: 'POST', body: formData });
          const data     = await safeJson(response);

          if (response.status === 503) {
            throw new Error('💤 ' + (data.detail || 'Нейромережа "прокидається". Зачекайте 15-30 секунд і натисніть ще раз.'));
          }
          if (response.status === 429) {
            throw new Error('⏳ ' + (data.detail || 'Занадто багато запитів. Спробуйте через хвилину.'));
          }
          if (!response.ok) {
            throw new Error(data.detail || `Сервер повернув ${response.status}`);
          }

          results.push({
            name:    data.name || file.name.replace(/\.[^.]+$/, ''),
            role:    data.role || 'Кандидат',
            score:   data.match_score ?? 0,
            ai_analysis:    data.ai_analysis || '',
            resume_preview: data.resume_preview || '',
            skills:         data.skills || [],
          });
        }
      } else {
        const resumes = resumeText.split('---').map(t => t.trim()).filter(t => t.length > 10);

        for (let i = 0; i < resumes.length; i++) {
          const formData = new FormData();
          formData.append('vacancy_text',      vacancyText);
          formData.append('resume_text_input', resumes[i]);
          if (selectedVacancyId) formData.append('vacancy_id', selectedVacancyId);

          const response = await apiFetch(API.analyze, { method: 'POST', body: formData });
          const data     = await safeJson(response);

          if (response.status === 503) {
            throw new Error('💤 ' + (data.detail || 'Нейромережа "прокидається". Зачекайте 15-30 секунд.'));
          }
          if (response.status === 429) {
            throw new Error('⏳ ' + (data.detail || 'Занадто багато запитів. Спробуйте через хвилину.'));
          }
          if (!response.ok) {
            throw new Error(data.detail || `Сервер повернув ${response.status}`);
          }

          results.push({
            name:    data.name || `Резюме #${i + 1}`,
            role:    data.role || 'Кандидат',
            score:   data.match_score ?? 0,
            ai_analysis:    data.ai_analysis || '',
            resume_preview: data.resume_preview || '',
            skills:         data.skills || [],
          });
        }
      }
    }

    if (results.length === 0) throw new Error('Не вдалося отримати результати від AI');

    results.sort((a, b) => b.score - a.score);

    // ── RENDER RESULTS ──
    loading.style.display = 'none';
    content.style.display = 'block';
    document.getElementById('results-title').textContent =
      `Знайдено ${results.length} результат${results.length === 1 ? '' : results.length < 5 ? 'и' : 'ів'} — відсортовано за Match Score`;
    list.innerHTML = results.map((r, i) => buildResultCard(r, i)).join('');

    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('.result-score-val[data-target-score]').forEach(el => {
          animateScoreCounter(el, parseInt(el.dataset.targetScore), 1400);
        });
      }, 300);
    });

    if (bannerBadge) {
      bannerBadge.textContent = 'Завершено ✓';
      bannerBadge.classList.remove('ai-badge-active');
      bannerBadge.classList.add('ai-badge-done');
      setTimeout(() => { bannerBadge.textContent = 'AI Ready'; bannerBadge.classList.remove('ai-badge-done'); }, 4000);
    }

    // Automatically reload stats to adapt all tabs and statistics to the new candidate immediately!
    if (Auth.isLoggedIn()) {
      loadOverviewStats();
    }

  } catch (error) {
    console.error('Analysis error:', error);
    showAnalysisError(error.message || "Помилка з'єднання з сервером ШІ.");
    if (bannerBadge) {
      bannerBadge.textContent = 'Помилка';
      bannerBadge.classList.remove('ai-badge-active');
      bannerBadge.classList.add('ai-badge-error');
      setTimeout(() => { bannerBadge.textContent = 'AI Ready'; bannerBadge.classList.remove('ai-badge-error'); }, 5000);
    }
  } finally {
    if (skeletonMsgInterval) { clearInterval(skeletonMsgInterval); skeletonMsgInterval = null; }
    btn.disabled = false;
    btn.innerHTML = '🤖 Запустити AI Аналіз';
    btn.classList.remove('analysing');
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT RESULTS TO CSV
// ═══════════════════════════════════════════════════════════════════

function exportResults() {
  const items = document.querySelectorAll('.result-item');
  if (!items.length) { showToast('Немає результатів для експорту', 'warning'); return; }
  const rows = [['Кандидат', 'Match Score', 'Статус', 'AI Аналіз']];
  items.forEach(item => {
    rows.push([
      item.querySelector('.result-name')?.textContent.trim() || '',
      item.querySelector('.result-score-val')?.textContent.trim() || '',
      item.querySelector('.result-score-label-bar')?.textContent.trim() || '',
      item.querySelector('.result-summary')?.textContent.trim() || '',
    ]);
  });
  const csv  = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `vectyra_results_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast('CSV експортовано ✓', 'success');
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setButtonLoading(btn, loading, text) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? `<span class="btn-spinner"></span> ${text}` : text;
}

function showValidationToast(msg) { showToast(msg, 'warning'); }

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW CHARTS
// ═══════════════════════════════════════════════════════════════════

new Chart(document.getElementById('activityChart'), {
  type: 'line',
  data: {
    labels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'],
    datasets: [{
      label: 'Нові кандидати',
      data: [12, 19, 8, 24, 31, 14, 7],
      borderColor: GREEN, backgroundColor: 'rgba(61,122,90,0.08)',
      borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: GREEN,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { color: '#8A8A80' }, grid: { color: '#F0EDE6' } },
      x: { ticks: { color: '#4A4A42' }, grid: { display: false } }
    }
  }
});

new Chart(document.getElementById('funnelChart'), {
  type: 'bar',
  data: {
    labels: ['Відгуки', 'Аналіз', 'Скринінг', 'Інтерв\'ю', 'Оффер'],
    datasets: [{
      data: [247, 89, 34, 12, 4],
      backgroundColor: ['rgba(61,122,90,0.8)', 'rgba(61,122,90,0.6)', 'rgba(201,150,60,0.7)', 'rgba(201,150,60,0.5)', 'rgba(125,90,60,0.7)'],
      borderRadius: 6, borderWidth: 0,
    }]
  },
  options: {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#8A8A80' }, grid: { color: '#F0EDE6' } },
      y: { ticks: { color: '#4A4A42', font: { weight: '600' } }, grid: { display: false } }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
// ANALYTICS CHARTS
// ═══════════════════════════════════════════════════════════════════

let analyticsChartsInit = false;
function initAnalyticsCharts() {
  if (analyticsChartsInit) return;
  analyticsChartsInit = true;

  new Chart(document.getElementById('analyticsLine'), {
    type: 'line',
    data: {
      labels: ['01','05','10','15','20','25','30'],
      datasets: [
        { label: 'Нові кандидати', data: [8,22,15,34,28,41,38], borderColor: GREEN, backgroundColor: 'rgba(61,122,90,0.08)', fill: true, tension: 0.4, borderWidth: 2.5 },
        { label: 'Офери', data: [1,2,1,3,2,4,3], borderColor: GOLD, backgroundColor: 'rgba(201,150,60,0.08)', fill: true, tension: 0.4, borderWidth: 2.5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { color: '#4A4A42', font: { size: 12 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#8A8A80' }, grid: { color: '#F0EDE6' } },
        x: { ticks: { color: '#4A4A42' }, grid: { display: false } }
      }
    }
  });

  new Chart(document.getElementById('scoreDistChart'), {
    type: 'bar',
    data: {
      labels: ['50-60%','60-70%','70-80%','80-90%','90-100%'],
      datasets: [{ label: 'Кандидатів', data: [12,28,47,89,34], backgroundColor: ['rgba(231,76,60,0.5)','rgba(231,76,60,0.3)','rgba(201,150,60,0.5)','rgba(61,122,90,0.5)','rgba(61,122,90,0.8)'], borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#8A8A80' }, grid: { color: '#F0EDE6' } },
        x: { ticks: { color: '#4A4A42' }, grid: { display: false } }
      }
    }
  });

  new Chart(document.getElementById('vacancyStatusChart'), {
    type: 'doughnut',
    data: {
      labels: ['Активна','Пауза','Закрита'],
      datasets: [{ data: [8,2,3], backgroundColor: ['rgba(61,122,90,0.7)','rgba(201,150,60,0.7)','rgba(125,90,60,0.6)'], borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: { legend: { position: 'bottom', labels: { color: '#4A4A42', padding: 14 } } }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// LOCAL AI ENGINE ASSISTANTS
// ═══════════════════════════════════════════════════════════════════

let localGenerator = null;

async function getLocalAIGenerator(onProgress) {
  if (localGenerator) return localGenerator;
  
  if (!window.transformers) {
    throw new Error("Не вдалося завантажити Transformers.js. Перевірте з'єднання з мережею.");
  }
  
  const { pipeline } = window.transformers;
  localGenerator = await pipeline('text-generation', 'Xenova/TinyLlama-1.1B-Chat-v1.0', {
    progress_callback: (data) => {
      if (data.status === 'progress') {
        onProgress(data.file, data.progress);
      }
    }
  });
  return localGenerator;
}

let loadedFiles = {};
function handleProgress(file, progress) {
  loadedFiles[file] = progress;
  let total = 0;
  let count = 0;
  for (let f in loadedFiles) {
    total += loadedFiles[f];
    count++;
  }
  let avg = count > 0 ? Math.round(total / count) : 0;
  if (avg > 100) avg = 100;
  
  const progressBar = document.getElementById('local-ai-progress-bar');
  const percentText = document.getElementById('local-ai-percent');
  const fileStatus = document.getElementById('local-ai-file-status');
  
  if (progressBar) progressBar.style.width = avg + '%';
  if (percentText) percentText.textContent = avg + '%';
  if (fileStatus) {
    const filename = file.split('/').pop();
    fileStatus.textContent = `Завантаження ${filename}...`;
  }
}

function parseLocalJson(str) {
  try {
    const braceIdx = str.indexOf('{');
    const lastBraceIdx = str.lastIndexOf('}');
    if (braceIdx !== -1 && lastBraceIdx !== -1) {
      const jsonSub = str.substring(braceIdx, lastBraceIdx + 1);
      return JSON.parse(jsonSub);
    }
  } catch (e) {
    console.error("JSON parse failed", e);
  }
  return null;
}

function extractSkillsFront(text) {
  const SKILLS = [
    "Python", "JavaScript", "TypeScript", "Java", "C++", "C#", "Go", "Rust",
    "PHP", "Ruby", "Swift", "Kotlin", "Scala", "R", "MATLAB",
    "React", "Vue", "Angular", "Next.js", "Node.js", "FastAPI", "Django",
    "Flask", "Express", "GraphQL", "REST", "HTML", "CSS", "Tailwind",
    "Machine Learning", "Deep Learning", "NLP", "TensorFlow", "PyTorch",
    "Scikit-learn", "Pandas", "NumPy", "SQL", "PostgreSQL", "MySQL",
    "MongoDB", "Redis", "Elasticsearch",
    "Docker", "Kubernetes", "AWS", "GCP", "Azure", "CI/CD", "GitHub Actions",
    "Terraform", "Linux", "Nginx",
    "Agile", "Scrum", "Figma", "Jira", "Git"
  ];
  const found = [];
  const textLower = text.toLowerCase();
  for (let skill of SKILLS) {
    if (textLower.includes(skill.toLowerCase()) && !found.includes(skill)) {
      found.push(skill);
    }
  }
  return found.slice(0, 8);
}

function changeAiEngine(val) {
  // Option change hook
}

function saveAiEngineSettings() {
  const select = document.getElementById('settings-ai-engine');
  if (select) {
    const engine = select.value;
    localStorage.setItem('vectyra_ai_engine', engine);
    updateAiEngineUI();
    showToast(`AI двигун змінено на: ${engine === 'local' ? 'Локальний' : 'Хмарний'}`, 'success');
  }
}

function updateAiEngineUI() {
  const engine = localStorage.getItem('vectyra_ai_engine') || 'cloud';
  const badge = document.getElementById('active-engine-badge');
  const tag = document.getElementById('ai-engine-tag');
  const select = document.getElementById('settings-ai-engine');
  
  if (select) select.value = engine;
  
  if (badge) {
    badge.textContent = engine === 'local' ? '💻 Локальний AI' : '☁️ Хмарний Llama-3';
    badge.style.background = engine === 'local' ? '#D8F3DC' : '#FDF3E3';
    badge.style.color = engine === 'local' ? '#2D6A4F' : '#C9963C';
    badge.style.borderColor = engine === 'local' ? '#52B788' : '#E9B96E';
  }
  if (tag) {
    tag.textContent = engine === 'local' ? 'Local Llama-3' : 'Cloud Llama-3';
  }
}

// ═══════════════════════════════════════════════════════════════════
// INIT — runs on page load
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize AI engine UI
  updateAiEngineUI();

  // Reset selected vacancy ID on manual vacancy text changes
  const vacancyTextarea = document.getElementById('vacancy-text');
  if (vacancyTextarea) {
    vacancyTextarea.addEventListener('input', () => {
      selectedVacancyId = null;
    });
  }

  // Check if user has a valid session
  if (Auth.isLoggedIn()) {
    try {
      // Verify token is still valid
      const res  = await apiFetch(API.authMe, { method: 'GET' });
      const data = await safeJson(res);

      if (res.ok && data.user) {
        Auth.setUser(data.user);
        updateUIForUser(data.user);
        closeModal(); // Hide auth modal
        // Load data
        loadOverviewStats();
      } else {
        // Token expired
        Auth.removeToken();
        openModal();
      }
    } catch {
      Auth.removeToken();
      openModal();
    }
  } else {
    // Not logged in — show auth modal
    openModal();
  }

  // Health check
  await runHealthCheck();
});
