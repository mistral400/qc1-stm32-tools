import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { ConfiguredTarget } from "./cmakeFileApi";
import { inside } from "./filesystem";
import { targetMatchesCore } from "./coreBuild";
import type { Qc1Core } from "./targetArchitecture";

export interface FirmwareArtifactEvidence {
  valid: boolean;
  reason: string;
  artifactPath?: string;
  targetName?: string;
  sizeBytes?: number;
  sha256?: string;
}

/** Copy a validated ELF into this operation's private staging area and reject a source changed since hashing. */
export async function snapshotFirmwareArtifact(
  evidence: FirmwareArtifactEvidence,
  stagingDirectory: string,
  fileName: string,
): Promise<FirmwareArtifactEvidence> {
  const fail = (reason: string): FirmwareArtifactEvidence => ({ valid: false, reason });
  if (!evidence.valid || !evidence.artifactPath || !evidence.sha256 || !/^[a-z0-9_.-]+\.elf$/i.test(fileName))
    return fail("Preuve ELF absente ou nom de snapshot invalide.");
  const stagingReal = realPath(stagingDirectory);
  const sourceReal = realPath(evidence.artifactPath);
  if (!stagingReal || !sourceReal) return fail("ELF validé ou dossier temporaire introuvable.");
  const snapshotPath = path.join(stagingReal, fileName);
  if (!inside(stagingReal, snapshotPath)) return fail("Le snapshot ELF sort du dossier temporaire.");
  try {
    await fs.promises.copyFile(sourceReal, snapshotPath, fs.constants.COPYFILE_EXCL);
    const stat = await fs.promises.stat(snapshotPath);
    const bytes = await fs.promises.readFile(snapshotPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (!stat.isFile() || stat.size !== evidence.sizeBytes || sha256 !== evidence.sha256) {
      await fs.promises.rm(snapshotPath, { force: true });
      return fail("L'ELF source a changé depuis sa validation; aucun snapshot ne sera programmé.");
    }
    return { ...evidence, reason: "Snapshot ELF temporaire identique à l'artefact validé.", artifactPath: snapshotPath };
  } catch (error) {
    try { await fs.promises.rm(snapshotPath, { force: true }); } catch { /* best-effort cleanup */ }
    return fail(`Impossible de créer le snapshot ELF: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function validateStagedBinary(binaryPath: string, stagingDirectory: string): FirmwareArtifactEvidence {
  const fail = (reason: string): FirmwareArtifactEvidence => ({ valid: false, reason });
  if (!/\.bin$/i.test(binaryPath)) return fail("La sortie temporaire n'est pas un BIN.");
  const stagingReal = realPath(stagingDirectory);
  const binaryReal = realPath(binaryPath);
  if (!stagingReal || !binaryReal || !inside(stagingReal, binaryReal))
    return fail("Le BIN temporaire est absent ou sort du dossier isolé de cette opération.");
  const stat = fs.statSync(binaryReal);
  if (!stat.isFile() || stat.size <= 0) return fail("objcopy n'a pas produit de BIN non vide.");
  if (stat.size > 64 * 1024 * 1024) return fail("Le BIN dépasse la limite de validation de 64 MiB.");
  const bytes = fs.readFileSync(binaryReal);
  return {
    valid: true,
    reason: `BIN transitoire produit par objcopy (${stat.size} octets).`,
    artifactPath: binaryReal,
    sizeBytes: stat.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function comparablePath(value: string): string {
  const normalized = path.resolve(value).normalize("NFC");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function realPath(file: string): string | undefined {
  try { return fs.realpathSync(file); } catch { return undefined; }
}

/** Validate ownership, target, project/build scope and bytes before a programmer receives an ELF. */
export function validateFirmwareArtifact(input: {
  artifactPath: string;
  projectRoot: string;
  buildRoot: string;
  sourceRoot: string;
  targets: ConfiguredTarget[];
  core?: Qc1Core;
  allowSourceLessTarget?: boolean;
}): FirmwareArtifactEvidence {
  const fail = (reason: string): FirmwareArtifactEvidence => ({ valid: false, reason });
  if (!input.artifactPath || !/\.elf$/i.test(input.artifactPath)) return fail("L'artefact sélectionné n'est pas un ELF.");

  const projectReal = realPath(input.projectRoot);
  const buildReal = realPath(input.buildRoot);
  const artifactReal = realPath(input.artifactPath);
  if (!projectReal || !buildReal || !artifactReal) return fail("Projet, dossier de build ou ELF introuvable.");

  const stat = fs.statSync(artifactReal);
  if (!stat.isFile() || stat.size <= 0) return fail("L'ELF est vide ou n'est pas un fichier régulier.");
  if (stat.size > 64 * 1024 * 1024) return fail("L'ELF dépasse la limite de validation de 64 MiB.");
  if (!inside(projectReal, artifactReal) && !inside(buildReal, artifactReal))
    return fail("L'ELF résolu sort du projet et du dossier de build configurés.");

  const artifactKey = comparablePath(artifactReal);
  const owners = input.targets.filter((target) => target.type === "EXECUTABLE" &&
    target.artifacts.some((file) => {
      const targetArtifact = realPath(file) || path.resolve(file);
      return comparablePath(targetArtifact) === artifactKey;
    }));
  if (owners.length !== 1) return fail(owners.length ? "Plusieurs cibles CMake revendiquent cet ELF." : "L'ELF n'est pas déclaré par une cible exécutable CMake connue.");

  const target = owners[0];
  if (input.core && !targetMatchesCore(target, input.core))
    return fail(`L'ELF n'est pas attribué sans ambiguïté au cœur ${input.core.toUpperCase()}.`);

  const source = realPath(input.sourceRoot) || path.resolve(input.sourceRoot);
  const projectSourceRoot = comparablePath(source) === comparablePath(projectReal);
  const hasProjectSource = target.sources.some((file) => {
    const sourceFile = realPath(file) || path.resolve(file);
    return inside(projectReal, sourceFile);
  });
  if (!projectSourceRoot && !hasProjectSource && !input.allowSourceLessTarget)
    return fail("La cible CMake ne fournit pas de source rattachée au projet actif.");

  const bytes = fs.readFileSync(artifactReal);
  return {
    valid: true,
    reason: "ELF associé à une cible exécutable du projet actif.",
    artifactPath: artifactReal,
    targetName: target.name,
    sizeBytes: stat.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function compareFirmwareReadback(expected: Uint8Array, actual: Uint8Array): { matches: boolean; reason: string } {
  if (!expected.length) return { matches: false, reason: "L'image attendue est vide." };
  if (expected.length !== actual.length)
    return { matches: false, reason: `Taille différente : attendu ${expected.length} octets, lu ${actual.length}.` };
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  const actualHash = createHash("sha256").update(actual).digest("hex");
  return expectedHash === actualHash
    ? { matches: true, reason: `Lecture comparée (${expected.length} octets, SHA-256 ${expectedHash.slice(0, 12)}…).` }
    : { matches: false, reason: "Le contenu relu ne correspond pas à l'image programmée." };
}
