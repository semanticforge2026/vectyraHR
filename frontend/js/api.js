// ═══════════════════════════════════════════════════════════════════
// VECTYRA — CENTRALIZED API CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

// ── BASE URL ──
const API_BASE = 'https://vectyrahr.onrender.com';

// ── ENDPOINTS ──
const API = {
  // AI
  analyze:       `${API_BASE}/api/analyze`,
  extractSkills: `${API_BASE}/api/extract-skills`,
  leads:         `${API_BASE}/api/leads`,

  // Auth
  authLogin:     `${API_BASE}/api/auth/login`,
  authRegister:  `${API_BASE}/api/auth/register`,
  authMe:        `${API_BASE}/api/auth/me`,

  // Resources
  health:        `${API_BASE}/api/health`,
  vacancies:     `${API_BASE}/api/vacancies`,
  candidates:    `${API_BASE}/api/candidates`,
};

// ═══════════════════════════════════════════════════════════════════
// TOKEN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

const Auth = {
  getToken() {
    return localStorage.getItem('vectyra_token');
  },
  setToken(token) {
    localStorage.setItem('vectyra_token', token);
  },
  removeToken() {
    localStorage.removeItem('vectyra_token');
    localStorage.removeItem('vectyra_user');
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem('vectyra_user') || 'null');
    } catch {
      return null;
    }
  },
  setUser(user) {
    localStorage.setItem('vectyra_user', JSON.stringify(user));
  },
  isLoggedIn() {
    return !!this.getToken();
  },
};

// ═══════════════════════════════════════════════════════════════════
// BASE FETCH WRAPPER — safe JSON parsing, token injection, 401 handler
// ═══════════════════════════════════════════════════════════════════

async function apiFetch(url, options = {}) {
  if (!url) {
    return new Response(JSON.stringify({ detail: 'Endpoint not implemented yet' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = Auth.getToken();
  const headers = { ...(options.headers || {}) };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof URLSearchParams)
  ) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    Auth.removeToken();
    if (window.location.pathname.includes('dashboard')) {
      // Show auth modal if token expired
      document.getElementById('auth-modal')?.classList.add('open');
      showToast('Сесія закінчилась. Увійдіть знову.', 'warning');
    }
  }

  return response;
}

// Safe JSON parse helper — never throws
async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN / REGISTER HELPERS
// ═══════════════════════════════════════════════════════════════════

async function apiLogin(email, password) {
  return apiFetch(API.authLogin, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

async function apiRegister(email, password, fullName, company) {
  return apiFetch(API.authRegister, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      full_name: fullName,
      company: company || null,
    }),
  });
}

// ═══════════════════════════════════════════════════════════════════
// BACKEND HEALTH CHECK — GET /api/health
// ═══════════════════════════════════════════════════════════════════

async function checkBackendHealth() {
  if (!API.health) return false;
  try {
    let signal;
    if (typeof AbortSignal.timeout === 'function') {
      signal = AbortSignal.timeout(8000);
    } else {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 8000);
      signal = controller.signal;
    }
    const res = await fetch(API.health, { method: 'GET', signal });
    return res.status < 500;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION HELPER — 4 types, works on all pages
// ═══════════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
  const existing = document.querySelector('.v-toast');
  if (existing) existing.remove();

  const typeStyles = {
    info:    { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE', icon: 'ℹ️' },
    success: { bg: '#ECFDF5', color: '#065F46', border: '#6EE7B7', icon: '✅' },
    warning: { bg: '#FFFBEB', color: '#92400E', border: '#FDE68A', icon: '⚠️' },
    error:   { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA', icon: '❌' },
  };
  const s = typeStyles[type] || typeStyles.info;

  const toast = document.createElement('div');
  toast.className = 'v-toast';
  toast.style.cssText = `background:${s.bg};color:${s.color};border-color:${s.border};`;
  toast.innerHTML = `<span class="v-toast-icon">${s.icon}</span><span>${message}</span>`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('v-toast-show'));

  setTimeout(() => {
    toast.classList.remove('v-toast-show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
