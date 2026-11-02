# pithy

> Polish your rough Claude Code prompts into precise ones. Review in your editor, then execute. Uses your Claude subscription - **no API key required**.

A Claude Code plugin for the moments you type faster than you think.

## What it does

You type:

```
/pithy fix the thing where users cant login after reset
```

Pithy opens your editor with a polished version:

> Fix the bug where a user cannot log in after resetting their password. Reproduce the failure mode first to confirm the actual symptom, then fix the root cause. Do not modify unrelated code.

You review, maybe tweak, save and close - Claude Code executes the polished prompt. The whole round-trip uses your logged-in Claude subscription; nothing hits an external API with a separate key.

## Install

Via Claude Code's plugin system:

```
/plugin marketplace add 082T/pithy
/plugin install pithy@pithy
```

If you're installing from a local checkout, run `/plugin marketplace add <path>` instead of the first line.

### Prerequisites

- **Node.js 18+** on PATH
- **`claude` CLI** on PATH (installed with Claude Code)
- **An editor that blocks on save-and-close**:
  - VS Code is auto-detected (`code --wait`)
  - Otherwise set `$EDITOR` or `$VISUAL` (vim, nano, emacs, etc.)
  - Windows falls back to `notepad` if nothing else matches

## Usage

```
/pithy <your rough prompt>
```

### Flags

| Flag | Values | Default | Notes |
|---|---|---|---|
| `--model <name>` | `haiku`, `sonnet`, `opus` (or any full model ID) | `sonnet` | Model used to polish. Haiku is fast and cheap; opus is deepest. |
| `--thinking <level>` | `low`, `medium`, `high`, `max` | *(off)* | Extended thinking effort. Alias: `--effort`. |
| `--debug` | - | off | Print the exact `claude -p` invocation and template source to stderr. |
| `-h`, `--help` | - | - | Print usage. |

Flags may appear anywhere in the arguments. Use `--` to end flag parsing if your prompt literally starts with `--`.

### Examples

```
/pithy add retries to the fetch helper

/pithy --model haiku explain how the auth middleware works

/pithy --model opus --thinking high design a reconnect strategy
       for the websocket client that preserves subscription state

/pithy --debug add dark mode support
```

## Cancelling a reprompt

Three ways to abort after the editor opens:

1. **Uncomment the pre-written `<!-- #cancel -->` line** in the editor - remove the HTML comment wrapper so it reads just `#cancel`. Save and close.
2. **Clear the entire file** and save.
3. **`Ctrl+C`** in Claude Code before the editor opens.

Any of these aborts without sending anything to Claude.

## Configuration

### Global defaults

Create `~/.pithy/config.json` to set defaults so you don't have to repeat flags:

```json
{
  "defaultModel": "haiku",
  "defaultThinking": "medium"
}
```

CLI flags override config file values.

### Project-local template

To customize the reprompter template for a specific project (e.g., to encode house style, forbid certain patterns, require specific framing), create `.pithy/reprompter.md` in the project root. Pithy will use it instead of the bundled default. The bundled template lives at [templates/reprompter.md](templates/reprompter.md) - copy and modify it as a starting point.

Use cases:
- **Teams**: encode "always ask about test coverage" or "prefer composition over inheritance"
- **Backend-heavy repo**: skew rewrites toward backend framing
- **Specific domain**: inject vocabulary ("in this codebase, 'tenant' means organization, not user")

## How it works

The plugin's slash command runs a small Node script that:

1. Calls `claude -p` (headless mode) with the reprompter system prompt + your raw input. This uses your logged-in Claude subscription auth - same as regular Claude Code - rather than a separate API key.
2. Writes the polished output to a temp file with instructional comments at the top.
3. Opens your editor (`code --wait` / `$EDITOR` / `notepad`) and waits for you to save and close.
4. Strips HTML comments from your saved content and emits the result to stdout.
5. Claude Code captures that stdout and uses it as the actual prompt for the turn.

## Known limitations

- **2-minute timeout.** Claude Code's slash command bash step is limited to 2 minutes. If your editor is open longer than that, the command silently times out.
- **Raw args visible.** Claude Code includes your raw `/pithy ...` text in the user turn alongside the polished output. In practice the model prioritizes the polished version, but your raw input is still in context.
- **Cursor / forks of VS Code.** Pithy's editor auto-detect targets `code --wait`. For Cursor, set `$env:EDITOR = "cursor --wait"` (Windows) or `export EDITOR="cursor --wait"` (macOS/Linux) before launching Claude Code.

## License

MIT - see [LICENSE](LICENSE).
