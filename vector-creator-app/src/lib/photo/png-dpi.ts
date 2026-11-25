/**
 * Stamp a DPI into a PNG (its pHYs chunk), so LightBurn, Bambu Suite and
 * xTool open the image at the right physical size. Browsers' canvas.toBlob
 * never writes one.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  // PNG = 8-byte signature, then chunks: length(4) type(4) data crc(4). IHDR is first.
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Drop any existing pHYs, then insert ours right after IHDR.
  const parts: Uint8Array[] = [png.subarray(0, ihdrEnd), chunk];
  let i = ihdrEnd;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (i + 8 <= png.length) {
    const len = view.getUint32(i);
    const type = String.fromCharCode(png[i + 4], png[i + 5], png[i + 6], png[i + 7]);
    const end = i + 12 + len;
    if (type !== "pHYs") parts.push(png.subarray(i, end));
    i = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
