import type { Folder } from './types'

export function flattenFolders(all: Folder[], parentId: string | null = null, depth = 0): Array<{ folder: Folder; depth: number }> {
  const result: Array<{ folder: Folder; depth: number }> = []
  const children = all.filter(f => f.parentId === parentId).sort((a, b) => a.order - b.order)
  for (const child of children) {
    result.push({ folder: child, depth })
    result.push(...flattenFolders(all, child.id, depth + 1))
  }
  return result
}
