/* form.js — Add/Edit Job modal */

const JobForm = (function () {
  let editingId = null;
  let mode = 'alone'; // 'alone' | 'team'
  let workStatus = 'in-progress'; // 'in-progress' | 'delivered'
  let selectedFreelancers = [];

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
    els.workBtns = document.querySelectorAll('[data-work]');
  }

  function init() {
    cacheEls();

    els.modeBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
    els.workBtns.forEach(btn => btn.addEventListener('click', () => setWorkStatus(btn.dataset.work)));

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
      selectedFreelancers = [];
    } else {
      els.freelancersRow.hidden = false;
      renderFreelancerPicker();
    }
    updateCalc();
  }

  function setWorkStatus(newStatus) {
    workStatus = newStatus === 'delivered' ? 'delivered' : 'in-progress';
    els.workBtns.forEach(b => {
      const on = b.dataset.work === workStatus;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function renderFreelancerPicker() {
    const settings = Storage.getSettings();
    const all = Array.from(new Set([...settings.freelancers, ...selectedFreelancers]));
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
    all.forEach(name => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-toggle' + (selectedFreelancers.includes(name) ? ' active' : '');
      btn.textContent = name;
      btn.addEventListener('click', () => {
        const i = selectedFreelancers.indexOf(name);
        if (i === -1) selectedFreelancers.push(name);
        else selectedFreelancers.splice(i, 1);
        renderFreelancerPicker();
        updateCalc();
      });
      els.picker.appendChild(btn);
    });
  }

  function addCustomFreelancer() {
    const name = els.newFreelancer.value.trim();
    if (!name) return;
    const settings = Storage.getSettings();
    if (!settings.freelancers.includes(name)) {
      settings.freelancers.push(name);
      Storage.saveSettings(settings);
    }
    if (!selectedFreelancers.includes(name)) selectedFreelancers.push(name);
    els.newFreelancer.value = '';
    renderFreelancerPicker();
    updateCalc();
    if (typeof SettingsUI !== 'undefined' && SettingsUI.refresh) SettingsUI.refresh();
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

    // Per-freelancer breakdown
    const calcPanel = els.calcBusiness.closest('.calc-panel');
    let freelancerSection = calcPanel.querySelector('.calc-freelancers');
    if (mode === 'team' && selectedFreelancers.length > 0) {
      const freelancerPct = Math.max(0, 100 - totalPct);
      const perPct = Utils.round2(freelancerPct / selectedFreelancers.length);
      const perAmt = Utils.round2(total * perPct / 100);
      const html = `
        <div class="calc-row" style="border-top:1px dashed var(--border); margin-top:6px; padding-top:8px;">
          <span>Freelancers <span class="dim">(${freelancerPct}%)</span></span>
          <strong>${Utils.formatCurrency(Utils.round2(total * freelancerPct / 100), cur)}</strong>
        </div>
        ${selectedFreelancers.map(name => `
          <div class="calc-row" style="padding-left: 14px; font-size: 12px;">
            <span class="dim">• ${Utils.escapeHTML(name)} <span class="dim">(${perPct}%)</span></span>
            <span class="dim">${Utils.formatCurrency(perAmt, cur)}</span>
          </div>
        `).join('')}
      `;
      if (!freelancerSection) {
        freelancerSection = document.createElement('div');
        freelancerSection.className = 'calc-freelancers';
        const totalRow = calcPanel.querySelector('.calc-row.total');
        calcPanel.insertBefore(freelancerSection, totalRow);
      }
      freelancerSection.innerHTML = html;
    } else if (freelancerSection) {
      freelancerSection.remove();
    }
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
      setWorkStatus(job.workStatus || 'in-progress');
      const details = els.prepayClient.closest('details');
      if (details) details.hidden = true;
      if (job.freelancers.length === 0) {
        setMode('alone');
      } else {
        selectedFreelancers = job.freelancers.slice();
        setMode('team');
      }
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
      setWorkStatus('in-progress');
      const details = els.prepayClient.closest('details');
      if (details) details.hidden = false;
      selectedFreelancers = [];
      setMode('alone');
    }
    updateCalc();
    els.modal.hidden = false;
    setTimeout(() => els.jobName.focus(), 50);
  }

  function close() {
    els.modal.hidden = true;
    editingId = null;
    selectedFreelancers = [];
  }

  function onSubmit(e) {
    e.preventDefault();
    const data = {
      jobName: els.jobName.value.trim(),
      description: els.description.value.trim(),
      clientName: els.clientName.value.trim(),
      freelancers: mode === 'team' ? selectedFreelancers.slice() : [],
      totalPay: Number(els.totalPay.value),
      faresTechnicalPercent: Utils.round2(Utils.clamp(Number(els.tech.value), 0, 100) * 0.6),
      deadlineDate: els.deadlineDate.value || '',
      workStatus
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
  }

  return { init, open, close };
})();
