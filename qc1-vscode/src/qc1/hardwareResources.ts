import * as net from "net";

export type HardwareResourceKind = "programming" | "debug" | "openocd-server";

export interface HardwareResourceLease {
  id: string;
  kind: HardwareResourceKind;
  owner: string;
  projectPath: string;
  serialNumber?: string;
  startedAt: number;
  certainty: "known";
}

export interface HardwareResourceAcquisition {
  acquired: boolean;
  leaseId?: string;
  conflicts: HardwareResourceLease[];
}

function sameSerial(left?: string, right?: string): boolean {
  return !left || !right || left.toUpperCase() === right.toUpperCase();
}

/** Tracks only resources QC1 has observed directly; it never terminates an owner. */
export class HardwareResourceCoordinator {
  private readonly leases = new Map<string, HardwareResourceLease>();

  acquire(input: Omit<HardwareResourceLease, "startedAt" | "certainty">): HardwareResourceAcquisition {
    const conflicts = this.conflicts(input.serialNumber);
    if (conflicts.length) return { acquired: false, conflicts };
    const lease: HardwareResourceLease = { ...input, startedAt: Date.now(), certainty: "known" };
    this.leases.set(lease.id, lease);
    return { acquired: true, leaseId: lease.id, conflicts: [] };
  }

  observe(input: Omit<HardwareResourceLease, "startedAt" | "certainty">, startedAt = Date.now()): void {
    this.leases.set(input.id, { ...input, startedAt, certainty: "known" });
  }

  release(id: string): void { this.leases.delete(id); }

  conflicts(serialNumber?: string): HardwareResourceLease[] {
    return [...this.leases.values()].filter((lease) => sameSerial(lease.serialNumber, serialNumber));
  }

  list(): HardwareResourceLease[] { return [...this.leases.values()].map((lease) => ({ ...lease })); }
}

export function formatHardwareResourceConflicts(conflicts: HardwareResourceLease[]): string {
  const owners = conflicts.map((lease) => {
    const project = lease.projectPath ? ` — ${lease.projectPath}` : "";
    const probe = lease.serialNumber ? ` — ST-Link ${lease.serialNumber.slice(-6)}` : " — ST-Link non identifié";
    return `${lease.owner}${probe}${project}`;
  });
  return `Ressource ST-Link occupée par une session connue : ${owners.join("; ")}. Ferme cette session dans VS Code ou son terminal avant de réessayer; QC1 ne l'arrêtera pas.`;
}

function probeTcpPort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** Standard OpenOCD GDB/Telnet ports; an open port is only suspected, never attributed. */
export async function probeOpenOcdEndpoints(
  probe: (port: number, timeoutMs: number) => Promise<boolean> = probeTcpPort,
  timeoutMs = 250,
): Promise<number[]> {
  const ports = [3333, 4444];
  const results = await Promise.all(ports.map((port) => probe(port, timeoutMs).catch(() => false)));
  return ports.filter((_port, index) => results[index]);
}
