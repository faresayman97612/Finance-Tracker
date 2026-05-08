/* payments.js — payment log modal: incoming (client → me) + outgoing (me → freelancer) */

const Payments = (function () {
  let currentJobId = null;
  let direction = 'incoming';
  let listFilter = 'all';
  const els = {};

  function init() {
    els.modal = document.getElementById('payments-modal');
    els.title = document.getElementById('payments-title');
    els.summary = document.getElementById('payments-summary');
    els.breakdown = document.getElementById('freelancer-breakdown');
    els.list = document.getElementById('payments-list');
    els.form = document.getElementById('payment-form');
    els.dirBtns = document.querySelectorAll('.dir-btn');
    els.toField = document.getElementById('p-to-field');
    els.to = document.getElementById('p-to');
    els.amount = document.getElementById('p-amount');
    els.method = document.getElementById('p-method');
    els.date = document.getElementById('p-date');
    els.note = document.getElementById('p-note');
    els.filterBtns = document.querySelectorAll('.pf-btn');

    els.dirBtns.forEach(b => b.addEventListener('click', () => setDirection(b.dataset.direction)));
    els.filterBtns.forEach(b => b.addEventListener('click', () => {
      listFilter = b.dataset.filter;
      els.filterBtns.forEach(x => x.classList.toggle('active', x === b));
      renderList();
    }));
    els.form.addEventListener('submit', onSubmit);
  }

  function setDirection(d) {
    direction = d === 'outgoing' ? 'outgoing' : 'incoming';
    els.dirBtns.forEach(b => {
      const on = b.dataset.direction === direction;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    // Method options
    const methods = direction === 'incoming' ? Jobs.INCOMING_METHODS : Jobs.OUTGOING_METHODS;
    els.method.innerHTML = methods.map(m => `<option value="${m}">${m}</option>`).join('');
    // To field visibility
    els.toField.hidden = direction !== 'outgoing';
    if (direction === 'outgoing') {
      const job = Jobs.get(currentJobId);
      const opts = (job?.freelancers || [])
        .map(n => `<option value="${Utils.escapeHTML(n)}">${Utils.escapeHTML(n)}</option>`)
        .join('');
      els.to.innerHTML = '<option value="">Select…</option>' + opts;
    }
  }

  function open(jobId) {
    currentJobId = jobId;
    listFilter = 'all';
    els.filterBtns.forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    els.date.value = Utils.todayISO();
    els.amount.value = '';
    els.note.value = '';
    setDirection('incoming');
    render();
    els.modal.hidden = false;
    setTimeout(() => els.amount.focus(), 50);
  }

  function close() { els.modal.hidden = true; currentJobId = null; }

  function render() {
    if (!currentJobId) return;
    const job = Jobs.get(currentJobId);
    if (!job) { close(); return; }
    const c = Jobs.compute(job);
    const cur = Storage.getSettings().currency;
    els.title.textContent = `Payments — ${job.jobName}`;

    els.summary.innerHTML = `
      <div class="ps-card">
        <div class="ps-label">From client</div>
        <div class="ps-value">${Utils.formatCurrency(c.cashIn, cur)} <span class="ps-sub">/ ${Utils.formatCurrency(c.totalPay, cur)}</span></div>
        <div class="ps-sub">Remaining ${Utils.formatCurrency(c.remainingFromClient, cur)}</div>
      </div>
      <div class="ps-card">
        <div class="ps-label">Fares share earned</div>
        <div class="ps-value">${Utils.formatCurrency(c.faresReceived, cur)} <span class="ps-sub">/ ${Utils.formatCurrency(c.faresShare, cur)}</span></div>
        <div class="ps-sub">${c.faresTotalPercent}% of project · pending ${Utils.formatCurrency(c.faresRemaining, cur)}</div>
      </div>
      <div class="ps-card">
        <div class="ps-label">Paid to team</div>
        <div class="ps-value">${Utils.formatCurrency(c.cashOut, cur)} <span class="ps-sub">/ ${Utils.formatCurrency(c.freelancersTotalShare, cur)}</span></div>
        <div class="ps-sub">Owed now ${Utils.formatCurrency(c.owedToTeamNow, cur)}</div>
      </div>
      <div class="ps-card">
        <div class="ps-label">On hand</div>
        <div class="ps-value">${Utils.formatCurrency(c.cashOnHand, cur)}</div>
        <div class="ps-sub">Cash in − cash out</div>
      </div>
    `;

    // Per-freelancer breakdown (only when there are freelancers)
    if (c.freelancerStats.length === 0) {
      els.breakdown.innerHTML = '';
    } else {
      els.breakdown.innerHTML = `
        <h3 class="bd-title">Per freelancer</h3>
        <div class="bd-list">
          ${c.freelancerStats.map(f => {
            const pct = f.share > 0 ? Math.min(100, (f.paid / f.share) * 100) : 0;
            const cls = pct >= 100 ? '' : (pct > 0 ? 'partial' : 'empty');
            return `
              <div class="bd-row">
                <div class="bd-name"><strong>${Utils.escapeHTML(f.name)}</strong> <span class="dim">(${f.percent}%)</span></div>
                <div class="bd-amounts">
                  <span class="dim">Paid</span> <strong>${Utils.formatCurrency(f.paid, cur)}</strong>
                  <span class="dim">/ ${Utils.formatCurrency(f.share, cur)}</span>
                  ${f.owedNow > 0 ? `<span class="bd-owed">Owe now ${Utils.formatCurrency(f.owedNow, cur)}</span>` : ''}
                </div>
                <div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    renderList();
  }

  function renderList() {
    const job = Jobs.get(currentJobId);
    if (!job) return;
    const cur = Storage.getSettings().currency;
    let payments = (job.payments || []).slice();
    if (listFilter !== 'all') payments = payments.filter(p => p.direction === listFilter);
    payments.sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);

    if (payments.length === 0) {
      els.list.innerHTML = '<div class="empty-state" style="padding:24px"><p>No payments yet.</p></div>';
      return;
    }

    els.list.innerHTML = payments.map(p => {
      const isIn = p.direction === 'incoming';
      const arrow = isIn
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
      const fromTo = isIn
        ? `from ${Utils.escapeHTML(job.clientName)}`
        : `to ${Utils.escapeHTML(p.to || '?')}`;
      return `
        <div class="payment-item v2" data-pid="${p.id}">
          <span class="pi-direction ${p.direction}">${arrow} ${isIn ? 'IN' : 'OUT'}</span>
          <span class="pi-method">${Utils.escapeHTML(p.method || '—')}</span>
          <span class="pi-amount ${isIn ? 'pos' : 'neg'}">${isIn ? '+' : '−'} ${Utils.formatCurrency(p.amount, cur)}</span>
          <span class="pi-from-to">${fromTo}</span>
          <span class="pi-date">${Utils.formatDate(p.date)}</span>
          <span class="pi-note">${Utils.escapeHTML(p.note || '')}</span>
          <button class="row-action danger" data-action="del-pay" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;
    }).join('');

    els.list.querySelectorAll('[data-action="del-pay"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pid = e.currentTarget.closest('.payment-item').dataset.pid;
        Jobs.removePayment(currentJobId, pid);
        render();
        JobsTable.render();
        Dashboard.render();
        Utils.toast('Payment deleted', 'success');
      });
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!currentJobId) return;
    const amount = Number(els.amount.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      Utils.toast('Enter a valid amount', 'error'); return;
    }
    if (direction === 'outgoing' && !els.to.value) {
      Utils.toast('Pick a freelancer', 'error'); return;
    }
    const result = Jobs.addPayment(currentJobId, {
      direction,
      to: els.to.value,
      amount,
      method: els.method.value,
      date: els.date.value || Utils.todayISO(),
      note: els.note.value
    });
    if (!result) {
      Utils.toast('Could not save payment', 'error'); return;
    }
    els.amount.value = '';
    els.note.value = '';
    els.amount.focus();
    render();
    JobsTable.render();
    Dashboard.render();
    Utils.toast('Payment added', 'success');
  }

  return { init, open, close };
})();
