/* table.js — render jobs table, sort, filter, row actions */

const JobsTable = (function () {
  let sortBy = 'createdAt';
  let sortDir = 'desc'; // 'asc' | 'desc'
  let search = '';
  let statusFilter = 'all';
  let clientFilter = 'all';

  function init() {
    document.querySelectorAll('.jobs-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortBy === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortBy = key; sortDir = 'asc'; }
        render();
      });
    });

    const search$ = document.getElementById('search-input');
    const status$ = document.getElementById('status-filter');
    const client$ = document.getElementById('client-filter');
    search$.addEventListener('input', Utils.debounce(() => {
      search = search$.value.toLowerCase().trim();
      render();
    }, 150));
    status$.addEventListener('change', () => { statusFilter = status$.value; render(); });
    client$.addEventListener('change', () => { clientFilter = client$.value; render(); });
  }

  function refreshClientFilter() {
    const sel = document.getElementById('client-filter');
    const current = sel.value;
    const clients = Jobs.uniqueClients();
    sel.innerHTML = '<option value="all">All clients</option>' +
      clients.map(c => `<option value="${Utils.escapeHTML(c)}">${Utils.escapeHTML(c)}</option>`).join('');
    sel.value = clients.includes(current) ? current : 'all';
    if (sel.value === '') sel.value = 'all';
  }

  function passesFilters(job) {
    if (search) {
      const hay = `${job.jobName} ${job.clientName} ${job.description}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (clientFilter !== 'all' && job.clientName !== clientFilter) return false;
    if (statusFilter !== 'all' && job.paymentStatus !== statusFilter) return false;
    return true;
  }

  function sortJobs(jobs) {
    const key = sortBy;
    const dir = sortDir === 'asc' ? 1 : -1;
    return jobs.sort((a, b) => {
      let va = a[key], vb = b[key];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  function statusClassFor(received, total) {
    if (total <= 0) return '';
    const pct = received / total;
    if (pct >= 1) return '';
    if (pct > 0) return 'partial';
    return 'empty';
  }

  function rowHTML(j, currency) {
    const fmt = n => Utils.formatCurrency(n, currency);
    const totalPct = j.totalPay > 0 ? Math.min(100, (j.cashIn / j.totalPay) * 100) : 0;
    const sharePct = j.faresShare > 0 ? Math.min(100, (j.faresReceived / j.faresShare) * 100) : 0;
    const totalBarClass = statusClassFor(j.cashIn, j.totalPay);
    const shareBarClass = statusClassFor(j.faresReceived, j.faresShare);

    const team = j.freelancers.length === 0
      ? `<span class="chip alone">🧍 Alone</span>`
      : j.freelancers.map(f => `<span class="chip">${Utils.escapeHTML(f)}</span>`).join(' ');

    const desc = j.description
      ? `<span title="${Utils.escapeHTML(j.description)}">${Utils.escapeHTML(j.description)}</span>`
      : '<span class="amount-zero">—</span>';

    const remTotalCls = j.remainingFromClient > 0 ? 'amount-pending' : 'amount-zero';
    const remFaresCls = j.faresRemaining > 0 ? 'amount-pending' : 'amount-zero';
    const recTotalCls = j.cashIn > 0 ? 'amount-pos' : 'amount-zero';
    const recFaresCls = j.faresReceived > 0 ? 'amount-pos' : 'amount-zero';

    return `
      <tr data-id="${j.id}">
        <td class="col-job">${Utils.escapeHTML(j.jobName)}</td>
        <td class="col-desc">${desc}</td>
        <td>${Utils.escapeHTML(j.clientName)}</td>
        <td><div class="chip-list">${team}</div></td>
        <td class="num">${fmt(j.totalPay)}</td>
        <td class="num">${j.faresTechnicalPercent}%</td>
        <td class="num">${fmt(j.totalPay)}</td>
        <td class="num">
          <div class="bar-cell">
            <span class="num-line ${recTotalCls}">${fmt(j.cashIn)}</span>
            <div class="bar"><div class="bar-fill ${totalBarClass}" style="width:${totalPct}%"></div></div>
          </div>
        </td>
        <td class="num ${remTotalCls}">${fmt(j.remainingFromClient)}</td>
        <td class="num">
          <div class="bar-cell">
            <span class="num-line ${recFaresCls}">${fmt(j.faresReceived)}</span>
            <div class="bar"><div class="bar-fill ${shareBarClass}" style="width:${sharePct}%"></div></div>
          </div>
        </td>
        <td class="num ${remFaresCls}">${fmt(j.faresRemaining)}</td>
        <td>
          <div class="row-actions">
            <button class="row-action" data-action="payments" title="Payments" aria-label="Payments">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            </button>
            <button class="row-action" data-action="edit" title="Edit" aria-label="Edit">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="row-action danger" data-action="delete" title="Delete" aria-label="Delete">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  function updateSortIndicators() {
    document.querySelectorAll('.jobs-table th[data-sort]').forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === sortBy) {
        th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });
  }

  function render() {
    const tbody = document.getElementById('jobs-tbody');
    const empty = document.getElementById('empty-state');
    if (!tbody) return;

    refreshClientFilter();

    const currency = Storage.getSettings().currency;
    const computed = Jobs.all().map(Jobs.compute);
    const filtered = computed.filter(passesFilters);
    const sorted = sortJobs(filtered);

    updateSortIndicators();

    if (Jobs.all().length === 0) {
      tbody.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').innerHTML = 'No jobs yet. Click <strong>Add New Job</strong> to start tracking.';
      return;
    }

    if (sorted.length === 0) {
      tbody.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').innerHTML = 'No jobs match the current filters.';
      return;
    }

    empty.hidden = true;
    tbody.innerHTML = sorted.map(j => rowHTML(j, currency)).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
      const id = tr.dataset.id;
      tr.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        JobForm.open(id);
      });
      tr.querySelector('[data-action="payments"]').addEventListener('click', (e) => {
        e.stopPropagation();
        Payments.open(id);
      });
      tr.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const job = Jobs.get(id);
        App.confirm(`Delete "${job.jobName}"?`, 'This cannot be undone.', () => {
          Jobs.remove(id);
          render();
          Dashboard.render();
          Utils.toast('Job deleted', 'success');
        });
      });
    });
  }

  return { init, render };
})();
