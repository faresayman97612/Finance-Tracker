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
      accent: Utils.readCSSVar('--accent'),
      info: Utils.readCSSVar('--chart-5')
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
    let totalPipeline = 0, totalCashIn = 0, totalTotalPay = 0;
    const freelancerAgg = {};
    const clientReceivables = {};
    const jobValues = [];
    let overdueCount = 0, dueSoonCount = 0, totalPaidOut = 0;
    const dlStatus = { overdue: 0, 'due-soon': 0, ok: 0, done: 0, none: 0 };
    const jobsPerMonth = {};
    const faresInByMonth = {};

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

      // Total Fares earns from this client (full contract value × Fares %)
      const c = j.clientName || 'Unknown';
      earningsByClient[c] = (earningsByClient[c] || 0) + j.faresShare;

      totalPipeline += j.faresShare;
      totalCashIn   += j.cashIn;
      totalTotalPay += j.totalPay;

      for (const f of (j.freelancerStats || [])) {
        if (!freelancerAgg[f.name]) freelancerAgg[f.name] = { paid: 0, owed: 0 };
        freelancerAgg[f.name].paid += f.paid;
        freelancerAgg[f.name].owed += f.owedNow;
      }

      const cl = j.clientName || 'Unknown';
      if (!clientReceivables[cl]) clientReceivables[cl] = { cashIn: 0, remaining: 0 };
      clientReceivables[cl].cashIn    += j.cashIn;
      clientReceivables[cl].remaining += Math.max(0, j.remainingFromClient);

      jobValues.push({ label: `${j.jobName} (${j.clientName || 'Unknown'})`, totalPay: j.totalPay });

      if (j.deadlineStatus === 'overdue') overdueCount++;
      else if (j.deadlineStatus === 'due-soon') dueSoonCount++;
      const ds = j.deadlineStatus || 'none';
      dlStatus[ds] = (dlStatus[ds] || 0) + 1;
      totalPaidOut += j.cashOut;
      const jobMonth = j.createdAt ? j.createdAt.slice(0, 7) : null;
      if (jobMonth) jobsPerMonth[jobMonth] = (jobsPerMonth[jobMonth] || 0) + 1;

      for (const p of (j.payments || [])) {
        const k = Utils.monthKey(p.date);
        if (!k) continue;
        const amt = Number(p.amount) || 0;
        if (p.direction === 'incoming') {
          cashInByMonth[k] = (cashInByMonth[k] || 0) + amt;
          incomingByMethod[p.method] = (incomingByMethod[p.method] || 0) + amt;
          const faresContrib = Utils.round2(amt * j.faresTotalPercent / 100);
          faresInByMonth[k] = Utils.round2((faresInByMonth[k] || 0) + faresContrib);
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
      incomingByMethod, outgoingByMethod,
      totalPipeline:  Utils.round2(totalPipeline),
      totalCashIn:    Utils.round2(totalCashIn),
      totalTotalPay:  Utils.round2(totalTotalPay),
      totalJobs:      computed.length,
      freelancerAgg,
      clientReceivables,
      jobValues,
      overdueCount,
      dueSoonCount,
      totalPaidOut: Utils.round2(totalPaidOut),
      dlStatus,
      jobsPerMonth,
      faresInByMonth
    };
  }

  function renderKPIs(agg, currency) {
    document.getElementById('kpi-earned').textContent = Utils.formatCurrency(agg.earned, currency);
    document.getElementById('kpi-pending').textContent = Utils.formatCurrency(agg.pendingFromClient, currency);
    document.getElementById('kpi-owed-team').textContent = Utils.formatCurrency(agg.owedToTeam, currency);
    document.getElementById('kpi-onhand').textContent = Utils.formatCurrency(agg.onHand, currency);
    document.getElementById('kpi-active').textContent = String(agg.active);
    document.getElementById('kpi-completed').textContent = String(agg.completed);
    document.getElementById('kpi-pipeline').textContent = Utils.formatCurrency(agg.totalPipeline, currency);
    const collectionRate = agg.totalTotalPay > 0
      ? Utils.round2(agg.totalCashIn / agg.totalTotalPay * 100) : 0;
    document.getElementById('kpi-collection-rate').textContent = collectionRate + '%';
    document.getElementById('kpi-total-jobs').textContent = String(agg.totalJobs);
    const avgJobValue = agg.totalJobs > 0
      ? Utils.round2(agg.totalTotalPay / agg.totalJobs) : 0;
    document.getElementById('kpi-avg-job').textContent = Utils.formatCurrency(avgJobValue, currency);
    document.getElementById('kpi-overdue').textContent     = String(agg.overdueCount);
    document.getElementById('kpi-due-soon').textContent    = String(agg.dueSoonCount);
    document.getElementById('kpi-team-payout').textContent = Utils.formatCurrency(agg.totalPaidOut, currency);
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

  function renderFreelancerChart(agg, palette, currency) {
    const ctx = document.getElementById('chart-freelancers');
    if (!ctx) return;
    const entries = Object.entries(agg.freelancerAgg)
      .sort((a, b) => (b[1].paid + b[1].owed) - (a[1].paid + a[1].owed));
    const labels = entries.map(([name]) => name);
    const paid   = entries.map(([, v]) => Utils.round2(v.paid));
    const owed   = entries.map(([, v]) => Utils.round2(v.owed));
    if (charts.freelancers) charts.freelancers.destroy();
    charts.freelancers = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Paid', data: paid, backgroundColor: palette.success + 'cc', borderColor: palette.success, borderWidth: 1, borderRadius: 4 },
          { label: 'Still Owed', data: owed, backgroundColor: palette.warning + 'cc', borderColor: palette.warning, borderWidth: 1, borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 10, boxWidth: 10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${Utils.formatCurrency(ctx.raw, currency)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: palette.grid }, ticks: { callback: v => Utils.formatNumber(v) } }
        }
      }
    });
  }

  function renderReceivablesChart(agg, palette, currency) {
    const ctx = document.getElementById('chart-receivables');
    if (!ctx) return;
    const entries = Object.entries(agg.clientReceivables)
      .sort((a, b) => (b[1].cashIn + b[1].remaining) - (a[1].cashIn + a[1].remaining))
      .slice(0, 8);
    const labels   = entries.map(([name]) => name);
    const received = entries.map(([, v]) => Utils.round2(v.cashIn));
    const pending  = entries.map(([, v]) => Utils.round2(v.remaining));
    if (charts.receivables) charts.receivables.destroy();
    charts.receivables = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Received', data: received, backgroundColor: palette.success + 'cc', borderColor: palette.success, borderWidth: 1, borderRadius: 0 },
          { label: 'Pending',  data: pending,  backgroundColor: palette.warning + 'cc', borderColor: palette.warning,  borderWidth: 1, borderRadius: 0 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 10, boxWidth: 10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${Utils.formatCurrency(ctx.raw, currency)}` } }
        },
        scales: {
          x: { stacked: true, grid: { color: palette.grid }, ticks: { callback: v => Utils.formatNumber(v) } },
          y: { stacked: true, grid: { display: false } }
        }
      }
    });
  }

  function renderTopJobsChart(agg, palette, currency) {
    const ctx = document.getElementById('chart-top-jobs');
    if (!ctx) return;
    const entries = agg.jobValues.slice().sort((a, b) => b.totalPay - a.totalPay).slice(0, 8);
    const labels = entries.map(e => e.label);
    const data   = entries.map(e => Utils.round2(e.totalPay));
    if (charts.topJobs) charts.topJobs.destroy();
    charts.topJobs = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Total Pay', data, backgroundColor: palette.colors, borderRadius: 6, borderSkipped: false }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
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

  function renderDeadlineChart(agg, palette) {
    const ctx = document.getElementById('chart-deadline');
    if (!ctx) return;
    const labels = ['Overdue', 'Due soon', 'On track', 'Done', 'No deadline'];
    const data = [
      agg.dlStatus.overdue || 0, agg.dlStatus['due-soon'] || 0,
      agg.dlStatus.ok || 0, agg.dlStatus.done || 0, agg.dlStatus.none || 0
    ];
    const colors = [palette.danger, palette.warning, palette.success, palette.accent, palette.grid];
    if (charts.deadline) charts.deadline.destroy();
    charts.deadline = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: palette.surface, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { padding: 12, boxWidth: 10 } } }
      }
    });
  }

  function renderJobsPerMonthChart(agg, palette) {
    const ctx = document.getElementById('chart-jobs-month');
    if (!ctx) return;
    const months = Object.keys(agg.jobsPerMonth).sort().slice(-12);
    const labels = months.map(Utils.monthLabel);
    const data = months.map(k => agg.jobsPerMonth[k] || 0);
    if (charts.jobsMonth) charts.jobsMonth.destroy();
    charts.jobsMonth = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Jobs created', data, backgroundColor: palette.info + 'cc', borderColor: palette.info, borderWidth: 1, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.raw} job${ctx.raw !== 1 ? 's' : ''}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: palette.grid }, ticks: { stepSize: 1, callback: v => Number.isInteger(v) ? v : '' } }
        }
      }
    });
  }

  function renderFaresMonthlyChart(agg, palette, currency) {
    const ctx = document.getElementById('chart-fares-monthly');
    if (!ctx) return;
    const months = Object.keys(agg.faresInByMonth).sort().slice(-12);
    const labels = months.map(Utils.monthLabel);
    const data = months.map(k => agg.faresInByMonth[k] || 0);
    if (charts.faresMonthly) charts.faresMonthly.destroy();
    charts.faresMonthly = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Fares earnings', data, backgroundColor: palette.success + 'cc', borderColor: palette.success, borderWidth: 1, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => Utils.formatCurrency(ctx.raw, currency) } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: palette.grid }, ticks: { callback: v => Utils.formatNumber(v) } }
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
    renderFreelancerChart(agg, palette, currency);
    renderReceivablesChart(agg, palette, currency);
    renderTopJobsChart(agg, palette, currency);
    renderDeadlineChart(agg, palette);
    renderJobsPerMonthChart(agg, palette);
    renderFaresMonthlyChart(agg, palette, currency);
  }

  return { init, render };
})();
