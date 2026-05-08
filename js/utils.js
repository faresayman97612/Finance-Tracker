/* utils.js — formatting helpers, ids, math */

const Utils = (function () {
  const CURRENCY_SYMBOLS = {
    EGP: 'E£',
    USD: '$',
    EUR: '€',
    SAR: '﷼',
    AED: 'د.إ'
  };

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (Number.isNaN(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function round2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function formatCurrency(n, currency = 'EGP') {
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    const value = Number(n) || 0;
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value);
    return `${symbol} ${formatted}`;
  }

  function formatNumber(n) {
    const value = Number(n) || 0;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function monthKey(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 7); // YYYY-MM
  }

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }

  function toast(message, type = 'info', duration = 2400) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 200ms';
      setTimeout(() => el.remove(), 220);
    }, duration);
  }

  function readCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function debounce(fn, wait = 200) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function escapeHTML(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  return {
    CURRENCY_SYMBOLS,
    uuid, clamp, round2,
    formatCurrency, formatNumber, formatDate, todayISO, nowISO,
    monthKey, monthLabel,
    toast, readCSSVar, debounce, escapeHTML
  };
})();
