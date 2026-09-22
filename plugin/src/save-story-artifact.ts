import { createHash } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

import { requireMyWritingRoot } from './mywriting-root.ts'

export const name = 'save-story-artifact'

export const inject = [
  'tools',
  'fs',
  'sandboxPolicy',
]

const ARTIFACT_PATHS = {
  'rough-outline': 'input/rough-outline.md',
  'expanded-outline': 'work/expanded-outline.md',
  'draft': 'work/draft.md',
  'memory-patch': 'work/memory-patch.json',
  'scene-checkpoint': 'work/scene-checkpoint.md',
} as const

const DRAFT_META_PATH = 'work/draft.meta.json'
const COMMIT_INTENT_PATH = 'work/commit-intent.json'

const TRANSACTION_META_PATHS = {
  'memory-patch': 'work/memory-patch.meta.json',
  'scene-checkpoint': 'work/scene-checkpoint.meta.json',
} as const

type TransactionArtifact =
  keyof typeof TRANSACTION_META_PATHS

interface CommitIntentV1 {
  schema_version: 1
  transaction_id: string
  status: 'approved'
  draft_path: 'work/draft.md'
  draft_sha256: string
  base_commit_id: number | null
  base_manifest_sha256: string | null
  created_at: string
}

function sha256Text(content: string): string {
  return createHash('sha256')
    .update(content, 'utf8')
    .digest('hex')
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function isSha256(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{64}$/.test(value)
  )
}

function parseCommitIntent(
  content: string,
): CommitIntentV1 {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(
      `commit intent is not valid JSON: ${COMMIT_INTENT_PATH}`,
    )
  }

  if (!isRecord(parsed)) {
    throw new Error(
      'commit intent root must be an object',
    )
  }

  if (parsed.schema_version !== 1) {
    throw new Error(
      'unsupported commit intent schema_version',
    )
  }

  if (
    typeof parsed.transaction_id !== 'string' ||
    parsed.transaction_id.length === 0
  ) {
    throw new Error(
      'commit intent transaction_id must be a non-empty string',
    )
  }

  if (parsed.status !== 'approved') {
    throw new Error(
      'commit intent status must be approved',
    )
  }

  if (parsed.draft_path !== 'work/draft.md') {
    throw new Error(
      'commit intent draft_path must be work/draft.md',
    )
  }

  if (!isSha256(parsed.draft_sha256)) {
    throw new Error(
      'commit intent draft_sha256 is invalid',
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
    !isSha256(parsed.base_manifest_sha256)
  ) {
    throw new Error(
      'commit intent base_manifest_sha256 must be null or a SHA-256 digest',
    )
  }

  if (
    typeof parsed.created_at !== 'string' ||
    parsed.created_at.length === 0
  ) {
    throw new Error(
      'commit intent created_at must be a non-empty string',
    )
  }

  return parsed as unknown as CommitIntentV1
}

function isTransactionArtifact(
  artifact: keyof typeof ARTIFACT_PATHS,
): artifact is TransactionArtifact {
  return (
    artifact === 'memory-patch' ||
    artifact === 'scene-checkpoint'
  )
}

export function apply(ctx: Context) {
  console.log('[save-story-artifact] plugin loaded!')

  ctx.tools.register(defineTool({
    name: 'save_story_artifact',

    description:
      'Save a MyWriting pipeline artifact. ' +
      'Rough outlines capture the exact input for a new pipeline run. ' +
      'Drafts receive SHA-256 identity metadata. ' +
      'Memory patches and scene checkpoints are mechanically bound to the current approved commit transaction.',

    parameters: {
      artifact: {
        type: 'string',
        required: true,
        enum: [
          'rough-outline',
          'expanded-outline',
          'draft',
          'memory-patch',
          'scene-checkpoint',
        ],
        description:
          'The pipeline artifact to save.',
      },

      content: {
        type: 'string',
        required: true,
        description:
          'The complete content of the artifact.',
      },
    },

    output: {
      schema: {
        type: 'object',
        additionalProperties: false,

        properties: {
          artifact: {
            type: 'string',
            required: true,
            enum: [
              'rough-outline',
              'expanded-outline',
              'draft',
              'memory-patch',
              'scene-checkpoint',
            ],
          },

          path: {
            type: 'string',
            required: true,
          },

          operation: {
            type: 'string',
            required: true,
            enum: [
              'create',
              'update',
            ],
          },

          characters: {
            type: 'integer',
            required: true,
          },

          sha256: {
            type: 'string',
            required: true,
          },

          transaction_bound: {
            type: 'boolean',
            required: true,
          },
        },
      },

      render: (_args, value) => [
        {
          type: 'text',
          text:
            `Saved ${value.artifact} to ${value.path} ` +
            `(${value.operation}, ${value.characters} characters).\n` +
            `SHA-256: ${value.sha256}\n` +
            `Transaction bound: ${value.transaction_bound}`,
        },
      ],
    },

    async execute(args, exec) {
      if (args.content.length === 0) {
        throw new Error(
          'artifact content must not be empty',
        )
      }

      const session = exec.agent?.session

      if (session === undefined) {
        throw new Error(
          'save_story_artifact requires an active agent session',
        )
      }

      const sessionCwd = session.header.cwd

      if (
        sessionCwd === undefined ||
        sessionCwd.length === 0
      ) {
        throw new Error(
          'save_story_artifact requires a workspace cwd',
        )
      }

      const cwd = requireMyWritingRoot(sessionCwd)

      const relativePath =
        ARTIFACT_PATHS[args.artifact]

      const policy =
        ctx.sandboxPolicy.resolve({
          session,
        })

      if (policy.mode === 'read-only') {
        throw new Error(
          'save_story_artifact cannot write while the session is read-only',
        )
      }

      const workspaceTarget =
        await ctx.fs.resolve(
          cwd,
          {
            signal: exec.signal,
          },
        )

      const target =
        await ctx.fs.resolve(
          relativePath,
          {
            cwd,
            signal: exec.signal,
          },
        )

      if (
        !ctx.fs.contains(
          workspaceTarget,
          target,
        )
      ) {
        throw new Error(
          `artifact target escaped the workspace: ${target.displayPath}`,
        )
      }

      let commitIntent:
        | CommitIntentV1
        | undefined

      // Transaction-bound artifacts may only be saved
      // after explicit approval of the exact current draft.
      if (isTransactionArtifact(args.artifact)) {
        const intentTarget =
          await ctx.fs.resolve(
            COMMIT_INTENT_PATH,
            {
              cwd,
              signal: exec.signal,
            },
          )

        if (
          !ctx.fs.contains(
            workspaceTarget,
            intentTarget,
          )
        ) {
          throw new Error(
            `commit intent escaped the workspace: ${intentTarget.displayPath}`,
          )
        }

        const intentInfo =
          await ctx.fs.stat(
            intentTarget,
            exec.signal,
          )

        if (
          intentInfo === undefined ||
          intentInfo.type !== 'file'
        ) {
          throw new Error(
            `approved commit intent does not exist: ${COMMIT_INTENT_PATH}`,
          )
        }

        commitIntent =
          parseCommitIntent(
            await ctx.fs.readText(
              intentTarget,
              exec.signal,
            ),
          )

        const draftTarget =
          await ctx.fs.resolve(
            'work/draft.md',
            {
              cwd,
              signal: exec.signal,
            },
          )

        const draftMetaTarget =
          await ctx.fs.resolve(
            DRAFT_META_PATH,
            {
              cwd,
              signal: exec.signal,
            },
          )

        const draftInfo =
          await ctx.fs.stat(
            draftTarget,
            exec.signal,
          )

        const draftMetaInfo =
          await ctx.fs.stat(
            draftMetaTarget,
            exec.signal,
          )

        if (
          draftInfo === undefined ||
          draftInfo.type !== 'file' ||
          draftMetaInfo === undefined ||
          draftMetaInfo.type !== 'file'
        ) {
          throw new Error(
            'approved candidate draft or its metadata is missing',
          )
        }

        const draftContent =
          await ctx.fs.readText(
            draftTarget,
            exec.signal,
          )

        const currentDraftSha =
          sha256Text(draftContent)

        let draftMetaParsed: unknown

        try {
          draftMetaParsed = JSON.parse(
            await ctx.fs.readText(
              draftMetaTarget,
              exec.signal,
            ),
          )
        } catch {
          throw new Error(
            `candidate draft metadata is not valid JSON: ${DRAFT_META_PATH}`,
          )
        }

        if (
          !isRecord(draftMetaParsed) ||
          draftMetaParsed.schema_version !== 1 ||
          draftMetaParsed.artifact !== 'draft' ||
          !isSha256(draftMetaParsed.sha256)
        ) {
          throw new Error(
            `candidate draft metadata is invalid: ${DRAFT_META_PATH}`,
          )
        }

        if (
          currentDraftSha !==
            draftMetaParsed.sha256 ||
          currentDraftSha !==
            commitIntent.draft_sha256
        ) {
          throw new Error(
            'approved candidate changed after commit intent was created; return to Stage 3 and obtain fresh acceptance',
          )
        }
      }

      const outcome =
        await ctx.fs.writeText(
          target,
          args.content,
          undefined,
          exec.signal,
          policy,
        )

      const savedContent =
        await ctx.fs.readText(
          target,
          exec.signal,
        )

      if (savedContent !== args.content) {
        throw new Error(
          `${args.artifact} verification failed after save`,
        )
      }

      const artifactSha256 =
        sha256Text(savedContent)

      if (args.artifact === 'draft') {
        const draftMeta =
          `${JSON.stringify(
            {
              schema_version: 1,
              artifact: 'draft',
              sha256: artifactSha256,
            },
            null,
            2,
          )}\n`

        const draftMetaTarget =
          await ctx.fs.resolve(
            DRAFT_META_PATH,
            {
              cwd,
              signal: exec.signal,
            },
          )

        if (
          !ctx.fs.contains(
            workspaceTarget,
            draftMetaTarget,
          )
        ) {
          throw new Error(
            `draft metadata target escaped the workspace: ${draftMetaTarget.displayPath}`,
          )
        }

        await ctx.fs.writeText(
          draftMetaTarget,
          draftMeta,
          undefined,
          exec.signal,
          policy,
        )

        const savedMeta =
          await ctx.fs.readText(
            draftMetaTarget,
            exec.signal,
          )

        if (savedMeta !== draftMeta) {
          throw new Error(
            'draft metadata verification failed after save',
          )
        }
      }

      if (
        isTransactionArtifact(args.artifact)
      ) {
        if (commitIntent === undefined) {
          throw new Error(
            'internal error: missing commit intent for transaction artifact',
          )
        }

        const metaPath =
          TRANSACTION_META_PATHS[
            args.artifact
          ]

        const metaTarget =
          await ctx.fs.resolve(
            metaPath,
            {
              cwd,
              signal: exec.signal,
            },
          )

        if (
          !ctx.fs.contains(
            workspaceTarget,
            metaTarget,
          )
        ) {
          throw new Error(
            `transaction metadata target escaped the workspace: ${metaTarget.displayPath}`,
          )
        }

        const metaContent =
          `${JSON.stringify(
            {
              schema_version: 1,
              artifact: args.artifact,
              transaction_id:
                commitIntent.transaction_id,
              base_commit_id:
                commitIntent.base_commit_id,
              base_manifest_sha256:
                commitIntent.base_manifest_sha256,
              draft_sha256:
                commitIntent.draft_sha256,
              artifact_sha256:
                artifactSha256,
              created_at:
                new Date().toISOString(),
            },
            null,
            2,
          )}\n`

        await ctx.fs.writeText(
          metaTarget,
          metaContent,
          undefined,
          exec.signal,
          policy,
        )

        const savedMeta =
          await ctx.fs.readText(
            metaTarget,
            exec.signal,
          )

        if (savedMeta !== metaContent) {
          throw new Error(
            `${args.artifact} transaction metadata verification failed after save`,
          )
        }
      }

      return {
        artifact: args.artifact,
        path: relativePath,
        operation: outcome.operation,
        characters:
          Array.from(savedContent).length,
        sha256: artifactSha256,
        transaction_bound:
          isTransactionArtifact(
            args.artifact,
          ),
      }
    },
  }))
}
