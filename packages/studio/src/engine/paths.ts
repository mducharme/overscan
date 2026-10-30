const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/

/** True for URLs and built-in `overscan://` assets, which are never resolved against a file. */
export function isUrl(target: string): boolean {
  return SCHEME_RE.test(target) || target.startsWith('overscan://')
}

function isAbsolute(target: string): boolean {
  return target.startsWith('/') || target.startsWith('\\\\') || WINDOWS_ABSOLUTE_RE.test(target)
}

/**
 * Resolves `target` relative to the directory of `baseFile` (a scene, demo or asset path).
 * Keeps the base's separator style: POSIX paths stay POSIX, Windows paths stay Windows.
 */
export function resolvePath(baseFile: string, target: string): string {
  if (isUrl(target) || isAbsolute(target)) return target
  const windows = WINDOWS_ABSOLUTE_RE.test(baseFile) || baseFile.includes('\\')
  const sep = windows ? '\\' : '/'
  const baseParts = baseFile.split(/[\\/]/)
  baseParts.pop()
  const parts = [...baseParts]
  for (const part of target.split(/[\\/]/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 1) parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join(sep)
}

/** File name without directory, e.g. 'plasma.scene.json'. */
export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}
