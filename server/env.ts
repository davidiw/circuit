import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads KEY=VALUE lines from a .env file into process.env without overriding values already set. The file is git-ignored; see .env.example. */
export function loadDotEnv(path = resolve(process.cwd(), '.env')): void {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return; }
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('='); if (eq < 0) continue;
    const key = line.slice(0, eq).trim(); let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
