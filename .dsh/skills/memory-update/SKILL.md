---
name: memory-update
description: "Generate a structured memory patch from the exact candidate draft approved for the current commit transaction without directly modifying story state."
---

# Memory Update

Use this skill only after the current candidate has received explicit user
acceptance and `commit_story_draft` has successfully created:

`work/commit-intent.json`

This stage proposes character-state changes for the pending transaction.

It must never directly modify files under `state/rag/`.

## Source of Truth

Read:

1. `work/draft.md`
2. current relevant character state files under `state/rag/`
3. relevant stable character references under `reference/characters/`

`work/draft.md` is the story content approved for the current transaction.

Do not use `output/accepted-draft.md` as the source for this pending transaction.

Project files are authoritative.

Do not use pretrained model knowledge to fill missing story-specific facts.

## Core Principle

Do not summarize the approved draft.

Only record state changes that are still relevant at the end of the approved
draft and may affect later scenes.

If forgetting a detail would not create a meaningful continuity problem,
it normally should not become memory.

## State Sections

Only use these sections:

- `身体状态`
- `心情`
- `关系态度`
- `认知 / 知识 / 怀疑`
- `当前目标 / 意图`
- `持续心理状态`
- `当前约束`

### 身体状态

Record injuries, illnesses, physical limitations, or current physical /
appearance changes that are still active when the approved draft ends.

### 心情

Record the character's meaningful current emotional state at the end of
the approved draft.

Do not accumulate emotions that have already passed.

### 关系态度

Record meaningful changes in the character's attitude toward another
specific person.

Relationship changes require stronger evidence than ordinary mood changes.

Do not infer love, hatred, trust, hostility, or similar major changes from
minor interactions.

### 认知 / 知识 / 怀疑

Distinguish certainty whenever possible.

Use forms such as:

- `已知：...`
- `相信：...`
- `怀疑：...`

Do not convert suspicion into fact.

### 当前目标 / 意图

Record goals or intentions that are still active after the approved draft.

Remove goals that have clearly been completed or abandoned.

### 持续心理状态

Use this section only for significant persistent internal psychological
changes.

Do not use it for ordinary short-term emotions or ordinary relationship
attitudes.

Changes in this section require strong evidence.

### 当前约束

Record conditions that currently restrict the character's possible actions.

## Operations

Every proposed change must use exactly one of:

- `add`
- `replace`
- `remove`

Use `add` for genuinely new current state.

Use `replace` when an existing state has changed and the previous state is
no longer current.

Use `remove` when an existing state has explicitly ceased to apply.

For `replace` and `remove`, `old_value` must contain only the text content
of the existing state entry.

Do not include the Markdown bullet prefix `- ` in `old_value`.

For `add` and `replace`, `value` must also contain only the state text.

Do not include Markdown bullet markers, list markers, indentation, or
surrounding whitespace in `old_value` or `value`.

## Evidence

Every change must include brief evidence grounded in the approved draft.

Evidence is used to audit why the change was proposed.

Do not use evidence to introduce information not present in the approved draft.

## Output Format

Produce one JSON object:

{
  "schema_version": 1,
  "source": "work/draft.md",
  "updates": [
    {
      "character": "<character name>",
      "changes": [
        {
          "op": "add | replace | remove",
          "section": "<state section>",
          "old_value": "<required for replace/remove>",
          "value": "<required for add/replace>",
          "evidence": "<brief evidence>"
        }
      ]
    }
  ]
}

Do not include characters whose state does not change.

If the approved draft creates no state changes worth preserving, output:

{
  "schema_version": 1,
  "source": "work/draft.md",
  "updates": []
}

Save the complete JSON using `save_story_artifact` with:

- `artifact`: `memory-patch`
- `content`: the complete JSON object

`save_story_artifact` mechanically binds the saved patch to the current
transaction and approved draft.

After the memory patch is saved successfully, return control to the calling
`story-pipeline`.

Do not modify `state/rag/`.
Do not apply the patch.
