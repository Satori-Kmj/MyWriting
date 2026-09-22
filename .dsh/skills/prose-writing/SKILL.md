---
name: prose-writing
description: Generate candidate story prose from the prepared story plan and project context, using the project writing system as the sole authority for literary expression.
---

# Prose Writing

Generate the candidate story prose for the current continuation.

This skill controls:

- which project information must be read;
- how different project information should be interpreted;
- where the candidate draft is saved.

This skill does not define literary style.

All rules about narrative style, prose structure, dialogue presentation,
description, implication, opening behavior, and stopping behavior come
from:

`config/writing-system.md`

## Required Input

Before writing, read:

1. `work/expanded-outline.md`
2. `config/writing-system.md`
3. `state/current-scene.md` if it exists
4. relevant character files under `reference/characters/`
5. relevant character state files under `state/rag/`
6. `reference/terminology.md` when relevant
7. `state/recent-prose.md` if it exists

Do not load unrelated character files.

If `work/expanded-outline.md` is missing or empty, stop and report the
pipeline failure.

## Information Roles

Treat each source according to its role.

### Expanded Outline

`work/expanded-outline.md` is an event and constraint plan.

It determines:

- required events;
- required event order;
- required factual outcomes;
- explicit constraints.

It is not prose source material.

Do not:

- copy its wording into prose merely because it appears in the outline;
- paraphrase planning explanations into narration;
- summarize its event sequence;
- convert planning labels into literary sentences.

If the outline contains `控制信息`, treat that information only as an
internal behavior constraint.

Do not directly narrate, explain, summarize, or expose control information
unless the user's requested event explicitly requires that information to
become observable in the story.



### Current Scene State

`state/current-scene.md` describes the current physical and situational
state of the story.

It is continuity data.

It is not a list of facts that must be reintroduced to the reader.

Use it to prevent contradictions.

### Character State

Files under `state/rag/` describe persistent or continuing character
state.

Use them to maintain character continuity.

Do not automatically restate them in prose.

### Character References

Files under `reference/characters/` define stable character facts.

Use them as canon constraints.

Do not introduce unrelated reference information merely because it was
read.

### Recent Prose

If `state/recent-prose.md` exists, treat it as the immediate textual
continuation point.

Use it to understand where the existing prose actually stopped.

Do not repeat information already established there unless repetition is
required by a new action, dialogue, perception, or explicit user request.

### Writing System

`config/writing-system.md` is the sole authority for literary expression.

Follow it for:

- narrative presentation;
- prose flow;
- description;
- dialogue;
- implication;
- continuation behavior;
- stopping behavior.

Do not invent additional literary rules in this skill.

## Content Authority

For story facts, use this priority:

1. the user's current explicit plot requirements and constraints;
2. current committed story state;
3. the expanded outline's required events and outcomes;
4. stable character references;
5. terminology reference.

For literary expression, use:

`config/writing-system.md`

Do not use planning language as a substitute for literary expression.

## Output Contract

Produce only the candidate story prose.

Do not include:

- analysis;
- planning notes;
- outline commentary;
- scene-quality analysis;
- explanations to the user;
- future-story suggestions;
- draft status;
- labels copied from the expanded outline.

Save the complete candidate prose using `save_story_artifact`.

Call it with:

- `artifact`: `draft`
- `content`: the complete candidate prose

Do not use generic `write` or `edit` for this artifact.

Do not modify story memory.

Do not modify files under `state/`.

The candidate draft is not committed story canon until the user explicitly
accepts it.

## Optional continuity files

`state/current-scene.md` and `state/recent-prose.md` are optional on a fresh project or before the first committed continuation.

If either optional file does not exist:

- treat that as normal absence, not as a pipeline failure;
- do not repeatedly retry the same missing read;
- continue using the other available canon inputs.

A missing `state/recent-prose.md` means there is no prior prose continuation anchor yet.