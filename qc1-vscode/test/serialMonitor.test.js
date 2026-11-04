const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { SerialPortMock } = require("serialport");
const {
  parseHexBytes,
  SerialMonitorService,
  serialChunkAsHex,
  validateSerialOptions,
} = require("../out/qc1/serialMonitor");

const OPTIONS = {
  path: "/dev/ROBOT",
  baudRate: 115200,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
};

test("serial settings reject invalid framing and rate before opening a port", async () => {
  assert.match(validateSerialOptions({ ...OPTIONS, baudRate: 0 }), /baud rate/);
  assert.match(validateSerialOptions({ ...OPTIONS, dataBits: 9 }), /bits de données/);
  assert.match(validateSerialOptions({ ...OPTIONS, parity: "invalid" }), /parité/);
  let created = false;
  const service = new SerialMonitorService(() => { created = true; throw new Error("unexpected"); });
  await assert.rejects(service.connect({ ...OPTIONS, baudRate: 0 }), /baud rate/);
  assert.equal(created, false);
});

test("enumeration drops serial numbers and returns stable port ordering", async () => {
  const service = new SerialMonitorService(undefined, async () => [
    { path: "/dev/ttyZ", serialNumber: "SENSITIVE", vendorId: "0483" },
    { path: "/dev/ttyA", serialNumber: "SENSITIVE-2" },
    { path: "", serialNumber: "SENSITIVE-3" },
  ]);
  const ports = await service.enumeratePorts();
  assert.deepEqual(ports, [
    { path: "/dev/ttyA", manufacturer: undefined, vendorId: undefined, productId: undefined, pnpId: undefined },
    { path: "/dev/ttyZ", manufacturer: undefined, vendorId: "0483", productId: undefined, pnpId: undefined },
  ]);
});

test("mocked UART connects, streams RX, drains TX and closes cleanly", async () => {
  SerialPortMock.binding.reset();
  SerialPortMock.binding.createPort(OPTIONS.path, { echo: false, record: true });
  let mockPort;
  const service = new SerialMonitorService(
    (options) => { mockPort = new SerialPortMock(options); return mockPort; },
    () => SerialPortMock.list(),
  );
  const received = new Promise((resolve) => service.once("data", resolve));
  try {
    await service.connect(OPTIONS);
    assert.equal(service.connected, true);
    assert.deepEqual((await service.enumeratePorts()).map((port) => port.path), [OPTIONS.path]);
    mockPort.port.emitData(Buffer.from([0x41, 0x00, 0xff]));
    assert.deepEqual(await received, Buffer.from([0x41, 0x00, 0xff]));
    assert.equal(await service.send(Buffer.from([0x55, 0xaa])), 2);
    assert.deepEqual(mockPort.port.recording, Buffer.from([0x55, 0xaa]));
    await service.disconnect();
    assert.equal(service.connected, false);
  } finally {
    await service.dispose();
    SerialPortMock.binding.reset();
  }
});

test("opening a missing mocked device reports failure and releases the service", async () => {
  SerialPortMock.binding.reset();
  const service = new SerialMonitorService((options) => new SerialPortMock(options));
  try {
    await assert.rejects(service.connect(OPTIONS));
    assert.equal(service.connected, false);
    // A failed open must not leave the service latched as busy.
    SerialPortMock.binding.createPort(OPTIONS.path, { record: true });
    const retry = service.connect(OPTIONS);
    await retry;
    await service.disconnect();
  } finally {
    await service.dispose();
    SerialPortMock.binding.reset();
  }
});

test("a stalled port open times out instead of leaving the connection pending", async () => {
  class NeverOpeningPort extends EventEmitter {
    isOpen = false;
    opening = true;
    open() {}
    close(callback) { callback?.(null); }
    write() { return true; }
    drain(callback) { callback?.(null); }
  }
  const service = new SerialMonitorService(() => new NeverOpeningPort(), async () => [], 5, 5);
  await assert.rejects(service.connect(OPTIONS), /Délai dépassé/);
  assert.equal(service.connected, false);
  await service.dispose();
});

test("a pending UART open can be cancelled without waiting for its timeout", async () => {
  class NeverOpeningPort extends EventEmitter {
    isOpen = false;
    opening = true;
    open() {}
    close(callback) { callback?.(null); }
    write() { return true; }
    drain(callback) { callback?.(null); }
  }
  const service = new SerialMonitorService(() => new NeverOpeningPort(), async () => [], 1000, 5);
  const opening = service.connect(OPTIONS);
  await new Promise((resolve) => setImmediate(resolve));
  await service.disconnect();
  await assert.rejects(opening, /Connexion UART annulée/);
  assert.equal(service.connected, false);
  await service.dispose();
});

test("a stalled UART write times out and remains closable", async () => {
  class StalledWritePort extends EventEmitter {
    isOpen = false;
    opening = false;
    open(callback) { this.isOpen = true; this.emit("open"); callback?.(null); }
    close(callback) { this.isOpen = false; this.emit("close"); callback?.(null); }
    write() { return true; }
    drain(callback) { callback?.(null); }
  }
  const service = new SerialMonitorService(() => new StalledWritePort(), async () => [], 50, 5);
  await service.connect(OPTIONS);
  await assert.rejects(service.send(Buffer.from([0x55])), /Délai dépassé.*écriture/);
  assert.equal(service.connected, true);
  await service.disconnect();
  assert.equal(service.connected, false);
});

test("HEX TX requires complete byte pairs and bounds each transmission", () => {
  assert.deepEqual(parseHexBytes("55 aa,01"), Buffer.from([0x55, 0xaa, 0x01]));
  assert.equal(serialChunkAsHex(Buffer.from([0x00, 0xab, 0xff])), "00 AB FF");
  assert.throws(() => parseHexBytes("5A 1"), /Format HEX invalide/);
  assert.throws(() => parseHexBytes(""), /Saisis des octets HEX/);
  assert.throws(() => parseHexBytes("AA ".repeat(4097)), /Maximum|limité/);
});
