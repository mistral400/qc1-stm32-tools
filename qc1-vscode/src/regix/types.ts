export type RegisterAccess = "read-only" | "read-write" | "write-only" | "write-one-to-clear";
export type RegisterOperation = "read" | "write" | "read-modify-write";
export type WriteSemantics = "normal" | "command" | "write-one-to-clear";
export type GenerationMode = "bare-metal" | "cmsis";
export type CommentStyle = "none" | "simple" | "detailed";
export type CommentLanguage = "fr" | "en";
export type OutputKind = "snippet" | "files";
export type GpioModeId =
  | "inputAnalog" | "inputFloating" | "inputPullUp" | "inputPullDown"
  | "outputPushPull2MHz" | "outputPushPull10MHz" | "outputPushPull50MHz"
  | "outputOpenDrain2MHz";

export interface DatabaseSource {
  id: string;
  title: string;
  document: string;
  revision: string;
  url: string;
  license: string;
}

export interface RegisterField {
  name: string;
  lsb: number;
  width: number;
  access: RegisterAccess;
  description?: string;
}

export interface RegisterDefinition {
  id: string;
  name: string;
  peripheral: string;
  address: number;
  baseAddress: number;
  offset: number;
  width: 32;
  access: RegisterAccess;
  readSideEffects: boolean;
  writeSideEffects: boolean;
  writeSemantics: WriteSemantics;
  sourceIds: string[];
  fields: RegisterField[];
}

export interface PackagePin {
  name: string;
  physicalPin: number;
  port: string;
  index: number;
  maxOutputMHz?: number;
  maxLoadPf?: number;
  maxSinkCurrentMilliamp?: number;
  canSourceCurrent?: boolean;
  electricalNote?: string;
  remapRequired?: string;
  defaultFunction?: string;
  alternateFunction?: string;
}

export interface DeviceModel {
  id: string;
  partNumber: string;
  family: string;
  cmsisClass: string;
  core: string;
  flashKiB: number;
  sramKiB: number;
  packageId: string;
  status: "course-reference" | "neighbor-model";
  sourceIds: string[];
}

export interface GenerationPreferences {
  deviceId: string;
  boardProfileId: string;
  mode: GenerationMode;
  comments: CommentStyle;
  commentsLanguage: CommentLanguage;
  showHex: boolean;
  showBin: boolean;
  showDec: boolean;
  explainOffsetsAndMasks: boolean;
  macroPrefix: string;
  functionPrefix: string;
  emitDefines: boolean;
  outputKind: OutputKind;
  previewRequired: boolean;
  expertMode: boolean;
}

export interface GpioConfigurationRequest {
  deviceId: string;
  pinId: string;
  modeId: GpioModeId;
}

export interface GpioConfigurationResult {
  device: DeviceModel;
  pin: PackagePin;
  modeId: GpioModeId;
  modeLabelFr: string;
  modeLabelEn: string;
  gpioRegister: RegisterDefinition;
  rccRegister: RegisterDefinition;
  configShift: number;
  configMask: number;
  configValue: number;
  rccMask: number;
  odrMask?: number;
  odrValue?: number;
  explanations: string[];
  warnings: string[];
}

export interface GeneratedCode {
  outputKind: OutputKind;
  functionName: string;
  snippet?: string;
  header?: string;
  source?: string;
  headerFileName?: string;
  sourceFileName?: string;
  explanations: string[];
  warnings: string[];
  values: Record<string, number>;
}

export interface BitValues {
  hex: string;
  bin: string;
  dec: string;
}
