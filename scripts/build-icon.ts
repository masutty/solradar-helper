// Dev-only: renders assets/icon.svg to PNGs and packs them into assets/icon.ico.
// Run with `bun run icon`. The generated .ico is committed, so normal builds do not need this.
import { Resvg } from "@resvg/resvg-js";
import { join } from "node:path";

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const assets = join(import.meta.dir, "..", "assets");
const svg = await Bun.file(join(assets, "icon.svg")).text();

const pngs = SIZES.map(size => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());

// ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) per image, then the PNG data.
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
    const size = SIZES[i]!;
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at); // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1); // height
    header.writeUInt8(0, at + 2); // palette colors
    header.writeUInt8(0, at + 3); // reserved
    header.writeUInt16LE(1, at + 4); // color planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8); // image size
    header.writeUInt32LE(offset, at + 12); // image offset
    offset += png.length;
});

await Bun.write(join(assets, "icon.ico"), Buffer.concat([header, ...pngs]));
console.log(`Wrote assets/icon.ico (${SIZES.join(", ")} px)`);
