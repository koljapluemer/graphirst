import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { LoaderCircle } from 'lucide-react'
import type { StatsResponse } from '../../../shared/notes'

interface StatsModalProps {
  open: boolean
  onClose: () => void
}

const SERIES = [
  { key: 'noteCount', label: 'Nodes', color: '#d86f49' },
  { key: 'relationCount', label: 'Relationships', color: '#0f6f6d' },
  { key: 'islandCount', label: 'Islands', color: '#b3672c' },
  { key: 'orphanCount', label: 'Orphans', color: '#6b5143' }
] as const

export default function StatsModal({ open, onClose }: StatsModalProps): React.JSX.Element {
  const [response, setResponse] = useState<StatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    let ignore = false
    void window.api.notes
      .openStats()
      .then((result) => {
        if (!ignore) {
          setResponse(result)
          setError(null)
        }
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message)
      })

    return () => {
      ignore = true
    }
  }, [open])

  const chartData = useMemo(
    () =>
      response?.history.flatMap((day) => {
        const samples =
          day.first.capturedAt === day.last.capturedAt ? [day.first] : [day.first, day.last]
        return samples.map((sample) => ({
          ...sample,
          timestamp: new Date(sample.capturedAt).getTime()
        }))
      }) ?? [],
    [response]
  )

  return (
    <dialog className={['modal', open ? 'modal-open' : ''].join(' ')}>
      <div className="modal-box w-11/12 max-w-5xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">Stats</h3>
            <p className="mt-1 text-sm text-base-content/60">Daily first and last snapshots</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm rounded-full" onClick={onClose}>
            Close
          </button>
        </div>

        {!response && !error ? (
          <div className="flex h-72 items-center justify-center">
            <LoaderCircle className="size-6 animate-spin text-base-content/60" />
          </div>
        ) : null}

        {error ? <div className="alert alert-error alert-soft mt-5">{error}</div> : null}

        {response ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {SERIES.map((series) => (
                <div
                  key={series.key}
                  className="rounded-box border border-base-300 bg-base-200/60 p-4"
                >
                  <div className="text-sm text-base-content/60">{series.label}</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {response.current[series.key].toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 h-80 rounded-box border border-base-300 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid
                    stroke="currentColor"
                    className="text-base-300"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={formatChartDate}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={48} />
                  <Tooltip labelFormatter={(value) => formatTooltipDate(Number(value))} />
                  <Legend />
                  {SERIES.map((series) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      name={series.label}
                      stroke={series.color}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : null}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  )
}

function formatChartDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

function formatTooltipDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp)
}
