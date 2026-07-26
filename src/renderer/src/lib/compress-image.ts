const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

export interface CompressedImage {
  dataUrl: string
}

/**
 * Downscales and re-encodes a pasted/dropped image file entirely client-side, so a
 * multi-megabyte screenshot never gets written to the (synced) media folder as-is.
 * Encodes as WebP where the runtime supports it, falling back to whatever
 * HTMLCanvasElement.toDataURL actually produced (Chromium always supports WebP, but
 * this keeps the check honest rather than assuming it).
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas 2D context is unavailable.')
    }
    context.drawImage(bitmap, 0, 0, width, height)

    return { dataUrl: canvas.toDataURL('image/webp', JPEG_QUALITY) }
  } finally {
    bitmap.close()
  }
}
