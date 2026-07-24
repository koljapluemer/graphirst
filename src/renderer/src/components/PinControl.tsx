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
        className="btn btn-ghost btn-xs nodrag rounded-full text-[#7c5b48] hover:bg-[#fdeee0] hover:text-[#b3672c]"
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
        className="btn btn-ghost btn-xs rounded-full text-[#7c5b48] disabled:opacity-30"
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
        className="btn btn-ghost btn-xs gap-1 rounded-full text-[#b3672c]"
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
        className="btn btn-ghost btn-xs rounded-full text-[#7c5b48]"
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
