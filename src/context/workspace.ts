import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

export function sessionWorkspaceDirectory(cwd: string | undefined, host = process.cwd()): string {
  return cwd ?? host
}
export function workspaceMeetingRoot(cwd: string | undefined, host = process.cwd()): string {
  return join(sessionWorkspaceDirectory(cwd, host), '.dsh-meeting')
}
export function sessionDirectoryName(id: string): string {
  if (typeof id !== 'string') throw new Error('Invalid DSH Session id')
  return createHash('sha256').update(id).digest('hex')
}
function confined(parent: string, child: string): void {
  const rel = relative(parent, child)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error('Meeting path escapes Session Workspace')
  }
}
async function existing(path: string): Promise<string | null> {
  try { return await realpath(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
/** A matching directory may already have an owner's .gitignore; do not overwrite it. */
async function ensureIgnore(dir: string, required: boolean): Promise<void> {
  const file = join(dir, '.gitignore')
  try { await writeFile(file, '*\n!/.gitignore\n', { flag: 'wx' }); return }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const stat = await lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe meeting .gitignore')
  if (required) {
    const contents = await readFile(file, 'utf8')
    if (!/(?:^|\n)\*(?:\r?\n|$)/.test(contents)) {
      throw new Error('Existing Session meeting .gitignore does not protect audio')
    }
  }
}
/** Validate physical root and per-session directory, including pre-existing symlinks. */
export async function secureMeetingDirectory(root: string, id: string, create: boolean): Promise<string | null> {
  const workspace = await realpath(dirname(root))
  if (create) await mkdir(root, { recursive: true })
  const canonicalRoot = await existing(root)
  if (!canonicalRoot) return null
  confined(workspace, canonicalRoot)
  const child = join(root, sessionDirectoryName(id))
  if (create) await mkdir(child, { recursive: true })
  const canonicalChild = await existing(child)
  if (!canonicalChild) return null
  confined(canonicalRoot, canonicalChild)
  if (create) {
    await ensureIgnore(root, false)
    await ensureIgnore(child, true)
  }
  return canonicalChild
}
export async function secureAudioDirectory(root: string, id: string): Promise<string> {
  const session = await secureMeetingDirectory(root, id, true)
  if (!session) throw new Error('Cannot create meeting directory')
  const audio = join(session, 'audio')
  await mkdir(audio, { recursive: true })
  const canonical = await realpath(audio)
  confined(session, canonical)
  return canonical
}
export async function verifyMeetingFile(directory: string, path: string): Promise<void> {
  const target = await existing(path)
  if (target) confined(directory, target)
}
