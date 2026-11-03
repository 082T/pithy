#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  writeFileSync, readFileSync, mkdtempSync, existsSync,
  readdirSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(scriptDir, '..');
const IS_WINDOWS = process.platform === 'win32';

const KNOWN_EFFORT = new Set(['low', 'medium', 'high', 'max']);
const TEMP_DIR_PREFIX = 'pithy-';
const TEMP_DIR_MAX_AGE_MS = 60 * 60 * 1000;

const config = loadConfig();
const DEFAULTS = {
  model: config.defaultModel || 'sonnet',
  effort: config.defaultThinking || null,
};

let templateSource = 'bundled';

pruneOldTempDirs();

const { opts, raw } = parseArgs(flattenArgv(process.argv.slice(2)));
if (opts.help) { printUsage(process.stderr); process.exit(0); }
if (!raw) { printUsage(process.stderr); process.exit(1); }

const systemPrompt = loadTemplate();

stderr(`[pithy] polishing (model=${opts.model}${opts.effort ? `, thinking=${opts.effort}` : ''})...`);
if (opts.debug) stderr(`[pithy] template: ${templateSource}`);

const polished = runClaude(systemPrompt, raw, opts);
if (!polished) {
  stderr('[pithy] empty polished output - aborting');
  process.exit(1);
}

const file = writeTempPrompt(raw, polished);
stderr(`[pithy] opening editor: ${file}`);
openEditor(file);

const final = readFinal(file);
if (isCancel(final)) {
  stderr('[pithy] cancelled');
  process.exit(1);
}

process.stdout.write(final + '\n');

function loadConfig() {
  const path = join(homedir(), '.pithy', 'config.json');
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function loadTemplate() {
  const projectTemplate = join(process.cwd(), '.pithy', 'pithy', 'reprompter.md');
  if (existsSync(projectTemplate)) {
    templateSource = projectTemplate;
    return readFileSync(projectTemplate, 'utf8');
  }
  const bundled = join(skillRoot, 'assets', 'reprompter.md');
  templateSource = bundled;
  return readFileSync(bundled, 'utf8');
}

function runClaude(system, userText, opts) {
  const combined = `${system}\n\n--- USER INPUT ---\n${userText}`;
  const claudeArgs = ['-p', '--no-session-persistence', '--model', opts.model];
  if (opts.effort) claudeArgs.push('--effort', opts.effort);
  if (opts.debug) {
    stderr(`[pithy] command: claude ${claudeArgs.join(' ')}`);
    stderr(`[pithy] stdin bytes: ${combined.length}`);
  }
  const r = spawnSync('claude', claudeArgs, {
    input: combined,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: IS_WINDOWS,
  });
  if (r.status !== 0) {
    stderr(`[pithy] claude -p failed (status ${r.status})`);
    process.exit(r.status ?? 1);
  }
  return r.stdout.trim();
}

// The SKILL.md body wraps $ARGUMENTS in double quotes so apostrophes
// in prompts survive shell parsing. The cost is that all args arrive
// as a single whitespace-joined string instead of pre-tokenized argv.
// Re-split on whitespace so flag parsing still works downstream.
function flattenArgv(argv) {
  if (argv.length === 1 && /\s/.test(argv[0])) {
    return argv[0].split(/\s+/).filter(Boolean);
  }
  return argv;
}

function parseArgs(args) {
  const opts = { ...DEFAULTS, help: false, debug: false };
  const promptParts = [];
  let endOfFlags = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (endOfFlags) { promptParts.push(a); continue; }
    if (a === '--') { endOfFlags = true; continue; }
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--debug') { opts.debug = true; continue; }

    const [flag, inlineVal] = a.startsWith('--') && a.includes('=')
      ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
      : [a, null];

    if (flag === '--model') {
      opts.model = inlineVal ?? args[++i];
    } else if (flag === '--thinking' || flag === '--effort') {
      const val = inlineVal ?? args[++i];
      if (!KNOWN_EFFORT.has(val)) {
        stderr(`[pithy] invalid --thinking value "${val}" (allowed: ${[...KNOWN_EFFORT].join(', ')})`);
        process.exit(1);
      }
      opts.effort = val;
    } else {
      promptParts.push(a);
    }
  }
  return { opts, raw: promptParts.join(' ').trim() };
}

function writeTempPrompt(original, polished) {
  const dir = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
  const file = join(dir, 'PROMPT.md');
  const originalSingleLine = original.replace(/\s+/g, ' ').slice(0, 300);
  const body = [
    '<!-- pithy: review and edit the prompt below, then save and close the editor to execute.',
    '     TO CANCEL: uncomment the #cancel line below (remove the HTML comment wrapper around it).',
    '     HTML comments like this one are stripped before sending. -->',
    `<!-- session: ${new Date().toISOString()} (pid ${process.pid}) -->`,
    `<!-- original: ${originalSingleLine} -->`,
    '<!-- #cancel -->',
    '',
    polished,
    '',
  ].join('\n');
  writeFileSync(file, body);
  return file;
}

// Claude Code's slash-command bash step has a 2-minute hard timeout.
// When it fires, our process dies but the spawned editor keeps running,
// leaving the user with a stale PROMPT.md they can edit to no effect.
// On the next invocation, delete those abandoned temp dirs so stale
// editor tabs point at missing files and are visibly dead.
function pruneOldTempDirs() {
  try {
    const tempRoot = tmpdir();
    const now = Date.now();
    for (const entry of readdirSync(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(TEMP_DIR_PREFIX)) continue;
      const dirPath = join(tempRoot, entry.name);
      try {
        if (now - statSync(dirPath).mtimeMs > TEMP_DIR_MAX_AGE_MS) {
          rmSync(dirPath, { recursive: true, force: true });
        }
      } catch { /* a single orphan we can't stat or delete isn't fatal */ }
    }
  } catch { /* cleanup is best-effort; never block the main flow */ }
}

function openEditor(file) {
  const editor = pickEditor();
  const r = spawnSync(editor.cmd, [...editor.args, file], {
    stdio: 'inherit',
    shell: IS_WINDOWS,
  });
  if (r.status !== 0) {
    stderr(`[pithy] editor exited with status ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

function readFinal(file) {
  const raw = readFileSync(file, 'utf8');
  return raw.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function isCancel(content) {
  if (!content) return true;
  const firstLine = content.split(/\r?\n/).find(l => l.trim().length > 0) ?? '';
  return /^#cancel\b/i.test(firstLine.trim());
}

function pickEditor() {
  const envEditor = process.env.VISUAL || process.env.EDITOR;
  if (envEditor) return splitCmd(envEditor);
  if (hasCommand('code')) return { cmd: 'code', args: ['--wait'] };
  if (IS_WINDOWS) return { cmd: 'notepad', args: [] };
  if (hasCommand('nano')) return { cmd: 'nano', args: [] };
  return { cmd: 'vi', args: [] };
}

function hasCommand(name) {
  const r = spawnSync(name, ['--version'], { stdio: 'ignore', shell: IS_WINDOWS });
  return r.status === 0 || r.status === 1;
}

function splitCmd(s) {
  const parts = s.trim().split(/\s+/);
  return { cmd: parts[0], args: parts.slice(1) };
}

function printUsage(stream) {
  stream.write(
`Usage: pithy [options] <your prompt>

Options:
  --model <name>       Model for the polisher (haiku | sonnet | opus). Default: ${DEFAULTS.model}.
  --thinking <level>   Thinking effort (low | medium | high | max). Alias: --effort.
  --debug              Print extra diagnostics to stderr.
  -h, --help           Show this help.

Flags may appear anywhere; use "--" to end flag parsing if the prompt literally starts with "--".

Config:   optional ~/.pithy/config.json with {"defaultModel": "...", "defaultThinking": "..."}
Template: project override at ./.pithy/pithy/reprompter.md takes precedence over the bundled default
`);
}

function stderr(line) {
  process.stderr.write(line + '\n');
}
