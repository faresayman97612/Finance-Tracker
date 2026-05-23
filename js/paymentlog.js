/* paymentlog.js — global payment log: all payments across all jobs with filters */

const PaymentLog = (function () {
  let _clientFilter = 'all';
  let _jobFilter = 'all';
  let _dirFilter = 'all'; // 'all' | 'incoming' | 'outgoing'

  function init() {
    document.getElementById('pl-client-filter').addEventListener('change', function () {
      _clientFilter = this.value;
      _jobFilter = 'all';
      render();
    });

    document.getElementById('pl-job-filter').addEventListener('change', function () {
      _jobFilter = this.value;
      render();
    });

    document.querySelectorAll('.pl-dir-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        _dirFilter = this.dataset.dir;
        render();
      });
    });
  }

  function _populateClientFilter() {
    const sel = document.getElementById('pl-client-filter');
    const clients = Jobs.uniqueClients();
    sel.innerHTML = '<option value="all">All clients</option>';
    for (const c of clients) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
    if (_clientFilter !== 'all' && !clients.includes(_clientFilter)) _clientFilter = 'all';
    sel.value = _clientFilter;
  }

  function _populateJobFilter() {
    const sel = document.getElementById('pl-job-filter');
    const jobs = Jobs.all()
      .filter(j => _clientFilter === 'all' || j.clientName === _clientFilter)
      .sort((a, b) => a.jobName.localeCompare(b.jobName));
    sel.innerHTML = '<option value="all">All projects</option>';
    for (const j of jobs) {
      const opt = document.createElement('option');
      opt.value = j.id;
      opt.textContent = j.jobName;
      sel.appendChild(opt);
    }
    if (_jobFilter !== 'all' && !jobs.find(j => j.id === _jobFilter)) _jobFilter = 'all';
    sel.value = _jobFilter;
  }

  function _flattenPayments() {
    const rows = [];
    for (const job of Jobs.all()) {
      for (const p of (job.payments || [])) {
        const toName = p.direction === 'outgoing'
          ? (Storage.getFreelancerName(p.to, p.toName || ''))
          : '';
        rows.push({
          jobId: job.id,
          jobName: job.jobName,
          clientName: job.clientName,
          id: p.id,
          direction: p.direction,
          amount: p.amount,
          method: p.method,
          date: p.date,
          note: p.note || '',
          to: p.to || '',
          toName
        });
      }
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  }

  function render() {
    const settings = Storage.getSettings();
    const currency = (settings && settings.currency) || 'EGP';

    _populateClientFilter();
    _populateJobFilter();

    document.querySelectorAll('.pl-dir-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.dir === _dirFilter);
    });

    let rows = _flattenPayments();
    if (_clientFilter !== 'all') rows = rows.filter(r => r.clientName === _clientFilter);
    if (_jobFilter !== 'all') rows = rows.filter(r => r.jobId === _jobFilter);
    if (_dirFilter !== 'all') rows = rows.filter(r => r.direction === _dirFilter);

    const inRows = rows.filter(r => r.direction === 'incoming');
    const outRows = rows.filter(r => r.direction === 'outgoing');
    const totalIn = Utils.round2(inRows.reduce((s, r) => s + r.amount, 0));
    const totalOut = Utils.round2(outRows.reduce((s, r) => s + r.amount, 0));
    const net = Utils.round2(totalIn - totalOut);

    document.getElementById('pl-summary').innerHTML = `
      <div class="ps-card">
        <div class="ps-label">Total In</div>
        <div class="ps-value" style="color:var(--success)">${Utils.formatCurrency(totalIn, currency)}</div>
        <div class="ps-sub">${inRows.length} payment${inRows.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="ps-card">
        <div class="ps-label">Total Out</div>
        <div class="ps-value" style="color:var(--warning)">${Utils.formatCurrency(totalOut, currency)}</div>
        <div class="ps-sub">${outRows.length} payment${outRows.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="ps-card">
        <div class="ps-label">Net</div>
        <div class="ps-value" style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">${net < 0 ? '−' : ''}${Utils.formatCurrency(Math.abs(net), currency)}</div>
        <div class="ps-sub">${rows.length} transaction${rows.length !== 1 ? 's' : ''}</div>
      </div>
    `;

    const tbody = document.getElementById('pl-tbody');
    const empty = document.getElementById('pl-empty');

    if (rows.length === 0) {
      tbody.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    tbody.innerHTML = rows.map(r => {
      const isIn = r.direction === 'incoming';
      const dirClass = isIn ? 'incoming' : 'outgoing';
      const dirLabel = isIn ? 'In' : 'Out';
      const amtClass = isIn ? 'pos' : 'neg';
      const sign = isIn ? '+' : '−';
      const fromTo = isIn ? Utils.escapeHTML(r.clientName) : Utils.escapeHTML(r.toName || '—');

      return `<tr>
        <td class="pl-date">${Utils.escapeHTML(Utils.formatDate(r.date))}</td>
        <td><span class="pi-direction ${dirClass}">${dirLabel}</span></td>
        <td class="num pi-amount ${amtClass}">${sign}${Utils.formatCurrency(r.amount, currency)}</td>
        <td><span class="pi-method">${Utils.escapeHTML(r.method)}</span></td>
        <td class="pl-job">${Utils.escapeHTML(r.jobName)}</td>
        <td class="pl-client">${Utils.escapeHTML(r.clientName)}</td>
        <td class="pl-from-to">${fromTo}</td>
        <td class="pl-note">${Utils.escapeHTML(r.note)}</td>
      </tr>`;
    }).join('');
  }

  return { init, render };
})();
