import { chaptersApi } from '@/lib/api'
import { type Draft, DraftQueue } from '@/lib/draftQueue'
import { useCloudDocumentStore } from '@/stores/useCloudDocumentStore'

export const chapterDrafts = new DraftQueue(
  window.localStorage,
  (draft) => chaptersApi.update(draft.project, draft.num, { ...draft.data, volume_id: draft.volumeId }),
  () => window.dispatchEvent(new Event('mythpen-draft-changed')),
)
const savers = new Set<() => Promise<void>>()
export function registerEditorSaver(save: () => Promise<void>) {
  savers.add(save)
  return () => {
    savers.delete(save)
  }
}
export function queueChapterDraft(draft: Draft) {
  chapterDrafts.put(draft)
  useCloudDocumentStore.setState((state) => ({ editVersion: state.editVersion + 1 }))
}
export async function flushEditors(project?: string) {
  for (const save of savers) await save()
  await chapterDrafts.flush(project)
}
