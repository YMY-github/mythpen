export type Draft = { project: string; num: number; volumeId?: number; data: Record<string, string | number> }
type Storage = Pick<globalThis.Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>
const prefix = 'mythpen-chapter-draft:'

// A durable outbox, independent of the mounted editor and its current chapter.
// Each chapter is written serially; a late response cannot clear a newer draft.
export class DraftQueue {
  storage: Storage
  write: (draft: Draft) => Promise<unknown>
  changed: () => void
  running = new Map<string, Promise<void>>()
  constructor(storage: Storage, write: (draft: Draft) => Promise<unknown>, changed: () => void = () => {}) {
    this.storage = storage
    this.write = write
    this.changed = changed
  }
  id(project: string, num: number, volumeId?: number) {
    return prefix + JSON.stringify([project, num, volumeId ?? null])
  }
  put(draft: Draft) {
    const key = this.id(draft.project, draft.num, draft.volumeId)
    const old = this.storage.getItem(key)
    const previous: Draft | null = old ? JSON.parse(old) : null
    this.storage.setItem(key, JSON.stringify({ ...draft, data: { ...previous?.data, ...draft.data } }))
    this.changed()
  }
  entries(project?: string): [string, Draft][] {
    const result: [string, Draft][] = []
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i)
      if (!key?.startsWith(prefix)) continue
      const draft = JSON.parse(this.storage.getItem(key) || 'null') as Draft
      if (!draft || typeof draft.project !== 'string' || !Number.isInteger(draft.num) || draft.num < 1 || !draft.data)
        throw new Error('Invalid local writing draft; original data retained')
      if (!project || draft.project === project) result.push([key, draft])
    }
    return result
  }
  pending(project?: string) {
    return this.entries(project).length > 0
  }
  async flush(project?: string) {
    for (const [key] of this.entries(project)) {
      let task = this.running.get(key)
      if (!task) {
        task = (async () => {
          for (;;) {
            const raw = this.storage.getItem(key)
            if (!raw) return
            const draft = JSON.parse(raw) as Draft
            await this.write(draft)
            if (this.storage.getItem(key) === raw) {
              this.storage.removeItem(key)
              this.changed()
            }
          }
        })().finally(() => this.running.delete(key))
        this.running.set(key, task)
      }
      await task
    }
  }
}
