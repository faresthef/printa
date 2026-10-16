import { BleClient } from '@capacitor-community/bluetooth-le';

// Protocole BLE PeriPage (A6 / A6+), d'après la doc de rétro-ingénierie
// publiée dans github.com/aaa4xu/peripage (docs/ble_protocol_v1.36.md).
const uuid16 = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;
export const SERVICE = uuid16('ff00');
const RESPONSE = uuid16('ff01'); // réponses aux requêtes + octet AA de fin de job
const WRITE = uuid16('ff02'); // commandes et raster (write without response)
const STATUS = uuid16('ff03'); // crédits de flux : 01 N, taille de paquet : 02 lo hi

const INITIALIZE = [0x10, 0xff, 0xfe, 0x01, ...Array(12).fill(0)];
const END_JOB = [0x10, 0xff, 0xfe, 0x45];
const MAX_PACKET = 100; // taille vérifiée sur matériel réel
const ROWS_PER_BLOCK = 1024;

export interface Raster {
  widthBytes: number;
  height: number;
  data: Uint8Array; // 1 bit par point, bit 7 = premier point, 1 = noir
}

export interface PrinterInfo {
  battery: number | null;
  model: string | null;
  firmware: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PeriPage {
  deviceId: string | null = null;
  name: string | null = null;
  onDisconnect: () => void = () => {};

  #credits = 0;
  #paused = false;
  #packetBytes = 20;
  #flowControl = false; // vrai dès qu'une notification FF03 arrive
  #bootstrapped = false;
  #wake: (() => void) | null = null;
  #pending: ((bytes: Uint8Array) => void) | null = null;
  #jobDone: (() => void) | null = null;

  get connected() {
    return this.deviceId !== null;
  }

  async connect(): Promise<void> {
    await BleClient.initialize();
    // Le A6 annonce FEE7 et non FF00 : on filtre par nom, pas par service.
    const device = await BleClient.requestDevice({
      namePrefix: 'PeriPage',
      optionalServices: [SERVICE],
    });
    this.#reset();
    await BleClient.connect(device.deviceId, () => {
      this.deviceId = null;
      this.#wake?.();
      this.onDisconnect();
    });
    this.deviceId = device.deviceId;
    this.name = device.name ?? 'PeriPage';
    try {
      // Les notifications FF03 doivent être actives avant la première écriture,
      // sinon les crédits initiaux sont perdus.
      await BleClient.startNotifications(this.deviceId, SERVICE, STATUS, (v) => this.#onStatus(v));
      await BleClient.startNotifications(this.deviceId, SERVICE, RESPONSE, (v) => this.#onResponse(v));
      await this.#startup();
    } catch (e) {
      await this.disconnect();
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    const id = this.deviceId;
    this.deviceId = null;
    if (id) await BleClient.disconnect(id).catch(() => {});
  }

  async readInfo(): Promise<PrinterInfo> {
    const text = (b: Uint8Array | null) =>
      b ? new TextDecoder().decode(b).replace(/\0+$/, '').trim() || null : null;
    const battery = await this.#query([0x10, 0xff, 0x50, 0xf1]);
    const model = await this.#query([0x10, 0xff, 0x20, 0xf0]);
    const firmware = await this.#query([0x10, 0xff, 0x20, 0xf1]);
    return {
      battery: battery && battery.length === 2 && battery[1] <= 100 ? battery[1] : null,
      model: text(model),
      firmware: text(firmware),
    };
  }

  /** Imprime un raster. Résout quand la fin de job (AA) arrive ou après un délai. */
  async print(raster: Raster, feedRows = 96, onProgress?: (ratio: number) => void): Promise<boolean> {
    const { widthBytes, height, data } = raster;
    await this.#write(INITIALIZE);
    let sent = 0;
    for (let y = 0; y < height; y += ROWS_PER_BLOCK) {
      const rows = Math.min(ROWS_PER_BLOCK, height - y);
      await this.#write([0x1d, 0x76, 0x30, 0x00, widthBytes & 255, widthBytes >> 8, rows & 255, rows >> 8]);
      const block = data.subarray(y * widthBytes, (y + rows) * widthBytes);
      for (let i = 0; i < block.length; ) {
        const size = Math.min(this.#packetBytes, MAX_PACKET, block.length - i);
        await this.#write(block.subarray(i, i + size));
        i += size;
        sent += size;
        onProgress?.(sent / data.length);
      }
    }
    for (let left = feedRows; left > 0; left -= 255) await this.#write([0x1b, 0x4a, Math.min(255, left)]);
    const done = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      this.#jobDone = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
    await this.#write(END_JOB);
    const ok = await done;
    this.#jobDone = null;
    return ok;
  }

  #reset() {
    this.#credits = 0;
    this.#paused = false;
    this.#packetBytes = 20;
    this.#flowControl = false;
    this.#bootstrapped = false;
  }

  async #startup() {
    await sleep(200);
    if (this.#credits > 0) {
      await this.#write(INITIALIZE);
    } else {
      // Crédits initiaux pas (encore) reçus : une seule écriture courte d'initialisation
      // relance les notifications FF03 (comportement observé sur V1.36).
      this.#bootstrapped = true;
      await this.#send(INITIALIZE);
    }
    // Sans aucune notification FF03, on passe en mode sans contrôle de flux (anciens firmwares).
    for (let t = 0; t < 15 && !this.#flowControl; t++) await sleep(100);
  }

  #onStatus(v: DataView) {
    const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    this.#flowControl = true;
    if (b.length === 2 && b[0] === 1) {
      this.#paused = b[1] === 0;
      if (this.#bootstrapped && b[1] > 1) this.#credits += b[1] - 1;
      else this.#credits += b[1];
      this.#bootstrapped = false;
    } else if (b.length === 3 && b[0] === 2) {
      const size = b[1] | (b[2] << 8);
      if (size > 0) this.#packetBytes = size;
    }
    this.#wake?.();
  }

  #onResponse(v: DataView) {
    const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
    if (b.length === 1 && b[0] === 0xaa && this.#jobDone) return this.#jobDone();
    this.#pending?.(b);
  }

  async #query(command: number[]): Promise<Uint8Array | null> {
    const reply = new Promise<Uint8Array | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 1500);
      this.#pending = (bytes) => {
        clearTimeout(timer);
        resolve(bytes);
      };
    });
    await this.#write(command);
    const bytes = await reply;
    this.#pending = null;
    // Une réponse tardive serait confondue avec la suivante : on laisse respirer.
    if (!bytes) await sleep(300);
    return bytes;
  }

  /** Écrit en respectant les crédits FF03 quand l'imprimante en envoie. */
  async #write(bytes: ArrayLike<number>) {
    if (!this.#flowControl) {
      await this.#send(bytes);
      await sleep(15);
      return;
    }
    const deadline = Date.now() + 8000;
    while (this.#paused || this.#credits <= 0) {
      if (!this.deviceId) throw new Error("L'imprimante s'est déconnectée");
      if (Date.now() > deadline) throw new Error("L'imprimante ne répond plus (pas de crédit)");
      await new Promise<void>((r) => {
        this.#wake = r;
        setTimeout(r, 250);
      });
      this.#wake = null;
    }
    this.#credits--;
    await this.#send(bytes);
  }

  async #send(bytes: ArrayLike<number>) {
    if (!this.deviceId) throw new Error("L'imprimante n'est pas connectée");
    const copy = Uint8Array.from(bytes);
    await BleClient.writeWithoutResponse(this.deviceId, SERVICE, WRITE, new DataView(copy.buffer));
  }
}
