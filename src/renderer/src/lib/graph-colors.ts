/**
 * React Flow feeds these straight into SVG `stroke`/`fill`/`color` attributes, which
 * can't take a Tailwind class or a `var(--color-*)` reference - only a literal color.
 * Kept as one module, mirroring the theme tokens in main.css, so there's a single
 * place to update instead of duplicated hex codes scattered across edge/canvas code.
 */
export const GRAPH_COLORS = {
  primary: '#d86f49',
  secondary: '#0f6f6d',
  accent: '#b3672c',
  neutral: '#6b5143',
  base100: '#fffcf7',
  base300: '#e2d3c4'
} as const
