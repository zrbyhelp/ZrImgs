interface DownloadableImage {
  url?: string
  fileName?: string
  id?: string
}

export function useImageDownload() {
  function downloadImage(image: DownloadableImage | null | undefined, fallbackName = 'image') {
    if (!image?.url || typeof document === 'undefined') return

    const link = document.createElement('a')
    link.href = image.url
    link.download = safeFileName(image.fileName || `${fallbackName}.png`)
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return { downloadImage }
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'image.png'
}
