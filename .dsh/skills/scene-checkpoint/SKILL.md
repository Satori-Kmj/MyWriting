---
name: scene-checkpoint
description: "Generate the end-of-scene physical and situational snapshot for the exact candidate draft approved for the current commit transaction."
---

# Scene Checkpoint

Use this skill only after the current candidate has received explicit user
acceptance and `commit_story_draft` has successfully created:

`work/commit-intent.json`

The purpose of this skill is to prepare the pending transaction's end-of-scene
physical and situational snapshot.

This is not a story summary and not a character-memory update.

## Required Input

Read:

1. `work/draft.md`
2. `state/current-scene.md` if it already exists

`work/draft.md` is the story content approved for the current transaction.

Do not use `output/accepted-draft.md` as the source for this pending transaction.

The previous current-scene file is only the starting physical state.

## Continuity Rule

If the approved draft directly continues the previous scene:

- preserve unchanged physical and environmental facts when they are still
  clearly valid;
- update facts that changed;
- remove facts that explicitly ceased to apply.

If the approved draft establishes a new location, time period, or clearly
separate scene:

- do not carry transient physical details from the previous scene;
- construct a new scene snapshot from the approved draft.

Do not preserve old scene facts when their continued validity is uncertain.

## Output Purpose

Record only information needed to correctly begin the next scene.

Use exactly these sections:

# 当前场景状态

## 时间

## 地点

## 在场人物

## 人物位置与姿态

## 持有物与接触状态

## 关键物体与环境状态

## 最后发生的动作与对话

## 当前未解决事项

## Rules

Use concrete factual statements.

Do not include:

- literary description;
- emotional interpretation;
- relationship summaries;
- predictions;
- symbolism;
- future plot speculation;
- stable character appearance;
- information already belonging only to character memory.

Do not use pretrained model knowledge to fill missing story facts.

If a detail cannot be established from project canon, omit it.

Keep the checkpoint concise.

Save the complete checkpoint using `save_story_artifact` with:

- `artifact`: `scene-checkpoint`
- `content`: the complete checkpoint

`save_story_artifact` mechanically binds the saved checkpoint to the current
transaction and approved draft.

Do not directly modify `state/current-scene.md`.

After the checkpoint is saved successfully, return control to the calling
`story-pipeline`.
