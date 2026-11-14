/** The only door to localStorage. Never throws: private windows, blocked storage and
 * in-app browsers all fall back to a map that lives as long as the page. */
const memory = new Map<string, string>()

export const storage = {
  get(key: string): string | null {
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
    } catch {
      // memory already has it
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
