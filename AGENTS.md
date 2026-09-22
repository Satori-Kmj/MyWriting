# MyWriting Workspace Rules

These rules define workspace-wide workflow and safety invariants. Stage
transitions belong only to `story-pipeline`; literary behavior belongs only to
the stage skills.

## Workflow authority

For the rough-outline-to-commit workflow, load and follow `story-pipeline` in
order. A subskill completes only its assigned stage and returns control to that
pipeline.

Do not replace the pipeline with a plan, todo list, checklist, DSH goal,
progress summary, or inferred workflow. Do not use a DSH goal as pipeline
state. If an ambient goal exists, complete it only after verified final commit
and never complete it twice.

If a required skill fails to load, stop and report the failure. Do not imitate
or reconstruct the missing skill.

## Writing Agent tool surface

The Writing Agent may discover and read project context, load skills, ask for
missing user-owned information, and call these mutation tools:

- `save_story_artifact`
- `commit_story_draft`
- `commit_story_update`

These are tools, not skills; call them directly when `story-pipeline` requires
them. Shell, generic filesystem mutation, goals, todos, web, delegation, and
coding workflows are outside the Writing Agent's tool surface. Use a separate
maintenance agent for plugin or configuration work.

## Protected files and persistence

All writes under `input/`, `work/`, `output/`, `state/`, and `history/` are
pipeline-controlled. Save the five generated artifacts only through
`save_story_artifact` with the matching artifact name:

- `rough-outline`
- `expanded-outline`
- `draft`
- `memory-patch`
- `scene-checkpoint`

Never create, edit, or repair pipeline artifacts, transaction metadata,
canonical working copies, or history through a generic tool. In particular,
do not manually change `work/commit-intent.json`, any `work/*.meta.json`,
`state/current-commit.json`, or a committed history directory.

Tool results and verified filesystem state are authoritative. A saved draft,
memory patch, scene checkpoint, or commit intent is pending data, not committed
story canon.

## Commit invariants

Only explicit acceptance of the current saved candidate may enter the commit
stages. `commit_story_draft` verifies that candidate and creates an approved
pending transaction; it does not publish canon. The memory patch and scene
checkpoint must both be bound to that exact transaction.

`commit_story_update` is the only normal publication tool. Do not use the
legacy apply/update/snapshot tools. Completion requires one of these statuses:

- `committed`
- `already_committed`

and both `materialized: true` and `verified: true`.

`committed_needs_sync` means history publication succeeded but the working
copy did not. Retry only the same transaction with `commit_story_update`; do
not regenerate artifacts, create a new intent, or start the next scene. If the
tool throws before publication, stop, report the error, and keep the pending
transaction for inspection or retry.

The latest valid `history/<commit_id>/` snapshot is canonical.
`output/accepted-draft.md`, `state/current-scene.md`, `state/recent-prose.md`,
and `state/rag/` are materialized working copies. `state/current-commit.json`
identifies the successfully materialized snapshot.

Do not claim that an artifact, approval, commit, synchronization, or workflow
completed unless the responsible tool returned the required success state. A
progress summary never replaces a remaining stage.
