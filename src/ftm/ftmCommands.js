// WhatsApp commands for the Follow the Money AML bot.
// Only phone numbers listed in FTM_ADMIN_PHONES can use them; every other
// message carries on to the normal lead agent.
const config = require('../config');
const whatsapp = require('../whatsappClient');
const bank = require('./bankClient');
const aa = require('./aaClient');

const STANDARD = 'Process all alerts (standard run). Claim every new alert, investigate, file and complete every open case, then report.';
const STATUS_ONLY = 'STATUS only. Report counts of new, assigned and completed alerts. Do not claim or file anything.';

let running = null; // { startedAt, ids }
let lastResult = null;
let lastNewCount = 0;

const COMMANDS = {
  help: /^(help|menu|\?)$/i,
  status: /^(status|alerts)$/i,
  process: /^(process|process all|run|go)$/i,
  result: /^(result|results|last|report)$/i,
};

function isAdmin(phone) {
  return config.ftm.adminPhones.includes(String(phone));
}

function match(text) {
  const t = String(text || '').trim();
  return Object.keys(COMMANDS).find((k) => COMMANDS[k].test(t)) || null;
}

// Returns true if the message was an FTM command (so the lead agent skips it).
async function handle(from, text) {
  if (!config.ftm.enabled || !isAdmin(from)) return false;
  const cmd = match(text);
  if (!cmd) return false;
  const reply = (msg) => whatsapp.sendTextMessage(from, msg);
  try {
    if (cmd === 'help') await reply(helpText());
    if (cmd === 'status') await reply(statusText(await bank.scan()));
    if (cmd === 'result') await reply(lastResult || 'No run finished yet. Send PROCESS to start one.');
    if (cmd === 'process') await startProcess(reply);
  } catch (err) {
    console.error('[ftm] command failed', err);
    await reply(`Something went wrong: ${err.message}`.slice(0, 900));
  }
  return true;
}

function helpText() {
  return [
    '*Follow the Money bot*',
    'STATUS: counts of new, assigned and completed alerts',
    'PROCESS: claim, investigate, file and complete every open alert (about 5 min)',
    'RESULT: the last run report',
  ].join('\n');
}

function statusText({ cases, counts }) {
  const lines = [
    '*Alert status*',
    `New: ${counts.new} | Assigned: ${counts.assigned} | Filed, not completed: ${counts.filed_not_completed} | Completed: ${counts.completed}`,
    '',
  ];
  for (const c of cases) {
    lines.push(`#${c.workId} ${c.rule} ${c.subject}: ${c.state}${c.disposition ? ` (${c.disposition})` : ''}`);
  }
  const open = counts.new + counts.assigned + counts.filed_not_completed;
  lines.push('', open ? `${open} to process. Reply PROCESS to run them.` : 'Nothing to process.');
  return lines.join('\n');
}

async function startProcess(reply) {
  if (running) {
    const mins = Math.round((Date.now() - running.startedAt) / 60000);
    return reply(`A run is already going (started ${mins} min ago). I will message you when it finishes.`);
  }
  const before = await bank.scan();
  const ids = before.cases.filter((c) => c.state !== 'completed').map((c) => c.workId);
  if (!ids.length) return reply('Nothing to process. All alerts are completed.');

  const req = await aa.startRun(STANDARD);
  running = { startedAt: Date.now(), ids };
  await reply(`Started the AA agent on ${ids.length} alerts: ${ids.map((i) => '#' + i).join(', ')}.\nIt takes about 5 minutes. I will send the results here.${req?.reference ? `\nAA ref: ${req.reference}` : ''}`);

  watch(reply).catch((err) => console.error('[ftm] watch failed', err));
}

// Polls the bank until every case from the run is completed (or time runs out).
async function watch(reply) {
  const { startedAt, ids } = running;
  const deadline = startedAt + config.ftm.runTimeoutMin * 60000;
  let cases = [];
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20000));
      cases = (await Promise.all(ids.map((id) => bank.probe(id)))).filter(Boolean);
      if (cases.length && cases.every((c) => c.state === 'completed')) break;
    }
  } finally {
    running = null;
  }
  const secs = Math.round((Date.now() - startedAt) / 1000);
  const done = cases.filter((c) => c.state === 'completed').length;
  const lines = [
    `*FTM run finished in ${Math.floor(secs / 60)}m ${secs % 60}s*`,
    `${done} of ${ids.length} completed${done < ids.length ? ' (check AA Activity for the rest)' : ''}`,
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

// Optional: tell admins when new alerts show up.
async function checkForNewAlerts() {
  if (!config.ftm.enabled || running) return;
  try {
    const { counts } = await bank.scan();
    if (counts.new > 0 && counts.new !== lastNewCount) {
      for (const phone of config.ftm.adminPhones) {
        await whatsapp
          .sendTextMessage(phone, `${counts.new} new AML alert(s) waiting. Reply PROCESS to run them or STATUS for details.`)
          .catch((e) => console.warn('[ftm] alert notify failed (24h window closed?)', e.response?.data?.error?.message || e.message));
      }
    }
    lastNewCount = counts.new;
  } catch (err) {
    console.error('[ftm] new-alert check failed', err.message);
  }
}

module.exports = { handle, checkForNewAlerts, STATUS_ONLY };
