// P-234 — a partial Spanish catalog (a SAMPLE, per the phase file).
//
// Typed as `Catalog`, so a key that does not exist in en.ts is a compile
// error; a key that exists but is missing HERE falls back to English at
// runtime.

import type { Catalog } from './en.js';

export const es: Catalog = {
  'shell.tagline': 'Composición multirepositorio aumentada con IA',
  'shell.settings': 'ajustes',
  'shell.runStatus.idle': 'inactivo',
  'tour.hero.title': 'Bienvenido a stitch',
  'tour.hero.cta': 'Haz el recorrido',
  'tour.step': 'paso {current} de {total}',
  'settings.title': 'Ajustes',
  'settings.language.legend': 'Idioma',
  'settings.language.label': 'idioma',
  'settings.language.save': 'Guardar idioma',
  'settings.language.saved': 'idioma guardado',
};
