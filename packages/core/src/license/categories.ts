// License categories (P-120, P-121, P-122 shared).
// Single source of truth for SPDX id → LicenseCategory mapping.

import type { LicenseCategory } from './types.js';

export const LICENSE_CATEGORIES: Record<string, LicenseCategory> = {
  // permissive
  MIT: 'permissive',
  'Apache-2.0': 'permissive',
  'BSD-2-Clause': 'permissive',
  'BSD-3-Clause': 'permissive',
  ISC: 'permissive',
  '0BSD': 'permissive',
  'BlueOak-1.0.0': 'permissive',
  Unlicense: 'permissive',
  'CC0-1.0': 'permissive',
  WTFPL: 'permissive',
  Zlib: 'permissive',
  // weak-copyleft
  'MPL-2.0': 'weak-copyleft',
  'LGPL-2.0-only': 'weak-copyleft',
  'LGPL-2.0-or-later': 'weak-copyleft',
  'LGPL-2.1-only': 'weak-copyleft',
  'LGPL-2.1-or-later': 'weak-copyleft',
  'LGPL-3.0-only': 'weak-copyleft',
  'LGPL-3.0-or-later': 'weak-copyleft',
  'EPL-1.0': 'weak-copyleft',
  'EPL-2.0': 'weak-copyleft',
  'CDDL-1.0': 'weak-copyleft',
  // strong-copyleft
  'GPL-2.0-only': 'strong-copyleft',
  'GPL-2.0-or-later': 'strong-copyleft',
  'GPL-3.0-only': 'strong-copyleft',
  'GPL-3.0-or-later': 'strong-copyleft',
  'EUPL-1.1': 'strong-copyleft',
  'EUPL-1.2': 'strong-copyleft',
  // network-copyleft
  'AGPL-1.0-only': 'network-copyleft',
  'AGPL-1.0-or-later': 'network-copyleft',
  'AGPL-3.0-only': 'network-copyleft',
  'AGPL-3.0-or-later': 'network-copyleft',
  'SSPL-1.0': 'network-copyleft',
};
