Basic electron+React skeleton.

Goal: display (sections of) json notes as a navigable graph.
For now, two simple components:

Left, the main graph view. Right, a sidebar where we can search for notes (by body, some basic smart search), and click on them to open them in the graph.
"Open" means: Render note in the center, and show relationships w/ depth 2 around it.

Source of truth: a folder of JSON notes on disk. The user selects this folder via an
icon-button controlled settings modal; there is no built-in default path.

files all have a shape like this:
```
{
  "body": "comprehensible input\n\n#Gestalt",
  "rels": [
    [
      "backlink",
      "preloading-9jgemz.json"
    ],
    [
      "core idea",
      "⁓ acquire a language by taking in (barely) comprehensible input.json"
    ]
  ],
  "aliases": [
    "CI",
    "i+1"
  ]
}
```

Render the body as markdown, on the graph, w/o ellipsis/cutoff.
Each rels object describes an edge label and the note it's pointing at (filename).

Add needed libraries, e.g. but not limited to:
- tailwind+daisy (latest stable!) for UI
- reactflow (graph core) https://reactflow.dev/examples
- lucide (latest recommendation for stack) for icons
- markdown renderer
- possibly plaintext search library, if that's a win

This is a personal app, so don't overexplain features etc.
However, we already have 5k notes, and may scale to 100k+ notes, with dense relationships.
Do not skimp on quality in core features, graph interaction has to be smooth.
