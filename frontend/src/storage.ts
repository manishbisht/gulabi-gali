/** The only door to localStorage. Never throws: private windows, blocked storage and
 * in-app browsers all fall back to a map that lives as long as the page. */
const memory = new Map<string, string>()
/** Keys whose last write localStorage refused: the map holds their newer value, and answers for them. */
const refused = new Set<string>()

export const storage = {
  get(key: string): string | null {
    if (refused.has(key)) return memory.get(key) ?? null
    try {
      const value = localStorage.getItem(key)
      if (value !== null) return value
    } catch {
      // fall through to memory
    }
    return memory.get(key) ?? null
  },
  set(key: string, value: string): void {
    memory.set(key, value)
    try {
      localStorage.setItem(key, value)
      refused.delete(key)
    } catch {
      refused.add(key) // memory already has it, and localStorage still holds an older one
    }
  },
  /** Forgets everything, the page-lifetime map included. For tests: `localStorage.clear()` alone leaves the map. */
  clear(): void {
    memory.clear()
    refused.clear()
    try {
      localStorage.clear()
    } catch {
      // nothing stored to clear
    }
  },
  getJSON<T>(key: string, fallback: T): T {
    const raw = storage.get(key)
    if (raw === null) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },
}
