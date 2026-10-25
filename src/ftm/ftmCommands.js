// WhatsApp commands for the Follow the Money AML bot.
// Only phone numbers listed in FTM_ADMIN_PHONES can use them; every other
// message carries on to the normal lead agent.
const config = require('../config');
const whatsapp = require('../whatsappClient');
const bank = require('./bankClient');
const aa = require('./aaClient');

const STANDARD = 'Process all alerts (standard run). Claim every new alert, investigate, file and complete every open case, then report.';

// FAST RUN: the server already scanned the bank, so the agent skips its own status check.
function fastInstruction(cases) {
  const ids = cases.map((c) => c.workId);
  const claim = cases.some((c) => c.state === 'new') ? 'yes' : 'no';
  return `FAST RUN work ids: ${ids.join(',')}. claim: ${claim}. Investigate, file and complete every listed case, then report.`;
}

let running = null; // { startedAt, ids, attempt, lastChangeAt, lastSig, phase, cancelled }
let lastResult = null;
let lastNewSig = '';

const COMMANDS = {
  help: /^(help|menu|\?)$/i,
  status: /^(status|alerts)$/i,
  process: /^(process|process all|run|go)$/i,
  result: /^(result|results|last|report)$/i,
  cancel: /^(cancel|stop|reset run)$/i,
};

const isAdmin = (phone) => config.ftm.adminPhones.includes(String(phone));
const match = (text) => Object.keys(COMMANDS).find((k) => COMMANDS[k].test(String(text || '').trim())) || null;
const mins = (ms) => `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;

async function notifyAdmins(msg) {
  for (const phone of config.ftm.adminPhones) {
    await whatsapp
      .sendTextMessage(phone, msg)
      .then(() => console.log(`[ftm] sent to ${phone}: ${msg.split('\n')[0]}`))
      .catch((e) => console.warn('[ftm] send failed (24h window closed?)', e.response?.data?.error?.message || e.message));
  }
}

// Returns true if the message was an FTM command (so the lead agent skips it).
async function handle(from, text) {
  if (!config.ftm.enabled || !isAdmin(from)) return false;
  // Any other message from an admin number gets the status plus the command list,
  // so "hi" (or any text after deleting the chat) is enough to get going.
  const cmd = match(text) || 'menu';
  const reply = (msg) =>
    whatsapp.sendTextMessage(from, msg).then(() => console.log(`[ftm] replied ${cmd}: ${msg.split('\n')[0]}`));
  try {
    if (cmd === 'help') await reply(helpText());
    if (cmd === 'menu') await reply((await statusText()) + '\n\n' + helpText());
    if (cmd === 'status') await reply(await statusText());
    if (cmd === 'result') await reply(lastResult || 'No run finished yet. Send PROCESS to start one.');
    if (cmd === 'process') await startProcess(reply);
    if (cmd === 'cancel') await cancel(reply);
  } catch (err) {
    console.error('[ftm] command failed', err);
    await reply(`Something went wrong: ${err.message}`.slice(0, 900));
  }
  return true;
}

function helpText() {
  return [
    '*Follow the Money bot*',
    'STATUS: alert counts, and progress if a run is going',
    'PROCESS: claim, investigate, file and complete every open alert (about 3 min)',
    'RESULT: the last run report',
    'CANCEL: stop waiting on the current run (unlocks PROCESS)',
  ].join('\n');
}

function caseLines(cases) {
  return cases.map((c) => `#${c.workId} ${c.rule} ${c.subject}: ${c.state}${c.disposition ? ` (${c.disposition})` : ''}`);
}

async function statusText(scan) {
  const { cases, counts } = scan || (await bank.scan());
  const lines = ['*Alert status*'];
  if (running) {
    const mine = cases.filter((c) => running.ids.includes(c.workId));
    const done = mine.filter((c) => c.state === 'completed').length;
    lines.push(
      `RUN IN PROGRESS: ${mins(Date.now() - running.startedAt)} so far, attempt ${running.attempt}, ${done} of ${running.ids.length} completed.`,
      `Last progress ${mins(Date.now() - running.lastChangeAt)} ago. I restart automatically after ${config.ftm.stallMin} min without progress. Send CANCEL to unlock.`
    );
  }
  lines.push(
    `New: ${counts.new} | Assigned: ${counts.assigned} | Filed, not completed: ${counts.filed_not_completed} | Completed: ${counts.completed}`,
    '',
    ...caseLines(cases)
  );
  const open = counts.new + counts.assigned + counts.filed_not_completed;
  if (!running) lines.push('', open ? `${open} to process. Reply PROCESS to run them.` : 'Nothing to process.');
  return lines.join('\n');
}

async function startProcess(reply) {
  if (running) {
    return reply(`A run is already going (${mins(Date.now() - running.startedAt)}). Send STATUS for progress or CANCEL to unlock.`);
  }
  const before = await bank.scan();
  const ids = before.cases.filter((c) => c.state !== 'completed').map((c) => c.workId);
  if (!ids.length) return reply('Nothing to process. All alerts are completed.');

  const open = before.cases.filter((c) => c.state !== 'completed');
  await aa.startRun(fastInstruction(open));
  const now = Date.now();
  running = { startedAt: now, ids, attempt: 1, lastChangeAt: now, lastSig: sig(before.cases, ids), cancelled: false };
  await reply(`Started the AA agent on ${ids.length} alerts: ${ids.map((i) => '#' + i).join(', ')}.\nIt takes about 5 minutes. I will send the results here.`);
  watch(reply).catch((err) => console.error('[ftm] watch failed', err));
}

async function cancel(reply) {
  if (!running) return reply('No run is in progress.');
  running.cancelled = true;
  running = null;
  await reply('Stopped waiting on the current run. PROCESS is unlocked. (Anything AA already filed stays filed.)');
}

// progress signature: the state of every case in this run
const sig = (cases, ids) => ids.map((id) => `${id}:${(cases.find((c) => c.workId === id) || {}).state}`).join(',');

// Polls the bank until every case is completed. Restarts the AA run when it stalls.
async function watch(reply) {
  const run = running;
  const deadline = run.startedAt + config.ftm.runTimeoutMin * 60000;
  let cases = [];
  while (!run.cancelled && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20000));
    if (run.cancelled) return;
    cases = (await Promise.all(run.ids.map((id) => bank.probe(id)))).filter(Boolean);
    if (cases.length && cases.every((c) => c.state === 'completed')) break;

    const s = sig(cases, run.ids);
    if (s !== run.lastSig) {
      run.lastSig = s;
      run.lastChangeAt = Date.now();
    } else if (Date.now() - run.lastChangeAt > config.ftm.stallMin * 60000 && run.attempt < config.ftm.maxAttempts) {
      run.attempt++;
      run.lastChangeAt = Date.now();
      const left = cases.filter((c) => c.state !== 'completed').length;
      console.warn(`[ftm] no progress for ${config.ftm.stallMin} min, restarting (attempt ${run.attempt})`);
      try {
        await aa.startRun(fastInstruction(cases.filter((c) => c.state !== 'completed')));
        await reply(`AA got stuck (no progress for ${config.ftm.stallMin} min). Started a fresh run for the ${left} unfinished case(s), attempt ${run.attempt}.`);
      } catch (err) {
        await reply(`AA got stuck and the restart failed: ${err.message}`.slice(0, 900));
      }
    }
  }
  if (run.cancelled) return;
  if (running === run) running = null;

  const secs = Date.now() - run.startedAt;
  const done = cases.filter((c) => c.state === 'completed').length;
  const lines = [
    `*FTM run finished in ${mins(secs)}*${run.attempt > 1 ? ` (${run.attempt} attempts)` : ''}`,
    `${done} of ${run.ids.length} completed${done < run.ids.length ? '. Send PROCESS to retry the rest.' : ''}`,
    '',
  ];
  for (const c of cases) {
    lines.push(
      `#${c.workId} ${c.rule} *${c.subject}*: ${String(c.disposition || 'not filed').toUpperCase()}`,
      `Filed: ${c.disposition ? 'yes' : 'no'} | Completed: ${c.state === 'completed' ? 'yes' : 'no'} | ${c.accounts} accounts, ${c.individuals} people, ${c.businesses} businesses`,
      c.narrative ? `${c.narrative.slice(0, 280)}${c.narrative.length > 280 ? '...' : ''}` : '',
      ''
    );
  }
  lastResult = lines.join('\n').slice(0, 4000);
  await reply(lastResult);
}

// Sends the status to admins when new alerts appear (including after a bank reset).
// Called every few seconds: a quick check of known ids, plus a full range scan every few minutes.
let lastFullScan = 0;
let checking = false;
async function checkForNewAlerts() {
  if (!config.ftm.enabled || running || checking) return;
  checking = true;
  const t0 = Date.now();
  try {
    const full = Date.now() - lastFullScan > config.ftm.fullScanMin * 60000;
    const scan = full ? await bank.scan() : await bank.quick();
    if (full) {
      lastFullScan = Date.now();
      console.log(`[ftm] full scan ${scan.cases.length} alerts in ${Date.now() - t0} ms`);
    }
    const newIds = scan.cases.filter((c) => c.state === 'new').map((c) => c.workId);
    const s = newIds.join(',');
    if (newIds.length && s !== lastNewSig) {
      await notifyAdmins(`*${newIds.length} new AML case${newIds.length > 1 ? 's' : ''}*\n\n` + (await statusText(scan)));
    }
    lastNewSig = s;
  } catch (err) {
    console.error('[ftm] new-alert check failed', err.message);
  } finally {
    checking = false;
  }
}

module.exports = { handle, checkForNewAlerts };
