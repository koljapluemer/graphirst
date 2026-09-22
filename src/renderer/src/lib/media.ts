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

/** Decodes any Chromium-supported image and returns a PNG for Electron's native clipboard API. */
export function imageUrlToPngDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight

      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Canvas 2D context is unavailable.'))
        return
      }

      context.drawImage(image, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('Chromium could not decode the image.'))
    image.src = src
  })
}
