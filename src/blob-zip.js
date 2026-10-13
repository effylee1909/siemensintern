// Stored ZIP/ZIP64 with Blob slices: memory use is bounded by one read chunk.
const enc = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
async function checksum(blob) {
  let crc = -1;
  for (let start = 0; start < blob.size; start += 1024 * 1024) {
    const bytes = new Uint8Array(await blob.slice(start, start + 1024 * 1024).arrayBuffer());
    for (const b of bytes) crc = (crc >>> 8) ^ table[(crc ^ b) & 255];
  }
  return (crc ^ -1) >>> 0;
}
const block = (size) => {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  return { bytes, view };
};
const u64 = (view, offset) => {
  const n = Number(view.getBigUint64(offset, true));
  if (!Number.isSafeInteger(n)) throw Error('ZIP 位址過大');
  return n;
};
export async function createBlobZip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const { name, blob } of files) {
    const filename = enc.encode(name), crc = await checksum(blob);
    if (blob.size >= 0xffffffff) throw Error('單一 ZIP 項目過大');
    const local = block(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 45, true);
    local.view.setUint16(6, 0x800, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, blob.size, true);
    local.view.setUint32(22, blob.size, true);
    local.view.setUint16(26, filename.length, true);
    const wide = offset >= 0xffffffff;
    const record = block(46), extra = block(wide ? 28 : 0);
    record.view.setUint32(0, 0x02014b50, true);
    record.view.setUint16(4, 45, true);
    record.view.setUint16(6, 45, true);
    record.view.setUint16(8, 0x800, true);
    record.view.setUint32(16, crc, true);
    record.view.setUint32(20, wide ? 0xffffffff : blob.size, true);
    record.view.setUint32(24, wide ? 0xffffffff : blob.size, true);
    record.view.setUint16(28, filename.length, true);
    record.view.setUint16(30, extra.bytes.length, true);
    record.view.setUint32(42, wide ? 0xffffffff : offset, true);
    if (wide) {
      extra.view.setUint16(0, 1, true);
      extra.view.setUint16(2, 24, true);
      extra.view.setBigUint64(4, BigInt(blob.size), true);
      extra.view.setBigUint64(12, BigInt(blob.size), true);
      extra.view.setBigUint64(20, BigInt(offset), true);
    }
    parts.push(local.bytes, filename, blob);
    central.push(record.bytes, filename, extra.bytes);
    offset += 30 + filename.length + blob.size;
  }
  const directory = new Blob(central), end64 = block(56), locator = block(20), end = block(22);
  end64.view.setUint32(0, 0x06064b50, true);
  end64.view.setBigUint64(4, 44n, true);
  end64.view.setUint16(12, 45, true);
  end64.view.setUint16(14, 45, true);
  end64.view.setBigUint64(24, BigInt(files.length), true);
  end64.view.setBigUint64(32, BigInt(files.length), true);
  end64.view.setBigUint64(40, BigInt(directory.size), true);
  end64.view.setBigUint64(48, BigInt(offset), true);
  locator.view.setUint32(0, 0x07064b50, true);
  locator.view.setBigUint64(8, BigInt(offset + directory.size), true);
  locator.view.setUint32(16, 1, true);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, 0xffff, true);
  end.view.setUint16(10, 0xffff, true);
  end.view.setUint32(12, 0xffffffff, true);
  end.view.setUint32(16, 0xffffffff, true);
  return new Blob([...parts, directory, end64.bytes, locator.bytes, end.bytes], { type: 'application/zip' });
}
export async function readBlobZip(file) {
  const read = async (start, length) => {
    if (start < 0 || length < 0 || start + length > file.size) throw Error('ZIP 檔案不完整');
    return new DataView(await file.slice(start, start + length).arrayBuffer());
  };
  const tailStart = Math.max(0, file.size - 65557), tail = await read(tailStart, file.size - tailStart);
  let e = tail.byteLength - 22;
  while (e >= 0 && (tail.getUint32(e, true) !== 0x06054b50 || e + 22 + tail.getUint16(e + 20, true) !== tail.byteLength)) e--;
  if (e < 0) throw Error('不是完整 ZIP 備份');
  if (tail.getUint16(e + 4, true) || tail.getUint16(e + 6, true)) throw Error('不支援分卷 ZIP');
  let count = tail.getUint16(e + 10, true), size = tail.getUint32(e + 12, true), offset = tail.getUint32(e + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locator = await read(tailStart + e - 20, 20);
    if (locator.getUint32(0, true) !== 0x07064b50 || locator.getUint32(4, true) || locator.getUint32(16, true) !== 1) throw Error('ZIP64 格式不正確');
    const end = await read(u64(locator, 8), 56);
    if (end.getUint32(0, true) !== 0x06064b50 || end.getUint32(16, true) || end.getUint32(20, true)) throw Error('ZIP64 格式不正確');
    count = u64(end, 32); size = u64(end, 40); offset = u64(end, 48);
  }
  if (count > 20001 || size > 16 * 1024 * 1024 || offset + size > tailStart + e) throw Error('ZIP 目錄超過限制');
  const dir = await read(offset, size), entries = new Map(), dec = new TextDecoder();
  let pos = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > size || dir.getUint32(pos, true) !== 0x02014b50) throw Error('ZIP 目錄損毀');
    const flags = dir.getUint16(pos + 8, true), method = dir.getUint16(pos + 10, true), crc = dir.getUint32(pos + 16, true);
    let length = dir.getUint32(pos + 24, true), packed = dir.getUint32(pos + 20, true);
    const nl = dir.getUint16(pos + 28, true), xl = dir.getUint16(pos + 30, true), cl = dir.getUint16(pos + 32, true);
    if (pos + 46 + nl + xl + cl > size || dir.getUint16(pos + 34, true)) throw Error('ZIP 目錄損毀');
    const name = dec.decode(new Uint8Array(dir.buffer, pos + 46, nl));
    if (entries.has(name) || (name !== 'workspace.json' && !/^attachments\/\d{6}\.pptx$/.test(name))) throw Error('ZIP 包含重複或不支援的項目');
    let localOffset = dir.getUint32(pos + 42, true);
    if (localOffset === 0xffffffff || length === 0xffffffff || packed === 0xffffffff) {
      let xp = pos + 46 + nl, found = false;
      while (xp + 4 <= pos + 46 + nl + xl) {
        const tag = dir.getUint16(xp, true), len = dir.getUint16(xp + 2, true);
        if (xp + 4 + len > pos + 46 + nl + xl) throw Error('ZIP64 欄位損毀');
        if (tag === 1) {
          let at = xp + 4;
          const next = () => {if(at+8>xp+4+len) throw Error('ZIP64 欄位損毀'); const n=u64(dir,at);at+=8;return n;};
          if(length===0xffffffff) length=next();
          if(packed===0xffffffff) packed=next();
          if(localOffset===0xffffffff) localOffset=next();
          found = true; break;
        }
        xp += 4 + len;
      }
      if (!found) throw Error('缺少 ZIP64 位址');
    }
    if ((flags & 1) || method !== 0 || length !== packed || length > 100 * 1024 * 1024) throw Error('請使用本網站產生的未壓縮備份，單一項目上限 100 MB');
    const local = await read(localOffset, 30), localNameLength = local.getUint16(26, true), localExtra = local.getUint16(28, true);
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(8, true) !== 0 || (local.getUint16(6, true) & 1)) throw Error('ZIP 原檔標頭損毀');
    const localName = await read(localOffset + 30, localNameLength);
    if (dec.decode(new Uint8Array(localName.buffer)) !== name) throw Error('ZIP 原檔名稱不一致');
    const start = localOffset + 30 + localNameLength + localExtra;
    if (start + length > offset) throw Error('ZIP 原檔範圍不正確');
    entries.set(name, { blob: file.slice(start, start + length), crc });
    pos += 46 + nl + xl + cl;
  }
  if (pos !== size) throw Error('ZIP 目錄長度不一致');
  return entries;
}
export async function verifyZipEntry(entry) {
  if (await checksum(entry.blob) !== entry.crc) throw Error('ZIP 原檔校驗失敗，請使用完整備份');
  return entry.blob;
}
