// ============================================
// Lightweight image inspector — no native deps.
// Reads dimensions + whether the file carries an alpha channel by parsing
// container headers only (no full decode). Good enough to reject obviously
// low-resolution uploads and images that can't have a transparent background.
// ============================================

function readUInt32BE(buf, off) {
  return (
    ((buf[off] << 24) >>> 0) +
    (buf[off + 1] << 16) +
    (buf[off + 2] << 8) +
    buf[off + 3]
  );
}

function inspectPng(buf) {
  // Signature: 89 50 4E 47 0D 0A 1A 0A, then IHDR chunk.
  const width = readUInt32BE(buf, 16);
  const height = readUInt32BE(buf, 20);
  const colorType = buf[25]; // 0 gray, 2 rgb, 3 palette, 4 gray+alpha, 6 rgba
  let hasAlpha = colorType === 4 || colorType === 6;

  // Palette images can still be transparent via a tRNS chunk — scan chunks.
  if (!hasAlpha) {
    let off = 8;
    while (off + 8 <= buf.length) {
      const len = readUInt32BE(buf, off);
      const type = buf.toString("ascii", off + 4, off + 8);
      if (type === "tRNS") {
        hasAlpha = true;
        break;
      }
      if (type === "IDAT" || type === "IEND") break; // alpha info comes before pixels
      off += 12 + len; // length(4) + type(4) + data(len) + crc(4)
    }
  }

  return { format: "png", width, height, hasAlpha };
}

function inspectJpeg(buf) {
  // JPEG cannot store an alpha channel — transparency is impossible.
  let off = 2; // skip SOI (FF D8)
  let width = null;
  let height = null;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    // SOF0..SOF15 carry frame dimensions (skip DHT=C4, JPG=C8, DAC=CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      height = (buf[off + 5] << 8) + buf[off + 6];
      width = (buf[off + 7] << 8) + buf[off + 8];
      break;
    }
    const segLen = (buf[off + 2] << 8) + buf[off + 3];
    if (segLen <= 0) break;
    off += 2 + segLen;
  }
  return { format: "jpeg", width, height, hasAlpha: false };
}

function inspectGif(buf) {
  const width = buf[6] + (buf[7] << 8);
  const height = buf[8] + (buf[9] << 8);
  // GIF transparency is per-frame and uncommon for these uploads — treat as
  // unknown rather than asserting alpha.
  return { format: "gif", width, height, hasAlpha: null };
}

function inspectWebp(buf) {
  const fourcc = buf.toString("ascii", 12, 16);
  if (fourcc === "VP8X") {
    const flags = buf[20];
    const hasAlpha = (flags & 0x10) !== 0;
    const width = 1 + (buf[24] + (buf[25] << 8) + (buf[26] << 16));
    const height = 1 + (buf[27] + (buf[28] << 8) + (buf[29] << 16));
    return { format: "webp", width, height, hasAlpha };
  }
  if (fourcc === "VP8L") {
    const b = [buf[21], buf[22], buf[23], buf[24]];
    const bits = b[0] + (b[1] << 8) + (b[2] << 16) + (b[3] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    const hasAlpha = ((bits >> 28) & 1) === 1;
    return { format: "webp", width, height, hasAlpha };
  }
  if (fourcc === "VP8 ") {
    // Lossy simple format — no alpha.
    const width = ((buf[27] << 8) | buf[26]) & 0x3fff;
    const height = ((buf[29] << 8) | buf[28]) & 0x3fff;
    return { format: "webp", width, height, hasAlpha: false };
  }
  return { format: "webp", width: null, height: null, hasAlpha: null };
}

/**
 * Inspect an image buffer.
 * @returns {{format, width, height, hasAlpha}} — width/height/hasAlpha may be
 *   null when they can't be determined (caller should treat null as "unknown").
 */
export function inspectImage(buf) {
  try {
    if (!buf || buf.length < 24) {
      return { format: "unknown", width: null, height: null, hasAlpha: null };
    }
    // PNG
    if (
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    ) {
      return inspectPng(buf);
    }
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      return inspectJpeg(buf);
    }
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return inspectGif(buf);
    }
    // WEBP (RIFF....WEBP)
    if (
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP"
    ) {
      return inspectWebp(buf);
    }
    // HEIC/HEIF and others — can't parse cheaply; treat as unknown.
    return { format: "unknown", width: null, height: null, hasAlpha: null };
  } catch {
    return { format: "unknown", width: null, height: null, hasAlpha: null };
  }
}

/**
 * Apply upload quality rules. Returns { ok: true } or { ok: false, reason }.
 *
 * Env:
 *   PHOTO_MIN_DIMENSION      min px on the short side (default 500; 0 disables)
 *   PHOTO_REQUIRE_TRANSPARENT "true" to reject images without a transparent
 *                            background (default off — most parent photos are
 *                            normal photos and don't have one).
 */
export function checkUploadedPhoto(buf) {
  const info = inspectImage(buf);
  const minDim = parseInt(process.env.PHOTO_MIN_DIMENSION ?? "500", 10);
  const requireTransparent =
    String(process.env.PHOTO_REQUIRE_TRANSPARENT).toLowerCase() === "true";

  if (minDim > 0 && info.width && info.height) {
    const shortSide = Math.min(info.width, info.height);
    if (shortSide < minDim) {
      return {
        ok: false,
        info,
        reason: `This photo looks low-resolution (${info.width}×${info.height}px). Please upload a clearer photo at least ${minDim}px on the shortest side.`,
      };
    }
  }

  if (requireTransparent && info.hasAlpha === false) {
    return {
      ok: false,
      info,
      reason:
        "This photo needs a transparent background. Please upload a PNG with the background removed.",
    };
  }

  return { ok: true, info };
}
