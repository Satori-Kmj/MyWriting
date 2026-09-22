import { createHash, randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'

import { requireMyWritingRoot } from './mywriting-root.ts'

export const name = 'commit-story-draft'

export const inject = [
  'tools',
  'fs',
  'sandboxPolicy',
  'approval',
]

const SOURCE_PATH = 'work/draft.md'
const DRAFT_META_PATH = 'work/draft.meta.json'
const COMMIT_INTENT_PATH = 'work/commit-intent.json'
const CURRENT_COMMIT_PATH = 'state/current-commit.json'
const HISTORY_ROOT = 'history'

interface DraftMetaV1 {
  schema_version: 1
  artifact: 'draft'
  sha256: string
}

interface CommitIntentV1 {
  schema_version: 1
  transaction_id: string
  status: 'approved'
  draft_path: typeof SOURCE_PATH
  draft_sha256: string
  base_commit_id: number | null
  base_manifest_sha256: string | null
  created_at: string
}

interface BaseCommit {
  commitId: number | null
  manifestSha256: string | null
  transactionId: string | null
}

function sha256Text(content: string): string {
  return createHash('sha256')
    .update(content, 'utf8')
    .digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function parseDraftMeta(content: string): DraftMetaV1 {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(
      `candidate draft metadata is not valid JSON: ${DRAFT_META_PATH}`,
    )
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `candidate draft metadata has invalid structure: ${DRAFT_META_PATH}`,
    )
  }

  if (parsed.schema_version !== 1) {
    throw new Error(
      'candidate draft metadata schema_version must be 1',
    )
  }

  if (parsed.artifact !== 'draft') {
    throw new Error(
      'candidate draft metadata artifact must be "draft"',
    )
  }

  if (
    typeof parsed.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(parsed.sha256)
  ) {
    throw new Error(
      'candidate draft metadata sha256 must be a lowercase 64-character hexadecimal digest',
    )
  }

  return {
    schema_version: 1,
    artifact: 'draft',
    sha256: parsed.sha256,
  }
}

function parseCommitIntent(content: string): CommitIntentV1 {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(
      `commit intent is not valid JSON: ${COMMIT_INTENT_PATH}`,
    )
  }

  if (
    !isRecord(parsed) ||
    parsed.schema_version !== 1 ||
    parsed.status !== 'approved' ||
    parsed.draft_path !== SOURCE_PATH ||
    typeof parsed.transaction_id !== 'string' ||
    parsed.transaction_id.length === 0 ||
    typeof parsed.draft_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(parsed.draft_sha256) ||
    typeof parsed.created_at !== 'string' ||
    parsed.created_at.length === 0
  ) {
    throw new Error(
      `commit intent is invalid: ${COMMIT_INTENT_PATH}`,
    )
  }

  if (
    parsed.base_commit_id !== null &&
    (
      typeof parsed.base_commit_id !== 'number' ||
      !Number.isSafeInteger(parsed.base_commit_id) ||
      parsed.base_commit_id <= 0
    )
  ) {
    throw new Error(
      'commit intent base_commit_id must be null or a positive integer',
    )
  }

  if (
    parsed.base_manifest_sha256 !== null &&
    (
      typeof parsed.base_manifest_sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(
        parsed.base_manifest_sha256,
      )
    )
  ) {
    throw new Error(
      'commit intent base_manifest_sha256 must be null or a SHA-256 digest',
    )
  }

  return parsed as unknown as CommitIntentV1
}

async function discoverBaseCommit(
  ctx: Context,
  cwd: string,
  workspace: Awaited<ReturnType<Context['fs']['resolve']>>,
  signal: AbortSignal | undefined,
): Promise<BaseCommit> {
  const history = await ctx.fs.resolve(HISTORY_ROOT, {
    cwd,
    signal,
  })

  if (!ctx.fs.contains(workspace, history)) {
    throw new Error(
      `history root escaped workspace: ${history.displayPath}`,
    )
  }

  const historyInfo = await ctx.fs.stat(history, signal)

  if (historyInfo === undefined) {
    return {
      commitId: null,
      manifestSha256: null,
      transactionId: null,
    }
  }

  if (historyInfo.type !== 'directory') {
    throw new Error(
      `${HISTORY_ROOT} exists but is not a directory`,
    )
  }

  const entries = await ctx.fs.listDir(history, signal)

  let latestId: number | null = null
  let latestManifestSha256: string | null = null
  let latestTransactionId: string | null = null

  for (const entry of entries) {
    if (
      entry.type !== 'directory' ||
      !/^\d{4,}$/.test(entry.name)
    ) {
      continue
    }

    const commitId = Number.parseInt(entry.name, 10)

    if (
      !Number.isSafeInteger(commitId) ||
      commitId <= 0
    ) {
      continue
    }

    const manifestPath =
      `${HISTORY_ROOT}/${entry.name}/manifest.json`

    const manifestTarget = await ctx.fs.resolve(
      manifestPath,
      {
        cwd,
        signal,
      },
    )

    if (
      !ctx.fs.contains(
        workspace,
        manifestTarget,
      )
    ) {
      throw new Error(
        `history manifest escaped workspace: ${manifestTarget.displayPath}`,
      )
    }

    const manifestInfo = await ctx.fs.stat(
      manifestTarget,
      signal,
    )

    if (
      manifestInfo === undefined ||
      manifestInfo.type !== 'file'
    ) {
      continue
    }

    const manifestContent = await ctx.fs.readText(
      manifestTarget,
      signal,
    )

    let parsed: unknown

    try {
      parsed = JSON.parse(manifestContent)
    } catch {
      continue
    }

    if (
      !isRecord(parsed) ||
      parsed.commit_id !== commitId ||
      parsed.status !== 'committed'
    ) {
      continue
    }

    if (
      latestId === null ||
      commitId > latestId
    ) {
      latestId = commitId
      latestManifestSha256 =
        sha256Text(manifestContent)
      latestTransactionId =
        typeof parsed.transaction_id === 'string' &&
        parsed.transaction_id.length > 0
          ? parsed.transaction_id
          : null
    }
  }

  return {
    commitId: latestId,
    manifestSha256: latestManifestSha256,
    transactionId: latestTransactionId,
  }
}

async function isTransactionMaterialized(
  ctx: Context,
  cwd: string,
  workspace: Awaited<ReturnType<Context['fs']['resolve']>>,
  base: BaseCommit,
  transactionId: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (
    base.commitId === null ||
    base.manifestSha256 === null ||
    base.transactionId !== transactionId
  ) {
    return false
  }

  const markerTarget = await ctx.fs.resolve(
    CURRENT_COMMIT_PATH,
    {
      cwd,
      signal,
    },
  )

  if (!ctx.fs.contains(workspace, markerTarget)) {
    throw new Error(
      `current commit marker escaped workspace: ${markerTarget.displayPath}`,
    )
  }

  const markerInfo = await ctx.fs.stat(
    markerTarget,
    signal,
  )

  if (
    markerInfo === undefined ||
    markerInfo.type !== 'file'
  ) {
    return false
  }

  let marker: unknown

  try {
    marker = JSON.parse(
      await ctx.fs.readText(
        markerTarget,
        signal,
      ),
    )
  } catch {
    return false
  }

  return (
    isRecord(marker) &&
    marker.commit_id === base.commitId &&
    marker.manifest_sha256 ===
      base.manifestSha256 &&
    marker.transaction_id === transactionId
  )
}

export function apply(ctx: Context) {
  console.log('[commit-story-draft] plugin loaded!')

  ctx.tools.register(defineTool({
    name: 'commit_story_draft',

    description:
      'Approve the exact current MyWriting candidate draft for the commit workflow. ' +
      'This verifies work/draft.md against work/draft.meta.json, requests one-shot user approval, ' +
      'then creates work/commit-intent.json bound to that exact draft and current history base. ' +
      'It does not publish story canon or modify output/state/history.',

    parameters: {},

    output: {
      schema: {
        type: 'object',
        additionalProperties: false,

        properties: {
          intent_path: {
            type: 'string',
            required: true,
          },

          transaction_id: {
            type: 'string',
            required: true,
          },

          draft_sha256: {
            type: 'string',
            required: true,
          },

          base_commit_id: {
            type: 'integer',
            required: true,
          },

          base_manifest_sha256: {
            type: 'string',
            required: true,
          },

          approved: {
            type: 'boolean',
            required: true,
          },

          verified: {
            type: 'boolean',
            required: true,
          },
        },
      },

      render: (_args, value) => [
        {
          type: 'text',
          text:
            `Commit intent created: ${value.intent_path}\n` +
            `Transaction: ${value.transaction_id}\n` +
            `Draft SHA-256: ${value.draft_sha256}\n` +
            `Base commit: ${
              value.base_commit_id === 0
                ? 'none'
                : value.base_commit_id
            }\n` +
            `Approved: ${value.approved}\n` +
            `Verified: ${value.verified}`,
        },
      ],
    },

    async execute(_args, exec) {
      const agent = exec.agent

      if (agent === undefined) {
        throw new Error(
          'commit_story_draft requires an active agent session',
        )
      }

      const session = agent.session

      const sessionCwd = session.header.cwd

      if (
        sessionCwd === undefined ||
        sessionCwd.length === 0
      ) {
        throw new Error(
          'commit_story_draft requires a workspace cwd',
        )
      }

      const cwd = requireMyWritingRoot(sessionCwd)

      const workspace = await ctx.fs.resolve(
        cwd,
        {
          signal: exec.signal,
        },
      )

      const source = await ctx.fs.resolve(
        SOURCE_PATH,
        {
          cwd,
          signal: exec.signal,
        },
      )

      const draftMetaTarget = await ctx.fs.resolve(
        DRAFT_META_PATH,
        {
          cwd,
          signal: exec.signal,
        },
      )

      const intentTarget = await ctx.fs.resolve(
        COMMIT_INTENT_PATH,
        {
          cwd,
          signal: exec.signal,
        },
      )

      for (
        const [label, target] of [
          ['candidate draft', source],
          ['candidate draft metadata', draftMetaTarget],
          ['commit intent', intentTarget],
        ] as const
      ) {
        if (!ctx.fs.contains(workspace, target)) {
          throw new Error(
            `${label} escaped workspace: ${target.displayPath}`,
          )
        }
      }

      const sourceInfo = await ctx.fs.stat(
        source,
        exec.signal,
      )

      if (
        sourceInfo === undefined ||
        sourceInfo.type !== 'file'
      ) {
        throw new Error(
          `candidate draft does not exist: ${SOURCE_PATH}`,
        )
      }

      const draftMetaInfo = await ctx.fs.stat(
        draftMetaTarget,
        exec.signal,
      )

      if (
        draftMetaInfo === undefined ||
        draftMetaInfo.type !== 'file'
      ) {
        throw new Error(
          `candidate draft metadata does not exist: ${DRAFT_META_PATH}`,
        )
      }

      const content = await ctx.fs.readText(
        source,
        exec.signal,
      )

      if (content.trim().length === 0) {
        throw new Error(
          'candidate draft is empty and cannot enter the commit workflow',
        )
      }

      const draftMetaContent = await ctx.fs.readText(
        draftMetaTarget,
        exec.signal,
      )

      const draftMeta =
        parseDraftMeta(draftMetaContent)

      const sourceSha256 =
        sha256Text(content)

      if (sourceSha256 !== draftMeta.sha256) {
        throw new Error(
          'candidate draft version mismatch: work/draft.md no longer matches work/draft.meta.json',
        )
      }

      const base = await discoverBaseCommit(
        ctx,
        cwd,
        workspace,
        exec.signal,
      )

      let intentBeforeApproval:
        | string
        | undefined
      let replacementNotice = ''

      const existingIntentInfo =
        await ctx.fs.stat(
          intentTarget,
          exec.signal,
        )

      if (existingIntentInfo !== undefined) {
        if (existingIntentInfo.type !== 'file') {
          throw new Error(
            `${COMMIT_INTENT_PATH} exists but is not a file`,
          )
        }

        intentBeforeApproval =
          await ctx.fs.readText(
            intentTarget,
            exec.signal,
          )

        const existingIntent =
          parseCommitIntent(
            intentBeforeApproval,
          )

        if (
          existingIntent.draft_sha256 ===
            sourceSha256 &&
          existingIntent.base_commit_id ===
            base.commitId &&
          existingIntent.base_manifest_sha256 ===
            base.manifestSha256
        ) {
          return {
            intent_path: COMMIT_INTENT_PATH,
            transaction_id:
              existingIntent.transaction_id,
            draft_sha256:
              existingIntent.draft_sha256,
            base_commit_id:
              existingIntent.base_commit_id ?? 0,
            base_manifest_sha256:
              existingIntent.base_manifest_sha256 ?? '',
            approved: true,
            verified: true,
          }
        }

        if (
          base.transactionId ===
          existingIntent.transaction_id
        ) {
          const materialized =
            await isTransactionMaterialized(
              ctx,
              cwd,
              workspace,
              base,
              existingIntent.transaction_id,
              exec.signal,
            )

          if (!materialized) {
            throw new Error(
              'the existing transaction is already published but its working copy is not synchronized; retry commit_story_update instead of creating a new commit intent',
            )
          }
        } else {
          replacementNotice =
            ` This approval will supersede pending transaction ${existingIntent.transaction_id}.`
        }
      }

      const approvalOutcome =
        await ctx.approval.request({
          agent,
          toolName: 'commit_story_draft',
          callId: exec.callId,
          reason:
            `Candidate draft ${sourceSha256.slice(0, 12)}… is ready to enter the commit workflow. ` +
            `Current committed history base: ${
              base.commitId === null
                ? 'none'
                : base.commitId
            }. ` +
            'Allow once to approve this exact candidate for memory/scene generation and final commit; ' +
            'reject to keep it as an unapproved candidate.' +
            replacementNotice,
          signal: exec.signal,
        })

      if (approvalOutcome !== 'allowed-once') {
        throw new Error(
          `commit_story_draft was not approved by the user (approval outcome: ${approvalOutcome})`,
        )
      }

      // Re-read after approval so an approval cannot silently bind
      // to a candidate that changed while the approval UI was open.
      const contentAfterApproval =
        await ctx.fs.readText(
          source,
          exec.signal,
        )

      const metaAfterApproval =
        parseDraftMeta(
          await ctx.fs.readText(
            draftMetaTarget,
            exec.signal,
          ),
        )

      const shaAfterApproval =
        sha256Text(contentAfterApproval)

      if (
        shaAfterApproval !== sourceSha256 ||
        metaAfterApproval.sha256 !== sourceSha256
      ) {
        throw new Error(
          'candidate draft changed during approval; request fresh approval for the current candidate',
        )
      }

      const baseAfterApproval =
        await discoverBaseCommit(
          ctx,
          cwd,
          workspace,
          exec.signal,
        )

      if (
        baseAfterApproval.commitId !== base.commitId ||
        baseAfterApproval.manifestSha256 !==
          base.manifestSha256
      ) {
        throw new Error(
          'story history changed during approval; request fresh approval against the new base commit',
        )
      }

      const intentInfoAfterApproval =
        await ctx.fs.stat(
          intentTarget,
          exec.signal,
        )

      const intentAfterApproval =
        intentInfoAfterApproval === undefined
          ? undefined
          : intentInfoAfterApproval.type === 'file'
            ? await ctx.fs.readText(
                intentTarget,
                exec.signal,
              )
            : null

      if (
        intentAfterApproval !==
        intentBeforeApproval
      ) {
        throw new Error(
          'commit intent changed during approval; inspect the current transaction before retrying',
        )
      }

      const policy =
        ctx.sandboxPolicy.resolve({
          session,
        })

      if (policy.mode === 'read-only') {
        throw new Error(
          'commit_story_draft cannot run in read-only mode',
        )
      }

      const intent: CommitIntentV1 = {
        schema_version: 1,
        transaction_id: randomUUID(),
        status: 'approved',
        draft_path: SOURCE_PATH,
        draft_sha256: sourceSha256,
        base_commit_id: base.commitId,
        base_manifest_sha256:
          base.manifestSha256,
        created_at: new Date().toISOString(),
      }

      const intentContent =
        `${JSON.stringify(intent, null, 2)}\n`

      await ctx.fs.writeText(
        intentTarget,
        intentContent,
        undefined,
        exec.signal,
        policy,
      )

      const savedIntent =
        await ctx.fs.readText(
          intentTarget,
          exec.signal,
        )

      if (savedIntent !== intentContent) {
        throw new Error(
          'commit intent verification failed after save',
        )
      }

      return {
        intent_path: COMMIT_INTENT_PATH,
        transaction_id:
          intent.transaction_id,
        draft_sha256:
          intent.draft_sha256,
        base_commit_id:
          intent.base_commit_id ?? 0,
        base_manifest_sha256:
          intent.base_manifest_sha256 ?? '',
        approved: true,
        verified: true,
      }
    },
  }))
}
