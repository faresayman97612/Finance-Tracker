/* team.js — Team tab: freelancer grid + detail modal */

const Team = (function () {
  const els = {};
  let currentFreelancerId = null;

  function init() {
    els.grid = document.getElementById('team-grid');
    els.empty = document.getElementById('team-empty');
    els.modal = document.getElementById('freelancer-modal');
    els.modalTitle = document.getElementById('freelancer-modal-title');
    els.modalBody = document.getElementById('freelancer-modal-body');
  }

  function aggregate() {
    // returns: Map<freelancerId, {assignments[], tasks{}, earned, paid, owed, payments[], firstJobAt, lastJobAt}>
    const map = new Map();
    const settings = Storage.getSettings();
    for (const f of (settings.freelancers || [])) {
      map.set(f.id, {
        freelancer: f,
        assignments: [],
        tasks: { todo: 0, doing: 0, done: 0, overdue: 0 },
        earned: 0,
        paid: 0,
        owed: 0,
        payments: [],
        activeJobs: 0
      });
    }
    function ensure(id) {
      if (!map.has(id)) {
        const ref = Storage.getFreelancer(id);
        map.set(id, {
          freelancer: ref || { id, name: '(removed)', active: false },
          assignments: [], tasks: { todo: 0, doing: 0, done: 0, overdue: 0 },
          earned: 0, paid: 0, owed: 0, payments: [], activeJobs: 0
        });
      }
      return map.get(id);
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);

    for (const job of Jobs.all()) {
      const c = Jobs.compute(job);
      for (const f of (c.freelancerStats || [])) {
        const slot = ensure(f.id);
        slot.assignments.push({
          jobId: job.id,
          jobName: job.jobName,
          clientName: job.clientName,
          stage: c.stage,
          stageLabel: c.stageLabel,
          share: f.share,
          paid: f.paid,
          owedNow: f.owedNow,
          taskCounts: f.tasks
        });
        slot.earned += f.share;
        slot.paid += f.paid;
        slot.owed += f.owedNow;
        slot.tasks.todo += f.tasks.todo;
        slot.tasks.doing += f.tasks.doing;
        slot.tasks.done += f.tasks.done;
        if (c.stage !== 'delivered' && c.stage !== 'closed') slot.activeJobs += 1;
      }
      // collect outgoing payments
      for (const p of (job.payments || [])) {
        if (p.direction !== 'outgoing' || !p.to) continue;
        const slot = ensure(p.to);
        slot.payments.push({
          jobId: job.id,
          jobName: job.jobName,
          amount: p.amount,
          method: p.method,
          date: p.date,
          note: p.note || ''
        });
      }
      // overdue tasks per assignee
      for (const t of (job.tasks || [])) {
        if (t.status === 'done' || !t.dueDate) continue;
        const [y, m, d] = t.dueDate.split('-').map(Number);
        const dl = new Date(y, m - 1, d);
        if (dl < today) {
          const slot = ensure(t.assignee === 'fares' ? 'fares' : t.assignee);
          if (slot) slot.tasks.overdue += 1;
        }
      }
    }

    // round and sort payments
    for (const slot of map.values()) {
      slot.earned = Utils.round2(slot.earned);
      slot.paid = Utils.round2(slot.paid);
      slot.owed = Utils.round2(slot.owed);
      slot.payments.sort((a, b) => (a.date < b.date) ? 1 : -1);
    }

    return map;
  }

  function render() {
    if (!els.grid) init();
    const data = aggregate();
    const settings = Storage.getSettings();
    const cur = settings.currency;
    const freelancers = (settings.freelancers || []).slice()
      .sort((a, b) => {
        if (a.active === b.active) return (a.name || '').localeCompare(b.name || '');
        return a.active === false ? 1 : -1;
      });

    if (freelancers.length === 0) {
      els.grid.innerHTML = '';
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    els.grid.innerHTML = freelancers.map(f => {
      const slot = data.get(f.id) || { earned: 0, paid: 0, owed: 0, tasks: { todo: 0, doing: 0, done: 0, overdue: 0 }, activeJobs: 0, assignments: [] };
      const openTasks = slot.tasks.todo + slot.tasks.doing;
      const inactiveCls = f.active === false ? ' inactive' : '';
      const role = f.role ? `<span class="freelancer-role">${Utils.escapeHTML(f.role)}</span>` : '';
      return `
        <div class="freelancer-card${inactiveCls}" data-id="${Utils.escapeHTML(f.id)}">
          <div class="fc-head">
            <strong>${Utils.escapeHTML(f.name || '(unnamed)')}</strong>
            ${role}
          </div>
          <div class="fc-stats">
            <div><span class="fc-stat-num">${slot.activeJobs}</span><span class="dim"> active</span></div>
            <div><span class="fc-stat-num">${openTasks}</span><span class="dim"> open tasks</span></div>
            ${slot.tasks.overdue ? `<div style="color:var(--danger)"><span class="fc-stat-num">${slot.tasks.overdue}</span><span> overdue</span></div>` : ''}
          </div>
          <div class="fc-money">
            <div class="dim">Owed now</div>
            <strong style="color:${slot.owed > 0 ? 'var(--warning)' : 'var(--text-muted)'}">${Utils.formatCurrency(slot.owed, cur)}</strong>
          </div>
          <div class="fc-money">
            <div class="dim">Paid total</div>
            <strong>${Utils.formatCurrency(slot.paid, cur)}</strong>
          </div>
        </div>
      `;
    }).join('');

    els.grid.querySelectorAll('.freelancer-card').forEach(card => {
      card.addEventListener('click', () => openFreelancer(card.dataset.id));
    });
  }

  function openFreelancer(id) {
    if (!els.modal) init();
    currentFreelancerId = id;
    const settings = Storage.getSettings();
    const f = (settings.freelancers || []).find(x => x.id === id);
    if (!f) return;
    const data = aggregate();
    const slot = data.get(id) || { assignments: [], tasks: {}, earned: 0, paid: 0, owed: 0, payments: [], activeJobs: 0 };
    const cur = settings.currency;
    els.modalTitle.textContent = f.name || '(unnamed)';

    const contactLine = [
      f.role ? `<span class="dim">${Utils.escapeHTML(f.role)}</span>` : '',
      f.email ? `<span class="dim">${Utils.escapeHTML(f.email)}</span>` : '',
      f.phone ? `<span class="dim">${Utils.escapeHTML(f.phone)}</span>` : '',
      f.preferredMethod ? `<span class="chip">${Utils.escapeHTML(f.preferredMethod)}</span>` : ''
    ].filter(Boolean).join(' · ');

    const totalTasks = (slot.tasks.todo || 0) + (slot.tasks.doing || 0) + (slot.tasks.done || 0);

    const assignmentsHTML = slot.assignments.length === 0
      ? '<p class="dim" style="font-size:12px;padding:6px 0">No active assignments.</p>'
      : `
        <table class="fl-assignments">
          <thead>
            <tr><th>Job</th><th>Client</th><th>Status</th><th class="num">Share</th><th class="num">Paid</th><th class="num">Owed</th></tr>
          </thead>
          <tbody>
            ${slot.assignments.map(a => `
              <tr data-job="${Utils.escapeHTML(a.jobId)}">
                <td><strong>${Utils.escapeHTML(a.jobName)}</strong></td>
                <td>${Utils.escapeHTML(a.clientName)}</td>
                <td><span class="stage-pill stage-${a.stage}">${Utils.escapeHTML(a.stageLabel)}</span></td>
                <td class="num">${Utils.formatCurrency(a.share, cur)}</td>
                <td class="num">${Utils.formatCurrency(a.paid, cur)}</td>
                <td class="num ${a.owedNow > 0 ? 'amount-pending' : 'amount-zero'}">${Utils.formatCurrency(a.owedNow, cur)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    const paymentsHTML = slot.payments.length === 0
      ? '<p class="dim" style="font-size:12px;padding:6px 0">No payments yet.</p>'
      : `
        <table class="fl-assignments">
          <thead>
            <tr><th>Date</th><th>Job</th><th>Method</th><th class="num">Amount</th><th>Note</th></tr>
          </thead>
          <tbody>
            ${slot.payments.map(p => `
              <tr>
                <td>${Utils.escapeHTML(Utils.formatDate(p.date))}</td>
                <td>${Utils.escapeHTML(p.jobName)}</td>
                <td><span class="pi-method">${Utils.escapeHTML(p.method)}</span></td>
                <td class="num">${Utils.formatCurrency(p.amount, cur)}</td>
                <td class="dim">${Utils.escapeHTML(p.note)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    els.modalBody.innerHTML = `
      <div class="fl-header">
        <div>${contactLine || '<span class="dim">No contact info — edit in Settings.</span>'}</div>
        ${f.active === false ? '<span class="chip" style="background:var(--warning-soft);color:var(--warning)">Inactive</span>' : ''}
      </div>

      <div class="payments-summary" style="margin-top:14px">
        <div class="ps-card">
          <div class="ps-label">Active jobs</div>
          <div class="ps-value">${slot.activeJobs}</div>
        </div>
        <div class="ps-card">
          <div class="ps-label">Earned</div>
          <div class="ps-value">${Utils.formatCurrency(slot.earned, cur)}</div>
        </div>
        <div class="ps-card">
          <div class="ps-label">Paid</div>
          <div class="ps-value" style="color:var(--success)">${Utils.formatCurrency(slot.paid, cur)}</div>
        </div>
        <div class="ps-card">
          <div class="ps-label">Owed now</div>
          <div class="ps-value" style="color:${slot.owed > 0 ? 'var(--warning)' : 'var(--text-muted)'}">${Utils.formatCurrency(slot.owed, cur)}</div>
        </div>
        <div class="ps-card">
          <div class="ps-label">Tasks</div>
          <div class="ps-value">${slot.tasks.done || 0} / ${totalTasks}</div>
          <div class="ps-sub">${slot.tasks.overdue ? `${slot.tasks.overdue} overdue` : 'no overdue'}</div>
        </div>
      </div>

      <h3 class="bd-title" style="margin-top:18px">Assignments</h3>
      ${assignmentsHTML}

      <h3 class="bd-title" style="margin-top:18px">Payment history</h3>
      ${paymentsHTML}
    `;

    // Wire row clicks to open the job's payments modal
    els.modalBody.querySelectorAll('.fl-assignments tr[data-job]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        closeFreelancer();
        Payments.open(tr.dataset.job);
      });
    });

    els.modal.hidden = false;
  }

  function closeFreelancer() {
    if (els.modal) els.modal.hidden = true;
    currentFreelancerId = null;
  }

  return { init, render, openFreelancer, closeFreelancer };
})();
