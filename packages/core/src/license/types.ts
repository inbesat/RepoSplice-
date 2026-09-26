import type { DeclaredLicense } from './scan.js';
import type { UnknownLicense } from './unknown.js';
import type { GplWarning } from './gpl.js';
import type { DualDecision } from './dual.js';

export type { DeclaredLicense } from './scan.js';
export type { UnknownLicense } from './unknown.js';
export type { GplWarning } from './gpl.js';
export type { DualDecision } from './dual.js';

export type LicenseCategory =
  'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'network-copyleft' | 'unknown';

export interface LicensePolicy {
  allow: ('permissive' | 'weak-copyleft' | 'strong-copyleft' | 'network-copyleft')[];
  denyUnknown: boolean;
  requireAttribution: boolean;
  targetLicense: string;
}

export interface CompatibilityResult {
  decision: 'allow' | 'deny' | 'review';
  reasons: string[];
  failingCategories: LicenseCategory[];
}

export interface DeepScanFile {
  path: string;
  licenses: string[];
  copyrights: string[];
}

export interface DeepScanResult {
  scanner: 'scancode' | 'none';
  files: DeepScanFile[];
  totalFiles: number;
  scannedAt: string;
  optIn: boolean;
}

export interface GeneratedLicense {
  licenseId: string;
  path: string;
  year: string;
  holderLines: string[];
  checksumSha256: string;
}

export interface NoticeEntry {
  package: string;
  version: string;
  license: string;
  copyright?: string;
  sourceRepo?: string;
}

export interface NoticeResult {
  path: string;
  entries: NoticeEntry[];
}

export interface LicenseReport {
  declared: DeclaredLicense[];
  unknown: UnknownLicense[];
  gplWarnings: GplWarning[];
  matrix: CompatibilityResult;
  dual: DualDecision[];
  deep: DeepScanResult | null;
  notice?: NoticeResult;
  generatedLicense?: GeneratedLicense;
  verdict: 'allow' | 'deny' | 'review';
  blocking: boolean;
  reasons: string[];
}

export interface LicenseReportRow {
  package: string;
  version: string;
  declared: string;
  normalized: string;
  category: LicenseCategory;
  decision: 'allow' | 'review' | 'deny';
  reason?: string;
}

export interface LicenseReportData {
  reportVersion: 1;
  generatedAt: string;
  verdict: 'allow' | 'deny' | 'review';
  blocking: boolean;
  rows: LicenseReportRow[];
  summary: {
    total: number;
    allow: number;
    review: number;
    deny: number;
    unknown: number;
    gplWarnings: number;
  };
  dualLicenses: DualDecision[];
  gplWarnings: GplWarning[];
  unknown: UnknownLicense[];
}
