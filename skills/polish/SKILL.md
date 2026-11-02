---
name: polish
description: Polish rough Claude Code prompts into precise instructions. Opens the user's editor with a polished version of the raw input for review, then uses the final edited text as the actual prompt for the turn. Invoke with /polish <your rough prompt>.
user-invocable: true
argument-hint: [--model haiku|sonnet|opus] [--thinking low|medium|high|max] <your prompt>
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/polish/scripts/polish.mjs" *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/skills/polish/scripts/polish.mjs" $ARGUMENTS`
