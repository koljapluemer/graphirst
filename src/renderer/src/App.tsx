import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChartNoAxesCombined,
  Dices,
  FolderOpen,
  LoaderCircle,
  PinOff,
  RefreshCw,
  Search,
  Settings2,
  StickyNote
} from 'lucide-react'
import GraphCanvas from './components/GraphCanvas'
import SearchModeToggle from './components/SearchModeToggle'
import StatsModal from './components/StatsModal'
import { MANUAL_PIN_DEPTH, SEARCH_RESULT_PIN_DEPTH, useNoteGraph } from './hooks/useNoteGraph'
import { useNoteSearch } from './hooks/useNoteSearch'
import type { IndexProgress, NotesBootstrap, SearchMode } from '../../shared/notes'

function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<NotesBootstrap | null>(null)
  const {
    graph,
    pins,
    loading: graphLoading,
    error: graphError,
    pinNote,
    unpinNote,
    setPinDepth,
    clearPins,
    refetch
  } = useNoteGraph()
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('fuzzy')
  const [bootLoading, setBootLoading] = useState(true)
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [orphanBusy, setOrphanBusy] = useState(false)
  const [notedBusy, setNotedBusy] = useState(false)
  const { results, loading: searchLoading } = useNoteSearch(query, {
    enabled: bootstrap?.status === 'ready',
    onError: (error) => setErrorMessage(error.message),
    mode: searchMode
  })

  useEffect(() => {
    let ignore = false

    const bootstrapApp = async (): Promise<void> => {
      try {
        const state = await window.api.notes.getBootstrap()
        if (ignore) {
          return
        }

        setBootstrap(state)
        setErrorMessage(null)

        if (state.status === 'ready') {
          for (const pin of state.pins ?? []) {
            pinNote(pin.filename, pin.depth)
          }
        }
      } catch (error) {
        if (!ignore) {
          setErrorMessage((error as Error).message)
        }
      } finally {
        if (!ignore) {
          setBootLoading(false)
        }
      }
    }

    void bootstrapApp()

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return window.api.notes.onIndexProgress(setIndexProgress)
  }, [])

  const displayedError = errorMessage ?? graphError

  // The single place that reacts to "notes changed" - every mutation (delete, edit,
  // create, connect, relation change, undo, ...) funnels through the backend's one
  // rebuild-and-emit path, so this is the only refresh wiring any of them need,
  // instead of each call site remembering to poke the graph *and* the search results.
  useEffect(() => {
    return window.api.notes.onChanged(() => {
      refetch()
    })
  }, [refetch])

  const handleRefresh = async (): Promise<void> => {
    setSettingsBusy(true)
    try {
      const state = await window.api.notes.refresh()
      setBootstrap(state)
      setErrorMessage(null)

      if (state.status === 'ready') {
        refetch()
      } else {
        clearPins()
      }
    } catch (error) {
      setErrorMessage((error as Error).message)
    } finally {
      setSettingsBusy(false)
    }
  }

  const handlePickDirectory = async (): Promise<void> => {
    const previousGraphPath = bootstrap?.graphPath
    setSettingsBusy(true)
    try {
      const state = await window.api.notes.pickDirectory()
      setBootstrap(state)
      setErrorMessage(null)

      // Only clear pins if the folder actually changed - the picker returns the
      // unchanged bootstrap state when the user cancels the dialog.
      if (state.graphPath !== previousGraphPath) {
        clearPins()
      }
    } catch (error) {
      setErrorMessage((error as Error).message)
    } finally {
      setSettingsBusy(false)
    }
  }

  const handlePinRandomOrphan = async (): Promise<void> => {
    setOrphanBusy(true)
    try {
      const response = await window.api.notes.randomOrphan({ exclude: Array.from(pins.keys()) })
      if (response.filename) {
        pinNote(response.filename, MANUAL_PIN_DEPTH)
        setErrorMessage(null)
      } else {
        setErrorMessage('No unopened orphan notes left to pin.')
      }
    } catch (error) {
      setErrorMessage((error as Error).message)
    } finally {
      setOrphanBusy(false)
    }
  }

  const handleOpenRandomWithNote = async (): Promise<void> => {
    setNotedBusy(true)
    try {
      const response = await window.api.notes.randomWithNotes({ exclude: Array.from(pins.keys()) })
      if (response.filename) {
        pinNote(response.filename, MANUAL_PIN_DEPTH)
        setErrorMessage(null)
      } else {
        setErrorMessage('No unopened notes with a note left to open.')
      }
    } catch (error) {
      setErrorMessage((error as Error).message)
    } finally {
      setNotedBusy(false)
    }
  }

  if (bootLoading) {
    const progressLabel =
      indexProgress && indexProgress.total > 0
        ? `Indexing notes… ${indexProgress.loaded.toLocaleString()} / ${indexProgress.total.toLocaleString()}`
        : 'Indexing notes…'

    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-base-300 bg-base-100 px-5 py-3 shadow-lg">
          <LoaderCircle className="size-5 animate-spin" />
          <span className="font-medium">{progressLabel}</span>
        </div>
      </div>
    )
  }

  return (
    <main className="h-screen p-4">
      <div className="grid h-[calc(100vh-2rem)] grid-cols-[minmax(0,1fr)_22rem] gap-4">
        <section className="relative min-h-0">
          <button
            type="button"
            className="btn btn-ghost btn-sm absolute right-4 top-4 z-20 rounded-full border border-base-300 bg-base-100/90"
            onClick={() => setSettingsOpen(true)}
            title="Configure graph folder"
          >
            <Settings2 className="size-4" />
          </button>

          {displayedError ? (
            <div className="alert alert-error alert-soft absolute left-4 top-4 z-20 max-w-md items-start shadow-lg">
              <AlertTriangle className="mt-0.5 size-4.5 shrink-0" />
              <p>{displayedError}</p>
            </div>
          ) : null}

          {bootstrap?.status === 'ready' ? (
            <GraphCanvas
              graph={graph}
              loading={graphLoading}
              pins={pins}
              onPinNote={pinNote}
              onUnpinNote={unpinNote}
              onSetPinDepth={setPinDepth}
            />
          ) : (
            <UnavailableState bootstrap={bootstrap} onOpenSettings={() => setSettingsOpen(true)} />
          )}
        </section>

        <aside className="flex min-h-0 flex-col rounded-box border border-base-300 bg-base-100/90 shadow-xl backdrop-blur">
          <div className="border-b border-base-300 px-4 py-4">
            <label className="input w-full">
              <Search className="size-4.5 text-base-content/60" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && results[0]) {
                    pinNote(results[0].filename, SEARCH_RESULT_PIN_DEPTH)
                  }
                }}
                placeholder="Search body or aliases…"
              />
              {searchLoading ? (
                <LoaderCircle className="size-4 animate-spin text-base-content/60" />
              ) : null}
              <SearchModeToggle
                mode={searchMode}
                onToggle={() => setSearchMode((current) => (current === 'fuzzy' ? 'raw' : 'fuzzy'))}
              />
            </label>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="btn btn-ghost btn-xs rounded-full border border-base-300 bg-base-100/75"
                onClick={() => void handleRefresh()}
                disabled={settingsBusy}
                title="Re-index graph folder"
              >
                <RefreshCw className={['size-3.5', settingsBusy ? 'animate-spin' : ''].join(' ')} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {!query.trim() ? (
              <div className="px-2 py-2 text-sm text-base-content/60">Search to open a note.</div>
            ) : null}

            {query.trim() && results.length === 0 && !searchLoading ? (
              <div className="px-2 py-2 text-sm text-base-content/60">No matches.</div>
            ) : null}

            <div className="space-y-2">
              {results.map((result) => {
                const isActive = pins.has(result.filename)
                return (
                  <button
                    key={result.filename}
                    type="button"
                    className={[
                      'block w-full rounded-box border px-4 py-3 text-left transition-colors',
                      isActive
                        ? 'border-primary/50 bg-primary/10'
                        : 'border-transparent bg-base-200/70 hover:border-base-300 hover:bg-base-100'
                    ].join(' ')}
                    onClick={() => pinNote(result.filename, SEARCH_RESULT_PIN_DEPTH)}
                  >
                    <p className="line-clamp-4 text-xs leading-5">{result.preview}</p>
                    {result.aliases.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {result.aliases.slice(0, 5).map((alias) => (
                          <span
                            key={alias}
                            className="rounded-full border border-base-300 px-2 py-0.5 text-xs text-base-content/60"
                          >
                            {alias}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-wrap border-t border-base-300 p-1">
            <button type="button" className="btn" onClick={clearPins} disabled={pins.size === 0}>
              <PinOff className="size-2" />
              Unpin all
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handlePinRandomOrphan()}
              disabled={orphanBusy}
            >
              <Dices className={['size-2', orphanBusy ? 'animate-spin' : ''].join(' ')} />
              Pin Orphan
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleOpenRandomWithNote()}
              disabled={notedBusy}
            >
              <StickyNote className={['size-2', notedBusy ? 'animate-spin' : ''].join(' ')} />
              Pin Random w/ Note
            </button>
            <button
              type="button"
              className="btn ml-auto"
              onClick={() => setStatsOpen(true)}
              disabled={bootstrap?.status !== 'ready'}
            >
              <ChartNoAxesCombined className="size-3.5" />
              Stats
            </button>
          </div>
        </aside>
      </div>

      <dialog className={['modal', settingsOpen ? 'modal-open' : ''].join(' ')}>
        <div className="modal-box max-w-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">Graph folder</h3>
              <p className="mt-2 text-sm leading-6 text-base-content/70">{bootstrap?.graphPath}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm rounded-full"
              onClick={() => setSettingsOpen(false)}
            >
              Close
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary rounded-full"
              disabled={settingsBusy}
              onClick={() => void handlePickDirectory()}
            >
              <FolderOpen className="size-4" />
              Choose folder
            </button>
            <button
              type="button"
              className="btn btn-outline rounded-full"
              disabled={settingsBusy}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw className={['size-4', settingsBusy ? 'animate-spin' : ''].join(' ')} />
              Re-index
            </button>
          </div>

          {bootstrap?.message ? (
            <div className="alert alert-warning alert-soft mt-5">{bootstrap.message}</div>
          ) : null}
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={() => setSettingsOpen(false)}>close</button>
        </form>
      </dialog>

      <StatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
    </main>
  )
}

function UnavailableState({
  bootstrap,
  onOpenSettings
}: {
  bootstrap: NotesBootstrap | null
  onOpenSettings: () => void
}): React.JSX.Element {
  const title =
    bootstrap?.status === 'missing-directory'
      ? 'Graph folder not found'
      : bootstrap?.status === 'empty'
        ? 'No notes indexed yet'
        : 'Graph unavailable'

  const message = bootstrap?.message ?? 'Choose the folder that contains your JSON notes.'

  return (
    <div className="flex h-full items-center justify-center rounded-box border border-dashed border-base-300 bg-base-100/70 px-8 text-center">
      <div className="max-w-lg space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm leading-6 text-base-content/70">{message}</p>
        </div>
        <button type="button" className="btn btn-primary rounded-full" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          Configure graph folder
        </button>
      </div>
    </div>
  )
}

export default App
