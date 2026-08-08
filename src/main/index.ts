import { app, shell, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { NOTES_CHANGED_EVENT, NOTES_INDEX_PROGRESS_EVENT, NoteStore } from './note-store'
import type {
  ConnectNotesRequest,
  CreateNoteRequest,
  DeleteNoteEntryRequest,
  DeleteNoteRequest,
  DeleteRelationRequest,
  IndexProgress,
  PinSpec,
  RandomOrphanRequest,
  RandomWithNotesRequest,
  SaveImageRequest,
  SearchMode,
  UpdateNoteRequest,
  UpdateRelationRequest
} from '../shared/notes'

const MEDIA_PROTOCOL = 'media'
const MEDIA_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
}

// Must run before app 'ready' - registers the scheme itself as privileged
// (fetchable, CSP-friendly) so protocol.handle can serve real responses for it below.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

// Chromium doesn't request server-side decorations on native Wayland by default,
// so compositors like Mutter have no title bar/border to attach minimize, maximize,
// edge-resize, or keyboard tiling to. Must be set before app 'ready'.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
}

let noteStore: NoteStore

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1680,
    height: 1040,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f0e8',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  noteStore = new NoteStore(app.getPath('userData'))

  // Single fan-out point for "the note index changed" - every renderer-side view
  // (graph, search, ...) subscribes to this instead of individual mutations having
  // to remember which views need poking (see tckt/issues/sidebar-out-of-sync-with-true-note-state.md).
  noteStore.on(NOTES_CHANGED_EVENT, () => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('notes:changed')
    }
  })

  noteStore.on(NOTES_INDEX_PROGRESS_EVENT, (progress: IndexProgress) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('notes:index-progress', progress)
    }
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Serves note-attached images straight out of <graphPath>/media - reads the graph
  // path fresh on every request (rather than capturing it once) since it can change
  // at runtime via pickDirectory/setGraphPath.
  protocol.handle(MEDIA_PROTOCOL, async (request) => {
    const filename = basename(decodeURIComponent(new URL(request.url).hostname))
    const extension = filename.split('.').pop()?.toLowerCase() ?? ''
    const mimeType = MEDIA_MIME_TYPES[extension]

    if (!filename || !mimeType) {
      return new Response(null, { status: 404 })
    }

    try {
      const data = await readFile(join(noteStore.getCurrentPath(), 'media', filename))
      return new Response(data, { headers: { 'content-type': mimeType } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })

  ipcMain.handle('notes:get-bootstrap', async () => {
    await noteStore.loadSettings()
    return noteStore.getBootstrap()
  })

  ipcMain.handle('notes:search', async (_event, query: string, mode?: SearchMode) => {
    return noteStore.search(query, mode)
  })

  ipcMain.handle('notes:graph', async (_event, pins: PinSpec[]) => {
    return noteStore.openGraph(pins)
  })

  ipcMain.handle('notes:refresh', async () => {
    return noteStore.refresh()
  })

  ipcMain.handle('notes:create', async (_event, request: CreateNoteRequest) => {
    return noteStore.createNote(request)
  })

  ipcMain.handle('notes:delete', async (_event, request: DeleteNoteRequest) => {
    return noteStore.deleteNote(request)
  })

  ipcMain.handle('notes:update', async (_event, request: UpdateNoteRequest) => {
    return noteStore.updateNote(request)
  })

  ipcMain.handle('notes:save-image', async (_event, request: SaveImageRequest) => {
    return noteStore.saveImage(request)
  })

  ipcMain.handle('notes:connect', async (_event, request: ConnectNotesRequest) => {
    return noteStore.connectNotes(request)
  })

  ipcMain.handle('notes:update-relation-label', async (_event, request: UpdateRelationRequest) => {
    return noteStore.updateRelationLabel(request)
  })

  ipcMain.handle('notes:delete-relation', async (_event, request: DeleteRelationRequest) => {
    return noteStore.deleteRelation(request)
  })

  ipcMain.handle('notes:random-orphan', async (_event, request: RandomOrphanRequest) => {
    return noteStore.randomOrphan(request)
  })

  ipcMain.handle('notes:random-with-notes', async (_event, request: RandomWithNotesRequest) => {
    return noteStore.randomWithNotes(request)
  })

  ipcMain.handle('notes:delete-note-entry', async (_event, request: DeleteNoteEntryRequest) => {
    return noteStore.deleteNoteEntry(request)
  })

  ipcMain.handle('notes:undo-delete', async () => {
    return noteStore.undoDelete()
  })

  ipcMain.handle('notes:pick-directory', async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Choose graph folder',
      defaultPath: noteStore.getCurrentPath(),
      properties: ['openDirectory', 'createDirectory']
    })

    if (selection.canceled || selection.filePaths.length === 0) {
      return noteStore.getBootstrap()
    }

    return noteStore.setGraphPath(selection.filePaths[0])
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
