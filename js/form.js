/* form.js — Add/Edit Job modal */

const JobForm = (function () {
  let editingId = null;
  let mode = 'alone'; // 'alone' | 'team'
  let stage = 'in-progress';
  let selectedFreelancerIds = [];
  let pendingTasks = []; // local copy edited until submit

  const els = {};

  function cacheEls() {
    els.modal = document.getElementById('job-modal');
    els.title = document.getElementById('job-modal-title');
    els.form = document.getElementById('job-form');
    els.id = document.getElementById('job-id');
    els.jobName = document.getElementById('f-jobName');
    els.description = document.getElementById('f-description');
    els.clientName = document.getElementById('f-clientName');
    els.totalPay = document.getElementById('f-totalPay');
    els.tech = document.getElementById('f-tech');
    els.techNum = document.getElementById('f-tech-num');
    els.modeBtns = document.querySelectorAll('[data-mode]');
    els.freelancersRow = document.getElementById('freelancers-row');
    els.picker = document.getElementById('freelancers-picker');
    els.newFreelancer = document.getElementById('new-freelancer');
    els.addFreelancerBtn = document.getElementById('add-freelancer-btn');
    els.calcBusiness = document.getElementById('calc-business');
    els.calcTechnical = document.getElementById('calc-technical');
    els.calcTechPct = document.getElementById('calc-tech-pct');
    els.calcTotal = document.getElementById('calc-total');
    els.calcTotalPct = document.getElementById('calc-total-pct');
    els.prepayClient = document.getElementById('f-prepay-client');
    els.prepayFares = document.getElementById('f-prepay-fares');
    els.clientList = document.getElementById('client-list');
    els.deadlineDate = document.getElementById('f-deadlineDate');
    els.stage = document.getElementById('f-stage');
    els.tasksEditor = document.getElementById('tasks-editor');
    els.tasksDetails = document.getElementById('tasks-details');
    els.tasksSummaryCount = document.getElementById('tasks-summary-count');
    els.addTaskBtn = document.getElementById('add-task-btn');
  }

  function init() {
    cacheEls();

    els.modeBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

    els.tech.addEventListener('input', () => {
      els.techNum.value = els.tech.value;
      updateCalc();
    });
    els.techNum.addEventListener('input', () => {
      const v = Utils.clamp(els.techNum.value, 0, 100);
      els.tech.value = v;
      updateCalc();
    });
    els.totalPay.addEventListener('input', updateCalc);

    els.addFreelancerBtn.addEventListener('click', addCustomFreelancer);
    els.newFreelancer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCustomFreelancer(); }
    });

    els.stage.addEventListener('change', () => { stage = els.stage.value; });
    els.addTaskBtn.addEventListener('click', () => {
      pendingTasks.push({
        id: Utils.uuid(),
        title: '',
        assignee: 'fares',
        status: 'todo',
        dueDate: '',
        valueType: 'none',
        value: 0,
        notes: ''
      });
      renderTasksEditor();
    });

    els.form.addEventListener('submit', onSubmit);
  }

  function setMode(newMode) {
    mode = newMode === 'team' ? 'team' : 'alone';
    els.modeBtns.forEach(b => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (mode === 'alone') {
      els.freelancersRow.hidden = true;
      els.tech.value = 100;
      els.techNum.value = 100;
      selectedFreelancerIds = [];
    } else {
      els.freelancersRow.hidden = false;
      renderFreelancerPicker();
    }
    renderTasksEditor();
    updateCalc();
  }

  function renderFreelancerPicker() {
    const settings = Storage.getSettings();
    const all = (settings.freelancers || []).slice();
    // Include any selected ID that's missing from settings (defensive)
    for (const id of selectedFreelancerIds) {
      if (!all.find(f => f.id === id)) {
        const ref = Storage.getFreelancer(id);
        if (ref) all.push(ref);
      }
    }
    els.picker.innerHTML = '';
    if (all.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'dim';
      empty.style.color = 'var(--text-muted)';
      empty.style.fontSize = '12px';
      empty.textContent = 'No freelancers yet — add one below.';
      els.picker.appendChild(empty);
      return;
    }
    all.forEach(f => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-toggle' + (selectedFreelancerIds.includes(f.id) ? ' active' : '');
      btn.textContent = f.name || '(unnamed)';
      btn.addEventListener('click', () => {
        const i = selectedFreelancerIds.indexOf(f.id);
        if (i === -1) selectedFreelancerIds.push(f.id);
        else selectedFreelancerIds.splice(i, 1);
        renderFreelancerPicker();
        renderTasksEditor();
        updateCalc();
      });
      els.picker.appendChild(btn);
    });
  }

  function addCustomFreelancer() {
    const name = els.newFreelancer.value.trim();
    if (!name) return;
    const settings = Storage.getSettings();
    if (!Array.isArray(settings.freelancers)) settings.freelancers = [];
    let existing = settings.freelancers.find(f => f.name === name);
    if (!existing) {
      existing = { id: Utils.uuid(), name, role: '', active: true };
      settings.freelancers.push(existing);
      Storage.saveSettings(settings);
    }
    if (!selectedFreelancerIds.includes(existing.id)) selectedFreelancerIds.push(existing.id);
    els.newFreelancer.value = '';
    renderFreelancerPicker();
    renderTasksEditor();
    updateCalc();
    if (typeof SettingsUI !== 'undefined' && SettingsUI.refresh) SettingsUI.refresh();
  }

  function renderTasksEditor() {
    els.tasksEditor.innerHTML = '';
    els.tasksSummaryCount.textContent = pendingTasks.length
      ? `(${pendingTasks.length})` : '';

    if (pendingTasks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dim';
      empty.style.cssText = 'font-size:12px;color:var(--text-muted);margin:4px 0;';
      empty.textContent = 'No tasks yet. Use this to break the job into milestones, assign people, and override the equal-split payout per task.';
      els.tasksEditor.appendChild(empty);
      return;
    }

    pendingTasks.forEach((t, i) => els.tasksEditor.appendChild(renderTaskRow(t, i)));
  }

  function renderTaskRow(t, i) {
    const row = document.createElement('div');
    row.className = 'task-row task-status-' + t.status;

    // Build assignee options: 'fares' + each selected freelancer + always include current assignee if missing
    const assigneeOptions = [{ value: 'fares', label: 'Fares' }];
    const settings = Storage.getSettings();
    for (const id of selectedFreelancerIds) {
      const ref = Storage.getFreelancer(id) || settings.freelancers.find(f => f.id === id);
      assigneeOptions.push({ value: id, label: (ref && ref.name) || '(unnamed)' });
    }
    if (t.assignee && t.assignee !== 'fares' && !assigneeOptions.find(o => o.value === t.assignee)) {
      const ref = Storage.getFreelancer(t.assignee);
      assigneeOptions.push({ value: t.assignee, label: (ref && ref.name) || '(removed)' });
    }
    const assigneeHTML = assigneeOptions.map(o =>
      `<option value="${Utils.escapeHTML(o.value)}" ${o.value === t.assignee ? 'selected' : ''}>${Utils.escapeHTML(o.label)}</option>`
    ).join('');

    const statusHTML = Jobs.TASK_STATUSES.map(s =>
      `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s}</option>`
    ).join('');

    const valueTypeHTML = ['none', 'percent', 'fixed'].map(v =>
      `<option value="${v}" ${v === t.valueType ? 'selected' : ''}>${v}</option>`
    ).join('');

    row.innerHTML = `
      <input class="input t-title" type="text" placeholder="Task title…" value="${Utils.escapeHTML(t.title)}">
      <select class="input t-assignee" aria-label="Assignee">${assigneeHTML}</select>
      <select class="input t-status" aria-label="Status">${statusHTML}</select>
      <input class="input t-due" type="date" value="${Utils.escapeHTML(t.dueDate || '')}" aria-label="Due date">
      <select class="input t-vtype" aria-label="Value type">${valueTypeHTML}</select>
      <input class="input t-val" type="number" min="0" step="0.01" value="${t.value || ''}" placeholder="${t.valueType === 'percent' ? '%' : t.valueType === 'fixed' ? 'amt' : '—'}" ${t.valueType === 'none' ? 'disabled' : ''}>
      <button type="button" class="row-action danger t-del" aria-label="Delete task">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;

    row.querySelector('.t-title').addEventListener('input', e => { t.title = e.target.value; });
    row.querySelector('.t-assignee').addEventListener('change', e => { t.assignee = e.target.value; updateCalc(); });
    row.querySelector('.t-status').addEventListener('change', e => {
      t.status = e.target.value;
      row.className = 'task-row task-status-' + t.status;
    });
    row.querySelector('.t-due').addEventListener('change', e => { t.dueDate = e.target.value; });
    row.querySelector('.t-vtype').addEventListener('change', e => {
      t.valueType = e.target.value;
      renderTasksEditor();
      updateCalc();
    });
    row.querySelector('.t-val').addEventListener('input', e => {
      t.value = Number(e.target.value) || 0;
      updateCalc();
    });
    row.querySelector('.t-del').addEventListener('click', () => {
      pendingTasks.splice(i, 1);
      renderTasksEditor();
      updateCalc();
    });

    return row;
  }

  function updateCalc() {
    const total = Number(els.totalPay.value) || 0;
    const tech = Utils.round2(Utils.clamp(Number(els.tech.value), 0, 100) * 0.6);
    const totalPct = Jobs.BUSINESS_PERCENT + tech;
    const business = Utils.round2(total * Jobs.BUSINESS_PERCENT / 100);
    const technical = Utils.round2(total * tech / 100);
    const share = Utils.round2(total * totalPct / 100);
    const cur = Storage.getSettings().currency;

    els.calcBusiness.textContent = Utils.formatCurrency(business, cur);
    els.calcTechnical.textContent = Utils.formatCurrency(technical, cur);
    els.calcTotal.textContent = Utils.formatCurrency(share, cur);
    els.calcTechPct.textContent = `(${tech}%)`;
    els.calcTotalPct.textContent = `(${totalPct}%)`;

    // Per-freelancer breakdown (using simulated compute for live preview)
    const calcPanel = els.calcBusiness.closest('.calc-panel');
    let freelancerSection = calcPanel.querySelector('.calc-freelancers');

    if (mode !== 'team' || selectedFreelancerIds.length === 0) {
      if (freelancerSection) freelancerSection.remove();
      return;
    }

    const freelancersTotalPercent = Math.max(0, 100 - totalPct);
    const freelancersTotalShare = Utils.round2(total * freelancersTotalPercent / 100);

    // Compute task allocations
    const taskAssigned = {};
    for (const id of selectedFreelancerIds) taskAssigned[id] = 0;
    for (const t of pendingTasks) {
      if (t.assignee === 'fares' || t.valueType === 'none') continue;
      if (!(t.assignee in taskAssigned)) continue;
      const amt = t.valueType === 'percent'
        ? Utils.round2(total * (Number(t.value) || 0) / 100)
        : Utils.round2(Number(t.value) || 0);
      if (amt > 0) taskAssigned[t.assignee] = Utils.round2(taskAssigned[t.assignee] + amt);
    }
    const taskTotal = Utils.round2(Object.values(taskAssigned).reduce((s, n) => s + n, 0));
    const overAllocation = taskTotal > freelancersTotalShare + 0.005;
    const remainingTeamShare = Math.max(0, freelancersTotalShare - taskTotal);
    const withoutTask = selectedFreelancerIds.filter(id => (taskAssigned[id] || 0) === 0);
    const equalShare = withoutTask.length > 0 ? Utils.round2(remainingTeamShare / withoutTask.length) : 0;

    const rows = selectedFreelancerIds.map(id => {
      const ref = Storage.getFreelancer(id);
      const name = (ref && ref.name) || '(unnamed)';
      const ts = Utils.round2(taskAssigned[id] || 0);
      const es = ts > 0 ? 0 : equalShare;
      const personal = Utils.round2(ts + es);
      const pct = total > 0 ? Utils.round2(personal / total * 100) : 0;
      const detail = ts > 0
        ? `<span class="dim">tasks ${Utils.formatCurrency(ts, cur)}</span>`
        : `<span class="dim">equal split</span>`;
      return `
        <div class="calc-row" style="padding-left: 14px; font-size: 12px;">
          <span class="dim">• ${Utils.escapeHTML(name)} <span class="dim">(${pct}%)</span> ${detail}</span>
          <span class="dim">${Utils.formatCurrency(personal, cur)}</span>
        </div>
      `;
    }).join('');

    const html = `
      <div class="calc-row" style="border-top:1px dashed var(--border); margin-top:6px; padding-top:8px;">
        <span>Freelancers <span class="dim">(${freelancersTotalPercent}%)</span></span>
        <strong>${Utils.formatCurrency(freelancersTotalShare, cur)}</strong>
      </div>
      ${rows}
      ${overAllocation ? `
        <div class="calc-row" style="padding-left: 14px;">
          <span style="color:var(--warning);font-size:11px">⚠ Tasks total exceeds team share — payouts will follow tasks.</span>
        </div>
      ` : ''}
    `;

    if (!freelancerSection) {
      freelancerSection = document.createElement('div');
      freelancerSection.className = 'calc-freelancers';
      const totalRow = calcPanel.querySelector('.calc-row.total');
      calcPanel.insertBefore(freelancerSection, totalRow);
    }
    freelancerSection.innerHTML = html;
  }

  function refreshClientList() {
    const clients = Jobs.uniqueClients();
    els.clientList.innerHTML = clients.map(c =>
      `<option value="${Utils.escapeHTML(c)}"></option>`
    ).join('');
  }

  function open(jobId) {
    cacheEls();
    refreshClientList();
    pendingTasks = [];
    if (jobId) {
      const job = Jobs.get(jobId);
      if (!job) return;
      editingId = jobId;
      els.title.textContent = 'Edit Job';
      els.id.value = job.id;
      els.jobName.value = job.jobName;
      els.description.value = job.description;
      els.clientName.value = job.clientName;
      els.totalPay.value = job.totalPay;
      const displayTech = Utils.round2(job.faresTechnicalPercent / 0.6);
      els.tech.value = displayTech;
      els.techNum.value = displayTech;
      els.prepayClient.value = 0;
      els.prepayFares.value = 0;
      els.deadlineDate.value = job.deadlineDate || '';
      stage = Jobs.STAGES.includes(job.stage) ? job.stage : 'in-progress';
      els.stage.value = stage;
      const details = els.prepayClient.closest('details');
      if (details) details.hidden = true;
      if (!job.freelancers || job.freelancers.length === 0) {
        selectedFreelancerIds = [];
        setMode('alone');
      } else {
        selectedFreelancerIds = job.freelancers.slice();
        setMode('team');
      }
      pendingTasks = (job.tasks || []).map(t => ({ ...t }));
      if (pendingTasks.length > 0) els.tasksDetails.open = true;
    } else {
      editingId = null;
      els.title.textContent = 'Add New Job';
      els.form.reset();
      els.id.value = '';
      els.tech.value = 100;
      els.techNum.value = 100;
      els.prepayClient.value = 0;
      els.prepayFares.value = 0;
      els.deadlineDate.value = '';
      stage = 'in-progress';
      els.stage.value = stage;
      els.tasksDetails.open = false;
      const details = els.prepayClient.closest('details');
      if (details) details.hidden = false;
      selectedFreelancerIds = [];
      setMode('alone');
    }
    renderTasksEditor();
    updateCalc();
    els.modal.hidden = false;
    setTimeout(() => els.jobName.focus(), 50);
  }

  function close() {
    els.modal.hidden = true;
    editingId = null;
    selectedFreelancerIds = [];
    pendingTasks = [];
  }

  function onSubmit(e) {
    e.preventDefault();
    const sanitizedTasks = pendingTasks
      .filter(t => (t.title || '').trim() || t.valueType !== 'none')
      .map(t => ({ ...t, title: (t.title || '').trim() }));
    const data = {
      jobName: els.jobName.value.trim(),
      description: els.description.value.trim(),
      clientName: els.clientName.value.trim(),
      freelancers: mode === 'team' ? selectedFreelancerIds.slice() : [],
      totalPay: Number(els.totalPay.value),
      faresTechnicalPercent: Utils.round2(Utils.clamp(Number(els.tech.value), 0, 100) * 0.6),
      deadlineDate: els.deadlineDate.value || '',
      stage: els.stage.value,
      tasks: sanitizedTasks
    };
    if (!data.jobName) { Utils.toast('Job name is required', 'error'); return; }
    if (!data.clientName) { Utils.toast('Client name is required', 'error'); return; }
    if (!Number.isFinite(data.totalPay) || data.totalPay < 0) {
      Utils.toast('Enter a valid total pay', 'error'); return;
    }

    if (editingId) {
      Jobs.update(editingId, data);
      Utils.toast('Job updated', 'success');
    } else {
      data.prepayClient = Number(els.prepayClient.value) || 0;
      const methodEl = document.getElementById('f-prepay-client-method');
      data.prepayClientMethod = methodEl ? methodEl.value : 'Telda';
      Jobs.create(data);
      Utils.toast('Job added', 'success');
    }
    close();
    JobsTable.render();
    Dashboard.render();
    if (typeof Team !== 'undefined' && Team.render) Team.render();
  }

  return { init, open, close };
})();
