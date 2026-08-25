#!/usr/bin/env node
// subir-videos-wa.mjs — [2026-08-25]
//
// 🎥 SUBE LOS VIDEOS DE LA FABRICA A META, UNA SOLA VEZ, Y GUARDA SUS `media_id`.
//
// Condicion del dueño: *"que no gaste almacenamiento de nosotros, solo del cliente que
// revise; nosotros no lo volvemos a almacenar"*. Este script es la pieza que lo hace posible:
//   · corre desde el PC del dueño, que es donde estan los videos (OneDrive);
//   · sube cada uno a Meta y se queda SOLO con el `media_id` (~40 caracteres);
//   · guarda esos ids en el estado persistente, que el bot lee al mandar.
// El repo no engorda, Railway no guarda video, y el original sigue en el OneDrive.
//
// ⏳ LOS media_id CADUCAN (~30 dias). Volver a correr esto los repone. Es idempotente: sube
// solo lo que falta, salvo que se le pase --forzar.
//
// USO (desde C:\\Users\\mcifu\\activa\\temp-wa):
//   node tools/subir-videos-wa.mjs              → sube lo que falte
//   node tools/subir-videos-wa.mjs --forzar     → resube todo (para renovar los vencidos)
//   node tools/subir-videos-wa.mjs --listar     → muestra que hay cargado, sin subir nada
//
// Necesita las credenciales de Meta en el entorno (las mismas del bot).

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Las credenciales viven en Railway, no en el PC. Igual que `index.js` (:324), se carga el
// `.env` local ANTES de importar nada que las lea: `estadoPersistente.js` decide en su
// import si la persistencia esta activa, asi que cargarlo despues llegaria tarde.
dotenv.config();

const { CATALOGO_VIDEOS } = await import('../services/videosFabrica.js');
const { leer: leerEstado, escribir: escribirEstado, PERSISTENCIA_ACTIVA } = await import('../services/estadoPersistente.js');

const CARPETA = process.env.VIDEOS_WA_DIR
  || 'C:/Users/mcifu/OneDrive - Activa Inversiones SPA/VIDEOS PARA WHATSAPP/_LISTOS PARA WHATSAPP';
const CLAVE = 'videos_fabrica:media_ids';
const TTL_S = 25 * 24 * 3600;   // 25 dias: vence ANTES que el media_id de Meta (~30)
// Respaldo en disco. El PC del dueño NO tiene las credenciales de sales-os (viven en
// Railway), asi que exigirlas para subir dejaria el script inutilizable justo en la maquina
// donde estan los videos. Con esto sube igual y deja los ids en un JSON del repo, que el bot
// lee si el estado compartido no los tiene.
const ARCHIVO_IDS = path.join(process.cwd(), 'data', 'videos-media-ids.json');

const forzar = process.argv.includes('--forzar');
const soloListar = process.argv.includes('--listar');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function main() {
  if (!process.env.WHATSAPP_TOKEN || !process.env.PHONE_NUMBER_ID) {
    console.error('❌ Faltan las credenciales de WhatsApp para poder subir.');
    console.error('   Poné en el `.env` de esta carpeta: WHATSAPP_TOKEN y PHONE_NUMBER_ID');
    console.error('   (son las MISMAS que ya tiene el bot en Railway — copialas de ahí).');
    process.exit(1);
  }
  if (!PERSISTENCIA_ACTIVA) {
    console.log('ℹ️  Sin SALES_OS_URL/token: los ids se guardan en el archivo del repo');
    console.log(`   ${ARCHIVO_IDS} — hay que commitearlo para que el bot los vea.
`);
  }

  const guardados = (PERSISTENCIA_ACTIVA ? await leerEstado(CLAVE) : null)
    || (fs.existsSync(ARCHIVO_IDS) ? JSON.parse(fs.readFileSync(ARCHIVO_IDS, 'utf8')) : {});
  console.log(`📁 ${CARPETA}`);
  console.log(`💾 ya cargados: ${Object.keys(guardados).length}/${CATALOGO_VIDEOS.length}\n`);

  if (soloListar) {
    for (const v of CATALOGO_VIDEOS) {
      console.log(`${guardados[v.id] ? '✅' : '⬜'} ${v.id.padEnd(14)} ${v.archivo}`);
    }
    return;
  }

  // Se comprueba TODO antes de subir nada: descubrir a la mitad que falta un archivo deja
  // el catalogo a medias y un cliente podria recibir un envio fallido.
  const faltantes = [];
  for (const v of CATALOGO_VIDEOS) {
    const ruta = path.join(CARPETA, v.archivo);
    if (!fs.existsSync(ruta)) faltantes.push(`${v.id}: no existe ${v.archivo}`);
    else if (fs.statSync(ruta).size > 16 * 1024 * 1024) {
      faltantes.push(`${v.id}: ${mb(fs.statSync(ruta).size)} — WhatsApp acepta hasta 16 MB`);
    }
  }
  if (faltantes.length) {
    console.error('❌ Antes de subir hay que resolver esto:');
    faltantes.forEach((f) => console.error(`   · ${f}`));
    process.exit(1);
  }

  const { uploadWaVideo } = await import('../src/sales-agent/whatsapp-adapter.js');
  const nuevos = { ...guardados };
  let subidos = 0;

  for (const v of CATALOGO_VIDEOS) {
    if (guardados[v.id] && !forzar) {
      console.log(`⏭️  ${v.id.padEnd(14)} ya cargado`);
      continue;
    }
    const ruta = path.join(CARPETA, v.archivo);
    const buf = fs.readFileSync(ruta);
    process.stdout.write(`⬆️  ${v.id.padEnd(14)} ${mb(buf.length).padStart(8)} … `);
    try {
      nuevos[v.id] = await uploadWaVideo(buf, v.archivo);
      subidos += 1;
      console.log('OK');
    } catch (e) {
      console.log(`FALLO — ${e.message}`);
    }
  }

  // Se escriben LOS DOS caminos cuando se puede: el estado compartido (que el bot lee sin
  // deploy) y el archivo del repo (que funciona aunque el KV este caido).
  if (PERSISTENCIA_ACTIVA) {
    await escribirEstado(CLAVE, nuevos, TTL_S);
    await new Promise((r) => setTimeout(r, 400));   // la escritura viaja fire-and-forget
  }
  fs.mkdirSync(path.dirname(ARCHIVO_IDS), { recursive: true });
  fs.writeFileSync(ARCHIVO_IDS, `${JSON.stringify(nuevos, null, 2)}
`);
  console.log(`
💾 ids en ${ARCHIVO_IDS}`);
  if (!PERSISTENCIA_ACTIVA) console.log('   → commiteá ese archivo y deployá para que el bot los use.');

  console.log(`\n✅ ${subidos} subidos · ${Object.keys(nuevos).length}/${CATALOGO_VIDEOS.length} disponibles`);
  console.log('⏳ Los media_id caducan a los ~30 días: volvé a correr esto cuando eso pase.');
  console.log('💾 En nuestro servidor no queda ni un byte de video: solo los ids.');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
