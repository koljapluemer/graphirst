import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { NoteStore } from './note-store'
import type { CreateNoteRequest } from '../shared/notes'

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

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('notes:get-bootstrap', async () => {
    await noteStore.loadSettings()
    return noteStore.getBootstrap()
  })

  ipcMain.handle('notes:search', async (_event, query: string) => {
    return noteStore.search(query)
  })

  ipcMain.handle('notes:open', async (_event, filename: string) => {
    return noteStore.openNote(filename)
  })

  ipcMain.handle('notes:refresh', async () => {
    return noteStore.refresh()
  })

  ipcMain.handle('notes:create', async (_event, request: CreateNoteRequest) => {
    return noteStore.createNote(request)
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
