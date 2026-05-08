/* dashboard.js — KPIs + Chart.js charts */

const Dashboard = (function () {
  let charts = {};

  function init() {
    window.addEventListener('themechange', () => {
      Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) {} });
      charts = {};
      render();
    });
  }

  function getPalette() {
    return {
      text: Utils.readCSSVar('--text-primary'),
      textSecondary: Utils.readCSSVar('--text-secondary'),
      grid: Utils.readCSSVar('--chart-grid'),
      surface: Utils.readCSSVar('--bg-surface'),
      colors: [
        Utils.readCSSVar('--chart-1'),
        Utils.readCSSVar('--chart-2'),
        Utils.readCSSVar('--chart-3'),
        Utils.readCSSVar('--chart-4'),
        Utils.readCSSVar('--chart-5'),
        Utils.readCSSVar('--chart-6')
      ],
      success: Utils.readCSSVar('--success'),
      warning: Utils.readCSSVar('--warning'),
      danger: Utils.readCSSVar('--danger'),
      accent: Utils.readCSSVar('--accent')
    };
  }

  function applyChartDefaults(palette) {
    Chart.defaults.color = palette.textSecondary;
    Chart.defaults.borderColor = palette.grid;
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 11;
  }

  function aggregate(jobs) {
    const computed = jobs.map(Jobs.compute);
    let earned = 0, pendingFromClient = 0, owedToTeam = 0, onHand = 0;
    let active = 0, completed = 0;
    let businessReceived = 0, technicalReceived = 0;
    let unpaid = 0, partial = 0, paid = 0;
    const cashInByMonth = {};
    const cashOutByMonth = {};
    const earningsByClient = {};
    const incomingByMethod = {};
    const outgoingByMethod = {};

    for (const j of computed) {
      earned += j.faresReceived;
      pendingFromClient += Math.max(0, j.remainingFromClient);
      owedToTeam += j.owedToTeamNow;
      onHand += j.cashOnHand;

      if (j.paymentStatus === 'paid') { completed += 1; paid += 1; }
      else if (j.paymentStatus === 'partial') { active += 1; partial += 1; }
      else { active += 1; unpaid += 1; }

      // Split fares earned between business 40% and technical
      const totalPct = j.faresTotalPercent || 1;
      if (totalPct > 0) {
        businessReceived += j.faresReceived * (Jobs.BUSINESS_PERCENT / totalPct);
        technicalReceived += j.faresReceived * (j.faresTechnicalPercent / totalPct);
      }

      for (const p of (j.payments || [])) {
        const k = Utils.monthKey(p.date);
        if (!k) continue;
        const amt = Number(p.amount) || 0;
        if (p.direction === 'incoming') {
          cashInByMonth[k] = (cashInByMonth[k] || 0) + amt;
          incomingByMethod[p.method] = (incomingByMethod[p.method] || 0) + amt;
          // Fares' share of this payment is what counts as "earnings by client"
          const faresShareOfPayment = amt * j.faresTotalPercent / 100;
          const c = j.clientName || 'Unknown';
          earningsByClient[c] = (earningsByClient[c] || 0) + faresShareOfPayment;
        } else if (p.direction === 'outgoing') {
          cashOutByMonth[k] = (cashOutByMonth[k] || 0) + amt;
          outgoingByMethod[p.method] = (outgoingByMethod[p.method] || 0) + amt;
        }
      }
    }
    return {
      earned: Utils.round2(earned),
      pendingFromClient: Utils.round2(pendingFromClient),
      owedToTeam: Utils.round2(owedToTeam),
      onHand: Utils.round2(onHand),
      active, completed,
      businessReceived: Utils.round2(businessReceived),
      technicalReceived: Utils.round2(technicalReceived),
      unpaid, partial, paid,
      cashInByMonth, cashOutByMonth,
      earningsByClient,
      incomingByMethod, outgoingByMethod
    };
  }

  function renderKPIs(agg, currency) {
    document.getElementById('kpi-earned').textContent = Utils.formatCurrency(agg.earned, currency);
    document.getElementById('kpi-pending').textContent = Utils.formatCurrency(agg.pendingFromClient, currency);
    document.getElementById('kpi-owed-team').textContent = Utils.formatCurrency(agg.owedToTeam, currency);
    document.getElementById('kpi-onhand').textContent = Utils.formatCurrency(agg.onHand, currency);
    document.getElementById('kpi-active').textContent = String(agg.active);
    document.getElementById('kpi-completed').textContent = String(agg.completed);
  }

  function renderCashFlowChart(agg, palette, currency) {
    const ctx = document.getElementById('chart-income');
    if (!ctx) return;
    const months = Array.from(new Set([
      ...Object.keys(agg.cashInByMonth),
      ...Object.keys(agg.cashOutByMonth)
    ])).sort();
    const labels = months.map(Utils.monthLabel);
    const inData = months.map(k => agg.cashInByMonth[k] || 0);
    const outData = months.map(k => agg.cashOutByMonth[k] || 0);

    if (charts.income) charts.income.destroy();
    charts.income = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Money In',
            data: inData,
            backgroundColor: palette.colors[1] + 'cc',
            borderColor: palette.colors[1],
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Money Out',
            data: outData,
            backgroundColor: palette.colors[2] + 'cc',
            borderColor: palette.colors[2],
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 10, boxWidth: 10 } },
          tooltip: {
            callbacks: { label: ctx => `${ctx.dataset.label}: ${Utils.formatCurrency(ctx.raw, currency)}` }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: palette.grid },
            ticks: { callback: v => Utils.formatNumber(v) }
          }
        }
      }
    });
  }

  function renderClientsChart(agg, palette, currency) {
    const ctx = document.getElementById('chart-clients');
    if (!ctx) return;
    const entries = Object.entries(agg.earningsByClient).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const labels = entries.map(e => e[0]);
    const data = entries.map(e => Utils.round2(e[1]));

    if (charts.clients) charts.clients.destroy();
    charts.clients = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Earnings',
          data,
          backgroundColor: palette.colors,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => Utils.formatCurrency(ctx.raw, currency) } }
        },
        scales: {
          x: { grid: { color: palette.grid }, ticks: { callback: v => Utils.formatNumber(v) } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  function renderStatusChart(agg, palette) {
    const ctx = document.getElementById('chart-status');
    if (!ctx) return;
    const data = [agg.paid, agg.partial, agg.unpaid];
    if (charts.status) charts.status.destroy();
    charts.status = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Paid', 'Partial', 'Unpaid'],
        datasets: [{
          data,
          backgroundColor: [palette.success, palette.warning, palette.danger],
          borderColor: palette.surface,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { padding: 12, boxWidth: 10 } } }
      }
    });
  }

  function renderSplitChart(agg, palette, currency) {
    const ctx = document.getElementById('chart-split');
    if (!ctx) return;
    if (charts.split) charts.split.destroy();
    charts.split = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Business (40%)', 'Technical'],
        datasets: [{
          data: [agg.businessReceived, agg.technicalReceived],
          backgroundColor: [palette.colors[0], palette.colors[1]],
          borderColor: palette.surface,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 12, boxWidth: 10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${Utils.formatCurrency(ctx.raw, currency)}` } }
        }
      }
    });
  }

  function renderMethodChart(canvasId, byMethod, palette, currency, key) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const entries = Object.entries(byMethod);
    const labels = entries.map(e => e[0]);
    const data = entries.map(e => Utils.round2(e[1]));
    if (charts[key]) charts[key].destroy();
    if (data.length === 0) {
      charts[key] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['No data'], datasets: [{ data: [1], backgroundColor: [palette.grid], borderWidth: 0 }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '65%',
          plugins: { legend: { display: false }, tooltip: { enabled: false } }
        }
      });
      return;
    }
    charts[key] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: palette.colors,
          borderColor: palette.surface,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 12, boxWidth: 10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${Utils.formatCurrency(ctx.raw, currency)}` } }
        }
      }
    });
  }

  function render() {
    const settings = Storage.getSettings();
    const currency = settings.currency;
    const palette = getPalette();
    applyChartDefaults(palette);

    const jobs = Jobs.all();
    const agg = aggregate(jobs);

    renderKPIs(agg, currency);
    renderCashFlowChart(agg, palette, currency);
    renderClientsChart(agg, palette, currency);
    renderStatusChart(agg, palette);
    renderSplitChart(agg, palette, currency);
    renderMethodChart('chart-methods-in', agg.incomingByMethod, palette, currency, 'methodsIn');
    renderMethodChart('chart-methods-out', agg.outgoingByMethod, palette, currency, 'methodsOut');
  }

  return { init, render };
})();
