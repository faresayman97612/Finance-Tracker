/* jobs.js — job model + computed derived fields + CRUD */

const Jobs = (function () {
  const BUSINESS_PERCENT = 40;
  const MAX_TECH_PERCENT = 60;

  // Payment methods (kept here so other modules can read them)
  const INCOMING_METHODS = ['Telda', 'Instapay', 'Binance', 'VodafoneCash'];
  const OUTGOING_METHODS = ['Telda', 'Instapay', 'VodafoneCash', 'Cash'];

  const STAGES = ['lead', 'proposal', 'accepted', 'in-progress', 'review', 'delivered', 'paid', 'closed'];
  const STAGE_LABELS = {
    'lead':        'Lead',
    'proposal':    'Proposal',
    'accepted':    'Accepted',
    'in-progress': 'In Progress',
    'review':      'Review',
    'delivered':   'Delivered',
    'paid':        'Paid',
    'closed':      'Closed'
  };

  const TASK_STATUSES = ['todo', 'doing', 'done'];

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

  function normalizeStage(s) {
    return STAGES.includes(s) ? s : 'in-progress';
  }

  function deriveWorkStatus(stage) {
    return (stage === 'delivered' || stage === 'paid' || stage === 'closed') ? 'delivered' : 'in-progress';
  }

  function makeActivity(type, message) {
    return { id: Utils.uuid(), ts: Utils.nowISO(), type, message: String(message || '') };
  }

  function pushActivity(job, type, message) {
    if (!Array.isArray(job.activity)) job.activity = [];
    job.activity.push(makeActivity(type, message));
  }

  function sanitizeTask(raw, defaults) {
    const t = {
      id: raw.id || Utils.uuid(),
      title: String(raw.title || '').trim(),
      assignee: raw.assignee || 'fares',
      status: TASK_STATUSES.includes(raw.status) ? raw.status : 'todo',
      dueDate: raw.dueDate ? String(raw.dueDate).trim() : '',
      valueType: ['percent', 'fixed', 'none'].includes(raw.valueType) ? raw.valueType : 'none',
      value: Number(raw.value) || 0,
      notes: String(raw.notes || '').trim(),
      createdAt: raw.createdAt || (defaults && defaults.createdAt) || Utils.nowISO(),
      completedAt: raw.completedAt || null
    };
    if (t.valueType === 'none') t.value = 0;
    if (t.status === 'done' && !t.completedAt) t.completedAt = Utils.nowISO();
    if (t.status !== 'done') t.completedAt = null;
    return t;
  }

  function create(data) {
    const stage = normalizeStage(data.stage || (data.workStatus === 'delivered' ? 'delivered' : 'in-progress'));
    const tasks = Array.isArray(data.tasks) ? data.tasks.map(t => sanitizeTask(t)) : [];
    const job = {
      id: Utils.uuid(),
      jobName: String(data.jobName || '').trim(),
      description: String(data.description || '').trim(),
      clientName: String(data.clientName || '').trim(),
      freelancers: Array.isArray(data.freelancers) ? data.freelancers.slice() : [],
      totalPay: Number(data.totalPay) || 0,
      faresTechnicalPercent: Utils.clamp(data.faresTechnicalPercent ?? 0, 0, MAX_TECH_PERCENT),
      status: 'active',
      stage,
      workStatus: deriveWorkStatus(stage),
      tasks,
      activity: [],
      createdAt: Utils.nowISO(),
      updatedAt: Utils.nowISO(),
      deadlineDate: data.deadlineDate ? String(data.deadlineDate).trim() : '',
      payments: [],
      schemaVersion: Storage.SCHEMA_VERSION
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
      pushActivity(job, 'payment', `Initial incoming ${Utils.round2(data.prepayClient)} via ${data.prepayClientMethod || 'Telda'}`);
    }
    pushActivity(job, 'stage', `Job created at stage "${STAGE_LABELS[stage]}"`);
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

    let stageChanged = false;
    if ('stage' in data) {
      const next = normalizeStage(data.stage);
      if (next !== job.stage) {
        pushActivity(job, 'stage', `Stage: ${STAGE_LABELS[job.stage] || job.stage} → ${STAGE_LABELS[next]}`);
        job.stage = next;
        stageChanged = true;
      }
    } else if ('workStatus' in data) {
      const next = data.workStatus === 'delivered' ? 'delivered' : 'in-progress';
      if (next !== job.stage && (next === 'delivered' || next === 'in-progress')) {
        pushActivity(job, 'stage', `Stage: ${STAGE_LABELS[job.stage] || job.stage} → ${STAGE_LABELS[next]}`);
        job.stage = next;
        stageChanged = true;
      }
    }
    job.workStatus = deriveWorkStatus(job.stage);

    if ('tasks' in data) {
      replaceTasks(job, Array.isArray(data.tasks) ? data.tasks : []);
    }

    job.updatedAt = Utils.nowISO();
    persist();
    return job;
  }

  function replaceTasks(job, nextTasks) {
    const prevById = new Map((job.tasks || []).map(t => [t.id, t]));
    const next = nextTasks.map(t => sanitizeTask(t));
    const nextById = new Map(next.map(t => [t.id, t]));

    // Detect added / removed / changed
    for (const t of next) {
      const prev = prevById.get(t.id);
      if (!prev) {
        pushActivity(job, 'task', `Task added: "${t.title || '(untitled)'}"`);
      } else if (prev.status !== t.status) {
        pushActivity(job, 'task', `Task "${t.title || prev.title}" → ${t.status}`);
      } else if (prev.title !== t.title || prev.assignee !== t.assignee || prev.valueType !== t.valueType || prev.value !== t.value || prev.dueDate !== t.dueDate) {
        pushActivity(job, 'task', `Task updated: "${t.title || prev.title}"`);
      }
    }
    for (const [id, prev] of prevById) {
      if (!nextById.has(id)) {
        pushActivity(job, 'task', `Task removed: "${prev.title || '(untitled)'}"`);
      }
    }

    job.tasks = next;
  }

  function setStage(jobId, stage) {
    return update(jobId, { stage });
  }

  function addTask(jobId, taskData) {
    const job = get(jobId);
    if (!job) return null;
    const t = sanitizeTask({ ...taskData, id: taskData.id || Utils.uuid() });
    if (!Array.isArray(job.tasks)) job.tasks = [];
    job.tasks.push(t);
    pushActivity(job, 'task', `Task added: "${t.title || '(untitled)'}"`);
    job.updatedAt = Utils.nowISO();
    persist();
    return t;
  }

  function updateTask(jobId, taskId, patch) {
    const job = get(jobId);
    if (!job) return null;
    const i = (job.tasks || []).findIndex(t => t.id === taskId);
    if (i === -1) return null;
    const prev = job.tasks[i];
    const next = sanitizeTask({ ...prev, ...patch, id: prev.id, createdAt: prev.createdAt });
    job.tasks[i] = next;
    if (prev.status !== next.status) {
      pushActivity(job, 'task', `Task "${next.title || prev.title}" → ${next.status}`);
    } else {
      pushActivity(job, 'task', `Task updated: "${next.title || prev.title}"`);
    }
    job.updatedAt = Utils.nowISO();
    persist();
    return next;
  }

  function removeTask(jobId, taskId) {
    const job = get(jobId);
    if (!job) return false;
    const i = (job.tasks || []).findIndex(t => t.id === taskId);
    if (i === -1) return false;
    const removed = job.tasks[i];
    job.tasks.splice(i, 1);
    pushActivity(job, 'task', `Task removed: "${removed.title || '(untitled)'}"`);
    job.updatedAt = Utils.nowISO();
    persist();
    return true;
  }

  function addActivityNote(jobId, message) {
    const job = get(jobId);
    if (!job) return null;
    const trimmed = String(message || '').trim();
    if (!trimmed) return null;
    pushActivity(job, 'note', trimmed);
    job.updatedAt = Utils.nowISO();
    persist();
    return job.activity[job.activity.length - 1];
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
      // Snapshot the display name in case the freelancer is later renamed/removed
      const ref = Storage.getFreelancer(to);
      if (ref && ref.name) p.toName = ref.name;
    }
    if (p.amount <= 0) return null;
    job.payments.push(p);
    job.updatedAt = Utils.nowISO();
    if (direction === 'incoming') {
      pushActivity(job, 'payment', `Incoming ${p.amount} via ${p.method}${p.note ? ' — ' + p.note : ''}`);
    } else {
      const name = (Storage.getFreelancerName(p.to) || p.toName || '');
      pushActivity(job, 'payment', `Outgoing ${p.amount} → ${name}${p.note ? ' (' + p.note + ')' : ''}`);
    }
    persist();
    return p;
  }

  function removePayment(jobId, paymentId) {
    const job = get(jobId);
    if (!job) return false;
    const i = job.payments.findIndex(p => p.id === paymentId);
    if (i === -1) return false;
    const removed = job.payments[i];
    job.payments.splice(i, 1);
    job.updatedAt = Utils.nowISO();
    pushActivity(job, 'payment', `Payment removed (${removed.direction} ${removed.amount})`);
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
    const freelancerIds = Array.isArray(job.freelancers) ? job.freelancers.slice() : [];
    const freelancerCount = freelancerIds.length;

    const warnings = [];
    const tasks = Array.isArray(job.tasks) ? job.tasks : [];

    // Build task allocations per freelancer id (skip 'fares' and 'none')
    const taskAssigned = {};
    const taskCounts = {}; // {id: {todo, doing, done}}
    for (const id of freelancerIds) {
      taskAssigned[id] = 0;
      taskCounts[id] = { todo: 0, doing: 0, done: 0 };
    }
    // Also collect counts for 'fares' and any orphan assignees so UI can surface them
    taskCounts.fares = { todo: 0, doing: 0, done: 0 };

    for (const t of tasks) {
      const counter = taskCounts[t.assignee] || (taskCounts[t.assignee] = { todo: 0, doing: 0, done: 0 });
      counter[t.status] = (counter[t.status] || 0) + 1;

      if (t.assignee === 'fares' || t.valueType === 'none') continue;
      // Only count toward payouts if assignee is on the job roster
      if (!(t.assignee in taskAssigned)) continue;
      const amt = t.valueType === 'percent'
        ? Utils.round2(totalPay * (Number(t.value) || 0) / 100)
        : Utils.round2(Number(t.value) || 0);
      if (amt > 0) taskAssigned[t.assignee] = Utils.round2(taskAssigned[t.assignee] + amt);
    }

    const taskTotal = Utils.round2(Object.values(taskAssigned).reduce((s, n) => s + n, 0));
    if (taskTotal > freelancersTotalShare + 0.005) {
      warnings.push('task-allocation-exceeds-team-share');
    }

    // Equal-split fallback for freelancers without a task allocation
    const remainingTeamShare = Utils.round2(Math.max(0, freelancersTotalShare - taskTotal));
    const freelancersWithoutTask = freelancerIds.filter(id => (taskAssigned[id] || 0) === 0);
    const equalSplitShare = freelancersWithoutTask.length > 0
      ? Utils.round2(remainingTeamShare / freelancersWithoutTask.length)
      : 0;

    // Compute payments aggregates
    let cashIn = 0, cashOut = 0;
    const paidByFreelancer = {};
    const incomingByMethod = {};
    const outgoingByMethod = {};
    for (const id of freelancerIds) paidByFreelancer[id] = 0;

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

    // Per-freelancer stats keyed by id, with display name resolved
    const freelancerStats = freelancerIds.map(id => {
      const taskShare = Utils.round2(taskAssigned[id] || 0);
      const equalShare = taskShare > 0 ? 0 : equalSplitShare;
      const share = Utils.round2(taskShare + equalShare);
      const percent = totalPay > 0 ? Utils.round2(share / totalPay * 100) : 0;
      const paid = Utils.round2(paidByFreelancer[id] || 0);
      const owedNow = Utils.round2(Math.max(0, share - paid));
      const ref = Storage.getFreelancer(id);
      const name = ref ? (ref.name || '(unnamed)') : '(removed)';
      const counts = taskCounts[id] || { todo: 0, doing: 0, done: 0 };
      return {
        id, name,
        percent, share, taskShare, equalShare,
        paid, owedNow, owedTotal: owedNow,
        tasks: counts,
        active: ref ? ref.active !== false : false
      };
    });

    const owedToTeamNow = Utils.round2(freelancerStats.reduce((a, f) => a + f.owedNow, 0));
    const owedToTeamTotal = owedToTeamNow;

    let paymentStatus = 'unpaid';
    if (totalPay > 0 && cashIn >= totalPay) paymentStatus = 'paid';
    else if (cashIn > 0) paymentStatus = 'partial';

    const stage = normalizeStage(job.stage || (job.workStatus === 'delivered' ? 'delivered' : 'in-progress'));
    const workStatus = deriveWorkStatus(stage);

    // Deadline status
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let daysToDeadline = null;
    let deadlineStatus = 'none';
    const deliveredLike = stage === 'delivered' || stage === 'review' || stage === 'paid' || stage === 'closed';
    if (paymentStatus === 'paid') {
      deadlineStatus = 'done';
    } else if (deliveredLike) {
      deadlineStatus = 'awaiting-payment';
    } else if (job.deadlineDate) {
      const [y, m, d] = job.deadlineDate.split('-').map(Number);
      const dl = new Date(y, m - 1, d);
      daysToDeadline = Math.round((dl - today) / 86400000);
      if (daysToDeadline < 0) deadlineStatus = 'overdue';
      else if (daysToDeadline <= 7) deadlineStatus = 'due-soon';
      else deadlineStatus = 'ok';
    }
    if (job.deadlineDate && deadlineStatus === 'awaiting-payment') {
      const [y, m, d] = job.deadlineDate.split('-').map(Number);
      const dl = new Date(y, m - 1, d);
      daysToDeadline = Math.round((dl - today) / 86400000);
    }

    // Task-due aggregates
    const TASK_DUE_THRESHOLD = 7;
    const taskAgg = { total: tasks.length, todo: 0, doing: 0, done: 0, overdue: 0, dueSoon: 0 };
    for (const t of tasks) {
      taskAgg[t.status] = (taskAgg[t.status] || 0) + 1;
      if (t.status === 'done') continue;
      if (!t.dueDate) continue;
      const [y, m, d] = t.dueDate.split('-').map(Number);
      const dl = new Date(y, m - 1, d);
      const diff = Math.round((dl - today) / 86400000);
      if (diff < 0) taskAgg.overdue++;
      else if (diff <= TASK_DUE_THRESHOLD) taskAgg.dueSoon++;
    }

    return {
      ...job,
      businessAmount,
      technicalAmount,
      faresTotalPercent,
      faresShare,
      freelancersTotalPercent,
      freelancersTotalShare,
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
      stage,
      stageLabel: STAGE_LABELS[stage] || stage,
      workStatus,
      daysToDeadline,
      deadlineStatus,
      taskAgg,
      warnings
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
    STAGES, STAGE_LABELS, TASK_STATUSES,
    load, all, get, create, update, remove, setAll,
    addPayment, removePayment,
    addTask, updateTask, removeTask, setStage, addActivityNote,
    compute, uniqueClients
  };
})();
