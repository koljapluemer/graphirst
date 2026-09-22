/**
 * Media-attachment constants shared by the main process (validation, disk I/O)
 * and the renderer (deciding whether to render an `<img>` or a `<video>`).
 */

/** Recognised image file extensions, lowercase and without the leading dot. */
export const SUPPORTED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp'
])

/**
 * Recognised video file extensions, lowercase and without the leading dot. Kept
 * small on purpose: this is for a short clip attached to a note, not general
 * video hosting - see MAX_VIDEO_ATTACHMENT_BYTES.
 */
export const SUPPORTED_VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'webm', 'mov'])

/** Every extension a note's single media attachment may have, image or video. */
export const SUPPORTED_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS
])

/**
 * Upper bound on an attached video's byte size, enforced client-side (instant
 * feedback in DraftNoteCard) and server-side (authoritative, in
 * NoteStore.attachImage). Unlike an image, a pasted video isn't re-encoded
 * before being written to disk, so this is the only thing keeping an
 * oversized file out of the media folder.
 */
export const MAX_VIDEO_ATTACHMENT_BYTES = 250 * 1024 * 1024

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/** Whether `filename`'s extension identifies it as a video rather than an image. */
export function isVideoFilename(filename: string): boolean {
  return SUPPORTED_VIDEO_EXTENSIONS.has(extensionOf(filename))
}
