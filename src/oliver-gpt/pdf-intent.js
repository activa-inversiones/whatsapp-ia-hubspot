// pdf-intent.js — Detección de intención de PDF + captura de cotización (COMPARTIDO)
// ─────────────────────────────────────────────────────────────────────────────
// Extraído de channel-agent.js (idéntico) para que WhatsApp (webhook.js) e IG/FB
// (channel-agent.js) usen la MISMA lógica del PDF determinista y no se desincronicen.
// [2026-06-19 PDF-01] Antes solo IG/FB tenía la red de seguridad; WhatsApp (canal
// principal) dependía 100% de que el LLM llamara la tool → a veces escribía
// "[Enlace a la cotización]" como texto y el cliente NO recibía el PDF.

import { aperturaFueExplicita, detectHojas, FABRICATION_LIMITS as _LIMITES } from '../../services/enginePricer.js';
import { colorFueExplicito } from './normalizers.js';        // [2026-08-29] el color se mide en lo que dijo el CLIENTE
import { COLORES_PROPUESTA } from './propuestas-color.js';   // [2026-08-31] sin color → tres propuestas A/B/C

/** ¿El cliente está afirmando que quiere el PDF? (incluye afirmaciones cortas). */
export function isPdfAffirmative(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/\b(env[ií]a(mela|melo|la|lo)?|m[aá]nda(mela|melo|la|lo)?|quiero (el|la|mi) (pdf|cotiza|propuesta)|el pdf|la propuesta formal)\b/.test(t)) return true;
  // afirmación corta — solo cuenta si el bot venía OFRECIENDO el PDF (ver lastAssistantOfferedPdf).
  return /^(s[ií]|ok(ey)?|dale|ya|perfecto|listo|de acuerdo|claro|por ?fa(vor)?|bueno|obvio|as[ií] es|s[ií]\s*por ?favor)[\s.!👍🙌✅]*$/.test(t);
}

/** ¿El último mensaje del asistente venía ofreciendo el PDF/propuesta formal? */
export function lastAssistantOfferedPdf(history) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === 'assistant') {
      return /\bpdf\b|propuesta formal|propuesta t[eé]cnica|cotizaci[oó]n formal|te (la |lo )?env[ií]o|enviar(te)? (la|el)|¿te (gustar[ií]a|env[ií]o)|mando la propuesta|(te|se|le) la preparo|prepar(o|amos|o la propuesta)|misma propuesta|se la preparo con/i.test(String(m.content || ''));
    }
  }
  return false;
}

/** Extrae los items cotizados de las tool calls del turno (para pending_quote). */
export function itemsFromQuoteCalls(toolCalls, defaultColor) {
  return (toolCalls || [])
    .filter(t => (t.name === 'calcular_cotizacion' || t.name === 'calcular_por_area') && t.result && t.result.ok && Number(t.result.unit_price) > 0)
    .map(t => {
      // [2026-07-06 LOTE2] PRIORIDAD: medidas RESUELTAS por el tool ("AxBmm" — sobreviven la confirmación
      // de unidad). Se separan en CAMPOS NUMÉRICOS (ancho_mm/alto_mm: las re-cotizaciones del PDF usan
      // esto exacto, sin re-parsear) + string LIMPIO para display (Zoho/PDF/alertas ven "350x600").
      // Antes, el texto crudo del cliente ("350x600") se re-manglaba ×10 al re-cotizar en generarPdf.
      const _res = String(t.result?.medidas_resueltas || '').match(/^(\d+)x(\d+)mm$/i);
      return {
        product: t.result.producto_label || t.input?.tipo || 'Ventana',
        producto_label: t.result.producto_label || t.input?.tipo || 'Ventana',
        measures: _res ? `${_res[1]}x${_res[2]}`
          : (t.input?.medidas_texto || t.input?.measures || t.result?.medidas_derivadas ||
            ((t.input?.ancho_mm && t.input?.alto_mm) ? `${t.input.ancho_mm}x${t.input.alto_mm}` : '')),
        ancho_mm: _res ? Number(_res[1]) : undefined,
        alto_mm: _res ? Number(_res[2]) : undefined,
        color: t.input?.color || defaultColor || '',
        qty: Number(t.result.cantidad) || Number(t.input?.cantidad) || 1,
        unit_price: Number(t.result.unit_price) || 0,
        glass_label: t.result.glass_label || 'Termopanel DVH',
        // [2026-08-26] La composicion y la hoja viajan con el item del pending_quote: sin
        // esto el PDF determinista dibujaba la compuesta como un paño (0358 de Paula) y toda
        // corredera con el grueso por defecto.
        compuesta: t.result.compuesta || undefined,
        hoja_mm: (String(t.result.producto_label || '').match(/H(\d{2,3})/i) || [])[1]
          ? Number(String(t.result.producto_label || '').match(/H(\d{2,3})/i)[1]) : undefined,
        ambiente: t.input?.ambiente || '',
        termico: t.result?.termico || null,   // [thermal] Uw → PDF (camino determinista)
        referencial: !!t.result?.referencial, // [2026-07-07] fuera de estándar → escalación a Marcelo (revisión ingeniería)
      };
    })
    .filter(it => Number(it.unit_price) > 0);
}

/**
 * [PDF-RACE 2026-07-01] Guard de COMPLETITUD antes de quemar folio ISO / emitir el PDF (COMPARTIDO).
 * Evidencia BD: PDFs emitidos 9-13 seg ANTES de que el cliente respondiera nombre/color/tipo
 * (folios 0081/0085/0086 Ximena, 0060/0061 Vivi, 0090 Julio — causalidad invertida probada).
 * Regla del dueño: PDF formal SOLO con datos confirmados; el NOMBRE se obtiene ANTES del PDF.
 * NO exige color (política REGLA #13: BLANCO por defecto) para no bloquear PDFs legítimos.
 */
export function quoteDataComplete(input = {}, state = {}, opciones = {}) {
  const missing = [];
  const name = String(input.name || state.name || '').trim();
  if (!name || /^cliente$/i.test(name)) missing.push('name');
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) missing.push('items');
  items.forEach((it, i) => {
    if (!String(it.producto_label || it.product || '').trim()) missing.push(`items[${i}].product`);
    if (!String(it.measures || '').trim()) missing.push(`items[${i}].measures`);
    if (!(Number(it.unit_price) > 0)) missing.push(`items[${i}].unit_price`);
  });
  // 🔴 [2026-08-25] EL COLOR TAMBIEN ES UN DATO OBLIGATORIO.
  //
  // Este gate validaba nombre, medidas y precio, pero no el color — y era el ULTIMO
  // eslabon de la cadena que hacia que **todas** las cotizaciones salieran blancas: el
  // color llegaba vacio y esto lo dejaba pasar sin decir nada.
  //
  // Ahora, si no hay color ni en los items ni recordado de la conversacion, el PDF no se
  // emite y se pide el dato. Es lo que pidio el dueño: *"no cotizar blanco por defecto
  // altiro, debemos ser mas humanos"*. Preguntar el color cuesta un mensaje; cotizar el
  // color equivocado cuesta plata y una recotizacion.
  //
  // ⏱️ Y SI EL CLIENTE NO CONTESTA, NO SE PIERDE LA VENTA. Instruccion del dueño:
  // *"si cliente no dice el color, nosotros le decimos después de un minuto o algo así que
  // le preparamos mientras una de color blanco"*. Equilibra las dos cosas que importan: no
  // cotizar blanco EN SILENCIO (el defecto que costaba plata) y no dejar al cliente sin
  // propuesta esperando un dato que no dio. Se pregunta primero; pasado el minuto sale la
  // blanca CON el aviso de que es blanca y de que se recotiza sin costo.
  const ESPERA_COLOR_MS = Number(process.env.ESPERA_COLOR_MS || 60_000);
  const colorRecordado = String(state.default_color || '').trim();

  // 🔴 [2026-08-31] EL TEXTO DEL COLOR SE PASA APARTE, Y NO ES UN CAPRICHO.
  //
  // Hasta hoy los dos gates —color y apertura— compartian `textoCliente`, asi que IG/FB no
  // podia activar uno sin activar el otro. Y activarle el de la APERTURA a IG/FB esta vetado
  // por la compuerta cruzada: ese gate SI bloquea y en IG/FB no hay rama de pregunta ni
  // reloj ⇒ bloquearia PDFs con el mensaje generico y para siempre. Consecuencia: IG/FB
  // tampoco podia cazar el "Blanco que nadie pidio".
  //
  // Desde hoy el gate del COLOR **ya no bloquea nada** (entrega tres propuestas), asi que
  // activarlo en IG/FB no puede costar un PDF: es seguro por construccion. Se separan los dos
  // textos para poder hacer eso y NADA MAS que eso — el de la apertura sigue igual.
  // `textoColor` cae a `textoCliente` cuando no se pasa, asi WhatsApp no cambia.
  const textoCliente = opciones.textoCliente;
  const textoColor = opciones.textoColor !== undefined ? opciones.textoColor : textoCliente;
  const gateColor = textoColor !== undefined && textoColor !== null;

  // 🔴 [2026-08-29] EL BLANCO QUE NADIE PIDIO. El color efectivo de cada item es el suyo o,
  // si no trae, el recordado de la conversacion — que es exactamente lo que va a ver el motor.
  // Se mide contra el TEXTO DEL CLIENTE por la misma razon que la apertura: el system-prompt
  // le ordena al modelo rellenar "Blanco", asi que el item dice Blanco tanto si el cliente lo
  // pidio como si nadie lo nombro nunca. Mirar solo el item da siempre verde y no caza nada.
  const _colorEfectivo = items
    .map((it) => String(it.color || '').trim() || colorRecordado)
    .filter(Boolean);
  const _todoBlanco = _colorEfectivo.length > 0 && _colorEfectivo.every((c) => /^blanco$/i.test(c));
  const _blancoQueNadiePidio = gateColor && _todoBlanco && !colorFueExplicito(String(textoColor));
  const faltaColor = _blancoQueNadiePidio
    || (!colorRecordado && items.some((it) => !String(it.color || '').trim()));
  // ¿Hay algun color REAL puesto (algo distinto de Blanco)? Entonces el cliente si eligio y
  // lo que falta es completar, no proponer: ese caso conserva el camino viejo. La terna solo
  // tiene sentido cuando NADIE eligio nada — proponerle tres colores a alguien que ya pidio
  // Nogal seria ignorarlo.
  const _hayColorReal = _colorEfectivo.some((c) => !/^blanco$/i.test(c));
  let colorAsumido = false;

  // 🔴 [2026-08-31 · DECISION DEL DUEÑO] SIN COLOR YA NO SE FRENA NI SE INVENTA: SALEN TRES.
  //
  // Textual: *"cuando cliente no entrega color entreguemosle blanco, nogal y negro"* +
  // *"entregar 3 propuestas tecnica economicas una blanco, nogal y new black"*.
  //
  // QUE REEMPLAZA, exactamente: la rama de abajo tenia DOS salidas y las dos costaban plata.
  //   · `missing.push('color')` → frenaba el PDF. Y el plazo de gracia es PASIVO: solo se
  //     re-evalua cuando el cliente vuelve a escribir, asi que el que pregunta, no contesta y
  //     se va NO RECIBE NADA. Sin PDF no sale el evento de cotizacion ⇒ Google Ads no recibe
  //     la conversion (medido: webhook.click-ids.test.js).
  //   · `colorAsumido = true` → salia UNA blanca. Mejor que nada, pero es un color que el
  //     cliente no eligio, y el foliado vale 69-88 % mas: cotizar blanco y entregar nogal es
  //     recotizar o comerse la diferencia.
  // Ninguna de las dos hace falta ya: con tres propuestas rotuladas no hay nada que inventar
  // ni nada que esperar.
  //
  // ⚠️ Y SE SIGUE PREGUNTANDO EL COLOR — una propuesta con el color correcto es mejor que
  // tres. Lo que cambia es DONDE se pregunta, no SI se pregunta: Oliver ya lo pide en su
  // flujo normal de datos ANTES de cotizar, y el mensaje que acompana a las tres lo vuelve a
  // pedir (`textoDeOpciones`), asi el cliente puede colapsar a una sola en el turno siguiente.
  // El prompt ya decia, textual, *"El color NO es bloqueante"*: el gate que bloqueaba lo
  // contradecia. Ahora vuelven a decir lo mismo.
  //
  // ↩️ COMO SE REVIERTE si el dueño lo prefiere al reves (preguntar bloqueando y sacar la
  // terna solo despues del plazo): cambiar el `if` de abajo por
  //     if (preguntaVigente(state.color_preguntado_at) && (Date.now() - state.color_preguntado_at) >= ESPERA_COLOR_MS)
  //         coloresPropuestos = COLORES_PROPUESTA.slice();
  //     else missing.push('color');
  // Todo lo demas (reloj, mensaje del gate, `datoQuePregunta`) sigue en pie para eso.
  let coloresPropuestos = null;
  if (faltaColor && !_hayColorReal) coloresPropuestos = COLORES_PROPUESTA.slice();
  else if (faltaColor) {
    const preguntadoAt = Number(state.color_preguntado_at) || 0;
    // Pedido MIXTO (una ventana Nogal y otra sin color): el cliente SI eligio, solo falta
    // completar. Se le pregunta, y pasado el plazo se completa con Blanco avisando — que es
    // el comportamiento de siempre, intacto.
    if (preguntaVigente(preguntadoAt) && (Date.now() - preguntadoAt) >= ESPERA_COLOR_MS) colorAsumido = true;
    else missing.push('color');
  }

  // 🔴 [2026-08-25] LA APERTURA TAMBIEN ES UN DATO OBLIGATORIO — Y SE MIDE EN LO QUE DIJO
  // EL CLIENTE, NO EN LO QUE ESCRIBIO EL MODELO.
  //
  // Reclamo del dueño, textual: *"siempre está enviando imágenes que igual le cotizamos
  // corredera"*. Verificado: `enginePricer.js` caia a CORREDERA cuando el texto no nombraba
  // ninguna apertura, y el cliente recibia ese precio sin enterarse. Es el mismo defecto que
  // hizo que TODAS las cotizaciones salieran blancas.
  //
  // ⚠️ POR QUE NO SE MIRA EL ITEM: para cuando el item existe, la apertura YA se resolvio —
  // `producto_label` dice "Corredera SLIDING H98" tanto si el cliente la pidio como si nadie
  // la nombro nunca. Mirar ahi da siempre verde y no caza nada. El unico lugar donde "no
  // dijo" sigue siendo distinguible de "dijo corredera" es el texto del cliente.
  //
  // ⏱️ Mismo trato en dos tiempos que el color, por la misma razon: preguntar no puede
  // costar la venta. Se pregunta una vez; si no contesta, sale la corredera CON el aviso.
  const ESPERA_TIPO_MS = Number(process.env.ESPERA_TIPO_MS || 60_000);
  // ⚠️ [2026-08-25 · compuerta cruzada] "NO LO PASA" Y "LO PASA VACIO" NO SON LO MISMO.
  //   · `undefined` = el llamador todavia no manda el dato (IG/FB): el gate NO se activa y el
  //     canal se comporta exactamente como antes. No puede bloquear PDFs por algo que no recibio.
  //   · `''` = el cliente escribio y no dijo NADA util (una foto que la vision no pudo leer, un
  //     audio sin transcribir). Eso es precisamente "no nombro la apertura" ⇒ SE PREGUNTA.
  // Cuando las dos se trataban igual, una cotizacion pedida con una sola foto ilegible salia
  // corredera sin preguntar ni avisar — o sea el reclamo del dueño, intacto, por otro camino.
  // `textoCliente` ya se leyo arriba. ⚠️ [2026-08-31] Este gate mira `textoCliente` y NO
  // `textoColor`: son la misma cosa en WhatsApp, pero IG/FB manda solo el segundo, y este
  // gate SI bloquea. Cuando compartian variable, activarle el color a IG/FB le activaba
  // tambien la apertura — justo lo que la compuerta cruzada veto.
  const gateApertura = textoCliente !== undefined && textoCliente !== null;
  const faltaTipo = gateApertura && !aperturaFueExplicita(String(textoCliente));
  let tipoAsumido = false;

  if (faltaTipo) {
    const preguntadoAt = Number(state.tipo_preguntado_at) || 0;
    if (preguntaVigente(preguntadoAt) && (Date.now() - preguntadoAt) >= ESPERA_TIPO_MS) tipoAsumido = true;
    else missing.push('tipo');
  }

  // 🔴 [2026-08-25] CORREDERA MAS ANCHA QUE EL ESTANDAR ⇒ SE PREGUNTA CUANTAS HOJAS.
  // Instruccion del dueño (caso Martin, 0341 — corredera de 5560 mm cobrada $413 mil de
  // menos): *"por el tamaño debimos preguntarle al cliente si la quiere en 3 hojas o 4
  // hojas; si no dice nada, cotizar en 2 hojas como se hizo pero a un precio real"*.
  // El numero de hojas cambia el precio (medido en el motor: 2h $1.343k · 3h $1.449k ·
  // 4h $1.509k en 5560×2160 roble) y una hoja de 2,8 m pesa el doble que una de 1,4:
  // el cliente tiene que elegirlo, no descubrirlo en la instalacion.
  // Mismo trato en dos tiempos que color y apertura: se pregunta una vez; pasado el plazo
  // sale de 2 hojas (el default del motor) CON aviso.
  const ESPERA_HOJAS_MS = Number(process.env.ESPERA_HOJAS_MS || 60_000);
  const anchoCorredera = (it) => {
    const esCorr = /corredera|sliding/i.test(String(it.producto_label || it.product || ''));
    if (!esCorr) return 0;
    // Puntos de miles fuera ("5.560" → 5560) y se toma el MAYOR de los dos numeros: si las
    // medidas llegaron invertidas ("2160x5560"), el ancho real es el grande — una corredera
    // de 5,5 m de ALTO no existe (Codex, 2a pasada).
    const limpio = String(it.measures || '').replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');
    const mm = limpio.match(/(\d+)\s*[x×]\s*(\d+)/i);
    return mm ? Math.max(Number(mm[1]), Number(mm[2])) : (Number(it.ancho_mm) || 0);
  };
  const MAX_ANCHO_2H = _LIMITES?.SLIDING?.H98?.maxAncho || 2930;
  const gigantes = items.filter((it) => anchoCorredera(it) > MAX_ANCHO_2H);
  // ¿Ya eligio las hojas? El LABEL del propio item gigante siempre vale ("Corredera 3
  // hojas"). El TEXTO del chat vale solo cuando el pedido es de UN item: con varios,
  // "la puerta es de 2 hojas" habilitaria en silencio a la corredera gigante de al lado
  // (falso positivo cazado por Codex).
  const hojasElegidas = gigantes.length > 0 && (
    gigantes.every((it) => detectHojas(String(it.producto_label || it.product || '')))
    || (items.length === 1 && gateApertura && !!detectHojas(String(textoCliente)))
  );
  // Solo se activa con textoCliente presente (WhatsApp): IG/FB todavia no pasa el texto y
  // tampoco tiene la rama de la pregunta — activarles el gate los dejaria bloqueando PDFs
  // con el mensaje generico, sin reloj y para siempre (Codex, 2a pasada).
  const faltaHojas = gateApertura && gigantes.length > 0 && !hojasElegidas;
  let hojasAsumido = false;

  // 🔴 [2026-08-31 · EL DUENO CAMBIO DE DECISION — NO ES UNA REGRESION, NO LO "RESTAURES"]
  // El 25-ago pidio PREGUNTAR: *"por el tamano debimos preguntarle al cliente si la quiere en
  // 3 hojas o 4 hojas"*. El 31-ago lo dio vuelta, textual:
  //   *"el cliente mejor ni decirle que existe las ventanas de tres hojas o cuatro hojas.
  //     Si el cliente las pide, se le cotizan. Si no, se cotiza de dos hojas... y despues yo
  //     le dire: esta ventana esta muy grande, como te la modifico. Eso tambien me da a mi un
  //     grado de confianza con el cliente para poder seguir conversando"*
  // Su razon no es tecnica y por eso el codigo no la puede "mejorar": la conversacion sobre el
  // tamano es SUYA, en la llamada de seguimiento, y le sirve para cerrar. Preguntarselo Oliver
  // le saca ese momento y ademas frena la propuesta por un dato que el cliente no sabe dar.
  //
  // ⚠️ LO QUE ESTO CUESTA, medido el mismo dia y dicho para que quede: una corredera de mas de
  // 2.930 mm no se fabrica en 2 hojas, y cotizarla asi sale 13-21% bajo lo que costaria en 3 o
  // 4 (Winart cobra +35% de 2 a 4 hojas en la MISMA ventana; datos en
  // _activa-docs/winart-validacion/correderas-s75). El dueno lo sabe y decidio igual: lo ajusta
  // el en la llamada. Si algun dia quiere el precio real desde el primer PDF, el cambio es
  // deducir las hojas del ancho aca — NO volver a preguntar.
  if (faltaHojas) hojasAsumido = true;

  // `coloresPropuestos`: null = el cliente eligio (o eligio a medias) ⇒ sale UNA propuesta,
  // como siempre. Array = nadie eligio ⇒ salen esas tres, rotuladas A/B/C.
  return { ok: missing.length === 0, missing, colorAsumido, tipoAsumido, hojasAsumido, coloresPropuestos };
}

/**
 * ¿Sigue VIGENTE la pregunta que se le hizo al cliente, o es de otra conversacion?
 *
 * 🔴 [2026-08-25 · compuerta cruzada] Los relojes de los gates se escribian UNA vez y no se
 * borraban nunca. Efecto medido en el razonamiento, no en la BD: un cliente que cotiza hoy sin
 * dar el color —se le pregunta, no contesta, se le asume Blanco— y vuelve EN TRES DIAS con otro
 * proyecto, trae el reloj ya vencido ⇒ se le asume Blanco **de entrada, sin preguntarle nada**.
 * Es exactamente el defecto que estos gates vinieron a cerrar, reapareciendo por el paso del
 * tiempo.
 *
 * SE RESUELVE CADUCANDO, NO BORRANDO, y es a proposito. Borrar exigiria propagar un `null` a
 * traves del merge del webhook, que hoy es `if (state.X) newState.X = …` y NO propaga nulos: la
 * limpieza no tendria efecto y nadie entenderia por que (lo anticipo Gemini). Una condicion pura
 * acá no depende de ese merge, no se puede olvidar en el camino, y se prueba sin montar un turno.
 *
 * La ventana es la de UNA conversacion, no la de un dato: pasada esa, la pregunta se vuelve a
 * hacer. Preguntar de mas cuesta un mensaje; asumir de mas cuesta plata y una recotizacion.
 */
export function preguntaVigente(preguntadoAt, ahora = Date.now()) {
  const t = Number(preguntadoAt) || 0;
  if (!t) return false;
  const VIGENCIA_MS = Number(process.env.VIGENCIA_PREGUNTA_MS || 2 * 60 * 60 * 1000); // 2 h
  const edad = ahora - t;
  // Un reloj del FUTURO (relojes desincronizados, estado editado a mano) no puede dar por
  // vencido un plazo que nunca corrio.
  if (edad < 0) return false;
  return edad <= VIGENCIA_MS;
}

/**
 * ¿CUAL de los datos que faltan se le va a preguntar al cliente en ESTE turno?
 *
 * Existe para que la respuesta sea UNA SOLA y este en un lugar: el mensaje del gate pregunta
 * un dato por vez, y el reloj del plazo de gracia tiene que arrancar EXACTAMENTE para ese.
 *
 * 🔴 [2026-08-25 · compuerta cruzada] Cuando eran dos decisiones separadas —el mensaje por un
 * lado, los relojes por otro— se marcaban color y apertura a la vez aunque se preguntaba uno
 * solo. El reloj del dato NO preguntado vencia igual y se asumia CORREDERA sin habersela
 * preguntado nunca: el defecto que el gate vino a cerrar, entrando por la puerta de atras.
 *
 * El orden es el del mensaje y no es arbitrario: sin NOMBRE no hay documento que emitir; el
 * color y la apertura cambian el precio, y preguntar dos cosas juntas por WhatsApp hace que
 * el cliente conteste una.
 *
 * @param {string[]} missing — el `missing` de quoteDataComplete.
 * @returns {'name'|'color'|'tipo'|'hojas'|null}
 */
export function datoQuePregunta(missing = []) {
  const f = Array.isArray(missing) ? missing : [];
  if (f.includes('name')) return 'name';
  if (f.includes('color')) return 'color';
  if (f.includes('tipo')) return 'tipo';
  if (f.includes('hojas')) return 'hojas';
  return null;
}

/**
 * [#2 2026-06-21] Anti "precio suelto" (REGLA #13): el monto va SOLO en el PDF formal, NUNCA en el
 * texto del chat. Si el LLM dejó un monto CLP en la respuesta (desobedeció), lo reemplaza por un
 * redirect a la propuesta. El PDF se entrega por el flujo determinista (mismo/próximo turno).
 * CONSERVADOR a propósito (cero falsos positivos): solo dispara con (a) "$" + miles agrupados,
 * (b) miles agrupados + "pesos/CLP", o (c) ≥2 grupos de miles (≥ 1.000.000). NO toca medidas
 * "1.20 m" / "120x150" / "2.400 mm", cantidades "2 ventanas", folios "N° 0021", ni teléfonos.
 */
export function stripMontos(text) {
  if (!text) return text;
  // [Ronda 4 2026-07-20] Separador [.,]: el LLM escribió "$291,158 c/u" (coma gringa) y
  // el regex solo entendía punto chileno → el precio LLEGÓ al cliente (caso real 07-19,
  // conversation_messages, reportado por el dueño). Mismo diseño conservador: la coma
  // exige grupo de EXACTAMENTE 3 dígitos, así "1,5 metros" / "120x150" no se tocan.
  const RX = /\$\s?\d{1,3}(?:[.,]\d{3})+(?:\s?(?:CLP|clp|pesos?))?|\d{1,3}(?:[.,]\d{3})+\s?(?:CLP|clp|pesos?)|\d{1,3}(?:[.,]\d{3}){2,}/g;
  // [2026-08-28] EXCEPCIÓN RUT (caso real Alfredo, conv 56952077379, 4 reclamos "falta el rut"):
  // el LLM escribió el RUT formateado "10.047.794-7" y la alternativa (c) lo comió como si fuera
  // un monto → al cliente le llegó "RUT (valor en la propuesta formal)-7" y se fue enojado.
  // Un número con separadores NO es un monto si: (a) lo sigue un dígito verificador "-7"/"-K",
  // o (b) viene precedido por la palabra RUT. Los montos reales nunca cumplen ninguna de las dos.
  const out = text.replace(RX, (m, off) => {
    // [Codex, misma fecha] Un match con "$" o unidad (CLP/pesos) es MONTO siempre, aunque lo siga
    // un "-2 cuotas" o lo preceda "RUT:" — las excepciones solo valen para números pelados.
    if (/[$]|clp|pesos?/i.test(m)) return '(valor en la propuesta formal)';
    const despues = text.slice(off + m.length, off + m.length + 4);
    // [Gemini, misma fecha] "-N" solo cuenta como dígito verificador si lo que sigue NO continúa
    // como cifra de plata: "1.200.000 - 3 cuotas" / "- 10%" / "- 2 cheques" son montos, no RUT.
    const mDV = despues.match(/^\s?-\s?[0-9kK]/);
    if (mDV) {
      const resto = text.slice(off + m.length + mDV[0].length);
      const sigueComoMonto = /^[0-9%]|^\s*(?:%|cuotas?|pagos?|cheques?|meses|mensual(?:es)?|inter[eé]s|descuentos?|d[ií]as?|abonos?)\b/i.test(resto);
      if (!sigueComoMonto) return m;                               // dígito verificador → es RUT
    }
    const antes = text.slice(Math.max(0, off - 20), off);
    if (/rut\b[^0-9a-z]{0,12}$/i.test(antes)) return m;            // "RUT: 10.047.794" → es RUT
    return '(valor en la propuesta formal)';
  });
  return out === text ? text : out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * [Ronda 4 2026-07-20] Borra ACCIONES FALSAS que el LLM narra en vez de ejecutar:
 * "[Enlace a la cotización]", "[Calculando propuesta...]", "[PDF adjunto]" — casos
 * reales del 16-19 jul (el prompt las prohíbe pero el modelo las escribió igual).
 * Determinista y conservador: solo corchetes que EMPIEZAN con esos verbos/sustantivos.
 * Si el reply queda vacío, el fallback de respuesta-vacía existente toma el control.
 */
export function stripAccionesFalsas(text) {
  if (!text) return text;
  const RX = /\[\s*(?:enlace|link|url|calculando|generando|preparando|procesando|adjunto|pdf|documento|descarga)[^\]\n]*\]/gi;
  const out = text.replace(RX, '');
  return out === text ? text : out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
