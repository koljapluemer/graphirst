# Note media attachments (images and video)

Each note may have a single attached media file: an image, or (as of this
change) a short video, alternative not additive - one attachment per note.

## On-disk contract

- The attachment is a loose file inside `<graphFolder>/images/`, named
  `<noteStem>-<epochMillis>.<ext>`, e.g. `my-note-1758540000000.webp` or
  `my-note-1758540000000.mp4`. `<noteStem>` is the note's `.json` filename
  without the extension.
- The note's own JSON file (`<noteStem>.json`) never references the
  attachment. The link is purely by filename stem: a reader matches a note to
  its media by scanning `images/` for the newest file whose name starts with
  `<noteStem>-`.
- Only one attachment is considered live per stem. If more than one file
  shares a stem (e.g. a stale file left behind by a crashed write), the one
  with the greatest `<epochMillis>` wins.
- The directory name (`images/`) is unchanged and now holds both file kinds -
  it was not renamed to `media/` to avoid a breaking change for readers of
  this folder.

## Recognised extensions

| Kind  | Extensions              |
| ----- | ------------------------ |
| Image | `jpg`, `jpeg`, `png`, `gif`, `webp`, `bmp` |
| Video | `mp4`, `webm`, `mov`      |

A reader should treat any other extension found in `images/` as not a note
attachment (ignore it), the same way it already ignores non-matching or
malformed filenames.

## Telling image and video apart

There is no separate "kind" field anywhere - a reader decides by file
extension alone, the same way this app does (see
`src/shared/media.ts:isVideoFilename` in this repo).

## Size expectations

Videos are meant to be short clips, not general video hosting. This app caps
an attached video at a certain value and does not transcode or compress it before
writing it to disk (unlike images, which are downscaled/re-encoded client
side). A reader does not need to enforce this itself, but should not assume
video files in `images/` are small without checking.

## Suggested support in `../note`

To display these attachments, `../note` needs to:

1. Resolve a note's attachment filename the same way it already does for
   images (newest file in `images/` matching the note's stem).
2. Branch on the extension: render `<img>` for an image extension, `<video>`
   for a video extension.
3. For video, keep playback minimal - muted, no autoplay, a single play/pause
   control. No scrubber, volume, or fullscreen UI is expected by this app's
   own attachments, so parity isn't required, but keeping it simple avoids
   surprising size/complexity differences between the two apps' renderings of
   the same file.
