---
name: outline-expansion
description: Expand a user-provided rough story outline into a concise event plan for prose generation while preserving plot intent, logical continuity, and physical consistency.
---

# Outline Expansion

Convert the user's rough outline into a concise and mechanically clear
story plan.

The expanded outline is an intermediate planning artifact.

It is not prose.

It should be deliberately simple, factual, and difficult to copy directly
into literary prose.

## Primary Responsibilities

Preserve:

- intended events;
- event order;
- intended outcomes;
- important user-specified details;
- explicit user constraints.

You may add only what is necessary to make the requested events logically
and physically possible, including:

- necessary intermediate actions;
- necessary reactions that affect later events;
- physical movement required for continuity;
- information transfer required for a character to know something;
- simple causal connections required to prevent logical contradictions.

Do not add material only to make the outline more vivid, emotional,
literary, atmospheric, or complete.

## Output Format

For each scene, use this format:

场景：<时间 / 地点 / 与上一场景的连续关系>
人物：<实际参与当前场景的角色>

1. <一个动作、互动、事实变化或结果>
2. <一个动作、互动、事实变化或结果>
3. <一个动作、互动、事实变化或结果>

控制信息：
- <仅在必要时记录隐含意图、信息限制或行为限制>

Keep each numbered step to approximately one sentence.

Normally use 3–6 numbered steps unless the user's requested plot requires
otherwise.

The `控制信息` section is optional.

Omit it when no hidden intent or special constraint is needed.

## Event-Step Rules

Each numbered step should describe only:

- what happens;
- who acts;
- what changes;
- what result becomes true.

Prefer concrete event facts.


## Control Information

Use `控制信息` only when the Writer must know something that should not
normally be stated directly in prose.



Control information exists to constrain character behavior.

It is not dialogue, narration, internal monologue, or prose content.

Do not phrase control information as literary description.

## Forbidden Planning Content

Do not create sections or statements such as:

- 结尾状态;
- 场景意义;
- 场景效果;
- 情绪总结;
- 关系总结;
- 人物成长总结;
- 整体评价;
- 后续发展空间;
- 为下一幕留下伏笔;
- 重点表现某种抽象心理变化.

Do not summarize the meaning of a sequence of events.

Do not explain what the reader should understand from a character's
actions.

Do not add future-story suggestions unless the user explicitly requested
future plot planning.

## Style Restrictions for the Outline

Do not write:

- environmental atmosphere for literary effect;
- decorative sensory description;
- metaphor;
- prose-style internal monologue;
- prose-style dialogue unless the user explicitly requires exact dialogue;
- rhetorical or emotional embellishment.

Environmental information may appear only when it is an actual event
constraint or required story fact.

## Previous Scene Context

Before expanding the rough outline, check whether:

`state/current-scene.md`

exists.

If it exists, read it.

Treat it as the physical and situational starting state of the story.

If the new rough outline directly continues the previous scene:

- preserve location;
- preserve time continuity;
- preserve character positions and postures unless events change them;
- preserve held objects and contact states;
- preserve unresolved physical circumstances.

Do not restart or re-establish the scene merely because a new generation
has started.

If the rough outline explicitly establishes a different time, location,
or separate scene, accept that as the new scene state.

Do not invent a transition between substantially different scenes unless:

- the user requests the transition; or
- the transition itself is necessary to satisfy an explicitly continuous
  sequence of events.

A location or time change may represent a scene cut.

## Project Knowledge

Use project character references and current story state when needed to
avoid:

- impossible actions;
- knowledge a character cannot possess;
- contradictory physical states;
- incorrect character participation;
- conflicts with established story facts.

Do not use the outline to add unrelated character development or
persistent state changes.

## Output Contract

Save the complete expanded outline using `save_story_artifact`.

Use:

- `artifact`: `expanded-outline`
- `content`: the complete expanded outline

Do not use generic `write` or `edit`.

Do not begin prose writing during this stage.

Do not update story memory or story state.