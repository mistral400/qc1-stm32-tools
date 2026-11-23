import type { RegisterDefinition, RegisterOperation } from "./types";

export interface RegisterAccessValidation {
  allowed: boolean;
  reason?: string;
}

export function validateRegisterAccess(
  register: Pick<RegisterDefinition, "access" | "readSideEffects" | "writeSideEffects" | "writeSemantics">,
  operation: RegisterOperation,
  allowSideEffects = false,
): RegisterAccessValidation {
  if (operation === "read") {
    if (register.access === "write-only") return { allowed: false, reason: "Ce registre est en écriture seule." };
    if (register.readSideEffects && !allowSideEffects)
      return { allowed: false, reason: "La lecture peut modifier l'état du périphérique; confirmation explicite requise." };
    return { allowed: true };
  }
  if (operation === "write") {
    if (register.access === "read-only") return { allowed: false, reason: "Ce registre est en lecture seule." };
    if (register.writeSemantics === "command" && !register.writeSideEffects)
      return { allowed: false, reason: "Les effets d'écriture de ce registre ne sont pas caractérisés." };
    return { allowed: true };
  }
  if (register.access !== "read-write")
    return { allowed: false, reason: "La lecture-modification-écriture exige un registre RW." };
  if (register.readSideEffects || register.writeSideEffects || register.writeSemantics !== "normal")
    return { allowed: false, reason: "La lecture-modification-écriture est dangereuse pour les effets de ce registre." };
  return { allowed: true };
}
