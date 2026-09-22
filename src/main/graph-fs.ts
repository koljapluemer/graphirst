/**
 * Layout constants for a graph folder, shared by the note index (NoteStore) and
 * the filesystem watcher (GraphWatcher) so the two agree on exactly which files
 * on disk are part of the graph.
 */
import {
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_MEDIA_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS
} from '../shared/media'

/** Subdirectory of the graph folder that holds note-attached media files (an image or a short video). */
export const IMAGES_DIR_NAME = 'images'

export { SUPPORTED_IMAGE_EXTENSIONS, SUPPORTED_VIDEO_EXTENSIONS, SUPPORTED_MEDIA_EXTENSIONS }

/** basename-without-extension of a media file: `<noteStem>-<epochMillis>`. */
export const IMAGE_STEM_PATTERN = /^(.+)-(\d+)$/
