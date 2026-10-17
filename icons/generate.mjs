import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
for (const size of [180, 192, 512]) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size - 0.5;
      const ny = (y + 0.5) / size - 0.53;
      const radius = Math.hypot(nx, ny);
      const ring = radius > 0.255 && radius < 0.315;
      const hand = (Math.abs(nx) < 0.018 && ny > -0.19 && ny < 0.025) || (nx > -0.018 && nx < 0.15 && Math.abs(ny) < 0.018);
      const crown = Math.abs(nx) < 0.075 && ny > -0.4 && ny < -0.35;
      const color = ring || hand || crown ? [255, 230, 0] : [17, 17, 17];
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      raw.set(color, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(new URL(size === 180 ? './apple-touch-icon.png' : `./icon-${size}.png`, import.meta.url), png);
}
