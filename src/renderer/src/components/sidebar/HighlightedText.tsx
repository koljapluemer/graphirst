import type { MatchRange } from '../../../../shared/notes'

export interface HighlightedTextProps {
  text: string
  match: MatchRange | null
}

export default function HighlightedText({ text, match }: HighlightedTextProps): React.JSX.Element {
  if (!match || match.length === 0) {
    return <>{text}</>
  }

  const end = match.start + match.length
  return (
    <>
      {text.slice(0, match.start)}
      <mark className="bg-primary/30 text-inherit">{text.slice(match.start, end)}</mark>
      {text.slice(end)}
    </>
  )
}
