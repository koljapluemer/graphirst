import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Dices,
  FolderOpen,
  LoaderCircle,
  PinOff,
  RefreshCw,
  Search,
  Settings2
} from 'lucide-react'
import GraphCanvas from './components/GraphCanvas'
import { MANUAL_PIN_DEPTH, SEARCH_RESULT_PIN_DEPTH, useNoteGraph } from './hooks/useNoteGraph'
import { useNoteSearch } from './hooks/useNoteSearch'
import type { NotesBootstrap } from '../../shared/notes'

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
  const [bootLoading, setBootLoading] = useState(true)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [orphanBusy, setOrphanBusy] = useState(false)
  const { results, loading: searchLoading } = useNoteSearch(query, {
    enabled: bootstrap?.status === 'ready',
    onError: (error) => setErrorMessage(error.message)
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

  if (bootLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" data-theme="autumn">
        <div className="flex items-center gap-3 rounded-full border border-[#ead8c8] bg-[rgba(255,250,245,0.92)] px-5 py-3 text-[#6f5444] shadow-lg">
          <LoaderCircle className="size-5 animate-spin" />
          <span className="font-medium">Indexing notes…</span>
        </div>
      </div>
    )
  }

  return (
    <main className="h-screen p-4 text-[#2c1f17]" data-theme="autumn">
      <div className="grid h-[calc(100vh-2rem)] grid-cols-[minmax(0,1fr)_22rem] gap-4">
        <section className="relative min-h-0">
          <button
            type="button"
            className="btn btn-ghost btn-sm absolute right-4 top-4 z-20 rounded-full border border-[#e5d7c8] bg-[rgba(255,250,245,0.92)]"
            onClick={() => setSettingsOpen(true)}
            title="Configure graph folder"
          >
            <Settings2 className="size-4" />
          </button>

          {displayedError ? (
            <div className="absolute left-4 top-4 z-20 flex max-w-md items-start gap-3 rounded-[20px] border border-[#edcdbf] bg-[#fff4ee] px-4 py-3 text-sm text-[#7c4c33] shadow-lg">
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

        <aside className="flex min-h-0 flex-col rounded-[24px] border border-[#e2d3c4] bg-[rgba(255,252,247,0.9)] shadow-[0_24px_70px_rgba(122,95,74,0.11)] backdrop-blur">
          <div className="border-b border-[#ecdfd2] px-4 py-4">
            <label className="flex items-center gap-3 rounded-[20px] border border-[#e8d9ca] bg-white/85 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <Search className="size-4.5 text-[#9a7964]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && results[0]) {
                    pinNote(results[0].filename, SEARCH_RESULT_PIN_DEPTH)
                  }
                }}
                placeholder="Search body or aliases…"
                className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-[#a18877]"
              />
              {searchLoading ? (
                <LoaderCircle className="size-4 animate-spin text-[#8f6f5b]" />
              ) : null}
            </label>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="btn btn-ghost btn-xs rounded-full border border-[#e7d9cb] bg-[rgba(255,248,241,0.75)]"
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
              <div className="px-2 py-2 text-sm text-[#7a6051]">Search to open a note.</div>
            ) : null}

            {query.trim() && results.length === 0 && !searchLoading ? (
              <div className="px-2 py-2 text-sm text-[#7a6051]">No matches.</div>
            ) : null}

            <div className="space-y-2">
              {results.map((result) => {
                const isActive = pins.has(result.filename)
                return (
                  <button
                    key={result.filename}
                    type="button"
                    className={[
                      'block w-full rounded-[20px] border px-4 py-3 text-left transition-colors',
                      isActive
                        ? 'border-[#da8760] bg-[#fff1e4]'
                        : 'border-transparent bg-[rgba(252,248,242,0.82)] hover:border-[#e8d7c8] hover:bg-white'
                    ].join(' ')}
                    onClick={() => pinNote(result.filename, SEARCH_RESULT_PIN_DEPTH)}
                  >
                    <p className="line-clamp-4 text-xs leading-5 text-[#2f2219]">
                      {result.preview}
                    </p>
                    {result.aliases.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {result.aliases.slice(0, 5).map((alias) => (
                          <span
                            key={alias}
                            className="rounded-full border border-[#eadacd] px-2 py-0.5 text-[11px] text-[#7b604f]"
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

          <div className="flex items-center gap-2 border-t border-[#ecdfd2] px-4 py-3">
            <button
              type="button"
              className="btn"
              onClick={clearPins}
              disabled={pins.size === 0}
            >
              <PinOff className="size-4" />
              Unpin all
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handlePinRandomOrphan()}
              disabled={orphanBusy}
            >
              <Dices className={['size-4', orphanBusy ? 'animate-spin' : ''].join(' ')} />
              Pin Orphan
            </button>
          </div>
        </aside>
      </div>

      <dialog className={['modal', settingsOpen ? 'modal-open' : ''].join(' ')}>
        <div className="modal-box max-w-xl rounded-[24px] border border-[#e3d4c5] bg-[rgba(255,252,247,0.98)] shadow-[0_35px_90px_rgba(122,95,74,0.2)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-sans text-xl font-semibold">Graph folder</h3>
              <p className="mt-2 text-sm leading-6 text-[#745b4c]">{bootstrap?.graphPath}</p>
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
              className="btn rounded-full border-[#d6b49e] bg-[#d86f49] text-white hover:bg-[#c8623d]"
              disabled={settingsBusy}
              onClick={() => void handlePickDirectory()}
            >
              <FolderOpen className="size-4" />
              Choose folder
            </button>
            <button
              type="button"
              className="btn btn-outline rounded-full border-[#decdbd] bg-white/70 text-[#64493a] hover:bg-[#f7efe6]"
              disabled={settingsBusy}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw className={['size-4', settingsBusy ? 'animate-spin' : ''].join(' ')} />
              Re-index
            </button>
          </div>

          {bootstrap?.message ? (
            <div className="mt-5 rounded-[20px] border border-[#edd1c4] bg-[#fff4ee] px-4 py-3 text-sm text-[#7c4d34]">
              {bootstrap.message}
            </div>
          ) : null}
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={() => setSettingsOpen(false)}>close</button>
        </form>
      </dialog>
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
    <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-[#dfceb9] bg-[rgba(255,251,246,0.72)] px-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
      <div className="max-w-lg space-y-4">
        <div className="space-y-2">
          <h2 className="font-sans text-xl font-semibold text-[#2d2018]">{title}</h2>
          <p className="text-sm leading-6 text-[#715748]">{message}</p>
        </div>
        <button
          type="button"
          className="btn rounded-full border-[#d6b49e] bg-[#d86f49] text-white hover:bg-[#c8623d]"
          onClick={onOpenSettings}
        >
          <Settings2 className="size-4" />
          Configure graph folder
        </button>
      </div>
    </div>
  )
}

export default App
