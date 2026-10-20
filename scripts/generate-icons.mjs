import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const inputSvg = fs.readFileSync(path.resolve('logo.svg'));

const sizes = [16, 32, 48, 128];

async function generateIcons() {
  for (const size of sizes) {
    await sharp(inputSvg)
      .resize(size, size)
      .png()
      .toFile(`public/icon-${size}.png`);
    // eslint-disable-next-line no-console
    globalThis.console.log(`Generated icon-${size}.png`);
  }
  
  // Also create a 128x128 for good measure
  await sharp(inputSvg)
    .resize(128, 128)
    .png()
    .toFile('public/icon-128.png');
  // eslint-disable-next-line no-console
  globalThis.console.log('Generated icon-128.png');
}

generateIcons().catch((err) => {
  // eslint-disable-next-line no-console
  globalThis.console.error(err);
  globalThis.process.exit(1);
});