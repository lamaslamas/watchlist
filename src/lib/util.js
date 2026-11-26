import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const p = (...a) => path.join(ROOT, ...a);

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, data, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 1 : 0) + '\n');
}
export function loadConfig() {
  return YAML.parse(fs.readFileSync(p('config', 'ranking.yml'), 'utf8'));
}

/** Legge un CSV con intestazione. Salta righe di preambolo finché non trova `headerStartsWith`. */
export function readCsv(file, headerStartsWith) {
  let text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (headerStartsWith) {
    const i = text.split('\n').findIndex(l => l.startsWith(headerStartsWith));
    if (i < 0) throw new Error(`Intestazione "${headerStartsWith}" non trovata in ${file}`);
    text = text.split('\n').slice(i).join('\n');
  }
  return parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
}

/** Normalizza un titolo per i confronti: minuscolo, senza accenti/punteggiatura/articolo iniziale. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^(the|a|an|il|lo|la|i|gli|le|l) /, '');
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
