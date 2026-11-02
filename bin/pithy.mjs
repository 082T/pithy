#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(scriptDir, '..');
const IS_WINDOWS = process.platform === 'win32';

const KNOWN_EFFORT = new Set(['low', 'medium', 'high', 'max']);

const config = loadConfig();
const DEFAULTS = {
  model: config.defaultModel || 'sonnet',
  effort: config.defaultThinking || null,
};

let templateSource = 'bundled';

const { opts, raw } = parseArgs(process.argv.slice(2));
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
  const projectTemplate = join(process.cwd(), '.pithy', 'reprompter.md');
  if (existsSync(projectTemplate)) {
    templateSource = projectTemplate;
    return readFileSync(projectTemplate, 'utf8');
  }
  const bundled = join(pluginRoot, 'templates', 'reprompter.md');
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
  const dir = mkdtempSync(join(tmpdir(), 'pithy-'));
  const file = join(dir, 'PROMPT.md');
  const originalSingleLine = original.replace(/\s+/g, ' ').slice(0, 300);
  const body = [
    '<!-- pithy: review and edit the prompt below, then save and close the editor to execute.',
    '     TO CANCEL: uncomment the #cancel line below (remove the HTML comment wrapper around it).',
    '     HTML comments like this one are stripped before sending. -->',
    `<!-- original: ${originalSingleLine} -->`,
    '<!-- #cancel -->',
    '',
    polished,
    '',
  ].join('\n');
  writeFileSync(file, body);
  return file;
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
Template: project override at ./.pithy/reprompter.md takes precedence over the bundled default
`);
}

function stderr(line) {
  process.stderr.write(line + '\n');
}
