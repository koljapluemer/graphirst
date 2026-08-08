import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { IndexProgress, NotesApi } from '../shared/notes'

const notesApi: NotesApi = {
  getBootstrap: () => ipcRenderer.invoke('notes:get-bootstrap'),
  search: (query, mode) => ipcRenderer.invoke('notes:search', query, mode),
  openGraph: (pins) => ipcRenderer.invoke('notes:graph', pins),
  pickDirectory: () => ipcRenderer.invoke('notes:pick-directory'),
  refresh: () => ipcRenderer.invoke('notes:refresh'),
  createNote: (request) => ipcRenderer.invoke('notes:create', request),
  deleteNote: (request) => ipcRenderer.invoke('notes:delete', request),
  updateNote: (request) => ipcRenderer.invoke('notes:update', request),
  saveImage: (request) => ipcRenderer.invoke('notes:save-image', request),
  connectNotes: (request) => ipcRenderer.invoke('notes:connect', request),
  updateRelationLabel: (request) => ipcRenderer.invoke('notes:update-relation-label', request),
  deleteRelation: (request) => ipcRenderer.invoke('notes:delete-relation', request),
  randomOrphan: (request) => ipcRenderer.invoke('notes:random-orphan', request),
  randomWithNotes: (request) => ipcRenderer.invoke('notes:random-with-notes', request),
  deleteNoteEntry: (request) => ipcRenderer.invoke('notes:delete-note-entry', request),
  undoDelete: () => ipcRenderer.invoke('notes:undo-delete'),
  onChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('notes:changed', listener)
    return () => ipcRenderer.removeListener('notes:changed', listener)
  },
  onIndexProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: IndexProgress): void =>
      callback(progress)
    ipcRenderer.on('notes:index-progress', listener)
    return () => ipcRenderer.removeListener('notes:index-progress', listener)
  }
}

const api = {
  notes: notesApi
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const target = window as typeof window & {
    electron: typeof electronAPI
    api: typeof api
  }
  target.electron = electronAPI
  target.api = api
}
