/* clientpay.js — Client Payment: per-client job table with per-row deposit/total mode and PDF export */

const ClientPay = (function () {
  const DEPOSIT_PCT = 50; // deposit is always 50% of total
  let _client = 'all';
  const _modes = {}; // jobId -> 'total' | 'deposit'  (default 'total')

  function init() {
    document.getElementById('cp-client-filter').addEventListener('change', function () {
      _client = this.value;
      render();
    });

    document.getElementById('cp-export-pdf').addEventListener('click', exportPdf);

    // Per-row mode switch (event delegation)
    document.getElementById('cp-tbody').addEventListener('click', function (e) {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      const jobId = btn.dataset.jobId;
      const mode = btn.dataset.mode;
      if (!jobId || !mode) return;
      _modes[jobId] = mode;
      render();
    });
  }

  function _populateClientFilter() {
    const sel = document.getElementById('cp-client-filter');
    const clients = Jobs.uniqueClients();
    sel.innerHTML = '<option value="all">Choose a client…</option>';
    for (const c of clients) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
    if (_client !== 'all' && !clients.includes(_client)) _client = 'all';
    sel.value = _client;
  }

  // Build the display rows for the currently selected client.
  // Only jobs with a positive outstanding balance in their current mode are shown
  // (remaining <= 0 — fully paid, or overpaid vs. the deposit — is dropped).
  function _buildRows() {
    const jobs = Jobs.all()
      .filter(j => j.clientName === _client)
      .sort((a, b) => (a.jobName || '').localeCompare(b.jobName || ''));

    return jobs.map(job => {
      const c = Jobs.compute(job);
      const total = c.totalPay;
      const paid = c.cashIn;
      const deposit = Utils.round2(total * DEPOSIT_PCT / 100);
      const mode = _modes[job.id] || 'total';
      const remaining = mode === 'deposit'
        ? Utils.round2(deposit - paid)
        : c.remainingFromClient; // total - paid
      return {
        id: job.id,
        jobName: job.jobName || '(untitled)',
        total, deposit, paid, remaining, mode
      };
    }).filter(r => r.remaining > 0);
  }

  function render() {
    const settings = Storage.getSettings();
    const currency = (settings && settings.currency) || 'EGP';

    _populateClientFilter();

    const tbody = document.getElementById('cp-tbody');
    const empty = document.getElementById('cp-empty');
    const summary = document.getElementById('cp-summary');

    if (_client === 'all') {
      tbody.innerHTML = '';
      summary.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').innerHTML = 'Choose a client above to see their jobs and payment status.';
      return;
    }

    const rows = _buildRows();

    if (rows.length === 0) {
      tbody.innerHTML = '';
      summary.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('p').innerHTML = `Nothing outstanding for <strong>${Utils.escapeHTML(_client)}</strong> — all jobs are fully settled.`;
      return;
    }
    empty.hidden = true;

    const remainingSum = Utils.round2(rows.reduce((s, r) => s + r.remaining, 0));

    summary.innerHTML = `
      <div class="ps-card">
        <div class="ps-label">Remaining</div>
        <div class="ps-value" style="color:var(--warning)">${Utils.formatCurrency(remainingSum, currency)}</div>
        <div class="ps-sub">${rows.length} outstanding job${rows.length !== 1 ? 's' : ''}</div>
      </div>
    `;

    tbody.innerHTML = rows.map((r, i) => {
      const isDeposit = r.mode === 'deposit';
      const depositCell = isDeposit
        ? `<span class="num">${Utils.formatCurrency(r.deposit, currency)}</span>`
        : `<span class="cp-dash">---</span>`;
      const remNeg = r.remaining < 0;
      const remColor = r.remaining > 0 ? 'var(--warning)' : (remNeg ? 'var(--danger)' : 'var(--success)');
      const remText = `${remNeg ? '−' : ''}${Utils.formatCurrency(Math.abs(r.remaining), currency)}`;

      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${Utils.escapeHTML(r.jobName)}</td>
        <td class="num">${Utils.formatCurrency(r.total, currency)}</td>
        <td class="num">${depositCell}</td>
        <td class="num">${Utils.formatCurrency(r.paid, currency)}</td>
        <td class="num" style="color:${remColor}">${remText}</td>
        <td>
          <div class="mode-toggle cp-mode-toggle" role="radiogroup" aria-label="Mode">
            <button type="button" class="mode-btn ${!isDeposit ? 'active' : ''}" data-job-id="${r.id}" data-mode="total" role="radio" aria-checked="${!isDeposit}">Total</button>
            <button type="button" class="mode-btn ${isDeposit ? 'active' : ''}" data-job-id="${r.id}" data-mode="deposit" role="radio" aria-checked="${isDeposit}">Deposit</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function exportPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      Utils.toast('PDF library not loaded.', 'error');
      return;
    }
    if (_client === 'all') {
      Utils.toast('Choose a client first.', 'info');
      return;
    }
    const rows = _buildRows();
    if (rows.length === 0) {
      Utils.toast('No jobs to export.', 'info');
      return;
    }

    const settings = Storage.getSettings();
    const currency = (settings && settings.currency) || 'EGP';
    const fmt = n => Utils.formatNumber(n);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const marginX = 14;

    // --- Quantro AI wordmark (text, not image) ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(26, 26, 35); // matches --text-primary (#1a1a23)
    doc.text('Quantro ', marginX, 20);
    const quantroWidth = doc.getTextWidth('Quantro ');
    doc.setTextColor(99, 102, 241); // indigo accent (approximates the cyan→indigo gradient)
    doc.text('AI', marginX + quantroWidth, 20);

    // Subtitle: section + client + date
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(90, 90, 100);
    doc.text(`Client Payment — ${_client}`, marginX, 29);
    doc.setFontSize(10);
    doc.text(`Generated ${Utils.formatDate(Utils.nowISO())}  ·  Currency: ${currency}`, marginX, 35);

    // --- Table (Mode column is intentionally omitted from the PDF) ---
    const body = rows.map((r, i) => [
      String(i + 1),
      r.jobName,
      fmt(r.total),
      r.mode === 'deposit' ? fmt(r.deposit) : '—',
      fmt(r.paid),
      (r.remaining < 0 ? '-' : '') + fmt(Math.abs(r.remaining))
    ]);

    const totalSum = rows.reduce((s, r) => s + r.total, 0);
    const paidSum = rows.reduce((s, r) => s + r.paid, 0);
    const remainingSum = rows.reduce((s, r) => s + r.remaining, 0);
    const footRow = [
      '', 'Totals',
      fmt(Utils.round2(totalSum)),
      '',
      fmt(Utils.round2(paidSum)),
      (remainingSum < 0 ? '-' : '') + fmt(Math.abs(Utils.round2(remainingSum)))
    ];

    doc.autoTable({
      startY: 42,
      head: [['#', 'Job', 'Total', `Deposit (${DEPOSIT_PCT}%)`, 'Paid', 'Remaining']],
      body,
      foot: [footRow],
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 245], textColor: [26, 26, 35], fontStyle: 'bold' },
      columnStyles: {
        0: { halign: 'right', cellWidth: 10 },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' }
      }
    });

    const slug = _client.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client';
    doc.save(`client-payment-${slug}.pdf`);
  }

  return { init, render };
})();
