import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { NotesApi } from '../shared/notes'

const notesApi: NotesApi = {
  getBootstrap: () => ipcRenderer.invoke('notes:get-bootstrap'),
  search: (query) => ipcRenderer.invoke('notes:search', query),
  openGraph: (pins) => ipcRenderer.invoke('notes:graph', pins),
  pickDirectory: () => ipcRenderer.invoke('notes:pick-directory'),
  refresh: () => ipcRenderer.invoke('notes:refresh'),
  createNote: (request) => ipcRenderer.invoke('notes:create', request),
  deleteNote: (request) => ipcRenderer.invoke('notes:delete', request),
  connectNotes: (request) => ipcRenderer.invoke('notes:connect', request),
  updateRelationLabel: (request) => ipcRenderer.invoke('notes:update-relation-label', request),
  deleteRelation: (request) => ipcRenderer.invoke('notes:delete-relation', request)
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
