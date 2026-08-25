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
import { CATALOGO_VIDEOS } from '../services/videosFabrica.js';
import { leer as leerEstado, escribir as escribirEstado, PERSISTENCIA_ACTIVA } from '../services/estadoPersistente.js';

const CARPETA = process.env.VIDEOS_WA_DIR
  || 'C:/Users/mcifu/OneDrive - Activa Inversiones SPA/VIDEOS PARA WHATSAPP/_LISTOS PARA WHATSAPP';
const CLAVE = 'videos_fabrica:media_ids';
const TTL_S = 25 * 24 * 3600;   // 25 dias: vence ANTES que el media_id de Meta (~30)

const forzar = process.argv.includes('--forzar');
const soloListar = process.argv.includes('--listar');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function main() {
  if (!PERSISTENCIA_ACTIVA) {
    console.error('❌ Sin SALES_OS_URL/token: los media_id no se podrian guardar y la subida seria en vano.');
    process.exit(1);
  }

  const guardados = (await leerEstado(CLAVE)) || {};
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

  await escribirEstado(CLAVE, nuevos, TTL_S);
  await new Promise((r) => setTimeout(r, 400));   // la escritura viaja fire-and-forget

  console.log(`\n✅ ${subidos} subidos · ${Object.keys(nuevos).length}/${CATALOGO_VIDEOS.length} disponibles`);
  console.log('⏳ Los media_id caducan a los ~30 días: volvé a correr esto cuando eso pase.');
  console.log('💾 En nuestro servidor no queda ni un byte de video: solo los ids.');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
