/**
 * Layout constants for a graph folder, shared by the note index (NoteStore) and
 * the filesystem watcher (GraphWatcher) so the two agree on exactly which files
 * on disk are part of the graph.
 */

/** Subdirectory of the graph folder that holds note-attached image files. */
export const IMAGES_DIR_NAME = 'images'

/** Recognised image file extensions, lowercase and without the leading dot. */
export const SUPPORTED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp'
])

/** basename-without-extension of an image file: `<noteStem>-<epochMillis>`. */
export const IMAGE_STEM_PATTERN = /^(.+)-(\d+)$/
