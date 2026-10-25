// Read-only client for the Trustworthy Bank APIs (Follow the Money challenge).
// Used only to REPORT status and results on WhatsApp. All claiming, deciding
// and filing is done inside Automation Anywhere by the FTM agent.
const axios = require('axios');
const config = require('../config');

function http() {
  return axios.create({
    baseURL: config.ftm.bankBase,
    headers: { 'X-API-Key': config.ftm.bankApiKey },
    timeout: 30000,
    validateStatus: () => true,
  });
}

async function get(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await http().get(path);
      return { status: r.status, data: r.data };
    } catch (err) {
      if (attempt === 2) return { status: 0, data: { error: err.message } };
    }
  }
}

async function probe(workId) {
  const a = await get(`/api-alert/${workId}`);
  if (a.status !== 200) return null;
  const inv = await get(`/api-investigation/${workId}`);
  const i = inv.status === 200 ? inv.data || {} : {};
  const alert = a.data.alert || {};
  const state = i.completed_at
    ? 'completed'
    : i.disposition
    ? 'filed_not_completed'
    : alert.assigned_at
    ? 'assigned'
    : 'new';
  return {
    workId,
    rule: alert.rule_code || '?',
    subject: (a.data.subject || {}).full_name || '?',
    state,
    disposition: i.disposition || null,
    completedAt: i.completed_at || null,
    narrative: i.narrative || '',
    accounts: (i.associated_accounts || []).length,
    individuals: (i.associated_individuals || []).length,
    businesses: (i.business_lookups || []).length,
  };
}

// Scan a work-id range with limited parallelism (same approach as FTM_Status).
async function scan() {
  const [lo, hi] = config.ftm.scanRange;
  const ids = [];
  for (let i = lo; i <= hi; i++) ids.push(i);
  const found = [];
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      const r = await probe(id);
      if (r) found.push(r);
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
  found.sort((x, y) => x.workId - y.workId);
  const counts = { new: 0, assigned: 0, filed_not_completed: 0, completed: 0 };
  for (const r of found) counts[r.state]++;
  return { cases: found, counts };
}

module.exports = { probe, scan };
