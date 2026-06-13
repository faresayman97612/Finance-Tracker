/* insights.js — Insights tab: P&L, forecast, client profitability, period compare, print */

const Insights = (function () {
  // Stage probabilities for revenue forecast (tweakable)
  const STAGE_PROBABILITY = {
    'proposal':    0.25,
    'in-progress': 0.75,
    'delivered':   0.95,
    'closed':      0.00
  };

  const PRESETS = ['this-month', 'last-month', 'last-3', 'ytd', 'last-12', 'all', 'custom'];
  const PRESET_LABELS = {
    'this-month': 'This month',
    'last-month': 'Last month',
    'last-3':     'Last 3 months',
    'ytd':        'YTD',
    'last-12':    'Last 12 months',
    'all':        'All time',
    'custom':     'Custom'
  };

  const els = {};
  const charts = {};
  const computeCache = new Map();

  let state = {
    presetKey: 'this-month',
    from: '',
    to: '',
    customFrom: '',
    customTo: '',
    clientFilter: null,         // normalized client key when filtering
    clientFilterDisplay: null,  // original-case display name
    sort: { col: 'revenue', dir: 'desc' }
  };

  // ─── Date helpers ───────────────────────────────────────────────────

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function todayDate() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  function presetToRange(key) {
    const today = todayDate();
    const y = today.getFullYear();
    const m = today.getMonth();
    if (key === 'this-month') {
      return { from: ymd(new Date(y, m, 1)), to: ymd(today) };
    }
    if (key === 'last-month') {
      const lastFrom = new Date(y, m - 1, 1);
      const lastTo = new Date(y, m, 0); // day 0 of this month = last day of previous month
      return { from: ymd(lastFrom), to: ymd(lastTo) };
    }
    if (key === 'last-3') {
      const from = new Date(y, m - 2, 1);
      return { from: ymd(from), to: ymd(today) };
    }
    if (key === 'ytd') {
      return { from: ymd(new Date(y, 0, 1)), to: ymd(today) };
    }
    if (key === 'last-12') {
      const from = new Date(y - 1, m + 1, 1);
      return { from: ymd(from), to: ymd(today) };
    }
    if (key === 'all') {
      return { from: '1970-01-01', to: '2099-12-31' };
    }
    if (key === 'custom') {
      return { from: state.customFrom || ymd(today), to: state.customTo || ymd(today) };
    }
    return { from: ymd(today), to: ymd(today) };
  }

  function previousRange({ from, to }) {
    // previous range = equal length immediately before current range
    if (from === '1970-01-01' && to === '2099-12-31') return null; // all-time has no "previous"
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const fromDate = new Date(fy, fm - 1, fd);
    const toDate = new Date(ty, tm - 1, td);
    const lengthMs = toDate - fromDate;
    const prevTo = new Date(fromDate.getTime() - 86400000);   // one day before current start
    const prevFrom = new Date(prevTo.getTime() - lengthMs);
    return { from: ymd(prevFrom), to: ymd(prevTo) };
  }

  function dateInRange(iso, from, to) {
    if (!iso) return false;
    const d = String(iso).slice(0, 10);
    return d >= from && d <= to;
  }

  // ─── Compute cache ──────────────────────────────────────────────────

  function computeCached(job) {
    const entry = computeCache.get(job.id);
    if (entry && entry.updatedAt === job.updatedAt) return entry.result;
    const result = Jobs.compute(job);
    computeCache.set(job.id, { updatedAt: job.updatedAt, result });
    return result;
  }

  // ─── Expense recurring expansion ────────────────────────────────────

  function recurringExpenseInstancesInRange(exp, { from, to }) {
    const out = [];
    if (!exp || !exp.date) return out;
    const [y, m, d] = exp.date.split('-').map(Number);
    const startDate = new Date(y, m - 1, d);
    const [ty, tm, td] = to.split('-').map(Number);
    const toDate = new Date(ty, tm - 1, td);
    if (exp.recurring === 'none' || !exp.recurring) {
      out.push({ ...exp, date: exp.date });
      return out;
    }
    let cur = new Date(startDate);
    let safety = 0;
    while (cur <= toDate && safety < 120) {
      const iso = ymd(cur);
      if (iso >= from && iso <= to) {
        out.push({ ...exp, date: iso });
      }
      if (exp.recurring === 'monthly') {
        const targetMonth = cur.getMonth() + 1;
        cur = new Date(cur.getFullYear(), targetMonth, Math.min(d, daysInMonth(cur.getFullYear(), targetMonth)));
      } else if (exp.recurring === 'yearly') {
        cur = new Date(cur.getFullYear() + 1, m - 1, Math.min(d, daysInMonth(cur.getFullYear() + 1, m - 1)));
      } else {
        break;
      }
      safety++;
    }
    return out;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  // ─── Aggregation ────────────────────────────────────────────────────

  function clientKey(name) { return String(name || '').trim().toLowerCase(); }

  function aggregateRange(jobs, expenses, { from, to }, clientFilter) {
    const result = {
      revenue: 0, teamPayout: 0, expenses: 0,
      grossProfit: 0, netProfit: 0,
      cashIn: 0, jobsCompleted: 0,
      avgJobValue: 0, collectionRate: 0,
      expenseByCategory: {},
      incomingByMonth: {}, netByMonth: {},
      clientStats: new Map(),
      freelancerOutput: {}
    };

    const completedTotalPays = [];
    let totalPayInRange = 0;

    for (const job of jobs) {
      const c = computeCached(job);
      const cKey = clientKey(job.clientName);
      if (clientFilter && cKey !== clientFilter) continue;

      let jobRevenueInRange = 0;
      let jobPayoutInRange = 0;
      let jobCashInRange = 0;
      let lastPaymentDateInRange = null;

      for (const p of (job.payments || [])) {
        if (!dateInRange(p.date, from, to)) continue;
        const month = String(p.date).slice(0, 7);
        if (p.direction === 'incoming') {
          const faresContrib = p.amount * (c.faresTotalPercent / 100);
          result.revenue += faresContrib;
          result.cashIn += p.amount;
          jobRevenueInRange += faresContrib;
          jobCashInRange += p.amount;
          result.incomingByMonth[month] = (result.incomingByMonth[month] || 0) + p.amount;
          if (!lastPaymentDateInRange || p.date > lastPaymentDateInRange) lastPaymentDateInRange = p.date;
        } else if (p.direction === 'outgoing') {
          result.teamPayout += p.amount;
          jobPayoutInRange += p.amount;
        }
      }

      // Jobs completed in range: cashIn (all-time) covers totalPay AND last incoming payment date is in range
      if (c.cashIn >= c.totalPay && c.totalPay > 0 && lastPaymentDateInRange) {
        result.jobsCompleted++;
        completedTotalPays.push(c.totalPay);
      }

      // Client stats
      if (job.clientName) {
        const stat = result.clientStats.get(cKey) || {
          name: job.clientName, jobs: 0, revenue: 0, teamPaid: 0,
          marginPct: 0, daysToPaySum: 0, paidJobsForAvg: 0
        };
        stat.jobs++;
        stat.revenue += jobRevenueInRange;
        stat.teamPaid += jobPayoutInRange;
        if (c.cashIn >= c.totalPay && c.totalPay > 0 && lastPaymentDateInRange && job.createdAt) {
          const created = new Date(String(job.createdAt).slice(0, 10));
          const paid = new Date(lastPaymentDateInRange);
          const days = Math.max(0, Math.round((paid - created) / 86400000));
          stat.daysToPaySum += days;
          stat.paidJobsForAvg++;
        }
        result.clientStats.set(cKey, stat);
      }

      // Total totalPay attributed to range for collectionRate (jobs with any activity in range)
      if (jobCashInRange > 0) totalPayInRange += c.totalPay;

      // Freelancer output: open tasks now + tasks marked done in range
      for (const t of (job.tasks || [])) {
        if (!t.assignee || t.assignee === 'fares') continue;
        const key = t.assignee;
        if (!result.freelancerOutput[key]) {
          result.freelancerOutput[key] = { name: Storage.getFreelancerName(key, key), value: 0 };
        }
        if (t.status === 'done' && dateInRange(t.completedAt, from, to)) {
          result.freelancerOutput[key].value++;
        } else if (t.status !== 'done') {
          result.freelancerOutput[key].value++;
        }
      }
    }

    // Expenses
    for (const exp of expenses) {
      const instances = recurringExpenseInstancesInRange(exp, { from, to });
      for (const inst of instances) {
        const amt = Number(inst.amount) || 0;
        result.expenses += amt;
        const cat = inst.category || 'other';
        result.expenseByCategory[cat] = (result.expenseByCategory[cat] || 0) + amt;
      }
    }

    // Net by month (from current rolling figures)
    for (const month of Object.keys(result.incomingByMonth)) {
      result.netByMonth[month] = result.incomingByMonth[month];
    }

    // Finalize derived fields
    result.revenue = Utils.round2(result.revenue);
    result.teamPayout = Utils.round2(result.teamPayout);
    result.expenses = Utils.round2(result.expenses);
    result.grossProfit = Utils.round2(result.revenue - result.teamPayout);
    result.netProfit = Utils.round2(result.grossProfit - result.expenses);
    result.cashIn = Utils.round2(result.cashIn);
    result.avgJobValue = completedTotalPays.length > 0
      ? Utils.round2(completedTotalPays.reduce((s, n) => s + n, 0) / completedTotalPays.length) : 0;
    result.collectionRate = totalPayInRange > 0
      ? Utils.round2((result.cashIn / totalPayInRange) * 100) : 0;

    // Client margin finalization
    for (const stat of result.clientStats.values()) {
      stat.revenue = Utils.round2(stat.revenue);
      stat.teamPaid = Utils.round2(stat.teamPaid);
      stat.marginPct = stat.revenue > 0
        ? Utils.round2(((stat.revenue - stat.teamPaid) / stat.revenue) * 100) : 0;
      stat.avgDaysToPay = stat.paidJobsForAvg > 0
        ? Math.round(stat.daysToPaySum / stat.paidJobsForAvg) : null;
    }

    return result;
  }

  // ─── Forecast ───────────────────────────────────────────────────────

  function forecastPipeline(jobs, clientFilter) {
    let expected = 0, bestCase = 0, worstCase = 0;
    for (const job of jobs) {
      if (clientFilter && clientKey(job.clientName) !== clientFilter) continue;
      const c = computeCached(job);
      if (c.stage === 'closed') continue;
      const remaining = Math.max(0, c.remainingFromClient);
      const faresShare = remaining * (c.faresTotalPercent / 100);
      const prob = STAGE_PROBABILITY[c.stage] != null ? STAGE_PROBABILITY[c.stage] : 0;
      expected += faresShare * prob;
      bestCase += faresShare;
      if (c.stage === 'delivered') worstCase += faresShare;
    }
    return {
      expected: Utils.round2(expected),
      bestCase: Utils.round2(bestCase),
      worstCase: Utils.round2(worstCase)
    };
  }

  // ─── Period over period ─────────────────────────────────────────────

  function periodOverPeriod(jobs, expenses, currentRange, clientFilter) {
    const current = aggregateRange(jobs, expenses, currentRange, clientFilter);
    const prevRange = previousRange(currentRange);
    if (!prevRange) return { current, previous: null, deltas: null };
    const previous = aggregateRange(jobs, expenses, prevRange, clientFilter);
    const metrics = ['revenue', 'netProfit', 'jobsCompleted', 'avgJobValue', 'collectionRate'];
    const deltas = {};
    for (const k of metrics) {
      const cur = current[k] || 0;
      const prev = previous[k] || 0;
      const abs = Utils.round2(cur - prev);
      const pct = prev !== 0 ? Utils.round2(((cur - prev) / Math.abs(prev)) * 100) : (cur > 0 ? 100 : 0);
      deltas[k] = { current: cur, previous: prev, abs, pct };
    }
    return { current, previous, deltas, prevRange };
  }

  // ─── DOM helpers ────────────────────────────────────────────────────

  function cacheEls() {
    els.view = document.getElementById('view-insights');
    els.rangePresets = document.getElementById('range-presets');
    els.rangeCustom = document.getElementById('range-custom');
    els.rangeCustomFrom = document.getElementById('range-custom-from');
    els.rangeCustomTo = document.getElementById('range-custom-to');
    els.clientChip = document.getElementById('client-filter-chip');
    els.expensesBtn = document.getElementById('expenses-btn');
    els.printBtn = document.getElementById('print-report-btn');
    els.pnlGrid = document.getElementById('insights-pnl-grid');
    els.periodCompare = document.getElementById('insights-period-compare');
    els.forecast = document.getElementById('insights-forecast');
    els.clientTable = document.getElementById('insights-client-table');
    els.chartClients = document.getElementById('chart-insights-clients');
    els.chartFreelancers = document.getElementById('chart-insights-freelancers');
    els.chartExpenses = document.getElementById('chart-insights-expenses');
    els.printHeader = document.getElementById('insights-print-header');
    els.expensesModal = document.getElementById('expenses-modal');
    els.expensesAddDate = document.getElementById('exp-add-date');
    els.expensesAddCategory = document.getElementById('exp-add-category');
    els.expensesAddAmount = document.getElementById('exp-add-amount');
    els.expensesAddDescription = document.getElementById('exp-add-description');
    els.expensesAddRecurring = document.getElementById('exp-add-recurring');
    els.expensesAddBtn = document.getElementById('exp-add-btn');
    els.expensesList = document.getElementById('expenses-list');
  }

  function init() {
    cacheEls();
    if (!els.view) return; // markup missing — bail safely

    // Wire presets
    els.rangePresets.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => setRange(btn.dataset.preset));
    });
    els.rangeCustomFrom.addEventListener('change', () => {
      state.customFrom = els.rangeCustomFrom.value;
      if (state.presetKey === 'custom') { Object.assign(state, presetToRange('custom')); render(); }
    });
    els.rangeCustomTo.addEventListener('change', () => {
      state.customTo = els.rangeCustomTo.value;
      if (state.presetKey === 'custom') { Object.assign(state, presetToRange('custom')); render(); }
    });

    // Buttons
    els.expensesBtn.addEventListener('click', openExpenses);
    els.printBtn.addEventListener('click', printReport);

    // Expenses modal wiring
    els.expensesAddDate.value = Utils.todayISO();
    els.expensesAddBtn.addEventListener('click', addExpense);

    // Default range
    const initial = presetToRange(state.presetKey);
    state.from = initial.from; state.to = initial.to;
    if (!state.customFrom) state.customFrom = state.from;
    if (!state.customTo) state.customTo = state.to;

    // Theme change → invalidate charts (palette)
    window.addEventListener('themechange', () => {
      Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) {} });
      for (const k of Object.keys(charts)) delete charts[k];
      if (els.view && !els.view.classList.contains('active')) return;
      render();
    });
  }

  function setRange(presetKey) {
    if (!PRESETS.includes(presetKey)) return;
    state.presetKey = presetKey;
    const r = presetToRange(presetKey);
    state.from = r.from; state.to = r.to;
    if (presetKey === 'custom') {
      els.rangeCustom.hidden = false;
      els.rangeCustomFrom.value = state.customFrom || state.from;
      els.rangeCustomTo.value = state.customTo || state.to;
    } else {
      els.rangeCustom.hidden = true;
    }
    render();
  }

  function openClientFilter(displayName) {
    if (!displayName) {
      state.clientFilter = null;
      state.clientFilterDisplay = null;
    } else {
      state.clientFilter = clientKey(displayName);
      state.clientFilterDisplay = displayName;
    }
    render();
  }

  function printReport() {
    // Make sure charts are fresh at print resolution
    window.dispatchEvent(new Event('resize'));
    setTimeout(() => window.print(), 100);
  }

  // ─── Expenses CRUD ──────────────────────────────────────────────────

  function openExpenses() {
    renderExpenses();
    els.expensesModal.hidden = false;
  }

  function renderExpenses() {
    const list = Storage.getExpenses();
    if (!list || list.length === 0) {
      els.expensesList.innerHTML = '<p class="dim" style="font-size:12px;padding:10px 4px">No expenses yet. Add one above.</p>';
      return;
    }
    const cur = Storage.getSettings().currency;
    const sorted = list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    els.expensesList.innerHTML = `
      <table class="expenses-table">
        <thead>
          <tr><th>Date</th><th>Category</th><th>Description</th><th class="num">Amount</th><th>Recurring</th><th></th></tr>
        </thead>
        <tbody>
          ${sorted.map(e => `
            <tr data-id="${Utils.escapeHTML(e.id)}">
              <td><input class="input exp-date" type="date" value="${Utils.escapeHTML(e.date || '')}"></td>
              <td>
                <select class="input exp-cat">
                  ${Storage.EXPENSE_CATEGORIES.map(c => `<option value="${c}" ${c === e.category ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </td>
              <td><input class="input exp-desc" type="text" value="${Utils.escapeHTML(e.description || '')}" placeholder="Description"></td>
              <td class="num"><input class="input exp-amt" type="number" min="0" step="0.01" value="${e.amount || 0}"></td>
              <td>
                <select class="input exp-rec">
                  ${['none','monthly','yearly'].map(r => `<option value="${r}" ${r === (e.recurring || 'none') ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </td>
              <td>
                <button class="row-action danger exp-del" aria-label="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    els.expensesList.querySelectorAll('tbody tr').forEach(tr => {
      const id = tr.dataset.id;
      const onChange = () => updateExpense(id, tr);
      tr.querySelectorAll('.exp-date, .exp-cat, .exp-desc, .exp-amt, .exp-rec').forEach(el =>
        el.addEventListener('change', onChange));
      tr.querySelector('.exp-del').addEventListener('click', () => deleteExpense(id));
    });
  }

  function addExpense() {
    const amount = Number(els.expensesAddAmount.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      Utils.toast('Enter a valid amount', 'error'); return;
    }
    const exp = {
      id: Utils.uuid(),
      date: els.expensesAddDate.value || Utils.todayISO(),
      category: els.expensesAddCategory.value || 'other',
      amount: Utils.round2(amount),
      description: els.expensesAddDescription.value.trim(),
      recurring: els.expensesAddRecurring.value || 'none',
      notes: '',
      createdAt: Utils.nowISO(),
      updatedAt: Utils.nowISO()
    };
    const list = Storage.getExpenses().slice();
    list.push(exp);
    Storage.saveExpenses(list);
    els.expensesAddAmount.value = '';
    els.expensesAddDescription.value = '';
    renderExpenses();
    render();
    Utils.toast('Expense added', 'success', 1200);
  }

  function updateExpense(id, tr) {
    const list = Storage.getExpenses().slice();
    const i = list.findIndex(e => e.id === id);
    if (i === -1) return;
    list[i] = {
      ...list[i],
      date: tr.querySelector('.exp-date').value,
      category: tr.querySelector('.exp-cat').value,
      description: tr.querySelector('.exp-desc').value.trim(),
      amount: Utils.round2(Number(tr.querySelector('.exp-amt').value) || 0),
      recurring: tr.querySelector('.exp-rec').value,
      updatedAt: Utils.nowISO()
    };
    Storage.saveExpenses(list);
    render();
  }

  function deleteExpense(id) {
    App.confirm('Delete this expense?', 'It will be removed from your records.', () => {
      const list = Storage.getExpenses().filter(e => e.id !== id);
      Storage.saveExpenses(list);
      renderExpenses();
      render();
      Utils.toast('Expense deleted', 'success', 1200);
    });
  }

  // ─── Rendering ──────────────────────────────────────────────────────

  function render() {
    if (!els.view) cacheEls();
    if (!els.view) return;

    // Invalidate stale compute-cache entries (keep only jobs that still exist)
    const jobIds = new Set(Jobs.all().map(j => j.id));
    for (const id of computeCache.keys()) if (!jobIds.has(id)) computeCache.delete(id);

    const jobs = Jobs.all();
    const expenses = Storage.getExpenses();
    const settings = Storage.getSettings();
    const currency = settings.currency;
    const range = { from: state.from, to: state.to };

    const pop = periodOverPeriod(jobs, expenses, range, state.clientFilter);
    const forecast = forecastPipeline(jobs, state.clientFilter);

    renderRangePresets();
    renderClientChip();
    renderPnlCards(pop, currency);
    renderPeriodCompare(pop, currency);
    renderForecast(forecast, currency);
    renderClientTable(pop.current, currency);
    renderTopClientsChart(pop.current, currency);
    renderTopFreelancersChart(pop.current);
    renderExpensesChart(pop.current, currency);
    renderPrintHeader();
  }

  function renderRangePresets() {
    if (!els.rangePresets) return;
    els.rangePresets.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === state.presetKey);
    });
    els.rangeCustom.hidden = state.presetKey !== 'custom';
  }

  function renderClientChip() {
    if (!els.clientChip) return;
    if (!state.clientFilter) { els.clientChip.hidden = true; return; }
    els.clientChip.hidden = false;
    els.clientChip.innerHTML = `Client: <strong>${Utils.escapeHTML(state.clientFilterDisplay)}</strong> <span class="x">×</span>`;
    els.clientChip.querySelector('.x').addEventListener('click', () => openClientFilter(null));
  }

  function deltaChip(deltas, key, currency) {
    if (!deltas || !deltas[key]) return '<span class="delta-flat">—</span>';
    const d = deltas[key];
    if (d.previous === 0 && d.current === 0) return '<span class="delta-flat">0%</span>';
    const cls = d.abs > 0 ? 'delta-up' : (d.abs < 0 ? 'delta-down' : 'delta-flat');
    return `<span class="${cls}">${Utils.round2(d.pct)}%</span>`;
  }

  function renderPnlCards(pop, currency) {
    const c = pop.current;
    const revDelta = deltaChip(pop.deltas, 'revenue', currency);
    const netDelta = deltaChip(pop.deltas, 'netProfit', currency);
    els.pnlGrid.innerHTML = `
      <div class="kpi-card pnl-card revenue">
        <div class="kpi-label">Revenue</div>
        <div class="kpi-value success">${Utils.formatCurrency(c.revenue, currency)}</div>
        <div class="kpi-hint">Fares share of incoming · ${revDelta} vs previous</div>
      </div>
      <div class="kpi-card pnl-card payout">
        <div class="kpi-label">Team payouts</div>
        <div class="kpi-value warning">${Utils.formatCurrency(c.teamPayout, currency)}</div>
        <div class="kpi-hint">Outgoing to freelancers in range</div>
      </div>
      <div class="kpi-card pnl-card expenses">
        <div class="kpi-label">Expenses</div>
        <div class="kpi-value warning">${Utils.formatCurrency(c.expenses, currency)}</div>
        <div class="kpi-hint">Subscriptions, tools, taxes, etc.</div>
      </div>
      <div class="kpi-card pnl-card net">
        <div class="kpi-label">Net profit</div>
        <div class="kpi-value accent">${Utils.formatCurrency(c.netProfit, currency)}</div>
        <div class="kpi-hint">Revenue − Payouts − Expenses · ${netDelta}</div>
      </div>
    `;
  }

  function renderPeriodCompare(pop, currency) {
    if (!pop.deltas) {
      els.periodCompare.innerHTML = '<p class="dim" style="font-size:12px;padding:6px 4px">No previous period to compare (range is all-time).</p>';
      return;
    }
    const cells = [
      { label: 'Revenue', key: 'revenue', fmt: v => Utils.formatCurrency(v, currency) },
      { label: 'Net profit', key: 'netProfit', fmt: v => Utils.formatCurrency(v, currency) },
      { label: 'Jobs completed', key: 'jobsCompleted', fmt: v => String(v) },
      { label: 'Avg job value', key: 'avgJobValue', fmt: v => Utils.formatCurrency(v, currency) },
      { label: 'Collection rate', key: 'collectionRate', fmt: v => `${v}%` }
    ];
    els.periodCompare.innerHTML = cells.map(c => {
      const d = pop.deltas[c.key];
      const cls = d.abs > 0 ? 'delta-up' : (d.abs < 0 ? 'delta-down' : 'delta-flat');
      const pctText = (d.previous === 0 && d.current === 0) ? '0%' : `${d.pct}%`;
      return `
        <div class="pc-cell">
          <div class="pc-label">${c.label}</div>
          <div class="pc-current">${c.fmt(d.current)}</div>
          <div class="pc-delta ${cls}">${pctText}</div>
          <div class="pc-previous dim">vs ${c.fmt(d.previous)}</div>
        </div>
      `;
    }).join('');
  }

  function renderForecast(forecast, currency) {
    const max = Math.max(forecast.bestCase, 1);
    const pct = v => Math.min(100, (v / max) * 100);
    els.forecast.innerHTML = `
      <div class="forecast-row">
        <div class="forecast-label">Worst <span class="dim">(only "delivered" jobs)</span></div>
        <div class="forecast-bar"><span style="width:${pct(forecast.worstCase)}%;background:var(--danger)"></span></div>
        <div class="forecast-value">${Utils.formatCurrency(forecast.worstCase, currency)}</div>
      </div>
      <div class="forecast-row">
        <div class="forecast-label">Expected <span class="dim">(status-weighted)</span></div>
        <div class="forecast-bar"><span style="width:${pct(forecast.expected)}%;background:var(--accent)"></span></div>
        <div class="forecast-value">${Utils.formatCurrency(forecast.expected, currency)}</div>
      </div>
      <div class="forecast-row">
        <div class="forecast-label">Best <span class="dim">(if everything pays)</span></div>
        <div class="forecast-bar"><span style="width:${pct(forecast.bestCase)}%;background:var(--success)"></span></div>
        <div class="forecast-value">${Utils.formatCurrency(forecast.bestCase, currency)}</div>
      </div>
    `;
  }

  function renderClientTable(agg, currency) {
    const rows = Array.from(agg.clientStats.values());
    if (rows.length === 0) {
      els.clientTable.innerHTML = '<p class="dim" style="font-size:12px;padding:14px">No client activity in this range.</p>';
      return;
    }
    const col = state.sort.col;
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let av = a[col], bv = b[col];
      if (av == null) av = 0; if (bv == null) bv = 0;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return av < bv ? -1 * dir : (av > bv ? 1 * dir : 0);
    });
    const indicator = c => c === col ? (dir === 1 ? ' ▲' : ' ▼') : '';
    els.clientTable.innerHTML = `
      <table class="client-profit-table">
        <thead>
          <tr>
            <th data-col="name">Client${indicator('name')}</th>
            <th class="num" data-col="jobs">Jobs${indicator('jobs')}</th>
            <th class="num" data-col="revenue">Revenue${indicator('revenue')}</th>
            <th class="num" data-col="teamPaid">Team paid${indicator('teamPaid')}</th>
            <th class="num" data-col="marginPct">Margin %${indicator('marginPct')}</th>
            <th class="num" data-col="avgDaysToPay">Days to pay${indicator('avgDaysToPay')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr data-name="${Utils.escapeHTML(r.name)}">
              <td><strong>${Utils.escapeHTML(r.name)}</strong></td>
              <td class="num">${r.jobs}</td>
              <td class="num">${Utils.formatCurrency(r.revenue, currency)}</td>
              <td class="num">${Utils.formatCurrency(r.teamPaid, currency)}</td>
              <td class="num ${r.marginPct >= 50 ? 'amount-pos' : (r.marginPct >= 20 ? 'amount-pending' : '')}">${r.marginPct}%</td>
              <td class="num">${r.avgDaysToPay != null ? r.avgDaysToPay + 'd' : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    // Sort + click-to-filter wiring
    els.clientTable.querySelectorAll('th[data-col]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const c = th.dataset.col;
        if (state.sort.col === c) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        else { state.sort.col = c; state.sort.dir = 'desc'; }
        render();
      });
    });
    els.clientTable.querySelectorAll('tbody tr').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => openClientFilter(tr.dataset.name));
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

  function renderTopClientsChart(agg, currency) {
    if (!els.chartClients) return;
    const palette = getPalette();
    const entries = Array.from(agg.clientStats.values())
      .map(s => ({ name: s.name, profit: Utils.round2(s.revenue - s.teamPaid) }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 8);
    if (charts.topClients) charts.topClients.destroy();
    if (entries.length === 0) {
      charts.topClients = emptyChart(els.chartClients, palette);
      return;
    }
    charts.topClients = new Chart(els.chartClients, {
      type: 'bar',
      data: {
        labels: entries.map(e => e.name),
        datasets: [{
          label: 'Profit', data: entries.map(e => e.profit),
          backgroundColor: palette.colors, borderRadius: 6, borderSkipped: false
        }]
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

  function renderTopFreelancersChart(agg) {
    if (!els.chartFreelancers) return;
    const palette = getPalette();
    const entries = Object.values(agg.freelancerOutput || {})
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    if (charts.topFreelancers) charts.topFreelancers.destroy();
    if (entries.length === 0) {
      charts.topFreelancers = emptyChart(els.chartFreelancers, palette);
      return;
    }
    charts.topFreelancers = new Chart(els.chartFreelancers, {
      type: 'bar',
      data: {
        labels: entries.map(e => e.name),
        datasets: [{
          label: 'Tasks (open + done in range)',
          data: entries.map(e => e.value),
          backgroundColor: palette.accent + 'cc',
          borderColor: palette.accent,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.raw} task${ctx.raw !== 1 ? 's' : ''}` } }
        },
        scales: {
          x: { grid: { color: palette.grid }, ticks: { stepSize: 1, callback: v => Number.isInteger(v) ? v : '' } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  function renderExpensesChart(agg, currency) {
    if (!els.chartExpenses) return;
    const palette = getPalette();
    const entries = Object.entries(agg.expenseByCategory || {})
      .sort((a, b) => b[1] - a[1]);
    if (charts.expenses) charts.expenses.destroy();
    if (entries.length === 0) {
      charts.expenses = emptyChart(els.chartExpenses, palette);
      return;
    }
    charts.expenses = new Chart(els.chartExpenses, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => Utils.round2(e[1])),
          backgroundColor: palette.colors,
          borderColor: palette.surface,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 12, boxWidth: 10 } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${Utils.formatCurrency(ctx.raw, currency)}` } }
        }
      }
    });
  }

  function emptyChart(canvas, palette) {
    return new Chart(canvas, {
      type: 'doughnut',
      data: { labels: ['No data'], datasets: [{ data: [1], backgroundColor: [palette.grid], borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });
  }

  function renderPrintHeader() {
    if (!els.printHeader) return;
    const label = state.presetKey === 'custom'
      ? `${state.from} → ${state.to}`
      : (PRESET_LABELS[state.presetKey] + ` (${state.from} → ${state.to})`);
    const cf = state.clientFilterDisplay ? ` · Client: ${state.clientFilterDisplay}` : '';
    els.printHeader.innerHTML = `
      <h1>Quantro AI — Insights Report</h1>
      <p class="dim">${Utils.escapeHTML(label)}${Utils.escapeHTML(cf)} · Generated ${Utils.escapeHTML(new Date().toLocaleString())}</p>
    `;
  }

  return { init, render, setRange, openClientFilter, printReport };
})();
