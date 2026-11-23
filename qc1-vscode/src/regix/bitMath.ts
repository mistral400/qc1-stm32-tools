import type { BitValues } from "./types";

export type BitOperation = "and" | "or" | "xor" | "not" | "readBits";

const UINT32_MAX = 0xFFFF_FFFF;

export function parseUnsigned32(value: string | number | bigint): number {
  let parsed: bigint;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("La valeur doit être un entier sûr.");
    parsed = BigInt(value);
  } else {
    const text = value.trim();
    if (!/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)$/.test(text))
      throw new Error("Utilisez un entier décimal, 0xHEX ou 0bBIN.");
    parsed = BigInt(text);
  }
  if (parsed < 0n || parsed > BigInt(UINT32_MAX)) throw new Error("La valeur dépasse 32 bits non signés.");
  return Number(parsed);
}

export function validateBitRange(offset: number, width: number, registerWidth = 32): void {
  if (!Number.isInteger(registerWidth) || registerWidth < 1 || registerWidth > 32)
    throw new Error("La largeur du registre doit être comprise entre 1 et 32 bits.");
  if (!Number.isInteger(offset) || !Number.isInteger(width) || offset < 0 || width < 1 || offset + width > registerWidth)
    throw new Error("Le champ dépasse les limites du registre.");
}

export function calculateMask(width: number, offset = 0, registerWidth = 32): number {
  validateBitRange(offset, width, registerWidth);
  const lowMask = width === 32 ? BigInt(UINT32_MAX) : (1n << BigInt(width)) - 1n;
  return Number((lowMask << BigInt(offset)) & BigInt(UINT32_MAX));
}

export function calculateFieldValue(value: string | number | bigint, width: number, offset = 0, registerWidth = 32): number {
  validateBitRange(offset, width, registerWidth);
  const parsed = parseUnsigned32(value);
  const maxValue = width === 32 ? BigInt(UINT32_MAX) : (1n << BigInt(width)) - 1n;
  if (BigInt(parsed) > maxValue) throw new Error(`La valeur ne tient pas dans un champ de ${width} bit(s).`);
  return Number((BigInt(parsed) << BigInt(offset)) & BigInt(UINT32_MAX));
}

export function extractBits(value: string | number | bigint, offset: number, width: number, registerWidth = 32): number {
  validateBitRange(offset, width, registerWidth);
  const parsed = BigInt(parseUnsigned32(value));
  const mask = width === 32 ? BigInt(UINT32_MAX) : (1n << BigInt(width)) - 1n;
  return Number((parsed >> BigInt(offset)) & mask);
}

export function formatUnsigned32(value: string | number | bigint): BitValues {
  const parsed = parseUnsigned32(value);
  return {
    hex: `0x${parsed.toString(16).toUpperCase().padStart(8, "0")}`,
    bin: `0b${parsed.toString(2).padStart(32, "0")}`,
    dec: String(parsed),
  };
}

export function calculateBits(
  operation: BitOperation,
  leftInput: string | number | bigint,
  rightInput: string | number | bigint = 0,
  width = 32,
  offset = 0,
): number {
  const left = parseUnsigned32(leftInput);
  switch (operation) {
    case "and": return Number(BigInt(left) & BigInt(parseUnsigned32(rightInput)));
    case "or": return Number(BigInt(left) | BigInt(parseUnsigned32(rightInput)));
    case "xor": return Number(BigInt(left) ^ BigInt(parseUnsigned32(rightInput)));
    case "not": return Number((~BigInt(left)) & BigInt(UINT32_MAX));
    case "readBits": return extractBits(left, offset, width);
    default: throw new Error("Opération de bits inconnue.");
  }
}
