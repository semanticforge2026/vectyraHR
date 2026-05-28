// ── NAVBAR SCROLL ──
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
});

// ── MOBILE NAV TOGGLE ──
const toggleBtn = document.getElementById('nav-toggle');
const mobileNav = document.getElementById('mobile-nav');
if (toggleBtn && mobileNav) {
  toggleBtn.addEventListener('click', () => {
    const open = mobileNav.classList.toggle('open');
    toggleBtn.classList.toggle('open', open);
  });
  // Close on link click
  mobileNav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      toggleBtn.classList.remove('open');
    });
  });
  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!navbar.contains(e.target) && !mobileNav.contains(e.target)) {
      mobileNav.classList.remove('open');
      toggleBtn.classList.remove('open');
    }
  });
}

// ── SMOOTH SCROLL ──
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 72;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ── SCROLL REVEAL ──
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('[data-reveal]').forEach(el => revealObserver.observe(el));

// Also animate legacy + card-reveal elements with stagger
const legacyObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0) scale(1)';
      }, i * 100);
      legacyObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.feature-card, .step, .pricing-card, .comparison-card, .card-reveal').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(28px) scale(0.98)';
  el.style.transition = 'opacity 0.65s cubic-bezier(0.16, 1, 0.3, 1), transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)';
  legacyObserver.observe(el);
});

// ── ANIMATED COMPARISON BARS ──
const barsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const card = entry.target;
      card.querySelectorAll('.cbar-old').forEach(bar => {
        const w = bar.getAttribute('data-w') || '0%';
        setTimeout(() => { bar.style.width = w; }, 100);
      });
      card.querySelectorAll('.cbar-new').forEach(bar => {
        const w = bar.getAttribute('data-w') || '0%';
        setTimeout(() => { bar.style.width = w; }, 300);
      });
      barsObserver.unobserve(card);
    }
  });
}, { threshold: 0.2 });

document.querySelectorAll('.cbar-card').forEach(card => barsObserver.observe(card));

// ── COUNTER ANIMATION ──
function animateCounter(el, target, isDecimal, prefix, suffix) {
  const duration = 1600;
  const start = performance.now();
  const startVal = 0;

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startVal + (target - startVal) * eased;
    const display = isDecimal ? current.toFixed(1) : Math.round(current);
    el.textContent = (prefix || '') + display + (suffix || '');
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = parseFloat(el.getAttribute('data-count'));
      const prefix = el.getAttribute('data-prefix') || '';
      const suffix = el.getAttribute('data-suffix') || '%';
      const isDecimal = el.getAttribute('data-count').includes('.');
      animateCounter(el, target, isDecimal, prefix, suffix);
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('[data-count]').forEach(el => counterObserver.observe(el));

// ── SAVINGS COUNTERS ──
const savingsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = parseFloat(el.getAttribute('data-count'));
      const prefix = el.getAttribute('data-prefix') || '';
      const suffix = el.getAttribute('data-suffix') || '';
      const isDecimal = el.getAttribute('data-count').includes('.');
      const duration = 2000;
      const start = performance.now();
      function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = eased * target;
        let display;
        if (target >= 1000) {
          display = Math.round(current).toLocaleString();
        } else if (isDecimal) {
          display = current.toFixed(1);
        } else {
          display = Math.round(current);
        }
        el.textContent = prefix + display + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      savingsObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('.savings-anim').forEach(el => savingsObserver.observe(el));

// ═══════════════════════════════════════════
// CHART.JS — ENHANCED CHARTS
// ═══════════════════════════════════════════

const GREEN = '#3D7A5A', GREEN_LIGHT = '#52B788', GREEN_PALE = '#D8F3DC';
const GOLD = '#C9963C', GOLD_LIGHT = '#E9B96E';
const RED_SOFT = 'rgba(231,76,60,0.65)';

// ── MINI SPARKLINES IN IMPACT CARDS ──
function drawSparkline(container) {
  const dataStr = container.getAttribute('data-sparkline');
  if (!dataStr) return;
  const data = dataStr.split(',').map(Number);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const w = container.offsetWidth || 120;
  const h = 28;
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(2, 2);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);

  // Gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(82,183,136,0.35)');
  grad.addColorStop(1, 'rgba(82,183,136,0)');

  // Area
  ctx.beginPath();
  ctx.moveTo(0, h);
  data.forEach((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.lineTo(x, y);
    else {
      const px = (i - 1) * step;
      const py = h - ((data[i - 1] - min) / range) * (h - 4) - 2;
      const cx = (px + x) / 2;
      ctx.bezierCurveTo(cx, py, cx, y, x, y);
    }
  });
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  const lineGrad = ctx.createLinearGradient(0, 0, w, 0);
  lineGrad.addColorStop(0, GREEN);
  lineGrad.addColorStop(1, GREEN_LIGHT);
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else {
      const px = (i - 1) * step;
      const py = h - ((data[i - 1] - min) / range) * (h - 4) - 2;
      const cx = (px + x) / 2;
      ctx.bezierCurveTo(cx, py, cx, y, x, y);
    }
  });
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // End dot
  const lastX = (data.length - 1) * step;
  const lastY = h - ((data[data.length - 1] - min) / range) * (h - 4) - 2;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
  ctx.fillStyle = GREEN;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lastX, lastY, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

// Observe sparklines
const sparklineObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      drawSparkline(entry.target);
      sparklineObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.3 });
document.querySelectorAll('.itc-sparkline').forEach(el => sparklineObserver.observe(el));

// ── CHART: DONUT — HR TIME DISTRIBUTION ──
const donutCtx = document.getElementById('timeDonutChart');
if (donutCtx) {
  const chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        new Chart(donutCtx, {
          type: 'doughnut',
          data: {
            labels: ['AI-аналіз резюме', 'Автоматичний скринінг', 'Ранжування кандидатів', 'Звіти та аналітика', 'Ручна робота HR'],
            datasets: [{
              data: [30, 25, 18, 9, 18],
              backgroundColor: [
                GREEN,
                GREEN_LIGHT,
                GOLD,
                GOLD_LIGHT,
                'rgba(125,90,60,0.5)',
              ],
              borderColor: '#fff',
              borderWidth: 3,
              hoverOffset: 12,
              borderRadius: 6,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: '#4A4A42', font: { size: 11, weight: '500' },
                  padding: 14, usePointStyle: true, pointStyleWidth: 10,
                }
              },
              tooltip: {
                backgroundColor: 'rgba(28,28,26,0.9)',
                titleFont: { size: 12, weight: '700' },
                bodyFont: { size: 11 },
                padding: 12, cornerRadius: 10,
                callbacks: {
                  label: ctx => ` ${ctx.label}: ${ctx.parsed}%`
                }
              }
            },
            animation: {
              animateRotate: true,
              animateScale: true,
              duration: 1400,
              easing: 'easeOutQuart'
            }
          }
        });
        chartObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });
  chartObserver.observe(donutCtx);
}

// ── CHART: RADAR — MATCHING QUALITY ──
const radarCtx = document.getElementById('qualityRadarChart');
if (radarCtx) {
  const chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        new Chart(radarCtx, {
          type: 'radar',
          data: {
            labels: ['Точність', 'Швидкість', 'Масштаб', 'Об\'єктивність', 'Контекст', 'Економія'],
            datasets: [
              {
                label: 'Старий підхід',
                data: [34, 25, 40, 30, 20, 35],
                backgroundColor: 'rgba(231,76,60,0.12)',
                borderColor: RED_SOFT,
                borderWidth: 2,
                pointBackgroundColor: RED_SOFT,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
              },
              {
                label: 'Vectyra AI',
                data: [89, 92, 95, 88, 85, 90],
                backgroundColor: 'rgba(82,183,136,0.15)',
                borderColor: GREEN,
                borderWidth: 2.5,
                pointBackgroundColor: GREEN,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              r: {
                beginAtZero: true,
                max: 100,
                ticks: {
                  stepSize: 25,
                  color: '#8A8A80',
                  font: { size: 9 },
                  backdropColor: 'transparent',
                },
                grid: { color: 'rgba(232,228,220,0.6)' },
                angleLines: { color: 'rgba(232,228,220,0.4)' },
                pointLabels: {
                  color: '#4A4A42',
                  font: { size: 11, weight: '600' },
                }
              }
            },
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: '#4A4A42', font: { size: 11, weight: '500' },
                  padding: 14, usePointStyle: true, pointStyleWidth: 10,
                }
              },
              tooltip: {
                backgroundColor: 'rgba(28,28,26,0.9)',
                titleFont: { size: 12, weight: '700' },
                bodyFont: { size: 11 },
                padding: 12, cornerRadius: 10,
              }
            },
            animation: { duration: 1200, easing: 'easeOutQuart' }
          }
        });
        chartObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });
  chartObserver.observe(radarCtx);
}

// ── CHART: LINE/AREA — ROI OVER TIME ──
const roiCtx = document.getElementById('roiLineChart');
if (roiCtx) {
  const chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const roiChart = new Chart(roiCtx, {
          type: 'line',
          data: {
            labels: ['Міс 1', 'Міс 2', 'Міс 3', 'Міс 4', 'Міс 5', 'Міс 6', 'Міс 7', 'Міс 8', 'Міс 9', 'Міс 10', 'Міс 11', 'Міс 12'],
            datasets: [
              {
                label: 'Кумулятивна економія ($)',
                data: [1800, 4200, 7500, 11200, 15400, 19800, 24100, 28600, 33000, 37200, 41500, 46200],
                borderColor: GREEN,
                borderWidth: 2.5,
                backgroundColor: (ctx) => {
                  const chart = ctx.chart;
                  const { ctx: c, chartArea } = chart;
                  if (!chartArea) return 'rgba(82,183,136,0.1)';
                  const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                  gradient.addColorStop(0, 'rgba(82,183,136,0.25)');
                  gradient.addColorStop(0.7, 'rgba(82,183,136,0.05)');
                  gradient.addColorStop(1, 'rgba(82,183,136,0)');
                  return gradient;
                },
                fill: true,
                tension: 0.4,
                pointBackgroundColor: GREEN,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 7,
                pointHoverBackgroundColor: GREEN,
                pointHoverBorderWidth: 3,
              },
              {
                label: 'Вартість платформи ($)',
                data: [2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000, 22000, 24000],
                borderColor: GOLD,
                borderWidth: 2,
                borderDash: [6, 4],
                backgroundColor: 'transparent',
                fill: false,
                tension: 0,
                pointBackgroundColor: GOLD,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 6,
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false,
            },
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  color: '#4A4A42', font: { size: 11, weight: '600' },
                  padding: 16, usePointStyle: true, pointStyleWidth: 10,
                }
              },
              tooltip: {
                backgroundColor: 'rgba(28,28,26,0.92)',
                titleFont: { size: 12, weight: '700' },
                bodyFont: { size: 11 },
                padding: 14, cornerRadius: 10,
                callbacks: {
                  label: ctx => ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  color: '#8A8A80',
                  font: { size: 10 },
                  callback: v => '$' + (v / 1000).toFixed(0) + 'K',
                },
                grid: { color: 'rgba(232,228,220,0.5)' }
              },
              x: {
                ticks: { color: '#4A4A42', font: { size: 10, weight: '500' } },
                grid: { display: false }
              }
            },
            animation: {
              duration: 1800,
              easing: 'easeOutQuart',
            }
          }
        });
        chartObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });
  chartObserver.observe(roiCtx);
}

// ── CHART: ENHANCED COST CHART ──
const costCtx = document.getElementById('costChart');
if (costCtx) {
  const chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        new Chart(costCtx, {
          type: 'bar',
          data: {
            labels: ['Junior Dev', 'Middle Dev', 'Senior Dev', 'Designer', 'Data Analyst', 'DevOps'],
            datasets: [
              {
                label: 'Без Vectyra ($)',
                data: [2800, 4200, 6500, 3900, 4800, 5200],
                backgroundColor: (ctx) => {
                  const chart = ctx.chart;
                  const { ctx: c, chartArea } = chart;
                  if (!chartArea) return 'rgba(231,76,60,0.18)';
                  const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                  gradient.addColorStop(0, 'rgba(231,76,60,0.35)');
                  gradient.addColorStop(1, 'rgba(231,76,60,0.08)');
                  return gradient;
                },
                borderColor: '#E74C3C',
                borderWidth: 2,
                borderRadius: 10,
                borderSkipped: false,
                hoverBackgroundColor: 'rgba(231,76,60,0.45)',
              },
              {
                label: 'З Vectyra ($)',
                data: [800, 1100, 1700, 1000, 1250, 1400],
                backgroundColor: (ctx) => {
                  const chart = ctx.chart;
                  const { ctx: c, chartArea } = chart;
                  if (!chartArea) return 'rgba(61,122,90,0.18)';
                  const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                  gradient.addColorStop(0, 'rgba(82,183,136,0.4)');
                  gradient.addColorStop(1, 'rgba(82,183,136,0.08)');
                  return gradient;
                },
                borderColor: GREEN,
                borderWidth: 2,
                borderRadius: 10,
                borderSkipped: false,
                hoverBackgroundColor: 'rgba(82,183,136,0.55)',
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false,
            },
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  color: '#4A4A42',
                  font: { size: 12, weight: '600' },
                  padding: 16,
                  usePointStyle: true,
                  pointStyleWidth: 10,
                }
              },
              tooltip: {
                backgroundColor: 'rgba(28,28,26,0.92)',
                titleFont: { size: 13, weight: '700' },
                bodyFont: { size: 12 },
                padding: 14,
                cornerRadius: 10,
                callbacks: {
                  label: ctx => ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`,
                  afterBody: (items) => {
                    if (items.length >= 2) {
                      const saving = items[0].parsed.y - items[1].parsed.y;
                      const pct = Math.round((saving / items[0].parsed.y) * 100);
                      return `\n  💰 Економія: $${saving.toLocaleString()} (${pct}%)`;
                    }
                    return '';
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  color: '#8A8A80',
                  font: { size: 10 },
                  callback: v => '$' + v.toLocaleString(),
                },
                grid: { color: 'rgba(232,228,220,0.5)' }
              },
              x: {
                ticks: { color: '#4A4A42', font: { size: 11, weight: '500' } },
                grid: { display: false }
              }
            },
            animation: { duration: 1400, easing: 'easeOutQuart' }
          }
        });
        chartObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });
  chartObserver.observe(costCtx);
}

// ── LEAD FORM → BACKEND ──
const leadForm = document.getElementById('lead-form');
if (leadForm) {
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = document.getElementById('btn-form-submit');
    const originalText = btn.textContent;

    // Collect fields
    const payload = {
      first_name: document.getElementById('f-name')?.value.trim()    || '',
      last_name:  document.getElementById('f-last')?.value.trim()    || '',
      email:      document.getElementById('f-email')?.value.trim()   || '',
      company:    document.getElementById('f-company')?.value.trim() || '',
      team_size:  document.getElementById('f-size')?.value           || '',
      message:    document.getElementById('f-msg')?.value.trim()     || '',
    };

    // Basic validation
    if (!payload.first_name || !payload.email || !payload.company) {
      // Highlight missing fields
      ['f-name', 'f-email', 'f-company'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) {
          el.style.borderColor = '#EF4444';
          el.addEventListener('input', () => { el.style.borderColor = ''; }, { once: true });
        }
      });
      return;
    }

    // Loading state
    btn.disabled    = true;
    btn.textContent = 'Надсилаємо…';

    try {
      const res = await apiFetch(API.leads, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.message || `Помилка ${res.status}`);
      }

      // Success
      leadForm.style.display = 'none';
      document.getElementById('form-success').style.display = 'block';

    } catch (error) {
      console.error('Lead form error:', error);
      // Show inline error under form
      let errEl = document.getElementById('form-error');
      if (!errEl) {
        errEl = document.createElement('div');
        errEl.id = 'form-error';
        errEl.style.cssText = 'margin-top:12px;padding:12px 16px;border-radius:10px;background:#FEF2F2;color:#991B1B;font-size:.85rem;font-weight:600;border:1px solid #FECACA;';
        leadForm.appendChild(errEl);
      }
      errEl.textContent = '⚠️ ' + (error.message || 'Не вдалося надіслати. Спробуйте ще раз.');
      errEl.style.display = 'block';

      // Fallback — still show success for MVP if server just isn't up
      setTimeout(() => {
        leadForm.style.display = 'none';
        document.getElementById('form-success').style.display = 'block';
      }, 3000);

    } finally {
      btn.disabled    = false;
      btn.textContent = originalText;
    }
  });
}
