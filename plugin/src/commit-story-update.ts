import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

import { requireMyWritingRoot } from './mywriting-root.ts'

export const name = 'commit-story-update'
export const inject = ['tools', 'fs', 'sandboxPolicy']

const DRAFT_PATH = 'work/draft.md'
const DRAFT_META_PATH = 'work/draft.meta.json'
const COMMIT_INTENT_PATH = 'work/commit-intent.json'
const MEMORY_PATCH_PATH = 'work/memory-patch.json'
const MEMORY_META_PATH = 'work/memory-patch.meta.json'
const SCENE_PATH = 'work/scene-checkpoint.md'
const SCENE_META_PATH = 'work/scene-checkpoint.meta.json'

const HISTORY_ROOT = 'history'
const ACCEPTED_DRAFT_PATH = 'output/accepted-draft.md'
const CURRENT_SCENE_PATH = 'state/current-scene.md'
const RECENT_PROSE_PATH = 'state/recent-prose.md'
const CURRENT_COMMIT_PATH = 'state/current-commit.json'
const RAG_ROOT = 'state/rag'
const CHARACTER_STATE_SUFFIX = '状态.md'

const REQUIRED_SCENE_HEADINGS = [
  '# 当前场景状态',
  '## 时间',
  '## 地点',
  '## 在场人物',
  '## 人物位置与姿态',
  '## 持有物与接触状态',
  '## 关键物体与环境状态',
  '## 最后发生的动作与对话',
  '## 当前未解决事项',
] as const

const ALLOWED_SECTIONS = [
  '身体状态',
  '心情',
  '关系态度',
  '认知 / 知识 / 怀疑',
  '当前目标 / 意图',
  '持续心理状态',
  '当前约束',
] as const

type StateSection = typeof ALLOWED_SECTIONS[number]
type FsTarget = Awaited<ReturnType<Context['fs']['resolve']>>
type Policy = ReturnType<Context['sandboxPolicy']['resolve']>

export function isCharacterStateFilename(filename: string): boolean {
  return (
    filename.length > CHARACTER_STATE_SUFFIX.length &&
    filename.endsWith(CHARACTER_STATE_SUFFIX)
  )
}

type PatchOperation = {
  op: 'add' | 'replace' | 'remove'
  section: StateSection
  old_value?: string
  value?: string
  evidence: string
}

type CharacterUpdate = {
  character: string
  changes: PatchOperation[]
}

type MemoryPatch = {
  schema_version: 1
  source: 'work/draft.md'
  updates: CharacterUpdate[]
}

type CommitIntent = {
  schema_version: 1
  transaction_id: string
  status: 'approved'
  draft_path: 'work/draft.md'
  draft_sha256: string
  base_commit_id: number | null
  base_manifest_sha256: string | null
  created_at: string
}

type TransactionMeta = {
  schema_version: 1
  artifact: 'memory-patch' | 'scene-checkpoint'
  transaction_id: string
  base_commit_id: number | null
  base_manifest_sha256: string | null
  draft_sha256: string
  artifact_sha256: string
  created_at: string
}

type ManifestEntry = {
  sha256: string
  characters: number
}

type StoryManifest = {
  schema_version: 1
  commit_id: number
  parent_commit_id: number | null
  status: 'committed'
  created_at: string
  character_state_schema_version: 1
  transaction_id?: string
  source_draft_sha256?: string
  base_manifest_sha256?: string | null
  files: Record<string, ManifestEntry>
}

type LatestCommit = {
  commitId: number
  commitName: string
  manifest: StoryManifest
  manifestContent: string
  manifestSha256: string
}

type SnapshotFile = {
  path: string
  content: string
  sha256: string
  characters: number
}

function sha256Text(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function charCount(content: string): number {
  return Array.from(content).length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const result = value.trim()
  if (!result) throw new Error(`${field} must not be empty`)
  if (result.includes('\n') || result.includes('\r')) {
    throw new Error(`${field} must be a single line`)
  }
  return result
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireString(value, field)
}

function formatCommitId(id: number): string {
  return String(id).padStart(4, '0')
}

function parseJsonObject(content: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (!isRecord(parsed)) throw new Error(`${label} root must be an object`)
  return parsed
}

function parseDraftMeta(content: string): { sha256: string } {
  const value = parseJsonObject(content, 'draft metadata')
  if (value.schema_version !== 1 || value.artifact !== 'draft' || !isSha(value.sha256)) {
    throw new Error(`candidate draft metadata is invalid: ${DRAFT_META_PATH}`)
  }
  return { sha256: value.sha256 }
}

function parseCommitIntent(content: string): CommitIntent {
  const value = parseJsonObject(content, 'commit intent')
  if (value.schema_version !== 1) throw new Error('unsupported commit intent schema_version')
  if (value.status !== 'approved') throw new Error('commit intent status must be approved')
  if (value.draft_path !== DRAFT_PATH) throw new Error(`commit intent draft_path must be ${DRAFT_PATH}`)
  if (!isSha(value.draft_sha256)) throw new Error('commit intent draft_sha256 is invalid')
  if (
    value.base_commit_id !== null &&
    (typeof value.base_commit_id !== 'number' || !Number.isSafeInteger(value.base_commit_id) || value.base_commit_id <= 0)
  ) {
    throw new Error('commit intent base_commit_id must be null or a positive integer')
  }
  if (value.base_manifest_sha256 !== null && !isSha(value.base_manifest_sha256)) {
    throw new Error('commit intent base_manifest_sha256 must be null or a SHA-256 digest')
  }
  return {
    schema_version: 1,
    transaction_id: requireString(value.transaction_id, 'commit intent transaction_id'),
    status: 'approved',
    draft_path: DRAFT_PATH,
    draft_sha256: value.draft_sha256,
    base_commit_id: value.base_commit_id as number | null,
    base_manifest_sha256: value.base_manifest_sha256 as string | null,
    created_at: requireString(value.created_at, 'commit intent created_at'),
  }
}

function parseTransactionMeta(
  content: string,
  artifact: 'memory-patch' | 'scene-checkpoint',
): TransactionMeta {
  const value = parseJsonObject(content, `${artifact} metadata`)
  if (value.schema_version !== 1 || value.artifact !== artifact) {
    throw new Error(`${artifact} metadata has invalid schema or artifact`)
  }
  if (!isSha(value.draft_sha256) || !isSha(value.artifact_sha256)) {
    throw new Error(`${artifact} metadata contains an invalid SHA-256`)
  }
  if (
    value.base_commit_id !== null &&
    (typeof value.base_commit_id !== 'number' || !Number.isSafeInteger(value.base_commit_id) || value.base_commit_id <= 0)
  ) {
    throw new Error(`${artifact} base_commit_id is invalid`)
  }
  if (value.base_manifest_sha256 !== null && !isSha(value.base_manifest_sha256)) {
    throw new Error(`${artifact} base_manifest_sha256 is invalid`)
  }
  return {
    schema_version: 1,
    artifact,
    transaction_id: requireString(value.transaction_id, `${artifact} transaction_id`),
    base_commit_id: value.base_commit_id as number | null,
    base_manifest_sha256: value.base_manifest_sha256 as string | null,
    draft_sha256: value.draft_sha256,
    artifact_sha256: value.artifact_sha256,
    created_at: requireString(value.created_at, `${artifact} created_at`),
  }
}

function parseManifest(content: string, expectedCommitId: number): StoryManifest {
  const value = parseJsonObject(content, `history manifest ${expectedCommitId}`)
  if (value.schema_version !== 1) throw new Error(`unsupported history manifest schema for commit ${expectedCommitId}`)
  if (value.commit_id !== expectedCommitId) throw new Error(`history manifest commit_id mismatch for ${expectedCommitId}`)
  if (value.status !== 'committed') throw new Error(`history commit ${expectedCommitId} is not committed`)
  if (!isRecord(value.files)) throw new Error(`history manifest files is invalid for commit ${expectedCommitId}`)
  return value as unknown as StoryManifest
}

function isAllowedSection(value: string): value is StateSection {
  return (ALLOWED_SECTIONS as readonly string[]).includes(value)
}

function parseMemoryPatch(content: string): MemoryPatch {
  const root = parseJsonObject(content, 'memory patch')
  if (root.schema_version !== 1) throw new Error('unsupported memory patch schema_version')
  if (root.source !== DRAFT_PATH) throw new Error(`memory patch source must be ${DRAFT_PATH}`)
  if (!Array.isArray(root.updates)) throw new Error('memory patch updates must be an array')

  const seen = new Set<string>()
  const updates: CharacterUpdate[] = root.updates.map((rawUpdate, updateIndex) => {
    if (!isRecord(rawUpdate)) throw new Error(`updates[${updateIndex}] must be an object`)
    const character = requireString(rawUpdate.character, `updates[${updateIndex}].character`)
    if (character.includes('/') || character.includes('\\') || character.includes('..')) {
      throw new Error(`invalid character name: ${character}`)
    }
    if (seen.has(character)) throw new Error(`duplicate character update: ${character}`)
    seen.add(character)
    if (!Array.isArray(rawUpdate.changes) || rawUpdate.changes.length === 0) {
      throw new Error(`changes for ${character} must be a non-empty array`)
    }

    const changes: PatchOperation[] = rawUpdate.changes.map((rawChange, changeIndex) => {
      if (!isRecord(rawChange)) throw new Error(`${character}.changes[${changeIndex}] must be an object`)
      const op = requireString(rawChange.op, `${character}.changes[${changeIndex}].op`)
      if (op !== 'add' && op !== 'replace' && op !== 'remove') throw new Error(`invalid operation "${op}" for ${character}`)
      const section = requireString(rawChange.section, `${character}.changes[${changeIndex}].section`)
      if (!isAllowedSection(section)) throw new Error(`invalid state section "${section}" for ${character}`)
      const oldValue = optionalString(rawChange.old_value, `${character}.changes[${changeIndex}].old_value`)
      const newValue = optionalString(rawChange.value, `${character}.changes[${changeIndex}].value`)
      const evidence = requireString(rawChange.evidence, `${character}.changes[${changeIndex}].evidence`)

      if (op === 'add' && (newValue === undefined || oldValue !== undefined)) throw new Error(`invalid add operation for ${character}`)
      if (op === 'replace' && (oldValue === undefined || newValue === undefined || oldValue === newValue)) throw new Error(`invalid replace operation for ${character}`)
      if (op === 'remove' && (oldValue === undefined || newValue !== undefined)) throw new Error(`invalid remove operation for ${character}`)

      return {
        op,
        section,
        ...(oldValue !== undefined ? { old_value: oldValue } : {}),
        ...(newValue !== undefined ? { value: newValue } : {}),
        evidence,
      } as PatchOperation
    })

    return { character, changes }
  })

  return { schema_version: 1, source: DRAFT_PATH, updates }
}

function findSection(lines: string[], section: StateSection): { heading: number; end: number } {
  const expected = `## ${section}`
  const heading = lines.findIndex(line => line.trim() === expected)
  if (heading === -1) throw new Error(`state card is missing section: ${section}`)
  let end = lines.length
  for (let i = heading + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) {
      end = i
      break
    }
  }
  return { heading, end }
}

function findBullet(lines: string[], section: StateSection, value: string): number {
  const { heading, end } = findSection(lines, section)
  const expected = `- ${value}`
  const matches: number[] = []
  for (let i = heading + 1; i < end; i += 1) {
    if (lines[i].trim() === expected) matches.push(i)
  }
  if (matches.length > 1) throw new Error(`ambiguous duplicate state entry in ${section}: ${value}`)
  return matches.length === 1 ? matches[0] : -1
}

function applyChanges(original: string, character: string, changes: PatchOperation[]): string {
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.replace(/\r\n/g, '\n').split('\n')

  for (const change of changes) {
    if (change.op === 'add') {
      const value = change.value!
      if (findBullet(lines, change.section, value) !== -1) {
        throw new Error(`PATCH_CONFLICT: ${character} already contains "${value}" in ${change.section}`)
      }
      const { heading, end } = findSection(lines, change.section)
      let insertAt = end
      while (insertAt > heading + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1
      lines.splice(insertAt, 0, `- ${value}`)
      continue
    }

    if (change.op === 'remove') {
      const oldValue = change.old_value!
      const index = findBullet(lines, change.section, oldValue)
      if (index === -1) throw new Error(`PATCH_CONFLICT: ${character} does not contain "${oldValue}" in ${change.section}`)
      lines.splice(index, 1)
      continue
    }

    const oldValue = change.old_value!
    const value = change.value!
    const index = findBullet(lines, change.section, oldValue)
    if (index === -1) throw new Error(`PATCH_CONFLICT: ${character} does not contain "${oldValue}" in ${change.section}`)
    if (findBullet(lines, change.section, value) !== -1) {
      throw new Error(`PATCH_CONFLICT: ${character} already contains replacement value "${value}"`)
    }
    lines[index] = `- ${value}`
  }

  return lines.join(newline)
}

function validateSceneCheckpoint(content: string): void {
  if (!content.trim()) throw new Error('scene checkpoint is empty')
  const headings = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^#{1,2}\s+/.test(line))

  if (headings.length !== REQUIRED_SCENE_HEADINGS.length) {
    throw new Error('scene checkpoint must contain exactly the required level-1/2 headings')
  }
  for (let i = 0; i < REQUIRED_SCENE_HEADINGS.length; i += 1) {
    if (headings[i] !== REQUIRED_SCENE_HEADINGS[i]) {
      throw new Error(`scene checkpoint heading mismatch at position ${i + 1}: expected "${REQUIRED_SCENE_HEADINGS[i]}"`)
    }
  }
}

function extractRecentProse(source: string): string {
  const paragraphs = source
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n[ \t]*\n+/)
    .map(p => p.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) throw new Error('approved draft contains no prose paragraphs')

  const selected: string[] = []
  let count = 0
  for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
    if (selected.length >= 5) break
    selected.unshift(paragraphs[i])
    count += charCount(paragraphs[i])
    if (count >= 1000) break
  }
  return `${selected.join('\n\n')}\n`
}

async function readWorkspaceText(
  ctx: Context,
  cwd: string,
  workspace: FsTarget,
  path: string,
  signal: AbortSignal | undefined,
  requireNonEmpty = true,
): Promise<string> {
  const target = await ctx.fs.resolve(path, { cwd, signal })
  if (!ctx.fs.contains(workspace, target)) throw new Error(`path escaped workspace: ${target.displayPath}`)
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined || info.type !== 'file') throw new Error(`required file does not exist: ${path}`)
  const content = await ctx.fs.readText(target, signal)
  if (requireNonEmpty && !content.trim()) throw new Error(`required file is empty: ${path}`)
  return content
}

async function discoverLatestCommit(
  ctx: Context,
  cwd: string,
  workspace: FsTarget,
  signal: AbortSignal | undefined,
): Promise<LatestCommit | null> {
  const history = await ctx.fs.resolve(HISTORY_ROOT, { cwd, signal })
  if (!ctx.fs.contains(workspace, history)) throw new Error(`history root escaped workspace: ${history.displayPath}`)
  const historyInfo = await ctx.fs.stat(history, signal)
  if (historyInfo === undefined) return null
  if (historyInfo.type !== 'directory') throw new Error(`${HISTORY_ROOT} exists but is not a directory`)

  const entries = await ctx.fs.listDir(history, signal)
  let latest: LatestCommit | null = null

  for (const entry of entries) {
    if (entry.type !== 'directory' || !/^\d{4,}$/.test(entry.name)) continue
    const commitId = Number.parseInt(entry.name, 10)
    if (!Number.isSafeInteger(commitId) || commitId <= 0) continue
    const manifestPath = `${HISTORY_ROOT}/${entry.name}/manifest.json`
    const manifestContent = await readWorkspaceText(ctx, cwd, workspace, manifestPath, signal, true)
    const manifest = parseManifest(manifestContent, commitId)
    const candidate: LatestCommit = {
      commitId,
      commitName: entry.name,
      manifest,
      manifestContent,
      manifestSha256: sha256Text(manifestContent),
    }
    if (latest === null || commitId > latest.commitId) latest = candidate
  }
  return latest
}

async function verifyCommitFiles(
  ctx: Context,
  cwd: string,
  workspace: FsTarget,
  commit: LatestCommit,
  signal: AbortSignal | undefined,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()

  for (const [path, entry] of Object.entries(commit.manifest.files)) {
    if (!isRecord(entry) || !isSha(entry.sha256) || typeof entry.characters !== 'number') {
      throw new Error(`invalid manifest file entry: ${path}`)
    }
    const fullPath = `${HISTORY_ROOT}/${commit.commitName}/${path}`
    const content = await readWorkspaceText(ctx, cwd, workspace, fullPath, signal, false)
    if (sha256Text(content) !== entry.sha256) {
      throw new Error(`history snapshot integrity failure: ${fullPath}`)
    }
    result.set(path, content)
  }

  return result
}

async function loadBaseRag(
  ctx: Context,
  cwd: string,
  workspace: FsTarget,
  latest: LatestCommit | null,
  intent: CommitIntent,
  signal: AbortSignal | undefined,
): Promise<Map<string, string>> {
  const rag = new Map<string, string>()

  if (intent.base_commit_id === null) {
    if (latest !== null) throw new Error('base commit mismatch: transaction expected no history base')
    const root = await ctx.fs.resolve(RAG_ROOT, { cwd, signal })
    if (!ctx.fs.contains(workspace, root)) throw new Error(`character state root escaped workspace: ${root.displayPath}`)
    const info = await ctx.fs.stat(root, signal)
    if (info === undefined) return rag
    if (info.type !== 'directory') throw new Error(`${RAG_ROOT} is not a directory`)
    for (const entry of await ctx.fs.listDir(root, signal)) {
      if (entry.type !== 'file') throw new Error(`unsupported non-file under ${RAG_ROOT}: ${entry.name}`)
      if (!isCharacterStateFilename(entry.name)) continue
      rag.set(entry.name, await readWorkspaceText(ctx, cwd, workspace, `${RAG_ROOT}/${entry.name}`, signal, false))
    }
    return rag
  }

  if (latest === null || latest.commitId !== intent.base_commit_id) {
    throw new Error(`BASE_COMMIT_MISMATCH: expected ${intent.base_commit_id}, current latest is ${latest?.commitId ?? 'none'}`)
  }
  if (latest.manifestSha256 !== intent.base_manifest_sha256) {
    throw new Error('BASE_MANIFEST_MISMATCH: base history changed after approval')
  }

  const files = await verifyCommitFiles(ctx, cwd, workspace, latest, signal)
  for (const [path, content] of files) {
    if (path.startsWith('rag/')) rag.set(path.slice(4), content)
  }
  return rag
}

function applyMemoryPatch(base: Map<string, string>, patch: MemoryPatch): Map<string, string> {
  const next = new Map(base)
  for (const update of patch.updates) {
    const filename = `${update.character}状态.md`
    const original = next.get(filename)
    if (original === undefined) throw new Error(`state file does not exist in base commit: rag/${filename}`)
    next.set(filename, applyChanges(original, update.character, update.changes))
  }
  return next
}

async function writeAndVerify(
  ctx: Context,
  cwd: string,
  workspace: FsTarget,
  path: string,
  content: string,
  signal: AbortSignal | undefined,
  policy: Policy,
): Promise<void> {
  const target = await ctx.fs.resolve(path, { cwd, signal })
  if (!ctx.fs.contains(workspace, target)) throw new Error(`write target escaped workspace: ${target.displayPath}`)
  await ctx.fs.writeText(target, content, undefined, signal, policy)
  const verified = await ctx.fs.readText(target, signal)
  if (verified !== content) throw new Error(`verification failed after writing ${path}`)
}

async function materializeCommit(
  ctx: Context,
  cwd: string,
  workspace: FsTarget,
  policy: Policy,
  commit: LatestCommit,
  files: ReadonlyMap<string, string>,
): Promise<void> {
  const accepted = files.get('accepted-draft.md')
  const scene = files.get('current-scene.md')
  const recent = files.get('recent-prose.md')
  if (accepted === undefined || scene === undefined || recent === undefined) {
    throw new Error('published commit is missing required working-copy files')
  }

  await writeAndVerify(ctx, cwd, workspace, ACCEPTED_DRAFT_PATH, accepted, undefined, policy)
  await writeAndVerify(ctx, cwd, workspace, CURRENT_SCENE_PATH, scene, undefined, policy)
  await writeAndVerify(ctx, cwd, workspace, RECENT_PROSE_PATH, recent, undefined, policy)

  for (const [path, content] of files) {
    if (path.startsWith('rag/')) {
      await writeAndVerify(ctx, cwd, workspace, `${RAG_ROOT}/${path.slice(4)}`, content, undefined, policy)
    }
  }

  const marker = `${JSON.stringify({
    schema_version: 1,
    commit_id: commit.commitId,
    manifest_sha256: commit.manifestSha256,
    transaction_id: commit.manifest.transaction_id ?? null,
    materialized_at: new Date().toISOString(),
  }, null, 2)}\n`

  // Marker is written last; it certifies that all canonical working-copy files above were verified.
  await writeAndVerify(ctx, cwd, workspace, CURRENT_COMMIT_PATH, marker, undefined, policy)
}

export function apply(ctx: Context) {
  console.log('[commit-story-update] plugin loaded!')

  ctx.tools.register(defineTool({
    name: 'commit_story_update',
    description:
      'Publish the current approved MyWriting transaction as one immutable history commit, then materialize that commit to output/ and state/. This is the only normal final commit tool for Stage 7.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: {
            type: 'string',
            required: true,
            enum: ['committed', 'already_committed', 'committed_needs_sync'],
          },
          commit_id: { type: 'integer', required: true },
          parent_commit_id: { type: 'integer', required: true },
          commit_path: { type: 'string', required: true },
          transaction_id: { type: 'string', required: true },
          accepted_draft_sha256: { type: 'string', required: true },
          manifest_sha256: { type: 'string', required: true },
          materialized: { type: 'boolean', required: true },
          verified: { type: 'boolean', required: true },
          sync_error: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text:
          `Story transaction status: ${value.status}\n` +
          `Commit: ${value.commit_id}\n` +
          `Parent: ${value.parent_commit_id === 0 ? 'none' : value.parent_commit_id}\n` +
          `Transaction: ${value.transaction_id}\n` +
          `Commit path: ${value.commit_path}\n` +
          `Accepted draft SHA-256: ${value.accepted_draft_sha256}\n` +
          `Manifest SHA-256: ${value.manifest_sha256}\n` +
          `Working copy materialized: ${value.materialized}\n` +
          `Verified: ${value.verified}` +
          (value.sync_error ? `\nSync error: ${value.sync_error}` : ''),
      }],
    },

    async execute(_args, exec) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('commit_story_update requires an active agent session')
      const sessionCwd = session.header.cwd
      if (!sessionCwd) throw new Error('commit_story_update requires a workspace cwd')
      const cwd = requireMyWritingRoot(sessionCwd)

      const workspace = await ctx.fs.resolve(cwd, { signal: exec.signal })
      const policy = ctx.sandboxPolicy.resolve({ session })
      if (policy.mode === 'read-only') throw new Error('commit_story_update cannot run in read-only mode')

      const intentContent = await readWorkspaceText(ctx, cwd, workspace, COMMIT_INTENT_PATH, exec.signal, true)
      const intent = parseCommitIntent(intentContent)
      const latest = await discoverLatestCommit(ctx, cwd, workspace, exec.signal)

      // Idempotent retry after a successful history publication.
      if (
        latest !== null &&
        latest.manifest.transaction_id === intent.transaction_id &&
        latest.manifest.source_draft_sha256 === intent.draft_sha256
      ) {
        const verifiedFiles = await verifyCommitFiles(
          ctx,
          cwd,
          workspace,
          latest,
          undefined,
        )

        try {
          await materializeCommit(
            ctx,
            cwd,
            workspace,
            policy,
            latest,
            verifiedFiles,
          )
          return {
            status: 'already_committed' as const,
            commit_id: latest.commitId,
            parent_commit_id: latest.manifest.parent_commit_id ?? 0,
            commit_path: `${HISTORY_ROOT}/${latest.commitName}`,
            transaction_id: intent.transaction_id,
            accepted_draft_sha256: intent.draft_sha256,
            manifest_sha256: latest.manifestSha256,
            materialized: true,
            verified: true,
            sync_error: '',
          }
        } catch (error: unknown) {
          return {
            status: 'committed_needs_sync' as const,
            commit_id: latest.commitId,
            parent_commit_id: latest.manifest.parent_commit_id ?? 0,
            commit_path: `${HISTORY_ROOT}/${latest.commitName}`,
            transaction_id: intent.transaction_id,
            accepted_draft_sha256: intent.draft_sha256,
            manifest_sha256: latest.manifestSha256,
            materialized: false,
            verified: true,
            sync_error: error instanceof Error ? error.message : String(error),
          }
        }
      }

      if (intent.base_commit_id === null) {
        if (latest !== null) {
          throw new Error(`BASE_COMMIT_MISMATCH: expected no history base, current latest is ${latest.commitId}`)
        }
      } else {
        if (latest === null || latest.commitId !== intent.base_commit_id) {
          throw new Error(`BASE_COMMIT_MISMATCH: expected ${intent.base_commit_id}, current latest is ${latest?.commitId ?? 'none'}`)
        }
        if (latest.manifestSha256 !== intent.base_manifest_sha256) {
          throw new Error('BASE_MANIFEST_MISMATCH: current history base no longer matches the approved transaction')
        }
      }

      const draft = await readWorkspaceText(ctx, cwd, workspace, DRAFT_PATH, exec.signal, true)
      const draftMeta = parseDraftMeta(await readWorkspaceText(ctx, cwd, workspace, DRAFT_META_PATH, exec.signal, true))
      const draftSha = sha256Text(draft)
      if (draftSha !== draftMeta.sha256 || draftSha !== intent.draft_sha256) {
        throw new Error('DRAFT_VERSION_MISMATCH: current candidate is not the draft approved by this transaction')
      }

      const memoryContent = await readWorkspaceText(ctx, cwd, workspace, MEMORY_PATCH_PATH, exec.signal, true)
      const memoryMetaContent = await readWorkspaceText(ctx, cwd, workspace, MEMORY_META_PATH, exec.signal, true)
      const memoryMeta = parseTransactionMeta(memoryMetaContent, 'memory-patch')

      const sceneContent = await readWorkspaceText(ctx, cwd, workspace, SCENE_PATH, exec.signal, true)
      const sceneMetaContent = await readWorkspaceText(ctx, cwd, workspace, SCENE_META_PATH, exec.signal, true)
      const sceneMeta = parseTransactionMeta(sceneMetaContent, 'scene-checkpoint')

      for (const [label, meta, actualSha] of [
        ['memory-patch', memoryMeta, sha256Text(memoryContent)],
        ['scene-checkpoint', sceneMeta, sha256Text(sceneContent)],
      ] as const) {
        if (meta.transaction_id !== intent.transaction_id) throw new Error(`${label} transaction_id does not match commit intent`)
        if (meta.draft_sha256 !== intent.draft_sha256) throw new Error(`${label} draft_sha256 does not match approved draft`)
        if (meta.base_commit_id !== intent.base_commit_id) throw new Error(`${label} base_commit_id does not match commit intent`)
        if (meta.base_manifest_sha256 !== intent.base_manifest_sha256) throw new Error(`${label} base_manifest_sha256 does not match commit intent`)
        if (meta.artifact_sha256 !== actualSha) throw new Error(`${label} content no longer matches its transaction metadata`)
      }

      const memoryPatch = parseMemoryPatch(memoryContent)
      validateSceneCheckpoint(sceneContent)

      const baseRag = await loadBaseRag(ctx, cwd, workspace, latest, intent, exec.signal)
      const nextRag = applyMemoryPatch(baseRag, memoryPatch)
      const recentProse = extractRecentProse(draft)

      const nextCommitId = (intent.base_commit_id ?? 0) + 1
      const nextCommitName = formatCommitId(nextCommitId)
      const tempPath =
        `${HISTORY_ROOT}/.${nextCommitName}.${randomUUID()}.tmp`
      const finalPath = `${HISTORY_ROOT}/${nextCommitName}`

      const tempTarget = await ctx.fs.resolve(tempPath, { cwd, signal: exec.signal })
      const finalTarget = await ctx.fs.resolve(finalPath, { cwd, signal: exec.signal })
      if (!ctx.fs.contains(workspace, tempTarget) || !ctx.fs.contains(workspace, finalTarget)) {
        throw new Error('history commit target escaped workspace')
      }
      if (await ctx.fs.stat(finalTarget, exec.signal) !== undefined) throw new Error(`history commit already exists: ${finalPath}`)
      if (await ctx.fs.stat(tempTarget, exec.signal) !== undefined) throw new Error(`unfinished history transaction already exists: ${tempPath}`)

      const snapshots: SnapshotFile[] = []
      const add = (path: string, content: string) => snapshots.push({
        path,
        content,
        sha256: sha256Text(content),
        characters: charCount(content),
      })

      add('accepted-draft.md', draft)
      add('current-scene.md', sceneContent)
      add('recent-prose.md', recentProse)
      for (const [filename, content] of Array.from(nextRag.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        add(`rag/${filename}`, content)
      }
      add('transaction/commit-intent.json', intentContent)
      add('transaction/draft.meta.json', await readWorkspaceText(ctx, cwd, workspace, DRAFT_META_PATH, exec.signal, true))
      add('transaction/memory-patch.json', memoryContent)
      add('transaction/memory-patch.meta.json', memoryMetaContent)
      add('transaction/scene-checkpoint.md', sceneContent)
      add('transaction/scene-checkpoint.meta.json', sceneMetaContent)

      const manifestFiles: Record<string, ManifestEntry> = {}
      for (const file of snapshots) manifestFiles[file.path] = { sha256: file.sha256, characters: file.characters }

      const manifest: StoryManifest = {
        schema_version: 1,
        commit_id: nextCommitId,
        parent_commit_id: intent.base_commit_id,
        status: 'committed',
        created_at: new Date().toISOString(),
        character_state_schema_version: 1,
        transaction_id: intent.transaction_id,
        source_draft_sha256: intent.draft_sha256,
        base_manifest_sha256: intent.base_manifest_sha256,
        files: manifestFiles,
      }
      const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`
      const manifestSha256 = sha256Text(manifestContent)

      const historyTarget = await ctx.fs.resolve(HISTORY_ROOT, { cwd, signal: exec.signal })
      if (!ctx.fs.contains(workspace, historyTarget)) throw new Error(`history root escaped workspace: ${historyTarget.displayPath}`)
      const historyPathInfo = await ctx.fs.lstat(HISTORY_ROOT, { cwd }, exec.signal)
      if (historyPathInfo?.type === 'symlink') throw new Error(`${HISTORY_ROOT} must not be a symbolic link`)

      const historyProcessPath = ctx.fs.processPath(historyTarget)
      const tempProcessPath = ctx.fs.processPath(tempTarget)
      const finalProcessPath = ctx.fs.processPath(finalTarget)
      let tempCreated = false
      let published = false

      try {
        await mkdir(historyProcessPath, { recursive: true })
        await mkdir(tempProcessPath, { recursive: false })
        tempCreated = true

        for (const subdir of ['rag', 'transaction']) {
          const dirTarget = await ctx.fs.resolve(`${tempPath}/${subdir}`, { cwd, signal: exec.signal })
          if (!ctx.fs.contains(workspace, dirTarget)) throw new Error(`temporary history subdirectory escaped workspace: ${dirTarget.displayPath}`)
          await mkdir(ctx.fs.processPath(dirTarget), { recursive: false })
        }

        for (const file of snapshots) {
          await writeAndVerify(ctx, cwd, workspace, `${tempPath}/${file.path}`, file.content, exec.signal, policy)
        }
        await writeAndVerify(ctx, cwd, workspace, `${tempPath}/manifest.json`, manifestContent, exec.signal, policy)

        if (exec.signal?.aborted) throw new Error('commit_story_update was cancelled before publication')
        await rename(tempProcessPath, finalProcessPath)
        published = true
      } catch (error: unknown) {
        if (tempCreated && !published) {
          try {
            await rm(tempProcessPath, { recursive: true, force: true })
          } catch (cleanupError: unknown) {
            const primary = error instanceof Error ? error.message : String(error)
            const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            throw new Error(`${primary}; transaction cleanup also failed: ${cleanup}`)
          }
        }
        throw error
      }

      const publishedManifestContent = await readWorkspaceText(
        ctx,
        cwd,
        workspace,
        `${finalPath}/manifest.json`,
        undefined,
        true,
      )

      if (
        sha256Text(publishedManifestContent) !==
        manifestSha256
      ) {
        throw new Error(
          'published history manifest failed verification',
        )
      }

      const publishedManifest = parseManifest(
        publishedManifestContent,
        nextCommitId,
      )

      const publishedCommit: LatestCommit = {
        commitId: nextCommitId,
        commitName: nextCommitName,
        manifest: publishedManifest,
        manifestContent: publishedManifestContent,
        manifestSha256,
      }

      const verifiedFiles = await verifyCommitFiles(
        ctx,
        cwd,
        workspace,
        publishedCommit,
        undefined,
      )

      try {
        await materializeCommit(
          ctx,
          cwd,
          workspace,
          policy,
          publishedCommit,
          verifiedFiles,
        )
        return {
          status: 'committed' as const,
          commit_id: nextCommitId,
          parent_commit_id: intent.base_commit_id ?? 0,
          commit_path: finalPath,
          transaction_id: intent.transaction_id,
          accepted_draft_sha256: intent.draft_sha256,
          manifest_sha256: manifestSha256,
          materialized: true,
          verified: true,
          sync_error: '',
        }
      } catch (error: unknown) {
        return {
          status: 'committed_needs_sync' as const,
          commit_id: nextCommitId,
          parent_commit_id: intent.base_commit_id ?? 0,
          commit_path: finalPath,
          transaction_id: intent.transaction_id,
          accepted_draft_sha256: intent.draft_sha256,
          manifest_sha256: manifestSha256,
          materialized: false,
          verified: true,
          sync_error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }))
}
