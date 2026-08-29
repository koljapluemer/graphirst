/**
 * Builds the `media://` URL that the main-process protocol handler (see
 * src/main/index.ts) serves note images from. The filename is placed in the URL
 * path, never the authority: image files inherit their note's filename stem,
 * which is routinely not a valid URL host (leading `-`, spaces, uppercase, …) and
 * would otherwise make the image unreachable.
 */
export function mediaUrl(filename: string): string {
  return `media://images/${encodeURIComponent(filename)}`
}
