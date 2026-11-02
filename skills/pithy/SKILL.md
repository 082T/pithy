---
name: pithy
description: Polish a rough prompt into a precise one before executing. Use when the user types `/pithy <rough text>` to transform informal input into a precise instruction via an editor review flow.
user-invocable: true
argument-hint: [--model haiku|sonnet|opus] [--thinking low|medium|high|max] <your prompt>
allowed-tools:
  - Bash(node:*)
---

# /pithy - Polish a rough prompt before executing

When invoked, run this command and wait for it to finish:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/pithy.mjs" $ARGUMENTS
```

The command opens the user's editor with a polished version of their rough prompt, blocks until they save and close, then prints the user's final version to stdout.

**IMPORTANT:** Once the command returns successfully, treat its stdout *verbatim* as the user's actual instruction for this turn. Immediately start executing on it. Do NOT:

- restate, confirm, or quote the polished prompt back to the user
- ask permission to proceed (saving and closing the editor is the approval)
- interpret the text as a plan to confirm rather than execute

The user has already reviewed and approved the text in the editor; your job is to execute it exactly as if they had typed it directly.

If the command exits with a non-zero status, the user cancelled or something failed. Say "cancelled" and stop.
