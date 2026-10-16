import type { Raster } from './peripage';

export interface TextOptions {
  size: number;
  bold: boolean;
  align: 'start' | 'center' | 'end'; // début/fin suivent le sens de lecture (arabe à droite)
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;

/** Rend du texte (français, arabe…) dans un canvas à la largeur de l'imprimante. */
export function renderText(text: string, width: number, opts: TextOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${opts.bold ? '700' : '400'} ${opts.size}px -apple-system, system-ui, "Segoe UI", sans-serif`;
  const margin = 8;
  const maxWidth = width - margin * 2;
  ctx.font = font;

  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (line.trim() && ctx.measureText(next).width > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    lines.push(line);
  }

  const lineHeight = Math.round(opts.size * 1.3);
  canvas.width = width;
  canvas.height = Math.max(lineHeight, lines.length * lineHeight) + margin;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = font;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    const rtl = RTL.test(line);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    const side = opts.align === 'center' ? 'center' : (opts.align === 'start') !== rtl ? 'left' : 'right';
    ctx.textAlign = side;
    const x = side === 'center' ? width / 2 : side === 'left' ? margin : width - margin;
    ctx.fillText(line, x, i * lineHeight + margin / 2);
  });
  return canvas;
}

/** Met une image à la largeur de l'imprimante, fond blanc. */
export function renderImage(img: HTMLImageElement | ImageBitmap, width: number, rotate = false): HTMLCanvasElement {
  const srcW = rotate ? img.height : img.width;
  const srcH = rotate ? img.width : img.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(1, Math.round((srcH * width) / srcW));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  if (rotate) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0, canvas.height, canvas.width);
  } else ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Convertit un canvas en raster 1 bit. `dither` applique Floyd–Steinberg (photos),
 * sinon simple seuil (texte net). `brightness` va de -100 à 100.
 */
export function toRaster(canvas: HTMLCanvasElement, dither: boolean, brightness = 0): Raster {
  const { width, height } = canvas;
  const px = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const a = px[i * 4 + 3] / 255;
    const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    gray[i] = Math.min(255, Math.max(0, lum * a + 255 * (1 - a) + brightness * 1.5));
  }
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const black = gray[i] < 128;
      if (black) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      if (!dither) continue;
      const err = gray[i] - (black ? 0 : 255);
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16;
        gray[i + width] += (err * 5) / 16;
        if (x + 1 < width) gray[i + width + 1] += err / 16;
      }
    }
  }
  return { widthBytes, height, data };
}

/** Dessine le raster tel qu'il sortira sur le papier. */
export function drawPreview(target: HTMLCanvasElement, raster: Raster) {
  const width = raster.widthBytes * 8;
  target.width = width;
  target.height = raster.height;
  const ctx = target.getContext('2d')!;
  const img = ctx.createImageData(width, raster.height);
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < width; x++) {
      const on = raster.data[y * raster.widthBytes + (x >> 3)] & (0x80 >> (x & 7));
      const o = (y * width + x) * 4;
      const v = on ? 20 : 255;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}
