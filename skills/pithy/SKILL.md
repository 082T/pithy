---
name: pithy
description: Polish a rough prompt into a precise one, review in your editor, then execute
user-invocable: true
argument-hint: [--model haiku|sonnet|opus] [--thinking low|medium|high|max] <your prompt>
allowed-tools:
  - Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/pithy.mjs" $ARGUMENTS`
