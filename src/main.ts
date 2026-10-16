import { PeriPage, type Raster } from './peripage';
import { drawPreview, renderImage, renderText, toRaster } from './raster';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  connect: $<HTMLButtonElement>('connect'),
  status: $<HTMLParagraphElement>('status'),
  model: $<HTMLSelectElement>('model'),
  text: $<HTMLTextAreaElement>('text'),
  size: $<HTMLInputElement>('size'),
  bold: $<HTMLInputElement>('bold'),
  align: $<HTMLSelectElement>('align'),
  file: $<HTMLInputElement>('file'),
  dither: $<HTMLInputElement>('dither'),
  rotate: $<HTMLInputElement>('rotate'),
  brightness: $<HTMLInputElement>('brightness'),
  feed: $<HTMLSelectElement>('feed'),
  preview: $<HTMLCanvasElement>('preview'),
  print: $<HTMLButtonElement>('print'),
};

const printer = new PeriPage();
let tab: 'text' | 'image' = 'text';
let image: ImageBitmap | null = null;
let raster: Raster | null = null;
let busy = false;

try {
  ui.model.value = localStorage.getItem('printa.model') ?? '48';
} catch {}

function setStatus(message: string, kind: '' | 'ok' | 'err' = '') {
  ui.status.textContent = message;
  ui.status.className = `status ${kind}`;
}

function refresh() {
  ui.connect.textContent = printer.connected ? 'Déconnecter' : 'Connecter';
  ui.print.disabled = busy || !printer.connected || !raster;
  ui.connect.disabled = busy;
}

function render() {
  const width = Number(ui.model.value) * 8;
  if (tab === 'text') {
    const canvas = renderText(ui.text.value, width, {
      size: Number(ui.size.value),
      bold: ui.bold.checked,
      align: ui.align.value as 'start' | 'center' | 'end',
    });
    raster = toRaster(canvas, false);
  } else if (image) {
    raster = toRaster(renderImage(image, width, ui.rotate.checked), ui.dither.checked, Number(ui.brightness.value));
  } else raster = null;
  if (raster) drawPreview(ui.preview, raster);
  else ui.preview.height = 0;
  refresh();
}

printer.onDisconnect = () => {
  setStatus('Imprimante déconnectée', 'err');
  refresh();
};

ui.connect.addEventListener('click', async () => {
  if (printer.connected) {
    await printer.disconnect();
    setStatus('Imprimante non connectée');
    return refresh();
  }
  busy = true;
  refresh();
  setStatus('Recherche de l’imprimante…');
  try {
    await printer.connect();
    setStatus(`Connectée à ${printer.name}`, 'ok');
    const info = await printer.readInfo();
    const parts = [printer.name, info.model, info.battery !== null ? `batterie ${info.battery} %` : null];
    setStatus(`Connectée · ${parts.filter(Boolean).join(' · ')}`, 'ok');
  } catch (e) {
    setStatus(`Connexion impossible : ${(e as Error).message}`, 'err');
  } finally {
    busy = false;
    refresh();
  }
});

ui.print.addEventListener('click', async () => {
  if (!raster) return;
  busy = true;
  refresh();
  try {
    const done = await printer.print(raster, Number(ui.feed.value), (r) =>
      setStatus(`Envoi… ${Math.round(r * 100)} %`),
    );
    setStatus(done ? 'Impression terminée' : 'Envoyé (pas de confirmation de l’imprimante)', 'ok');
  } catch (e) {
    setStatus(`Erreur : ${(e as Error).message}`, 'err');
  } finally {
    busy = false;
    refresh();
  }
});

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    tab = btn.dataset.tab as 'text' | 'image';
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $('tab-text').hidden = tab !== 'text';
    $('tab-image').hidden = tab !== 'image';
    render();
  }),
);

ui.file.addEventListener('change', async () => {
  const f = ui.file.files?.[0];
  if (!f) return;
  image = await createImageBitmap(f);
  render();
});

ui.model.addEventListener('change', () => {
  try {
    localStorage.setItem('printa.model', ui.model.value);
  } catch {}
  render();
});
for (const el of [ui.text, ui.size, ui.bold, ui.align, ui.dither, ui.rotate, ui.brightness])
  el.addEventListener('input', render);

render();
