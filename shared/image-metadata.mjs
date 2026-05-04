export function inferImageMetadata(buffer, mime = '') {
  if (!Buffer.isBuffer(buffer)) {
    return { mime: mime || 'application/octet-stream', width: null, height: null, ext: 'bin' }
  }

  const png = readPng(buffer)
  if (png) {
    return { mime: 'image/png', width: png.width, height: png.height, ext: 'png' }
  }

  const jpeg = readJpeg(buffer)
  if (jpeg) {
    return { mime: 'image/jpeg', width: jpeg.width, height: jpeg.height, ext: 'jpg' }
  }

  const webp = readWebp(buffer)
  if (webp) {
    return { mime: 'image/webp', width: webp.width, height: webp.height, ext: 'webp' }
  }

  if (mime.includes('png')) return { mime: 'image/png', width: null, height: null, ext: 'png' }
  if (mime.includes('jpeg') || mime.includes('jpg')) return { mime: 'image/jpeg', width: null, height: null, ext: 'jpg' }
  if (mime.includes('webp')) return { mime: 'image/webp', width: null, height: null, ext: 'webp' }

  return { mime: mime || 'application/octet-stream', width: null, height: null, ext: 'bin' }
}

function readPng(buffer) {
  if (buffer.length < 24) return null
  const signature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== signature) return null
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

function readJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  let offset = 2
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)

    if (isSof && offset + 8 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      }
    }

    offset += 2 + length
  }

  return null
}

function readWebp(buffer) {
  if (buffer.length < 30) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null

  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    }
  }

  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    }
  }

  return null
}
