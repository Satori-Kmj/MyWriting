---
name: candidate-revision
description: Revise the current uncommitted MyWriting candidate draft according to the user's explicit requested changes, while preserving unaffected content.
---

# Candidate Revision

Use this skill only when:

- `work/draft.md` already exists;
- the current candidate has not been committed as story canon;
- the user explicitly requests one or more changes to that candidate.

This skill is for user-directed candidate revision only.

It must not perform automatic style detection, style correction, AI-style removal,
or unsolicited rewriting.

## Hard Write Boundary

During this skill, the only pipeline artifact that may be changed is:

`work/draft.md`

The revised draft must be saved only through:

`save_story_artifact` with `artifact: draft`

Do not call generic `write` or `edit`.

Do not modify:

- `work/expanded-outline.md`
- `input/rough-outline.md`
- `output/accepted-draft.md`
- any file under `state/`
- any file under `reference/`
- any file under `history/`
- any configuration or skill file

`work/expanded-outline.md` is read-only planning context during candidate revision.
Do not synchronize the user's revision request back into the expanded outline.

## Required Input

Read:

1. `work/draft.md`
2. the user's current revision request
3. `config/writing-system.md`

Read additional files only when strictly necessary to avoid a continuity or canon
contradiction:

- `work/expanded-outline.md`
- `state/current-scene.md`
- relevant character references
- relevant character state
- `state/recent-prose.md`

Do not load unrelated project files.

If `work/draft.md` is missing or empty, stop and report the pipeline failure.

## Revision Procedure

Perform the revision as one bounded operation:

1. Read the current candidate draft.
2. Identify the minimum textual changes required by the user's request.
3. Produce the complete revised candidate in memory.
4. Preserve unaffected wording, event order, dialogue, and structure as much as
   reasonably possible.
5. If the requested change creates a direct local continuity consequence, make
   only the minimum additional edits needed for internal consistency.
6. Save the complete revised candidate exactly once through
   `save_story_artifact` with `artifact: draft`.
7. After the save succeeds, return control to the calling `story-pipeline`.

Do not perform a section-by-section audit of project files.

Do not repeatedly check whether unrelated sections "also need updating".

Do not use tool failures as a way to test whether content already matches.

Never issue an edit operation whose old and new text are identical.

If the requested change is already satisfied by the current candidate:

- do not modify any other artifact;
- do not perform no-op edit calls;
- keep the current candidate as-is;
- return control to `story-pipeline` and wait for explicit acceptance.

## Revision Principle

Treat the current `work/draft.md` as the sole base text to revise.

Do not regenerate the entire draft merely because a local revision was requested.

Do not introduce unrelated improvements.

Do not perform unsolicited:

- prose polishing;
- style correction;
- tone normalization;
- AI-writing detection or removal;
- plot expansion;
- character reinterpretation;
- scene restructuring.

The user's explicit revision request controls the requested change.
Existing committed story state and stable references remain canon constraints.

## Acceptance Boundary

A materially revised draft is a new candidate version.

Any earlier acceptance, approval, or assumption about the previous candidate must
not be reused for the revised version.

After revision, return to the normal user acceptance stage.

Do not commit the revised draft automatically.

Do not update memory or scene state.

## Output Contract

When a textual revision is required:

- produce the complete revised candidate prose;
- call `save_story_artifact` exactly once with:
  - `artifact`: `draft`
  - `content`: the complete revised candidate prose.

After the tool reports success, return control to the calling `story-pipeline`.

Do not invoke the commit workflow yourself.
