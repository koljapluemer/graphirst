import { ChevronDown, ChevronUp, Pin } from 'lucide-react'

export default function PinControl({
  pinDepth,
  onPin,
  onUnpin,
  onChangeDepth
}: {
  pinDepth: number | null
  onPin: () => void
  onUnpin: () => void
  onChangeDepth: (nextDepth: number) => void
}): React.JSX.Element {
  if (pinDepth === null) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-xs nodrag rounded-full hover:bg-accent/10 hover:text-accent"
        onClick={(event) => {
          event.stopPropagation()
          onPin()
        }}
        title="Pin this note"
      >
        <Pin className="size-3.5" />
      </button>
    )
  }

  return (
    <div className="nodrag flex items-center gap-0.5">
      <button
        type="button"
        className="btn btn-ghost btn-xs rounded-full disabled:opacity-30"
        onClick={(event) => {
          event.stopPropagation()
          onChangeDepth(pinDepth - 1)
        }}
        disabled={pinDepth === 0}
        title="Show fewer hops"
      >
        <ChevronDown className="size-3.5" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs gap-1 rounded-full text-accent"
        onClick={(event) => {
          event.stopPropagation()
          onUnpin()
        }}
        title="Unpin this note"
      >
        <Pin className="size-3.5 fill-current" />
        <span className="text-xs font-medium">{pinDepth}</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs rounded-full"
        onClick={(event) => {
          event.stopPropagation()
          onChangeDepth(pinDepth + 1)
        }}
        title="Show more hops"
      >
        <ChevronUp className="size-3.5" />
      </button>
    </div>
  )
}
