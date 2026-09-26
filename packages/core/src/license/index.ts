export { scanDeclared, scanDeclaredLicenses, parseNpmPkg, writeFixturePkg } from './scan.js';
export { normalizeToSPDX, isValidSPDX, normalizeExpression, parseLicenses } from './spdx.js';
export { LICENSE_CATEGORIES, checkCompatibility } from './compat.js';
export { parseOrExpression, chooseDualLicense } from './dual.js';
export type { DualDecision } from './dual.js';
export { checkGpl, GPL_REMEDIATIONS } from './gpl.js';
export type { GplWarning, GplSeverity } from './gpl.js';
export {
  detectUnknown,
  recordLicenseDecision,
  getPendingUnknown,
  clearLicenseDecisionsForTests,
  getAllUnknownForTests,
} from './unknown.js';
export type { UnknownLicense } from './unknown.js';
export {
  aggregateLicenseReport,
  aggregateLicenseReportWithGplOpts,
  buildLicenseReportData,
  renderLicenseReportJson,
  buildLicenseReport,
} from './report.js';
export type { LicenseReport } from './types.js';
export { evaluatePolicy, finalGate, buildLicenseReport as buildPolicyReport } from './policy.js';
export {
  runScanCode,
  setDeepScanConfigForTests,
  clearDeepScanConfigForTests,
  setDeepScanExecForTests,
} from './deepScan.js';
export type { DeepScanFile, DeepScanResult } from './deepScan.js';
export {
  registerScanner,
  getScanner,
  hasScanner,
  getRegisteredScanners,
  runDeepScan,
  clearScannerRegistryForTests,
} from './plugin.js';
export type { LicenseScanner, DeepScanConfig } from './plugin.js';
export type { DeclaredLicense, ScanDeclaredOptions } from './scan.js';
export type { LicenseCategory, LicensePolicy, CompatibilityResult } from './types.js';
export type { LicenseReportData, LicenseReportRow } from './types.js';
export { generateNotice, buildNoticeEntries } from './notice.js';
export type { NoticeEntry, NoticeResult } from './notice.js';
export {
  generateLicense,
  generateLicenseWithNotice,
  normalizeLicenseIdForTemplate,
} from './generate.js';
export type { GeneratedLicense, HolderInput, GenerateResult } from './generate.js';
