/* jobs.js — job model + computed derived fields + CRUD */

const Jobs = (function () {
  const BUSINESS_PERCENT = 40;
  const MAX_TECH_PERCENT = 60;

  // Payment methods (kept here so other modules can read them)
  const INCOMING_METHODS = ['Telda', 'Instapay', 'Binance', 'VodafoneCash'];
  const OUTGOING_METHODS = ['Telda', 'Instapay', 'VodafoneCash', 'Cash'];

  // In-memory copy (synced with storage on every mutation)
  let _jobs = [];

  function load() {
    _jobs = Storage.getJobs();
    return _jobs;
  }

  function persist() {
    Storage.saveJobs(_jobs);
  }

  function all() { return _jobs.slice(); }

  function get(id) { return _jobs.find(j => j.id === id) || null; }

  function create(data) {
    const job = {
      id: Utils.uuid(),
      jobName: String(data.jobName || '').trim(),
      description: String(data.description || '').trim(),
      clientName: String(data.clientName || '').trim(),
      freelancers: Array.isArray(data.freelancers) ? data.freelancers.slice() : [],
      totalPay: Number(data.totalPay) || 0,
      faresTechnicalPercent: Utils.clamp(data.faresTechnicalPercent ?? 0, 0, MAX_TECH_PERCENT),
      status: 'active',
      createdAt: Utils.nowISO(),
      updatedAt: Utils.nowISO(),
      deadlineDate: data.deadlineDate ? String(data.deadlineDate).trim() : '',
      payments: []
    };
    if (data.prepayClient && Number(data.prepayClient) > 0) {
      job.payments.push({
        id: Utils.uuid(),
        direction: 'incoming',
        amount: Utils.round2(data.prepayClient),
        method: data.prepayClientMethod || 'Telda',
        date: Utils.todayISO(),
        note: 'Initial'
      });
    }
    _jobs.push(job);
    persist();
    return job;
  }

  function update(id, data) {
    const job = get(id);
    if (!job) return null;
    if ('jobName' in data) job.jobName = String(data.jobName).trim();
    if ('description' in data) job.description = String(data.description).trim();
    if ('clientName' in data) job.clientName = String(data.clientName).trim();
    if ('freelancers' in data) job.freelancers = data.freelancers.slice();
    if ('totalPay' in data) job.totalPay = Number(data.totalPay) || 0;
    if ('faresTechnicalPercent' in data) {
      job.faresTechnicalPercent = Utils.clamp(data.faresTechnicalPercent, 0, MAX_TECH_PERCENT);
    }
    if ('deadlineDate' in data) job.deadlineDate = data.deadlineDate ? String(data.deadlineDate).trim() : '';
    job.updatedAt = Utils.nowISO();
    persist();
    return job;
  }

  function remove(id) {
    const i = _jobs.findIndex(j => j.id === id);
    if (i === -1) return false;
    _jobs.splice(i, 1);
    persist();
    return true;
  }

  function addPayment(jobId, payment) {
    const job = get(jobId);
    if (!job) return null;
    const direction = payment.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const allowedMethods = direction === 'incoming' ? INCOMING_METHODS : OUTGOING_METHODS;
    const method = allowedMethods.includes(payment.method) ? payment.method : allowedMethods[0];
    const p = {
      id: Utils.uuid(),
      direction,
      amount: Utils.round2(Number(payment.amount) || 0),
      method,
      date: payment.date || Utils.todayISO(),
      note: String(payment.note || '').trim()
    };
    if (direction === 'outgoing') {
      const to = String(payment.to || '').trim();
      if (!to) return null;
      // freelancer must be on this job's roster
      if (!job.freelancers.includes(to)) return null;
      p.to = to;
    }
    if (p.amount <= 0) return null;
    job.payments.push(p);
    job.updatedAt = Utils.nowISO();
    persist();
    return p;
  }

  function removePayment(jobId, paymentId) {
    const job = get(jobId);
    if (!job) return false;
    const i = job.payments.findIndex(p => p.id === paymentId);
    if (i === -1) return false;
    job.payments.splice(i, 1);
    job.updatedAt = Utils.nowISO();
    persist();
    return true;
  }

  function compute(job) {
    const faresTechnicalPercent = Utils.clamp(job.faresTechnicalPercent, 0, MAX_TECH_PERCENT);
    const faresTotalPercent = BUSINESS_PERCENT + faresTechnicalPercent;
    const totalPay = Number(job.totalPay) || 0;
    const businessAmount = Utils.round2(totalPay * BUSINESS_PERCENT / 100);
    const technicalAmount = Utils.round2(totalPay * faresTechnicalPercent / 100);
    const faresShare = Utils.round2(totalPay * faresTotalPercent / 100);
    const freelancersTotalPercent = Math.max(0, 100 - faresTotalPercent);
    const freelancersTotalShare = Utils.round2(totalPay * freelancersTotalPercent / 100);
    const freelancerCount = job.freelancers.length;
    const freelancerPercent = freelancerCount > 0
      ? Utils.round2(freelancersTotalPercent / freelancerCount)
      : 0;
    const freelancerShare = freelancerCount > 0
      ? Utils.round2(freelancersTotalShare / freelancerCount)
      : 0;

    let cashIn = 0, cashOut = 0;
    const paidByFreelancer = {};
    const incomingByMethod = {};
    const outgoingByMethod = {};
    for (const name of job.freelancers) paidByFreelancer[name] = 0;

    for (const p of (job.payments || [])) {
      const amt = Number(p.amount) || 0;
      if (p.direction === 'incoming') {
        cashIn += amt;
        incomingByMethod[p.method] = (incomingByMethod[p.method] || 0) + amt;
      } else if (p.direction === 'outgoing') {
        cashOut += amt;
        outgoingByMethod[p.method] = (outgoingByMethod[p.method] || 0) + amt;
        if (p.to) paidByFreelancer[p.to] = (paidByFreelancer[p.to] || 0) + amt;
      }
    }
    cashIn = Utils.round2(cashIn);
    cashOut = Utils.round2(cashOut);

    const remainingFromClient = Utils.round2(totalPay - cashIn);
    const cashOnHand = Utils.round2(cashIn - cashOut);

    const faresReceived = cashOnHand; // cashIn - cashOut
    const faresRemaining = Utils.round2(faresShare - faresReceived);

    // Per-freelancer outstanding amounts
    const freelancerStats = job.freelancers.map(name => {
      const paid = Utils.round2(paidByFreelancer[name] || 0);
      const owedNow = Utils.round2(Math.max(0, freelancerShare - paid));
      const owedTotal = owedNow;
      return { name, percent: freelancerPercent, share: freelancerShare, paid, owedNow, owedTotal };
    });

    const owedToTeamNow = Utils.round2(freelancerStats.reduce((a, f) => a + f.owedNow, 0));
    const owedToTeamTotal = Utils.round2(freelancerStats.reduce((a, f) => a + Math.max(0, f.owedTotal), 0));

    let paymentStatus = 'unpaid';
    if (totalPay > 0 && cashIn >= totalPay) paymentStatus = 'paid';
    else if (cashIn > 0) paymentStatus = 'partial';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let daysToDeadline = null;
    let deadlineStatus = 'none';
    if (job.deadlineDate) {
      const [y, m, d] = job.deadlineDate.split('-').map(Number);
      const dl = new Date(y, m - 1, d);
      daysToDeadline = Math.round((dl - today) / 86400000);
      if (paymentStatus === 'paid') deadlineStatus = 'done';
      else if (daysToDeadline < 0) deadlineStatus = 'overdue';
      else if (daysToDeadline <= 7) deadlineStatus = 'due-soon';
      else deadlineStatus = 'ok';
    }

    return {
      ...job,
      businessAmount,
      technicalAmount,
      faresTotalPercent,
      faresShare,
      freelancersTotalPercent,
      freelancersTotalShare,
      freelancerPercent,
      freelancerShare,
      cashIn,
      cashOut,
      cashOnHand,
      remainingFromClient,
      faresReceived,
      faresRemaining,
      freelancerStats,
      owedToTeamNow,
      owedToTeamTotal,
      incomingByMethod,
      outgoingByMethod,
      paymentStatus,
      daysToDeadline,
      deadlineStatus
    };
  }

  function uniqueClients() {
    const set = new Set();
    for (const j of _jobs) if (j.clientName) set.add(j.clientName);
    return Array.from(set).sort();
  }

  function setAll(jobs) {
    _jobs = Array.isArray(jobs) ? jobs.slice() : [];
  }

  return {
    BUSINESS_PERCENT, MAX_TECH_PERCENT,
    INCOMING_METHODS, OUTGOING_METHODS,
    load, all, get, create, update, remove, setAll,
    addPayment, removePayment,
    compute, uniqueClients
  };
})();
