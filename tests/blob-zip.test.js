import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlobZip, readBlobZip, verifyZipEntry } from '../src/blob-zip.js';
import { zipSync, unzipSync } from 'fflate';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('ZIP64 backup round trip, external ZIP reader compatibility, corrupt original rejection', async () => {
  const zip = await createBlobZip([{ name: 'workspace.json', blob: new Blob(['metadata']) }, { name: 'attachments/000001.pptx', blob: new Blob(['PKoriginal']) }]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  assert.equal(new TextDecoder().decode(unzipSync(bytes)['workspace.json']), 'metadata');
  const entries = await readBlobZip(zip);
  assert.equal(await (await verifyZipEntry(entries.get('attachments/000001.pptx'))).text(), 'PKoriginal');
  bytes[30 + 'workspace.json'.length] ^= 1;
  const corrupt = await readBlobZip(new Blob([bytes]));
  await assert.rejects(verifyZipEntry(corrupt.get('workspace.json')), /校驗失敗/);
});

test('previous standard ZIP backups remain readable; compressed and duplicate entries are rejected', async () => {
  const zip = new Blob([zipSync({ 'workspace.json': new TextEncoder().encode('old') }, { level: 0 })]);
  assert.equal(await (await verifyZipEntry((await readBlobZip(zip)).get('workspace.json'))).text(), 'old');
  const compressed = new Blob([zipSync({ 'workspace.json': new Uint8Array(1000) })]);
  await assert.rejects(readBlobZip(compressed), /未壓縮/);
  const duplicate = await createBlobZip([{name:'workspace.json',blob:new Blob(['a'])},{name:'workspace.json',blob:new Blob(['b'])}]);
  await assert.rejects(readBlobZip(duplicate), /重複/);
});

test('ZIP64 reads an entry beyond 4 GiB using file slices without reading the entire archive', async () => {
  const zip = await createBlobZip([{name:'workspace.json',blob:new Blob(['large offset'])}]);
  const bytes = new Uint8Array(await zip.arrayBuffer()), view = new DataView(bytes.buffer);
  const prefix = 5 * 1024 * 1024 * 1024;
  let central = -1;
  for(let i=0;i<bytes.length-4;i++) if(view.getUint32(i,true)===0x02014b50){central=i;break;}
  const nl = 'workspace.json'.length;
  const extra = new Uint8Array(28), ev = new DataView(extra.buffer);
  ev.setUint16(0,1,true);ev.setUint16(2,24,true);ev.setBigUint64(4,12n,true);ev.setBigUint64(12,12n,true);ev.setBigUint64(20,BigInt(prefix),true);
  view.setUint16(central+30,28,true);view.setUint32(central+20,0xffffffff,true);view.setUint32(central+24,0xffffffff,true);view.setUint32(central+42,0xffffffff,true);
  const joined = new Uint8Array(bytes.length+28);
  joined.set(bytes.slice(0,central+46+nl));
  joined.set(extra,central+46+nl);
  joined.set(bytes.slice(central+46+nl),central+46+nl+28);
  const jv = new DataView(joined.buffer), end64 = joined.length-98, locator = joined.length-42;
  jv.setBigUint64(end64+40,BigInt(46+nl+28),true);
  jv.setBigUint64(end64+48,BigInt(prefix+central),true);
  jv.setBigUint64(locator+8,BigInt(prefix+end64),true);
  const dir = await mkdtemp(join(tmpdir(),'meeting-large-zip-'));
  try {
    const path = join(dir,'large.zip'), handle = await open(path,'w');
    try { await handle.write(Buffer.from(joined),0,joined.length,prefix); } finally {await handle.close();}
    // Node openAsBlob truncates size at 4 GiB; use bounded file reads here.
    const disk = { size: (await stat(path)).size, slice(start,end) {
      return { size:end-start, slice(a,b){return disk.slice(start+a,Math.min(end,start+b));}, async text(){return new TextDecoder().decode(await this.arrayBuffer());}, async arrayBuffer() {
        const h = await open(path,'r');
        try { const b=Buffer.alloc(end-start);await h.read(b,0,b.length,start);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength); }
        finally {await h.close();}
      }};
    }};
    assert.ok(disk.size > 5 * 1024 * 1024 * 1024);
    const entries = await readBlobZip(disk);
    assert.equal(await (await verifyZipEntry(entries.get('workspace.json'))).text(),'large offset');
  } finally {await rm(dir,{recursive:true,force:true});}
});
