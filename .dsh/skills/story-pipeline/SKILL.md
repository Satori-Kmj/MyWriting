---
name: story-pipeline
description: Use this skill to turn a rough story outline into an expanded outline and candidate prose, then publish an explicitly accepted candidate through the MyWriting transaction workflow.
---

# Story Pipeline

This skill is the authoritative state machine for the MyWriting workflow.

## Control rules

- Execute Stages 0–7 in order; do not merge, skip, or reorder them.
- Do not substitute a plan, todo list, checklist, DSH goal, or progress summary
  for pipeline state.
- A subskill completes only its stage. Return here after it succeeds.
- Except while waiting for candidate acceptance in Stage 3, continue to the
  next mandatory stage without asking for a generic "continue" message.
- If a required skill or tool fails, stop and report the failure. Never imitate
  a missing skill or bypass a failed stage.
- `save_story_artifact`, `commit_story_draft`, and `commit_story_update` are
  tools, not skills. Call them directly.
- Use only the artifact and commit tools required below for mutations. Tool
  results and verified filesystem state are authoritative.

## Stage 0 — Capture rough outline

Enter this stage for a new continuation or new plot material.

1. Treat the user's current plot, scene requirements, and constraints as the
   rough-outline input.
2. Preserve that input without expansion, prose rewriting, or added plot.
3. Call `save_story_artifact` with `artifact: rough-outline` and the complete
   input. It may replace `input/rough-outline.md` from an earlier run.
4. Continue to Stage 1 only after success.

This stage changes no committed story state.

## Stage 1 — Expand outline

1. Load `outline-expansion`.
2. Read `input/rough-outline.md`.
3. Produce the expanded outline.
4. Call `save_story_artifact` with `artifact: expanded-outline`.
5. Continue to Stage 2 only after success.

## Stage 2 — Write candidate

1. Load `prose-writing`.
2. Read `work/expanded-outline.md`.
3. Produce the candidate prose.
4. Call `save_story_artifact` with `artifact: draft`.
5. Continue to Stage 3 only after success.

## Stage 3 — Candidate review

The saved candidate is not story canon. Only explicit acceptance of the
current candidate may enter Stage 4. Examples include "采用", "接受这一版",
and "commit this draft".

Praise, silence, "继续", "下一步", or another generic continuation instruction
is not acceptance. Remain in Stage 3 in those cases.

### Explicit acceptance

If the user accepts the current candidate without requesting a content change
in the same instruction, enter Stage 4.

### Targeted revision

If the user requests a targeted change:

1. Do not enter Stage 4 or update memory, scene state, or history.
2. Load `candidate-revision` and let it operate only on the current candidate.
3. Do not modify or synchronize `work/expanded-outline.md`.
4. The only permitted artifact write is
   `save_story_artifact(artifact: draft)`.
5. After the skill returns, remain in Stage 3 and require fresh explicit
   acceptance.

Do not perform an additional consistency sweep or follow-up edit. If one user
message both requests a change and says to accept afterward, revise first and
still require fresh acceptance of the revised candidate.

### Regeneration

If the user requests a substantially different candidate:

1. Do not enter Stage 4 or update committed state.
2. Load `prose-writing` and regenerate from the current expanded outline plus
   the user's new requirements.
3. Save it with `save_story_artifact(artifact: draft)`.
4. Return to Stage 3 and require explicit acceptance of the new candidate.

## Stage 4 — Approve commit transaction

Enter only after explicit acceptance.

1. Call `commit_story_draft` directly.
2. Require `intent_path: work/commit-intent.json`, a `transaction_id`, the
   approved `draft_sha256`, and `verified: true`.
3. Treat the intent as pending approval state, not published canon.
   `output/`, `state/`, and `history/` must remain unchanged.
4. If validation fails or approval is denied or cancelled, stop and do not
   generate transaction artifacts.
5. After success, continue automatically to Stage 5.

The exact `work/draft.md` bound by the intent is the source for Stages 5–6.

## Stage 5 — Prepare memory patch

1. Load `memory-update`.
2. Generate the patch for the approved draft.
3. Call `save_story_artifact` with `artifact: memory-patch`.
4. Require success and `transaction_bound: true`.
5. Do not modify `state/rag/`.
6. Return here and continue automatically to Stage 6.

The saved patch is pending transaction data, not a completed commit.

## Stage 6 — Prepare scene checkpoint

1. Load `scene-checkpoint`.
2. Generate the checkpoint for the approved draft.
3. Call `save_story_artifact` with `artifact: scene-checkpoint`.
4. Require success and `transaction_bound: true`.
5. Do not modify `state/current-scene.md`.
6. Return here and continue automatically to Stage 7.

The saved checkpoint is pending transaction data, not a completed commit.

## Stage 7 — Publish transaction

Enter only after Stage 4 created the intent and Stages 5–6 saved both
transaction-bound artifacts.

Do not call the legacy tools `apply_memory_patch`, `apply_scene_checkpoint`,
`update_recent_prose`, or `snapshot_story_commit`.

Call `commit_story_update` for the initial publication attempt, then handle its
result as follows:

- `committed` or `already_committed`: finish only when the result also contains
  `materialized: true` and `verified: true`. Do not call the tool again for that
  transaction.
- `committed_needs_sync`: history publication succeeded but the working copy
  did not. Report `sync_error`; do not regenerate artifacts, create a new
  intent, start the next scene, or use legacy tools. Retry only the same
  `commit_story_update` transaction to repair materialization.
- thrown error: no new valid history commit was established by that call. Stop,
  report the exact failure, preserve pending artifacts, and do not repair state
  manually.

The immutable `history/<commit_id>/` snapshot is canonical; `output/` and
`state/` are its materialized working copies.

## Completion

Only a successful Stage 7 result may complete the workflow. A subskill,
artifact, progress summary, or internal task completion is not a story commit.

A DSH goal is not pipeline state. If an ambient goal exists, do not complete it
before verified Stage 7 success and never complete it twice.
