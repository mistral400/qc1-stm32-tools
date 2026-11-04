import { EventEmitter } from "events";

export type SerialParity = "none" | "even" | "odd" | "mark" | "space";
export type SerialDisplayMode = "ascii" | "hex";

export interface SerialConnectionOptions {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: SerialParity;
  stopBits: 1 | 2;
  rtscts?: boolean;
  xon?: boolean;
  xoff?: boolean;
  xany?: boolean;
}

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  pnpId?: string;
}

export interface SerialLogLine {
  time: string;
  direction: "RX" | "TX";
  ascii: string;
  hex: string;
}

/** Structural interface keeps the transport replaceable by process-free test ports. */
export interface SerialPortLike {
  readonly isOpen: boolean;
  readonly opening?: boolean;
  on(event: "data", listener: (data: Buffer) => void): this;
  on(event: "open" | "close", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "error", listener: (error: Error) => void): this;
  open(callback?: (error: Error | null) => void): void;
  close(callback?: (error: Error | null) => void): void;
  write(data: Buffer, callback?: (error?: Error | null) => void): boolean;
  drain(callback?: (error?: Error | null) => void): void;
}

export type SerialPortFactory = (options: SerialConnectionOptions & { autoOpen: false }) => SerialPortLike;
export type SerialPortLister = () => Promise<SerialPortInfo[]>;

function loadSerialPortLibrary(): Promise<typeof import("serialport")> {
  return import("serialport");
}

const MAX_TX_BYTES = 4096;
const OPEN_TIMEOUT_MS = 10_000;
const IO_TIMEOUT_MS = 5000;

export function validateSerialOptions(options: SerialConnectionOptions): string | undefined {
  if (!options.path.trim() || options.path.length > 4096) return "Sélectionne un port série valide.";
  if (!Number.isInteger(options.baudRate) || options.baudRate < 50 || options.baudRate > 4_000_000) return "Le baud rate doit être compris entre 50 et 4 000 000.";
  if (![5, 6, 7, 8].includes(options.dataBits)) return "Le nombre de bits de données doit être 5, 6, 7 ou 8.";
  if (!["none", "even", "odd", "mark", "space"].includes(options.parity)) return "La parité série est invalide.";
  if (![1, 2].includes(options.stopBits)) return "Le nombre de bits d'arrêt doit être 1 ou 2.";
  return undefined;
}

export function parseHexBytes(text: string): Buffer {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TX_BYTES * 3) throw new Error("Saisis des octets HEX (ex. 55 AA 01). Maximum : 4096 octets.");
  const compact = trimmed.replace(/[\s,:-]+/g, "");
  if (!/^(?:[\da-f]{2})+$/i.test(compact)) throw new Error("Format HEX invalide : chaque octet doit avoir deux chiffres hexadécimaux.");
  const bytes = Buffer.from(compact, "hex");
  if (bytes.length > MAX_TX_BYTES) throw new Error("Un envoi est limité à 4096 octets.");
  return bytes;
}

export function serialChunkAsHex(data: Buffer): string {
  return [...data].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

/** Host-side UART transport; no data or selected port is persisted by this service. */
export class SerialMonitorService extends EventEmitter {
  private port?: SerialPortLike;
  private openingPromise?: Promise<void>;
  private cancelOpening?: () => void;

  constructor(
    private readonly createPort?: SerialPortFactory,
    private readonly listPorts?: SerialPortLister,
    private readonly openTimeoutMs = OPEN_TIMEOUT_MS,
    private readonly ioTimeoutMs = IO_TIMEOUT_MS,
  ) {
    super();
  }

  async enumeratePorts(): Promise<SerialPortInfo[]> {
    const ports = this.listPorts
      ? await this.listPorts()
      : await (await loadSerialPortLibrary()).SerialPort.list();
    return ports
      .filter((port) => typeof port.path === "string" && port.path.length > 0)
      .map((port) => ({
        path: port.path.slice(0, 4096),
        manufacturer: typeof port.manufacturer === "string" ? port.manufacturer.slice(0, 128) : undefined,
        vendorId: typeof port.vendorId === "string" ? port.vendorId.slice(0, 16) : undefined,
        productId: typeof port.productId === "string" ? port.productId.slice(0, 16) : undefined,
        pnpId: typeof port.pnpId === "string" ? port.pnpId.slice(0, 128) : undefined,
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, 128);
  }

  get connected(): boolean {
    return Boolean(this.port?.isOpen);
  }

  async connect(options: SerialConnectionOptions): Promise<void> {
    const validationError = validateSerialOptions(options);
    if (validationError) throw new Error(validationError);
    if (this.port) throw new Error("Un port série QC1 est déjà ouvert ou en cours d'ouverture.");

    const portOptions = { ...options, autoOpen: false as const };
    const port = this.createPort
      ? this.createPort(portOptions)
      : new (await loadSerialPortLibrary()).SerialPort(portOptions);
    this.port = port;

    port.on("data", (data) => this.emit("data", Buffer.from(data)));
    port.on("close", () => {
      if (this.port === port) this.port = undefined;
      this.emit("close");
    });

    const opening = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => fail(new Error("Délai dépassé à l'ouverture du port série.")), this.openTimeoutMs);
      const fail = (error: Error): void => {
        clearTimeout(timeout);
        this.emit("fault", error);
        if (!settled) {
          settled = true;
          if (this.port === port) this.port = undefined;
          if (port.isOpen) port.close(() => undefined);
          reject(error);
        }
      };
      const cancel = (): void => fail(new Error("Connexion UART annulée."));
      this.cancelOpening = cancel;
      port.on("error", (error) => fail(error));
      port.on("open", () => {
        clearTimeout(timeout);
        if (this.port !== port) {
          port.close(() => undefined);
          return;
        }
        this.cancelOpening = undefined;
        this.emit("open", options.path);
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      try {
        port.open((error) => { if (error) fail(error); });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.openingPromise = opening;
    try {
      await opening;
    } finally {
      if (this.openingPromise === opening) this.openingPromise = undefined;
      this.cancelOpening = undefined;
    }
  }

  async send(data: Buffer): Promise<number> {
    if (!this.port?.isOpen) throw new Error("Aucun port série connecté.");
    if (data.length === 0 || data.length > MAX_TX_BYTES) throw new Error("L'envoi doit contenir entre 1 et 4096 octets.");
    const port = this.port;
    await this.waitForPortOperation(port, (complete) => { port.write(data, complete); }, "écriture");
    await this.waitForPortOperation(port, (complete) => { port.drain(complete); }, "vidage TX");
    this.emit("transmit", data.length);
    return data.length;
  }

  private waitForPortOperation(
    port: SerialPortLike,
    operation: (complete: (error?: Error | null) => void) => void,
    label: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        port.removeListener("error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onError = (error: Error): void => finish(error);
      const timeout = setTimeout(() => finish(new Error("Délai dépassé pendant l'opération " + label + " UART.")), this.ioTimeoutMs);
      port.once("error", onError);
      try { operation(finish); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    if (!port) return;
    if (!port.isOpen) {
      if (this.openingPromise) {
        this.cancelOpening?.();
        return;
      }
      if (!port.isOpen) return;
    }
    await new Promise<void>((resolve, reject) => {
      port.close((error) => error ? reject(error) : resolve());
    });
  }

  async dispose(): Promise<void> {
    try {
      if (this.openingPromise) {
        this.cancelOpening?.();
        try { await this.openingPromise; } catch { /* Opening failure already closed the pending port. */ }
      }
      await this.disconnect();
    }
    finally { this.removeAllListeners(); }
  }
}

export function createDefaultSerialMonitor(): SerialMonitorService {
  return new SerialMonitorService();
}
