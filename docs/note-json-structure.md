# Note source JSON structure

Each note is one loose `.json` file directly inside `<graphFolder>/` (no
subfolder). There is no index, manifest, or database - the graph folder's
`.json` files ARE the database (see `src/main/note-store.ts`).

## On-disk shape

Type: `RawNoteFile` in `src/shared/notes.ts:3-23`. Every field is optional;
there is no runtime schema/validator (no zod, no `version` field) - reading
is defensive and treats a missing/malformed field as absent.

```ts
export type NoteRelationTuple = [label: string, target: string]

export interface RawNoteFile {
  body?: string
  rels?: NoteRelationTuple[]
  extra?: string
  notes?: string[]
  created?: string
  updated?: string
  opened?: string
  relationshipsChanged?: string
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `body` | `string` | Main/short text shown on the graph node. Defaults to `''` if missing. |
| `rels` | `[label, target][]` | Outgoing relationships to other notes - see below. Defaults to `[]`. |
| `extra` | `string` | Long-form content, shared verbatim with the sibling `../note` app (which owns this key). Key is deleted entirely (not stored as `""`) when emptied. |
| `notes` | `string[]` | Freeform comments/to-dos rendered on the node itself. Also deleted when emptied. |
| `created` | ISO-8601 `string` | Stamped once, the first time this app creates the note. Write-once - never overwritten afterward. |
| `updated` | ISO-8601 `string` | Stamped on any content edit (`body`, `extra`, or a `notes` entry). Also refreshes `opened` at the same instant. |
| `opened` | ISO-8601 `string` | Stamped whenever the note is opened onto the graph - pinned, created, or edited. |
| `relationshipsChanged` | ISO-8601 `string` | Stamped whenever this note's relationships change in either direction (a target added/removed, or a label changed, on this note or on one that targets it). |

There is **no** `id`/`uuid`, `title`, `position`/`x`/`y`, `color`, `tags`, or
`pinned` field in the file. Layout is computed live by ELK, not persisted;
pin state lives outside the graph folder entirely (see below).

## Identity: the filename is the key

There is no stored id. Every reference to a note elsewhere in the app - in
another note's `rels`, in the pins list, in the in-memory index - is that
note's **filename**, e.g. `my-note-a1b2c3.json`.

- Generated once at creation time from the note's initial `body`
  (`generateFilename`/`slugifyBody`, `note-store.ts:1981-1999`): lowercase,
  slugify to `[a-z0-9-]`, first ~40 chars, then a random 6-hex-char suffix,
  e.g. body "Buy milk and eggs" → `buy-milk-and-eggs-a1b2c3.json`.
- Never regenerated on edit, so the filename can drift out of sync with the
  note's current `body` over its lifetime.
- There is no exposed rename operation. Renaming a note's file outside the
  app is indistinguishable from "deleted + new file created" and will break
  every relationship pointing at the old filename (see dangling relations,
  below) - the filename is effectively permanent once assigned.

## Relationships (`rels`)

Stored as an array of `[label, target]` tuples, one entry per **outgoing**
relationship only:

```json
"rels": [["clarifies", "other-note-f00b4r.json"], ["related", "third-note-abc123.json"]]
```

- `target` is another note's filename (not a separate id).
- `label` is freeform text; falls back to `'related'` if blank.
- Incoming relationships are **not** stored anywhere - they are computed
  purely in memory by scanning every note's `rels` and building a reverse
  index. The graph is conceptually directed but traversed bidirectionally at
  runtime; nothing extra is written to disk for that.
- No other per-edge metadata (no type, color, weight, or id) is persisted.
- Malformed entries (not a 2+-element array of strings) are silently
  dropped on read.
- Dangling relations are auto-repaired: a target file that's missing is
  dropped from the in-memory graph (recoverable if the file reappears, e.g.
  via undo); a relation pointing at a target that exists but has an empty
  `body` is actually stripped from the source file on disk.

## Versioning

None. The format has no `version` field and no migration logic - every
field has always been optional, and unknown/extra keys written by other
tools sharing the folder are read into an untyped record and preserved
verbatim across edits rather than dropped or migrated.

## Pin/open state lives outside the graph folder

Which notes are currently pinned onto the graph (and to what depth) is
**not** part of the note JSON. It's stored in a separate settings file
(`graphirst-settings.json`, outside the graph folder, alongside the
configured graph path):

```ts
interface StoredSettings {
  graphPath?: string
  pins?: PinSpec[] // { filename: string; depth: number }
}
```

## Media attachments

Images/video are **not** referenced anywhere in the note JSON at all -
matched purely by filename-stem convention against the `images/`
subfolder. See [media-attachments.md](./media-attachments.md) for the full
contract.

## Key file references

- Types: `src/shared/notes.ts:1-48` (`NoteRelationTuple`, `RawNoteFile`, `NoteLink`, `IndexedNote`)
- Read/normalize: `src/main/note-store.ts:1435-1481` (`readNoteFile`, `normalizeRelation`)
- Write/mutate: `src/main/note-store.ts:2001-2112` (`writeNoteFile`, `mutateRawNote`, `mutateRelations`)
- Filename generation: `src/main/note-store.ts:1981-1999`
- Timestamp stamping: `src/main/note-store.ts:2021-2047`
- Dangling-relation repair: `src/main/note-store.ts:1483-1548`
- Settings/pins: `src/main/note-store.ts:62, 85-88, 2186-2201`
