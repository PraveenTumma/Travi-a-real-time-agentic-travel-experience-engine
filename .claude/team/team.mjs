#!/usr/bin/env node
/**
 * Team Sync: keeps every teammate's Claude Code session aware of the others.
 *
 * Shared state lives on the orphan branch `team-sync` (never merged into main):
 *   status/<member>.json   what each person is doing, their branch, files they're editing
 *   tasks/T-###.json       delegated work: assignee, state, notes
 *   log/<member>.jsonl     append-only activity notes
 * It is written with git plumbing (temp index + commit-tree + push), so it never
 * touches your working tree or index, can't conflict with code, and doesn't
 * trigger the Vercel/Render deploys that watch `main`.
 *
 * Commands (run from the repo root):
 *   brief                                   team briefing (fetches first)
 *   sync                                    fetch, fast-forward if safe, show what's new
 *   status "<doing>" [--files a,b]          publish what you're working on
 *   idle [--note ".."]                      you're done / stepping away
 *   task add "<title>" [--to <member|any>] [--details ".."] [--priority P0|P1|P2]
 *   task claim|start|done|block|reopen <T-id> [--note ".."]
 *   task assign <T-id> --to <member>
 *   task note <T-id> "<text>"
 *   tasks [--all]                           list tasks
 *   log "<message>"                         broadcast a note to the team
 *   whoami | setup <member>                 show / pin who you are on this clone
 * Hook entry points (wired in .claude/settings.json): hook-session-start, hook-prompt
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT);
const REMOTE = process.env.TEAM_SYNC_REMOTE || 'origin';
const BRANCH = process.env.TEAM_SYNC_BRANCH || 'team-sync';
const TEAM_REF = `refs/remotes/${REMOTE}/${BRANCH}`;
const MAIN_REF = `refs/remotes/${REMOTE}/main`;
const FETCH_EVERY_MS = 60 * 1000;
const HEARTBEAT_EVERY_MS = 5 * 60 * 1000;
const OFFLINE_AFTER_MS = 20 * 60 * 1000;
const PUSH_NUDGE_AFTER_MS = 15 * 60 * 1000;

const ROSTER = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'members.json'), 'utf8')).members;
const IDS = ROSTER.map((m) => m.id);
const short = (id) => ROSTER.find((m) => m.id === id)?.short || id;

// ---------------------------------------------------------------- helpers

function run(cmd, args, { cwd, input, env, timeout = 30000 } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    input,
    timeout,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    // No credential prompts from hooks; no optional index locks that could collide with Claude's own git commands.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_OPTIONAL_LOCKS: '0', ...env },
  });
  const stdout = r.stdout || Buffer.alloc(0);
  return {
    ok: !r.error && r.status === 0,
    buf: stdout,
    out: stdout.toString('utf8').trim(),
    err: r.error ? r.error.message : (r.stderr || '').toString('utf8').trim(),
  };
}

// Each git spawn costs ~60ms on Windows, so the per-prompt hook avoids and batches git calls.
// This file lives at <repo>/.claude/team/, so the repo root is two levels up (a worktree has a .git file instead).
const [ROOT, COMMON_DIR] = (() => {
  const root = path.resolve(SCRIPT_DIR, '..', '..');
  try {
    if (fs.statSync(path.join(root, '.git')).isDirectory()) return [root, path.join(root, '.git')];
  } catch { /* not a plain checkout */ }
  return run('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], { cwd: SCRIPT_DIR }).out.split('\n');
})();
if (!ROOT) process.exit(0);

function git(args, opts = {}) {
  const r = run('git', args, { cwd: ROOT, ...opts });
  if (!r.ok && !opts.allowFail) throw new Error(`git ${args[0]} failed: ${r.err.split('\n')[0]}`);
  return r;
}

const CONFIG = {};
for (const line of git(['config', '--get-regexp', '^(user\\.name|user\\.email|team\\.member|remote\\..*\\.fetch)$'], { allowFail: true }).out.split('\n')) {
  const space = line.indexOf(' ');
  if (space > 0) (CONFIG[line.slice(0, space)] ||= []).push(line.slice(space + 1));
}
// --get-regexp lists every level (system, global, local); the last value is the effective one.
const gitConfig = (key) => (CONFIG[key] || []).at(-1) || '';

const GIT_DIR = path.resolve(SCRIPT_DIR, COMMON_DIR);
const STATE_DIR = path.join(GIT_DIR, 'team-sync');
fs.mkdirSync(STATE_DIR, { recursive: true });
const SEEN_FILE = path.join(STATE_DIR, 'seen.json'); // written by hooks only
const BG_FILE = path.join(STATE_DIR, 'bg.json'); // written by background refresh only
const LOCK_FILE = path.join(STATE_DIR, 'bg.lock');

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
};
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const toJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const nowIso = () => new Date().toISOString();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const indent = (text) => text.split('\n').filter(Boolean).map((l) => `    ${l}`).join('\n');

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function fail(message) {
  console.error(`team-sync: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- identity

function whoami() {
  const pinned = (process.env.TEAM_MEMBER || gitConfig('team.member')).toLowerCase();
  if (IDS.includes(pinned)) return pinned;
  const tokens = `${gitConfig('user.name')} ${gitConfig('user.email')}`.toLowerCase().split(/[^a-z0-9]+/);
  const hits = ROSTER.filter((m) => (m.match || []).some((t) => tokens.includes(t)));
  return hits.length === 1 ? hits[0].id : null;
}

function identityEnv(me) {
  const member = ROSTER.find((m) => m.id === me);
  const name = gitConfig('user.name') || member?.name || 'team-sync';
  const email = gitConfig('user.email') || `${me || 'team'}@users.noreply.github.com`;
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

// ---------------------------------------------------------------- reading shared state

const refSha = (ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true }).out || null;

function catBlobs(shas) {
  const out = new Map();
  if (!shas.length) return out;
  const buf = git(['cat-file', '--batch'], { input: `${shas.join('\n')}\n` }).buf;
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const [sha, type, size] = buf.subarray(pos, nl).toString('utf8').split(' ');
    if (type === 'missing') { pos = nl + 1; continue; }
    const end = nl + 1 + Number(size);
    out.set(sha, buf.subarray(nl + 1, end).toString('utf8'));
    pos = end + 1;
  }
  return out;
}

function readTeam(sha = refSha(TEAM_REF)) {
  const team = { sha, files: {}, status: {}, tasks: {}, log: [] };
  if (!team.sha) return team;
  const entries = git(['ls-tree', '-r', '-z', team.sha]).buf.toString('utf8').split('\0').filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { sha: line.slice(0, tab).split(' ')[2], path: line.slice(tab + 1) };
    });
  const blobs = catBlobs([...new Set(entries.map((e) => e.sha))]);
  for (const { sha, path: p } of entries) {
    const text = blobs.get(sha) ?? '';
    team.files[p] = text;
    try {
      if (/^status\/[\w-]+\.json$/.test(p)) {
        const s = JSON.parse(text);
        team.status[s.member] = s;
      } else if (/^tasks\/T-\d+\.json$/.test(p)) {
        const t = JSON.parse(text);
        team.tasks[t.id] = t;
      } else if (/^log\/[\w-]+\.jsonl$/.test(p)) {
        team.log.push(...text.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
      }
    } catch { /* a malformed file must not break everyone's session */ }
  }
  team.log.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return team;
}

// ---------------------------------------------------------------- writing shared state

const fetchTeam = () => git(
  ['fetch', '--quiet', '--no-tags', REMOTE, `+refs/heads/${BRANCH}:${TEAM_REF}`],
  { allowFail: true, timeout: 20000 },
);

function fetchAll() {
  const refspecs = (CONFIG[`remote.${REMOTE}.fetch`] || []).join(' ');
  git(['fetch', '--quiet', '--no-tags', '--prune', REMOTE], { allowFail: true, timeout: 30000 });
  if (!refspecs.includes('refs/heads/*')) fetchTeam();
  writeJson(BG_FILE, { ...readJson(BG_FILE), lastFetchAt: Date.now() });
}

/**
 * Read-modify-write on the team-sync branch. `mutate(team)` returns
 * { path: content } to write; it is re-run on fresh state if the push races
 * with a teammate's, so concurrent writers never lose each other's updates.
 */
function transact(me, message, mutate) {
  const indexFile = path.join(STATE_DIR, `index.${process.pid}`);
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      fetchTeam();
      const team = readTeam();
      const writes = mutate(team);
      if (!writes || !Object.keys(writes).length) return team;
      git(team.sha ? ['read-tree', team.sha] : ['read-tree', '--empty'], { env });
      for (const [p, content] of Object.entries(writes)) {
        const blob = git(['hash-object', '-w', '--stdin'], { input: content }).out;
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${p}`], { env });
      }
      const tree = git(['write-tree'], { env }).out;
      const parents = team.sha ? ['-p', team.sha] : [];
      const commit = git(['commit-tree', tree, ...parents, '-m', message], { env: identityEnv(me) }).out;
      const push = git(['push', '--quiet', REMOTE, `${commit}:refs/heads/${BRANCH}`], { allowFail: true, timeout: 30000 });
      if (push.ok) {
        git(['update-ref', TEAM_REF, commit]);
        return readTeam();
      }
      if (!/rejected|non-fast-forward|fetch first|stale info|failed to (update|lock)/i.test(push.err)) {
        throw new Error(`push to ${REMOTE}/${BRANCH} failed: ${push.err.split('\n')[0]}`);
      }
      sleep(250 + Math.random() * 1000);
    }
    throw new Error('the team-sync branch is busy; try again in a moment');
  } finally {
    fs.rmSync(indexFile, { force: true });
  }
}

const statusFile = (id) => `status/${id}.json`;

function appendLog(team, me, text, kind = 'auto') {
  const p = `log/${me}.jsonl`;
  const lines = (team.files[p] || '').split('\n').filter(Boolean);
  lines.push(JSON.stringify({ at: nowIso(), by: me, kind, text }));
  return { [p]: `${lines.slice(-200).join('\n')}\n` };
}

// ---------------------------------------------------------------- local working copy

/** Branch, upstream, ahead/behind and changed files from a single `git status` call. */
function localWork() {
  const work = { branch: 'HEAD', upstream: null, ahead: 0, behind: 0, files: [], trackedDirty: false };
  const parts = git(['status', '--porcelain=v2', '--branch', '-z'], { allowFail: true }).buf.toString('utf8').split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const e = parts[i];
    if (!e) continue;
    if (e.startsWith('# branch.head ')) work.branch = e.slice(14);
    else if (e.startsWith('# branch.upstream ')) work.upstream = e.slice(18);
    else if (e.startsWith('# branch.ab ')) {
      const [a, b] = e.slice(12).split(' ');
      work.ahead = Math.abs(Number(a)) || 0;
      work.behind = Math.abs(Number(b)) || 0;
    } else if (e[0] === '1' || e[0] === '2' || e[0] === 'u') {
      work.files.push(e.split(' ').slice({ 1: 8, 2: 9, u: 10 }[e[0]]).join(' '));
      work.trackedDirty = true;
      if (e[0] === '2') i += 1; // skip the rename source path
    } else if (e[0] === '?') {
      work.files.push(e.slice(2));
    }
  }
  return work;
}

/** origin/main and origin/team-sync in one call. */
function remoteRefs() {
  const out = git(['for-each-ref', '--format=%(objectname) %(refname)', MAIN_REF, TEAM_REF], { allowFail: true }).out;
  const shas = Object.fromEntries(out.split('\n').filter(Boolean).map((l) => l.split(' ').reverse()));
  return { main: shas[MAIN_REF] || null, team: shas[TEAM_REF] || null };
}

function presence(me, prev = {}, work = localWork()) {
  return {
    ...prev,
    member: me,
    state: prev.state || 'idle',
    branch: work.branch,
    editing: work.files.slice(0, 30),
    unpushed: work.ahead,
    last_seen: nowIso(),
  };
}

/** Pull teammates' pushes into the current branch, but only when nothing local can be disturbed. */
function fastForwardIfSafe(work = localWork(), alreadyReported = null) {
  const { upstream, ahead, behind } = work;
  const dirty = work.trackedDirty;
  const key = `${upstream}:${behind}:${ahead}:${dirty}`;
  if (!upstream || !behind) return { upstream, key, pulled: 0, message: null };
  const canPull = !ahead && !dirty;
  if (!canPull && key === alreadyReported) return { upstream, key, pulled: 0, message: null };
  const incoming = git(['log', '-n', '8', '--format=%h %s (%an, %ar)', 'HEAD..@{upstream}'], { allowFail: true }).out;
  if (canPull) {
    const merge = git(['merge', '--ff-only', '--quiet', '@{upstream}'], { allowFail: true });
    if (merge.ok) {
      return { upstream, key, pulled: behind, message: `Auto-pulled ${behind} new commit(s) from ${upstream} (fast-forward):\n${indent(incoming)}` };
    }
    return { upstream, key, pulled: 0, message: `${behind} new commit(s) on ${upstream}, auto-pull failed (${merge.err.split('\n')[0]}). Run: git pull --rebase --autostash` };
  }
  const why = [ahead ? `${ahead} unpushed commit(s)` : '', dirty ? 'uncommitted changes' : ''].filter(Boolean).join(' and ');
  return {
    upstream,
    key,
    pulled: 0,
    message: `${upstream} has ${behind} commit(s) you don't have (not auto-pulled: you have ${why}). Run git pull --rebase --autostash before pushing:\n${indent(incoming)}`,
  };
}

function spawnBackground(command = 'bg-refresh') {
  try {
    spawn(process.execPath, [SCRIPT, command], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* best effort */ }
}

function withLock(fn) {
  try {
    if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs < 90000) return; // another refresh is running
    fs.rmSync(LOCK_FILE, { force: true });
  } catch { /* no lock yet */ }
  let fd;
  try { fd = fs.openSync(LOCK_FILE, 'wx'); } catch { return; }
  try { fn(); } finally {
    fs.closeSync(fd);
    fs.rmSync(LOCK_FILE, { force: true });
  }
}

function heartbeat(me, force = false) {
  const work = localWork();
  const signature = JSON.stringify([work.branch, work.files.slice(0, 30), work.ahead]);
  const bg = readJson(BG_FILE);
  if (!force && bg.heartbeatSig === signature && Date.now() - (bg.heartbeatAt || 0) < HEARTBEAT_EVERY_MS) return;
  transact(me, `heartbeat ${me}`, (team) => ({ [statusFile(me)]: toJson(presence(me, team.status[me], work)) }));
  writeJson(BG_FILE, { ...readJson(BG_FILE), heartbeatAt: Date.now(), heartbeatSig: signature });
}

// ---------------------------------------------------------------- formatting

const isOnline = (s) => Date.now() - Date.parse(s?.last_seen || 0) < OFFLINE_AFTER_MS;
const filesOf = (s) => [...new Set([...(s?.editing || []), ...(s?.planned_files || [])])];
const byId = (a, b) => a.id.localeCompare(b.id);

function describeMember(s) {
  const parts = [`${short(s.member)}: ${isOnline(s) ? 'ONLINE' : `offline (last seen ${ago(s.last_seen)})`}`];
  parts.push(s.state === 'working' && s.doing ? `working on "${s.doing}" (since ${ago(s.doing_since)})` : 'idle');
  if (s.branch) parts.push(`branch ${s.branch}`);
  const files = filesOf(s);
  if (files.length) parts.push(`files: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` +${files.length - 8} more` : ''}`);
  if (s.unpushed) parts.push(`${s.unpushed} unpushed commit(s)`);
  return parts.join(' | ');
}

function formatTask(t) {
  const owner = t.assignee === 'any' ? 'unassigned' : short(t.assignee);
  const lastNote = t.notes?.length ? ` -- note from ${short(t.notes.at(-1).by)}: ${t.notes.at(-1).text}` : '';
  return `${t.id} [${t.priority}] ${t.title} (${t.state}, ${owner}, from ${short(t.created_by)}, ${ago(t.updated_at)})${lastNote}`;
}

function overlapWarnings(me, team, myFiles) {
  const mine = new Set(myFiles);
  const warnings = {};
  for (const s of Object.values(team.status)) {
    if (s.member === me || !isOnline(s)) continue;
    const shared = filesOf(s).filter((f) => mine.has(f));
    if (shared.length) warnings[s.member] = shared.sort();
  }
  return warnings;
}

function briefing(me, team, notes = []) {
  const L = ['TEAM SYNC BRIEF (generated by .claude/team/team.mjs from the team-sync branch)'];
  const work = localWork();
  if (me) {
    const local = [`branch ${work.branch}`, work.files.length ? `${work.files.length} changed file(s)` : 'clean'];
    if (work.ahead) local.push(`${work.ahead} unpushed commit(s)`);
    if (work.behind) local.push(`${work.behind} behind upstream`);
    L.push(`You are pairing with ${short(me)} (member id "${me}"). Local: ${local.join(', ')}.`);
  } else {
    L.push(`!! This clone doesn't know which teammate is using it. Ask the user who they are (${IDS.join(' | ')}) and run: node .claude/team/team.mjs setup <id>`);
  }
  L.push(...notes.filter(Boolean));
  if (!team.sha) L.push('The team-sync branch does not exist yet; the first status/task/log command creates it.');

  L.push('', 'Teammates:');
  for (const id of IDS.filter((x) => x !== me)) {
    L.push(team.status[id] ? `- ${describeMember(team.status[id])}` : `- ${short(id)}: no activity yet (their Claude has not synced)`);
  }
  if (me) {
    const clashes = overlapWarnings(me, team, work.files);
    for (const [id, files] of Object.entries(clashes)) {
      L.push(`!! ${short(id)} is also editing ${files.join(', ')}. Coordinate before committing (merge-conflict risk).`);
    }
  }

  const tasks = Object.values(team.tasks).sort(byId);
  const section = (title, list) => {
    if (!list.length) return;
    L.push('', `${title}:`, ...list.map((t) => `- ${formatTask(t)}`));
  };
  section('Your tasks', tasks.filter((t) => t.assignee === me && t.state !== 'done'));
  section('Unassigned tasks (anyone can claim)', tasks.filter((t) => t.assignee === 'any' && t.state !== 'done'));
  section("Teammates' tasks", tasks.filter((t) => t.assignee !== me && t.assignee !== 'any' && t.state !== 'done'));
  section('Recently done', tasks.filter((t) => t.state === 'done')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 3));

  const recent = team.log.filter((e) => e.by !== me).slice(-8);
  if (recent.length) L.push('', 'Recent teammate activity:', ...recent.map((e) => `- ${ago(e.at)} ${short(e.by)}: ${e.text}`));

  const latest = git(['log', '-n', '6', '--format=%h %s (%an, %ar)', MAIN_REF], { allowFail: true }).out;
  if (latest) L.push('', `Latest on ${REMOTE}/main:`, indent(latest));

  L.push('', 'Protocol: see "Team Sync" in CLAUDE.md. Commands: node .claude/team/team.mjs status "<doing>" --files a,b | task add "<title>" --to <member> | task claim|done <id> | log "<note>" | idle');
  return L.join('\n');
}

function snapshot(team, { mainSha = refSha(MAIN_REF), ...extra } = {}) {
  const seen = readJson(SEEN_FILE);
  const status = {};
  for (const [id, s] of Object.entries(team.status)) {
    status[id] = JSON.stringify([s.state, s.doing, s.branch, filesOf(s)]);
  }
  const tasks = {};
  for (const t of Object.values(team.tasks)) tasks[t.id] = t.updated_at;
  writeJson(SEEN_FILE, {
    ...seen,
    teamSha: team.sha,
    mainSha,
    status,
    tasks,
    logAt: team.log.at(-1)?.at || seen.logAt || '',
    teamStatus: team.status,
    ...extra,
  });
}

function emit(event, context, systemMessage) {
  const payload = { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
  if (systemMessage) payload.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(payload));
}

// ---------------------------------------------------------------- hooks

function hookSessionStart() {
  const me = whoami();
  fetchAll();
  const ff = fastForwardIfSafe();
  const team = readTeam();
  emit('SessionStart', briefing(me, team, [ff.message]), summaryLine(me, team));
  snapshot(team, { overlaps: {}, pushNudgeAt: 0 });
  if (me) spawnBackground('bg-heartbeat');
}

function summaryLine(me, team) {
  const others = IDS.filter((id) => id !== me && team.status[id] && isOnline(team.status[id]))
    .map((id) => `${short(id)}${team.status[id].doing ? `: ${team.status[id].doing}` : ' online'}`);
  const mine = Object.values(team.tasks).filter((t) => t.assignee === me && t.state !== 'done').length;
  return `Team Sync: ${me ? `you are ${short(me)}` : 'identity unknown, run setup'} | ${others.length ? others.join(' | ') : 'no teammates online'} | ${mine} open task(s) for you`;
}

function hookPrompt() {
  const me = whoami();
  const seen = readJson(SEEN_FILE);
  const lines = [];
  const extra = { overlaps: seen.overlaps || {}, pushNudgeAt: seen.pushNudgeAt || 0 };
  const refs = remoteRefs();
  const work = localWork();

  // Teammates' code: new commits on main, pulled automatically when nothing local can be disturbed.
  const mainSha = refs.main;
  const ff = fastForwardIfSafe(work, seen.ffReported);
  if (mainSha && seen.mainSha && mainSha !== seen.mainSha) {
    const myEmail = gitConfig('user.email');
    const fresh = git(['log', '-n', '8', '--format=%h%x09%ae%x09%s (%an)', `${seen.mainSha}..${mainSha}`], { allowFail: true }).out
      .split('\n').filter(Boolean).map((l) => l.split('\t')).filter(([, email]) => email !== myEmail);
    if (fresh.length && !(ff.upstream === `${REMOTE}/main` && ff.message)) {
      lines.push(`New on ${REMOTE}/main:\n${indent(fresh.map(([h, , s]) => `${h} ${s}`).join('\n'))}`);
    }
  }
  if (ff.message) {
    lines.push(ff.message);
    extra.ffReported = ff.key;
  }

  // Teammates' status, tasks and notes.
  const teamSha = refs.team;
  let team = null;
  if (teamSha && teamSha !== seen.teamSha) {
    team = readTeam(teamSha);
    for (const s of Object.values(team.status)) {
      if (s.member === me) continue;
      const sig = JSON.stringify([s.state, s.doing, s.branch, filesOf(s)]);
      if (seen.status?.[s.member] !== sig) lines.push(`- ${describeMember(s)}`);
    }
    for (const t of Object.values(team.tasks).sort(byId)) {
      if (seen.tasks?.[t.id] === t.updated_at || t.updated_by === me) continue;
      const isNew = !seen.tasks?.[t.id] && t.created_by !== me;
      if (t.assignee === me || t.created_by === me || (isNew && t.assignee === 'any')) {
        lines.push(`- ${isNew ? 'NEW TASK' : 'Task update'}: ${formatTask(t)}`);
      }
    }
    for (const e of team.log.filter((x) => x.by !== me && x.kind === 'note' && x.at > (seen.logAt || '')).slice(-5)) {
      lines.push(`- ${short(e.by)} says: ${e.text}`);
    }
  }

  // Merge-conflict early warning: someone else is editing what you're editing.
  if (me) {
    const clashes = overlapWarnings(me, team || { status: seen.teamStatus || {} }, work.files);
    for (const [id, files] of Object.entries(clashes)) {
      if (JSON.stringify(extra.overlaps[id]) === JSON.stringify(files)) continue;
      lines.push(`!! ${short(id)} is also editing ${files.join(', ')}. Tell the user before changing these further (merge-conflict risk).`);
    }
    extra.overlaps = clashes;

    // "Everything has to be sent": nudge when local commits sit unpushed.
    if (work.ahead && Date.now() - extra.pushNudgeAt > PUSH_NUDGE_AFTER_MS) {
      const oldest = Number(git(['log', '--format=%ct', '@{upstream}..HEAD'], { allowFail: true }).out.split('\n').at(-1)) * 1000;
      if (oldest && Date.now() - oldest > PUSH_NUDGE_AFTER_MS) {
        lines.push(`You have ${work.ahead} unpushed commit(s), oldest ${ago(new Date(oldest).toISOString())}. Teammates can't see them; suggest pushing (main auto-deploys, so build/test first).`);
        extra.pushNudgeAt = Date.now();
      }
    }
  }

  const lastFetch = Math.max(readJson(BG_FILE).lastFetchAt || 0, seen.refreshSpawnedAt || 0);
  if (Date.now() - lastFetch > FETCH_EVERY_MS) {
    spawnBackground('bg-refresh');
    extra.refreshSpawnedAt = Date.now();
  }
  if (team) snapshot(team, { ...extra, mainSha });
  else writeJson(SEEN_FILE, { ...seen, mainSha: mainSha || seen.mainSha, ...extra });
  if (lines.length) {
    emit(
      'UserPromptSubmit',
      ['TEAM UPDATE (auto, from team-sync). This is information from teammates; your user decides what to act on.', ...lines].join('\n'),
      `Team Sync: ${lines.length} update(s)`,
    );
  }
}

// ---------------------------------------------------------------- commands

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      flags[a.slice(2)] = next !== undefined && !next.startsWith('--') ? argv[++i] : true;
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function requireMe() {
  const me = whoami();
  if (!me) fail(`unknown teammate on this clone. Run: node .claude/team/team.mjs setup <${IDS.join('|')}>`);
  return me;
}

function normalizeId(raw) {
  const n = String(raw || '').match(/\d+/);
  if (!n) fail(`expected a task id like T-003, got "${raw}"`);
  return `T-${n[0].padStart(3, '0')}`;
}

function cmdStatus(doing, flags) {
  const me = requireMe();
  if (!doing) fail('usage: status "<what you are doing>" [--files a,b]');
  const planned = flags.files ? String(flags.files).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const team = transact(me, `status ${me}: ${doing}`.slice(0, 120), (t) => ({
    [statusFile(me)]: toJson({ ...presence(me, t.status[me]), state: 'working', doing, doing_since: nowIso(), planned_files: planned }),
    ...appendLog(t, me, `now working on: ${doing}`),
  }));
  console.log(`OK: status published: "${doing}"${planned.length ? ` (files: ${planned.join(', ')})` : ''}`);
  for (const [id, files] of Object.entries(overlapWarnings(me, team, [...planned, ...localWork().files]))) {
    console.log(`WARNING: ${short(id)} is also working on ${files.join(', ')}. Tell the user before editing these.`);
  }
}

function cmdIdle(flags) {
  const me = requireMe();
  transact(me, `idle ${me}`, (t) => ({
    [statusFile(me)]: toJson({ ...presence(me, t.status[me]), state: 'idle', doing: '', planned_files: [] }),
    ...appendLog(t, me, flags.note ? `idle: ${flags.note}` : 'idle'),
  }));
  console.log('OK: marked idle.');
}

function cmdLog(text) {
  const me = requireMe();
  if (!text) fail('usage: log "<message>"');
  transact(me, `log ${me}`, (t) => appendLog(t, me, text, 'note'));
  console.log('OK: note broadcast to the team.');
}

function cmdTask(verb, args, flags) {
  const me = requireMe();
  if (verb === 'add') {
    const title = args.join(' ').trim();
    const to = String(flags.to || 'any').toLowerCase();
    if (!title) fail('usage: task add "<title>" [--to <member|any>] [--details ".."] [--priority P0|P1|P2]');
    if (to !== 'any' && !IDS.includes(to)) fail(`unknown member "${to}" (use ${IDS.join(', ')} or any)`);
    let id;
    transact(me, `task add by ${me}`, (t) => {
      const n = Object.keys(t.tasks).map((x) => Number(x.slice(2))).reduce((a, b) => Math.max(a, b), 0) + 1;
      id = `T-${String(n).padStart(3, '0')}`;
      const stamp = nowIso();
      const task = {
        id,
        title,
        details: flags.details ? String(flags.details) : '',
        priority: String(flags.priority || 'P1').toUpperCase(),
        assignee: to,
        state: to === me ? 'in_progress' : 'open',
        created_by: me,
        created_at: stamp,
        updated_at: stamp,
        updated_by: me,
        notes: [],
      };
      return { [`tasks/${id}.json`]: toJson(task), ...appendLog(t, me, `created ${id} for ${to}: ${title}`) };
    });
    console.log(`OK: ${id} created${to === 'any' ? ' (unassigned)' : ` for ${short(to)}`}: ${title}`);
    return;
  }

  const transitions = { claim: 'in_progress', start: 'in_progress', done: 'done', block: 'blocked', reopen: 'open' };
  if (!transitions[verb] && verb !== 'assign' && verb !== 'note') {
    fail('usage: task add|claim|start|done|block|reopen|assign|note <T-id> ...');
  }
  const id = normalizeId(args[0]);
  const noteText = verb === 'note' ? args.slice(1).join(' ').trim() : (flags.note ? String(flags.note) : '');
  const to = verb === 'assign' ? String(flags.to || args[1] || '').toLowerCase() : null;
  if (verb === 'assign' && !IDS.includes(to) && to !== 'any') fail(`usage: task assign ${id} --to <${IDS.join('|')}|any>`);
  if (verb === 'note' && !noteText) fail(`usage: task note ${id} "<text>"`);
  let found = null;
  transact(me, `task ${verb} ${id} by ${me}`, (t) => {
    found = t.tasks[id] || null;
    if (!found) return null;
    const next = { ...found, notes: [...(found.notes || [])], updated_at: nowIso(), updated_by: me };
    if (transitions[verb]) next.state = transitions[verb];
    if (verb === 'claim' || verb === 'start') next.assignee = me;
    if (verb === 'assign') next.assignee = to;
    if (noteText) next.notes.push({ at: nowIso(), by: me, text: noteText });
    const summary = `${verb} ${id}${to ? ` -> ${to}` : ''}${noteText ? `: ${noteText}` : ''}`;
    return { [`tasks/${id}.json`]: toJson(next), ...appendLog(t, me, summary) };
  });
  if (!found) fail(`no task ${id}. Run: node .claude/team/team.mjs tasks`);
  console.log(`OK: ${id} ${verb}${to ? ` -> ${to}` : ''}${noteText ? ` (${noteText})` : ''}`);
}

function cmdTasks(flags) {
  fetchTeam();
  const tasks = Object.values(readTeam().tasks).sort(byId).filter((t) => flags.all || t.state !== 'done');
  console.log(tasks.length ? tasks.map((t) => `- ${formatTask(t)}`).join('\n') : 'No open tasks.');
}

function cmdSync() {
  fetchAll();
  const ff = fastForwardIfSafe();
  console.log(ff.message || 'Your branch is up to date with its upstream.');
  const me = whoami();
  if (me) {
    heartbeat(me, true);
    console.log('Presence published.');
  }
}

function cmdSetup(id) {
  if (!IDS.includes(String(id).toLowerCase())) fail(`usage: setup <${IDS.join('|')}>`);
  git(['config', '--local', 'team.member', String(id).toLowerCase()]);
  console.log(`OK: this clone now belongs to ${short(String(id).toLowerCase())}. Run: node .claude/team/team.mjs brief`);
}

function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  switch (command) {
    case 'hook-session-start':
      try { hookSessionStart(); } catch (e) { emit('SessionStart', `team-sync could not build the brief: ${e.message}`); }
      return;
    case 'hook-prompt':
      try { hookPrompt(); } catch { /* never block a prompt */ }
      return;
    case 'bg-refresh':
      withLock(() => { fetchAll(); const me = whoami(); if (me) heartbeat(me); });
      return;
    case 'bg-heartbeat':
      withLock(() => { const me = whoami(); if (me) heartbeat(me, true); });
      return;
    case 'brief':
      fetchAll();
      console.log(briefing(whoami(), readTeam()));
      return;
    case 'sync': cmdSync(); return;
    case 'status': cmdStatus(pos.join(' ').trim(), flags); return;
    case 'idle': cmdIdle(flags); return;
    case 'log': cmdLog(pos.join(' ').trim()); return;
    case 'task': cmdTask(pos[0], pos.slice(1), flags); return;
    case 'tasks': cmdTasks(flags); return;
    case 'whoami': console.log(whoami() || 'unknown (run: setup <id>)'); return;
    case 'setup': cmdSetup(pos[0]); return;
    default:
      console.log(fs.readFileSync(SCRIPT, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
  }
}

try {
  main();
} catch (e) {
  fail(e.message);
}
