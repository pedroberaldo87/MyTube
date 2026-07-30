const STORAGE_KEY = 'mytube-ui-state'

export type HomeMode = 'new-only' | 'latest'

export interface UIState {
  expandedFolderIds: string[]
  scrollTop: number
  sectionOpen: Record<string, boolean>
  searchText: string
  typeFilter: string
  unassignedOnly: boolean
  hideWatched: boolean
  homeMode: HomeMode
  homeLatestCount: number
  homeFoldersExpanded: boolean
  folderSearchQuery: string
  folderSortMode: string
}

const DEFAULTS: UIState = {
  expandedFolderIds: [],
  scrollTop: 0,
  sectionOpen: { folders: true, library: true, tags: false },
  searchText: '',
  typeFilter: 'all',
  unassignedOnly: false,
  hideWatched: false,
  homeMode: 'new-only',
  homeLatestCount: 5,
  homeFoldersExpanded: true,
  folderSearchQuery: '',
  folderSortMode: 'manual',
}

let cache: UIState | null = null

export async function loadUIState(): Promise<UIState> {
  if (cache) return cache
  const result = await chrome.storage.local.get(STORAGE_KEY)
  cache = { ...DEFAULTS, ...(result[STORAGE_KEY] as Partial<UIState> ?? {}) }
  return cache
}

export function saveUIState(partial: Partial<UIState>): void {
  cache = { ...(cache ?? DEFAULTS), ...partial }
  void chrome.storage.local.set({ [STORAGE_KEY]: cache })
}
