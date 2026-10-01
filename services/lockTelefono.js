// services/lockTelefono.js — el lock POR TELÉFONO que serializa todo lo que le pasa a un número:
// los turnos de Oliver (webhook.js) y el comando CLIENTE (index.js). UNA sola implementación y UNA
// sola clave (claveTelefono), así un "CLIENTE Pedro" nunca corre a mitad de un turno de Juan.
// Map<clave, Promise> — la promesa encadenada actúa como cola FIFO. Alcance: POR PROCESO.

import { claveTelefono } from './telefono.js';

export const LOCKS = new Map();

/** Adquiere el lock del teléfono. Devuelve release(). */
export async function acquireLock(telefono, locks = LOCKS) {
  const clave = claveTelefono(telefono) || String(telefono);
  const prev = locks.get(clave) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(clave, next);
  await prev;
  return () => {
    release();
    if (locks.get(clave) === next) locks.delete(clave);
  };
}

/** Corre `fn` con el lock del teléfono tomado. */
export async function conLockDeTelefono(telefono, fn, locks = LOCKS) {
  const release = await acquireLock(telefono, locks);
  try { return await fn(); } finally { release(); }
}
