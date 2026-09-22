import { Pause, Play } from 'lucide-react'
import { useRef, useState } from 'react'

export interface MediaPreviewProps {
  src: string
  kind: 'image' | 'video'
  className?: string
}

/**
 * Renders a note's attached image, or a short muted video with a single
 * play/pause toggle - no scrubber, volume, or fullscreen chrome. Shared between
 * NoteCard (read-only) and DraftNoteCard (create/edit preview).
 */
export default function MediaPreview({
  src,
  kind,
  className
}: MediaPreviewProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  if (kind === 'image') {
    return <img src={src} alt="" className={className} />
  }

  const toggle = (): void => {
    const video = videoRef.current
    if (!video) {
      return
    }
    if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <video
        ref={videoRef}
        src={src}
        className="h-auto w-full"
        muted
        playsInline
        loop
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        type="button"
        className="btn btn-circle btn-sm absolute inset-0 m-auto border-none bg-base-100/70 hover:bg-base-100/90"
        onClick={toggle}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 pl-0.5" />}
      </button>
    </div>
  )
}
