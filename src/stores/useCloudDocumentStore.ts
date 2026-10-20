import { create } from 'zustand'
export type CloudAccount = {
  configured: boolean
  phase: string
  account: string | null
  errorCode?: string
  message?: string
}
export type CloudDocumentResult = {
  action: string
  pending?: boolean
  lastSync?: string
  errorCode?: string
  expectedHash?: string
}
export const useCloudDocumentStore = create<{
  account: CloudAccount | null
  result: CloudDocumentResult | null
  opened: string | null
  applying: boolean
  checking: boolean
  errorCode: string | null
  editVersion: number
  syncedVersion: number
}>(() => ({
  account: null,
  result: null,
  opened: null,
  applying: false,
  checking: false,
  errorCode: null,
  editVersion: 0,
  syncedVersion: 0,
}))
