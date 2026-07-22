import { ElectronAPI } from '@electron-toolkit/preload'
import type { NotesApi } from '../shared/notes'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      notes: NotesApi
    }
  }
}
